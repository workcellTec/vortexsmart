// ================================================================
// calculadoras/por-aparelho.js — VortexSmart · Calcular por Aparelho
// Depende de (via window.*):
//   _areRatesLoaded, _getRate, safeStorage, showCustomModal, escapeHtml,
//   products, _fuse, updateFlagDisplay, openFlagSelector, openCalculatorSection,
//   _lojaRef, _dbUpdate
// Expõe via window.*:
//   updateCalcularPorAparelhoUI, _calcResetCarrinho (chamado pelo core.js
//   ao entrar na seção), _calcSelectAparelho, _calcRemover
// ================================================================
(function () {
    'use strict';

    const ratesOk = () => !!window._areRatesLoaded;
    const getRate = (m, b, i) => typeof window._getRate === 'function' ? window._getRate(m, b, i) : undefined;
    const storage = () => window.safeStorage || { getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } } };
    const modal   = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc     = t  => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const el      = id => document.getElementById(id);
    const fmt     = v  => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    let carrinhoDeAparelhos = [];
    let modoSelecaoMultipla = false;
    let chavesSelecionadas  = new Set();

    // ── Chip de máquina + modal centralizado (substitui o <select> nativo,
    //    que abria o seletor do sistema operacional em vez de algo no
    //    visual do app). Modal SEMPRE centralizado — nunca sobe de baixo,
    //    pra não brigar com a navbar fixa. ──
    // A lista de máquinas agora vem de Configurações → Taxas (Firebase,
    // node 'maquininhasConfig' + 'rates'). Esse array só serve de
    // fallback caso ainda não tenha carregado nada.
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
        return window._areRatesLoaded ? [] : MAQUINAS_FALLBACK;
    }
    function getMaquinaPadraoId() {
        return typeof window._getMaquininhaPadrao === 'function' ? window._getMaquininhaPadrao() : 'pagbank';
    }
    function renderMachineChip3() {
        const cur = el('machine3')?.value || getMaquinaPadraoId();
        const atual = getMaquinas().find(m => m.v === cur);
        const valEl = el('machine3ChipValue');
        if (valEl) valEl.textContent = atual ? atual.l : 'PagBank';
    }
    function renderMachineModalList3() {
        const listEl = el('machine3ModalList');
        if (!listEl) return;
        const cur = el('machine3')?.value || getMaquinaPadraoId();
        listEl.innerHTML = getMaquinas().map(m => `
            <div class="apr-modal-item${cur === m.v ? ' active' : ''}" data-m="${m.v}">
                <span>${m.l}</span>${cur === m.v ? '<i class="bi bi-check-lg"></i>' : ''}
            </div>`).join('');
        listEl.querySelectorAll('.apr-modal-item').forEach(item => {
            item.addEventListener('click', () => {
                if (el('machine3')) el('machine3').value = item.dataset.m;
                fecharModalMaquina3();
                renderMachineChip3();
                updateCalcularPorAparelhoUI();
            });
        });
    }
    function abrirModalMaquina3() {
        renderMachineModalList3();
        el('machine3ModalBackdrop')?.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }
    function fecharModalMaquina3() {
        el('machine3ModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
    }

    function updateCalcularPorAparelhoUI() {
        const machine = el('machine3')?.value || getMaquinaPadraoId();
        if (!machine) return;
        renderMachineChip3();
        const flagContainer = el('flagDisplayContainer3');
        if (flagContainer) flagContainer.classList.toggle('hidden', !(window._getBandeirasDaMaquina?.(machine) || []).length);
        if (typeof window.updateFlagDisplay === 'function') window.updateFlagDisplay('3');
        calculateAparelho();
    }

    function renderCarrinho() {
        const container = el('carrinhoAparelhosContainer');
        if (!container) return;
        container.innerHTML = '';
        if (!carrinhoDeAparelhos.length) return;
        carrinhoDeAparelhos.forEach((p, i) => {
            const dateInfo = p.lastCheckedTimestamp
                ? 'Verificado em ' + new Date(p.lastCheckedTimestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                : 'Verificado hoje';
            const colorsHtml = p.cores?.length
                ? p.cores.map(c => `<div class="color-pill" title="${c.nome}"><div class="color-swatch-sm" style="background:${c.hex};"></div><span>${c.nome}</span></div>`).join('')
                : '<span class="text-secondary small ms-1">Sem cores definidas</span>';
            container.insertAdjacentHTML('beforeend', `
            <div class="product-action-card" data-index="${i}">
                <div class="product-action-header">
                    <div class="product-action-info" style="flex:1;">
                        <h5 class="mb-1 text-start">${esc(p.nome)}</h5>
                        <div class="product-action-date text-start"><i class="bi bi-clock-history"></i> ${dateInfo}</div>
                    </div>
                    ${(typeof window._temPermissao === 'function' ? window._temPermissao('calc_editar_lucro') : true) ? `
                    <button class="btn-settings-toggle" title="Opções" data-index="${i}">
                        <i class="bi bi-gear-fill"></i>
                    </button>` : ''}
                    <button class="btn-remove-card" onclick="window._calcRemover(${i})" title="Remover">
                        <i class="bi bi-x-lg"></i>
                    </button>
                </div>
                <div class="product-action-colors">${colorsHtml}</div>
                ${(typeof window._temPermissao === 'function' ? window._temPermissao('calc_editar_lucro') : true) ? `
                <div class="product-admin-panel" id="adminPanel_${i}" style="display:none;">
                    <span class="admin-warning-label"><i class="bi bi-exclamation-triangle"></i> Editar Cadastro no Sistema</span>
                    <div class="product-action-buttons mt-2">
                        <button class="btn-action-sm edit-name-btn" data-index="${i}" data-id="${p.id}">
                            <i class="bi bi-pencil"></i> Nome
                        </button>
                        <button class="btn-action-sm edit-price-btn" data-index="${i}" data-id="${p.id}">
                            <i class="bi bi-cash-coin"></i> Valor
                        </button>
                        <button class="btn-action-sm edit-colors-btn" data-id="${p.id}">
                            <i class="bi bi-palette"></i> Cores
                        </button>
                    </div>
                </div>` : ''}
            </div>`);
        });
    }

    function calculateAparelho() {
        if (!ratesOk()) return;
        const resultDiv       = el('resultCalcularPorAparelho');
        const exportContainer = el('exportAparelhoContainer');
        const entradaValue    = parseFloat(el('entradaAparelho')?.value) || 0;
        const extraValue      = parseFloat(el('valorExtraAparelho')?.value) || 0;

        if (!carrinhoDeAparelhos.length) {
            if (resultDiv) resultDiv.innerHTML = '<div class="alert alert-warning d-flex align-items-center mt-3 w-100" style="max-width:400px;margin:1rem auto;"><i class="bi bi-exclamation-triangle-fill me-3"></i>Adicione um aparelho para calcular.</div>';
            if (exportContainer) exportContainer.style.display = 'none';
            return;
        }

        const totalProd = carrinhoDeAparelhos.reduce((t, p) => t + parseFloat(p.valor), 0);
        const totalAp   = totalProd + extraValue;
        const base      = totalAp - entradaValue;
        const precoDisp = el('aparelhoPrecoTotalDisplay');
        if (precoDisp) precoDisp.innerHTML = `Preço Total: ${fmt(totalAp)}`;

        let headerHtml = '';
        if (entradaValue > 0) headerHtml = `<div class="alert alert-info d-flex align-items-center w-100" style="max-width:400px;margin-top:1rem;"><i class="bi bi-info-circle-fill me-3"></i><div><strong>Entrada de ${fmt(entradaValue)} aplicada.</strong></div></div>`;
        if (base < 0) { if (resultDiv) resultDiv.innerHTML = headerHtml + '<div class="alert alert-danger d-flex align-items-center mt-3 w-100" style="max-width:400px;margin:1rem auto;"><i class="bi bi-x-circle-fill me-3"></i>Entrada maior que o valor total.</div>'; if (exportContainer) exportContainer.style.display = 'none'; return; }
        if (base <= 0) { if (resultDiv) resultDiv.innerHTML = headerHtml + '<div class="alert alert-success d-flex align-items-center mt-3 w-100" style="max-width:400px;margin:1rem auto;"><i class="bi bi-check-circle-fill me-3"></i>Valor quitado com a entrada.</div>'; if (exportContainer) exportContainer.style.display = 'none'; return; }

        const machine  = el('machine3')?.value || getMaquinaPadraoId();
        const brand    = el('brand3')?.value;
        const maxInst  = getMaquinas().find(m => m.v === machine)?.maxParcelas || 18;
        const arredond = storage().getItem('ctwArredondarEnabled') === 'true';

        let rows = '';
        const debitTax = getRate(machine, brand, 0);
        if (debitTax != null) { const bruto = base / (1 - debitTax / 100); rows += `<tr class="apr-row debit-row" data-debit="1" data-total="${bruto.toFixed(2)}"><td>Débito</td><td>-</td><td>${fmt(bruto)}</td></tr>`; }
        for (let i = 1; i <= maxInst; i++) {
            const tax = getRate(machine, brand, i);
            if (tax === undefined) continue;
            let bruto = base / (1 - tax / 100);
            let parcela = bruto / i;
            if (arredond) { parcela = Math.floor(parcela) + 0.90; bruto = parcela * i; }
            rows += `<tr class="apr-row" data-installments="${i}" data-parcela="${parcela.toFixed(2)}" data-total="${bruto.toFixed(2)}"><td>${i}x</td><td>${fmt(parcela)}</td><td>${fmt(bruto)}</td></tr>`;
        }
        const multiToggle = rows ? `<div class="apr-multi-row w-100"><span class="apr-multi-lbl">Selecionar Vários</span><label class="apr-switch"><input type="checkbox" id="multiSelectToggle"${modoSelecaoMultipla ? ' checked' : ''}><span class="track"></span></label></div>` : '';
        if (resultDiv) resultDiv.innerHTML = headerHtml + multiToggle + (rows ? `<div class="table-responsive"><table class="table results-table"><thead><tr><th>Parcelas</th><th>Valor da Parcela</th><th>Total a Passar</th></tr></thead><tbody>${rows}</tbody></table></div>` : '');
        if (exportContainer) exportContainer.style.display = rows ? 'block' : 'none';

        bindResultadoAparelhoEvents();
    }

    // ── Texto pra WhatsApp: nome do(s) produto(s) do carrinho ─────
    function nomeProdutosDoCarrinho() {
        return carrinhoDeAparelhos.map(p => p.nome).join(' + ');
    }

    // Texto livre definido em Configurações → Customizações. Anexado
    // no final da cópia (única e múltipla), com uma linha em branco
    // antes. Vazio por padrão — não aparece nada se ninguém configurar.
    function textoCustomizadoRodape() {
        const texto = (window._configCustomizacoes && window._configCustomizacoes.textoRodapeCalculo) || '';
        return texto.trim() ? `\n\n${texto}` : '';
    }

    // ── Linha de entrada (puxa o valor real digitado no campo) ─────
    function linhaValorEntrada(entradaValue) {
        return entradaValue > 0 ? `*+ ${fmt(entradaValue)} de entrada à vista no dinheiro ou pix*` : '';
    }

    // ── Cópia de UMA linha (clique direto, fora do modo múltiplo) ──
    function textoCopiaUnica(linha, entradaValue) {
        const cabecalho = linha.debit ? `Débito ${fmt(linha.total)}` : `${linha.inst}x ${fmt(linha.parcela)}`;
        const nomes = nomeProdutosDoCarrinho();
        let base = linha.debit ? cabecalho : `${cabecalho}\n_(Total: ${fmt(linha.total)})_`;
        base += entradaValue > 0
            ? `\n${linhaValorEntrada(entradaValue)}\n\n${nomes}`
            : `\n${nomes}`;
        return base + textoCustomizadoRodape();
    }

    // ── Cópia de VÁRIAS linhas selecionadas (modo múltiplo) ────────
    function textoCopiaMultipla(linhas, entradaValue) {
        const partes = linhas.map(l => l.debit ? `Débito ${fmt(l.total)}` : `${l.inst}x ${fmt(l.parcela)}\n_(Total: ${fmt(l.total)})_`);
        let texto = partes.join('\nOu\n');
        if (entradaValue > 0) {
            texto += `\n\n${linhaValorEntrada(entradaValue)}`;
        }
        texto += `\n\n${nomeProdutosDoCarrinho()}`;
        texto += textoCustomizadoRodape();
        return texto;
    }

    function chaveLinha(row) {
        return row.dataset.debit ? 'debito' : `p${row.dataset.installments}`;
    }
    function linhaDoRow(row) {
        return row.dataset.debit
            ? { debit: true, total: parseFloat(row.dataset.total) }
            : { debit: false, inst: parseInt(row.dataset.installments, 10), parcela: parseFloat(row.dataset.parcela), total: parseFloat(row.dataset.total) };
    }

    function atualizarBotaoCopiarFab() {
        const btn = el('aprCopiarSelecionadosBtn');
        const label = el('aprCopiarSelecionadosLabel');
        if (!btn) return;
        const qtd = chavesSelecionadas.size;
        if (!modoSelecaoMultipla || qtd === 0) { btn.style.display = 'none'; return; }
        btn.style.display = 'flex';
        if (label) label.textContent = `Copiar selecionados (${qtd})`;
    }

    function bindResultadoAparelhoEvents() {
        const toggle = el('multiSelectToggle');
        toggle?.addEventListener('change', () => {
            modoSelecaoMultipla = toggle.checked;
            chavesSelecionadas = new Set();
            calculateAparelho();
        });

        atualizarBotaoCopiarFab();

        document.querySelectorAll('#resultCalcularPorAparelho .apr-row').forEach(row => {
            const chave = chaveLinha(row);
            if (modoSelecaoMultipla && chavesSelecionadas.has(chave)) row.classList.add('selected');
            row.addEventListener('click', () => {
                if (modoSelecaoMultipla) {
                    if (chavesSelecionadas.has(chave)) { chavesSelecionadas.delete(chave); row.classList.remove('selected'); }
                    else { chavesSelecionadas.add(chave); row.classList.add('selected'); }
                    atualizarBotaoCopiarFab();
                } else {
                    const entradaValue = parseFloat(el('entradaAparelho')?.value) || 0;
                    const texto = textoCopiaUnica(linhaDoRow(row), entradaValue);
                    navigator.clipboard?.writeText(texto).then(() => modal({ message: 'Copiado!' })).catch(() => {});
                }
            });
        });
    }

    function handleProductSelectionForAparelho(product) {
        carrinhoDeAparelhos.push({ ...product });
        el('aparelhoSearch').value = '';
        el('aparelhoResultsContainer').innerHTML = '';
        if (carrinhoDeAparelhos.length === 1) { const ext = el('valorExtraAparelho'); if (ext) ext.value = '40'; }
        if (carrinhoDeAparelhos.length === 2) modal({ message: 'Múltiplos produtos: textos de etiqueta desativados.' });
        el('aparelhoInfoNote')?.classList.add('hidden');
        renderCarrinho();
        calculateAparelho();
    }

    function setupAparelhoSearch() {
        const input = el('aparelhoSearch');
        if (!input) return;
        input.addEventListener('input', () => {
            const q = input.value.trim();
            const container = el('aparelhoResultsContainer');
            if (!container) return;
            if (!q) { container.innerHTML = ''; return; }
            const prods = window.products || [];
            const fuse  = window._fuse;
            const results = fuse ? fuse.search(q).map(r => r.item).slice(0, 8) : prods.filter(p => p.nome.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
            container.innerHTML = results.length
                ? results.map(p => `<button class="list-group-item list-group-item-action" onclick="window._calcSelectAparelho('${p.id}')">${esc(p.nome)} — ${fmt(p.valor)}</button>`).join('')
                : '<div class="list-group-item text-secondary small">Nenhum produto encontrado</div>';
        });
    }

    // ── Exportar imagem (carrinho de aparelhos) ───────────────────
    function exportarImagemAparelho() {
        if (!carrinhoDeAparelhos.length) return;

        const machine  = el('machine3')?.value || getMaquinaPadraoId();
        const brand    = el('brand3')?.value   || 'visa';
        const maxInst  = getMaquinas().find(m => m.v === machine)?.maxParcelas || 18;
        const entrada  = parseFloat(el('entradaAparelho')?.value) || 0;
        const extra    = parseFloat(el('valorExtraAparelho')?.value) || 0;
        const totalProd = carrinhoDeAparelhos.reduce((t, p) => t + parseFloat(p.valor), 0);
        const base      = (totalProd + extra) - entrada;

        if (base <= 0) { modal({ message: 'Nenhum valor para exportar.' }); return; }

        const linhas = [];
        const debitTax = getRate(machine, brand, 0);
        if (debitTax != null) {
            linhas.push({ inst: 'Débito', parcela: null, total: base / (1 - debitTax / 100), debit: true });
        }
        for (let i = 1; i <= maxInst; i++) {
            const tax = getRate(machine, brand, i);
            if (tax === undefined) continue;
            const bruto   = base / (1 - tax / 100);
            const parcela = bruto / i;
            linhas.push({ inst: i + 'x', parcela, total: bruto, debit: false });
        }

        const nomeProduto = carrinhoDeAparelhos.map(p => p.nome).join(' + ');
        const notaEntrada = entrada > 0 ? `+ ${fmt(entrada)} de entrada à vista no dinheiro ou pix` : null;

        window._calcExportarImagem({ badge: { texto: nomeProduto }, linhas, arquivoSufixo: 'parcelas', notaEntrada });
    }

    // ── API exposta pro core.js e pros onclick inline ─────────────
    window._calcResetCarrinho = function () {
        carrinhoDeAparelhos = [];
        renderCarrinho();
        const entIn = el('entradaAparelho'), extIn = el('valorExtraAparelho');
        if (entIn) entIn.value = '';
        if (extIn) extIn.value = '';
        if (el('machine3')) el('machine3').value = getMaquinaPadraoId();
        renderMachineChip3();
    };
    window._calcRemover = function (i) { carrinhoDeAparelhos.splice(i, 1); renderCarrinho(); calculateAparelho(); };
    window.removerDoCarrinho = window._calcRemover;
    window._calcSelectAparelho = function (id) {
        const p = (window.products || []).find(p => p.id === id);
        if (p) handleProductSelectionForAparelho(p);
    };
    window.updateCalcularPorAparelhoUI = updateCalcularPorAparelhoUI;

    document.addEventListener('DOMContentLoaded', () => {
        renderMachineChip3();
        el('machine3Chip')?.addEventListener('click', abrirModalMaquina3);
        el('machine3ModalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'machine3ModalBackdrop') fecharModalMaquina3(); });
        el('machine3')?.addEventListener('change', updateCalcularPorAparelhoUI);
        el('brand3')?.addEventListener('change', updateCalcularPorAparelhoUI);
        el('flagDisplayButton3')?.addEventListener('click', () => window.openFlagSelector?.('3'));
        el('entradaAparelho')?.addEventListener('input', calculateAparelho);
        el('valorExtraAparelho')?.addEventListener('input', calculateAparelho);
        el('exportAparelhoBtn')?.addEventListener('click', exportarImagemAparelho);
        setupAparelhoSearch();

        el('aprCopiarSelecionadosBtn')?.addEventListener('click', () => {
            const entradaValue = parseFloat(el('entradaAparelho')?.value) || 0;
            const linhas = Array.from(document.querySelectorAll('#resultCalcularPorAparelho .apr-row'))
                .filter(row => chavesSelecionadas.has(chaveLinha(row)))
                .map(row => linhaDoRow(row));
            const texto = textoCopiaMultipla(linhas, entradaValue);
            navigator.clipboard?.writeText(texto).then(() => modal({ message: 'Copiado!' })).catch(() => {});

            // Já executou a cópia — sai do modo de seleção múltipla automaticamente
            // (desmarca o toggle, limpa a seleção e refaz o cálculo pra sumir os
            // checkboxes e o próprio FAB, já que ele não tem mais nada selecionado).
            modoSelecaoMultipla = false;
            chavesSelecionadas = new Set();
            const toggle = el('multiSelectToggle');
            if (toggle) toggle.checked = false;
            calculateAparelho();
        });

        el('toggleValorExtraBtn')?.addEventListener('click', () => {
            const c = el('valorExtraContainer');
            const b = el('toggleValorExtraBtn');
            if (!c) return;
            const open = c.classList.toggle('is-active');
            b?.querySelector('i')?.classList.toggle('bi-chevron-up', open);
            b?.querySelector('i')?.classList.toggle('bi-chevron-down', !open);
        });

        // Botão de engrenagem do carrinho (mostra/esconde painel admin do produto)
        document.addEventListener('click', e => {
            const gear = e.target.closest('.btn-settings-toggle');
            if (!gear) return;
            const idx = gear.dataset.index;
            const panel = document.getElementById('adminPanel_' + idx);
            if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        });

        // Editar Nome / Valor / Cores — grava direto no produto de origem
        // (window.products / Firebase), não só no carrinho local. Só
        // aparece pro Gestor (já filtrado na renderização do card).
        document.addEventListener('click', e => {
            const nomeBtn = e.target.closest('.edit-name-btn');
            const valorBtn = e.target.closest('.edit-price-btn');
            const coresBtn = e.target.closest('.edit-colors-btn');
            if (nomeBtn) {
                const produto = (window.products || []).find(p => p.id === nomeBtn.dataset.id);
                editarCampoProduto(nomeBtn.dataset.id, 'nome', produto?.nome, 'Nome do produto', 'text');
            } else if (valorBtn) {
                const produto = (window.products || []).find(p => p.id === valorBtn.dataset.id);
                editarCampoProduto(valorBtn.dataset.id, 'valor', produto?.valor, 'Valor (R$)', 'number');
            } else if (coresBtn) {
                abrirEditorCores(coresBtn.dataset.id);
            }
        });
    });

    function formatarValorBR(v) {
        const n = parseFloat(v);
        if (isNaN(n)) return '';
        return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function parseValorBR(v) {
        if (typeof v !== 'string') return parseFloat(v);
        return parseFloat(v.replace(/\./g, '').replace(',', '.'));
    }

    function editarCampoProduto(produtoId, campo, valorAtual, label, tipo) {
        if (!produtoId) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Produto sem ID — não dá pra editar.' }); return; }
        window.showCustomModal({
            message: `Novo ${label}:`,
            showPassword: true,
            confirmText: 'Salvar',
            onConfirm: (novoValor) => salvarCampoProduto(produtoId, campo, novoValor, tipo),
            onCancel: () => {}
        });
        const input = document.getElementById('customModalPasswordInput');
        if (input) {
            input.type = 'text'; // number nativo não aceita "2.329,00" formatado
            input.style.webkitTextSecurity = 'none'; // reaproveitando o modal de senha aqui — não é senha, tira a máscara ***
            input.placeholder = label;
            input.value = tipo === 'number' ? formatarValorBR(valorAtual) : (valorAtual ?? '');
            input.setAttribute('autocomplete', 'off');
            input.setAttribute('inputmode', tipo === 'number' ? 'decimal' : 'text');
        }
    }

    function salvarCampoProduto(produtoId, campo, novoValor, tipo) {
        let valor = novoValor;
        if (tipo === 'number') {
            valor = parseValorBR(novoValor);
            if (isNaN(valor)) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Valor inválido.' }); return; }
        } else {
            valor = String(novoValor).trim();
            if (!valor) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Nome não pode ficar vazio.' }); return; }
        }
        window._dbUpdate(window._lojaRef(`products/${produtoId}`), { [campo]: valor })
            .then(() => { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: '✅ Atualizado!' }); })
            .catch(e => { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao salvar: ${e.message}` }); });
    }

    // ── Editor de cores (lista + adicionar + remover) ──────────────
    function abrirEditorCores(produtoId) {
        const produto = (window.products || []).find(p => p.id === produtoId);
        if (!produto) return;
        let cores = JSON.parse(JSON.stringify(produto.cores || []));

        let overlay = document.getElementById('coresEditorOverlay');
        if (!overlay) {
            document.body.insertAdjacentHTML('beforeend', `
                <div class="custom-modal-overlay" id="coresEditorOverlay">
                    <div class="custom-modal-content" style="max-width:340px;">
                        <h4 class="mb-2">Editar Cores</h4>
                        <div id="coresEditorList" style="text-align:left;margin-bottom:12px;"></div>
                        <div class="d-flex gap-2 mb-3">
                            <input type="color" id="coresEditorHex" value="#2979FF" style="width:44px;height:38px;border:none;border-radius:8px;padding:0;flex-shrink:0;">
                            <input class="form-control" id="coresEditorNome" placeholder="Nome da cor">
                            <button class="btn btn-primary" id="coresEditorAddBtn" style="flex-shrink:0;">+</button>
                        </div>
                        <div class="d-flex gap-2">
                            <button class="btn btn-secondary flex-fill" id="coresEditorCancelBtn">Cancelar</button>
                            <button class="btn btn-primary flex-fill" id="coresEditorSaveBtn">Salvar</button>
                        </div>
                    </div>
                </div>`);
            overlay = document.getElementById('coresEditorOverlay');
        }

        function draw() {
            const listEl = document.getElementById('coresEditorList');
            listEl.innerHTML = cores.length ? cores.map((c, i) => `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);">
                    <div style="width:18px;height:18px;border-radius:50%;background:${c.hex};flex-shrink:0;"></div>
                    <span style="flex:1;">${c.nome}</span>
                    <button type="button" data-i="${i}" class="cores-editor-remove" style="border:none;background:none;color:var(--danger,#dc3545);font-size:1rem;">✕</button>
                </div>
            `).join('') : '<div class="text-secondary small">Nenhuma cor cadastrada.</div>';
            listEl.querySelectorAll('.cores-editor-remove').forEach(btn => {
                btn.addEventListener('click', () => { cores.splice(Number(btn.dataset.i), 1); draw(); });
            });
        }
        draw();

        document.getElementById('coresEditorAddBtn').onclick = () => {
            const nome = document.getElementById('coresEditorNome').value.trim();
            const hex = document.getElementById('coresEditorHex').value;
            if (!nome) return;
            cores.push({ nome, hex });
            document.getElementById('coresEditorNome').value = '';
            draw();
        };
        document.getElementById('coresEditorCancelBtn').onclick = () => overlay.classList.remove('active');
        document.getElementById('coresEditorSaveBtn').onclick = () => {
            window._dbUpdate(window._lojaRef(`products/${produtoId}`), { cores })
                .then(() => {
                    overlay.classList.remove('active');
                    if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: '✅ Cores atualizadas!' });
                })
                .catch(e => { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro: ${e.message}` }); });
        };
        overlay.classList.add('active');
    }
})();
