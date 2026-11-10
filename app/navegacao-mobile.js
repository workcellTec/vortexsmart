// ================================================================
// navegacao-mobile.js — VortexSmart · Barra inferior personalizável (só celular)
//
// Barra: Início · até 3 atalhos escolhidos pelo usuário · botão Vender (Nova venda).
// Os módulos que NÃO estão na barra aparecem em "Seus módulos", na Início (#vsGradeModulos).
// "Editar barra" abre uma folha com um interruptor por módulo (máx. 3; ligar um 4º tira o mais antigo).
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
// Botão do meio ADAPTATIVO: "Vender" por padrão; em cada tela que tem um "criar" vira esse criar
// (Novo concerto, Novo produto, Novo lançamento, Novo contrato…) — tabela CONTEXTOS, mais abaixo.
// Ele só dispara o botão de criar que a própria tela já tem, então permissão e regra de cada
// módulo continuam sendo as do módulo.
//
// Abrir direto numa tela (toque num widget do Android): window._vsAbrirDestino('venda:nova'…), mais abaixo.
//
// Expõe via window.*: _vsBarraRender, _vsBarraAtiva, _vsBarraCentro, _vsBarraSincronizar, _vsAbas, _vsAbrirDestino
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
        { id: 'vendas',        btn: 'goToVenda',      nome: 'Vendas',        icone: 'bag',   secao: 'venda' },
        { id: 'calculadora',   btn: 'goToCalculator', nome: 'Calculadora',   icone: 'calc',  secao: 'calculator' },
        { id: 'estoque',       btn: 'goToEstoque',    nome: 'Estoque',       icone: 'box',   secao: 'estoque' },
        { id: 'reparos',       btn: 'goToReparos',    nome: 'Concertos',     icone: 'tool',  secao: 'reparos' },
        { id: 'financeiro',    btn: 'goToFinanceiro', nome: 'Financeiro',    icone: 'chart', secao: 'financeiro' },
        { id: 'reposicao',     btn: 'goToReposicao',  nome: 'Reposição',     icone: 'cart',  secao: 'reposicao' },
        { id: 'documentos',    btn: 'goToDocumentos', nome: 'Documentos',    icone: 'doc',   secao: 'documentos' },
        { id: 'credscan',      btn: 'goToCredscan',   nome: 'CredScan',      icone: 'cpu',   secao: 'credscan' },
        { id: 'configuracoes', btn: 'goToConfig',     nome: 'Configurações', icone: 'gear',  secao: 'configuracoes' },
    ];
    const POR_ID = Object.fromEntries(MODULOS.map(m => [m.id, m]));

    const el = id => document.getElementById(id);
    const iconeSvg = (nome, tam) => `<svg class="vs-ic" width="${tam}" height="${tam}" aria-hidden="true"><use href="#vsi-${nome}"/></svg>`;
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
            b.innerHTML = `<span class="ctw-nav-icon">${iconeSvg(m.icone, 23)}</span><span class="ctw-nav-label"></span>`;
            b.querySelector('.ctw-nav-label').textContent = m.nome;
            b.addEventListener('click', () => el(m.btn)?.click());
            nav.insertBefore(b, vender);
        });
        if (vender) vender.style.gridColumn = '3';

        // "Seus módulos": quem já está na barra sai da grade (a visibilidade por papel continua vindo do core.js).
        MODULOS.forEach(m => el(m.btn)?.classList.toggle('vs-na-barra', ids.includes(m.id)));
        if (typeof window._vsInicioPerfil === 'function') window._vsInicioPerfil();
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
        atualizarCentro();
    };

    // ── Botão do meio: Vender, ou o "criar" da tela em que o usuário está ──
    // "aberto": a tela está mesmo à vista (o container do módulo some quando se sai dele).
    const aberto = id => { const n = el(id); return !!n && n.getClientRects().length > 0; };
    const podeEm = chave => typeof window._temPermissao !== 'function' || window._temPermissao(chave);
    const clicarEm = id => () => el(id)?.click();
    // Botões de criar que o código compartilhado liga/desliga por estilo inline: vale o que está no estilo.
    const acaoLigada = (id, icone) => {
        const b = el(id);
        return !!b && b.style.display !== 'none' && !b.disabled && !!b.querySelector('.' + icone);
    };

    // Receita × Despesa: o botão "+" do Financeiro precisa saber qual das duas.
    function lancar(tipo) {
        const id = tipo === 'receita' ? 'finBtnReceita' : 'finBtnDespesa';
        if (!el(id) || !aberto('financeiroLancamentos')) window.openFinanceiroSection?.('financeiroLancamentos', null, true);
        el(id)?.click();
    }
    function abrirFolhaLancamento() {
        let f = el('vsFinFolha');
        if (!f) {
            f = document.createElement('div');
            f.id = 'vsFinFolha';
            f.className = 'vs-folha-overlay';
            f.innerHTML = `
                <div class="vs-folha" role="dialog" aria-label="Novo lançamento">
                    <div class="vs-folha-alca"></div>
                    <div class="vs-folha-titulo">Novo lançamento</div>
                    <button type="button" class="vs-linha ganho" data-tipo="receita"><span class="vs-linha-ic">${iconeSvg('cashplus', 21)}</span><span class="vs-linha-nome">Receita<small>Dinheiro que entrou</small></span></button>
                    <button type="button" class="vs-linha perigo" data-tipo="despesa"><span class="vs-linha-ic">${iconeSvg('cashminus', 21)}</span><span class="vs-linha-nome">Despesa<small>Dinheiro que saiu</small></span></button>
                </div>`;
            document.body.appendChild(f);
            f.addEventListener('click', e => {
                const b = e.target.closest('[data-tipo]');
                if (b) { f.classList.remove('active'); lancar(b.dataset.tipo); }
                else if (e.target === f) f.classList.remove('active');
            });
        }
        void f.offsetWidth;
        f.classList.add('active');
    }

    const docs = (secao, viewHist, tabNovo, rotulo, curto) => ({
        acao: 'doc-' + secao, rotulo, curto, icone: 'docplus',
        ativo: () => aberto(viewHist) && !!el(tabNovo), executar: clicarEm(tabNovo),
    });
    // A primeira que estiver ativa vence; sem nenhuma, vale o Vender.
    const CONTEXTOS = [
        { acao: 'concerto', rotulo: 'Novo concerto', icone: 'toolplus',
          ativo: () => aberto('reparosLista') && podeEm('reparos_criar'),
          executar: () => window.openReparosSection?.('reparosForm') },
        { acao: 'produto', rotulo: 'Novo produto', icone: 'boxplus',
          ativo: () => aberto('estoqueProdutos') && !!el('stqNewBtn'), executar: clicarEm('stqNewBtn') },
        { acao: 'lancamento', rotulo: 'Novo lançamento', curto: 'Lançamento', icone: 'cashplus',
          ativo: () => (aberto('financeiroLancamentos') && !!el('finBtnReceita')) || aberto('financeiroGraficos'),
          executar: abrirFolhaLancamento },
        { acao: 'conta-fixa', rotulo: 'Nova conta fixa', curto: 'Conta fixa', icone: 'cashplus',
          ativo: () => aberto('financeiroRecorrentes') && !!el('finRecNovoBtn'), executar: clicarEm('finRecNovoBtn') },
        { acao: 'reposicao', rotulo: 'Novo item', icone: 'cartplus',
          ativo: () => aberto('reposicaoLista') && !!el('repoNovoBtn'), executar: clicarEm('repoNovoBtn') },
        { acao: 'credscan', rotulo: 'Nova análise', icone: 'shieldplus',
          ativo: () => aberto('credscanLista') && !!el('csNovoBtn'), executar: clicarEm('csNovoBtn') },
        docs('contrato', 'ctViewHistorico', 'ctTabNovo', 'Novo contrato'),
        docs('garantia', 'bkViewHist', 'bkTabNovo', 'Nova garantia'),
        docs('recibo', 'rcViewHistorico', 'rcTabNovo', 'Novo recibo'),
        docs('orcamento', 'orViewHist', 'orTabNovo', 'Novo orçamento', 'Orçamento'),
        { acao: 'cliente', rotulo: 'Novo cliente', icone: 'userplus',
          ativo: () => aberto('configuracoesClientes') && acaoLigada('ccHeaderActionBtn', 'bi-person-plus-fill'),
          executar: clicarEm('ccHeaderActionBtn') },
        { acao: 'usuario', rotulo: 'Novo usuário', icone: 'userplus',
          ativo: () => aberto('configuracoesUsuarios') && acaoLigada('cuHeaderActionBtn', 'bi-person-plus-fill'),
          executar: clicarEm('cuHeaderActionBtn') },
    ];
    const VENDER = {
        acao: 'venda', rotulo: 'Vender', icone: 'bag',
        executar: () => window.openVendaSection?.('lancarVenda'),
    };
    const centroAtual = () => CONTEXTOS.find(c => c.ativo()) || VENDER;

    function atualizarCentro() {
        const b = el('ctwNavVender');
        if (!b) return;
        const c = centroAtual();
        // Telas estreitas (≤ 360px) não comportam rótulo de 14+ letras entre os vizinhos: usa a forma curta.
        const texto = c.curto && window.innerWidth <= 360 ? c.curto : c.rotulo;
        const chave = c.acao + '|' + texto;
        if (b.dataset.chave === chave) return;   // só mexe quando muda (o observador abaixo roda a cada alteração de tela)
        b.dataset.chave = chave;
        b.dataset.acao = c.acao;
        b.title = c.rotulo;
        b.setAttribute('aria-label', c.rotulo);
        const rot = b.querySelector('.ctw-nav-label');
        rot.textContent = texto;
        rot.dataset.tam = texto.length >= 14 ? 'gg' : texto.length >= 12 ? 'g' : '';
        b.querySelector('.ctw-nav-vender-ic use').setAttribute('href', '#vsi-' + c.icone);
    }
    window._vsBarraCentro = atualizarCentro;   // routers chamam depois de trocar de sub-tela

    // As telas trocam de lista ↔ formulário e de aba por estilo/HTML: o botão acompanha sem cada módulo ter que avisar.
    let centroAgendado = false;
    function observarCentro() {
        const obs = new MutationObserver(() => {
            if (centroAgendado) return;
            centroAgendado = true;
            requestAnimationFrame(() => { centroAgendado = false; atualizarCentro(); });
        });
        MODULOS.forEach(m => {
            const alvo = el(m.secao + 'Container');
            if (alvo) obs.observe(alvo, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'disabled'] });
        });
    }

    // ── Abas dos módulos ───────────────────────────────────────
    const ehGestor = () => window._papelUsuario === 'gestor';
    const ABAS = {
        venda: {
            titulo: 'Vendas', cont: 'vendaContainer', hubs: ['vendaHome'],
            abrir: sub => window.openVendaSection(sub, null, true),
            itens: [
                { sub: 'historicoVendas', nome: 'Histórico' },
                { sub: 'vendaRelatorios', nome: 'Relatórios', ok: () => typeof window._temPermissao !== 'function' || window._temPermissao('relatorios') },
            ],
        },
        estoque: {
            titulo: 'Estoque', cont: 'estoqueContainer', hubs: ['estoqueHome'],
            abrir: sub => window.openEstoqueSection(sub, undefined, true),
            itens: [
                { sub: 'estoqueProdutos', nome: 'Produtos' },
                { sub: 'estoqueConferencia', nome: 'Conferência' },
                { sub: 'estoqueMovimentacao', nome: 'Movimentação', ok: ehGestor },
            ],
        },
        documentos: {
            titulo: 'Documentos', cont: 'documentosContainer', hubs: ['documentosHome'],
            abrir: sub => window.openDocumentosSection(sub, undefined, true),
            itens: [
                { sub: 'documentosGarantia', nome: 'Garantia' },
                { sub: 'documentosRecibo', nome: 'Recibo' },
                { sub: 'documentosOrcamento', nome: 'Orçamento' },
                { sub: 'documentosContrato', nome: 'Contrato' },
            ],
        },
        calculadora: {
            titulo: 'Calculadora', cont: 'calculatorContainer', hubs: ['calculatorHome'], padrao: 'calcularPorAparelho',
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
        f.innerHTML = '<div class="vs-mod-topo"><h1 class="vs-mod-titulo"></h1>' +
            '<span class="vs-ini-sino"><button type="button" class="vs-ini-btn" aria-label="Notificações">' + iconeSvg('bell', 20) + '</button><span class="ctw-nav-dot"></span></span></div>' +
            '<div class="vs-abas-linha" role="tablist"></div>';
        f.querySelector('.vs-mod-titulo').textContent = cfg.titulo;
        f.querySelector('.vs-ini-btn').addEventListener('click', () => el('ctwNavNotif')?.click());
        if (typeof window._atualizarBadgeNotificacoes === 'function') window._atualizarBadgeNotificacoes();
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
            const alvo = livres.find(i => i.sub === cfg.padrao) || livres[0];
            return alvo ? alvo.sub : sub;
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
            const linha = f.querySelector('.vs-abas-linha');
            linha.innerHTML = '';
            livres.forEach(i => {
                const b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('role', 'tab');
                b.dataset.sub = i.sub;
                b.textContent = i.nome;
                const ativa = i.sub === sub;
                b.className = ativa ? 'on' : '';
                b.setAttribute('aria-selected', ativa ? 'true' : 'false');
                linha.appendChild(b);
            });
            const on = linha.querySelector('.on');
            if (on) linha.scrollLeft = on.offsetLeft - (linha.clientWidth - on.offsetWidth) / 2;
        },
    };

    // ── Abrir direto numa tela (widgets do Android) ────────────
    // O APK chama window._vsAbrirDestino('venda:nova') quando alguém toca num widget da tela inicial.
    // Cada destino usa o mesmo caminho do botão correspondente da Início, então permissão e módulo
    // liberado/fechado seguem valendo. Sem sessão pronta (app abrindo, login), guarda por 60 s e
    // executa assim que a Início abre (core.js avisa em _vsSessaoProntaAviso).
    const botaoLigado = id => { const b = el(id); return !!b && b.style.display !== 'none' && !b.disabled; };
    const clicarSeLigado = id => () => { if (botaoLigado(id)) el(id).click(); };
    const DESTINOS = {
        'venda:nova':      () => window.openVendaSection?.('lancarVenda'),
        'venda:escanear':  () => {
            window.openVendaSection?.('lancarVenda');
            setTimeout(() => el('vendaLerCameraBtn')?.click(), 350);   // espera a tela de venda montar
        },
        'venda:historico': clicarSeLigado('goToVenda'),
        'reparos:novo':    () => { if (podeEm('reparos_criar')) window.openReparosSection?.('reparosForm'); },
        'reparos:lista':   clicarSeLigado('goToReparos'),
        'calculadora':     clicarSeLigado('goToCalculator'),
        'estoque':         clicarSeLigado('goToEstoque'),
        'financeiro':      clicarSeLigado('goToFinanceiro'),
        'inicio':          () => el('ctwNavHome')?.click(),
    };
    let destinoPendente = null;
    function executarDestino() {
        if (!destinoPendente || !window._vsSessaoPronta) return;
        const { nome, ts } = destinoPendente;
        destinoPendente = null;
        if (Date.now() - ts > 60000) return;
        const f = DESTINOS[nome];
        if (f) f();
    }
    window._vsAbrirDestino = function (nome) {
        destinoPendente = nome ? { nome, ts: Date.now() } : null;
        executarDestino();
    };
    window._vsSessaoProntaAviso = executarDestino;

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
        return Array.from(document.querySelectorAll('.custom-modal-overlay.active, .vs-folha-overlay.active, .stq-modal-backdrop.show, .apr-modal-backdrop.show, .rep-lightbox-backdrop'))
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
        '📱': 'phone-fill', '🙈': 'eye-slash-fill', '👁': 'eye-fill', '⬇': 'download', '⬆': 'upload', '⚠': 'exclamation-triangle-fill',
    };
    const ALVOS_EMOJI = [
        '.cfgA-icon', '.cz-item-ic', '.cz-sec-title', '.cb-hero-ic', '.cb-block-ic', '.ctx-machine-ic',
        '.ctx-icon-btn', '.pulse-icon-box', '.cfgA-name', '.cb-notice', '#cbBaixarTudoBtn', '#cbRestaurarTudoBtn',
        '.form-label',
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

    // ── Botão do meio ──────────────────────────────────────────
    function ligarCentro() {
        // Recalcula na hora do toque: a ação é a da tela que está à vista agora, mesmo que o observador ainda não tenha rodado.
        el('ctwNavVender')?.addEventListener('click', () => centroAtual().executar());
    }

    // ── Folha "Editar barra" ───────────────────────────────────
    function fecharFolha() { el('vsBarraFolha')?.classList.remove('active'); }

    function desenharLista() {
        const lista = el('vsBarraLista');
        if (!lista) return;
        const marcados = atalhosVisiveis();
        lista.innerHTML = '';
        MODULOS.filter(disponivel).forEach(m => {
            const on = marcados.includes(m.id);
            const li = document.createElement('label');
            li.className = 'vs-linha';
            li.innerHTML = `<span class="vs-linha-ic">${iconeSvg(m.icone, 21)}</span><span class="vs-linha-nome"></span>` +
                `<span class="vs-sw"><input type="checkbox"${on ? ' checked' : ''}/><span class="vs-sw-trilho"></span></span>`;
            li.querySelector('.vs-linha-nome').textContent = m.nome;
            li.querySelector('input').addEventListener('change', e => {
                const atual = atalhosVisiveis();
                // Ligar um 4º tira o mais antigo da barra.
                const novo = e.target.checked ? atual.concat(m.id).slice(-MAX_ATALHOS) : atual.filter(id => id !== m.id);
                salvarEscolha(novo);
                render();
                desenharLista();
            });
            lista.appendChild(li);
        });
    }

    function abrirFolha() {
        let f = el('vsBarraFolha');
        if (!f) {
            f = document.createElement('div');
            f.id = 'vsBarraFolha';
            f.className = 'vs-folha-overlay';
            f.innerHTML = `
                <div class="vs-folha" role="dialog" aria-label="Personalizar barra">
                    <div class="vs-folha-alca"></div>
                    <div class="vs-folha-titulo">Personalizar barra</div>
                    <div class="vs-folha-sub">Início e Vender sempre ficam. Escolha até ${MAX_ATALHOS} telas para a barra. O que ficar de fora aparece em <b>Seus módulos</b>, no Início.</div>
                    <div id="vsBarraLista"></div>
                </div>`;
            document.body.appendChild(f);
            f.addEventListener('click', e => { if (e.target === f) fecharFolha(); });
        }
        desenharLista();
        // força o reflow antes de ativar, senão a transição de entrada não anima
        void f.offsetWidth;
        f.classList.add('active');
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-editar-barra]').forEach(b => b.addEventListener('click', abrirFolha));
        ligarCentro();
        observarCentro();
        render();
        atualizarCentro();
    });
})();
