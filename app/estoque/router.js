// ================================================================
// estoque/router.js — VortexSmart · Router do módulo Estoque
// Expõe via window.*:
//   openEstoqueSection
// Depende de (via window.*):
//   showMainSection,
//   _renderEstoqueProdutos      (estoque/produtos.js)
//   _renderEstoqueConferencia   (estoque/conferencia.js)
//   _renderEstoqueMovimentacao  (estoque/movimentacao.js)
// ================================================================
(function () {
    'use strict';

    const SUBS = ['estoqueHome', 'estoqueProdutos', 'estoqueConferencia', 'estoqueMovimentacao'];

    function openEstoqueSection(sectionId, contexto, substituir) {
        // Movimentação de Produto é exclusiva do Gestor — mesmo padrão de
        // Usuários e Permissões (ver configuracoes/router.js): o card já
        // vem escondido pra Funcionário, isso aqui é a segunda trava,
        // caso alguém force a navegação por outro caminho.
        const ehGestor = window._papelUsuario === 'gestor';
        if (sectionId === 'estoqueMovimentacao' && !ehGestor) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Movimentação de Produto é uma área exclusiva do Gestor.' });
            return;
        }

        if (typeof window.showMainSection === 'function') window.showMainSection('estoque');
        // Ver window._vsNavegarParaHub em core.js pro raciocínio completo.
        const ehHubDoModulo = sectionId === 'estoqueHome' || !sectionId;
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openEstoqueSection', [sectionId], ehHubDoModulo, substituir);
        if (!sectionId || !document.getElementById(sectionId)) sectionId = 'estoqueHome';
        SUBS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const el = document.getElementById(sectionId);
        if (el) el.style.display = 'flex';

        if (sectionId === 'estoqueProdutos' && typeof window._renderEstoqueProdutos === 'function') {
            window._renderEstoqueProdutos();
            // Veio de um atalho (ex: notificação de estoque baixo) pedindo
            // pra abrir direto num produto específico já em edição.
            if (contexto && contexto.produtoId && typeof window._abrirEdicaoProdutoPorId === 'function') {
                window._abrirEdicaoProdutoPorId(contexto.produtoId);
            }
        }
        if (sectionId === 'estoqueConferencia' && typeof window._renderEstoqueConferencia === 'function') {
            window._renderEstoqueConferencia();
        }
        if (sectionId === 'estoqueMovimentacao' && typeof window._renderEstoqueMovimentacao === 'function') {
            window._renderEstoqueMovimentacao();
        }
    }
    window.openEstoqueSection = openEstoqueSection;

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('openEstoqueProdutos2')?.addEventListener('click', () => openEstoqueSection('estoqueProdutos'));
        document.getElementById('openEstoqueConferencia2')?.addEventListener('click', () => openEstoqueSection('estoqueConferencia'));
        document.getElementById('openEstoqueMovimentacao2')?.addEventListener('click', () => openEstoqueSection('estoqueMovimentacao'));
    });
})();
