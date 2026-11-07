// ================================================================
// financeiro/router.js — VortexSmart · Router do módulo Financeiro
// Expõe via window.*:
//   openFinanceiroSection(sectionId, contexto?, substituir?)
// Depende de (via window.*):
//   showMainSection, _vsNavegarParaHub (core.js)
//   _renderFinanceiroLancamentos (financeiro/lancamentos.js)
//   _renderFinanceiroRecorrentes (financeiro/recorrentes.js)
//   _renderFinanceiroGraficos    (financeiro/graficos.js)
//   _renderFinanceiroResumo      (financeiro/resumo.js)
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

    const SUBS = ['financeiroHome', 'financeiroLancamentos', 'financeiroRecorrentes', 'financeiroGraficos', 'financeiroResumo'];
    window._financeiroContexto = null;

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
        // Ver window._vsNavegarParaHub em core.js pro raciocínio completo.
        const ehHubDoModulo = sectionId === 'financeiroHome' || !sectionId;
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openFinanceiroSection', [sectionId, contexto], ehHubDoModulo, substituir);
        if (!sectionId || !document.getElementById(sectionId)) sectionId = 'financeiroHome';
        window._financeiroContexto = contexto || null;
        SUBS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const el = document.getElementById(sectionId);
        if (el) el.style.display = 'flex';

        if (sectionId === 'financeiroHome') renderFinanceiroHome();
        if (sectionId === 'financeiroLancamentos' && typeof window._renderFinanceiroLancamentos === 'function') {
            window._renderFinanceiroLancamentos();
        }
        if (sectionId === 'financeiroRecorrentes' && typeof window._renderFinanceiroRecorrentes === 'function') {
            window._renderFinanceiroRecorrentes();
        }
        if (sectionId === 'financeiroGraficos' && typeof window._renderFinanceiroGraficos === 'function') {
            window._renderFinanceiroGraficos();
        }
        if (sectionId === 'financeiroResumo' && typeof window._renderFinanceiroResumo === 'function') {
            window._renderFinanceiroResumo();
        }
    }
    window.openFinanceiroSection = openFinanceiroSection;

    // Hub do módulo — 4 cards (Lançamentos / Recorrentes / Gráficos / Resumo),
    // mesmo componente visual (.card-v2) que Vendas e Documentos já
    // usam nos próprios hubs.
    let hubMontado = false;
    function renderFinanceiroHome() {
        const wrap = document.getElementById('financeiroHome');
        if (!wrap || hubMontado) return;
        wrap.className = 'container text-center';
        wrap.innerHTML = `
            <div class="hub-back-row"><button type="button" class="btn-back" aria-label="Voltar ao Início"><i class="bi bi-arrow-left"></i></button></div>
            <h2 class="hub-title">Financeiro,<br/>o que você quer fazer?</h2>
            <div class="ctw-card-grid">
                <button class="card-v2" id="openFinLancamentos2">
                    <div class="stripe" style="--grad:linear-gradient(90deg,#4ade80,#16a34a);"></div>
                    <div class="body">
                        <div class="icon-v2" style="--grad:linear-gradient(135deg,#4ade80,#16a34a);--shadow:rgba(22,163,74,.4);color:#fff;">💰</div>
                        <div class="txt-v2">
                            <div class="name-v2">Lançamentos</div>
                            <div class="desc-v2">Registra e consulta receitas e despesas por período</div>
                            <div class="tag-v2" style="--tagbg:#dcfce7;--tagcolor:#16a34a;">Ver e lançar</div>
                        </div>
                    </div>
                </button>
                <button class="card-v2" id="openFinRecorrentes2">
                    <div class="stripe" style="--grad:linear-gradient(90deg,#fbbf24,#c2410c);"></div>
                    <div class="body">
                        <div class="icon-v2" style="--grad:linear-gradient(135deg,#fbbf24,#c2410c);--shadow:rgba(194,65,12,.4);color:#fff;">🔁</div>
                        <div class="txt-v2">
                            <div class="name-v2">Recorrentes</div>
                            <div class="desc-v2">Contas fixas mensais, como aluguel e assinaturas</div>
                            <div class="tag-v2" style="--tagbg:#fef3c7;--tagcolor:#c2410c;">Aluguel, etc</div>
                        </div>
                    </div>
                </button>
                <button class="card-v2" id="openFinGraficos2">
                    <div class="stripe" style="--grad:linear-gradient(90deg,#a78bfa,#5b3df5);"></div>
                    <div class="body">
                        <div class="icon-v2" style="--grad:linear-gradient(135deg,#a78bfa,#5b3df5);--shadow:rgba(91,61,245,.4);color:#fff;">📊</div>
                        <div class="txt-v2">
                            <div class="name-v2">Gráficos</div>
                            <div class="desc-v2">Saldo de caixa, fluxo e despesas por categoria</div>
                            <div class="tag-v2" style="--tagbg:#ede9fe;--tagcolor:#5b3df5;">Caixa e análise</div>
                        </div>
                    </div>
                </button>
                <button class="card-v2" id="openFinResumo2">
                    <div class="stripe" style="--grad:linear-gradient(90deg,#5eead4,#0891b2);"></div>
                    <div class="body">
                        <div class="icon-v2" style="--grad:linear-gradient(135deg,#5eead4,#0891b2);--shadow:rgba(8,145,178,.4);color:#fff;">🧾</div>
                        <div class="txt-v2">
                            <div class="name-v2">Resumo do período</div>
                            <div class="desc-v2">Tudo de um dia, semana ou mês: o que entrou, o que saiu e pra onde foi a grana</div>
                            <div class="tag-v2" style="--tagbg:#cffafe;--tagcolor:#0891b2;">Visão completa</div>
                        </div>
                    </div>
                </button>
            </div>
        `;
        document.getElementById('openFinLancamentos2')?.addEventListener('click', () => openFinanceiroSection('financeiroLancamentos'));
        document.getElementById('openFinRecorrentes2')?.addEventListener('click', () => openFinanceiroSection('financeiroRecorrentes'));
        document.getElementById('openFinGraficos2')?.addEventListener('click', () => openFinanceiroSection('financeiroGraficos'));
        document.getElementById('openFinResumo2')?.addEventListener('click', () => openFinanceiroSection('financeiroResumo'));
        hubMontado = true;
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('goToFinanceiro')?.addEventListener('click', () => openFinanceiroSection('financeiroHome'));
    });
})();
