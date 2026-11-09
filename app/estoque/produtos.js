// ================================================================
// estoque/produtos.js — VortexSmart · Estoque · Cadastro de Produtos
// Visual: Neon (aprovado) — anel colorido por categoria + painel de
// ícones sólidos + modal "Header Colorido" pra Novo/Editar e Adicionar
// Node real: /products (mesmo node usado pela Calculadora por Aparelho)
// Campos reais existentes: nome, valor, quantidade, ignorarContagem, notificacaoEstoqueDesativada, cores?[{nome,hex}]
// Campos novos deste módulo: precoCompra (opcional), historico (subnode por produto)
// Node novo: /fornecedores/{id} = { nome, criadoEm }
// Expõe via window.*:
//   _renderEstoqueProdutos
// Depende de (via window.*):
//   showCustomModal, escapeHtml, _fmt, products (populado pelo core.js),
//   _lojaRef, _dbUpdate, _dbPush, _dbRemove, _dbGet, _dbTransaction,
//   _onProductsUpdated (hook chamado pelo core.js quando /products muda)
// ================================================================
(function () {
    'use strict';

    const CORES_SUGERIDAS = [
        { nome: 'Preto',   hex: '#111111' },
        { nome: 'Branco',  hex: '#f5f5f5' },
        { nome: 'Azul',    hex: '#2979ff' },
        { nome: 'Vermelho',hex: '#f44336' },
        { nome: 'Dourado', hex: '#d4af37' },
        { nome: 'Rosa',    hex: '#f8bbd0' },
        { nome: 'Verde',   hex: '#43a047' },
        { nome: 'Roxo',    hex: '#8b5cf6' },
        { nome: 'Cinza',   hex: '#9e9e9e' },
        { nome: 'Prata',   hex: '#c0c0c0' }
    ];

    // ── Categorias do filtro ──────────────────────────────────────
    // TODAS são do Gestor: cria, edita e apaga em "Categorias" (botão ao lado dos
    // chips). Celulares, Áudio, Notebooks, Capas, Películas, Carregadores e Cabos
    // já vêm de fábrica; "Outros" é a única fixa (guarda o que não se encaixa).
    // Ficam em lojas/{loja}/categoriasProduto (window._categoriasProduto, mantido
    // ao vivo pelo core.js). Cada categoria escolhe como acha o produto:
    //  - "inicio": a PRIMEIRA palavra do nome é uma das palavras dela (palavra
    //    inteira, sem diferenciar maiúscula nem acento, singular ou plural).
    //    Assim "Fone com case de carregamento" segue em Áudio e "Capacete" não
    //    vira Capa.
    //  - "qualquer": a palavra (ou frase, ex.: "caixa de som") aparece em qualquer
    //    parte do nome, até no meio de outra palavra ("fone" acha "Microfone").
    // As de "inicio" são checadas ANTES: "Capa Samsung A02" fica em Capas e não
    // cai em Celulares. Dentro de cada grupo vale a ordem da lista.
    // Loja que nunca mexeu (nada gravado) usa o padrão abaixo. Loja personalizada
    // antes da versão 2 não tem as 3 de fábrica gravadas: elas valem como padrão
    // até a 1ª mexida, que grava tudo e marca versao: 2.
    const CATEGORIA_OUTROS = { id: 'outros', label: 'Outros', cor: '#64748b' };
    const NOMES_RESERVADOS = new Set(['outros', 'todos', 'todas']);
    const VERSAO_CATEGORIAS = 2;
    // Cor automática = a 1ª da paleta que nenhuma categoria usa. Nenhuma é
    // vermelha (vermelho = estoque zerado) nem igual às de fábrica dos aparelhos.
    const CORES_CATEGORIA = ['#f59e0b', '#10b981', '#3b82f6', '#84cc16', '#f97316', '#14b8a6', '#eab308', '#6366f1', '#0ea5e9', '#a3e635', '#fb923c', '#2dd4bf'];
    const CAT_MAX = CORES_CATEGORIA.length;   // 12 categorias (fora "Outros")
    const CAT_NOME_MAX = 20, CAT_PALAVRAS_MAX = 10, CAT_PALAVRA_MIN = 2, CAT_PALAVRA_MAX = 24;
    const CATEGORIAS_PADRAO = [
        { id: 'phones',       nome: 'Celulares',    modo: 'qualquer', cor: '#8b5cf6', ordem: -3, palavras: ['iphone', 'honor', 'realme', 'redmi', 'xiaomi', 'samsung', 'galaxy', 'motorola', 'poco', 'zenfone'] },
        { id: 'audio',        nome: 'Áudio',        modo: 'qualquer', cor: '#ec4899', ordem: -2, palavras: ['jbl', 'bombox', 'fone', 'caixa de som', 'speaker', 'headset', 'aiwa', 'soundbar'] },
        { id: 'notebooks',    nome: 'Notebooks',    modo: 'qualquer', cor: '#22d3ee', ordem: -1, palavras: ['notebook', 'laptop'] },
        { id: 'capas',        nome: 'Capas',        modo: 'inicio',   cor: CORES_CATEGORIA[0], ordem: 0, palavras: ['capa', 'capinha', 'case', 'bumper'] },
        { id: 'peliculas',    nome: 'Películas',    modo: 'inicio',   cor: CORES_CATEGORIA[1], ordem: 1, palavras: ['pelicula', 'hidrogel', 'vidro'] },
        { id: 'carregadores', nome: 'Carregadores', modo: 'inicio',   cor: CORES_CATEGORIA[2], ordem: 2, palavras: ['carregador', 'fonte'] },
        { id: 'cabos',        nome: 'Cabos',        modo: 'inicio',   cor: CORES_CATEGORIA[3], ordem: 3, palavras: ['cabo'] }
    ];
    const MODO_PADRAO = Object.fromEntries(CATEGORIAS_PADRAO.map(c => [c.id, c.modo]));
    const FABRICA_SEM_GRAVAR = new Set(['phones', 'audio', 'notebooks']);   // não estavam gravadas antes da versão 2
    // Primeiras palavras que não dizem nada sobre o tipo do produto (não viram sugestão)
    const PALAVRAS_IGNORADAS = new Set(['kit', 'kits', 'para', 'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'em', 'novo', 'nova', 'original', 'universal', 'aparelho', 'produto', 'item', 'lote', 'varios', 'varias']);

    // minúsculas e sem acento — "Película" e "pelicula" viram a mesma coisa
    function normalizarTexto(t) {
        return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }
    // idem, com qualquer sequência de espaços virando um só ("caixa  de som" = "caixa de som")
    const textoCompacto = t => normalizarTexto(t).replace(/\s+/g, ' ').trim();
    // 1ª palavra do nome feita só de letras (pula "01", "-", "/", "3D", "A12" no começo)
    function primeiraPalavra(nome) {
        return (normalizarTexto(nome).match(/[a-z0-9]+/g) || []).find(t => /^[a-z]+$/.test(t)) || '';
    }
    // singular e plural nos dois sentidos: "carregadores" acha "carregador" e vice-versa
    function formasDaPalavra(w) {
        const f = new Set([w, w + 's', w + 'es']);
        if (w.length >= 6 && w.endsWith('es')) f.add(w.slice(0, -2));
        if (w.length >= 4 && w.endsWith('s')) f.add(w.slice(0, -1));
        return f;
    }
    // uma palavra de categoria é válida? ("inicio": uma palavra só; "qualquer": aceita frase)
    const palavraValida = (w, modo) => (modo === 'qualquer' ? /^[a-z0-9]+( [a-z0-9]+)*$/ : /^[a-z0-9]+$/).test(w) && w.length >= CAT_PALAVRA_MIN && w.length <= CAT_PALAVRA_MAX;
    // Lê uma categoria como veio do banco, sem confiar: nome, modo, palavras e cor inválidos são descartados
    function lerCategoria(id, c, posicao) {
        if (!c || typeof c !== 'object' || id === CATEGORIA_OUTROS.id) return null;
        const nome = typeof c.nome === 'string' ? c.nome.trim().slice(0, CAT_NOME_MAX) : '';
        const modo = c.modo === 'inicio' || c.modo === 'qualquer' ? c.modo : (MODO_PADRAO[id] || 'inicio');
        const brutas = Array.isArray(c.palavras) ? c.palavras : (c.palavras && typeof c.palavras === 'object' ? Object.values(c.palavras) : []);
        const palavras = [...new Set(brutas.map(w => textoCompacto(w)).filter(w => palavraValida(w, modo)))].slice(0, CAT_PALAVRAS_MAX);
        if (!nome || !palavras.length) return null;
        const formas = new Set();
        palavras.forEach(w => formasDaPalavra(w).forEach(f => formas.add(f)));
        return {
            id, nome, palavras, modo, formas,
            cor: typeof c.cor === 'string' && /^#[0-9a-f]{6}$/i.test(c.cor) ? c.cor : CORES_CATEGORIA[posicao % CAT_MAX],
            ordem: Number.isFinite(c.ordem) ? c.ordem : posicao
        };
    }
    // Lista efetiva, na ordem: a gravada pelo Gestor ou, sem nada gravado, o padrão.
    // "virtual" = ainda não existe no banco (só vale "de cabeça" até a 1ª mexida).
    // (memoizada: o core.js troca o objeto inteiro a cada mudança no banco)
    let memoCfg, memoLista;
    function categoriasEditaveis() {
        const cfg = window._categoriasProduto;
        if (memoLista && memoCfg === cfg) return memoLista;
        let base;
        if (cfg && cfg.personalizado === true) {
            const lista = cfg.lista && typeof cfg.lista === 'object' ? cfg.lista : {};
            base = Object.entries(lista).map(([id, c], i) => lerCategoria(id, c, i)).filter(Boolean);
            if (cfg.versao !== VERSAO_CATEGORIAS) {
                CATEGORIAS_PADRAO.filter(p => FABRICA_SEM_GRAVAR.has(p.id) && !(p.id in lista))
                    .forEach(p => base.push({ ...lerCategoria(p.id, p, p.ordem), virtual: true }));
            }
        } else {
            base = CATEGORIAS_PADRAO.map((c, i) => ({ ...lerCategoria(c.id, c, i), virtual: true }));
        }
        base.sort((a, b) => a.ordem - b.ordem || a.id.localeCompare(b.id));
        memoCfg = cfg; memoLista = base;
        return base;
    }
    function infoCategoria(id) {
        const c = categoriasEditaveis().find(x => x.id === id);
        return c ? { label: c.nome, cor: c.cor } : CATEGORIA_OUTROS;
    }
    // chips do filtro, na ordem da tela: as do Gestor, depois "Outros"
    function opcoesDeFiltro() {
        return [
            ...categoriasEditaveis().map(c => ({ id: c.id, label: c.nome, cor: c.cor })),
            { id: CATEGORIA_OUTROS.id, label: CATEGORIA_OUTROS.label, cor: CATEGORIA_OUTROS.cor }
        ];
    }
    function detectarCategoria(nome) {
        const lista = categoriasEditaveis();
        const inicio = primeiraPalavra(nome);
        if (inicio) {
            for (const c of lista) if (c.modo === 'inicio' && c.formas.has(inicio)) return c.id;
        }
        const n = textoCompacto(nome);
        for (const c of lista) if (c.modo === 'qualquer' && c.palavras.some(w => n.includes(w))) return c.id;
        return CATEGORIA_OUTROS.id;
    }

    let editingId = null;
    let sessaoModal = 0; // muda a cada abertura E fechamento do modal — detecta que o form fechou/trocou durante uma operação assíncrona
    let quantidadeOriginalEdicao = null; // pra detectar se a quantidade mudou por edição direta (ajuste manual)
    let coresSelecionadas = []; // [{nome, hex}]
    let mounted = false;
    let expandedId = null;
    let filtroCategoria = null;
    const ESTOQUE_PAGINA = 40;       // cards desenhados por vez na lista (o resto vem em "Ver mais")
    let limiteExibicao = ESTOQUE_PAGINA;
    let assinaturaFiltro = '';       // busca+categoria da última renderização — mudou, volta pra primeira página
    let fornecedoresCache = [];
    let catTela = null;  // 'lista' | 'form' enquanto o modal de Categorias está aberto
    let catForm = null;  // rascunho do formulário de categoria

    const el  = id => document.getElementById(id);
    const esc = t  => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : t;
    const fmt = v  => typeof window._fmt === 'function' ? window._fmt(v) : `R$ ${Number(v || 0).toFixed(2)}`;

    // ── Skeleton (montado 1x) ────────────────────────────────────
    function ensureSkeleton() {
        const container = el('estoqueProdutos');
        if (!container || mounted) return;
        container.classList.add('stq-neon');
        const podeCriar = typeof window._temPermissao === 'function' ? window._temPermissao('estoque_criar_produto') : true;
        const podeRepor = typeof window._temPermissao === 'function' ? window._temPermissao('estoque_editar_produto') : true;
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Produtos</h3>
                <div style="display:flex;gap:6px;">
                    ${podeRepor ? `<button class="btn-header-action" id="stqReporBtn" aria-label="Repor estoque por leitura" title="Repor estoque"><i class="bi bi-upc-scan"></i></button>` : ''}
                    ${podeCriar ? `<button class="btn-header-action" id="stqNewBtn" aria-label="Novo produto"><i class="bi bi-plus-lg"></i></button>` : '<div style="width:36px;"></div>'}
                </div>
            </div>
            <div class="mb-2 w-100 max-width-400-margin-1rem">
                <input class="form-control" id="stqBusca" type="text" placeholder="Buscar produto cadastrado..."/>
            </div>
            <div class="stq-cats" id="stqCats"></div>
            <div class="stq-list" id="stqList"></div>

            <div class="stq-modal-backdrop" id="stqModalBackdrop">
                <div class="stq-modal-card">
                    <div class="stq-modal-header" id="stqModalHeader">
                        <div class="stq-modal-header-title" id="stqModalTitle"></div>
                        <button class="stq-modal-close" id="stqModalClose" aria-label="Fechar"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="stqModalBody"></div>
                </div>
            </div>
        `;

        renderCategoriaChips();

        el('stqNewBtn')?.addEventListener('click', openFormForNew);
        el('stqReporBtn')?.addEventListener('click', abrirReposicaoPorLeitura);
        el('stqBusca')?.addEventListener('input', renderLista);
        el('stqModalClose')?.addEventListener('click', fecharModal);
        el('stqModalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'stqModalBackdrop') fecharModal(); });

        mounted = true;
    }

    // ── Modal genérico ("Header Colorido") ─────────────────────────
    function abrirModal(corClasse, titulo) {
        sessaoModal++;
        const backdrop = el('stqModalBackdrop');
        const header = el('stqModalHeader');
        header.className = 'stq-modal-header ' + corClasse;
        el('stqModalTitle').textContent = titulo;
        backdrop.classList.remove('stq-fp-tela'); // tela cheia (celular) é só do formulário de produto: ele se marca depois de abrir
        backdrop.classList.add('show');
        // Trava a rolagem de fundo enquanto o modal tá aberto (sem isso a
        // lista de produtos por baixo continua respondendo ao dedo).
        window._vsTravarScroll && window._vsTravarScroll();
        // Empilha o modal no histórico — assim o botão/gesto físico de
        // voltar do Android fecha ESSE modal em vez de sair da tela de
        // Produtos por baixo dele.
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(fecharModal);
        return el('stqModalBody');
    }
    function fecharModal() {
        sessaoModal++; // fechar também invalida operações assíncronas em andamento (elas conferem isso antes de mexer na tela)
        el('stqModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        const body = el('stqModalBody');
        if (body) body.innerHTML = '';
        editingId = null;
        quantidadeOriginalEdicao = null;
        produtoAtualDoAlerta = null;
        catTela = null;
        catForm = null;
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
    }

    // ── Chips de categoria (filtro) ────────────────────────────────
    const souGestor = () => window._papelUsuario === 'gestor';

    function renderCategoriaChips() {
        const wrap = el('stqCats');
        if (!wrap) return;
        wrap.innerHTML = opcoesDeFiltro().map(c => `
            <button type="button" class="stq-cat-pill ${filtroCategoria === c.id ? 'active' : ''}" data-cat="${esc(c.id)}"
                style="background:${c.cor}22;color:${c.cor};">${esc(c.label)}</button>
        `).join('') + (souGestor() ? `
            <button type="button" class="stq-cat-pill stq-cat-gerenciar" id="stqCatGerenciar" title="Criar, editar ou apagar categorias"><i class="bi bi-sliders"></i> Categorias</button>` : '');
        wrap.querySelectorAll('.stq-cat-pill[data-cat]').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.dataset.cat;
                filtroCategoria = (filtroCategoria === cat) ? null : cat;
                renderCategoriaChips();
                renderLista();
                // No PC o cursor volta pra busca (dá pra seguir digitando ou usar o leitor);
                // no celular não, senão o teclado abriria a cada toque no chip.
                if (window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches) el('stqBusca')?.focus();
            });
        });
        el('stqCatGerenciar')?.addEventListener('click', abrirGerenciarCategorias);
    }

    // Outro aparelho mudou as categorias (ou o Gestor acabou de salvar): redesenha os
    // chips, solta o filtro se a categoria dele sumiu e atualiza a janela se estiver aberta.
    window._onCategoriasProdutoAtualizadas = function () {
        if (!mounted) return;
        if (filtroCategoria && !opcoesDeFiltro().some(c => c.id === filtroCategoria)) filtroCategoria = null;
        renderCategoriaChips();
        renderLista();
        if (catTela === 'lista' && el('catLista')) renderCatLista();
    };

    // ── Gerenciar categorias (só Gestor) ───────────────────────────
    // Tudo dentro do modal do estoque: a janela troca entre a lista e o formulário.
    // Cada categoria é gravada no próprio caminho (lista/{id}), então dois Gestores
    // mexendo em categorias diferentes não se atropelam. Na 1ª mexida da loja o
    // que só existia "de cabeça" (padrão) é gravado junto (personalizado: true,
    // versao: 2) — é isso que faz um "apagar" valer, em vez de o padrão reaparecer.
    const avisoToast = msg => typeof window.showCustomModal === 'function' && window.showCustomModal({ message: msg });
    const categoriaParaBanco = c => ({ nome: c.nome, palavras: c.palavras.slice(), modo: c.modo, cor: c.cor, ordem: c.ordem });
    const jaPersonalizado = () => !!(window._categoriasProduto && window._categoriasProduto.personalizado === true);
    const jaNaVersaoAtual = () => jaPersonalizado() && window._categoriasProduto.versao === VERSAO_CATEGORIAS;
    // O que a 1ª mexida precisa gravar além da própria alteração: as categorias virtuais
    // (loja sem nada gravado = todas; loja da versão 1 = só Celulares/Áudio/Notebooks).
    function gravacaoInicial(atual) {
        if (jaNaVersaoAtual()) return {};
        const dados = { personalizado: true, versao: VERSAO_CATEGORIAS };
        atual.filter(c => c.virtual).forEach(c => { dados[`lista/${c.id}`] = categoriaParaBanco(c); });
        return dados;
    }

    function textoDoErroCategoria(e) {
        const msg = String((e && e.message) || e || '');
        if ((e && e.code === 'PERMISSION_DENIED') || /permission|denied/i.test(msg)) {
            return 'Sem permissão para gravar as categorias. Só o Gestor pode e, se você é Gestor, as regras do banco (firebase-rules-saas.json) ainda não foram publicadas.';
        }
        return 'Erro ao salvar as categorias: ' + msg;
    }
    function gravarCategorias(dados) {
        return Promise.resolve(window._dbUpdate(window._lojaRef('categoriasProduto'), dados));
    }

    function abrirGerenciarCategorias() {
        if (!souGestor()) return;
        abrirModal('primary', 'Categorias');
        mostrarCatLista();
    }

    function mostrarCatLista() {
        catTela = 'lista'; catForm = null;
        el('stqModalTitle').textContent = 'Categorias';
        el('stqModalBody').innerHTML = `
            <p class="text-secondary" style="font-size:.78rem;margin-bottom:10px;">Cada categoria acha os produtos por palavras do nome: pela <b>primeira palavra</b> ou em <b>qualquer parte</b> do nome, você escolhe. Mexer aqui não altera nenhum produto, só como eles aparecem nos filtros, em todos os aparelhos da loja.</p>
            <div id="catLista"></div>
            <button type="button" class="stq-modal-btn-save w-100 mt-3" id="catNovaBtn"><i class="bi bi-plus-lg"></i> Nova categoria</button>
            <button type="button" class="stq-modal-btn-cancel w-100 mt-2" id="catRestaurarBtn">Restaurar padrão</button>`;
        el('catNovaBtn').addEventListener('click', () => mostrarCatForm(null));
        el('catRestaurarBtn').addEventListener('click', restaurarPadraoCategorias);
        renderCatLista();
    }

    function renderCatLista() {
        const wrap = el('catLista');
        if (!wrap) return;
        const lista = categoriasEditaveis();
        const linhaOutros = `
            <div class="stq-catman-row travada" data-fixa="outros">
                <span class="stq-catman-dot" style="background:${CATEGORIA_OUTROS.cor};"></span>
                <div class="stq-catman-info">
                    <div class="stq-catman-nome">${esc(CATEGORIA_OUTROS.label)}</div>
                    <div class="stq-catman-palavras">Sempre existe: guarda o que não se encaixa em nenhuma categoria</div>
                </div>
                <span class="stq-catman-trava" title="Não pode ser editada nem apagada"><i class="bi bi-lock-fill"></i></span>
            </div>`;
        wrap.innerHTML = (lista.length ? lista.map(c => `
            <div class="stq-catman-row" data-id="${esc(c.id)}">
                <span class="stq-catman-dot" style="background:${c.cor};"></span>
                <div class="stq-catman-info">
                    <div class="stq-catman-nome">${esc(c.nome)}</div>
                    <div class="stq-catman-palavras">${esc(c.palavras.join(' · '))}</div>
                    <div class="stq-catman-modo">${c.modo === 'qualquer' ? 'Palavra em qualquer parte do nome' : 'Nome começa com a palavra'}</div>
                </div>
                <button type="button" class="stq-catman-btn" data-acao="editar" aria-label="Editar ${esc(c.nome)}"><i class="bi bi-pencil-fill"></i></button>
                <button type="button" class="stq-catman-btn danger" data-acao="apagar" aria-label="Apagar ${esc(c.nome)}"><i class="bi bi-trash3-fill"></i></button>
            </div>`).join('')
            : `<div class="text-secondary" style="font-size:.8rem;padding:12px 0;">Nenhuma categoria além de "Outros". Toque em "Nova categoria" ou restaure o padrão.</div>`) + linhaOutros;
        wrap.querySelectorAll('.stq-catman-row[data-id]').forEach(row => {
            const id = row.dataset.id;
            row.querySelector('[data-acao="editar"]').addEventListener('click', () => mostrarCatForm(id));
            row.querySelector('[data-acao="apagar"]').addEventListener('click', () => apagarCategoria(id));
        });
        const cheio = lista.length >= CAT_MAX;
        if (cheio) wrap.insertAdjacentHTML('beforeend', `<div class="text-secondary" style="font-size:.74rem;padding-top:8px;">Limite de ${CAT_MAX} categorias atingido. Apague uma para criar outra.</div>`);
        const nova = el('catNovaBtn');
        if (nova) nova.disabled = cheio;
    }

    // As palavras mais comuns no começo dos produtos que hoje estão em "Outros" (≥ 2 produtos)
    function sugestoesDoEstoque() {
        const cont = new Map();
        getProdutos().forEach(p => {
            if (detectarCategoria(p.nome) !== CATEGORIA_OUTROS.id) return;
            const w = primeiraPalavra(p.nome);
            if (w.length < 3 || PALAVRAS_IGNORADAS.has(w)) return;
            cont.set(w, (cont.get(w) || 0) + 1);
        });
        return [...cont.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    }

    function mostrarCatForm(id) {
        const existente = id ? categoriasEditaveis().find(c => c.id === id) : null;
        if (id && !existente) {
            avisoToast('Essa categoria não existe mais (foi apagada em outro aparelho).');
            mostrarCatLista();
            return;
        }
        catTela = 'form';
        catForm = {
            id: existente ? existente.id : null,
            nome: existente ? existente.nome : '',
            palavras: existente ? existente.palavras.slice() : [],
            modo: existente ? existente.modo : 'inicio',
            tocadas: !!existente,          // true = as palavras não acompanham mais o nome
            erro: '',
            sug: existente ? undefined : sugestoesDoEstoque()
        };
        el('stqModalTitle').textContent = existente ? 'Editar categoria' : 'Nova categoria';
        el('stqModalBody').innerHTML = `
            <label class="form-label">Nome da categoria</label>
            <input class="form-control" id="catNome" type="text" maxlength="${CAT_NOME_MAX}" placeholder="Ex: Carregadores" autocomplete="off"/>
            <label class="form-label mt-3">Como o filtro acha os produtos</label>
            <div class="stq-catman-modos" id="catModos">
                <button type="button" data-modo="inicio">Nome começa com a palavra</button>
                <button type="button" data-modo="qualquer">Palavra em qualquer parte</button>
            </div>
            <label class="form-label mt-3" id="catPalavrasLabel"></label>
            <div class="text-secondary" style="font-size:.72rem;margin-bottom:4px;" id="catPalavrasDica"></div>
            <div class="stq-catman-chips" id="catChips"></div>
            <div style="display:flex;gap:8px;">
                <input class="form-control" id="catPalavra" type="text" maxlength="${CAT_PALAVRA_MAX + 2}" autocomplete="off"/>
                <button type="button" class="stq-modal-btn-cancel" id="catPalavraAdd" style="white-space:nowrap;">Adicionar</button>
            </div>
            <div class="stq-catman-aviso" id="catAviso"></div>
            <div id="catSugestoesWrap"></div>
            <button type="button" class="stq-modal-btn-save w-100 mt-3" id="catSalvarBtn"><i class="bi bi-check-circle-fill"></i> Salvar</button>
            <button type="button" class="stq-modal-btn-cancel w-100 mt-2" id="catVoltarBtn">Voltar</button>`;
        el('catNome').value = catForm.nome;

        el('catNome').addEventListener('input', e => {
            if (!catForm) return;
            catForm.nome = e.target.value;
            if (!catForm.tocadas) {
                const p = primeiraPalavra(catForm.nome);
                catForm.palavras = p.length >= CAT_PALAVRA_MIN ? [p] : [];
            }
            catForm.erro = '';
            renderCatChips();
        });
        el('catPalavra').addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            adicionarPalavrasDoCampo();
        });
        el('catPalavraAdd').addEventListener('click', adicionarPalavrasDoCampo);
        el('catModos').querySelectorAll('button[data-modo]').forEach(b => b.addEventListener('click', () => {
            if (!catForm || catForm.modo === b.dataset.modo) return;
            catForm.modo = b.dataset.modo;
            catForm.erro = '';
            renderCatModo();
            renderCatChips();
        }));
        el('catSalvarBtn').addEventListener('click', salvarCategoria);
        el('catVoltarBtn').addEventListener('click', mostrarCatLista);
        renderCatModo();
        renderCatChips();
    }

    // Textos que dependem de "começa com" x "em qualquer parte" (botões, explicação, campo)
    function renderCatModo() {
        if (!catForm || !el('catModos')) return;
        const qualquer = catForm.modo === 'qualquer';
        el('catModos').querySelectorAll('button[data-modo]').forEach(b => {
            const ativo = b.dataset.modo === catForm.modo;
            b.classList.toggle('active', ativo);
            b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
        });
        el('catPalavrasLabel').textContent = qualquer ? 'Palavras que aparecem no nome do produto' : 'Palavras com que o nome do produto começa';
        el('catPalavrasDica').textContent = qualquer
            ? 'Vale em qualquer lugar do nome, até no meio de outra palavra ("fone" acha "Microfone"). Pode ser uma frase, como "caixa de som". Separe com vírgula.'
            : 'Singular e plural valem. A palavra do nome já vem preenchida; acrescente outras se quiser.';
        el('catPalavra').placeholder = qualquer ? 'Palavra ou frase + Enter' : 'Outra palavra + Enter';
    }

    function renderCatChips() {
        const wrap = el('catChips');
        if (!wrap || !catForm) return;
        wrap.innerHTML = catForm.palavras.length
            ? catForm.palavras.map(w => `<span class="stq-catman-chip">${esc(w)}<button type="button" data-w="${esc(w)}" aria-label="Remover ${esc(w)}"><i class="bi bi-x-lg"></i></button></span>`).join('')
            : `<span class="text-secondary" style="font-size:.76rem;">Nenhuma palavra ainda. Digite o nome acima ou adicione uma.</span>`;
        wrap.querySelectorAll('button[data-w]').forEach(b => b.addEventListener('click', () => {
            catForm.palavras = catForm.palavras.filter(x => x !== b.dataset.w);
            catForm.tocadas = true;
            catForm.erro = '';
            renderCatChips();
        }));
        renderCatAviso();
        renderCatSugestoes();
    }

    // Erro de validação (vermelho) ou, se não houver, o aviso de palavra repetida em outra categoria (âmbar)
    function renderCatAviso() {
        const box = el('catAviso');
        if (!box || !catForm) return;
        if (catForm.erro) { box.className = 'stq-catman-aviso erro'; box.textContent = catForm.erro; return; }
        const outras = categoriasEditaveis().filter(c => c.id !== catForm.id);
        const repetidas = [];
        catForm.palavras.forEach(w => {
            const f = formasDaPalavra(w);
            const dona = outras.find(c => [...f].some(x => c.formas.has(x)));
            if (dona) repetidas.push(`"${w}" também está em "${dona.nome}"`);
        });
        box.className = 'stq-catman-aviso alerta';
        box.textContent = repetidas.length ? `${repetidas.join('; ')}. Se o nome combinar com as duas, vale a de "começa com a palavra"; entre iguais, a que vier primeiro na lista.` : '';
    }

    function renderCatSugestoes() {
        const wrap = el('catSugestoesWrap');
        if (!wrap || !catForm) return;
        const sug = (catForm.sug || []).filter(([w]) => !catForm.palavras.includes(w));
        if (!sug.length) { wrap.innerHTML = ''; return; }
        wrap.innerHTML = `
            <label class="form-label mt-3">Sugestões do seu estoque <span class="text-secondary">(como começam os produtos que estão em "Outros")</span></label>
            <div class="stq-catman-chips">${sug.map(([w, n]) => `<button type="button" class="stq-cat-pill stq-catman-sug" data-w="${esc(w)}">${esc(w)} (${n})</button>`).join('')}</div>`;
        wrap.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => {
            const w = b.dataset.w;
            if (!catForm.nome.trim()) {
                catForm.nome = (w.charAt(0).toUpperCase() + w.slice(1)).slice(0, CAT_NOME_MAX);
                el('catNome').value = catForm.nome;
            }
            adicionarPalavras(w);
        }));
    }

    // Aceita várias de uma vez ("fonte, carregador"; em "qualquer parte" só a vírgula
    // separa, porque a palavra pode ser uma frase). Devolve false se alguma foi recusada.
    function adicionarPalavras(texto) {
        if (!catForm) return false;
        const qualquer = catForm.modo === 'qualquer';
        const partes = (qualquer ? normalizarTexto(texto).split(/[,;]+/) : normalizarTexto(texto).split(/[\s,;]+/)).map(w => w.replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (!partes.length) return true;
        const erros = [];
        partes.forEach(w => {
            if (!(qualquer ? /^[a-z0-9]+( [a-z0-9]+)*$/ : /^[a-z0-9]+$/).test(w)) erros.push(`"${w}": use só letras e números`);
            else if (w.length < CAT_PALAVRA_MIN || w.length > CAT_PALAVRA_MAX) erros.push(`"${w}": use de ${CAT_PALAVRA_MIN} a ${CAT_PALAVRA_MAX} letras`);
            else if (catForm.palavras.includes(w)) { /* já está */ }
            else if (catForm.palavras.length >= CAT_PALAVRAS_MAX) erros.push(`no máximo ${CAT_PALAVRAS_MAX} palavras`);
            else catForm.palavras.push(w);
        });
        catForm.tocadas = true;
        catForm.erro = erros.length ? [...new Set(erros)].join('; ') + '.' : '';
        renderCatChips();
        return !erros.length;
    }
    function adicionarPalavrasDoCampo() {
        const campo = el('catPalavra');
        if (!campo || !catForm) return true;
        const ok = adicionarPalavras(campo.value);
        if (ok) campo.value = '';
        return ok;
    }

    function validarCatForm() {
        const nome = catForm.nome.trim();
        if (!nome) return 'Dê um nome para a categoria.';
        const norm = normalizarTexto(nome).replace(/\s+/g, ' ');
        if (NOMES_RESERVADOS.has(norm)) return `"${nome}" já é um filtro fixo do sistema. Escolha outro nome.`;
        if (categoriasEditaveis().some(c => c.id !== catForm.id && normalizarTexto(c.nome).replace(/\s+/g, ' ') === norm)) return `Já existe uma categoria chamada "${nome}".`;
        if (!catForm.palavras.length) return catForm.modo === 'qualquer' ? 'Coloque pelo menos uma palavra: ela precisa aparecer no nome do produto.' : 'Coloque pelo menos uma palavra: o nome do produto precisa começar com ela.';
        const frase = catForm.modo === 'inicio' && catForm.palavras.find(w => w.includes(' '));
        if (frase) return `"${frase}" tem mais de uma palavra. Em "nome começa com a palavra" use uma palavra só, ou troque para "palavra em qualquer parte".`;
        if (!catForm.id && categoriasEditaveis().length >= CAT_MAX) return `Limite de ${CAT_MAX} categorias atingido.`;
        return '';
    }

    function salvarCategoria() {
        if (!catForm) return;
        if (!adicionarPalavrasDoCampo()) return;      // palavra digitada e ainda não adicionada entra junto
        const erro = validarCatForm();
        if (erro) { catForm.erro = erro; renderCatAviso(); return; }

        const atual = categoriasEditaveis();
        const dados = gravacaoInicial(atual);          // 1ª mexida da loja: grava junto o que só existia "de cabeça"
        let id = catForm.id, ordem, cor;
        if (id) {
            const c = atual.find(x => x.id === id);
            if (!c) { avisoToast('Essa categoria foi apagada em outro aparelho.'); mostrarCatLista(); return; }
            ordem = c.ordem; cor = c.cor;
        } else {
            id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
            ordem = atual.reduce((m, c) => Math.max(m, c.ordem), -1) + 1;
            cor = CORES_CATEGORIA.find(x => !atual.some(c => c.cor.toLowerCase() === x)) || CORES_CATEGORIA[atual.length % CAT_MAX];
        }
        dados[`lista/${id}`] = { nome: catForm.nome.trim(), palavras: catForm.palavras.slice(), modo: catForm.modo, cor, ordem };

        const btn = el('catSalvarBtn'), sessao = sessaoModal;
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        gravarCategorias(dados)
            .then(() => {
                if (sessao !== sessaoModal) return;
                mostrarCatLista();
                avisoToast('Categoria salva!');
            })
            .catch(e => {
                if (sessao !== sessaoModal || !catForm) return;
                window._setBtnLoading && window._setBtnLoading(btn, false);
                catForm.erro = textoDoErroCategoria(e);
                renderCatAviso();
            });
    }

    // Apagar e restaurar pedem DUAS confirmações: mexe no filtro da loja inteira.
    function confirmarEmDuasEtapas(msg1, msg2, textoFinal, aoConfirmar) {
        window.showCustomModal({
            message: msg1, confirmText: 'Continuar', cancelText: 'Cancelar', onCancel: () => {},
            onConfirm: () => window.showCustomModal({
                message: msg2, confirmText: textoFinal, cancelText: 'Voltar', onCancel: () => {},
                onConfirm: aoConfirmar
            })
        });
    }

    function apagarCategoria(id) {
        const c = categoriasEditaveis().find(x => x.id === id);
        if (!c) return;
        confirmarEmDuasEtapas(
            `Apagar a categoria "${c.nome}"? Nenhum produto é apagado: eles só deixam de aparecer nesse filtro e passam para "Outros" (ou para outra categoria que combine com o nome). Isso vale para a loja inteira, em todos os aparelhos.`,
            `Última confirmação: apagar "${c.nome}"? Para ter de volta, você vai precisar criar de novo ou usar "Restaurar padrão".`,
            'Sim, apagar',
            () => {
                const atual = categoriasEditaveis();           // relê: outro aparelho pode ter mexido entre as duas confirmações
                const alvo = atual.find(x => x.id === id);
                if (!alvo) { avisoToast('Essa categoria já foi apagada em outro aparelho.'); return; }
                const dados = gravacaoInicial(atual);
                if (alvo.virtual) delete dados[`lista/${id}`];   // nunca foi gravada: basta não gravar
                else dados[`lista/${id}`] = null;
                const sessao = sessaoModal;
                gravarCategorias(dados)
                    .then(() => { if (sessao === sessaoModal && catTela === 'lista') renderCatLista(); avisoToast('Categoria apagada.'); })
                    .catch(e => avisoToast(textoDoErroCategoria(e)));
            }
        );
    }

    function restaurarPadraoCategorias() {
        if (!jaPersonalizado()) { avisoToast('As categorias já estão no padrão.'); return; }
        confirmarEmDuasEtapas(
            'Restaurar as categorias para o padrão (Celulares, Áudio, Notebooks, Capas, Películas, Carregadores e Cabos)? As categorias que você criou ou mudou serão apagadas, em todos os aparelhos da loja. Nenhum produto é alterado.',
            'Última confirmação: voltar tudo para o padrão? Isso não dá para desfazer.',
            'Sim, restaurar',
            () => {
                const sessao = sessaoModal;
                Promise.resolve(window._dbRemove(window._lojaRef('categoriasProduto')))
                    .then(() => { if (sessao === sessaoModal && catTela === 'lista') renderCatLista(); avisoToast('Categorias restauradas para o padrão.'); })
                    .catch(e => avisoToast(textoDoErroCategoria(e)));
            }
        );
    }

    // ── Cor picker (form Novo/Editar) ──────────────────────────────
    function corSelecionada(nome) { return coresSelecionadas.some(c => c.nome === nome); }

    function renderCorPicker() {
        const wrap = el('stqCorPicker');
        if (!wrap) return;
        const mapaNomes = new Map(CORES_SUGERIDAS.map(c => [c.nome, c]));
        coresSelecionadas.forEach(c => { if (!mapaNomes.has(c.nome)) mapaNomes.set(c.nome, c); });
        const todasCores = Array.from(mapaNomes.values());

        wrap.innerHTML = todasCores.map(cor => `
            <button type="button" class="stq-cor-tag ${corSelecionada(cor.nome) ? 'active' : ''}" data-nome="${esc(cor.nome)}" data-hex="${esc(cor.hex)}">
                <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${esc(cor.hex)};margin-right:5px;vertical-align:middle;"></span>${esc(cor.nome)}
            </button>
        `).join('');
        wrap.querySelectorAll('.stq-cor-tag').forEach(btn => {
            btn.addEventListener('click', () => {
                const nome = btn.dataset.nome, hex = btn.dataset.hex;
                if (corSelecionada(nome)) coresSelecionadas = coresSelecionadas.filter(c => c.nome !== nome);
                else coresSelecionadas.push({ nome, hex });
                renderCorPicker();
            });
        });
        atualizarResumosForm();
    }

    function adicionarCorCustom() {
        const input = el('stqCorCustom');
        const hexInput = el('stqCorCustomHex');
        const val = (input.value || '').trim();
        if (!val) return;
        if (!corSelecionada(val)) coresSelecionadas.push({ nome: val, hex: hexInput.value || '#666666' });
        input.value = '';
        renderCorPicker();
    }

    const LIMIAR_ALERTA_CUSTO = 5; // % — só alerta se a variação passar disso, evita virar spam

    function calcVariacaoCusto(p) {
        // Compara o que foi PAGO na última reposição com a média de ANTES
        // dessa reposição — não a média nova com a média velha (a média
        // suaviza de propósito, então media-nova-vs-media-velha perde
        // sensibilidade justamente quando o estoque já existente é grande).
        if (!p.precoCompraAnterior || p.ultimoValorEntrada == null) return 0;
        return ((p.ultimoValorEntrada - p.precoCompraAnterior) / p.precoCompraAnterior) * 100;
    }
    function calcMargem(compra, venda) {
        if (!compra) return venda > 0 ? 999 : 0;
        return ((venda - compra) / compra) * 100;
    }

    // Banner de "custo mudou" anexado ao card do produto na lista —
    // some sozinho quando ignorado ou quando o preço é revisado/salvo.
    function alertaCustoHtml(p) {
        // Esse alerta mexe com preço de custo e margem — informação que
        // já é escondida de quem não pode editar produto em outros
        // lugares da tela (ver podeVerCustoLog no histórico). Sem essa
        // trava, um Funcionário sem permissão via o preço pago E tinha
        // um atalho ("Ajustar preço de venda") pra abrir a edição mesmo
        // sem poder editar.
        const podeEditarAlerta = typeof window._temPermissao === 'function' ? window._temPermissao('estoque_editar_produto') : true;
        if (!podeEditarAlerta) return '';
        if (p.alertaCustoIgnorado) return '';
        const variacao = calcVariacaoCusto(p);
        if (Math.abs(variacao) < LIMIAR_ALERTA_CUSTO) return '';
        const subiu = variacao > 0;
        const margem = calcMargem(p.precoCompra, p.valor);
        return `
            <div class="stq-alerta-custo ${subiu ? 'subiu' : 'desceu'}">
                <span class="emo">${subiu ? '🔺' : '🔻'}</span>
                <div class="txt">
                    <b>Pagou ${fmt(p.ultimoValorEntrada)}</b> na última reposição — ${Math.abs(variacao).toFixed(0)}% ${subiu ? 'mais caro' : 'mais barato'}
                    que sua média anterior (${fmt(p.precoCompraAnterior)}). Média agora: ${fmt(p.precoCompra)}.
                    ${subiu
                        ? `Sua margem caiu pra <b>${margem.toFixed(0)}%</b>.`
                        : `Sua margem subiu pra <b>${margem.toFixed(0)}%</b> — dá pra baixar o preço e ficar mais competitivo, se quiser.`}
                    <div class="stq-alerta-acoes">
                        <button type="button" class="stq-alerta-btn principal" data-action="ajustar-alerta" data-id="${p.id}">Ajustar preço de venda</button>
                        <button type="button" class="stq-alerta-btn secundario" data-action="ignorar-alerta" data-id="${p.id}">Ignorar</button>
                    </div>
                </div>
            </div>`;
    }
    function ignorarAlertaCusto(produto) {
        window._dbUpdate(window._lojaRef(`products/${produto.id}`), { alertaCustoIgnorado: true })
            .then(renderLista)
            .catch(e => window.showCustomModal({ message: `Erro: ${e.message}` }));
    }

    // ── Campos de dinheiro (Compra, Venda e valor do Repor) ──────────
    // Digitação de calculadora: só dígitos, os 2 últimos são os centavos
    // (1 2 5 0 0 → "R$ 125,00"). O texto do campo é SEMPRE o valor formatado —
    // nunca dê parseFloat direto no .value: use lerMoeda / lerMoedaOuNull e
    // escreverMoeda. Vírgula, ponto e "R$" digitados são ignorados.
    const MAX_DIGITOS_MOEDA = 9; // até R$ 9.999.999,99
    function formatarMoeda(n) { return 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function digitosDoCampo(input) { return String((input && input.value) || '').replace(/\D/g, '').slice(0, MAX_DIGITOS_MOEDA); }
    function lerMoedaOuNull(input) { const d = digitosDoCampo(input); return d ? parseInt(d, 10) / 100 : null; } // null = campo vazio
    function lerMoeda(input) { const n = lerMoedaOuNull(input); return n === null ? 0 : n; }
    function escreverMoeda(input, n) {
        if (!input) return;
        input.value = (n === null || n === undefined || n === '' || !(Number(n) >= 0)) ? '' : formatarMoeda(Math.round(Number(n) * 100) / 100);
    }
    // Texto colado ("1.234,56", "1234,5", "12.50"): entende o decimal em vez de tratar tudo como centavos.
    function numeroDeTextoColado(t) {
        if (/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
        if (/^\d+(\.\d{1,2})?$/.test(t)) return Number(t);
        return null;
    }
    function aplicarMascaraMoeda(input) {
        if (!input) return;
        input.addEventListener('input', () => {
            const d = digitosDoCampo(input);
            input.value = d ? formatarMoeda(parseInt(d, 10) / 100) : '';
        });
        input.addEventListener('paste', e => {
            const n = numeroDeTextoColado(((e.clipboardData || window.clipboardData).getData('text') || '').replace(/R\$|\s/g, ''));
            if (n === null) return; // formato estranho: deixa colar normal (a máscara limpa no 'input')
            e.preventDefault();
            escreverMoeda(input, n);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    }

    // Formulário Novo/Editar produto. A MESMA estrutura serve celular e PC: no celular as classes
    // stq-fp-* viram seções, cartões, seletor "Já tinha / Acabei de comprar", chips e grupos
    // recolhíveis (style.mobile.css); no PC elas ficam neutras e o formulário continua como sempre
    // foi (style.pc.css). Os ids e os campos de verdade (input/select/radio/checkbox) são os de sempre.
    function formBodyHtml(viaAlerta) {
        const etiquetaOk = typeof window._etiquetaTermicaDisponivel === 'function' && window._etiquetaTermicaDisponivel();
        return `
            <div class="stq-fp ${viaAlerta ? 'stq-fp-alerta' : ''}">
                <div class="stq-fp-sec">O produto</div>
                <div class="stq-fp-card">
                    <div class="mb-3 stq-fp-nome">
                        <label class="form-label" for="stqNome"><i class="bi bi-box-seam"></i> Nome do Produto</label>
                        <input class="form-control" id="stqNome" type="text" placeholder="Ex: iPhone 11 128GB" autocomplete="off"/>
                    </div>
                </div>

                <div class="stq-fp-sec">Preço</div>
                <div class="stq-fp-card">
                    <div class="row w-100 mb-3" style="display:flex;gap:10px;">
                        <div style="flex:1;" class="${viaAlerta ? 'stq-campo-destacado' : ''}">
                            <label class="form-label" for="stqPrecoCompra">
                                <i class="bi bi-cart-dash"></i> Compra <span class="text-secondary small stq-fp-hint-uso">(usada no lucro)</span>
                                ${viaAlerta ? `<span class="stq-badge-auto">🔄 Automático</span>` : ''}
                            </label>
                            <input class="form-control" id="stqPrecoCompra" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"/>
                        </div>
                        <div style="flex:1;">
                            <label class="form-label" for="stqValor"><i class="bi bi-cart-check"></i> Venda</label>
                            <input class="form-control" id="stqValor" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"/>
                        </div>
                    </div>
                    <div class="stq-fp-lucro" id="stqLucroLinha"></div>
                    <div id="stqMargemWrap"></div>
                </div>

                <div class="stq-fp-sec">Estoque</div>
                <div class="stq-fp-card">
                    <div class="mb-3">
                        <label class="form-label" for="stqQuantidade"><i class="bi bi-123"></i> Quantidade em Estoque</label>
                        <div class="stq-fp-step">
                            <button type="button" class="stq-fp-stepbtn" id="stqQtdMenos" aria-label="Diminuir quantidade">−</button>
                            <input class="form-control" id="stqQuantidade" type="number" step="1" min="0" placeholder="0" inputmode="numeric"/>
                            <button type="button" class="stq-fp-stepbtn" id="stqQtdMais" aria-label="Aumentar quantidade">+</button>
                        </div>
                    </div>
                    <div class="mb-3 small" id="stqCompraInicialDica" style="display:none;color:#fbbf24;"></div>
                    <div class="mb-3" id="stqCompraInicialWrap" style="display:none;">
                        <div class="form-label fw-semibold">Esse estoque você…</div>
                        <div class="stq-fp-seg">
                            <label for="stqOrigemTinha" class="stq-origem-opcao" data-origem="tinha">
                                <input class="form-check-input mt-1" type="radio" name="stqOrigemEstoque" id="stqOrigemTinha" value="tinha"/>
                                <span><strong>Já tinha</strong><span class="text-secondary small d-block stq-origem-desc">Só estou cadastrando. Não vira despesa. O preço de compra continua valendo pro lucro.</span></span>
                            </label>
                            <label for="stqOrigemCompreiRadio" class="stq-origem-opcao" data-origem="comprei">
                                <input class="form-check-input mt-1" type="radio" name="stqOrigemEstoque" id="stqOrigemCompreiRadio" value="comprei"/>
                                <span><strong>Acabei de comprar</strong><span class="text-secondary small d-block stq-origem-desc" id="stqOrigemCompreiTexto"></span></span>
                            </label>
                        </div>
                        <div class="stq-fp-explica" id="stqOrigemExplica"></div>
                    </div>
                </div>

                <div class="stq-fp-grupo" id="stqGrupoDetalhes">
                    <button type="button" class="stq-fp-gh" aria-expanded="false">
                        <span class="stq-fp-gic"><i class="bi bi-tag-fill"></i></span>
                        <span class="stq-fp-gt"><span class="stq-fp-gn">Detalhes</span><span class="stq-fp-gs" id="stqResumoDetalhes"></span></span>
                        <i class="bi bi-chevron-right stq-fp-chev"></i>
                    </button>
                    <div class="stq-fp-gcorpo">
                        <div class="mb-3 stq-fp-codigo">
                            <label class="form-label" for="stqCodigoBarras"><i class="bi bi-upc-scan"></i> Código de Barras <span class="text-secondary small">(opcional)</span></label>
                            <div style="display:flex;gap:8px;">
                                <input class="form-control" id="stqCodigoBarras" type="text" placeholder="Leia com a pistola, digite, ou gere abaixo" style="flex:1;"/>
                                <button type="button" class="btn btn-secondary vs-so-celular" id="stqLerCodigoBtn" title="Ler com a câmera" aria-label="Ler código de barras com a câmera"><i class="bi bi-upc-scan"></i></button>
                                <button type="button" class="btn btn-secondary" id="stqGerarCodigoBtn" title="Gerar e salvar código de barras"><i class="bi bi-magic"></i></button>
                            </div>
                            <div id="stqBarcodePreviewWrap" class="hidden mt-2" style="text-align:center;background:#fff;border-radius:8px;padding:10px;">
                                <svg id="stqBarcodePreview"></svg>
                                ${etiquetaOk ? `
                                <div style="display:flex;gap:8px;justify-content:center;align-items:center;" class="mt-1">
                                    <label for="stqCopiasEtiqueta" class="small mb-0" style="color:#333;">Qtd</label>
                                    <input type="number" class="form-control form-control-sm" id="stqCopiasEtiqueta" min="1" max="100" step="1" value="1" style="width:72px;"/>
                                    <button type="button" class="btn btn-sm btn-info" id="stqImprimirCodigoBtn"><i class="bi bi-printer-fill"></i> Imprimir etiqueta</button>
                                </div>` : ''}
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label" for="stqCondicao"><i class="bi bi-patch-check"></i> Condição <span class="text-secondary small">(opcional)</span></label>
                            <select class="form-control" id="stqCondicao">
                                <option value="">Sem condição definida</option>
                                ${Object.entries(window._condicoesProduto || {}).map(([slug, nome]) => `<option value="${esc(slug)}">${esc(nome)}</option>`).join('')}
                            </select>
                            <div class="stq-fp-chips" id="stqCondicaoChips"></div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label"><i class="bi bi-palette"></i> Cores disponíveis</label>
                            <div class="stq-cor-picker" id="stqCorPicker"></div>
                            <div class="stq-cor-add-row">
                                <input class="form-control" id="stqCorCustom" type="text" placeholder="Outra cor..." style="flex:2;"/>
                                <input class="form-control" id="stqCorCustomHex" type="color" value="#666666" style="flex:0 0 46px;padding:4px;"/>
                                <button class="btn btn-secondary btn-sm" id="stqCorAddBtn">+</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="stq-fp-grupo" id="stqGrupoAvisos">
                    <button type="button" class="stq-fp-gh" aria-expanded="false">
                        <span class="stq-fp-gic"><i class="bi bi-bell-fill"></i></span>
                        <span class="stq-fp-gt"><span class="stq-fp-gn">Avisos e conferência</span><span class="stq-fp-gs" id="stqResumoAvisos"></span></span>
                        <i class="bi bi-chevron-right stq-fp-chev"></i>
                    </button>
                    <div class="stq-fp-gcorpo">
                        <div class="mb-3 form-check form-switch stq-fp-lin">
                            <input class="form-check-input" type="checkbox" id="stqIgnorarContagem"/>
                            <label class="form-check-label" for="stqIgnorarContagem">Ocultar da Conferência de Estoque</label>
                        </div>
                        <div class="mb-3 form-check form-switch stq-fp-lin">
                            <input class="form-check-input" type="checkbox" id="stqSilenciarNotificacao"/>
                            <label class="form-check-label" for="stqSilenciarNotificacao">Não avisar sobre estoque baixo desse produto</label>
                        </div>
                    </div>
                </div>

                <div class="stq-modal-actions">
                    <button class="stq-modal-btn-cancel" id="stqCancelFormBtn">Cancelar</button>
                    <button class="stq-modal-btn-save" id="stqSaveBtn">Salvar<small class="stq-fp-salvar-sub" id="stqSaveSub"></small></button>
                </div>
            </div>
        `;
    }

    // ── Bloco de margem (só existe quando o modal abre a partir do
    //    alerta de custo) — vive num container próprio (#stqMargemWrap)
    //    pra poder se re-renderizar sozinho ao trocar o modo, sem
    //    precisar redesenhar o formulário inteiro (perderia foco/cores
    //    selecionadas no meio do caminho). ──────────────────────────
    let margemModo = 'valor'; // 'valor' | 'margem'
    let produtoAtualDoAlerta = null;

    function renderMargemBox() {
        const wrap = el('stqMargemWrap');
        if (!wrap || !produtoAtualDoAlerta) { if (wrap) wrap.innerHTML = ''; return; }
        const p = produtoAtualDoAlerta;
        const variacao = calcVariacaoCusto(p);
        const subiu = variacao > 0;
        const compra = lerMoeda(el('stqPrecoCompra'));
        const venda = lerMoeda(el('stqValor'));
        const margemAtual = calcMargem(compra, venda);

        wrap.innerHTML = `
            <div class="stq-tooltip-custo">
                ℹ️ Você pagou ${fmt(p.ultimoValorEntrada)} na última reposição — ${Math.abs(variacao).toFixed(0)}% ${subiu ? 'mais caro' : 'mais barato'}
                que sua média anterior (${fmt(p.precoCompraAnterior)}). A média ponderada recalculou o custo pra ${fmt(p.precoCompra)}.
                Pode corrigir na mão se achar que não bate.
            </div>
            <div class="stq-margem-box">
                <div class="stq-margem-atual">
                    <span class="lbl">Margem atual</span>
                    <span class="val ${margemAtual >= 30 ? 'boa' : 'ruim'}" id="stqMargemVal">${margemAtual.toFixed(0)}%</span>
                </div>
                <div class="stq-margem-toggle">
                    <button type="button" data-modo="valor" class="${margemModo === 'valor' ? 'active' : ''}">Definir por valor</button>
                    <button type="button" data-modo="margem" class="${margemModo === 'margem' ? 'active' : ''}">Definir por margem %</button>
                </div>
                ${margemModo === 'margem' ? `
                    <label class="form-label">Margem desejada (%)</label>
                    <input class="form-control" id="stqMargemDesejada" type="number" step="1" value="${Math.max(margemAtual, 30).toFixed(0)}"/>
                    <div class="stq-margem-sugestao">Preço de venda sugerido: <b id="stqSugestaoVenda">${fmt(venda)}</b></div>
                ` : ''}
            </div>
        `;

        wrap.querySelectorAll('[data-modo]').forEach(btn => {
            btn.addEventListener('click', () => { margemModo = btn.dataset.modo; renderMargemBox(); atualizarBloqueioVenda(); });
        });
        el('stqMargemDesejada')?.addEventListener('input', atualizarSugestaoPorMargem);
        if (margemModo === 'margem') atualizarSugestaoPorMargem();
        atualizarBloqueioVenda();
    }

    function atualizarBloqueioVenda() {
        const vendaInput = el('stqValor');
        if (vendaInput) vendaInput.disabled = (margemModo === 'margem');
    }

    function atualizarSugestaoPorMargem() {
        const compra = lerMoeda(el('stqPrecoCompra'));
        const margemDesejada = parseFloat(el('stqMargemDesejada')?.value) || 0;
        const vendaSugerida = compra * (1 + margemDesejada / 100);
        const sug = el('stqSugestaoVenda');
        if (sug) sug.innerHTML = fmt(vendaSugerida);
        const vendaInput = el('stqValor');
        escreverMoeda(vendaInput, vendaSugerida);
    }

    // Linha "Lucro por unidade" (celular): venda − compra, em R$ e em % sobre o custo.
    function atualizarLucroLinha() {
        const linha = el('stqLucroLinha');
        if (!linha) return;
        const compra = lerMoeda(el('stqPrecoCompra'));
        const venda = lerMoeda(el('stqValor'));
        if (!(compra > 0) || !(venda > 0)) { linha.innerHTML = '<span>Lucro por unidade</span><b>—</b>'; return; }
        const lucro = venda - compra;
        const pct = (lucro / compra) * 100;
        linha.innerHTML = `<span>Lucro por unidade</span><b class="${lucro < 0 ? 'ruim' : (pct >= 30 ? 'boa' : '')}">${fmt(lucro)} · ${pct.toFixed(0)}%</b>`;
    }

    function atualizarMargemAoVivo() {
        atualizarLucroLinha();
        if (!produtoAtualDoAlerta) return;
        const compra = lerMoeda(el('stqPrecoCompra'));
        const venda = lerMoeda(el('stqValor'));
        const m = calcMargem(compra, venda);
        const elMargem = el('stqMargemVal');
        if (elMargem) {
            elMargem.textContent = m.toFixed(0) + '%';
            elMargem.className = 'val ' + (m >= 30 ? 'boa' : 'ruim');
        }
    }

    function bindFormEvents() {
        el('stqCancelFormBtn')?.addEventListener('click', fecharModal);
        el('stqSaveBtn')?.addEventListener('click', salvarProduto);
        el('stqCorAddBtn')?.addEventListener('click', adicionarCorCustom);
        el('stqCorCustom')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); adicionarCorCustom(); } });
        aplicarMascaraMoeda(el('stqPrecoCompra')); // primeiro: os outros ouvintes já leem o campo formatado
        aplicarMascaraMoeda(el('stqValor'));
        el('stqPrecoCompra')?.addEventListener('input', atualizarMargemAoVivo);
        el('stqPrecoCompra')?.addEventListener('input', atualizarCompraInicial);
        el('stqQuantidade')?.addEventListener('input', atualizarCompraInicial);
        el('stqValor')?.addEventListener('input', atualizarMargemAoVivo);
        el('stqGerarCodigoBtn')?.addEventListener('click', gerarCodigoBarrasParaForm);
        el('stqLerCodigoBtn')?.addEventListener('click', lerCodigoDoFormPelaCamera);
        el('stqCodigoBarras')?.addEventListener('input', () => { renderBarcodePreview(el('stqCodigoBarras').value); atualizarResumosForm(); });
        el('stqQtdMenos')?.addEventListener('click', () => passoQuantidade(-1));
        el('stqQtdMais')?.addEventListener('click', () => passoQuantidade(1));
        el('stqCondicaoChips')?.addEventListener('click', e => {
            const chip = e.target.closest('.stq-fp-chip');
            if (!chip || !el('stqCondicao')) return;
            el('stqCondicao').value = chip.dataset.v;
            atualizarResumosForm();
        });
        ['stqIgnorarContagem', 'stqSilenciarNotificacao'].forEach(id => el(id)?.addEventListener('change', atualizarResumosForm));
        document.querySelectorAll('.stq-fp-gh').forEach(btn => btn.addEventListener('click', () => {
            const aberto = btn.parentElement.classList.toggle('aberto');
            btn.setAttribute('aria-expanded', aberto ? 'true' : 'false');
        }));
        el('stqImprimirCodigoBtn')?.addEventListener('click', () => imprimirEtiquetaCodigoBarras(el('stqCodigoBarras')?.value || ''));
        renderCorPicker();
        renderMargemBox();
        document.querySelectorAll('input[name="stqOrigemEstoque"]').forEach(r => r.addEventListener('change', () => { origemEstoqueLembrada = r.value; realcarOrigemEscolhida(); }));
        if (origemEstoqueLembrada) { // cadastrando vários em sequência: já vem a última escolha (a 1ª vez, nenhuma marcada)
            const r = document.querySelector(`input[name="stqOrigemEstoque"][value="${origemEstoqueLembrada}"]`);
            if (r) r.checked = true;
        }
        realcarOrigemEscolhida(); // também atualiza o bloco de origem (atualizarCompraInicial)
        atualizarLucroLinha();
        atualizarResumosForm();
    }

    // Botões − / + da Quantidade (celular). Dispara 'input' pra tudo que depende do campo
    // (bloco "já tinha / acabei de comprar", total da compra) reagir como se tivesse digitado.
    function passoQuantidade(delta) {
        const campo = el('stqQuantidade');
        if (!campo) return;
        campo.value = Math.max(0, (parseInt(campo.value, 10) || 0) + delta);
        campo.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Chips da Condição (espelham o <select>, que segue sendo o campo lido no Salvar) e as linhas
    // de resumo dos grupos recolhidos "Detalhes" e "Avisos e conferência" (celular).
    function atualizarResumosForm() {
        const sel = el('stqCondicao');
        const chips = el('stqCondicaoChips');
        if (sel && chips) {
            chips.innerHTML = Array.from(sel.options).map(o =>
                `<button type="button" class="stq-fp-chip ${o.value === sel.value ? 'active' : ''}" data-v="${esc(o.value)}">${esc(o.value === '' ? 'Nenhuma' : o.textContent)}</button>`
            ).join('');
        }
        const detalhes = [];
        if (sel && sel.value && sel.selectedOptions[0]) detalhes.push(sel.selectedOptions[0].textContent);
        if (coresSelecionadas.length) detalhes.push(coresSelecionadas.length + (coresSelecionadas.length > 1 ? ' cores' : ' cor'));
        if ((el('stqCodigoBarras')?.value || '').trim()) detalhes.push('código de barras');
        const avisos = [];
        if (el('stqIgnorarContagem')?.checked) avisos.push('fora da conferência');
        if (el('stqSilenciarNotificacao')?.checked) avisos.push('sem aviso de estoque baixo');
        const rDet = el('stqResumoDetalhes');
        const rAv = el('stqResumoAvisos');
        if (rDet) rDet.textContent = detalhes.length ? detalhes.join(' · ') : 'Condição, cores e código de barras';
        if (rAv) rAv.textContent = avisos.length ? avisos.join(' · ') : 'Tudo padrão';
    }

    // ── Estoque do cadastro de produto novo: "já tinha" ou "acabei de comprar"? ──
    //    Preço de compra (custo) e despesa no Financeiro são coisas DIFERENTES: o custo é o que o
    //    lucro usa e deve ser preenchido sempre; já a despesa só existe se o estoque foi comprado
    //    AGORA. Antes uma caixinha já vinha marcada e a dica dizia "preencha Compra pra registrar
    //    no Financeiro" — quem cadastrava o estoque que já tinha gerava uma despesa falsa, ou
    //    deixava o custo em branco e perdia o lucro. Agora a pergunta fica na tela desde que o
    //    cadastro abre, com duas opções e NENHUMA marcada de partida. A escolha só é EXIGIDA quando há
    //    quantidade E preço de compra (aí há o que decidir); sem isso o produto salva direto (erro
    //    silencioso no financeiro é pior que um toque a mais). Escolheu "Acabei de comprar": o produto nasce com
    //    estoque 0 e a quantidade entra como ENTRADA — o mesmo caminho do Repor (histórico, custo
    //    médio e despesa "Compra de Produto"). "Já tinha": entra direto no cadastro, sem despesa.
    //    Cadastrando vários em sequência, a última escolha já vem marcada.
    let origemEstoqueLembrada = null;
    function origemDoEstoqueEscolhida() {
        return document.querySelector('input[name="stqOrigemEstoque"]:checked')?.value || null;
    }
    function realcarOrigemEscolhida() {
        document.querySelectorAll('#stqCompraInicialWrap .stq-origem-opcao').forEach(l => {
            l.classList.toggle('escolhida', !!l.querySelector('input')?.checked);
            l.classList.remove('stq-origem-erro');
        });
        atualizarCompraInicial();
    }
    function atualizarCompraInicial() {
        const wrap = el('stqCompraInicialWrap');
        if (!wrap) return;
        const quantidade = parseInt(el('stqQuantidade')?.value, 10) || 0;
        const valorUnitario = lerMoeda(el('stqPrecoCompra'));
        const calculavel = quantidade > 0 && valorUnitario > 0; // dá pra mostrar o total da compra
        const origem = origemDoEstoqueEscolhida();
        wrap.style.display = editingId ? 'none' : ''; // visível desde o início no cadastro novo; nunca na edição
        wrap.dataset.ativa = (quantidade > 0 || origem) ? '1' : '0'; // celular: a pergunta só aparece com quantidade (ou se já houver escolha)
        // A dica lembra de preencher a Compra: é o que o lucro usa (não tem nada a ver com lançar
        // despesa). Aparece desde que o formulário abre, enquanto a Compra estiver vazia; some quando
        // ela é preenchida (o custo já está garantido) e no modo edição.
        const dica = el('stqCompraInicialDica');
        if (dica) {
            const mostrarDica = !editingId && !(valorUnitario > 0);
            dica.style.display = mostrarDica ? '' : 'none';
            if (mostrarDica) {
                dica.innerHTML = quantidade > 0
                    ? '💡 Preencha <b>Compra</b> (quanto você paga em cada unidade): é com ela que o app calcula o seu lucro, mesmo que esse estoque seja antigo.'
                    : '💡 Preencha <b>Compra</b> (quanto você paga em cada unidade): é com ela que o app calcula o seu lucro.';
            }
        }
        el('stqOrigemCompreiTexto').textContent = calculavel
            ? `Lança como despesa no Financeiro — ${fmt(quantidade * valorUnitario)} (${quantidade} × ${fmt(valorUnitario)}), hoje.`
            : 'Lança como despesa no Financeiro o total da compra (Quantidade × Compra), hoje.';

        // Celular: uma explicação só, da opção escolhida, no lugar do texto dentro de cada opção.
        const explica = el('stqOrigemExplica');
        if (explica) {
            let tom = '', texto;
            if (!origem) texto = 'Escolha uma das duas pra eu saber se isso vira despesa.';
            else if (origem === 'tinha') texto = 'Só cadastro. Não vira despesa. O preço de compra segue valendo pro lucro.';
            else if (calculavel) { tom = ' ok'; texto = `Vai lançar ${fmt(quantidade * valorUnitario)} como despesa em Financeiro › Produto (${quantidade} × ${fmt(valorUnitario)}).`; }
            else { tom = ' aviso'; texto = `Falta ${quantidade > 0 ? 'o preço de Compra' : (valorUnitario > 0 ? 'a Quantidade' : 'a Quantidade e o preço de Compra')} pra lançar a despesa no Financeiro.`; }
            explica.className = 'stq-fp-explica' + tom;
            explica.textContent = texto;
        }
        // Celular: o botão Salvar diz o que vai acontecer com o Financeiro.
        const sub = el('stqSaveSub');
        if (sub) sub.textContent = !editingId && origem === 'comprei' && calculavel ? `e lançar ${fmt(quantidade * valorUnitario)} no Financeiro` : '';
    }
    // Há quantidade E preço de compra (a pergunta está na tela) e nenhuma opção foi marcada?
    function faltaEscolherOrigemDoEstoque() {
        if (editingId) return false;
        const quantidade = parseInt(el('stqQuantidade')?.value, 10) || 0;
        return quantidade > 0 && lerMoeda(el('stqPrecoCompra')) > 0 && !origemDoEstoqueEscolhida();
    }
    function avisarFaltaEscolherOrigem() {
        window.showCustomModal({ message: 'Escolha se esse estoque você já tinha ou se acabou de comprar. É assim que o app sabe se lança a compra no Financeiro.' });
        document.querySelectorAll('#stqCompraInicialWrap .stq-origem-opcao').forEach(l => l.classList.add('stq-origem-erro'));
        el('stqCompraInicialWrap')?.scrollIntoView?.({ block: 'center' });
    }
    // Barra o salvamento (e avisa) quando: há quantidade + compra e nada foi escolhido; ou foi escolhido
    // "Acabei de comprar" e falta a quantidade e/ou o valor de compra (sem os dois não dá pra lançar a
    // despesa — antes o produto salvava calado, sem despesa nenhuma, mesmo a pessoa tendo dito que
    // comprou: com a Quantidade em branco, que é como o formulário abre, nada acontecia e nada avisava).
    function origemDoEstoqueBloqueia() {
        if (editingId) return false;
        if (faltaEscolherOrigemDoEstoque()) { avisarFaltaEscolherOrigem(); return true; }
        if (origemDoEstoqueEscolhida() === 'comprei') {
            const faltando = [];
            if (!((parseInt(el('stqQuantidade')?.value, 10) || 0) > 0)) faltando.push('a Quantidade em Estoque');
            if (!(lerMoeda(el('stqPrecoCompra')) > 0)) faltando.push('o campo Compra (quanto você pagou em cada unidade)');
            if (faltando.length) {
                window.showCustomModal({ message: `Você marcou "Acabei de comprar", então preencha ${faltando.join(' e ')}: é com isso que a compra entra no Financeiro. Se não comprou agora, escolha "Já tinha".` });
                return true;
            }
        }
        return false;
    }
    function compraInicialDoFormulario() {
        if (editingId || origemDoEstoqueEscolhida() !== 'comprei') return null;
        const quantidade = parseInt(el('stqQuantidade')?.value, 10) || 0;
        const valorUnitario = lerMoeda(el('stqPrecoCompra'));
        return quantidade > 0 && valorUnitario > 0 ? { quantidade, valorUnitario } : null;
    }

    // ── Desenha o código de barras (SVG) no preview do formulário —
    //    some se o campo estiver vazio ou se a lib não conseguir
    //    desenhar aquele texto (ex: caracteres não suportados). ──
    let _barcodePendente = '';
    function renderBarcodePreview(codigo) {
        const wrap = el('stqBarcodePreviewWrap');
        const svg  = el('stqBarcodePreview');
        if (!wrap || !svg) return;
        const valor = (codigo || '').trim();
        if (valor && typeof window.JsBarcode !== 'function') {
            // JsBarcode carrega sob demanda (window._vsLib): desenha assim que chegar,
            // se o campo ainda tiver o mesmo código (a pessoa pode ter continuado digitando).
            _barcodePendente = valor;
            window._vsLib('jsbarcode')
                .then(() => { if (_barcodePendente === valor) renderBarcodePreview(valor); })
                .catch(() => { /* sem a biblioteca só não há prévia; o código continua sendo salvo */ });
            wrap.classList.add('hidden');
            return;
        }
        if (!valor) {
            wrap.classList.add('hidden');
            return;
        }
        try {
            window.JsBarcode(svg, valor, { format: 'CODE128', displayValue: true, height: 50, margin: 6 });
            wrap.classList.remove('hidden');
        } catch (e) {
            // Código com caractere que o CODE128 não desenha — não é erro
            // fatal, só não tem preview (o texto ainda é salvo normal).
            wrap.classList.add('hidden');
        }
    }

    // ── Próximo código único da loja (ex: 00000001) via contador atômico —
    //    mesmo padrão/robustez de numeroVenda em venda/lancar.js,
    //    protegido contra 2 PCs gerando ao mesmo tempo. Só dígitos, sem
    //    prefixo de letra: mais compatível com leitores/formatos de
    //    código de barras padrão de mercado (EAN-13 etc. só aceitam
    //    dígito), e sem embutir nome de loja nenhum — é um SaaS
    //    multi-tenant, o número já é único por loja via _lojaRef.
    //    Um código digitado à mão em outro produto pode coincidir com
    //    um número que o contador ainda vai gerar: se já estiver em
    //    uso, pula pro próximo (o número pulado se perde, sem problema). ──
    async function proximoCodigoBarrasLivre(idIgnorar) {
        for (let tentativa = 0; tentativa < 50; tentativa++) {
            const resultado = await window._dbTransaction(window._lojaRef('contadorCodigosBarras'), atual => (atual || 0) + 1);
            if (!resultado.committed) throw new Error('Não foi possível gerar o código, tente de novo.');
            const codigo = String(resultado.snapshot.val()).padStart(8, '0');
            const emUso = (window.products || []).some(p =>
                p.id !== idIgnorar && p.codigoBarras && p.codigoBarras.trim().toUpperCase() === codigo
            );
            if (!emUso) return codigo;
        }
        throw new Error('Não foi possível achar um código livre, tente de novo.');
    }

    // ── Gera e grava um código num produto JÁ cadastrado (usada pelo
    //    formulário e pelo botão "Etiqueta" do card). Transaction em
    //    products/{id}/codigoBarras: só grava se estiver vazio (outro
    //    caixa pode ter gerado antes — nesse caso devolve o dele). ──
    async function garantirCodigoNoProduto(idProduto) {
        const codigo = await proximoCodigoBarrasLivre(idProduto);
        const res = await window._dbTransaction(
            window._lojaRef(`products/${idProduto}/codigoBarras`),
            atual => atual ? undefined : codigo
        );
        if (res.committed) {
            // Produto excluído em outro caixa no meio do processo: a
            // gravação acima teria criado um "produto fantasma" só
            // com o código — desfaz e avisa.
            const existe = await window._dbGet(window._lojaRef(`products/${idProduto}/nome`));
            if (!existe.exists()) {
                await window._dbRemove(window._lojaRef(`products/${idProduto}`));
                throw new Error('Este produto foi excluído em outro caixa.');
            }
            return { codigo, jaTinhaCodigo: false };
        }
        // Outro caixa gravou um código antes — mantém o dele.
        const existente = res.snapshot.val();
        if (!existente) throw new Error('Não foi possível gravar o código, tente de novo.');
        return { codigo: existente, jaTinhaCodigo: true };
    }

    // ── Botão "gerar código": gera E JÁ GRAVA no produto, sem precisar
    //    apertar Salvar — assim nunca dá pra imprimir uma etiqueta com
    //    um código que o produto não tem no banco (o leitor não acharia
    //    o produto na venda). Só o campo codigoBarras é gravado; o resto
    //    do formulário continua pendente até o Salvar.
    //    · Produto existente: transaction em products/{id}/codigoBarras,
    //      só grava se estiver vazio (outro caixa pode ter gerado antes).
    //    · Produto NOVO: ainda não existe no banco, então é cadastrado
    //      agora (com o que já estiver preenchido; nome é obrigatório) e
    //      o modal passa a editar esse produto.
    //    O campo/preview só são preenchidos depois da gravação confirmada. ──
    // Celular: a câmera lê UM código (leitor-camera.js) e ele entra no campo como se tivesse sido
    // digitado — o 'input' atualiza a prévia e os resumos; a trava de duplicidade é a do salvarProduto,
    // mas já avisa aqui pra não descobrir só no fim do cadastro.
    let lendoPelaCamera = false;
    function lerCodigoDoFormPelaCamera() {
        if (lendoPelaCamera || typeof window._vsLerCodigoCamera !== 'function') return;
        lendoPelaCamera = true;
        window._vsLerCodigoCamera()
            .then(codigo => {
                const campo = el('stqCodigoBarras');
                if (!codigo || !campo) return;
                campo.value = String(codigo).trim().toUpperCase();
                campo.dispatchEvent(new Event('input'));
                const outro = (window.products || []).find(p => p.codigoBarras && p.codigoBarras.trim().toUpperCase() === campo.value && p.id !== editingId);
                if (outro) window.showCustomModal({ message: `Esse código de barras já está cadastrado no produto "${outro.nome}". Cada código só pode pertencer a um produto.` });
            })
            .finally(() => { lendoPelaCamera = false; });
    }

    async function gerarCodigoBarrasParaForm() {
        const btn = el('stqGerarCodigoBtn');
        if (el('stqCodigoBarras')?.value.trim()) {
            window.showCustomModal({
                message: 'Esse produto já tem um código de barras. Apague o campo primeiro se quiser gerar um novo.',
            });
            return;
        }
        const idProduto = editingId; // null = produto novo
        const sessao = sessaoModal;
        const permissao = idProduto ? 'estoque_editar_produto' : 'estoque_criar_produto';
        if (typeof window._temPermissao === 'function' && !window._temPermissao(permissao)) {
            window.showCustomModal({ message: 'Você não tem permissão pra gerar código de barras.' });
            return;
        }
        if (!idProduto && !(el('stqNome')?.value || '').trim()) {
            window.showCustomModal({ message: 'Digite o nome do produto antes de gerar o código — o produto é cadastrado ao gerar.' });
            return;
        }
        if (origemDoEstoqueBloqueia()) return;
        const salvarBtn = el('stqSaveBtn');
        if (btn) { btn.disabled = true; }
        if (salvarBtn) salvarBtn.disabled = true; // Salvar durante a criação criaria um 2º produto
        try {
            let codigoFinal;
            let jaTinhaCodigo = false;
            let novoId = null;
            let quantidadeCriada = 0;
            let compraRegistradaNaCriacao = false;
            let erroCompraNaCriacao = null;

            if (idProduto) {
                ({ codigo: codigoFinal, jaTinhaCodigo } = await garantirCodigoNoProduto(idProduto));
            } else {
                const { quantidade, payload } = lerFormularioProduto();
                const compraInicial = compraInicialDoFormulario(); // lido no momento do clique (o usuário pode mexer enquanto espera)
                codigoFinal = await proximoCodigoBarrasLivre(null);
                payload.codigoBarras = codigoFinal;
                const criado = await criarProdutoNovo(payload, quantidade, compraInicial);
                novoId = criado.id;
                // Estoque que realmente ficou gravado — base do "Ajuste manual" se o
                // usuário mexer na quantidade e clicar em Salvar depois.
                quantidadeCriada = compraInicial && !criado.compraRegistrada ? 0 : quantidade;
                compraRegistradaNaCriacao = criado.compraRegistrada;
                erroCompraNaCriacao = criado.erroCompra;
            }

            // O formulário fechou (ou foi trocado) durante a gravação: o
            // código já está salvo no produto, só não há tela pra atualizar.
            if (sessao !== sessaoModal) return;
            if (novoId) {
                editingId = novoId;
                quantidadeOriginalEdicao = quantidadeCriada; // o que foi realmente gravado — base do "Ajuste manual" no Salvar
                el('stqModalTitle').textContent = 'Editar Produto';
                atualizarCompraInicial(); // agora é edição: a opção de compra some
            }
            if (el('stqCodigoBarras')) el('stqCodigoBarras').value = codigoFinal;
            renderBarcodePreview(codigoFinal);
            atualizarResumosForm();
            if (jaTinhaCodigo) {
                window.showCustomModal({ message: `Este produto já tinha o código ${codigoFinal} (gerado em outro caixa). Mantido esse código.` });
            } else if (typeof window._showSuccessOverlay === 'function') {
                window._showSuccessOverlay(compraRegistradaNaCriacao ? 'Código gerado, produto salvo e compra registrada!' : 'Código gerado e salvo no produto!');
            }
            if (erroCompraNaCriacao) {
                window.showCustomModal({ message: `Produto criado, mas NÃO consegui registrar a compra (${erroCompraNaCriacao.message}). O estoque ficou em 0 — use o botão Repor, com o valor de compra, pra lançar a entrada.` });
            }
        } catch (e) {
            window.showCustomModal({ message: `Erro ao gerar código: ${e.message}` });
        } finally {
            if (btn) btn.disabled = false;
            if (salvarBtn) salvarBtn.disabled = false;
        }
    }

    // ── Imprimir etiqueta com o código de barras — usa a impressora de
    //    ETIQUETAS dedicada (Knup KP-IM600, diferente da térmica de
    //    recibo/KP-IM602), via impressao/etiqueta-termica.js. Exige
    //    nome do produto porque a etiqueta imprime nome + código
    //    juntos (ver montarEtiquetaProduto em tspl-builder.js, que
    //    corta nomes longos com "..." e valida o código). ──
    const COPIAS_MAX_ETIQUETA = 100; // mesmo limite do tspl-builder.js
    function imprimirEtiquetaCodigoBarras(codigo) {
        if (!codigo || !codigo.trim()) {
            window.showCustomModal({ message: 'Gere ou digite um código de barras antes de imprimir.' });
            return;
        }
        const nome = (el('stqNome')?.value || '').trim();
        if (!nome) {
            window.showCustomModal({ message: 'Preencha o nome do produto antes de imprimir a etiqueta.' });
            return;
        }
        if (typeof window._imprimirEtiquetaProduto !== 'function') {
            window.showCustomModal({ message: 'Impressão de etiquetas só está disponível na versão Desktop (.exe) do VortexSmart.' });
            return;
        }
        const copias = Number(el('stqCopiasEtiqueta')?.value);
        if (!Number.isInteger(copias) || copias < 1 || copias > COPIAS_MAX_ETIQUETA) {
            window.showCustomModal({ message: `Informe a quantidade de etiquetas (de 1 a ${COPIAS_MAX_ETIQUETA}).` });
            return;
        }
        window._imprimirEtiquetaProduto(nome, codigo.trim(), { copias });
    }

    // ── Botão "Etiqueta" do card: pergunta quantas e imprime. Produto
    //    sem código ganha um agora (gerado e gravado, igual à varinha
    //    do formulário). Fechar o modal antes de imprimir cancela. ──
    function abrirImpressaoEtiqueta(produto) {
        const estoque = Math.max(0, parseInt(produto.quantidade, 10) || 0);
        const atalho = Math.min(estoque, COPIAS_MAX_ETIQUETA);
        const body = abrirModal('primary', 'Imprimir Etiquetas');
        body.innerHTML = `
            <div class="mb-3">
                <label class="form-label">Produto</label>
                <input class="form-control" value="${esc(produto.nome)}" disabled/>
            </div>
            <div class="mb-3">
                <label class="form-label">Quantas etiquetas?</label>
                <input class="form-control" id="stqEtiquetaQtd" type="number" min="1" max="${COPIAS_MAX_ETIQUETA}" step="1" value="1"/>
                ${atalho > 1 ? `<button type="button" class="btn btn-sm btn-secondary mt-2" id="stqEtiquetaUsarEstoqueBtn">Usar estoque (${atalho}${estoque > COPIAS_MAX_ETIQUETA ? ` — máx. ${COPIAS_MAX_ETIQUETA}` : ''})</button>` : ''}
            </div>
            <div class="stq-modal-actions">
                <button class="stq-modal-btn-cancel" id="stqEtiquetaCancelarBtn">Cancelar</button>
                <button class="stq-modal-btn-save" id="stqEtiquetaImprimirBtn"><i class="bi bi-printer-fill"></i> Imprimir</button>
            </div>
        `;
        el('stqEtiquetaCancelarBtn').addEventListener('click', fecharModal);
        el('stqEtiquetaUsarEstoqueBtn')?.addEventListener('click', () => { el('stqEtiquetaQtd').value = atalho; });
        el('stqEtiquetaImprimirBtn').addEventListener('click', () => confirmarImpressaoEtiqueta(produto.id));
        el('stqEtiquetaQtd').addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            confirmarImpressaoEtiqueta(produto.id);
        });
        setTimeout(() => { el('stqEtiquetaQtd')?.focus(); el('stqEtiquetaQtd')?.select(); }, 100);
    }

    async function confirmarImpressaoEtiqueta(idProduto) {
        const copias = Number(el('stqEtiquetaQtd')?.value);
        if (!Number.isInteger(copias) || copias < 1 || copias > COPIAS_MAX_ETIQUETA) {
            window.showCustomModal({ message: `Informe a quantidade de etiquetas (de 1 a ${COPIAS_MAX_ETIQUETA}).` });
            return;
        }
        // Dados ATUAIS (não os de quando o painel abriu): o produto pode
        // ter ganhado código, mudado de nome ou sido excluído desde então.
        const atual = (window.products || []).find(p => p.id === idProduto);
        if (!atual) {
            window.showCustomModal({ message: 'Esse produto não foi encontrado (pode ter sido removido ou arquivado).' });
            return;
        }
        const btn = el('stqEtiquetaImprimirBtn');
        const sessao = sessaoModal;
        if (btn) btn.disabled = true;
        try {
            let codigo = (atual.codigoBarras || '').trim();
            let gerado = false;
            if (!codigo) {
                if (typeof window._temPermissao === 'function' && !window._temPermissao('estoque_editar_produto')) {
                    throw new Error('Você não tem permissão pra gerar código de barras.');
                }
                ({ codigo } = await garantirCodigoNoProduto(idProduto));
                gerado = true;
            }
            if (sessao !== sessaoModal) return; // fechou o modal enquanto gerava: cancelou (o código, se gerado, já ficou salvo)
            fecharModal();
            if (gerado) window.showCustomModal({ message: `Código ${codigo} gerado e salvo no produto.` });
            window._imprimirEtiquetaProduto(atual.nome, codigo, { copias });
        } catch (e) {
            window.showCustomModal({ message: `Erro ao preparar etiqueta: ${e.message}` });
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── Abrir modal Novo / Editar produto ─────────────────────────
    function openFormForNew() {
        fecharPainelExpandido();
        editingId = null;
        quantidadeOriginalEdicao = null;
        coresSelecionadas = [];
        produtoAtualDoAlerta = null;
        const body = abrirModal('primary', 'Novo Produto');
        el('stqModalBackdrop').classList.add('stq-fp-tela');
        body.innerHTML = formBodyHtml(false);
        bindFormEvents();
    }

    // viaAlerta: true quando veio do botão "Ajustar preço de venda" do
    // banner de custo — destaca o campo Compra e mostra a calculadora
    // de margem. Editar Produto pelo caminho normal (lápis do card)
    // continua exatamente como sempre foi, sem esse bloco extra.
    function openFormForEdit(produto, viaAlerta) {
        // Trava central: TODO caminho que chega aqui (lápis normal, botão
        // do alerta de custo, atalho da notificação de estoque baixo)
        // passa por essa checagem — evita reabrir a mesma brecha de
        // permissão por um caminho novo amanhã.
        const podeEditar = typeof window._temPermissao === 'function' ? window._temPermissao('estoque_editar_produto') : true;
        if (!podeEditar) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Você não tem permissão pra editar produtos.' });
            return;
        }
        editingId = produto.id;
        quantidadeOriginalEdicao = produto.quantidade ?? 0;
        coresSelecionadas = Array.isArray(produto.cores) ? produto.cores.map(c => ({ nome: c.nome, hex: c.hex || '#666666' })) : [];
        margemModo = 'valor';
        produtoAtualDoAlerta = viaAlerta ? produto : null;
        const body = abrirModal('primary', 'Editar Produto');
        el('stqModalBackdrop').classList.add('stq-fp-tela');
        body.innerHTML = formBodyHtml(!!viaAlerta);
        bindFormEvents();
        el('stqNome').value = produto.nome || '';
        if (el('stqCodigoBarras')) el('stqCodigoBarras').value = produto.codigoBarras || '';
        renderBarcodePreview(produto.codigoBarras || '');
        escreverMoeda(el('stqPrecoCompra'), produto.precoCompra);
        escreverMoeda(el('stqValor'), produto.valor);
        el('stqQuantidade').value = produto.quantidade ?? '';
        el('stqIgnorarContagem').checked = !!produto.ignorarContagem;
        if (el('stqSilenciarNotificacao')) el('stqSilenciarNotificacao').checked = !!produto.notificacaoEstoqueDesativada;
        if (el('stqCondicao')) el('stqCondicao').value = produto.condicao || '';
        atualizarMargemAoVivo();
        atualizarResumosForm();
        // Celular: os grupos recolhidos já abrem se tiverem algo preenchido (não esconde o que o produto tem).
        const abrirGrupo = (id, temConteudo) => {
            const g = el(id);
            if (!g || !temConteudo) return;
            g.classList.add('aberto');
            g.querySelector('.stq-fp-gh')?.setAttribute('aria-expanded', 'true');
        };
        abrirGrupo('stqGrupoDetalhes', !!(produto.codigoBarras || produto.condicao || coresSelecionadas.length));
        abrirGrupo('stqGrupoAvisos', !!(produto.ignorarContagem || produto.notificacaoEstoqueDesativada));
    }

    // Lê o formulário aberto e monta o payload do produto (sem quantidade
    // — ver nota abaixo). Usada pelo Salvar e pelo "gerar código" de
    // produto novo, pra as duas regras nunca divergirem.
    function lerFormularioProduto() {
        const nome = (el('stqNome').value || '').trim();
        const codigoBarras = (el('stqCodigoBarras')?.value || '').trim().toUpperCase();
        const valor = lerMoeda(el('stqValor'));
        const quantidade = parseInt(el('stqQuantidade').value, 10) || 0;
        const precoCompra = lerMoedaOuNull(el('stqPrecoCompra')); // null = campo vazio
        const ignorarContagem = !!el('stqIgnorarContagem').checked;
        const notificacaoEstoqueDesativada = !!el('stqSilenciarNotificacao')?.checked;
        const condicao = el('stqCondicao')?.value || '';

        // Quantidade NÃO entra no payload genérico — ver correção abaixo
        // (moverEstoque, transacional) logo depois de decidir se mudou.
        const payload = { nome, codigoBarras: codigoBarras || null, valor, ignorarContagem, notificacaoEstoqueDesativada, cores: coresSelecionadas, condicao: condicao || null };
        if (precoCompra !== null) payload.precoCompra = precoCompra;
        return { nome, codigoBarras, quantidade, payload };
    }

    // Cria o produto novo. Com compraInicial, ele nasce com estoque 0 e a
    // quantidade entra por moverEstoque('entrada', valor de compra) — a mesma
    // entrada do Repor. Se só a entrada falhar, o produto já existe (estoque 0)
    // e o erro volta em erroCompra: nada é apagado, dá pra lançar pelo Repor.
    async function criarProdutoNovo(payload, quantidade, compraInicial) {
        const comCompra = !!(compraInicial && quantidade > 0 && compraInicial.valorUnitario > 0);
        payload.criadoEm = Date.now();
        payload.quantidade = comCompra ? 0 : quantidade;
        const novaRef = window._dbPush(window._lojaRef('products'), payload);
        await novaRef;
        const id = novaRef.key;
        if (!comCompra) return { id, compraRegistrada: false, erroCompra: null };
        try {
            await moverEstoque({ id }, quantidade, 'entrada', { valorUnitario: compraInicial.valorUnitario });
            return { id, compraRegistrada: true, erroCompra: null };
        } catch (e) {
            return { id, compraRegistrada: false, erroCompra: e };
        }
    }

    // ── Salvar (add ou update) ──────────────────────────────────
    function salvarProduto() {
        const { nome, codigoBarras, quantidade, payload } = lerFormularioProduto();

        if (!nome) { window.showCustomModal({ message: 'Digite o nome do produto.' }); return; }

        // Trava de duplicidade: dois produtos não podem compartilhar o
        // mesmo código de barras — na leitura (venda/lancar.js), a busca
        // pega o primeiro que encontrar e ignora silenciosamente que
        // existe outro, então isso precisa ser barrado aqui na origem,
        // antes de gravar, não descoberto depois na hora da venda.
        if (codigoBarras) {
            const outroComMesmoCodigo = (window.products || []).find(p =>
                p.codigoBarras && p.codigoBarras.trim().toUpperCase() === codigoBarras && p.id !== editingId
            );
            if (outroComMesmoCodigo) {
                window.showCustomModal({ message: `Esse código de barras já está cadastrado no produto "${outroComMesmoCodigo.nome}". Cada código só pode pertencer a um produto.` });
                return;
            }
        }

        // Salvou pelo modal (revisou preço/custo na mão) — considera o
        // alerta de custo resolvido, se existia um.
        if (produtoAtualDoAlerta) {
            payload.alertaCustoIgnorado = null;
            payload.precoCompraAnterior = null;
            payload.ultimoValorEntrada = null;
        }

        if (origemDoEstoqueBloqueia()) return;
        const idParaSalvar = editingId;
        if (idParaSalvar) {
            // Quantidade mudou por edição direta (não por reposição/venda,
            // que já passam por moverEstoque) — registra como "Ajuste
            // manual" no histórico, senão a mudança não deixa rastro
            // nenhum. Não vira despesa automática: essa tela não pede
            // preço nenhum, inventar um valor aqui seria chute.
            //
            // CORREÇÃO (lost update): antes, a quantidade ia junto no
            // mesmo _dbUpdate genérico do resto do produto, como valor
            // ABSOLUTO calculado contra o que a tela tinha quando o modal
            // abriu. Se o estoque mudasse nesse meio-tempo (ex: uma venda
            // concorrente em outro caixa), esse update sobrescrevia de
            // volta o valor antigo, apagando a mudança concorrente sem
            // deixar rastro nenhum e sem entrar no histórico (delta contra
            // valor velho batia 0 mesmo tendo havido movimento real).
            // Agora: quantidade nunca vai no _dbUpdate genérico. Quando
            // mudou, passa por moverEstoque (transaction — lê o valor
            // ATUAL no Firebase e aplica o delta em cima dele), a mesma
            // função central que venda e reposição já usam.
            const deltaAjuste = quantidadeOriginalEdicao != null ? quantidade - quantidadeOriginalEdicao : 0;
            window._dbUpdate(window._lojaRef(`products/${idParaSalvar}`), payload)
                .then(() => {
                    if (deltaAjuste !== 0) {
                        return moverEstoque({ id: idParaSalvar }, deltaAjuste, 'ajuste', {});
                    }
                })
                .then(() => {
                    window.showCustomModal({ message: 'Produto atualizado.' }); fecharModal(); fecharPainelExpandido();
                })
                .catch(e => window.showCustomModal({ message: `Erro ao salvar: ${e.message}` }));
        } else {
            // Produto NOVO — sem risco de lost-update aqui (não existe
            // "valor atual no Firebase" pra perder, o produto está sendo
            // criado agora), então a quantidade inicial entra direto no
            // cadastro, diferente da edição acima — ou, se marcado, como
            // compra registrada (ver criarProdutoNovo).
            // Botão travado até terminar: clique duplo criaria 2 produtos — e agora
            // também 2 compras no Financeiro. Só destrava se der erro (sucesso fecha o modal).
            const salvarBtn = el('stqSaveBtn');
            if (salvarBtn) salvarBtn.disabled = true;
            criarProdutoNovo(payload, quantidade, compraInicialDoFormulario())
                .then(r => {
                    window.showCustomModal({
                        message: r.erroCompra
                            ? `Produto cadastrado, mas NÃO consegui registrar a compra (${r.erroCompra.message}). O estoque ficou em 0 — use o botão Repor, com o valor de compra, pra lançar a entrada.`
                            : (r.compraRegistrada ? 'Produto cadastrado e compra registrada no Financeiro.' : 'Produto cadastrado.')
                    });
                    fecharModal();
                })
                .catch(e => {
                    if (salvarBtn) salvarBtn.disabled = false;
                    window.showCustomModal({ message: `Erro ao salvar: ${e.message}` });
                });
        }
    }

    // ── Excluir ──────────────────────────────────────────────────
    function excluirProduto(produto) {
        // Apagar é pra produto cadastrado POR ENGANO: leva o histórico junto e, no servidor
        // (financeiroSyncReposicao), as compras dele saem do Financeiro. Venda já feita NÃO é
        // apagada (dinheiro que entrou de verdade) — pra venda errada, cancele a venda.
        // Produto certo que só não é mais vendido: ARQUIVAR (não apaga nada).
        const historico = Object.values(produto.historico || {});
        const podeVerCusto = typeof window._temPermissao === 'function' ? window._temPermissao('estoque_editar_produto') : true;
        const compras = historico.filter(h => h.tipo === 'entrada' && h.valorUnitario != null && !h.estornadoEm)
            .reduce((s, h) => s + h.valorUnitario * Math.abs(h.delta || 0), 0);
        const vendas = new Set(historico.filter(h => h.tipo === 'saida' && h.vendaId).map(h => h.vendaId)).size;
        const partes = [`Apagar "${produto.nome}"? Isso remove o produto e o histórico dele${compras > 0 && podeVerCusto ? `, e tira do Financeiro as compras dele (${fmt(compras)})` : ''}.`];
        if (vendas > 0) partes.push(`As ${vendas} venda(s) já feitas NÃO são apagadas: continuam em Vendas e na receita do Financeiro.`);
        partes.push('Use Apagar só se o produto foi cadastrado por engano; se está certo e você só quer escondê-lo, use Arquivar. Não dá pra desfazer.');
        window.showCustomModal({
            message: partes.join(' '),
            onConfirm: () => {
                window._dbRemove(window._lojaRef(`products/${produto.id}`))
                    .then(() => window.showCustomModal({ message: 'Produto excluído.' }))
                    .catch(e => window.showCustomModal({ message: `Erro ao excluir: ${e.message}` }));
            },
            onCancel: () => {}
        });
    }

    // ── moverEstoque: função central — toda mudança de quantidade
    //    passa por aqui, sempre com registro no histórico.
    //
    //    Dois caminhos de gravação do histórico:
    //      - COM meta.chaveMovimento (vendas e cancelamentos, ver venda/lancar.js
    //        e venda/historico.js): a entrada é gravada DENTRO da mesma transaction
    //        que muda a quantidade, sob essa chave fixa — quantidade e registro
    //        entram juntos ou nenhum entra. Se a chave já existir, a transaction
    //        vira no-op (resolve com jaAplicado:true), então repetir a mesma
    //        chamada (retry depois de rede caída) NUNCA mexe duas vezes no estoque.
    //      - SEM chave (reposição, estorno de reposição): o push do histórico é
    //        uma escrita separada, depois da transaction.
    //
    //    Exposta globalmente porque o módulo de Venda também usa ela
    //    (baixa automática no estoque ao fechar uma venda).
    //    Pode resultar em quantidade NEGATIVA — é intencional: o
    //    lançamento de venda (venda/lancar.js) já avisa e pede
    //    confirmação antes de vender com estoque insuficiente; aqui
    //    só executa o que já foi combinado com o usuário, sem travar
    //    em zero e silenciosamente vender "de graça" a diferença.
    //
    //    Custo médio ponderado: numa ENTRADA (reposição) com valor de
    //    compra informado, recalcula precoCompra do produto — o que já
    //    tinha em estoque pesa pela quantidade atual, o que tá entrando
    //    pesa pela quantidade da reposição. É esse precoCompra que o
    //    Relatório usa pra calcular Lucro Real. Campo opcional: se não
    //    informar valor na reposição, não mexe no custo guardado — e o
    //    campo "Compra" em Editar Produto continua editável na mão a
    //    qualquer momento, pra quem quiser corrigir manualmente.
    //
    //    Guarda precoCompraAnterior toda vez que recalcula — é o que a
    //    tela de Produtos usa pra comparar e decidir se mostra o alerta
    //    "custo mudou, quer revisar o preço de venda?". Limpa
    //    alertaCustoIgnorado nesse momento também: se o custo mudou de
    //    novo, um "Ignorar" de uma mudança ANTERIOR não vale mais. ──────
    function moverEstoque(produto, delta, tipo, meta = {}) {
        const produtoRef = window._lojaRef(`products/${produto.id}`);
        const valorUnitarioEntrada = (tipo === 'entrada' && meta.valorUnitario != null && meta.valorUnitario !== '' && Number(meta.valorUnitario) > 0)
            ? Number(meta.valorUnitario)
            : null;
        const valorUnitarioFinal = (meta.valorUnitario != null && meta.valorUnitario !== '') ? meta.valorUnitario : null;
        // Chaves do Firebase não aceitam . # $ [ ] / — troca por _ (os ids de venda e os índices que
        // lancar.js monta já são seguros; isso é só rede de proteção contra uma chave futura mal formada).
        const chaveMov = meta.chaveMovimento ? String(meta.chaveMovimento).replace(/[.#$\[\]\/]/g, '_') : null;
        let jaAplicado = false; // só o resultado da ÚLTIMA execução da função abaixo vale (o SDK pode rodá-la várias vezes)

        // CORREÇÃO (C4 — custo médio irreversível): antes, o estorno de
        // uma reposição diminuía a quantidade mas nunca tocava em
        // precoCompra — a média ponderada ficava contaminada pra sempre
        // por uma entrada que devia ter sido desfeita. Agora, toda
        // ENTRADA com valor grava no próprio registro do histórico o
        // snapshot exato de ANTES dela (quantidadeAntesDaEntrada,
        // precoCompraAntesDaEntrada) — é esse snapshot que o estorno usa
        // pra reverter a média com precisão matemática, em vez de tentar
        // reconstruir o "antes" a partir do estado atual (que pode já
        // ter sido alterado por outras entradas/vendas).
        let quantidadeAntesDaEntradaCapturada = null;
        let precoCompraAntesDaEntradaCapturada = null;

        // Monta o registro de histórico. Usado pelos DOIS caminhos de gravação (dentro da transaction
        // quando há chaveMov, push separado quando não há) pra não duplicar o formato.
        const montarEntradaHistorico = quantidadeApos => ({
            tipo,
            delta,
            quantidadeApos,
            fornecedor: meta.fornecedor || null,
            cliente: meta.cliente || null,
            // Vincula esse movimento à venda que o originou (quando aplicável — 'saida'/'estorno' de uma
            // venda rastreia qual venda mexeu nesse estoque). Null pra reposição e movimentos manuais.
            vendaId: meta.vendaId || null,
            valorUnitario: valorUnitarioFinal,
            // Só preenchido quando essa entrada mexeu na média (C4) — null em qualquer outro tipo de
            // movimentação (venda, estorno de venda, ajuste manual, entrada sem valor).
            quantidadeAntesDaEntrada: quantidadeAntesDaEntradaCapturada,
            precoCompraAntesDaEntrada: precoCompraAntesDaEntradaCapturada,
            timestamp: Date.now(),
            // Quem fez a movimentação — nome gravado direto: um log é um retrato do que aconteceu NAQUELE
            // momento; se a pessoa mudar de nome depois, o histórico continua mostrando quem era à época.
            usuarioUid:  window._firebaseAuthUid || null,
            usuarioNome: window._nomeUsuario || 'Usuário',
        });

        return window._dbTransaction(produtoRef, atual => {
            if (!atual) return undefined; // produto sumiu — aborta, não inventa nada
            if (chaveMov && atual.historico && atual.historico[chaveMov]) {
                jaAplicado = true;
                return atual; // movimento já gravado antes — no-op, não mexe na quantidade
            }
            jaAplicado = false;
            quantidadeAntesDaEntradaCapturada = null;
            precoCompraAntesDaEntradaCapturada = null;
            const quantidadeAtual = atual.quantidade || 0;
            const novaQuantidade = quantidadeAtual + delta;

            let novoPrecoCompra = atual.precoCompra || 0;
            let precoCompraAnterior = atual.precoCompraAnterior ?? null;
            let ultimoValorEntrada = atual.ultimoValorEntrada ?? null;
            let alertaCustoIgnorado = atual.alertaCustoIgnorado ?? null;
            if (valorUnitarioEntrada !== null) {
                // Snapshot de ANTES dessa entrada específica — gravado no
                // histórico logo abaixo, pra permitir reverter esta
                // entrada (e só esta) com exatidão, se um dia for
                // estornada enquanto ainda for a última movimentação.
                quantidadeAntesDaEntradaCapturada = quantidadeAtual;
                precoCompraAntesDaEntradaCapturada = atual.precoCompra || 0;

                const pesoAtual = Math.max(quantidadeAtual, 0); // estoque negativo/zerado não pesa na média
                novoPrecoCompra = Math.round(
                    ((pesoAtual * (atual.precoCompra || 0)) + (delta * valorUnitarioEntrada)) / (pesoAtual + delta) * 100
                ) / 100;
                // Guarda o preço médio de ANTES dessa entrada e o valor
                // PAGO nessa entrada em específico — é comparando esses
                // dois que o alerta decide se dispara, não a média nova
                // contra a média velha. A média suaviza de propósito (é
                // pra isso que ela serve), então usá-la pro alerta perderia
                // sensibilidade bem na hora que mais importa: quando já
                // tem bastante estoque e uma reposição vem bem mais cara.
                precoCompraAnterior = atual.precoCompra || 0;
                ultimoValorEntrada = valorUnitarioEntrada;
                alertaCustoIgnorado = null;
            }

            const proximo = { ...atual, quantidade: novaQuantidade, precoCompra: novoPrecoCompra, precoCompraAnterior, ultimoValorEntrada, alertaCustoIgnorado };
            // Com chave: o registro entra na MESMA escrita que muda a quantidade (atômico). O nó do produto
            // já é lido e regravado inteiro por esta transaction, então levar o histórico junto não custa
            // uma ida extra ao banco.
            if (chaveMov) proximo.historico = { ...(atual.historico || {}), [chaveMov]: montarEntradaHistorico(novaQuantidade) };
            return proximo;
        }).then(result => {
            if (!result.committed) throw new Error('Produto não encontrado.');
            const novoProduto = result.snapshot.val();
            if (chaveMov) return { novaQtd: novoProduto.quantidade, produtoAtualizado: novoProduto, jaAplicado };

            const histRef = window._lojaRef(`products/${produto.id}/historico`);
            // push() já devolve a referência (com .key preenchido) na
            // hora, de forma síncrona — não espera o .then() pra pegar o
            // key, porque o valor que o .then() resolve varia (pode vir
            // undefined dependendo da versão do SDK).
            const novaEntradaRef = window._dbPush(histRef, montarEntradaHistorico(novoProduto.quantidade));
            return novaEntradaRef.then(() => {
                // Financeiro: sem gancho aqui — financeiroSyncReposicao
                // (Cloud Function, Admin SDK) já reage sozinha a
                // QUALQUER 'entrada' com valor preenchido escrita nesse
                // historico, e funciona não importa quem fez a reposição
                // (Gestor ou Funcionário com permissão) — um gancho
                // client-side aqui exigiria que quem repôs também tivesse
                // permissão de escrever em financeiro/, que é 100%
                // Gestor de propósito (ver functions/index.js pro
                // raciocínio completo).
                return { novaQtd: novoProduto.quantidade, produtoAtualizado: novoProduto };
            });
        });
    }
    window._estoqueMoverEstoque = moverEstoque;

    // ── Estorno de reposição com reversão exata do custo médio (C4) ──
    // Diferente de moverEstoque (delta simples), este caminho reverte
    // quantidade E precoCompra pro snapshot exato de ANTES da entrada
    // sendo estornada (quantidadeAntesDaEntrada/precoCompraAntesDaEntrada,
    // gravados em moverEstoque no momento da entrada — ver comentário lá).
    //
    // SÓ é seguro reverter a média se NADA mexeu no produto depois
    // dessa entrada (nenhuma venda, ajuste ou outra reposição) — a
    // média é cumulativa, não em camadas independentes; reverter uma
    // entrada "no meio" da linha do tempo deixaria a média matemati-
    // camente errada mesmo que a intenção fosse boa. Decisão de negócio
    // (confirmada): nesse caso, BLOQUEIA e não mexe em nada — quem quiser
    // corrigir o custo depois de já ter havido movimento, ajusta na mão
    // em Editar Produto.
    //
    // A checagem "é a última movimentação" usa quantidadeApos (gravado
    // na própria entrada, no momento em que ela aconteceu) comparado
    // com a quantidade ATUAL do produto — se forem iguais, nada mexeu
    // depois. Essa comparação roda DENTRO da mesma transaction que faz
    // a reversão, então não existe janela pra uma venda entrar no meio
    // do caminho entre a checagem e a escrita (era exatamente essa
    // janela que permitia o estorno duplicado/incorreto antes).
    //
    // Retorna uma Promise que resolve com { bloqueado: false } se
    // reverteu, ou rejeita com Error(code:'MOVIMENTO_POSTERIOR') se
    // bloqueou por já ter havido movimento depois.
    function estornarUltimaEntrada(produto, entradaId, entradaSnapshot) {
        const produtoRef = window._lojaRef(`products/${produto.id}`);
        const entradaRef = window._lojaRef(`products/${produto.id}/historico/${entradaId}`);

        // Já estornada (quem chamou com dados velhos): nunca estorna duas vezes.
        if (entradaSnapshot.estornadoEm) {
            return Promise.reject(Object.assign(new Error('Essa reposição já foi estornada.'), { code: 'JA_ESTORNADA' }));
        }

        // Entrada SEM valor de compra nunca mexeu no custo médio (moverEstoque só
        // mexe nele — e só grava o snapshot — quando há valor): não há média pra
        // reverter, só a quantidade. Sem esse caminho, o erro mais comum (digitar
        // 50 em vez de 5, sem preço) ficava SEM como corrigir, e ainda com uma
        // mensagem enganosa de "reposição antiga".
        const semValor = entradaSnapshot.valorUnitario == null;

        // Entrada COM valor de antes dessa correção existir não tem snapshot
        // gravado — não dá pra reverter com precisão, então nem tenta:
        // mesmo bloqueio de "não é seguro reverter", mensagem própria.
        if (!semValor && (entradaSnapshot.quantidadeAntesDaEntrada == null || entradaSnapshot.precoCompraAntesDaEntrada == null)) {
            return Promise.reject(Object.assign(
                new Error('Essa reposição é de antes do sistema guardar o histórico necessário pra reverter o custo médio automaticamente. Ajuste o custo na mão em Editar Produto, se precisar.'),
                { code: 'SEM_SNAPSHOT' }
            ));
        }

        let bloqueadoPorMovimentoPosterior = false;

        return window._dbTransaction(produtoRef, atual => {
            if (!atual) return undefined; // produto sumiu — aborta, não inventa nada
            const quantidadeAtual = atual.quantidade || 0;

            // É a última movimentação relevante? Compara o estoque logo
            // APÓS a entrada (gravado nela mesma) com o estoque ATUAL —
            // se bater, nada mexeu desde então.
            if (quantidadeAtual !== entradaSnapshot.quantidadeApos) {
                bloqueadoPorMovimentoPosterior = true;
                return; // aborta a transaction sem escrever nada
            }
            bloqueadoPorMovimentoPosterior = false;

            if (semValor) {
                // Só devolve a quantidade; custo médio e alerta de custo ficam como estão.
                return { ...atual, quantidade: entradaSnapshot.quantidadeApos - (entradaSnapshot.delta || 0) };
            }
            return {
                ...atual,
                quantidade: entradaSnapshot.quantidadeAntesDaEntrada,
                precoCompra: entradaSnapshot.precoCompraAntesDaEntrada,
                // precoCompraAnterior/ultimoValorEntrada também voltam a
                // refletir "nenhuma entrada recente" — senão o alerta de
                // custo (calcVariacaoCusto) continuaria comparando contra
                // uma entrada que acabou de ser desfeita.
                precoCompraAnterior: null,
                ultimoValorEntrada: null,
                alertaCustoIgnorado: null,
            };
        }).then(result => {
            if (bloqueadoPorMovimentoPosterior) {
                return Promise.reject(Object.assign(
                    new Error('Não dá pra estornar: já houve venda, ajuste ou outra reposição desse produto depois dessa entrada — reverter agora deixaria o custo médio incorreto. Ajuste manualmente em Editar Produto, se precisar.'),
                    { code: 'MOVIMENTO_POSTERIOR' }
                ));
            }
            if (!result.committed) throw new Error('Produto não encontrado.');
            const novoProduto = result.snapshot.val();

            const histRef = window._lojaRef(`products/${produto.id}/historico`);
            const novaEntradaRef = window._dbPush(histRef, {
                tipo: 'estorno_reposicao',
                delta: -Math.abs(entradaSnapshot.delta || 0),
                quantidadeApos: novoProduto.quantidade,
                fornecedor: entradaSnapshot.fornecedor || null,
                cliente: null,
                valorUnitario: null,
                quantidadeAntesDaEntrada: null,
                precoCompraAntesDaEntrada: null,
                timestamp: Date.now(),
                usuarioUid:  window._firebaseAuthUid || null,
                usuarioNome: window._nomeUsuario || 'Usuário',
            });

            return novaEntradaRef.then(() =>
                window._dbUpdate(entradaRef, {
                    estornadoEm: Date.now(),
                    estornadoPorNome: window._nomeUsuario || 'Usuário',
                })
            ).then(() => ({ novoProduto }));
        });
    }
    window._estoqueEstornarUltimaEntrada = estornarUltimaEntrada;

    // ── Estorno TARDIO de uma compra (reposição) ─────────────────────
    // Para quando estornarUltimaEntrada bloqueia (já houve venda, ajuste
    // ou outra reposição depois, ou a compra é antiga e sem snapshot) e a
    // despesa ficaria presa no Financeiro. Em vez de reverter o custo
    // médio pro "retrato de antes" (impossível com movimento posterior),
    // TIRA O LOTE DA MÉDIA atual:
    //   custo novo = (qtdAtual × custoAtual − qtdDoLote × valorDoLote) ÷ (qtdAtual − qtdDoLote)
    // Se não sobrar estoque positivo, usa o snapshot de antes da entrada
    // (quando existe) ou mantém o custo como está.
    // O estoque diminui da quantidade da compra e pode ficar NEGATIVO
    // (parte já foi vendida) — só com permitirNegativo explícito. Venda já
    // feita nunca é alterada.
    // A despesa sai do Financeiro porque a entrada recebe 'estornadoEm'
    // (financeiroSyncReposicao já remove nesse caso e nunca recria).
    function calcularEstornoTardio(entrada, quantidadeAtual, precoCompraAtual) {
        const qtdLote = Math.abs(entrada.delta || 0);
        const quantidadeDepois = quantidadeAtual - qtdLote;
        let precoCompraDepois = precoCompraAtual;
        let metodo = 'mantido';
        if (entrada.valorUnitario != null) {
            if (quantidadeDepois > 0) {
                precoCompraDepois = Math.max(0, Math.round(((quantidadeAtual * precoCompraAtual) - (qtdLote * entrada.valorUnitario)) / quantidadeDepois * 100) / 100);
                metodo = 'recalculado';
            } else if (entrada.precoCompraAntesDaEntrada != null) {
                precoCompraDepois = entrada.precoCompraAntesDaEntrada;
                metodo = 'snapshot';
            }
        }
        return { qtdLote, quantidadeAtual, quantidadeDepois, precoCompraAtual, precoCompraDepois, metodo, valorTotal: (entrada.valorUnitario || 0) * qtdLote };
    }

    // Lê o estado de agora e devolve a previsão do que o estorno vai fazer (não grava nada).
    function preverEstornoTardio(produtoId, historicoId) {
        const base = `products/${produtoId}`;
        return Promise.all([
            window._dbGet(window._lojaRef(`${base}/historico/${historicoId}`)),
            window._dbGet(window._lojaRef(`${base}/nome`)),
            window._dbGet(window._lojaRef(`${base}/quantidade`)),
            window._dbGet(window._lojaRef(`${base}/precoCompra`)),
        ]).then(([e, n, q, pc]) => {
            const entrada = e.val();
            if (!entrada) return { entrada: null };
            const nome = n.val() || 'Produto';
            return { entrada, nome, calc: calcularEstornoTardio(entrada, q.val() || 0, pc.val() || 0) };
        });
    }

    function estornarCompraTardia(produtoId, historicoId, opcoes) {
        const permitirNegativo = !!(opcoes && opcoes.permitirNegativo);
        const produtoRef = window._lojaRef(`products/${produtoId}`);
        const entradaRef = window._lojaRef(`products/${produtoId}/historico/${historicoId}`);
        const erro = (msg, code) => Object.assign(new Error(msg), { code });
        let reivindicado = false, aplicado = false, bloqueio = null, entradaVal = null, calc = null;

        // Solta a reivindicação se algo falhar antes de mexer no produto — a Cloud
        // Function recria a despesa sozinha quando 'estornadoEm' volta a ficar vazio.
        const soltar = () => (reivindicado && !aplicado)
            ? window._dbUpdate(entradaRef, { estornadoEm: null, estornadoPorNome: null, estornoTardio: null }).catch(() => {})
            : Promise.resolve();

        // PASSO 1 — reivindica a entrada (impede estorno em dobro, inclusive de dois aparelhos).
        return window._dbTransaction(entradaRef, atual => {
            if (atual === null) return null; // cache frio — o SDK reexecuta com o dado real
            if (atual.tipo !== 'entrada' || atual.estornadoEm) return undefined;
            return { ...atual, estornadoEm: Date.now(), estornadoPorNome: window._nomeUsuario || 'Usuário', estornoTardio: true };
        }).then(res => {
            if (!res.committed || !res.snapshot.exists()) throw erro('Essa reposição já foi estornada (ou não existe mais).', 'JA_ESTORNADA');
            reivindicado = true;
            entradaVal = res.snapshot.val();
            // PASSO 2 — tira o lote do estoque e da média, atomicamente.
            return window._dbTransaction(produtoRef, atual => {
                if (!atual) return undefined;
                calc = calcularEstornoTardio(entradaVal, atual.quantidade || 0, atual.precoCompra || 0);
                if (calc.quantidadeDepois < 0 && !permitirNegativo) { bloqueio = 'ESTOQUE_INSUFICIENTE'; return undefined; }
                bloqueio = null;
                return { ...atual, quantidade: calc.quantidadeDepois, precoCompra: calc.precoCompraDepois, precoCompraAnterior: null, ultimoValorEntrada: null, alertaCustoIgnorado: null };
            });
        }).then(result => {
            if (bloqueio) throw erro('O estoque ficaria negativo — confirme novamente pra estornar mesmo assim.', bloqueio);
            if (!result.committed) throw erro('Produto não encontrado.', 'SEM_PRODUTO');
            aplicado = true;
            const novoProduto = result.snapshot.val();
            // PASSO 3 — registra no histórico do produto (auditável, com o antes/depois do custo).
            return window._dbPush(window._lojaRef(`products/${produtoId}/historico`), {
                tipo: 'estorno_reposicao',
                delta: -calc.qtdLote,
                quantidadeApos: novoProduto.quantidade,
                fornecedor: entradaVal.fornecedor || null,
                cliente: null,
                vendaId: null,
                valorUnitario: null,
                quantidadeAntesDaEntrada: null,
                precoCompraAntesDaEntrada: null,
                estornoTardio: true,
                estornoDaEntradaId: historicoId,
                precoCompraAntes: calc.precoCompraAtual,
                precoCompraDepois: calc.precoCompraDepois,
                timestamp: Date.now(),
                usuarioUid: window._firebaseAuthUid || null,
                usuarioNome: window._nomeUsuario || 'Usuário',
            }).then(() => ({ novoProduto, calc }));
        }).catch(e => soltar().then(() => { throw e; }));
    }
    window._estoqueEstornarCompraTardia = estornarCompraTardia;

    // Fluxo completo com confirmação (usado pelo Financeiro e pela tela de Movimentação).
    // aoConcluir() roda depois de tudo certo (pra a tela de origem recarregar).
    window._estoqueEstornoCompraFluxo = function (produtoId, historicoId, aoConcluir) {
        const modal = o => window.showCustomModal(o);
        const chaveFin = `estoque_${produtoId}_${historicoId}`;
        const limparLinha = () => (typeof window._financeiroRemoverAutomaticos === 'function')
            ? window._financeiroRemoverAutomaticos(k => k === chaveFin).catch(err => console.error('[Estoque] Erro ao limpar compra do Financeiro:', err))
            : Promise.resolve();
        const concluir = () => { if (typeof aoConcluir === 'function') aoConcluir(); };

        preverEstornoTardio(produtoId, historicoId).then(p => {
            // Compra que não existe mais no estoque (produto apagado) ou já estornada: só sobrou a linha no caixa.
            if (!p.entrada || p.entrada.estornadoEm || p.entrada.tipo !== 'entrada') {
                modal({
                    message: !p.entrada
                        ? 'Essa compra não existe mais no histórico do estoque (o produto foi apagado). Remover só a linha dela do Financeiro? O estoque não será alterado.'
                        : 'Essa compra já foi estornada no estoque, mas a linha ficou no Financeiro. Remover a linha agora?',
                    confirmText: 'Remover do Financeiro', cancelText: 'Cancelar',
                    onConfirm: () => limparLinha().then(() => { modal({ message: 'Removido do Financeiro.' }); concluir(); }),
                    onCancel: () => {}
                });
                return;
            }
            const c = p.calc;
            const negativo = c.quantidadeDepois < 0;
            const partes = [
                `Estornar a compra de ${c.qtdLote} un. de "${p.nome}" (${fmt(c.valorTotal)})?`,
                `Estoque: ${c.quantidadeAtual} → ${c.quantidadeDepois} un.`,
            ];
            if (c.metodo !== 'mantido' || c.precoCompraDepois !== c.precoCompraAtual) {
                partes.push(`Custo médio: ${fmt(c.precoCompraAtual)} → ${fmt(c.precoCompraDepois)} (lote tirado da média).`);
            }
            partes.push(`Remove ${fmt(c.valorTotal)} das despesas do Financeiro. Vendas já feitas não mudam. Não dá pra desfazer.`);
            if (negativo) partes.push(`⚠️ O estoque ficaria NEGATIVO (${c.quantidadeDepois}): parte dessas unidades já foi vendida. Se alguma venda foi errada, cancele a venda.`);
            modal({
                message: partes.join(' '),
                confirmText: negativo ? 'Estornar mesmo assim' : 'Estornar', cancelText: 'Cancelar',
                onConfirm: () => {
                    estornarCompraTardia(produtoId, historicoId, { permitirNegativo: negativo })
                        .then(() => limparLinha())
                        .then(() => { modal({ message: '✅ Compra estornada: estoque, custo e Financeiro atualizados.' }); concluir(); })
                        .catch(e => modal({ message: `Erro ao estornar: ${e.message}` }));
                },
                onCancel: () => {}
            });
        }).catch(e => modal({ message: `Erro ao ler a compra: ${e.message}` }));
    };

    // ── Reposição de estoque via leitura de código de barras ────────
    // Fluxo: lê o código (pistola ou digitado), acha o produto, pede
    // a quantidade recebida (não "1 leitura = 1 unidade" — reposição
    // normalmente chega em lote/caixa, então digitar a quantidade de
    // uma vez é o padrão que bate com o uso real de loja), soma ao
    // estoque via moverEstoque (já existente, com transaction segura
    // e histórico auditável — não duplica essa lógica aqui).
    // Não pede valor unitário de propósito: é reposição simples de
    // quantidade, não lançamento de compra — se o valor mudou, isso se
    // ajusta pelo cadastro normal do produto, não aqui.
    function abrirReposicaoPorLeitura() {
        const body = abrirModal('primary', 'Repor Estoque');
        body.innerHTML = `
            <label class="form-label">Código de barras</label>
            <button type="button" class="vs-scan-btn mb-2" id="stqReporCameraBtn"><i class="bi bi-upc-scan"></i> Ler com a câmera</button>
            <input class="form-control mb-3" id="stqReporCodigo" placeholder="🔫 Leia ou digite o código..." autocomplete="off"/>
            <div id="stqReporProdutoInfo"></div>
        `;
        // Pistola/teclado e câmera caem no mesmo caminho: acha o produto pelo código e pede a quantidade.
        const buscarPorCodigo = codigo => {
            if (!codigo) return;
            const produto = (window.products || []).find(p => p.codigoBarras && p.codigoBarras.trim().toUpperCase() === codigo);
            if (!produto) {
                el('stqReporProdutoInfo').innerHTML = `<div class="stq-hist-empty">Nenhum produto com o código ${esc(codigo)}.</div>`;
                el('stqReporCodigo').value = '';
                return;
            }
            renderReporProdutoInfo(produto);
        };
        // No celular o foco automático abriria o teclado por cima do botão da câmera; no PC a pistola precisa do foco
        if (document.documentElement.dataset.shell !== 'mobile') setTimeout(() => el('stqReporCodigo')?.focus(), 100);
        el('stqReporCodigo').addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            buscarPorCodigo(el('stqReporCodigo').value.trim().toUpperCase());
        });
        let lendo = false;
        el('stqReporCameraBtn').addEventListener('click', () => {
            if (lendo || typeof window._vsLerCodigoCamera !== 'function') return;
            lendo = true;
            window._vsLerCodigoCamera()
                .then(codigo => { if (codigo) buscarPorCodigo(String(codigo).trim().toUpperCase()); })
                .finally(() => { lendo = false; });
        });
    }

    function renderReporProdutoInfo(produto) {
        const infoEl = el('stqReporProdutoInfo');
        if (!infoEl) return;
        infoEl.innerHTML = `
            <div class="content-card w-100 mb-3">
                <div style="font-weight:700;">${esc(produto.nome)}</div>
                <div class="text-secondary small">Estoque atual: ${produto.quantidade ?? 0} un.</div>
            </div>
            <label class="form-label">Quantidade recebida</label>
            <input class="form-control mb-3" id="stqReporQtd" type="number" min="1" step="1" value="1"/>
            <button type="button" class="stq-modal-btn-save w-100" id="stqReporConfirmarBtn">
                <i class="bi bi-check-circle-fill"></i> Confirmar entrada
            </button>
        `;
        el('stqReporQtd')?.focus();
        el('stqReporQtd')?.select();
        el('stqReporConfirmarBtn').addEventListener('click', () => {
            const qtd = parseInt(el('stqReporQtd')?.value, 10) || 0;
            if (qtd <= 0) {
                window.showCustomModal({ message: 'Digite uma quantidade válida.' });
                return;
            }
            const btn = el('stqReporConfirmarBtn');
            window._setBtnLoading ? window._setBtnLoading(btn, true) : (btn.disabled = true);
            moverEstoque(produto, qtd, 'entrada')
                .then(() => {
                    fecharModal();
                    if (typeof window._showSuccessOverlay === 'function') {
                        window._showSuccessOverlay(`+${qtd} un. — ${produto.nome}`);
                    }
                })
                .catch(e => {
                    window.showCustomModal({ message: `Erro ao repor estoque: ${e.message}` });
                    window._setBtnLoading ? window._setBtnLoading(btn, false) : (btn.disabled = false);
                });
        });
    }


    // ── Fornecedores (cadastro reutilizável simples) ──────────────
    function carregarFornecedores() {
        return window._dbGet(window._lojaRef('fornecedores')).then(snap => {
            const data = snap.val();
            fornecedoresCache = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })) : [];
            return fornecedoresCache;
        }).catch(() => { fornecedoresCache = []; return fornecedoresCache; });
    }

    function criarFornecedor(nome) {
        return window._dbPush(window._lojaRef('fornecedores'), { nome, criadoEm: Date.now() })
            .then(res => ({ id: res.key, nome }));
    }

    // ── Abrir modal Adicionar (reposição com fornecedor) ──────────
    function abrirReposicao(produto) {
        const body = abrirModal('green', 'Adicionar Estoque');
        body.innerHTML = `
            <div class="mb-3">
                <label class="form-label">Produto</label>
                <input class="form-control" value="${esc(produto.nome)}" disabled/>
            </div>
            <div class="mb-3">
                <label class="form-label">Quantidade a adicionar</label>
                <input class="form-control" id="stqReporQtd" type="number" min="1" step="1" value="1"/>
            </div>
            <div class="mb-3">
                <label class="form-label">Fornecedor <span class="text-secondary small">(opcional)</span></label>
                <select class="form-select" id="stqReporFornecedor"><option value="">Carregando...</option></select>
                <div id="stqReporFornecedorNovoWrap" style="display:none;">
                    <input class="form-control mt-2" id="stqReporFornecedorNovo" placeholder="Nome do novo fornecedor"/>
                </div>
            </div>
            ${(typeof window._temPermissao === 'function' ? window._temPermissao('estoque_editar_produto') : true) ? `
            <div class="mb-3">
                <label class="form-label">Valor de compra (unitário) <span class="text-secondary small">(opcional)</span></label>
                <input class="form-control" id="stqReporValor" type="text" inputmode="numeric" autocomplete="off" placeholder="R$ 0,00"/>
                <div class="small mt-1" id="stqReporValorAviso" style="color:#fbbf24;">Sem o valor, essa compra não entra no Financeiro nem no custo médio.</div>
            </div>` : ''}
            <div class="stq-modal-actions">
                <button class="stq-modal-btn-cancel" id="stqReporCancelarBtn">Cancelar</button>
                <button class="stq-modal-btn-save" id="stqReporConfirmarBtn">Confirmar Entrada</button>
            </div>
        `;

        el('stqReporCancelarBtn').addEventListener('click', fecharModal);
        aplicarMascaraMoeda(el('stqReporValor'));
        el('stqReporValor')?.addEventListener('input', () => {
            el('stqReporValorAviso').style.display = lerMoeda(el('stqReporValor')) > 0 ? 'none' : '';
        });

        const select = el('stqReporFornecedor');
        const preencherSelect = () => {
            select.innerHTML = `
                <option value="">Sem fornecedor</option>
                ${fornecedoresCache.map(f => `<option value="${esc(f.nome)}">${esc(f.nome)}</option>`).join('')}
                <option value="__novo__">+ Novo fornecedor</option>
            `;
        };
        if (fornecedoresCache.length) preencherSelect();
        else carregarFornecedores().then(preencherSelect);

        select.addEventListener('change', () => {
            el('stqReporFornecedorNovoWrap').style.display = select.value === '__novo__' ? '' : 'none';
        });

        el('stqReporConfirmarBtn').addEventListener('click', () => {
            const qtd = parseInt(el('stqReporQtd').value, 10) || 0;
            if (qtd <= 0) { window.showCustomModal({ message: 'Informe uma quantidade válida.' }); return; }
            const valorUnitario = lerMoedaOuNull(el('stqReporValor'));

            const aplicarEntrada = (fornecedorNome) => {
                moverEstoque(produto, qtd, 'entrada', { fornecedor: fornecedorNome || null, valorUnitario })
                    .then(resultado => {
                        fecharModal();
                        fecharPainelExpandido();
                        const prod = resultado.produtoAtualizado;
                        const variacao = prod ? calcVariacaoCusto(prod) : 0;
                        // Custo pago nessa reposição mudou o suficiente pra
                        // valer perguntar na hora (não precisa ir caçar o
                        // banner na lista depois).
                        if (prod && Math.abs(variacao) >= LIMIAR_ALERTA_CUSTO) {
                            const subiu = variacao > 0;
                            window.showCustomModal({
                                message: `Você pagou ${fmt(prod.ultimoValorEntrada)} nessa reposição — ${Math.abs(variacao).toFixed(0)}% ${subiu ? 'mais caro' : 'mais barato'} que sua média anterior (${fmt(prod.precoCompraAnterior)}). Quer revisar o preço de venda agora?`,
                                confirmText: 'Revisar agora',
                                cancelText: 'Depois',
                                onConfirm: () => openFormForEdit({ id: produto.id, ...prod }, true),
                                onCancel: () => {}
                            });
                        } else {
                            window.showCustomModal({ message: `Entrada registrada: +${qtd} un.` });
                        }
                    })
                    .catch(e => window.showCustomModal({ message: `Erro: ${e.message}` }));
            };

            const seguir = () => {
                if (select.value === '__novo__') {
                    const novoNome = (el('stqReporFornecedorNovo').value || '').trim();
                    if (!novoNome) { window.showCustomModal({ message: 'Digite o nome do novo fornecedor.' }); return; }
                    criarFornecedor(novoNome)
                        .then(f => { fornecedoresCache.push(f); aplicarEntrada(f.nome); })
                        .catch(e => window.showCustomModal({ message: `Erro ao criar fornecedor: ${e.message}` }));
                } else {
                    aplicarEntrada(select.value);
                }
            };
            // Sem valor de compra a entrada NÃO vira despesa no Financeiro nem mexe no
            // custo médio. Não obriga (tem quem não controle isso), mas pergunta antes.
            if (el('stqReporValor') && !(valorUnitario > 0)) {
                window.showCustomModal({
                    message: 'Repor sem o valor de compra? Essa entrada não será lançada no Financeiro nem atualiza o custo médio do produto.',
                    confirmText: 'Repor mesmo assim',
                    cancelText: 'Voltar',
                    onConfirm: seguir,
                    onCancel: () => {}
                });
                return;
            }
            seguir();
        });
    }

    // ── Expand/collapse do produto na lista ───────────────────────
    function fecharPainelExpandido() {
        if (!expandedId) return;
        const wrap = document.querySelector(`.stq-card-wrap[data-id="${expandedId}"]`);
        if (wrap) {
            wrap.classList.remove('expanded');
            const panel = wrap.querySelector('.stq-row-panel');
            if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        }
        expandedId = null;
    }

    function toggleExpand(produto, wrapEl) {
        if (expandedId === produto.id) { fecharPainelExpandido(); return; }
        fecharPainelExpandido();
        expandedId = produto.id;
        wrapEl.classList.add('expanded');
        const panel = wrapEl.querySelector('.stq-row-panel');
        panel.style.display = 'block';
        renderPainelAcoes(panel, produto);
    }

    function renderPainelAcoes(panel, produto) {
        const tp = chave => typeof window._temPermissao === 'function' ? window._temPermissao(chave) : true;
        const podeEditar = tp('estoque_editar_produto');
        const podeReporEstoque = tp('estoque_editar_produto'); // "Add" (repor) é uma forma de editar o produto
        const podeLog = tp('estoque_ver_log');
        const podeArquivar = tp('estoque_arquivar_produto');
        const podeApagar = tp('estoque_apagar_produto');
        // Etiqueta só existe na versão Desktop (.exe) e pode gravar um
        // código no produto — mesma permissão de Editar.
        const podeEtiqueta = podeEditar && typeof window._etiquetaTermicaDisponivel === 'function' && window._etiquetaTermicaDisponivel();

        if (!podeEditar && !podeReporEstoque && !podeLog && !podeArquivar && !podeApagar) {
            panel.innerHTML = `<div class="stq-hist-sub" style="padding:8px 0;"><i class="bi bi-lock-fill"></i> Sem permissão pra ações neste produto.</div>`;
            return;
        }
        panel.innerHTML = `
            <div class="stq-panel-actions">
                ${podeEditar ? `<button class="stq-panel-btn editar" data-a="editar"><i class="bi bi-pencil-fill"></i>Editar</button>` : ''}
                ${podeReporEstoque ? `<button class="stq-panel-btn add" data-a="reposicao"><i class="bi bi-box-arrow-in-down"></i>Repor</button>` : ''}
                ${podeEtiqueta ? `<button class="stq-panel-btn etiqueta" data-a="etiqueta"><i class="bi bi-tag-fill"></i>Etiqueta</button>` : ''}
                ${podeLog ? `<button class="stq-panel-btn hist" data-a="historico"><i class="bi bi-clock-history"></i>Log</button>` : ''}
                ${podeArquivar ? `<button class="stq-panel-btn obs" data-a="arquivar"><i class="bi bi-archive-fill"></i>Arquivar</button>` : ''}
                ${podeApagar ? `<button class="stq-panel-btn apagar" data-a="apagar"><i class="bi bi-trash-fill"></i>Apagar</button>` : ''}
            </div>
        `;
        panel.querySelector('[data-a="editar"]')?.addEventListener('click', () => openFormForEdit(produto));
        panel.querySelector('[data-a="reposicao"]')?.addEventListener('click', () => abrirReposicao(produto));
        panel.querySelector('[data-a="etiqueta"]')?.addEventListener('click', () => abrirImpressaoEtiqueta(produto));
        panel.querySelector('[data-a="historico"]')?.addEventListener('click', () => renderPainelHistorico(panel, produto));
        panel.querySelector('[data-a="arquivar"]')?.addEventListener('click', () => arquivarProduto(produto));
        panel.querySelector('[data-a="apagar"]')?.addEventListener('click', () => excluirProduto(produto));
    }

    // ── Arquivar: some da lista/estoque, mas continua existindo pro
    //    Histórico de Vendas e Relatórios (diferente de Apagar) ──────
    function arquivarProduto(produto) {
        if (typeof window.showCustomModal === 'function') {
            window.showCustomModal({
                message: `Arquivar "${produto.nome}"? Ele some da lista de Estoque e da Venda, mas continua no histórico de vendas já feitas. Dá pra restaurar em Configurações → Produtos.`,
                confirmText: 'Arquivar',
                onConfirm: () => salvarArquivamento(produto)
            });
        } else if (confirm(`Arquivar "${produto.nome}"?`)) {
            salvarArquivamento(produto);
        }
    }

    function salvarArquivamento(produto) {
        window._dbUpdate(window._lojaRef(`products/${produto.id}`), { arquivado: true })
            .then(() => renderLista())
            .catch(e => {
                if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao arquivar: ${e.message}` });
            });
    }

    // ── Painel inline: Histórico ────────────────────────────────────
    const TIPO_LABEL = { entrada: 'Reposição', saida: 'Saída', ajuste: 'Ajuste manual', estorno: 'Estorno (venda cancelada)', estorno_reposicao: 'Estorno de reposição' };
    const TIPO_ICON  = { entrada: 'bi-box-arrow-in-down', saida: 'bi-box-arrow-up', ajuste: 'bi-sliders', estorno: 'bi-arrow-counterclockwise', estorno_reposicao: 'bi-arrow-counterclockwise' };

    // Estornar uma reposição direto do Log do produto (mesma regra da tela Movimentação:
    // exclusivo do Gestor — desfaz estoque, custo médio e a despesa no Financeiro). Lê a
    // entrada de novo antes de perguntar, pra nunca agir sobre dado velho de tela.
    function estornarReposicaoDoLog(panel, produto, entId) {
        // Quando o estoque muda a lista inteira se redesenha e o painel antigo some do DOM —
        // então reabre o Log no painel VIVO desse produto (senão a tela voltaria às ações
        // e a pessoa não veria a reposição marcada como "Estornada").
        const reabrirLog = () => renderPainelHistorico(
            document.querySelector(`.stq-card-wrap[data-id="${produto.id}"] .stq-row-panel`) || panel, produto);
        const entradaRef = window._lojaRef(`products/${produto.id}/historico/${entId}`);
        window._dbGet(entradaRef).then(snap => {
            const ent = snap.val();
            if (!ent || ent.tipo !== 'entrada' || ent.estornadoEm) {
                window.showCustomModal({ message: 'Essa reposição já foi estornada.' });
                reabrirLog();
                return;
            }
            const qtd = Math.abs(ent.delta || 0);
            const temValor = ent.valorUnitario != null;
            window.showCustomModal({
                message: `Estornar essa reposição de ${qtd} unidade(s)? Isso devolve o estoque${temValor ? `, volta o custo médio ao valor de antes dessa entrada e remove a despesa de ${fmt(ent.valorUnitario * qtd)} do Financeiro` : ' (a reposição foi lançada sem valor, então nada muda no Financeiro)'}. Não dá pra desfazer.`,
                confirmText: 'Estornar', cancelText: 'Cancelar',
                onConfirm: () => {
                    estornarUltimaEntrada(produto, entId, ent)
                        .then(() => { window.showCustomModal({ message: 'Reposição estornada.' }); reabrirLog(); })
                        .catch(e => window.showCustomModal({
                            message: ['MOVIMENTO_POSTERIOR', 'SEM_SNAPSHOT', 'JA_ESTORNADA'].includes(e.code) ? e.message : `Erro ao estornar: ${e.message}`
                        }));
                },
                onCancel: () => {}
            });
        }).catch(e => window.showCustomModal({ message: `Erro ao buscar reposição: ${e.message}` }));
    }

    function renderPainelHistorico(panel, produto) {
        panel.innerHTML = `
            <div class="stq-panel-back"><button data-a="voltar"><i class="bi bi-arrow-left"></i> Voltar</button></div>
            <div class="stq-hist-loading">Carregando histórico...</div>
        `;
        panel.querySelector('[data-a="voltar"]').addEventListener('click', () => renderPainelAcoes(panel, produto));

        // Só busca as 20 movimentações mais recentes — direto na consulta
        // ao Firebase, não é só esconder na tela. Sem isso, um produto
        // com muito tempo de loja ia baixar o histórico inteiro (podendo
        // chegar a centenas de entradas) toda vez que alguém abrisse o
        // log, mesmo só mostrando uma fração dele.
        const historicoQuery = window._dbQuery(
            window._lojaRef(`products/${produto.id}/historico`),
            window._dbOrderByChild('timestamp'),
            window._dbLimitToLast(20)
        );
        window._dbGet(historicoQuery).then(snap => {
            const data = snap.val();
            const itens = data ? Object.entries(data).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)) : [];
            const ehGestor = window._papelUsuario === 'gestor';
            const loadingEl = panel.querySelector('.stq-hist-loading');
            if (!loadingEl) return;

            if (!itens.length) {
                loadingEl.outerHTML = `<div class="stq-hist-empty"><i class="bi bi-clock-history"></i><br/>Nenhuma movimentação registrada ainda.</div>`;
                return;
            }
            loadingEl.outerHTML = itens.map(it => {
                const dataStr = new Date(it.timestamp || 0).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
                const deltaClass = it.delta > 0 ? 'pos' : (it.delta < 0 ? 'neg' : '');
                const deltaTxt = it.delta > 0 ? `+${it.delta}` : `${it.delta}`;
                const subPartes = [dataStr];
                if (it.fornecedor) subPartes.push(it.fornecedor);
                if (it.cliente) subPartes.push(it.cliente);
                const podeVerCustoLog = typeof window._temPermissao === 'function' ? window._temPermissao('estoque_editar_produto') : true;
                if (it.valorUnitario != null && podeVerCustoLog) subPartes.push(fmt(it.valorUnitario) + '/un.');
                // Reposição: Gestor vê "Estornar" (ou o selo "Estornada").
                const acaoEstorno = (it.tipo === 'entrada' && ehGestor)
                    ? (it.estornadoEm
                        ? `<div class="stq-hist-sub" style="color:var(--danger);"><i class="bi bi-arrow-counterclockwise"></i> Estornada</div>`
                        : `<button type="button" class="mov-estornar-btn" style="margin:6px 0 0 0;" data-estornar-reposicao="${esc(it.id)}"><i class="bi bi-arrow-counterclockwise"></i> Estornar</button>`)
                    : '';
                return `
                    <div class="stq-hist-item">
                        <div class="stq-hist-icon ${it.tipo || 'ajuste'}"><i class="bi ${TIPO_ICON[it.tipo] || 'bi-sliders'}"></i></div>
                        <div class="stq-hist-info">
                            <div class="stq-hist-title">${TIPO_LABEL[it.tipo] || 'Movimentação'} <b class="${deltaClass}">${esc(deltaTxt)}</b> <span class="text-secondary small">→ ${it.quantidadeApos ?? '?'} un.</span></div>
                            <div class="stq-hist-sub">${esc(subPartes.join(' · '))}</div>
                            ${acaoEstorno}
                        </div>
                    </div>`;
            }).join('');
            panel.querySelectorAll('[data-estornar-reposicao]').forEach(btn => {
                btn.addEventListener('click', () => estornarReposicaoDoLog(panel, produto, btn.dataset.estornarReposicao));
            });
        }).catch(e => {
            const loadingEl = panel.querySelector('.stq-hist-loading');
            if (loadingEl) loadingEl.outerHTML = `<div class="stq-hist-empty">Erro ao carregar: ${esc(e.message)}</div>`;
        });
    }

    // ── Lista (visual Neon) ────────────────────────────────────────
    function getProdutos() {
        // Arquivados somem da lista/estoque, mas continuam no Firebase —
        // seguem aparecendo no Histórico de Vendas e nos Relatórios de
        // vendas já feitas (essas telas não passam por getProdutos()).
        return (window.products || []).filter(p => !p.arquivado);
    }

    function renderCard(p) {
        const cat = infoCategoria(detectarCategoria(p.nome));
        const zerado = (p.quantidade || 0) <= 0;
        const ringCor = zerado ? '#ef4444' : cat.cor;
        const cores = Array.isArray(p.cores) ? p.cores : [];
        return `
            <div class="stq-card-wrap ${p.ignorarContagem ? 'oculto' : ''}" data-id="${p.id}">
                <div class="stq-card-main" data-action="toggle">
                    <div class="stq-ring" style="border-color:${ringCor};background:${ringCor}22;">${p.quantidade ?? 0}</div>
                    <div class="stq-card-info">
                        <div class="stq-card-nome">${esc(p.nome)}</div>
                        <div class="stq-card-meta">
                            <span>${fmt(p.valor || 0)}</span>
                            ${p.condicao && window._condicoesProduto?.[p.condicao] ? `<span>${esc(window._condicoesProduto[p.condicao])}</span>` : ''}
                            ${cores.map(c => `<span><span class="stq-card-cor-dot" style="background:${esc(c.hex || '#666')};"></span> ${esc(c.nome)}</span>`).join('')}
                        </div>
                    </div>
                    <i class="bi bi-chevron-right stq-card-chev"></i>
                </div>
                ${alertaCustoHtml(p)}
                <div class="stq-row-panel" style="display:none;"></div>
            </div>`;
    }

    function renderLista() {
        const listEl = el('stqList');
        if (!listEl) return;

        // Palavras em qualquer ordem e sem acento: "g22 moto" acha "Capa Moto G22".
        const termos = normalizarTexto(el('stqBusca')?.value).split(/\s+/).filter(Boolean);
        let produtos = getProdutos();
        if (termos.length) produtos = produtos.filter(p => { const nome = normalizarTexto(p.nome); return termos.every(t => nome.includes(t)); });
        if (filtroCategoria) produtos = produtos.filter(p => detectarCategoria(p.nome) === filtroCategoria);

        const assinatura = termos.join(' ') + '|' + (filtroCategoria || '');
        if (assinatura !== assinaturaFiltro) { assinaturaFiltro = assinatura; limiteExibicao = ESTOQUE_PAGINA; }

        if (!produtos.length) {
            listEl.innerHTML = `
                <div class="stq-empty">
                    <i class="bi bi-box2-heart"></i>
                    <h4>Nenhum produto encontrado</h4>
                    <p class="text-secondary small">Tente outro termo de busca ou filtro.</p>
                </div>`;
            expandedId = null;
            return;
        }

        // Produto com painel aberto nunca some atrás do "Ver mais".
        const idxAberto = expandedId ? produtos.findIndex(p => p.id === expandedId) : -1;
        if (idxAberto >= limiteExibicao) limiteExibicao = idxAberto + 1;

        const visiveis = produtos.slice(0, limiteExibicao);
        const restantes = produtos.length - visiveis.length;
        const porId = new Map(visiveis.map(p => [p.id, p]));
        listEl.innerHTML = visiveis.map(renderCard).join('') + (restantes > 0
            ? `<button type="button" class="stq-ver-mais-btn" id="stqVerMais"><i class="bi bi-chevron-down"></i> Ver mais ${Math.min(ESTOQUE_PAGINA, restantes)} (${restantes} restantes)</button>`
            : '');
        el('stqVerMais')?.addEventListener('click', () => { limiteExibicao += ESTOQUE_PAGINA; renderLista(); });

        listEl.querySelectorAll('.stq-card-wrap').forEach(wrapEl => {
            const produto = porId.get(wrapEl.dataset.id);
            if (!produto) return;

            wrapEl.querySelector('.stq-card-main').addEventListener('click', () => toggleExpand(produto, wrapEl));
            wrapEl.querySelector('[data-action="ajustar-alerta"]')?.addEventListener('click', e => {
                e.stopPropagation();
                openFormForEdit(produto, true);
            });
            wrapEl.querySelector('[data-action="ignorar-alerta"]')?.addEventListener('click', e => {
                e.stopPropagation();
                ignorarAlertaCusto(produto);
            });

            if (expandedId === produto.id) {
                wrapEl.classList.add('expanded');
                const panel = wrapEl.querySelector('.stq-row-panel');
                panel.style.display = 'block';
                renderPainelAcoes(panel, produto);
            }
        });
    }

    // ── Entrada pública ──────────────────────────────────────────
    function renderEstoqueProdutos() {
        ensureSkeleton();
        fecharModal();
        limiteExibicao = ESTOQUE_PAGINA;
        renderCategoriaChips();   // refaz também o botão "Categorias" (só Gestor)
        renderLista();
    }
    window._renderEstoqueProdutos = renderEstoqueProdutos;

    // Atalho pra abrir um produto específico já em edição — usado pelo
    // botão de ação da notificação de "estoque baixo" (openEstoqueSection
    // chama isso depois de já ter renderizado a lista).
    window._abrirEdicaoProdutoPorId = function (produtoId) {
        const produto = (window.products || []).find(p => p.id === produtoId);
        if (!produto) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Esse produto não foi encontrado (pode ter sido removido ou arquivado).' });
            return;
        }
        openFormForEdit(produto);
    };

    // Re-renderiza quando /products mudar no Firebase (hook do core.js)
    window._onProductsUpdated = function () {
        if (mounted) renderLista();
    };

})();
