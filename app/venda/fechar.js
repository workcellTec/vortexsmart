// ================================================================
// venda/fechar.js — VortexSmart · Venda · Fechar Venda (Etapa 2)
// Recebe uma venda PENDENTE (window._vendaContexto.vendaId), mostra
// cliente + itens + Total/Em Aberto, e permite registrar pagamentos —
// inclusive FRACIONADOS (ex: R$100 no Pix + R$100 no Cartão).
//
// Redesenho (aprovado em mockup v4, ago/2026):
//   - Cada "Salvar pagamento" grava NO FIREBASE NA HORA (window._dbUpdate).
//     Antes só ficava em memória até clicar em "Fechar Venda" — se o
//     app fechasse antes disso, a baixa se perdia. Não perde mais.
//   - A venda fecha SOZINHA quando a soma dos pagamentos bate o total
//     (por matemática, sem clique manual). Não bateu, fica pendente —
//     sem etapa de confirmação, sem botão "Fechar mesmo assim".
//   - Forma de pagamento não é mais grid de cards grandes (não escala
//     com muitas formas customizadas) — é um campo que abre modal em
//     lista. Cartão abre sub-fluxo dentro do mesmo modal: Máquina →
//     Débito/Crédito → Bandeira (só se a taxa realmente variar entre
//     bandeiras nessa máquina) → Parcelas (só no Crédito).
//   - Seletor Parcial/Total: Parcial é o padrão (digita o valor);
//     Total auto-preenche com o que falta e trava o campo.
//   - Data/hora do pagamento são editáveis (pré-preenchidas com agora)
//     — vira o p.criadoEm salvo, que é o mesmo campo que
//     venda/relatorios.js usa pra jogar o pagamento na linha do tempo
//     de entradas. Editar a data serve pra lançar um recebimento
//     retroativo (ex: esqueceu de registrar o dinheiro de ontem).
//     Parcelado é EXCEÇÃO: não pergunta essa data — usa a data da
//     própria venda direto (nesse momento nenhum dinheiro entrou ainda,
//     é só a promissória sendo registrada; quem representa dinheiro de
//     verdade é cada parcela sendo paga depois, não isso aqui).
//   - Excluir um pagamento já registrado é ação exclusiva do Gestor
//     (window._papelAtual() === 'gestor') — Funcionário não vê o botão.
//
// A baixa de estoque JÁ aconteceu no lançamento (Etapa 1, venda/lancar.js)
// — aqui só registra a forma de pagamento e, quando a soma bate,
// muda o status pra 'fechada'.
//
// Quando a forma é Cartão, calcula o valor LÍQUIDO daquela linha
// usando a MESMA tabela de taxas que a Calculadora usa (window._getRate)
// — sem duplicar tabela nenhuma. O valor bruto continua sendo o que
// soma no total da venda; o líquido é só o "quanto realmente entra"
// depois da taxa. Dinheiro/Pix (e formas customizadas sem maquininha)
// podem ter uma taxa % opcional cadastrada em Configurações → Taxas
// (window._formasPagamentoConfig[forma].taxa) — ver taxaDaForma().
//
// Depois de fechada, a geração da Garantia (Bookip) é feita por um
// botão separado no Histórico (venda/historico.js) — aqui não pergunta
// nada sobre garantia.
//
// Depende de (via window.*):
//   showCustomModal, _fmt, _lojaRef, _dbGet, _dbUpdate, _papelAtual,
//   _vendaContexto (venda/router.js), _getRate, _areRatesLoaded,
//   _showSuccessOverlay, _setBtnLoading, _formasPagamentoConfig (core.js)
// Expõe via window.*:
//   _renderFecharVenda
//   _vendaReduzirPagamentosParaNovoTotal — usado por venda/lancar.js
//     quando uma edição de venda fechada reduz o total e precisa
//     abater o excedente do pagamento já lançado (ver reconciliarEdicaoDeFechada).
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc   = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt   = v => typeof window._fmt === 'function' ? window._fmt(v) : `R$ ${Number(v || 0).toFixed(2)}`;
    const el    = id => document.getElementById(id);
    const ehGestor = () => (typeof window._papelAtual === 'function' ? window._papelAtual() : 'funcionario') === 'gestor';
    const podeEditarFechada = () => typeof window._temPermissao === 'function' ? window._temPermissao('vendas_editar_fechada') : ehGestor();

    // Dinheiro/Pix têm toggle de ocultar em Configurações → Taxas — igual
    // já funcionava antes. "Cartão" agora é uma entrada VIRTUAL única
    // (só aparece se existir ao menos 1 máquina visível) que abre o
    // sub-fluxo; débito/crédito deixaram de ser cards soltos no topo.
    const FORMAS_BASE = [
        { v: 'dinheiro', l: 'Dinheiro' },
        { v: 'pix',      l: 'Pix' }
    ];
    function getFormasDisponiveis() {
        const cfg = window._formasPagamentoConfig || {};
        const bases = FORMAS_BASE.filter(f => !cfg[f.v]?.oculta);
        const customIds = Object.keys(cfg).filter(id => cfg[id]?.custom && !FORMAS_BASE.find(f => f.v === id) && !cfg[id]?.oculta);
        const customs = customIds.map(id => ({ v: id, l: cfg[id].nome || id }));
        const lista = [...bases, ...customs];
        if (getMaquinas().length > 0) lista.splice(bases.length, 0, { v: 'cartao', l: 'Cartão' });
        // Parcelado é uma forma configurável como as outras (Configurações → Taxas & Máquinas): pode ser
        // desativada e renomeada (ex: "Promissória", "Venda a prazo"). Sem configuração: aparece como "Parcelado".
        const cfgParcelado = cfg.parcelado || {};
        if (!cfgParcelado.oculta) lista.push({ v: 'parcelado', l: String(cfgParcelado.nome || '').trim() || 'Parcelado' });
        return lista;
    }
    // Taxa % opcional que uma forma sem maquininha desconta do que a loja
    // recebe (Configurações → Taxas & Máquinas → ✏️ na forma: Dinheiro, Pix
    // ou as cadastradas). Cartão e Parcelado têm cálculo próprio. 0 = sem taxa.
    function taxaDaForma(v) {
        if (v === 'cartao' || v === 'parcelado') return 0;
        const t = Number((window._formasPagamentoConfig || {})[v]?.taxa);
        return Number.isFinite(t) && t > 0 && t <= 100 ? t : 0;
    }
    // Lista de máquinas: vem de Configurações → Taxas (Firebase). Esse
    // array só serve de fallback caso ainda não tenha carregado nada.
    const MAQUINAS_FALLBACK = [
        { v: 'pagbank',   l: 'PagBank',     maxParcelas: 18 },
        { v: 'infinity',  l: 'InfinityPay', maxParcelas: 12 },
        { v: 'valorante', l: 'Valorante',   maxParcelas: 21 },
        { v: 'nubank',    l: 'Nubank Link', maxParcelas: 12 },
    ];
    function getMaquinas() {
        const dinamicas = typeof window._getMaquininhasVisiveis === 'function' ? window._getMaquininhasVisiveis() : [];
        if (dinamicas.length) return dinamicas;
        // Só cai no fallback fixo enquanto os dados REALMENTE ainda não
        // chegaram do Firebase — se já carregou e a loja genuinamente
        // não tem nenhuma máquina (ex: excluiu todas), retorna vazio de
        // verdade em vez de mostrar 4 máquinas fantasma que não existem.
        // (Isso também já esconde o card "Cartão" sozinho —
        // getFormasDisponiveis só inclui Cartão quando getMaquinas().length > 0.)
        return window._areRatesLoaded ? [] : MAQUINAS_FALLBACK;
    }
    // Bandeiras agora vêm de window._getBandeirasDaMaquina(maquina) —
    // cada maquininha tem a sua própria lista (Configurações → Taxas),
    // não mais uma lista fixa igual pra todas.
    function bandeirasDaMaquina(maquina) {
        return typeof window._getBandeirasDaMaquina === 'function' ? window._getBandeirasDaMaquina(maquina) : [];
    }
    // Bandeira que vale de verdade pro cálculo/gravação: a escolhida no
    // wizard, ou — se a etapa "Bandeira" foi pulada por não variar
    // taxa — a primeira bandeira da maquininha (nunca mais um "visa"
    // chumbado, que quebraria numa maquininha com bandeira de nome
    // customizado que nem se chama Visa).
    function bandeiraEfetiva() {
        return wiz.bandeira || bandeirasDaMaquina(wiz.maquina)[0]?.id || '';
    }
    const TOLERANCIA = 0.01; // arredondamento de centavos

    // ── Reduz os pagamentos já registrados de uma venda FECHADA quando
    //    ela é editada e o novo total é MENOR que o antigo (excedente) —
    //    ex: removeu um item. Precisa "devolver" esse excedente de algum
    //    pagamento, e a ordem de prioridade é:
    //
    //   FASE 1 — parcelas de Parcelado que ainda NÃO foram pagas, de
    //   trás pra frente (reduz/cancela a última parcela primeiro, depois
    //   a penúltima, etc). Dinheiro que ainda não entrou — a escolha
    //   mais segura, não desfaz nada que já foi recebido de verdade.
    //
    //   FASE 2/3 — se isso não bastar (ou não existir), reduz os
    //   pagamentos avulsos (Dinheiro/Pix/Cartão — já recebidos de
    //   verdade) proporcionalmente ao peso de cada um, preservando a
    //   taxa efetiva de cada um (líquido/bruto).
    //
    //   FASE 4 — se mesmo reduzindo TODO avulso a zero ainda sobrar
    //   excedente, a única coisa que resta é parcela JÁ PAGA — e essa
    //   não mexemos sozinhos. Bloqueia com mensagem clara, sem gravar
    //   nada (retorna { bloqueado: true, mensagem }).
    //
    // Retorna { pagamentos: novoArray } se coube reduzir tudo, ou
    // { bloqueado: true, mensagem } se não coube (nada é alterado nesse
    // caso — quem chamar decide o que fazer, ex: não gravar a venda).
    // Não muta o array recebido; sempre devolve um novo.
    function reduzirPagamentosParaNovoTotal(pagamentosAtuais, excedente) {
        if (excedente <= TOLERANCIA) return { pagamentos: pagamentosAtuais, bloqueado: false };

        // Trabalha em CENTAVOS inteiros o tempo todo (M1 da auditoria —
        // float puro em reduções sucessivas acumula erro de arredonda-
        // mento). Só volta pra reais no final, ao montar o resultado.
        const paraCentavos = v => Math.round((v || 0) * 100);
        let excedenteCent = paraCentavos(excedente);

        // Clona profundo só o necessário (pagamentos + seus itens) —
        // nunca muta o que veio de fora.
        const pagamentos = pagamentosAtuais.map(p => ({
            ...p,
            itens: Array.isArray(p.itens) ? p.itens.map(it => ({ ...it })) : p.itens,
        }));

        // ── FASE 1 — parcelas não pagas, de trás pra frente ──────────
        for (const p of pagamentos) {
            if (excedenteCent <= 0) break;
            if (p.forma !== 'parcelado' || !Array.isArray(p.itens)) continue;
            for (let i = p.itens.length - 1; i >= 0 && excedenteCent > 0; i--) {
                const item = p.itens[i];
                if (item.paga) continue; // dinheiro já recebido — nunca mexe aqui
                const valorItemCent = paraCentavos(item.valor);
                const absorvido = Math.min(excedenteCent, valorItemCent);
                const novoValorCent = valorItemCent - absorvido;
                excedenteCent -= absorvido;
                if (novoValorCent <= 0) {
                    p.itens.splice(i, 1); // parcela zerada — some da lista
                } else {
                    item.valor = novoValorCent / 100;
                }
            }
        }
        // Pagamento parcelado que TINHA itens e ficou sem nenhuma parcela
        // (todas absorvidas na Fase 1) — remove o pagamento inteiro. Um
        // parcelado LEGADO sem array 'itens' nunca passa pelo loop da
        // Fase 1 acima (pulado por "!Array.isArray(p.itens)") — então
        // continua com seu 'valor' original intacto, e NÃO pode ser
        // descartado aqui: ele é dinheiro/dívida real que simplesmente
        // não dá pra reduzir automaticamente nesse formato antigo.
        // (Confundir "sem itens porque é legado" com "sem itens porque
        // zerou" apagava promissórias antigas inteiras — bug encontrado
        // em revisão: R$100 de parcelado legado + R$50 de pix com
        // excedente de R$10 virava só R$40, sumindo com os R$100.)
        let pagamentosPosFase1 = pagamentos
            .filter(p => p.forma !== 'parcelado' || !Array.isArray(p.itens) || p.itens.length > 0)
            .map(p => {
                if (p.forma !== 'parcelado' || !Array.isArray(p.itens)) return p;
                const novoValor = p.itens.reduce((s, it) => s + it.valor, 0);
                // valorLiquido realinhado com valor — promissória não tem
                // taxa (sempre foram iguais desde a criação do pagamento),
                // então mantê-lo desatualizado exibiria "líq. R$X antigo"
                // ao lado de um bruto já reduzido em fechar.js.
                return { ...p, parcelas: p.itens.length, valor: centavos2(novoValor), valorLiquido: centavos2(novoValor) };
            });

        if (excedenteCent <= 0) {
            return { pagamentos: pagamentosPosFase1, bloqueado: false };
        }

        // ── FASE 2/3 — pagamentos avulsos (dinheiro já recebido de
        //    verdade), reduzidos proporcionalmente ao peso de cada um.
        const avulsos = pagamentosPosFase1.filter(p => p.forma !== 'parcelado');
        const somaAvulsosCent = avulsos.reduce((s, p) => s + paraCentavos(p.valor), 0);

        if (avulsos.length === 0 || somaAvulsosCent < excedenteCent) {
            // FASE 4 — não há avulso suficiente (ou nenhum) pra cobrir
            // o resto. Reduzir mais exigiria mexer em parcela já paga —
            // bloqueia sem gravar nada.
            return {
                pagamentos: pagamentosAtuais,
                bloqueado: true,
                mensagem: 'Não dá pra reduzir esse valor: o excedente é maior do que a dívida futura (parcelas não pagas) somada ao que ainda pode ser devolvido. Isso exigiria desfazer um pagamento já recebido (parcela paga) ou mexer numa promissória antiga sem parcelas detalhadas, sem devolução registrada. Ajuste manualmente.',
            };
        }

        // Distribui o excedenteCent entre os avulsos proporcionalmente
        // ao valor de cada um (peso = valor do pagamento / soma dos
        // avulsos). Arredonda cada um pra baixo e joga o resto de
        // centavos (erro de arredondamento) no ÚLTIMO avulso da lista —
        // garante que a soma final bate exata com o excedente pedido.
        let somaReduzidaCent = 0;
        const resultadoAvulsos = avulsos.map((p, idx) => {
            const valorCent = paraCentavos(p.valor);
            const ehUltimo = idx === avulsos.length - 1;
            const reducaoCent = ehUltimo
                ? (excedenteCent - somaReduzidaCent)
                : Math.round((valorCent / somaAvulsosCent) * excedenteCent);
            somaReduzidaCent += reducaoCent;
            const novoValorCent = valorCent - reducaoCent;
            const novoValor = novoValorCent / 100;

            // Recalcula o líquido a partir do NOVO bruto usando a taxa
            // efetiva já registrada nesse pagamento (líquido/bruto
            // originais) — nunca subtrai a redução direto do líquido,
            // isso duplicaria/erraria o efeito da taxa.
            const taxaEfetiva = valorCent > 0 ? (1 - (p.valorLiquido ?? p.valor) / p.valor) : 0;
            const novoLiquido = centavos2(novoValor * (1 - taxaEfetiva));

            return { ...p, valor: novoValor, valorLiquido: novoLiquido };
        });

        let iAvulso = 0;
        const pagamentosFinais = pagamentosPosFase1
            .map(p => (p.forma === 'parcelado') ? p : resultadoAvulsos[iAvulso++])
            // Pagamento avulso reduzido a ZERO (a promissória/outros
            // avulsos já cobriram tudo, e esse sobrou como resto de
            // arredondamento) some da lista — igual já acontece com
            // parcelado zerado logo acima. Sem isso ficava uma linha
            // "R$ 0,00" pendurada pra sempre na tela de Fechar Venda.
            .filter(p => p.forma === 'parcelado' || p.valor > 0);

        return { pagamentos: pagamentosFinais, bloqueado: false };
    }
    window._vendaReduzirPagamentosParaNovoTotal = reduzirPagamentosParaNovoTotal;

    const ICONE_FORMA = {
        dinheiro:  'bi-cash-coin',
        pix:       'bi-qr-code',
        cartao:    'bi-credit-card-2-front',
        parcelado: 'bi-calendar3-range',
    };

    // Detecta se a taxa de uma máquina/parcela varia entre bandeiras —
    // se não varia (caso mais comum, "Personalizar por bandeira" desligado
    // em Configurações → Taxas), a etapa "Bandeira" do wizard é pulada.
    function taxaVariaPorBandeira(maquina, inst) {
        const bandeiras = bandeirasDaMaquina(maquina);
        if (bandeiras.length <= 1) return false; // 0 ou 1 bandeira: nada pra comparar, etapa nunca aparece
        const valores = bandeiras
            .map(b => (typeof window._getRate === 'function' ? window._getRate(maquina, b.id, inst) : undefined))
            .filter(v => v !== undefined);
        return new Set(valores).size > 1;
    }

    let mounted = false;
    let vendaAtual = null;      // { id, clienteNome, itens, valorTotal, status }
    let pagamentos = [];        // [{ forma, valor, valorLiquido, criadoEm, ... }]

    // ── Estado do formulário "Novo pagamento" ───────────────────────
    let tipoPagamento = 'parcial';   // 'parcial' | 'total' — padrão é Parcial
    let valorParcialStr = '';        // sobrevive a troca de forma/wizard/re-render
    let formaSelecionada = null;
    let formaLabel = null;
    let wiz = { maquina: null, tipo: null, bandeira: null, parcelas: 1 };
    let parceladoQtd = 1;
    let parceladoDataInicial = dataAgora();
    let parceladoPeriodicidade = 'mensal'; // 'semanal' | 'quinzenal' | 'mensal' | 'customizado'
    let parceladoIntervaloDias = 20;
    let dataPagamento = '';
    let horaPagamento = '';

    function pad2(n) { return String(n).padStart(2, '0'); }
    // yyyy-mm-dd no fuso do computador. toISOString() é UTC: depois das 21h no Brasil já dá "amanhã".
    function dataLocal(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
    function dataAgora() { return dataLocal(new Date()); }
    const centavos2 = n => Math.round((Number(n) || 0) * 100) / 100;   // 97.03000000000001 → 97.03
    function horaAgora() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
    // Label "DD/MM às HH:MM" da data em que a VENDA foi lançada — usado
    // só pra Parcelado, que não pergunta "Data do pagamento" de novo
    // (não faz sentido: nada foi recebido ainda nesse momento, é só a
    // promissória sendo registrada — ver salvarPagamento mais abaixo).
    function dataVendaLabel() {
        if (!vendaAtual?.criadoEm) return '—';
        const d = new Date(vendaAtual.criadoEm);
        return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} às ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }

    const PERIODO_OPCOES = [
        { v: 'semanal',     l: 'Semanal' },
        { v: 'quinzenal',   l: 'Quinzenal' },
        { v: 'mensal',      l: 'Mensal' },
        { v: 'customizado', l: 'Customizado' },
    ];

    // Calcula o vencimento da parcela de índice `i` (0-based) a partir da
    // data da 1ª parcela, respeitando a periodicidade escolhida:
    //   semanal    → +7 dias por parcela
    //   quinzenal  → +15 dias por parcela
    //   mensal     → mesmo DIA do mês seguinte — "efeito sanfona": cada
    //                parcela recalcula a partir da data-BASE original
    //                (nunca herda o achatamento de uma parcela anterior),
    //                e se o dia-base não existir no mês de destino (ex:
    //                dia 31 num mês com 30 ou menos dias), cai no ÚLTIMO
    //                dia válido DAQUELE mês. Ex.: base 31/jan → parcelas
    //                em 31/01, 28/02, 31/03, 30/04, 31/05, 30/06 — nunca
    //                pula um mês inteiro (que era o bug: setMonth() puro
    //                transborda 31/jan+1mês pra 03/mar, pulando fevereiro).
    //   customizado→ +intervaloDias por parcela (o usuário define)
    function calcularVencimentoParcela(dataBase, i, periodicidade, intervaloDias) {
        const d = new Date(dataBase);
        if (periodicidade === 'semanal') { d.setDate(d.getDate() + 7 * i); return d; }
        if (periodicidade === 'quinzenal') { d.setDate(d.getDate() + 15 * i); return d; }
        if (periodicidade === 'customizado') { d.setDate(d.getDate() + (intervaloDias || 1) * i); return d; }
        // mensal — sempre a partir do dia-base original, nunca de 'd' já
        // deslocado por uma iteração anterior (é isso que garante o
        // "efeito sanfona": 31→28→31→30→31, e não 31→28→28→28...).
        const diaBase = d.getDate();
        const mesDestino = d.getMonth() + i;
        const ultimoDiaDoMesDestino = new Date(d.getFullYear(), mesDestino + 1, 0).getDate();
        d.setFullYear(d.getFullYear(), mesDestino, Math.min(diaBase, ultimoDiaDoMesDestino));
        return d;
    }

    // Prévia (só visual, não grava nada) dos próximos vencimentos —
    // mostra até 6 parcelas, o resto some num "+ N parcela(s)...".
    function renderPreviaParcelas() {
        const wrap = el('fvPeriodoPrevia');
        if (!wrap) return;
        if (!parceladoDataInicial || !parceladoQtd) { wrap.innerHTML = ''; return; }
        const dataBase = new Date(parceladoDataInicial + 'T00:00:00');
        const max = Math.min(parceladoQtd, 6);
        let html = `<div class="fv-periodo-previa-titulo"><i class="bi bi-calendar-check"></i> Prévia dos vencimentos</div>`;
        for (let i = 0; i < max; i++) {
            const venc = calcularVencimentoParcela(dataBase, i, parceladoPeriodicidade, parceladoIntervaloDias);
            html += `<div class="fv-periodo-previa-item"><span>Parcela <b>${i + 1}/${parceladoQtd}</b></span><span class="venc">${venc.toLocaleDateString('pt-BR')}</span></div>`;
        }
        if (parceladoQtd > max) html += `<div class="fv-periodo-previa-mais">+ ${parceladoQtd - max} parcela(s)...</div>`;
        wrap.innerHTML = html;
    }

    function resetFormulario() {
        tipoPagamento = 'parcial';
        valorParcialStr = '';
        formaSelecionada = null;
        formaLabel = null;
        wiz = { maquina: null, tipo: null, bandeira: null, parcelas: 1 };
        parceladoQtd = 1;
        parceladoDataInicial = dataAgora();
        parceladoPeriodicidade = 'mensal';
        parceladoIntervaloDias = 20;
        dataPagamento = dataAgora();
        horaPagamento = horaAgora();
    }

    function ensureSkeleton() {
        const container = el('vendaFechar');
        if (!container || mounted) return;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="section-header">
                <h3>Fechar Venda</h3>
                <button class="btn-header-action" id="fvEditarVendaBtn" title="Editar venda"><i class="bi bi-pencil-fill"></i></button>
            </div>
            <div class="content-card w-100" id="fvConteudo"></div>
        `;
        el('fvEditarVendaBtn')?.addEventListener('click', () => {
            if (!vendaAtual) return;
            if (typeof window.openVendaSection === 'function') window.openVendaSection('lancarVenda', { vendaId: vendaAtual.id });
        });
        mounted = true;
    }

    let resumoAberto = false; // some/aparece os itens — cliente sempre visível

    function totalPago() { return pagamentos.reduce((s, p) => s + p.valor, 0); }
    function restante() { return Math.max(0, (vendaAtual?.valorTotal || 0) - totalPago()); }
    // Quanto foi pago A MAIS do que o valor atual da venda — só existe
    // depois de uma edição que baixou o total pra menos do que já
    // tinha sido recebido (ver aviso em renderConteudo). Em operação
    // normal isso é sempre 0.
    function excedente() { return Math.max(0, totalPago() - (vendaAtual?.valorTotal || 0)); }

    function renderConteudo() {
        const box = el('fvConteudo');
        if (!box) return;

        if (!vendaAtual) {
            box.innerHTML = `<div class="stq-hist-empty">Venda não encontrada.</div>`;
            return;
        }
        if (vendaAtual.status === 'cancelada') {
            box.innerHTML = `
                <div class="stq-hist-empty">
                    <i class="bi bi-lock-fill"></i><br/>
                    Essa venda foi <b>cancelada</b> e não pode ser reaberta aqui.
                </div>`;
            return;
        }
        const editandoFechada = vendaAtual.status === 'fechada';
        if (editandoFechada && !podeEditarFechada()) {
            box.innerHTML = `
                <div class="stq-hist-empty">
                    <i class="bi bi-lock-fill"></i><br/>
                    Essa venda já está <b>fechada</b> e não pode ser reaberta aqui.
                </div>`;
            return;
        }

        const restanteAtual = restante();
        const excedenteAtual = excedente();
        const quitado = restanteAtual <= TOLERANCIA;
        const gestor = ehGestor();

        box.innerHTML = `
            ${editandoFechada ? `
                <div class="fv-editando-fechada-banner">
                    <i class="bi bi-exclamation-triangle-fill"></i>
                    Editando uma venda já fechada. Se o valor deixar de bater, ela volta a ficar pendente sozinha — sem perder o histórico do que já foi pago.
                </div>
            ` : ''}
            ${excedenteAtual > TOLERANCIA ? `
                <div class="fv-excedente-banner">
                    <i class="bi bi-exclamation-octagon-fill"></i>
                    <span>Essa venda foi paga <b>a mais</b> — sobram <b>${fmt(excedenteAtual)}</b> depois da edição do valor. Exclua o pagamento antigo na lista abaixo e lance de novo com o valor certo (ou o troco/estorno que combinar com o cliente) pra essa venda conseguir fechar.</span>
                </div>
            ` : ''}
            <div class="fv-resumo-head" id="fvResumoToggle">
                <div>
                    <div class="fv-resumo-lbl">Cliente</div>
                    <div class="fv-resumo-cliente">${esc(vendaAtual.clienteNome)}</div>
                </div>
                <div class="fv-resumo-toggle ${resumoAberto ? 'open' : ''}" id="fvResumoToggleLabel">
                    ${resumoAberto ? 'Ocultar itens' : 'Ver itens'} <i class="bi bi-chevron-down"></i>
                </div>
            </div>
            <div class="fv-resumo-itens ${resumoAberto ? 'open' : ''}" id="fvResumoItens">
                ${vendaAtual.itens.map(it => `
                    <div class="fv-item-row">
                        <span>${esc(it.produtoNome)} × ${it.quantidade}</span>
                        <span>${fmt(it.valorTotal ?? (it.quantidade * it.valorUnitario))}</span>
                    </div>`).join('')}
            </div>

            <div class="fv-stats-row">
                <div class="fv-stat-cell">
                    <div class="fv-stat-lbl">Valor Total</div>
                    <div class="fv-stat-val">${fmt(vendaAtual.valorTotal)}</div>
                </div>
                ${excedenteAtual > TOLERANCIA ? `
                <div class="fv-stat-cell aberto" style="background:rgba(248,113,113,.12);">
                    <div class="fv-stat-lbl">Pago a mais</div>
                    <div class="fv-stat-val" style="color:#f87171;">${fmt(excedenteAtual)}</div>
                </div>
                ` : `
                <div class="fv-stat-cell aberto ${quitado ? 'quitado' : ''}">
                    <div class="fv-stat-lbl">Em Aberto</div>
                    <div class="fv-stat-val">${fmt(restanteAtual)}</div>
                </div>
                `}
            </div>

            <div class="fv-divider"></div>

            ${excedenteAtual > TOLERANCIA ? '' : `
            <div class="fv-card-title">Novo pagamento</div>

            <div class="fv-tipo-toggle">
                <div class="fv-tipo-btn ${tipoPagamento === 'parcial' ? 'active' : ''}" data-tipo="parcial">
                    <i class="bi bi-circle-half"></i>
                    <span class="lbl">Parcial</span>
                    <span class="sub">Só uma parte agora</span>
                </div>
                <div class="fv-tipo-btn ${tipoPagamento === 'total' ? 'active' : ''}" data-tipo="total">
                    <i class="bi bi-circle-fill"></i>
                    <span class="lbl">Total</span>
                    <span class="sub">Quita tudo agora</span>
                </div>
            </div>

            <label class="form-label">Valor recebido</label>
            <div class="fv-valor-wrap">
                <span>R$</span>
                <input class="fv-valor-input" id="fvValorInput" type="text" inputmode="decimal" placeholder="0,00" ${tipoPagamento === 'total' ? 'disabled' : ''}/>
            </div>
            ${tipoPagamento === 'parcial' ? `<div class="stq-hist-sub" style="margin:-4px 0 10px;">Máximo: ${fmt(restanteAtual)} (o que ainda falta pagar)</div>` : ''}
            <div id="fvPreviaLiquido"></div>

            <label class="form-label">Forma de pagamento</label>
            <button type="button" class="fv-forma-select-btn ${!formaSelecionada ? 'placeholder' : ''}" id="fvAbrirFormaModal">
                <span class="fv-forma-select-icon">${formaSelecionada ? `<i class="bi ${ICONE_FORMA[formaSelecionada] || 'bi-cash-stack'}"></i> ${esc(formaLabel || '')}` : 'Selecionar forma de pagamento'}</span>
                <i class="bi bi-chevron-right chev"></i>
            </button>

            ${formaSelecionada === 'parcelado' ? `
                <div class="stq-hist-sub mb-2">Parcelado direto com você (promissória) — sem taxa de máquina. Use quantidade 1 pra "recebe numa data só".</div>
                <div class="venda-qtyval-row">
                    <div>
                        <label class="form-label">Quantidade de parcelas</label>
                        <input class="form-control" id="fvParceladoQtd" type="number" min="1" step="1" value="${parceladoQtd}"/>
                    </div>
                    <div>
                        <label class="form-label">Data da 1ª parcela</label>
                        <input class="form-control" id="fvParceladoData" type="date" value="${parceladoDataInicial}"/>
                    </div>
                </div>

                <label class="form-label" style="margin-top:0;">Repete a cada</label>
                <div class="fv-periodo-chip-row" id="fvPeriodoChips">
                    ${PERIODO_OPCOES.map(p => `<div class="fv-periodo-chip ${parceladoPeriodicidade === p.v ? 'active' : ''}" data-v="${p.v}">${p.l}</div>`).join('')}
                </div>

                ${parceladoPeriodicidade === 'customizado' ? `
                    <label class="form-label">A cada quantos dias</label>
                    <input class="form-control" id="fvParceladoIntervalo" type="number" min="1" step="1" value="${parceladoIntervaloDias}"/>
                ` : ''}

                <div class="fv-periodo-previa" id="fvPeriodoPrevia"></div>
            ` : ''}

            ${formaSelecionada === 'parcelado' ? `
                <div class="stq-hist-sub" style="display:flex;align-items:center;gap:6px;margin:2px 0 14px;">
                    <i class="bi bi-info-circle"></i>
                    <span>Registrado com a data da própria venda (${dataVendaLabel()}).</span>
                </div>
            ` : `
                <div class="venda-qtyval-row">
                    <div>
                        <label class="form-label">Data do pagamento</label>
                        <input class="form-control" id="fvDataPagamento" type="date" value="${dataPagamento}"/>
                    </div>
                    <div>
                        <label class="form-label">Hora do pagamento</label>
                        <input class="form-control" id="fvHoraPagamento" type="time" value="${horaPagamento}"/>
                    </div>
                </div>
            `}

            <button type="button" class="stq-modal-btn-save w-100 mb-3" id="fvSalvarPagamentoBtn" disabled><i class="bi bi-check-circle-fill"></i> Salvar pagamento</button>
            `}

            ${pagamentos.length ? `
            <div class="fv-pagamentos-title">Pagamentos registrados</div>
            ${pagamentos.map((p, i) => `
                <div class="venda-cart-item">
                    <div>
                        <div class="venda-cart-item-nome">${esc(p.formaLabel || p.forma)}</div>
                        <div class="venda-cart-item-sub">${esc(p.dataExibicao || '')}${p.valorLiquido != null && p.valorLiquido !== p.valor ? ` · líq. ${fmt(p.valorLiquido)}` : ''}</div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="color:var(--success);font-weight:700;font-size:.8rem;">${fmt(p.valor)}</span>
                        ${p.forma === 'parcelado' && Array.isArray(p.itens) ? `<button type="button" class="stq-panel-btn hist" data-parcelas-idx="${i}" style="flex-direction:row;padding:6px 10px;border-radius:9px;font-size:.68rem;"><i class="bi bi-list-ol"></i></button>` : ''}
                        ${gestor
                            ? `<button type="button" class="venda-cart-item-remove" data-idx="${i}"><i class="bi bi-trash-fill"></i></button>`
                            : `<span class="fv-lock-badge" title="Só o Gestor pode excluir um pagamento já registrado"><i class="bi bi-lock-fill"></i></span>`}
                    </div>
                </div>`).join('')}
            ` : `<div class="fv-pagamentos-title">Pagamentos registrados</div><div class="fv-vazio">Nenhum pagamento lançado ainda.</div>`}

            <div class="fv-microcopy">
                <i class="bi bi-shield-check"></i>
                <span>Cada pagamento é salvo assim que você clica em "Salvar pagamento" — pode sair da tela quando quiser, nada se perde. A venda fecha sozinha quando o valor em aberto chegar a zero.${!gestor ? ' Excluir um pagamento já registrado é uma ação restrita ao Gestor.' : ''}</span>
            </div>
        `;

        el('fvResumoToggle')?.addEventListener('click', () => {
            resumoAberto = !resumoAberto;
            el('fvResumoItens')?.classList.toggle('open', resumoAberto);
            el('fvResumoToggleLabel')?.classList.toggle('open', resumoAberto);
            if (el('fvResumoToggleLabel')) {
                el('fvResumoToggleLabel').innerHTML = `${resumoAberto ? 'Ocultar itens' : 'Ver itens'} <i class="bi bi-chevron-down"></i>`;
            }
        });

        box.querySelectorAll('.fv-tipo-toggle [data-tipo]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tipo === tipoPagamento) return;
                if (tipoPagamento === 'parcial') valorParcialStr = el('fvValorInput')?.value || valorParcialStr;
                tipoPagamento = btn.dataset.tipo;
                renderConteudo();
            });
        });

        el('fvValorInput')?.addEventListener('input', onValorInput);
        el('fvAbrirFormaModal')?.addEventListener('click', abrirModalForma);
        el('fvParceladoQtd')?.addEventListener('input', () => { parceladoQtd = parseInt(el('fvParceladoQtd').value, 10) || 1; renderPreviaParcelas(); });
        el('fvParceladoData')?.addEventListener('input', () => { parceladoDataInicial = el('fvParceladoData').value; renderPreviaParcelas(); });
        el('fvParceladoIntervalo')?.addEventListener('input', () => { parceladoIntervaloDias = parseInt(el('fvParceladoIntervalo').value, 10) || 1; renderPreviaParcelas(); });
        el('fvPeriodoChips')?.querySelectorAll('[data-v]').forEach(chip => {
            chip.addEventListener('click', () => {
                if (chip.dataset.v === parceladoPeriodicidade) return;
                parceladoPeriodicidade = chip.dataset.v;
                renderConteudo(); // precisa re-renderizar o form inteiro pro campo "customizado" aparecer/sumir
            });
        });
        el('fvDataPagamento')?.addEventListener('input', () => { dataPagamento = el('fvDataPagamento').value; });
        el('fvHoraPagamento')?.addEventListener('input', () => { horaPagamento = el('fvHoraPagamento').value; });
        el('fvSalvarPagamentoBtn')?.addEventListener('click', salvarPagamento);
        box.querySelectorAll('.venda-cart-item-remove').forEach(btn => {
            btn.addEventListener('click', () => confirmarRemoverPagamento(parseInt(btn.dataset.idx, 10)));
        });
        box.querySelectorAll('[data-parcelas-idx]').forEach(btn => {
            btn.addEventListener('click', () => abrirModalParcelas(parseInt(btn.dataset.parcelasIdx, 10)));
        });

        // Restaura o valor certo no input recém-criado — trocar de forma,
        // abrir/fechar o modal, passar pelo wizard do cartão... nada disso
        // pode apagar o que a pessoa já digitou (bug corrigido no mockup).
        if (el('fvValorInput')) {
            el('fvValorInput').value = tipoPagamento === 'total'
                ? restanteAtual.toFixed(2).replace('.', ',')
                : valorParcialStr;
        }
        atualizarPreviaLiquido();
        renderPreviaParcelas();
        validarBotaoSalvar();
    }

    // ── Valor digitado (máscara de moeda em tempo real, mesma técnica
    //    já usada no card de item do carrinho em lancar.js) ──────────
    function onValorInput() {
        const input = el('fvValorInput');
        const digits = input.value.replace(/\D/g, '');
        if (!digits) { input.value = ''; valorParcialStr = ''; atualizarPreviaLiquido(); validarBotaoSalvar(); return; }
        const valorNum = parseInt(digits, 10) / 100;
        input.value = valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        valorParcialStr = input.value;
        atualizarPreviaLiquido();
        validarBotaoSalvar();
    }
    function valorDigitado() {
        const raw = (el('fvValorInput')?.value || '').replace(/\./g, '').replace(',', '.');
        return parseFloat(raw) || 0;
    }
    function atualizarPreviaLiquido() {
        const previaEl = el('fvPreviaLiquido');
        if (!previaEl) return;
        const valor = valorDigitado();
        if (formaSelecionada === 'cartao' && wiz.maquina && valor > 0 && window._areRatesLoaded) {
            const inst = wiz.tipo === 'debito' ? 0 : wiz.parcelas;
            const taxa = window._getRate ? window._getRate(wiz.maquina, bandeiraEfetiva(), inst) : undefined;
            if (taxa !== undefined) {
                const liquido = valor * (1 - taxa / 100);
                previaEl.innerHTML = `<div class="venda-desconto-final mb-2">Líquido dessa linha (após taxa de ${taxa.toFixed(2)}%): <b>${fmt(liquido)}</b></div>`;
                return;
            }
        }
        const taxaForma = valor > 0 && formaSelecionada ? taxaDaForma(formaSelecionada) : 0;
        if (taxaForma > 0) {
            const liquido = centavos2(valor * (1 - taxaForma / 100));
            previaEl.innerHTML = `<div class="venda-desconto-final mb-2">Líquido dessa linha (após taxa de ${taxaForma.toFixed(2)}%): <b>${fmt(liquido)}</b></div>`;
            return;
        }
        previaEl.innerHTML = '';
    }
    function validarBotaoSalvar() {
        const btn = el('fvSalvarPagamentoBtn');
        if (!btn) return;
        const v = valorDigitado();
        btn.disabled = !(v > 0 && v <= restante() + TOLERANCIA && formaSelecionada);
    }

    // ── Salvar pagamento: valida, monta o objeto, grava no Firebase NA
    //    HORA, e fecha a venda sozinha se a soma bater o total. ──────
    function salvarPagamento() {
        const valor = valorDigitado();
        if (!valor || valor > restante() + TOLERANCIA || !formaSelecionada) return;

        const pagamento = { id: window._dbPush(window._lojaRef(`vendas/${vendaAtual.id}/pagamentos`)).key, forma: formaSelecionada, valor, valorLiquido: valor, formaLabel };

        // Forma com taxa própria (ex: Pix recebido na maquininha): o líquido
        // é gravado AGORA, no pagamento — mudar a taxa depois na configuração
        // não reescreve vendas antigas. Financeiro/relatórios já leem o líquido.
        const taxaForma = taxaDaForma(formaSelecionada);
        if (taxaForma > 0) {
            pagamento.taxa = taxaForma;
            pagamento.valorLiquido = centavos2(valor * (1 - taxaForma / 100));
        }

        if (formaSelecionada === 'cartao') {
            if (!window._areRatesLoaded) { modal({ message: 'As taxas ainda estão carregando, aguarde um instante.' }); return; }
            const inst = wiz.tipo === 'debito' ? 0 : wiz.parcelas;
            const taxa = window._getRate ? window._getRate(wiz.maquina, bandeiraEfetiva(), inst) : undefined;
            if (taxa === undefined) { modal({ message: 'Não tem taxa configurada pra essa combinação de máquina/bandeira/parcelas.' }); return; }
            pagamento.maquina = wiz.maquina;
            pagamento.bandeira = bandeiraEfetiva();
            pagamento.parcelas = wiz.tipo === 'debito' ? 1 : wiz.parcelas;
            pagamento.valorLiquido = centavos2(valor * (1 - taxa / 100));
        }

        if (formaSelecionada === 'parcelado') {
            if (!parceladoQtd || parceladoQtd < 1) { modal({ message: 'Informe a quantidade de parcelas (mínimo 1).' }); return; }
            if (!parceladoDataInicial) { modal({ message: 'Informe a data da 1ª parcela.' }); return; }
            if (parceladoPeriodicidade === 'customizado' && (!parceladoIntervaloDias || parceladoIntervaloDias < 1)) {
                modal({ message: 'Informe a cada quantos dias repete (mínimo 1).' }); return;
            }
            pagamento.parcelas = parceladoQtd;
            pagamento.dataInicial = parceladoDataInicial;
            pagamento.periodicidade = parceladoPeriodicidade;
            if (parceladoPeriodicidade === 'customizado') pagamento.intervaloDias = parceladoIntervaloDias;
            // sem taxa — é acordo direto com o cliente, não passa na maquininha

            // Cada parcela vira um item com identidade própria — é isso
            // que permite marcar UMA parcela como paga sem mexer nas outras.
            // O vencimento respeita a periodicidade escolhida (semanal/
            // quinzenal/mensal/customizado) — ver calcularVencimentoParcela.
            // Em centavos: 100 em 3x = 33,33 + 33,33 + 33,34 (a última absorve a sobra). Dividir sem
            // arredondar gravava 33,33333… em cada parcela e o Financeiro herdava essa dízima.
            const centavosTotal = Math.round(valor * 100);
            const centavosParcela = Math.round(centavosTotal / parceladoQtd);
            const dataBase = new Date(parceladoDataInicial + 'T00:00:00');
            pagamento.itens = Array.from({ length: parceladoQtd }, (_, i) => {
                const venc = calcularVencimentoParcela(dataBase, i, parceladoPeriodicidade, parceladoIntervaloDias);
                return {
                    numero: i + 1,
                    valor: (i === parceladoQtd - 1 ? centavosTotal - centavosParcela * (parceladoQtd - 1) : centavosParcela) / 100,
                    vencimento: dataLocal(venc),
                    paga: false,
                    pagaEm: null
                };
            });
        }

        // Parcelado usa a data da PRÓPRIA venda como criadoEm do
        // pagamento — não pergunta "Data do pagamento" de novo (o campo
        // nem aparece nesse caso, ver template acima). Faz sentido:
        // nesse momento nenhum dinheiro entrou ainda, é só a promissória
        // sendo registrada; quem representa dinheiro de verdade entrando
        // é cada parcela sendo paga depois (item.pagaEm), não isso aqui.
        let criadoEmPagamento, dataExibicaoPagamento;
        if (formaSelecionada === 'parcelado') {
            criadoEmPagamento = vendaAtual.criadoEm || Date.now();
            dataExibicaoPagamento = dataVendaLabel();
        } else {
            const dataStr = el('fvDataPagamento')?.value || dataPagamento;
            const horaStr = el('fvHoraPagamento')?.value || horaPagamento;
            const [ano, mes, dia] = dataStr.split('-');
            criadoEmPagamento = new Date(`${dataStr}T${horaStr || '00:00'}:00`).getTime() || Date.now();
            dataExibicaoPagamento = `${dia}/${mes}/${ano} às ${horaStr}`;

            // Pagamento não pode ser anterior ao lançamento da própria
            // venda — não faz sentido receber antes de vender.
            // TOLERANCIA_MS de 1min absorve só arredondamento de
            // relógio, não deixa passar erro real de data digitada
            // errado. Parcelado não passa por aqui: já usa a data da
            // venda direto, então é sempre igual, nunca "antes".
            const TOLERANCIA_MS = 60000;
            if (vendaAtual.criadoEm && criadoEmPagamento < vendaAtual.criadoEm - TOLERANCIA_MS) {
                const dataVenda = new Date(vendaAtual.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                modal({ message: `Esse pagamento não pode ser antes do lançamento da venda (${dataVenda}). Confere a data e hora.` });
                return;
            }
        }

        pagamento.criadoEm = criadoEmPagamento;
        pagamento.dataExibicao = dataExibicaoPagamento;

        const btn = el('fvSalvarPagamentoBtn');
        window._setBtnLoading(btn, true, 'Salvando...');

        const vendaRef = window._lojaRef(`vendas/${vendaAtual.id}`);

        // O _dbGet abaixo só serve pra dar uma mensagem clara caso a
        // venda tenha sido apagada. Ele NÃO aquece o cache da transaction:
        // no SDK modular do Firebase, get() não mantém o dado em cache
        // (só listener ativo mantém — e vendas/{id} não tem nenhum).
        // Por isso a 1ª execução da função da transaction abaixo pode
        // receber atual=null mesmo com a venda existindo, e ela precisa
        // tratar isso devolvendo null (NUNCA undefined — ver comentário
        // dentro da transaction).
        window._dbGet(vendaRef).then(snapAquecimento => {
            if (!snapAquecimento.exists()) {
                throw new Error('Essa venda não existe mais — pode ter sido cancelada ou apagada. Volte pro Histórico e confira.');
            }

            let vaiFechar = false, jaTinhaFechadaEmResolvido = false, novosPagamentosResolvido = null;
            // CORREÇÃO (concorrência): antes, o array de pagamentos era
            // reconstruído a partir da variável local `pagamentos` (o que a
            // TELA tinha carregado, não necessariamente o que está no
            // Firebase agora) e gravado inteiro via _dbUpdate — "vence quem
            // grava por último". Se dois PCs tivessem essa venda aberta ao
            // mesmo tempo e cada um lançasse um pagamento diferente, o
            // segundo _dbUpdate sobrescrevia o array do primeiro por
            // completo, apagando o pagamento dele sem erro nem aviso.
            // Agora: transaction no nó da venda inteira — a função abaixo
            // roda de novo automaticamente se o Firebase detectar que o
            // dado mudou entre a leitura e a escrita, sempre partindo do
            // array REAL mais recente, nunca do estado antigo da tela.
            return window._dbTransaction(vendaRef, atual => {
                // Cache frio: o SDK chama essa função primeiro com o que
                // tem local (null se ninguém escuta esse nó), mesmo com a
                // venda existindo no servidor. Devolver null faz o SDK
                // comparar com o servidor, ver que está desatualizado e
                // rodar a função DE NOVO com o dado real. Devolver
                // undefined aborta a transaction na hora (committed=false)
                // — era isso que gerava o erro "não foi possível salvar".
                if (atual === null) return null;
                const pagamentosAtuais = atual.pagamentos || [];
                const novosPagamentos = [...pagamentosAtuais, pagamento];
                const totalPagoNovo = novosPagamentos.reduce((s, p) => s + p.valor, 0);
                const fecha = Math.abs(atual.valorTotal - totalPagoNovo) <= TOLERANCIA || totalPagoNovo > atual.valorTotal;
                const jaTinhaFechadaEm = !!atual.fechadaEm;

                const proximo = { ...atual, pagamentos: novosPagamentos };
                if (fecha) {
                    proximo.status = 'fechada';
                    proximo.valorLiquidoTotal = centavos2(novosPagamentos.reduce((s, p) => s + (p.valorLiquido ?? p.valor), 0));
                    if (!jaTinhaFechadaEm) proximo.fechadaEm = Date.now();
                }
                // Guarda o resultado desse cálculo pro .then() de fora usar
                // depois — o Firebase pode chamar essa função várias vezes
                // até conseguir commitar sem conflito, então só o ÚLTIMO
                // valor (o que efetivamente foi gravado) importa.
                vaiFechar = fecha;
                jaTinhaFechadaEmResolvido = jaTinhaFechadaEm;
                novosPagamentosResolvido = novosPagamentos;
                return proximo;
            }).then(result => {
                if (!result.snapshot.exists()) throw new Error('Essa venda não existe mais — pode ter sido cancelada ou apagada. Volte pro Histórico e confira.');
                if (!result.committed) throw new Error('Não foi possível salvar — a venda pode ter sido alterada em outro lugar. Tenta de novo.');
                pagamentos = novosPagamentosResolvido;
                window._setBtnLoading(btn, false);
                resetFormulario();
                if (vaiFechar) {
                    vendaAtual.status = 'fechada';
                    if (result.snapshot.val().fechadaEm) vendaAtual.fechadaEm = result.snapshot.val().fechadaEm;
                    // Financeiro: NÃO precisa de gancho aqui — a Cloud
                    // Function financeiroSyncVenda (Admin SDK, roda no
                    // servidor) já reage sozinha a QUALQUER escrita nessa
                    // venda, registrando cada pagamento/parcela no regime
                    // de caixa certo. Um gancho client-side aqui brigaria
                    // com ela (o modelo antigo de "valor inteiro de uma
                    // vez" que existia nessa linha foi removido de
                    // propósito — ver financeiroSyncVenda em
                    // functions/index.js pro raciocínio completo).
                    const msg = jaTinhaFechadaEmResolvido ? 'Pagamento atualizado!' : 'Venda fechada!';
                    window._showSuccessOverlay(msg).then(() => {
                        // vendaFechar só é alcançada editando uma venda já
                        // existente (sempre partindo do Histórico) — o
                        // Histórico de onde veio já está uma posição
                        // abaixo na pilha, esperando. Por isso VOLTA
                        // (history.back()) em vez de "trocar" pra lá de
                        // novo, que empilhava uma SEGUNDA cópia idêntica
                        // por cima da primeira — apertar voltar uma vez
                        // só trocava uma cópia pela outra, sem sair de
                        // verdade, precisando de um segundo toque.
                        history.back();
                    });
                } else {
                    window._showSuccessOverlay(`Pagamento de ${fmt(valor)} salvo`);
                    renderConteudo();
                }
            })
            .catch(e => {
                window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar pagamento: ${e.message}` });
            });
        });
    }

    // ── Excluir pagamento já registrado — só Gestor, fechada ou
    //    pendente. Já está gravado no Firebase (diferente de antes,
    //    quando só existia em memória até fechar), então excluir aqui
    //    também precisa gravar. Se a venda JÁ ESTAVA fechada e a
    //    exclusão faz o total deixar de bater, ela reabre sozinha como
    //    pendente — sem exigir clique extra nem confirmação a mais
    //    (mesma filosofia "fecha/abre por matemática" do resto da tela).
    function confirmarRemoverPagamento(idx) {
        if (!ehGestor()) return; // trava dupla — o botão nem aparece pro Funcionário
        const p = pagamentos[idx];
        if (!p) return;
        modal({
            message: `Excluir o pagamento de ${fmt(p.valor)} (${p.formaLabel || p.forma})? Essa ação não pode ser desfeita.`,
            confirmText: 'Excluir',
            cancelText: 'Cancelar',
            onConfirm: () => removerPagamento(idx)
        });
    }
    function removerPagamento(idx) {
        // Identifica o pagamento pelo ID único (gerado em salvarPagamento)
        // sempre que existir — pagamentos antigos, gravados antes dessa
        // correção, não têm id, e caem no fallback por posição (mesmo
        // comportamento de antes, só pra esses casos legados).
        const alvoLocal = pagamentos[idx];
        if (!alvoLocal) return;
        const alvoId = alvoLocal.id || null;

        window._dbTransaction(window._lojaRef(`vendas/${vendaAtual.id}`), atual => {
            if (atual === null) return null; // cache frio — null faz o SDK reexecutar com o dado real (undefined abortaria)
            const pagamentosAtuais = atual.pagamentos || [];
            const idxReal = alvoId
                ? pagamentosAtuais.findIndex(p => p.id === alvoId)
                : idx; // fallback: pagamento legado sem id, confia na posição
            if (idxReal < 0 || idxReal >= pagamentosAtuais.length) return undefined; // já não existe mais — outra aba já removeu
            const novosPagamentos = pagamentosAtuais.filter((_, i) => i !== idxReal);
            const totalPagoNovo = novosPagamentos.reduce((s, p) => s + p.valor, 0);
            const aindaCobreTotal = Math.abs(atual.valorTotal - totalPagoNovo) <= TOLERANCIA || totalPagoNovo > atual.valorTotal;
            const eraFechada = atual.status === 'fechada';

            const proximo = { ...atual, pagamentos: novosPagamentos };
            if (eraFechada) {
                if (aindaCobreTotal) {
                    // Continua fechada — só a composição do pagamento mudou,
                    // recalcula o líquido. fechadaEm NÃO muda.
                    proximo.valorLiquidoTotal = centavos2(novosPagamentos.reduce((s, p) => s + (p.valorLiquido ?? p.valor), 0));
                } else {
                    // Não bate mais o total — reabre sozinha como pendente.
                    // De propósito NÃO mexe em fechadaEm aqui: se a pessoa
                    // já vai lançar o pagamento certo em seguida (o caso de
                    // uso mais comum — corrigir um erro), salvarPagamento()
                    // vê que já existe um fechadaEm antigo e reaproveita ele
                    // em vez de gravar a data de hoje. valorLiquidoTotal some
                    // porque não é mais um valor válido enquanto pendente.
                    proximo.status = 'pendente';
                    proximo.valorLiquidoTotal = null;
                }
            }
            return proximo;
        }).then(result => {
                if (!result.committed || !result.snapshot.exists()) {
                    modal({ message: 'Esse pagamento já não existe mais (pode ter sido removido em outra tela).' });
                    renderConteudo();
                    return;
                }
                const vendaAtualizada = result.snapshot.val();
                pagamentos = vendaAtualizada.pagamentos || [];
                const statusMudou = vendaAtual.status !== vendaAtualizada.status;
                const eraFechada = vendaAtual.status === 'fechada';
                vendaAtual.status = vendaAtualizada.status;
                if (eraFechada && statusMudou) {
                    window._showSuccessOverlay('Pagamento removido — venda reaberta como pendente').then(() => renderConteudo());
                } else {
                    renderConteudo();
                }
            })
            .catch(e => modal({ message: `Erro ao excluir pagamento: ${e.message}` }));
    }

    // ── Modal "Forma de pagamento" — lista simples e escalável.
    //    Cartão continua dentro do MESMO modal, só troca o conteúdo
    //    pros passos do wizard (Máquina → Débito/Crédito → Bandeira
    //    [se variar] → Parcelas [se Crédito]). ─────────────────────
    function ensureModalFormaBackdrop() {
        if (el('fvModalFormaBackdrop')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="stq-modal-backdrop" id="fvModalFormaBackdrop">
                <div class="stq-modal-card">
                    <div class="stq-modal-header primary">
                        <div class="stq-modal-header-title" id="fvModalFormaTitulo">Forma de pagamento</div>
                        <button class="stq-modal-close" id="fvModalFormaClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="fv-wiz-steps" id="fvWizardSteps"></div>
                    <div class="fv-wiz-back-row" id="fvWizardBackRow"></div>
                    <div class="stq-modal-body" id="fvModalFormaBody"></div>
                </div>
            </div>`);
        el('fvModalFormaClose').addEventListener('click', fecharModalForma);
        el('fvModalFormaBackdrop').addEventListener('click', e => { if (e.target.id === 'fvModalFormaBackdrop') fecharModalForma(); });
    }
    function fecharModalForma() {
        el('fvModalFormaBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (formaSelecionada === 'cartao' && !wiz.maquina) formaSelecionada = null;
        renderConteudo();
    }
    function abrirModalForma() {
        // Guarda o que já foi digitado ANTES de abrir — abrir/fechar
        // esse modal não pode apagar o valor.
        if (tipoPagamento === 'parcial') valorParcialStr = el('fvValorInput')?.value || valorParcialStr;
        ensureModalFormaBackdrop();
        el('fvModalFormaTitulo').textContent = 'Forma de pagamento';
        el('fvWizardSteps').innerHTML = '';
        el('fvWizardBackRow').innerHTML = '';
        el('fvModalFormaBody').innerHTML = getFormasDisponiveis().map(f => `
            <div class="fv-modal-list-item" data-v="${f.v}">
                <i class="bi ${ICONE_FORMA[f.v] || 'bi-cash-stack'}"></i>
                <span class="lbl">${esc(f.l)}</span>
                <i class="bi bi-chevron-right chev"></i>
            </div>`).join('');
        el('fvModalFormaBody').querySelectorAll('[data-v]').forEach(item => {
            item.addEventListener('click', () => {
                const v = item.dataset.v;
                if (v === 'cartao') {
                    wiz = { maquina: null, tipo: null, bandeira: null, parcelas: 1 };
                    abrirWizardMaquina();
                } else {
                    formaSelecionada = v;
                    formaLabel = getFormasDisponiveis().find(f => f.v === v)?.l || v;
                    el('fvModalFormaBackdrop').classList.remove('show');
                    window._vsDestravarScroll && window._vsDestravarScroll();
                    renderConteudo();
                }
            });
        });
        el('fvModalFormaBackdrop').classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }

    function passosWizard() {
        const passos = ['maquina', 'tipo'];
        if (wiz.maquina && taxaVariaPorBandeira(wiz.maquina, wiz.tipo === 'debito' ? 0 : (wiz.parcelas || 1))) passos.push('bandeira');
        if (wiz.tipo === 'credito') passos.push('parcelas');
        return passos;
    }
    function renderStepsDots(passoAtualIdx) {
        const passos = passosWizard();
        el('fvWizardSteps').innerHTML = passos.map((_, i) => `<div class="fv-wiz-step-dot ${i <= passoAtualIdx ? 'done' : ''}"></div>`).join('');
    }
    function renderBackRow(onBack) {
        el('fvWizardBackRow').innerHTML = onBack ? `<button type="button" class="fv-wiz-back-btn" id="fvWizardBackBtn"><i class="bi bi-arrow-left"></i> Voltar</button>` : '';
        el('fvWizardBackBtn')?.addEventListener('click', onBack);
    }
    function abrirWizardMaquina() {
        el('fvModalFormaTitulo').textContent = 'Qual maquininha?';
        renderStepsDots(0);
        renderBackRow(abrirModalForma);
        el('fvModalFormaBody').innerHTML = getMaquinas().map(m =>
            `<div class="fv-modal-list-item" data-v="${m.v}"><i class="bi bi-credit-card-2-front"></i><span class="lbl">${esc(m.l)}</span><i class="bi bi-chevron-right chev"></i></div>`
        ).join('');
        el('fvModalFormaBody').querySelectorAll('[data-v]').forEach(item => {
            item.addEventListener('click', () => { wiz.maquina = item.dataset.v; abrirWizardTipo(); });
        });
    }
    function abrirWizardTipo() {
        el('fvModalFormaTitulo').textContent = 'Débito ou Crédito?';
        renderStepsDots(1);
        renderBackRow(abrirWizardMaquina);
        el('fvModalFormaBody').innerHTML = `
            <div class="fv-modal-list-item" data-v="debito"><i class="bi bi-credit-card"></i><span class="lbl">Débito</span><i class="bi bi-chevron-right chev"></i></div>
            <div class="fv-modal-list-item" data-v="credito"><i class="bi bi-credit-card-2-front"></i><span class="lbl">Crédito</span><i class="bi bi-chevron-right chev"></i></div>
        `;
        el('fvModalFormaBody').querySelectorAll('[data-v]').forEach(item => {
            item.addEventListener('click', () => {
                wiz.tipo = item.dataset.v;
                if (taxaVariaPorBandeira(wiz.maquina, wiz.tipo === 'debito' ? 0 : 1)) abrirWizardBandeira();
                else if (wiz.tipo === 'credito') abrirWizardParcelas();
                else finalizarWizardCartao();
            });
        });
    }
    function abrirWizardBandeira() {
        el('fvModalFormaTitulo').textContent = 'Qual bandeira?';
        renderStepsDots(2);
        renderBackRow(abrirWizardTipo);
        const bandeiras = bandeirasDaMaquina(wiz.maquina);
        el('fvModalFormaBody').innerHTML = bandeiras.map(b =>
            `<div class="fv-modal-list-item" data-v="${b.id}"><i class="bi bi-credit-card"></i><span class="lbl">${esc(b.nome)}</span><i class="bi bi-chevron-right chev"></i></div>`
        ).join('');
        el('fvModalFormaBody').querySelectorAll('[data-v]').forEach(item => {
            item.addEventListener('click', () => {
                wiz.bandeira = item.dataset.v;
                if (wiz.tipo === 'credito') abrirWizardParcelas(); else finalizarWizardCartao();
            });
        });
    }
    function abrirWizardParcelas() {
        el('fvModalFormaTitulo').textContent = 'Quantas parcelas?';
        renderStepsDots(passosWizard().length - 1);
        renderBackRow(() => { if (wiz.bandeira !== null && taxaVariaPorBandeira(wiz.maquina, 1)) abrirWizardBandeira(); else abrirWizardTipo(); });
        const max = getMaquinas().find(m => m.v === wiz.maquina)?.maxParcelas || 18;
        const opcoes = Array.from({ length: max }, (_, i) => ({ v: String(i + 1), l: `${i + 1}x` }));
        el('fvModalFormaBody').innerHTML = `<div class="stq-cats">${opcoes.map(o => `<button type="button" class="stq-cat-pill" data-v="${o.v}" style="color:var(--primary);">${o.l}</button>`).join('')}</div>`;
        el('fvModalFormaBody').querySelectorAll('[data-v]').forEach(item => {
            item.addEventListener('click', () => { wiz.parcelas = parseInt(item.dataset.v, 10) || 1; finalizarWizardCartao(); });
        });
    }
    function finalizarWizardCartao() {
        formaSelecionada = 'cartao';
        const maquinaL = getMaquinas().find(m => m.v === wiz.maquina)?.l || '';
        const tipoL = wiz.tipo === 'debito' ? 'Débito' : `Crédito ${wiz.parcelas}x`;
        const bandL = wiz.bandeira ? ` · ${bandeirasDaMaquina(wiz.maquina).find(b => b.id === wiz.bandeira)?.nome || ''}` : '';
        formaLabel = `${maquinaL} · ${tipoL}${bandL}`;
        el('fvModalFormaBackdrop').classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        renderConteudo();
        setTimeout(() => el('fvValorInput')?.focus(), 250);
    }

    // ── Parcelas (dentro do Fechar Venda, antes mesmo de fechar) ────
    // Mesma lógica/estrutura de dados que venda/historico.js usa (Ver
    // Parcelas pós-fechamento) — aqui reaproveitada pra permitir marcar
    // parcela como paga já durante o registro, sem esperar a venda
    // estar 100% fechada. Como os pagamentos já estão salvos no
    // Firebase assim que são lançados, não precisa mais salvar antes
    // de abrir o modal — já está lá.
    function abrirModalParcelas(pIdx) {
        const pagamento = pagamentos[pIdx];
        if (!pagamento || !Array.isArray(pagamento.itens)) return;
        ensureModalParcelasBackdrop();
        renderParcelasBody(pIdx);
        el('fvParcelasBackdrop').classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }

    function ensureModalParcelasBackdrop() {
        if (el('fvParcelasBackdrop')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="stq-modal-backdrop" id="fvParcelasBackdrop">
                <div class="stq-modal-card">
                    <div class="stq-modal-header primary">
                        <div class="stq-modal-header-title">Parcelas</div>
                        <button class="stq-modal-close" id="fvParcelasClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="fvParcelasBody"></div>
                </div>
            </div>`);
        el('fvParcelasClose').addEventListener('click', () => { el('fvParcelasBackdrop').classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); });
        el('fvParcelasBackdrop').addEventListener('click', e => {
            if (e.target.id === 'fvParcelasBackdrop') { el('fvParcelasBackdrop').classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); }
        });
    }

    function renderParcelasBody(pIdx) {
        const pagamento = pagamentos[pIdx];
        const bodyEl = el('fvParcelasBody');
        if (!pagamento || !bodyEl) return;
        bodyEl.innerHTML = pagamento.itens.map((it, iIdx) => `
            <div class="apr-modal-item venda-parcela-item ${it.paga ? 'paga' : ''}" data-iidx="${iIdx}">
                <span>${it.numero}/${pagamento.parcelas} · ${fmt(it.valor)} <span class="text-secondary small">· vence ${new Date(it.vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</span></span>
                <span class="venda-parcela-status">${it.paga ? `<i class="bi bi-check-circle-fill"></i> Paga em ${new Date(it.pagaEm).toLocaleDateString('pt-BR')}` : 'Marcar paga'}</span>
            </div>`).join('');
        bodyEl.querySelectorAll('[data-iidx]').forEach(row => {
            row.addEventListener('click', () => confirmarToggleParcelaFV(pIdx, parseInt(row.dataset.iidx, 10)));
        });
    }

    function confirmarToggleParcelaFV(pIdx, iIdx) {
        const pagamento = pagamentos[pIdx];
        const item = pagamento?.itens?.[iIdx];
        if (!item) return;
        const vaiPagar = !item.paga;
        modal({
            message: vaiPagar
                ? `Marcar a parcela ${item.numero}/${pagamento.parcelas} (${fmt(item.valor)}) como paga?`
                : `Desfazer o pagamento da parcela ${item.numero}/${pagamento.parcelas}?`,
            confirmText: vaiPagar ? 'Marcar como paga' : 'Desfazer',
            onConfirm: () => toggleParcelaPagaFV(pIdx, iIdx)
        });
    }

    function toggleParcelaPagaFV(pIdx, iIdx) {
        const pagamentoLocal = pagamentos[pIdx];
        const itemLocal = pagamentoLocal?.itens?.[iIdx];
        if (!itemLocal) return;
        const novoPaga = !itemLocal.paga;
        const pagamentoId = pagamentoLocal.id || null;
        const numeroParcela = itemLocal.numero;

        window._dbTransaction(window._lojaRef(`vendas/${vendaAtual.id}`), atual => {
            if (atual === null) return null; // cache frio — null faz o SDK reexecutar com o dado real (undefined abortaria)
            const pagamentosAtuais = atual.pagamentos || [];
            // Localiza o PAGAMENTO pelo id único (fallback por posição só
            // para pagamentos legados sem id) e a PARCELA dentro dele pelo
            // número (1, 2, 3... — estável, atribuído na criação, nunca
            // muda mesmo que outras parcelas do mesmo pagamento sejam
            // alteradas). Isso evita o bug de path fixo por índice: se o
            // array de pagamentos mudou de composição em outro PC, pIdx
            // sozinho podia apontar pro pagamento errado.
            const pIdxReal = pagamentoId
                ? pagamentosAtuais.findIndex(p => p.id === pagamentoId)
                : pIdx;
            if (pIdxReal < 0) return undefined; // pagamento já não existe mais
            const pagamentoAtual = pagamentosAtuais[pIdxReal];
            const iIdxReal = (pagamentoAtual.itens || []).findIndex(it => it.numero === numeroParcela);
            if (iIdxReal < 0) return undefined; // parcela já não existe mais

            const novosItens = pagamentoAtual.itens.map((it, i) => {
                if (i !== iIdxReal) return it;
                return novoPaga
                    ? { ...it, paga: true, pagaEm: Date.now(), revogadaEm: null }
                    : { ...it, paga: false, revogadaEm: Date.now() };
            });
            const novosPagamentos = pagamentosAtuais.map((p, i) => i === pIdxReal ? { ...p, itens: novosItens } : p);
            return { ...atual, pagamentos: novosPagamentos };
        }).then(result => {
            if (!result.committed || !result.snapshot.exists()) {
                modal({ message: 'Essa parcela já não existe mais (pode ter sido alterada em outra tela).' });
                return;
            }
            pagamentos = result.snapshot.val().pagamentos || [];
            renderParcelasBody(pIdx);
            renderConteudo();
            if (novoPaga && typeof window._showSuccessOverlay === 'function') window._showSuccessOverlay('Parcela paga!');
        }).catch(e => modal({ message: `Erro ao atualizar parcela: ${e.message}` }));
    }

    function carregarVenda(vendaId) {
        const box = el('fvConteudo');
        if (box) box.innerHTML = `<div class="stq-hist-loading">Carregando venda...</div>`;
        return window._dbGet(window._lojaRef(`vendas/${vendaId}`)).then(snap => {
            const v = snap.val();
            vendaAtual = v ? { id: vendaId, ...v } : null;
            // Se a venda já tinha pagamento(s) parcial(is) salvos antes,
            // esse histórico precisa aparecer aqui — senão a tela "esquece"
            // que já recebeu parte do dinheiro.
            pagamentos = (vendaAtual && Array.isArray(vendaAtual.pagamentos)) ? vendaAtual.pagamentos : [];
        }).catch(() => { vendaAtual = null; pagamentos = []; });
    }

    // ── Entrada pública ──────────────────────────────────────────
    window._renderFecharVenda = function () {
        ensureSkeleton();
        resetFormulario();
        resumoAberto = false;
        // Rede de segurança: se o botão ficou preso em "Salvando..." de
        // uma vez anterior, libera ao entrar na tela de novo.
        const btnSalvar = el('fvSalvarPagamentoBtn');
        if (btnSalvar) window._setBtnLoading(btnSalvar, false);
        const ctx = window._vendaContexto;
        if (!ctx || !ctx.vendaId) {
            vendaAtual = null;
            pagamentos = [];
            renderConteudo();
            return;
        }
        carregarVenda(ctx.vendaId).then(renderConteudo);
    };
})();