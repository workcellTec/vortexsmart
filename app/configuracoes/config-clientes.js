// ================================================================
// configuracoes/config-clientes.js — VortexSmart · Config → Clientes
// Lista, busca, ranking "Mais compraram" e cadastro/edição de
// clientes.
//
// Node: /clientes/{id} = { nome, telefone, cpf?, dataNascimento?,
//        email?, endereco?, criadoEm }  (mesmo shape que o cadastro
//        rápido do venda/lancar.js já grava — nada de campo novo)
//
// Estatísticas (total gasto, nº de compras, última compra, ranking)
// são calculadas na hora varrendo /vendas por clienteId + status
// 'fechada' — nada disso fica duplicado no cadastro do cliente.
// Carregamento em duas etapas: a lista de /clientes aparece primeiro
// (skeleton enquanto isso), e /vendas (pesado) só é buscado quando a
// aba "Mais compraram" ou a tela de um cliente pedem estatística —
// e mesmo assim sem travar o resto da tela. Lista paginada em blocos
// de 40 pra não pesar o DOM com muitos clientes de uma vez.
//
// Depende de (via window.*):
//   showCustomModal, escapeHtml, _fmt, _lojaRef,
//   _dbGet, _dbUpdate, _dbPush, _dbRemove, _setBtnLoading,
//   openVendaSection (venda/router.js, opcional — link "Ver histórico")
// Expõe via window.*:
//   _initConfigClientes
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc   = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt   = v => typeof window._fmt === 'function' ? window._fmt(v) : `R$ ${Number(v || 0).toFixed(2)}`;
    const el    = id => document.getElementById(id);

    const AVATAR_CORES = ['#5b3df5', '#059669', '#d97706', '#dc2626', '#2563eb', '#0891b2', '#db2777'];
    const RANK_CORES   = ['#d97706', '#94a3b8', '#b45309']; // ouro · prata · bronze

    let mounted = false;
    let clientesCache = null;   // [{id, nome, telefone, cpf, dataNascimento, email, endereco, criadoEm}]
    let statsCache = null;      // { [clienteId]: { gasto, compras, ultima } } — carrega em paralelo, não trava a lista
    let carregandoStats = false;
    let aba = 'todos';          // 'todos' | 'top'
    let termoBusca = '';
    let buscaDebounceTimer = null;
    let clienteAbertoId = null; // null = lista · id = tela de detalhe/edição
    let modoNovo = false;
    let paginaAtual = 1;
    const PAGINA_TAMANHO = 20;  // muitos clientes de uma vez pesa o DOM no celular — carrega em blocos

    // ── Skeleton (uma vez só) ───────────────────────────────────
    function ensureSkeleton() {
        const container = el('configuracoesClientes');
        if (!container || mounted) return;
        mounted = true;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="section-header">
                <button class="btn-icon-circle" id="ccBackBtn" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3 id="ccTitulo">Clientes</h3>
                <button type="button" class="btn-header-action" id="ccHeaderActionBtn"><i class="bi bi-person-plus-fill"></i></button>
            </div>
            <div class="content-card w-100" id="ccConteudo"></div>
        `;
        el('ccBackBtn').addEventListener('click', voltar);
    }

    function voltar() {
        if (clienteAbertoId || modoNovo) {
            clienteAbertoId = null;
            modoNovo = false;
            render();
        } else {
            history.back();
        }
    }

    // ── Dados ────────────────────────────────────────────────────
    // Separado em duas buscas independentes: clientes é leve e é o
    // que a pessoa quer ver primeiro; vendas é pesado (histórico
    // inteiro, só serve pra somar estatística) e não pode travar a
    // lista na tela de carregamento por causa disso.
    // Lista em TEMPO REAL (um ouvinte só). Antes era lida uma vez e nunca mais: cliente
    // cadastrado pela Nova Venda (ou em outro aparelho) não aparecia aqui, e uma falha na
    // 1ª leitura virava "lista vazia" pra sempre.
    // A promessa é COMPARTILHADA e só resolve quando o 1º dado (ou o erro) chega — devolver uma
    // promessa já resolvida com o cache ainda vazio fazia render() → carregarClientes().then(render)
    // virar um laço que nunca solta o navegador.
    let clientesErro = false;
    let clientesPromessa = null;
    function carregarClientes() {
        if (clientesPromessa) return clientesPromessa;
        clientesPromessa = new Promise(resolve => {
            window._dbOnValue(window._lojaRef('clientes'), snap => {
                const data = snap.val();
                clientesCache = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })) : [];
                clientesErro = false;
                resolve();
                atualizarListaAoVivo();
            }, () => {
                clientesPromessa = null; // tenta de novo na próxima vez
                clientesErro = true;
                resolve();
            });
        });
        return clientesPromessa;
    }

    // Chegou dado novo com a tela de clientes aberta: atualiza só o que mudou (sem recriar a
    // busca, senão o cursor pula) e não mexe se tem formulário aberto.
    function atualizarListaAoVivo() {
        if (!el('ccConteudo') || modoNovo || clienteAbertoId) return;
        if (!el('ccResultados')) { render(); return; }
        const abaTodos = el('ccAbaTodos');
        if (abaTodos) abaTodos.textContent = `Todos (${clientesCache.length})`;
        renderResultados();
    }

    function carregarStats() {
        if (carregandoStats) return Promise.resolve();
        carregandoStats = true;
        return window._dbGet(window._lojaRef('vendas')).then(snap => {
            const vendasData = snap.val();
            const vendas = vendasData ? Object.values(vendasData) : [];
            statsCache = {};
            vendas.forEach(v => {
                if (v.status !== 'fechada' || !v.clienteId) return;
                const s = statsCache[v.clienteId] || (statsCache[v.clienteId] = { gasto: 0, compras: 0, ultima: 0 });
                s.gasto += v.valorTotal || 0;
                s.compras += 1;
                const data = v.fechadaEm || v.criadoEm || 0;
                if (data > s.ultima) s.ultima = data;
            });
        }).catch(() => { statsCache = {}; }).finally(() => { carregandoStats = false; });
    }

    // ── Helpers visuais ──────────────────────────────────────────
    function iniciais(nome) {
        const partes = (nome || '?').trim().split(/\s+/);
        return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
    }
    function corAvatar(nome) {
        let h = 0;
        for (let i = 0; i < (nome || '').length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
        return AVATAR_CORES[h % AVATAR_CORES.length];
    }
    function dataStr(ts) {
        return ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    }

    // ── Render raiz ──────────────────────────────────────────────
    function render() {
        if (!el('ccConteudo')) return;
        if (modoNovo) return renderForm(null);
        if (clienteAbertoId) return renderForm(clientesCache.find(c => c.id === clienteAbertoId) || null);
        renderLista();
    }

    // ── Tela: lista + busca + ranking ───────────────────────────
    function renderLista() {
        el('ccTitulo').textContent = 'Clientes';
        const acaoBtn = el('ccHeaderActionBtn');
        acaoBtn.style.display = 'flex';
        acaoBtn.classList.remove('danger');
        acaoBtn.innerHTML = '<i class="bi bi-person-plus-fill"></i>';
        acaoBtn.onclick = abrirNovo;

        const conteudo = el('ccConteudo');
        if (!clientesCache && clientesErro) {
            conteudo.innerHTML = `
                <div class="stq-hist-empty">Não consegui carregar os clientes. Confira a conexão.</div>
                <button type="button" class="btn btn-ok w-100 mt-2" id="ccTentarDeNovo">Tentar de novo</button>
            `;
            el('ccTentarDeNovo').addEventListener('click', () => { clientesErro = false; renderLista(); });
            return;
        }
        if (!clientesCache) {
            conteudo.innerHTML = `
                <div class="skeleton-row" style="height:44px;"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
            `;
            carregarClientes().then(render);
            return;
        }

        // Shell fixo: a busca e as abas só são desenhadas uma vez ao
        // entrar na lista. Digitar não recria o <input> (senão o cursor
        // pula pro fim a cada tecla) — só o bloco de resultados abaixo
        // é reconstruído, via renderResultados().
        conteudo.innerHTML = `
            <div class="cc-search"><i class="bi bi-search"></i><input id="ccBusca" placeholder="Buscar por nome, CPF ou telefone..." value="${esc(termoBusca)}"></div>
            <div class="cc-seg">
                <button type="button" class="${aba === 'todos' ? 'active' : ''}" id="ccAbaTodos">Todos (${clientesCache.length})</button>
                <button type="button" class="${aba === 'top' ? 'active' : ''}" id="ccAbaTop">Mais compraram</button>
            </div>
            <div id="ccResultados"></div>
        `;

        el('ccBusca').addEventListener('input', e => {
            const valor = e.target.value;
            clearTimeout(buscaDebounceTimer);
            buscaDebounceTimer = setTimeout(() => { termoBusca = valor; paginaAtual = 1; renderResultados(); }, 200);
        });
        el('ccAbaTodos').addEventListener('click', () => { if (aba === 'todos') return; aba = 'todos'; paginaAtual = 1; renderLista(); });
        el('ccAbaTop').addEventListener('click', () => { if (aba === 'top') return; aba = 'top'; paginaAtual = 1; renderLista(); });

        renderResultados();
    }

    // Recalcula/repinta só a lista de resultados — chamado pela busca
    // (debounced), pelo "Ver mais" e quando as estatísticas terminam
    // de carregar. Nunca mexe no <input> de busca, então o foco fica
    // intacto enquanto a pessoa digita.
    function renderResultados() {
        const resultados = el('ccResultados');
        if (!resultados) return;

        // Aba "Mais compraram" depende das vendas — só busca esse node
        // pesado quando alguém realmente pede o ranking, não de cara.
        if (aba === 'top' && !statsCache) {
            resultados.innerHTML = `
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
                <div class="cc-hint"><i class="bi bi-hourglass-split"></i> Somando as vendas fechadas pra montar o ranking...</div>
            `;
            carregarStats().then(() => { if (aba === 'top') renderResultados(); });
            return;
        }

        const termo = termoBusca.trim().toLowerCase();
        const soDigitos = s => (s || '').replace(/\D/g, '');
        let lista = clientesCache.filter(c => {
            if (!termo) return true;
            return (c.nome || '').toLowerCase().includes(termo)
                || (soDigitos(c.cpf) && soDigitos(c.cpf).includes(soDigitos(termo)))
                || (soDigitos(c.telefone) && soDigitos(c.telefone).includes(soDigitos(termo)));
        });

        if (aba === 'top') {
            lista = lista.filter(c => statsCache[c.id]).sort((a, b) => (statsCache[b.id]?.gasto || 0) - (statsCache[a.id]?.gasto || 0));
        } else {
            lista = lista.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
        }

        // Paginação: renderiza só um bloco por vez — com muitos clientes,
        // jogar tudo de uma vez no DOM é o que mais pesa a rolagem no celular.
        const totalFiltrados = lista.length;
        const visiveis = lista.slice(0, paginaAtual * PAGINA_TAMANHO);
        const temMais = visiveis.length < totalFiltrados;

        resultados.innerHTML = `
            ${visiveis.length ? `
            <div class="cc-card">
                ${visiveis.map((c, i) => {
                    const s = statsCache ? statsCache[c.id] : null;
                    const rank = aba === 'top' ? i : -1;
                    return `
                    <div class="cc-row" data-id="${c.id}">
                        ${rank >= 0 && rank < 3 ? `<span class="cc-rank-badge" style="background:${RANK_CORES[rank]};">${rank + 1}</span>` : ''}
                        <div class="cc-avatar" style="background:${corAvatar(c.nome)};${rank >= 0 && rank < 3 ? 'margin-left:14px;' : ''}">${iniciais(c.nome)}</div>
                        <div class="cc-body">
                            <div class="cc-nome">${esc(c.nome || 'Sem nome')}</div>
                            <div class="cc-sub">${aba === 'top' ? `${s?.compras || 0} compra${(s?.compras || 0) !== 1 ? 's' : ''}` : esc(c.telefone || 'Sem telefone')}</div>
                        </div>
                        ${aba === 'top'
                            ? `<div class="cc-right"><div class="cc-gasto">${fmt(s?.gasto || 0)}</div></div>`
                            : `<i class="bi bi-chevron-right cc-chevron"></i>`}
                    </div>`;
                }).join('')}
            </div>
            ${temMais ? `<button type="button" class="venda-ver-mais-btn" id="ccVerMaisBtn">Ver mais (${totalFiltrados - visiveis.length} restantes)</button>` : ''}
            ${aba === 'top' ? `<div class="cc-hint"><i class="bi bi-info-circle"></i> Ranking soma só vendas fechadas — pendentes e canceladas não contam.</div>` : ''}
            ` : `<div class="stq-hist-empty">${termo ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}</div>`}
        `;

        el('ccVerMaisBtn')?.addEventListener('click', () => { paginaAtual += 1; renderResultados(); });
        resultados.querySelectorAll('.cc-row').forEach(row => {
            row.addEventListener('click', () => { clienteAbertoId = row.dataset.id; render(); });
        });
    }

    // ── Tela: detalhe / edição / novo ───────────────────────────
    function renderForm(cliente) {
        const novo = !cliente;
        el('ccTitulo').textContent = novo ? 'Novo Cliente' : (cliente.nome || 'Cliente');

        const acaoBtn = el('ccHeaderActionBtn');
        acaoBtn.style.display = novo ? 'none' : 'flex';
        acaoBtn.classList.toggle('danger', !novo);
        acaoBtn.innerHTML = '<i class="bi bi-trash"></i>';
        acaoBtn.onclick = novo ? null : () => confirmarExclusao(cliente);

        const conteudo = el('ccConteudo');
        const statsProntas = !novo && !!statsCache;
        const s = statsProntas ? statsCache[cliente.id] : null;
        if (!novo && !statsCache) {
            carregarStats().then(() => { if (clienteAbertoId === cliente.id) renderForm(cliente); });
        }

        conteudo.innerHTML = `
            ${!novo ? `
            <div class="cc-profile-head">
                <div class="cc-avatar-big" style="background:${corAvatar(cliente.nome)};">${iniciais(cliente.nome)}</div>
                <div class="cc-profile-nome">${esc(cliente.nome || 'Sem nome')}</div>
                <div class="cc-profile-sub">Cliente desde ${dataStr(cliente.criadoEm)}</div>
            </div>
            <div class="cc-stats-row">
                <div class="cc-stat-box"><div class="v">${statsProntas ? fmt(s?.gasto || 0) : '…'}</div><div class="l">Total gasto</div></div>
                <div class="cc-stat-box"><div class="v">${statsProntas ? (s?.compras || 0) : '…'}</div><div class="l">Compras</div></div>
                <div class="cc-stat-box"><div class="v">${statsProntas ? (s?.ultima ? dataStr(s.ultima) : '—') : '…'}</div><div class="l">Última compra</div></div>
            </div>
            <div class="cc-link-historico" id="ccVerHistorico"><i class="bi bi-receipt"></i> Ver histórico de compras</div>
            ` : ''}

            <div class="cc-field-lbl"><i class="bi bi-person"></i> Nome completo</div>
            <input class="cc-field-input" id="ccFNome" value="${esc(cliente?.nome || '')}" placeholder="Nome completo">

            <div class="cc-field-row-2">
                <div>
                    <div class="cc-field-lbl"><i class="bi bi-card-text"></i> CPF</div>
                    <input class="cc-field-input" id="ccFCpf" value="${esc(cliente?.cpf || '')}" placeholder="000.000.000-00">
                </div>
                <div>
                    <div class="cc-field-lbl"><i class="bi bi-cake2"></i> Nascimento</div>
                    <input class="cc-field-input" id="ccFNascimento" type="date" value="${cliente?.dataNascimento || ''}">
                </div>
            </div>
            <div class="cc-field-row-2">
                <div>
                    <div class="cc-field-lbl"><i class="bi bi-telephone"></i> Telefone</div>
                    <input class="cc-field-input" id="ccFTelefone" value="${esc(cliente?.telefone || '')}" placeholder="(00) 00000-0000">
                </div>
                <div>
                    <div class="cc-field-lbl"><i class="bi bi-envelope"></i> Email</div>
                    <input class="cc-field-input" id="ccFEmail" value="${esc(cliente?.email || '')}" placeholder="email@exemplo.com">
                </div>
            </div>
            <div class="cc-field-lbl"><i class="bi bi-geo-alt"></i> Endereço</div>
            <input class="cc-field-input" id="ccFEndereco" value="${esc(cliente?.endereco || '')}" placeholder="Rua, número, bairro...">

            <button type="button" class="btn btn-ok w-100" id="ccSalvarBtn"><i class="bi bi-check-circle"></i> ${novo ? 'Cadastrar cliente' : 'Salvar alterações'}</button>
        `;

        el('ccSalvarBtn').addEventListener('click', () => salvar(cliente));
        el('ccVerHistorico')?.addEventListener('click', () => {
            if (typeof window.openVendaSection === 'function') window.openVendaSection('historicoVendas');
        });
        el('ccFNome')?.focus();
    }

    function abrirNovo() {
        modoNovo = true;
        clienteAbertoId = null;
        render();
    }

    function salvar(clienteExistente) {
        const nome = (el('ccFNome').value || '').trim();
        if (!nome) { modal({ message: 'Digite o nome do cliente.' }); return; }
        const dados = {
            nome,
            cpf:            (el('ccFCpf').value || '').trim() || null,
            telefone:       (el('ccFTelefone').value || '').trim() || null,
            dataNascimento: el('ccFNascimento').value || null,
            email:          (el('ccFEmail').value || '').trim() || null,
            endereco:       (el('ccFEndereco').value || '').trim() || null,
        };
        const btn = el('ccSalvarBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');

        const salvo = clienteExistente
            ? window._dbUpdate(window._lojaRef(`clientes/${clienteExistente.id}`), dados).then(() => clienteExistente.id)
            : window._dbPush(window._lojaRef('clientes'), { ...dados, criadoEm: Date.now(), criadoPorUid: window._firebaseAuthUid || null }).then(res => res.key);

        salvo.then(id => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            if (clienteExistente) {
                Object.assign(clienteExistente, dados);
            } else {
                if (clientesCache && !clientesCache.some(c => c.id === id)) clientesCache.push({ id, ...dados, criadoEm: Date.now() }); // o ouvinte em tempo real pode já ter trazido
            }
            modal({ message: clienteExistente ? 'Cliente atualizado!' : 'Cliente cadastrado!' });
            modoNovo = false;
            clienteAbertoId = null;
            render();
        }).catch(e => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            modal({ message: `Erro ao salvar cliente: ${e.message}` });
        });
    }

    function confirmarExclusao(cliente) {
        modal({
            message: `Excluir ${cliente.nome}? As vendas já feitas continuam no histórico normalmente.`,
            confirmText: 'Excluir',
            cancelText: 'Cancelar',
            onConfirm: () => {
                window._dbRemove(window._lojaRef(`clientes/${cliente.id}`)).then(() => {
                    clientesCache = clientesCache.filter(c => c.id !== cliente.id);
                    clienteAbertoId = null;
                    render();
                }).catch(e => modal({ message: `Erro ao excluir cliente: ${e.message}` }));
            },
            onCancel: () => {}
        });
    }

    // ── Entrada pública ──────────────────────────────────────────
    // Pré-carrega a lista de clientes em segundo plano, sem montar a UI
    // — chamado assim que a tela Configurações Home abre (configuracoes/
    // router.js), pra quando o usuário realmente clicar em "Clientes" a
    // lista já estar pronta (ou quase), sem esperar o round-trip.
    // Não faz nada se já estiver carregado ou carregando.
    let preCarregando = false;
    window._preCarregarClientes = function () {
        if (clientesCache || preCarregando) return;
        preCarregando = true;
        carregarClientes().finally(() => { preCarregando = false; });
    };

    window._initConfigClientes = function () {
        ensureSkeleton();
        aba = 'todos';
        termoBusca = '';
        clienteAbertoId = null;
        modoNovo = false;
        paginaAtual = 1;
        render();
    };
})();