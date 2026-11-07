// ================================================================
// venda/relatorios.js — VortexSmart · Venda · Relatórios (Vortex Pulse)
// Filtra vendas FECHADAS por período (hoje/semana/mês/personalizado)
// e mostra: Lucro Real (bruto − taxa da maquininha − custo dos
// produtos), a cascata de onde esse número veio, KPIs secundários,
// gráfico de lucro por dia e produtos mais vendidos.
//
// Lucro Real = valorLiquidoTotal da venda (bruto já menos taxa da
// maquininha) − custo dos produtos vendidos (quantidade × custoUnitario
// gravado em cada item da venda — a FOTO do precoCompra do produto no
// momento em que a venda foi feita, não o custo atual dele. Vendas de
// antes dessa mudança, sem esse campo salvo, caem pro custo ATUAL do
// produto em products/{id}.precoCompra como fallback).
// Serviços (sem produtoId) não têm custo, entram só na receita.
//
// Só considera vendas com status:'fechada' — pendente ainda não
// "aconteceu" de fato, e cancelada foi estornada.
// Depende de (via window.*):
//   _fmt, _lojaRef, _dbGet, escapeHtml
// Expõe via window.*:
//   _renderRelatoriosVendas
//   _lucroDasVendas(inicio, fim, {atualizar}) → Promise<resumo> — a ÚNICA
//     conta de lucro das vendas do app; o Financeiro usa esta mesma, pra
//     o "Lucro das vendas" nunca divergir entre as duas telas.
//   _entradasPorForma(inicio, fim, {atualizar}) → Promise<{grupos, bruto,
//     liquido, qtd}> — quanto ENTROU de dinheiro no período, por forma de
//     pagamento (usado pelo Resumo do período do Financeiro).
// ================================================================
(function () {
    'use strict';
    // yyyy-mm-dd no fuso do computador. toISOString() é UTC: depois das 21h no Brasil já dá "amanhã".
    const dataLocalISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const esc = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt = v => typeof window._fmt === 'function' ? window._fmt(v) : `R$ ${Number(v || 0).toFixed(2)}`;
    const el  = id => document.getElementById(id);

    let mounted = false;
    let vendasCache = null;
    let produtosCustoCache = null; // { [produtoId]: precoCompra }
    let vendasCarregadasEm = 0;    // quando vendasCache foi lido (ms) — o Financeiro reaproveita leituras recentes
    let lendoVendas = null;        // leitura em andamento: chamadas simultâneas dividem a mesma
    let periodo = 'hoje'; // hoje | semana | mes | custom
    let dataDe = '';
    let dataAte = '';
    // Loja que embute a taxa da maquininha no preço (cliente "paga" a
    // taxa, ela se anula na venda) pode querer ver o relatório sem
    // desconto de taxa nenhum — não muda o valor final de nada, só a
    // FORMA de mostrar. Preferência pessoal (por usuário, não por
    // loja) — ver window._usuarioPrefRef em core.js.
    let ocultarTaxa = false;

    function ensureSkeleton() {
        const container = el('vendaRelatorios');
        if (!container || mounted) return;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Relatórios</h3>
            </div>
            <div class="content-card w-100">
                <label class="form-label">Período</label>
                <div class="stq-cats" id="relPeriodoPills">
                    <button type="button" class="stq-cat-pill" data-v="hoje" style="color:var(--primary);">Hoje</button>
                    <button type="button" class="stq-cat-pill" data-v="semana" style="color:var(--primary);">Semana</button>
                    <button type="button" class="stq-cat-pill" data-v="mes" style="color:var(--primary);">Mês</button>
                    <button type="button" class="stq-cat-pill" data-v="custom" style="color:var(--primary);">Personalizado</button>
                </div>
                <div id="relCustomRow" style="display:none;" class="venda-qtyval-row mb-2">
                    <div>
                        <label class="form-label">De</label>
                        <input class="form-control" id="relDataDe" type="date"/>
                    </div>
                    <div>
                        <label class="form-label">Até</label>
                        <input class="form-control" id="relDataAte" type="date"/>
                    </div>
                </div>
                <div class="ctx-machine-card mb-2" style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;">
                    <div>
                        <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:.78rem;">Ocultar taxas</div>
                        <div class="stq-hist-sub" style="font-size:.64rem;margin-top:1px;">Pra loja que já embute a taxa no preço — mostra o valor bruto direto, sem descontar nada. Não muda o valor final de nenhuma venda, só a forma de exibir aqui.</div>
                    </div>
                    <button type="button" class="ctx-switch" id="relOcultarTaxaSwitch" style="flex-shrink:0;margin-left:10px;" aria-label="Ocultar taxas"></button>
                </div>

                <div id="relConteudo"></div>
            </div>
        `;
        el('relPeriodoPills').querySelectorAll('.stq-cat-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                periodo = btn.dataset.v;
                el('relPeriodoPills').querySelectorAll('.stq-cat-pill').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                el('relCustomRow').style.display = periodo === 'custom' ? 'flex' : 'none';
                if (periodo !== 'custom') calcularERenderizar();
            });
        });
        el('relDataDe').addEventListener('change', () => { dataDe = el('relDataDe').value; if (dataDe && dataAte) calcularERenderizar(); });
        el('relDataAte').addEventListener('change', () => { dataAte = el('relDataAte').value; if (dataDe && dataAte) calcularERenderizar(); });

        // Preferência pessoal salva (não é da loja, é de quem tá
        // logado) — carrega 1x e já reflete no switch.
        if (typeof window._usuarioPrefRef === 'function') {
            window._dbGet(window._usuarioPrefRef('ocultarTaxaRelatorio')).then(snap => {
                ocultarTaxa = snap.val() === true;
                el('relOcultarTaxaSwitch')?.classList.toggle('on', ocultarTaxa);
                if (vendasCache) calcularERenderizar();
            }).catch(() => {});
        }
        el('relOcultarTaxaSwitch').addEventListener('click', () => {
            ocultarTaxa = !ocultarTaxa;
            el('relOcultarTaxaSwitch').classList.toggle('on', ocultarTaxa);
            if (typeof window._usuarioPrefRef === 'function') {
                window._dbUpdate(window._usuarioPrefRef(), { ocultarTaxaRelatorio: ocultarTaxa }).catch(() => {});
            }
            calcularERenderizar();
        });
        mounted = true;
    }

    function limitesDoPeriodo() {
        const agora = new Date();
        let inicio, fim;
        if (periodo === 'hoje') {
            inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0);
            fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59, 999);
        } else if (periodo === 'semana') {
            const diaSemana = agora.getDay();
            inicio = new Date(agora);
            inicio.setDate(agora.getDate() - diaSemana);
            inicio.setHours(0, 0, 0, 0);
            fim = new Date();
            fim.setHours(23, 59, 59, 999);
        } else if (periodo === 'mes') {
            inicio = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0);
            fim = new Date();
            fim.setHours(23, 59, 59, 999);
        } else { // custom
            if (!dataDe || !dataAte) return null;
            inicio = new Date(dataDe + 'T00:00:00');
            fim = new Date(dataAte + 'T23:59:59');
        }
        return { inicio: inicio.getTime(), fim: fim.getTime() };
    }

    // Lê todas as vendas e propaga o erro — quem precisa saber que falhou
    // (o Financeiro: lucro "zero" por falha de leitura seria mentira).
    function lerVendas() {
        return window._dbGet(window._lojaRef('vendas')).then(snap => {
            const data = snap.val();
            vendasCache = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })) : [];
            vendasCarregadasEm = Date.now();
        });
    }
    // Versão da tela de Relatórios: erro vira lista vazia (comportamento de sempre).
    function carregarVendas() {
        return lerVendas().catch(() => { vendasCache = []; });
    }

    // Custo por produto: usa o cache já carregado pelo core.js (window.products)
    // se disponível (mais rápido, sem round-trip extra); senão busca direto.
    function carregarCustosDosProdutos() {
        if (Array.isArray(window.products) && window.products.length) {
            produtosCustoCache = {};
            window.products.forEach(p => { produtosCustoCache[p.id] = p.precoCompra || 0; });
            return Promise.resolve();
        }
        return window._dbGet(window._lojaRef('products')).then(snap => {
            const data = snap.val();
            produtosCustoCache = {};
            if (data) Object.keys(data).forEach(id => { produtosCustoCache[id] = data[id].precoCompra || 0; });
        }).catch(() => { produtosCustoCache = {}; });
    }

    // Custo total dos itens de uma venda (serviços sem produtoId não têm custo).
    // Prioridade: custoUnitario GRAVADO na venda (foto do momento em que
    // foi feita) — só cai pro custo ATUAL do produto (cache) se o item
    // for de antes dessa mudança e não tiver esse campo salvo.
    //
    // CORREÇÃO (C5 sem efeito — achado em revisão adversarial): antes,
    // `it.custoUnitario != null` tratava igual "nunca gravado" (undefined,
    // item legado — cai no cache de propósito) e "gravado como null
    // porque o produto não tinha custo NO MOMENTO da venda" (
    // custoIndefinido:true, ver venda/lancar.js) — os dois caíam no
    // mesmo fallback do custo ATUAL do produto, então a marcação de
    // custoIndefinido não mudava nada no Lucro Real: se o produto fosse
    // recadastrado com custo depois, o lucro de uma venda ANTIGA mudava
    // sozinho (o bug exato que C4/C5 existem pra evitar). Agora:
    // custoIndefinido:true é respeitado explicitamente — SEMPRE 0,
    // nunca cai no cache, mesmo que o produto tenha custo cadastrado
    // hoje.
    function custoUnitarioDoItem(it) {
        if (it.custoIndefinido === true) return 0;
        return it.custoUnitario != null ? it.custoUnitario : (produtosCustoCache?.[it.produtoId] || 0);
    }
    function custoDaVenda(venda) {
        return (venda.itens || []).reduce((s, it) => {
            if (!it.produtoId) return s;
            return s + custoUnitarioDoItem(it) * (it.quantidade || 0);
        }, 0);
    }

    // Vendas FECHADAS cujo fechamento caiu entre dois instantes (inclusivo).
    function vendasFechadasEntre(inicio, fim) {
        return (vendasCache || []).filter(v =>
            v.status === 'fechada' && (v.fechadaEm || 0) >= inicio && (v.fechadaEm || 0) <= fim
        );
    }

    // Totais de um conjunto de vendas fechadas — a ÚNICA conta de lucro do
    // app (Relatórios e Financeiro usam esta). Lucro das vendas = receita
    // líquida (já sem taxa de maquininha/forma) − custo dos produtos
    // VENDIDOS; despesa operacional é descontada depois, no Financeiro.
    // itensSemCusto: UNIDADES de produto vendidas sem custo conhecido — sem
    // preço de compra gravado na venda nem no cadastro, ou marcadas
    // custoIndefinido (sem custo NA ÉPOCA da venda, mesmo que o cadastro
    // tenha custo hoje) — o lucro delas sai maior que o real.
    function resumirVendas(vendas) {
        const bruto = vendas.reduce((s, v) => s + (v.valorTotal || 0), 0);
        const liquido = vendas.reduce((s, v) => s + (v.valorLiquidoTotal ?? v.valorTotal ?? 0), 0);
        const custo = vendas.reduce((s, v) => s + custoDaVenda(v), 0);
        let itensSemCusto = 0;
        vendas.forEach(v => (v.itens || []).forEach(it => {
            if (it.produtoId && custoUnitarioDoItem(it) <= 0) itensSemCusto += (it.quantidade || 1);
        }));
        return { vendas: vendas.length, bruto, liquido, taxas: Math.max(0, bruto - liquido), custo, lucro: liquido - custo, itensSemCusto };
    }

    // Garante vendas e custos carregados. Reaproveita a leitura das vendas de
    // até 30s atrás (navegar entre períodos não precisa reler tudo);
    // atualizar:true força reler. Rejeita se a leitura falhar.
    function garantirVendasECustos(atualizar) {
        const velha = !vendasCache || Date.now() - vendasCarregadasEm > 30000;
        if (atualizar || velha) {
            if (!lendoVendas) lendoVendas = lerVendas().finally(() => { lendoVendas = null; });
        }
        return Promise.all([lendoVendas || Promise.resolve(), carregarCustosDosProdutos()]);
    }

    // Lucro das vendas fechadas entre dois instantes (inclusivo), por data de
    // fechamento. Usado pelo Financeiro.
    window._lucroDasVendas = function (inicio, fim, opcoes) {
        return garantirVendasECustos(opcoes && opcoes.atualizar)
            .then(() => resumirVendas(vendasFechadasEntre(inicio, fim)));
    };

    // Nome da forma de pagamento como aparece agrupada no Resumo do Financeiro.
    // Dinheiro/Pix têm nome fixo (dado antigo pode vir sem formaLabel); cartão
    // agrupa por maquininha ("Cartão · PagBank"); forma cadastrada pela loja usa o nome dela.
    function rotuloDaFormaDeEntrada(p) {
        if (p.forma === 'dinheiro') return 'Dinheiro';
        if (p.forma === 'pix') return 'Pix';
        if (p.forma === 'cartao') {
            const maquina = String(p.formaLabel || '').split(' · ')[0].trim() || p.maquina || '';
            return maquina ? `Cartão · ${maquina}` : 'Cartão';
        }
        return p.formaLabel || p.forma || 'Outra forma';
    }

    // Entradas de dinheiro entre dois instantes (inclusivo) por forma de
    // pagamento — regime de CAIXA, com a MESMA regra que a Cloud Function
    // financeiroSyncVenda usa pra criar as receitas do Financeiro: pagamento
    // avulso conta quando foi lançado (p.criadoEm; se for antigo e não tiver,
    // a data da venda) e cada parcela de promissória conta quando foi PAGA
    // (it.pagaEm). Venda cancelada não conta. Valores líquidos (já sem taxa).
    function resumirEntradas(inicio, fim) {
        const grupos = {};
        const somar = (rotulo, bruto, liquido) => {
            const g = grupos[rotulo] || (grupos[rotulo] = { rotulo, qtd: 0, bruto: 0, liquido: 0 });
            g.qtd += 1; g.bruto += bruto; g.liquido += liquido;
        };
        const comoLista = x => (Array.isArray(x) ? x : Object.values(x || {}));
        (vendasCache || []).forEach(v => {
            if (!v || v.status === 'cancelada') return;
            comoLista(v.pagamentos).forEach(p => {
                if (!p) return;
                if (p.forma === 'parcelado' && p.itens) {
                    // Parcelado renomeado (ex: "Promissória") aparece com o nome gravado no pagamento.
                    const rotuloParcelas = (p.formaLabel && p.formaLabel !== 'Parcelado') ? `${p.formaLabel} — parcelas recebidas` : 'Parcelas recebidas';
                    comoLista(p.itens).forEach(it => {
                        if (!it || !it.paga) return;
                        const ts = it.pagaEm || v.criadoEm || 0;
                        if (ts >= inicio && ts <= fim) somar(rotuloParcelas, it.valor || 0, it.valor || 0);
                    });
                } else {
                    const ts = p.criadoEm || v.criadoEm || 0;
                    if (ts >= inicio && ts <= fim) somar(rotuloDaFormaDeEntrada(p), p.valor || 0, p.valorLiquido ?? p.valor ?? 0);
                }
            });
        });
        const lista = Object.values(grupos).sort((a, b) => b.liquido - a.liquido);
        return {
            grupos: lista,
            bruto: lista.reduce((s, g) => s + g.bruto, 0),
            liquido: lista.reduce((s, g) => s + g.liquido, 0),
            qtd: lista.reduce((s, g) => s + g.qtd, 0)
        };
    }
    window._entradasPorForma = function (inicio, fim, opcoes) {
        return garantirVendasECustos(opcoes && opcoes.atualizar)
            .then(() => resumirEntradas(inicio, fim));
    };

    // Agrupa lucro por dia dentro do período, pro gráfico de barrinhas do hero
    function lucroPorDia(vendas, limites) {
        const porDia = {};
        vendas.forEach(v => {
            const chave = dataLocalISO(new Date(v.fechadaEm || v.criadoEm || 0));
            const liquido = v.valorLiquidoTotal ?? v.valorTotal ?? 0;
            const lucro = liquido - custoDaVenda(v);
            porDia[chave] = (porDia[chave] || 0) + lucro;
        });
        const dias = [];
        const cursor = new Date(limites.inicio);
        const fimData = new Date(limites.fim);
        while (cursor <= fimData && dias.length < 31) {
            dias.push(dataLocalISO(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        const valores = dias.map(d => porDia[d] || 0);
        const max = Math.max(1, ...valores.map(v => Math.abs(v)));
        return valores.map(v => Math.max(4, Math.round((Math.abs(v) / max) * 100))); // % de altura, mínimo 4% pra aparecer a barrinha
    }

    // Conta parcelas pagas/total — usado no ranking, fora do escopo da timeline
    // (função já existente mais abaixo, ver contagemProdutos)

    // ── Timeline de entradas de dinheiro ────────────────────────────
    // Cada evento é uma entrada individual: um pagamento lançado (Débito,
    // Pix, Parcelado etc — valor LÍQUIDO) ou uma parcela marcada como paga.
    // Só entram eventos com timestamp próprio (criadoEm/pagaEm/revogadaEm)
    // — pagamentos antigos, lançados antes desse controle existir, não
    // aparecem aqui (não tem como saber a hora exata que entraram).
    // Eventos de vendas CANCELADAS ou parcelas REVOGADAS entram riscados.
    function montarTimelineEventos(limites) {
        const eventos = [];
        (vendasCache || []).forEach(v => {
            const cancelada = v.status === 'cancelada';
            (v.pagamentos || []).forEach((p, pIdx) => {
                // Evento 1: o pagamento em si (Débito, Pix, Crédito...).
                // Parcelado NÃO entra aqui — nesse momento é só a
                // promissória sendo registrada, nenhum dinheiro trocou
                // de mão ainda (ver comentário grande em venda/fechar.js
                // sobre "Data do pagamento" nesse caso ser a data do
                // ACORDO, não de recebimento). Contar aqui E de novo em
                // "Evento 2" (cada parcela paga) duplicava o valor na
                // timeline — uma venda de R$2.049 em 5x aparecia como
                // R$2.049 recebido na hora do fechamento MAIS R$2.049
                // espalhado nas 5 parcelas conforme iam sendo pagas:
                // R$4.098 visível na tela, o dobro do que entrou de
                // verdade. Os totais do relatório (totalBruto/totalLiquido,
                // mais abaixo) nunca dependeram dessa lista — somam pela
                // venda em si — então só a timeline mostrava errado.
                if (p.forma !== 'parcelado' && p.criadoEm && p.criadoEm >= limites.inicio && p.criadoEm <= limites.fim) {
                    eventos.push({
                        ts: p.criadoEm,
                        tipo: 'pagamento',
                        cancelado: cancelada,
                        clienteNome: v.clienteNome,
                        produtoResumo: nomeProdutosDaVenda(v),
                        forma: p.forma,
                        valor: p.valorLiquido ?? p.valor,
                        parcelas: p.parcelas
                    });
                }
                // Evento 2: cada parcela dentro de um Parcelado — paga ou revogada
                if (Array.isArray(p.itens)) {
                    p.itens.forEach(it => {
                        if (it.pagaEm && it.pagaEm >= limites.inicio && it.pagaEm <= limites.fim) {
                            eventos.push({
                                ts: it.pagaEm,
                                tipo: 'parcela',
                                cancelado: cancelada || (!it.paga && !!it.revogadaEm && it.revogadaEm > it.pagaEm),
                                clienteNome: v.clienteNome,
                                produtoResumo: nomeProdutosDaVenda(v),
                                numero: it.numero,
                                totalParcelas: p.parcelas,
                                valor: it.valor
                            });
                        }
                        if (it.revogadaEm && !it.paga && it.revogadaEm >= limites.inicio && it.revogadaEm <= limites.fim) {
                            eventos.push({
                                ts: it.revogadaEm,
                                tipo: 'revogacao',
                                cancelado: true, // revogação sempre aparece riscada — é uma reversão
                                clienteNome: v.clienteNome,
                                produtoResumo: nomeProdutosDaVenda(v),
                                numero: it.numero,
                                totalParcelas: p.parcelas,
                                valor: it.valor
                            });
                        }
                    });
                }
            });
        });
        return eventos.sort((a, b) => b.ts - a.ts);
    }

    function nomeProdutosDaVenda(v) {
        return (v.itens || []).map(it => it.produtoNome).join(' + ') || 'Venda';
    }

    const FORMAS_LABEL_TIMELINE = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', parcelado: 'Parcelado' };
    const ICONE_FORMA_TIMELINE = { dinheiro: 'bi-cash-coin', pix: 'bi-qr-code', debito: 'bi-credit-card', credito: 'bi-credit-card-2-front', parcelado: 'bi-calendar3-range' };

    let timelineLimite = 20; // "ver mais" incrementa isso

    function renderTimelineEvento(ev) {
        const dataStr = new Date(ev.ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        const horaStr = new Date(ev.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const riscado = ev.cancelado;

        let icone, titulo, subtitulo;
        if (ev.tipo === 'pagamento') {
            icone = ICONE_FORMA_TIMELINE[ev.forma] || 'bi-cash-stack';
            titulo = `${FORMAS_LABEL_TIMELINE[ev.forma] || ev.forma}${ev.parcelas > 1 ? ` ${ev.parcelas}x` : ''}`;
            subtitulo = `${esc(ev.clienteNome)} · ${esc(ev.produtoResumo)}`;
        } else if (ev.tipo === 'parcela') {
            icone = 'bi-check-circle-fill';
            titulo = `Parcela ${ev.numero}/${ev.totalParcelas} paga`;
            subtitulo = `${esc(ev.clienteNome)} · ${esc(ev.produtoResumo)}`;
        } else { // revogacao
            icone = 'bi-arrow-counterclockwise';
            titulo = `Parcela ${ev.numero}/${ev.totalParcelas} revogada`;
            subtitulo = `${esc(ev.clienteNome)} · ${esc(ev.produtoResumo)}`;
        }

        return `
            <div class="pulse-tl-row${riscado ? ' cancelado' : ''}">
                <div class="pulse-tl-ic"><i class="bi ${icone}"></i></div>
                <div class="pulse-tl-mid">
                    <div class="pulse-tl-titulo">${titulo}</div>
                    <div class="pulse-tl-sub">${subtitulo}</div>
                </div>
                <div class="pulse-tl-right">
                    <div class="pulse-tl-valor">${ev.tipo === 'revogacao' ? '−' : ''}${fmt(ev.valor)}</div>
                    <div class="pulse-tl-data">${dataStr} · ${horaStr}</div>
                </div>
            </div>`;
    }

    function renderTimeline(limites) {
        const wrap = el('relTimelineWrap');
        if (!wrap) return;
        const todos = montarTimelineEventos(limites);
        if (!todos.length) {
            wrap.innerHTML = `<div class="stq-hist-sub text-center" style="padding:14px 0;">Nenhuma entrada com horário registrado nesse período.</div>`;
            return;
        }
        const visiveis = todos.slice(0, timelineLimite);
        const restantes = todos.length - visiveis.length;
        wrap.innerHTML = visiveis.map(renderTimelineEvento).join('')
            + (restantes > 0 ? `<button type="button" class="venda-ver-mais-btn" id="relTimelineVerMaisBtn">Ver mais (${restantes} restante${restantes > 1 ? 's' : ''})</button>` : '');
        el('relTimelineVerMaisBtn')?.addEventListener('click', () => {
            timelineLimite += 20;
            renderTimeline(limites);
        });
    }

    function calcularERenderizar() {
        const conteudoEl = el('relConteudo');
        if (!conteudoEl || !vendasCache || !produtosCustoCache) return;

        const limites = limitesDoPeriodo();
        if (!limites) { conteudoEl.innerHTML = `<div class="stq-hist-sub text-center">Escolha as duas datas.</div>`; return; }

        const vendasFechadas = vendasFechadasEntre(limites.inicio, limites.fim);

        // Timeline é independente do resumo de lucro — mostra mesmo se não
        // houver venda FECHADA no período (ex: uma parcela paga agora, de
        // venda fechada em outro dia, ainda é uma entrada de dinheiro hoje).
        const timelineHtml = `
            <label class="form-label mt-2">Linha do tempo de entradas</label>
            <div id="relTimelineWrap"></div>
        `;

        if (!vendasFechadas.length) {
            conteudoEl.innerHTML = `<div class="stq-hist-empty"><i class="bi bi-bar-chart"></i><br/>Nenhuma venda fechada nesse período.</div>` + timelineHtml;
            timelineLimite = 20;
            renderTimeline(limites);
            return;
        }

        const resumoVendas = resumirVendas(vendasFechadas);
        const { bruto: totalBruto, liquido: totalLiquido, custo: custoTotal, taxas: taxaMaquina } = resumoVendas;
        // Lucro Real NUNCA muda com o toggle — é sempre o que a loja
        // realmente ganhou (líquido) menos o custo. O toggle só decide
        // qual número vira a referência de "Bruto" na tela: pra loja
        // que embute a taxa no preço (ou já recebe líquido direto da
        // maquininha), o líquido JÁ É o bruto de verdade dela — taxa
        // nunca foi lucro a mais pra tirar da conta depois. Errado
        // seria manter o bruto cheio e só sumir com a linha da taxa —
        // isso inventaria lucro que não existe (bug corrigido depois
        // do Brendon flagrar a conta errada).
        const totalBrutoExibido = ocultarTaxa ? totalLiquido : totalBruto;
        const lucroReal = resumoVendas.lucro;
        const margem = totalBrutoExibido > 0 ? (lucroReal / totalBrutoExibido) * 100 : 0;
        const ticketMedio = totalBrutoExibido / vendasFechadas.length;

        const barras = lucroPorDia(vendasFechadas, limites);

        const contagemProdutos = {};
        vendasFechadas.forEach(v => {
            (v.itens || []).forEach(it => {
                const nome = it.produtoNome || 'Sem nome';
                contagemProdutos[nome] = (contagemProdutos[nome] || 0) + (it.quantidade || 1);
            });
        });
        const rankingProdutos = Object.entries(contagemProdutos).sort((a, b) => b[1] - a[1]).slice(0, 5);

        // Larguras da cascata proporcionais ao bruto EXIBIDO (mínimo 4% pra aparecer)
        const pct = v => Math.max(4, Math.min(100, Math.round((Math.abs(v) / Math.max(1, totalBrutoExibido)) * 100)));

        conteudoEl.innerHTML = `
            <div class="stq-hist-sub text-center mb-2">${vendasFechadas.length} venda(s) fechada(s) no período</div>

            <div class="pulse-hero" style="margin-bottom:12px;">
                <div class="pulse-hero-top">
                    <div class="pulse-hero-label">Lucro Real</div>
                    <div class="pulse-hero-margem">margem ${margem.toFixed(0)}%</div>
                </div>
                <div class="pulse-hero-value">${fmt(lucroReal)}</div>
                <div class="pulse-hero-sub">de ${fmt(totalBrutoExibido)} em vendas brutas · ${vendasFechadas.length} venda(s)</div>
                <div class="pulse-hero-bars">
                    ${barras.map(h => `<span style="height:${h}%;"></span>`).join('')}
                </div>
            </div>

            <div class="pulse-waterfall">
                <div class="pulse-waterfall-title">De onde veio esse número</div>
                <div class="pulse-wf-row">
                    <div class="pulse-wf-label">Bruto</div>
                    <div class="pulse-wf-bar-wrap"><div class="pulse-wf-bar" style="width:100%;background:#c7bfff;"></div></div>
                    <div class="pulse-wf-value">${fmt(totalBrutoExibido)}</div>
                </div>
                ${!ocultarTaxa ? `
                <div class="pulse-wf-row">
                    <div class="pulse-wf-label">− Taxas</div>
                    <div class="pulse-wf-bar-wrap"><div class="pulse-wf-bar" style="width:${pct(taxaMaquina)}%;background:#fca5a5;"></div></div>
                    <div class="pulse-wf-value">− ${fmt(taxaMaquina)}</div>
                </div>` : ''}
                <div class="pulse-wf-row">
                    <div class="pulse-wf-label">− Custo prod.</div>
                    <div class="pulse-wf-bar-wrap"><div class="pulse-wf-bar" style="width:${pct(custoTotal)}%;background:#fdba74;"></div></div>
                    <div class="pulse-wf-value">− ${fmt(custoTotal)}</div>
                </div>
                <div class="pulse-wf-row">
                    <div class="pulse-wf-label"><b>= Lucro Real</b></div>
                    <div class="pulse-wf-bar-wrap"><div class="pulse-wf-bar" style="width:${pct(lucroReal)}%;background:linear-gradient(90deg,#5b3df5,#4f8cff);"></div></div>
                    <div class="pulse-wf-value" style="color:#22c55e;">${fmt(lucroReal)}</div>
                </div>
            </div>

            <div class="pulse-kpi-grid">
                <div class="pulse-kpi-card"><div class="pulse-kpi-l">Total Bruto</div><div class="pulse-kpi-v">${fmt(totalBrutoExibido)}</div></div>
                ${!ocultarTaxa ? `<div class="pulse-kpi-card"><div class="pulse-kpi-l">Líquido (após taxa)</div><div class="pulse-kpi-v">${fmt(totalLiquido)}</div></div>` : ''}
                <div class="pulse-kpi-card"><div class="pulse-kpi-l">Custo dos produtos</div><div class="pulse-kpi-v red">${fmt(custoTotal)}</div></div>
                <div class="pulse-kpi-card"><div class="pulse-kpi-l">Ticket médio</div><div class="pulse-kpi-v">${fmt(ticketMedio)}</div></div>
            </div>

            <label class="form-label mt-1">Produtos mais vendidos</label>
            ${rankingProdutos.map(([nome, qtd], i) => `
                <div class="venda-cart-item">
                    <div class="venda-cart-item-nome">${i + 1}º · ${esc(nome)}</div>
                    <span style="color:var(--primary);font-weight:700;font-size:.8rem;">${qtd} un.</span>
                </div>`).join('')}

            ${timelineHtml}
        `;
        timelineLimite = 20;
        renderTimeline(limites);
    }

    window._renderRelatoriosVendas = function () {
        ensureSkeleton();
        periodo = 'hoje';
        dataDe = '';
        dataAte = '';
        el('relPeriodoPills').querySelectorAll('.stq-cat-pill').forEach(p => p.classList.remove('active'));
        el('relPeriodoPills').querySelector('[data-v="hoje"]').classList.add('active');
        el('relCustomRow').style.display = 'none';
        el('relDataDe').value = '';
        el('relDataAte').value = '';
        Promise.all([carregarVendas(), carregarCustosDosProdutos()]).then(calcularERenderizar);
    };
})();