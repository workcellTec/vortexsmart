// ================================================================
// documentos/recibo.js — VortexSmart · Recibo Simples
// Registra: window._initRecibo()
// Depende de (via window.*):
//   showCustomModal, escapeHtml, html2canvas,
//   _lojaRef, _dbOnValue, _dbUpdate, _dbPush,
//   _dbGet, _dbRemove, openDocumentosSection
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const el    = id   => document.getElementById(id);
    const esc   = t    => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt   = v    => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    // dbref(caminho) agora monta a referência DENTRO da loja logada —
    // todas as chamadas existentes já ficam isoladas por loja
    // automaticamente, sem precisar editar cada uma individualmente.
    const dbref = (caminho) => window._lojaRef(caminho);

    const RC = {
        initialized: false,
        view: 'novo',       // 'novo' | 'historico'
        cart: [],
        editId: null,
        cache: [],
        listenerAttached: false,
    };

    // Largura "de papel" do recibo — o antigo layout Padrão da Garantia.
    const DOC_WIDTH = 560;

    window._initRecibo = function () {
        if (!RC.initialized) {
            renderShell();
            attachListeners();
            RC.initialized = true;
        }
        if (!RC.listenerAttached) {
            loadHistorico();
            RC.listenerAttached = true;
        }
        resetForm();
        switchView('novo');
    };

    function renderShell() {
        const wrap = el('documentosRecibo');
        if (!wrap) return;
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Recibo</h3>
            </div>
            <div class="content-card w-100" style="padding-bottom:110px;">
                <div class="row g-2 mb-3">
                    <div class="col-6"><button class="btn btn-info w-100" id="rcTabNovo"><i class="bi bi-plus-lg"></i> Novo Recibo</button></div>
                    <div class="col-6"><button class="btn btn-secondary w-100" id="rcTabHistorico"><i class="bi bi-clock-history"></i> Histórico</button></div>
                </div>

                <!-- ── VIEW: NOVO RECIBO ─────────────────────────── -->
                <div id="rcViewNovo">
                    <h5 class="mb-3"><i class="bi bi-person-fill"></i> Dados do Cliente</h5>
                    <div class="mb-3"><label class="form-label">Nome Completo</label><input class="form-control" id="rcNome" placeholder="Nome do cliente"></div>
                    <div class="row g-2 mb-3">
                        <div class="col-6"><label class="form-label">CPF</label><input class="form-control" id="rcCpf" placeholder="000.000.000-00"></div>
                        <div class="col-6"><label class="form-label">Telefone</label><input class="form-control" id="rcTelefone" placeholder="(XX) 9XXXX-XXXX"></div>
                    </div>

                    <h5 class="mb-3 mt-4"><i class="bi bi-box-seam-fill"></i> Produtos</h5>
                    <div id="rcCartList" class="mb-2"></div>
                    <div class="row g-2">
                        <div class="col-12"><input class="form-control" id="rcProdNome" placeholder="Nome do produto"></div>
                        <div class="col-6"><input class="form-control" id="rcProdValor" type="number" step="0.01" min="0" placeholder="Valor R$"></div>
                        <div class="col-6"><input class="form-control" id="rcProdQtd" type="number" min="1" value="1" placeholder="Qtd"></div>
                        <div class="col-6"><input class="form-control" id="rcProdCor" placeholder="Cor (opcional)"></div>
                        <div class="col-6"><input class="form-control" id="rcProdObs" placeholder="IMEI / Obs (opcional)"></div>
                    </div>
                    <button class="btn btn-secondary w-100 mt-2" id="rcAddItemBtn"><i class="bi bi-plus-circle"></i> Adicionar Item</button>

                    <button class="btn btn-primary w-100 mt-4" id="rcSaveBtn"><i class="bi bi-check-circle-fill"></i> Finalizar e Salvar</button>
                </div>

                <!-- ── VIEW: HISTÓRICO ───────────────────────────── -->
                <div id="rcViewHistorico" style="display:none;">
                    <div class="mb-3"><input class="form-control" id="rcHistSearch" placeholder="Nome, CPF ou Doc..."></div>
                    <div id="rcHistList"></div>
                    <div id="rcHistEmpty" class="text-center text-secondary hidden" style="padding:2rem 0;">
                        <i class="bi bi-inbox" style="font-size:2.5rem;"></i>
                        <p class="mt-2">Nenhum recibo encontrado.</p>
                    </div>
                </div>
            </div>
        `;
    }

    function attachListeners() {
        el('rcTabNovo')?.addEventListener('click', () => switchView('novo'));
        el('rcTabHistorico')?.addEventListener('click', () => switchView('historico'));
        el('rcAddItemBtn')?.addEventListener('click', addCartItem);
        el('rcSaveBtn')?.addEventListener('click', saveRecibo);
        el('rcHistSearch')?.addEventListener('input', () => renderHistList(el('rcHistSearch').value));
        el('rcCartList')?.addEventListener('click', e => {
            const btn = e.target.closest('[data-remove]');
            if (!btn) return;
            RC.cart.splice(parseInt(btn.dataset.remove), 1);
            renderCartList();
        });
        el('rcHistList')?.addEventListener('click', e => {
            const editBtn   = e.target.closest('[data-edit]');
            const delBtn    = e.target.closest('[data-del]');
            const shareBtn  = e.target.closest('[data-share]');
            const baixarBtn = e.target.closest('[data-baixar]');
            if (editBtn)   loadForEdit(editBtn.dataset.edit);
            if (delBtn)    deleteRecibo(delBtn.dataset.del);
            if (shareBtn)  compartilharRecibo(shareBtn.dataset.share);
            if (baixarBtn) baixarRecibo(baixarBtn.dataset.baixar);
        });
    }

    function switchView(view) {
        RC.view = view;
        el('rcViewNovo').style.display      = view === 'novo' ? 'block' : 'none';
        el('rcViewHistorico').style.display = view === 'historico' ? 'block' : 'none';
        el('rcTabNovo')?.classList.toggle('btn-info', view === 'novo');
        el('rcTabNovo')?.classList.toggle('btn-secondary', view !== 'novo');
        el('rcTabHistorico')?.classList.toggle('btn-info', view === 'historico');
        el('rcTabHistorico')?.classList.toggle('btn-secondary', view !== 'historico');
        if (view === 'historico') renderHistList(el('rcHistSearch')?.value || '');
    }

    function resetForm() {
        RC.cart = []; RC.editId = null;
        ['rcNome', 'rcCpf', 'rcTelefone', 'rcProdNome', 'rcProdValor', 'rcProdQtd', 'rcProdCor', 'rcProdObs']
            .forEach(id => { if (el(id)) el(id).value = ''; });
        if (el('rcProdQtd')) el('rcProdQtd').value = 1;
        renderCartList();
    }

    // ── Carrinho de produtos ────────────────────────────────────────
    function addCartItem() {
        const nome  = el('rcProdNome')?.value.trim();
        const valor = parseFloat(el('rcProdValor')?.value) || 0;
        const qtd   = parseInt(el('rcProdQtd')?.value) || 1;
        const cor   = el('rcProdCor')?.value.trim() || '';
        const obs   = el('rcProdObs')?.value.trim() || '';
        if (!nome) { modal({ message: 'Digite o nome do produto.' }); return; }
        RC.cart.push({ nome, valor, qtd, cor, obs });
        ['rcProdNome', 'rcProdValor', 'rcProdCor', 'rcProdObs'].forEach(id => { if (el(id)) el(id).value = ''; });
        if (el('rcProdQtd')) el('rcProdQtd').value = 1;
        renderCartList();
    }

    function renderCartList() {
        const wrap = el('rcCartList');
        if (!wrap) return;
        if (RC.cart.length === 0) {
            wrap.innerHTML = `<p class="text-secondary small mb-2">Nenhum produto adicionado ainda.</p>`;
            return;
        }
        wrap.innerHTML = RC.cart.map((item, i) => `
            <div class="content-card mb-2" style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
                <div>
                    <div class="fw-bold">${esc(item.nome)} <span class="text-secondary small">x${item.qtd}</span></div>
                    <div class="text-secondary small">${item.cor ? esc(item.cor) + ' · ' : ''}${item.obs ? esc(item.obs) + ' · ' : ''}${fmt(item.valor * item.qtd)}</div>
                </div>
                <button class="btn-back" data-remove="${i}" aria-label="Remover"><i class="bi bi-trash3"></i></button>
            </div>
        `).join('');
    }

    function calcularTotal(items) {
        return (items || []).reduce((soma, p) => soma + (p.valor * p.qtd), 0);
    }

    // ── Numeração sequencial de documento — reaproveitada tanto pelo
    //    salvar manual (saveRecibo) quanto pela geração automática vinda
    //    de outro módulo (ex: Concertos) via _reciboGerarAutomatico ──
    async function proximoDocNumber(editId) {
        const snap = await window._dbGet(dbref('recibos'));
        if (editId && snap.exists() && snap.val()[editId]) {
            return snap.val()[editId].docNumber;
        }
        let maior = 0;
        if (snap.exists()) {
            Object.values(snap.val()).forEach(item => {
                const n = parseInt(item.docNumber || '0', 10);
                if (!isNaN(n) && n > maior) maior = n;
            });
        }
        return String(maior + 1).padStart(3, '0');
    }

    // ── Salvar ────────────────────────────────────────────────────
    async function saveRecibo() {
        const nome = el('rcNome')?.value.trim();
        if (!nome) { modal({ message: 'Digite o nome do cliente.' }); return; }
        if (RC.cart.length === 0) { modal({ message: 'A lista de produtos está vazia! Adicione ao menos um item.' }); return; }

        const saveBtn = el('rcSaveBtn');
        const originalHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';
        saveBtn.disabled = true;

        try {
            const dados = {
                nome,
                cpf:      el('rcCpf')?.value.trim() || '',
                tel:      el('rcTelefone')?.value.trim() || '',
                items:    RC.cart,
                total:    calcularTotal(RC.cart),
                criadoEm: new Date().toISOString(),
            };
            dados.docNumber = await proximoDocNumber(RC.editId);

            if (RC.editId) {
                await window._dbUpdate(dbref('recibos/' + RC.editId), dados);
            } else {
                await window._dbPush(dbref('recibos'), dados);
            }

            if (navigator.vibrate) navigator.vibrate(50);
            modal({ message: RC.editId ? 'Recibo atualizado com sucesso!' : 'Recibo salvo com sucesso!' });
            resetForm();
            switchView('historico');
        } catch (e) {
            console.error('Erro ao salvar recibo:', e);
            modal({ message: 'Erro ao salvar recibo: ' + e.message });
        } finally {
            saveBtn.innerHTML = originalHtml;
            saveBtn.disabled = false;
        }
    }

    // ── Geração automática (chamada por OUTRO módulo, ex: Concertos) ──
    // Mesmo formato de dados do saveRecibo manual, só que sem passar
    // pela UI — quem chama já entrega nome/tel/items prontos. Usada
    // pelo fluxo "Gerar comprovante" de uma OS de conserto: monta um
    // item "Concerto" e chama isso direto, sem o usuário digitar nada
    // no carrinho manualmente.
    window._reciboGerarAutomatico = async function (dadosEntrada) {
        const nome = (dadosEntrada.nome || '').trim();
        if (!nome) throw new Error('Nome do cliente é obrigatório pra gerar o recibo.');
        const items = Array.isArray(dadosEntrada.items) ? dadosEntrada.items : [];
        if (!items.length) throw new Error('Nenhum item informado pra gerar o recibo.');

        const dados = {
            nome,
            cpf:      dadosEntrada.cpf || '',
            tel:      dadosEntrada.tel || '',
            items,
            total:    calcularTotal(items),
            criadoEm: new Date().toISOString(),
        };
        if (dadosEntrada.garantiaTxt) dados.garantiaTxt = dadosEntrada.garantiaTxt;
        dados.docNumber = await proximoDocNumber(null);
        const res = await window._dbPush(dbref('recibos'), dados);
        return { id: res.key, dados };
    };

    // ── Abrir um recibo específico já em edição, com os dados na mão
    //    (sem depender do listener/cache do histórico já ter chegado —
    //    evita corrida quando isso é chamado logo após gerar) ────────
    window._reciboAbrirEdicaoComDados = function (id, dados) {
        if (typeof window.openDocumentosSection === 'function') window.openDocumentosSection('documentosRecibo');
        resetForm();
        RC.editId = id;
        if (el('rcNome')) el('rcNome').value = dados.nome || '';
        if (el('rcCpf')) el('rcCpf').value = dados.cpf || '';
        if (el('rcTelefone')) el('rcTelefone').value = dados.tel || '';
        RC.cart = Array.isArray(dados.items) ? JSON.parse(JSON.stringify(dados.items)) : [];
        renderCartList();
        switchView('novo');
    };

    // ── Histórico ────────────────────────────────────────────────────
    function loadHistorico() {
        window._dbOnValue(dbref('recibos'), snap => {
            const data = snap.val();
            RC.cache = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })) : [];
            RC.cache.sort((a, b) => new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0));
            if (RC.view === 'historico') renderHistList(el('rcHistSearch')?.value || '');
        });
    }

    // ── CSS do card de histórico — injetado uma vez no <head> ──────
    function garantirCardCss() {
        if (document.getElementById('rcCardStyleTag')) return;
        const styleTag = document.createElement('style');
        styleTag.id = 'rcCardStyleTag';
        styleTag.textContent = `
            .rc-card { display:flex; flex-direction:column; gap:0; padding:11px 12px; }
            .rc-card-row { display:flex; align-items:center; gap:10px; }
            .rc-card-avatar { width:36px; height:36px; border-radius:10px; background:rgba(22,163,74,.15); color:#16a34a; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:.85rem; flex-shrink:0; }
            .rc-card-body { flex:1; min-width:0; }
            .rc-card-name { font-weight:700; font-size:.85rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .rc-card-meta { font-size:.68rem; color:#94a3b8; margin-top:1px; }
            .rc-card-valor { font-weight:800; font-size:.85rem; color:#16a34a; white-space:nowrap; flex-shrink:0; }
            .rc-card-actions { display:flex; gap:4px; margin-top:9px; padding-top:8px; border-top:1px solid rgba(255,255,255,.06); }
            .rc-action-btn { flex:1; display:flex; align-items:center; justify-content:center; background:transparent; border:none; border-radius:8px; padding:6px 0; color:#94a3b8; font-size:.9rem; transition:background .15s ease, color .15s ease; }
            .rc-action-btn:active { background:rgba(255,255,255,.08); color:#e2e8f0; }
            .rc-action-btn.rc-danger:active { color:#f87171; }
        `;
        document.head.appendChild(styleTag);
    }

    function renderHistList(filterText) {
        garantirCardCss();
        const wrap  = el('rcHistList');
        const empty = el('rcHistEmpty');
        if (!wrap) return;
        const f = (filterText || '').toLowerCase().trim();
        const filtered = RC.cache.filter(item => {
            if (!f) return true;
            return (item.nome || '').toLowerCase().includes(f)
                || (item.cpf  || '').replace(/\D/g, '').includes(f.replace(/\D/g, ''))
                || (item.docNumber || '').includes(f);
        });
        if (filtered.length === 0) {
            wrap.innerHTML = '';
            empty?.classList.remove('hidden');
            return;
        }
        empty?.classList.add('hidden');
        wrap.innerHTML = filtered.map(item => {
            const dataFmt  = item.criadoEm ? new Date(item.criadoEm).toLocaleDateString('pt-BR') : '';
            const inicial  = (item.nome || '?').trim().charAt(0).toUpperCase();
            const qtdItens = item.items?.length || 0;
            return `
                <div class="content-card rc-card mb-2">
                    <div class="rc-card-row">
                        <div class="rc-card-avatar">${esc(inicial)}</div>
                        <div class="rc-card-body">
                            <div class="rc-card-name">${esc(item.nome || 'Sem nome')}</div>
                            <div class="rc-card-meta">Doc ${esc(item.docNumber || '')} · ${dataFmt} · ${qtdItens} ${qtdItens === 1 ? 'item' : 'itens'}</div>
                        </div>
                        <div class="rc-card-valor">${fmt(item.total || 0)}</div>
                    </div>
                    <div class="rc-card-actions">
                        <button class="rc-action-btn" data-share="${item.id}" aria-label="Compartilhar"><i class="bi bi-share"></i></button>
                        <button class="rc-action-btn" data-baixar="${item.id}" aria-label="Baixar"><i class="bi bi-download"></i></button>
                        <button class="rc-action-btn" data-edit="${item.id}" aria-label="Editar"><i class="bi bi-pencil"></i></button>
                        <button class="rc-action-btn rc-danger" data-del="${item.id}" aria-label="Excluir"><i class="bi bi-trash3"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function loadForEdit(id) {
        const item = RC.cache.find(i => i.id === id);
        if (!item) return;
        resetForm();
        RC.editId = id;
        if (el('rcNome')) el('rcNome').value = item.nome || '';
        if (el('rcCpf')) el('rcCpf').value = item.cpf || '';
        if (el('rcTelefone')) el('rcTelefone').value = item.tel || '';
        RC.cart = Array.isArray(item.items) ? JSON.parse(JSON.stringify(item.items)) : [];
        renderCartList();
        switchView('novo');
    }

    function deleteRecibo(id) {
        modal({
            message: 'Excluir este recibo? Essa ação não pode ser desfeita.',
            confirmText: 'Excluir', cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await window._dbRemove(dbref('recibos/' + id));
                    modal({ message: 'Recibo excluído.' });
                } catch (e) {
                    modal({ message: 'Erro ao excluir: ' + e.message });
                }
            },
            onCancel: () => {}
        });
    }

    // ── Config de Documentos (nome da loja) — mesma config da Garantia ──
    async function getStoreConfig() {
        try {
            const snap = await window._dbGet(dbref('configuracoes/documentos'));
            return snap.exists() ? snap.val() : {};
        } catch (e) {
            console.error('Erro ao buscar config de documentos:', e);
            return {};
        }
    }

    // ── Monta o miolo do documento — o antigo Layout Padrão da
    // Garantia, sem os campos de garantia (dias/venda).
    function construirHtmlRecibo(item, cfg) {
        const storeName = (cfg.storeName || window._nomeLojaCadastrada || 'VORTEXSMART').toUpperCase();
        const corBarra  = cfg.storeCorBarra || '#16a34a';
        const itensHtml = (item.items || []).map(p => `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <div style="flex:1;">
                    <div style="font-size:.85rem;font-weight:700;color:#1e293b;">${esc(p.nome)} <span style="color:#94a3b8;font-weight:400;">x${p.qtd}</span></div>
                    ${(p.cor || p.obs) ? `<div style="font-size:.68rem;color:#64748b;margin-top:2px;">${p.cor ? 'Cor: ' + esc(p.cor) : ''}${p.cor && p.obs ? ' · ' : ''}${p.obs ? 'IMEI/Obs: ' + esc(p.obs) : ''}</div>` : ''}
                </div>
                <div style="font-size:.85rem;font-weight:800;color:${corBarra};white-space:nowrap;">${fmt(p.valor * p.qtd)}</div>
            </div>`).join('');

        const dataFmt = item.criadoEm ? new Date(item.criadoEm).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR');

        return `
        <div style="background:#fff;width:${DOC_WIDTH}px;padding:28px;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;">
            <div style="text-align:center;margin-bottom:18px;">
                <div style="font-size:1.4rem;font-weight:900;color:#0f172a;letter-spacing:-.5px;">${esc(storeName)}</div>
                <div style="font-size:.68rem;font-weight:700;color:${corBarra};letter-spacing:1px;margin-top:2px;">RECIBO · DOC ${esc(item.docNumber || '')}</div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:14px;">
                <div style="font-size:.6rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Cliente</div>
                <div style="font-size:1rem;font-weight:800;color:#1e293b;margin:2px 0 6px;">${esc(item.nome || '-')}</div>
                <div style="font-size:.75rem;color:#64748b;">CPF: ${esc(item.cpf || '-')} &nbsp;·&nbsp; Tel: ${esc(item.tel || '-')}</div>
            </div>
            <div style="margin-bottom:14px;">
                <div style="font-size:.6rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Produtos</div>
                ${itensHtml}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;background:${corBarra};border-radius:10px;padding:12px 16px;margin-bottom:14px;">
                <span style="color:#fff;font-size:.8rem;font-weight:700;">TOTAL</span>
                <span style="color:#fff;font-size:1.3rem;font-weight:900;">${fmt(item.total || 0)}</span>
            </div>
            ${item.garantiaTxt ? `
            <div style="display:flex;justify-content:space-between;align-items:center;background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:10px 16px;margin-bottom:14px;">
                <span style="color:#4338ca;font-size:.72rem;font-weight:700;"><span style="margin-right:5px;">🛡️</span>Garantia</span>
                <span style="color:#4338ca;font-size:.8rem;font-weight:800;">${esc(item.garantiaTxt)}</span>
            </div>` : ''}
            <div style="text-align:right;font-size:.72rem;color:#64748b;border-top:1px dashed #cbd5e1;padding-top:10px;">
                <span>Data: ${dataFmt}</span>
            </div>
            <div style="text-align:center;margin-top:16px;font-size:.6rem;color:#cbd5e1;">Gerado via ${esc(storeName)}</div>
        </div>`;
    }

    // ── Gerar imagem do recibo (canvas) ──────────────────────────
    async function gerarCanvasRecibo(item, cfgPreFetched) {
        const cfg  = cfgPreFetched || await getStoreConfig();
        const html = `<div id="vsReciboExport" style="position:fixed;left:-9999px;top:0;">${construirHtmlRecibo(item, cfg)}</div>`;

        document.body.insertAdjacentHTML('beforeend', html);
        const node = document.getElementById('vsReciboExport');
        try {
            return await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
        } finally {
            node.remove();
        }
    }

    function nomeDocumentoBase(item) {
        const nomeCliente = item.nome || 'Cliente';
        return `Recibo de ${nomeCliente}`.replace(/[\/\\:*?"<>|]/g, '-');
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
        let overlay = document.getElementById('rcLoadingOverlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'rcLoadingOverlay';
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
        const overlay = document.getElementById('rcLoadingOverlay');
        if (overlay) overlay.remove();
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (sucesso) await window._showSuccessOverlay(textoSucesso, 1100);
        window._vsFinalizarProtecaoNavegacao && window._vsFinalizarProtecaoNavegacao();
    }

    // Núcleo reaproveitável: gera e compartilha a partir dos DADOS
    // diretos (não depende de RC.cache, que só existe depois que a
    // tela de Recibo abriu pelo menos uma vez) — usado tanto pelo
    // histórico normal quanto por outro módulo que acabou de gerar um
    // recibo na hora (ex: Concertos) e ainda não tem esse registro em
    // cache nenhum.
    async function compartilharRecibDadosDireto(item) {
        mostrarCarregando('Gerando recibo...');
        try {
            const canvas = await gerarCanvasRecibo(item);
            canvas.toBlob(async blob => {
                const fileName = `${nomeDocumentoBase(item)}.png`;
                const file = new File([blob], fileName, { type: 'image/png' });
                try {
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        try {
                            await navigator.share({ files: [file], title: nomeDocumentoBase(item), text: item.nome ? `Olá ${item.nome},` : 'Olá,' });
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
            }, 'image/png');
        } catch (e) {
            esconderCarregando(false);
            modal({ message: 'Erro ao gerar recibo: ' + e.message });
        }
    }

    async function compartilharRecibo(id) {
        const item = RC.cache.find(i => i.id === id);
        if (!item) return;
        return compartilharRecibDadosDireto(item);
    }
    window._reciboCompartilharComDados = compartilharRecibDadosDireto;

    async function baixarRecibo(id) {
        const item = RC.cache.find(i => i.id === id);
        if (!item) return;
        mostrarCarregando('Gerando imagem...');
        try {
            const canvas = await gerarCanvasRecibo(item);
            canvas.toBlob(async blob => {
                try { baixarBlob(blob, `${nomeDocumentoBase(item)}.png`); }
                finally { await esconderCarregando(true, 'Baixado!'); }
            }, 'image/png');
        } catch (e) {
            await esconderCarregando(false);
            modal({ message: 'Erro ao gerar recibo: ' + e.message });
        }
    }

})();
