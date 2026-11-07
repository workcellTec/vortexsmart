// ================================================================
// reposicao/router.js — VortexSmart · Router do módulo Reposição
// Expõe via window.*:
//   openReposicaoSection
// Depende de (via window.*):
//   showMainSection, _vsNavegarParaHub (core.js),
//   _renderReposicaoLista (reposicao/lista.js)
//
// Só tem UMA tela (reposicaoLista) — diferente de Concertos/Estoque,
// que têm sub-telas, aqui a lista com o modal de novo/editar item já
// resolve tudo, não precisa de um "form" separado.
// ================================================================
(function () {
    'use strict';

    function openReposicaoSection() {
        if (typeof window.showMainSection === 'function') window.showMainSection('reposicao');
        // Ver window._vsNavegarParaHub em core.js pro raciocínio completo
        // — sempre true aqui porque só existe essa única tela (é sempre
        // o "hub" do próprio módulo, nunca uma sub-tela dentro dele).
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openReposicaoSection', [], true);
        if (typeof window._renderReposicaoLista === 'function') window._renderReposicaoLista();
    }
    window.openReposicaoSection = openReposicaoSection;
})();
