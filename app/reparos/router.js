// ================================================================
// reparos/router.js — VortexSmart · Router do módulo Concertos
// Expõe via window.*:
//   openReparosSection
// Depende de (via window.*):
//   showMainSection, _reparosConfig (core.js — carregado por
//   loadReparosConfig), _renderReparosLista (reparos/lista.js),
//   _renderReparosForm (reparos/form.js)
// ================================================================
(function () {
    'use strict';

    const SUBS = ['reparosLista', 'reparosForm'];

    function openReparosSection(sectionId, contexto, substituir) {
        // Defesa extra: se por algum caminho alguém tentar entrar aqui
        // sem o modo configurado (própria/terceirizada), manda pra
        // Configurações em vez de mostrar uma lista sem fluxo definido.
        // O menu principal já evita isso (ver goToReparos em core.js),
        // isso aqui é só o "cinto de segurança" caso outro código chame
        // openReparosSection direto no futuro.
        const modo = (window._reparosConfig || {}).modo || null;
        if (!modo) {
            if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesReparos');
            return;
        }

        if (typeof window.showMainSection === 'function') window.showMainSection('reparos');
        // Ver window._vsNavegarParaHub em core.js pro raciocínio completo.
        const ehHubDoModulo = sectionId === 'reparosLista' || !sectionId;
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openReparosSection', [sectionId], ehHubDoModulo, substituir);
        if (!sectionId || !document.getElementById(sectionId)) sectionId = 'reparosLista';
        SUBS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const el = document.getElementById(sectionId);
        if (el) el.style.display = 'flex';
        // Celular: o botão do meio da barra vira "Novo concerto" só dentro da lista.
        if (typeof window._vsBarraCentro === 'function') window._vsBarraCentro();

        if (sectionId === 'reparosLista' && typeof window._renderReparosLista === 'function') {
            // Entrar na lista = cards fechados; só continua aberto ao voltar de uma folha/formulário ou vindo de "Ver OS".
            if (!window._vsNavRestoring && !(contexto && contexto.focarId)) window._reparosRecolherCards?.();
            window._renderReparosLista(contexto);
        }
        if (sectionId === 'reparosForm' && typeof window._renderReparosForm === 'function') {
            // contexto.repairId presente = editando uma OS existente;
            // ausente = formulário de cadastro novo.
            window._renderReparosForm(contexto && contexto.repairId ? contexto.repairId : null);
        }
    }
    window.openReparosSection = openReparosSection;
})();
