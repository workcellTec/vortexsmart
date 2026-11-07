// ================================================================
// reparos/lista.js — VortexSmart · Concertos · Lista de OS
// Node real: /reparos/{id} (dados gerais) — a SENHA do aparelho mora
// separada, em /reparosSenhas/{lojaId}/{id} (ver window._reparosSenhaRef
// no core.js). Isolada por organização, mas sem regra restritiva —
// qualquer usuário da loja pode ver (decisão do Gestor).
// Expõe via window.*:
//   _renderReparosLista
// Depende de (via window.*):
//   showCustomModal, escapeHtml, _fmt, _temPermissao, _papelUsuario,
//   _lojaRef, _reparosSenhaRef, _dbOnValue, _dbGet, _dbUpdate, _dbRemove,
//   _reparosRenderPatternGrid (reparos/pattern-widget.js),
//   _uploadFotoStorage, _vsTravarScroll, _vsDestravarScroll,
//   _vsAbrirModal, _vsFecharModal, _vsLimparModalSemVoltar (core.js),
//   openReparosSection
// ================================================================
(function () {
    'use strict';

    const el  = id => document.getElementById(id);
    const esc = t  => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : t;
    const tp  = chave => typeof window._temPermissao === 'function' ? window._temPermissao(chave) : true;
    const ehGestor = () => window._papelUsuario === 'gestor';

    // ── Helpers de cor pros chips de filtro (etapas do fluxo) ──────
    function hexRgba(hex, alpha) {
        const h = (hex || '#64748b').replace('#', '');
        const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        const num = parseInt(n, 16);
        const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
        return `rgba(${r},${g},${b},${alpha})`;
    }
    function corContrasteTexto(hex) {
        const h = (hex || '#64748b').replace('#', '');
        const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        const num = parseInt(n, 16);
        const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
        const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminancia > 0.6 ? '#0f172a' : '#ffffff';
    }
    const CHIP_ATIVOS_COLOR    = '#4f8cff';
    const CHIP_ATRASADOS_COLOR = '#ef4444';

    // Mesmos fluxos definidos com o Brendon no mockup aprovado, com um
    // ajuste: "Aguardando Peça" virou uma etapa OPCIONAL (opcional:
    // true) nos dois fluxos — não trava o caminho automático do botão
    // Avançar (que pula direto pra próxima etapa "de verdade"), só
    // existe se alguém escolher ela manualmente (pelo "..."), pra
    // quando realmente falta peça. Nem toda OS passa por isso.
    const FLOWS = {
        propria: [
            { k: 'fila',            label: 'Na Fila',           icon: 'bi-inbox-fill',      color: '#64748b' },
            { k: 'em_reparo',       label: 'Em Reparo',         icon: 'bi-tools',           color: '#fbbf24' },
            { k: 'aguardando_peca', label: 'Aguardando Peça',   icon: 'bi-box-seam-fill',   color: '#a78bfa', opcional: true },
            { k: 'finalizado',      label: 'Finalizado (loja)', icon: 'bi-check2-circle',   color: '#4f8cff' },
            { k: 'entregue',        label: 'Entregue',          icon: 'bi-bag-check-fill',  color: '#00e676' },
        ],
        terceirizada: [
            { k: 'levar_tecnico',   label: 'Levar ao Técnico',  icon: 'bi-truck',           color: '#f87171' },
            { k: 'em_reparo',       label: 'Em Reparo',         icon: 'bi-tools',           color: '#fbbf24' },
            { k: 'aguardando_peca', label: 'Aguardando Peça',   icon: 'bi-box-seam-fill',   color: '#a78bfa', opcional: true },
            { k: 'fin_loja',        label: 'Finalizado na Loja',icon: 'bi-shop',            color: '#4f8cff' },
            { k: 'entregue',        label: 'Entregue',          icon: 'bi-bag-check-fill',  color: '#00e676' },
        ],
    };
    window._REPAROS_FLOWS = FLOWS; // reaproveitado por reparos/form.js e config-reparos.js

    function flowMeta(modo, statusKey) {
        return (FLOWS[modo] || []).find(s => s.k === statusKey);
    }

    let mounted = false;
    let todasOS = [];
    let filtroAtivo = 'ativos';
    let expandedId = null;
    // Setado quando a tela abre vinda de uma notificação (ver
    // renderReparosLista) — assim que o card daquela OS aparecer no
    // DOM (pode levar um instante extra se os dados ainda não tinham
    // chegado do Firebase), rola até ele uma vez só e limpa.
    let scrollParaId = null;
    const LIMITE_PAGINA = 30;
    let limiteExibicao = LIMITE_PAGINA;
    const senhaCache = {}; // { [repairId]: {tipo, valor?, sequencia?} } — só preenchido sob demanda

    // ── Skeleton (montado 1x) ────────────────────────────────────
    function ensureSkeleton() {
        const container = el('reparosLista');
        if (!container || mounted) return;
        container.classList.add('stq-neon');
        const podeCriar = tp('reparos_criar');
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Concertos</h3>
                ${podeCriar ? `<button class="btn-header-action" id="repNewBtn" aria-label="Nova OS"><i class="bi bi-plus-lg"></i></button>` : '<div style="width:36px;"></div>'}
            </div>
            <div class="rep-flow-label vs-rep-largura" id="repFlowLabel"></div>
            <div class="rep-busca-wrap vs-rep-largura" style="margin:0 auto 12px;">
                <i class="bi bi-search"></i>
                <input type="text" id="repBusca" placeholder="Buscar por cliente ou aparelho..." autocomplete="off"/>
            </div>
            <div class="stq-cats vs-rep-largura" id="repFiltros" style="margin:0 auto 14px;"></div>
            <div class="stq-list vs-rep-largura" id="repList"></div>
        `;

        el('repBusca').addEventListener('input', () => {
            limiteExibicao = LIMITE_PAGINA;
            renderLista();
        });

        el('repNewBtn')?.addEventListener('click', () => {
            if (typeof window.openReparosSection === 'function') window.openReparosSection('reparosForm');
        });

        mounted = true;
    }

    // ── Carregamento dos dados ──────────────────────────────────
    let listenerAttached = false;
    function carregarOS() {
        if (listenerAttached) return;
        listenerAttached = true;
        window._dbOnValue(window._lojaRef('reparos'), snap => {
            const dados = snap.val() || {};
            todasOS = Object.keys(dados).map(id => ({ id, ...dados[id] }));
            renderLista();
        });
    }

    // ── Prazo: calculado em cima do status, não é um status em si ──
    function prazoInfo(os) {
        if (os.status === 'entregue' || !os.prazoTs) return null;
        const diffH = (os.prazoTs - Date.now()) / 3600000;
        if (diffH < 0) return { cls: 'atrasado', label: `${Math.abs(Math.round(diffH))}h atraso` };
        if (diffH < 24) return { cls: 'proximo', label: `${Math.round(diffH)}h restantes` };
        return { cls: 'ok', label: new Date(os.prazoTs).toLocaleDateString('pt-BR') };
    }

    // ── Filtros (chips) ──────────────────────────────────────────
    function renderFiltrosEFlowLabel() {
        const modo = (window._reparosConfig || {}).modo || 'terceirizada';
        const flowLabelEl = el('repFlowLabel');
        if (flowLabelEl) {
            flowLabelEl.innerHTML = `Fluxo ativo: <span class="tag ${modo}">${modo === 'propria' ? 'Própria loja' : 'Terceirizada'}</span>`;
        }
        const etapas = FLOWS[modo] || [];
        const chips = [
            { k: 'ativos', label: 'Ativos', color: CHIP_ATIVOS_COLOR },
            ...etapas.map(s => ({ k: s.k, label: s.label, color: s.color })),
            { k: 'atrasados', label: 'Atrasados', color: CHIP_ATRASADOS_COLOR },
        ];
        const wrap = el('repFiltros');
        if (!wrap) return;
        wrap.innerHTML = chips.map(c => {
            const style = `--pill-bg:${hexRgba(c.color, .16)};--pill-border:${hexRgba(c.color, .5)};--pill-color:${c.color};--pill-active-text:${corContrasteTexto(c.color)};`;
            return `<span class="stq-cat-pill${filtroAtivo === c.k ? ' active' : ''}" data-filtro="${c.k}" style="${style}">${c.label}</span>`;
        }).join('');
        wrap.querySelectorAll('[data-filtro]').forEach(chip => {
            chip.addEventListener('click', () => { filtroAtivo = chip.dataset.filtro; limiteExibicao = LIMITE_PAGINA; renderLista(); });
        });
    }

    // ── Lista ────────────────────────────────────────────────────
    function renderLista() {
        renderFiltrosEFlowLabel();
        const listEl = el('repList');
        if (!listEl) return;

        let itens = todasOS.slice();
        if (filtroAtivo === 'ativos') itens = itens.filter(o => o.status !== 'entregue');
        else if (filtroAtivo === 'atrasados') itens = itens.filter(o => o.status !== 'entregue' && o.prazoTs && o.prazoTs < Date.now());
        else itens = itens.filter(o => o.status === filtroAtivo);

        const termoBusca = (el('repBusca')?.value || '').trim().toLowerCase();
        if (termoBusca) {
            itens = itens.filter(o =>
                (o.cliente?.nome || '').toLowerCase().includes(termoBusca) ||
                (o.aparelho || '').toLowerCase().includes(termoBusca)
            );
        }

        // Mais urgente primeiro: atrasado > próximo > resto, por prazo
        itens.sort((a, b) => (a.prazoTs || Infinity) - (b.prazoTs || Infinity));

        if (!itens.length) {
            listEl.innerHTML = `
                <div class="stq-empty">
                    <i class="bi bi-wrench-adjustable-circle"></i>
                    <h4>${termoBusca ? 'Nada encontrado' : 'Nenhuma OS nesse filtro'}</h4>
                    <p class="text-secondary small">${termoBusca ? 'Tenta outro nome ou aparelho.' : 'Toque no + pra cadastrar uma nova.'}</p>
                </div>`;
            return;
        }

        // Corta em 30 pra não travar a tela com muita OS de uma vez —
        // "Ver mais" só revela o que já está carregado em memória, não
        // busca de novo no Firebase (a lista inteira já veio via
        // _dbOnValue; isso aqui é só questão de quanto RENDERIZAR).
        const totalFiltrado = itens.length;
        const visiveis = itens.slice(0, limiteExibicao);

        listEl.innerHTML = visiveis.map(o => buildCard(o)).join('')
            + (totalFiltrado > visiveis.length ? `
                <button type="button" class="rep-vermais-btn" id="repVerMais">
                    Ver mais (${totalFiltrado - visiveis.length} restantes)
                </button>` : '');
        wireCardEvents(listEl, visiveis);
        el('repVerMais')?.addEventListener('click', () => { limiteExibicao += LIMITE_PAGINA; renderLista(); });

        // Se veio de notificação (scrollParaId setado) e o card já
        // está no DOM agora, rola até ele. Se os dados ainda não
        // tinham chegado nessa passada, scrollParaId continua setado
        // e o PRÓXIMO renderLista (disparado pelo listener do
        // Firebase quando os dados chegarem) tenta de novo.
        if (scrollParaId) {
            const cardAlvo = listEl.querySelector(`.rep-card[data-id="${scrollParaId}"]`);
            if (cardAlvo) {
                requestAnimationFrame(() => cardAlvo.scrollIntoView({ behavior: 'smooth', block: 'center' }));
                scrollParaId = null;
            }
        }
    }

    function senhaResumoIcon(os) {
        const map = { nenhuma: 'bi-slash-circle', senha: 'bi-key-fill', pin: 'bi-grid-3x3-gap-fill', padrao: 'bi-shuffle' };
        return map[os.senhaTipo] || 'bi-slash-circle';
    }

    // Acha a próxima etapa "de verdade" (pula qualquer etapa marcada
    // como opcional, tipo Aguardando Peça) a partir da etapa atual —
    // usado tanto pro texto do botão Avançar quanto pra ação de
    // avançar de fato. Funciona mesmo se a OS estiver PARADA numa
    // etapa opcional no momento (acha a próxima não-opcional depois
    // dela na lista, não só a seguinte).
    function proximaEtapaSequencial(os) {
        const todasEtapas = FLOWS[os.modo] || [];
        const idxAtual = todasEtapas.findIndex(s => s.k === os.status);
        if (idxAtual === -1) return null;
        for (let i = idxAtual + 1; i < todasEtapas.length; i++) {
            if (!todasEtapas[i].opcional) return todasEtapas[i];
        }
        return null;
    }

    function buildNextBtn(os, meta) {
        if (!tp('reparos_avancar_etapa')) return '';
        if (os.status === 'entregue') return `<button class="rep-btn-next" disabled><i class="bi bi-check-lg"></i> OS finalizada</button>`;
        const proxima = proximaEtapaSequencial(os);
        const label = proxima ? `Avançar: ${proxima.label}` : 'Avançar';
        return `<button class="rep-btn-next" data-action="avancar"><i class="bi bi-arrow-right-circle-fill"></i> ${label}</button>`;
    }

    function buildCard(os) {
        const meta = flowMeta(os.modo, os.status);
        const prazo = prazoInfo(os);
        const expandido = expandedId === os.id;
        const classePrazo = prazo && prazo.cls !== 'ok' ? ' prazo-' + prazo.cls : '';
        const corEtapa = meta ? meta.color : '#64748b';
        // Miniatura (~120px, gerada no cadastro/edição — ver form.js)
        // preenchendo um bloco do tamanho do card, encostada nas
        // bordas (o .rep-card já tem overflow:hidden, então o próprio
        // recorte arredondado do card faz o trabalho de "cantos
        // arredondados" sem precisar replicar o border-radius aqui).
        // Loja antiga sem miniatura ainda (OS cadastrada antes dessa
        // mudança) cai no ícone de sempre, centralizado no mesmo
        // bloco — nunca busca a foto grande só pra mostrar na lista.
        const avatar = os.fotoThumbUrl
            ? `<div class="rep-card-foto"><img src="${esc(os.fotoThumbUrl)}" loading="lazy" alt=""/></div>`
            : `<div class="rep-card-foto"><div class="rep-status-dot" style="background:${corEtapa};"><i class="bi ${meta ? meta.icon : 'bi-question-lg'}"></i></div></div>`;
        return `
        <div class="rep-card${expandido ? ' expanded' : ''}${classePrazo}" data-id="${os.id}">
            <div class="rep-card-main" data-action="toggle">
                ${avatar}
                <div class="rep-card-info">
                    <div class="rep-card-nome">${esc(os.cliente?.nome || 'Sem nome')} <span style="color:var(--text-muted);font-weight:500;">· ${esc(os.aparelho || '')}</span></div>
                    <div class="rep-card-meta">
                        <span>${meta ? meta.label : os.status}</span>
                        ${prazo ? `<span class="rep-badge ${prazo.cls}"><i class="bi bi-flag-fill"></i> ${prazo.label}</span>` : ''}
                        <i class="bi ${senhaResumoIcon(os)}" style="font-size:.8rem;"></i>
                    </div>
                </div>
                <i class="bi bi-chevron-right rep-card-chev"></i>
            </div>
            <div class="rep-row-panel" style="display:${expandido ? 'block' : 'none'};"></div>
        </div>`;
    }

    // ── Painel expandido — montado sob demanda, só quando o card abre ──
    function renderPainel(panel, os) {
        const meta = flowMeta(os.modo, os.status);
        const etapas = FLOWS[os.modo] || [];
        const fotos = Array.isArray(os.fotosChegada) ? os.fotosChegada : [];
        panel.innerHTML = `
            <div class="rep-mini-grid-2col">
                <div class="rep-mini-card">
                    <div class="cabecalho"><i class="bi bi-card-text"></i>Defeito</div>
                    <div class="conteudo">${esc(os.defeito || '—')}</div>
                </div>
                <div class="rep-mini-card">
                    <div class="cabecalho"><i class="bi bi-images"></i>Fotos (${fotos.length})</div>
                    ${fotos.length
                        ? `<div class="thumbs-mini">${fotos.map(url => `<div class="rep-mini-thumb" data-ver-foto="${esc(url)}"><img src="${esc(url)}"/></div>`).join('')}</div>`
                        : `<div class="conteudo" style="color:var(--text-muted);font-style:italic;">Nenhuma foto</div>`}
                </div>
                <div class="rep-mini-card" id="repSenhaMini-${os.id}">
                    <div class="cabecalho"><i class="bi bi-shield-lock"></i>Senha</div>
                    <div class="conteudo">carregando...</div>
                </div>
                <div class="rep-mini-card" data-action="timeline" style="cursor:pointer;">
                    <div class="cabecalho"><i class="bi bi-clock-history"></i>Timeline</div>
                    <div class="conteudo">Ver histórico completo →</div>
                </div>
            </div>

            <div class="rep-panel-sec-title" style="margin-top:16px;"><i class="bi bi-signpost-split-fill"></i>Etapa</div>
            <div class="rep-actions-row">
                ${buildNextBtn(os, meta)}
                ${tp('reparos_mudar_etapa_manual') ? `<button class="rep-btn-manual" data-action="toggle-manual" title="Escolher etapa manualmente"><i class="bi bi-three-dots"></i></button>` : ''}
            </div>
            ${tp('reparos_mudar_etapa_manual') ? `
            <div class="rep-etapa-select-wrap" data-manual-wrap>
                <div class="rep-etapa-picker">
                    ${etapas.map(s => `
                        <button type="button" class="rep-etapa-opcao${s.k === os.status ? ' ativa' : ''}" data-etapa-opcao="${s.k}">
                            <span class="rep-etapa-opcao-dot" style="background:${s.color};"><i class="bi ${s.icon}"></i></span>
                            <span class="rep-etapa-opcao-label">${s.label}${s.opcional ? ' <span class="rep-etapa-opcional-tag">opcional</span>' : ''}</span>
                            ${s.k === os.status ? '<i class="bi bi-check-circle-fill rep-etapa-opcao-check"></i>' : ''}
                        </button>`).join('')}
                </div>
                <div class="rep-perm-note"><i class="bi bi-info-circle-fill"></i> Só quem tem a permissão "Escolher etapa manualmente" vê essa opção — o resto só usa o botão de avançar.</div>
            </div>` : ''}

            <div class="rep-panel-actions2">
                ${tp('reparos_editar') ? `<button class="rep-panel-btn2 editar" data-action="editar"><i class="bi bi-pencil-fill"></i>Editar</button>` : ''}
                ${tp('reparos_apagar') ? `<button class="rep-panel-btn2 apagar" data-action="apagar"><i class="bi bi-trash-fill"></i>Apagar</button>` : ''}
            </div>
        `;
        carregarSenha(os);
    }

    // Busca a senha só quando o card abre — evita gastar leitura à toa
    // quando o card nem foi aberto. Qualquer usuário da loja pode ver
    // (decisão do Gestor: assistência técnica, todo mundo ali precisa
    // do acesso pra trabalhar — sem checagem de permissão de propósito).
    function carregarSenha(os) {
        const miniCard = el('repSenhaMini-' + os.id);
        if (!miniCard) return;
        if (senhaCache[os.id]) { renderSenhaMini(miniCard, senhaCache[os.id]); return; }
        window._dbGet(window._reparosSenhaRef(os.id)).then(snap => {
            const senha = snap.val() || { tipo: 'nenhuma' };
            senhaCache[os.id] = senha;
            renderSenhaMini(miniCard, senha);
        }).catch(e => {
            console.error('Erro ao carregar senha do aparelho:', e);
            const conteudo = miniCard.querySelector('.conteudo');
            if (conteudo) conteudo.innerHTML = `<span style="color:var(--text-muted);">Erro ao carregar</span>`;
        });
    }

    // Chamada pelo reparos/form.js depois de salvar uma senha nova —
    // sem isso, o card expandido continuava mostrando a senha ANTIGA
    // que já tinha em memória (reparosSenhas é um node separado de
    // reparos, então o listener normal da lista não percebe essa
    // mudança sozinho). Se o card dessa OS estiver aberto no momento,
    // recarrega na hora; senão só limpa o cache — a próxima vez que
    // alguém abrir o card, busca a versão atual.
    window._reparosInvalidarSenhaCache = function (id) {
        delete senhaCache[id];
        const os = todasOS.find(o => o.id === id);
        if (os && expandedId === id) carregarSenha(os);
    };

    // Senha/PIN aparecem com o VALOR direto (era pra isso que existiam
    // desde o início — "fácil e rápido de ver"). Só o Padrão desenhado
    // não cabe pequeno de um jeito legível, então vira "toque pra ver"
    // e abre um lightbox com o desenho em tamanho grande.
    function renderSenhaMini(miniCard, senha) {
        const conteudo = miniCard.querySelector('.conteudo');
        if (!conteudo) return;
        if (!senha || senha.tipo === 'nenhuma') {
            conteudo.innerHTML = `<span style="color:var(--text-muted);font-style:italic;">Nenhuma senha</span>`;
        } else if (senha.tipo === 'senha') {
            conteudo.innerHTML = `<span class="rep-senha-texto" style="font-size:.78rem;">${esc(senha.valor || '')}</span>`;
        } else if (senha.tipo === 'pin') {
            conteudo.innerHTML = `<span class="rep-senha-texto" style="font-size:.78rem;letter-spacing:.15em;">${esc(senha.valor || '')}</span>`;
        } else if (senha.tipo === 'padrao') {
            const sequencia = Array.isArray(senha.sequencia) ? senha.sequencia : [];
            conteudo.innerHTML = `<span class="rep-ver-padrao" data-ver-padrao="1"><i class="bi bi-shuffle"></i> Padrão (toque p/ ver)</span>`;
            conteudo.querySelector('[data-ver-padrao]').addEventListener('click', e => {
                e.stopPropagation();
                abrirPatternLightbox(sequencia);
            });
        } else {
            conteudo.innerHTML = '';
        }
    }

    // ── Ações do card ────────────────────────────────────────────
    function avancarEtapa(os) {
        const proxima = proximaEtapaSequencial(os);
        if (!proxima) return;
        abrirFluxoMudancaEtapa(os, proxima.k);
    }

    // Ponto único de decisão: indo pra "Entregue", abre o wizard
    // completo (foto + valor + documento + venda); qualquer outra
    // etapa continua no modal simples de foto (sempre opcional).
    function abrirFluxoMudancaEtapa(os, novoStatus) {
        if (novoStatus === 'entregue' && typeof window._reparosAbrirWizardEntrega === 'function') {
            window._reparosAbrirWizardEntrega(os);
        } else {
            abrirModalFotoEtapa(os, novoStatus);
        }
    }

    function salvarStatus(os, novoStatus, fotoBlob) {
        const etapaSendoConcluida = os.status;
        const aplicar = fotoUrl => {
            const payload = { status: novoStatus };
            payload['timeline/' + novoStatus] = { ts: Date.now(), uid: window._firebaseAuthUid || null };
            if (fotoUrl) payload['timeline/' + etapaSendoConcluida + '/fotoUrl'] = fotoUrl;
            return window._dbUpdate(window._lojaRef('reparos/' + os.id), payload);
        };
        const promessa = fotoBlob
            ? window._uploadFotoStorage(fotoBlob, `reparos/${os.id}/etapas/${etapaSendoConcluida}.jpg`).then(aplicar)
            : aplicar(null);
        return promessa; // quem chama decide o que fazer com sucesso/erro
    }
    window._reparosSalvarStatus = salvarStatus;

    function apagarOS(os) {
        const confirmar = () => {
            Promise.all([
                window._dbRemove(window._lojaRef('reparos/' + os.id)),
                window._dbRemove(window._reparosSenhaRef(os.id)).catch(() => {}), // pode não existir/não ter permissão de escrita — não trava a exclusão principal por isso
            ]).then(() => {
                if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'OS apagada.' });
            }).catch(e => {
                if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao apagar: ${e.message}` });
            });
        };
        if (typeof window.showCustomModal === 'function') {
            window.showCustomModal({
                message: `Apagar a OS de "${os.cliente?.nome || 'cliente'}"? Isso remove os dados e a senha salva do aparelho — não dá pra desfazer.`,
                confirmText: 'Apagar', cancelText: 'Cancelar',
                onConfirm: confirmar
            });
        } else if (confirm('Apagar essa OS? Não dá pra desfazer.')) {
            confirmar();
        }
    }

    function wireCardEvents(listEl, itens) {
        listEl.querySelectorAll('.rep-card').forEach(card => {
            const id = card.dataset.id;
            const os = itens.find(o => o.id === id);
            if (!os) return;

            card.querySelector('[data-action="toggle"]').addEventListener('click', () => {
                const panel = card.querySelector('.rep-row-panel');
                const abrindo = expandedId !== os.id;
                expandedId = abrindo ? os.id : null;
                listEl.querySelectorAll('.rep-card').forEach(c => c.classList.remove('expanded'));
                listEl.querySelectorAll('.rep-row-panel').forEach(p => { p.style.display = 'none'; });
                if (abrindo) {
                    card.classList.add('expanded');
                    panel.style.display = 'block';
                    renderPainel(panel, os);
                }
            });

            const panel = card.querySelector('.rep-row-panel');
            panel.addEventListener('click', e => {
                const verFoto = e.target.closest('[data-ver-foto]');
                if (verFoto) { e.stopPropagation(); abrirLightbox(verFoto.dataset.verFoto); return; }
                const opcaoEtapa = e.target.closest('[data-etapa-opcao]');
                if (opcaoEtapa) {
                    e.stopPropagation();
                    const novoStatus = opcaoEtapa.dataset.etapaOpcao;
                    if (novoStatus !== os.status) abrirFluxoMudancaEtapa(os, novoStatus);
                    return;
                }
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                e.stopPropagation();
                const acao = btn.dataset.action;
                if (acao === 'avancar') avancarEtapa(os);
                else if (acao === 'toggle-manual') panel.querySelector('[data-manual-wrap]')?.classList.toggle('show');
                else if (acao === 'editar') { if (typeof window.openReparosSection === 'function') window.openReparosSection('reparosForm', { repairId: os.id }); }
                else if (acao === 'apagar') apagarOS(os);
                else if (acao === 'timeline') abrirTimeline(os);
            });

            // Card que já estava expandido antes desse refresh de dados
            // (ex: acabou de avançar etapa, o listener do Firebase
            // disparou renderLista de novo) precisa reconstruir o
            // conteúdo do painel — buildCard só recria o container vazio.
            if (expandedId === os.id) {
                renderPainel(panel, os);
            }
        });
    }

    // ── Modal: foto ao mudar de etapa (sempre opcional, tem "Pular") ──
    function motivoFoto(etapaAntiga, etapaNova) {
        if (etapaAntiga === 'levar_tecnico') return 'Foi pro técnico? Tire uma foto comprovando que entregou o aparelho.';
        if (etapaNova === 'entregue') return 'Entregue ao cliente? Tire uma foto com o cliente recebendo o aparelho.';
        return 'Quer registrar uma foto dessa etapa antes de avançar? (opcional)';
    }

    let fotoEtapaBackdrop = null;
    let fotoEtapaBlobPendente = null;
    function ensureModalFotoEtapa() {
        if (fotoEtapaBackdrop) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="stq-modal-backdrop" id="repModalFotoEtapa">
                <div class="stq-modal-card">
                    <div class="stq-modal-header primary">
                        <div class="stq-modal-header-title" id="repFotoEtapaTitulo">Avançar etapa</div>
                        <button class="stq-modal-close" id="repFotoEtapaClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="repFotoEtapaCorpo">
                        <p style="font-size:.78rem;color:var(--text);margin-bottom:12px;" id="repFotoEtapaMsg"></p>
                        <div class="rep-foto-modal-preview" id="repFotoEtapaPreview"><i class="bi bi-camera-fill ic"></i><span class="txt">Nenhuma foto ainda</span></div>
                        <div class="rep-foto-btns" style="margin-bottom:10px;">
                            <button type="button" class="rep-foto-btn" id="repFotoEtapaBtnCam"><i class="bi bi-camera-fill"></i> Câmera</button>
                            <button type="button" class="rep-foto-btn" id="repFotoEtapaBtnGal"><i class="bi bi-image-fill"></i> Galeria</button>
                        </div>
                        <input type="file" accept="image/*" capture="environment" id="repFotoEtapaInputCam" class="hidden">
                        <input type="file" accept="image/*" id="repFotoEtapaInputGal" class="hidden">
                        <button type="button" class="rep-btn-next" id="repFotoEtapaConfirmar" style="width:100%;">Confirmar</button>
                        <button type="button" class="rep-foto-modal-pular" id="repFotoEtapaPular">Pular sem foto</button>
                    </div>
                    <div class="rep-foto-modal-loading" id="repFotoEtapaLoading">
                        <div class="spinner" id="repFotoEtapaSpinner"></div>
                        <div class="txt-status" id="repFotoEtapaLoadingTxt">Salvando...</div>
                    </div>
                </div>
            </div>`);
        fotoEtapaBackdrop = el('repModalFotoEtapa');
        function onArquivo(e) {
            const file = e.target.files?.[0];
            if (!file) return;
            fotoEtapaBlobPendente = file;
            const reader = new FileReader();
            reader.onload = ev => { el('repFotoEtapaPreview').innerHTML = `<img src="${ev.target.result}"/>`; };
            reader.readAsDataURL(file);
        }
        el('repFotoEtapaInputCam').addEventListener('change', onArquivo);
        el('repFotoEtapaInputGal').addEventListener('change', onArquivo);
        el('repFotoEtapaBtnCam').addEventListener('click', () => el('repFotoEtapaInputCam').click());
        el('repFotoEtapaBtnGal').addEventListener('click', () => el('repFotoEtapaInputGal').click());
        el('repFotoEtapaClose').addEventListener('click', fecharModalFotoEtapaSemConfirmar);
        fotoEtapaBackdrop.addEventListener('click', e => { if (e.target.id === 'repModalFotoEtapa') fecharModalFotoEtapaSemConfirmar(); });
        el('repFotoEtapaPular').addEventListener('click', () => confirmarFotoEtapa(false));
        el('repFotoEtapaConfirmar').addEventListener('click', () => confirmarFotoEtapa(true));
    }

    let _fotoEtapaOs = null, _fotoEtapaNovoStatus = null;
    function abrirModalFotoEtapa(os, novoStatus) {
        ensureModalFotoEtapa();
        _fotoEtapaOs = os; _fotoEtapaNovoStatus = novoStatus;
        fotoEtapaBlobPendente = null;
        const metaNovo = flowMeta(os.modo, novoStatus);
        el('repFotoEtapaTitulo').textContent = 'Avançar: ' + (metaNovo ? metaNovo.label : novoStatus);
        el('repFotoEtapaMsg').textContent = motivoFoto(os.status, novoStatus);
        el('repFotoEtapaPreview').innerHTML = '<i class="bi bi-camera-fill ic"></i><span class="txt">Nenhuma foto ainda</span>';
        // Garante que reabre no estado normal, não travado no "carregando"
        // de uma vez anterior.
        el('repFotoEtapaCorpo').style.display = '';
        el('repFotoEtapaLoading').classList.remove('show');
        el('repFotoEtapaSpinner').style.display = '';
        [el('repFotoEtapaConfirmar'), el('repFotoEtapaPular'), el('repFotoEtapaBtnCam'), el('repFotoEtapaBtnGal')].forEach(b => b.disabled = false);
        fotoEtapaBackdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(fecharModalFotoEtapaSemConfirmar);
    }
    function fecharModalFotoEtapaSemConfirmar() {
        fotoEtapaBackdrop?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
        // Fecha sem confirmar (X ou fundo) — a troca de etapa NÃO
        // aconteceu, mas o <select> de troca manual já pode estar
        // mostrando o valor novo (reação nativa do navegador ao
        // escolher a opção) — re-renderiza pra ele voltar a mostrar
        // o status real.
        renderLista();
    }
    function confirmarFotoEtapa(comFoto) {
        const os = _fotoEtapaOs, novoStatus = _fotoEtapaNovoStatus;
        const blob = comFoto ? fotoEtapaBlobPendente : null;
        if (!os || !novoStatus) return;

        // Troca pro estado "carregando" SEM fechar o modal — é isso que
        // esconde a espera do upload/gravação. Antes o modal fechava na
        // hora e a OS só atualizava na tela depois de um tempo, dando
        // a impressão de travamento.
        el('repFotoEtapaCorpo').style.display = 'none';
        el('repFotoEtapaLoading').classList.add('show');
        el('repFotoEtapaLoadingTxt').textContent = blob ? 'Enviando foto e salvando...' : 'Salvando...';

        salvarStatus(os, novoStatus, blob).then(() => {
            // Sucesso: troca o spinner por um check por uma fração de
            // segundo, só pra confirmar visualmente, depois fecha.
            el('repFotoEtapaSpinner').style.display = 'none';
            el('repFotoEtapaLoading').insertAdjacentHTML('afterbegin', '<i class="bi bi-check-circle-fill check" id="repFotoEtapaCheck"></i>');
            el('repFotoEtapaLoadingTxt').textContent = 'Pronto!';
            setTimeout(() => {
                fotoEtapaBackdrop.classList.remove('show');
                window._vsDestravarScroll && window._vsDestravarScroll();
                if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
                el('repFotoEtapaCheck')?.remove();
            }, 550);
        }).catch(e => {
            fotoEtapaBackdrop.classList.remove('show');
            window._vsDestravarScroll && window._vsDestravarScroll();
            if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao mudar etapa: ${e.message}` });
            renderLista();
        });
    }

    // ── Lightbox simples (ver foto em tamanho grande) ────────────
    let lightboxBackdrop = null;
    function abrirLightbox(url) {
        if (!lightboxBackdrop) {
            document.body.insertAdjacentHTML('beforeend', `<div class="rep-lightbox-backdrop" id="repLightbox"><img id="repLightboxImg"/></div>`);
            lightboxBackdrop = el('repLightbox');
            lightboxBackdrop.addEventListener('click', () => lightboxBackdrop.classList.remove('show'));
        }
        el('repLightboxImg').src = url;
        lightboxBackdrop.classList.add('show');
    }

    // ── Lightbox do padrão desenhado (a caixinha compacta só mostra
    //    "toque pra ver" — isso abre o desenho de verdade, grande) ──
    let patternLightboxBackdrop = null;
    function abrirPatternLightbox(sequencia) {
        if (!patternLightboxBackdrop) {
            document.body.insertAdjacentHTML('beforeend', `
                <div class="stq-modal-backdrop" id="repPatternLightbox">
                    <div class="stq-modal-card">
                        <div class="stq-modal-header primary">
                            <div class="stq-modal-header-title">Padrão desenhado</div>
                            <button class="stq-modal-close" id="repPatternLightboxClose"><i class="bi bi-x-lg"></i></button>
                        </div>
                        <div class="stq-modal-body" style="display:flex;justify-content:center;">
                            <div class="rep-pattern-wrap lg" id="repPatternLightboxGrid"></div>
                        </div>
                    </div>
                </div>`);
            patternLightboxBackdrop = el('repPatternLightbox');
            const fechar = () => {
                patternLightboxBackdrop.classList.remove('show');
                window._vsDestravarScroll && window._vsDestravarScroll();
                if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
            };
            el('repPatternLightboxClose').addEventListener('click', fechar);
            patternLightboxBackdrop.addEventListener('click', e => { if (e.target.id === 'repPatternLightbox') fechar(); });
            patternLightboxBackdrop._fechar = fechar;
        }
        const gridEl = el('repPatternLightboxGrid');
        if (gridEl && typeof window._reparosRenderPatternGrid === 'function') {
            window._reparosRenderPatternGrid(gridEl, { sequence: sequencia, interactive: false });
        }
        patternLightboxBackdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(patternLightboxBackdrop._fechar);
    }

    // ── Timeline: quando a OS passou por cada etapa, com foto ────
    let timelineBackdrop = null;
    function ensureModalTimeline() {
        if (timelineBackdrop) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="stq-modal-backdrop" id="repModalTimeline">
                <div class="stq-modal-card">
                    <div class="stq-modal-header primary">
                        <div class="stq-modal-header-title">Linha do tempo</div>
                        <button class="stq-modal-close" id="repTimelineClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="repTimelineBody"></div>
                </div>
            </div>`);
        timelineBackdrop = el('repModalTimeline');
        const fechar = () => {
            timelineBackdrop.classList.remove('show');
            window._vsDestravarScroll && window._vsDestravarScroll();
            if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
        };
        el('repTimelineClose').addEventListener('click', fechar);
        timelineBackdrop.addEventListener('click', e => { if (e.target.id === 'repModalTimeline') fechar(); });
        timelineBackdrop._fechar = fechar;
    }
    function abrirTimeline(os) {
        ensureModalTimeline();
        const etapas = FLOWS[os.modo] || [];
        const entradas = Object.entries(os.timeline || {})
            .map(([k, v]) => ({ etapa: k, ...v, meta: flowMeta(os.modo, k) }))
            .sort((a, b) => (a.ts || 0) - (b.ts || 0));
        const body = el('repTimelineBody');
        if (!entradas.length) {
            body.innerHTML = `<p style="font-size:.76rem;color:var(--text-muted);">Nenhum histórico registrado ainda.</p>`;
        } else {
            body.innerHTML = entradas.map(e => `
                <div class="rep-timeline-item">
                    <div class="rep-timeline-dot" style="background:${e.meta ? e.meta.color : '#64748b'};"></div>
                    <div class="rep-timeline-info">
                        <div class="rep-timeline-etapa">${esc(e.meta ? e.meta.label : e.etapa)}</div>
                        <div class="rep-timeline-data">${e.ts ? new Date(e.ts).toLocaleString('pt-BR') : '—'}</div>
                        ${e.fotoUrl ? `<img src="${esc(e.fotoUrl)}" class="rep-timeline-foto" data-ver-foto-timeline="${esc(e.fotoUrl)}"/>` : ''}
                    </div>
                </div>`).join('');
            body.querySelectorAll('[data-ver-foto-timeline]').forEach(img => {
                img.addEventListener('click', () => abrirLightbox(img.dataset.verFotoTimeline));
            });
        }
        timelineBackdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(timelineBackdrop._fechar);
    }

    // ── Entrada pública ──────────────────────────────────────────
    // Roda toda vez que a tela de Concertos é (re)aberta — inclusive
    // logo depois de cadastrar uma OS nova. Reseta o filtro pro
    // padrão ("Ativos") aqui: sem isso, um filtro específico (tipo
    // "Aguardando Peça") ficava grudado da visita anterior, e uma OS
    // nova nascida em "Na Fila" simplesmente não aparecia — parecia
    // que a OS tinha sumido, quando na real só estava filtrada.
    //
    // contexto.focarId (vindo do clique em "Ver OS" numa notificação
    // de reparo atrasado — ver notificacoes-central.js) já chega
    // abrindo o card daquela OS expandido e rola até ele, em vez de
    // levar pro formulário de edição.
    function renderReparosLista(contexto) {
        filtroAtivo = 'ativos';
        limiteExibicao = LIMITE_PAGINA;
        ensureSkeleton();
        const focarId = contexto && contexto.focarId;
        if (focarId) {
            expandedId = focarId;
            scrollParaId = focarId;
        }
        carregarOS();
        renderLista();
    }
    window._renderReparosLista = renderReparosLista;
})();
