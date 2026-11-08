// ================================================================
// configuracoes/config-taxas.js — VortexSmart · Config → Taxas & Máquinas
// Registra: window._initConfigTaxas()
//
// Importante sobre onde cada coisa é gravada no Firebase:
//   - rates/{maquina}/{bandeira} = {debito, credito:[...], debitoTipo?, creditoTipo?}
//     ESSA estrutura é a mesma que o CTW (sistema original) usa e
//     depende — NUNCA muda de formato aqui, só os valores. Maquininha
//     SEM bandeira (lista vazia) usa rates/{maquina} = {debito,
//     credito:[...]} direto na raiz, sem sub-chave (mesmo formato que
//     o PagBank sempre usou — agora generalizado pra qualquer
//     maquininha, não só ele).
//     Os números são % por padrão. 'debitoTipo' / 'creditoTipo' = 'rs' (opcionais,
//     ao lado dos números) dizem que aquele valor é R$ FIXO por transação em vez de %
//     (ex: a máquina cobra R$ 0,50 no débito, qualquer que seja a venda). Ausente = %.
//   - maquininhasConfig/{maquina} = {nome, maxParcelas, oculta, padrao,
//     bandeiras:[{id,nome}, ...]}
//     Node NOVO, só do VortexSmart. O CTW não sabe que existe.
//     'bandeiras' é a lista de bandeiras DESSA maquininha específica —
//     cada máquina escolhe as suas (0, 2, 3, 4... o que o Gestor
//     cadastrar). Máquina antiga sem esse campo ainda: window
//     ._getBandeirasDaMaquina (core.js) infere a partir de 'rates' e
//     cura sozinha na primeira leitura.
//   - formasPagamentoConfig/{forma} = {oculta, taxa?, taxaTipo?}
//     Idem, só pro VortexSmart (Dinheiro/Pix e as formas cadastradas
//     pela loja). 'taxa' é opcional: o que essa forma desconta do que a
//     loja recebe (ex: Pix recebido na maquininha) — % por padrão, ou R$ fixo
//     por pagamento quando taxaTipo = 'rs'. Ausente = sem taxa.
//     Vale só pras vendas NOVAS — cada pagamento guarda o próprio líquido.
// ================================================================
(function () {
    'use strict';
    const el      = id => document.getElementById(id);
    const modal   = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc     = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const dbRoot  = () => window._lojaRef();
    const pathRef = p => window._lojaRef(p);
    const getBandeirasDaMaquina = id => typeof window._getBandeirasDaMaquina === 'function' ? window._getBandeirasDaMaquina(id) : [];
    const brl     = v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const semAcento = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const idDe    = nome => semAcento(nome).replace(/[^a-z0-9]+/g, '');

    const FORMAS_BASE = [
        { v: 'dinheiro', l: 'Dinheiro', icone: 'cash-stack', verde: true },
        { v: 'pix', l: 'Pix', icone: 'lightning-charge-fill' }
    ];
    // Parcelado (promissória): antes era uma forma "fixa" — aparecia sempre ao fechar a venda e nem existia
    // nesta lista. Agora entra como as outras: dá pra DESATIVAR e RENOMEAR (ex: "Promissória", "Venda a
    // prazo"). Não tem taxa (é uma promessa de pagamento em parcelas, sem maquininha).
    // Guardado em formasPagamentoConfig/parcelado = { nome?, oculta? }. Sem nome salvo = "Parcelado".
    const FORMA_PARCELADO = { v: 'parcelado', l: 'Parcelado', icone: 'calendar3', semTaxa: true };
    const NOME_FORMA_MAX = 24;
    function getFormasSemTaxa() {
        const cfg = window._formasPagamentoConfig || {};
        const customIds = Object.keys(cfg).filter(id => cfg[id]?.custom && !FORMAS_BASE.find(f => f.v === id) && id !== FORMA_PARCELADO.v);
        const customs = customIds.map(id => ({ v: id, l: cfg[id].nome || id, emoji: cfg[id].emoji || '💳', custom: true }));
        const nomeParcelado = String(cfg[FORMA_PARCELADO.v]?.nome || '').trim();
        return [...FORMAS_BASE, ...customs, { ...FORMA_PARCELADO, l: nomeParcelado || FORMA_PARCELADO.l }];
    }
    // Nome novo de uma forma: sem espaços sobrando, cabe na tela, e não repete o de outra forma (nem "Cartão").
    // Parcelado vazio (ou igual ao padrão) = volta ao nome padrão. Devolve { ok, nome } — nome null apaga o campo.
    function validarNomeDaForma(texto, id) {
        const nome = String(texto || '').trim().replace(/\s+/g, ' ');
        if (id === FORMA_PARCELADO.v && (!nome || nome === FORMA_PARCELADO.l)) return { ok: true, nome: null };
        if (!nome) return { ok: false, erro: 'Dá um nome pra forma de pagamento.' };
        if (nome.length > NOME_FORMA_MAX) return { ok: false, erro: `Nome muito grande — use até ${NOME_FORMA_MAX} letras.` };
        const norm = t => semAcento(t).replace(/\s+/g, ' ');
        const usados = [...getFormasSemTaxa().filter(f => f.v !== id).map(f => f.l), 'Cartão'].map(norm);
        if (usados.includes(norm(nome))) return { ok: false, erro: 'Já existe uma forma de pagamento com esse nome.' };
        return { ok: true, nome };
    }

    // ── Taxa: % ou R$ fixo ─────────────────────────────────────────
    // Tipos: 'pct' (% sobre a venda) e 'rs' (R$ fixo por transação). Os campos da tela guardam o TEXTO
    // digitado; só no salvar viram número (lerNumero) e passam pela faixa válida (naFaixa).
    const LIMITE_RS = 10000;
    const TEXTO_FAIXA = { pct: 'use um número de 0 a 100 (ex: 0,99)', rs: 'use um valor em reais de 0 a 10.000 (ex: 0,50)' };
    // '' → null (em branco); texto que não é número → NaN; senão o número com até 2 casas.
    function lerNumero(texto) {
        const bruto = String(texto ?? '').trim();
        if (bruto === '') return null;
        if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(bruto)) return NaN;
        const n = Number(bruto.replace(',', '.'));
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
    }
    // Maquininha: % tem que ser menor que 100 (100% não deixaria nada pra loja e quebra o "quanto cobrar").
    const naFaixa = (n, tipo) => n >= 0 && (tipo === 'rs' ? n <= LIMITE_RS : n < 100);
    const paraTexto = (n, tipo) => (n == null || !Number.isFinite(Number(n))) ? '' : (tipo === 'rs' ? Number(n).toFixed(2) : String(Number(n))).replace('.', ',');
    // Digitação: só dígitos e uma vírgula/ponto, até 2 casas.
    function limparDigitacao(inp) {
        let v = inp.value.replace(/[^\d.,]/g, '');
        const i = v.search(/[.,]/);
        if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/[.,]/g, '');
        v = v.replace(/([.,]\d{2})\d+/, '$1');
        if (v !== inp.value) inp.value = v;
        return v;
    }
    // "Venda de R$ 100,00 no débito: a loja recebe … Pra receber R$ 100,00, o cliente paga …"
    function linhaSimulacao(onde, taxa) {
        const liquido = window._taxaLiquido(100, taxa), bruto = window._taxaBruto(100, taxa);
        return `<div>Numa venda de <b>${brl(100)}</b> ${onde}, a loja recebe <b>${brl(liquido)}</b>. Pra receber ${brl(100)}, o cliente paga <b>${brl(bruto)}</b>.</div>`;
    }
    function segHtml(grupo, tipo) {
        return `<div class="tx-seg" role="group">${[['pct', 'Porcentagem %'], ['rs', 'Valor fixo R$']].map(([t, rotulo]) =>
            `<button type="button" class="${t === tipo ? 'on' : ''}" data-seg="${grupo}" data-u="${t}" aria-pressed="${t === tipo}">${rotulo}</button>`).join('')}</div>`;
    }
    function campoHtml(attrs, valor, tipo, classe = '') {
        return `<div class="tx-campo ${classe}">${tipo === 'rs' ? '<span class="tx-un">R$</span>' : ''}<input type="text" inputmode="decimal" autocomplete="off" placeholder="${tipo === 'rs' ? '0,00' : '0'}" value="${esc(valor)}" ${attrs}>${tipo === 'pct' ? '<span class="tx-un">%</span>' : ''}</div>`;
    }
    const dicaTaxa = (tipo, onde) => tipo === 'rs'
        ? `Valor fixo descontado em toda venda ${onde}, seja qual for o valor da venda (ex: a máquina cobra R$ 0,50 por transação).`
        : `Percentual descontado do valor de cada venda ${onde}.`;

    let mounted = false;
    let tela = 'lista';          // 'lista' | 'maquina' | 'forma'
    let maquinaEmEdicao = null;  // id da máquina sendo editada (null = cadastro novo)
    let formaEmEdicao = null;    // id da forma sendo editada (null = cadastro de forma nova)

    // ── Estado do formulário da maquininha (cadastro E edição) ─────
    // sets[chave] guarda o que foi digitado (texto) por bandeira; chave '_unica' = maquininha sem bandeira.
    // Nada é lido de volta do DOM: os campos atualizam este objeto a cada digitação.
    let fm = null;   // { nome, max, bandeiras:[{id,nome}], ativa, removidas:[ids], adicionando, sets:{} }
    let ff = null;   // formulário da forma: { nome, emoji, taxa, tipo }

    const novoSet = () => ({ deb: '', debTipo: 'pct', cred: [], credTipo: 'pct' });
    function setDeRates(o) {
        if (!o) return novoSet();
        const debTipo = o.debitoTipo === 'rs' ? 'rs' : 'pct', credTipo = o.creditoTipo === 'rs' ? 'rs' : 'pct';
        const cred = Array.isArray(o.credito) ? o.credito : Object.values(o.credito || {});
        return { deb: paraTexto(o.debito, debTipo), debTipo, cred: cred.map(v => paraTexto(v, credTipo)), credTipo };
    }
    const chaveAtual = () => fm.ativa || '_unica';
    function setAtivo() { return fm.sets[chaveAtual()] || (fm.sets[chaveAtual()] = novoSet()); }

    function todasAsMaquinas() {
        const cfg = window._maquininhasConfig || {};
        const idsComTaxa = window._rates ? Object.keys(window._rates) : [];
        // Config sem taxa E sem nome = resíduo "só bandeiras" (máquina fantasma de versões antigas): não listar.
        const idsSoConfig = Object.keys(cfg).filter(id => !idsComTaxa.includes(id) && cfg[id]?.nome);
        return [...idsComTaxa, ...idsSoConfig].map(id => {
            const maxReal = cfg[id]?.maxParcelas || (typeof window._inferirMaxParcelas === 'function' ? window._inferirMaxParcelas(id) : null) || 12;
            // Cura sozinho: se 'maquininhasConfig' não tinha esse campo (máquina
            // antiga, de antes dessa tela existir), grava o valor real agora —
            // assim não fica reinferindo (e arriscando) toda vez.
            if (cfg[id]?.maxParcelas == null && maxReal) {
                window._dbUpdate(pathRef(`maquininhasConfig/${id}`), { maxParcelas: maxReal }).catch(() => {});
            }
            return {
                v: id,
                l: cfg[id]?.nome || (id.charAt(0).toUpperCase() + id.slice(1)),
                maxParcelas: maxReal,
                oculta: !!cfg[id]?.oculta,
                padrao: !!cfg[id]?.padrao
            };
        });
    }

    // ── Esqueleto (uma vez só) ───────────────────────────────────
    function ensureSkeleton() {
        const wrap = el('configuracoesTaxas');
        if (!wrap || mounted) return;
        wrap.innerHTML = `
            <div class="section-header">
                <h3 id="ctxTitulo">Taxas &amp; Máquinas</h3>
                <button class="btn-icon-circle" id="ctxBack" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
            </div>
            <div class="content-card w-100" id="ctxBody"></div>
        `;
        el('ctxBack')?.addEventListener('click', () => {
            if (tela !== 'lista') { voltarParaLista(); }
            else history.back();
        });
        mounted = true;
    }

    function voltarParaLista() {
        tela = 'lista';
        maquinaEmEdicao = null;
        formaEmEdicao = null;
        fm = null;
        ff = null;
        renderTudo();
    }

    function renderTudo() {
        ensureSkeleton();
        el('ctxTitulo').textContent = tela === 'lista' ? 'Taxas & Máquinas'
            : tela === 'forma' ? (formaEmEdicao ? (getFormasSemTaxa().find(f => f.v === formaEmEdicao)?.l || 'Forma de pagamento') : 'Nova forma')
            : (maquinaEmEdicao ? (fm?.nome || 'Maquininha') : 'Nova maquininha');
        if (tela === 'lista') renderLista();
        else if (tela === 'forma') renderForma();
        else renderMaquina();
    }

    // Troca de tela: volta pro topo (a tela nova começa do começo).
    function irPara(nova) {
        tela = nova;
        renderTudo();
        window.scrollTo(0, 0);
        el('ctxTitulo')?.scrollIntoView({ block: 'nearest' });
    }

    // ══════════════════════ TELA: LISTA ══════════════════════
    function subtituloForma(f) {
        if (f.semTaxa) return 'Promessa de pagamento';
        const t = window._taxaDaForma(f.v);
        if (!t) return 'Sem taxa';
        return t.tipo === 'rs' ? `Taxa de ${window._taxaTexto(t)} por venda` : `Taxa de ${window._taxaTexto(t)}`;
    }

    function iconeForma(f) {
        return f.emoji ? esc(f.emoji) : `<i class="bi bi-${f.icone || 'credit-card-2-front'}"></i>`;
    }

    function chipsMaquina(m) {
        const b0 = getBandeirasDaMaquina(m.v)[0]?.id;
        const taxa = i => (typeof window._getTaxa === 'function' ? window._getTaxa(m.v, b0, i) : undefined);
        const itens = [['Débito', taxa(0)], ['1x', taxa(1)]];
        if (m.maxParcelas > 1) itens.push([`${m.maxParcelas}x`, taxa(m.maxParcelas)]);
        const chips = itens.filter(([, t]) => t).map(([rotulo, t]) =>
            `<span class="tx-chip">${rotulo} <b>${window._taxaTexto(t)}</b>${t.tipo === 'rs' ? ' <small>por venda</small>' : ''}</span>`);
        return chips.join('') || '<span class="tx-chip tx-chip-vazio">Sem taxa cadastrada ainda</span>';
    }

    function subtituloMaquina(m) {
        const bs = getBandeirasDaMaquina(m.v);
        const nomes = bs.length ? bs.slice(0, 3).map(b => esc(b.nome)).join(', ') + (bs.length > 3 ? ` +${bs.length - 3}` : '') : 'Sem bandeira';
        return `${nomes} · até ${m.maxParcelas}x`;
    }

    function renderLista() {
        const formasCfg = window._formasPagamentoConfig || {};
        const maquinas = todasAsMaquinas();

        el('ctxBody').innerHTML = `
            <div class="tx-sec">Formas de pagamento</div>
            <div class="tx-card" id="txFormas">
                ${getFormasSemTaxa().map(f => `
                    <div class="tx-lin">
                        <button type="button" class="tx-lin-main" data-forma-abrir="${f.v}">
                            <span class="tx-ic ${f.verde ? 'v' : ''}">${iconeForma(f)}</span>
                            <span class="tx-t"><span class="tx-n">${esc(f.l)}</span><span class="tx-s">${esc(subtituloForma(f))}</span></span>
                        </button>
                        <button type="button" class="tx-sw ${formasCfg[f.v]?.oculta ? '' : 'on'}" role="switch" aria-checked="${!formasCfg[f.v]?.oculta}" data-forma-oculta="${f.v}" aria-label="Mostrar ${esc(f.l)} nas vendas"></button>
                        <i class="bi bi-chevron-right tx-chev" aria-hidden="true"></i>
                    </div>`).join('')}
            </div>
            <button type="button" class="tx-add" id="txNovaForma"><i class="bi bi-plus-lg"></i> Nova forma de pagamento</button>

            <div class="tx-sec">Maquininhas de cartão</div>
            <div id="txMaquinas">
                ${maquinas.map(m => `
                    <div class="tx-card tx-maq ${m.oculta ? 'tx-off' : ''}">
                        <button type="button" class="tx-maq-cab" data-maq-abrir="${m.v}">
                            <span class="tx-ic tx-ic-maq"><i class="bi bi-credit-card-2-front"></i></span>
                            <span class="tx-t"><span class="tx-n">${esc(m.l)}${m.padrao ? '<span class="tx-pill">Padrão</span>' : ''}</span><span class="tx-s">${subtituloMaquina(m)}</span></span>
                            <i class="bi bi-chevron-right tx-chev" aria-hidden="true"></i>
                        </button>
                        <div class="tx-chips">${chipsMaquina(m)}</div>
                        <div class="tx-rod">
                            <span>Aparece nas vendas e calculadoras</span>
                            <button type="button" class="tx-sw ${m.oculta ? '' : 'on'}" role="switch" aria-checked="${!m.oculta}" data-maq-oculta="${m.v}" aria-label="Mostrar ${esc(m.l)} nas vendas e calculadoras"></button>
                        </div>
                        ${m.padrao ? '' : `<button type="button" class="tx-txt tx-padrao" data-maq-padrao="${m.v}">★ Definir como padrão</button>`}
                    </div>`).join('') || '<div class="tx-vazio">Nenhuma maquininha cadastrada ainda.</div>'}
            </div>
            <button type="button" class="tx-add" id="txNovaMaquina"><i class="bi bi-plus-lg"></i> Nova maquininha</button>
        `;

        el('txFormas').querySelectorAll('[data-forma-abrir]').forEach(b => b.addEventListener('click', () => abrirForma(b.dataset.formaAbrir)));
        el('txFormas').querySelectorAll('[data-forma-oculta]').forEach(b => b.addEventListener('click', () => {
            const forma = b.dataset.formaOculta;
            const atual = !!(window._formasPagamentoConfig || {})[forma]?.oculta;
            window._dbUpdate(pathRef(`formasPagamentoConfig/${forma}`), { oculta: !atual })
                .catch(e => modal({ message: `Erro ao salvar: ${e.message}` }));
        }));

        const lista = el('txMaquinas');
        lista.querySelectorAll('[data-maq-abrir]').forEach(b => b.addEventListener('click', () => abrirEdicao(b.dataset.maqAbrir)));
        lista.querySelectorAll('[data-maq-oculta]').forEach(b => b.addEventListener('click', () => {
            const id = b.dataset.maqOculta;
            const atual = !!(window._maquininhasConfig || {})[id]?.oculta;
            window._dbUpdate(pathRef(`maquininhasConfig/${id}`), { oculta: !atual })
                .catch(e => modal({ message: `Erro ao salvar: ${e.message}` }));
        }));
        // Definir como padrão — update multi-path atômico (limpa os outros)
        lista.querySelectorAll('[data-maq-padrao]').forEach(b => b.addEventListener('click', () => {
            const id = b.dataset.maqPadrao;
            const updates = {};
            maquinas.forEach(m => { updates[`maquininhasConfig/${m.v}/padrao`] = (m.v === id); });
            window._dbUpdate(dbRoot(), updates)
                .catch(e => modal({ message: `Erro ao definir padrão: ${e.message}` }));
        }));

        el('txNovaMaquina')?.addEventListener('click', abrirCadastro);
        el('txNovaForma')?.addEventListener('click', () => abrirForma(null));
    }

    // ══════════════════════ TELA: MAQUININHA (cadastro/edição) ══════════════════════
    function abrirCadastro() {
        maquinaEmEdicao = null;
        fm = { nome: '', max: 12, bandeiras: [], ativa: null, removidas: [], adicionando: false, sets: {} };
        irPara('maquina');
    }

    function abrirEdicao(id) {
        const cfg = (window._maquininhasConfig || {})[id] || {};
        const rt = (window._rates || {})[id] || {};
        const bandeiras = getBandeirasDaMaquina(id).map(b => ({ ...b }));
        const sets = {};
        if (bandeiras.length) bandeiras.forEach(b => { if (rt[b.id]) sets[b.id] = setDeRates(rt[b.id]); });
        else sets._unica = setDeRates(rt);
        maquinaEmEdicao = id;
        fm = {
            nome: cfg.nome || (id.charAt(0).toUpperCase() + id.slice(1)),
            max: Math.min(24, cfg.maxParcelas || (typeof window._inferirMaxParcelas === 'function' ? window._inferirMaxParcelas(id) : null) || 12),
            bandeiras, ativa: bandeiras[0]?.id || null, removidas: [], adicionando: false, sets
        };
        irPara('maquina');
    }

    function renderMaquina() {
        el('ctxBody').innerHTML = `
            <div class="tx-sec">Dados</div>
            <div class="tx-card">
                <div class="tx-pad">
                    <label class="tx-lbl" for="txNome">Nome da maquininha</label>
                    <div class="tx-campo"><input type="text" id="txNome" maxlength="30" autocomplete="off" placeholder="Ex: GetNet" value="${esc(fm.nome)}"></div>
                </div>
                <div class="tx-pad tx-linha">
                    <div><div class="tx-forte">Máximo de parcelas</div><div class="tx-dica tx-dica-s">no crédito</div></div>
                    <div class="tx-step"><button type="button" id="txMenos" aria-label="Menos uma parcela">−</button><span id="txMax">${fm.max}</span><button type="button" id="txMais" aria-label="Mais uma parcela">+</button></div>
                </div>
            </div>

            <div class="tx-sec">Bandeiras</div>
            <div class="tx-card"><div class="tx-pad" id="txBandeiras"></div></div>

            <div id="txTaxas"></div>

            ${maquinaEmEdicao ? '<button type="button" class="tx-perigo" id="txExcluir">Excluir maquininha</button>' : ''}
            <div class="tx-salvar"><button type="button" id="txSalvar">${maquinaEmEdicao ? 'Salvar maquininha' : 'Cadastrar maquininha'}</button></div>
        `;
        renderBandeiras();
        renderTaxas();

        el('txNome').addEventListener('input', e => { fm.nome = e.target.value; });
        const passo = delta => {
            fm.max = Math.min(24, Math.max(1, fm.max + delta));
            el('txMax').textContent = fm.max;
            renderTaxas();
        };
        el('txMenos').addEventListener('click', () => passo(-1));
        el('txMais').addEventListener('click', () => passo(1));
        el('txSalvar').addEventListener('click', salvarMaquina);
        el('txExcluir')?.addEventListener('click', excluirMaquina);
    }

    // ── Bandeiras ────────────────────────────────────────────────
    // Ids que a própria estrutura de rates já usa como chave: uma bandeira com esse id se misturaria
    // com os números da maquininha sem bandeira.
    const IDS_RESERVADOS = ['debito', 'credito', 'debitotipo', 'creditotipo'];

    function renderBandeiras() {
        const box = el('txBandeiras');
        if (!box) return;
        box.innerHTML = `
            <div class="tx-bchips">
                ${fm.bandeiras.map(b => `
                    <div class="tx-bch ${b.id === fm.ativa ? 'on' : ''}">
                        <button type="button" class="tx-bch-nome" data-b="${b.id}">${esc(b.nome)}</button>
                        <button type="button" class="tx-bch-x" data-rem="${b.id}" aria-label="Remover ${esc(b.nome)}"><i class="bi bi-x"></i></button>
                    </div>`).join('')}
                ${fm.adicionando ? '' : '<button type="button" class="tx-bch novo" id="txAddB"><i class="bi bi-plus-lg"></i> Adicionar</button>'}
            </div>
            ${fm.adicionando ? `
            <div class="tx-add-row">
                <div class="tx-campo"><input type="text" id="txNovaB" maxlength="20" autocomplete="off" placeholder="Ex: Visa, Elo, Ticket..."></div>
                <button type="button" class="tx-iconbtn ok" id="txOkB" aria-label="Confirmar"><i class="bi bi-check-lg"></i></button>
                <button type="button" class="tx-iconbtn" id="txCancB" aria-label="Cancelar"><i class="bi bi-x-lg"></i></button>
            </div>` : ''}
            <div class="tx-dica">${fm.bandeiras.length
                ? 'Toque numa bandeira para editar as taxas dela. Bandeira sem taxa preenchida usa a da primeira que tiver.'
                : 'Sem bandeiras: a taxa vale pra qualquer cartão nessa maquininha. Cadastre bandeiras só se cada uma tiver taxa diferente.'}</div>`;

        box.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => {
            fm.ativa = b.dataset.b;
            renderBandeiras();
            renderTaxas();
        }));
        box.querySelectorAll('[data-rem]').forEach(x => x.addEventListener('click', () => removerBandeira(x.dataset.rem)));
        el('txAddB')?.addEventListener('click', () => { fm.adicionando = true; renderBandeiras(); el('txNovaB')?.focus(); });
        el('txCancB')?.addEventListener('click', () => { fm.adicionando = false; renderBandeiras(); });
        el('txOkB')?.addEventListener('click', confirmarNovaBandeira);
        el('txNovaB')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); confirmarNovaBandeira(); } });
    }

    function confirmarNovaBandeira() {
        const nome = el('txNovaB')?.value.trim().replace(/\s+/g, ' ');
        if (!nome) return;
        const id = idDe(nome);
        if (!id || IDS_RESERVADOS.includes(id)) { modal({ message: 'Nome inválido — use letras ou números (e não "Débito" ou "Crédito").' }); return; }
        if (fm.bandeiras.find(b => b.id === id)) { modal({ message: 'Já tem uma bandeira com esse nome nessa maquininha.' }); return; }
        // Primeira bandeira de uma maquininha que tinha taxa única: aproveita o que já foi digitado.
        if (!fm.bandeiras.length && fm.sets._unica) fm.sets[id] = JSON.parse(JSON.stringify(fm.sets._unica));
        fm.bandeiras.push({ id, nome });
        fm.removidas = fm.removidas.filter(r => r !== id);
        fm.ativa = id;
        fm.adicionando = false;
        renderBandeiras();
        renderTaxas();
    }

    function removerBandeira(id) {
        const set = fm.sets[id];
        fm.bandeiras = fm.bandeiras.filter(b => b.id !== id);
        delete fm.sets[id];
        if (maquinaEmEdicao && !fm.removidas.includes(id)) fm.removidas.push(id);
        // Sobrou nenhuma: volta a ser taxa única, aproveitando as taxas da bandeira que saiu.
        if (!fm.bandeiras.length && !fm.sets._unica) fm.sets._unica = set || novoSet();
        fm.ativa = fm.bandeiras[0]?.id || null;
        renderBandeiras();
        renderTaxas();
    }

    // ── Taxas (débito + crédito por parcela) da bandeira ativa ─────
    function renderTaxas() {
        const box = el('txTaxas');
        if (!box) return;
        const st = setAtivo();
        const nomeB = fm.ativa ? fm.bandeiras.find(b => b.id === fm.ativa)?.nome : null;
        const sufixo = nomeB ? ` · ${esc(nomeB)}` : '';
        box.innerHTML = `
            <div class="tx-sec">Débito${sufixo}</div>
            <div class="tx-card"><div class="tx-pad">
                ${segHtml('deb', st.debTipo)}
                ${campoHtml('data-deb', st.deb, st.debTipo)}
                <div class="tx-dica">${dicaTaxa(st.debTipo, 'no débito')}</div>
            </div></div>

            <div class="tx-sec">Crédito por parcela${sufixo}</div>
            <div class="tx-card">
                <div class="tx-pad">
                    ${segHtml('cre', st.credTipo)}
                    <div class="tx-dica tx-dica-s">${dicaTaxa(st.credTipo, 'no crédito')}</div>
                </div>
                <div class="tx-parcs">
                    ${Array.from({ length: fm.max }, (_, i) => `
                    <div class="tx-parc"><span class="tx-parc-n">${i + 1}x</span>${campoHtml(`data-p="${i}"`, st.cred[i] ?? '', st.credTipo, 'tx-campo-sm')}</div>`).join('')}
                </div>
            </div>
            <div class="tx-acoes">
                <button type="button" class="tx-txt" id="txCopiar">Copiar a 1x para todas</button>
                <span>Parcelas em branco são completadas a partir da 1x ao salvar.</span>
            </div>
            <div class="tx-simu" id="txSimu"></div>`;

        box.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => {
            const u = b.dataset.u;
            if (b.dataset.seg === 'deb') { if (st.debTipo === u) return; st.debTipo = u; st.deb = ''; }
            else { if (st.credTipo === u) return; st.credTipo = u; st.cred = []; }
            renderTaxas(); // mudou a unidade: os números digitados na unidade antiga não valem mais
        }));
        box.querySelector('[data-deb]').addEventListener('input', e => { st.deb = limparDigitacao(e.target); atualizarSimulacao(); });
        box.querySelectorAll('[data-p]').forEach(inp => inp.addEventListener('input', e => { st.cred[Number(inp.dataset.p)] = limparDigitacao(e.target); atualizarSimulacao(); }));
        el('txCopiar').addEventListener('click', () => {
            const primeira = lerNumero(st.cred[0]);
            if (primeira === null || Number.isNaN(primeira)) { modal({ message: 'Preencha a taxa da 1x primeiro.' }); return; }
            st.cred = Array.from({ length: fm.max }, () => st.cred[0]);
            renderTaxas();
        });
        atualizarSimulacao();
    }

    function atualizarSimulacao() {
        const box = el('txSimu');
        if (!box) return;
        const st = setAtivo();
        const linhas = [];
        const deb = lerNumero(st.deb), c1 = lerNumero(st.cred[0]);
        if (deb !== null && !Number.isNaN(deb) && naFaixa(deb, st.debTipo)) linhas.push(linhaSimulacao('no débito', { tipo: st.debTipo, valor: deb }));
        if (c1 !== null && !Number.isNaN(c1) && naFaixa(c1, st.credTipo)) linhas.push(linhaSimulacao('em 1x no crédito', { tipo: st.credTipo, valor: c1 }));
        box.innerHTML = linhas.join('');
        box.style.display = linhas.length ? '' : 'none';
    }

    // Converte o que foi digitado numa bandeira (ou na taxa única) no objeto gravado em rates/.
    // Devolve { erro } | { incompleto } | { set }. Parcelas em branco depois da 1x são completadas:
    // % sobe 1,1 ponto por parcela a partir da anterior; R$ repete o valor da anterior.
    function montarSet(st, max, rotulo) {
        const onde = rotulo ? ` (${rotulo})` : '';
        const deb = lerNumero(st.deb);
        if (deb !== null && !(naFaixa(deb, st.debTipo))) return { erro: `Taxa de débito inválida${onde} — ${TEXTO_FAIXA[st.debTipo]}.` };
        const cred = [];
        for (let i = 0; i < max; i++) {
            const n = lerNumero(st.cred[i]);
            if (n !== null && !naFaixa(n, st.credTipo)) return { erro: `Taxa de crédito ${i + 1}x inválida${onde} — ${TEXTO_FAIXA[st.credTipo]}.` };
            cred.push(n);
        }
        if (deb === null || cred[0] === null) return { incompleto: true };
        for (let i = 1; i < max; i++) {
            if (cred[i] === null) cred[i] = st.credTipo === 'rs' ? cred[i - 1] : Math.min(Math.round((cred[i - 1] + 1.1) * 100) / 100, 99.99);
        }
        return { set: { debito: deb, credito: cred, ...(st.debTipo === 'rs' ? { debitoTipo: 'rs' } : {}), ...(st.credTipo === 'rs' ? { creditoTipo: 'rs' } : {}) } };
    }

    function salvarMaquina() {
        const nome = fm.nome.trim().replace(/\s+/g, ' ');
        const max = fm.max;
        if (!nome) { modal({ message: 'Dá um nome pra maquininha.' }); return; }
        const id = maquinaEmEdicao || idDe(nome);
        if (!id) { modal({ message: 'Nome inválido — usa letras ou números.' }); return; }
        if (!maquinaEmEdicao && ((window._rates || {})[id] || (window._maquininhasConfig || {})[id])) {
            modal({ message: 'Já existe uma maquininha com esse nome.' }); return;
        }
        if (maquinaEmEdicao && todasAsMaquinas().some(m => m.v !== id && semAcento(m.l).replace(/\s+/g, ' ') === semAcento(nome))) {
            modal({ message: 'Já existe outra maquininha com esse nome.' }); return;
        }

        // Taxas de cada bandeira (ou a única). Bandeira sem taxa preenchida herda da primeira que tem.
        const chaves = fm.bandeiras.length ? fm.bandeiras.map(b => ({ k: b.id, rotulo: b.nome })) : [{ k: '_unica', rotulo: null }];
        const prontos = {};
        let referencia = null;
        for (const c of chaves) {
            const r = montarSet(fm.sets[c.k] || novoSet(), max, c.rotulo);
            if (r.erro) { modal({ message: r.erro }); return; }
            prontos[c.k] = r.set || null;
            if (r.set && !referencia) referencia = r.set;
        }
        if (!referencia) {
            modal({ message: fm.bandeiras.length ? 'Preencha as taxas de ao menos uma bandeira (débito e crédito 1x).' : 'Preencha a taxa de débito e a de crédito 1x.' });
            return;
        }
        chaves.forEach(c => { if (!prontos[c.k]) prontos[c.k] = referencia; });

        const bandeiras = fm.bandeiras.map(b => ({ id: b.id, nome: b.nome }));
        const updates = {};
        if (maquinaEmEdicao) {
            updates[`maquininhasConfig/${id}/nome`] = nome;
            updates[`maquininhasConfig/${id}/maxParcelas`] = max;
            updates[`maquininhasConfig/${id}/bandeiras`] = bandeiras;
        } else {
            updates[`maquininhasConfig/${id}`] = { nome, maxParcelas: max, oculta: false, padrao: false, bandeiras };
        }
        if (!bandeiras.length) {
            // Substituir o node 'rates/{id}' inteiro já limpa qualquer sub-chave de bandeira antiga. Não dá pra
            // apagar a bandeira individual no mesmo update (caminho e caminho FILHO dele): o Firebase recusaria tudo.
            updates[`rates/${id}`] = prontos._unica;
        } else {
            // Se essa maquininha ERA achatada (taxa única, debito/credito direto na raiz) e ganhou bandeira,
            // limpa os campos antigos — senão os dois formatos ficam misturados e getTaxa() (core.js) acha que
            // ainda é achatada, já que ela checa debito/credito antes de olhar a bandeira.
            if (maquinaEmEdicao) {
                ['debito', 'credito', 'debitoTipo', 'creditoTipo'].forEach(k => { updates[`rates/${id}/${k}`] = null; });
                fm.removidas.forEach(r => { updates[`rates/${id}/${r}`] = null; });
            }
            bandeiras.forEach(b => { updates[`rates/${id}/${b.id}`] = prontos[b.id]; });
        }

        const btn = el('txSalvar');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        window._dbUpdate(dbRoot(), updates)
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                const editou = !!maquinaEmEdicao;
                voltarParaLista();
                modal({ message: editou ? '✅ Maquininha atualizada!' : `✅ ${nome} cadastrada!` });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
    }

    // Excluir máquina de verdade — ação sem volta, por isso pede confirmação.
    function excluirMaquina() {
        const id = maquinaEmEdicao;
        modal({
            message: `Excluir "${fm.nome}"? Essa ação não tem volta.`,
            confirmText: 'Excluir',
            cancelText: 'Cancelar',
            onConfirm: () => {
                const updates = { [`maquininhasConfig/${id}`]: null };
                if ((window._rates || {})[id]) updates[`rates/${id}`] = null;
                window._dbUpdate(dbRoot(), updates)
                    .then(() => voltarParaLista())
                    .catch(e => modal({ message: `Erro ao excluir: ${e.message}` }));
            }
        });
    }

    // ══════════════════════ TELA: FORMA DE PAGAMENTO ══════════════════════
    // Cadastro de nova forma (tipo Dinheiro/Pix; taxa opcional) e edição de uma existente
    // (Dinheiro, Pix, Parcelado ou cadastrada).
    function abrirForma(id) {
        const forma = id ? getFormasSemTaxa().find(f => f.v === id) : null;
        if (id && !forma) return;
        const t = id ? window._taxaDaForma(id) : null;
        formaEmEdicao = id;
        ff = { nome: forma ? forma.l : '', emoji: '', taxa: t ? paraTexto(t.valor, t.tipo) : '', tipo: t ? t.tipo : 'pct' };
        irPara('forma');
    }

    const nomeEditavelDaForma = f => !!f && (f.semTaxa || !!f.custom);

    function renderForma() {
        const editando = formaEmEdicao ? getFormasSemTaxa().find(f => f.v === formaEmEdicao) : null;
        if (formaEmEdicao && !editando) { voltarParaLista(); return; } // a forma foi excluída enquanto a tela estava aberta
        const nomeEditavel = !editando || nomeEditavelDaForma(editando);

        el('ctxBody').innerHTML = `
            <div class="tx-sec">Dados</div>
            <div class="tx-card"><div class="tx-pad">
                ${nomeEditavel ? `
                <label class="tx-lbl" for="txFormaNome">${editando ? 'Nome que aparece na venda' : 'Nome'}</label>
                <div class="tx-campo"><input type="text" id="txFormaNome" maxlength="${NOME_FORMA_MAX}" autocomplete="off" placeholder="${editando ? 'Ex: Promissória' : 'Ex: Vale Alimentação'}" value="${esc(ff.nome)}"></div>
                ${editando && editando.semTaxa ? `<div class="tx-dica">Ex: Promissória, Venda a prazo. Deixe vazio pra voltar a "${esc(FORMA_PARCELADO.l)}". Vale só pras vendas novas — as vendas antigas continuam com o nome que tinham.</div>` : ''}
                ` : `
                <label class="tx-lbl">Forma de pagamento</label>
                <div class="tx-campo tx-fixo">${esc(editando.l)}</div>
                `}
                ${!editando ? `
                <label class="tx-lbl tx-lbl-2" for="txFormaEmoji">Emoji (opcional)</label>
                <div class="tx-campo"><input type="text" id="txFormaEmoji" maxlength="2" autocomplete="off" placeholder="💳"></div>` : ''}
            </div></div>

            ${editando && editando.semTaxa ? '' : `
            <div class="tx-sec">Taxa · opcional</div>
            <div class="tx-card"><div class="tx-pad" id="txFormaTaxa"></div></div>
            <div class="tx-simu" id="txFormaSimu"></div>`}

            ${editando && editando.custom ? '<button type="button" class="tx-perigo" id="txExcluirForma">Excluir forma de pagamento</button>' : ''}
            <div class="tx-salvar"><button type="button" id="txSalvarForma">${editando ? 'Salvar' : 'Cadastrar forma de pagamento'}</button></div>
        `;
        if (!(editando && editando.semTaxa)) renderTaxaForma();

        el('txFormaNome')?.addEventListener('input', e => { ff.nome = e.target.value; });
        el('txFormaEmoji')?.addEventListener('input', e => { ff.emoji = e.target.value; });
        el('txSalvarForma').addEventListener('click', salvarForma);
        el('txExcluirForma')?.addEventListener('click', excluirForma);
    }

    function renderTaxaForma() {
        const box = el('txFormaTaxa');
        if (!box) return;
        box.innerHTML = `
            ${segHtml('forma', ff.tipo)}
            ${campoHtml('data-taxa-forma', ff.taxa, ff.tipo)}
            <div class="tx-dica">${ff.tipo === 'rs'
                ? 'Valor fixo que a máquina/banco desconta em cada pagamento nessa forma, seja qual for o valor (ex: 0,36).'
                : 'Quanto a máquina/banco desconta quando o cliente paga nessa forma (ex: 0,99).'} Deixe vazio se não tem taxa. Vale só pras vendas novas — as já lançadas não mudam.</div>`;
        box.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => {
            if (ff.tipo === b.dataset.u) return;
            ff.tipo = b.dataset.u;
            ff.taxa = '';
            renderTaxaForma();
        }));
        box.querySelector('[data-taxa-forma]').addEventListener('input', e => { ff.taxa = limparDigitacao(e.target); atualizarSimulacaoForma(); });
        atualizarSimulacaoForma();
    }

    function atualizarSimulacaoForma() {
        const box = el('txFormaSimu');
        if (!box) return;
        const n = lerNumero(ff.taxa);
        const ok = n !== null && !Number.isNaN(n) && n > 0 && n <= (ff.tipo === 'rs' ? LIMITE_RS : 100);
        box.innerHTML = ok ? linhaSimulacao('nessa forma', { tipo: ff.tipo, valor: n }) : '';
        box.style.display = ok ? '' : 'none';
    }

    // Campo de taxa da forma: vazio/0 = sem taxa (valor null); aceita vírgula, até 2 casas; faixa conforme a unidade.
    function lerTaxaForma() {
        const n = lerNumero(ff.taxa);
        if (n === null) return { ok: true, valor: null };
        if (Number.isNaN(n) || n < 0 || n > (ff.tipo === 'rs' ? LIMITE_RS : 100)) return { ok: false };
        return { ok: true, valor: n === 0 ? null : n };
    }

    function salvarForma() {
        const id = formaEmEdicao;
        const forma = id ? getFormasSemTaxa().find(f => f.v === id) : null;
        const comTaxa = !forma || !forma.semTaxa;
        const taxa = comTaxa ? lerTaxaForma() : { ok: true, valor: null };
        const nomeEditavel = !forma || nomeEditavelDaForma(forma);
        const nome = nomeEditavel ? validarNomeDaForma(ff.nome, id) : { ok: true, nome: null };
        if (!nome.ok) { modal({ message: nome.erro }); return; }
        if (!taxa.ok) { modal({ message: `Taxa inválida — ${TEXTO_FAIXA[ff.tipo]}.` }); return; }
        const taxaTipo = taxa.valor && ff.tipo === 'rs' ? 'rs' : null;

        let destino, valor, msgSucesso;
        if (!forma) {
            // Forma nova: o id vem do nome (sem acento/espaço) e não pode repetir.
            const novoId = idDe(nome.nome);
            if (!novoId) { modal({ message: 'Nome inválido — usa letras ou números.' }); return; }
            if (getFormasSemTaxa().find(f => f.v === novoId)) { modal({ message: 'Já existe uma forma de pagamento com esse nome.' }); return; }
            const emoji = String(ff.emoji || '').trim() || '💳';
            destino = novoId;
            valor = { nome: nome.nome, emoji, oculta: false, custom: true, ...(taxa.valor ? { taxa: taxa.valor, ...(taxaTipo ? { taxaTipo } : {}) } : {}) };
            msgSucesso = `✅ ${nome.nome} cadastrada!`;
        } else {
            // Só mexe nos campos que mudaram — o update não toca em oculta/custom/emoji. Nome do Parcelado
            // vazio/padrão apaga o campo (volta a "Parcelado"); nome null só chega aqui pro Parcelado.
            const alteracoes = {};
            const nomeMudou = nomeEditavel && (nome.nome || FORMA_PARCELADO.l) !== forma.l;
            if (nomeMudou) alteracoes.nome = nome.nome;
            if (comTaxa) {
                const atual = window._taxaDaForma(id);
                if ((taxa.valor || null) !== (atual ? atual.valor : null) || (taxa.valor && ff.tipo !== (atual ? atual.tipo : 'pct'))) {
                    alteracoes.taxa = taxa.valor;
                    alteracoes.taxaTipo = taxaTipo;
                }
            }
            if (!Object.keys(alteracoes).length) { voltarParaLista(); return; } // nada mudou: só volta
            destino = id;
            valor = alteracoes;
            msgSucesso = forma.semTaxa
                ? (nome.nome ? `✅ Agora aparece como "${nome.nome}" na hora de fechar a venda. Vale pras vendas novas.` : `✅ Voltou ao nome padrão "${FORMA_PARCELADO.l}". Vale pras vendas novas.`)
                : nomeMudou ? `✅ Agora se chama "${nome.nome}". Vale pras vendas novas.`
                : taxa.valor ? `✅ Taxa de ${window._taxaTexto({ tipo: ff.tipo, valor: taxa.valor })} salva. Vale pras próximas vendas.` : '✅ Taxa removida. Vale pras próximas vendas.';
        }

        const btn = el('txSalvarForma');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        window._dbUpdate(pathRef(`formasPagamentoConfig/${destino}`), valor)
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                voltarParaLista();
                modal({ message: msgSucesso });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
    }

    function excluirForma() {
        const id = formaEmEdicao;
        const nome = getFormasSemTaxa().find(f => f.v === id)?.l || id;
        modal({
            message: `Excluir a forma de pagamento "${nome}"? Isso não muda vendas já lançadas com ela — só some da lista pra novas vendas.`,
            confirmText: 'Excluir',
            cancelText: 'Cancelar',
            onConfirm: () => {
                window._dbRemove(pathRef(`formasPagamentoConfig/${id}`))
                    .then(() => voltarParaLista())
                    .catch(e => modal({ message: `Erro ao excluir: ${e.message}` }));
            }
        });
    }

    // ── Ponto de entrada chamado pelo router ao abrir a tela ──────
    window._initConfigTaxas = function () {
        voltarParaLista();
    };

    // core.js chama isso toda vez que window._maquininhasConfig muda em
    // tempo real (ex: essa própria tela salvou um oculta/padrao — o
    // Firebase confirma e o onValue do core.js dispara de volta aqui).
    // Só re-renderiza se estiver na lista (não interrompe edição aberta).
    window._ctxOnMaquininhasLoaded = function () {
        if (mounted && tela === 'lista') renderTudo();
    };
    window._ctxOnFormasPagamentoLoaded = function () {
        if (mounted && tela === 'lista') renderTudo();
    };
})();
