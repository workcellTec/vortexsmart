// ================================================================
// documentos/router.js — VortexSmart · Roteador de Documentos
// Responsável apenas por navegar entre as telas do módulo.
// Cada tela vive em seu próprio arquivo:
//   bookip.js    → window._initBookip()
//   contrato.js  → window._initContrato()
//   recibo.js    → window._initRecibo()
//   orcamento.js → window._initOrcamento()
// ================================================================
(function () {
    'use strict';

    const el = id => document.getElementById(id);

    const DOC_SUBS = ['documentosHome', 'documentosContrato', 'documentosGarantia', 'documentosRecibo', 'documentosOrcamento'];

    function openDocumentosSection(sectionId, contexto, substituir) {
        if (typeof window.showMainSection === 'function') window.showMainSection('documentos');
        // Ver window._vsNavegarParaHub em core.js pro raciocínio completo.
        const ehHubDoModulo = sectionId === 'documentosHome' || !sectionId;
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openDocumentosSection', [sectionId], ehHubDoModulo, substituir);
        if (!sectionId || !el(sectionId)) sectionId = 'documentosHome';
        // Celular: o hub do módulo não existe — abre direto na aba padrão (ver navegacao-mobile.js).
        if (window._vsAbas) sectionId = window._vsAbas.redirecionar('documentos', sectionId);
        DOC_SUBS.forEach(id => { const s = el(id); if (s) s.style.display = 'none'; });

        const target = el(sectionId);
        if (target) target.style.display = 'flex';
        if (window._vsAbas) window._vsAbas.atualizar('documentos', sectionId);

        const initMap = {
            documentosContrato:  () => typeof window._initContrato  === 'function' && window._initContrato(),
            documentosGarantia:  () => typeof window._initBookip    === 'function' && window._initBookip(),
            documentosRecibo:    () => typeof window._initRecibo    === 'function' && window._initRecibo(),
            documentosOrcamento: () => typeof window._initOrcamento === 'function' && window._initOrcamento(),
        };
        if (initMap[sectionId]) initMap[sectionId]();
    }
    window.openDocumentosSection = openDocumentosSection;

    // ── Listeners dos cards do Documentos Home ───────────────────
    window._vsQuandoDomPronto(() => {
        el('openContrato2')?.addEventListener('click', () => openDocumentosSection('documentosContrato'));
        el('openGarantia2')?.addEventListener('click', () => openDocumentosSection('documentosGarantia'));
        el('openRecibo2')?.addEventListener('click', () => openDocumentosSection('documentosRecibo'));
        el('openOrcamento2')?.addEventListener('click', () => openDocumentosSection('documentosOrcamento'));
    });

})();

