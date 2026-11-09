// ================================================================
// venda/relatorios.js — VortexSmart · Venda · Relatórios
// Filtra vendas FECHADAS por período (hoje/semana/mês/personalizado)
// e mostra: Lucro Real (bruto − taxa da maquininha − custo dos
// produtos) com o gráfico de lucro por dia, KPIs, o anel "pra onde foi
// cada real vendido", produtos mais vendidos e as entradas de dinheiro
// agrupadas por dia. A marcação é a mesma no celular e no PC (classes
// rel-*); cada style.*.css dá a aparência com a paleta do próprio shell.
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
//   _percorrerEntradas(vendas, inicio, fim, aoEntrar) — a regra de caixa pura (sem
//     cache nem leitura), usada também pela Início do celular (inicio-mobile.js).
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
                <div class="rel">
                    <div class="rel-topo">
                        <div class="rel-seg" id="relPeriodoPills" role="tablist">
                            <button type="button" data-v="hoje">Hoje</button>
                            <button type="button" data-v="semana">Semana</button>
                            <button type="button" data-v="mes">Mês</button>
                            <button type="button" data-v="custom">Outro</button>
                        </div>
                        <div class="rel-custom" id="relCustomRow">
                            <label>De<input class="form-control" id="relDataDe" type="date"/></label>
                            <label>Até<input class="form-control" id="relDataAte" type="date"/></label>
                        </div>
                        <div class="rel-opt">
                            <div>Ocultar taxas<small>Pra loja que já embute a taxa no preço: mostra o valor bruto direto, sem descontar nada. Não muda o valor final de nenhuma venda, só a forma de exibir aqui.</small></div>
                            <button type="button" class="ctx-switch" id="relOcultarTaxaSwitch" aria-label="Ocultar taxas"></button>
                        </div>
                    </div>
                    <div id="relConteudo"></div>
                </div>
            </div>
        `;
        el('relPeriodoPills').querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                periodo = btn.dataset.v;
                el('relPeriodoPills').querySelectorAll('button').forEach(p => p.classList.toggle('on', p === btn));
                el('relCustomRow').classList.toggle('on', periodo === 'custom');
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
    // Percorre as entradas de caixa de uma lista de vendas no período e chama
    // aoEntrar(pagamento, bruto, liquido) pra cada uma. Parcela paga de promissória
    // chega com o pagamento "pai" (forma 'parcelado'). É a única definição de
    // "o que entrou" do app: o Resumo do Financeiro e a Início do celular usam esta.
    const comoLista = x => (Array.isArray(x) ? x : Object.values(x || {}));
    function percorrerEntradas(vendas, inicio, fim, aoEntrar) {
        (vendas || []).forEach(v => {
            if (!v || v.status === 'cancelada') return;
            comoLista(v.pagamentos).forEach(p => {
                if (!p) return;
                if (p.forma === 'parcelado' && p.itens) {
                    comoLista(p.itens).forEach(it => {
                        if (!it || !it.paga) return;
                        const ts = it.pagaEm || v.criadoEm || 0;
                        if (ts >= inicio && ts <= fim) aoEntrar(p, it.valor || 0, it.valor || 0);
                    });
                } else {
                    const ts = p.criadoEm || v.criadoEm || 0;
                    if (ts >= inicio && ts <= fim) aoEntrar(p, p.valor || 0, p.valorLiquido ?? p.valor ?? 0);
                }
            });
        });
    }
    window._percorrerEntradas = percorrerEntradas;

    function resumirEntradas(inicio, fim) {
        const grupos = {};
        percorrerEntradas(vendasCache, inicio, fim, (p, bruto, liquido) => {
            // Parcelado renomeado (ex: "Promissória") aparece com o nome gravado no pagamento.
            const rotulo = (p.forma === 'parcelado' && p.itens)
                ? ((p.formaLabel && p.formaLabel !== 'Parcelado') ? `${p.formaLabel} — parcelas recebidas` : 'Parcelas recebidas')
                : rotuloDaFormaDeEntrada(p);
            const g = grupos[rotulo] || (grupos[rotulo] = { rotulo, qtd: 0, bruto: 0, liquido: 0 });
            g.qtd += 1; g.bruto += bruto; g.liquido += liquido;
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

    // Barras do gráfico do topo: lucro (líquido − custo, a mesma conta do Lucro
    // Real) por DIA dentro do período; num período de um dia só, por HORA em que
    // a venda foi fechada (só as horas com venda). Devolve [{ l: rótulo, v: lucro }].
    function barrasDoPeriodo(vendas, limites) {
        const lucroDe = v => (v.valorLiquidoTotal ?? v.valorTotal ?? 0) - custoDaVenda(v);
        const mesmoDia = dataLocalISO(new Date(limites.inicio)) === dataLocalISO(new Date(limites.fim));
        if (mesmoDia) {
            const porHora = {};
            vendas.forEach(v => {
                const h = new Date(v.fechadaEm || v.criadoEm || 0).getHours();
                porHora[h] = (porHora[h] || 0) + lucroDe(v);
            });
            return Object.keys(porHora).map(Number).sort((a, b) => a - b).map(h => ({ l: `${h}h`, v: porHora[h] }));
        }
        const dias = Math.round((limites.fim - limites.inicio) / 86400000) + 1;
        const porMes = dias > 31; // período longo: uma barra por mês (31 barras já é o que cabe)
        const chaveDe = d => porMes ? dataLocalISO(d).slice(0, 7) : dataLocalISO(d);
        const soma = {};
        vendas.forEach(v => {
            const chave = chaveDe(new Date(v.fechadaEm || v.criadoEm || 0));
            soma[chave] = (soma[chave] || 0) + lucroDe(v);
        });
        const barras = [];
        const cursor = new Date(limites.inicio);
        if (porMes) cursor.setDate(1);
        const fimData = new Date(limites.fim);
        while (cursor <= fimData && barras.length < 36) {
            const chave = chaveDe(cursor);
            barras.push({
                l: porMes ? `${String(cursor.getMonth() + 1).padStart(2, '0')}/${String(cursor.getFullYear()).slice(2)}` : String(cursor.getDate()).padStart(2, '0'),
                v: soma[chave] || 0
            });
            if (porMes) cursor.setMonth(cursor.getMonth() + 1); else cursor.setDate(cursor.getDate() + 1);
        }
        return barras;
    }

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
    const SEMANA_CURTA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    let timelineLimite = 20; // "ver mais" incrementa isso

    // R$ sem centavos (anel, KPIs, total do dia). Negativo vira "− R$ 5".
    const fmt0 = v => `${v < 0 ? '− ' : ''}R$ ${Math.round(Math.abs(v)).toLocaleString('pt-BR')}`;

    function renderTimelineEvento(ev) {
        const horaStr = new Date(ev.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        let icone, titulo;
        if (ev.tipo === 'pagamento') {
            icone = ICONE_FORMA_TIMELINE[ev.forma] || 'bi-cash-stack';
            titulo = `${FORMAS_LABEL_TIMELINE[ev.forma] || ev.forma}${ev.parcelas > 1 ? ` ${ev.parcelas}x` : ''}`;
        } else if (ev.tipo === 'parcela') {
            icone = 'bi-check-circle-fill';
            titulo = `Parcela ${ev.numero}/${ev.totalParcelas} paga`;
        } else { // revogacao
            icone = 'bi-arrow-counterclockwise';
            titulo = `Parcela ${ev.numero}/${ev.totalParcelas} revogada`;
        }
        return `
            <div class="rel-ev${ev.cancelado ? ' canc' : ''}">
                <span class="rel-ev-ic"><i class="bi ${icone}"></i></span>
                <div class="rel-ev-m">
                    <b>${titulo}</b>
                    <small>${esc(ev.clienteNome)} · ${esc(ev.produtoResumo)}</small>
                </div>
                <div class="rel-ev-r">
                    <b>${ev.tipo === 'revogacao' ? '−' : ''}${fmt(ev.valor)}</b>
                    <small>${horaStr}</small>
                </div>
            </div>`;
    }

    // "Hoje · 08/11", "Ontem · 07/11" ou "Qui · 05/11".
    function rotuloDoDia(ts) {
        const d = new Date(ts);
        const hoje = new Date();
        const chave = dataLocalISO(d);
        const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
        const nome = chave === dataLocalISO(hoje) ? 'Hoje' : chave === dataLocalISO(ontem) ? 'Ontem' : SEMANA_CURTA[d.getDay()];
        return `${nome} · ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    // Entradas agrupadas por dia (mais novo primeiro). O total do dia soma só o
    // que está de pé: evento cancelado/revogado aparece riscado e não conta.
    function renderTimeline(limites) {
        const wrap = el('relTimelineWrap');
        if (!wrap) return;
        const todos = montarTimelineEventos(limites);
        if (!todos.length) {
            wrap.innerHTML = `<div class="rel-vazio">Nenhuma entrada com horário registrado nesse período.</div>`;
            return;
        }
        const totalDoDia = {};
        todos.forEach(ev => {
            if (ev.cancelado || ev.tipo === 'revogacao') return;
            const k = dataLocalISO(new Date(ev.ts));
            totalDoDia[k] = (totalDoDia[k] || 0) + (ev.valor || 0);
        });
        const visiveis = todos.slice(0, timelineLimite);
        const restantes = todos.length - visiveis.length;
        let html = '', diaAtual = '';
        visiveis.forEach(ev => {
            const k = dataLocalISO(new Date(ev.ts));
            if (k !== diaAtual) {
                diaAtual = k;
                html += `<div class="rel-dia"><span>${rotuloDoDia(ev.ts)}</span><b>${fmt0(totalDoDia[k] || 0)}</b></div>`;
            }
            html += renderTimelineEvento(ev);
        });
        const lista = wrap.querySelector('.rel-ent-lista');
        const rolagem = lista ? lista.scrollTop : 0; // "Ver mais" não pode jogar a lista de volta pro topo
        wrap.innerHTML = `<div class="rel-ent-lista">${html}</div>`
            + (restantes > 0 ? `<button type="button" class="rel-mais" id="relTimelineVerMaisBtn">Ver mais (${restantes})</button>` : '');
        const novaLista = wrap.querySelector('.rel-ent-lista');
        if (novaLista && rolagem) novaLista.scrollTop = rolagem;
        el('relTimelineVerMaisBtn')?.addEventListener('click', () => {
            timelineLimite += 20;
            renderTimeline(limites);
        });
    }

    // Anel "pra onde foi cada real vendido": lucro / custo / taxas sobre o valor
    // exibido como vendido. Lucro negativo (vendeu abaixo do custo) não vira arco —
    // fica só na legenda, em vermelho.
    function anelHtml(base, lucro, custo, taxas) {
        const partes = [['var(--success)', lucro], ['var(--warning)', custo], ['var(--danger)', taxas]].filter(p => p[1] > 0);
        const soma = partes.reduce((s, p) => s + p[1], 0) || 1;
        const C = 2 * Math.PI * 52;
        let desloc = 0;
        const arcos = partes.map(([cor, v]) => {
            const len = v / soma * C;
            const e = `<circle cx="70" cy="70" r="52" fill="none" stroke="${cor}" stroke-width="16" stroke-dasharray="${Math.max(0, len - (partes.length > 1 ? 2 : 0))} ${C}" stroke-dashoffset="${-desloc}" transform="rotate(-90 70 70)"/>`;
            desloc += len;
            return e;
        }).join('');
        return `<svg class="rel-anel" viewBox="0 0 140 140" role="img" aria-label="Divisão do valor vendido"><circle cx="70" cy="70" r="52" fill="none" stroke="var(--surface-raised)" stroke-width="16"/>${arcos}<text x="70" y="65" text-anchor="middle" class="k">VENDIDO</text><text x="70" y="84" text-anchor="middle" class="v">${fmt0(base)}</text></svg>`;
    }

    function calcularERenderizar() {
        const conteudoEl = el('relConteudo');
        if (!conteudoEl || !vendasCache || !produtosCustoCache) return;

        const limites = limitesDoPeriodo();
        if (!limites) { conteudoEl.innerHTML = `<div class="rel-vazio">Escolha as duas datas.</div>`; return; }
        if (limites.inicio > limites.fim) { conteudoEl.innerHTML = `<div class="rel-vazio">A data final é antes da inicial.</div>`; return; }

        const vendasFechadas = vendasFechadasEntre(limites.inicio, limites.fim);

        // As entradas são independentes do resumo de lucro — aparecem mesmo
        // sem venda FECHADA no período (uma parcela paga hoje, de venda
        // fechada em outro dia, ainda é dinheiro que entrou hoje).
        const entradasHtml = `
            <section class="rel-card rel-ent">
                <h3>Entradas de dinheiro</h3>
                <div class="rel-sub">Cada pagamento recebido, do mais novo pro mais antigo</div>
                <div id="relTimelineWrap"></div>
            </section>`;

        timelineLimite = 20;
        if (!vendasFechadas.length) {
            conteudoEl.innerHTML = `<div class="rel-grade"><div class="rel-card rel-vazio rel-vazio-card"><i class="bi bi-bar-chart"></i><br/>Nenhuma venda fechada nesse período.</div>${entradasHtml}</div>`;
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
        const taxasExibidas = ocultarTaxa ? 0 : taxaMaquina;
        const pctDe = v => Math.round(v / Math.max(1, totalBrutoExibido) * 100);
        const nomePeriodo = { hoje: 'hoje', semana: 'esta semana', mes: 'este mês', custom: 'o período' }[periodo];

        const barras = barrasDoPeriodo(vendasFechadas, limites);
        const maxBarra = Math.max(1, ...barras.map(b => b.v));
        const passoRotulo = Math.ceil(barras.length / 12); // com muitas barras, o rótulo aparece de tantas em tantas
        const barrasHtml = barras.map((b, i) => {
            const alt = Math.max(4, Math.round(Math.max(0, b.v) / maxBarra * 78));
            const cls = b.v < 0 ? ' neg' : (b.v === maxBarra && b.v > 0 ? ' max' : '');
            return `<div><i class="${cls.trim()}" style="height:${alt}%" title="${esc(b.l)}: ${fmt(b.v)}"></i><span>${i % passoRotulo === 0 ? esc(b.l) : ''}</span></div>`;
        }).join('');

        const contagemProdutos = {};
        vendasFechadas.forEach(v => {
            (v.itens || []).forEach(it => {
                const nome = it.produtoNome || 'Sem nome';
                contagemProdutos[nome] = (contagemProdutos[nome] || 0) + (it.quantidade || 1);
            });
        });
        const rankingProdutos = Object.entries(contagemProdutos).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const maiorQtd = rankingProdutos.length ? rankingProdutos[0][1] : 1;

        const kpi = (rotulo, valor, extra) => `<div class="rel-kpi${extra ? ' ' + extra : ''}"><small>${rotulo}</small><b>${valor}</b></div>`;

        conteudoEl.innerHTML = `
            <div class="rel-grade">
                <section class="rel-card rel-hero">
                    <div class="rel-hero-topo"><span class="rel-lbl">Lucro real · ${{ hoje: 'hoje', semana: 'semana', mes: 'mês', custom: 'período' }[periodo]}</span><span class="rel-chip${lucroReal < 0 ? ' neg' : ''}">margem ${margem.toFixed(0)}%</span></div>
                    <div class="rel-grande${lucroReal < 0 ? ' neg' : ''}">${fmt(lucroReal)}</div>
                    <div class="rel-sub">de ${fmt(totalBrutoExibido)} vendidos · ${vendasFechadas.length} venda${vendasFechadas.length > 1 ? 's' : ''}</div>
                    ${resumoVendas.itensSemCusto > 0 ? `<div class="rel-aviso"><i class="bi bi-exclamation-triangle-fill"></i> ${resumoVendas.itensSemCusto} item(ns) sem preço de compra: o lucro pode estar maior que o real.</div>` : ''}
                    <div class="rel-barras">${barrasHtml}</div>
                </section>

                <div class="rel-kpis">
                    ${kpi('Vendas', vendasFechadas.length)}
                    ${kpi('Ticket médio', fmt0(ticketMedio))}
                    ${ocultarTaxa ? '' : kpi('Líquido', fmt0(totalLiquido))}
                    ${kpi(ocultarTaxa ? 'Total vendido' : 'Bruto', fmt0(totalBrutoExibido), 'so-pc')}
                </div>

                <section class="rel-card rel-anel-card">
                    <h3>Para onde foi cada real vendido</h3>
                    <div class="rel-sub">Do total vendido ${nomePeriodo}</div>
                    <div class="rel-anel-linha">
                        ${anelHtml(totalBrutoExibido, lucroReal, custoTotal, taxasExibidas)}
                        <div class="rel-leg">
                            <div><i style="background:${lucroReal < 0 ? 'var(--danger)' : 'var(--success)'}"></i>Lucro real<small>${pctDe(lucroReal)}%</small><b>${fmt0(lucroReal)}</b></div>
                            <div><i style="background:var(--warning)"></i>Custo<small>${pctDe(custoTotal)}%</small><b>${fmt0(custoTotal)}</b></div>
                            ${ocultarTaxa ? '' : `<div><i style="background:var(--danger)"></i>Taxas<small>${pctDe(taxaMaquina)}%</small><b>${fmt0(taxaMaquina)}</b></div>`}
                        </div>
                    </div>
                </section>

                <section class="rel-card rel-rank">
                    <h3>Produtos mais vendidos</h3>
                    <div class="rel-rk">
                        ${rankingProdutos.map(([nome, qtd], i) => `
                            <span class="n">${i + 1}</span><span class="nm">${esc(nome)}</span><span class="q">${qtd} un.</span>
                            <div class="tr"><i style="width:${Math.max(4, Math.round(qtd / maiorQtd * 100))}%"></i></div>`).join('')}
                    </div>
                </section>

                ${entradasHtml}
            </div>
        `;
        renderTimeline(limites);
    }

    window._renderRelatoriosVendas = function () {
        ensureSkeleton();
        periodo = 'hoje';
        dataDe = '';
        dataAte = '';
        el('relPeriodoPills').querySelectorAll('button').forEach(p => p.classList.toggle('on', p.dataset.v === 'hoje'));
        el('relCustomRow').classList.remove('on');
        el('relDataDe').value = '';
        el('relDataAte').value = '';
        el('relConteudo').innerHTML = `<div class="rel-vazio">Carregando…</div>`;
        Promise.all([carregarVendas(), carregarCustosDosProdutos()]).then(calcularERenderizar);
    };
})();
