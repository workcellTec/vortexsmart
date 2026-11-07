// ================================================================
// calculadoras/emprestimo.js — VortexSmart · Calcular Empréstimo
// Depende de (via window.*):
//   _areRatesLoaded, _getRate, safeStorage, updateFlagDisplay,
//   openFlagSelector, openCalculatorSection
// ================================================================
(function () {
    'use strict';

    const ratesOk = () => !!window._areRatesLoaded;
    const getRate = (m, b, i) => typeof window._getRate === 'function' ? window._getRate(m, b, i) : undefined;
    const storage = () => window.safeStorage || { getItem: k => { try { return localStorage.getItem(k); } catch (e) { return null; } } };
    const el      = id => document.getElementById(id);
    const fmt     = v  => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    let emprestimoLucroPerc = 15;
    let ultimoValorBase = 0;
    let ultimasLinhas = [];

    // ── Chip de máquina + modal centralizado (mesmo padrão do Aparelho) ──
    // Vem do que a loja realmente cadastrou (Configurações → Taxas) —
    // antes era uma lista fixa (PagBank/InfinityPay/Valorante/Nubank)
    // sem ligação nenhuma com o sistema real, mostrando máquina fantasma.
    const MAQUINAS_FALLBACK = [
        { v: 'pagbank',   l: 'PagBank'     },
        { v: 'infinity',  l: 'InfinityPay' },
        { v: 'valorante', l: 'Valorante'   },
        { v: 'nubank',    l: 'Nubank Link' },
    ];
    function getMaquinas() {
        const dinamicas = typeof window._getMaquininhasVisiveis === 'function' ? window._getMaquininhasVisiveis() : [];
        if (dinamicas.length) return dinamicas;
        // Só cai no fallback fixo enquanto os dados REALMENTE ainda não
        // chegaram do Firebase — se já carregou e a loja genuinamente
        // não tem nenhuma máquina, retorna vazio de verdade em vez de
        // mostrar máquina fantasma que não existe.
        return window._areRatesLoaded ? [] : MAQUINAS_FALLBACK;
    }
    function getMaquinaPadraoId() {
        return typeof window._getMaquininhaPadrao === 'function' ? window._getMaquininhaPadrao() : 'pagbank';
    }
    function renderMachineChip4() {
        const cur = el('machine4')?.value || getMaquinaPadraoId();
        const atual = getMaquinas().find(m => m.v === cur);
        const valEl = el('machine4ChipValue');
        if (valEl) valEl.textContent = atual ? atual.l : 'PagBank';
    }
    function renderMachineModalList4() {
        const listEl = el('machine4ModalList');
        if (!listEl) return;
        const cur = el('machine4')?.value || getMaquinaPadraoId();
        listEl.innerHTML = getMaquinas().map(m => `
            <div class="apr-modal-item${cur === m.v ? ' active' : ''}" data-m="${m.v}">
                <span>${m.l}</span>${cur === m.v ? '<i class="bi bi-check-lg"></i>' : ''}
            </div>`).join('');
        listEl.querySelectorAll('.apr-modal-item').forEach(item => {
            item.addEventListener('click', () => {
                if (el('machine4')) el('machine4').value = item.dataset.m;
                fecharModalMaquina4();
                renderMachineChip4();
                updateCalcularEmprestimoUI();
            });
        });
    }
    function abrirModalMaquina4() {
        renderMachineModalList4();
        el('machine4ModalBackdrop')?.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }
    function fecharModalMaquina4() {
        el('machine4ModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
    }

    function updateCalcularEmprestimoUI() {
        renderMachineChip4();
        const machine = el('machine4')?.value || getMaquinaPadraoId();
        if (!machine) return;
        const flagContainer = el('flagDisplayContainer4');
        const bandeiras = window._getBandeirasDaMaquina?.(machine) || [];
        if (flagContainer) flagContainer.classList.toggle('hidden', !bandeiras.length);
        if (typeof window.updateFlagDisplay === 'function') window.updateFlagDisplay('4');
        calculateEmprestimo();
    }

    function calculateEmprestimo() {
        const resultDiv       = el('resultCalcularEmprestimo');
        const exportContainer = el('exportEmprestimoContainer');
        if (!ratesOk()) return;

        const valorBase     = parseFloat(el('emprestimoValue')?.value) || 0;
        const lucro         = valorBase * (emprestimoLucroPerc / 100);
        const valorDesejado = valorBase + lucro;
        const lucroDisp     = el('emprestimoLucroDisplay');
        const liqDisp       = el('valorLiquidoDisplay');
        ultimoValorBase = valorBase;

        if (lucroDisp) lucroDisp.innerHTML = `🟢 Lucro ${emprestimoLucroPerc}% = <span>${fmt(lucro)}</span>`;
        if (valorBase <= 0) {
            if (liqDisp) liqDisp.innerHTML = '';
            if (resultDiv) resultDiv.innerHTML = '';
            if (exportContainer) exportContainer.style.display = 'none';
            ultimasLinhas = [];
            return;
        }
        if (liqDisp) liqDisp.innerHTML = `<div class="alert alert-info d-flex align-items-center w-100" style="max-width:400px;margin:0 auto;"><i class="bi bi-info-circle-fill me-3"></i><div>Valor líquido a receber: <strong>${fmt(valorDesejado)}</strong></div></div>`;

        const machine  = el('machine4')?.value || getMaquinaPadraoId();
        const brand    = el('brand4')?.value;
        const maxInst  = getMaquinas().find(m => m.v === machine)?.maxParcelas || 18;
        const arredond = storage().getItem('ctwArredondarEnabled') === 'true';

        const linhas = [];
        const debitTax = getRate(machine, brand, 0);
        if (debitTax != null) {
            linhas.push({ inst: 'Débito', parcela: null, total: valorDesejado / (1 - debitTax / 100), debit: true });
        }
        for (let i = 1; i <= maxInst; i++) {
            const tax = getRate(machine, brand, i);
            if (tax === undefined) continue;
            let bruto = valorDesejado / (1 - tax / 100);
            let parcela = bruto / i;
            if (arredond) { parcela = Math.floor(parcela) + 0.90; bruto = parcela * i; }
            linhas.push({ inst: `${i}x`, parcela, total: bruto, debit: false });
        }
        ultimasLinhas = linhas;

        const rows = linhas.map(l => l.debit
            ? `<tr class="debit-row"><td>Débito</td><td>-</td><td>${fmt(l.total)}</td></tr>`
            : `<tr class="copyable-row" data-installments="${l.inst.replace('x','')}" data-parcela="${l.parcela.toFixed(2)}" data-total="${l.total.toFixed(2)}"><td>${l.inst}</td><td>${fmt(l.parcela)}</td><td>${fmt(l.total)}</td></tr>`
        ).join('');
        if (resultDiv) resultDiv.innerHTML = rows ? `<div class="table-responsive"><table class="table results-table"><thead><tr><th>Parcelas</th><th>Parcela</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>` : '';
        if (exportContainer) exportContainer.style.display = rows ? 'block' : 'none';
    }

    // ── Exportar imagem ────────────────────────────────────────────
    function exportarImagemEmprestimo() {
        if (!ultimasLinhas.length) return;
        window._calcExportarImagem({ badge: { texto: `Você recebe na hora: ${fmt(ultimoValorBase)}` }, linhas: ultimasLinhas, arquivoSufixo: 'emprestimo' });
    }

    // ── Modal de Lucro ────────────────────────────────────────────
    function openLucroModal() {
        const overlay = el('lucroModalOverlay');
        const input   = el('lucroPercentInput');
        if (!overlay || !input) return;
        input.value = emprestimoLucroPerc;
        overlay.classList.add('active');
        input.focus();
    }
    function closeLucroModal() { el('lucroModalOverlay')?.classList.remove('active'); }

    window._vsQuandoDomPronto(() => {
        renderMachineChip4();
        el('machine4Chip')?.addEventListener('click', abrirModalMaquina4);
        el('machine4ModalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'machine4ModalBackdrop') fecharModalMaquina4(); });
        el('machine4')?.addEventListener('change', updateCalcularEmprestimoUI);
        el('brand4')?.addEventListener('change', updateCalcularEmprestimoUI);
        el('flagDisplayButton4')?.addEventListener('click', () => window.openFlagSelector?.('4'));
        el('emprestimoValue')?.addEventListener('input', calculateEmprestimo);
        el('openLucroModalBtn')?.addEventListener('click', openLucroModal);
        el('cancelLucroBtn')?.addEventListener('click', closeLucroModal);
        el('saveLucroBtn')?.addEventListener('click', () => {
            const v = parseInt(el('lucroPercentInput')?.value);
            if (!isNaN(v) && v >= 0) { emprestimoLucroPerc = v; closeLucroModal(); calculateEmprestimo(); }
        });
        el('exportEmprestimoBtn')?.addEventListener('click', exportarImagemEmprestimo);
    });

    window.updateCalcularEmprestimoUI = updateCalcularEmprestimoUI;
})();
