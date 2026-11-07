// ================================================================
// documentos/orcamento.js — VortexSmart · Orçamento
// Clone do Garantia (Bookip): mesmos dados, mesmo layout e mesmas
// animações — SEM o bloco de Termos de Garantia (que o Bookip puxa
// de configuracoes/documentos). Salva em coleção própria ('orcamentos'),
// separada da Garantia, para não misturar os históricos.
// Registra: window._initOrcamento()
// Depende de (via window.*):
//   showCustomModal, escapeHtml, products, _fuse,
//   _lojaRef, _dbOnValue, _dbUpdate, _dbPush,
//   _dbGet, _dbRemove, openDocumentosSection,
//   _lojaStorageRef, _storageUploadBytes, _storageGetDownloadURL
// ================================================================
(function () {
    'use strict';
    // yyyy-mm-dd no fuso do computador. toISOString() é UTC: depois das 21h no Brasil já dá "amanhã".
    const dataLocalISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const el    = id   => document.getElementById(id);
    const esc   = t    => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt   = v    => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    // Converte **texto** em <b>texto</b> — sempre escapa o HTML primeiro
    // (segurança) e só então aplica o negrito na string já escapada.
    const boldify = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    // Remove emojis do nome do produto (usados como cor/etiqueta interna)
    // antes de preencher campos que vão pro documento do cliente.
    const stripEmoji = t => (t || '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\uFE0F]/gu, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    // input[type=date].value SÓ aceita "YYYY-MM-DD" — qualquer outro
    // formato (ex: "24/07/2026" ou datas sem zero à esquerda) é
    // silenciosamente rejeitado e o campo fica vazio. Normaliza aqui
    // pra garantir que a data salva sempre volte a aparecer na edição.
    const toISODate = v => {
        if (!v) return '';
        v = String(v).trim();
        if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return v.slice(0, 10);   // a data que está escrita (um aniversário não anda por fuso)
        const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
        const d = new Date(v);
        return isNaN(d) ? '' : dataLocalISO(d);
    };
    // dbref(caminho) agora monta a referência DENTRO da loja logada —
    // todas as chamadas existentes já ficam isoladas por loja
    // automaticamente, sem precisar editar cada uma individualmente.
    const dbref = (caminho) => window._lojaRef(caminho);

    const GR = {
        initialized: false,
        view: 'novo',
        cart: [],
        editId: null,
        fotoUrl: '',
        cache: [],
        listenerAttached: false,
        histSub: 'ativos',       // 'ativos' | 'lixeira'
        expandedIds: new Set(),  // ids dos cards abertos no histórico
        renderedIds: new Set(),  // ids cujo conteúdo interno já foi montado (lazy render)
        histVisibleCount: 50,    // paginação do histórico
    };

    const LIXEIRA_DIAS = 30;
    const HIST_PAGE_SIZE = 50;

    // ── Paginação do PDF completo ──────────────────────────────────
    // O container offscreen tem width:794px, que equivale exatamente
    // à largura de uma página A4 a 96dpi. Por isso a altura de página
    // em "px de tela" (mesma unidade do offsetTop/offsetHeight do DOM)
    // é 297mm convertidos para px nessa mesma escala.
    const PX_PER_MM      = 96 / 25.4;
    const PRINT_PAGE_H_PX = 297 * PX_PER_MM;

    // Evita que blocos marcados com .vs-avoid-break fiquem cortados na
    // borda entre duas páginas: se um bloco cruza a linha de quebra,
    // empurra ele (margin-top) para o início da próxima página.
    function evitarCorteDePagina(container, pageHeightPx) {
        container.querySelectorAll('.vs-avoid-break').forEach(elm => {
            const top    = elm.offsetTop;
            const bottom = top + elm.offsetHeight;
            const topPage    = Math.floor(top / pageHeightPx);
            const bottomPage = Math.floor((bottom - 1) / pageHeightPx);
            if (topPage !== bottomPage && elm.offsetHeight < pageHeightPx) {
                const nextPageTop = (topPage + 1) * pageHeightPx;
                const currentMT = parseFloat(getComputedStyle(elm).marginTop) || 0;
                elm.style.marginTop = (currentMT + (nextPageTop - top)) + 'px';
            }
        });
    }

    const PAGAMENTOS = ['Dinheiro/Pix', 'Crédito', 'Débito', 'Boleto', 'Troca'];

    // ── CSS do PDF completo — injetado no <head> da página principal
    // na hora de imprimir (ver imprimirOrcamentoCompleto).
    const PRINT_CSS = `
        @page { size: A4; margin: 14mm 12mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        /* Fonte de sistema, de propósito — não usa a Poppins (Google
           Fonts) aqui. O html2canvas tem um pipeline próprio, separado
           do navegador, pra "incorporar" fontes customizadas no canvas,
           e esse pipeline falha silenciosamente em alguns aparelhos:
           o layout é calculado com a fonte certa mas o desenho final
           cai numa fonte de fallback com métricas diferentes — daí as
           letras saem coladas/embaralhadas. Fonte de sistema não passa
           por esse pipeline (o navegador já tem ela nativamente), então
           esse bug inteiro deixa de poder acontecer. */
        body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; }
        .vs-print-doc { font-size: 11px; line-height: 1.5; }
        .vs-print-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
        .vs-print-logo { width: 76px; height: 76px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
        .vs-print-logo-placeholder { display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #94a3b8; font-size: 1.6rem; }
        .vs-print-title-block { text-align: right; flex: 1; }
        .vs-print-title-sub { font-size: 15px; color: #1e293b; }
        .vs-print-title-main { font-size: 20px; font-weight: 800; color: #1e293b; margin-bottom: 8px; }
        .vs-print-store-info { font-size: 10px; color: #334155; line-height: 1.6; }
        .vs-print-store-name { font-weight: 700; }
        .vs-print-divider { border-top: 1px solid #cbd5e1; margin: 16px 0; }
        .vs-print-client-row { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
        .vs-print-client-col { flex: 1; }
        .vs-print-client-name { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
        .vs-print-field { font-size: 10.5px; color: #334155; }
        .vs-print-field b { color: #1e293b; }
        .vs-print-doc-col { min-width: 150px; }
        .vs-print-docinfo-row { display: flex; justify-content: space-between; gap: 12px; font-size: 10.5px; color: #334155; margin-bottom: 2px; }
        .vs-print-docinfo-row b { color: #1e293b; }
        .vs-print-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
        .vs-print-table thead th { background: #16a34a; color: #fff; font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 8px 10px; text-align: left; }
        .vs-print-table tbody td { padding: 9px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; vertical-align: top; }
        .vs-print-table tbody tr { page-break-inside: avoid; }
        .vs-print-item-name { font-weight: 700; }
        .vs-print-item-sub { font-size: 9.5px; color: #64748b; margin-top: 2px; }
        .vs-print-footer-row { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #1e293b; margin-bottom: 16px; }
        .vs-print-total-box { background: #f1f5f9; border-radius: 8px; padding: 8px 16px; font-weight: 700; font-size: 12px; }
        .vs-print-terms-title { font-size: 11px; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 6px; }
        .vs-print-terms-text { font-size: 9.5px; color: #334155; line-height: 1.7; }
        .vs-print-terms-gap { height: 9.5px; }
        .vs-print-signature { margin-top: 40px; display: flex; justify-content: flex-end; }
        .vs-print-signature-line { width: 220px; border-top: 1px solid #1e293b; text-align: center; padding-top: 4px; font-size: 9px; color: #64748b; }
        .vs-print-signature-line::after { content: 'Assinatura'; }
        .vs-print-signature-img { max-width: 220px; max-height: 80px; object-fit: contain; }
    `;

    window._initOrcamento = function () {
        if (!GR.initialized) {
            renderShell();
            attachListeners();
            GR.initialized = true;
        }
        if (!GR.listenerAttached) {
            loadHistorico();
            GR.listenerAttached = true;
        }
        resetForm();
        switchView('novo');
    };

    // ── Shell (design Sanfona/Accordion) ─────────────────────────
    function renderShell() {
        const wrap = el('documentosOrcamento');
        if (!wrap) return;
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Orçamento</h3>
            </div>
            <div class="content-card w-100" style="padding-bottom:170px;">
                <div class="row g-2 mb-3">
                    <div class="col-6"><button class="btn btn-info w-100" id="orTabNovo"><i class="bi bi-plus-lg"></i> Nova</button></div>
                    <div class="col-6"><button class="btn btn-secondary w-100" id="orTabHist"><i class="bi bi-clock-history"></i> Histórico</button></div>
                </div>

                <!-- ══ VIEW: NOVO ORÇAMENTO (Sanfona) ══ -->
                <div id="orViewNovo">

                    <!-- ① CLIENTE -->
                    <div class="bk-sec open" id="orSecCliente">
                        <div class="bk-sec-head" data-sec="orSecCliente">
                            <div class="bk-sec-badge">1</div>
                            <div class="bk-sec-info">
                                <div class="bk-sec-name">Cliente</div>
                                <div class="bk-sec-sub" id="orSubCliente">Toque para preencher</div>
                            </div>
                            <i class="bi bi-chevron-down bk-sec-chevron"></i>
                        </div>
                        <div class="bk-sec-body">
                            <div class="mb-2" style="position:relative;">
                                <label class="form-label">Nome Completo</label>
                                <input class="form-control" id="orNome" placeholder="Nome do cliente" autocomplete="off">
                                <div class="search-results-container" id="orClienteResNome" style="display:none;"></div>
                            </div>
                            <div class="row g-2 mb-1">
                                <div class="col-6" style="position:relative;">
                                    <label class="form-label">CPF</label>
                                    <input class="form-control" id="orCpf" placeholder="000.000.000-00" autocomplete="off">
                                    <div class="search-results-container" id="orClienteResCpf" style="display:none;"></div>
                                </div>
                                <div class="col-6" style="position:relative;">
                                    <label class="form-label">Telefone</label>
                                    <input class="form-control" id="orTel" placeholder="(XX) 9XXXX-XXXX" autocomplete="off">
                                    <div class="search-results-container" id="orClienteResTel" style="display:none;"></div>
                                </div>
                            </div>
                            <div class="row g-2 mb-1">
                                <div class="col-6"><label class="form-label">🎂 Nascimento</label><input class="form-control" id="orNasc" type="date"></div>
                                <div class="col-6"><label class="form-label">Email (Opcional)</label><input class="form-control" id="orEmail" placeholder="cliente@email.com"></div>
                            </div>
                            <div class="mb-1"><label class="form-label">Endereço / CEP</label><input class="form-control" id="orEnd" placeholder="Endereço completo"></div>
                        </div>
                    </div>

                    <!-- ② PRODUTOS -->
                    <div class="bk-sec" id="orSecProdutos">
                        <div class="bk-sec-head" data-sec="orSecProdutos">
                            <div class="bk-sec-badge">2</div>
                            <div class="bk-sec-info">
                                <div class="bk-sec-name">Produtos</div>
                                <div class="bk-sec-sub" id="orSubProdutos">Nenhum item</div>
                            </div>
                            <i class="bi bi-chevron-down bk-sec-chevron"></i>
                        </div>
                        <div class="bk-sec-body">
                            <div class="mb-2" style="position:relative;">
                                <div class="bk-search-dash" id="orProdBuscaWrap">
                                    <i class="bi bi-search"></i>
                                    <input id="orProdBusca" placeholder="Buscar produto no sistema..." autocomplete="off">
                                </div>
                                <div class="search-results-container" id="orProdResultados" style="display:none;"></div>
                            </div>
                            <div class="mb-2"><input class="form-control" id="orProdNome" placeholder="Nome do produto"></div>
                            <div class="d-flex gap-2 mb-2">
                                <button class="btn btn-sm btn-secondary" id="orChipNovo" type="button">+ Novo/Lacrado</button>
                                <button class="btn btn-sm btn-secondary" id="orChipSemi" type="button">+ Seminovo</button>
                            </div>
                            <div class="row g-2 mb-2">
                                <div class="col-4"><input class="form-control" id="orProdQtd" type="number" min="1" value="1"></div>
                                <div class="col-8"><input class="form-control" id="orProdValor" type="number" step="0.01" min="0" placeholder="Valor Unit (R$)"></div>
                            </div>
                            <div class="mb-2"><input class="form-control" id="orProdCor" placeholder="Cor / Detalhe"></div>
                            <div class="mb-2"><input class="form-control" id="orProdObs" placeholder="IMEI / Serial / Obs"></div>
                            <button class="btn btn-primary w-100 mb-3" id="orAddItem"><i class="bi bi-plus-lg"></i> Adicionar à Lista</button>
                            <div id="orCartList"></div>
                        </div>
                    </div>

                    <!-- ③ DETALHES FINAIS -->
                    <div class="bk-sec" id="orSecDetalhes">
                        <div class="bk-sec-head" data-sec="orSecDetalhes">
                            <div class="bk-sec-badge">3</div>
                            <div class="bk-sec-info">
                                <div class="bk-sec-name">Detalhes Finais</div>
                                <div class="bk-sec-sub" id="orSubDetalhes">Garantia · Pagamento</div>
                            </div>
                            <i class="bi bi-chevron-down bk-sec-chevron"></i>
                        </div>
                        <div class="bk-sec-body">
                            <div class="row g-2 mb-1">
                                <div class="col-6"><label class="form-label">Data da Venda</label><input class="form-control" id="orDataVenda" type="date"></div>
                                <div class="col-6">
                                    <label class="form-label">Tempo de Garantia</label>
                                    <select class="form-select" id="orDias">
                                        <option value="90">90 dias</option>
                                        <option value="180">180 dias</option>
                                        <option value="365" selected>1 Ano (Padrão)</option>
                                        <option value="custom">Personalizado</option>
                                    </select>
                                </div>
                            </div>
                            <input class="form-control hidden mb-3" id="orDiasCustom" type="number" min="0" placeholder="Quantidade de dias">
                            <div class="mb-2 mt-2"><label class="form-label">Forma(s) de Pagamento</label></div>
                            <div class="d-flex flex-wrap gap-3 mb-3" id="orPagamentos">
                                ${PAGAMENTOS.map((p, i) => `
                                <label class="form-check" style="cursor:pointer;">
                                    <input class="form-check-input" type="checkbox" value="${p}" id="orPag${i}">
                                    <span class="form-check-label">${p}</span>
                                </label>`).join('')}
                            </div>
                        </div>
                    </div>

                    <!-- Barra fixa: Total + Salvar -->
                    <div class="bk-total-bar">
                        <div>
                            <div class="bk-total-label">Total</div>
                            <div class="bk-total-val" id="orTotal">R$ 0,00</div>
                        </div>
                        <button class="btn" id="orSave" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;box-shadow:0 4px 12px rgba(34,197,94,.35);padding:10px 22px;">
                            <i class="bi bi-check-circle-fill"></i> Salvar
                        </button>
                    </div>

                    <button class="btn w-100 mt-2 text-secondary" id="orNovoRecibo" style="background:none;border:none;">
                        <i class="bi bi-plus-circle"></i> Começar um Novo Orçamento
                    </button>
                </div>

                <!-- ══ VIEW: HISTÓRICO ══ -->
                <div id="orViewHist" style="display:none;">
                    <div class="mb-2 d-flex gap-2">
                        <input class="form-control" id="orHistSearch" placeholder="Nome, CPF, Doc ou Produto..." style="flex:1;">
                        <button class="btn-back" id="orHistDateToggle" aria-label="Filtrar por data" title="Filtrar por data"><i class="bi bi-calendar3"></i></button>
                    </div>
                    <div id="orHistDatePanel" class="hidden" style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
                        <div style="flex:1;">
                            <label class="form-label" style="font-size:.7rem;">De</label>
                            <input class="form-control" id="orHistDataDe" type="date">
                        </div>
                        <div style="flex:1;">
                            <label class="form-label" style="font-size:.7rem;">Até</label>
                            <input class="form-control" id="orHistDataAte" type="date">
                        </div>
                        <button class="btn-back" id="orHistDateClear" aria-label="Limpar datas" title="Limpar datas" style="align-self:flex-end;margin-bottom:2px;"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="d-flex justify-content-end mb-3">
                        <button class="bk-lixeira-link" id="orLixeiraToggle" type="button">
                            <i class="bi bi-trash3"></i> <span id="orLixeiraLabel">Lixeira</span>
                        </button>
                    </div>
                    <div id="orHistList"></div>
                    <div id="orHistEmpty" class="text-center text-secondary hidden" style="padding:2rem 0;">
                        <i class="bi bi-inbox" style="font-size:2.5rem;"></i>
                        <p class="mt-2">Nenhum orçamento encontrado.</p>
                    </div>
                </div>
            </div>
        `;
    }

    // ── Sanfona: toggle + resumos ─────────────────────────────────
    function toggleSec(secId) {
        const sec = el(secId);
        if (!sec) return;
        const wasOpen = sec.classList.contains('open');
        document.querySelectorAll('.bk-sec').forEach(s => s.classList.remove('open'));
        if (!wasOpen) sec.classList.add('open');
        updateResumos();
    }

    function updateResumos() {
        // Cliente
        const nome = el('orNome')?.value.trim();
        const preenchidos = ['orNome','orCpf','orTel','orNasc','orEmail','orEnd'].filter(id => el(id)?.value.trim()).length;
        const subC = el('orSubCliente');
        const secC = el('orSecCliente');
        if (subC) subC.textContent = nome ? `${nome} · ${preenchidos} campo${preenchidos > 1 ? 's' : ''} ✓` : 'Toque para preencher';
        secC?.classList.toggle('done', !!nome);

        // Produtos
        const subP = el('orSubProdutos');
        const secP = el('orSecProdutos');
        if (subP) subP.textContent = GR.cart.length
            ? `${GR.cart.length} ${GR.cart.length === 1 ? 'item' : 'itens'} · ${fmt(cartTotal())}`
            : 'Nenhum item';
        secP?.classList.toggle('done', GR.cart.length > 0);

        // Detalhes
        const subD = el('orSubDetalhes');
        const secD = el('orSecDetalhes');
        const pags = Array.from(document.querySelectorAll('#orPagamentos input:checked')).map(c => c.value);
        const diasSel = el('orDias');
        const diasTxt = diasSel ? (diasSel.value === 'custom' ? (el('orDiasCustom')?.value || '?') + ' dias' : diasSel.options[diasSel.selectedIndex].text) : '';
        if (subD) subD.textContent = pags.length ? `${diasTxt} · ${pags.join(', ')}` : 'Garantia · Pagamento';
        secD?.classList.toggle('done', pags.length > 0);
    }

    // ── Listeners ────────────────────────────────────────────────
    function attachListeners() {
        // Sanfona: toggle das seções
        document.querySelectorAll('.bk-sec-head').forEach(head => {
            head.addEventListener('click', () => toggleSec(head.dataset.sec));
        });
        // Resumos dinâmicos ao digitar
        ['orNome','orCpf','orTel','orNasc','orEmail','orEnd'].forEach(id => {
            el(id)?.addEventListener('input', updateResumos);
        });
        el('orDias')?.addEventListener('change', updateResumos);
        el('orDiasCustom')?.addEventListener('input', updateResumos);
        document.querySelectorAll('#orPagamentos input').forEach(c => c.addEventListener('change', updateResumos));
        el('orTabNovo')?.addEventListener('click', () => switchView('novo'));
        el('orTabHist')?.addEventListener('click', () => switchView('historico'));
        el('orAddItem')?.addEventListener('click', addCartItem);
        el('orSave')?.addEventListener('click', saveOrcamento);
        el('orNovoRecibo')?.addEventListener('click', () => { resetForm(); modal({ message: 'Novo recibo iniciado.' }); });
        el('orDias')?.addEventListener('change', () => {
            el('orDiasCustom').classList.toggle('hidden', el('orDias').value !== 'custom');
        });

        // Chips Novo/Seminovo
        el('orChipNovo')?.addEventListener('click', () => appendToNome('Novo/Lacrado'));
        el('orChipSemi')?.addEventListener('click', () => appendToNome('Seminovo'));

        // Busca de produtos do sistema
        el('orProdBusca')?.addEventListener('input', onBuscaProduto);
        document.addEventListener('click', e => {
            if (!e.target.closest('#orProdResultados') && e.target.id !== 'orProdBusca') {
                const r = el('orProdResultados'); if (r) r.style.display = 'none';
            }
        });

        // Autopreenchimento de cliente (Nome / CPF / Telefone)
        setupClienteAutocomplete();

        el('orHistSearch')?.addEventListener('input', () => {
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('orHistSearch').value);
        });
        el('orHistDateToggle')?.addEventListener('click', () => {
            el('orHistDatePanel')?.classList.toggle('hidden');
        });
        el('orHistDataDe')?.addEventListener('change', () => {
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('orHistSearch')?.value || '');
        });
        el('orHistDataAte')?.addEventListener('change', () => {
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('orHistSearch')?.value || '');
        });
        el('orHistDateClear')?.addEventListener('click', () => {
            if (el('orHistDataDe')) el('orHistDataDe').value = '';
            if (el('orHistDataAte')) el('orHistDataAte').value = '';
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('orHistSearch')?.value || '');
        });

        el('orCartList')?.addEventListener('click', e => {
            const btn = e.target.closest('[data-remove]');
            if (!btn) return;
            GR.cart.splice(parseInt(btn.dataset.remove), 1);
            renderCartList();
        });
        el('orHistList')?.addEventListener('click', e => {
            if (e.target.closest('#orVerMais')) {
                GR.histVisibleCount += HIST_PAGE_SIZE;
                renderHistList(el('orHistSearch')?.value || '');
                return;
            }
            const editBtn   = e.target.closest('[data-edit]');
            const delBtn    = e.target.closest('[data-del]');
            const toggleBtn = e.target.closest('[data-toggle]');
            const copyBtn   = e.target.closest('[data-copy-nome]');
            const waBtn     = e.target.closest('[data-whatsapp]');
            const dadosBtn  = e.target.closest('[data-dados]');
            const enviarBtn = e.target.closest('[data-enviar]');
            const fotoBtn   = e.target.closest('[data-foto]');
            const downBtn   = e.target.closest('[data-download]');
            const restBtn   = e.target.closest('[data-restore]');
            const purgeBtn  = e.target.closest('[data-purge]');

            if (editBtn)   { e.stopPropagation(); loadForEdit(editBtn.dataset.edit); return; }
            if (copyBtn)   { e.stopPropagation(); copiarNome(copyBtn.dataset.copyNome); return; }
            if (waBtn)     { e.stopPropagation(); abrirWhatsapp(waBtn.dataset.whatsapp); return; }
            if (dadosBtn)  { e.stopPropagation(); copiarDados(dadosBtn.dataset.dados); return; }
            if (enviarBtn) { e.stopPropagation(); compartilharOrcamento(enviarBtn.dataset.enviar); return; }
            if (fotoBtn)   { e.stopPropagation(); verFoto(fotoBtn.dataset.foto); return; }
            if (downBtn)   { e.stopPropagation(); baixarOrcamento(downBtn.dataset.download); return; }
            if (restBtn)   { e.stopPropagation(); restaurarOrcamento(restBtn.dataset.restore); return; }
            if (purgeBtn)  { e.stopPropagation(); excluirDefinitivo(purgeBtn.dataset.purge); return; }
            if (delBtn)    { e.stopPropagation(); deleteOrcamento(delBtn.dataset.del); return; }

            if (toggleBtn) {
                toggleHistCard(toggleBtn.dataset.toggle);
            }
        });

        el('orLixeiraToggle')?.addEventListener('click', () => {
            GR.histSub = GR.histSub === 'lixeira' ? 'ativos' : 'lixeira';
            GR.expandedIds.clear();
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('orHistSearch')?.value || '');
        });
    }

    function appendToNome(palavra) {
        const input = el('orProdNome');
        if (!input) return;
        const atual = input.value.trim();
        if (!atual.toLowerCase().includes(palavra.toLowerCase())) {
            input.value = atual ? `${atual} ${palavra}` : palavra;
        }
    }

    // ── Busca de produtos do sistema ─────────────────────────────
    // ── Autopreenchimento de Cliente — busca em orçamentos já salvos ──
    // Não precisa de coleção nova no Firebase: usa o histórico (GR.cache)
    // que já fica carregado. Dedupe por CPF (ou nome, se não tiver CPF),
    // mantendo o registro mais recente de cada cliente.
    function buscarClientesUnicos(query, campo) {
        const q = query.trim().toLowerCase();
        if (q.length < 2) return [];

        const vistos = new Set();
        const resultados = [];
        for (const item of GR.cache) {
            if (item.deletedAt) continue;
            const valor = (item[campo] || '').toString().toLowerCase();
            if (!valor.includes(q)) continue;

            const chave = (item.cpf || item.nome || '').toLowerCase();
            if (vistos.has(chave)) continue;
            vistos.add(chave);
            resultados.push(item);
            if (resultados.length >= 6) break;
        }
        return resultados;
    }

    function renderClienteResultados(containerId, resultados) {
        const box = el(containerId);
        if (!box) return;
        if (!resultados.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        box.innerHTML = resultados.map(item => `
            <button class="list-group-item" type="button" data-cliente-id="${item.id}">
                <div style="font-weight:600;">${esc(item.nome || 'Sem nome')}</div>
                <div class="text-secondary small">${esc(item.cpf || 'CPF não inf.')} ${item.tel ? '· ' + esc(item.tel) : ''}</div>
            </button>`).join('');
        box.style.display = 'block';
        box.querySelectorAll('[data-cliente-id]').forEach(btn => {
            btn.addEventListener('click', () => preencherCliente(btn.dataset.clienteId));
        });
    }

    function preencherCliente(id) {
        const item = GR.cache.find(i => i.id === id);
        if (!item) return;
        if (el('orNome'))  el('orNome').value  = item.nome || '';
        if (el('orCpf'))   el('orCpf').value   = item.cpf || '';
        if (el('orTel'))   el('orTel').value   = item.tel || '';
        if (el('orEmail')) el('orEmail').value = item.email || '';
        if (el('orEnd'))   el('orEnd').value   = item.end || '';
        if (el('orNasc'))  el('orNasc').value  = toISODate(item.dataNascimento);
        ['orClienteResNome', 'orClienteResCpf', 'orClienteResTel'].forEach(cid => {
            const box = el(cid);
            if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        });
        updateResumos();
        if (navigator.vibrate) navigator.vibrate(15);
    }

    function setupClienteAutocomplete() {
        const campos = [
            { inputId: 'orNome', campo: 'nome', resId: 'orClienteResNome' },
            { inputId: 'orCpf',  campo: 'cpf',  resId: 'orClienteResCpf' },
            { inputId: 'orTel',  campo: 'tel',  resId: 'orClienteResTel' },
        ];
        campos.forEach(({ inputId, campo, resId }) => {
            el(inputId)?.addEventListener('input', () => {
                // Se estamos editando um orçamento existente, não sugere
                // (evita ficar re-sugerindo o próprio registro em edição).
                if (GR.editId) return;
                const resultados = buscarClientesUnicos(el(inputId).value, campo);
                renderClienteResultados(resId, resultados);
            });
        });
        document.addEventListener('click', e => {
            campos.forEach(({ inputId, resId }) => {
                if (e.target.id !== inputId && !e.target.closest('#' + resId)) {
                    const box = el(resId);
                    if (box) box.style.display = 'none';
                }
            });
        });
    }

    function onBuscaProduto() {
        const q = el('orProdBusca')?.value.trim();
        const box = el('orProdResultados');
        if (!box) return;
        if (!q || q.length < 2) { box.style.display = 'none'; return; }

        const prods = window.products || [];
        const fuse  = window._fuse;
        const results = fuse
            ? fuse.search(q).map(r => r.item).slice(0, 8)
            : prods.filter(p => (p.nome || '').toLowerCase().includes(q.toLowerCase())).slice(0, 8);

        if (!results.length) {
            box.innerHTML = `<div class="list-group-item text-secondary small">Nenhum produto — digite manualmente</div>`;
        } else {
            box.innerHTML = results.map(p => `
                <button class="list-group-item" type="button" data-nome="${esc(stripEmoji(p.nome))}" data-valor="${p.valor || 0}">
                    ${esc(p.nome)} — <span class="text-primary fw-bold">${fmt(p.valor)}</span>
                </button>`).join('');
            box.querySelectorAll('[data-nome]').forEach(btn => {
                btn.addEventListener('click', () => {
                    el('orProdNome').value  = btn.dataset.nome;
                    el('orProdValor').value = btn.dataset.valor;
                    el('orProdBusca').value = '';
                    box.style.display = 'none';
                });
            });
        }
        box.style.display = 'block';
    }

    // ── Views ────────────────────────────────────────────────────
    function switchView(view) {
        GR.view = view;
        el('orViewNovo').style.display = view === 'novo' ? 'block' : 'none';
        el('orViewHist').style.display = view === 'historico' ? 'block' : 'none';
        el('orTabNovo')?.classList.toggle('btn-info', view === 'novo');
        el('orTabNovo')?.classList.toggle('btn-secondary', view !== 'novo');
        el('orTabHist')?.classList.toggle('btn-info', view === 'historico');
        el('orTabHist')?.classList.toggle('btn-secondary', view !== 'historico');
        if (view === 'historico') renderHistList(el('orHistSearch')?.value || '');
    }

    function resetForm() {
        GR.cart = []; GR.editId = null; GR.fotoUrl = '';
        ['orNome','orCpf','orTel','orNasc','orEmail','orEnd',
         'orProdBusca','orProdNome','orProdValor','orProdCor','orProdObs','orDiasCustom'].forEach(id => { if (el(id)) el(id).value = ''; });
        if (el('orProdQtd')) el('orProdQtd').value = 1;
        if (el('orDias')) el('orDias').value = '365';
        el('orDiasCustom')?.classList.add('hidden');
        if (el('orDataVenda')) el('orDataVenda').value = dataLocalISO(new Date());
        document.querySelectorAll('#orPagamentos input[type=checkbox]').forEach(c => c.checked = false);
        // Sanfona sempre volta com "Cliente" expandida — é a primeira coisa
        // a preencher num documento novo.
        document.querySelectorAll('.bk-sec').forEach(s => s.classList.remove('open'));
        el('orSecCliente')?.classList.add('open');
        renderCartList();
    }

    // ── Carrinho ─────────────────────────────────────────────────
    function addCartItem() {
        const nome  = el('orProdNome')?.value.trim();
        const valor = parseFloat(el('orProdValor')?.value) || 0;
        const qtd   = parseInt(el('orProdQtd')?.value) || 1;
        const cor   = el('orProdCor')?.value.trim() || '';
        const obs   = el('orProdObs')?.value.trim() || '';
        if (!nome) { modal({ message: 'Digite o nome do produto.' }); return; }
        GR.cart.push({ nome, valor, qtd, cor, obs });
        ['orProdNome','orProdValor','orProdCor','orProdObs','orProdBusca'].forEach(id => { if (el(id)) el(id).value = ''; });
        if (el('orProdQtd')) el('orProdQtd').value = 1;
        renderCartList();
        if (navigator.vibrate) navigator.vibrate(20);
    }

    function cartTotal() {
        return GR.cart.reduce((t, i) => t + (i.valor * i.qtd), 0);
    }

    function renderCartList() {
        const wrap = el('orCartList');
        if (!wrap) return;
        if (GR.cart.length === 0) {
            wrap.innerHTML = `<p class="text-secondary small mb-2 text-center" style="padding:10px;border:1px dashed var(--border);border-radius:10px;">Nenhum item adicionado.</p>`;
        } else {
            wrap.innerHTML = GR.cart.map((item, i) => `
                <div class="content-card mb-2" style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
                    <div style="flex:1;min-width:0;">
                        <div class="fw-bold">${esc(item.nome)} <span class="text-secondary small">x${item.qtd}</span></div>
                        <div class="text-secondary small">${item.cor ? esc(item.cor) + ' · ' : ''}${item.obs ? esc(item.obs) + ' · ' : ''}${fmt(item.valor * item.qtd)}</div>
                    </div>
                    <button class="btn-back" data-remove="${i}" aria-label="Remover"><i class="bi bi-trash3"></i></button>
                </div>
            `).join('');
        }
        const total = el('orTotal');
        if (total) total.textContent = fmt(cartTotal());
        updateResumos();
    }

    // ── Salvar ───────────────────────────────────────────────────
    async function saveOrcamento() {
        const nome = el('orNome')?.value.trim();
        if (!nome) { modal({ message: 'Digite o nome do cliente.' }); return; }
        if (GR.cart.length === 0) { modal({ message: 'A lista de produtos está vazia! Adicione ao menos um item.' }); return; }

        const saveBtn = el('orSave');
        const originalHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = 'Salvando...';
        saveBtn.disabled = true;
        mostrarCarregando('Salvando na nuvem...');
        let itemSalvo = null;
        let eraEdicao = false;
        let erro = null;

        try {
            let dias = el('orDias').value;
            dias = dias === 'custom' ? (parseInt(el('orDiasCustom').value) || 0) : parseInt(dias);

            const pagamentos = Array.from(document.querySelectorAll('#orPagamentos input:checked')).map(c => c.value);

            const dados = {
                nome,
                cpf:            el('orCpf')?.value.trim() || '',
                tel:            el('orTel')?.value.trim() || '',
                dataNascimento: el('orNasc')?.value || '',
                email:          el('orEmail')?.value.trim() || '',
                end:            el('orEnd')?.value.trim() || '',
                items:          GR.cart,
                total:          cartTotal(),
                pagamentos,
                diasGarantia:   dias,
                dataVenda:      el('orDataVenda')?.value || dataLocalISO(new Date()),
                fotoUrl:        GR.fotoUrl || '',
                criadoEm:       new Date().toISOString(),
            };

            const snap = await window._dbGet(dbref('orcamentos'));
            if (GR.editId && snap.exists() && snap.val()[GR.editId]) {
                dados.docNumber = snap.val()[GR.editId].docNumber;
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

            let savedId = GR.editId;
            if (GR.editId) {
                await window._dbUpdate(dbref('orcamentos/' + GR.editId), dados);
            } else {
                const newRef = await window._dbPush(dbref('orcamentos'), dados);
                savedId = newRef.key;
            }

            if (navigator.vibrate) navigator.vibrate(50);
            eraEdicao = !!GR.editId;
            itemSalvo = { id: savedId, ...dados };

            // Atualiza o cache local na hora — não depende do listener
            // assíncrono do Firebase, que pode demorar a refletir a
            // mudança se o usuário voltar a editar o mesmo registro
            // logo em seguida (campo ficando "vazio" ao reabrir).
            const idxCache = GR.cache.findIndex(i => i.id === savedId);
            if (idxCache >= 0) GR.cache[idxCache] = normalizarOrcamento({ ...GR.cache[idxCache], ...dados, id: savedId });
            else GR.cache.unshift(normalizarOrcamento({ id: savedId, ...dados }));
        } catch (e) {
            console.error('Erro ao salvar orçamento:', e);
            erro = e;
        } finally {
            saveBtn.innerHTML = originalHtml;
            saveBtn.disabled = false;
            await esconderCarregando(!erro);
        }

        // Só chega aqui depois que a animação de carregamento já sumiu
        // por completo — evita o modal de confirmação aparecer por baixo
        // dela, com os botões "Sim, compartilhar" / "Agora não" com
        // aparência de bloqueados.
        if (erro) {
            modal({ message: 'Erro ao salvar orçamento: ' + erro.message });
            return;
        }

        // Fica na tela de Novo Orçamento — os dados continuam visíveis
        // (desfocados atrás do card) até o usuário compartilhar ou
        // dispensar. Só reseta depois disso, nunca muda de tela sozinho.
        modal({
            message: (eraEdicao ? 'Orçamento atualizado' : 'Documento salvo e seguro na nuvem') + '. Deseja compartilhar agora?',
            confirmText: 'Sim, compartilhar',
            cancelText: 'Agora não',
            onConfirm: async () => { await compartilharOrcamento(itemSalvo, 'preview'); resetForm(); },
            onCancel: () => { resetForm(); },
        });
    }

    // ── Histórico ────────────────────────────────────────────────
    // Normaliza o formato do registro antes de usar (defensivo, mesmo
    // padrão aplicado no módulo de Garantia):
    // - "pagamento" (texto único) em vez de "pagamentos" (lista)
    // - sem campo "total" salvo — soma a partir dos itens
    // Aplicado uma única vez ao carregar, então todo o resto do app
    // (card, edição, PDF, WhatsApp, resumo) já lê o formato atual.
    function normalizarOrcamento(item) {
        if (!Array.isArray(item.pagamentos)) {
            item.pagamentos = item.pagamento ? [item.pagamento] : [];
        }
        if (typeof item.total !== 'number' || isNaN(item.total)) {
            item.total = (item.items || []).reduce((t, i) => t + (i.valor || 0) * (i.qtd || 1), 0);
        }
        return item;
    }

    function loadHistorico() {
        window._dbOnValue(dbref('orcamentos'), snap => {
            const data = snap.val();
            GR.cache = data ? Object.keys(data).map(k => normalizarOrcamento({ id: k, ...data[k] })) : [];
            GR.cache.sort((a, b) => new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0));
            purgeExpiredTrash();
            if (GR.view === 'historico') renderHistList(el('orHistSearch')?.value || '');
        });
    }

    function statusOrcamento(item) {
        if (!item.dataVenda || !item.diasGarantia) return { label: 'GARANTIA ATIVA', cls: 'success' };
        const venc = new Date(item.dataVenda + 'T00:00:00');
        venc.setDate(venc.getDate() + parseInt(item.diasGarantia));
        return venc >= new Date() ? { label: 'GARANTIA ATIVA', cls: 'success' } : { label: 'GARANTIA EXPIRADA', cls: 'danger' };
    }

    function diasRestantesLixeira(item) {
        if (!item.deletedAt) return null;
        const passados = (Date.now() - new Date(item.deletedAt).getTime()) / 86400000;
        return Math.max(0, Math.ceil(LIXEIRA_DIAS - passados));
    }

    function buildDetailHtml(item, naLixeira) {
        const produtosHtml = (item.items || []).map(p => `
            <div class="bk-detail-produto">
                <div class="bk-detail-produto-nome">${esc(p.nome)} <span class="text-secondary">x${p.qtd}</span></div>
                ${(p.cor || p.obs) ? `<div class="bk-detail-produto-meta">${p.cor ? 'Cor: ' + esc(p.cor) : ''}${p.cor && p.obs ? ' · ' : ''}${p.obs ? 'IMEI/Obs: ' + esc(p.obs) : ''}</div>` : ''}
                <div class="bk-detail-produto-valor">${fmt(p.valor * p.qtd)}</div>
            </div>`).join('') || '<div class="text-secondary small">Nenhum produto registrado.</div>';

        const actionsAtivos = `
            <button class="bk-action-btn act-whatsapp" data-whatsapp="${item.id}"><i class="bi bi-whatsapp"></i><span>WhatsApp</span></button>
            <button class="bk-action-btn act-dados" data-dados="${item.id}"><i class="bi bi-clipboard-data"></i><span>Dados</span></button>
            <button class="bk-action-btn act-enviar" data-enviar="${item.id}"><i class="bi bi-share-fill"></i><span>Enviar</span></button>
            ${item.fotoUrl ? `<button class="bk-action-btn act-foto" data-foto="${item.id}"><i class="bi bi-image"></i><span>Foto</span></button>` : ''}
            <button class="bk-action-btn act-baixar" data-download="${item.id}"><i class="bi bi-download"></i><span>Baixar</span></button>
            <button class="bk-action-btn act-excluir" data-del="${item.id}"><i class="bi bi-trash3"></i><span>Excluir</span></button>
        `;
        const actionsLixeira = `
            <button class="bk-action-btn act-restaurar" data-restore="${item.id}"><i class="bi bi-arrow-counterclockwise"></i><span>Restaurar</span></button>
            <button class="bk-action-btn act-excluir" data-purge="${item.id}"><i class="bi bi-trash3-fill"></i><span>Excluir agora</span></button>
        `;

        return `
            <div class="bk-detail-row">
                <div class="bk-detail-label">Comprador</div>
                <div class="d-flex align-items-center gap-2">
                    <div class="bk-detail-value">${esc(item.nome || '-')}</div>
                    <button class="bk-copy-btn" data-copy-nome="${item.id}" title="Copiar nome"><i class="bi bi-clipboard"></i></button>
                </div>
            </div>
            <div class="bk-detail-row">
                <div class="bk-detail-label">Produtos</div>
                ${produtosHtml}
            </div>
            <div class="bk-actions-row">
                ${naLixeira ? actionsLixeira : actionsAtivos}
            </div>
        `;
    }

    function toggleHistCard(id) {
        const card    = document.querySelector(`.bk-hist-card[data-card="${id}"]`);
        const detail  = card?.querySelector('.bk-hist-detail');
        const inner   = detail?.querySelector('.bk-hist-detail-inner');
        const chevron = card?.querySelector('.bk-hist-chevron');
        if (!detail || !inner) return;

        const opening = !GR.expandedIds.has(id);
        if (opening) {
            GR.expandedIds.add(id);
            // Lazy render: só monta o HTML pesado (produtos + botões) na primeira abertura
            if (!GR.renderedIds.has(id)) {
                const item = GR.cache.find(i => i.id === id);
                if (item) {
                    inner.innerHTML = buildDetailHtml(item, GR.histSub === 'lixeira');
                    GR.renderedIds.add(id);
                }
            }
            detail.classList.add('open');
            chevron?.classList.add('open');
            // Mede a altura real do conteúdo (já no DOM) e anima até ela —
            // nunca fica "quase fechado" com sobra de texto vazando.
            detail.style.maxHeight = inner.scrollHeight + 'px';
        } else {
            GR.expandedIds.delete(id);
            detail.classList.remove('open');
            chevron?.classList.remove('open');
            detail.style.maxHeight = '0px';
        }
    }

    function itemMatchesSearch(item, f) {
        if (!f) return true;
        const fDigits = f.replace(/\D/g, '');
        if ((item.nome || '').toLowerCase().includes(f)) return true;
        if (fDigits && (item.cpf || '').replace(/\D/g, '').includes(fDigits)) return true;
        if ((item.docNumber || '').includes(f)) return true;
        if ((item.items || []).some(p => (p.nome || '').toLowerCase().includes(f))) return true;
        return false;
    }

    // Verifica se a data de criação do documento cai dentro do período
    // selecionado nos campos "De" / "Até" (inclusivo nas duas pontas).
    function itemInDateRange(item, de, ate) {
        if (!de && !ate) return true;
        if (!item.criadoEm) return false;
        const dia = dataLocalISO(new Date(item.criadoEm));
        if (de && dia < de) return false;
        if (ate && dia > ate) return false;
        return true;
    }

    function renderHistList(filterText) {
        const wrap  = el('orHistList');
        const empty = el('orHistEmpty');
        if (!wrap) return;
        const f = (filterText || '').toLowerCase().trim();
        const naLixeira = GR.histSub === 'lixeira';
        const dataDe  = el('orHistDataDe')?.value  || '';
        const dataAte = el('orHistDataAte')?.value || '';

        const base = GR.cache.filter(item => naLixeira ? !!item.deletedAt : !item.deletedAt);
        const filtered = base.filter(item => itemMatchesSearch(item, f) && itemInDateRange(item, dataDe, dataAte));

        // Atualiza label/contador do botão Lixeira
        const totalLixeira = GR.cache.filter(i => i.deletedAt).length;
        const lixLabel = el('orLixeiraLabel');
        if (lixLabel) lixLabel.textContent = naLixeira ? 'Voltar' : `Lixeira${totalLixeira ? ' (' + totalLixeira + ')' : ''}`;

        if (filtered.length === 0) {
            wrap.innerHTML = '';
            empty?.classList.remove('hidden');
            if (empty) empty.querySelector('p').textContent = naLixeira ? 'A lixeira está vazia.' : 'Nenhum orçamento encontrado.';
            return;
        }
        empty?.classList.add('hidden');

        const totalFiltrado = filtered.length;
        const visiveis = filtered.slice(0, GR.histVisibleCount);
        const restantes = totalFiltrado - visiveis.length;

        GR.renderedIds.clear(); // DOM será recriado — refaz o rastreio do que já está montado

        wrap.innerHTML = visiveis.map(item => {
            const st = statusOrcamento(item);
            const dataFmt = item.criadoEm ? new Date(item.criadoEm).toLocaleDateString('pt-BR') : '';
            const barColor = naLixeira ? 'var(--text-muted)' : (st.cls === 'success' ? 'var(--success)' : 'var(--danger)');
            const isOpen = GR.expandedIds.has(item.id);
            const diasLix = naLixeira ? diasRestantesLixeira(item) : null;

            // Só monta o conteúdo pesado (produtos + botões) se o card já estava aberto
            let detailInner = '';
            if (isOpen) { detailInner = buildDetailHtml(item, naLixeira); GR.renderedIds.add(item.id); }

            return `
                <div class="content-card bk-hist-card ${naLixeira ? "status-lixeira" : (st.cls === "success" ? "status-ativa" : "status-expirada")}" data-card="${item.id}" style="padding:0;margin-bottom:var(--bk-hist-gap);border-left:3px solid ${barColor};overflow:hidden;">
                    <div class="d-flex justify-content-between align-items-start bk-hist-head" data-toggle="${item.id}" style="padding:var(--bk-hist-pad-y) var(--bk-hist-pad-x);cursor:pointer;">
                        <div style="flex:1;min-width:0;">
                            <span style="background:rgba(0,230,118,.15);color:var(--success);font-size:var(--bk-hist-badge-fs);font-weight:700;padding:2px 8px;border-radius:8px;">Doc ${esc(item.docNumber || '')}</span>
                            <div class="fw-bold mt-1" style="color:var(--text-strong);font-size:var(--bk-hist-title-fs);">${esc(item.nome || 'Sem nome')}</div>
                            ${naLixeira
                                ? `<div class="small text-secondary" style="font-weight:600;font-size:var(--bk-hist-status-fs);"><i class="bi bi-clock-history"></i> exclui em ${diasLix} dia${diasLix === 1 ? '' : 's'}</div>`
                                : `<div class="small" style="color:${barColor};font-weight:600;font-size:var(--bk-hist-status-fs);">${st.label}</div>`}
                            <div class="text-secondary small mt-1" style="font-size:var(--bk-hist-meta-fs);">${dataFmt} · ${item.items?.length || 0} ${(item.items?.length || 0) === 1 ? 'item' : 'itens'} · ${fmt(item.total || 0)}</div>
                        </div>
                        <div class="d-flex align-items-center gap-2" style="font-size:var(--bk-hist-icon-fs);">
                            ${!naLixeira ? `<button class="btn-back" data-edit="${item.id}" aria-label="Editar"><i class="bi bi-pencil"></i></button>` : ''}
                            <i class="bi bi-chevron-down bk-hist-chevron${isOpen ? ' open' : ''}"></i>
                        </div>
                    </div>
                    <div class="bk-hist-detail${isOpen ? ' open' : ''}">
                        <div class="bk-hist-detail-inner">${detailInner}</div>
                    </div>
                </div>
            `;
        }).join('') + (restantes > 0 ? `
            <button class="bk-vermais-btn" id="orVerMais">
                <i class="bi bi-chevron-down"></i> Ver mais (${restantes} restante${restantes === 1 ? '' : 's'})
            </button>` : '');

        // Cards que já estavam abertos antes deste re-render: fixa a altura
        // real na hora (sem transição), já que o HTML foi todo recriado do
        // zero e perdeu qualquer max-height inline que tinha antes.
        wrap.querySelectorAll('.bk-hist-detail.open').forEach(detail => {
            const inner = detail.querySelector('.bk-hist-detail-inner');
            if (!inner) return;
            detail.style.transition = 'none';
            detail.style.maxHeight = inner.scrollHeight + 'px';
            requestAnimationFrame(() => { detail.style.transition = ''; });
        });
    }

    function loadForEdit(id) {
        const item = GR.cache.find(i => i.id === id);
        if (!item) return;
        resetForm();
        GR.editId = id;
        if (el('orNome')) el('orNome').value = item.nome || '';
        if (el('orCpf')) el('orCpf').value = item.cpf || '';
        if (el('orTel')) el('orTel').value = item.tel || '';
        if (el('orNasc')) el('orNasc').value = toISODate(item.dataNascimento);
        if (el('orEmail')) el('orEmail').value = item.email || '';
        if (el('orEnd')) el('orEnd').value = item.end || '';
        if (el('orDataVenda')) el('orDataVenda').value = item.dataVenda || '';
        GR.cart = Array.isArray(item.items) ? JSON.parse(JSON.stringify(item.items)) : [];
        renderCartList();
        (item.pagamentos || []).forEach(p => {
            const cb = Array.from(document.querySelectorAll('#orPagamentos input')).find(c => c.value === p);
            if (cb) cb.checked = true;
        });
        const diasSel = el('orDias');
        const diasPadrao = ['90','180','365'];
        if (diasSel) {
            const diasStr = String(item.diasGarantia || 365);
            diasSel.value = diasPadrao.includes(diasStr) ? diasStr : 'custom';
            if (!diasPadrao.includes(diasStr)) { el('orDiasCustom').classList.remove('hidden'); el('orDiasCustom').value = diasStr; }
        }
        GR.fotoUrl = item.fotoUrl || '';
        switchView('novo');
    }

    function deleteOrcamento(id) {
        modal({
            message: `Mover este orçamento para a lixeira? Ele será excluído definitivamente em ${LIXEIRA_DIAS} dias.`,
            confirmText: 'Mover para lixeira', cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await window._dbUpdate(dbref('orcamentos/' + id), { deletedAt: new Date().toISOString() });
                    modal({ message: 'Movido para a lixeira.' });
                } catch (e) {
                    modal({ message: 'Erro ao excluir: ' + e.message });
                }
            },
            onCancel: () => {}
        });
    }

    function restaurarOrcamento(id) {
        window._dbUpdate(dbref('orcamentos/' + id), { deletedAt: null })
            .then(() => modal({ message: 'Orçamento restaurado.' }))
            .catch(e => modal({ message: 'Erro ao restaurar: ' + e.message }));
    }

    function excluirDefinitivo(id) {
        modal({
            message: 'Excluir definitivamente? Essa ação não pode ser desfeita.',
            confirmText: 'Excluir para sempre', cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await window._dbRemove(dbref('orcamentos/' + id));
                    modal({ message: 'Excluído definitivamente.' });
                } catch (e) {
                    modal({ message: 'Erro ao excluir: ' + e.message });
                }
            },
            onCancel: () => {}
        });
    }

    // Limpeza automática: itens na lixeira há mais de LIXEIRA_DIAS dias são removidos de vez
    function purgeExpiredTrash() {
        GR.cache.forEach(item => {
            if (item.deletedAt) {
                const dias = (Date.now() - new Date(item.deletedAt).getTime()) / 86400000;
                if (dias >= LIXEIRA_DIAS) {
                    window._dbRemove(dbref('orcamentos/' + item.id)).catch(() => {});
                }
            }
        });
    }

    // ── Copiar nome do comprador ───────────────────────────────────
    function copiarNome(id) {
        const item = GR.cache.find(i => i.id === id);
        if (!item) return;
        navigator.clipboard?.writeText(item.nome || '')
            .then(() => modal({ message: 'Nome copiado!' }))
            .catch(() => modal({ message: 'Não foi possível copiar.' }));
    }

    // ── WhatsApp ─────────────────────────────────────────────────
    function abrirWhatsapp(id) {
        const item = GR.cache.find(i => i.id === id);
        if (!item) return;
        const digits = (item.tel || '').replace(/\D/g, '');
        if (!digits) { modal({ message: 'Cliente sem telefone cadastrado.' }); return; }
        const numero = digits.length <= 11 ? '55' + digits : digits;
        window.open(`https://wa.me/${numero}`, '_blank');
    }

    // ── Resumo de dados (copiar) ─────────────────────────────────
    function buildResumoTexto(item) {
        const itensTxt = (item.items || []).map(p =>
            `• ${p.nome} x${p.qtd} — ${fmt(p.valor * p.qtd)}${p.cor ? ` (Cor: ${p.cor})` : ''}${p.obs ? ` [${p.obs}]` : ''}`
        ).join('\n') || 'Nenhum produto';

        const dataVendaFmt = item.dataVenda ? new Date(item.dataVenda + 'T00:00:00').toLocaleDateString('pt-BR') : '-';

        return `*ORÇAMENTO — Doc ${item.docNumber || '-'}*
Cliente: ${item.nome || '-'}
CPF: ${item.cpf || '-'}
Telefone: ${item.tel || '-'}
Endereço: ${item.end || '-'}

Produtos:
${itensTxt}

Forma de pagamento: ${(item.pagamentos || []).join(', ') || '-'}
*Total: ${fmt(item.total || 0)}*
Venda em: ${dataVendaFmt}
Garantia: ${item.diasGarantia || 0} dias`;
    }

    function copiarDados(id) {
        const item = GR.cache.find(i => i.id === id);
        if (!item) return;
        const texto = buildResumoTexto(item);
        navigator.clipboard?.writeText(texto)
            .then(() => modal({ message: 'Resumo copiado! Pronto para colar no WhatsApp.' }))
            .catch(() => modal({ message: 'Não foi possível copiar.' }));
    }

    // ── Ver foto ─────────────────────────────────────────────────
    function verFoto(id) {
        const item = GR.cache.find(i => i.id === id);
        if (!item || !item.fotoUrl) return;
        window.open(item.fotoUrl, '_blank');
    }

    // ── Config de Documentos (loja, logo, assinatura, termos) ────
    // Vem de configuracoes/config-documentos.js, salva no Firebase.
    async function getStoreConfig() {
        try {
            const snap = await window._dbGet(dbref('configuracoes/documentos'));
            return snap.exists() ? snap.val() : {};
        } catch (e) {
            console.error('Erro ao buscar config de documentos:', e);
            return {};
        }
    }

    // ── Largura "de papel" do documento — usada tanto pra captura
    // offscreen (html2canvas) quanto pra pré-visualização real na tela.
    const DOC_WIDTH_COMPLETO = 794;
    // no <head> — idempotente, chamada tanto na geração do PDF quanto
    // na pré-visualização real (que usa as mesmas classes).
    function garantirPrintCss() {
        if (!document.getElementById('vsPrintStyleTag')) {
            const styleTag = document.createElement('style');
            styleTag.id = 'vsPrintStyleTag';
            styleTag.textContent = PRINT_CSS;
            document.head.appendChild(styleTag);
        }
    }

    // Monta o miolo do documento do Layout Completo (classes vs-print-*)
    // — mesma função usada pra gerar o PDF (offscreen) e pra mostrar o
    // documento DE VERDADE na pré-visualização.
    function construirHtmlCompleto(item, cfg) {
        const storeName  = cfg.storeName     || window._nomeLojaCadastrada || 'VORTEXSMART';
        const storeEmail = cfg.storeEmail    || '';
        const storeCnpj  = cfg.storeCNPJ     || '';
        const storeEnd   = cfg.storeEndereco || '';
        const storeTel   = cfg.storeTelefone || '';
        const storeLogo  = cfg.storeLogoUrl  || '';
        const logoSize   = cfg.storeLogoSize || 76;
        const corBarra   = cfg.storeCorBarra || '#16a34a';
        const assinatura = cfg.storeAssinaturaUrl || '';
        const mensagemPadrao = cfg.mensagemPadrao || '';

        const dataVendaFmt = item.dataVenda ? new Date(item.dataVenda + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
        let venceFmt = '-';
        if (item.dataVenda && item.diasGarantia) {
            const v = new Date(item.dataVenda + 'T00:00:00');
            v.setDate(v.getDate() + parseInt(item.diasGarantia));
            venceFmt = v.toLocaleDateString('pt-BR');
        }
        const garantiaLabel = String(item.diasGarantia) === '365' ? '1 Ano' : `${item.diasGarantia || 0} dias`;

        const linhasItens = (item.items || []).map(p => `
            <tr>
                <td>
                    <div class="vs-print-item-name">${esc(p.nome)}</div>
                    ${(p.cor || p.obs) ? `<div class="vs-print-item-sub">${[p.cor, p.obs].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
                </td>
                <td style="text-align:center;">${p.qtd}</td>
                <td style="text-align:right;">${fmt(p.valor)}</td>
                <td style="text-align:right;">${fmt(p.valor * p.qtd)}</td>
            </tr>`).join('');

        const logoHtml = storeLogo
            ? `<img src="${storeLogo}" class="vs-print-logo" crossorigin="anonymous" style="width:${logoSize}px;height:${logoSize}px;">`
            : `<div class="vs-print-logo vs-print-logo-placeholder" style="width:${logoSize}px;height:${logoSize}px;"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" viewBox="0 0 16 16"><path d="M2.97 1.35A1 1 0 0 1 3.73 1h8.54a1 1 0 0 1 .76.35l2.609 3.044A1.5 1.5 0 0 1 16 5.37v.255a2.375 2.375 0 0 1-4.25 1.458A2.37 2.37 0 0 1 9.875 8 2.37 2.37 0 0 1 8 7.083 2.37 2.37 0 0 1 6.125 8a2.37 2.37 0 0 1-1.875-.917A2.375 2.375 0 0 1 0 5.625V5.37a1.5 1.5 0 0 1 .361-.976zm1.78 4.275a1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0 1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0 1.375 1.375 0 1 0 2.75 0V5.37a.5.5 0 0 0-.12-.325L12.27 2H3.73L1.12 5.045A.5.5 0 0 0 1 5.37v.255a1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0M1.5 8.5A.5.5 0 0 1 2 9v6h1v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5h6V9a.5.5 0 0 1 1 0v6h.5a.5.5 0 0 1 0 1H.5a.5.5 0 0 1 0-1H1V9a.5.5 0 0 1 .5-.5M4 15h3v-5H4zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1zm3 0h-2v3h2z"/></svg></div>`;

        const html = `
        <div class="vs-print-doc">
            <div class="vs-print-header vs-avoid-break">
                ${logoHtml}
                <div class="vs-print-title-block">
                    <div class="vs-print-title-sub">Orçamento de</div>
                    <div class="vs-print-title-main">Produtos e Serviços</div>
                    <div class="vs-print-store-info">
                        ${storeName  ? `<div class="vs-print-store-name">${esc(storeName.toUpperCase())}</div>` : ''}
                        ${storeEmail ? `<div>${esc(storeEmail)}</div>` : ''}
                        ${storeCnpj  ? `<div>CNPJ: ${esc(storeCnpj)}</div>` : ''}
                        ${storeEnd   ? `<div>${esc(storeEnd)}</div>` : ''}
                        ${storeTel   ? `<div>${esc(storeTel)}</div>` : ''}
                    </div>
                </div>
            </div>

            <div class="vs-print-divider"></div>

            <div class="vs-print-client-row vs-avoid-break">
                <div class="vs-print-client-col">
                    <div class="vs-print-client-name">${esc(item.nome || '-')}</div>
                    <div class="vs-print-field"><b>CPF:</b> ${esc(item.cpf || '-')}</div>
                    <div class="vs-print-field"><b>Número:</b> ${esc(item.tel || '-')}</div>
                    ${item.email ? `<div class="vs-print-field"><b>E-mail:</b> ${esc(item.email)}</div>` : ''}
                    <div class="vs-print-field"><b>Endereço:</b> ${esc(item.end || '-')}</div>
                </div>
                <div class="vs-print-doc-col">
                    <div class="vs-print-docinfo-row"><span>Doc N°:</span><b>${esc(item.docNumber || '-')}</b></div>
                    <div class="vs-print-docinfo-row"><span>Data:</span><b>${dataVendaFmt}</b></div>
                    <div class="vs-print-docinfo-row"><span>Garantia:</span><b>${garantiaLabel}</b></div>
                    <div class="vs-print-docinfo-row"><span>Vence:</span><b>${venceFmt}</b></div>
                </div>
            </div>

            <table class="vs-print-table vs-avoid-break">
                <thead><tr>
                    <th style="background:${corBarra};">Item</th>
                    <th style="background:${corBarra};text-align:center;">Qtd</th>
                    <th style="background:${corBarra};text-align:right;">Unit</th>
                    <th style="background:${corBarra};text-align:right;">Total</th>
                </tr></thead>
                <tbody>${linhasItens}</tbody>
            </table>

            <div class="vs-print-footer-row vs-avoid-break">
                <div><b>Forma de Pagamento:</b> ${esc((item.pagamentos || []).join(', ') || '-')}</div>
                <div class="vs-print-total-box">Total: ${fmt(item.total || 0)}</div>
            </div>

            <div class="vs-print-divider"></div>

            <div class="vs-print-signature vs-avoid-break">
                ${assinatura
                    ? `<img src="${assinatura}" class="vs-print-signature-img" crossorigin="anonymous">`
                    : `<div class="vs-print-signature-line"></div>`}
            </div>
        </div>`;

        return html;
    }

    // ── Gerar PDF real via html2canvas + jsPDF — Layout Completo ──
    // (substitui window.print(): no Android o "Salvar como PDF" nativo
    // captura a tela antes do conteúdo/imagens remotas terminarem de
    // carregar, resultando em página em branco. Gerando o PDF direto
    // no JS evitamos esse pipeline e controlamos o resultado 100%.)
    async function imprimirOrcamentoCompleto(item, cfgPreFetched, mode = 'compartilhar', onProgress) {
        onProgress?.(10, 'Preparando dados...');
        const cfg  = cfgPreFetched || await getStoreConfig();
        const html = construirHtmlCompleto(item, cfg);

        garantirPrintCss();

        // ── Renderiza fora da tela (mesmo padrão usado no resto do módulo) ──
        let printArea = document.getElementById('vsPrintArea');
        if (!printArea) {
            printArea = document.createElement('div');
            printArea.id = 'vsPrintArea';
            document.body.appendChild(printArea);
        }
        printArea.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;padding:38px 34px;';
        printArea.innerHTML = html;

        try {
            // aguarda logo/assinatura (imagens remotas) carregarem antes de capturar
            const imgs = Array.from(printArea.querySelectorAll('img'));
            await Promise.all(imgs.map(img => img.complete
                ? Promise.resolve()
                : new Promise(res => { img.onload = res; img.onerror = res; })));

            // empurra pra próxima página qualquer bloco que ficaria cortado
            // (tabela, rodapé, linhas dos termos, assinatura etc.)
            evitarCorteDePagina(printArea, PRINT_PAGE_H_PX);

            onProgress?.(35, 'Renderizando documento...');
            await window._vsLib('html2canvas', 'jspdf');
            const canvas = await html2canvas(printArea, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });

            onProgress?.(65, 'Montando PDF...');
            const { jsPDF }  = window.jspdf;
            const pdf        = new jsPDF({ unit: 'mm', format: 'a4' });
            const pageWidth  = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const imgWidth   = pageWidth;
            const imgHeight  = (canvas.height * imgWidth) / canvas.width;
            const imgData    = canvas.toDataURL('image/jpeg', 0.95);

            let heightLeft = imgHeight;
            let position   = 0;
            pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
            while (heightLeft > 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }
            onProgress?.(90, 'Quase pronto...');

            const fileName = `${nomeDocumentoBase(item, cfg)}.pdf`;
            const blob = pdf.output('blob');
            const file = new File([blob], fileName, { type: 'application/pdf' });

            onProgress?.(100, 'Pronto!');

            // 'gerar' só monta o PDF e devolve pro chamador — quem decide se
            // compartilha ou baixa é o card de ações (botões Enviar/Baixar).
            if (mode === 'gerar') {
                return { blob, file, fileName };
            }

            if (mode === 'compartilhar' && navigator.canShare && navigator.canShare({ files: [file] })) {
                copiarEmailParaTransferencia(item);
                try {
                    await navigator.share({ files: [file], title: nomeDocumentoBase(item, cfg), text: mensagemCompartilhamento(item, cfg.mensagemPadrao || '') });
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        // não foi o usuário cancelando — algo real falhou.
                        // Não escondemos mais o erro: baixa o PDF como
                        // alternativa e avisa o que aconteceu.
                        baixarBlob(blob, fileName);
                        modal({ message: 'Não foi possível abrir o compartilhamento (' + e.message + ') — PDF baixado.' });
                    }
                }
            } else {
                baixarBlob(blob, fileName);
            }
        } finally {
            printArea.innerHTML = '';
        }
    }

    // ── Mensagem de compartilhamento: "Olá [Nome]," + texto padrão ──
    // ── Nome do arquivo/documento — configurável nas Configurações ──
    // Ex: "Orçamento de João Silva.pdf"
    // Remove caracteres inválidos em nome de arquivo (/ \ : * ? " < > |).
    function nomeDocumentoBase(item, cfg) {
        const prefixo = 'Orçamento';
        const nomeCliente = item.nome || 'Cliente';
        return `${prefixo} de ${nomeCliente}`.replace(/[\/\\:*?"<>|]/g, '-');
    }

    function mensagemCompartilhamento(item, mensagemPadrao) {
        const saudacao = item.nome ? `Olá ${item.nome},` : 'Olá,';
        return mensagemPadrao ? `${saudacao}\n\n${mensagemPadrao}` : saudacao;
    }

    // Dispara o download de um blob já pronto (PDF ou PNG).
    function baixarBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = fileName; link.click();
        URL.revokeObjectURL(url);
    }

    // Copia o e-mail do cliente pra área de transferência antes de
    // compartilhar — o Android não deixa nenhum app preencher o campo
    // "Para" de um e-mail automaticamente, então isso é o mais próximo:
    // o usuário só precisa colar.
    // ── Overlay de carregamento — reaproveita o MESMO componente visual
    // do resto do app (.success-overlay/.success-card, o mesmo card
    // escuro usado em "Venda fechada!"/"Parcela paga!"), só trocando o
    // círculo gradiente+check por um anel girando enquanto espera. Ao
    // terminar com sucesso, chama window._showSuccessOverlay() de
    // verdade — não uma imitação — garantindo que fique IDÊNTICO ao
    // resto do app, pixel a pixel.
    // .vs-blocking + trava de scroll + guarda de navegação: enquanto
    // essa operação roda, a tela de trás não pode responder a toque
    // nem rolar, e o botão voltar (físico ou da tela) avisa "aguarda"
    // em vez de navegar por baixo da animação.
    function mostrarCarregando(texto) {
        let overlay = document.getElementById('orLoadingOverlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'orLoadingOverlay';
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
    async function esconderCarregando(sucesso = true, textoSucesso = 'Salvo!') {
        const overlay = document.getElementById('orLoadingOverlay');
        if (overlay) overlay.remove();
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (sucesso) await window._showSuccessOverlay(textoSucesso, 1100);
        window._vsFinalizarProtecaoNavegacao && window._vsFinalizarProtecaoNavegacao();
    }

    // ── Pré-visualização "estilo CapCut" — mostra o DOCUMENTO REAL
    // (o mesmo HTML que vira o PDF/imagem final, com nome, produtos e
    // total de verdade — não é miniatura nem mockup) dentro de uma
    // moldura com uma borda verde girando enquanto o documento é
    // montado. Ao chegar em 100%, a borda vira um brilho verde sólido
    // e os botões Enviar/Baixar aparecem. Usada no compartilhamento
    // rápido logo após salvar o orçamento.
    function mostrarPreviewCarregando(item, cfg) {
        let overlay = document.getElementById('orPreviewOverlay');
        if (overlay) overlay.remove(); // sempre remonta com os dados atuais

        const docWidth  = DOC_WIDTH_COMPLETO;
        const docHtml   = construirHtmlCompleto(item, cfg);
        garantirPrintCss();
        // O layout Completo, quando vira PDF de verdade (imprimirOrcamentoCompleto),
        // é renderizado dentro de um container com padding:38px 34px (mesma
        // margem da página real). A prévia precisa reproduzir esse mesmo
        // respiro — senão o texto fica colado na borda e a moldura de
        // progresso acaba cobrindo informação.
        const docPad = 'padding:38px 34px;background:#fff;box-sizing:border-box;';

        const totalItens    = (item.items || []).length;
        const garantiaLabel = String(item.diasGarantia) === '365' ? '1 Ano' : `${item.diasGarantia || 0} dias`;

        overlay = document.createElement('div');
        overlay.id = 'orPreviewOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,12,24,.72);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);display:flex;align-items:center;justify-content:center;z-index:9999;opacity:0;animation:orBackdropIn .25s ease forwards;padding:18px;';
        overlay.innerHTML = `
            <div id="orPreviewCard" style="width:min(94vw,252px);max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;align-items:center;gap:14px;transform:scale(.85);opacity:0;animation:orCardIn .45s cubic-bezier(.2,1.4,.4,1) .1s forwards;">

                <!-- Documento real, com moldura de progresso girando -->
                <div id="orDocFrame" class="bk-doc-frame">
                    <div id="orDocScaleWrap" class="bk-doc-scale-wrap">
                        <div id="orDocReal" style="width:${docWidth}px;${docPad}">${docHtml}</div>
                    </div>
                </div>

                <!-- Progresso real, ligado às etapas da geração -->
                <div id="orPreviewProgress" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;">
                    <div id="orPreviewPct" style="color:#4ade80;font-family:'Poppins',sans-serif;font-size:1.6rem;font-weight:800;line-height:1;">0%</div>
                    <div style="color:#fff;font-family:'Poppins',sans-serif;font-size:.86rem;font-weight:700;text-align:center;margin-top:2px;">${esc(item.nome || 'Cliente')}</div>
                    <div style="color:rgba(255,255,255,.55);font-family:'Poppins',sans-serif;font-size:.72rem;text-align:center;">${totalItens} ${totalItens === 1 ? 'item' : 'itens'} · Garantia: ${esc(garantiaLabel)}</div>
                    <div id="orPreviewText" style="color:rgba(255,255,255,.5);font-family:'Poppins',sans-serif;font-size:.74rem;text-align:center;margin-top:6px;"></div>
                </div>

                <!-- Ações — reveladas só quando o documento está pronto -->
                <div id="orPreviewActions" style="display:none;flex-direction:column;align-items:stretch;gap:10px;width:100%;">
                    <div style="display:flex;gap:10px;width:100%;">
                        <button id="orBtnEnviar" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;background:#16a34a;border:none;border-radius:14px;padding:13px 6px;color:#fff;font-family:'Poppins',sans-serif;font-size:.78rem;font-weight:700;">
                            <i class="bi bi-send-fill" style="font-size:1.1rem;"></i> Enviar
                        </button>
                        <button id="orBtnBaixar" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:14px;padding:13px 6px;color:#fff;font-family:'Poppins',sans-serif;font-size:.78rem;font-weight:700;">
                            <i class="bi bi-download" style="font-size:1.1rem;"></i> Baixar
                        </button>
                    </div>
                    <button id="orBtnNovo" style="background:none;border:none;color:rgba(255,255,255,.55);font-family:'Poppins',sans-serif;font-size:.76rem;font-weight:600;padding:4px;">
                        <i class="bi bi-plus-circle"></i> Começar outro documento
                    </button>
                </div>
            </div>

            <style>
                @keyframes orBackdropIn { to { opacity:1; } }
                @keyframes orCardIn { to { transform:scale(1); opacity:1; } }

                /* Moldura do documento real — tamanho fixo, cantos quadrados.
                   A borda verde "correndo" (conic-gradient girando) vive
                   FORA da área do documento: o padding empurra o documento
                   pra dentro e o ::before ocupa só a faixa criada por esse
                   padding, nunca sobrepondo o conteúdo. */
                .bk-doc-frame {
                    position:relative; width:239px; height:240px; box-sizing:border-box;
                    border-radius:0; padding:3px; margin:0 auto;
                    transition: height .25s ease;
                }
                .bk-doc-frame::before {
                    content:''; position:absolute; inset:-3px; border-radius:0; z-index:0;
                    background:conic-gradient(from 0deg, transparent 0deg, #4ade80 55deg, transparent 130deg, transparent 360deg);
                    animation:orFrameSpin 1.4s linear infinite;
                }
                .bk-doc-frame.bk-frame-done::before {
                    animation:none; background:#22c55e; opacity:.95;
                }
                .bk-doc-frame.bk-frame-done { box-shadow:0 0 34px 3px rgba(34,197,94,.55); }
                @keyframes orFrameSpin { to { transform:rotate(360deg); } }

                /* Janela que recorta o documento real escalado — prévia
                   ESTÁTICA da página 1, sem rolagem dentro do card. Ocupa
                   exatamente o espaço interno do frame (239x355 menos o
                   padding de 3px), sem cantos arredondados e sem folga —
                   o documento fica totalmente encaixado, sem deformidade. */
                .bk-doc-scale-wrap {
                    position:relative; z-index:1; width:100%; height:100%;
                    background:#fff; border-radius:0; overflow:hidden;
                    box-shadow:0 18px 46px rgba(0,0,0,.4);
                }
                #orDocReal { transform-origin:top left; }

                #orPreviewActions.bk-actions-in { animation:orCardIn .35s cubic-bezier(.2,1.4,.4,1) forwards; }
                #orBtnEnviar, #orBtnBaixar, #orBtnNovo { opacity:0; animation:orDocLineIn .35s ease forwards; }
                @keyframes orDocLineIn { to { opacity:1; transform:translateY(0); } }
                #orBtnEnviar { animation-delay:.05s; }
                #orBtnBaixar { animation-delay:.12s; }
                #orBtnNovo { animation-delay:.2s; }
            </style>
        `;
        document.body.appendChild(overlay);

        // Escala o documento real pra caber na largura do card (sem virar
        // miniatura ilegível) e recorta uma prévia ESTÁTICA — sem rolagem.
        // A altura da moldura acompanha a altura real do conteúdo já
        // escalado (com teto/piso), então não sobra espaço em branco
        // quando o documento é curto, e o texto continua no mesmo tamanho.
        const ALTURA_MIN_FRAME = 160;
        const ALTURA_MAX_FRAME = 460;
        requestAnimationFrame(() => {
            const frame = document.getElementById('orDocFrame');
            const wrap  = document.getElementById('orDocScaleWrap');
            const real  = document.getElementById('orDocReal');
            if (!frame || !wrap || !real) return;
            const scale = wrap.clientWidth / docWidth;
            real.style.transform = `scale(${scale})`;
            const alturaConteudo = real.scrollHeight * scale;
            const alturaFrame = Math.min(ALTURA_MAX_FRAME, Math.max(ALTURA_MIN_FRAME, alturaConteudo));
            frame.style.height = Math.round(alturaFrame) + 'px';
        });

        atualizarPreviewCarregando(5, 'Preparando dados...');
    }

    function atualizarPreviewCarregando(pct, texto) {
        const pctEl = document.getElementById('orPreviewPct');
        const txt   = document.getElementById('orPreviewText');
        const frame = document.getElementById('orDocFrame');
        const p = Math.min(pct, 100);
        if (pctEl) pctEl.textContent = Math.round(p) + '%';
        if (txt && texto) txt.textContent = texto;
        if (frame) frame.classList.toggle('bk-frame-done', p >= 100);
    }

    function esconderPreviewCarregando() {
        const overlay = document.getElementById('orPreviewOverlay');
        if (overlay) overlay.remove();
    }

    // Troca o anel de progresso pelos botões Enviar/Baixar + "Começar outro
    // documento", com animação. Reaproveita o arquivo já gerado — nada é
    // regenerado ao clicar. Chamado só quando o documento chega a 100%.
    function revelarAcoesPreview({ onEnviar, onBaixar, onNovo }) {
        const progresso = document.getElementById('orPreviewProgress');
        const acoes     = document.getElementById('orPreviewActions');
        if (!progresso || !acoes) return;

        setTimeout(() => {
            progresso.style.transition = 'opacity .25s ease';
            progresso.style.opacity = '0';
            setTimeout(() => {
                progresso.style.display = 'none';
                acoes.style.display = 'flex';
                acoes.classList.add('bk-actions-in');
            }, 220);
        }, 450);

        const btnEnviar = document.getElementById('orBtnEnviar');
        const btnBaixar = document.getElementById('orBtnBaixar');
        const btnNovo   = document.getElementById('orBtnNovo');

        if (btnEnviar) btnEnviar.onclick = async () => {
            btnEnviar.disabled = true;
            try { await onEnviar(); } finally { btnEnviar.disabled = false; }
        };
        if (btnBaixar) btnBaixar.onclick = async () => {
            btnBaixar.disabled = true;
            try { await onBaixar(); } finally { btnBaixar.disabled = false; }
        };
        if (btnNovo) btnNovo.onclick = () => {
            const overlay = document.getElementById('orPreviewOverlay');
            if (overlay) {
                overlay.style.animation = 'none';
                overlay.style.transition = 'opacity .2s ease';
                overlay.style.opacity = '0';
                setTimeout(() => overlay.remove(), 200);
            }
            onNovo?.();
        };
    }

    function copiarEmailParaTransferencia(item) {
        if (!item.email) return;
        navigator.clipboard?.writeText(item.email)
            .then(() => modal({ message: `E-mail copiado: ${item.email} — cole no campo "Para".` }))
            .catch(() => {});
    }

    async function compartilharOrcamento(idOuItem, loadingStyle = 'overlay') {
        const item = typeof idOuItem === 'string' ? GR.cache.find(i => i.id === idOuItem) : idOuItem;
        if (!item) return;
        const cfg = await getStoreConfig();
        const usaPreview = loadingStyle === 'preview';

        const mostrar  = () => usaPreview ? mostrarPreviewCarregando(item, cfg) : mostrarCarregando('Gerando documento...');
        const esconder = () => usaPreview ? esconderPreviewCarregando() : esconderCarregando();
        const onProgress = usaPreview ? atualizarPreviewCarregando : null;

        // Compartilha um arquivo (PDF ou PNG) já gerado — usado tanto no
        // fluxo automático (loadingStyle 'overlay') quanto pelo botão
        // "Enviar" do card de preview.
        const enviarArquivo = async (blob, file, fileName) => {
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                copiarEmailParaTransferencia(item);
                try {
                    await navigator.share({ files: [file], title: nomeDocumentoBase(item, cfg), text: mensagemCompartilhamento(item, cfg.mensagemPadrao || '') });
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
        };

        mostrar();
        try {
            if (usaPreview) {
                const { blob, file, fileName } = await imprimirOrcamentoCompleto(item, cfg, 'gerar', onProgress);
                revelarAcoesPreview({
                    onEnviar: () => enviarArquivo(blob, file, fileName),
                    onBaixar: () => baixarBlob(blob, fileName),
                });
            } else {
                await imprimirOrcamentoCompleto(item, cfg, 'compartilhar', onProgress);
                esconder();
            }
        } catch (e) {
            esconder();
            modal({ message: 'Erro ao gerar documento: ' + e.message });
        }
    }

    async function baixarOrcamento(id) {
        const item = GR.cache.find(i => i.id === id);
        if (!item) return;
        const cfg = await getStoreConfig();
        mostrarCarregando('Gerando PDF...');
        let ok = true;
        try { await imprimirOrcamentoCompleto(item, cfg, 'baixar'); }
        catch (e) { ok = false; modal({ message: 'Erro ao gerar PDF: ' + e.message }); }
        finally { await esconderCarregando(ok, 'Baixado!'); }
    }

})();
