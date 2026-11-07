// ================================================================
// configuracoes/config-taxas.js — VortexSmart · Config → Taxas & Máquinas
// Registra: window._initConfigTaxas()
//
// Importante sobre onde cada coisa é gravada no Firebase:
//   - rates/{maquina}/{bandeira} = {debito, credito:[...]}
//     ESSA estrutura é a mesma que o CTW (sistema original) usa e
//     depende — NUNCA muda de formato aqui, só os valores. Maquininha
//     SEM bandeira (lista vazia) usa rates/{maquina} = {debito,
//     credito:[...]} direto na raiz, sem sub-chave (mesmo formato que
//     o PagBank sempre usou — agora generalizado pra qualquer
//     maquininha, não só ele).
//   - maquininhasConfig/{maquina} = {nome, maxParcelas, oculta, padrao,
//     bandeiras:[{id,nome}, ...]}
//     Node NOVO, só do VortexSmart. O CTW não sabe que existe.
//     'bandeiras' é a lista de bandeiras DESSA maquininha específica —
//     cada máquina escolhe as suas (0, 2, 3, 4... o que o Gestor
//     cadastrar). Máquina antiga sem esse campo ainda: window
//     ._getBandeirasDaMaquina (core.js) infere a partir de 'rates' e
//     cura sozinha na primeira leitura.
//   - formasPagamentoConfig/{forma} = {oculta, taxa?}
//     Idem, só pro VortexSmart (Dinheiro/Pix e as formas cadastradas
//     pela loja). 'taxa' é opcional: % que essa forma desconta do que a
//     loja recebe (ex: Pix recebido na maquininha). Ausente = sem taxa.
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

    const FORMAS_BASE = [
        { v: 'dinheiro', l: 'Dinheiro', emoji: '💵', grad: 'linear-gradient(135deg,#4ade80,#16a34a)' },
        { v: 'pix', l: 'Pix', emoji: '⚡', grad: 'linear-gradient(135deg,#5eead4,#0891b2)' }
    ];
    // Parcelado (promissória): antes era uma forma "fixa" — aparecia sempre ao fechar a venda e nem existia
    // nesta lista. Agora entra como as outras: dá pra DESATIVAR e RENOMEAR (ex: "Promissória", "Venda a
    // prazo"). Não tem taxa (é uma promessa de pagamento em parcelas, sem maquininha).
    // Guardado em formasPagamentoConfig/parcelado = { nome?, oculta? }. Sem nome salvo = "Parcelado".
    const FORMA_PARCELADO = { v: 'parcelado', l: 'Parcelado', emoji: '🗓️', grad: 'linear-gradient(135deg,#fbbf24,#d97706)', semTaxa: true };
    const NOME_FORMA_MAX = 24;
    function getFormasSemTaxa() {
        const cfg = window._formasPagamentoConfig || {};
        const customIds = Object.keys(cfg).filter(id => cfg[id]?.custom && !FORMAS_BASE.find(f => f.v === id) && id !== FORMA_PARCELADO.v);
        const customs = customIds.map(id => ({
            v: id, l: cfg[id].nome || id, emoji: cfg[id].emoji || '💳',
            grad: 'linear-gradient(135deg,#94a3b8,#475569)'
        }));
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
        const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
        const usados = [...getFormasSemTaxa().filter(f => f.v !== id).map(f => f.l), 'Cartão'].map(norm);
        if (usados.includes(norm(nome))) return { ok: false, erro: 'Já existe uma forma de pagamento com esse nome.' };
        return { ok: true, nome };
    }
    // Taxa % de uma forma sem maquininha (0 = sem taxa). Só aceita número
    // entre 0 e 100 — qualquer outra coisa gravada vira "sem taxa".
    function taxaDaFormaCfg(id) {
        const t = Number((window._formasPagamentoConfig || {})[id]?.taxa);
        return Number.isFinite(t) && t > 0 && t <= 100 ? t : 0;
    }
    const fmtTaxa = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    // Campo de taxa: vazio/0 = sem taxa (null); aceita vírgula; 0 a 100, até 2 casas.
    function lerTaxaDigitada(texto) {
        const bruto = String(texto || '').trim();
        if (bruto === '') return { ok: true, valor: null };
        if (!/^\d+([.,]\d+)?$/.test(bruto)) return { ok: false };
        const n = Number(bruto.replace(',', '.'));
        if (!Number.isFinite(n) || n > 100) return { ok: false };
        return { ok: true, valor: n === 0 ? null : Math.round(n * 100) / 100 };
    }
    const CORES_MAQUINA = [
        'linear-gradient(135deg,#4f8cff,#2563eb)', 'linear-gradient(135deg,#fbbf24,#c2410c)',
        'linear-gradient(135deg,#a78bfa,#5b3df5)', 'linear-gradient(135deg,#5eead4,#0f766e)',
        'linear-gradient(135deg,#f472b6,#be185d)', 'linear-gradient(135deg,#94a3b8,#475569)'
    ];

    let mounted = false;
    let tela = 'lista';          // 'lista' | 'form' | 'form-forma'
    let maquinaEmEdicao = null;  // id da máquina sendo editada (null = cadastro novo)
    let formaEmEdicao = null;    // id da forma cuja taxa está sendo editada (null = cadastro de forma nova)

    // ── Estado da seção "Bandeiras" (cadastro E edição) ────────────
    let bandeirasAtuais   = [];   // [{id, nome}, ...] — lista sendo montada/editada nesse form
    let bandeiraAtiva     = null; // id da bandeira cujo campo de taxa tá visível agora (null = taxa única, sem bandeira)
    let bandeirasRemovidas = [];  // ids removidos NESSA sessão de edição (precisa apagar a taxa deles ao salvar)
    let rascunhoPorBandeira = {}; // guarda em memória o que foi digitado, por bandeira (chave '_unica' = sem bandeira), até salvar

    function todasAsMaquinas() {
        const cfg = window._maquininhasConfig || {};
        const idsComTaxa = window._rates ? Object.keys(window._rates) : [];
        // Config sem taxa E sem nome = resíduo "só bandeiras" (máquina fantasma de versões antigas): não listar.
        const idsSoConfig = Object.keys(cfg).filter(id => !idsComTaxa.includes(id) && cfg[id]?.nome);
        return [...idsComTaxa, ...idsSoConfig].map((id, i) => {
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
                padrao: !!cfg[id]?.padrao,
                cor: CORES_MAQUINA[i % CORES_MAQUINA.length]
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
            if (tela !== 'lista') { tela = 'lista'; renderTudo(); }
            else history.back();
        });
        mounted = true;
    }

    function renderTudo() {
        ensureSkeleton();
        el('ctxTitulo').textContent = tela === 'lista' ? 'Taxas & Máquinas'
            : tela === 'form-forma' ? (formaEmEdicao ? 'Taxa da Forma de Pagamento' : 'Nova Forma de Pagamento')
            : (maquinaEmEdicao ? 'Editar Maquininha' : 'Nova Maquininha');
        if (tela === 'lista') renderLista(); else renderForm();
    }

    // ══════════════════════ TELA: LISTA ══════════════════════
    function renderLista() {
        const formasCfg = window._formasPagamentoConfig || {};
        const maquinas = todasAsMaquinas();

        el('ctxBody').innerHTML = `
            <div class="cfg-section-title">Formas de Pagamento</div>
            <div class="cfgA-card mb-2" id="ctxFormasList">
                ${getFormasSemTaxa().map(f => {
                    const oculta = !!formasCfg[f.v]?.oculta;
                    const ehCustom = !!formasCfg[f.v]?.custom;
                    const taxa = f.semTaxa ? 0 : taxaDaFormaCfg(f.v);
                    return `
                    <div class="cfgA-row" style="cursor:default;">
                        <div class="cfgA-icon" style="background:${f.grad};">${f.emoji}</div>
                        <div class="cfgA-name">${esc(f.l)}${f.semTaxa ? ` <span class="ctx-badge-default" style="margin-left:6px;">parcelas</span>` : (taxa > 0 ? ` <span class="ctx-badge-default" style="margin-left:6px;">taxa ${fmtTaxa(taxa)}%</span>` : '')}</div>
                        <button type="button" class="ctx-icon-btn" data-taxa-forma="${f.v}" aria-label="${f.semTaxa ? 'Editar nome' : 'Editar taxa'}" style="margin-right:6px;">✏️</button>
                        <button type="button" class="ctx-switch ${oculta ? '' : 'on'}" data-forma="${f.v}" aria-label="Mostrar/ocultar"></button>
                        ${ehCustom ? `<button type="button" class="ctx-icon-btn" data-excluir-forma="${f.v}" aria-label="Excluir" style="margin-left:6px;">🗑️</button>` : ''}
                    </div>`;
                }).join('')}
            </div>
            <button type="button" class="ctx-add-btn mb-3" id="ctxNovaFormaBtn"><i class="bi bi-plus-lg"></i> Cadastrar Nova Forma de Pagamento</button>

            <div class="cfg-section-title">Maquininhas de Cartão</div>
            <div id="ctxMaquinasList"></div>
            <button type="button" class="ctx-add-btn" id="ctxNovaMaquinaBtn"><i class="bi bi-plus-lg"></i> Cadastrar Nova Maquininha</button>
        `;

        el('ctxMaquinasList').innerHTML = maquinas.map(m => `
            <div class="ctx-machine-card ${m.oculta ? 'ctx-hidden' : ''}" data-m="${m.v}">
                <div class="ctx-machine-top">
                    <div class="ctx-machine-ic" style="background:${m.cor};">💳</div>
                    <div class="ctx-machine-name-row">
                        <div class="ctx-machine-name">${esc(m.l)}</div>
                        ${m.padrao ? `<span class="ctx-badge-default">PADRÃO</span>` : ''}
                    </div>
                    <div class="ctx-machine-actions">
                        <button type="button" class="ctx-icon-btn" data-toggle-oculta="${m.v}" aria-label="Ocultar/mostrar">${m.oculta ? '🙈' : '👁️'}</button>
                        <button type="button" class="ctx-icon-btn" data-editar="${m.v}" aria-label="Editar">✏️</button>
                        <button type="button" class="ctx-icon-btn" data-excluir-maquina="${m.v}" aria-label="Excluir">🗑️</button>
                    </div>
                </div>
                <div class="ctx-machine-summary">${resumoTaxa(m)}</div>
                ${!m.padrao ? `<div class="ctx-machine-footer"><button type="button" class="ctx-foot-btn ctx-foot-primary" data-padrao="${m.v}">★ Definir como padrão</button></div>` : ''}
            </div>
        `).join('') || `<div class="stq-hist-sub text-center py-3">Nenhuma maquininha cadastrada ainda.</div>`;

        el('ctxFormasList').querySelectorAll('[data-forma]').forEach(btn => {
            btn.addEventListener('click', () => {
                const forma = btn.dataset.forma;
                const atual = !!(window._formasPagamentoConfig || {})[forma]?.oculta;
                window._dbUpdate(pathRef(`formasPagamentoConfig/${forma}`), { oculta: !atual })
                    .catch(e => modal({ message: `Erro ao salvar: ${e.message}` }));
            });
        });

        el('ctxFormasList').querySelectorAll('[data-taxa-forma]').forEach(btn => {
            btn.addEventListener('click', () => {
                formaEmEdicao = btn.dataset.taxaForma;
                tela = 'form-forma';
                renderTudo();
            });
        });

        el('ctxFormasList').querySelectorAll('[data-excluir-forma]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.excluirForma;
                const nome = getFormasSemTaxa().find(f => f.v === id)?.l || id;
                modal({
                    message: `Excluir a forma de pagamento "${nome}"? Isso não muda vendas já lançadas com ela — só some da lista pra novas vendas.`,
                    confirmText: 'Excluir',
                    cancelText: 'Cancelar',
                    onConfirm: () => {
                        window._dbRemove(pathRef(`formasPagamentoConfig/${id}`))
                            .then(() => renderTudo())
                            .catch(e => modal({ message: `Erro ao excluir: ${e.message}` }));
                    }
                });
            });
        });

        el('ctxMaquinasList').querySelectorAll('[data-toggle-oculta]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.toggleOculta;
                const atual = !!(window._maquininhasConfig || {})[id]?.oculta;
                window._dbUpdate(pathRef(`maquininhasConfig/${id}`), { oculta: !atual })
                    .catch(e => modal({ message: `Erro ao salvar: ${e.message}` }));
            });
        });

        // Definir como padrão — update multi-path atômico (limpa os outros)
        el('ctxMaquinasList').querySelectorAll('[data-padrao]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.padrao;
                const updates = {};
                maquinas.forEach(m => { updates[`maquininhasConfig/${m.v}/padrao`] = (m.v === id); });
                window._dbUpdate(dbRoot(), updates)
                    .catch(e => modal({ message: `Erro ao definir padrão: ${e.message}` }));
            });
        });

        el('ctxMaquinasList').querySelectorAll('[data-editar]').forEach(btn => {
            btn.addEventListener('click', () => abrirEdicao(btn.dataset.editar));
        });

        // Excluir máquina de verdade — ação sem volta, por isso pede confirmação.
        el('ctxMaquinasList').querySelectorAll('[data-excluir-maquina]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.excluirMaquina;
                const m = maquinas.find(x => x.v === id);
                const nome = m?.l || id;
                const temTaxa = !!(window._rates && window._rates[id]);
                const aviso = `Excluir "${nome}"? Essa ação não tem volta.`;
                modal({
                    message: aviso,
                    confirmText: 'Excluir',
                    cancelText: 'Cancelar',
                    onConfirm: () => {
                        const updates = { [`maquininhasConfig/${id}`]: null };
                        if (temTaxa) updates[`rates/${id}`] = null;
                        window._dbUpdate(dbRoot(), updates)
                            .then(() => renderTudo())
                            .catch(e => modal({ message: `Erro ao excluir: ${e.message}` }));
                    }
                });
            });
        });

        el('ctxNovaMaquinaBtn')?.addEventListener('click', abrirCadastro);
        el('ctxNovaFormaBtn')?.addEventListener('click', abrirCadastroForma);
    }

    function resumoTaxa(m) {
        const rt = (window._rates || {})[m.v];
        if (!rt) return 'Sem taxa cadastrada ainda.';
        const bandeiras = getBandeirasDaMaquina(m.v);
        const base = bandeiras.length ? (rt[bandeiras[0].id] || rt[Object.keys(rt)[0]]) : rt;
        if (!base || base.debito == null) return 'Sem taxa cadastrada ainda.';
        const debito = `${String(base.debito).replace('.', ',')}%`;
        return `Débito ${debito} · Crédito 1x a <b>${m.maxParcelas}x</b>`;
    }

    // ══════════════════════ TELA: FORM (cadastro/edição) ══════════════════════
    function abrirCadastro() {
        maquinaEmEdicao = null;
        bandeirasAtuais = [];
        bandeiraAtiva = null;
        bandeirasRemovidas = [];
        rascunhoPorBandeira = {};
        tela = 'form';
        renderTudo();
    }

    function abrirEdicao(id) {
        maquinaEmEdicao = id;
        bandeirasAtuais = getBandeirasDaMaquina(id).map(b => ({ ...b }));
        bandeiraAtiva = bandeirasAtuais[0]?.id || null;
        bandeirasRemovidas = [];
        rascunhoPorBandeira = {};
        tela = 'form';
        renderTudo();
    }

    function renderForm() {
        if (tela === 'form-forma') { renderFormForma(); return; }
        if (!maquinaEmEdicao) renderFormCadastro(); else renderFormEdicao();
    }

    // ── Cadastro de nova Forma de Pagamento (tipo Dinheiro/Pix; taxa opcional) e
    //    edição da taxa de uma forma existente (Dinheiro, Pix ou cadastrada) ──
    function abrirCadastroForma() {
        formaEmEdicao = null;
        tela = 'form-forma';
        renderTudo();
    }

    function renderFormForma() {
        const editando = formaEmEdicao ? getFormasSemTaxa().find(f => f.v === formaEmEdicao) : null;
        if (formaEmEdicao && !editando) { // a forma foi excluída enquanto a tela estava aberta
            formaEmEdicao = null;
            tela = 'lista';
            renderTudo();
            return;
        }
        const taxaAtual = editando && !editando.semTaxa ? taxaDaFormaCfg(editando.v) : 0;
        // Parcelado e as formas cadastradas têm nome editável; Dinheiro e Pix têm nome fixo.
        const nomeEditavel = !!editando && (editando.semTaxa || !!(window._formasPagamentoConfig || {})[editando.v]?.custom);
        el('ctxBody').innerHTML = `
            <div class="cfgA-card" style="padding:14px;margin-bottom:14px;">
                ${editando && nomeEditavel ? `
                <label class="ctx-field-label">Nome que aparece na venda</label>
                <input class="ctx-field-input" id="ctxFormaNomeEditar" maxlength="${NOME_FORMA_MAX}" value="${esc(editando.l)}" placeholder="Ex: Promissória">
                ${editando.semTaxa ? `<div class="stq-hist-sub mt-1">Ex: Promissória, Venda a prazo. Deixe vazio pra voltar a "${esc(FORMA_PARCELADO.l)}". Vale só pras vendas novas — as vendas antigas continuam com o nome que tinham.</div>` : ''}
                ` : editando ? `
                <label class="ctx-field-label">Forma de pagamento</label>
                <div class="ctx-field-input" style="opacity:.75;">${editando.emoji} ${esc(editando.l)}</div>
                ` : `
                <label class="ctx-field-label">Nome</label>
                <input class="ctx-field-input" id="ctxFormaNome" placeholder="Ex: Vale Alimentação">
                <label class="ctx-field-label mt-2">Emoji (opcional)</label>
                <input class="ctx-field-input" id="ctxFormaEmoji" placeholder="💳" maxlength="2">
                `}
                ${editando && editando.semTaxa ? '' : `
                <label class="ctx-field-label mt-2">Taxa descontada (%) — opcional</label>
                <input class="ctx-field-input" id="ctxFormaTaxa" inputmode="decimal" placeholder="0" value="${taxaAtual ? String(taxaAtual).replace('.', ',') : ''}">
                <div class="stq-hist-sub mt-2">Quanto a máquina/banco desconta quando o cliente paga nessa forma (ex: 0,99). Deixe vazio se não tem taxa. Vale só pras vendas novas — as já lançadas não mudam.</div>
                `}
            </div>
            <button type="button" class="ctx-add-btn ctx-add-btn-solid" id="ctxSalvarFormaBtn"><i class="bi bi-check-lg"></i> ${editando ? (nomeEditavel ? 'Salvar' : 'Salvar taxa') : 'Cadastrar Forma de Pagamento'}</button>
        `;
        el('ctxSalvarFormaBtn')?.addEventListener('click', editando ? (nomeEditavel ? salvarEdicaoForma : salvarTaxaForma) : salvarNovaForma);
    }

    // Parcelado e formas cadastradas: grava o NOME (e a taxa, nas que têm). Só mexe nos campos que mudaram —
    // o update não toca em oculta/custom/emoji. Nome do Parcelado vazio/padrão apaga o campo (volta a "Parcelado").
    function salvarEdicaoForma() {
        const id = formaEmEdicao;
        const forma = getFormasSemTaxa().find(f => f.v === id);
        if (!forma) return;
        const nome = validarNomeDaForma(el('ctxFormaNomeEditar')?.value, id);
        if (!nome.ok) { modal({ message: nome.erro }); return; }
        const nomeMudou = (nome.nome || FORMA_PARCELADO.l) !== forma.l;
        const alteracoes = {};
        if (nomeMudou) alteracoes.nome = nome.nome; // null = apaga (só o Parcelado chega aqui com null)
        let taxa = null;
        if (!forma.semTaxa) {
            taxa = lerTaxaDigitada(el('ctxFormaTaxa')?.value);
            if (!taxa.ok) { modal({ message: 'Taxa inválida — use um número de 0 a 100 (ex: 0,99).' }); return; }
            if (taxa.valor !== (taxaDaFormaCfg(id) || null)) alteracoes.taxa = taxa.valor;
        }
        const msgSucesso = () => {
            if (forma.semTaxa) return nome.nome ? `✅ Agora aparece como "${nome.nome}" na hora de fechar a venda. Vale pras vendas novas.` : `✅ Voltou ao nome padrão "${FORMA_PARCELADO.l}". Vale pras vendas novas.`;
            if (nomeMudou) return `✅ Agora se chama "${nome.nome}". Vale pras vendas novas.`;
            return taxa && taxa.valor ? `✅ Taxa de ${fmtTaxa(taxa.valor)}% salva. Vale pras próximas vendas.` : '✅ Taxa removida. Vale pras próximas vendas.';
        };
        const voltar = () => { formaEmEdicao = null; tela = 'lista'; renderTudo(); };
        if (!Object.keys(alteracoes).length) { voltar(); return; } // nada mudou: só volta
        const btn = el('ctxSalvarFormaBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        window._dbUpdate(pathRef(`formasPagamentoConfig/${id}`), alteracoes)
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                voltar();
                modal({ message: msgSucesso() });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
    }

    function salvarTaxaForma() {
        const taxa = lerTaxaDigitada(el('ctxFormaTaxa')?.value);
        if (!taxa.ok) { modal({ message: 'Taxa inválida — use um número de 0 a 100 (ex: 0,99).' }); return; }
        const id = formaEmEdicao;
        const btn = el('ctxSalvarFormaBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        // taxa null remove o campo (= sem taxa); update não mexe em nome/oculta/custom.
        window._dbUpdate(pathRef(`formasPagamentoConfig/${id}`), { taxa: taxa.valor })
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                formaEmEdicao = null;
                tela = 'lista';
                renderTudo();
                modal({ message: taxa.valor ? `✅ Taxa de ${fmtTaxa(taxa.valor)}% salva. Vale pras próximas vendas.` : '✅ Taxa removida. Vale pras próximas vendas.' });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
    }

    function salvarNovaForma() {
        const nome = el('ctxFormaNome')?.value.trim();
        const emoji = el('ctxFormaEmoji')?.value.trim() || '💳';
        if (!nome) { modal({ message: 'Dá um nome pra forma de pagamento.' }); return; }
        const id = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
        if (!id) { modal({ message: 'Nome inválido — usa letras ou números.' }); return; }
        if (getFormasSemTaxa().find(f => f.v === id)) { modal({ message: 'Já existe uma forma de pagamento com esse nome.' }); return; }
        const taxa = lerTaxaDigitada(el('ctxFormaTaxa')?.value);
        if (!taxa.ok) { modal({ message: 'Taxa inválida — use um número de 0 a 100 (ex: 0,99).' }); return; }

        const btn = el('ctxSalvarFormaBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        window._dbUpdate(pathRef(`formasPagamentoConfig/${id}`), { nome, emoji, oculta: false, custom: true, ...(taxa.valor ? { taxa: taxa.valor } : {}) })
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                tela = 'lista';
                renderTudo();
                modal({ message: `✅ ${nome} cadastrada!` });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao cadastrar: ${e.message}` });
            });
    }

    // ── Seção "Bandeiras" — compartilhada entre cadastro e edição ──
    // Chave usada em rascunhoPorBandeira: o id da bandeira ativa, ou
    // '_unica' quando a maquininha não tem NENHUMA bandeira (taxa única,
    // igual o PagBank sempre funcionou — agora vale pra qualquer uma).
    function chaveAtual() { return bandeiraAtiva || '_unica'; }

    function htmlSecaoBandeiras() {
        return `
            <div class="cfgA-card mb-3" style="padding:14px;">
                <div class="cfg-section-title" style="margin-top:0;">Bandeiras</div>
                <div class="stq-hist-sub mb-2" style="font-size:.7rem;line-height:1.4;">Cada bandeira pode ter sua própria taxa. Sem nenhuma, é uma taxa única pra essa maquininha inteira.</div>
                <div id="bandeirasChipsWrap" class="ctx-bandeira-chips-dyn"></div>
                <div id="bandeirasEmptyMsg" class="ctx-bandeiras-empty">
                    <i class="bi bi-info-circle"></i>
                    <span>Sem bandeiras cadastradas — a taxa abaixo vale pra qualquer cartão nessa maquininha.</span>
                </div>
                <div id="bandeiraAddRow">
                    <button type="button" class="ctx-add-btn" id="btnMostrarAddBandeira" style="margin-top:2px;"><i class="bi bi-plus-lg"></i> Adicionar bandeira</button>
                </div>
                <div id="bandeiraAddInline" class="ctx-bandeira-add-inline" style="display:none;">
                    <input class="ctx-field-input" id="novaBandeiraNomeInput" placeholder="Ex: Visa, Elo, Ticket..." style="flex:1;">
                    <button type="button" class="btn-icon-circle ctx-bandeira-add-ok" id="btnConfirmarAddBandeira" aria-label="Confirmar"><i class="bi bi-check-lg"></i></button>
                    <button type="button" class="btn-icon-circle" id="btnCancelarAddBandeira" aria-label="Cancelar"><i class="bi bi-x-lg"></i></button>
                </div>
            </div>
        `;
    }

    function wireSecaoBandeiras(onMudou) {
        renderBandeirasChips(onMudou);
        el('btnMostrarAddBandeira')?.addEventListener('click', () => {
            el('bandeiraAddRow').style.display = 'none';
            el('bandeiraAddInline').style.display = 'flex';
            el('novaBandeiraNomeInput')?.focus();
        });
        el('btnCancelarAddBandeira')?.addEventListener('click', () => {
            el('bandeiraAddInline').style.display = 'none';
            el('bandeiraAddRow').style.display = 'block';
            if (el('novaBandeiraNomeInput')) el('novaBandeiraNomeInput').value = '';
        });
        el('btnConfirmarAddBandeira')?.addEventListener('click', () => {
            const nome = el('novaBandeiraNomeInput')?.value.trim();
            if (!nome) return;
            const id = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
            if (!id) { modal({ message: 'Nome inválido — usa letras ou números.' }); return; }
            if (bandeirasAtuais.find(b => b.id === id)) { modal({ message: 'Já tem uma bandeira com esse nome nessa maquininha.' }); return; }
            salvarRascunhoAtual(); // guarda o que já tava digitado antes de trocar de aba
            const primeira = bandeirasAtuais.length === 0;
            bandeirasAtuais.push({ id, nome });
            // Se era taxa única e essa é a primeira bandeira, aproveita o
            // que já tinha sido digitado em vez de pedir de novo.
            if (primeira && rascunhoPorBandeira._unica) rascunhoPorBandeira[id] = rascunhoPorBandeira._unica;
            bandeiraAtiva = id;
            onMudou();
        });
    }

    function renderBandeirasChips(onMudou) {
        const wrap = el('bandeirasChipsWrap');
        const empty = el('bandeirasEmptyMsg');
        if (!wrap || !empty) return;
        if (!bandeirasAtuais.length) {
            wrap.style.display = 'none';
            empty.style.display = 'flex';
            return;
        }
        wrap.style.display = 'flex';
        empty.style.display = 'none';
        if (!bandeirasAtuais.find(b => b.id === bandeiraAtiva)) bandeiraAtiva = bandeirasAtuais[0].id;
        wrap.innerHTML = bandeirasAtuais.map(b => `
            <div class="ctx-bandeira-chip-dyn ${b.id === bandeiraAtiva ? 'on' : ''}" data-id="${b.id}">
                <span>${esc(b.nome)}</span>
                <span class="ctx-bandeira-chip-x" data-remover="${b.id}"><i class="bi bi-x"></i></span>
            </div>
        `).join('');
        wrap.querySelectorAll('.ctx-bandeira-chip-dyn').forEach(chip => {
            chip.addEventListener('click', e => {
                if (e.target.closest('[data-remover]')) return;
                salvarRascunhoAtual();
                bandeiraAtiva = chip.dataset.id;
                onMudou();
            });
        });
        wrap.querySelectorAll('[data-remover]').forEach(x => {
            x.addEventListener('click', e => {
                e.stopPropagation();
                const id = x.dataset.remover;
                bandeirasAtuais = bandeirasAtuais.filter(b => b.id !== id);
                delete rascunhoPorBandeira[id];
                if (maquinaEmEdicao && !bandeirasRemovidas.includes(id)) bandeirasRemovidas.push(id);
                bandeiraAtiva = bandeirasAtuais[0]?.id || null;
                onMudou();
            });
        });
    }

    // ── Cadastro: uma taxa (ou uma por bandeira) ────────────────────
    function renderFormCadastro() {
        const setAtual = rascunhoPorBandeira[chaveAtual()] || {};
        const nomeAtiva = bandeiraAtiva ? bandeirasAtuais.find(b => b.id === bandeiraAtiva)?.nome : null;

        el('ctxBody').innerHTML = `
            <div class="cfgA-card mb-3" style="padding:14px;">
                <label class="ctx-field-label">Nome da Maquininha</label>
                <input class="ctx-field-input" id="ctxNovoNome" placeholder="Ex: GetNet" value="${esc(el('ctxNovoNome')?.value || '')}">
                <label class="ctx-field-label mt-2">Máximo de parcelas no crédito</label>
                <input class="ctx-field-input" id="ctxNovoMax" type="number" min="1" max="24" value="${el('ctxNovoMax')?.value || 12}">
            </div>

            ${htmlSecaoBandeiras()}

            <div class="cfgA-card mb-3" style="padding:14px;">
                <label class="ctx-field-label">Taxa Débito${nomeAtiva ? ` · ${esc(nomeAtiva)}` : ''} (%)</label>
                <input class="ctx-field-input" id="ctxNovoDebito" type="number" step="0.01" placeholder="Ex: 1,99" value="${setAtual.debito ?? ''}">
                <label class="ctx-field-label mt-2">Taxa Crédito 1x${nomeAtiva ? ` · ${esc(nomeAtiva)}` : ''} (%)</label>
                <input class="ctx-field-input" id="ctxNovoCred1" type="number" step="0.01" placeholder="Ex: 3,19" value="${(setAtual.credito && setAtual.credito[0]) ?? ''}">
                <div class="stq-hist-sub mt-2" style="font-size:.68rem;"><i class="bi bi-info-circle"></i> As demais parcelas (2x até o máximo) começam com uma progressão simples entre essas duas taxas — dá pra ajustar parcela por parcela depois, no lápis de editar.</div>
            </div>
            <button type="button" class="ctx-add-btn ctx-add-btn-solid" id="ctxSalvarNovoBtn"><i class="bi bi-check-lg"></i> Cadastrar Maquininha</button>
        `;

        wireSecaoBandeiras(renderFormCadastro);
        el('ctxSalvarNovoBtn')?.addEventListener('click', salvarNovaMaquina);
    }

    function salvarRascunhoAtual() {
        const debitoEl = el('ctxNovoDebito') || el('ctxEditDebito');
        if (!debitoEl) return; // form ainda não montou os campos de taxa
        const debito = parseFloat(debitoEl.value);
        const cred1El = el('ctxNovoCred1');
        const credito = cred1El ? [isNaN(parseFloat(cred1El.value)) ? undefined : parseFloat(cred1El.value)] : coletarCreditoAtual();
        if (isNaN(debito) && (!credito.length || credito[0] === undefined)) return; // nada digitado ainda, não grava rascunho vazio
        rascunhoPorBandeira[chaveAtual()] = { debito: isNaN(debito) ? undefined : debito, credito };
    }

    function gerarCreditoLinear(debito, cred1, max) {
        const tetoEstimado = debito + (cred1 - debito) * 3 + (max - 1) * 1.1;
        return Array.from({ length: max }, (_, i) => {
            if (max === 1) return +cred1.toFixed(2);
            const t = i / (max - 1);
            return +(cred1 + (tetoEstimado - cred1) * t).toFixed(2);
        });
    }

    function salvarNovaMaquina() {
        salvarRascunhoAtual();
        const nome = el('ctxNovoNome')?.value.trim();
        const max = parseInt(el('ctxNovoMax')?.value, 10) || 12;
        if (!nome) { modal({ message: 'Dá um nome pra maquininha.' }); return; }

        const id = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
        if (!id) { modal({ message: 'Nome inválido — usa letras ou números.' }); return; }
        if ((window._rates || {})[id] || (window._maquininhasConfig || {})[id]) {
            modal({ message: 'Já existe uma maquininha com esse nome.' }); return;
        }

        const btn = el('ctxSalvarNovoBtn');
        const updates = { [`maquininhasConfig/${id}`]: { nome, maxParcelas: max, oculta: false, padrao: false, bandeiras: bandeirasAtuais } };

        if (!bandeirasAtuais.length) {
            const draft = rascunhoPorBandeira._unica || {};
            if (draft.debito == null || draft.credito?.[0] == null) { modal({ message: 'Preenche a taxa de débito e a de crédito 1x.' }); return; }
            updates[`rates/${id}`] = { debito: draft.debito, credito: gerarCreditoLinear(draft.debito, draft.credito[0], max) };
        } else {
            // Bandeira sem taxa preenchida herda da primeira que foi
            // preenchida (não obriga digitar uma por uma). Checa
            // debito/credito de verdade, não só "existe uma entrada" —
            // clicar numa bandeira sem preencher nada já cria uma
            // entrada em rascunhoPorBandeira (com os campos vazios), e
            // achar que isso conta como "preenchida" gerava taxa NaN
            // (Firebase recusa o update inteiro com NaN, sem aviso
            // claro do motivo).
            const estaPreenchida = bid => rascunhoPorBandeira[bid]?.debito != null && rascunhoPorBandeira[bid]?.credito?.[0] != null;
            const preenchidas = bandeirasAtuais.filter(b => estaPreenchida(b.id));
            if (!preenchidas.length) { modal({ message: 'Preenche ao menos a taxa de uma bandeira.' }); return; }
            const referencia = rascunhoPorBandeira[preenchidas[0].id];
            bandeirasAtuais.forEach(b => {
                const draft = estaPreenchida(b.id) ? rascunhoPorBandeira[b.id] : referencia;
                updates[`rates/${id}/${b.id}`] = { debito: draft.debito, credito: gerarCreditoLinear(draft.debito, draft.credito[0], max) };
            });
        }

        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        window._dbUpdate(dbRoot(), updates)
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                tela = 'lista';
                renderTudo();
                modal({ message: `✅ ${nome} cadastrada!` });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao cadastrar: ${e.message}` });
            });
    }

    // ── Edição ───────────────────────────────────────────────────
    function renderFormEdicao() {
        const cfg = (window._maquininhasConfig || {})[maquinaEmEdicao] || {};
        const nome = cfg.nome || maquinaEmEdicao;
        const max = cfg.maxParcelas || (typeof window._inferirMaxParcelas === 'function' ? window._inferirMaxParcelas(maquinaEmEdicao) : null) || 12;
        const rt = (window._rates || {})[maquinaEmEdicao] || {};
        const setSalvo = bandeiraAtiva ? (rt[bandeiraAtiva] || {}) : rt;
        const setAtual = rascunhoPorBandeira[chaveAtual()] || setSalvo;
        const nomeAtiva = bandeiraAtiva ? bandeirasAtuais.find(b => b.id === bandeiraAtiva)?.nome : null;

        el('ctxBody').innerHTML = `
            <div class="cfgA-card mb-3" style="padding:14px;">
                <label class="ctx-field-label">Nome da Maquininha</label>
                <input class="ctx-field-input" id="ctxEditNome" value="${esc(nome)}">
                <label class="ctx-field-label mt-2">Máximo de parcelas no crédito</label>
                <input class="ctx-field-input" id="ctxEditMax" type="number" min="1" max="24" value="${max}">
            </div>

            ${htmlSecaoBandeiras()}

            <div class="cfg-section-title" id="ctxEditDebitoTitulo">Taxa Débito${nomeAtiva ? ` · ${esc(nomeAtiva)}` : ''}</div>
            <div class="cfgA-card mb-2" style="padding:12px 14px;">
                <input class="ctx-field-input" id="ctxEditDebito" type="number" step="0.01" value="${setAtual.debito ?? ''}">
            </div>

            <div class="cfg-section-title">Taxa de crédito por parcela</div>
            <div class="cfgA-card" id="ctxParcelasList"></div>

            <button type="button" class="ctx-add-btn ctx-add-btn-solid" id="ctxSalvarEdicaoBtn" style="margin-top:14px;"><i class="bi bi-check-lg"></i> Salvar Maquininha</button>
        `;

        renderParcelasList(setAtual.credito || []);
        el('ctxEditMax')?.addEventListener('input', () => renderParcelasList(coletarCreditoAtual()));
        wireSecaoBandeiras(renderFormEdicao);
        el('ctxSalvarEdicaoBtn')?.addEventListener('click', salvarEdicaoCompleta);
    }

    function coletarCreditoAtual() {
        const inputs = el('ctxParcelasList')?.querySelectorAll('.ctx-parc-input');
        return inputs ? Array.from(inputs).map(i => parseFloat(i.value) || 0) : [];
    }

    function renderParcelasList(creditoAtual) {
        const max = parseInt(el('ctxEditMax')?.value, 10) || creditoAtual.length || 12;
        el('ctxParcelasList').innerHTML = Array.from({ length: max }, (_, i) => `
            <div class="ctx-parc-row">
                <div class="ctx-parc-n">${i + 1}x</div>
                <input class="ctx-parc-input" type="number" step="0.01" value="${creditoAtual[i] ?? ''}">
                <span class="ctx-parc-pct">%</span>
            </div>
        `).join('');
    }

    function salvarEdicaoCompleta() {
        salvarRascunhoAtual();
        const nome = el('ctxEditNome')?.value.trim() || maquinaEmEdicao;
        const max = parseInt(el('ctxEditMax')?.value, 10) || 12;

        const btn = el('ctxSalvarEdicaoBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');

        const updates = {
            [`maquininhasConfig/${maquinaEmEdicao}/nome`]: nome,
            [`maquininhasConfig/${maquinaEmEdicao}/maxParcelas`]: max,
            [`maquininhasConfig/${maquinaEmEdicao}/bandeiras`]: bandeirasAtuais
        };

        if (!bandeirasAtuais.length) {
            // Nota: não apaga bandeira individual aqui (rates/{id}/{bandeira})
            // — substituir o node 'rates/{id}' inteiro já limpa qualquer
            // sub-chave antiga sozinho. Incluir os dois no mesmo update()
            // (um caminho e um caminho FILHO dele) faria o Firebase recusar
            // a operação inteira (caminhos ancestrais não podem conviver
            // num update multi-path).
            const only = rascunhoPorBandeira._unica;
            if (only && only.debito != null && only.credito?.[0] != null) {
                updates[`rates/${maquinaEmEdicao}`] = { debito: only.debito, credito: only.credito };
            }
        } else {
            // Se essa maquininha ERA achatada (taxa única, debito/credito
            // direto na raiz) e ganhou bandeira agora, limpa os campos
            // antigos — senão os dois formatos ficam misturados e
            // getRate() (core.js) acha que ainda é achatada, já que ela
            // checa debito/credito antes de olhar bandeira.
            updates[`rates/${maquinaEmEdicao}/debito`] = null;
            updates[`rates/${maquinaEmEdicao}/credito`] = null;
            bandeirasRemovidas.forEach(id => { updates[`rates/${maquinaEmEdicao}/${id}`] = null; });
            bandeirasAtuais.forEach(b => {
                const draft = rascunhoPorBandeira[b.id];
                if (draft && draft.debito != null && draft.credito?.[0] != null) updates[`rates/${maquinaEmEdicao}/${b.id}`] = draft;
            });
        }

        window._dbUpdate(dbRoot(), updates)
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                rascunhoPorBandeira = {};
                tela = 'lista';
                renderTudo();
                modal({ message: '✅ Maquininha atualizada!' });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
    }

    // ── Ponto de entrada chamado pelo router ao abrir a tela ──────
    window._initConfigTaxas = function () {
        tela = 'lista';
        maquinaEmEdicao = null;
        bandeirasAtuais = [];
        bandeiraAtiva = null;
        bandeirasRemovidas = [];
        rascunhoPorBandeira = {};
        renderTudo();
    };

    // core.js chama isso toda vez que window._maquininhasConfig muda em
    // tempo real (ex: essa própria tela salvou um oculta/padrao — o
    // Firebase confirma e o onValue do core.js dispara de volta aqui).
    // Só re-renderiza se estiver na lista (não interrompe edição aberta).
    window._ctxOnMaquininhasLoaded = function () {
        if (mounted && tela === 'lista' && !maquinaEmEdicao) renderTudo();
    };
    window._ctxOnFormasPagamentoLoaded = function () {
        if (mounted && tela === 'lista' && !maquinaEmEdicao) renderTudo();
    };
})();
