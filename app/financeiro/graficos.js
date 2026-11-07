// ================================================================
// financeiro/graficos.js — VortexSmart · Financeiro → Gráficos
// Registra: window._renderFinanceiroGraficos()
//
// Sem lib externa de gráfico de propósito — o app inteiro é vanilla
// JS, e o "Vortex Pulse" já resolve visual de número/comparação com
// barras simples em CSS (ver .pulse-waterfall, .pulse-hero-bars nos
// Relatórios de Vendas). Manter esse mesmo padrão aqui em vez de
// puxar uma lib nova (ex: Chart.js) evita dependência externa numa
// tela que é só apresentação de dado que a gente já tem.
//
// Dados vêm de financeiro/lancamentos (window._financeiroLancamentos,
// carregado em tempo real pelo core.js) — nada aqui lê 'vendas' ou
// 'products' direto. Se não tem nada em financeiro/lancamentos, todo
// gráfico mostra zero, mesmo que existam vendas/reposições no resto do
// sistema — ver financeiro/lancamentos.js pra entender como esse node
// é alimentado (automático + sincronização manual de venda antiga).
// A única exceção é o Painel do dinheiro do topo (Entrou / Contas / Virou
// produto / Sobrou / Lucro), que é o mesmo das telas Lançamentos e Resumo
// (financeiro/painel-dinheiro.js) e lê as vendas por conta própria.
// ================================================================
(function () {
    'use strict';
    const el   = id => document.getElementById(id);
    const esc  = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt  = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const NOMES_MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const NOMES_MES_LONGO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    let mounted = false;

    // Mês do DRE / Pico / Categoria — independente do comparativo (ver
    // baixo). Só existe pra esses 3 blocos, que sempre mostram "o mês
    // que eu tô olhando agora".
    let mesRef = new Date(); mesRef.setDate(1); mesRef.setHours(0,0,0,0);

    // ── Comparativo — estado totalmente separado do mesRef acima. Fica
    // FECHADO por padrão (o usuário decide se quer comparar, não abre
    // sozinho na cara) e troca de granularidade (dia/mês/ano) sem
    // reaproveitar as referências de mês do resto da tela.
    let comparativoAberto = false;
    let granularidade = 'mes'; // 'dia' | 'mes' | 'ano'
    let refA = null, refB = null;

    // Painel do dinheiro do mês em exibição (instância única: guarda o que o usuário abriu,
    // mesmo com renderTudo redesenhando a tela a cada mudança em tempo real).
    let painelDinheiro = null;

    function ensureSkeleton() {
        const container = el('financeiroGraficos');
        if (!container || mounted) return;
        container.innerHTML = `<div id="finGrafBody" class="vs-fin-largura"></div>`;
        mounted = true;
    }

    function todosLancamentos() {
        const data = window._financeiroLancamentos || {};
        return Object.keys(data).map(id => ({ id, ...data[id] }));
    }

    // ── Faixa de tempo [início, fim) de um período, dado a granularidade ──
    function faixaDoPeriodo(ref, gran) {
        if (gran === 'dia') {
            const inicio = new Date(ref); inicio.setHours(0, 0, 0, 0);
            const fim = new Date(inicio); fim.setDate(fim.getDate() + 1);
            return [inicio, fim];
        }
        if (gran === 'ano') {
            const inicio = new Date(ref.getFullYear(), 0, 1);
            const fim = new Date(ref.getFullYear() + 1, 0, 1);
            return [inicio, fim];
        }
        const inicio = new Date(ref.getFullYear(), ref.getMonth(), 1);
        const fim = new Date(inicio); fim.setMonth(fim.getMonth() + 1);
        return [inicio, fim];
    }

    // Resumo (receita/despesa/custoProduto) entre duas datas quaisquer
    // [inicio, fimExclusivo) — usado tanto pelos períodos fixos
    // (dia/mês/ano, via resumoDoPeriodo abaixo) quanto pelo modo
    // Personalizado, que passa datas soltas direto.
    function resumoEntre(inicio, fimExclusivo) {
        const itens = todosLancamentos().filter(i => (i.criadoEm || 0) >= inicio.getTime() && (i.criadoEm || 0) < fimExclusivo.getTime());
        const receita = itens.filter(i => i.tipo === 'receita').reduce((s, i) => s + (i.valor || 0), 0);
        const despesaTotal = itens.filter(i => i.tipo === 'despesa').reduce((s, i) => s + (i.valor || 0), 0);
        const custoProduto = itens.filter(i => i.tipo === 'despesa' && i.categoria === 'produto').reduce((s, i) => s + (i.valor || 0), 0);
        const despesaSemProduto = despesaTotal - custoProduto;
        const saldo = receita - despesaTotal;
        return { itens, receita, despesaTotal, custoProduto, despesaSemProduto, saldo };
    }

    function resumoDoPeriodo(ref, gran) {
        const [inicio, fim] = faixaDoPeriodo(ref, gran || 'mes');
        return resumoEntre(inicio, fim);
    }

    // Personalizado: usuário escolhe De/Até livremente pros dois lados
    // — 'ate' é a data ESCOLHIDA (inclusiva), soma 1 dia pra virar o
    // limite exclusivo que resumoEntre espera.
    function resumoPersonalizado(deStr, ateStr) {
        const inicio = new Date(deStr + 'T00:00:00');
        const fimIncl = new Date(ateStr + 'T00:00:00');
        const fim = new Date(fimIncl); fim.setDate(fim.getDate() + 1);
        return resumoEntre(inicio, fim);
    }

    function labelPersonalizado(deStr, ateStr) {
        const f = s => new Date(s + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        return `${f(deStr)} – ${f(ateStr)}`;
    }

    function labelPeriodo(ref, gran, curto) {
        if (gran === 'dia') return ref.toLocaleDateString('pt-BR', { day: '2-digit', month: curto ? 'short' : 'long', year: 'numeric' });
        if (gran === 'ano') return String(ref.getFullYear());
        return curto ? `${NOMES_MES[ref.getMonth()]}/${String(ref.getFullYear()).slice(2)}` : `${NOMES_MES_LONGO[ref.getMonth()]}<br><small>${ref.getFullYear()}</small>`;
    }

    function navegarPeriodo(ref, gran, direcao) {
        const novo = new Date(ref);
        if (gran === 'dia') novo.setDate(novo.getDate() + direcao);
        else if (gran === 'ano') novo.setFullYear(novo.getFullYear() + direcao);
        else novo.setMonth(novo.getMonth() + direcao);
        return novo;
    }

    // ══════════════════════ Montagem geral (1x por entrada na tela) ══════════════════════
    function renderTudo() {
        ensureSkeleton();
        const wrap = el('finGrafBody');
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Gráficos</h3>
                <div style="width:36px;"></div>
            </div>
            <div class="content-card w-100">
                <div class="fin-pd-mes">${NOMES_MES_LONGO[mesRef.getMonth()]} ${mesRef.getFullYear()}</div>
                <div id="finGrafPainel"></div>
                <div id="finGrafComparativo"></div>
                <div id="finGrafFluxo"></div>
                <div id="finGrafPico"></div>
                <div id="finGrafCategoria"></div>
            </div>
        `;
        wrap.querySelector('.btn-back').addEventListener('click', () => window.openFinanceiroSection('financeiroHome'));

        renderPainel();
        renderComparativo();
        renderFluxoMensal();
        renderPico();
        renderCategoria();
    }

    // ══════════════════════ Painel do dinheiro do mês em exibição ══════════════════════
    // Mesmo painel (Entrou / Contas / Virou produto / Sobrou no caixa / Lucro) das
    // telas Lançamentos e Resumo, aqui sempre do mês. Ver financeiro/painel-dinheiro.js.
    function renderPainel() {
        if (!el('finGrafPainel') || typeof window._finPainelDinheiro !== 'function') return;
        if (!painelDinheiro) painelDinheiro = window._finPainelDinheiro({
            alvoId: 'finGrafPainel',
            faixa: () => faixaDoPeriodo(mesRef, 'mes'),
            itens: () => resumoDoPeriodo(mesRef, 'mes').itens,
            rotulo: () => 'do mês'
        });
        painelDinheiro.desenhar();
    }

    // ══════════════════════ Comparar períodos (opcional, fechado por padrão) ══════════════════════
    // Só essa função re-renderiza quando o usuário navega/troca
    // granularidade — nunca chama renderTudo(), pra não piscar a tela
    // inteira (DRE/Pico/Categoria) por causa de um clique aqui dentro.
    let custA = null, custB = null; // { de: 'YYYY-MM-DD', ate: 'YYYY-MM-DD' } — só usado no modo 'personalizado'

    function resetarReferencias() {
        const hoje = new Date();
        if (granularidade === 'dia') { refA = new Date(hoje); refA.setHours(0,0,0,0); refB = navegarPeriodo(refA, 'dia', -1); }
        else if (granularidade === 'ano') { refA = new Date(hoje.getFullYear(), 0, 1); refB = navegarPeriodo(refA, 'ano', -1); }
        else if (granularidade === 'mes') { refA = new Date(hoje.getFullYear(), hoje.getMonth(), 1); refB = navegarPeriodo(refA, 'mes', -1); }
        else {
            // personalizado: A = mês corrente até hoje, B = mês anterior inteiro
            const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // fuso do computador (toISOString é UTC: à noite já seria "amanhã")
            const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
            const mesPassadoInicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
            const mesPassadoFim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
            custA = { de: iso(inicioMes), ate: iso(hoje) };
            custB = { de: iso(mesPassadoInicio), ate: iso(mesPassadoFim) };
        }
    }

    function renderComparativo() {
        const alvo = el('finGrafComparativo');

        if (!comparativoAberto) {
            alvo.innerHTML = `
                <button type="button" class="ctx-add-btn mb-3" id="finCompararBtn"><i class="bi bi-bar-chart-line"></i> Comparar dois períodos</button>
            `;
            el('finCompararBtn').addEventListener('click', () => {
                comparativoAberto = true;
                resetarReferencias();
                renderComparativo();
            });
            return;
        }

        const personalizado = granularidade === 'personalizado';
        const rA = personalizado ? resumoPersonalizado(custA.de, custA.ate) : resumoDoPeriodo(refA, granularidade);
        const rB = personalizado ? resumoPersonalizado(custB.de, custB.ate) : resumoDoPeriodo(refB, granularidade);
        const lblA = personalizado ? labelPersonalizado(custA.de, custA.ate) : labelPeriodo(refA, granularidade, true);
        const lblB = personalizado ? labelPersonalizado(custB.de, custB.ate) : labelPeriodo(refB, granularidade, true);
        const maxValor = Math.max(rA.receita, rA.despesaTotal, rB.receita, rB.despesaTotal, 1);
        const altura = v => Math.max(4, Math.round((v / maxValor) * 100));
        const deltaSaldo = rA.saldo - rB.saldo;
        const deltaPct = rB.saldo !== 0 ? (deltaSaldo / Math.abs(rB.saldo) * 100) : (rA.saldo !== 0 ? 100 : 0);
        const rotulos = { dia: 'Dia', mes: 'Mês', ano: 'Ano', personalizado: 'Personalizado' };

        alvo.innerHTML = `
            <div class="pulse-waterfall">
                <div class="d-flex align-items-center justify-content-between mb-2">
                    <div class="pulse-waterfall-title" style="margin-bottom:0;">Comparar períodos</div>
                    <button type="button" class="btn-icon-circle" id="finCompararFechar" aria-label="Fechar" style="width:28px;height:28px;"><i class="bi bi-x-lg" style="font-size:.7rem;"></i></button>
                </div>

                <div class="pulse-seg-row mb-3" style="flex-wrap:wrap;">
                    ${['dia','mes','ano','personalizado'].map(g => `<div class="pulse-seg-chip ${granularidade===g?'on':''}" data-gran="${g}" style="flex:1 1 auto;font-size:.72rem;padding:9px 4px;">${rotulos[g]}</div>`).join('')}
                </div>

                ${!personalizado ? `
                <div class="d-flex gap-2 mb-3">
                    <div class="fin-mes-picker" style="flex:1;">
                        <button type="button" class="btn-icon-circle" data-nav="a-ant" aria-label="Anterior"><i class="bi bi-chevron-left"></i></button>
                        <div class="fin-mes-picker-lbl">${labelPeriodo(refA, granularidade)}</div>
                        <button type="button" class="btn-icon-circle" data-nav="a-prox" aria-label="Próximo"><i class="bi bi-chevron-right"></i></button>
                    </div>
                    <div class="fin-mes-picker" style="flex:1;">
                        <button type="button" class="btn-icon-circle" data-nav="b-ant" aria-label="Anterior"><i class="bi bi-chevron-left"></i></button>
                        <div class="fin-mes-picker-lbl">${labelPeriodo(refB, granularidade)}</div>
                        <button type="button" class="btn-icon-circle" data-nav="b-prox" aria-label="Próximo"><i class="bi bi-chevron-right"></i></button>
                    </div>
                </div>
                ` : `
                <div class="cfgA-card mb-3" style="padding:12px;">
                    <label class="ctx-field-label" style="margin-top:0;font-size:.68rem;">Período A</label>
                    <div class="row g-2 mb-2">
                        <div class="col-6"><input class="ctx-field-input" type="date" id="finCustADe" value="${custA.de}" style="font-size:.76rem;padding:8px;"></div>
                        <div class="col-6"><input class="ctx-field-input" type="date" id="finCustAAte" value="${custA.ate}" style="font-size:.76rem;padding:8px;"></div>
                    </div>
                    <label class="ctx-field-label" style="font-size:.68rem;">Período B</label>
                    <div class="row g-2">
                        <div class="col-6"><input class="ctx-field-input" type="date" id="finCustBDe" value="${custB.de}" style="font-size:.76rem;padding:8px;"></div>
                        <div class="col-6"><input class="ctx-field-input" type="date" id="finCustBAte" value="${custB.ate}" style="font-size:.76rem;padding:8px;"></div>
                    </div>
                </div>
                `}

                <div class="fin-cmp-bars">
                    <div class="fin-cmp-col">
                        <div class="fin-cmp-bar-wrap">
                            <div class="fin-cmp-bar" style="height:${altura(rA.receita)}%;background:#22c55e;"></div>
                            <div class="fin-cmp-bar" style="height:${altura(rA.despesaTotal)}%;background:#ef4444;"></div>
                        </div>
                        <div class="fin-cmp-col-lbl">${lblA}</div>
                    </div>
                    <div class="fin-cmp-col">
                        <div class="fin-cmp-bar-wrap">
                            <div class="fin-cmp-bar" style="height:${altura(rB.receita)}%;background:#22c55e;"></div>
                            <div class="fin-cmp-bar" style="height:${altura(rB.despesaTotal)}%;background:#ef4444;"></div>
                        </div>
                        <div class="fin-cmp-col-lbl">${lblB}</div>
                    </div>
                </div>
                <div class="d-flex gap-2 justify-content-center mb-3" style="font-size:.66rem;color:var(--text-secondary);">
                    <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#22c55e;"></span> Receita</span>
                    <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#ef4444;"></span> Despesa</span>
                </div>

                <div class="pulse-kpi-grid">
                    <div class="pulse-kpi-card"><div class="pulse-kpi-l">Caixa · ${lblA}</div><div class="pulse-kpi-v" style="color:${rA.saldo>=0?'#22c55e':'#ef4444'};">${fmt(rA.saldo)}</div></div>
                    <div class="pulse-kpi-card"><div class="pulse-kpi-l">Caixa · ${lblB}</div><div class="pulse-kpi-v" style="color:${rB.saldo>=0?'#22c55e':'#ef4444'};">${fmt(rB.saldo)}</div></div>
                </div>
                <div class="fin-info-badge" style="width:100%;box-sizing:border-box;margin-top:8px;">
                    <i class="bi bi-${deltaSaldo >= 0 ? 'graph-up-arrow' : 'graph-down-arrow'}"></i>
                    ${lblA} ${deltaSaldo >= 0 ? 'melhor' : 'pior'} que ${lblB} em ${fmt(Math.abs(deltaSaldo))} (${Math.abs(deltaPct).toFixed(0)}%)
                </div>
            </div>
        `;

        el('finCompararFechar').addEventListener('click', () => { comparativoAberto = false; renderComparativo(); });
        alvo.querySelectorAll('[data-gran]').forEach(chip => {
            chip.addEventListener('click', () => {
                granularidade = chip.dataset.gran;
                resetarReferencias();
                renderComparativo();
            });
        });

        if (personalizado) {
            const ligar = (id, obj, campo) => el(id).addEventListener('change', () => { obj[campo] = el(id).value; renderComparativo(); });
            ligar('finCustADe', custA, 'de');
            ligar('finCustAAte', custA, 'ate');
            ligar('finCustBDe', custB, 'de');
            ligar('finCustBAte', custB, 'ate');
            return;
        }

        alvo.querySelectorAll('[data-nav]').forEach(btn => {
            btn.addEventListener('click', () => {
                const nav = btn.dataset.nav;
                if (nav === 'a-ant') refA = navegarPeriodo(refA, granularidade, -1);
                if (nav === 'a-prox') refA = navegarPeriodo(refA, granularidade, 1);
                if (nav === 'b-ant') refB = navegarPeriodo(refB, granularidade, -1);
                if (nav === 'b-prox') refB = navegarPeriodo(refB, granularidade, 1);
                renderComparativo();
            });
        });
    }

    // ══════════════════════ Pico de vendas do mês (mesRef) ══════════════════════
    // ══════════════════════ Fluxo do mês, dia a dia (receita × despesa) ══════════════════════
    // Diferente do "Pico de vendas" abaixo (só receita de venda) — esse
    // mostra RECEITA e DESPESA juntas, dia 1 a dia-último-do-mês, pra
    // enxergar o formato do fluxo de caixa no mês inteiro. Barra verde
    // cresce pra cima (receita), vermelha cresce pra baixo (despesa),
    // as duas saindo da mesma linha do meio — dá pra ver o dia inteiro
    // de uma vez, sem precisar somar nada na cabeça.
    function renderFluxoMensal() {
        const diasNoMes = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 0).getDate();
        const receitaPorDia = Array(diasNoMes).fill(0);
        const despesaPorDia = Array(diasNoMes).fill(0);
        todosLancamentos().forEach(i => {
            const d = new Date(i.criadoEm || 0);
            if (d.getFullYear() !== mesRef.getFullYear() || d.getMonth() !== mesRef.getMonth()) return;
            const idx = d.getDate() - 1;
            if (i.tipo === 'receita') receitaPorDia[idx] += (i.valor || 0);
            else if (i.tipo === 'despesa') despesaPorDia[idx] += (i.valor || 0);
        });
        const max = Math.max(...receitaPorDia, ...despesaPorDia, 1);
        const totalMes = receitaPorDia.reduce((a, b) => a + b, 0) + despesaPorDia.reduce((a, b) => a + b, 0);

        el('finGrafFluxo').innerHTML = `
            <div class="pulse-waterfall">
                <div class="pulse-waterfall-title">Fluxo do mês, dia a dia — ${NOMES_MES_LONGO[mesRef.getMonth()]}</div>
                ${totalMes > 0 ? `
                    <div class="fin-fluxo-wrap">
                        ${receitaPorDia.map((v, i) => `
                            <div class="fin-fluxo-col" title="Dia ${i + 1}: +${fmt(v)} / −${fmt(despesaPorDia[i])}">
                                <div class="fin-fluxo-top"><div class="fin-fluxo-bar receita" style="height:${v ? Math.max(6, Math.round(v / max * 100)) : 0}%;"></div></div>
                                <div class="fin-fluxo-linha"></div>
                                <div class="fin-fluxo-bottom"><div class="fin-fluxo-bar despesa" style="height:${despesaPorDia[i] ? Math.max(6, Math.round(despesaPorDia[i] / max * 100)) : 0}%;"></div></div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="d-flex justify-content-between" style="font-size:.6rem;color:var(--text-secondary);padding:0 2px;">
                        <span>1</span><span>${diasNoMes}</span>
                    </div>
                    <div class="d-flex gap-2 justify-content-center mt-2" style="font-size:.66rem;color:var(--text-secondary);">
                        <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#22c55e;"></span> Receita</span>
                        <span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#ef4444;"></span> Despesa</span>
                    </div>
                ` : `<div class="stq-hist-sub text-center py-2">Sem lançamentos nesse mês ainda.</div>`}
            </div>
        `;
    }

    function renderPico() {
        const diasNoMes = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 0).getDate();
        const porDia = Array(diasNoMes).fill(0);
        todosLancamentos().forEach(i => {
            if (i.tipo !== 'receita' || i.categoria !== 'venda') return;
            const d = new Date(i.criadoEm || 0);
            if (d.getFullYear() === mesRef.getFullYear() && d.getMonth() === mesRef.getMonth()) {
                porDia[d.getDate() - 1] += (i.valor || 0);
            }
        });
        const max = Math.max(...porDia, 1);
        const picoValor = Math.max(...porDia);
        const picoDia = porDia.indexOf(picoValor) + 1;

        el('finGrafPico').innerHTML = `
            <div class="pulse-waterfall">
                <div class="pulse-waterfall-title">Pico de vendas — ${NOMES_MES_LONGO[mesRef.getMonth()]}</div>
                <div class="fin-pico-bars">
                    ${porDia.map((v, i) => `<div class="fin-pico-bar ${v === picoValor && v > 0 ? 'pico' : ''}" style="height:${Math.max(4, Math.round(v/max*100))}%;" title="Dia ${i+1}: ${fmt(v)}"></div>`).join('')}
                </div>
                ${picoValor > 0 ? `<div class="fin-info-badge"><i class="bi bi-trophy-fill"></i> Melhor dia: ${String(picoDia).padStart(2,'0')}/${String(mesRef.getMonth()+1).padStart(2,'0')} — ${fmt(picoValor)}</div>` : `<div class="stq-hist-sub text-center py-2">Sem vendas registradas nesse mês ainda.</div>`}
            </div>
        `;
    }

    // ══════════════════════ Despesas por categoria (mesRef) ══════════════════════
    function renderCategoria() {
        const r = resumoDoPeriodo(mesRef, 'mes');
        const porCategoria = {};
        r.itens.filter(i => i.tipo === 'despesa').forEach(i => {
            const key = i.categoriaNome || i.categoria || 'Outras';
            porCategoria[key] = (porCategoria[key] || 0) + (i.valor || 0);
        });
        const entradas = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
        const max = Math.max(...entradas.map(e => e[1]), 1);

        el('finGrafCategoria').innerHTML = `
            <div class="pulse-waterfall">
                <div class="pulse-waterfall-title">Despesas por categoria — ${NOMES_MES[mesRef.getMonth()]}</div>
                ${entradas.length ? entradas.map(([nome, valor]) => `
                    <div class="pulse-wf-row">
                        <div class="pulse-wf-label">${esc(nome)}</div>
                        <div class="pulse-wf-bar-wrap"><div class="pulse-wf-bar" style="width:${Math.max(4, Math.round(valor/max*100))}%;background:#5b3df5;"></div></div>
                        <div class="pulse-wf-value">${fmt(valor)}</div>
                    </div>
                `).join('') : `<div class="stq-hist-sub text-center py-2">Sem despesas nesse mês ainda.</div>`}
            </div>
        `;
    }

    // ── Ponto de entrada chamado pelo router ──────────────────────
    window._renderFinanceiroGraficos = function () {
        mesRef = new Date(); mesRef.setDate(1); mesRef.setHours(0,0,0,0);
        comparativoAberto = false;
        if (painelDinheiro) painelDinheiro.forcarLeitura(); // ao entrar, a 1ª leitura relê as vendas
        renderTudo();
    };
    // core.js chama sempre que financeiro/lancamentos muda em tempo
    // real — redesenha os gráficos com o dado fresco.
    window._finOnLancamentosLoadedGraficos = function () {
        if (mounted && el('financeiroGraficos')?.style.display !== 'none') renderTudo();
    };
})();
