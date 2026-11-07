// ================================================================
// calculadoras/router.js — VortexSmart · Módulo de Calculadoras
// Navegação da Calculadora Home (cards Fechar Venda / Repassar Valores /
// Calcular Empréstimo / Calcular por Aparelho) + utilitário compartilhado
// de "copiar linha" (usado pelas 4 calculadoras) + agregador de rates.
// Depende de (via window.*):
//   showCustomModal, openCalculatorSection,
//   updateRepassarValoresUI, updateCalcularEmprestimoUI,
//   updateCalcularPorAparelhoUI (expostos por cada arquivo irmão)
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);

    // ── Cópia de linha de resultado (genérico, usado por todas) ───
    function setupCopyRows() {
        document.addEventListener('click', e => {
            const row = e.target.closest('.copyable-row');
            if (!row) return;
            const parc  = row.dataset.parcela;
            const inst  = row.dataset.installments;
            const total = row.dataset.total;
            if (!parc) return;
            const text = inst === 'Débito'
                ? `Débito: R$ ${parseFloat(total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                : `${inst}x de R$ ${parseFloat(parc).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
            navigator.clipboard?.writeText(text).then(() => modal({ message: `Copiado: ${text}` })).catch(() => {});
        });
    }

    // ── Callback agregador quando as taxas carregam (chamado pelo core.js) ──
    // Fechar Venda tem o seu próprio hook independente (_fvOnRatesLoaded),
    // exposto em calculadoras/fechar-venda.js.
    window._calcOnRatesLoaded = function () {
        if (typeof window.updateRepassarValoresUI === 'function') window.updateRepassarValoresUI();
        if (typeof window.updateCalcularEmprestimoUI === 'function') window.updateCalcularEmprestimoUI();
        if (typeof window.updateCalcularPorAparelhoUI === 'function') window.updateCalcularPorAparelhoUI();
    };

    document.addEventListener('DOMContentLoaded', () => {
        // Navegação a partir da Calculadora Home
        document.getElementById('openFecharVenda2')?.addEventListener('click', () => window.openCalculatorSection?.('fecharVenda'));
        document.getElementById('openRepassarValores')?.addEventListener('click', () => window.openCalculatorSection?.('repassarValores'));
        document.getElementById('openRepassarValores2')?.addEventListener('click', () => window.openCalculatorSection?.('repassarValores'));
        document.getElementById('openCalcularEmprestimo')?.addEventListener('click', () => window.openCalculatorSection?.('calcularEmprestimo'));
        document.getElementById('openCalcularEmprestimo2')?.addEventListener('click', () => window.openCalculatorSection?.('calcularEmprestimo'));
        document.getElementById('openCalcularPorAparelho')?.addEventListener('click', () => window.openCalculatorSection?.('calcularPorAparelho'));
        document.getElementById('openCalcularPorAparelho2')?.addEventListener('click', () => window.openCalculatorSection?.('calcularPorAparelho'));

        setupCopyRows();
    });
})();
