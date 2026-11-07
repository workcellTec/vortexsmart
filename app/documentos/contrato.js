// ================================================================
// documentos/contrato.js — VortexSmart · Contrato Dinâmico
// Registra: window._initContrato()
// O contrato é definido pela loja em Configurações → Documentos,
// usando tags {{tipo:id:rótulo}}. Este módulo faz o parse do
// modelo, monta o formulário automaticamente, calcula os campos
// {{calc:...}} e gera o documento final (imagem/compartilhar).
// Depende de (via window.*):
//   showCustomModal, escapeHtml, window.jspdf.jsPDF,
//   _lojaRef, _dbOnValue, _dbUpdate, _dbPush,
//   _dbGet, _dbRemove, openDocumentosSection, openConfiguracoesSection
// ================================================================
(function () {
    'use strict';
    // yyyy-mm-dd no fuso do computador. toISOString() é UTC: depois das 21h no Brasil já dá "amanhã".
    const dataLocalISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const el    = id   => document.getElementById(id);
    const esc   = t    => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt   = v    => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    // dbref(caminho) agora monta a referência DENTRO da loja logada —
    // todas as chamadas existentes já ficam isoladas por loja
    // automaticamente, sem precisar editar cada uma individualmente.
    const dbref = (caminho) => window._lojaRef(caminho);

    const CFG_PATH  = 'configuracoes/documentos';
    const TIPOS_INPUT = ['texto', 'numero', 'moeda', 'data', 'escolha'];
    const TIPOS_AUTO  = ['calc', 'hoje', 'diadata']; // calculados sozinhos, sem campo pro usuário preencher

    // Ex: {{moeda:valor_parcela:Valor da Parcela}}
    const TAG_RE = /\{\{\s*([a-zA-Z]+)\s*:\s*([a-zA-Z0-9_]+)\s*:\s*([^}]+?)\s*\}\}/g;

    const CT = {
        initialized: false,
        view: 'novo',        // 'novo' | 'historico'
        template: '',
        storeConfig: {},
        fields: [],           // [{tipo, id, label}]
        calc: [],              // [{id, formula}]
        editId: null,
        cache: [],
        listenerAttached: false,
    };

    window._initContrato = function () {
        if (!CT.initialized) {
            renderShell();
            attachListeners();
            CT.initialized = true;
        }
        carregarTemplate();
        if (!CT.listenerAttached) {
            loadHistorico();
            CT.listenerAttached = true;
        }
    };

    // ── Estrutura da tela ────────────────────────────────────────
    function renderShell() {
        const wrap = el('documentosContrato');
        if (!wrap) return;
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Contrato</h3>
            </div>
            <div class="content-card w-100" style="padding-bottom:110px;">

                <div id="ctSemTemplate" style="display:none;text-align:center;padding:2.5rem 0;">
                    <i class="bi bi-file-earmark-text" style="font-size:2.5rem;"></i>
                    <p class="mt-2 mb-3">Nenhum modelo de contrato configurado ainda.</p>
                    <button class="btn btn-primary" id="ctIrConfig"><i class="bi bi-gear"></i> Configurar Contrato</button>
                </div>

                <div id="ctComTemplate" style="display:none;">
                    <div class="row g-2 mb-3">
                        <div class="col-6"><button class="btn btn-info w-100" id="ctTabNovo"><i class="bi bi-plus-lg"></i> Novo</button></div>
                        <div class="col-6"><button class="btn btn-secondary w-100" id="ctTabHistorico"><i class="bi bi-clock-history"></i> Histórico</button></div>
                    </div>

                    <!-- ── VIEW: NOVO CONTRATO ───────────────────── -->
                    <div id="ctViewNovo">
                        <h5 class="mb-3"><i class="bi bi-pencil-square"></i> Preencher Dados</h5>
                        <div id="ctCamposForm"></div>

                        <h5 class="mb-2 mt-4"><i class="bi bi-eye"></i> Pré-visualização</h5>
                        <div id="ctPreviewWrap" style="background:#fff;border-radius:10px;padding:16px;max-height:360px;overflow:auto;">
                            <div id="ctPreviewBody" style="color:#1e293b;font-size:.8rem;line-height:1.65;"></div>
                        </div>

                        <button class="btn btn-primary w-100 mt-3" id="ctSaveBtn"><i class="bi bi-check-circle-fill"></i> Finalizar e Salvar</button>
                    </div>

                    <!-- ── VIEW: HISTÓRICO ───────────────────────── -->
                    <div id="ctViewHistorico" style="display:none;">
                        <div class="mb-3"><input class="form-control" id="ctHistSearch" placeholder="Nome, CPF ou Doc..."></div>
                        <div id="ctHistList"></div>
                        <div id="ctHistEmpty" class="text-center text-secondary hidden" style="padding:2rem 0;">
                            <i class="bi bi-inbox" style="font-size:2.5rem;"></i>
                            <p class="mt-2">Nenhum contrato encontrado.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function attachListeners() {
        el('ctIrConfig')?.addEventListener('click', () => {
            if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesDocumentos');
        });
        el('ctTabNovo')?.addEventListener('click', () => switchView('novo'));
        el('ctTabHistorico')?.addEventListener('click', () => switchView('historico'));
        el('ctSaveBtn')?.addEventListener('click', salvarContrato);
        el('ctCamposForm')?.addEventListener('input', atualizarPreview);
        el('ctCamposForm')?.addEventListener('click', handleEscolhaClick);
        el('ctHistSearch')?.addEventListener('input', () => renderHistList(el('ctHistSearch').value));
        el('ctHistList')?.addEventListener('click', e => {
            const editBtn   = e.target.closest('[data-edit]');
            const delBtn    = e.target.closest('[data-del]');
            const shareBtn  = e.target.closest('[data-share]');
            const baixarBtn = e.target.closest('[data-baixar]');
            if (editBtn)   loadForEdit(editBtn.dataset.edit);
            if (delBtn)    deleteContrato(delBtn.dataset.del);
            if (shareBtn)  compartilharContrato(shareBtn.dataset.share);
            if (baixarBtn) baixarContrato(baixarBtn.dataset.baixar);
        });
    }

    function switchView(view) {
        CT.view = view;
        el('ctViewNovo').style.display      = view === 'novo' ? 'block' : 'none';
        el('ctViewHistorico').style.display = view === 'historico' ? 'block' : 'none';
        el('ctTabNovo')?.classList.toggle('btn-info', view === 'novo');
        el('ctTabNovo')?.classList.toggle('btn-secondary', view !== 'novo');
        el('ctTabHistorico')?.classList.toggle('btn-info', view === 'historico');
        el('ctTabHistorico')?.classList.toggle('btn-secondary', view !== 'historico');
        if (view === 'historico') renderHistList(el('ctHistSearch')?.value || '');
    }

    // ── Carrega o modelo de contrato configurado pela loja ────────
    async function carregarTemplate() {
        try {
            const snap = await window._dbGet(dbref(CFG_PATH));
            CT.storeConfig = snap.exists() ? snap.val() : {};
        } catch (e) {
            console.error('Erro ao carregar configurações de documentos:', e);
            CT.storeConfig = {};
        }
        CT.template = (CT.storeConfig.contratoTemplate || '').trim();

        const semTemplate = el('ctSemTemplate');
        const comTemplate = el('ctComTemplate');
        if (!CT.template) {
            if (semTemplate) semTemplate.style.display = 'block';
            if (comTemplate) comTemplate.style.display = 'none';
            return;
        }
        if (semTemplate) semTemplate.style.display = 'none';
        if (comTemplate) comTemplate.style.display = 'block';

        const parsed = parseTemplate(CT.template);
        CT.fields = parsed.fields;
        CT.calc   = parsed.calc;

        CT.editId = null;
        renderCamposForm();
        switchView('novo');
        atualizarPreview();
    }

    // ── Parse das tags {{tipo:id:rótulo}} ─────────────────────────
    function parseTemplate(template) {
        const fields = [];
        const calc   = [];
        const seenFields = new Set();
        const seenCalc   = new Set();
        let m;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(template)) !== null) {
            const tipo = m[1].toLowerCase();
            const id   = m[2];
            const rest = m[3].trim();
            if (TIPOS_AUTO.includes(tipo)) {
                if (!seenCalc.has(id)) {
                    seenCalc.add(id);
                    if (tipo === 'diadata') calc.push({ id, tipo, origem: rest }); // rest = id do campo data de origem
                    else calc.push({ id, tipo, formula: rest }); // 'calc' usa rest como fórmula; 'hoje' ignora rest
                }
            } else if (tipo === 'escolha') {
                if (!seenFields.has(id)) {
                    seenFields.add(id);
                    const partes = rest.split('|').map(p => p.trim());
                    const opcoes = partes.slice(1).filter(Boolean);
                    fields.push({ tipo, id, label: partes[0] || id, opcoes: opcoes.length ? opcoes : ['Opção 1', 'Opção 2'] });
                }
            } else if (TIPOS_INPUT.includes(tipo)) {
                if (!seenFields.has(id)) { seenFields.add(id); fields.push({ tipo, id, label: rest }); }
            }
        }
        return { fields, calc };
    }

    // ── Formulário dinâmico ────────────────────────────────────────
    function renderCamposForm(valoresExistentes) {
        const wrap = el('ctCamposForm');
        if (!wrap) return;
        if (CT.fields.length === 0) {
            wrap.innerHTML = `<p class="text-secondary small">Este modelo não tem campos para preencher.</p>`;
            return;
        }
        wrap.innerHTML = CT.fields.map(f => {
            const valor = valoresExistentes ? (valoresExistentes[f.id] ?? '') : '';
            if (f.tipo === 'escolha') {
                const botoes = f.opcoes.map(op => {
                    const ativo = String(valor) === op;
                    return `<button type="button" class="btn ${ativo ? 'btn-info' : 'btn-secondary'} ct-escolha-btn" data-escolha-id="${f.id}" data-escolha-valor="${esc(op)}" style="flex:1;">${esc(op)}</button>`;
                }).join('');
                return `
                    <div class="mb-3">
                        <label class="form-label">${esc(f.label)}</label>
                        <input type="hidden" id="ctInput_${f.id}" data-field-id="${f.id}" value="${esc(String(valor))}">
                        <div class="d-flex gap-2" data-escolha-group="${f.id}">${botoes}</div>
                    </div>`;
            }
            const inputAttrs = f.tipo === 'moeda' ? `type="number" step="0.01" min="0"`
                              : f.tipo === 'data'  ? `type="date"`
                              : `type="text"`;
            return `
                <div class="mb-3">
                    <label class="form-label">${esc(f.label)}</label>
                    <input class="form-control" id="ctInput_${f.id}" data-field-id="${f.id}" ${inputAttrs} value="${esc(String(valor))}">
                </div>`;
        }).join('');
    }

    // ── Clique nos botões de {{escolha}} (interruptor) ────────────
    function handleEscolhaClick(e) {
        const btn = e.target.closest('.ct-escolha-btn');
        if (!btn) return;
        const id    = btn.dataset.escolhaId;
        const valor = btn.dataset.escolhaValor;
        const hidden = el('ctInput_' + id);
        if (hidden) hidden.value = valor;
        document.querySelectorAll(`[data-escolha-group="${id}"] .ct-escolha-btn`).forEach(b => {
            b.classList.toggle('btn-info', b.dataset.escolhaValor === valor);
            b.classList.toggle('btn-secondary', b.dataset.escolhaValor !== valor);
        });
        atualizarPreview();
    }

    // ── Coleta valores + calcula campos {{calc}} ──────────────────
    function coletarValores() {
        const valoresBase = {};
        CT.fields.forEach(f => {
            const input = el('ctInput_' + f.id);
            valoresBase[f.id] = input ? input.value : '';
        });
        return calcularValoresCompletos(CT.fields, CT.calc, valoresBase);
    }

    function paraNumero(v) {
        if (v === null || v === undefined || v === '') return 0;
        const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'));
        return isFinite(n) ? n : (parseFloat(v) || 0);
    }

    // ── Resolve todos os {{calc}}, na ordem em que aparecem no modelo,
    // permitindo que um calc use o resultado de outro calc anterior
    // (ex: valor_total = parcela*qtd, e depois saldo = valor_total-entrada).
    function calcularValoresCompletos(fields, calc, valoresBase) {
        const valores = { ...valoresBase };
        const hojeISO = dataLocalISO(new Date()); // yyyy-mm-dd, mesmo formato do input type="date"

        calc.forEach(c => {
            if (c.tipo === 'hoje') {
                valores[c.id] = hojeISO;
                return;
            }
            if (c.tipo === 'diadata') {
                const origem = valores[c.origem];
                const dia = origem ? String(origem).split('-')[2] : '';
                valores[c.id] = dia ? String(parseInt(dia, 10)) : '';
                return;
            }
            // tipo === 'calc' (comportamento original)
            const nums = {};
            fields.forEach(f => {
                if (f.tipo === 'moeda' || f.tipo === 'numero') nums[f.id] = paraNumero(valores[f.id]);
            });
            Object.keys(valores).forEach(id => {
                if (typeof valores[id] === 'number') nums[id] = valores[id];
            });
            let expr = c.formula;
            Object.keys(nums).sort((a, b) => b.length - a.length).forEach(id => {
                expr = expr.replace(new RegExp('\\b' + id + '\\b', 'g'), String(nums[id]));
            });
            let resultado = 0;
            if (/^[0-9+\-*/().\s]*$/.test(expr) && expr.trim() !== '') {
                try { resultado = Function('"use strict"; return (' + expr + ')')(); } catch (e) { resultado = 0; }
            }
            valores[c.id] = isFinite(resultado) ? resultado : 0;
        });
        return valores;
    }

    function formatarData(v) {
        if (!v) return '___/___/______';
        const [ano, mes, dia] = String(v).split('-');
        if (!ano || !mes || !dia) return v;
        return `${dia}/${mes}/${ano}`;
    }

    // ── Resolve o texto final substituindo as tags pelos valores ──
    function resolverTexto(template, valores) {
        TAG_RE.lastIndex = 0;
        return template.replace(TAG_RE, (match, tipoRaw, id) => {
            const tipo = tipoRaw.toLowerCase();
            if (tipo === 'calc')    return fmt(valores[id] || 0);
            if (tipo === 'hoje')    return formatarData(valores[id]);
            if (tipo === 'diadata') return (valores[id] !== undefined && valores[id] !== '') ? String(valores[id]) : '__';
            const v = valores[id];
            if (tipo === 'moeda') return fmt(paraNumero(v));
            if (tipo === 'data')  return formatarData(v);
            return (v && String(v).trim()) ? String(v) : '_'.repeat(18);
        });
    }

    function textoParaHtml(texto) {
        return esc(texto)
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/\n/g, '<br>');
    }

    // ── Título em destaque no topo do documento ────────────────────
    function renderTituloHtml(titulo, tamanho) {
        const t = (titulo || '').trim();
        if (!t) return '';
        return `<div style="font-size:${tamanho};font-weight:900;color:#0f172a;text-align:center;margin:2px 0 16px;text-transform:uppercase;letter-spacing:.3px;">${esc(t)}</div>`;
    }

    // ── Bloco de "local, data" automático — usa a data de hoje e o
    // "Local (Cidade/UF)" salvo nas configurações, não depende de tag no texto.
    function renderDataLocalHtml(ativo, cidadeUf) {
        if (!ativo) return '';
        const local = (cidadeUf || '').trim();
        const dataFmt = new Date().toLocaleDateString('pt-BR');
        return `<div style="text-align:center;margin-top:28px;font-size:.8rem;color:#1e293b;">${esc(local ? local + ', ' : '')}${dataFmt}.</div>`;
    }

    // ── Linhas de assinatura no final do documento (Locadora e/ou Locatário) ─
    function renderAssinaturaHtml({ incluirLocador, incluirLocatario, nomeLocador, docLocador, nomeCliente, docCliente } = {}) {
        if (!incluirLocador && !incluirLocatario) return '';
        const bloco = (label, nome, doc) => `
            <div style="margin-top:32px;text-align:center;">
                <div style="border-top:1px solid #1e293b;width:260px;margin:0 auto;"></div>
                <div style="margin-top:6px;font-size:.75rem;color:#475569;">
                    ${label ? `<b>${esc(label)}:</b> ` : ''}${esc(nome || '')}${doc ? ` — ${esc(doc)}` : ''}
                </div>
            </div>`;
        return `
            ${incluirLocador   ? bloco('LOCADORA', nomeLocador, docLocador) : ''}
            ${incluirLocatario ? bloco('LOCATÁRIO', nomeCliente, docCliente) : ''}`;
    }

    function atualizarPreview() {
        const body = el('ctPreviewBody');
        if (!body || !CT.template) return;
        const valores = coletarValores();
        const nomeCliente = detectarNomeCliente(valores);
        const docCliente  = detectarDocCliente(valores);
        const cfg = CT.storeConfig;
        body.innerHTML =
            renderTituloHtml(cfg.contratoTitulo, '1rem') +
            textoParaHtml(resolverTexto(CT.template, valores)) +
            renderDataLocalHtml(cfg.contratoDataAutomatica, cfg.storeCidadeUf) +
            renderAssinaturaHtml({
                incluirLocador:   cfg.contratoAssinaturaLocador,
                incluirLocatario: cfg.contratoAssinatura,
                nomeLocador: cfg.storeName || window._nomeLojaCadastrada,
                docLocador:  cfg.storeCNPJ,
                nomeCliente,
                docCliente,
            });
    }

    // ── Detecta um nome de cliente pra facilitar busca no histórico ─
    function detectarNomeCliente(valores) {
        const campoNome = CT.fields.find(f => /nome/i.test(f.id)) || CT.fields.find(f => f.tipo === 'texto');
        if (campoNome && valores[campoNome.id]) return String(valores[campoNome.id]).trim();
        return 'Cliente';
    }

    // ── Detecta o campo de CPF/CNPJ/documento do cliente pras linhas de assinatura ─
    function detectarDocCliente(valores) {
        const campoDoc = CT.fields.find(f => /cpf|cnpj|documento/i.test(f.id));
        if (campoDoc && valores[campoDoc.id]) return String(valores[campoDoc.id]).trim();
        return '';
    }

    // ── Salvar ────────────────────────────────────────────────────
    async function salvarContrato() {
        const valores = coletarValores();
        const vazio = CT.fields.every(f => !String(valores[f.id] || '').trim());
        if (vazio) { modal({ message: 'Preencha ao menos um campo do contrato.' }); return; }

        const saveBtn = el('ctSaveBtn');
        const originalHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';
        saveBtn.disabled = true;

        try {
            const dados = {
                valores,
                templateSnapshot: CT.template,
                tituloSnapshot: CT.storeConfig.contratoTitulo || '',
                assinaturaSnapshot: !!CT.storeConfig.contratoAssinatura,
                assinaturaLocadorSnapshot: !!CT.storeConfig.contratoAssinaturaLocador,
                dataLocalSnapshot: !!CT.storeConfig.contratoDataAutomatica,
                clienteNome: detectarNomeCliente(valores),
                clienteDoc: detectarDocCliente(valores),
                criadoEm: new Date().toISOString(),
            };

            const snap = await window._dbGet(dbref('contratos'));
            if (CT.editId && snap.exists() && snap.val()[CT.editId]) {
                dados.docNumber = snap.val()[CT.editId].docNumber;
            } else {
                let maior = 0;
                if (snap.exists()) {
                    Object.values(snap.val()).forEach(item => {
                        const n = parseInt(item.docNumber || '0', 10);
                        if (!isNaN(n) && n > maior) maior = n;
                    });
                }
                dados.docNumber = String(maior + 1).padStart(3, '0');
            }

            if (CT.editId) {
                await window._dbUpdate(dbref('contratos/' + CT.editId), dados);
            } else {
                await window._dbPush(dbref('contratos'), dados);
            }

            if (navigator.vibrate) navigator.vibrate(50);
            modal({ message: CT.editId ? 'Contrato atualizado com sucesso!' : 'Contrato salvo com sucesso!' });
            CT.editId = null;
            renderCamposForm();
            atualizarPreview();
            switchView('historico');
        } catch (e) {
            console.error('Erro ao salvar contrato:', e);
            modal({ message: 'Erro ao salvar contrato: ' + e.message });
        } finally {
            saveBtn.innerHTML = originalHtml;
            saveBtn.disabled = false;
        }
    }

    // ── Histórico ────────────────────────────────────────────────
    function loadHistorico() {
        window._dbOnValue(dbref('contratos'), snap => {
            const data = snap.val();
            CT.cache = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })) : [];
            CT.cache.sort((a, b) => new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0));
            if (CT.view === 'historico') renderHistList(el('ctHistSearch')?.value || '');
        });
    }

    function garantirCardCss() {
        if (document.getElementById('ctCardStyleTag')) return;
        const styleTag = document.createElement('style');
        styleTag.id = 'ctCardStyleTag';
        styleTag.textContent = `
            .ct-card { display:flex; flex-direction:column; gap:0; padding:11px 12px; }
            .ct-card-row { display:flex; align-items:center; gap:10px; }
            .ct-card-avatar { width:36px; height:36px; border-radius:10px; background:rgba(59,130,246,.15); color:#3b82f6; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:.85rem; flex-shrink:0; }
            .ct-card-body { flex:1; min-width:0; }
            .ct-card-name { font-weight:700; font-size:.85rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .ct-card-meta { font-size:.68rem; color:#94a3b8; margin-top:1px; }
            .ct-card-actions { display:flex; gap:4px; margin-top:9px; padding-top:8px; border-top:1px solid rgba(255,255,255,.06); }
            .ct-action-btn { flex:1; display:flex; align-items:center; justify-content:center; background:transparent; border:none; border-radius:8px; padding:6px 0; color:#94a3b8; font-size:.9rem; transition:background .15s ease, color .15s ease; }
            .ct-action-btn:active { background:rgba(255,255,255,.08); color:#e2e8f0; }
            .ct-action-btn.ct-danger:active { color:#f87171; }
        `;
        document.head.appendChild(styleTag);
    }

    function renderHistList(filterText) {
        garantirCardCss();
        const wrap  = el('ctHistList');
        const empty = el('ctHistEmpty');
        if (!wrap) return;
        const f = (filterText || '').toLowerCase().trim();
        const filtered = CT.cache.filter(item => {
            if (!f) return true;
            const camposTexto = Object.values(item.valores || {}).join(' ').toLowerCase();
            return (item.clienteNome || '').toLowerCase().includes(f)
                || camposTexto.includes(f)
                || (item.docNumber || '').includes(f);
        });
        if (filtered.length === 0) {
            wrap.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }
        empty?.classList.add('hidden');
        wrap.innerHTML = filtered.map(item => {
            const dataFmt = item.criadoEm ? new Date(item.criadoEm).toLocaleDateString('pt-BR') : '';
            const inicial = (item.clienteNome || '?').trim().charAt(0).toUpperCase();
            return `
                <div class="content-card ct-card mb-2">
                    <div class="ct-card-row">
                        <div class="ct-card-avatar">${esc(inicial)}</div>
                        <div class="ct-card-body">
                            <div class="ct-card-name">${esc(item.clienteNome || 'Sem nome')}</div>
                            <div class="ct-card-meta">Doc ${esc(item.docNumber || '')} · ${dataFmt}</div>
                        </div>
                    </div>
                    <div class="ct-card-actions">
                        <button class="ct-action-btn" data-share="${item.id}" aria-label="Compartilhar"><i class="bi bi-share"></i></button>
                        <button class="ct-action-btn" data-baixar="${item.id}" aria-label="Baixar"><i class="bi bi-download"></i></button>
                        <button class="ct-action-btn" data-edit="${item.id}" aria-label="Editar"><i class="bi bi-pencil"></i></button>
                        <button class="ct-action-btn ct-danger" data-del="${item.id}" aria-label="Excluir"><i class="bi bi-trash3"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function loadForEdit(id) {
        const item = CT.cache.find(i => i.id === id);
        if (!item) return;
        CT.editId = id;
        renderCamposForm(item.valores || {});
        atualizarPreview();
        switchView('novo');
    }

    function deleteContrato(id) {
        modal({
            message: 'Excluir este contrato? Essa ação não pode ser desfeita.',
            confirmText: 'Excluir', cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await window._dbRemove(dbref('contratos/' + id));
                    modal({ message: 'Contrato excluído.' });
                } catch (e) {
                    modal({ message: 'Erro ao excluir: ' + e.message });
                }
            },
            onCancel: () => {}
        });
    }

    // ── Nunca deixa uma operação travar o spinner pra sempre ──────
    function comTimeout(promise, ms, mensagemErro) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(mensagemErro)), ms)),
        ]);
    }

    async function getStoreConfig() {
        try {
            const snap = await window._dbGet(dbref(CFG_PATH));
            return snap.exists() ? snap.val() : {};
        } catch (e) {
            console.error('Erro ao buscar config de documentos:', e);
            return {};
        }
    }

    // ── Separa um parágrafo em trechos {texto, negrito} a partir das
    // marcações **negrito** ────────────────────────────────────────
    function tokenizarNegrito(paragrafo) {
        return paragrafo.split(/(\*\*.+?\*\*)/g).filter(p => p !== '').map(p => {
            const negrito = /^\*\*.+\*\*$/.test(p);
            return { texto: negrito ? p.slice(2, -2) : p, negrito };
        });
    }

    // ── Agrupa os trechos em "unidades" palavra+espaço, colando o
    // espaço na palavra anterior — evita desenhar um espaço isolado
    // (que pode ser perdido bem na fronteira negrito/normal) ───────
    function unidadesParaDesenhar(partes) {
        const unidades = [];
        partes.forEach(({ texto, negrito }) => {
            (texto.match(/\S+|\s+/g) || []).forEach(t => {
                if (/^\s+$/.test(t) && unidades.length > 0) {
                    unidades[unidades.length - 1].texto += t;
                } else {
                    unidades.push({ texto: t, negrito });
                }
            });
        });
        return unidades;
    }

    // ── Escreve um texto com **negrito** e quebra de linha automática,
    // paginando sozinho quando ultrapassa o fim da página ─────────
    function desenharTextoFormatado(pdf, texto, opts) {
        const { xStart, yStart, maxWidth, pageHeight, marginBottom, lineHeight } = opts;
        let x = xStart;
        let y = yStart;

        function novaLinha() {
            x = xStart;
            y += lineHeight;
            if (y > pageHeight - marginBottom) {
                pdf.addPage();
                y = yStart;
            }
        }

        texto.split('\n').forEach(paragrafo => {
            if (paragrafo.trim() === '') { novaLinha(); return; }
            const unidades = unidadesParaDesenhar(tokenizarNegrito(paragrafo));
            unidades.forEach(u => {
                pdf.setFont('helvetica', u.negrito ? 'bold' : 'normal');
                const largura = pdf.getTextWidth(u.texto);
                if (x + largura > xStart + maxWidth && u.texto.trim() !== '') novaLinha();
                pdf.text(u.texto, x, y);
                x += largura;
            });
            novaLinha();
        });

        return y;
    }

    // ── Monta o PDF do contrato inteiramente em texto (sem captura
    // de tela) — mais rápido, confiável e com texto selecionável ──
    function gerarPdfContratoTexto(item, cfg) {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });

        const template = item.templateSnapshot || CT.template;
        const parsed   = parseTemplate(template);
        const valores  = calcularValoresCompletos(parsed.fields, parsed.calc, { ...item.valores });
        const corpo    = resolverTexto(template, valores);

        const titulo = item.tituloSnapshot !== undefined ? item.tituloSnapshot : (cfg.contratoTitulo || '');
        const incluirLocatario = item.assinaturaSnapshot !== undefined ? item.assinaturaSnapshot : !!cfg.contratoAssinatura;
        const incluirLocador   = item.assinaturaLocadorSnapshot !== undefined ? item.assinaturaLocadorSnapshot : !!cfg.contratoAssinaturaLocador;
        const dataLocalAtiva   = item.dataLocalSnapshot !== undefined ? item.dataLocalSnapshot : !!cfg.contratoDataAutomatica;
        const nomeCliente = item.clienteNome || detectarNomeCliente(valores);
        const docCliente  = item.clienteDoc !== undefined ? item.clienteDoc : detectarDocCliente(valores);
        const dataFmt = item.criadoEm ? new Date(item.criadoEm).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');

        const margem   = 20;
        const largura  = pdf.internal.pageSize.getWidth();
        const altura   = pdf.internal.pageSize.getHeight();
        const maxWidth = largura - margem * 2;
        const centro   = largura / 2;
        let y = margem;

        if (titulo.trim()) {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(13);
            const linhasTitulo = pdf.splitTextToSize(titulo.toUpperCase(), maxWidth);
            linhasTitulo.forEach(linha => {
                pdf.text(linha, centro, y, { align: 'center' });
                y += 6.5;
            });
            y += 3.5;
        }

        pdf.setFontSize(10.5);
        y = desenharTextoFormatado(pdf, corpo, {
            xStart: margem, yStart: y, maxWidth, pageHeight: altura, marginBottom: margem, lineHeight: 5.2,
        });

        if (dataLocalAtiva) {
            y += 8;
            if (y > altura - margem) { pdf.addPage(); y = margem; }
            const local = (cfg.storeCidadeUf || '').trim();
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10.5);
            pdf.text(`${local ? local + ', ' : ''}${new Date().toLocaleDateString('pt-BR')}.`, centro, y, { align: 'center' });
        }

        if (incluirLocador || incluirLocatario) {
            y += 18;
            const desenharAssinatura = (label, nome, doc) => {
                if (y > altura - margem - 15) { pdf.addPage(); y = margem; }
                pdf.setDrawColor(30, 41, 59);
                pdf.line(centro - 45, y, centro + 45, y);
                y += 5;
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(9.5);
                pdf.text(`${label ? label + ': ' : ''}${nome || ''}${doc ? ' — ' + doc : ''}`, centro, y, { align: 'center' });
                y += 14;
            };
            if (incluirLocador)   desenharAssinatura('LOCADORA', cfg.storeName || window._nomeLojaCadastrada, cfg.storeCNPJ);
            if (incluirLocatario) desenharAssinatura('LOCATÁRIO', nomeCliente, docCliente);
        }

        pdf.setFontSize(8.5);
        pdf.setTextColor(100);
        pdf.text(`Data: ${dataFmt}`, largura - margem, altura - margem, { align: 'right' });

        return pdf.output('blob');
    }

    async function gerarPdfContrato(item) {
        const cfg = CT.storeConfig || await getStoreConfig();
        await window._vsLib('jspdf');
        return gerarPdfContratoTexto(item, cfg);
    }

    function nomeDocumentoBase(item) {
        const nomeCliente = item.clienteNome || 'Cliente';
        return `Contrato de ${nomeCliente}`.replace(/[\/\\:*?"<>|]/g, '-');
    }

    function baixarBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = fileName; link.click();
        URL.revokeObjectURL(url);
    }

    // ── Overlay de carregamento — reaproveita o MESMO componente visual
    // do resto do app (.success-overlay/.success-card), só trocando o
    // círculo gradiente+check por um anel girando enquanto espera. Ao
    // terminar com sucesso, chama window._showSuccessOverlay() de
    // verdade — garante ficar idêntico ao resto do app.
    // .vs-blocking + trava de scroll + guarda de navegação: enquanto
    // essa operação roda, a tela de trás não pode responder a toque
    // nem rolar, e o botão voltar avisa "aguarda" em vez de navegar
    // por baixo da animação.
    function mostrarCarregando(texto) {
        let overlay = document.getElementById('ctLoadingOverlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'ctLoadingOverlay';
        overlay.className = 'success-overlay show vs-blocking';
        overlay.innerHTML = `
            <div class="success-card">
                <div class="success-icon-circle vs-loading-circle">
                    <div class="vs-loading-spinner"></div>
                </div>
                <div class="success-text">${texto || 'Gerando...'}</div>
            </div>
        `;
        document.body.appendChild(overlay);
        window._vsTravarScroll && window._vsTravarScroll();
        window._vsIniciarProtecaoNavegacao && window._vsIniciarProtecaoNavegacao('Aguarde a operação terminar antes de voltar.');
    }

    async function esconderCarregando(sucesso = true, textoSucesso = 'Pronto!') {
        const overlay = document.getElementById('ctLoadingOverlay');
        if (overlay) overlay.remove();
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (sucesso) await window._showSuccessOverlay(textoSucesso, 1100);
        window._vsFinalizarProtecaoNavegacao && window._vsFinalizarProtecaoNavegacao();
    }

    async function compartilharContrato(id) {
        const item = CT.cache.find(i => i.id === id);
        if (!item) return;
        mostrarCarregando('Gerando contrato...');
        try {
            const blob = await comTimeout(gerarPdfContrato(item), 12000, 'Tempo esgotado ao gerar o contrato (verifique sua conexão).');
            const fileName = `${nomeDocumentoBase(item)}.pdf`;
            const file = new File([blob], fileName, { type: 'application/pdf' });
            try {
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    try {
                        await navigator.share({ files: [file], title: nomeDocumentoBase(item), text: item.clienteNome ? `Olá ${item.clienteNome},` : 'Olá,' });
                    } catch (e) {
                        if (e.name !== 'AbortError') {
                            baixarBlob(blob, fileName);
                            modal({ message: 'Não foi possível abrir o compartilhamento (' + e.message + ') — arquivo baixado.' });
                        }
                    }
                } else {
                    baixarBlob(blob, fileName);
                    modal({ message: 'Compartilhamento não suportado — arquivo baixado.' });
                }
            } finally {
                esconderCarregando();
            }
        } catch (e) {
            esconderCarregando(false);
            modal({ message: 'Erro ao gerar contrato: ' + e.message });
        }
    }

    async function baixarContrato(id) {
        const item = CT.cache.find(i => i.id === id);
        if (!item) return;
        mostrarCarregando('Gerando PDF...');
        try {
            const blob = await comTimeout(gerarPdfContrato(item), 12000, 'Tempo esgotado ao gerar o contrato (verifique sua conexão).');
            try { baixarBlob(blob, `${nomeDocumentoBase(item)}.pdf`); }
            finally { await esconderCarregando(true, 'Baixado!'); }
        } catch (e) {
            await esconderCarregando(false);
            modal({ message: 'Erro ao gerar contrato: ' + e.message });
        }
    }

})();
