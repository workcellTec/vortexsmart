// ================================================================
// financeiro/resumo.js — VortexSmart · Financeiro → Resumo do período
// Registra: window._renderFinanceiroResumo()
//
// Tela SÓ DE LEITURA, pensada pra responder "pra onde foi a grana?" de
// qualquer Dia/Semana/Mês/Personalizado, tudo numa tela:
//   • o Painel do dinheiro (Entrou / Contas / Virou produto / Sobrou no caixa /
//     Lucro) — o mesmo das telas Lançamentos e Gráficos, ver
//     financeiro/painel-dinheiro.js (lá estão as contas e o porquê de cada uma);
//   • 🧾 Tudo que aconteceu — todos os lançamentos do período, em ordem.
// Abre sempre em "Dia / hoje".
// ================================================================
(function () {
    'use strict';
    const el  = id => document.getElementById(id);
    const esc = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t == null ? '' : t);
    const fmt = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const NOMES_MES_LONGO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const LIMITE_PAGINA = 30;

    let mounted = false;
    let periodoTipo = 'dia';   // 'dia' | 'semana' | 'mes' | 'personalizado'
    let periodoRef = new Date();
    let personalDe = '', personalAte = '';
    let limiteCrono = LIMITE_PAGINA;

    function todosLancamentos() {
        const data = window._financeiroLancamentos || {};
        return Object.keys(data).map(id => ({ id, ...data[id] }));
    }

    // ── Período: mesma convenção de Lançamentos (semana de domingo a sábado) ──
    // Devolve [início, fim) — fim EXCLUSIVO. Personalizado sem as 2 datas = faixa vazia.
    function faixaDoPeriodo() {
        if (periodoTipo === 'dia') {
            const inicio = new Date(periodoRef); inicio.setHours(0, 0, 0, 0);
            const fim = new Date(inicio); fim.setDate(fim.getDate() + 1);
            return [inicio, fim];
        }
        if (periodoTipo === 'semana') {
            const inicio = new Date(periodoRef);
            inicio.setDate(inicio.getDate() - inicio.getDay());
            inicio.setHours(0, 0, 0, 0);
            const fim = new Date(inicio); fim.setDate(fim.getDate() + 7);
            return [inicio, fim];
        }
        if (periodoTipo === 'personalizado') {
            if (!personalDe || !personalAte) return [new Date(8640000000000000), new Date(-8640000000000000)];
            const inicio = new Date(personalDe + 'T00:00:00');
            const fim = new Date(personalAte + 'T00:00:00'); fim.setDate(fim.getDate() + 1);
            return [inicio, fim];
        }
        const inicio = new Date(periodoRef.getFullYear(), periodoRef.getMonth(), 1);
        const fim = new Date(inicio); fim.setMonth(fim.getMonth() + 1);
        return [inicio, fim];
    }
    function navegarPeriodo(direcao) {
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
    function labelPeriodo() {
        if (periodoTipo === 'dia') return periodoRef.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        if (periodoTipo === 'semana') {
            const [inicio, fim] = faixaDoPeriodo();
            const fimIncl = new Date(fim); fimIncl.setDate(fimIncl.getDate() - 1);
            const f = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
            return `${f(inicio)} – ${f(fimIncl)}`;
        }
        return `${NOMES_MES_LONGO[periodoRef.getMonth()]} ${periodoRef.getFullYear()}`;
    }

    function emojiDe(i) {
        if (i.tipo === 'receita') return '💰';
        return i.categoria === 'produto' ? '📦' : '💸';
    }
    function itemCronologico(i) {
        const despesa = i.tipo === 'despesa';
        const d = new Date(i.criadoEm || 0);
        const hora = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const ehParcela = i.categoria === 'venda' && /_i\d+$/.test(i.id);
        const titulo = ehParcela ? 'Parcela de venda' : (i.categoriaNome || i.categoria || '');
        const sub = i.origemDescricao || i.descricao || (i.origem === 'automatica' ? '' : 'Lançamento avulso');
        return `
            <div class="pulse-tl-row ${despesa ? 'despesa' : ''}" style="flex-direction:column;align-items:stretch;border-bottom:none;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:10px 12px;margin-bottom:8px;">
                <div class="d-flex align-items-center gap-2">
                    <div class="pulse-tl-ic">${emojiDe(i)}</div>
                    <div class="pulse-tl-mid">
                        <div class="pulse-tl-titulo">${esc(titulo)}</div>
                        <div class="pulse-tl-sub">${esc(sub)}</div>
                    </div>
                    <div class="pulse-tl-right">
                        <div class="pulse-tl-valor" style="color:${despesa ? 'var(--danger)' : 'var(--success)'};">${despesa ? '−' : '+'} ${fmt(i.valor)}</div>
                        <div class="pulse-tl-data">${hora}</div>
                    </div>
                </div>
            </div>`;
    }

    function renderNav() {
        const wrap = el('finResumoNav');
        if (!wrap) return;
        const tipos = [{ v: 'dia', l: 'Dia' }, { v: 'semana', l: 'Semana' }, { v: 'mes', l: 'Mês' }, { v: 'personalizado', l: 'Personalizado' }];
        wrap.style.cssText = 'margin-bottom:12px;';
        wrap.innerHTML = `
            <div class="stq-cats" style="margin:0 0 8px;padding:0;">
                ${tipos.map(t => `<span class="stq-cat-pill${periodoTipo === t.v ? ' active' : ''}" data-periodo="${t.v}" style="color:var(--primary);">${t.l}</span>`).join('')}
            </div>
            <div id="finResumoNavCorpo"></div>`;
        wrap.querySelectorAll('[data-periodo]').forEach(pill => pill.addEventListener('click', () => {
            periodoTipo = pill.dataset.periodo; limiteCrono = LIMITE_PAGINA; renderNav(); renderCorpo();
        }));
        const corpo = el('finResumoNavCorpo');
        if (periodoTipo === 'personalizado') {
            corpo.innerHTML = `
                <div class="row g-2">
                    <div class="col-6"><input class="ctx-field-input" type="date" id="finResumoDe" value="${personalDe}" style="font-size:.8rem;padding:9px;"></div>
                    <div class="col-6"><input class="ctx-field-input" type="date" id="finResumoAte" value="${personalAte}" style="font-size:.8rem;padding:9px;"></div>
                </div>`;
            el('finResumoDe').addEventListener('change', () => { personalDe = el('finResumoDe').value; limiteCrono = LIMITE_PAGINA; renderCorpo(); });
            el('finResumoAte').addEventListener('change', () => { personalAte = el('finResumoAte').value; limiteCrono = LIMITE_PAGINA; renderCorpo(); });
        } else {
            corpo.innerHTML = `
                <div class="ctx-machine-card" style="display:flex;align-items:center;justify-content:space-between;padding:10px 8px;">
                    <button type="button" class="btn-icon-circle" id="finResumoAnt" aria-label="Anterior"><i class="bi bi-chevron-left"></i></button>
                    <div style="font-family:'Space Grotesk',sans-serif;font-weight:800;font-size:.86rem;text-align:center;">${labelPeriodo()}</div>
                    <button type="button" class="btn-icon-circle" id="finResumoProx" aria-label="Próximo"><i class="bi bi-chevron-right"></i></button>
                </div>`;
            el('finResumoAnt').addEventListener('click', () => { navegarPeriodo(-1); limiteCrono = LIMITE_PAGINA; renderNav(); renderCorpo(); });
            el('finResumoProx').addEventListener('click', () => { navegarPeriodo(1); limiteCrono = LIMITE_PAGINA; renderNav(); renderCorpo(); });
        }
    }

    // Painel do dinheiro + cronologia. Os dois acompanham o período e os lançamentos em tempo real.
    let painelDinheiro = null;
    const rotuloDoPeriodo = () => ({ dia: 'do dia', semana: 'da semana', mes: 'do mês' }[periodoTipo] || 'do período');
    const lancamentosDoPeriodo = () => {
        const [inicio, fim] = faixaDoPeriodo();
        return todosLancamentos().filter(i => (i.criadoEm || 0) >= inicio.getTime() && (i.criadoEm || 0) < fim.getTime());
    };

    function desenharCronologia() {
        const alvo = el('finResumoCrono');
        if (!alvo) return;
        const crono = lancamentosDoPeriodo().sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
        alvo.innerHTML = `
            <div style="font-size:.7rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text-secondary);margin:6px 0 8px;">🧾 Tudo que aconteceu (${crono.length})</div>
            ${crono.length ? crono.slice(0, limiteCrono).map(itemCronologico).join('') : `<div class="stq-hist-sub text-center py-3">Nada registrado nesse período.</div>`}
            ${crono.length > limiteCrono ? `<button type="button" class="rep-vermais-btn" id="finResumoVerMais">Ver mais (${limiteCrono} de ${crono.length})</button>` : ''}
            <div class="stq-hist-sub text-center mt-2" style="font-size:.68rem;">Só leitura. Pra editar ou lançar algo, use Lançamentos.</div>`;
        el('finResumoVerMais')?.addEventListener('click', () => { limiteCrono += LIMITE_PAGINA; desenharCronologia(); });
    }

    function renderCorpo() {
        const alvo = el('finResumoCorpo');
        if (!alvo) return;
        const [inicio, fim] = faixaDoPeriodo();
        if (!(fim.getTime() > inicio.getTime())) {
            alvo.innerHTML = `<div class="stq-hist-sub text-center py-3">Escolha as duas datas pra ver o resumo.</div>`;
            return;
        }
        alvo.innerHTML = `<div id="finResumoPainel"></div><div id="finResumoCrono"></div>`;
        if (typeof window._finPainelDinheiro === 'function') {
            if (!painelDinheiro) painelDinheiro = window._finPainelDinheiro({ alvoId: 'finResumoPainel', faixa: faixaDoPeriodo, itens: lancamentosDoPeriodo, rotulo: rotuloDoPeriodo });
            painelDinheiro.desenhar();
        }
        desenharCronologia();
    }

    function ensureSkeleton() {
        const container = el('financeiroResumo');
        if (!container || mounted) return;
        container.innerHTML = `<div id="finResumoBody" class="vs-fin-largura"></div>`;
        mounted = true;
    }

    function renderTudo() {
        ensureSkeleton();
        const wrap = el('finResumoBody');
        if (!wrap) return;
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Resumo do período</h3>
                <div style="width:36px;"></div>
            </div>
            <div class="content-card w-100">
                <div id="finResumoNav"></div>
                <div id="finResumoCorpo"></div>
            </div>`;
        wrap.querySelector('.btn-back').addEventListener('click', () => window.openFinanceiroSection('financeiroHome'));
        renderNav();
        renderCorpo();
    }

    // ── Ponto de entrada chamado pelo router: sempre abre em "Dia / hoje" ──
    window._renderFinanceiroResumo = function () {
        periodoTipo = 'dia';
        periodoRef = new Date();
        personalDe = ''; personalAte = '';
        limiteCrono = LIMITE_PAGINA;
        if (painelDinheiro) painelDinheiro.forcarLeitura(); // ao entrar, a 1ª leitura relê as vendas
        renderTudo();
    };

    // core.js avisa quando financeiro/lancamentos muda em tempo real (venda, reposição...).
    // Encadeia no aviso que já existe (sem mexer no core.js): redesenha só se a tela estiver aberta.
    const avisoAnterior = window._finOnLancamentosLoadedGraficos;
    window._finOnLancamentosLoadedGraficos = function () {
        if (typeof avisoAnterior === 'function') avisoAnterior();
        const tela = el('financeiroResumo');
        if (mounted && tela && tela.style.display !== 'none') renderCorpo();
    };
})();
