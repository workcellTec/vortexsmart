// ================================================================
// configuracoes/config-reparos.js — VortexSmart · Config → Concertos
// Só o Gestor acessa essa tela (trava em configuracoes/router.js,
// igual Usuários e Permissões — não depende só da permissão geral
// 'configuracoes').
//
// Node: /lojas/{lojaId}/configuracoes/reparos = { modo:
//   'propria' | 'terceirizada' | null }. Enquanto for null, a aba de
// Concertos fica travada no menu (ver aplicarVisibilidadePorPapel,
// core.js). Troca de modo é BLOQUEADA se existir qualquer OS que
// ainda não chegou em "entregue" — pra não deixar OS órfã presa num
// fluxo que deixou de existir.
//
// Depende de (via window.*):
//   showCustomModal, _lojaRef, _dbGet, _dbUpdate, _setBtnLoading,
//   _REPAROS_FLOWS (reparos/lista.js, só pros textos de resumo do fluxo)
// Expõe via window.*:
//   _initConfigReparos
// ================================================================
(function () {
    'use strict';

    const el = id => document.getElementById(id);
    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);

    let mounted = false;
    let modoAtual = null;

    function ensureSkeleton() {
        const container = el('configuracoesReparos');
        if (!container || mounted) return;
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Concertos</h3>
                <div style="width:36px;"></div>
            </div>
            <div class="content-card w-100" style="max-width:400px;">
                <p style="font-size:.74rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">
                    Como funciona o conserto na sua loja? Isso define o fluxo de etapas que a equipe vai ver na aba Concertos.
                </p>
                <div class="rep-modo-toggle" id="crModoToggle">
                    <button type="button" class="rep-modo-card" id="crModoPropria" data-modo="propria">
                        <span class="ic"><i class="bi bi-house-gear-fill"></i></span>
                        <span>
                            <span class="t">A loja mesma conserta</span>
                            <span class="s">Fluxo: Na Fila → Em Reparo → Finalizado → Entregue. ("Aguardando Peça" fica disponível como opção manual, pra quando falta peça.)</span>
                        </span>
                    </button>
                    <button type="button" class="rep-modo-card" id="crModoTerceirizada" data-modo="terceirizada">
                        <span class="ic"><i class="bi bi-truck"></i></span>
                        <span>
                            <span class="t">Terceirizo pra um técnico</span>
                            <span class="s">Fluxo: Levar ao Técnico → Em Reparo → Finalizado na Loja → Entregue. (Mesma opção manual de "Aguardando Peça" disponível aqui também.)</span>
                        </span>
                    </button>
                </div>
                <div class="rep-lock-warn" id="crLockWarn" style="display:none;"></div>

                <div class="rep-panel-sec-title" style="margin-top:20px;"><i class="bi bi-bell-fill"></i>Aviso de prazo</div>
                <p style="font-size:.72rem;color:var(--text-secondary);margin-bottom:10px;line-height:1.55;">
                    Avisa a equipe quando uma OS estiver perto do prazo de entrega (só as que tiverem prazo marcado).
                </p>
                <div class="rep-form-group">
                    <label class="form-label">Avisar quantas horas antes?</label>
                    <input class="form-control" id="crAvisoHoras" type="number" min="0" placeholder="Ex: 24"/>
                    <p style="font-size:.62rem;color:var(--text-muted);margin-top:4px;">Deixe em branco pra desligar o aviso.</p>
                </div>
                <button type="button" class="rep-btn-next" id="crSalvarAviso" style="width:100%;">Salvar aviso de prazo</button>
            </div>
        `;
        el('crModoPropria').addEventListener('click', () => tentarMudarModo('propria'));
        el('crModoTerceirizada').addEventListener('click', () => tentarMudarModo('terceirizada'));
        el('crSalvarAviso').addEventListener('click', salvarAvisoPrazo);
        mounted = true;
    }

    function pintarSelecao() {
        el('crModoPropria').classList.toggle('selected', modoAtual === 'propria');
        el('crModoTerceirizada').classList.toggle('selected', modoAtual === 'terceirizada');
    }

    function existemOSEmAberto() {
        return window._dbGet(window._lojaRef('reparos')).then(snap => {
            const dados = snap.val() || {};
            return Object.values(dados).some(os => os.status !== 'entregue');
        });
    }

    function tentarMudarModo(novoModo) {
        if (novoModo === modoAtual) return;
        const warn = el('crLockWarn');
        warn.style.display = 'none';

        existemOSEmAberto().then(temAberta => {
            if (temAberta) {
                warn.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i><span>Não dá pra mudar o modo agora — existem OS em aberto. Finalize (marque como "Entregue") todas as ordens de serviço antes de trocar entre "Própria" e "Terceirizada".</span>`;
                warn.style.display = 'flex';
                return;
            }
            window._dbUpdate(window._lojaRef('configuracoes/reparos'), { modo: novoModo }).then(() => {
                modoAtual = novoModo;
                pintarSelecao();
                modal({ message: 'Modo de conserto atualizado! A aba Concertos já reflete o novo fluxo.' });
            }).catch(e => {
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
        }).catch(e => {
            modal({ message: `Erro ao conferir OS em aberto: ${e.message}` });
        });
    }

    function salvarAvisoPrazo() {
        const raw = el('crAvisoHoras').value.trim();
        const horas = raw ? parseInt(raw, 10) : null;
        if (raw && (isNaN(horas) || horas < 0)) {
            modal({ message: 'Digite um número de horas válido (ou deixe em branco pra desligar).' });
            return;
        }
        const btn = el('crSalvarAviso');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        window._dbUpdate(window._lojaRef('configuracoes/reparos'), { avisoPrazoHoras: horas }).then(() => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            modal({ message: horas ? `Aviso ligado — a equipe é avisada ${horas}h antes do prazo.` : 'Aviso de prazo desligado.' });
        }).catch(e => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            modal({ message: `Erro ao salvar: ${e.message}` });
        });
    }

    // ── Entrada pública ──────────────────────────────────────────
    window._initConfigReparos = function () {
        ensureSkeleton();
        modoAtual = (window._reparosConfig || {}).modo || null;
        pintarSelecao();
        el('crLockWarn').style.display = 'none';
        const avisoAtual = (window._reparosConfig || {}).avisoPrazoHoras;
        el('crAvisoHoras').value = avisoAtual != null ? avisoAtual : '';
    };
})();
