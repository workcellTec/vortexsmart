// ================================================================
// configuracoes/config-credscan.js — VortexSmart · Config → CredScan
//
// A chave da OpenRouter é escrita em credscanChaves/{lojaId} — um nó
// na RAIZ do banco, fora de lojas/{lojaId}/... de propósito. Regra
// filha não revoga regra pai mais permissiva no Realtime Database, e
// lojas/{lojaId} já libera leitura pra qualquer membro — então um
// .read:false dentro dessa árvore nunca protegeria nada de verdade.
// Mesmo padrão de financeiro/reparosSenhas (ver window._financeiroRef
// em core.js). Só a Cloud Function credscanProcessar (Admin SDK,
// ignora regras) consegue ler essa chave.
// O status "habilitado" fica em lojas/{lojaId}/info (campo
// credscanHabilitado), legível normalmente — é isso que a tela usa
// pra saber o que mostrar, nunca a chave em si. "Regras extras" da
// análise (texto livre, não é segredo) continua em
// lojas/{lojaId}/credscan/config/regrasAdicionais, sem mudança.
//
// Depende de (via window.*):
//   _lojaRef, _credscanChaveRef, _dbUpdate, _dbOnValue, _dbGet,
//   showCustomModal, _papelAtual
// Expõe via window.*:
//   _initConfigCredscan
// ================================================================
(function () {
    'use strict';

    const el = id => document.getElementById(id);
    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);

    let mounted = false;
    let listenerAtivo = false;

    function ensureSkeleton() {
        const container = el('configuracoesCredscan');
        if (!container || mounted) return;
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>CredScan</h3>
            </div>
            <div style="width:100%;padding:0 16px 24px;">

                <div style="background:rgba(var(--overlay-rgb),.04);border-radius:14px;padding:16px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;margin-bottom:8px;"><i class="bi bi-key-fill" style="color:var(--acento-hero);"></i>Chave da API</div>
                    <p style="font-size:.74rem;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">
                        Cole a chave da sua conta OpenRouter pra habilitar a análise de crédito via IA nessa loja.
                        Depois de salva, ninguém consegue ver ela de novo — nem você. Só o servidor usa, na hora de chamar a IA.
                    </p>

                    <label class="form-label">Chave OpenRouter</label>
                    <div style="position:relative;">
                        <input class="form-control" id="csCfgChave" type="password" placeholder="sk-or-v1-..." style="padding-right:44px;"/>
                        <button type="button" id="csCfgOlho" aria-label="Mostrar" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-muted);font-size:1rem;padding:6px;"><i class="bi bi-eye"></i></button>
                    </div>
                    <button type="button" class="rep-btn-next" id="csCfgSalvarBtn" style="width:100%;padding:13px;margin-top:12px;">Salvar chave</button>

                    <div id="csCfgStatus" style="margin-top:14px;padding:12px 14px;border-radius:12px;display:flex;align-items:center;gap:8px;font-size:.78rem;"></div>

                    <div class="form-check form-switch" style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(var(--overlay-rgb),.08);">
                        <input class="form-check-input" type="checkbox" id="csCfgToggleHabilitado"/>
                        <label class="form-check-label" for="csCfgToggleHabilitado">CredScan ativo pra essa loja</label>
                    </div>
                    <p style="font-size:.66rem;color:var(--text-muted);margin-top:4px;">Desligar aqui esconde o CredScan do menu na hora — a chave continua salva, é só ligar de novo quando quiser, sem precisar colar ela outra vez.</p>
                </div>

                <div style="background:rgba(var(--overlay-rgb),.04);border-radius:14px;padding:16px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;margin-bottom:8px;"><i class="bi bi-shield-exclamation" style="color:#fb923c;"></i>Critérios de reprovação</div>
                    <p style="font-size:.74rem;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">
                        Esses dois já são obrigatórios na análise. Aqui dá pra ajustar o valor de cada um, ou
                        desligar apostas por completo — sem risco de a IA receber instrução contraditória, porque
                        isso muda o próprio texto que ela recebe, não empilha uma regra em cima da outra.
                    </p>

                    <div class="form-check form-switch" style="margin-bottom:14px;">
                        <input class="form-check-input" type="checkbox" id="csCfgReprovarApostas" checked/>
                        <label class="form-check-label" for="csCfgReprovarApostas">Reprovar automaticamente por apostas</label>
                    </div>

                    <label class="form-label">Renda mínima mensal pra aprovar (R$)</label>
                    <input class="form-control" id="csCfgRendaMinima" type="number" inputmode="numeric" placeholder="1000" style="max-width:160px;"/>

                    <label class="form-label" style="margin-top:12px;">Taxa de juros padrão (% ao mês)</label>
                    <input class="form-control" id="csCfgTaxaJuros" type="number" inputmode="decimal" step="0.1" placeholder="6" style="max-width:160px;"/>

                    <button type="button" class="rep-btn-next" id="csCfgSalvarCriteriosBtn" style="width:100%;padding:12px;margin-top:14px;">Salvar critérios</button>
                </div>

                <div style="background:rgba(var(--overlay-rgb),.04);border-radius:14px;padding:16px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;margin-bottom:8px;"><i class="bi bi-chat-left-text-fill" style="color:#60a5fa;"></i>Outras orientações pra IA</div>
                    <p style="font-size:.74rem;color:var(--text-secondary);line-height:1.6;margin-bottom:12px;">
                        Pra qualquer outro critério além dos dois de cima (esses já têm campo próprio — escrever
                        sobre eles aqui pode confundir a IA em vez de ajudar). Ex: considerar tempo de emprego,
                        dar preferência a autônomos, etc.
                    </p>
                    <textarea class="form-control" id="csCfgRegras" rows="4" placeholder="Ex: dar prioridade a clientes com mais de 2 anos no mesmo emprego."></textarea>
                    <button type="button" class="rep-btn-next" id="csCfgSalvarRegrasBtn" style="width:100%;padding:12px;margin-top:10px;">Salvar orientações</button>
                </div>

                <div style="background:rgba(var(--overlay-rgb),.04);border-radius:14px;padding:16px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;margin-bottom:8px;"><i class="bi bi-whatsapp" style="color:#4ade80;"></i>Mensagens de WhatsApp</div>
                    <p style="font-size:.74rem;color:var(--text-secondary);line-height:1.6;margin-bottom:6px;">
                        Deixa em branco pra usar a mensagem padrão. Se escrever a sua, usa
                        <code>{cliente}</code>, <code>{produto}</code>, <code>{entrada}</code>,
                        <code>{parcelas}</code>, <code>{parcela}</code> e <code>{total}</code> — trocados
                        automaticamente pelo valor real de cada análise.
                    </p>

                    <label class="form-label" style="margin-top:10px;">Mensagem de aprovação</label>
                    <textarea class="form-control" id="csCfgMsgAprovado" rows="6" placeholder="Olá {cliente}, tudo bem? 😊&#10;Seu cadastro foi APROVADO! ✅&#10;&#10;📱 {produto}&#10;💰 Entrada: {entrada}&#10;💳 + {parcelas}x de {parcela}"></textarea>

                    <label class="form-label" style="margin-top:12px;">Mensagem de reprovação</label>
                    <textarea class="form-control" id="csCfgMsgReprovado" rows="6" placeholder="Olá {cliente}, infelizmente sua análise não foi aprovada dessa vez."></textarea>

                    <button type="button" class="rep-btn-next" id="csCfgSalvarMsgsBtn" style="width:100%;padding:12px;margin-top:10px;">Salvar mensagens</button>
                </div>
            </div>
        `;
        el('csCfgOlho').addEventListener('click', () => {
            const inp = el('csCfgChave');
            const mostrando = inp.type === 'text';
            inp.type = mostrando ? 'password' : 'text';
            el('csCfgOlho').innerHTML = mostrando ? '<i class="bi bi-eye"></i>' : '<i class="bi bi-eye-slash"></i>';
        });
        el('csCfgSalvarBtn').addEventListener('click', salvarChave);
        el('csCfgToggleHabilitado').addEventListener('change', alternarHabilitado);
        el('csCfgSalvarCriteriosBtn').addEventListener('click', salvarCriterios);
        el('csCfgSalvarRegrasBtn').addEventListener('click', salvarRegrasExtras);
        el('csCfgSalvarMsgsBtn').addEventListener('click', salvarMensagens);
        carregarConfigLegivel();
        mounted = true;
    }

    function renderStatus(habilitado) {
        const box = el('csCfgStatus');
        if (habilitado) {
            box.style.background = 'rgba(74,222,128,.08)';
            box.style.border = '1px solid rgba(74,222,128,.25)';
            box.style.color = '#4ade80';
            box.innerHTML = '<i class="bi bi-check-circle-fill"></i> CredScan ativo — pronto pra usar nessa loja';
        } else {
            box.style.background = 'rgba(248,113,113,.08)';
            box.style.border = '1px solid rgba(248,113,113,.25)';
            box.style.color = 'var(--danger)';
            box.innerHTML = '<i class="bi bi-x-circle-fill"></i> CredScan inativo — ninguém vê ele no menu';
        }
        // Só sincroniza aqui (não dispara 'change' sozinho — atribuir
        // .checked via JS não conta como interação do usuário) —
        // assim o toggle sempre reflete o banco, mesmo se outra tela/
        // dispositivo mudar isso enquanto essa está aberta.
        if (el('csCfgToggleHabilitado')) el('csCfgToggleHabilitado').checked = habilitado;
    }

    function ligarListener() {
        if (listenerAtivo) return;
        listenerAtivo = true;
        window._dbOnValue(window._lojaRef('info'), snap => {
            renderStatus(!!(snap.val() || {}).credscanHabilitado);
        });
    }

    function salvarChave() {
        const chave = el('csCfgChave').value.trim();
        if (!chave) { modal({ message: 'Cola a chave primeiro.' }); return; }
        if (!chave.startsWith('sk-')) { modal({ message: 'Essa chave não parece certa — a da OpenRouter começa com "sk-".' }); return; }

        const btn = el('csCfgSalvarBtn');
        btn.disabled = true; btn.textContent = 'Salvando...';

        // Sequencial de propósito, não Promise.all — se o write da
        // CHAVE falhar (ex: sessão sem ser Gestor de verdade, token
        // expirado), o indicador "habilitado" NUNCA liga. Antes os
        // dois writes iam em paralelo, e um write podia falhar
        // enquanto o outro passava, deixando o indicador mentindo
        // (mostrando "configurada" sem chave nenhuma gravada) — foi
        // exatamente isso que aconteceu numa loja de teste.
        window._dbUpdate(window._credscanChaveRef(), { openrouterKey: chave })
            .then(() => window._dbUpdate(window._lojaRef('info'), { credscanHabilitado: true }))
            .then(() => {
                el('csCfgChave').value = '';
                modal({ message: 'Chave salva! O CredScan já está liberado pra essa loja.' });
            })
            .catch(e => {
                modal({ message: `Não deu pra salvar: ${e.message}` });
            })
            .finally(() => {
                btn.disabled = false; btn.textContent = 'Salvar chave';
            });
    }

    function alternarHabilitado() {
        const ligar = el('csCfgToggleHabilitado').checked;
        window._dbUpdate(window._lojaRef('info'), { credscanHabilitado: ligar })
            .catch(e => {
                modal({ message: `Não deu pra ${ligar ? 'ativar' : 'desativar'}: ${e.message}` });
                el('csCfgToggleHabilitado').checked = !ligar; // desfaz o toggle visualmente se o write falhar
            });
    }

    // Nenhum desses campos tem .read:false nas regras — só a chave em
    // credscanChaves/{lojaId} é secreta (ver core.js). Isso aqui é
    // configuração normal de análise, dá pra carregar de volta pra
    // edição sem problema nenhum.
    function carregarConfigLegivel() {
        window._dbGet(window._lojaRef('credscan/config')).then(snap => {
            const cfg = snap.val() || {};
            if (el('csCfgRegras')) el('csCfgRegras').value = cfg.regrasAdicionais || '';
            if (el('csCfgReprovarApostas')) el('csCfgReprovarApostas').checked = cfg.reprovarApostas !== false;
            if (el('csCfgRendaMinima')) el('csCfgRendaMinima').value = cfg.rendaMinima || 1000;
            if (el('csCfgTaxaJuros')) el('csCfgTaxaJuros').value = cfg.taxaJuros || 6;
            if (el('csCfgMsgAprovado')) el('csCfgMsgAprovado').value = cfg.mensagemAprovado || '';
            if (el('csCfgMsgReprovado')) el('csCfgMsgReprovado').value = cfg.mensagemReprovado || '';
        }).catch(() => { /* silencioso — não é crítico, os campos só ficam no padrão */ });
    }

    function salvarCriterios() {
        const reprovarApostas = el('csCfgReprovarApostas').checked;
        const rendaMinima = Math.max(0, parseInt(el('csCfgRendaMinima').value, 10) || 1000);
        const taxaJuros = Math.max(0, parseFloat(el('csCfgTaxaJuros').value) || 6);
        const btn = el('csCfgSalvarCriteriosBtn');
        btn.disabled = true; btn.textContent = 'Salvando...';
        window._dbUpdate(window._lojaRef('credscan/config'), { reprovarApostas, rendaMinima, taxaJuros })
            .then(() => modal({ message: 'Critérios salvos — já valem pra próxima análise.' }))
            .catch(e => modal({ message: `Não deu pra salvar: ${e.message}` }))
            .finally(() => { btn.disabled = false; btn.textContent = 'Salvar critérios'; });
    }

    function salvarRegrasExtras() {
        const texto = el('csCfgRegras').value.trim();
        const btn = el('csCfgSalvarRegrasBtn');
        btn.disabled = true; btn.textContent = 'Salvando...';
        window._dbUpdate(window._lojaRef('credscan/config'), { regrasAdicionais: texto })
            .then(() => modal({ message: texto ? 'Orientações salvas — já valem pra próxima análise.' : 'Orientações removidas.' }))
            .catch(e => modal({ message: `Não deu pra salvar: ${e.message}` }))
            .finally(() => { btn.disabled = false; btn.textContent = 'Salvar orientações'; });
    }

    function salvarMensagens() {
        const mensagemAprovado = el('csCfgMsgAprovado').value.trim();
        const mensagemReprovado = el('csCfgMsgReprovado').value.trim();
        const btn = el('csCfgSalvarMsgsBtn');
        btn.disabled = true; btn.textContent = 'Salvando...';
        window._dbUpdate(window._lojaRef('credscan/config'), { mensagemAprovado, mensagemReprovado })
            .then(() => modal({ message: 'Mensagens salvas — já valem pra próxima análise.' }))
            .catch(e => modal({ message: `Não deu pra salvar: ${e.message}` }))
            .finally(() => { btn.disabled = false; btn.textContent = 'Salvar mensagens'; });
    }

    function initConfigCredscan() {
        ensureSkeleton();
        ligarListener();
    }
    window._initConfigCredscan = initConfigCredscan;
})();
