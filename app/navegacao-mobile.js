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
// Expõe via window.*: _vsBarraRender, _vsBarraAtiva, _vsBarraSincronizar
// Depende de (via window.*): _usuarioPrefRef, _dbUpdate, _firebaseAuthUid, _nomeUsuario,
//   _configCustomizacoes, openVendaSection, safeStorage
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
    window._vsBarraAtiva = function (secao) { secaoAtual = secao; marcarAtiva(); };

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
