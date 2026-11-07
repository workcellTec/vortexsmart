// ================================================================
// navegacao-mobile.js — VortexSmart · Barra inferior personalizável (só celular)
//
// Barra: Início · até 3 atalhos escolhidos pelo usuário · botão Vender (Nova venda).
// Os módulos que NÃO estão na barra aparecem na grade da Início (#vsGradeModulos).
// "Editar barra" abre uma folha com um interruptor por módulo (máx. 3).
//
// Os botões da grade e da barra são os mesmos elementos/ids de sempre (goToEstoque…):
// cliques, visibilidade por papel e cadeado de Concertos continuam vindo do core.js.
// A barra só dispara o clique do botão correspondente da grade.
//
// Preferência PESSOAL por usuário: cache local (chave por uid, aparece na hora) +
// usuarios/{uid}/preferencias/barraAtalhos (acompanha o usuário em outro aparelho;
// string "estoque,calculadora" — "" = barra sem atalhos, ausente = padrão).
//
// ABAS DOS MÓDULOS: Vendas, Estoque, Documentos e Calculadora não têm tela-menu no celular —
// abrem direto na primeira aba, com a faixa de abas fixa no topo; tocar numa aba ou deslizar
// pro lado troca a tela SEM empilhar histórico (o voltar sai do módulo).
//
// Expõe via window.*: _vsBarraRender, _vsBarraAtiva, _vsBarraSincronizar, _vsAbas
// Depende de (via window.*): _usuarioPrefRef, _dbUpdate, _firebaseAuthUid, _nomeUsuario,
//   _configCustomizacoes, openVendaSection, openEstoqueSection, openDocumentosSection,
//   openCalculatorSection, _temPermissao, _papelUsuario, _vsPedirTransicao, safeStorage
// ================================================================
(function () {
    'use strict';
    if (document.documentElement.getAttribute('data-shell') !== 'mobile') return;

    const MAX_ATALHOS = 3;
    const PADRAO = ['vendas', 'estoque', 'calculadora'];
    // id da chave → botão da grade (fonte de verdade de visibilidade e de clique) + dados da barra
    const MODULOS = [
        { id: 'vendas',      btn: 'goToVenda',       nome: 'Vendas',      icone: 'bi-cart-check-fill',                secao: 'venda' },
        { id: 'estoque',     btn: 'goToEstoque',     nome: 'Estoque',     icone: 'bi-box-seam-fill',                  secao: 'estoque' },
        { id: 'calculadora', btn: 'goToCalculator',  nome: 'Calculadora', icone: 'bi-calculator-fill',                secao: 'calculator' },
        { id: 'documentos',  btn: 'goToDocumentos',  nome: 'Documentos',  icone: 'bi-file-earmark-text-fill',         secao: 'documentos' },
        { id: 'reparos',     btn: 'goToReparos',     nome: 'Concertos',   icone: 'bi-wrench-adjustable-circle-fill',  secao: 'reparos' },
        { id: 'reposicao',   btn: 'goToReposicao',   nome: 'Reposição',   icone: 'bi-cart3',                          secao: 'reposicao' },
        { id: 'financeiro',  btn: 'goToFinanceiro',  nome: 'Financeiro',  icone: 'bi-graph-up-arrow',                 secao: 'financeiro' },
        { id: 'credscan',    btn: 'goToCredscan',    nome: 'CredScan',    icone: 'bi-cpu-fill',                       secao: 'credscan' },
    ];
    const POR_ID = Object.fromEntries(MODULOS.map(m => [m.id, m]));

    const el = id => document.getElementById(id);
    let escolha = null;        // array de ids, ou null = padrão
    let secaoAtual = 'main';

    // ── Preferência ────────────────────────────────────────────
    const chaveLocal = () => 'vsBarra:' + (window._firebaseAuthUid || 'anon');
    const paraTexto = arr => arr.join(',');
    const deTexto = t => (typeof t === 'string' ? t.split(',').filter(id => POR_ID[id]).slice(0, MAX_ATALHOS) : null);

    function lerEscolha() {
        if (escolha) return escolha;
        const remoto = window._configCustomizacoes && window._configCustomizacoes.barraAtalhos;
        const local = window.safeStorage && window.safeStorage.getItem(chaveLocal());
        escolha = deTexto(typeof remoto === 'string' ? remoto : local);
        return escolha;
    }
    const escolhaEfetiva = () => lerEscolha() || PADRAO;

    function salvarEscolha(arr) {
        escolha = arr;
        if (window.safeStorage) window.safeStorage.setItem(chaveLocal(), paraTexto(arr));
        // Segue o usuário em outro aparelho; se a regra do banco recusar, o cache local continua valendo.
        try {
            if (typeof window._usuarioPrefRef === 'function' && typeof window._dbUpdate === 'function') {
                const r = window._dbUpdate(window._usuarioPrefRef(), { barraAtalhos: paraTexto(arr) });
                if (r && r.catch) r.catch(() => {});
            }
        } catch (e) { /* login ainda não terminou: só cache local */ }
    }

    // Veio do Firebase (outro aparelho mudou): adota e redesenha.
    window._vsBarraSincronizar = function () {
        const remoto = window._configCustomizacoes && window._configCustomizacoes.barraAtalhos;
        if (typeof remoto !== 'string') return;
        const novo = deTexto(remoto);
        if (paraTexto(novo) === paraTexto(escolhaEfetiva())) return;
        escolha = novo;
        if (window.safeStorage) window.safeStorage.setItem(chaveLocal(), remoto);
        render();
    };

    // ── Disponibilidade (papel/flag/modo) = o que o core.js deixou visível na grade ──
    function disponivel(m) {
        const b = el(m.btn);
        return !!b && b.style.display !== 'none';
    }

    // ── Barra e grade ──────────────────────────────────────────
    function atalhosVisiveis() {
        return escolhaEfetiva().filter(id => POR_ID[id] && disponivel(POR_ID[id]));
    }

    function render() {
        const nav = el('ctwBottomNav');
        if (!nav) return;
        const ids = atalhosVisiveis();
        nav.querySelectorAll('.ctw-nav-slot').forEach(n => n.remove());
        const vender = el('ctwNavVender');
        // Colunas fixas: 1 Início · 3 Vender (sempre no meio) · atalhos em 2, 4 e 5 (com dois, ficam em 2 e 4: simétrico).
        const colunas = ids.length === 2 ? [2, 4] : [2, 4, 5];
        ids.forEach((id, i) => {
            const m = POR_ID[id];
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ctw-nav-btn ctw-nav-slot';
            b.dataset.mod = id;
            b.title = m.nome;
            b.style.gridColumn = String(colunas[i]);
            b.innerHTML = `<span class="ctw-nav-icon"><i class="bi ${m.icone}"></i></span><span class="ctw-nav-label"></span>`;
            b.querySelector('.ctw-nav-label').textContent = m.nome;
            b.addEventListener('click', () => el(m.btn)?.click());
            nav.insertBefore(b, vender);
        });
        if (vender) vender.style.gridColumn = '3';

        // Grade: só o que está disponível E fora da barra.
        let restantes = 0;
        MODULOS.forEach(m => {
            const b = el(m.btn);
            if (!b) return;
            const naBarra = ids.includes(m.id);
            b.classList.toggle('vs-na-barra', naBarra);
            if (!naBarra && disponivel(m)) restantes++;
        });
        const vazia = el('vsGradeVazia');
        if (vazia) vazia.style.display = restantes === 0 ? '' : 'none';

        // Avatar do topo: iniciais do usuário.
        const ini = el('vsTopoIniciais');
        const nome = (window._nomeUsuario || '').trim();
        if (ini && nome) {
            const p = nome.split(/\s+/);
            ini.textContent = ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
        }
        marcarAtiva();
    }
    window._vsBarraRender = render;

    function marcarAtiva() {
        const nav = el('ctwBottomNav');
        if (!nav) return;
        nav.querySelectorAll('.ctw-nav-slot').forEach(b => {
            b.classList.toggle('ctw-nav-active', !!POR_ID[b.dataset.mod] && POR_ID[b.dataset.mod].secao === secaoAtual);
        });
    }
    window._vsBarraAtiva = function (secao) {
        secaoAtual = secao;
        if (abaAtual && SECAO_DO_MODULO[abaAtual.mod] !== secao) abaAtual = null;
        marcarAtiva();
    };


    // ── Abas dos módulos ───────────────────────────────────────
    const ehGestor = () => window._papelUsuario === 'gestor';
    const ABAS = {
        venda: {
            cont: 'vendaContainer', hubs: ['vendaHome'],
            abrir: sub => window.openVendaSection(sub, null, true),
            itens: [
                { sub: 'historicoVendas', nome: 'Histórico' },
                { sub: 'vendaRelatorios', nome: 'Relatórios', ok: () => typeof window._temPermissao !== 'function' || window._temPermissao('relatorios') },
            ],
        },
        estoque: {
            cont: 'estoqueContainer', hubs: ['estoqueHome'],
            abrir: sub => window.openEstoqueSection(sub, undefined, true),
            itens: [
                { sub: 'estoqueProdutos', nome: 'Produtos' },
                { sub: 'estoqueConferencia', nome: 'Conferência' },
                { sub: 'estoqueMovimentacao', nome: 'Movimentação', ok: ehGestor },
            ],
        },
        documentos: {
            cont: 'documentosContainer', hubs: ['documentosHome'],
            abrir: sub => window.openDocumentosSection(sub, undefined, true),
            itens: [
                { sub: 'documentosContrato', nome: 'Contrato' },
                { sub: 'documentosGarantia', nome: 'Garantia' },
                { sub: 'documentosRecibo', nome: 'Recibo' },
                { sub: 'documentosOrcamento', nome: 'Orçamento' },
            ],
        },
        calculadora: {
            cont: 'calculatorContainer', hubs: ['calculatorHome'],
            abrir: sub => window.openCalculatorSection(sub, true),
            itens: [
                { sub: 'fecharVenda', nome: 'Remover taxa' },
                { sub: 'repassarValores', nome: 'Repassar' },
                { sub: 'calcularEmprestimo', nome: 'Empréstimo' },
                { sub: 'calcularPorAparelho', nome: 'Por aparelho' },
            ],
        },
    };
    const SECAO_DO_MODULO = { venda: 'venda', estoque: 'estoque', documentos: 'documentos', calculadora: 'calculator' };
    let abaAtual = null; // { mod, sub } da tela que está à vista (null = fora de qualquer aba)

    const itensPermitidos = mod => ABAS[mod].itens.filter(i => !i.ok || i.ok());

    function faixa(mod) {
        const cfg = ABAS[mod];
        let f = cfg.faixa;
        if (f && f.isConnected) return f;
        const cont = el(cfg.cont);
        if (!cont) return null;
        f = document.createElement('div');
        f.className = 'vs-abas';
        f.setAttribute('role', 'tablist');
        f.addEventListener('click', e => {
            const b = e.target.closest('[data-sub]');
            if (b && abaAtual && b.dataset.sub !== abaAtual.sub) cfg.abrir(b.dataset.sub);
        });
        cont.insertBefore(f, cont.firstChild);
        cfg.faixa = f;
        return f;
    }

    window._vsAbas = {
        // Hub/menu do módulo não existe no celular: cai na primeira aba liberada.
        redirecionar(mod, sub) {
            const cfg = ABAS[mod];
            if (!cfg || (sub && !cfg.hubs.includes(sub))) return sub;
            const livres = itensPermitidos(mod);
            return livres.length ? livres[0].sub : sub;
        },
        // Chamado pelos routers depois de mostrar a tela: desenha/atualiza a faixa de abas.
        atualizar(mod, sub) {
            const cfg = ABAS[mod];
            const f = cfg && faixa(mod);
            if (!f) return;
            const livres = itensPermitidos(mod);
            const naFaixa = livres.some(i => i.sub === sub);
            abaAtual = naFaixa ? { mod, sub } : null;
            // Tela de fluxo (ex: Nova venda) ou módulo com uma aba só: sem faixa.
            const comFaixa = naFaixa && livres.length > 1;
            el(cfg.cont).classList.toggle('vs-com-abas', comFaixa);
            if (!comFaixa) { f.style.display = 'none'; return; }
            f.style.display = '';
            f.innerHTML = '';
            livres.forEach(i => {
                const b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('role', 'tab');
                b.dataset.sub = i.sub;
                b.textContent = i.nome;
                const ativa = i.sub === sub;
                b.className = ativa ? 'on' : '';
                b.setAttribute('aria-selected', ativa ? 'true' : 'false');
                f.appendChild(b);
            });
            const on = f.querySelector('.on');
            if (on) f.scrollLeft = on.offsetLeft - (f.clientWidth - on.offsetWidth) / 2;
        },
    };

    // ── Deslizar pro lado troca de aba ─────────────────────────
    const FORA_DO_GESTO = 'input, textarea, select, canvas, video, [contenteditable="true"], .no-swipe, .vs-abas';
    function rolaNaHorizontal(n) {
        for (; n && n !== document.body; n = n.parentElement) {
            if (n.scrollWidth > n.clientWidth + 2) {
                const ox = getComputedStyle(n).overflowX;
                if (ox === 'auto' || ox === 'scroll') return true;
            }
        }
        return false;
    }
    function haJanelaAberta() {
        return Array.from(document.querySelectorAll('.custom-modal-overlay.active, .vs-folha-overlay.active, .ctw-sheet-overlay.active, .stq-modal-backdrop.show, .apr-modal-backdrop.show, .rep-lightbox-backdrop'))
            .some(n => getComputedStyle(n).display !== 'none');
    }
    let toque = null;
    document.addEventListener('touchstart', e => {
        toque = null;
        if (!abaAtual || e.touches.length !== 1) return;
        const t = e.touches[0];
        // Borda esquerda é do gesto de voltar do iOS.
        if (t.clientX < 24) return;
        if (e.target.closest(FORA_DO_GESTO) || rolaNaHorizontal(e.target) || haJanelaAberta()) return;
        toque = { x: t.clientX, y: t.clientY, t: Date.now(), mod: abaAtual.mod, sub: abaAtual.sub };
    }, { passive: true });
    document.addEventListener('touchend', e => {
        const ini = toque; toque = null;
        if (!ini || !abaAtual || abaAtual.mod !== ini.mod || abaAtual.sub !== ini.sub) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - ini.x, dy = t.clientY - ini.y;
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - ini.t > 700) return;
        const livres = itensPermitidos(ini.mod);
        const i = livres.findIndex(x => x.sub === ini.sub) + (dx < 0 ? 1 : -1);
        if (i < 0 || i >= livres.length) return;
        if (typeof window._vsPedirTransicao === 'function') window._vsPedirTransicao(dx < 0 ? 'frente' : 'tras');
        ABAS[ini.mod].abrir(livres[i].sub);
    }, { passive: true });

    // ── Ícones no lugar de emoji ───────────────────────────────
    // Várias telas (Configurações, Backup, Taxas...) são montadas por código compartilhado
    // com o PC e escrevem emoji nos títulos/ícones. No celular troca por ícone do app;
    // emoji fora da tabela (ex: o que o usuário escolhe pra uma forma de pagamento) fica como está.
    const EMOJI_ICONE = {
        '📦': 'box-seam-fill', '🏷': 'tag-fill', '👥': 'people-fill', '🔐': 'shield-lock-fill',
        '📄': 'file-earmark-text-fill', '✨': 'stars', '🔔': 'bell-fill', '🔧': 'wrench-adjustable',
        '🧠': 'cpu-fill', '🗄': 'database-fill', '🔄': 'arrow-repeat', '🖨': 'printer-fill',
        '🩺': 'heart-pulse-fill', '🎨': 'palette-fill', '🌗': 'circle-half', '🌙': 'moon-stars-fill',
        '☀': 'sun-fill', '🧮': 'calculator-fill', '💰': 'cash-coin', '🛒': 'cart-fill',
        '🎂': 'cake2-fill', '💳': 'credit-card-fill', '💾': 'floppy-fill', '📤': 'box-arrow-up',
        '📥': 'box-arrow-in-down', '👑': 'award-fill', '👤': 'person-fill', '📓': 'journal-text',
        '💵': 'cash-stack', '⚡': 'lightning-charge-fill', '🗓': 'calendar3', '📆': 'calendar-event',
        '✅': 'check-circle-fill', '✕': 'x-lg', '✏': 'pencil-fill', '🗑': 'trash3-fill',
        '🙈': 'eye-slash-fill', '👁': 'eye-fill', '⬇': 'download', '⬆': 'upload', '⚠': 'exclamation-triangle-fill',
    };
    const ALVOS_EMOJI = [
        '.cfgA-icon', '.cz-item-ic', '.cz-sec-title', '.cb-hero-ic', '.cb-block-ic', '.ctx-machine-ic',
        '.ctx-icon-btn', '.pulse-icon-box', '.cfgA-name', '.cb-notice', '#cbBaixarTudoBtn', '#cbRestaurarTudoBtn',
        '.form-label', '#profileSheetPapel', '#profileSheetAvatar',
        '.stq-cat-pill[data-v="escuro"]', '.stq-cat-pill[data-v="claro"]',
    ].join(',');
    const RE_EMOJI = new RegExp('^(\\s*)(' + Object.keys(EMOJI_ICONE).join('|') + ')\\uFE0F?\\s*');
    function trocarEmojis() {
        document.querySelectorAll(ALVOS_EMOJI).forEach(alvo => {
            for (const no of Array.from(alvo.childNodes)) {
                if (no.nodeType !== 3) continue;
                const m = RE_EMOJI.exec(no.nodeValue);
                if (!m) continue;
                const icone = document.createElement('i');
                icone.className = 'bi bi-' + EMOJI_ICONE[m[2]];
                const resto = no.nodeValue.slice(m[0].length);
                no.nodeValue = resto ? ' ' + resto : '';
                alvo.insertBefore(icone, no);
            }
        });
    }
    let trocaAgendada = false;
    new MutationObserver(() => {
        if (trocaAgendada) return;
        trocaAgendada = true;
        requestAnimationFrame(() => { trocaAgendada = false; trocarEmojis(); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    trocarEmojis();

    // ── Vender ─────────────────────────────────────────────────
    function ligarVender() {
        el('ctwNavVender')?.addEventListener('click', () => {
            if (typeof window.openVendaSection === 'function') window.openVendaSection('lancarVenda');
        });
    }

    // ── Folha "Editar barra" ───────────────────────────────────
    function fecharFolha() { el('vsBarraFolha')?.classList.remove('active'); }

    function desenharLista() {
        const lista = el('vsBarraLista');
        if (!lista) return;
        const marcados = atalhosVisiveis();
        const cheio = marcados.length >= MAX_ATALHOS;
        lista.innerHTML = '';
        MODULOS.filter(disponivel).forEach(m => {
            const on = marcados.includes(m.id);
            const li = document.createElement('label');
            li.className = 'vs-barra-item' + (!on && cheio ? ' desativado' : '');
            li.innerHTML = `<span class="vs-barra-ic"><i class="bi ${m.icone}"></i></span><span class="vs-barra-nome"></span>` +
                `<span class="vs-sw"><input type="checkbox"${on ? ' checked' : ''}${!on && cheio ? ' disabled' : ''}/><span class="vs-sw-trilho"></span></span>`;
            li.querySelector('.vs-barra-nome').textContent = m.nome;
            li.querySelector('input').addEventListener('change', e => {
                const atual = atalhosVisiveis();
                const novo = e.target.checked ? atual.concat(m.id).slice(0, MAX_ATALHOS) : atual.filter(id => id !== m.id);
                salvarEscolha(novo);
                render();
                desenharLista();
            });
            lista.appendChild(li);
        });
        const dica = el('vsBarraDica');
        if (dica) dica.textContent = `${marcados.length} de ${MAX_ATALHOS} atalhos na barra` + (cheio ? ' — desligue um pra trocar.' : '.');
    }

    function abrirFolha() {
        let f = el('vsBarraFolha');
        if (!f) {
            f = document.createElement('div');
            f.id = 'vsBarraFolha';
            f.className = 'vs-folha-overlay';
            f.innerHTML = `
                <div class="vs-folha" role="dialog" aria-label="Editar barra">
                    <div class="vs-folha-alca"></div>
                    <div class="vs-folha-titulo">Editar barra</div>
                    <div class="vs-folha-sub">Escolha até ${MAX_ATALHOS} módulos pra ficarem sempre à mão. O botão Vender e o Início não mudam.</div>
                    <div id="vsBarraLista"></div>
                    <div class="vs-folha-dica" id="vsBarraDica"></div>
                    <button type="button" class="btn btn-primary w-100" id="vsBarraOk">Concluído</button>
                </div>`;
            document.body.appendChild(f);
            f.addEventListener('click', e => { if (e.target === f) fecharFolha(); });
            f.querySelector('#vsBarraOk').addEventListener('click', fecharFolha);
        }
        desenharLista();
        // força o reflow antes de ativar, senão a transição de entrada não anima
        void f.offsetWidth;
        f.classList.add('active');
    }

    document.addEventListener('DOMContentLoaded', () => {
        el('vsEditarBarra')?.addEventListener('click', abrirFolha);
        ligarVender();
        render();
    });
})();
