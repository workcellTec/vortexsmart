// ================================================================
// financeiro/lancamentos.js — VortexSmart · Financeiro → Lançamentos
// Registra: window._renderFinanceiroLancamentos()
//
// Combina VER + LANÇAR na mesma tela (Opção B, aprovada) — categoria,
// valor e data é rápido demais pra merecer uma tela própria só pra
// isso, mesmo raciocínio que o Estoque já usa com "Adicionar Produto"
// direto na lista.
//
// Fonte dos dados: financeiro/lancamentos/{id} — automáticos (venda:
// cada pagamento avulso/parcela paga, regime de caixa; reposição: cada
// entrada com valor — criados pelas Cloud Functions financeiroSyncVenda e
// financeiroSyncReposicao, e RETIRADOS também pelo próprio app quando a
// venda é cancelada/a reposição estornada: ver reconciliarAutomaticos
// abaixo e window._financeiroRemoverAutomaticos em core.js)
// e manuais (gravados aqui mesmo).
// ================================================================
(function () {
    'use strict';
    const el     = id => document.getElementById(id);
    const modal  = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc    = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt    = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const ref    = p => window._lojaRef(p);
    // financeiro/{lojaId}/... mora fora de lojas/{lojaId} de propósito
    // (regra própria, 100% Gestor) — ver window._financeiroRef em
    // core.js pro raciocínio completo.
    const refFin = p => window._financeiroRef(p);

    const CAT_DESPESA = window._FINANCEIRO_CATEGORIAS_DESPESA_BASE || [];
    const CAT_RECEITA = window._FINANCEIRO_CATEGORIAS_RECEITA_BASE || [];

    let mounted = false;
    let tela = 'lista'; // 'lista' | 'form'
    let tipoForm = 'despesa';
    let filtroTipo = 'todos';       // 'todos' | 'receita' | 'despesa'
    let filtroOrigem = 'todas';     // 'todas' | 'automatica' | 'manual'
    let filtroCategorias = [];      // ids selecionados (vazio = todas)
    let termoBusca = '';
    let expandedId = null;
    let fotoBlob = null;
    let rascunhoForm = null;        // o que já foi digitado, pra não sumir ao trocar Receita ↔ Despesa
    const LIMITE_PAGINA = 30;
    let limiteExibicao = LIMITE_PAGINA;

    // Período em exibição — mesmo padrão de Dia/Semana/Mês/Personalizado
    // que venda/relatorios.js já usa, com navegação prev/next (ali não
    // navega, sempre é "a partir de agora" — aqui precisa, já que dá
    // pra olhar meses/dias passados). Sempre começa no mês corrente.
    let periodoTipo = 'mes'; // 'dia' | 'semana' | 'mes' | 'personalizado'
    let periodoRef = new Date(); periodoRef.setHours(0, 0, 0, 0);
    let personalDe = '', personalAte = '';
    const NOMES_MES_LONGO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    function faixaDoPeriodoAtual() {
        if (periodoTipo === 'dia') {
            const inicio = new Date(periodoRef); inicio.setHours(0, 0, 0, 0);
            const fim = new Date(inicio); fim.setDate(fim.getDate() + 1);
            return [inicio, fim];
        }
        if (periodoTipo === 'semana') {
            // Domingo a sábado — mesma convenção que relatorios.js já usa.
            const inicio = new Date(periodoRef);
            inicio.setDate(inicio.getDate() - inicio.getDay());
            inicio.setHours(0, 0, 0, 0);
            const fim = new Date(inicio); fim.setDate(fim.getDate() + 7);
            return [inicio, fim];
        }
        if (periodoTipo === 'personalizado') {
            if (!personalDe || !personalAte) return [new Date(8640000000000000), new Date(-8640000000000000)]; // faixa vazia até preencher os dois
            const inicio = new Date(personalDe + 'T00:00:00');
            const fimIncl = new Date(personalAte + 'T00:00:00');
            const fim = new Date(fimIncl); fim.setDate(fim.getDate() + 1);
            return [inicio, fim];
        }
        // mes
        const inicio = new Date(periodoRef.getFullYear(), periodoRef.getMonth(), 1);
        const fim = new Date(inicio); fim.setMonth(fim.getMonth() + 1);
        return [inicio, fim];
    }

    function dentroDoPeriodoAtual(item) {
        const [inicio, fim] = faixaDoPeriodoAtual();
        const t = item.criadoEm || 0;
        return t >= inicio.getTime() && t < fim.getTime();
    }

    function navegarPeriodoAtual(direcao) {
        const novo = new Date(periodoRef);
        if (periodoTipo === 'dia') novo.setDate(novo.getDate() + direcao);
        else if (periodoTipo === 'semana') novo.setDate(novo.getDate() + direcao * 7);
        else {
            // Mês: só o mês importa. Sem voltar pro dia 1 antes de somar, 31/mar − 1 mês
            // vira "31/fev" = 03/mar e a navegação ficava presa em março nos dias 29–31.
            novo.setDate(1);
            novo.setMonth(novo.getMonth() + direcao);
        }
        periodoRef = novo;
    }

    function labelPeriodoAtual() {
        if (periodoTipo === 'dia') return periodoRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        if (periodoTipo === 'semana') {
            const [inicio, fim] = faixaDoPeriodoAtual();
            const fimIncl = new Date(fim); fimIncl.setDate(fimIncl.getDate() - 1);
            const f = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            return `${f(inicio)} – ${f(fimIncl)}`;
        }
        if (periodoTipo === 'personalizado') return null; // não usa label de nav, usa os campos De/Até
        return `${NOMES_MES_LONGO[periodoRef.getMonth()]} ${periodoRef.getFullYear()}`;
    }

    function ensureSkeleton() {
        const container = el('financeiroLancamentos');
        if (!container || mounted) return;
        container.innerHTML = `<div id="finLancBody" class="vs-fin-largura"></div>`;
        mounted = true;
    }

    function todosLancamentos() {
        const data = window._financeiroLancamentos || {};
        return Object.keys(data).map(id => ({ id, ...data[id] }));
    }

    // ── Reconciliador do caixa (lançamentos AUTOMÁTICOS) ──────────────
    // Garante que nenhum lançamento automático fique "fantasma" no Financeiro
    // depois que a coisa que o gerou deixou de existir. Não depende da Cloud
    // Function ter reagido: confere direto na fonte e REMOVE o que perdeu o
    // lastro. Cobre os casos que deixavam o Saldo de caixa errado:
    //   • venda CANCELADA (ou apagada)  → some tudo de 'venda_{id}…'
    //   • pagamento removido numa edição → some 'venda_{id}_p{n}'
    //   • parcela desmarcada/revogada    → some 'venda_{id}_p{n}_i{m}'
    //   • reposição ESTORNADA, ou produto/entrada apagado → some 'estoque_{produtoId}_{historicoId}'
    // Só REMOVE (nunca cria nem altera valor) e só mexe em origem 'automatica' —
    // lançamento manual é intocável. Leitura que falha nunca remove nada.
    // Roda quando qualquer tela do Financeiro abre (no máximo 1x por minuto);
    // o cancelamento/estorno feito pelo Gestor já limpa na hora (ver
    // window._financeiroRemoverAutomaticos em core.js) — este aqui pega o que
    // foi feito por Funcionário ou por outro aparelho.
    const JANELA_RECONCILIAR_DIAS = 120;
    const comoLista = x => (Array.isArray(x) ? x : Object.values(x || {}));
    let reconciliando = false;
    let ultimaReconciliacao = 0;

    // O lançamento 'venda_{id}…' ainda tem lastro na venda?
    function lancamentoDeVendaTemLastro(chave, vendaId, venda) {
        if (!venda) return false;                                  // venda apagada
        if (venda.status === 'cancelada') return false;            // venda cancelada
        if (venda.status === 'cancelando') return true;            // cancelamento em andamento: espera terminar
        const resto = chave.slice(`venda_${vendaId}`.length);      // '' | '_p0' | '_p0_i2'
        if (!resto) return true;                                   // chave antiga (valor inteiro): não mexe
        const m = /^_p(\d+)(?:_i(\d+))?$/.exec(resto);
        if (!m) return true;                                       // formato desconhecido: não mexe
        const pagamento = comoLista(venda.pagamentos)[Number(m[1])];
        if (!pagamento) return false;                              // pagamento não existe mais
        const ehParcelado = pagamento.forma === 'parcelado' && !!pagamento.itens;
        if (m[2] === undefined) return !ehParcelado;               // avulso (só vale se NÃO virou parcelado)
        if (!ehParcelado) return false;
        const item = comoLista(pagamento.itens)[Number(m[2])];
        return !!(item && item.paga);                              // parcela só vale enquanto estiver paga
    }

    function emLotes(itens, fn, tamanho) {
        let cadeia = Promise.resolve();
        for (let i = 0; i < itens.length; i += tamanho) {
            cadeia = cadeia.then(() => Promise.all(itens.slice(i, i + tamanho).map(fn)));
        }
        return cadeia;
    }

    function reconciliarAutomaticos(tentativa) {
        tentativa = tentativa || 0;
        if (reconciliando || window._papelUsuario !== 'gestor') return;
        if (!window._financeiroLancamentos) { // 1ª leitura do Financeiro ainda não chegou
            if (tentativa < 6) setTimeout(() => reconciliarAutomaticos(tentativa + 1), 1500);
            return;
        }
        if (Date.now() - ultimaReconciliacao < 60000) return;
        reconciliando = true;

        const desde = Date.now() - JANELA_RECONCILIAR_DIAS * 24 * 60 * 60 * 1000;
        const autos = todosLancamentos().filter(l => l.origem === 'automatica' && (l.criadoEm || 0) >= desde);
        const porVenda = {};   // vendaId → [chaves]
        const reposicoes = []; // { chave, produtoId, historicoId }
        autos.forEach(l => {
            let m = /^venda_(-[A-Za-z0-9_-]{19})(?:_p\d+(?:_i\d+)?)?$/.exec(l.id);
            if (m) { (porVenda[m[1]] = porVenda[m[1]] || []).push(l.id); return; }
            m = /^estoque_(-[A-Za-z0-9_-]{19})_(-[A-Za-z0-9_-]{19})$/.exec(l.id);
            if (m) reposicoes.push({ chave: l.id, produtoId: m[1], historicoId: m[2] });
        });

        const remover = [];
        const idsVenda = Object.keys(porVenda);
        const tarefaVendas = emLotes(idsVenda, id =>
            window._dbGet(ref(`vendas/${id}`)).then(snap => {
                const venda = snap.val();
                porVenda[id].forEach(chave => { if (!lancamentoDeVendaTemLastro(chave, id, venda)) remover.push(chave); });
            }).catch(e => console.error('[Financeiro] Reconciliação: não consegui ler a venda', id, e)), 20);
        const tarefaReposicoes = () => emLotes(reposicoes, r =>
            window._dbGet(ref(`products/${r.produtoId}/historico/${r.historicoId}`)).then(snap => {
                const ent = snap.val();
                if (!ent || ent.estornadoEm || ent.tipo !== 'entrada') remover.push(r.chave);
            }).catch(e => console.error('[Financeiro] Reconciliação: não consegui ler a reposição', r.chave, e)), 20);

        tarefaVendas.then(tarefaReposicoes).then(() => {
            const examinados = idsVenda.reduce((s, id) => s + porVenda[id].length, 0) + reposicoes.length;
            // Trava de segurança: se "quase tudo" parece órfão, algo está errado na leitura
            // (não é cancelamento em massa) — não apaga nada e deixa registrado.
            if (remover.length > 20 && remover.length > examinados * 0.5) {
                console.warn(`[Financeiro] Reconciliação abortada: ${remover.length} de ${examinados} lançamentos pareciam órfãos — anormal, nada foi removido.`);
                return 0;
            }
            if (!remover.length) return 0;
            return Promise.all(remover.map(chave => window._dbRemove(refFin(`lancamentos/${chave}`)))).then(() => remover.length);
        }).then(qtd => {
            if (qtd > 0 && typeof window._showSuccessOverlay === 'function') {
                window._showSuccessOverlay(`✅ ${qtd} lançamento(s) de venda cancelada/reposição estornada removido(s) do caixa`);
            }
        }).catch(e => console.error('[Financeiro] Erro ao reconciliar lançamentos automáticos:', e))
          .then(() => { reconciliando = false; ultimaReconciliacao = Date.now(); });
    }

    function renderTudo() {
        ensureSkeleton();
        if (tela === 'lista') renderLista();
        else if (tela === 'filtros') renderFiltros();
        else renderForm();
    }

    // ══════════════════════ TELA: LISTA ══════════════════════
    function renderLista() {
        const wrap = el('finLancBody');
        const filtrando = filtroOrigem !== 'todas' || filtroCategorias.length > 0;
        wrap.innerHTML = `
            <div class="fl">
                <div class="section-header">
                    <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                    <div><h3>Lançamentos</h3><p>Tudo o que entrou e saiu, do jeito mais simples</p></div>
                </div>

                <div class="fl-bar">
                    <div class="fl-bar-l" id="finPeriodoNav"></div>
                    <div class="grow"></div>
                    <button type="button" class="fl-btn rec" id="finBtnReceita"><i class="bi bi-plus-lg"></i> Receita</button>
                    <button type="button" class="fl-btn des" id="finBtnDespesa"><i class="bi bi-plus-lg"></i> Despesa</button>
                </div>

                <div id="finResumoPeriodo"></div>

                <div class="fl-card fl-list">
                    <div class="fl-lh">
                        <h3>Movimentações</h3><span class="n" id="finContagem"></span><div class="grow"></div>
                        <label class="fl-search"><i class="bi bi-search"></i><input type="text" id="finBusca" placeholder="Buscar por categoria ou descrição…" value="${esc(termoBusca)}" autocomplete="off"></label>
                        <div class="fl-seg s" id="finFiltroChips"></div>
                        <button type="button" class="fl-fil${filtrando ? ' on' : ''}" id="finBtnFiltros" aria-label="Filtros"><i class="bi bi-funnel${filtrando ? '-fill' : ''}"></i></button>
                    </div>
                    <div class="fl-th"><span></span><span>Descrição</span><span>Categoria</span><span>Data</span><span>Valor</span></div>
                    <div id="finList"></div>
                </div>
            </div>
        `;

        renderPeriodoNav();
        renderResumoPeriodo();
        renderFiltroChips();
        renderListaItens();

        el('finLancBody').querySelector('.btn-back').addEventListener('click', () => window.openFinanceiroSection('financeiroHome'));
        el('finBtnReceita').addEventListener('click', () => abrirForm('receita'));
        el('finBtnDespesa').addEventListener('click', () => abrirForm('despesa'));
        el('finBtnFiltros').addEventListener('click', abrirFiltrosAvancados);
        el('finBusca').addEventListener('input', () => {
            termoBusca = el('finBusca').value.trim().toLowerCase();
            limiteExibicao = LIMITE_PAGINA;
            renderListaItens();
        });
    }

    function renderPeriodoNav() {
        const wrap = el('finPeriodoNav');
        const tipos = [{v:'dia',l:'Dia'},{v:'semana',l:'Semana'},{v:'mes',l:'Mês'},{v:'personalizado',l:'Personalizado'}];
        const corpo = periodoTipo === 'personalizado'
            ? `<div class="fl-step datas"><span>De</span><input type="date" id="finPeriodoDe" value="${personalDe}"><span>até</span><input type="date" id="finPeriodoAte" value="${personalAte}"></div>`
            : `<div class="fl-step">
                   <button type="button" id="finPeriodoAnt" aria-label="Anterior"><i class="bi bi-chevron-left"></i></button>
                   <b>${labelPeriodoAtual()}</b>
                   <button type="button" id="finPeriodoProx" aria-label="Próximo"><i class="bi bi-chevron-right"></i></button>
               </div>`;
        wrap.innerHTML = `
            <div class="fl-seg">${tipos.map(t => `<button type="button" data-periodo="${t.v}"${periodoTipo === t.v ? ' class="on"' : ''}>${t.l}</button>`).join('')}</div>
            ${corpo}
        `;
        wrap.querySelectorAll('[data-periodo]').forEach(btn => {
            btn.addEventListener('click', () => {
                periodoTipo = btn.dataset.periodo;
                limiteExibicao = LIMITE_PAGINA;
                renderPeriodoNav();
                renderResumoPeriodo();
                renderListaItens();
            });
        });

        if (periodoTipo === 'personalizado') {
            const aplicar = () => { limiteExibicao = LIMITE_PAGINA; renderResumoPeriodo(); renderListaItens(); };
            el('finPeriodoDe').addEventListener('change', () => { personalDe = el('finPeriodoDe').value; aplicar(); });
            el('finPeriodoAte').addEventListener('change', () => { personalAte = el('finPeriodoAte').value; aplicar(); });
        } else {
            el('finPeriodoAnt').addEventListener('click', () => { navegarPeriodoAtual(-1); limiteExibicao = LIMITE_PAGINA; renderPeriodoNav(); renderResumoPeriodo(); renderListaItens(); });
            el('finPeriodoProx').addEventListener('click', () => { navegarPeriodoAtual(1); limiteExibicao = LIMITE_PAGINA; renderPeriodoNav(); renderResumoPeriodo(); renderListaItens(); });
        }
    }

    // ── Painel do dinheiro (Entrou / Contas / Virou produto / Sobrou / Lucro) ──
    // O mesmo painel das telas Resumo e Gráficos (financeiro/painel-dinheiro.js), que
    // também faz a leitura assíncrona das vendas. SEMPRE acompanha o período
    // (Dia/Semana/Mês/Personalizado), nunca os filtros de tipo/origem/categoria/busca da
    // lista abaixo — senão o número mudaria conforme a pessoa filtra a lista.
    let painelDinheiro = null;
    const rotuloDoPeriodoAtual = () => ({ dia: 'do dia', semana: 'da semana', mes: 'do mês' }[periodoTipo] || 'do período');

    function renderResumoPeriodo() {
        if (!el('finResumoPeriodo') || typeof window._finPainelDinheiro !== 'function') return;
        if (!painelDinheiro) painelDinheiro = window._finPainelDinheiro({
            alvoId: 'finResumoPeriodo',
            faixa: faixaDoPeriodoAtual,
            itens: () => todosLancamentos().filter(dentroDoPeriodoAtual),
            rotulo: rotuloDoPeriodoAtual
        });
        painelDinheiro.desenhar();
    }

    function renderFiltroChips() {
        const chips = [
            { v: 'todos', l: 'Tudo' }, { v: 'receita', l: 'Receitas' }, { v: 'despesa', l: 'Despesas' }
        ];
        el('finFiltroChips').innerHTML = chips.map(c =>
            `<button type="button" data-f="${c.v}"${filtroTipo === c.v ? ' class="on"' : ''}>${c.l}</button>`
        ).join('');
        el('finFiltroChips').querySelectorAll('[data-f]').forEach(btn => {
            btn.addEventListener('click', () => { filtroTipo = btn.dataset.f; limiteExibicao = LIMITE_PAGINA; renderFiltroChips(); renderListaItens(); });
        });
    }

    function itensFiltrados() {
        return todosLancamentos()
            .filter(dentroDoPeriodoAtual)
            .filter(i => filtroTipo === 'todos' || i.tipo === filtroTipo)
            .filter(i => filtroOrigem === 'todas' || i.origem === filtroOrigem)
            .filter(i => !filtroCategorias.length || filtroCategorias.includes(i.categoria))
            .filter(i => !termoBusca || (i.categoriaNome || '').toLowerCase().includes(termoBusca) || (i.origemDescricao || '').toLowerCase().includes(termoBusca))
            .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
    }

    function renderListaItens() {
        const todos = itensFiltrados();
        const visiveis = todos.slice(0, limiteExibicao);
        const listEl = el('finList');
        el('finContagem').textContent = `${todos.length} lançamento${todos.length === 1 ? '' : 's'}`;
        if (!todos.length) {
            const refinando = termoBusca || filtroTipo !== 'todos' || filtroOrigem !== 'todas' || filtroCategorias.length;
            listEl.innerHTML = `
                <div class="fl-vazio">
                    <div class="ic">${refinando ? '🔍' : '🧾'}</div>
                    <h4>${refinando ? 'Nenhum lançamento com esse filtro nesse período.' : 'Nenhum lançamento encontrado nesse período.'}</h4>
                    <p>${refinando ? 'Tire a busca ou os filtros pra ver tudo.' : 'Registre uma receita ou uma despesa pra começar.'}</p>
                    ${refinando ? '' : `<div class="acoes"><button type="button" class="fl-btn rec" id="finVazioReceita"><i class="bi bi-plus-lg"></i> Receita</button><button type="button" class="fl-btn des" id="finVazioDespesa"><i class="bi bi-plus-lg"></i> Despesa</button></div>`}
                </div>`;
            el('finVazioReceita')?.addEventListener('click', () => abrirForm('receita'));
            el('finVazioDespesa')?.addEventListener('click', () => abrirForm('despesa'));
            return;
        }
        listEl.innerHTML = visiveis.map(i => itemHtml(i)).join('') +
            (todos.length > limiteExibicao ? `<button type="button" class="fl-more" id="finVerMais">Ver mais (${limiteExibicao} de ${todos.length})</button>` : '');

        listEl.querySelectorAll('[data-expandir]').forEach(row => {
            const alternar = () => { expandedId = expandedId === row.dataset.expandir ? null : row.dataset.expandir; renderListaItens(); };
            row.addEventListener('click', alternar);
            row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
        });
        listEl.querySelectorAll('[data-editar-lanc]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); abrirForm(null, btn.dataset.editarLanc); });
        });
        listEl.querySelectorAll('[data-estornar-compra]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const m = /^estoque_(-[A-Za-z0-9_-]{19})_(-[A-Za-z0-9_-]{19})$/.exec(btn.dataset.estornarCompra);
                if (!m || typeof window._estoqueEstornoCompraFluxo !== 'function') { modal({ message: 'Erro: estorno de compra indisponível nesta tela.' }); return; }
                window._estoqueEstornoCompraFluxo(m[1], m[2], () => renderTudo());
            });
        });
        listEl.querySelectorAll('[data-excluir-lanc]').forEach(btn => {
            btn.addEventListener('click', e => { e.stopPropagation(); excluirLancamento(btn.dataset.excluirLanc); });
        });
        el('finVerMais')?.addEventListener('click', () => { limiteExibicao += LIMITE_PAGINA; renderListaItens(); });
    }

    function itemHtml(i) {
        const despesa = i.tipo === 'despesa';
        const exp = expandedId === i.id;
        const d = new Date(i.criadoEm || 0);
        const dataFmt = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
        const ehAuto = i.origem === 'automatica';
        // Compra automática vinda da reposição de estoque (chave 'estoque_{produtoId}_{historicoId}') —
        // é a única automática que tem ação aqui: estorna a compra no estoque E tira do caixa.
        const ehCompraEstoque = ehAuto && despesa && /^estoque_-[A-Za-z0-9_-]{19}_-[A-Za-z0-9_-]{19}$/.test(i.id);
        // Entrada de PARCELA de venda (não a venda inteira/avulso) — a
        // Cloud Function grava cada parcela paga com chave própria
        // 'venda_{id}_p{pIdx}_i{iIdx}' (ver financeiroSyncVenda em
        // functions/index.js); pagamento avulso fica só em '..._p{pIdx}',
        // sem o '_i'. Usa o id pra detectar, não o texto — mais confiável.
        const ehParcelaVenda = i.categoria === 'venda' && /_i\d+$/.test(i.id);
        // Prioridade do texto: descrição automática (Venda #X · Cliente)
        // > descrição digitada pelo usuário > texto genérico de fallback.
        const subTexto = i.origemDescricao || i.descricao || (ehAuto ? '' : 'Lançamento avulso');
        const tituloExibido = ehParcelaVenda ? 'Parcela de venda' : (i.categoriaNome || i.categoria || '');
        // Selo da coluna Categoria: o mesmo agrupamento do painel (Contas / Virou produto / Outras receitas).
        // Receita à mão é sempre "Outras receitas", até com a categoria "Venda": venda de verdade é a automática.
        const selo = ehAuto ? '<span class="a">Automático</span>'
            : `<span>${despesa ? (i.categoria === 'produto' ? 'Virou produto' : 'Contas') : 'Outras receitas'}</span>`;
        return `
            <div class="fl-rw${despesa ? ' d' : ''}${ehParcelaVenda ? ' parc' : ''}${exp ? ' exp' : ''}">
                <div class="fl-row" data-expandir="${i.id}" role="button" tabindex="0" aria-expanded="${exp ? 'true' : 'false'}">
                    <div class="ic">${categoriaEmoji(i.categoria, i.tipo)}</div>
                    <div class="m">
                        <div class="t">${esc(tituloExibido)}</div>
                        <div class="s">${esc(subTexto)}</div>
                    </div>
                    <div class="c">${selo}</div>
                    <div class="dt">${dataFmt}</div>
                    <div class="v">${despesa ? '−' : '+'} ${fmt(i.valor)}</div>
                </div>
                ${exp ? `
                <div class="fl-exp">
                    <div class="acoes">
                        ${i.fotoUrl ? `<button type="button" class="ctx-foot-btn" onclick="window.open('${i.fotoUrl}','_blank')"><i class="bi bi-image"></i> Comprovante</button>` : ''}
                        ${!ehAuto ? `
                            <button type="button" class="ctx-foot-btn" data-editar-lanc="${i.id}"><i class="bi bi-pencil"></i> Editar</button>
                            <button type="button" class="ctx-foot-btn" data-excluir-lanc="${i.id}" style="color:#ef4444;"><i class="bi bi-trash"></i> Excluir</button>
                        ` : ehCompraEstoque
                            ? `<button type="button" class="ctx-foot-btn" data-estornar-compra="${i.id}" style="color:#ef4444;"><i class="bi bi-arrow-counterclockwise"></i> Estornar compra</button>`
                            : `<div class="nota">Automático — edite direto na Venda/Estoque de origem.</div>`}
                    </div>
                    ${i.editadoPorNome ? `<div class="editado">Editado por ${esc(i.editadoPorNome)}</div>` : ''}
                </div>` : ''}
            </div>
        `;
    }

    function categoriaEmoji(catId, tipo) {
        const mapa = { produto:'📦', aluguel:'🏠', funcionario:'👤', contas:'💡', manutencao:'🔧', marketing:'📣', venda:'🛒', avulsa:'💵', servico:'🔧', outras:'📁' };
        return mapa[catId] || (tipo === 'despesa' ? '💸' : '💵');
    }

    function excluirLancamento(id) {
        modal({
            message: 'Excluir esse lançamento? Não dá pra desfazer.',
            confirmText: 'Excluir', cancelText: 'Cancelar',
            onConfirm: () => {
                window._dbRemove(refFin(`lancamentos/${id}`))
                    .then(() => { expandedId = null; renderListaItens(); })
                    .catch(e => modal({ message: `Erro ao excluir: ${e.message}` }));
            }
        });
    }

    // ══════════════════════ TELA: FILTROS ══════════════════════
    function abrirFiltrosAvancados() {
        tela = 'filtros';
        renderTudo();
    }

    function renderFiltros() {
        const wrap = el('finLancBody');
        const todasCategorias = [...CAT_DESPESA, ...CAT_RECEITA];
        const origens = [{v:'todas',l:'Tudo'},{v:'automatica',l:'Automáticas'},{v:'manual',l:'Manuais'}];

        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-icon-circle" id="finFiltroVoltar" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Filtros</h3>
                <div style="width:36px;"></div>
            </div>
            <div class="content-card w-100">
                <div class="cfgA-card mb-3" style="padding:14px;">
                    <label class="ctx-field-label" style="margin-top:0;">Origem</label>
                    <div class="ctx-bandeira-chips-dyn" id="finFiltroOrigemGrid" style="display:flex;">
                        ${origens.map(o => `<div class="ctx-bandeira-chip-dyn ${filtroOrigem===o.v?'on':''}" data-fo="${o.v}"><span>${o.l}</span></div>`).join('')}
                    </div>
                    <label class="ctx-field-label mt-2">Categoria</label>
                    <div class="ctx-bandeira-chips-dyn" id="finFiltroCatGrid" style="display:flex;">
                        ${todasCategorias.map(c => `<div class="ctx-bandeira-chip-dyn ${filtroCategorias.includes(c.id)?'on':''}" data-fc="${c.id}"><span>${categoriaEmoji(c.id)} ${esc(c.nome)}</span></div>`).join('')}
                    </div>
                </div>
                <button class="ctx-add-btn ctx-add-btn-solid mb-2" type="button" id="finFiltroAplicar"><i class="bi bi-funnel"></i> Aplicar Filtros</button>
                <button class="ctx-add-btn" type="button" id="finFiltroLimpar">Limpar Filtros</button>
            </div>
        `;

        el('finFiltroVoltar').addEventListener('click', () => { tela = 'lista'; renderTudo(); });
        el('finFiltroOrigemGrid').querySelectorAll('[data-fo]').forEach(chip => {
            chip.addEventListener('click', () => {
                el('finFiltroOrigemGrid').querySelectorAll('[data-fo]').forEach(c => c.classList.remove('on'));
                chip.classList.add('on');
            });
        });
        el('finFiltroCatGrid').querySelectorAll('[data-fc]').forEach(chip => {
            chip.addEventListener('click', () => chip.classList.toggle('on'));
        });
        el('finFiltroAplicar').addEventListener('click', () => {
            filtroOrigem = el('finFiltroOrigemGrid').querySelector('.on')?.dataset.fo || 'todas';
            filtroCategorias = Array.from(el('finFiltroCatGrid').querySelectorAll('.on')).map(c => c.dataset.fc);
            limiteExibicao = LIMITE_PAGINA;
            tela = 'lista';
            renderTudo();
        });
        el('finFiltroLimpar').addEventListener('click', () => {
            filtroOrigem = 'todas'; filtroCategorias = [];
            limiteExibicao = LIMITE_PAGINA;
            tela = 'lista';
            renderTudo();
        });
    }

    // ══════════════════════ TELA: FORM (lançar/editar) ══════════════════════
    function abrirForm(tipo, editarId) {
        tela = 'form';
        fotoBlob = null;
        rascunhoForm = null;
        if (editarId) {
            const item = (window._financeiroLancamentos || {})[editarId];
            tipoForm = item?.tipo || 'despesa';
            window._finEditandoId = editarId;
            window._finEditandoItem = item;
        } else {
            tipoForm = tipo || 'despesa';
            window._finEditandoId = null;
            window._finEditandoItem = null;
        }
        renderTudo();
    }

    function renderForm() {
        const wrap = el('finLancBody');
        const editando = !!window._finEditandoId;
        const item = window._finEditandoItem || {};
        const cats = tipoForm === 'despesa' ? CAT_DESPESA : CAT_RECEITA;
        // yyyy-mm-dd no fuso do computador: toISOString() é UTC, e depois das 21h no Brasil já seria "amanhã"
        // (um lançamento feito à noite, no último dia do mês, cairia no mês seguinte).
        const dataLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const rasc = !editando && rascunhoForm;   // trocou Receita ↔ Despesa: mantém valor, data e descrição
        const dataVal = (rasc && rasc.data) || dataLocal(item.criadoEm ? new Date(item.criadoEm) : new Date());

        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-icon-circle" id="finFormVoltar" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>${editando ? 'Editar' : 'Nova'} ${tipoForm === 'despesa' ? 'Despesa' : 'Receita'}</h3>
                <div style="width:36px;"></div>
            </div>
            <div class="content-card w-100">
                ${!editando ? `
                <div class="pulse-seg-row mb-3">
                    <div class="pulse-seg-chip ${tipoForm==='receita'?'on':''}" data-tipo="receita" style="${tipoForm==='receita'?'background:#22c55e;border-color:#22c55e;':''}">💵 Receita</div>
                    <div class="pulse-seg-chip ${tipoForm==='despesa'?'on':''}" data-tipo="despesa" style="${tipoForm==='despesa'?'background:#ef4444;border-color:#ef4444;':''}">💸 Despesa</div>
                </div>` : ''}

                <div class="cfgA-card mb-3" style="padding:14px;">
                    <label class="ctx-field-label" style="margin-top:0;">Categoria</label>
                    <div class="ctx-bandeira-chips-dyn" id="finCatGrid" style="display:flex;"></div>
                    <label class="ctx-field-label">Valor</label>
                    <input class="ctx-field-input" type="number" step="0.01" id="finValor" placeholder="R$ 0,00" value="${rasc ? esc(rasc.valor) : (item.valor ?? '')}">
                    <label class="ctx-field-label mt-2">Data</label>
                    <input class="ctx-field-input" type="date" id="finData" value="${dataVal}">
                    <label class="ctx-field-label mt-2">Descrição (opcional)</label>
                    <input class="ctx-field-input" id="finDescricao" placeholder="Ex: Compra de material de limpeza" value="${esc(rasc ? rasc.descricao : (item.descricao || ''))}">
                    <label class="ctx-field-label mt-2"><i class="bi bi-camera-fill"></i> Comprovante (opcional)</label>
                    <div class="row g-2 mb-1">
                        <div class="col-6"><button class="btn btn-secondary w-100" type="button" id="finFotoCamera" style="border-style:dashed;"><i class="bi bi-camera-fill text-success"></i> Tirar foto</button></div>
                        <div class="col-6"><button class="btn btn-secondary w-100" type="button" id="finFotoGaleria" style="border-style:dashed;"><i class="bi bi-image-fill text-success"></i> Galeria</button></div>
                    </div>
                    <input type="file" accept="image/*" capture="environment" id="finFotoInputCam" class="hidden">
                    <input type="file" accept="image/*" id="finFotoInputGal" class="hidden">
                    <img id="finFotoPreview" style="display:${item.fotoUrl ? 'block' : 'none'};max-width:140px;border-radius:10px;margin-bottom:8px;" src="${item.fotoUrl || ''}">
                </div>
                <button class="ctx-add-btn ctx-add-btn-solid" type="button" id="finSalvarBtn"><i class="bi bi-check-lg"></i> Salvar</button>
            </div>
        `;

        popularCategorias(cats, item.categoria);

        el('finFormVoltar').addEventListener('click', () => { tela = 'lista'; renderTudo(); });
        wrap.querySelectorAll('[data-tipo]').forEach(btn => {
            btn.addEventListener('click', () => {
                rascunhoForm = { valor: el('finValor').value, data: el('finData').value, descricao: el('finDescricao').value };
                tipoForm = btn.dataset.tipo;
                renderForm();
            });
        });
        el('finFotoCamera').addEventListener('click', () => el('finFotoInputCam').click());
        el('finFotoGaleria').addEventListener('click', () => el('finFotoInputGal').click());
        el('finFotoInputCam').addEventListener('change', handleFotoSelect);
        el('finFotoInputGal').addEventListener('change', handleFotoSelect);
        el('finSalvarBtn').addEventListener('click', salvarLancamento);
    }

    function popularCategorias(cats, categoriaAtual) {
        // Reaproveita o componente de chip criado pra bandeira
        // (ctx-bandeira-chip-dyn, ver configuracoes/config-taxas.js) —
        // é o mesmo "pill selecionável", sem precisar duplicar CSS.
        el('finCatGrid').innerHTML = cats.map((c, i) => {
            const ativo = categoriaAtual ? c.id === categoriaAtual : i === 0;
            return `<div class="ctx-bandeira-chip-dyn ${ativo ? 'on' : ''}" data-cat="${c.id}" data-nome="${esc(c.nome)}"><span>${categoriaEmoji(c.id)} ${esc(c.nome)}</span></div>`;
        }).join('');
        el('finCatGrid').querySelectorAll('[data-cat]').forEach(chip => {
            chip.addEventListener('click', () => {
                el('finCatGrid').querySelectorAll('[data-cat]').forEach(c => c.classList.remove('on'));
                chip.classList.add('on');
            });
        });
    }

    function handleFotoSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const preview = el('finFotoPreview');
        const reader = new FileReader();
        reader.onload = ev => { preview.src = ev.target.result; preview.style.display = 'block'; };
        reader.readAsDataURL(file);
        fotoBlob = file;
    }

    function salvarLancamento() {
        const catBtn = el('finCatGrid').querySelector('.ctx-bandeira-chip-dyn.on');
        const valor = Math.round(parseFloat(el('finValor').value) * 100) / 100;   // centavos: 10,999 não vira dízima no caixa
        const dataStr = el('finData').value;
        if (!catBtn) { modal({ message: 'Escolhe uma categoria.' }); return; }
        if (!valor || valor <= 0) { modal({ message: 'Informa um valor válido.' }); return; }
        if (!dataStr) { modal({ message: 'Informa a data.' }); return; }

        const btn = el('finSalvarBtn');
        const criadoEm = new Date(dataStr + 'T12:00:00').getTime();
        const editando = !!window._finEditandoId;
        const dados = {
            tipo: tipoForm, categoria: catBtn.dataset.cat, categoriaNome: catBtn.dataset.nome,
            valor, criadoEm, origem: 'manual', descricao: el('finDescricao').value.trim() || null,
        };
        if (!editando) {
            dados.criadoPorUid = window._firebaseAuthUid || null;
            dados.criadoPorNome = window._nomeUsuario || null;
        } else {
            dados.editadoPorNome = window._nomeUsuario || null;
            dados.editadoEm = Date.now();
        }

        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        const salvar = () => {
            const id = editando ? window._finEditandoId : null;
            const p = id ? window._dbUpdate(refFin(`lancamentos/${id}`), dados) : window._dbPush(refFin('lancamentos'), dados);
            return p;
        };

        const finalizarSalvar = fotoUrlFinal => {
            if (fotoUrlFinal) dados.fotoUrl = fotoUrlFinal;
            salvar()
                .then(() => {
                    window._setBtnLoading && window._setBtnLoading(btn, false);
                    tela = 'lista';
                    renderTudo();
                })
                .catch(e => {
                    window._setBtnLoading && window._setBtnLoading(btn, false);
                    modal({ message: `Erro ao salvar: ${e.message}` });
                });
        };

        if (fotoBlob && window._comprimirImagem && window._uploadFotoStorage) {
            window._comprimirImagem(fotoBlob).then(blob => {
                const caminho = `financeiro/${editando ? window._finEditandoId : Date.now()}.jpg`;
                return window._uploadFotoStorage(blob, caminho);
            }).then(finalizarSalvar).catch(() => finalizarSalvar(null));
        } else {
            finalizarSalvar(null);
        }
    }

    // Exposta pro router chamar assim que QUALQUER tela do Financeiro
    // abre (Gráficos, Recorrentes, Lançamentos — não importa qual foi
    // a primeira) — antes só disparava entrando em Lançamentos
    // especificamente, então quem abria Gráficos primeiro via número
    // desatualizado até visitar Lançamentos por acaso. As duas funções
    // já se protege sozinha (no máximo 1 conferência por minuto).
    window._financeiroSincronizarAntigos = function () {
        reconciliarAutomaticos();
    };

    // ── Ponto de entrada chamado pelo router ──────────────────────
    window._renderFinanceiroLancamentos = function () {
        tela = 'lista';
        expandedId = null;
        limiteExibicao = LIMITE_PAGINA;
        if (painelDinheiro) painelDinheiro.forcarLeitura(); // ao entrar, a 1ª leitura relê as vendas
        renderTudo();
    };
    // core.js chama sempre que financeiro/lancamentos muda em tempo
    // real (lançamento automático de Venda/Estoque, por exemplo) — só
    // redesenha se a lista estiver aberta, não interrompe um form em
    // andamento.
    window._finOnLancamentosLoaded = function () {
        if (mounted && tela === 'lista') { renderResumoPeriodo(); renderListaItens(); }
    };
})();
