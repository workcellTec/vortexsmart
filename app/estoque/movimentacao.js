// ================================================================
// estoque/movimentacao.js — VortexSmart · Movimentação de Produto
// Registra: window._initEstoqueMovimentacao()
//
// Tela exclusiva do Gestor (checagem de papel no router, não aqui —
// mas a visibilidade do card de entrada também é escondida pra
// Funcionário, ver core.js/aplicarVisibilidadePorPapel). Mostra o
// caminho COMPLETO de um produto: toda entrada, saída (venda),
// estorno (venda cancelada) — com quem fez, quando, e o estoque
// resultante. Paginado (50 por vez, buscando do Firebase só quando
// necessário) porque o histórico de um produto de loja antiga pode
// ter centenas de entradas ao longo de 1 ano+ — não dá pra baixar
// tudo de uma vez.
//
// Depende de (via window.*):
//   _lojaRef, _dbGet, _dbQuery, _dbOrderByChild, _dbStartAt, _dbEndAt,
//   _dbLimitToLast, showCustomModal
// ================================================================
(function () {
    'use strict';

    const el    = id   => document.getElementById(id);
    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc   = s     => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt   = v      => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const PAGE_SIZE = 50;

    let mounted = false;
    let tela = 'lista'; // 'lista' | 'detalhe'
    let produtosCache = null;
    let produtoSelecionado = null;

    // Estado de paginação — específico do produto selecionado no
    // momento, resetado toda vez que troca de produto ou de filtro.
    let paginaAtual = 1;
    let cursorStack = [];      // cursorStack[i] = endAt usado pra buscar a página i+2
    let temProximaPagina = false;
    let filtroDataDe = null;   // timestamp ms, ou null
    let filtroDataAte = null;  // timestamp ms, ou null

    const TIPO_INFO = {
        entrada:  { label: 'Reposição de estoque', icone: 'bi-box-arrow-in-down', classe: '' },
        saida:    { label: 'Venda',                icone: 'bi-cart-check-fill',   classe: '' },
        estorno:  { label: 'Venda cancelada',       icone: 'bi-arrow-counterclockwise', classe: 'cancelado' },
        estorno_reposicao: { label: 'Reposição estornada', icone: 'bi-arrow-counterclockwise', classe: 'cancelado' },
        ajuste:   { label: 'Ajuste manual',         icone: 'bi-sliders',           classe: '' },
    };

    function ensureSkeleton() {
        const container = el('estoqueMovimentacao');
        if (!container || mounted) return;
        mounted = true;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3 id="movTitulo">Movimentação de Produto</h3>
            </div>
            <div class="content-card w-100" id="movConteudo"></div>
        `;
        // O botão usa a classe .btn-back, que já tem delegação central
        // no core.js (chama history.back() sozinha pra qualquer clique
        // dentro de um .btn-back, em qualquer tela do app). Não precisa
        // (e não pode) adicionar um listener manual aqui também — os
        // dois juntos disparavam DOIS history.back() no mesmo clique,
        // pulando a lista e indo direto pro hub.
    }

    function render() {
        // O celular só mostra o cabeçalho (nome do produto) no detalhe — ver style.mobile.css.
        el('estoqueMovimentacao')?.classList.toggle('mov-detalhe', tela === 'detalhe');
        if (tela === 'detalhe') renderDetalhe();
        else renderLista();
    }

    // ── Tela: lista de produtos (ponto de entrada) ─────────────────
    function renderLista() {
        el('movTitulo').textContent = 'Movimentação de Produto';
        const conteudo = el('movConteudo');

        if (!produtosCache) {
            conteudo.innerHTML = `
                <div class="skeleton-row" style="height:44px;"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
            `;
            carregarProdutos().then(render);
            return;
        }

        conteudo.innerHTML = `
            <p class="text-secondary small mb-2">Escolha um produto pra ver o caminho completo dele — toda entrada, venda e cancelamento, com quem fez.</p>
            <input class="form-control mb-3" id="movBusca" placeholder="Buscar produto..."/>
            <div id="movProdutosList"></div>
        `;
        renderProdutosList(produtosCache);
        el('movBusca').addEventListener('input', () => {
            const q = el('movBusca').value.toLowerCase().trim();
            renderProdutosList(!q ? produtosCache : produtosCache.filter(p => (p.nome || '').toLowerCase().includes(q)));
        });
    }

    function renderProdutosList(lista) {
        const box = el('movProdutosList');
        if (!box) return;
        if (!lista.length) { box.innerHTML = `<div class="stq-hist-empty"><i class="bi bi-search"></i><br/>Nenhum produto encontrado.</div>`; return; }
        box.innerHTML = `<div class="cfgA-card">${lista.map(p => `
            <button type="button" class="cfgA-row" data-id="${p.id}">
                <div class="cfgA-icon" style="background:linear-gradient(135deg,#4f8cff,#2563eb);"><i class="bi bi-box-seam-fill"></i></div>
                <div style="flex:1;min-width:0;">
                    <div class="cfgA-name">${esc(p.nome)}</div>
                    <div class="cfgA-row-sub">${p.quantidade ?? 0} un. em estoque</div>
                </div>
                <span class="cfgA-chev">›</span>
            </button>`).join('')}</div>`;
        box.querySelectorAll('[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const produto = lista.find(p => p.id === btn.dataset.id);
                if (!produto) return;
                abrirDetalhe(produto, true);
            });
        });
    }

    // Único ponto que entra na tela de detalhe — usado tanto pelo clique
    // direto (empilha um passo novo no histórico) quanto pela restauração
    // via popstate (não empilha de novo, só redesenha).
    function abrirDetalhe(produto, empilhar) {
        produtoSelecionado = produto;
        tela = 'detalhe';
        paginaAtual = 1;
        cursorStack = [];
        filtroDataDe = null;
        filtroDataAte = null;
        if (empilhar && window._vsPushNav) window._vsPushNav('_movRestaurarDetalhe', [produto.id]);
        render();
    }

    // Chamada pelo sistema de navegação global quando o usuário volta OU
    // avança pra esse passo específico (ver core.js/_vsPushNav) — precisa
    // achar o produto de novo porque uma navegação por histórico pode
    // acontecer bem depois do clique original, com o cache já limpo.
    window._movRestaurarDetalhe = function (produtoId) {
        ensureSkeleton();
        const continuarCom = produto => abrirDetalhe(produto, false);
        const doCache = (produtosCache || []).find(p => p.id === produtoId);
        if (doCache) { continuarCom(doCache); return; }
        window._dbGet(window._lojaRef(`products/${produtoId}`)).then(snap => {
            const val = snap.val();
            continuarCom(val ? { id: produtoId, ...val } : { id: produtoId, nome: 'Produto', quantidade: 0 });
        });
    };

    function carregarProdutos() {
        return window._dbGet(window._lojaRef('products')).then(snap => {
            const data = snap.val() || {};
            produtosCache = Object.keys(data)
                .map(id => ({ id, ...data[id] }))
                .filter(p => !p.arquivado)
                .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
        }).catch(() => { produtosCache = []; });
    }

    // ── Tela: detalhe/timeline de um produto ───────────────────────
    function renderDetalhe() {
        el('movTitulo').textContent = produtoSelecionado?.nome || 'Produto';
        const conteudo = el('movConteudo');
        conteudo.innerHTML = `
            <div class="pulse-hist-search-row" style="margin-bottom:6px;">
                <div class="cfgA-row-sub" style="flex:1;">${produtoSelecionado?.quantidade ?? 0} un. em estoque agora</div>
                <button type="button" class="pulse-icon-btn" id="movDataToggleBtn" title="Filtrar por período" aria-expanded="false"><i class="bi bi-calendar3"></i></button>
            </div>
            <div class="pulse-hist-date-panel" id="movDataPanel" hidden>
                <span class="pulse-hist-date-lbl">De</span>
                <input type="date" id="movDataDe"/>
                <span class="pulse-hist-date-sep">→</span>
                <span class="pulse-hist-date-lbl">Até</span>
                <input type="date" id="movDataAte"/>
                <button type="button" class="pulse-hist-date-clear" id="movDataLimparBtn" title="Limpar período"><i class="bi bi-x-lg"></i></button>
            </div>
            <div id="movTimelineBox"></div>
            <div id="movPaginacaoBox" class="mov-paginacao-row"></div>
        `;

        el('movDataToggleBtn').addEventListener('click', () => {
            const painel = el('movDataPanel');
            const abrir = painel.hasAttribute('hidden');
            painel.toggleAttribute('hidden', !abrir);
            el('movDataToggleBtn').classList.toggle('active', abrir);
            el('movDataToggleBtn').setAttribute('aria-expanded', String(abrir));
        });
        el('movDataLimparBtn').addEventListener('click', () => {
            el('movDataDe').value = '';
            el('movDataAte').value = '';
            aplicarFiltroData();
        });
        el('movDataDe').addEventListener('change', aplicarFiltroData);
        el('movDataAte').addEventListener('change', aplicarFiltroData);

        carregarEExibirPagina();
    }

    function aplicarFiltroData() {
        const deVal  = el('movDataDe')?.value;
        const ateVal = el('movDataAte')?.value;
        filtroDataDe  = deVal  ? new Date(deVal + 'T00:00:00').getTime()  : null;
        filtroDataAte = ateVal ? new Date(ateVal + 'T23:59:59').getTime() : null;
        el('movDataToggleBtn').classList.toggle('active', !!(filtroDataDe || filtroDataAte));
        paginaAtual = 1;
        cursorStack = [];
        carregarEExibirPagina();
    }

    // Busca 1 página (PAGE_SIZE+1, pra saber se tem próxima sem outra
    // chamada) do histórico do produto selecionado, respeitando o
    // filtro de data e a posição de paginação atual. Página 1 usa o
    // filtro "até" (ou nada) como teto; páginas seguintes usam o
    // cursor guardado da página anterior (o timestamp mais antigo já
    // visto, menos 1ms, pra não repetir o mesmo registro na borda).
    function carregarEExibirPagina() {
        const timelineBox = el('movTimelineBox');
        const paginacaoBox = el('movPaginacaoBox');
        timelineBox.innerHTML = `<div class="skeleton-row" style="height:52px;"></div><div class="skeleton-row" style="height:52px;"></div><div class="skeleton-row" style="height:52px;"></div>`;
        paginacaoBox.innerHTML = '';

        const historicoRef = window._lojaRef(`products/${produtoSelecionado.id}/historico`);
        const constraints = [window._dbOrderByChild('timestamp')];

        const endAtCursor = paginaAtual > 1 ? cursorStack[paginaAtual - 2] : filtroDataAte;
        if (endAtCursor != null) constraints.push(window._dbEndAt(endAtCursor));
        if (filtroDataDe  != null) constraints.push(window._dbStartAt(filtroDataDe));
        constraints.push(window._dbLimitToLast(PAGE_SIZE + 1));

        const q = window._dbQuery(historicoRef, ...constraints);
        window._dbGet(q).then(snap => {
            const data = snap.val() || {};
            let entradas = Object.keys(data)
                .map(id => ({ id, ...data[id] }))
                .sort((a, b) => b.timestamp - a.timestamp);

            temProximaPagina = entradas.length > PAGE_SIZE;
            if (temProximaPagina) entradas = entradas.slice(0, PAGE_SIZE);

            // Guarda o cursor pra próxima página, se ainda não guardado
            // (evita duplicar entrada no stack se o usuário voltar e
            // avançar de novo pela mesma página).
            if (temProximaPagina && cursorStack.length < paginaAtual) {
                const maisAntiga = entradas[entradas.length - 1];
                cursorStack.push(maisAntiga.timestamp - 1);
            }

            renderTimeline(entradas);
            renderPaginacao();
        }).catch(e => {
            timelineBox.innerHTML = `<div class="stq-hist-empty"><i class="bi bi-exclamation-triangle"></i><br/>Erro ao carregar: ${esc(e.message)}</div>`;
        });
    }

    function renderTimeline(entradas) {
        const box = el('movTimelineBox');
        if (!entradas.length) {
            box.innerHTML = `<div class="stq-hist-empty"><i class="bi bi-clock-history"></i><br/>Nenhuma movimentação encontrada${(filtroDataDe || filtroDataAte) ? ' nesse período' : ''}.</div>`;
            return;
        }
        box.innerHTML = entradas.map(renderEntradaTimeline).join('');
        box.querySelectorAll('[data-estornar-reposicao]').forEach(btn => {
            btn.addEventListener('click', () => estornarReposicao(btn.dataset.estornarReposicao));
        });
    }

    function renderEntradaTimeline(ent) {
        const info = TIPO_INFO[ent.tipo] || { label: ent.tipo || 'Movimentação', icone: 'bi-arrow-left-right', classe: '' };
        const dataStr = new Date(ent.timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const horaStr = new Date(ent.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const positivo = (ent.delta || 0) >= 0;

        // Linha de detalhe extra — quem fez + contexto específico do tipo
        // (cliente na venda/estorno, fornecedor e valor na reposição).
        const detalhesPartes = [];
        if (ent.usuarioNome) detalhesPartes.push(esc(ent.usuarioNome));
        if (ent.cliente) detalhesPartes.push(`Cliente: ${esc(ent.cliente)}`);
        if (ent.fornecedor) detalhesPartes.push(`Fornecedor: ${esc(ent.fornecedor)}`);
        if (ent.valorUnitario != null) detalhesPartes.push(`${fmt(ent.valorUnitario)}/un.`);

        // Estornar só faz sentido numa reposição (entrada) que ainda não
        // foi estornada — mesmo padrão do estorno de venda já usado no
        // app, só que devolvendo o estoque (delta negativo) em vez de
        // recebendo de volta, e tirando a despesa automática em vez de
        // criar uma. Reposição já estornada mostra só o selo, sem botão.
        let acaoEstorno = '';
        if (ent.tipo === 'entrada') {
            acaoEstorno = ent.estornadoEm
                ? `<div class="stq-hist-sub" style="margin:6px 4px 0 42px;color:var(--danger);"><i class="bi bi-arrow-counterclockwise"></i> Estornada</div>`
                : `<button type="button" class="mov-estornar-btn" data-estornar-reposicao="${ent.id}"><i class="bi bi-arrow-counterclockwise"></i> Estornar</button>`;
        }

        return `
            <div class="mov-entrada-wrap">
                <div class="pulse-tl-row${info.classe ? ' ' + info.classe : ''}" style="border-bottom:none;">
                    <div class="pulse-tl-ic"><i class="bi ${info.icone}"></i></div>
                    <div class="pulse-tl-mid">
                        <div class="pulse-tl-titulo">${info.label}</div>
                        <div class="pulse-tl-sub">${detalhesPartes.join(' · ') || '—'}</div>
                    </div>
                    <div class="pulse-tl-right">
                        <div class="pulse-tl-valor" style="color:${positivo ? 'var(--success)' : 'var(--danger)'};">${positivo ? '+' : ''}${ent.delta ?? 0}</div>
                        <div class="pulse-tl-data">${dataStr} · ${horaStr}</div>
                    </div>
                </div>
                <div class="mov-qtd-apos">Estoque após: ${ent.quantidadeApos ?? '—'} un.</div>
                ${acaoEstorno}
            </div>
        `;
    }

    // Estorna uma reposição: devolve a quantidade E reverte o custo
    // médio (precoCompra) pro que era exatamente ANTES dessa entrada —
    // marca a entrada original como estornada (pra não deixar estornar
    // 2x). A despesa correspondente no Financeiro é retirada aqui mesmo
    // (Gestor) e, como garantia, pelo reconciliador de lancamentos.js
    // (que enxerga 'estornadoEm' preenchido) — funciona mesmo se quem
    // estornou não for Gestor.
    //
    // CORREÇÃO (C4 — custo médio irreversível): antes, o estorno só
    // devolvia a quantidade (delta simples via moverEstoque), sem nunca
    // tocar em precoCompra — a média ponderada ficava contaminada pra
    // sempre por uma entrada que devia ter sido desfeita. Agora usa
    // _estoqueEstornarUltimaEntrada (estoque/produtos.js), que reverte
    // quantidade+precoCompra atomicamente, mas SÓ quando essa entrada
    // ainda é a última movimentação do produto (nenhuma venda, ajuste
    // ou outra reposição depois dela) — decisão de negócio confirmada:
    // fora desse caso, bloqueia e não mexe em nada, em vez de arriscar
    // uma reversão matemática incorreta.
    function estornarReposicao(entId) {
        if (!produtoSelecionado) return;
        const entradaRef = window._lojaRef(`products/${produtoSelecionado.id}/historico/${entId}`);
        window._dbGet(entradaRef).then(snap => {
            const ent = snap.val();
            if (!ent || ent.tipo !== 'entrada' || ent.estornadoEm) return;
            modal({
                message: `Estornar essa reposição de ${Math.abs(ent.delta || 0)} unidade(s)? Isso devolve o estoque, reverte o custo médio pro valor de antes dessa entrada e remove a despesa correspondente do Financeiro. Não dá pra desfazer.`,
                confirmText: 'Estornar', cancelText: 'Cancelar',
                onConfirm: () => {
                    const chaveFinanceiro = `estoque_${produtoSelecionado.id}_${entId}`;
                    window._estoqueEstornarUltimaEntrada(produtoSelecionado, entId, ent)
                        // Tira a despesa dessa compra do Financeiro AGORA (chave
                        // 'estoque_{produtoId}_{historicoId}'), sem esperar a Cloud
                        // Function. Só o Gestor escreve em financeiro/; se quem
                        // estornou não for Gestor, o reconciliador de
                        // financeiro/lancamentos.js limpa quando o Gestor abrir o Financeiro.
                        .then(() => window._financeiroRemoverAutomaticos
                            ? window._financeiroRemoverAutomaticos(k => k === chaveFinanceiro).catch(err => console.error('[Movimentação] Erro ao limpar despesa estornada do Financeiro:', err))
                            : null)
                        .then(() => carregarEExibirPagina())
                        .catch(e => {
                            if (e.code === 'MOVIMENTO_POSTERIOR' || e.code === 'SEM_SNAPSHOT') {
                                // O estorno exato não é possível — oferece o estorno tardio
                                // (tira o lote do estoque e da média e limpa o Financeiro).
                                modal({
                                    message: `${e.message} Quer fazer o estorno tardio? Ele tira essa compra do estoque, recalcula o custo médio sem esse lote e remove a despesa do Financeiro.`,
                                    confirmText: 'Estorno tardio', cancelText: 'Fechar',
                                    onConfirm: () => window._estoqueEstornoCompraFluxo(produtoSelecionado.id, entId, carregarEExibirPagina),
                                    onCancel: () => {}
                                });
                                return;
                            }
                            modal({ message: `Erro ao estornar: ${e.message}` });
                        });
                }
            });
        }).catch(e => modal({ message: `Erro ao buscar reposição: ${e.message}` }));
    }

    function renderPaginacao() {
        const box = el('movPaginacaoBox');
        if (paginaAtual === 1 && !temProximaPagina) { box.innerHTML = ''; return; }
        box.innerHTML = `
            <button type="button" class="btn btn-secondary" id="movPagAnteriorBtn" ${paginaAtual <= 1 ? 'disabled' : ''}>
                <i class="bi bi-chevron-left"></i> Anterior
            </button>
            <span class="mov-pag-numero">Página ${paginaAtual}</span>
            <button type="button" class="btn btn-secondary" id="movPagProximaBtn" ${!temProximaPagina ? 'disabled' : ''}>
                Próxima <i class="bi bi-chevron-right"></i>
            </button>
        `;
        el('movPagAnteriorBtn')?.addEventListener('click', () => {
            if (paginaAtual <= 1) return;
            paginaAtual--;
            carregarEExibirPagina();
        });
        el('movPagProximaBtn')?.addEventListener('click', () => {
            if (!temProximaPagina) return;
            paginaAtual++;
            carregarEExibirPagina();
        });
    }

    // ── Entrada pública ──────────────────────────────────────────
    window._renderEstoqueMovimentacao = function () {
        ensureSkeleton();
        tela = 'lista';
        produtoSelecionado = null;
        render();
    };
})();
