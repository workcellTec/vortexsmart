// ================================================================
// calculadoras/repassar-valores.js — VortexSmart · Repassar Valores
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

    let ultimasLinhas = [];

    // ── Chip de máquina + modal centralizado (mesmo padrão do Aparelho) ──
    // Lista vem de Configurações → Taxas agora; fallback só se ainda não
    // tiver carregado nada do Firebase.
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
    function renderMachineChip2() {
        const cur = el('machine2')?.value || getMaquinaPadraoId();
        const atual = getMaquinas().find(m => m.v === cur);
        const valEl = el('machine2ChipValue');
        if (valEl) valEl.textContent = atual ? atual.l : 'PagBank';
    }
    function renderMachineModalList2() {
        const listEl = el('machine2ModalList');
        if (!listEl) return;
        const cur = el('machine2')?.value || getMaquinaPadraoId();
        listEl.innerHTML = getMaquinas().map(m => `
            <div class="apr-modal-item${cur === m.v ? ' active' : ''}" data-m="${m.v}">
                <span>${m.l}</span>${cur === m.v ? '<i class="bi bi-check-lg"></i>' : ''}
            </div>`).join('');
        listEl.querySelectorAll('.apr-modal-item').forEach(item => {
            item.addEventListener('click', () => {
                if (el('machine2')) el('machine2').value = item.dataset.m;
                fecharModalMaquina2();
                renderMachineChip2();
                updateRepassarValoresUI();
            });
        });
    }
    function abrirModalMaquina2() {
        renderMachineModalList2();
        el('machine2ModalBackdrop')?.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }
    function fecharModalMaquina2() {
        el('machine2ModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
    }

    function updateRepassarValoresUI() {
        renderMachineChip2();
        const machine = el('machine2')?.value || getMaquinaPadraoId();
        if (!machine) return;
        const flagContainer = el('flagDisplayContainer2');
        if (flagContainer) flagContainer.classList.toggle('hidden', !(window._getBandeirasDaMaquina?.(machine) || []).length);
        if (typeof window.updateFlagDisplay === 'function') window.updateFlagDisplay('2');
        calculateRepassarValores();
    }

    function calculateRepassarValores() {
        const resultDiv       = el('resultRepassarValores');
        const exportContainer = el('exportRepassarContainer');
        if (!ratesOk()) return;

        const machine  = el('machine2')?.value || getMaquinaPadraoId();
        const brand    = el('brand2')?.value;
        const maxInst  = getMaquinas().find(m => m.v === machine)?.maxParcelas || 18;
        const arredond = storage().getItem('ctwArredondarEnabled') === 'true';

        const repassarValue = parseFloat(el('repassarValue')?.value) || 0;
        const repassarExtra = parseFloat(el('repassarExtra')?.value) || 0;
        const base = repassarValue + repassarExtra;

        if (base <= 0) {
            if (resultDiv) resultDiv.innerHTML = '';
            if (exportContainer) exportContainer.style.display = 'none';
            ultimasLinhas = [];
            return;
        }

        const linhas = [];
        const debitTax = getRate(machine, brand, 0);
        if (debitTax != null) {
            linhas.push({ inst: 'Débito', parcela: null, total: base / (1 - debitTax / 100), debit: true });
        }
        for (let i = 1; i <= maxInst; i++) {
            const tax = getRate(machine, brand, i);
            if (tax === undefined) continue;
            let bruto = base / (1 - tax / 100);
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
    function exportarImagemRepassar() {
        if (!ultimasLinhas.length) return;
        window._calcExportarImagem({ badge: { texto: 'Orçamento Personalizado' }, linhas: ultimasLinhas, arquivoSufixo: 'orcamento' });
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderMachineChip2();
        el('machine2Chip')?.addEventListener('click', abrirModalMaquina2);
        el('machine2ModalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'machine2ModalBackdrop') fecharModalMaquina2(); });
        el('machine2')?.addEventListener('change', updateRepassarValoresUI);
        el('brand2')?.addEventListener('change', updateRepassarValoresUI);
        el('flagDisplayButton2')?.addEventListener('click', () => window.openFlagSelector?.('2'));
        el('repassarValue')?.addEventListener('input', calculateRepassarValores);
        el('repassarExtra')?.addEventListener('input', calculateRepassarValores);
        el('exportRepassarBtn')?.addEventListener('click', exportarImagemRepassar);

        el('toggleRepassarExtraBtn')?.addEventListener('click', () => {
            const c = el('repassarExtraContainer');
            const b = el('toggleRepassarExtraBtn');
            if (!c) return;
            const open = c.classList.toggle('is-active');
            b?.querySelector('i')?.classList.toggle('bi-chevron-up', open);
            b?.querySelector('i')?.classList.toggle('bi-chevron-down', !open);
        });
    });

    window.updateRepassarValoresUI = updateRepassarValoresUI;
})();
