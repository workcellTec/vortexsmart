// ================================================================
// documentos/bookip.js — VortexSmart · Garantia (Bookip)
// Registra: window._initBookip()
//
// Pode ser aberto já preenchido a partir da Venda (Etapa 2, ao fechar
// uma venda): window._bookipContexto = { nome, items:[{nome,valor,qtd,
// cor,obs}] } antes de chamar _initBookip(). É consumido uma vez só
// (limpo logo depois de usar), pra não vazar pro próximo bookip novo.
//
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
    // todas as chamadas existentes (dbref('bookips'), dbref('bookips/'+id),
    // etc) já ficam isoladas por loja automaticamente, sem precisar
    // editar cada uma individualmente.
    const dbref = (caminho) => window._lojaRef(caminho);

    const GR = {
        initialized: false,
        view: 'novo',
        cart: [],
        editId: null,
        fotoUrl: '',
        fotoBlob: null,
        tipoTermo: 'venda',      // 'venda' | 'concerto' — qual termo de garantia usar
        cache: [],
        listenerAttached: false,
        clientesCache: [],       // lista real de clientes (Config → Clientes), pra autopreencher o Bookip
        clientesListenerAttached: false,
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
    // na hora de imprimir (ver imprimirGarantiaCompleta).
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

    window._initBookip = function () {
        if (!GR.initialized) {
            renderShell();
            attachListeners();
            GR.initialized = true;
        }
        if (!GR.listenerAttached) {
            loadHistorico();
            GR.listenerAttached = true;
        }
        if (!GR.clientesListenerAttached) {
            loadClientesReais();
            GR.clientesListenerAttached = true;
        }
        resetForm();
        switchView('novo');
        aplicarContextoVenda();
    };

    // Se a Venda mandou dados pra pré-preencher (window._bookipContexto),
    // aplica em cima do form já resetado e limpa o contexto (uso único).
    // Se ctx.gerarDireto vier true, salva na hora e já abre compartilhar
    // — sem o usuário precisar tocar em nada na tela do Bookip.
    function aplicarContextoVenda() {
        const ctx = window._bookipContexto;
        if (!ctx) return;
        window._bookipContexto = null;

        if (ctx.nome && el('bkNome')) el('bkNome').value = ctx.nome;
        if (ctx.cpf && el('bkCpf')) el('bkCpf').value = ctx.cpf;
        if (ctx.tel && el('bkTel')) el('bkTel').value = ctx.tel;
        if (ctx.dataNascimento && el('bkNasc')) el('bkNasc').value = ctx.dataNascimento;
        if (ctx.email && el('bkEmail')) el('bkEmail').value = ctx.email;
        if (ctx.end && el('bkEnd')) el('bkEnd').value = ctx.end;
        GR.tipoTermo = ctx.tipoTermo === 'concerto' ? 'concerto' : 'venda';
        el('bkTipoTermoToggle')?.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tipo === GR.tipoTermo));
        aplicarModoConcerto();
        if (Array.isArray(ctx.items) && ctx.items.length) {
            GR.cart = ctx.items.map(it => ({
                nome: it.nome || '',
                valor: it.valor || 0,
                qtd: it.qtd || 1,
                cor: it.cor || '',
                obs: it.obs || ''
            }));
            renderCartList();
        }
        if (Array.isArray(ctx.formasPagamento) && ctx.formasPagamento.length) {
            // Mapeia a forma usada na Venda (dinheiro/pix/debito/credito/parcelado)
            // pro rótulo real do checkbox do Bookip (PAGAMENTOS, lá em cima).
            const MAPA_FORMA = { dinheiro: 'Dinheiro/Pix', pix: 'Dinheiro/Pix', debito: 'Débito', credito: 'Crédito' };
            const labelsParaMarcar = new Set(ctx.formasPagamento.map(f => MAPA_FORMA[f]).filter(Boolean));
            document.querySelectorAll('#bkPagamentos input[type=checkbox]').forEach(cb => {
                if (labelsParaMarcar.has(cb.value)) cb.checked = true;
            });
        }
        // Cliente e Produtos já vêm prontos da Venda — pula direto pro
        // passo 3 (Detalhes), só falta confirmar garantia/pagamento/foto.
        setStep(3);

        if (ctx.gerarDireto) saveGarantia();
    }

    // Chamado pela Venda quando o usuário aperta "Gerar" direto (sem
    // passar pela edição manual) — usa exatamente o mesmo saveGarantia()
    // de sempre, só que já com window._bookipContexto.gerarDireto = true.
    window._salvarGarantiaDireto = saveGarantia;

    // ── Shell (design Vortex Pulse — wizard de passos, sem sanfona) ──
    function renderShell() {
        const wrap = el('documentosGarantia');
        if (!wrap) return;
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Garantia (Bookip)</h3>
            </div>
            <div class="content-card w-100" style="padding-bottom:170px;">
                <div class="pulse-seg-row mb-3">
                    <button type="button" class="pulse-seg-chip" id="bkTabNovo"><i class="bi bi-plus-lg"></i> Nova</button>
                    <button type="button" class="pulse-seg-chip" id="bkTabHist"><i class="bi bi-clock-history"></i> Histórico</button>
                </div>

                <!-- ══ VIEW: NOVA GARANTIA (wizard de 3 passos) ══ -->
                <div id="bkViewNovo">
                    <div class="pulse-steps-track" id="bkStepsTrack">
                        <div class="seg" data-i="1"></div><div class="seg" data-i="2"></div><div class="seg" data-i="3"></div>
                    </div>
                    <div class="pulse-step-tabs" id="bkStepTabs">
                        <div class="pulse-step-tab" data-i="1"><div class="num">1</div><div class="lb">Cliente</div></div>
                        <div class="pulse-step-tab" data-i="2"><div class="num">2</div><div class="lb">Produtos</div></div>
                        <div class="pulse-step-tab" data-i="3"><div class="num">3</div><div class="lb">Detalhes</div></div>
                    </div>

                    <!-- PASSO 1 · CLIENTE -->
                    <div class="pulse-step-pane" data-step="1">
                        <div class="pulse-doc-card">
                            <div class="mb-3" style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:.66rem;color:var(--text-muted);font-weight:700;">Termo:</span>
                                <div class="rep-seg-toggle" id="bkTipoTermoToggle" style="flex:1;max-width:180px;">
                                    <button type="button" data-tipo="venda" class="active">Venda</button>
                                    <button type="button" data-tipo="concerto">Concerto</button>
                                </div>
                            </div>
                            <div class="mb-2" style="position:relative;">
                                <label class="form-label">Nome Completo</label>
                                <input class="form-control" id="bkNome" placeholder="Nome do cliente" autocomplete="off">
                                <div class="search-results-container" id="bkClienteResNome" style="display:none;"></div>
                            </div>
                            <div class="row g-2 mb-1">
                                <div class="col-6" style="position:relative;">
                                    <label class="form-label">CPF</label>
                                    <input class="form-control" id="bkCpf" placeholder="000.000.000-00" autocomplete="off">
                                    <div class="search-results-container" id="bkClienteResCpf" style="display:none;"></div>
                                </div>
                                <div class="col-6" style="position:relative;">
                                    <label class="form-label">Telefone</label>
                                    <input class="form-control" id="bkTel" placeholder="(XX) 9XXXX-XXXX" autocomplete="off">
                                    <div class="search-results-container" id="bkClienteResTel" style="display:none;"></div>
                                </div>
                            </div>
                            <div class="row g-2 mb-1">
                                <div class="col-6"><label class="form-label">🎂 Nascimento</label><input class="form-control" id="bkNasc" type="date"></div>
                                <div class="col-6"><label class="form-label">Email (Opcional)</label><input class="form-control" id="bkEmail" placeholder="cliente@email.com"></div>
                            </div>
                            <div class="mb-1"><label class="form-label">Endereço / CEP</label><input class="form-control" id="bkEnd" placeholder="Endereço completo"></div>
                        </div>
                        <button type="button" class="pulse-doc-next" data-next="2">Próximo: Produtos →</button>
                    </div>

                    <!-- PASSO 2 · PRODUTOS -->
                    <div class="pulse-step-pane" data-step="2">
                        <div class="pulse-doc-card">
                            <div class="mb-2" id="bkProdBuscaBlock" style="position:relative;">
                                <div class="bk-search-dash" id="bkProdBuscaWrap">
                                    <i class="bi bi-search"></i>
                                    <input id="bkProdBusca" placeholder="Buscar produto no sistema..." autocomplete="off">
                                </div>
                                <div class="search-results-container" id="bkProdResultados" style="display:none;"></div>
                            </div>
                            <div class="mb-2"><input class="form-control" id="bkProdNome" placeholder="Nome do produto"></div>
                            <div class="mb-2" id="bkProdChipsBlock">
                                <div class="d-flex gap-2">
                                    <button class="btn btn-sm btn-secondary" id="bkChipNovo" type="button">+ Novo/Lacrado</button>
                                    <button class="btn btn-sm btn-secondary" id="bkChipSemi" type="button">+ Seminovo</button>
                                </div>
                            </div>
                            <div class="row g-2 mb-2">
                                <div class="col-4" id="bkProdQtdCol"><input class="form-control" id="bkProdQtd" type="number" min="1" value="1"></div>
                                <div class="col-8" id="bkProdValorCol"><input class="form-control" id="bkProdValor" type="number" step="0.01" min="0" placeholder="Valor Unit (R$)"></div>
                            </div>
                            <div class="mb-2" id="bkProdCorBlock"><input class="form-control" id="bkProdCor" placeholder="Cor / Detalhe"></div>
                            <div class="mb-2" id="bkProdObsBlock"><input class="form-control" id="bkProdObs" placeholder="IMEI / Serial / Obs"></div>
                            <button class="btn btn-primary w-100 mb-2" id="bkAddItem"><i class="bi bi-plus-lg"></i> Adicionar à Lista</button>
                            <div id="bkCartList"></div>
                        </div>
                        <div class="pulse-doc-nav-row">
                            <button type="button" class="pulse-doc-back" data-prev="1">← Voltar</button>
                            <button type="button" class="pulse-doc-next" data-next="3">Próximo →</button>
                        </div>
                    </div>

                    <!-- PASSO 3 · DETALHES FINAIS -->
                    <div class="pulse-step-pane" data-step="3">
                        <div class="pulse-doc-card">
                            <div class="row g-2 mb-1">
                                <div class="col-6"><label class="form-label">Data da Venda</label><input class="form-control" id="bkDataVenda" type="date"></div>
                                <div class="col-6">
                                    <label class="form-label">Tempo de Garantia</label>
                                    <select class="form-select" id="bkDias">
                                        <option value="90">90 dias</option>
                                        <option value="180">180 dias</option>
                                        <option value="365" selected>1 Ano (Padrão)</option>
                                        <option value="custom">Personalizado</option>
                                    </select>
                                </div>
                            </div>
                            <input class="form-control hidden mb-3" id="bkDiasCustom" type="number" min="0" placeholder="Quantidade de dias">
                            <div class="mb-2 mt-2"><label class="form-label">Forma(s) de Pagamento</label></div>
                            <div class="d-flex flex-wrap gap-3 mb-3" id="bkPagamentos">
                                ${PAGAMENTOS.map((p, i) => `
                                <label class="form-check" style="cursor:pointer;">
                                    <input class="form-check-input" type="checkbox" value="${p}" id="bkPag${i}">
                                    <span class="form-check-label">${p}</span>
                                </label>`).join('')}
                            </div>
                            <div class="mb-1"><label class="form-label"><i class="bi bi-camera-fill"></i> Foto do Produto (opcional)</label></div>
                            <div class="row g-2 mb-2">
                                <div class="col-6">
                                    <button class="btn btn-secondary w-100" id="bkFotoCamera" type="button" style="border-style:dashed;">
                                        <i class="bi bi-camera-fill text-success"></i> Tirar foto
                                    </button>
                                </div>
                                <div class="col-6">
                                    <button class="btn btn-secondary w-100" id="bkFotoGaleria" type="button" style="border-style:dashed;">
                                        <i class="bi bi-image-fill text-success"></i> Da galeria
                                    </button>
                                </div>
                            </div>
                            <input type="file" accept="image/*" capture="environment" id="bkFotoInputCam" class="hidden">
                            <input type="file" accept="image/*" id="bkFotoInputGal" class="hidden">
                            <img id="bkFotoPreview" style="display:none;max-width:140px;border-radius:10px;margin-bottom:8px;">
                        </div>
                        <div class="pulse-doc-nav-row">
                            <button type="button" class="pulse-doc-back" data-prev="2">← Voltar</button>
                        </div>
                    </div>

                    <!-- Barra fixa: Total + Salvar -->
                    <div class="bk-total-bar">
                        <div>
                            <div class="bk-total-label">Total</div>
                            <div class="bk-total-val" id="bkTotal">R$ 0,00</div>
                        </div>
                        <button class="btn" id="bkSave" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;box-shadow:0 4px 12px rgba(34,197,94,.35);padding:10px 22px;">
                            <i class="bi bi-check-circle-fill"></i> Salvar
                        </button>
                    </div>

                    <button class="btn w-100 mt-2 text-secondary" id="bkNovoRecibo" style="background:none;border:none;">
                        <i class="bi bi-plus-circle"></i> Começar um Novo Recibo
                    </button>
                </div>

                <!-- ══ VIEW: HISTÓRICO ══ -->
                <div id="bkViewHist" style="display:none;">
                    <div class="mb-2 d-flex gap-2">
                        <input class="form-control" id="bkHistSearch" placeholder="Nome, CPF, Doc ou Produto..." style="flex:1;">
                        <button class="btn-back" id="bkHistDateToggle" aria-label="Filtrar por data" title="Filtrar por data"><i class="bi bi-calendar3"></i></button>
                    </div>
                    <div id="bkHistDatePanel" class="hidden" style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
                        <div style="flex:1;">
                            <label class="form-label" style="font-size:.7rem;">De</label>
                            <input class="form-control" id="bkHistDataDe" type="date">
                        </div>
                        <div style="flex:1;">
                            <label class="form-label" style="font-size:.7rem;">Até</label>
                            <input class="form-control" id="bkHistDataAte" type="date">
                        </div>
                        <button class="btn-back" id="bkHistDateClear" aria-label="Limpar datas" title="Limpar datas" style="align-self:flex-end;margin-bottom:2px;"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="d-flex justify-content-end mb-3">
                        <button class="bk-lixeira-link" id="bkLixeiraToggle" type="button">
                            <i class="bi bi-trash3"></i> <span id="bkLixeiraLabel">Lixeira</span>
                        </button>
                    </div>
                    <div id="bkHistList"></div>
                    <div id="bkHistEmpty" class="text-center text-secondary hidden" style="padding:2rem 0;">
                        <i class="bi bi-inbox" style="font-size:2.5rem;"></i>
                        <p class="mt-2">Nenhuma garantia encontrada.</p>
                    </div>
                </div>
            </div>
        `;
    }

    // ── Wizard: navegação entre os 3 passos (sem sanfona) ──────────
    function setStep(n) {
        GR.step = n;
        document.querySelectorAll('.pulse-step-pane').forEach(p => p.classList.toggle('on', Number(p.dataset.step) === n));
        document.querySelectorAll('#bkStepTabs .pulse-step-tab').forEach(t => t.classList.toggle('on', Number(t.dataset.i) === n));
        document.querySelectorAll('#bkStepsTrack .seg').forEach(s => s.classList.toggle('on', Number(s.dataset.i) <= n));
    }

    function updateResumos() {
        // Sem sanfona, não há mais preview de seção fechada — mantido só
        // como no-op pra não quebrar nenhuma chamada residual.
    }

    // ── Listeners ────────────────────────────────────────────────
    function attachListeners() {
        // Wizard: navegação entre passos (substitui o toggle da sanfona)
        document.querySelectorAll('#bkStepTabs .pulse-step-tab').forEach(tab => {
            tab.addEventListener('click', () => setStep(Number(tab.dataset.i)));
        });
        document.querySelectorAll('#bkViewNovo [data-next]').forEach(btn => {
            btn.addEventListener('click', () => setStep(Number(btn.dataset.next)));
        });
        document.querySelectorAll('#bkViewNovo [data-prev]').forEach(btn => {
            btn.addEventListener('click', () => setStep(Number(btn.dataset.prev)));
        });
        // Resumos dinâmicos ao digitar
        ['bkNome','bkCpf','bkTel','bkNasc','bkEmail','bkEnd'].forEach(id => {
            el(id)?.addEventListener('input', updateResumos);
        });
        el('bkTipoTermoToggle')?.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                el('bkTipoTermoToggle').querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                GR.tipoTermo = btn.dataset.tipo;
                aplicarModoConcerto();
            });
        });
        el('bkDias')?.addEventListener('change', updateResumos);
        el('bkDiasCustom')?.addEventListener('input', updateResumos);
        document.querySelectorAll('#bkPagamentos input').forEach(c => c.addEventListener('change', updateResumos));
        el('bkTabNovo')?.addEventListener('click', () => switchView('novo'));
        el('bkTabHist')?.addEventListener('click', () => switchView('historico'));
        el('bkAddItem')?.addEventListener('click', addCartItem);
        el('bkSave')?.addEventListener('click', saveGarantia);
        el('bkNovoRecibo')?.addEventListener('click', () => { resetForm(); modal({ message: 'Novo recibo iniciado.' }); });
        el('bkDias')?.addEventListener('change', () => {
            el('bkDiasCustom').classList.toggle('hidden', el('bkDias').value !== 'custom');
        });

        // Chips Novo/Seminovo
        el('bkChipNovo')?.addEventListener('click', () => appendToNome('Novo/Lacrado'));
        el('bkChipSemi')?.addEventListener('click', () => appendToNome('Seminovo'));

        // Busca de produtos do sistema
        el('bkProdBusca')?.addEventListener('input', onBuscaProduto);
        document.addEventListener('click', e => {
            if (!e.target.closest('#bkProdResultados') && e.target.id !== 'bkProdBusca') {
                const r = el('bkProdResultados'); if (r) r.style.display = 'none';
            }
        });

        // Autopreenchimento de cliente (Nome / CPF / Telefone)
        setupClienteAutocomplete();

        // Fotos: câmera e galeria
        el('bkFotoCamera')?.addEventListener('click', () => el('bkFotoInputCam')?.click());
        el('bkFotoGaleria')?.addEventListener('click', () => el('bkFotoInputGal')?.click());
        el('bkFotoInputCam')?.addEventListener('change', handleFotoSelect);
        el('bkFotoInputGal')?.addEventListener('change', handleFotoSelect);

        el('bkHistSearch')?.addEventListener('input', () => {
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('bkHistSearch').value);
        });
        el('bkHistDateToggle')?.addEventListener('click', () => {
            el('bkHistDatePanel')?.classList.toggle('hidden');
        });
        el('bkHistDataDe')?.addEventListener('change', () => {
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('bkHistSearch')?.value || '');
        });
        el('bkHistDataAte')?.addEventListener('change', () => {
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('bkHistSearch')?.value || '');
        });
        el('bkHistDateClear')?.addEventListener('click', () => {
            if (el('bkHistDataDe')) el('bkHistDataDe').value = '';
            if (el('bkHistDataAte')) el('bkHistDataAte').value = '';
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('bkHistSearch')?.value || '');
        });

        el('bkCartList')?.addEventListener('click', e => {
            const btn = e.target.closest('[data-remove]');
            if (!btn) return;
            GR.cart.splice(parseInt(btn.dataset.remove), 1);
            renderCartList();
        });
        el('bkHistList')?.addEventListener('click', e => {
            if (e.target.closest('#bkVerMais')) {
                GR.histVisibleCount += HIST_PAGE_SIZE;
                renderHistList(el('bkHistSearch')?.value || '');
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
            if (enviarBtn) { e.stopPropagation(); compartilharGarantia(enviarBtn.dataset.enviar); return; }
            if (fotoBtn)   { e.stopPropagation(); verFoto(fotoBtn.dataset.foto); return; }
            if (downBtn)   { e.stopPropagation(); baixarGarantia(downBtn.dataset.download); return; }
            if (restBtn)   { e.stopPropagation(); restaurarGarantia(restBtn.dataset.restore); return; }
            if (purgeBtn)  { e.stopPropagation(); excluirDefinitivo(purgeBtn.dataset.purge); return; }
            if (delBtn)    { e.stopPropagation(); deleteGarantia(delBtn.dataset.del); return; }

            if (toggleBtn) {
                toggleHistCard(toggleBtn.dataset.toggle);
            }
        });

        el('bkLixeiraToggle')?.addEventListener('click', () => {
            GR.histSub = GR.histSub === 'lixeira' ? 'ativos' : 'lixeira';
            GR.expandedIds.clear();
            GR.histVisibleCount = HIST_PAGE_SIZE;
            renderHistList(el('bkHistSearch')?.value || '');
        });
    }

    function appendToNome(palavra) {
        const input = el('bkProdNome');
        if (!input) return;
        const atual = input.value.trim();
        if (!atual.toLowerCase().includes(palavra.toLowerCase())) {
            input.value = atual ? `${atual} ${palavra}` : palavra;
        }
    }

    // ── Busca de produtos do sistema ─────────────────────────────
    // ── Autopreenchimento de Cliente — clientes reais + garantias ────
    // Busca primeiro na lista real de clientes (GR.clientesCache, mais
    // atual) e depois no histórico de garantias (GR.cache, pega quem só
    // existe lá). Dedupe por CPF (ou nome, se não tiver CPF) — como o
    // pool de clientes vem primeiro, ele "ganha" de um registro
    // duplicado mais antigo salvo num bookip.
    function buscarClientesUnicos(query, campo) {
        const q = query.trim().toLowerCase();
        if (q.length < 2) return [];

        const vistos = new Set();
        const resultados = [];
        for (const item of [...GR.clientesCache, ...GR.cache]) {
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
        const item = [...GR.clientesCache, ...GR.cache].find(i => i.id === id);
        if (!item) return;
        if (el('bkNome'))  el('bkNome').value  = item.nome || '';
        if (el('bkCpf'))   el('bkCpf').value   = item.cpf || '';
        if (el('bkTel'))   el('bkTel').value   = item.tel || '';
        if (el('bkEmail')) el('bkEmail').value = item.email || '';
        if (el('bkEnd'))   el('bkEnd').value   = item.end || '';
        if (el('bkNasc'))  el('bkNasc').value  = toISODate(item.dataNascimento);
        ['bkClienteResNome', 'bkClienteResCpf', 'bkClienteResTel'].forEach(cid => {
            const box = el(cid);
            if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        });
        updateResumos();
        if (navigator.vibrate) navigator.vibrate(15);
    }

    function setupClienteAutocomplete() {
        const campos = [
            { inputId: 'bkNome', campo: 'nome', resId: 'bkClienteResNome' },
            { inputId: 'bkCpf',  campo: 'cpf',  resId: 'bkClienteResCpf' },
            { inputId: 'bkTel',  campo: 'tel',  resId: 'bkClienteResTel' },
        ];
        campos.forEach(({ inputId, campo, resId }) => {
            el(inputId)?.addEventListener('input', () => {
                // Se estamos editando uma garantia existente, não sugere
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
        const q = el('bkProdBusca')?.value.trim();
        const box = el('bkProdResultados');
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
                    el('bkProdNome').value  = btn.dataset.nome;
                    el('bkProdValor').value = btn.dataset.valor;
                    el('bkProdBusca').value = '';
                    box.style.display = 'none';
                });
            });
        }
        box.style.display = 'block';
    }

    // ── Views ────────────────────────────────────────────────────
    function switchView(view) {
        GR.view = view;
        el('bkViewNovo').style.display = view === 'novo' ? 'block' : 'none';
        el('bkViewHist').style.display = view === 'historico' ? 'block' : 'none';
        el('bkTabNovo')?.classList.toggle('on', view === 'novo');
        el('bkTabHist')?.classList.toggle('on', view === 'historico');
        if (view === 'historico') renderHistList(el('bkHistSearch')?.value || '');
    }

    // ── Modo Concerto no Passo 2 ─────────────────────────────────
    // Concerto é um serviço, não um produto em estoque — busca no
    // sistema, chips Novo/Seminovo, quantidade, cor e obs (IMEI/Serial)
    // não fazem sentido nesse caso. Esconde tudo isso e deixa só
    // "Informe o concerto" (reaproveita o campo Nome) + Valor.
    function aplicarModoConcerto() {
        const ehConcerto = GR.tipoTermo === 'concerto';
        ['bkProdBuscaBlock', 'bkProdChipsBlock', 'bkProdQtdCol', 'bkProdCorBlock', 'bkProdObsBlock'].forEach(id => {
            el(id)?.classList.toggle('hidden', ehConcerto);
        });
        // Valor ocupa a linha inteira quando a coluna de Qtd some.
        const valorCol = el('bkProdValorCol');
        if (valorCol) {
            valorCol.classList.toggle('col-8', !ehConcerto);
            valorCol.classList.toggle('col-12', ehConcerto);
        }
        const nomeInput = el('bkProdNome');
        if (nomeInput) nomeInput.placeholder = ehConcerto ? 'Informe o concerto' : 'Nome do produto';
    }

    function resetForm() {
        GR.cart = []; GR.editId = null; GR.fotoUrl = ''; GR.fotoBlob = null; GR.tipoTermo = 'venda';
        el('bkTipoTermoToggle')?.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tipo === 'venda'));
        aplicarModoConcerto();
        ['bkNome','bkCpf','bkTel','bkNasc','bkEmail','bkEnd',
         'bkProdBusca','bkProdNome','bkProdValor','bkProdCor','bkProdObs','bkDiasCustom'].forEach(id => { if (el(id)) el(id).value = ''; });
        if (el('bkProdQtd')) el('bkProdQtd').value = 1;
        if (el('bkDias')) el('bkDias').value = '365';
        el('bkDiasCustom')?.classList.add('hidden');
        if (el('bkDataVenda')) el('bkDataVenda').value = dataLocalISO(new Date());
        document.querySelectorAll('#bkPagamentos input[type=checkbox]').forEach(c => c.checked = false);
        const preview = el('bkFotoPreview');
        if (preview) { preview.style.display = 'none'; preview.src = ''; }
        // O wizard sempre volta pro passo 1 (Cliente) — é a primeira coisa
        // a preencher num documento novo.
        setStep(1);
        renderCartList();
    }

    // ── Carrinho ─────────────────────────────────────────────────
    function addCartItem() {
        const ehConcerto = GR.tipoTermo === 'concerto';
        const nome  = el('bkProdNome')?.value.trim();
        const valor = parseFloat(el('bkProdValor')?.value) || 0;
        // No modo Concerto os campos de Qtd/Cor/Obs ficam escondidos —
        // ignora o que estiver neles (pode ser lixo de uma venda normal
        // anterior) e usa os valores fixos que fazem sentido pra um
        // serviço: sempre 1, sem cor nem observação.
        const qtd   = ehConcerto ? 1 : (parseInt(el('bkProdQtd')?.value) || 1);
        const cor   = ehConcerto ? '' : (el('bkProdCor')?.value.trim() || '');
        const obs   = ehConcerto ? '' : (el('bkProdObs')?.value.trim() || '');
        if (!nome) { modal({ message: ehConcerto ? 'Informe o concerto.' : 'Digite o nome do produto.' }); return; }
        GR.cart.push({ nome, valor, qtd, cor, obs });
        ['bkProdNome','bkProdValor','bkProdCor','bkProdObs','bkProdBusca'].forEach(id => { if (el(id)) el(id).value = ''; });
        if (el('bkProdQtd')) el('bkProdQtd').value = 1;
        renderCartList();
        if (navigator.vibrate) navigator.vibrate(20);
    }

    function cartTotal() {
        return GR.cart.reduce((t, i) => t + (i.valor * i.qtd), 0);
    }

    function renderCartList() {
        const wrap = el('bkCartList');
        if (!wrap) return;
        if (GR.cart.length === 0) {
            wrap.innerHTML = `<p class="text-secondary small mb-2 text-center" style="padding:10px;border:1px dashed var(--border);border-radius:10px;">Nenhum item adicionado.</p>`;
        } else {
            wrap.innerHTML = GR.cart.map((item, i) => `
                <div class="content-card mb-2" style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;">
                    <div style="flex:1;min-width:0;cursor:pointer;" data-edit="${i}">
                        <div class="fw-bold">${esc(item.nome)} <span class="text-secondary small">x${item.qtd}</span></div>
                        <div class="text-secondary small">${item.cor ? esc(item.cor) + ' · ' : ''}${item.obs ? esc(item.obs) + ' · ' : ''}${fmt(item.valor * item.qtd)}</div>
                    </div>
                    <button class="btn-back" data-remove="${i}" aria-label="Remover"><i class="bi bi-trash3"></i></button>
                </div>
            `).join('');
            wrap.querySelectorAll('[data-edit]').forEach(elx => {
                elx.addEventListener('click', () => editarCartItem(parseInt(elx.dataset.edit, 10)));
            });
        }
        const total = el('bkTotal');
        if (total) total.textContent = fmt(cartTotal());
        updateResumos();
    }

    // Toca no item pra editar: joga os dados de volta no formulário de
    // adicionar produto e tira o item da lista (re-adicionar = salvar a edição)
    function editarCartItem(i) {
        const item = GR.cart[i];
        if (!item) return;
        if (el('bkProdNome'))  el('bkProdNome').value  = item.nome || '';
        if (el('bkProdValor')) el('bkProdValor').value = item.valor || '';
        if (el('bkProdQtd'))   el('bkProdQtd').value    = item.qtd || 1;
        if (el('bkProdCor'))   el('bkProdCor').value    = item.cor || '';
        if (el('bkProdObs'))   el('bkProdObs').value    = item.obs || '';
        GR.cart.splice(i, 1);
        renderCartList();
        el('bkProdNome')?.focus();
    }

    // ── Foto ─────────────────────────────────────────────────────
    // Reduz o tamanho do arquivo antes de subir (fotos de câmera de
    // celular costumam vir com vários MB) sem perder qualidade visível
    // — redimensiona o lado maior pra no máximo 1280px e reexporta como
    // JPEG a 82% de qualidade, um equilíbrio bem estabelecido pra foto
    // vista em tela de celular/PDF impresso em tamanho normal.
    async function handleFotoSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        const preview = el('bkFotoPreview');
        // Preview aparece na hora com o arquivo original — não trava
        // esperando a compressão terminar pra dar feedback visual.
        const reader = new FileReader();
        reader.onload = ev => { if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; } };
        reader.readAsDataURL(file);
        // O que efetivamente sobe pro Storage é a versão comprimida —
        // roda em segundo plano, pronta bem antes do usuário terminar
        // de preencher o resto do formulário e apertar Salvar.
        try {
            GR.fotoBlob = await window._comprimirImagem(file);
        } catch (err) {
            console.error('Erro ao comprimir foto, usando original sem comprimir:', err);
            GR.fotoBlob = file;
        }
    }

    // Envia pra "pastinha" da PRÓPRIA loja no Firebase Storage
    // (lojas/{lojaId}/caminho) — isolada de outras lojas pela regra
    // de segurança (storage.rules), que confere isso pelo token de
    // login, não dá pra acessar a pasta de loja nenhuma.
    async function uploadFotoStorage(blob, caminho) {
        try {
            return await window._uploadFotoStorage(blob, caminho);
        } catch (e) {
            console.error('Erro upload Firebase Storage:', e);
            modal({ message: `Erro ao enviar a foto: ${e.code || e.message}` });
            return null;
        }
    }

    // ── Salvar ───────────────────────────────────────────────────
    async function saveGarantia() {
        const nome = el('bkNome')?.value.trim();
        if (!nome) { modal({ message: 'Digite o nome do cliente.' }); return; }
        if (GR.cart.length === 0) { modal({ message: 'A lista de produtos está vazia! Adicione ao menos um item.' }); return; }

        const saveBtn = el('bkSave');
        const originalHtml = saveBtn.innerHTML;
        saveBtn.innerHTML = 'Salvando...';
        saveBtn.disabled = true;
        mostrarCarregando('Salvando na nuvem...');
        let itemSalvo = null;
        let eraEdicao = false;
        let erro = null;

        try {
            let dias = el('bkDias').value;
            dias = dias === 'custom' ? (parseInt(el('bkDiasCustom').value) || 0) : parseInt(dias);

            const pagamentos = Array.from(document.querySelectorAll('#bkPagamentos input:checked')).map(c => c.value);

            const dados = {
                nome,
                cpf:            el('bkCpf')?.value.trim() || '',
                tel:            el('bkTel')?.value.trim() || '',
                dataNascimento: el('bkNasc')?.value || '',
                email:          el('bkEmail')?.value.trim() || '',
                end:            el('bkEnd')?.value.trim() || '',
                items:          GR.cart,
                total:          cartTotal(),
                pagamentos,
                diasGarantia:   dias,
                dataVenda:      el('bkDataVenda')?.value || dataLocalISO(new Date()),
                fotoUrl:        GR.fotoUrl || '',
                criadoEm:       new Date().toISOString(),
                tipoTermo:      GR.tipoTermo === 'concerto' ? 'concerto' : 'venda',
            };

            const snap = await window._dbGet(dbref('bookips'));
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
                await window._dbUpdate(dbref('bookips/' + GR.editId), dados);
            } else {
                const newRef = await window._dbPush(dbref('bookips'), dados);
                savedId = newRef.key;
            }

            if (GR.fotoBlob) {
                const url = await uploadFotoStorage(GR.fotoBlob, `bookips/${savedId}.jpg`);
                if (url) { await window._dbUpdate(dbref('bookips/' + savedId), { fotoUrl: url }); dados.fotoUrl = url; }
            }

            if (navigator.vibrate) navigator.vibrate(50);
            eraEdicao = !!GR.editId;
            itemSalvo = { id: savedId, ...dados };

            // Atualiza o cache local na hora — não depende do listener
            // assíncrono do Firebase, que pode demorar a refletir a
            // mudança se o usuário voltar a editar o mesmo registro
            // logo em seguida (campo ficando "vazio" ao reabrir).
            const idxCache = GR.cache.findIndex(i => i.id === savedId);
            if (idxCache >= 0) GR.cache[idxCache] = normalizarGarantia({ ...GR.cache[idxCache], ...dados, id: savedId });
            else GR.cache.unshift(normalizarGarantia({ id: savedId, ...dados }));
        } catch (e) {
            console.error('Erro ao salvar garantia:', e);
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
            modal({ message: 'Erro ao salvar garantia: ' + erro.message });
            return;
        }

        // Fica na tela de Nova Garantia — os dados continuam visíveis
        // (desfocados atrás do card) até o usuário compartilhar ou
        // dispensar. Só reseta depois disso, nunca muda de tela sozinho.
        modal({
            message: (eraEdicao ? 'Garantia atualizada' : 'Documento salvo e seguro na nuvem') + '. Deseja compartilhar agora?',
            confirmText: 'Sim, compartilhar',
            cancelText: 'Agora não',
            onConfirm: async () => { await compartilharGarantia(itemSalvo, 'preview'); resetForm(); },
            onCancel: () => { resetForm(); },
        });
    }

    // ── Histórico ────────────────────────────────────────────────
    // Compatibilidade com registros salvos por versões antigas do Bookip:
    // - "pagamento" (texto único) em vez de "pagamentos" (lista)
    // - sem campo "total" salvo — soma a partir dos itens
    // Aplicado uma única vez ao carregar, então todo o resto do app
    // (card, edição, PDF, WhatsApp, resumo) já lê o formato atual.
    function normalizarGarantia(item) {
        if (!Array.isArray(item.pagamentos)) {
            item.pagamentos = item.pagamento ? [item.pagamento] : [];
        }
        if (typeof item.total !== 'number' || isNaN(item.total)) {
            item.total = (item.items || []).reduce((t, i) => t + (i.valor || 0) * (i.qtd || 1), 0);
        }
        return item;
    }

    function loadHistorico() {
        window._dbOnValue(dbref('bookips'), snap => {
            const data = snap.val();
            GR.cache = data ? Object.keys(data).map(k => normalizarGarantia({ id: k, ...data[k] })) : [];
            GR.cache.sort((a, b) => new Date(b.criadoEm || 0) - new Date(a.criadoEm || 0));
            purgeExpiredTrash();
            if (GR.view === 'historico') renderHistList(el('bkHistSearch')?.value || '');
        });
    }

    // Lista real de clientes (Config → Clientes) — fonte principal do
    // autopreenchimento. Node 'clientes' usa telefone/endereco; aqui
    // normaliza pra tel/end, mesmo shape já usado pelos itens de
    // bookip, pra buscarClientesUnicos/preencherCliente lerem os dois
    // sem precisar saber de qual fonte cada resultado veio.
    function loadClientesReais() {
        window._dbOnValue(dbref('clientes'), snap => {
            const data = snap.val();
            GR.clientesCache = data ? Object.keys(data).map(k => {
                const c = data[k];
                return { id: k, nome: c.nome || '', cpf: c.cpf || '', tel: c.telefone || '', email: c.email || '', end: c.endereco || '', dataNascimento: c.dataNascimento || '' };
            }) : [];
        });
    }

    function statusGarantia(item) {
        if (!item.dataVenda || !item.diasGarantia) return { label: 'Vigente', cls: 'success', emoji: '📓' };
        const venc = new Date(item.dataVenda + 'T00:00:00');
        venc.setDate(venc.getDate() + parseInt(item.diasGarantia));
        const diasRestantes = Math.ceil((venc - new Date()) / 86400000);
        if (diasRestantes < 0) return { label: 'Expirada', cls: 'expirada', emoji: '📓' };
        if (diasRestantes <= 30) return { label: `Vence em ${diasRestantes}d`, cls: 'venc-breve', emoji: '📓' };
        return { label: 'Vigente', cls: 'success', emoji: '📓' };
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
        const wrap  = el('bkHistList');
        const empty = el('bkHistEmpty');
        if (!wrap) return;
        const f = (filterText || '').toLowerCase().trim();
        const naLixeira = GR.histSub === 'lixeira';
        const dataDe  = el('bkHistDataDe')?.value  || '';
        const dataAte = el('bkHistDataAte')?.value || '';

        const base = GR.cache.filter(item => naLixeira ? !!item.deletedAt : !item.deletedAt);
        const filtered = base.filter(item => itemMatchesSearch(item, f) && itemInDateRange(item, dataDe, dataAte));

        // Atualiza label/contador do botão Lixeira
        const totalLixeira = GR.cache.filter(i => i.deletedAt).length;
        const lixLabel = el('bkLixeiraLabel');
        if (lixLabel) lixLabel.textContent = naLixeira ? 'Voltar' : `Lixeira${totalLixeira ? ' (' + totalLixeira + ')' : ''}`;

        if (filtered.length === 0) {
            wrap.innerHTML = '';
            empty?.classList.remove('hidden');
            if (empty) empty.querySelector('p').textContent = naLixeira ? 'A lixeira está vazia.' : 'Nenhuma garantia encontrada.';
            return;
        }
        empty?.classList.add('hidden');

        const totalFiltrado = filtered.length;
        const visiveis = filtered.slice(0, GR.histVisibleCount);
        const restantes = totalFiltrado - visiveis.length;

        GR.renderedIds.clear(); // DOM será recriado — refaz o rastreio do que já está montado

        wrap.innerHTML = visiveis.map(item => {
            const st = statusGarantia(item);
            const dataFmt = item.criadoEm ? new Date(item.criadoEm).toLocaleDateString('pt-BR') : '';
            const isOpen = GR.expandedIds.has(item.id);
            const diasLix = naLixeira ? diasRestantesLixeira(item) : null;
            const iconBg = naLixeira ? 'rgba(var(--overlay-rgb),.06)' : '#d6f3ef';
            const iconColor = naLixeira ? 'var(--text-muted)' : '#0f766e';

            // Só monta o conteúdo pesado (produtos + botões) se o card já estava aberto
            let detailInner = '';
            if (isOpen) { detailInner = buildDetailHtml(item, naLixeira); GR.renderedIds.add(item.id); }

            return `
                <div class="content-card pulse-sale-row bk-hist-card" data-card="${item.id}" style="padding:13px;margin-bottom:var(--bk-hist-gap);flex-direction:column;align-items:stretch;overflow:hidden;${naLixeira ? 'opacity:.6;' : ''}">
                    <div class="d-flex align-items-start gap-2 bk-hist-head" data-toggle="${item.id}" style="cursor:pointer;">
                        <div class="pulse-icon-box" style="background:${iconBg};color:${iconColor};flex-shrink:0;">📓</div>
                        <div style="flex:1;min-width:0;">
                            <div class="pulse-row-between">
                                <div class="pulse-sale-title">${esc(item.nome || 'Sem nome')}</div>
                                ${naLixeira
                                    ? `<span class="pulse-status-pill expirada"><i class="bi bi-clock-history"></i> ${diasLix}d</span>`
                                    : `<span class="pulse-status-pill ${st.cls}">${st.label}</span>`}
                            </div>
                            <div class="pulse-sale-sub">Doc ${esc(item.docNumber || '')} · ${dataFmt} · ${item.items?.length || 0} ${(item.items?.length || 0) === 1 ? 'item' : 'itens'} · ${fmt(item.total || 0)}${item.tipoTermo === 'concerto' ? ' · <span style="color:var(--acento-hero-2);font-weight:700;">🔧 Concerto</span>' : ''}</div>
                        </div>
                        <div class="d-flex align-items-center gap-2" style="flex-shrink:0;">
                            ${!naLixeira ? `<button class="btn-back" data-edit="${item.id}" aria-label="Editar" style="width:26px;height:26px;"><i class="bi bi-pencil" style="font-size:.68rem;"></i></button>` : ''}
                            <i class="bi bi-chevron-down bk-hist-chevron${isOpen ? ' open' : ''}" style="color:var(--text-secondary);opacity:.5;font-size:.8rem;"></i>
                        </div>
                    </div>
                    <div class="bk-hist-detail${isOpen ? ' open' : ''}">
                        <div class="bk-hist-detail-inner">${detailInner}</div>
                    </div>
                </div>
            `;
        }).join('') + (restantes > 0 ? `
            <button class="bk-vermais-btn" id="bkVerMais">
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
        // resetForm() (chamado logo acima) sempre volta o termo pra
        // 'venda' — é o ponto de partida certo pra um recibo NOVO, mas
        // aqui é EDIÇÃO de um já existente, então precisa restaurar o
        // termo real que foi salvo. Sem isso, reabrir um Bookip de
        // Concerto pra editar desligava o toggle e marcava "Venda"
        // sozinho, mesmo a garantia sendo de concerto de verdade.
        GR.tipoTermo = item.tipoTermo === 'concerto' ? 'concerto' : 'venda';
        el('bkTipoTermoToggle')?.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tipo === GR.tipoTermo));
        aplicarModoConcerto();
        if (el('bkNome')) el('bkNome').value = item.nome || '';
        if (el('bkCpf')) el('bkCpf').value = item.cpf || '';
        if (el('bkTel')) el('bkTel').value = item.tel || '';
        if (el('bkNasc')) el('bkNasc').value = toISODate(item.dataNascimento);
        if (el('bkEmail')) el('bkEmail').value = item.email || '';
        if (el('bkEnd')) el('bkEnd').value = item.end || '';
        if (el('bkDataVenda')) el('bkDataVenda').value = item.dataVenda || '';
        GR.cart = Array.isArray(item.items) ? JSON.parse(JSON.stringify(item.items)) : [];
        renderCartList();
        (item.pagamentos || []).forEach(p => {
            const cb = Array.from(document.querySelectorAll('#bkPagamentos input')).find(c => c.value === p);
            if (cb) cb.checked = true;
        });
        const diasSel = el('bkDias');
        const diasPadrao = ['90','180','365'];
        if (diasSel) {
            const diasStr = String(item.diasGarantia || 365);
            diasSel.value = diasPadrao.includes(diasStr) ? diasStr : 'custom';
            if (!diasPadrao.includes(diasStr)) { el('bkDiasCustom').classList.remove('hidden'); el('bkDiasCustom').value = diasStr; }
        }
        GR.fotoUrl = item.fotoUrl || '';
        if (item.fotoUrl && el('bkFotoPreview')) { el('bkFotoPreview').src = item.fotoUrl; el('bkFotoPreview').style.display = 'block'; }
        switchView('novo');
    }

    function deleteGarantia(id) {
        modal({
            message: `Mover esta garantia para a lixeira? Ela será excluída definitivamente em ${LIXEIRA_DIAS} dias.`,
            confirmText: 'Mover para lixeira', cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await window._dbUpdate(dbref('bookips/' + id), { deletedAt: new Date().toISOString() });
                    modal({ message: 'Movida para a lixeira.' });
                } catch (e) {
                    modal({ message: 'Erro ao excluir: ' + e.message });
                }
            },
            onCancel: () => {}
        });
    }

    function restaurarGarantia(id) {
        window._dbUpdate(dbref('bookips/' + id), { deletedAt: null })
            .then(() => modal({ message: 'Garantia restaurada.' }))
            .catch(e => modal({ message: 'Erro ao restaurar: ' + e.message }));
    }

    function excluirDefinitivo(id) {
        modal({
            message: 'Excluir definitivamente? Essa ação não pode ser desfeita.',
            confirmText: 'Excluir para sempre', cancelText: 'Cancelar',
            onConfirm: async () => {
                try {
                    await window._dbRemove(dbref('bookips/' + id));
                    modal({ message: 'Excluída definitivamente.' });
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
                    window._dbRemove(dbref('bookips/' + item.id)).catch(() => {});
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

        return `*GARANTIA — Doc ${item.docNumber || '-'}*
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
        const termos     = (item.tipoTermo === 'concerto' ? (cfg.termosGarantiaConcerto || cfg.termosGarantia) : cfg.termosGarantia) || '';
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

        const termosHtml = termos.split('\n').map(line => {
            const t = line.trim();
            return t
                ? `<div class="vs-print-terms-text vs-avoid-break">${boldify(line)}</div>`
                : `<div class="vs-print-terms-gap"></div>`;
        }).join('');

        const html = `
        <div class="vs-print-doc">
            <div class="vs-print-header vs-avoid-break">
                ${logoHtml}
                <div class="vs-print-title-block">
                    <div class="vs-print-title-sub">Comprovante de</div>
                    <div class="vs-print-title-main">compra / Garantia</div>
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

            <div class="vs-print-terms-title vs-avoid-break">TERMOS DE GARANTIA</div>
            ${termosHtml}

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
    async function imprimirGarantiaCompleta(item, cfgPreFetched, mode = 'compartilhar', onProgress, onPageOneReady) {
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

            // Diagnóstico temporário — tira depois de achar a causa da
            // logo sumindo do PDF. Mostra na tela o que cada <img>
            // efetivamente carregou (ou não), sem precisar de console.
            if (new URLSearchParams(location.search).get('pdfimgdebug') === '1') {
                const linhas = imgs.map((img, i) =>
                    `[${i}] src=${img.src.slice(0, 80)}...\n     complete=${img.complete} naturalWidth=${img.naturalWidth} naturalHeight=${img.naturalHeight}`
                );
                linhas.unshift(`cfg.storeLogoUrl = ${cfg.storeLogoUrl || '(vazio)'}`);
                linhas.unshift(`Total de <img> encontradas no documento: ${imgs.length}`);
                const painel = document.createElement('div');
                painel.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#000;color:#0f0;font-family:monospace;font-size:11px;padding:14px;overflow:auto;white-space:pre-wrap;line-height:1.6;';
                painel.textContent = linhas.join('\n\n');
                const fechar = document.createElement('button');
                fechar.textContent = '✕ Fechar';
                fechar.style.cssText = 'position:fixed;top:10px;right:10px;z-index:1000000;background:#f00;color:#fff;border:none;padding:8px 12px;border-radius:6px;font-size:14px;';
                fechar.onclick = () => painel.remove();
                painel.appendChild(fechar);
                document.body.appendChild(painel);
            }

            // empurra pra próxima página qualquer bloco que ficaria cortado
            // (tabela, rodapé, linhas dos termos, assinatura etc.)
            evitarCorteDePagina(printArea, PRINT_PAGE_H_PX);

            onProgress?.(35, 'Renderizando documento...');
            await window._vsLib('html2canvas', 'jspdf');
            const canvas = await html2canvas(printArea, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });

            // Recorte da página 1 em alta resolução (o próprio canvas usado
            // no PDF, escala 2x) — usado como prévia real na tela de
            // carregamento. Evita gerar o documento uma segunda vez e evita
            // o efeito borrado de dar CSS scale no DOM ao vivo: aqui é uma
            // imagem já renderizada em alta definição, só reduzida na tela.
            if (onPageOneReady) {
                try {
                    const escalaCanvas = canvas.width / printArea.offsetWidth;
                    const alturaPagina1 = Math.min(canvas.height, Math.round(PRINT_PAGE_H_PX * escalaCanvas));
                    const recorte = document.createElement('canvas');
                    recorte.width = canvas.width;
                    recorte.height = alturaPagina1;
                    recorte.getContext('2d').drawImage(canvas, 0, 0, canvas.width, alturaPagina1, 0, 0, canvas.width, alturaPagina1);
                    onPageOneReady(recorte.toDataURL('image/jpeg', 0.92), canvas.width / alturaPagina1);
                } catch (e) { /* prévia é só cosmética — nunca deve travar a geração real */ }
            }

            onProgress?.(65, 'Montando PDF...');
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
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
    // Ex: "Termo de compra e garantia de João Silva.pdf"
    // Remove caracteres inválidos em nome de arquivo (/ \ : * ? " < > |).
    function nomeDocumentoBase(item, cfg) {
        const prefixo = cfg.nomeDocumento || 'Garantia';
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
        let overlay = document.getElementById('bkLoadingOverlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'bkLoadingOverlay';
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
        const overlay = document.getElementById('bkLoadingOverlay');
        if (overlay) overlay.remove();
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (sucesso) await window._showSuccessOverlay(textoSucesso, 1100);
        window._vsFinalizarProtecaoNavegacao && window._vsFinalizarProtecaoNavegacao();
    }

    // ── Pré-visualização "estilo Selo" — mostra a PÁGINA 1 REAL do
    // documento (recorte em alta resolução do mesmo canvas que vira o
    // PDF — não é o DOM ao vivo escalado, por isso não fica borrada)
    // dentro de uma moldura fixa, com um anel de progresso "carimbado"
    // no canto, ligado de verdade às etapas da geração. Sem borda
    // girando e sem luz de fundo espalhada pela tela — só um halo
    // contido atrás do card. Usada no compartilhamento rápido logo
    // após salvar a garantia.
    function mostrarPreviewCarregando(item, cfg) {
        let overlay = document.getElementById('bkPreviewOverlay');
        if (overlay) overlay.remove(); // sempre remonta com os dados atuais

        const totalItens    = (item.items || []).length;
        const garantiaLabel = String(item.diasGarantia) === '365' ? '1 Ano' : `${item.diasGarantia || 0} dias`;

        overlay = document.createElement('div');
        overlay.id = 'bkPreviewOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(5,9,18,.94);display:flex;align-items:center;justify-content:center;z-index:9999;opacity:0;animation:bkBackdropIn .25s ease forwards;padding:18px;';
        overlay.innerHTML = `
            <div id="bkPreviewSpot" class="bk-preview-spot"></div>

            <div id="bkPreviewCard" style="position:relative;width:min(94vw,252px);max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;align-items:center;gap:14px;transform:scale(.85);opacity:0;animation:bkCardIn .45s cubic-bezier(.2,1.4,.4,1) .1s forwards;">

                <!-- Página 1 real (imagem em alta resolução) + selo de progresso -->
                <div id="bkDocFrame" class="bk-doc-frame">
                    <div class="bk-doc-skeleton" id="bkDocSkeleton"></div>
                    <img id="bkDocImg" class="bk-doc-img" alt="Prévia da página 1">
                    <div id="bkSeloBadge" class="bk-selo-badge">
                        <svg width="40" height="40" viewBox="0 0 40 40">
                            <circle class="bk-selo-bg" cx="20" cy="20" r="16.5"></circle>
                            <circle id="bkSeloRing" class="bk-selo-fg" cx="20" cy="20" r="16.5"></circle>
                        </svg>
                        <span id="bkSeloPct">0%</span>
                    </div>
                </div>

                <!-- Progresso real, ligado às etapas da geração -->
                <div id="bkPreviewProgress" style="display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;">
                    <div style="color:#fff;font-family:'Poppins',sans-serif;font-size:.86rem;font-weight:700;text-align:center;">${esc(item.nome || 'Cliente')}</div>
                    <div style="color:rgba(255,255,255,.55);font-family:'Poppins',sans-serif;font-size:.72rem;text-align:center;">${totalItens} ${totalItens === 1 ? 'item' : 'itens'} · Garantia: ${esc(garantiaLabel)}</div>
                    <div id="bkPreviewText" style="color:rgba(255,255,255,.5);font-family:'Poppins',sans-serif;font-size:.74rem;text-align:center;margin-top:6px;"></div>
                </div>

                <!-- Ações — reveladas só quando o documento está pronto -->
                <div id="bkPreviewActions" style="display:none;flex-direction:column;align-items:stretch;gap:10px;width:100%;">
                    <div style="display:flex;gap:10px;width:100%;">
                        <button id="bkBtnEnviar" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:14px;padding:14px 6px;color:#fff;font-family:'Poppins',sans-serif;font-size:.8rem;font-weight:700;box-shadow:0 8px 20px rgba(22,163,74,.4);">
                            <i class="bi bi-send-fill" style="font-size:1.15rem;"></i> Enviar
                        </button>
                        <button id="bkBtnBaixar" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;background:rgba(var(--primary-rgb, 41,121,255),.12);border:1.5px solid rgba(var(--primary-rgb, 41,121,255),.4);border-radius:14px;padding:14px 6px;color:#fff;font-family:'Poppins',sans-serif;font-size:.8rem;font-weight:700;">
                            <i class="bi bi-download" style="font-size:1.15rem;color:var(--primary, #2979FF);"></i> Baixar
                        </button>
                    </div>
                    <button id="bkBtnNovo" style="display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;color:rgba(255,255,255,.75);font-family:'Poppins',sans-serif;font-size:.76rem;font-weight:600;padding:11px 4px;">
                        <i class="bi bi-plus-circle"></i> Começar outro documento
                    </button>
                </div>
            </div>

            <style>
                @keyframes bkBackdropIn { to { opacity:1; } }
                @keyframes bkCardIn { to { transform:scale(1); opacity:1; } }

                /* Halo único e contido atrás do card — não é luz espalhada
                   pela tela toda, só um brilho suave na cor de destaque do
                   sistema (acompanha tema claro/escuro e cor escolhida). */
                .bk-preview-spot {
                    position:absolute; width:300px; height:300px; border-radius:50%;
                    background:radial-gradient(circle, rgba(var(--primary-rgb, 41,121,255), .22), transparent 70%);
                    pointer-events:none; z-index:0;
                }

                /* Moldura fixa da página 1 — proporção de folha A4, cantos
                   quadrados, só sombra de elevação (sem borda colorida
                   girando). O tamanho na tela não muda: largura igual à
                   moldura anterior, altura seguindo a proporção real da
                   página (794x1123) via aspect-ratio. */
                .bk-doc-frame {
                    position:relative; z-index:1; width:239px; aspect-ratio:794/1123;
                    border-radius:4px; overflow:hidden; margin:0 auto;
                    box-shadow:0 18px 46px rgba(0,0,0,.45);
                    background:#fff;
                }
                .bk-doc-skeleton {
                    position:absolute; inset:0;
                    background:linear-gradient(100deg, rgba(var(--primary-rgb, 41,121,255), .10) 0%, rgba(var(--primary-rgb, 41,121,255), .22) 40%, rgba(var(--primary-rgb, 41,121,255), .10) 60%);
                    background-size:220% 100%;
                    animation:bkSkeletonShine 1.3s ease-in-out infinite;
                }
                @keyframes bkSkeletonShine { 0% { background-position:120% 0; } 100% { background-position:-20% 0; } }
                .bk-doc-img {
                    position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:top;
                    opacity:0; transition:opacity .35s ease;
                }
                .bk-doc-img.bk-doc-img-in { opacity:1; }
                .bk-doc-img.bk-doc-img-in ~ .bk-doc-skeleton { opacity:0; transition:opacity .35s ease; }

                /* Selo de progresso — sobreposto no canto da moldura, como
                   um carimbo. Anel real (stroke-dashoffset), não decorativo. */
                .bk-selo-badge {
                    position:absolute; top:-10px; right:-10px; width:40px; height:40px; z-index:2;
                    display:flex; align-items:center; justify-content:center;
                    background:#0d1424; border-radius:50%;
                    box-shadow:0 4px 14px rgba(0,0,0,.4);
                }
                .bk-selo-badge svg { position:absolute; inset:0; transform:rotate(-90deg); }
                .bk-selo-bg { fill:none; stroke:rgba(var(--primary-rgb, 41,121,255), .22); stroke-width:3; }
                .bk-selo-fg {
                    fill:none; stroke:var(--primary, #2979FF); stroke-width:3; stroke-linecap:round;
                    stroke-dasharray:103.7; stroke-dashoffset:103.7; transition:stroke-dashoffset .35s ease, stroke .25s ease;
                }
                .bk-selo-badge.bk-selo-done .bk-selo-fg { stroke:#22c55e; }
                #bkSeloPct { position:relative; z-index:1; font-family:'Poppins',sans-serif; font-size:.6rem; font-weight:800; color:var(--primary, #2979FF); }
                .bk-selo-badge.bk-selo-done #bkSeloPct { color:#22c55e; }

                #bkPreviewActions.bk-actions-in { animation:bkCardIn .35s cubic-bezier(.2,1.4,.4,1) forwards; }
                #bkBtnEnviar, #bkBtnBaixar, #bkBtnNovo { opacity:0; animation:bkDocLineIn .35s ease forwards; }
                @keyframes bkDocLineIn { to { opacity:1; transform:translateY(0); } }
                #bkBtnEnviar { animation-delay:.05s; }
                #bkBtnBaixar { animation-delay:.12s; }
                #bkBtnNovo { animation-delay:.2s; }
            </style>
        `;
        document.body.appendChild(overlay);

        atualizarPreviewCarregando(5, 'Preparando dados...');
    }

    // Recebe o recorte da página 1 (data URL, já em alta resolução) assim
    // que o canvas real fica pronto e troca o esqueleto pela imagem.
    function definirImagemPreview(dataUrl) {
        const img = document.getElementById('bkDocImg');
        if (!img) return;
        img.src = dataUrl;
        img.onload = () => img.classList.add('bk-doc-img-in');
    }

    function atualizarPreviewCarregando(pct, texto) {
        const txt   = document.getElementById('bkPreviewText');
        const badge = document.getElementById('bkSeloBadge');
        const ring  = document.getElementById('bkSeloRing');
        const pctEl = document.getElementById('bkSeloPct');
        const p = Math.min(pct, 100);
        if (txt && texto) txt.textContent = texto;
        if (pctEl) pctEl.textContent = Math.round(p) + '%';
        if (ring) ring.style.strokeDashoffset = String(103.7 - (p / 100) * 103.7);
        if (badge) badge.classList.toggle('bk-selo-done', p >= 100);
    }

    function esconderPreviewCarregando() {
        const overlay = document.getElementById('bkPreviewOverlay');
        if (overlay) overlay.remove();
    }

    // Troca o anel de progresso pelos botões Enviar/Baixar + "Começar outro
    // documento", com animação. Reaproveita o arquivo já gerado — nada é
    // regenerado ao clicar. Chamado só quando o documento chega a 100%.
    function revelarAcoesPreview({ onEnviar, onBaixar, onNovo }) {
        const progresso = document.getElementById('bkPreviewProgress');
        const acoes     = document.getElementById('bkPreviewActions');
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

        const btnEnviar = document.getElementById('bkBtnEnviar');
        const btnBaixar = document.getElementById('bkBtnBaixar');
        const btnNovo   = document.getElementById('bkBtnNovo');

        if (btnEnviar) btnEnviar.onclick = async () => {
            btnEnviar.disabled = true;
            try { await onEnviar(); } finally { btnEnviar.disabled = false; }
        };
        if (btnBaixar) btnBaixar.onclick = async () => {
            btnBaixar.disabled = true;
            try { await onBaixar(); } finally { btnBaixar.disabled = false; }
        };
        if (btnNovo) btnNovo.onclick = () => {
            const overlay = document.getElementById('bkPreviewOverlay');
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

    async function compartilharGarantia(idOuItem, loadingStyle = 'overlay') {
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
                const { blob, file, fileName } = await imprimirGarantiaCompleta(item, cfg, 'gerar', onProgress, definirImagemPreview);
                revelarAcoesPreview({
                    onEnviar: () => enviarArquivo(blob, file, fileName),
                    onBaixar: () => baixarBlob(blob, fileName),
                });
            } else {
                await imprimirGarantiaCompleta(item, cfg, 'compartilhar', onProgress);
                esconder();
            }
        } catch (e) {
            esconder();
            modal({ message: 'Erro ao gerar documento: ' + e.message });
        }
    }

    async function baixarGarantia(id) {
        const item = GR.cache.find(i => i.id === id);
        if (!item) return;
        const cfg = await getStoreConfig();
        mostrarCarregando('Gerando PDF...');
        let ok = true;
        try { await imprimirGarantiaCompleta(item, cfg, 'baixar'); }
        catch (e) { ok = false; modal({ message: 'Erro ao gerar PDF: ' + e.message }); }
        finally { await esconderCarregando(ok, 'Baixado!'); }
    }

})();