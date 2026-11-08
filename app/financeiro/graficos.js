// ================================================================
// financeiro/graficos.js — VortexSmart · Financeiro → Gráficos
// Registra: window._renderFinanceiroGraficos()
//
// Três visões, em abas simples:
//   Neste mês       pra onde foi o dinheiro (anel) · calendário do mês com o que entrou e saiu
//                   em cada dia · despesas por categoria
//   Comparar        dois meses lado a lado: frase de veredito, 4 números e a linha "quem está
//                   na frente, dia a dia" (quanto já tinha entrado em cada dia do mês)
//   Últimos meses   6 meses de entrou × saiu e o quanto sobrou em cada um
//
// Sem lib de gráfico de propósito: o app todo é JS puro, e HTML/CSS/SVG resolvem anel, barras e linha.
// Dados: window._financeiroLancamentos (tempo real, core.js). Nada aqui lê 'vendas' ou 'products'.
// As contas são as do Painel do dinheiro (Movimentações): Sobrou = Entrou − Contas − Virou produto.
// O "Lucro do mês" fica só nas Movimentações (depende de ler as vendas).
//
// Regra da comparação: o mês em andamento NÃO pode ser medido contra um mês inteiro (daria falsa
// derrota). Por padrão compara só até o dia de hoje nos dois meses; dá pra desligar.
// ================================================================
(function () {
    'use strict';
    const el   = id => document.getElementById(id);
    const esc  = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t == null ? '' : t);
    const fmt  = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmt0 = v => 'R$ ' + Math.round(v || 0).toLocaleString('pt-BR');
    // Valor curto pra caber no quadrado do calendário: 437 · 1,5k · 1,2M
    const curto = v => v >= 1e6 ? (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M'
        : v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k' : String(Math.round(v));
    const arred = n => Math.round((Number(n) || 0) * 100) / 100;
    const soma = a => arred(a.reduce((s, x) => s + x, 0));
    const NOMES_MES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const NOMES_MES_LONGO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const ICONE = {
        cima: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
        baixo: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>'
    };

    let mounted = false;
    let visao = 'mes';              // 'mes' | 'comparar' | 'evolucao'
    let mesRef = null;              // mês em exibição em "Neste mês" (dia 1)
    let selDia = null;              // dia tocado no calendário (índice 0..n-1); null = o melhor dia
    let cmpA = null, cmpB = null;   // meses da comparação (dia 1)
    let mesmoPeriodo = true;        // só até hoje, quando um dos meses é o atual
    let selEvo = null;              // mês tocado em "Últimos meses"

    const primeiroDoMes = (a, m) => { const d = new Date(a, m, 1); d.setHours(0, 0, 0, 0); return d; };
    const mesAtual = () => { const h = new Date(); return primeiroDoMes(h.getFullYear(), h.getMonth()); };
    const mesmoMes = (x, y) => x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
    const ehMesAtual = d => mesmoMes(d, new Date());
    const somaMeses = (d, n) => primeiroDoMes(d.getFullYear(), d.getMonth() + n);
    const diasDoMes = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const nomeMes = d => `${NOMES_MES_LONGO[d.getMonth()]} ${d.getFullYear()}`;
    const nomeCurto = d => `${NOMES_MES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;

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

    // ── Dados de um mês, dia a dia ─────────────────────────────────
    // ent = receitas · sai = contas (despesa que não é produto) · prod = compra de produto ·
    // cats = despesas por categoria (contas + produto)
    let cache = null;
    function dadosDoMes(d) {
        if (!cache) {
            cache = {};
            todosLancamentos().forEach(i => {
                const t = new Date(i.criadoEm || 0);
                const chave = `${t.getFullYear()}-${t.getMonth()}`;
                const mes = cache[chave] || (cache[chave] = { itens: [] });
                mes.itens.push({ dia: t.getDate() - 1, i });
            });
        }
        const n = diasDoMes(d);
        const r = { n, ent: Array(n).fill(0), sai: Array(n).fill(0), prod: Array(n).fill(0), cats: {}, temLancamento: false };
        const bruto = cache[`${d.getFullYear()}-${d.getMonth()}`];
        if (!bruto) return r;
        bruto.itens.forEach(({ dia, i }) => {
            const v = i.valor || 0;
            if (i.tipo === 'receita') { r.ent[dia] += v; r.temLancamento = true; }
            else if (i.tipo === 'despesa') {
                if (i.categoria === 'produto') r.prod[dia] += v; else r.sai[dia] += v;
                const nome = i.categoriaNome || i.categoria || 'Outras';
                r.cats[nome] = (r.cats[nome] || 0) + v;
                r.temLancamento = true;
            }
        });
        return r;
    }

    // Totais do mês até o dia `lim` (inclusive); sem lim = mês inteiro
    function resumo(dados, lim) {
        const ate = Math.min(lim || dados.n, dados.n);
        const entrou = soma(dados.ent.slice(0, ate)), contas = soma(dados.sai.slice(0, ate)), prod = soma(dados.prod.slice(0, ate));
        return { entrou, contas, prod, saiu: arred(contas + prod), sobrou: arred(entrou - contas - prod), ate };
    }
    // Até que dia o mês em exibição vale (o mês atual só vai até hoje)
    const limiteDoMes = d => ehMesAtual(d) ? new Date().getDate() : diasDoMes(d);

    // Menor mês com lançamento: limita a navegação pra trás (sem nada pra ver antes dele)
    function primeiroMesComDados() {
        let min = null;
        todosLancamentos().forEach(i => { if (i.criadoEm && (min === null || i.criadoEm < min)) min = i.criadoEm; });
        if (min === null) return mesAtual();
        const d = new Date(min);
        return primeiroDoMes(d.getFullYear(), d.getMonth());
    }

    // ══════════════════════ Montagem geral ══════════════════════
    function renderTudo() {
        ensureSkeleton();
        const wrap = el('finGrafBody');
        const rolagem = el('financeiroGraficos');
        const topoRolagem = rolagem ? rolagem.scrollTop : 0;   // atualização em tempo real não pode jogar a tela pro topo
        cache = null;
        const visBtn = (k, t) => `<button type="button" data-fg-vis="${k}" class="${visao === k ? 'on' : ''}">${t}</button>`;
        wrap.innerHTML = `
            <div class="fl fg">
                <div class="section-header">
                    <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                    <div><h3>Financeiro</h3><p>Tudo o que entrou e saiu, do jeito mais simples</p></div>
                </div>
                ${window._finAbasHtml ? window._finAbasHtml('financeiroGraficos') : ''}
                ${visao === 'mes' ? navMesHtml() : ''}
                <div class="fg-vis" role="tablist">${visBtn('mes', 'Neste mês')}${visBtn('comparar', 'Comparar')}${visBtn('evolucao', 'Últimos meses')}</div>
                <div class="fg-corpo" id="finGrafCorpo">${visao === 'mes' ? mesHtml() : visao === 'comparar' ? compararHtml() : evolucaoHtml()}</div>
            </div>
        `;
        if (window._finLigarAbas) window._finLigarAbas(wrap, 'financeiroGraficos');
        ligarEventos(wrap);
        if (rolagem) rolagem.scrollTop = topoRolagem;
    }

    // ── Navegação de mês (só em "Neste mês") ──
    function navMesHtml() {
        const noInicio = mesmoMes(mesRef, primeiroMesComDados()) || mesRef < primeiroMesComDados();
        const noFim = mesRef >= mesAtual();
        return `<div class="fg-nav">
            <button type="button" class="fg-seta" data-fg-mes="-1" aria-label="Mês anterior"${noInicio ? ' disabled' : ''}><i class="bi bi-chevron-left"></i></button>
            <button type="button" class="fg-mes-lbl" data-fg-pick="ref">${nomeMes(mesRef)}</button>
            <button type="button" class="fg-seta" data-fg-mes="1" aria-label="Próximo mês"${noFim ? ' disabled' : ''}><i class="bi bi-chevron-right"></i></button>
        </div>`;
    }

    // ══════════════════════ Visão: Neste mês ══════════════════════
    function anelHtml(r) {
        const R = 52, C = 2 * Math.PI * R;
        const base = Math.max(r.entrou, r.saiu, 1);
        const partes = [[r.contas, 'var(--danger)'], [r.prod, 'var(--warning)'], [Math.max(r.sobrou, 0), 'var(--success)']];
        let deslocamento = 0, arcos = '';
        partes.forEach(([v, cor]) => {
            const comp = Math.max(0, v / base) * C;
            if (comp > 0) arcos += `<circle cx="70" cy="70" r="${R}" stroke="${cor}" stroke-width="16" fill="none" stroke-dasharray="${Math.max(0, comp - 2)} ${C}" stroke-dashoffset="${-deslocamento}" transform="rotate(-90 70 70)"/>`;
            deslocamento += comp;
        });
        return `<svg class="fg-anel" viewBox="0 0 140 140" role="img" aria-label="Para onde foi o dinheiro que entrou">
            <circle cx="70" cy="70" r="${R}" fill="none" stroke="rgba(var(--overlay-rgb),.08)" stroke-width="16"/>${arcos}
            <text x="70" y="65" text-anchor="middle" class="fg-anel-k">ENTROU</text>
            <text x="70" y="85" text-anchor="middle" class="fg-anel-v">${fmt0(r.entrou)}</text></svg>`;
    }

    function mesHtml() {
        const dados = dadosDoMes(mesRef);
        const lim = limiteDoMes(mesRef);
        const r = resumo(dados, lim);
        if (!dados.temLancamento) {
            return `<div class="fg-card larga"><div class="fg-vazio">Sem lançamentos em ${NOMES_MES_LONGO[mesRef.getMonth()].toLowerCase()} ainda.</div></div>`;
        }
        const base = Math.max(r.entrou, r.saiu, 1);
        const pct = v => Math.round(Math.max(0, v) / base * 100);
        const sobrouLinha = r.sobrou >= 0
            ? `<div><span class="fg-dot" style="background:var(--success)"></span>Sobrou<small>${pct(r.sobrou)}%</small><b>${fmt0(r.sobrou)}</b></div>`
            : `<div><span class="fg-dot" style="background:var(--danger)"></span>Faltou<small></small><b style="color:var(--danger)">${fmt0(-r.sobrou)}</b></div>`;
        return `
            <div class="fg-card">
                <h3>Para onde foi o dinheiro</h3>
                <div class="fg-sub">De tudo que entrou em ${NOMES_MES_LONGO[mesRef.getMonth()].toLowerCase()}</div>
                <div class="fg-anel-linha">${anelHtml(r)}<div class="fg-leg">
                    ${sobrouLinha}
                    <div><span class="fg-dot" style="background:var(--warning)"></span>Virou produto<small>${pct(r.prod)}%</small><b>${fmt0(r.prod)}</b></div>
                    <div><span class="fg-dot" style="background:var(--danger)"></span>Contas<small>${pct(r.contas)}%</small><b>${fmt0(r.contas)}</b></div>
                </div></div>
            </div>
            ${calendarioHtml(dados, lim)}
            ${categoriasHtml(dados)}`;
    }

    // ── Calendário: cada quadrado é um dia, com o que entrou (verde) e o que saiu (vermelho) ──
    function calendarioHtml(dados, lim) {
        const n = dados.n;
        const saiDia = dados.sai.map((v, i) => arred(v + dados.prod[i]));
        let melhor = -1;
        dados.ent.forEach((v, i) => { if (i < lim && v > 0 && (melhor < 0 || v > dados.ent[melhor])) melhor = i; });
        const sel = selDia !== null && selDia < lim ? selDia : (melhor >= 0 ? melhor : null);
        const maxEnt = Math.max(...dados.ent.slice(0, lim), 1);
        const vazios = mesRef.getDay(); // 0 = domingo: quantos quadrados em branco antes do dia 1
        const hoje = ehMesAtual(mesRef) ? lim - 1 : -1;
        const celulas = dados.ent.map((e, i) => {
            const cls = ['fg-d'];
            if (i >= lim) cls.push('fut');
            else if (e > 0 || saiDia[i] > 0) cls.push('mov');
            if (e > 0 && i < lim) cls.push('tem');
            if (i === sel) cls.push('sel');
            if (i === hoje) cls.push('hoje');
            const mostra = i < lim;
            return `<button type="button" class="${cls.join(' ')}" data-fg-dia="${i}" style="--k:${(e / maxEnt).toFixed(2)}"${i >= lim ? ' disabled' : ''} aria-label="Dia ${i + 1}">
                <span class="n">${i + 1}${i === melhor ? '<i class="bi bi-trophy-fill"></i>' : ''}</span>
                <span class="v">${mostra && e > 0 ? `<span class="e">${curto(e)}</span>` : ''}${mostra && saiDia[i] > 0 ? `<span class="s">${curto(saiDia[i])}</span>` : ''}</span></button>`;
        }).join('');
        const dd = String(sel === null ? 0 : sel + 1).padStart(2, '0'), mm = String(mesRef.getMonth() + 1).padStart(2, '0');
        const info = sel === null
            ? `<div class="fg-info">Toque num dia para ver o que entrou e saiu.</div>`
            : `<div class="fg-info"><b>Dia ${dd}/${mm}</b>
                <span class="e">${ICONE.cima} Entrou <b>${fmt(dados.ent[sel])}</b></span>
                <span class="s">${ICONE.baixo} Saiu <b>${fmt(saiDia[sel])}</b></span>
                ${sel === melhor ? '<span class="fg-pill up"><i class="bi bi-trophy-fill"></i> melhor dia</span>' : ''}</div>`;
        const r = resumo(dados, lim);
        return `
            <div class="fg-card larga">
                <h3>Dia a dia</h3>
                <div class="fg-sub">Cada quadrado é um dia. Verde: o que entrou. Vermelho: o que saiu.</div>
                <div class="fg-cal">${['D','S','T','Q','Q','S','S'].map(x => `<div class="fg-dw">${x}</div>`).join('')}${'<div></div>'.repeat(vazios)}${celulas}</div>
                ${info}
                <div class="fg-res">
                    <div>Entrou<b class="e">${fmt0(r.entrou)}</b><small>${lim} dia${lim === 1 ? '' : 's'}</small></div>
                    <div>Saiu<b class="s">${fmt0(r.saiu)}</b><small>contas + produto</small></div>
                    <div>Melhor dia<b>${melhor >= 0 ? fmt0(dados.ent[melhor]) : '–'}</b><small>${melhor >= 0 ? `dia ${String(melhor + 1).padStart(2, '0')}/${mm}` : 'sem entradas'}</small></div>
                </div>
            </div>`;
    }

    // ── Despesas por categoria ──
    function categoriasHtml(dados) {
        let linhas = Object.entries(dados.cats).sort((a, b) => b[1] - a[1]);
        if (linhas.length > 7) {   // as menores viram uma linha só
            const resto = linhas.slice(6);
            linhas = linhas.slice(0, 6).concat([[`Outras (${resto.length})`, resto.reduce((s, c) => s + c[1], 0)]]);
        }
        const total = linhas.reduce((s, c) => s + c[1], 0) || 1, max = linhas.length ? linhas[0][1] : 1;
        return `
            <div class="fg-card">
                <h3>Para onde vão as despesas</h3>
                <div class="fg-sub">Da maior para a menor</div>
                ${linhas.length ? linhas.map(([nome, v]) => `
                    <div class="fg-cat"><div class="n">${esc(nome)}<span>${Math.round(v / total * 100)}%</span></div><div class="v">${fmt(v)}</div>
                    <div class="trilho"><i style="width:${Math.max(3, v / max * 100)}%"></i></div></div>`).join('')
                    : `<div class="fg-vazio">Sem despesas nesse mês.</div>`}
            </div>`;
    }

    // ══════════════════════ Visão: Comparar ══════════════════════
    // Seta de mudança. bomSobe: true = subir é bom (entrou/sobrou) · false = descer é bom (contas) · null = neutro (produto)
    function pilula(a, b, bomSobe) {
        if (!a && !b) return `<span class="fg-pill neu">–</span>`;
        if (!b) return `<span class="fg-pill neu">novo</span>`;
        const sobe = a >= b, p = Math.abs((a - b) / Math.abs(b) * 100);
        const cls = bomSobe === null ? 'neu' : (sobe === bomSobe ? 'up' : 'down');
        return `<span class="fg-pill ${cls}">${sobe ? ICONE.cima : ICONE.baixo}${p >= 10 ? Math.round(p) : p.toFixed(1).replace('.', ',')}%</span>`;
    }

    // Se um dos meses é o atual e a opção está ligada, os dois valem só até hoje
    function limiteComparacao() {
        return (ehMesAtual(cmpA) || ehMesAtual(cmpB)) && mesmoPeriodo ? new Date().getDate() : null;
    }

    function compararHtml() {
        const dA = dadosDoMes(cmpA), dB = dadosDoMes(cmpB);
        const corte = limiteComparacao();
        const rA = resumo(dA, corte || limiteDoMes(cmpA)), rB = resumo(dB, corte || limiteDoMes(cmpB));
        const nA = NOMES_MES_LONGO[cmpA.getMonth()], nB = NOMES_MES_LONGO[cmpB.getMonth()];
        const diff = arred(rA.sobrou - rB.sobrou);
        const maxV = Math.max(rA.entrou, rB.entrou, rA.contas, rB.contas, rA.prod, rB.prod, Math.abs(rA.sobrou), Math.abs(rB.sobrou), 1);
        const linhaMetrica = (titulo, k, bom) => `
            <div class="fg-met"><div class="h"><span>${titulo}</span>${pilula(rA[k], rB[k], bom)}</div>
                <div class="l"><div class="tr"><i style="width:${Math.max(2, Math.abs(rA[k]) / maxV * 100)}%;background:var(--primary)"></i></div><div class="vl">${fmt0(rA[k])}</div></div>
                <div class="l"><div class="tr"><i style="width:${Math.max(2, Math.abs(rB[k]) / maxV * 100)}%;background:var(--fg-cinza)"></i></div><div class="vl b">${fmt0(rB[k])}</div></div></div>`;
        const veredito = diff === 0
            ? `<div class="t2">Os dois meses sobraram o mesmo valor</div>`
            : `<div class="t2"><em class="${diff > 0 ? 'ok' : 'ruim'}">${fmt0(Math.abs(diff))} ${diff > 0 ? 'a mais' : 'a menos'}</em> sobrando no caixa</div>${pilula(rA.sobrou, rB.sobrou, true)}`;
        const emAndamento = ehMesAtual(cmpA) || ehMesAtual(cmpB);
        return `
            <div class="fg-vs">
                <button type="button" class="fg-mes-btn a" data-fg-pick="A"><small><span class="fg-dot" style="background:var(--primary)"></span>MÊS</small><b>${nomeCurto(cmpA)} <i class="bi bi-chevron-down"></i></b></button>
                <button type="button" class="fg-troca" data-fg-troca aria-label="Trocar os dois meses"><i class="bi bi-arrow-left-right"></i></button>
                <button type="button" class="fg-mes-btn" data-fg-pick="B"><small><span class="fg-dot" style="background:var(--fg-cinza)"></span>CONTRA</small><b>${nomeCurto(cmpB)} <i class="bi bi-chevron-down"></i></b></button>
            </div>
            ${emAndamento ? `<label class="fg-opt"><span>Comparar só até o dia ${new Date().getDate()} nos dois meses<small>${mesmoPeriodo ? 'Justo: o mês atual ainda não acabou' : 'Mês inteiro: o mês completo leva vantagem de dias'}</small></span>
                <span class="fg-sw"><input type="checkbox" data-fg-mesmo${mesmoPeriodo ? ' checked' : ''}><span class="fg-sw-trilho"></span></span></label>` : ''}
            <div class="fg-verd"><div class="t1">${corte ? `Até o dia ${corte}, ` : ''}${nA} ${diff >= 0 ? 'está na frente de' : 'está atrás de'} ${nB}</div>${veredito}</div>
            <div class="fg-card">
                <h3>Lado a lado</h3>
                <div class="fg-sub"><span class="fg-dot" style="background:var(--primary)"></span>${nA} &nbsp; <span class="fg-dot" style="background:var(--fg-cinza)"></span>${nB}</div>
                ${linhaMetrica('Entrou', 'entrou', true)}${linhaMetrica('Contas', 'contas', false)}${linhaMetrica('Virou produto', 'prod', null)}${linhaMetrica('Sobrou', 'sobrou', true)}
            </div>
            ${linhaDoTempoHtml(dA, dB)}`;
    }

    // ── "Quem está na frente, dia a dia": quanto já tinha entrado em cada dia do mês ──
    let linhaEstado = null;   // dados do gráfico em uso (pro toque achar o dia)
    function linhaDoTempoHtml(dA, dB) {
        const nA = NOMES_MES_LONGO[cmpA.getMonth()], nB = NOMES_MES_LONGO[cmpB.getMonth()];
        const total = Math.max(dA.n, dB.n);
        const acum = d => { let s = 0; return Array.from({ length: total }, (_, i) => (s += d.ent[i] || 0)); };
        const acA = acum(dA), acB = acum(dB);
        const limA = limiteDoMes(cmpA), limB = limiteDoMes(cmpB);   // a linha do mês em andamento acaba hoje
        const corte = limiteComparacao();
        const diaRef = corte || limA;
        const topo = Math.max(acA[limA - 1] || 0, acB[limB - 1] || 0, 1);
        const W = 330, H = 150, base = H - 8;
        const X = i => total > 1 ? i / (total - 1) * W : 0;
        const Y = v => 8 + (1 - v / topo) * (base - 8);
        const trilha = (ac, lim) => ac.slice(0, lim).map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
        linhaEstado = { acA, acB, limA, limB, fechadoA: limA === dA.n, fechadoB: limB === dB.n, total, nA, nB, W };
        return `
            <div class="fg-card larga">
                <h3>Quem está na frente, dia a dia</h3>
                <div class="fg-sub">Quanto já tinha entrado até cada dia do mês. Toque no gráfico para ver um dia.</div>
                <svg class="fg-linha" id="finGrafLinha" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entrada acumulada dia a dia, ${nA} contra ${nB}">
                    <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="rgba(var(--overlay-rgb),.18)" stroke-width="1"/>
                    <path d="${trilha(acB, limB)}" fill="none" stroke="var(--fg-cinza)" stroke-width="2.4" stroke-dasharray="5 5" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="${trilha(acA, limA)} L${X(limA - 1).toFixed(1)} ${base} L0 ${base} Z" fill="var(--primary)" opacity=".13"/>
                    <path d="${trilha(acA, limA)}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                    <line id="finGrafMarca" x1="${X(diaRef - 1)}" x2="${X(diaRef - 1)}" y1="4" y2="${base}" stroke="rgba(var(--overlay-rgb),.35)" stroke-width="1.5" stroke-dasharray="3 3"/>
                </svg>
                <div class="fg-eixo"><span>dia 1</span><span>dia ${Math.round(total / 2)}</span><span>dia ${total}</span></div>
                <div class="fg-info" id="finGrafLinhaInfo">${infoLinha(diaRef)}</div>
                <div class="fg-legenda"><span><span class="fg-dot" style="background:var(--primary)"></span>${nA} (linha cheia)</span><span><span class="fg-dot" style="background:var(--fg-cinza)"></span>${nB} (tracejada)</span></div>
            </div>`;
    }
    function infoLinha(dia) {
        const s = linhaEstado;
        // depois do último dia de um mês já fechado (ex.: fevereiro no dia 30) vale o total final dele
        const valor = (ac, lim, fechado) => dia <= lim ? fmt0(ac[dia - 1]) : fechado ? fmt0(ac[lim - 1]) : 'ainda não chegou';
        const vA = valor(s.acA, s.limA, s.fechadoA), vB = valor(s.acB, s.limB, s.fechadoB);
        return `<span>No dia <b>${dia}</b>:</span><span class="a"><b>${s.nA}</b> ${vA}</span><span class="b"><b>${s.nB}</b> ${vB}</span>`;
    }
    function tocarLinha(e) {
        const svg = el('finGrafLinha');
        if (!svg || !linhaEstado) return;
        const caixa = svg.getBoundingClientRect();
        const s = linhaEstado;
        const dia = Math.min(s.total, Math.max(1, Math.round((e.clientX - caixa.left) / caixa.width * (s.total - 1)) + 1));
        const x = s.total > 1 ? (dia - 1) / (s.total - 1) * s.W : 0;
        const marca = el('finGrafMarca');
        marca.setAttribute('x1', x); marca.setAttribute('x2', x);
        el('finGrafLinhaInfo').innerHTML = infoLinha(dia);
    }

    // ══════════════════════ Visão: Últimos meses ══════════════════════
    function evolucaoHtml() {
        const meses = Array.from({ length: 6 }, (_, k) => somaMeses(mesAtual(), k - 5));
        const linhas = meses.map(m => ({ m, r: resumo(dadosDoMes(m), limiteDoMes(m)), atual: ehMesAtual(m) }));
        const max = Math.max(...linhas.map(l => Math.max(l.r.entrou, l.r.saiu)), 1);
        const idx = Math.max(0, linhas.findIndex(l => mesmoMes(l.m, selEvo || mesAtual())));
        const cur = linhas[idx];
        const barras = linhas.map((l, k) => `
            <button type="button" class="m${k === idx ? ' sel' : ''}" data-fg-evo="${k}" aria-label="${nomeMes(l.m)}">
                <span class="bs"><i class="e" style="height:${l.r.entrou ? Math.max(3, l.r.entrou / max * 100) : 0}%"></i><i class="s" style="height:${l.r.saiu ? Math.max(3, l.r.saiu / max * 100) : 0}%"></i></span>
                <span class="rot">${NOMES_MES[l.m.getMonth()]}</span></button>`).join('');
        const lista = linhas.slice().reverse().map((l, k, tudo) => {
            const anterior = tudo[k + 1];
            // O mês em andamento não leva seta: ele ainda não acabou, compará-lo com um mês inteiro daria falsa derrota.
            const seta = l.atual ? '' : (anterior ? pilula(l.r.sobrou, anterior.r.sobrou, true) : '');
            return `<button type="button" class="fg-lm" data-fg-evo="${linhas.indexOf(l)}"><span class="n">${NOMES_MES_LONGO[l.m.getMonth()]}<small>${l.atual ? `em andamento · até o dia ${l.r.ate}` : `Entrou ${fmt0(l.r.entrou)}`}</small></span>
                <span class="d"><b class="${l.r.sobrou < 0 ? 'neg' : ''}">${fmt0(l.r.sobrou)}</b>${seta}</span></button>`;
        }).join('');
        const anterior = idx > 0 ? linhas[idx - 1] : null;
        return `
            <div class="fg-card larga">
                <h3>Os últimos 6 meses</h3>
                <div class="fg-sub">Quanto entrou e quanto saiu (contas + produto) em cada mês</div>
                <div class="fg-evo">${barras}</div>
                <div class="fg-legenda"><span><span class="fg-dot" style="background:var(--success)"></span>Entrou</span><span><span class="fg-dot" style="background:var(--danger)"></span>Saiu</span></div>
                <div class="fg-info"><b>${NOMES_MES_LONGO[cur.m.getMonth()]}</b><span>Entrou ${fmt0(cur.r.entrou)}</span><span>Saiu ${fmt0(cur.r.saiu)}</span><span class="${cur.r.sobrou < 0 ? 's' : 'e'}"><b>${cur.r.sobrou < 0 ? 'Faltou' : 'Sobrou'} ${fmt0(Math.abs(cur.r.sobrou))}</b></span></div>
                ${anterior ? `<button type="button" class="fg-btn" data-fg-vai="${idx}">Comparar ${NOMES_MES_LONGO[cur.m.getMonth()]} com ${NOMES_MES_LONGO[anterior.m.getMonth()]}</button>` : ''}
            </div>
            <div class="fg-card larga">
                <h3>Sobrou no caixa, mês a mês</h3>
                <div class="fg-sub">A seta mostra a mudança em relação ao mês anterior</div>
                ${lista}
            </div>`;
    }

    // ══════════════════════ Escolher mês (folha de baixo) ══════════════════════
    // alvo: 'ref' (Neste mês) | 'A' | 'B' (Comparar). Mostra os últimos 12 meses; os sem lançamento ficam apagados.
    function abrirFolhaMes(alvo) {
        const atual = alvo === 'ref' ? mesRef : alvo === 'A' ? cmpA : cmpB;
        const primeiro = primeiroMesComDados();
        const lista = Array.from({ length: 12 }, (_, k) => somaMeses(mesAtual(), k - 11));
        const titulo = alvo === 'B' ? 'Comparar com qual mês?' : alvo === 'A' ? 'Qual mês?' : 'Escolher mês';
        const caixa = window._finFolha(`
            <div class="vs-folha-titulo">${titulo}</div>
            <div class="fg-meses">${lista.map((m, k) => `<button type="button" data-fg-escolhe="${k}" class="${mesmoMes(m, atual) ? 'on' : ''}"${m < primeiro ? ' disabled' : ''}>${NOMES_MES[m.getMonth()]}<small>${m.getFullYear()}</small></button>`).join('')}</div>`);
        caixa.querySelectorAll('[data-fg-escolhe]').forEach(b => b.addEventListener('click', () => {
            const m = lista[Number(b.dataset.fgEscolhe)];
            if (alvo === 'ref') { mesRef = m; selDia = null; }
            else {
                const outro = alvo === 'A' ? cmpB : cmpA;
                if (mesmoMes(m, outro)) { const x = cmpA; cmpA = cmpB; cmpB = x; }   // dois meses iguais não comparam nada: troca
                else if (alvo === 'A') cmpA = m; else cmpB = m;
            }
            window._finFolhaFechar();
            renderTudo();
        }));
    }

    // ══════════════════════ Eventos ══════════════════════
    function ligarEventos(wrap) {
        wrap.querySelectorAll('[data-fg-vis]').forEach(b => b.addEventListener('click', () => { visao = b.dataset.fgVis; renderTudo(); }));
        wrap.querySelectorAll('[data-fg-mes]').forEach(b => b.addEventListener('click', () => {
            mesRef = somaMeses(mesRef, Number(b.dataset.fgMes)); selDia = null; renderTudo();
        }));
        wrap.querySelectorAll('[data-fg-pick]').forEach(b => b.addEventListener('click', () => abrirFolhaMes(b.dataset.fgPick)));
        wrap.querySelectorAll('[data-fg-dia]').forEach(b => b.addEventListener('click', () => { selDia = Number(b.dataset.fgDia); renderTudo(); }));
        wrap.querySelectorAll('[data-fg-troca]').forEach(b => b.addEventListener('click', () => { const x = cmpA; cmpA = cmpB; cmpB = x; renderTudo(); }));
        wrap.querySelectorAll('[data-fg-mesmo]').forEach(b => b.addEventListener('change', () => { mesmoPeriodo = b.checked; renderTudo(); }));
        wrap.querySelectorAll('[data-fg-evo]').forEach(b => b.addEventListener('click', () => {
            selEvo = somaMeses(mesAtual(), Number(b.dataset.fgEvo) - 5); renderTudo();
        }));
        wrap.querySelectorAll('[data-fg-vai]').forEach(b => b.addEventListener('click', () => {
            const m = somaMeses(mesAtual(), Number(b.dataset.fgVai) - 5);
            cmpA = m; cmpB = somaMeses(m, -1); mesmoPeriodo = true; visao = 'comparar'; renderTudo();
        }));
        const linha = el('finGrafLinha');
        if (linha) {
            linha.addEventListener('pointerdown', e => { linha.setPointerCapture(e.pointerId); tocarLinha(e); });
            linha.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') tocarLinha(e); });
        }
    }

    // ── Ponto de entrada chamado pelo router ──────────────────────
    window._renderFinanceiroGraficos = function () {
        // Fechar a folha de baixo desfaz uma entrada do histórico, e o navegador então "restaura" esta tela
        // chamando esta função de novo (window._vsNavRestoring). Nesse caso o que a pessoa escolheu fica.
        if (!window._vsNavRestoring || !mesRef) {
            mesRef = mesAtual();
            selDia = null; selEvo = null; visao = 'mes';
            cmpA = mesAtual(); cmpB = somaMeses(cmpA, -1); mesmoPeriodo = true;
        }
        renderTudo();
    };
    // core.js chama sempre que financeiro/lancamentos muda em tempo real — redesenha com o dado fresco.
    window._finOnLancamentosLoadedGraficos = function () {
        if (mounted && el('financeiroGraficos')?.style.display !== 'none') renderTudo();
    };
})();
