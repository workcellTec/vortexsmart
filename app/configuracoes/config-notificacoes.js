// ================================================================
// configuracoes/config-notificacoes.js — VortexSmart · Notificações
// Registra: window._initConfigNotificacoes()
//
// Acessível pelo menu de perfil (abaixo de Customizações) — igual
// Customizações, é uma preferência PESSOAL por usuário (cada um liga/
// desliga o que quiser), com uma seção extra visível só pro Gestor
// (estoque baixo, parcela vencendo, backup — decisões que dizem
// respeito à loja inteira, não a uma pessoa só).
//
// Onde cada coisa mora:
//   - Toggles pessoais + horário de "vendas em aberto":
//     usuarios/{uid}/preferencias/notificacoes/* (preferência de
//     cada um, mesma "gaveta" já usada por Customizações)
//   - Limite de "estoque baixo" (número, vale pra loja inteira):
//     lojas/{lojaId}/notificacoesConfig/estoqueLimiteBaixo
//   - Token do aparelho pra receber push:
//     usuarios/{uid}/fcmTokens/{token}
//
// Depende de (via window.*):
//   showCustomModal, _usuarioPrefRef, _lojaRef, _dbUpdate, _dbGet,
//   _ativarNotificacoes, _papelUsuario, _setBtnLoading
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const el    = id   => document.getElementById(id);

    let prefs = null;               // usuarios/{uid}/preferencias/notificacoes
    let estoqueLimiteBaixo = null;  // lojas/{lojaId}/notificacoesConfig/estoqueLimiteBaixo

    const DEFAULT_PREFS = {
        vendasAbertas: false,
        vendasAbertasHorario: '20:00',
        aniversarioCliente: false,
        estoqueBaixo: false,
        parcelaVencendo: false,
        lembreteBackup: false,
        reparoAtrasado: false,
        despesaRecorrente: false,
    };

    function renderShell() {
        const wrap = el('configuracoesNotificacoes');
        if (!wrap) return;
        const ehGestor = window._papelUsuario === 'gestor';

        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Notificações</h3>
            </div>
            <div class="content-card w-100">

                <div class="cz-item" id="notifAtivarWrap">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#4f8cff,#2563eb);">🔔</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title" id="notifAtivarTitulo">Ativar notificações nesse aparelho</div>
                        <div class="cz-item-sub" id="notifAtivarSub">Precisa autorizar uma vez pra receber qualquer aviso abaixo</div>
                    </div>
                    <button type="button" class="stq-modal-btn-save" id="notifAtivarBtn" style="white-space:nowrap;">Ativar</button>
                </div>

                <div class="cz-sec-title">📦 Vendas &amp; Clientes</div>

                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#818cf8,#6366f1);">🛒</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">Vendas em aberto</div>
                        <div class="cz-item-sub">Um aviso por dia com quantas vendas você tem em aberto, no horário que escolher</div>
                    </div>
                    <button type="button" class="ctx-switch" id="notifSwitchVendasAbertas" aria-label="Ligar/desligar"></button>
                </div>
                <div id="notifVendasAbertasHorarioWrap" class="mb-2" style="padding-left:56px;display:none;">
                    <label class="form-label small mb-1">Horário do aviso</label>
                    <input type="time" class="form-control" id="notifVendasAbertasHorario" style="max-width:160px;"/>
                </div>

                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#f472b6,#db2777);">🎂</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">Aniversário de clientes</div>
                        <div class="cz-item-sub">Avisa no dia, pra você (e o Gestor) — só funciona pra clientes cadastrados a partir de agora</div>
                    </div>
                    <button type="button" class="ctx-switch" id="notifSwitchAniversario" aria-label="Ligar/desligar"></button>
                </div>

                <div class="cz-sec-title">🔧 Concertos</div>

                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#f472b6,#be185d);">🔧</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">OS atrasada</div>
                        <div class="cz-item-sub">Avisa quando uma OS passar do prazo sem ser entregue</div>
                    </div>
                    <button type="button" class="ctx-switch" id="notifSwitchReparoAtrasado" aria-label="Ligar/desligar"></button>
                </div>

                ${ehGestor ? `
                <div class="cz-sec-title">👑 Só Gestor</div>

                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#fb923c,#c2410c);">📦</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">Estoque baixo ou zerado</div>
                        <div class="cz-item-sub">Vale pra loja inteira — dá pra silenciar produto específico dentro de Editar Produto</div>
                    </div>
                    <button type="button" class="ctx-switch" id="notifSwitchEstoqueBaixo" aria-label="Ligar/desligar"></button>
                </div>
                <div id="notifEstoqueLimiteWrap" class="mb-2" style="padding-left:56px;display:none;">
                    <label class="form-label small mb-1">Avisar quando a quantidade for ≤</label>
                    <input type="number" min="0" step="1" class="form-control" id="notifEstoqueLimite" style="max-width:120px;" placeholder="Ex: 2"/>
                </div>

                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#fbbf24,#d97706);">💳</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">Parcela vencendo ou atrasada</div>
                        <div class="cz-item-sub">Aviso diário com as parcelas do dia e atrasadas</div>
                    </div>
                    <button type="button" class="ctx-switch" id="notifSwitchParcela" aria-label="Ligar/desligar"></button>
                </div>

                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#a78bfa,#7c3aed);">💰</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">Despesa recorrente vencendo</div>
                        <div class="cz-item-sub">Avisa no dia (Aluguel, Funcionário, etc) — o lançamento continua manual, isso só avisa</div>
                    </div>
                    <button type="button" class="ctx-switch" id="notifSwitchDespesaRecorrente" aria-label="Ligar/desligar"></button>
                </div>

                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#34d399,#059669);">💾</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">Lembrete de backup</div>
                        <div class="cz-item-sub">Um aviso por semana lembrando de fazer o backup</div>
                    </div>
                    <button type="button" class="ctx-switch" id="notifSwitchBackup" aria-label="Ligar/desligar"></button>
                </div>
                ` : ''}

                <button type="button" class="btn btn-ok w-100 mt-3" id="notifSalvarBtn"><i class="bi bi-check-circle"></i> Salvar</button>
            </div>
        `;

        attachListeners(ehGestor);
    }

    function attachListeners(ehGestor) {
        el('notifAtivarBtn')?.addEventListener('click', ativarNotificacoes);

        const switches = ehGestor
            ? ['notifSwitchVendasAbertas', 'notifSwitchAniversario', 'notifSwitchReparoAtrasado', 'notifSwitchEstoqueBaixo', 'notifSwitchParcela', 'notifSwitchDespesaRecorrente', 'notifSwitchBackup']
            : ['notifSwitchVendasAbertas', 'notifSwitchAniversario', 'notifSwitchReparoAtrasado'];
        switches.forEach(id => {
            el(id)?.addEventListener('click', () => {
                el(id).classList.toggle('on');
                atualizarVisibilidadeCondicionais();
            });
        });

        el('notifSalvarBtn')?.addEventListener('click', salvar);
    }

    // Campos que só fazem sentido mostrar quando o toggle "pai" deles
    // está ligado (horário só importa se "vendas em aberto" tiver
    // ligado; limite só importa se "estoque baixo" tiver ligado).
    function atualizarVisibilidadeCondicionais() {
        const vendasOn  = el('notifSwitchVendasAbertas')?.classList.contains('on');
        const wrapHora  = el('notifVendasAbertasHorarioWrap');
        if (wrapHora) wrapHora.style.display = vendasOn ? 'block' : 'none';

        const estoqueOn = el('notifSwitchEstoqueBaixo')?.classList.contains('on');
        const wrapLimite = el('notifEstoqueLimiteWrap');
        if (wrapLimite) wrapLimite.style.display = estoqueOn ? 'block' : 'none';
    }

    function preencherComValorAtual() {
        const p = prefs || DEFAULT_PREFS;
        [
            ['notifSwitchVendasAbertas', p.vendasAbertas],
            ['notifSwitchAniversario', p.aniversarioCliente],
            ['notifSwitchReparoAtrasado', p.reparoAtrasado],
            ['notifSwitchEstoqueBaixo', p.estoqueBaixo],
            ['notifSwitchParcela', p.parcelaVencendo],
            ['notifSwitchDespesaRecorrente', p.despesaRecorrente],
            ['notifSwitchBackup', p.lembreteBackup],
        ].forEach(([id, ligado]) => {
            const btn = el(id);
            if (btn) btn.classList.toggle('on', !!ligado);
        });
        if (el('notifVendasAbertasHorario')) el('notifVendasAbertasHorario').value = p.vendasAbertasHorario || '20:00';
        if (el('notifEstoqueLimite')) el('notifEstoqueLimite').value = (estoqueLimiteBaixo != null) ? estoqueLimiteBaixo : 2;
        atualizarVisibilidadeCondicionais();
        atualizarStatusPermissao();
    }

    function atualizarStatusPermissao() {
        const titulo = el('notifAtivarTitulo');
        const sub = el('notifAtivarSub');
        const btn = el('notifAtivarBtn');
        if (!titulo || !btn) return;
        if (typeof Notification === 'undefined') {
            titulo.textContent = 'Notificações não suportadas nesse navegador';
            btn.style.display = 'none';
            return;
        }
        if (Notification.permission === 'granted') {
            titulo.textContent = 'Notificações ativadas neste aparelho ✓';
            sub.textContent = 'Os avisos que você ligar abaixo vão chegar aqui';
            btn.textContent = 'Reativar';
        } else {
            titulo.textContent = 'Ativar notificações nesse aparelho';
            sub.textContent = 'Precisa autorizar uma vez pra receber qualquer aviso abaixo';
            btn.textContent = 'Ativar';
        }
    }

    function ativarNotificacoes() {
        const btn = el('notifAtivarBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Ativando...');
        Promise.resolve(window._ativarNotificacoes ? window._ativarNotificacoes() : { ok: false, motivo: 'Indisponível.' })
            .then(resultado => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                if (resultado.ok) {
                    modal({ message: 'Notificações ativadas nesse aparelho!' });
                } else {
                    modal({ message: `Não foi possível ativar: ${resultado.motivo}` });
                }
                atualizarStatusPermissao();
            });
    }

    function carregarDados() {
        const ehGestor = window._papelUsuario === 'gestor';
        const buscas = [
            window._dbGet(window._usuarioPrefRef('notificacoes')).then(snap => { prefs = snap.val() || {}; }).catch(() => { prefs = {}; }),
        ];
        if (ehGestor) {
            buscas.push(
                window._dbGet(window._lojaRef('notificacoesConfig/estoqueLimiteBaixo')).then(snap => { estoqueLimiteBaixo = snap.val(); }).catch(() => { estoqueLimiteBaixo = null; })
            );
        }
        return Promise.all(buscas);
    }

    function salvar() {
        const ehGestor = window._papelUsuario === 'gestor';
        const btn = el('notifSalvarBtn');

        const novasPrefs = {
            vendasAbertas: !!el('notifSwitchVendasAbertas')?.classList.contains('on'),
            vendasAbertasHorario: el('notifVendasAbertasHorario')?.value || '20:00',
            aniversarioCliente: !!el('notifSwitchAniversario')?.classList.contains('on'),
            reparoAtrasado: !!el('notifSwitchReparoAtrasado')?.classList.contains('on'),
        };
        if (ehGestor) {
            novasPrefs.estoqueBaixo = !!el('notifSwitchEstoqueBaixo')?.classList.contains('on');
            novasPrefs.parcelaVencendo = !!el('notifSwitchParcela')?.classList.contains('on');
            novasPrefs.despesaRecorrente = !!el('notifSwitchDespesaRecorrente')?.classList.contains('on');
            novasPrefs.lembreteBackup = !!el('notifSwitchBackup')?.classList.contains('on');
        }

        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');

        const salvamentos = [window._dbUpdate(window._usuarioPrefRef('notificacoes'), novasPrefs)];
        if (ehGestor) {
            const limiteRaw = el('notifEstoqueLimite')?.value;
            const limite = (limiteRaw !== '' && limiteRaw != null && !isNaN(parseInt(limiteRaw, 10))) ? parseInt(limiteRaw, 10) : 2;
            salvamentos.push(window._dbUpdate(window._lojaRef('notificacoesConfig'), { estoqueLimiteBaixo: limite }));
        }

        Promise.all(salvamentos)
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                prefs = { ...prefs, ...novasPrefs };
                modal({ message: 'Salvo!' });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
    }

    // ── Entrada pública ──────────────────────────────────────────
    // Sempre remonta o HTML do zero (não só na primeira vez) — o
    // papel (Gestor/Funcionário) não muda durante o uso do app, mas
    // remontar é barato aqui e garante que a seção "Só Gestor"
    // sempre reflete certo, sem depender de um HTML antigo já na tela.
    window._initConfigNotificacoes = function () {
        renderShell();
        carregarDados().then(preencherComValorAtual);
    };
})();
