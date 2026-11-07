// ================================================================
// financeiro/router.js — VortexSmart · Router do módulo Financeiro
// Expõe via window.*:
//   openFinanceiroSection(sectionId, contexto?, substituir?)  — sem sectionId abre Movimentações
// Depende de (via window.*):
//   showMainSection, _vsNavegarParaHub (core.js)
//   _renderFinanceiroLancamentos (financeiro/lancamentos.js)  — aba Movimentações
//   _renderFinanceiroGraficos    (financeiro/graficos.js)     — aba Gráficos
//   _renderFinanceiroRecorrentes (financeiro/recorrentes.js)  — contas fixas (gerenciar)
// Expõe também: _finAbasHtml(ativa) / _finLigarAbas(raiz, ativa) — as 2 abas do topo.
//
// ⚠️ DEPLOY PENDENTE (só dá pra fazer pelo PC, não pelo Termux):
//   1. Regra do RTDB — dado mora em financeiro/{lojaId}/... (node RAIZ
//      próprio, fora de lojas/{lojaId} de propósito — mesmo raciocínio
//      do reparosSenhas: dentro de lojas/{lojaId} não dava pra deixar
//      ilegível pra Funcionário, porque o .read amplo de lojas/$lojaId
//      já libera geral, e regra filha não restringe regra pai mais
//      permissiva no Realtime Database). Adicionar ISSO como bloco
//      irmão de "reparosSenhas" em firebase-rules-saas.json (fora de
//      "lojas", no nível raiz das regras):
//        "financeiro": {
//          "$lojaId": {
//            ".read":  "auth != null && root.child('usuarios').child(auth.uid).child('lojaId').val() === $lojaId && root.child('usuarios').child(auth.uid).child('papel').val() === 'gestor'",
//            ".write": "auth != null && root.child('usuarios').child(auth.uid).child('lojaId').val() === $lojaId && root.child('usuarios').child(auth.uid).child('papel').val() === 'gestor'"
//          }
//        }
//      Código já usa window._financeiroRef (core.js) apontando pra
//      esse node raiz — não precisa mexer em mais nada além da regra.
//   2. Cloud Function de aviso de recorrente vencendo — ver o
//      comentário no topo de financeiro/recorrentes.js.
// ================================================================
(function () {
    'use strict';

    // O Financeiro tem 2 áreas, lado a lado em abas: Movimentações (lançar, consultar e o painel do
    // dinheiro, com o seletor Dia/Semana/Mês/Personalizado) e Gráficos. "financeiroRecorrentes" não é
    // uma área: é a tela de gerenciar as contas fixas, aberta de dentro de Movimentações.
    const SUBS = ['financeiroLancamentos', 'financeiroGraficos', 'financeiroRecorrentes'];
    const ABAS = [
        { id: 'financeiroLancamentos', nome: 'Movimentações' },
        { id: 'financeiroGraficos', nome: 'Gráficos' }
    ];
    window._financeiroContexto = null;

    // Abas do topo, desenhadas por cada área (o texto muda de lugar no PC e no celular só pelo CSS).
    window._finAbasHtml = function (ativa) {
        return `<div class="fl-abas" role="tablist">${ABAS.map(a =>
            `<button type="button" role="tab" class="${a.id === ativa ? 'on' : ''}" aria-selected="${a.id === ativa ? 'true' : 'false'}" data-fin-aba="${a.id}">${a.nome}</button>`
        ).join('')}</div>`;
    };
    window._finLigarAbas = function (raiz, ativa) {
        raiz.querySelectorAll('[data-fin-aba]').forEach(btn => btn.addEventListener('click', () => {
            // substituir=true: trocar de aba não empilha histórico (o voltar sai do Financeiro).
            if (btn.dataset.finAba !== ativa) openFinanceiroSection(btn.dataset.finAba, null, true);
        }));
    };

    function openFinanceiroSection(sectionId, contexto, substituir) {
        // Defesa extra (a UI já esconde o card pro Funcionário, ver
        // aplicarVisibilidadePorPapel em core.js) — se por algum
        // caminho alguém tentar entrar aqui sem ser Gestor, barra e
        // manda pro Início. A proteção de verdade é a regra do RTDB
        // (ver nota de deploy no topo do arquivo), isso aqui é só mais
        // uma camada.
        if (window._papelUsuario !== 'gestor') {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Financeiro é exclusivo do Gestor.' });
            if (typeof window.showMainSection === 'function') window.showMainSection('main');
            return;
        }

        if (typeof window.showMainSection === 'function') window.showMainSection('financeiro');
        // Sincroniza venda/reposição antiga assim que o módulo abre,
        // não importa qual tela — antes só disparava entrando em
        // Lançamentos, e quem abria Gráficos primeiro via número
        // desatualizado até visitar Lançamentos por acaso. A função já
        // se protege contra rodar mais de uma vez por sessão.
        if (typeof window._financeiroSincronizarAntigos === 'function') window._financeiroSincronizarAntigos();
        // Nome antigo ou desconhecido (menu, Resumo do período) cai em Movimentações.
        if (!SUBS.includes(sectionId) || !document.getElementById(sectionId)) sectionId = 'financeiroLancamentos';
        // As duas áreas são o "início" do módulo; a tela de contas fixas é um passo dentro dele.
        const ehHubDoModulo = sectionId !== 'financeiroRecorrentes';
        // Ver window._vsNavegarParaHub em core.js pro raciocínio completo.
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openFinanceiroSection', [sectionId, contexto], ehHubDoModulo, substituir);
        window._financeiroContexto = contexto || null;
        SUBS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const el = document.getElementById(sectionId);
        if (el) el.style.display = 'flex';

        if (sectionId === 'financeiroLancamentos' && typeof window._renderFinanceiroLancamentos === 'function') {
            window._renderFinanceiroLancamentos();
        }
        if (sectionId === 'financeiroRecorrentes' && typeof window._renderFinanceiroRecorrentes === 'function') {
            window._renderFinanceiroRecorrentes();
        }
        if (sectionId === 'financeiroGraficos' && typeof window._renderFinanceiroGraficos === 'function') {
            window._renderFinanceiroGraficos();
        }
    }
    window.openFinanceiroSection = openFinanceiroSection;

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('goToFinanceiro')?.addEventListener('click', () => openFinanceiroSection('financeiroLancamentos'));
    });
})();
