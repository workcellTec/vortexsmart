// ================================================================
// configuracoes/config-usuarios.js — VortexSmart SaaS · Config → Usuários & Permissões
// Registra: window._initConfigUsuarios()
//
// Só o Gestor acessa essa tela (a trava de Fase 0 do router de
// Configurações já cobre isso — Usuários NÃO está na lista de seções
// liberadas pro Funcionário).
//
// Node: /usuarios/{uid} = { lojaId, papel: 'gestor'|'funcionario',
//        nome, email, permissoes?: {...16 chaves, ver SECOES_PERMISSOES
//        abaixo} } — só funcionário tem 'permissoes'.
//
// Criar funcionário e mudar permissão passam pelas Cloud Functions
// (criarFuncionario, atualizarPermissoesFuncionario) — nunca escreve
// direto em /usuarios daqui, porque criar usuário no Auth pelo client
// desloga quem está criando, e a checagem de "é Gestor dessa loja?"
// precisa ser feita no servidor, não confiar no client.
//
// Depende de (via window.*):
//   showCustomModal, escapeHtml, _firebaseDB, _firebaseRef, _dbGet,
//   _chamarFunction, _setBtnLoading, _lojaId
// Expõe via window.*:
//   _initConfigUsuarios
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc   = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const el    = id => document.getElementById(id);

    // Permissões organizadas em seções. Vendas e Estoque NÃO entram
    // como "Módulos" aqui de propósito — essas duas telas ficam
    // sempre visíveis pro Funcionário (é o trabalho dele), só as
    // AÇÕES específicas dentro delas são restringíveis. (Já existiu
    // um toggle de módulo pra Vendas/Estoque aqui, mas ele nunca
    // escondia nada de verdade — removido pra não confundir o Gestor
    // com um botão que não faz nada.)
    const SECOES_PERMISSOES = [
        {
            titulo: 'Módulos',
            itens: [
                { chave: 'relatorios',    label: 'Relatórios',    icone: 'bi-bar-chart-fill' },
                { chave: 'configuracoes', label: 'Configurações', icone: 'bi-gear-fill' },
            ],
        },
        {
            titulo: 'Vendas — ações específicas',
            itens: [
                { chave: 'vendas_cancelar',          label: 'Cancelar / apagar venda',       icone: 'bi-x-circle-fill' },
                { chave: 'vendas_editar_fechada',     label: 'Editar venda já fechada',       icone: 'bi-pencil-fill' },
                { chave: 'vendas_ver_valor_fechado',  label: 'Ver total "Fechado" no resumo', icone: 'bi-cash-stack' },
                { chave: 'vendas_baixa_parcela',      label: 'Dar baixa em parcela',          icone: 'bi-check2-circle' },
                { chave: 'vendas_ver_parcelas',       label: 'Ver parcelas pendentes',        icone: 'bi-list-ol' },
                { chave: 'vendas_ver_todas',          label: 'Ver vendas de todos os vendedores', icone: 'bi-people-fill' },
            ],
        },
        {
            titulo: 'Estoque — ações específicas',
            itens: [
                { chave: 'estoque_criar_produto',    label: 'Criar um novo produto',     icone: 'bi-plus-circle-fill' },
                { chave: 'estoque_editar_produto',   label: 'Editar produto',            icone: 'bi-pencil-fill', sub: 'Inclui também repor produto existente (botão "Repor")' },
                { chave: 'estoque_arquivar_produto', label: 'Arquivar produto',          icone: 'bi-archive-fill' },
                { chave: 'estoque_apagar_produto',   label: 'Apagar produto',            icone: 'bi-trash-fill' },
                { chave: 'estoque_ver_log',          label: 'Ver log do produto',        icone: 'bi-clock-history' },
            ],
        },
        {
            titulo: 'Calculadora',
            itens: [
                { chave: 'calc_editar_lucro', label: 'Atalho de edição de produto na hora de calcular por aparelho', icone: 'bi-gear-fill' },
            ],
        },
        {
            titulo: 'Concertos — ações específicas',
            itens: [
                { chave: 'reparos_criar',               label: 'Cadastrar nova OS',              icone: 'bi-plus-circle-fill' },
                { chave: 'reparos_editar',               label: 'Editar dados da OS',             icone: 'bi-pencil-fill' },
                { chave: 'reparos_avancar_etapa',        label: 'Avançar etapa',                  icone: 'bi-arrow-right-circle-fill' },
                { chave: 'reparos_mudar_etapa_manual',   label: 'Escolher etapa manualmente',     icone: 'bi-signpost-split-fill', sub: 'Pular etapas fora da ordem sugerida do fluxo' },
                { chave: 'reparos_gerar_documento',      label: 'Gerar comprovante/garantia',      icone: 'bi-file-earmark-check-fill' },
                { chave: 'reparos_apagar',               label: 'Apagar OS',                       icone: 'bi-trash-fill' },
            ],
        },
    ];
    // Lista achatada — usada onde só precisa iterar todas as 16 chaves,
    // sem se importar com a seção (ex: montar o objeto de permissões).
    const TODAS_PERMISSOES = SECOES_PERMISSOES.flatMap(s => s.itens);
    const LIMITE_FUNCIONARIOS = 3;

    let mounted = false;
    let usuariosCache = null; // [{id, nome, email, papel, permissoes?}]
    let tela = 'lista'; // 'lista' | 'novo' | 'editar'
    let funcionarioEmEdicaoId = null;

    function ensureSkeleton() {
        const container = el('configuracoesUsuarios');
        if (!container || mounted) return;
        mounted = true;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="section-header">
                <button class="btn-icon-circle" id="cuBackBtn" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3 id="cuTitulo">Usuários &amp; Permissões</h3>
                <button type="button" class="btn-header-action" id="cuHeaderActionBtn"><i class="bi bi-person-plus-fill"></i></button>
            </div>
            <div class="content-card w-100" id="cuConteudo"></div>

            <!-- Modal de troca de senha — reaproveitado tanto pra "minha
                 senha" (Gestor, pede senha atual) quanto pra senha de um
                 funcionário (Gestor troca, não precisa da senha atual
                 dele — quem autoriza é o próprio Gestor logado). -->
            <div class="custom-modal-overlay" id="cuSenhaModalOverlay">
                <div class="custom-modal-content">
                    <h4 class="mb-3" id="cuSenhaModalTitulo">Alterar senha</h4>
                    <div class="mb-3" id="cuSenhaAtualWrap">
                        <label class="form-label" style="display:block;text-align:left;">Senha atual</label>
                        <input type="text" class="form-control" id="cuSenhaAtualInput" style="-webkit-text-security:disc;" autocomplete="off"/>
                    </div>
                    <div class="mb-3">
                        <label class="form-label" style="display:block;text-align:left;">Nova senha</label>
                        <input type="text" class="form-control" id="cuSenhaNovaInput" style="-webkit-text-security:disc;" autocomplete="off"/>
                    </div>
                    <div class="mb-3">
                        <label class="form-label" style="display:block;text-align:left;">Confirmar nova senha</label>
                        <input type="text" class="form-control" id="cuSenhaConfirmarInput" style="-webkit-text-security:disc;" autocomplete="off"/>
                    </div>
                    <button type="button" class="btn btn-ok w-100 mb-2" id="cuSenhaModalSalvarBtn">Salvar</button>
                    <button type="button" class="btn btn-secondary w-100" id="cuSenhaModalCancelarBtn">Cancelar</button>
                </div>
            </div>
            <!-- Modal de editar nome — reaproveitado tanto pra "meu nome"
                 (Gestor) quanto pro nome de um funcionário. Grava direto
                 no banco (usuarios/{uid}/nome tem regra própria, liberada
                 pra dono OU Gestor da mesma loja) — não precisa de Cloud
                 Function, diferente da senha. -->
            <div class="custom-modal-overlay" id="cuNomeModalOverlay">
                <div class="custom-modal-content">
                    <h4 class="mb-3" id="cuNomeModalTitulo">Alterar nome</h4>
                    <div class="mb-3">
                        <label class="form-label" style="display:block;text-align:left;">Nome</label>
                        <input type="text" class="form-control" id="cuNomeInput" autocomplete="off"/>
                    </div>
                    <button type="button" class="btn btn-ok w-100 mb-2" id="cuNomeModalSalvarBtn">Salvar</button>
                    <button type="button" class="btn btn-secondary w-100" id="cuNomeModalCancelarBtn">Cancelar</button>
                </div>
            </div>
        `;
        el('cuBackBtn').addEventListener('click', voltar);
        el('cuSenhaModalCancelarBtn').addEventListener('click', fecharModalSenha);
        el('cuSenhaModalSalvarBtn').addEventListener('click', salvarSenhaModal);
        el('cuSenhaModalOverlay').addEventListener('click', e => { if (e.target.id === 'cuSenhaModalOverlay') fecharModalSenha(); });
        el('cuNomeModalCancelarBtn').addEventListener('click', fecharModalNome);
        el('cuNomeModalSalvarBtn').addEventListener('click', salvarNomeModal);
        el('cuNomeModalOverlay').addEventListener('click', e => { if (e.target.id === 'cuNomeModalOverlay') fecharModalNome(); });
    }

    // alvo: 'minha' (Gestor troca o próprio nome) ou {uid, nomeAtual}
    // (Gestor troca o nome de um funcionário).
    let nomeModalAlvo = null;
    function abrirModalNome(alvo, nomeAtual) {
        nomeModalAlvo = alvo;
        el('cuNomeModalTitulo').textContent = alvo === 'minha' ? 'Alterar meu nome' : 'Alterar nome do funcionário';
        el('cuNomeInput').value = nomeAtual || '';
        window._vsAbrirModal ? window._vsAbrirModal(fecharModalNome) : null;
        el('cuNomeModalOverlay').classList.add('active');
    }
    function fecharModalNome() {
        el('cuNomeModalOverlay').classList.remove('active');
        window._vsFecharModal && window._vsFecharModal();
    }

    function salvarNomeModal() {
        const novoNome = el('cuNomeInput').value.trim();
        if (!novoNome) { modal({ message: 'Digite um nome.' }); return; }

        const uid = nomeModalAlvo === 'minha' ? window._firebaseAuthUid : nomeModalAlvo.uid;
        const btn = el('cuNomeModalSalvarBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');

        window._dbUpdate(window._firebaseRef(window._firebaseDB, `usuarios/${uid}`), { nome: novoNome })
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                fecharModalNome();
                modal({ message: 'Nome atualizado!' });
                // Atualiza o cache local pra tela já refletir sem precisar recarregar tudo
                const item = (usuariosCache || []).find(u => u.id === uid);
                if (item) item.nome = novoNome;
                render();
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
    }

    // alvo: 'minha' (pede senha atual + usa updatePassword no cliente)
    // ou {funcionarioUid, nome} (Gestor troca a de outro, via Cloud
    // Function — não pede senha atual, só a nova).
    let senhaModalAlvo = null;
    function abrirModalSenha(alvo) {
        senhaModalAlvo = alvo;
        const ehMinha = alvo === 'minha';
        el('cuSenhaModalTitulo').textContent = ehMinha ? 'Alterar minha senha' : `Alterar senha de ${esc(alvo.nome)}`;
        el('cuSenhaAtualWrap').style.display = ehMinha ? 'block' : 'none';
        el('cuSenhaAtualInput').value = '';
        el('cuSenhaNovaInput').value = '';
        el('cuSenhaConfirmarInput').value = '';
        window._vsAbrirModal ? window._vsAbrirModal(fecharModalSenha) : null;
        el('cuSenhaModalOverlay').classList.add('active');
    }
    function fecharModalSenha() {
        el('cuSenhaModalOverlay').classList.remove('active');
        window._vsFecharModal && window._vsFecharModal();
    }

    function salvarSenhaModal() {
        const nova = el('cuSenhaNovaInput').value;
        const confirmar = el('cuSenhaConfirmarInput').value;
        if (!nova || nova.length < 6) { modal({ message: 'A senha precisa ter pelo menos 6 caracteres.' }); return; }
        if (nova !== confirmar) { modal({ message: 'As senhas não são iguais.' }); return; }

        const btn = el('cuSenhaModalSalvarBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');

        const finalizar = (promessa) => promessa
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                fecharModalSenha();
                modal({ message: 'Senha alterada com sucesso!' });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                // Mensagens do Firebase Auth em inglês — traduz as mais comuns
                // pra não deixar o Gestor lendo "wrong-password" sem entender.
                const cod = e.code || '';
                let msg = e.message;
                if (cod.includes('wrong-password') || cod.includes('invalid-credential')) msg = 'Senha atual incorreta.';
                else if (cod.includes('too-many-requests')) msg = 'Muitas tentativas — espera um pouco e tenta de novo.';
                modal({ message: `Erro ao trocar senha: ${msg}` });
            });

        if (senhaModalAlvo === 'minha') {
            const senhaAtual = el('cuSenhaAtualInput').value;
            if (!senhaAtual) { window._setBtnLoading && window._setBtnLoading(btn, false); modal({ message: 'Digite sua senha atual.' }); return; }
            finalizar(window._alterarMinhaSenha(senhaAtual, nova));
        } else {
            finalizar(window._chamarFunction('alterarSenhaFuncionario', { funcionarioUid: senhaModalAlvo.funcionarioUid, novaSenha: nova }));
        }
    }

    function voltar() {
        if (tela !== 'lista') {
            tela = 'lista';
            funcionarioEmEdicaoId = null;
            render();
        } else {
            history.back();
        }
    }

    function carregarUsuarios() {
        const db = window._firebaseDB, ref = window._firebaseRef;
        const lojaId = window._lojaId;
        if (!lojaId) { usuariosCache = []; return Promise.resolve(); }
        // Busca em 2 passos: (1) lista de UIDs que pertencem à loja, via
        // o índice inverso em lojas/{lojaId}/membros — esse caminho já é
        // protegido por loja nas regras de segurança; (2) busca os dados
        // de cada UID individualmente em /usuarios/{uid}, permitido pra
        // Gestor justamente porque o passo 1 confirma que esse UID é
        // membro da própria loja dele (ver firebase-rules-saas.json).
        return window._dbGet(ref(db, `lojas/${lojaId}/membros`)).then(snap => {
            const membros = snap.val() || {};
            const uids = Object.keys(membros);
            if (!uids.length) { usuariosCache = []; return; }
            return Promise.all(uids.map(uid =>
                window._dbGet(ref(db, `usuarios/${uid}`)).then(s => ({ id: uid, ...(s.val() || {}) }))
            )).then(lista => { usuariosCache = lista; });
        }).catch(e => {
            console.error('[carregarUsuarios]', e);
            usuariosCache = [];
        });
    }

    function render() {
        if (!el('cuConteudo')) return;
        if (tela === 'novo') return renderFormNovo();
        if (tela === 'editar') return renderFormEditar();
        renderLista();
    }

    // Monta o HTML das seções de permissão. `permissoesAtuais` é opcional
    // (objeto {chave: bool}) — se vier, os toggles já nascem no estado
    // certo (usado no form de editar); se não vier, todos nascem 'off'
    // (usado no form de criar).
    function renderSecoesPermissoes(idContainer, permissoesAtuais) {
        return `
            <div id="${idContainer}">
                ${SECOES_PERMISSOES.map(secao => `
                    <div class="cfg-section-title" style="margin-top:14px;">${secao.titulo}</div>
                    <div class="cfgA-card mb-2">
                        ${secao.itens.map(item => {
                            const ligado = !!(permissoesAtuais && permissoesAtuais[item.chave]);
                            return `
                            <div class="cfgA-row" style="cursor:default;">
                                <div class="cfgA-icon" style="background:rgba(var(--overlay-rgb),.08);color:var(--text-secondary);"><i class="bi ${item.icone}"></i></div>
                                <div style="flex:1;">
                                    <div class="cfgA-name">${item.label}</div>
                                    ${item.sub ? `<div class="cfgA-row-sub">${item.sub}</div>` : ''}
                                </div>
                                <button type="button" class="ctx-switch ${ligado ? 'on' : ''}" data-permissao="${item.chave}" aria-label="Ligar/desligar"></button>
                            </div>`;
                        }).join('')}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function attachTogglesPermissao(idContainer) {
        el(idContainer).querySelectorAll('[data-permissao]').forEach(btn => {
            btn.addEventListener('click', () => btn.classList.toggle('on'));
        });
    }

    function lerPermissoesDoContainer(idContainer) {
        const permissoes = {};
        el(idContainer).querySelectorAll('[data-permissao]').forEach(btn => {
            permissoes[btn.dataset.permissao] = btn.classList.contains('on');
        });
        return permissoes;
    }

    // ── Tela: lista de usuários da loja ─────────────────────────
    function renderLista() {
        el('cuTitulo').textContent = 'Usuários & Permissões';
        const acaoBtn = el('cuHeaderActionBtn');
        const qtdFuncionarios = (usuariosCache || []).filter(u => u.papel === 'funcionario').length;
        acaoBtn.style.display = 'flex';
        acaoBtn.disabled = qtdFuncionarios >= LIMITE_FUNCIONARIOS;
        acaoBtn.style.opacity = qtdFuncionarios >= LIMITE_FUNCIONARIOS ? '.4' : '1';
        acaoBtn.onclick = () => { if (qtdFuncionarios < LIMITE_FUNCIONARIOS) abrirNovo(); };

        const conteudo = el('cuConteudo');
        if (!usuariosCache) {
            conteudo.innerHTML = `
                <div class="skeleton-row" style="height:44px;"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
            `;
            carregarUsuarios().then(render);
            return;
        }

        const gestor = usuariosCache.find(u => u.papel === 'gestor');
        const funcionarios = usuariosCache.filter(u => u.papel === 'funcionario');

        conteudo.innerHTML = `
            <div class="cfg-section-title" style="margin-top:2px;">Gestor</div>
            <div class="cfgA-card mb-3">
                <div class="cfgA-row" style="cursor:default;">
                    <div class="cfgA-icon" style="background:linear-gradient(135deg,#a78bfa,#5b3df5);">👑</div>
                    <div class="cfgA-name">${gestor ? esc(gestor.nome || gestor.email) : '—'}</div>
                </div>
                <button type="button" class="cfgA-row" id="cuMeuNomeBtn">
                    <div class="cfgA-icon" style="background:rgba(var(--overlay-rgb),.08);color:var(--text-secondary);"><i class="bi bi-person-badge-fill"></i></div>
                    <div class="cfgA-name">Alterar meu nome</div>
                    <span class="cfgA-chev">›</span>
                </button>
                <button type="button" class="cfgA-row" id="cuMinhaSenhaBtn">
                    <div class="cfgA-icon" style="background:rgba(var(--overlay-rgb),.08);color:var(--text-secondary);"><i class="bi bi-key-fill"></i></div>
                    <div class="cfgA-name">Alterar minha senha</div>
                    <span class="cfgA-chev">›</span>
                </button>
            </div>

            <div class="cfg-section-title">Funcionários (${funcionarios.length}/${LIMITE_FUNCIONARIOS})</div>
            ${funcionarios.length ? `
            <div class="cfgA-card mb-2" id="cuFuncionariosList">
                ${funcionarios.map(f => `
                    <button type="button" class="cfgA-row" data-id="${f.id}">
                        <div class="cfgA-icon" style="background:linear-gradient(135deg,#4f8cff,#2563eb);">👤</div>
                        <div class="cfgA-name">${esc(f.nome || f.email)}</div>
                        <span class="cfgA-chev">›</span>
                    </button>`).join('')}
            </div>` : `<div class="stq-hist-empty">Nenhum funcionário cadastrado ainda.</div>`}

            ${funcionarios.length >= LIMITE_FUNCIONARIOS ? `
            <div class="stq-hist-sub text-center mt-2">Limite de ${LIMITE_FUNCIONARIOS} funcionários atingido.</div>` : ''}
        `;

        el('cuFuncionariosList')?.querySelectorAll('[data-id]').forEach(btn => {
            btn.addEventListener('click', () => { funcionarioEmEdicaoId = btn.dataset.id; tela = 'editar'; render(); });
        });
        el('cuMinhaSenhaBtn')?.addEventListener('click', () => abrirModalSenha('minha'));
        el('cuMeuNomeBtn')?.addEventListener('click', () => abrirModalNome('minha', gestor?.nome));
    }

    // ── Tela: criar novo funcionário ────────────────────────────
    function renderFormNovo() {
        el('cuTitulo').textContent = 'Novo Funcionário';
        el('cuHeaderActionBtn').style.display = 'none';

        el('cuConteudo').innerHTML = `
            <label class="form-label"><i class="bi bi-person"></i> Nome completo</label>
            <input class="form-control mb-3" id="cuFNome" placeholder="Nome do funcionário"/>

            <label class="form-label"><i class="bi bi-envelope"></i> Email de acesso</label>
            <input class="form-control mb-3" id="cuFEmail" type="email" placeholder="email@exemplo.com"/>

            <label class="form-label"><i class="bi bi-key"></i> Senha</label>
            <div class="d-flex align-items-center gap-2 mb-3">
                <input class="form-control" id="cuFSenha" type="password" placeholder="Mínimo 6 caracteres" style="flex:1;"/>
                <button type="button" class="btn-icon-circle" id="cuFSenhaToggle" title="Mostrar/ocultar senha"><i class="bi bi-eye-fill"></i></button>
            </div>

            ${renderSecoesPermissoes('cuPermissoesNovo', null)}

            <button type="button" class="btn btn-ok w-100 mt-2" id="cuSalvarNovoBtn"><i class="bi bi-person-check-fill"></i> Criar Funcionário</button>
        `;

        el('cuSalvarNovoBtn').addEventListener('click', criarFuncionario);
        attachTogglesPermissao('cuPermissoesNovo');
        el('cuFSenhaToggle').addEventListener('click', () => {
            const campo = el('cuFSenha');
            const icone = el('cuFSenhaToggle').querySelector('i');
            const mostrando = campo.type === 'text';
            campo.type = mostrando ? 'password' : 'text';
            icone.className = mostrando ? 'bi bi-eye-fill' : 'bi bi-eye-slash-fill';
        });
        el('cuFNome')?.focus();
    }

    function criarFuncionario() {
        const nome = (el('cuFNome').value || '').trim();
        const email = (el('cuFEmail').value || '').trim();
        const senha = el('cuFSenha').value || '';
        if (!nome) { modal({ message: 'Digite o nome do funcionário.' }); return; }
        if (!email) { modal({ message: 'Digite o email do funcionário.' }); return; }
        if (senha.length < 6) { modal({ message: 'A senha precisa ter pelo menos 6 caracteres.' }); return; }

        const permissoes = lerPermissoesDoContainer('cuPermissoesNovo');

        const btn = el('cuSalvarNovoBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Criando...');

        window._chamarFunction('criarFuncionario', {
            nomeFuncionario: nome,
            emailFuncionario: email,
            senhaFuncionario: senha,
            permissoes
        }).then(() => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            modal({ message: 'Funcionário criado!' });
            tela = 'lista';
            usuariosCache = null; // força recarregar a lista
            render();
        }).catch(e => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            modal({ message: `Erro ao criar funcionário: ${e.message}` });
        });
    }

    // ── Tela: editar permissões de um funcionário existente ─────
    function renderFormEditar() {
        const func = (usuariosCache || []).find(u => u.id === funcionarioEmEdicaoId);
        if (!func) { tela = 'lista'; render(); return; }

        el('cuTitulo').textContent = func.nome || func.email;
        const acaoBtn = el('cuHeaderActionBtn');
        acaoBtn.style.display = 'none';

        el('cuConteudo').innerHTML = `
            <div class="stq-hist-sub mb-1">Email</div>
            <div class="mb-3" style="font-weight:700;color:var(--text-strong);">${esc(func.email || '—')}</div>

            <button type="button" class="btn btn-secondary w-100 mb-2" id="cuAlterarNomeFuncBtn"><i class="bi bi-person-badge-fill"></i> Alterar nome</button>
            <button type="button" class="btn btn-secondary w-100 mb-3" id="cuAlterarSenhaFuncBtn"><i class="bi bi-key-fill"></i> Alterar senha</button>

            ${renderSecoesPermissoes('cuPermissoesEditar', func.permissoes)}

            <button type="button" class="btn btn-ok w-100 mt-2" id="cuSalvarPermissoesBtn"><i class="bi bi-check-circle"></i> Salvar Permissões</button>
        `;

        attachTogglesPermissao('cuPermissoesEditar');
        el('cuSalvarPermissoesBtn').addEventListener('click', () => salvarPermissoes(func));
        el('cuAlterarSenhaFuncBtn').addEventListener('click', () => abrirModalSenha({ funcionarioUid: func.id, nome: func.nome || func.email }));
        el('cuAlterarNomeFuncBtn').addEventListener('click', () => abrirModalNome({ uid: func.id }, func.nome));
    }

    function salvarPermissoes(func) {
        const permissoes = lerPermissoesDoContainer('cuPermissoesEditar');

        const btn = el('cuSalvarPermissoesBtn');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');

        window._chamarFunction('atualizarPermissoesFuncionario', {
            funcionarioUid: func.id,
            permissoes
        }).then(() => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            func.permissoes = { ...(func.permissoes || {}), ...permissoes };
            modal({ message: 'Permissões atualizadas!' });
        }).catch(e => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            modal({ message: `Erro ao salvar: ${e.message}` });
        });
    }

    function abrirNovo() {
        tela = 'novo';
        render();
    }

    // ── Entrada pública ──────────────────────────────────────────
    window._initConfigUsuarios = function () {
        ensureSkeleton();
        tela = 'lista';
        funcionarioEmEdicaoId = null;
        usuariosCache = null;
        render();
    };
})();
