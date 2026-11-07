// ================================================================
// venda/router.js — VortexSmart · Router do módulo Venda
// Expõe via window.*:
//   openVendaSection(sectionId, contexto?)
//   window._vendaContexto — { vendaId } setado antes de navegar pra
//   lancarVenda (editar pendente) ou fecharVenda (fechar pendente)
// Depende de (via window.*):
//   _renderLancarVenda      (venda/lancar.js)
//   _renderHistoricoVendas  (venda/historico.js)
//   _renderFecharVenda      (venda/fechar.js)
//   _renderRelatoriosVendas (venda/relatorios.js)
// ================================================================
(function () {
    'use strict';

    const SUBS = ['vendaHome', 'lancarVenda', 'historicoVendas', 'vendaFechar', 'vendaRelatorios'];
    window._vendaContexto = null;

    function openVendaSection(sectionId, contexto, substituir) {
        if (typeof window.showMainSection === 'function') window.showMainSection('venda');
        // Ver window._vsNavegarParaHub em core.js pro raciocínio completo:
        // entrar no vendaHome (hub do módulo) troca o topo da pilha só
        // quando o usuário já está dentro do módulo — nunca na primeira
        // entrada vinda do Início (preserva a guarda de saída vsExitGuard).
        const ehHubDoModulo = sectionId === 'vendaHome' || !sectionId;
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openVendaSection', [sectionId, contexto], ehHubDoModulo, substituir);
        // Relatórios respeita a permissão granular 'relatorios' — igual
        // ao padrão já usado em configuracoes/router.js. Antes disso era
        // um bloqueio fixo (Fase 0, sem checar permissão nenhuma) que
        // ignorava completamente o toggle em Config → Usuários — por
        // isso ligar a permissão não tinha efeito nenhum.
        if (sectionId === 'vendaRelatorios') {
            const podeRelatorios = typeof window._temPermissao === 'function' ? window._temPermissao('relatorios') : true;
            if (!podeRelatorios) {
                if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Você não tem permissão pra acessar Relatórios.' });
                sectionId = 'vendaHome';
            }
        }
        if (!sectionId || !document.getElementById(sectionId)) sectionId = 'vendaHome';
        window._vendaContexto = contexto || null;
        SUBS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const el = document.getElementById(sectionId);
        if (el) el.style.display = 'flex';

        if (sectionId === 'lancarVenda' && typeof window._renderLancarVenda === 'function') {
            window._renderLancarVenda();
        }
        if (sectionId === 'historicoVendas' && typeof window._renderHistoricoVendas === 'function') {
            window._renderHistoricoVendas();
        }
        if (sectionId === 'vendaFechar' && typeof window._renderFecharVenda === 'function') {
            window._renderFecharVenda();
        }
        if (sectionId === 'vendaRelatorios' && typeof window._renderRelatoriosVendas === 'function') {
            window._renderRelatoriosVendas();
        }
    }
    window.openVendaSection = openVendaSection;

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('openLancarVenda2')?.addEventListener('click', () => openVendaSection('lancarVenda'));
        document.getElementById('openHistoricoVendas2')?.addEventListener('click', () => openVendaSection('historicoVendas'));
        document.getElementById('openRelatoriosVendas2')?.addEventListener('click', () => openVendaSection('vendaRelatorios'));
    });
})();
