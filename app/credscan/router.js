// ================================================================
// credscan/router.js — VortexSmart · Router do CredScan
// Duas telas: lista (padrão) e detalhe de uma análise concluída.
// Expõe via window.*:
//   openCredscanSection
// Depende de (via window.*):
//   showMainSection, _vsNavegarParaHub,
//   _renderCredscanLista (credscan/lista.js),
//   _renderCredscanDetalhe (credscan/detalhe.js)
// ================================================================
(function () {
    'use strict';

    const el = id => document.getElementById(id);

    function openCredscanSection(sectionId, contexto) {
        if (typeof window.showMainSection === 'function') window.showMainSection('credscan');
        const ehHubDoModulo = !sectionId || sectionId === 'credscanLista';
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openCredscanSection', [sectionId, contexto], ehHubDoModulo);

        const telaLista = el('credscanLista'), telaDetalhe = el('credscanDetalhe');
        if (sectionId === 'credscanDetalhe' && contexto && contexto.itemId) {
            if (telaLista) telaLista.style.display = 'none';
            if (telaDetalhe) telaDetalhe.style.display = 'flex';
            if (typeof window._renderCredscanDetalhe === 'function') window._renderCredscanDetalhe(contexto.itemId);
            return;
        }
        if (telaDetalhe) telaDetalhe.style.display = 'none';
        if (telaLista) telaLista.style.display = 'flex';
        if (typeof window._renderCredscanLista === 'function') window._renderCredscanLista();
    }
    window.openCredscanSection = openCredscanSection;
})();
