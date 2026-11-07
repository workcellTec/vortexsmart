// ================================================================
// acesso-loja.js — VortexSmart · Acesso suspenso (loja bloqueada)
// O bloqueio de verdade é feito no SERVIDOR (regras do Realtime
// Database e do Storage negam tudo da loja bloqueada, via
// acessoLojas/{lojaId}.bloqueada — gravado só pelas Cloud Functions
// adminSuspenderLoja / adminReativarLoja, chamadas pelo painel de
// controle). Este módulo só cuida da EXPERIÊNCIA no app: descobre o
// bloqueio ao entrar, vigia em tempo real e mostra a tela "Acesso
// suspenso" com o motivo, em vez de um app vazio cheio de erro de
// permissão. Como a trava real está no servidor, uma cópia velha do
// app (ex: .exe desatualizado) também fica sem acesso aos dados.
//
// Ao ser liberado (pagamento regularizado), o app recarrega sozinho.
//
// Depende de (via window.*):
//   _lojaId, _firebaseDB, _firebaseRef, _dbGet, _dbOnValue (core.js)
//   _fazerLogout (core.js) — botão "Sair da conta"
// Expõe via window.*:
//   _verificarAcessoLoja()  → Promise<boolean> (true = suspensa;
//                             nunca rejeita: sem rede/permissão = false,
//                             pois quem barra de verdade é o servidor)
//   _pararVigiaAcesso()     → chamada no logout / tela de login
//   _vsRecarregarApp        → (opcional) sobrescreve o reload da página
// ================================================================
(function () {
    'use strict';

    const TELA_ID = 'acessoSuspensoScreen';
    // Mesma lista de telas que mostrarTelaLogin (core.js) esconde — nada
    // do app pode ficar utilizável (nem por tecla/pistola) por baixo.
    const TELAS_DO_APP = ['mainMenu', 'calculatorContainer', 'documentosContainer', 'estoqueContainer', 'vendaContainer', 'configuracoesContainer', 'reparosContainer', 'reposicaoContainer', 'financeiroContainer', 'fecharVenda'];

    let cancelarVigia = null;
    let suspensoAgora = false;

    const recarregarApp = () => (typeof window._vsRecarregarApp === 'function' ? window._vsRecarregarApp() : window.location.reload());

    function esconderApp() {
        const login = document.getElementById('loginScreen');
        if (login) login.style.display = 'none';
        // Navegação do app: barra lateral (computador) ou inferior (celular) — existe só uma delas por tela.
        ['vsSidebar', 'ctwBottomNav'].forEach(id => {
            const nav = document.getElementById(id);
            if (nav) nav.style.display = 'none';
        });
        ['profileSheetOverlay', 'notifDrawerOverlay', 'vsContaFolha', 'vsBarraFolha', 'vsMetaFolha'].forEach(id => document.getElementById(id)?.classList.remove('active'));
        TELAS_DO_APP.forEach(id => {
            const elem = document.getElementById(id);
            if (elem) { elem.style.display = 'none'; elem.classList.add('hidden'); }
        });
    }

    function mostrarTelaBloqueio(motivo) {
        suspensoAgora = true;
        esconderApp();
        let tela = document.getElementById(TELA_ID);
        if (!tela) {
            tela = document.createElement('div');
            tela.id = TELA_ID;
            tela.setAttribute('role', 'alert');
            tela.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100dvh;z-index:100000;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--bg,#07101f);overflow:auto;';
            tela.innerHTML = `
                <div style="width:100%;max-width:380px;text-align:center;">
                    <div style="width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#f87171,#dc2626);display:flex;align-items:center;justify-content:center;font-size:1.8rem;margin:0 auto 16px;">🔒</div>
                    <h2 style="margin:0 0 8px;">Acesso suspenso</h2>
                    <div class="text-secondary" style="margin-bottom:14px;">O acesso da sua loja ao VortexSmart está suspenso.</div>
                    <div id="acessoSuspensoMotivo" style="display:none;margin-bottom:14px;padding:12px 14px;border-radius:12px;background:rgba(248,113,113,.12);color:var(--danger,#f87171);font-weight:600;word-break:break-word;"></div>
                    <div class="text-secondary small" style="margin-bottom:22px;">Fale com o administrador para regularizar. Assim que o acesso for liberado, o app volta sozinho.</div>
                    <button type="button" class="btn btn-secondary w-100" id="acessoSuspensoSairBtn"><i class="bi bi-box-arrow-left"></i> Sair da conta</button>
                </div>`;
            document.body.appendChild(tela);
            document.getElementById('acessoSuspensoSairBtn').addEventListener('click', () => {
                if (typeof window._fazerLogout === 'function') window._fazerLogout();
            });
        }
        // textContent (nunca innerHTML): o motivo é texto livre digitado no painel.
        const motivoEl = document.getElementById('acessoSuspensoMotivo');
        motivoEl.textContent = motivo ? `Motivo: ${motivo}` : '';
        motivoEl.style.display = motivo ? 'block' : 'none';
    }

    // Vigia em tempo real: suspendeu com o app aberto → tela de
    // bloqueio na hora; liberou → recarrega o app inteiro (os
    // listeners de dados dele já tinham falhado por permissão).
    function iniciarVigia(refAcesso) {
        pararVigia();
        cancelarVigia = window._dbOnValue(refAcesso, snap => {
            const estado = snap.val() || {};
            if (estado.bloqueada === true) {
                mostrarTelaBloqueio(estado.motivo);
            } else if (suspensoAgora) {
                recarregarApp();
            }
        }, () => { /* sem permissão/rede: não trava o app — o servidor é quem barra */ });
    }

    function pararVigia() {
        if (typeof cancelarVigia === 'function') cancelarVigia();
        cancelarVigia = null;
    }

    window._verificarAcessoLoja = function () {
        const lojaId = window._lojaId;
        if (!lojaId || typeof window._dbGet !== 'function' || typeof window._firebaseRef !== 'function') {
            return Promise.resolve(false);
        }
        const refAcesso = window._firebaseRef(window._firebaseDB, `acessoLojas/${lojaId}`);
        return window._dbGet(refAcesso)
            .then(snap => {
                const estado = snap.val() || {};
                iniciarVigia(refAcesso);
                if (estado.bloqueada === true) {
                    mostrarTelaBloqueio(estado.motivo);
                    return true;
                }
                return false;
            })
            .catch(() => {
                iniciarVigia(refAcesso);
                return false;
            });
    };

    // Logout / tela de login: para de vigiar e tira a tela de bloqueio
    // (senão ela ficaria por cima do login de outra conta).
    window._pararVigiaAcesso = function () {
        pararVigia();
        suspensoAgora = false;
        document.getElementById(TELA_ID)?.remove();
    };
})();
