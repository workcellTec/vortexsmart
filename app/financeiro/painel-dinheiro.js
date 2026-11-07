// ================================================================
// financeiro/painel-dinheiro.js — VortexSmart · Financeiro → Painel do dinheiro
// Registra: window._finPainelDinheiro(cfg)  (+ ._calcular, a conta pura)
//
// O ÚNICO lugar que mostra "quanto entrou, quanto saiu e quanto virou produto".
// Movimentações e Gráficos só chamam este painel — antes cada
// tela tinha a sua versão, com palavras diferentes pro mesmo número.
//
// Fechado, são 5 blocos encaixados numa grade de 12 colunas e nada mais:
//   Entrou · Contas · Virou produto      (3 cartões iguais)
//   Sobrou no caixa   destaque, com a barra "pra onde foi cada real que entrou"
//                     (vira "Faltou no caixa" se negativo: a barra passa a dividir o que SAIU)
//   Lucro do mês      o que se ganhou DE VERDADE (ver abaixo)
// Tocando num cartão abre o detalhe numa faixa embaixo (um por vez); tocar de novo fecha.
// Entrou − Contas − Virou produto = Sobrou. O resto da explicação mora na faixa.
//
// Duas contas que NÃO são a mesma coisa (e por isso nunca aparecem lado a lado sem explicação):
//   CAIXA  = Entrou − Contas − Virou produto. A compra de estoque conta, porque o dinheiro saiu.
//   LUCRO  = vendas líquidas − custo do que foi VENDIDO + outras receitas − Contas.
//            A compra de estoque NÃO entra: o custo do que se vendeu já foi descontado, e
//            descontar a compra também seria o "Duplo Lucro". Outras receitas lançadas à mão
//            (sem custo) entram no lucro, inclusive as lançadas com a categoria "Venda".
//            Só a venda AUTOMÁTICA (origem: 'automatica') já está nas vendas. As vendas vêm de window._lucroDasVendas e
//            window._entradasPorForma (venda/relatorios.js): a mesma conta dos Relatórios.
//   A diferença entre os dois é a mercadoria que ficou na prateleira (compra − custo vendido).
//
// cfg = {
//   alvoId : id do elemento onde o painel é desenhado,
//   faixa  : () => [início, fim) em Date (fim EXCLUSIVO); inválida/vazia = período incompleto,
//   itens  : () => lançamentos do financeiro DENTRO da faixa (sempre frescos, tempo real),
//   rotulo : () => 'do mês' | 'do dia' | 'da semana' | 'do período'   (vai no "Lucro ...")
// }
// Devolve { desenhar(), forcarLeitura() }. As vendas chegam depois (assíncrono): o que vem dos
// lançamentos aparece na hora; só o lucro e o detalhe por forma esperam.
// ================================================================
(function () {
    'use strict';
    const el  = id => document.getElementById(id);
    const esc = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t == null ? '' : t);
    const fmt = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const arred = n => Math.round((Number(n) || 0) * 100) / 100;
    const VERDE = '#4ade80', VERMELHO = '#f87171', AMARELO = '#fbbf24';
    const LIMITE_COMPRAS = 5;   // linhas de "compra por produto" antes do "+ N compras menores"

    function somaPor(itens, chaveDe) {
        const m = {};
        itens.forEach(i => { const k = chaveDe(i); m[k] = (m[k] || 0) + (i.valor || 0); });
        return Object.entries(m).map(([nome, valor]) => ({ nome, valor: arred(valor) })).sort((a, b) => b.valor - a.valor);
    }

    // ── A conta, separada do desenho ───────────────────────────────────────────
    // itens  = lançamentos do período; vendas = { lucro, entradas } já lidos (ou null)
    function calcular(itens, vendas) {
        const soma = lista => arred(lista.reduce((s, i) => s + (i.valor || 0), 0));
        const receitas = itens.filter(i => i.tipo === 'receita');
        const despesas = itens.filter(i => i.tipo === 'despesa');
        // "Venda" automática = dinheiro de uma venda que já está nas vendas lidas (o lucro dela vem de lá,
        // com custo). Receita lançada à mão — mesmo escolhendo a categoria "Venda" — não está em venda
        // nenhuma: conta como outra receita (sem custo). Sem essa distinção ela ficava no caixa e sumia do lucro.
        const ehVendaAuto = i => i.categoria === 'venda' && i.origem === 'automatica';
        const vendasCaixa = receitas.filter(ehVendaAuto);
        const outrasRec = receitas.filter(i => !ehVendaAuto(i));
        const comprasLista = despesas.filter(i => i.categoria === 'produto');
        const contasLista = despesas.filter(i => i.categoria !== 'produto');

        const r = {
            entrou: soma(receitas), vendas: soma(vendasCaixa),
            outras: { total: soma(outrasRec), porCategoria: somaPor(outrasRec, i => i.categoriaNome || i.categoria || 'Outras') },
            contas: { total: soma(contasLista), porCategoria: somaPor(contasLista, i => i.categoriaNome || i.categoria || 'Outras') },
            compras: { total: soma(comprasLista), porProduto: somaPor(comprasLista, i => i.origemDescricao || i.descricao || 'Compra de produto') },
            lucro: null
        };
        r.sobrou = arred(r.entrou - r.contas.total - r.compras.total);
        const v = vendas && vendas.lucro;
        if (v) {
            r.lucro = {
                valor: arred(v.lucro + r.outras.total - r.contas.total),
                vendasLiquidas: arred(v.liquido), custo: arred(v.custo), taxas: arred(v.taxas || 0),
                qtdVendas: v.vendas, itensSemCusto: v.itensSemCusto || 0,
                prateleira: arred(r.compras.total - v.custo),  // + comprou e ainda não vendeu · − vendeu estoque antigo
                aReceber: arred(v.liquido - r.vendas)          // + vendido a prazo, ainda não entrou · − entrou venda de outro período
            };
        }
        return r;
    }

    // ── Desenho ────────────────────────────────────────────────────────────────
    // Ícones de linha (Bootstrap Icons embutidos em SVG: não dependem de fonte/rede).
    const ICONES = {
        entrou:  '<path d="M8 1a.5.5 0 0 1 .5.5v10.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 12.293V1.5A.5.5 0 0 1 8 1"/>',
        contas:  '<path d="M8 15a.5.5 0 0 1-.5-.5V3.707L4.354 6.854a.5.5 0 1 1-.708-.708l4-4a.5.5 0 0 1 .708 0l4 4a.5.5 0 0 1-.708.708L8.5 3.707V14.5A.5.5 0 0 1 8 15"/>',
        produto: '<path d="M8.186 1.113a.5.5 0 0 0-.372 0L1.846 3.5 8 5.961 14.154 3.5zM15 4.239l-6.5 2.6v7.922l6.5-2.6V4.24zM7.5 14.762V6.838L1 4.239v7.923z"/>',
        ok:      '<path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>',
        alerta:  '<path d="M7.005 3.1a1 1 0 1 1 1.99 0l-.388 6.35a.61.61 0 0 1-1.214 0zM7 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0"/>',
        lucro:   '<path fill-rule="evenodd" d="M0 0h1v15h15v1H0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07"/>'
    };
    const icone = id => `<svg width="19" height="19" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${ICONES[id]}</svg>`;

    const lin = (rotulo, valor, forte) => `<div class="fl-r${forte ? ' forte' : ''}"><span>${esc(rotulo)}</span><b>${valor}</b></div>`;
    const par = (html, cor) => `<p class="fl-p"${cor ? ` style="color:${cor};"` : ''}>${html}</p>`;
    const linhas = (rows, uma) => rows ? `<div class="fl-rows${uma ? ' uma' : ''}">${rows}</div>` : '';
    const sgn = v => (v < 0 ? '− ' + fmt(-v) : fmt(v));   // negativo sempre como "− R$ x" (igual ao resto do painel)
    const moeda = (v, sinal) => (arred(v) === 0 ? fmt(0) : `${sinal || ''}${fmt(v)}`);

    // Percentuais inteiros que SOMAM 100 (maior resto): 17 + 53 + 30, nunca 99 ou 101.
    function percentuais(valores, base) {
        if (!(base > 0)) return valores.map(() => 0);
        const brutos = valores.map(v => Math.max(0, v) / base * 100);
        const pisos = brutos.map(Math.floor);
        let falta = 100 - pisos.reduce((s, x) => s + x, 0);
        brutos.map((b, i) => ({ i, f: b - pisos[i] })).sort((a, b) => b.f - a.f).forEach(x => { if (falta > 0) { pisos[x.i]++; falta--; } });
        return pisos;
    }

    // estado: 'ok' | 'carregando' | 'erro' | 'indisponivel' (versão sem Relatórios de Vendas)
    // Cada detalhe devolve as LINHAS (valores) e depois as NOTAS (frases).
    function detalheEntrou(r, vendas, estado) {
        let rows = '', h = '';
        const ent = vendas && vendas.entradas;
        if (ent) {
            rows += ent.grupos.map(g => lin(g.rotulo, fmt(g.liquido))).join('');
            const semDetalhe = arred(r.vendas - ent.liquido);
            if (Math.abs(semDetalhe) >= 0.01) rows += lin('Sem detalhe da forma', fmt(semDetalhe));
        } else if (r.vendas > 0) rows += lin('Vendas', fmt(r.vendas));
        rows += r.outras.porCategoria.map(c => lin(c.nome, fmt(c.valor))).join('');
        if (!r.entrou) h += par('Nada entrou nesse período.');
        if (ent && ent.bruto - ent.liquido >= 0.01) h += par(`Já descontadas as taxas da máquina (${fmt(ent.bruto - ent.liquido)}).`);
        if (estado === 'carregando') h += par('Calculando o detalhe das vendas…');
        if (estado === 'erro') h += par('Não consegui ler o detalhe das vendas agora. O total está certo.', AMARELO);
        return linhas(rows) + h;
    }
    function detalheContas(r) {
        return r.contas.porCategoria.length
            ? linhas(r.contas.porCategoria.map(c => lin(c.nome, fmt(c.valor))).join(''))
            : par('Nenhuma conta nesse período.');
    }
    function detalheProduto(r) {
        const p = r.compras.porProduto;
        let rows = p.slice(0, LIMITE_COMPRAS).map(x => lin(x.nome, fmt(x.valor))).join(''), h = '';
        if (p.length > LIMITE_COMPRAS) rows += lin(`+ ${p.length - LIMITE_COMPRAS} compra(s) menores`, fmt(p.slice(LIMITE_COMPRAS).reduce((s, x) => s + x.valor, 0)));
        if (!p.length) h += par('Nenhuma compra de estoque nesse período.');
        const l = r.lucro;
        if (l && l.prateleira >= 0.01) h += par(`Desse total, ${fmt(l.custo)} já foi vendido. <b>${fmt(l.prateleira)} ainda está na prateleira.</b>`);
        else if (l && l.prateleira <= -0.01) h += par(`Você vendeu <b>${fmt(-l.prateleira)} a mais</b> do que comprou: saiu estoque que você já tinha.`);
        return linhas(rows) + h;
    }
    function detalheLucro(r, estado) {
        if (estado === 'carregando') return par('Calculando…');
        if (estado === 'erro') return par('Não consegui calcular o lucro agora. Tente de novo em instantes.', AMARELO);
        const l = r.lucro;
        let rows = lin('Vendeu (sem a taxa da máquina)', fmt(l.vendasLiquidas));
        if (r.outras.total >= 0.01) rows += lin('+ Outras receitas', fmt(r.outras.total));
        rows += lin('− Custo do que você vendeu', fmt(l.custo));
        rows += lin('− Contas', fmt(r.contas.total));
        rows += lin('= Lucro', sgn(l.valor), true);
        let h = '';
        // Por que lucro ≠ caixa: lucro − caixa = prateleira + a receber (exato, por construção da conta).
        const motivos = [];
        if (l.prateleira >= 0.01) motivos.push(`<b>${fmt(l.prateleira)}</b> da mercadoria que você comprou ainda está na prateleira`);
        else if (l.prateleira <= -0.01) motivos.push(`você vendeu <b>${fmt(-l.prateleira)}</b> de estoque que já tinha`);
        if (l.aReceber >= 0.01) motivos.push(`<b>${fmt(l.aReceber)}</b> das vendas ainda vai entrar (parcelas a receber)`);
        else if (l.aReceber <= -0.01) motivos.push(`entraram <b>${fmt(-l.aReceber)}</b> de vendas de outros períodos`);
        if (motivos.length) h += par(`${r.sobrou < 0 && l.valor >= 0 ? 'Caixa no vermelho não é prejuízo: ' : 'Lucro e caixa são coisas diferentes: '}${motivos.join(' e ')}.`);
        if (l.itensSemCusto > 0) h += par(`⚠️ ${l.itensSemCusto} item(ns) vendido(s) sem preço de compra: o lucro pode estar maior que o real.`, AMARELO);
        h += par('Serviços (concertos) entram só na receita, sem custo.');
        return linhas(rows, true) + h;
    }

    // Os 3 cartões iguais (Entrou, Contas, Virou produto) e o do Lucro: todos tocáveis.
    function cartao(id, classe, nome, valorHtml, legenda, cor, aberto, corValor) {
        return `
            <button type="button" class="fl-card ${classe}${aberto ? ' sel' : ''}" style="--g:${cor};" data-pd="${id}" aria-expanded="${aberto ? 'true' : 'false'}">
                <span class="fl-top"><span class="fl-ic">${icone(id)}</span><span class="fl-lab">${nome}</span><span class="fl-chev" aria-hidden="true">›</span></span>
                <span class="fl-val"${corValor ? ` style="color:${corValor};"` : ''}>${valorHtml}</span>
                <span class="fl-cap">${legenda}</span>
            </button>`;
    }

    // Bloco de destaque: o que sobrou + a barra "pra onde foi cada real que entrou".
    // Se faltou, a barra divide o que SAIU (contas × produto) e a 3ª legenda mostra o quanto faltou.
    function cartaoSobrou(r) {
        const faltou = r.sobrou <= -0.01, positivo = r.sobrou >= 0.01;
        const cor = faltou ? AMARELO : (positivo ? VERDE : '#94a3b8');
        const saidas = arred(r.contas.total + r.compras.total);
        const base = faltou ? saidas : r.entrou;
        const valores = [r.contas.total, r.compras.total, positivo ? r.sobrou : 0];
        const pct = percentuais(valores, base);
        const txtPct = (i) => (valores[i] > 0 && pct[i] === 0 ? '&lt;1%' : pct[i] + '%');
        const cores = [VERMELHO, AMARELO, VERDE];
        const segs = valores.map((v, i) => v > 0 && base > 0 ? `<i style="flex:${v};background:${cores[i]};"></i>` : '').join('');
        const leg = [['Contas', txtPct(0)], ['Virou produto', txtPct(1)], faltou ? ['Faltou', fmt(-r.sobrou)] : ['Sobrou', txtPct(2)]];
        return `
            <div class="fl-card hero${faltou ? ' falta' : ''}" style="--g:${cor};">
                <div class="fl-hero-l">
                    <div class="fl-top"><span class="fl-ic">${icone(faltou ? 'alerta' : 'ok')}</span><span class="fl-lab">${faltou ? 'Faltou no caixa' : 'Sobrou no caixa'}</span></div>
                    <div class="fl-val"${faltou ? ` style="color:${AMARELO};"` : ''}>${faltou ? '− ' + fmt(-r.sobrou) : fmt(r.sobrou)}</div>
                    <div><span class="fl-chip">● ${faltou ? 'Caixa no vermelho' : (positivo ? 'Caixa positivo' : 'Caixa zerado')}</span></div>
                </div>
                <div class="fl-hero-r">
                    <h4>${faltou ? 'Pra onde foi o dinheiro' : 'Pra onde foi cada real que entrou'}</h4>
                    <div class="fl-bar2" aria-hidden="true">${segs}</div>
                    <div class="fl-leg">${leg.map(([nome, v], i) => `<div><span style="background:${faltou && i === 2 ? AMARELO : cores[i]};"></span>${nome}<b>${v}</b></div>`).join('')}</div>
                </div>
            </div>`;
    }

    // Faixa de detalhe embaixo dos cartões (um por vez). Mesmo cartão de novo = fecha.
    function gaveta(id, r, vendas, estado, rotulo) {
        const D = {
            entrou:  ['Entrou', 'Vendas (já sem a taxa da máquina) e outras receitas', VERDE, () => detalheEntrou(r, vendas, estado)],
            contas:  ['Contas', 'Aluguel, luz, internet e outras despesas do dia a dia', VERMELHO, () => detalheContas(r)],
            produto: ['Virou produto', 'Dinheiro que você gastou comprando mercadoria pra vender', AMARELO, () => detalheProduto(r)],
            lucro:   [`Lucro ${esc(rotulo)}`, 'O que você ganhou de verdade', '#a78bfa', () => detalheLucro(r, estado)]
        }[id];
        if (!D) return '';
        return `<div class="fl-detail fin-pd-det" style="--g:${D[2]};" role="region" aria-label="${D[0]}"><h5>${D[0]}<small>${D[1]}</small></h5>${D[3]()}</div>`;
    }

    function html(r, estado, rotulo, aberto, vendas) {
        const comLucro = estado !== 'indisponivel';
        let h = cartao('entrou', 'k', 'Entrou', fmt(r.entrou), 'Vendas e outras receitas', VERDE, aberto === 'entrou')
              + cartao('contas', 'k', 'Contas', moeda(r.contas.total, '− '), 'Aluguel, luz, internet…', VERMELHO, aberto === 'contas')
              + cartao('produto', 'k', 'Virou produto', moeda(r.compras.total, '− '), 'Compra de mercadoria', AMARELO, aberto === 'produto')
              + cartaoSobrou(r);
        if (comLucro) {
            const ok = estado === 'ok';
            const valor = ok ? (arred(r.lucro.valor) > 0 ? '+ ' + fmt(r.lucro.valor) : sgn(r.lucro.valor)) : (estado === 'carregando' ? '…' : '—');
            const corV = ok ? (r.lucro.valor >= 0.01 ? VERDE : (r.lucro.valor <= -0.01 ? VERMELHO : '')) : 'var(--text-secondary)';
            const legenda = estado === 'carregando' ? 'Calculando…' : (estado === 'erro' ? 'Não consegui calcular agora' : 'Lucro e caixa não são a mesma coisa');
            h += cartao('lucro', 'luc', `Lucro ${esc(rotulo)}`, valor, legenda, '#a78bfa', aberto === 'lucro', corV);
        }
        if (aberto && (aberto !== 'lucro' || comLucro)) h += gaveta(aberto, r, vendas, estado, rotulo);
        return `<div class="fin-pd"><div class="fl-grid${comLucro ? '' : ' sem-lucro'}">${h}</div></div>`;
    }

    window._finPainelDinheiro = function (cfg) {
        let aberto = null;                // cartão com o detalhe aberto (um por vez) — vale pra todos os períodos e sobrevive ao redesenho
        const cache = {};                 // "loja|início-fim" → { lucro, entradas } (mostra na hora ao voltar pro período; a loja na chave evita mostrar venda de outra loja após trocar de login)
        let token = 0;                    // descarta respostas de períodos que o usuário já deixou pra trás
        let forcar = false;               // ao entrar na tela, a 1ª leitura relê as vendas
        let ultimo = { vendas: null, estado: 'carregando' };

        function pintar(vendas, estado) {
            const alvo = el(cfg.alvoId);
            if (!alvo) return;
            ultimo = { vendas, estado };
            alvo.innerHTML = html(calcular(cfg.itens(), vendas), estado, cfg.rotulo(), aberto, vendas);
            alvo.querySelectorAll('[data-pd]').forEach(b => b.addEventListener('click', () => {
                aberto = aberto === b.dataset.pd ? null : b.dataset.pd;
                pintar(ultimo.vendas, ultimo.estado);
            }));
        }

        function desenhar() {
            const alvo = el(cfg.alvoId);
            if (!alvo) return;
            const f = cfg.faixa();
            if (!f || !(f[1].getTime() > f[0].getTime())) {
                token++;
                alvo.innerHTML = `<div class="fin-pd"><div class="fl-aviso">Escolha as duas datas pra ver o dinheiro do período.</div></div>`;
                return;
            }
            const inicio = f[0].getTime(), fimIncl = f[1].getTime() - 1;
            if (typeof window._lucroDasVendas !== 'function' || typeof window._entradasPorForma !== 'function') {
                token++;
                pintar(null, 'indisponivel');   // versão sem Relatórios de Vendas: só a parte de caixa
                return;
            }
            const chave = `${window._lojaId || ''}|${inicio}-${fimIncl}`, meu = ++token;
            pintar(cache[chave] || null, cache[chave] ? 'ok' : 'carregando');
            const atualizar = forcar;
            forcar = false;
            Promise.all([
                window._lucroDasVendas(inicio, fimIncl, { atualizar }),
                window._entradasPorForma(inicio, fimIncl)
            ]).then(([lucro, entradas]) => {
                cache[chave] = { lucro, entradas };
                if (meu !== token) return;
                pintar(cache[chave], 'ok');
            }).catch(() => {
                if (meu !== token) return;
                pintar(null, 'erro');
            });
        }

        return { desenhar, forcarLeitura: () => { forcar = true; } };
    };
    window._finPainelDinheiro._calcular = calcular;
})();
