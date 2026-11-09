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
//   openReparosSection, openConfiguracoesSection, _reparosAbrirModalDoc,
//   _reparosAbrirWizardEntrega, _storageDeleteObject, _lojaStorageRef, _nomeUsuario
//
// Dois visuais, uma lógica: no celular (data-shell="mobile") a lista tem
// contadores, cartões com fotos, linha do tempo e folhas de baixo (blocos
// "if (MOB)" e funções "...Mob"); no computador continua como sempre foi.
// Dados, permissões e gravações são os mesmos nos dois.
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

    // ── Celular: ícones, cores e textos de cada etapa ───────────
    const MOB = document.documentElement.getAttribute('data-shell') === 'mobile';
    const ic = nome => `<svg class="vs-ic" width="1em" height="1em" aria-hidden="true"><use href="#vsi-${nome}"/></svg>`;

    // Cores = tokens do tema (claro/escuro). ver = texto da linha do tempo;
    // acao = nome do botão que LEVA a OS pra essa etapa; chip = rótulo curto do filtro.
    const CZ = {
        fila:            { ic: 'inbox', cor: 'var(--text-secondary)', ver: 'OS cadastrada' },
        levar_tecnico:   { ic: 'truck', cor: 'var(--danger)',         ver: 'OS cadastrada' },
        em_reparo:       { ic: 'tool',  cor: 'var(--warning)' },
        aguardando_peca: { ic: 'box',   cor: 'var(--rep-peca)',       ver: 'Aguardando peça', acao: 'Aguardando peça' },
        finalizado:      { ic: 'shop',  cor: 'var(--primary)',        ver: 'Reparo finalizado', acao: 'Finalizar reparo', chip: 'Finalizado' },
        fin_loja:        { ic: 'shop',  cor: 'var(--primary)',        ver: 'Retornou à loja', acao: 'Retornou à Loja', chip: 'Fin. Loja' },
        entregue:        { ic: 'ok',    cor: 'var(--success)',        ver: 'Entregue ao cliente', acao: 'Entregar ao Cliente' },
    };
    const CZ_EM_REPARO = {
        terceirizada: { ver: 'Entregue ao técnico', acao: 'Entregar ao Técnico' },
        propria:      { ver: 'Reparo iniciado',     acao: 'Iniciar reparo' },
    };
    function czEtapa(modo, k) {
        const base = CZ[k] || { ic: 'tool', cor: 'var(--text-secondary)' };
        const meta = flowMeta(modo, k);
        const label = meta ? meta.label : k;
        const extra = k === 'em_reparo' ? (CZ_EM_REPARO[modo] || CZ_EM_REPARO.terceirizada) : {};
        const r = { ...base, ...extra, label };
        r.ver = r.ver || label;
        r.acao = r.acao || `Mover para ${label}`;
        return r;
    }

    const fmtDia   = ts => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const fmtHora  = ts => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const fmtDiaHora = ts => `${new Date(ts).toLocaleDateString('pt-BR')} ${fmtHora(ts)}`;
    const fmtDinheiro = n => typeof window._fmt === 'function' ? window._fmt(n) : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    function fmtTelefone(t) {
        const d = String(t || '').replace(/\D/g, '');
        if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
        if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
        return String(t || '');
    }
    function linkWhatsApp(t) {
        let d = String(t || '').replace(/\D/g, '');
        if (!d) return null;
        if (!d.startsWith('55') || d.length <= 11) d = '55' + d;
        return `https://wa.me/${d}`;
    }
    // Tempo desde o cadastro: "5h" até 24h, depois "3d".
    function idadeOS(os) {
        if (!os.criadoEm) return '';
        const h = (Date.now() - os.criadoEm) / 3600000;
        return h < 24 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`;
    }
    function textoAtraso(os) {
        const h = Math.abs(Math.round((os.prazoTs - Date.now()) / 3600000));
        return h >= 72 ? `${Math.round(h / 24)}d atraso` : `${Math.max(1, h)}h atraso`;
    }
    // Registro da linha do tempo, na ordem em que aconteceram.
    function entradasTimeline(os) {
        return Object.entries(os.timeline || {})
            .map(([k, v]) => ({ etapa: k, ...v }))
            .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    }

    // Fotos de cada etapa do histórico: na primeira (cadastro) entram também as de chegada.
    // OS antiga sem histórico mas com fotos de chegada ganha uma entrada só pra elas (índice -1).
    function fotosDaEntrada(os, entradas, i) {
        const chegada = Array.isArray(os.fotosChegada) ? os.fotosChegada : [];
        const urls = (i <= 0 ? chegada : []).concat(i >= 0 && entradas[i] && entradas[i].fotoUrl ? [entradas[i].fotoUrl] : []);
        return urls.filter((u, k) => urls.indexOf(u) === k);
    }

    let mounted = false;
    let todasOS = [];
    let carregado = false;   // já chegou o primeiro retrato da lista (antes disso "vazio" seria mentira)
    let erroCarga = false;
    let filtroAtivo = 'ativos';
    let expandedId = null;
    const abaPorOS = {}; // { [repairId]: 'info' | 'hist' } — aba aberta no card do celular (zera ao abrir de novo)
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
        if (MOB) {
            // Celular: o "+" sai do cabeçalho (o botão do meio da barra vira "Novo concerto"
            // aqui dentro) e entra a engrenagem das configurações, só pro Gestor.
            container.innerHTML = `
                <div class="section-header">
                    <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                    <h3>Concertos</h3>
                    ${ehGestor() ? `<button type="button" class="btn-icon-circle" id="repCfgBtn" aria-label="Configurações de Concertos">${ic('gear')}</button>` : ''}
                </div>
                <div class="rep-kpis" id="repKpis"></div>
                <label class="rep-busca">${ic('search')}<input type="text" id="repBusca" placeholder="Buscar cliente ou defeito..." autocomplete="off" aria-label="Buscar cliente ou defeito"/></label>
                <div class="rep-chips" id="repFiltros" role="group" aria-label="Filtro por etapa"></div>
                <div class="rep-lista" id="repList"></div>
            `;
            el('repCfgBtn')?.addEventListener('click', () => {
                if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesReparos');
            });
            // Contadores e chips são refeitos a cada render: um ouvinte só, no contêiner.
            ['repKpis', 'repFiltros'].forEach(id => el(id).addEventListener('click', e => {
                const b = e.target.closest('[data-filtro]');
                if (!b) return;
                filtroAtivo = b.dataset.filtro;
                expandedId = null;
                limiteExibicao = LIMITE_PAGINA;
                renderLista();
            }));
        } else {
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
        }

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
    // Uma única assinatura da lista inteira, compartilhada com a Início (_reparosAguardar):
    // começa assim que o modo dos Concertos é conhecido, então quando a pessoa abre a tela
    // os dados já chegaram (ou estão chegando) e a Início não baixa tudo de novo a cada visita.
    let assinatura = null;
    function carregarOS() {
        if (assinatura) return assinatura;
        erroCarga = false;
        assinatura = new Promise((ok, falha) => {
            window._dbOnValue(window._lojaRef('reparos'), snap => {
                const dados = snap.val() || {};
                todasOS = Object.keys(dados).map(id => ({ id, ...dados[id] }));
                carregado = true;
                ok(todasOS);
                if (mounted) renderLista();
            }, err => {
                console.error('[Concertos] leitura da lista recusada:', err && err.code, err);
                erroCarga = true;
                assinatura = null;   // a próxima abertura tenta de novo
                falha(err);
                if (mounted) renderLista();
            });
        });
        assinatura.catch(() => {});   // quem não trata o erro não gera "unhandled rejection"
        return assinatura;
    }
    window._reparosPreCarregar = carregarOS;
    window._reparosAguardar = carregarOS;

    // ── Prazo: calculado em cima do status, não é um status em si ──
    function prazoInfo(os) {
        if (os.status === 'entregue' || !os.prazoTs) return null;
        const diffH = (os.prazoTs - Date.now()) / 3600000;
        if (diffH < 0) return { cls: 'atrasado', label: `${Math.abs(Math.round(diffH))}h atraso` };
        if (diffH < 24) return { cls: 'proximo', label: `${Math.round(diffH)}h restantes` };
        return { cls: 'ok', label: new Date(os.prazoTs).toLocaleDateString('pt-BR') };
    }

    // Um filtro só pra lista, pros contadores e pros chips. "prazo" = vence em menos de 24h.
    function passaFiltro(o, k) {
        const ativa = o.status !== 'entregue';
        if (k === 'ativos') return ativa;
        if (k === 'atrasados') return ativa && !!o.prazoTs && o.prazoTs < Date.now();
        if (k === 'prazo') return ativa && !!o.prazoTs && o.prazoTs >= Date.now() && (o.prazoTs - Date.now()) < 86400000;
        return o.status === k;
    }

    // ── Celular: contadores grandes + chips que quebram em linhas ──
    function renderFiltrosMob(modo) {
        const etapas = FLOWS[modo] || [];
        const ini = etapas[0] ? etapas[0].k : 'fila';
        const fin = (etapas.find(s => s.k === 'finalizado' || s.k === 'fin_loja') || {}).k || 'finalizado';
        const terc = modo === 'terceirizada';
        const kpis = [
            { k: ini,         l: terc ? 'Levar técnico' : 'Na fila', c: czEtapa(modo, ini).cor },
            { k: 'em_reparo', l: 'Em reparo',   c: 'var(--warning)' },
            { k: 'atrasados', l: 'Atrasadas',   c: 'var(--danger)' },
            { k: 'prazo',     l: 'Próx. prazo', c: 'var(--warning)' },
            { k: fin,         l: terc ? 'Voltou à loja' : 'Prontas', c: 'var(--success)' },
        ];
        const kpisEl = el('repKpis');
        if (kpisEl) {
            kpisEl.innerHTML = kpis.map(c => `
                <button type="button" class="rep-kpi" data-filtro="${c.k}" style="--c:${c.c}" aria-pressed="${filtroAtivo === c.k}">
                    <b>${carregado ? todasOS.filter(o => passaFiltro(o, c.k)).length : '–'}</b><span>${c.l}</span>
                </button>`).join('');
        }
        const chips = [
            { k: 'ativos', l: 'Ativos' },
            ...etapas.filter(s => s.k !== 'entregue').map(s => ({ k: s.k, l: CZ[s.k] && CZ[s.k].chip || s.label })),
            { k: 'prazo', l: 'Prazo', i: 'clock' },
            { k: 'atrasados', l: 'Atrasado', i: 'warn', cls: ' atrasado' },
            { k: 'entregue', l: 'Entregue', i: 'ok' },
        ];
        const wrap = el('repFiltros');
        if (wrap) {
            wrap.innerHTML = chips.map(c => `
                <button type="button" class="rep-chip${c.cls || ''}" data-filtro="${c.k}" aria-pressed="${filtroAtivo === c.k}">${c.i ? ic(c.i) : ''}${c.l}</button>`).join('');
        }
    }

    // ── Filtros (chips) ──────────────────────────────────────────
    function renderFiltrosEFlowLabel() {
        if (MOB) { renderFiltrosMob((window._reparosConfig || {}).modo || 'terceirizada'); return; }
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
        // Celular: a OS aberta mudou de etapa (avançou, voltou, foi entregue) e saiu do filtro
        // atual. Em vez de sumir da tela, volta pra "Ativos" e mantém o cartão aberto;
        // entregue não aparece em "Ativos", então só fecha.
        if (MOB && expandedId) {
            const aberta = todasOS.find(o => o.id === expandedId);
            if (aberta && !passaFiltro(aberta, filtroAtivo)) {
                if (aberta.status === 'entregue') expandedId = null; else filtroAtivo = 'ativos';
            }
        }
        renderFiltrosEFlowLabel();
        const listEl = el('repList');
        if (!listEl) return;

        if (MOB && !carregado) {   // ainda baixando (ou falhou): nunca mostrar "Nenhum concerto"
            listEl.innerHTML = erroCarga
                ? `<div class="rep-vazio"><b>Não foi possível carregar</b>Confira a conexão e abra Concertos de novo.</div>`
                : [0, 1, 2].map(() => `<div class="rep-card rep-sk" aria-hidden="true"><div class="rep-card-top"><div class="rep-card-foto"></div><div class="rep-card-info"><span class="rep-sk-l"></span><span class="rep-sk-l curto"></span></div></div></div>`).join('');
            return;
        }

        let itens = todasOS.filter(o => passaFiltro(o, filtroAtivo));

        const termoBusca = (el('repBusca')?.value || '').trim().toLowerCase();
        if (termoBusca) {
            itens = itens.filter(o =>
                (o.cliente?.nome || '').toLowerCase().includes(termoBusca) ||
                (o.aparelho || '').toLowerCase().includes(termoBusca) ||
                (MOB && (o.defeito || '').toLowerCase().includes(termoBusca))
            );
        }

        // Mais urgente primeiro: atrasado > próximo > resto, por prazo
        itens.sort((a, b) => (a.prazoTs || Infinity) - (b.prazoTs || Infinity));

        if (!itens.length && MOB) {
            listEl.innerHTML = `
                <div class="rep-vazio">
                    <b>${termoBusca ? 'Nada encontrado' : 'Nenhum concerto aqui'}</b>
                    ${termoBusca ? 'Tente outro nome, aparelho ou defeito.' : (tp('reparos_criar') ? 'Toque em Novo concerto para cadastrar.' : 'Nenhuma OS nesse filtro.')}
                </div>`;
            return;
        }
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

        listEl.innerHTML = visiveis.map(o => MOB ? buildCardMob(o) : buildCard(o)).join('')
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

    // ── Celular: cartão da lista ─────────────────────────────────
    function buildCardMob(os) {
        const e = czEtapa(os.modo, os.status);
        const prazo = prazoInfo(os);
        const expandido = expandedId === os.id;
        const atrasada = !!prazo && prazo.cls === 'atrasado';
        const proximo = !!prazo && prazo.cls === 'proximo';
        const idade = os.status !== 'entregue' ? idadeOS(os) : '';
        const foto = os.fotoThumbUrl
            ? `<img src="${esc(os.fotoThumbUrl)}" loading="lazy" alt=""/>`
            : ic('phone');
        return `
        <article class="rep-card${expandido ? ' expanded' : ''}${atrasada ? ' atrasada' : ''}" data-id="${os.id}" style="--c:${e.cor}">
            <div class="rep-card-main" data-action="toggle" role="button" tabindex="0" aria-expanded="${expandido}">
                <div class="rep-card-top">
                    <span class="rep-card-foto">${foto}</span>
                    <span class="rep-card-info">
                        <span class="rep-card-nome">${esc(os.cliente?.nome || 'Sem nome')}</span>
                        <span class="rep-card-apar">${ic('phone')}<span>${esc(os.aparelho || 'Aparelho não informado')}</span></span>
                    </span>
                    <span class="rep-card-chev">${ic('chev')}</span>
                </div>
                <div class="rep-card-mid">
                    <span class="rep-pill"><i></i>${esc(e.label)}</span>
                    ${atrasada ? `<span class="rep-prz atrasado">${ic('warn')}${textoAtraso(os)}</span>` : ''}
                    ${proximo ? `<span class="rep-prz proximo">${ic('clock')}${Math.max(1, Math.round((os.prazoTs - Date.now()) / 3600000))}h restantes</span>` : ''}
                    ${idade ? `<span class="rep-prz">${ic('clock')}${idade}</span>` : ''}
                </div>
            </div>
            <div class="rep-row-panel" style="display:${expandido ? 'block' : 'none'};"></div>
        </article>`;
    }

    // Etapa anterior pra "Desfazer": só vale se a OS não foi entregue (a venda já foi lançada),
    // se a última entrada do histórico é a etapa atual e se a anterior é de fato uma etapa
    // ANTERIOR do fluxo (uma troca manual pra trás deixa histórico fora de ordem).
    function etapaAnterior(os) {
        if (os.status === 'entregue') return null;
        const entradas = entradasTimeline(os);
        if (entradas.length < 2 || entradas[entradas.length - 1].etapa !== os.status) return null;
        const anterior = entradas[entradas.length - 2];
        const etapas = FLOWS[os.modo] || [];
        const iAnt = etapas.findIndex(s => s.k === anterior.etapa);
        const iAtual = etapas.findIndex(s => s.k === os.status);
        return iAnt >= 0 && iAtual >= 0 && iAnt < iAtual ? anterior : null;
    }

    function renderPainelMob(panel, os) {
        const fotos = Array.isArray(os.fotosChegada) ? os.fotosChegada : [];
        const entregue = os.status === 'entregue';
        const prazo = prazoInfo(os);
        const atrasada = !!prazo && prazo.cls === 'atrasado';
        const entradas = entradasTimeline(os);
        const proxima = entregue ? null : proximaEtapaSequencial(os);
        const podeAvancar = tp('reparos_avancar_etapa');
        const podeManual = tp('reparos_mudar_etapa_manual');

        const cel = (cls, icone, rotulo, valor) => `
            <div class="rep-ig${cls ? ' ' + cls : ''}"><span class="rep-ig-ib">${ic(icone)}</span><span class="rep-ig-it"><small>${rotulo}</small><b>${valor}</b></span></div>`;
        const entregaEm = entregue && os.timeline && os.timeline.entregue && os.timeline.entregue.ts;
        const celEntrega = entregue
            ? cel('ok', 'ok', 'Entregue em', entregaEm ? `${fmtDia(entregaEm)} ${fmtHora(entregaEm)}` : '—')
            : cel(atrasada ? 'atrasada' : '', 'flag', 'Entrega', os.prazoTs ? `${fmtDia(os.prazoTs)} ${fmtHora(os.prazoTs)}` : 'Sem prazo');
        const atendente = os.criadoPorNome || (entradas[0] && entradas[0].nome) || '—';
        const tel = os.cliente && os.cliente.telefone;

        const botaoFotos = (i, titulo) => {
            const n = fotosDaEntrada(os, entradas, i).length;
            return n ? `<button type="button" class="rep-vf" data-ver-fotos="${i}" data-titulo="${esc(titulo)}">${ic('img')}${n === 1 ? 'Ver foto' : `Ver ${n} fotos`}</button>` : '';
        };
        const tl = entradas.map((t, i) => {
            const x = czEtapa(os.modo, t.etapa);
            return `
            <div class="rep-tl-it" style="--c:${x.cor}">
                <span class="rep-tl-dot">${ic(x.ic)}</span>
                <div class="rep-tl-tx">
                    <div class="rep-tl-t">${esc(x.ver)}</div>
                    <div class="rep-tl-d">${t.ts ? fmtDiaHora(t.ts) : '—'}${t.nome ? ' · ' + esc(t.nome) : ''}</div>
                    ${botaoFotos(i, x.ver)}
                </div>
            </div>`;
        }).join('') || (fotos.length ? `
            <div class="rep-tl-it" style="--c:var(--text-muted)">
                <span class="rep-tl-dot">${ic('cam')}</span>
                <div class="rep-tl-tx"><div class="rep-tl-t">Fotos de chegada</div>${botaoFotos(-1, 'Chegada')}</div>
            </div>` : '');
        const nx = proxima ? (() => {
            const x = czEtapa(os.modo, proxima.k);
            return `
            <div class="rep-tl-it proxima" style="--c:${x.cor}">
                <span class="rep-tl-dot">${ic(x.ic)}</span>
                <div class="rep-tl-tx"><div class="rep-tl-t">Próxima: ${esc(x.label)}</div></div>
            </div>`;
        })() : '';
        const totalFotos = (entradas.length ? entradas.map((_, i) => fotosDaEntrada(os, entradas, i).length) : [fotos.length]).reduce((a, b) => a + b, 0);
        const aba = abaPorOS[os.id] === 'hist' ? 'hist' : 'info';

        const ferramentas = [];
        if (podeAvancar && etapaAnterior(os)) ferramentas.push(`<button type="button" class="rep-tb" data-action="desfazer">${ic('undo')}Desfazer</button>`);
        if (entregue) {
            if (typeof window._reparosAbrirModalDoc === 'function') ferramentas.push(`<button type="button" class="rep-tb" data-action="comprovante">${ic('doc')}Comprovante</button>`);
        } else if (linkWhatsApp(tel)) {
            ferramentas.push(`<button type="button" class="rep-tb wa" data-action="whatsapp">${ic('wa')}WhatsApp</button>`);
        }
        if (tp('reparos_editar')) ferramentas.push(`<button type="button" class="rep-tb" data-action="editar">${ic('edit')}Editar</button>`);
        if (tp('reparos_apagar')) ferramentas.push(`<button type="button" class="rep-tb apagar" data-action="apagar">${ic('trash')}Apagar</button>`);

        const botaoPrincipal = !podeAvancar ? ''
            : entregue ? `<button type="button" class="rep-btn-pri" disabled>${ic('ok')}OS entregue</button>`
            : proxima ? `<button type="button" class="rep-btn-pri" data-action="avancar">${esc(czEtapa(os.modo, proxima.k).acao)}</button>` : '';
        const botaoManual = podeManual ? `<button type="button" class="rep-btn-sq" data-action="toggle-manual" aria-label="Escolher etapa manualmente">${ic('more')}</button>` : '';

        panel.innerHTML = `
        <div class="rep-painel">
            <div class="rep-abas" role="tablist">
                <button type="button" class="rep-aba${aba === 'info' ? ' on' : ''}" role="tab" data-aba="info">${ic('doc')}Informações</button>
                <button type="button" class="rep-aba${aba === 'hist' ? ' on' : ''}" role="tab" data-aba="hist">${ic('clock')}Histórico${totalFotos ? `<b>${totalFotos}</b>` : ''}</button>
            </div>
            <div class="rep-pg${aba === 'info' ? ' on' : ''}" data-pg="info">
                <div class="rep-defeito"><span class="rep-lbl">Defeito</span><p>${esc(os.defeito || '—')}</p></div>
                <div class="rep-info-grid">
                    ${cel('', 'cal', 'Cadastro', os.criadoEm ? new Date(os.criadoEm).toLocaleDateString('pt-BR') : '—')}
                    ${celEntrega}
                    ${cel('', 'money', 'Valor', os.valorCobrado ? fmtDinheiro(os.valorCobrado) : '—')}
                    ${cel('', 'user', 'Atendente', esc(atendente))}
                </div>
                <div class="rep-senha" id="repSenhaMini-${os.id}"><span class="rep-senha-txt">Carregando senha...</span></div>
                ${(botaoPrincipal || botaoManual) ? `<div class="rep-acts">${botaoPrincipal}${botaoManual}</div>` : ''}
                ${ferramentas.length ? `<div class="rep-tools" style="--n:${ferramentas.length}">${ferramentas.join('')}</div>` : ''}
            </div>
            <div class="rep-pg${aba === 'hist' ? ' on' : ''}" data-pg="hist">
                ${(tl || nx) ? `<div class="rep-tl">${tl}${nx}</div>` : `<div class="rep-sem-foto">Nenhum histórico registrado ainda.</div>`}
            </div>
        </div>`;
        carregarSenha(os);
    }

    // ── Painel expandido — montado sob demanda, só quando o card abre ──
    function renderPainel(panel, os) {
        if (MOB) { renderPainelMob(panel, os); return; }
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
            const conteudo = MOB ? miniCard : miniCard.querySelector('.conteudo');
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
    function renderSenhaMob(box, senha) {
        if (!senha || senha.tipo === 'nenhuma') {
            box.innerHTML = `${ic('key')}<span class="rep-senha-txt">Sem senha</span>`;
        } else if (senha.tipo === 'senha' || senha.tipo === 'pin') {
            box.innerHTML = `${ic('key')}<span class="rep-senha-txt">${senha.tipo === 'pin' ? 'PIN' : 'Senha'}</span><code>${esc(senha.valor || '')}</code>`;
        } else if (senha.tipo === 'padrao') {
            box.innerHTML = `<button type="button" class="rep-senha-btn" data-action="padrao">${ic('grid')}<span class="rep-senha-txt">Padrão desenhado</span><span class="rep-senha-mais">Toque para ampliar</span></button>`;
        } else {
            box.innerHTML = '';
        }
    }

    function renderSenhaMini(miniCard, senha) {
        if (MOB) { renderSenhaMob(miniCard, senha); return; }
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
            payload['timeline/' + novoStatus] = { ts: Date.now(), uid: window._firebaseAuthUid || null, nome: window._nomeUsuario || null };
            if (fotoUrl) payload['timeline/' + etapaSendoConcluida + '/fotoUrl'] = fotoUrl;
            return window._dbUpdate(window._lojaRef('reparos/' + os.id), payload);
        };
        const promessa = fotoBlob
            ? window._uploadFotoStorage(fotoBlob, `reparos/${os.id}/etapas/${etapaSendoConcluida}.jpg`).then(aplicar)
            : aplicar(null);
        return promessa; // quem chama decide o que fazer com sucesso/erro
    }
    window._reparosSalvarStatus = salvarStatus;

    function excluirOS(os) {
        return Promise.all([
            window._dbRemove(window._lojaRef('reparos/' + os.id)),
            window._dbRemove(window._reparosSenhaRef(os.id)).catch(() => {}), // pode não existir/não ter permissão de escrita — não trava a exclusão principal por isso
        ]).then(() => {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'OS apagada.' });
        }).catch(e => {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao apagar: ${e.message}` });
        });
    }

    function apagarOS(os) {
        if (MOB) { abrirFolhaApagar(os); return; }
        if (typeof window.showCustomModal === 'function') {
            window.showCustomModal({
                message: `Apagar a OS de "${os.cliente?.nome || 'cliente'}"? Isso remove os dados e a senha salva do aparelho — não dá pra desfazer.`,
                confirmText: 'Apagar', cancelText: 'Cancelar',
                onConfirm: () => excluirOS(os)
            });
        } else if (confirm('Apagar essa OS? Não dá pra desfazer.')) {
            excluirOS(os);
        }
    }

    // ── Celular: Desfazer etapa ──────────────────────────────────
    // Lê a OS de novo antes de gravar: se outra pessoa mexeu nela enquanto a folha
    // estava aberta, não desfaz às cegas. Apaga a etapa atual do histórico e a foto
    // tirada ao sair da anterior, e volta o status.
    function desfazerEtapa(os) {
        const ref = window._lojaRef('reparos/' + os.id);
        return window._dbGet(ref).then(snap => {
            const dados = snap.val();
            if (!dados) throw new Error('Essa OS não existe mais.');
            const fresca = { id: os.id, ...dados };
            if (fresca.status !== os.status) throw new Error('Essa OS mudou de etapa enquanto você olhava. Confira e tente de novo.');
            const anterior = etapaAnterior(fresca);
            if (!anterior) throw new Error('Não há etapa anterior para voltar.');
            const payload = { status: anterior.etapa };
            payload['timeline/' + fresca.status] = null;
            payload['timeline/' + anterior.etapa + '/fotoUrl'] = null;
            return window._dbUpdate(ref, payload).then(() => {
                // A foto saiu do histórico; apagar o arquivo é só faxina (se a regra do Storage recusar, sobra um arquivo solto).
                if (anterior.fotoUrl && typeof window._storageDeleteObject === 'function' && typeof window._lojaStorageRef === 'function') {
                    try { Promise.resolve(window._storageDeleteObject(window._lojaStorageRef(`reparos/${os.id}/etapas/${anterior.etapa}.jpg`))).catch(() => {}); } catch (e) { /* faxina opcional */ }
                }
                return anterior;
            });
        });
    }

    // ── Celular: folha de baixo (mesma do "Meta do mês"/"Editar barra") ──
    let folhaEl = null;
    let folhaTrava = false;     // salvando: não deixa fechar por fora
    let folhaComHistorico = false;
    function abrirFolha(html) {
        if (!folhaEl) {
            folhaEl = document.createElement('div');
            folhaEl.id = 'repFolha';
            folhaEl.className = 'vs-folha-overlay';
            folhaEl.innerHTML = '<div class="vs-folha" role="dialog" aria-modal="true"></div>';
            document.body.appendChild(folhaEl);
            folhaEl.addEventListener('click', e => { if (e.target === folhaEl) fecharFolha(); });
        }
        const caixa = folhaEl.firstElementChild;
        caixa.innerHTML = '<div class="vs-folha-alca"></div>' + html;
        caixa.scrollTop = 0;
        folhaTrava = false;
        if (!folhaEl.classList.contains('active')) {
            void folhaEl.offsetWidth;   // sem o reflow a entrada não anima
            folhaEl.classList.add('active');
            window._vsTravarScroll && window._vsTravarScroll();
            if (typeof window._vsAbrirModal === 'function') { window._vsAbrirModal(fecharFolha); folhaComHistorico = true; }
        }
        return caixa;
    }
    function fecharFolha(forcar) {
        if (!folhaEl || !folhaEl.classList.contains('active')) return;
        if (folhaTrava && forcar !== true) return;
        folhaEl.classList.remove('active');
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (folhaComHistorico) { folhaComHistorico = false; if (typeof window._vsFecharModal === 'function') window._vsFecharModal(); }
    }
    // Fecha a folha e SÓ DEPOIS abre outra janela com histórico própria (o assistente de entrega):
    // fechar desfaz uma entrada do histórico de forma assíncrona, e abrir antes disso faria o
    // "voltar" atrasado fechar a janela nova.
    function fecharFolhaEDepois(fn) {
        const esperar = folhaComHistorico;
        fecharFolha(true);
        if (!esperar) { fn(); return; }
        let feito = false;
        const rodar = () => { if (!feito) { feito = true; fn(); } };
        window.addEventListener('popstate', () => setTimeout(rodar, 0), { once: true });
        setTimeout(rodar, 400);
    }
    function avisar(msg) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: msg }); }

    function folhaSalvando(texto) {
        folhaTrava = true;
        folhaEl.firstElementChild.innerHTML = `<div class="vs-folha-alca"></div><div class="rep-salvando"><div class="rep-spin"></div><span>${texto}</span></div>`;
    }

    function abrirFolhaFotoEtapa(os, novoStatus) {
        const info = czEtapa(os.modo, novoStatus);
        const seq = proximaEtapaSequencial(os);
        const titulo = seq && seq.k === novoStatus ? info.acao : `Mover para ${info.label}`;
        let blob = null;
        const caixa = abrirFolha(`
            <div class="vs-folha-titulo">${esc(titulo)}</div>
            <div class="vs-folha-sub">${esc(motivoFoto(os.status, novoStatus))}</div>
            <div class="rep-prev" id="repFolhaPrev">${ic('cam')}<span>Nenhuma foto ainda</span></div>
            <div class="rep-duo">
                <button type="button" id="repFolhaCam">${ic('cam')}Câmera</button>
                <button type="button" id="repFolhaGal">${ic('img')}Galeria</button>
            </div>
            <input type="file" accept="image/*" capture="environment" id="repFolhaInCam" class="hidden">
            <input type="file" accept="image/*" id="repFolhaInGal" class="hidden">
            <button type="button" class="rep-btn-pri" id="repFolhaConf" disabled>Confirmar com foto</button>
            <button type="button" class="rep-pular" id="repFolhaPular">Pular sem foto</button>`);
        const onArquivo = ev => {
            const arquivo = ev.target.files && ev.target.files[0];
            if (!arquivo) return;
            blob = arquivo;
            const leitor = new FileReader();
            leitor.onload = r => { caixa.querySelector('#repFolhaPrev').innerHTML = `<img src="${r.target.result}" alt=""/>`; };
            leitor.readAsDataURL(arquivo);
            caixa.querySelector('#repFolhaConf').disabled = false;
        };
        caixa.querySelector('#repFolhaInCam').addEventListener('change', onArquivo);
        caixa.querySelector('#repFolhaInGal').addEventListener('change', onArquivo);
        caixa.querySelector('#repFolhaCam').addEventListener('click', () => caixa.querySelector('#repFolhaInCam').click());
        caixa.querySelector('#repFolhaGal').addEventListener('click', () => caixa.querySelector('#repFolhaInGal').click());
        const confirmar = comFoto => {
            const arquivo = comFoto ? blob : null;
            folhaSalvando(arquivo ? 'Enviando foto e salvando...' : 'Salvando...');
            salvarStatus(os, novoStatus, arquivo).then(() => {
                fecharFolha(true);
                avisar('Etapa registrada com sucesso');
            }).catch(e => {
                fecharFolha(true);
                avisar(`Erro ao mudar etapa: ${e.message}`);
                renderLista();
            });
        };
        caixa.querySelector('#repFolhaConf').addEventListener('click', () => confirmar(true));
        caixa.querySelector('#repFolhaPular').addEventListener('click', () => confirmar(false));
    }

    function abrirFolhaManual(os) {
        const etapas = FLOWS[os.modo] || [];
        const caixa = abrirFolha(`
            <div class="vs-folha-titulo">Escolher etapa</div>
            <div class="vs-folha-sub">Só quem tem a permissão "Escolher etapa manualmente" vê esta opção.</div>
            <div id="repFolhaOpcoes">${etapas.map(s => {
                const x = czEtapa(os.modo, s.k);
                const atual = s.k === os.status;
                return `<button type="button" class="rep-opc${atual ? ' atual' : ''}" data-etapa-opcao="${s.k}" style="--c:${x.cor}">
                    <span class="rep-tl-dot">${ic(x.ic)}</span>
                    <span class="rep-opc-nome">${esc(x.label)}${s.opcional ? '<small>opcional</small>' : ''}</span>
                    ${atual ? ic('ok') : ''}
                </button>`;
            }).join('')}</div>`);
        caixa.querySelector('#repFolhaOpcoes').addEventListener('click', e => {
            const b = e.target.closest('[data-etapa-opcao]');
            if (!b) return;
            const novo = b.dataset.etapaOpcao;
            if (novo === os.status) { fecharFolha(); return; }
            if (novo === 'entregue') fecharFolhaEDepois(() => abrirFluxoMudancaEtapa(os, novo));
            else abrirFolhaFotoEtapa(os, novo);   // troca o conteúdo da própria folha
        });
    }

    function abrirFolhaDesfazer(os) {
        const anterior = etapaAnterior(os);
        if (!anterior) { avisar('Não há etapa anterior para voltar.'); return; }
        const de = czEtapa(os.modo, os.status).label, para = czEtapa(os.modo, anterior.etapa).label;
        const caixa = abrirFolha(`
            <div class="vs-folha-titulo">Voltar para ${esc(para)}?</div>
            <div class="vs-folha-sub">A etapa "${esc(de)}" e a foto de "${esc(para)}" saem da linha do tempo. A OS volta para "${esc(para)}".</div>
            <button type="button" class="rep-btn-pri perigo" id="repFolhaOk">Desfazer etapa</button>
            <button type="button" class="rep-pular" id="repFolhaNao">Cancelar</button>`);
        caixa.querySelector('#repFolhaNao').addEventListener('click', () => fecharFolha());
        caixa.querySelector('#repFolhaOk').addEventListener('click', () => {
            folhaSalvando('Desfazendo...');
            desfazerEtapa(os).then(() => {
                fecharFolha(true);
                avisar('Etapa desfeita com sucesso');
            }).catch(e => {
                fecharFolha(true);
                avisar(`Erro ao desfazer: ${e.message}`);
            });
        });
    }

    function abrirFolhaApagar(os) {
        const primeiro = (os.cliente && os.cliente.nome || 'cliente').split(/\s+/)[0];
        const caixa = abrirFolha(`
            <div class="vs-folha-titulo">Apagar a OS de ${esc(primeiro)}?</div>
            <div class="vs-folha-sub">Remove os dados e a senha salva do aparelho. Não dá para desfazer.</div>
            <button type="button" class="rep-btn-pri perigo" id="repFolhaOk">Apagar</button>
            <button type="button" class="rep-pular" id="repFolhaNao">Cancelar</button>`);
        caixa.querySelector('#repFolhaNao').addEventListener('click', () => fecharFolha());
        caixa.querySelector('#repFolhaOk').addEventListener('click', () => {
            folhaSalvando('Apagando...');
            excluirOS(os).then(() => fecharFolha(true));
        });
    }

    function abrirFolhaPadrao(sequencia) {
        const caixa = abrirFolha(`
            <div class="vs-folha-titulo">Padrão desenhado</div>
            <div class="vs-folha-sub">Sequência usada para desbloquear o aparelho.</div>
            <div class="rep-pattern-wrap lg" id="repFolhaPadrao"></div>
            <button type="button" class="rep-pular" id="repFolhaNao">Fechar</button>`);
        const grade = caixa.querySelector('#repFolhaPadrao');
        if (typeof window._reparosRenderPatternGrid === 'function') window._reparosRenderPatternGrid(grade, { sequence: sequencia, interactive: false });
        caixa.querySelector('#repFolhaNao').addEventListener('click', () => fecharFolha());
    }

    function wireCardEvents(listEl, itens) {
        listEl.querySelectorAll('.rep-card').forEach(card => {
            const id = card.dataset.id;
            const os = itens.find(o => o.id === id);
            if (!os) return;

            const alternar = () => {
                const panel = card.querySelector('.rep-row-panel');
                const abrindo = expandedId !== os.id;
                expandedId = abrindo ? os.id : null;
                if (abrindo) delete abaPorOS[os.id];
                listEl.querySelectorAll('.rep-card').forEach(c => {
                    c.classList.remove('expanded');
                    if (MOB) c.querySelector('.rep-card-main').setAttribute('aria-expanded', 'false');
                });
                listEl.querySelectorAll('.rep-row-panel').forEach(p => { p.style.display = 'none'; });
                if (abrindo) {
                    card.classList.add('expanded');
                    if (MOB) card.querySelector('.rep-card-main').setAttribute('aria-expanded', 'true');
                    panel.style.display = 'block';
                    renderPainel(panel, os);
                    if (MOB) requestAnimationFrame(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                }
            };
            const cabeca = card.querySelector('[data-action="toggle"]');
            cabeca.addEventListener('click', alternar);
            if (MOB) cabeca.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); }
            });

            const panel = card.querySelector('.rep-row-panel');
            panel.addEventListener('click', e => {
                const aba = e.target.closest('[data-aba]');
                if (aba) {
                    e.stopPropagation();
                    abaPorOS[os.id] = aba.dataset.aba;
                    panel.querySelectorAll('[data-aba]').forEach(b => b.classList.toggle('on', b === aba));
                    panel.querySelectorAll('[data-pg]').forEach(pg => pg.classList.toggle('on', pg.dataset.pg === aba.dataset.aba));
                    return;
                }
                const verFotos = e.target.closest('[data-ver-fotos]');
                if (verFotos) {
                    e.stopPropagation();
                    const entradas = entradasTimeline(os);
                    abrirLightbox(fotosDaEntrada(os, entradas, +verFotos.dataset.verFotos), 0, verFotos.dataset.titulo || '');
                    return;
                }
                const verFoto = e.target.closest('[data-ver-foto]');
                if (verFoto) { e.stopPropagation(); abrirLightbox([verFoto.dataset.verFoto]); return; }
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
                else if (acao === 'toggle-manual') { if (MOB) abrirFolhaManual(os); else panel.querySelector('[data-manual-wrap]')?.classList.toggle('show'); }
                else if (acao === 'desfazer') abrirFolhaDesfazer(os);
                else if (acao === 'padrao') abrirPatternLightbox((senhaCache[os.id] && senhaCache[os.id].sequencia) || []);
                else if (acao === 'whatsapp') { const url = linkWhatsApp(os.cliente && os.cliente.telefone); if (url) window.open(url, '_blank', 'noopener'); }
                else if (acao === 'comprovante') { if (typeof window._reparosAbrirModalDoc === 'function') window._reparosAbrirModalDoc(os); }
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
        if (MOB) { abrirFolhaFotoEtapa(os, novoStatus); return; }
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

    // ── Lightbox (ver foto em tamanho grande) ────────────────────
    // Celular: galeria que se arrasta pro lado (uma etapa pode ter até 5 fotos), com legenda e
    // bolinhas. Computador: só a foto. O voltar do Android fecha a galeria.
    let lightboxBackdrop = null;
    function marcarFotoAtual(n, total, titulo) {
        el('repLightboxCap').textContent = total > 1 ? `${titulo ? titulo + ' · ' : ''}${n + 1}/${total}` : titulo;
        el('repLightboxDots').innerHTML = total > 1 ? Array.from({ length: total }, (_, k) => `<i${k === n ? ' class="on"' : ''}></i>`).join('') : '';
    }
    function fecharLightbox() {
        if (!lightboxBackdrop || !lightboxBackdrop.classList.contains('show')) return;
        lightboxBackdrop.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        const sl = el('repLightboxSl');
        if (sl) sl.innerHTML = '';
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
    }
    function abrirLightbox(urls, idx, titulo) {
        urls = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
        if (!urls.length) return;
        const inicio = Math.min(Math.max(idx || 0, 0), urls.length - 1);
        const legenda = titulo || '';
        if (!lightboxBackdrop) {
            document.body.insertAdjacentHTML('beforeend', MOB
                ? `<div class="rep-lightbox-backdrop" id="repLightbox">
                       <div class="rep-lb-top"><div class="rep-lb-cap" id="repLightboxCap"></div><button type="button" class="rep-lb-x" data-lb="x" aria-label="Fechar">${ic('x')}</button></div>
                       <div class="rep-lb-sl" id="repLightboxSl"></div>
                       <div class="rep-lb-dots" id="repLightboxDots"></div>
                   </div>`
                : `<div class="rep-lightbox-backdrop" id="repLightbox"><img id="repLightboxImg" alt=""/></div>`);
            lightboxBackdrop = el('repLightbox');
            lightboxBackdrop.addEventListener('click', e => {
                if (MOB && e.target.closest('img')) return;   // tocar na foto não fecha: o toque é do arrastar
                fecharLightbox();
            });
            lightboxBackdrop._fechar = fecharLightbox;
            if (MOB) {
                const sl = el('repLightboxSl');
                sl.addEventListener('scroll', () => {
                    const total = sl.children.length;
                    if (total) marcarFotoAtual(Math.min(total - 1, Math.round(sl.scrollLeft / sl.clientWidth)), total, lightboxBackdrop._titulo);
                }, { passive: true });
            }
        }
        lightboxBackdrop._titulo = legenda;
        if (MOB) {
            const sl = el('repLightboxSl');
            sl.innerHTML = urls.map(u => `<div><img src="${esc(u)}" alt=""/></div>`).join('');
            marcarFotoAtual(inicio, urls.length, legenda);
            lightboxBackdrop.classList.add('show');
            sl.scrollLeft = inicio * sl.clientWidth;
        } else {
            el('repLightboxImg').src = urls[inicio];
            lightboxBackdrop.classList.add('show');
        }
        window._vsTravarScroll && window._vsTravarScroll();
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(fecharLightbox);
    }

    // ── Lightbox do padrão desenhado (a caixinha compacta só mostra
    //    "toque pra ver" — isso abre o desenho de verdade, grande) ──
    let patternLightboxBackdrop = null;
    function abrirPatternLightbox(sequencia) {
        if (MOB) { abrirFolhaPadrao(sequencia); return; }
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
        const entradas = entradasTimeline(os).map(e => ({ ...e, meta: flowMeta(os.modo, e.etapa) }));
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
        // Celular: fechar uma folha ou voltar do formulário reabre a tela por baixo
        // (_vsNavRestoring) — aí o filtro que a pessoa escolheu continua valendo.
        if (!(MOB && window._vsNavRestoring)) {
            filtroAtivo = 'ativos';
            limiteExibicao = LIMITE_PAGINA;
        }
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
