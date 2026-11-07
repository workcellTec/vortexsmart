// ================================================================
// configuracoes/config-produtos.js — VortexSmart · Config → Produtos & Notificações
// Registra: window._initConfigProdutos()
//
// Onde cada coisa é gravada no Firebase:
//   - condicoesProduto/{slug} = "Nome de exibição"
//     Node NOVO, só do VortexSmart — precisa de regra própria.
//   - products/{id}/arquivado = true/false
//     Campo novo dentro do node 'products' que já existe — não precisa
//     de regra nova, só usa a que já existe pra 'products'.
// ================================================================
(function () {
    'use strict';
    const el      = id => document.getElementById(id);
    const modal   = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc     = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const dbRoot  = () => window._lojaRef();
    const pathRef = p => window._lojaRef(p);

    let mounted = false;
    let tela = 'lista'; // 'lista' | 'arquivados'

    // ── Esqueleto (uma vez só) ───────────────────────────────────
    function ensureSkeleton() {
        const wrap = el('configuracoesProdutos');
        if (!wrap || mounted) return;
        wrap.innerHTML = `
            <div class="section-header">
                <h3 id="cpTitulo">Produtos & Notificações</h3>
                <button class="btn-icon-circle" id="cpBack" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
            </div>
            <div class="content-card w-100" id="cpBody"></div>
        `;
        el('cpBack')?.addEventListener('click', () => {
            if (tela !== 'lista') { tela = 'lista'; renderTudo(); }
            else history.back();
        });
        mounted = true;
    }

    function renderTudo() {
        ensureSkeleton();
        el('cpTitulo').textContent = tela === 'lista' ? 'Produtos & Notificações' : 'Produtos Arquivados';
        if (tela === 'lista') renderLista(); else renderArquivados();
    }

    function condicoes() {
        return window._condicoesProduto || {};
    }

    function produtosAtivos() {
        return (window.products || []).filter(p => !p.arquivado);
    }
    function produtosArquivados() {
        return (window.products || []).filter(p => p.arquivado);
    }

    function custoAtualProduto(p) {
        const entradas = Object.values(p.historico || {})
            .filter(h => h.tipo === 'entrada' && h.valorUnitario != null)
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return entradas.length ? entradas[0].valorUnitario : '';
    }

    // ══════════════════════ TELA: LISTA ══════════════════════
    function renderLista() {
        const cond = condicoes();
        const arquivadosCount = produtosArquivados().length;

        el('cpBody').innerHTML = `
            <div class="cfg-section-title">Catálogo</div>
            <div class="cfgA-card mb-3">
                <button type="button" class="cfgA-row" id="cpExportarBtn">
                    <div class="cfgA-icon" style="background:linear-gradient(135deg,#4ade80,#16a34a);">📤</div>
                    <div style="flex:1;"><div class="cfgA-name">Exportar Catálogo</div><div class="cfgA-row-sub">Baixa todos os produtos em CSV</div></div>
                    <span class="cfgA-chev">›</span>
                </button>
                <button type="button" class="cfgA-row" id="cpImportarBtn">
                    <div class="cfgA-icon" style="background:linear-gradient(135deg,#4f8cff,#2563eb);">📥</div>
                    <div style="flex:1;"><div class="cfgA-name">Importar Catálogo</div><div class="cfgA-row-sub">Cadastra produtos a partir de um CSV</div></div>
                    <span class="cfgA-chev">›</span>
                </button>
                <input type="file" accept=".csv,text/csv" id="cpImportarInput" class="hidden">
            </div>

            <div class="cfg-section-title">Condições do Produto</div>
            <div class="cfgA-card mb-3">
                <div class="cp-cond-chip-row" id="cpCondChips">
                    ${Object.keys(cond).length ? Object.entries(cond).map(([slug, nome]) => `
                        <div class="cp-cond-chip">${esc(nome)}<span class="cp-cond-x" data-slug="${slug}">✕</span></div>
                    `).join('') : `<div class="stq-hist-sub" style="padding:4px 0;">Nenhuma condição cadastrada ainda.</div>`}
                </div>
                <div class="cp-cond-add-row">
                    <input class="ctx-field-input" id="cpCondNovaInput" placeholder="Nova condição (ex: Vitrine)">
                    <button type="button" class="cp-cond-add-btn" id="cpCondAddBtn">+</button>
                </div>
            </div>

            <div class="cfg-section-title">Organização do Catálogo</div>
            <div class="cfgA-card">
                <div class="cp-archive-info">
                    Produtos arquivados somem da lista de venda e do estoque, mas continuam aparecendo no <b>Histórico de Vendas</b> e nos <b>Relatórios</b> de vendas já feitas — evita a lista crescer pra sempre sem perder o histórico.
                </div>
                <button type="button" class="cfgA-row" id="cpVerArquivadosBtn" style="border-top:1px solid var(--border);">
                    <div class="cfgA-name" style="color:#5b3df5;">📦 ${arquivadosCount} produto${arquivadosCount === 1 ? '' : 's'} arquivado${arquivadosCount === 1 ? '' : 's'}</div>
                    <span class="cfgA-chev">›</span>
                </button>
            </div>
        `;

        el('cpExportarBtn')?.addEventListener('click', exportarCSV);
        el('cpImportarBtn')?.addEventListener('click', () => el('cpImportarInput')?.click());
        el('cpImportarInput')?.addEventListener('change', importarCSV);

        el('cpCondChips')?.querySelectorAll('[data-slug]').forEach(btn => {
            btn.addEventListener('click', () => removerCondicao(btn.dataset.slug));
        });
        el('cpCondAddBtn')?.addEventListener('click', adicionarCondicao);
        el('cpCondNovaInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') adicionarCondicao(); });

        el('cpVerArquivadosBtn')?.addEventListener('click', () => { tela = 'arquivados'; renderTudo(); });
    }

    // ── Condições: cadastrar / remover ──────────────────────────
    function adicionarCondicao() {
        const nome = el('cpCondNovaInput')?.value.trim();
        if (!nome) return;
        const slug = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '');
        if (!slug) { modal({ message: 'Nome inválido — usa letras ou números.' }); return; }
        if (condicoes()[slug]) { modal({ message: 'Essa condição já existe.' }); return; }
        window._dbUpdate(pathRef('condicoesProduto'), { [slug]: nome })
            .then(() => { el('cpCondNovaInput').value = ''; })
            .catch(e => modal({ message: `Erro ao salvar: ${e.message}` }));
    }

    function removerCondicao(slug) {
        const emUso = produtosAtivos().some(p => p.condicaoSlug === slug);
        const seguir = () => {
            window._dbUpdate(pathRef('condicoesProduto'), { [slug]: null })
                .catch(e => modal({ message: `Erro ao remover: ${e.message}` }));
        };
        if (emUso) {
            modal({ message: 'Existem produtos usando essa condição — eles não vão perder o valor já salvo, só some da lista de opções pra novos cadastros. Removendo mesmo assim.' });
        }
        seguir();
    }

    // ── Exportar CSV ─────────────────────────────────────────────
    function exportarCSV() {
        const linhas = [['nome', 'valor', 'quantidade', 'condicao', 'custoAtual', 'cores'].join(',')];
        produtosAtivos().forEach(p => {
            const cores = Array.isArray(p.cores) ? p.cores.join(';') : '';
            const linha = [p.nome, p.valor, p.quantidade, p.condicaoSlug || '', custoAtualProduto(p), cores]
                .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
            linhas.push(linha);
        });
        const blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `catalogo-vortexsmart-${new Date().toLocaleDateString("sv-SE")}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    // ── Importar CSV ─────────────────────────────────────────────
    function parseCSVLine(linha) {
        const campos = [];
        let atual = '', dentroAspas = false;
        for (let i = 0; i < linha.length; i++) {
            const c = linha[i];
            if (c === '"') { dentroAspas = !dentroAspas; }
            else if (c === ',' && !dentroAspas) { campos.push(atual); atual = ''; }
            else atual += c;
        }
        campos.push(atual);
        return campos.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
    }

    function importarCSV(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const linhas = reader.result.split(/\r?\n/).filter(l => l.trim());
            if (linhas.length < 2) { modal({ message: 'CSV vazio ou sem produtos.' }); return; }
            const header = parseCSVLine(linhas[0]).map(h => h.trim().toLowerCase());
            const idxNome = header.indexOf('nome');
            const idxValor = header.indexOf('valor');
            const idxQtd = header.indexOf('quantidade');
            const idxCond = header.indexOf('condicao');
            if (idxNome === -1) { modal({ message: 'O CSV precisa ter pelo menos a coluna "nome".' }); return; }

            const nomesExistentes = new Set((window.products || []).map(p => (p.nome || '').toLowerCase()));
            const updates = {};
            let novos = 0, ignorados = 0;
            linhas.slice(1).forEach(linha => {
                const campos = parseCSVLine(linha);
                const nome = (campos[idxNome] || '').trim();
                if (!nome) return;
                if (nomesExistentes.has(nome.toLowerCase())) { ignorados++; return; }
                const id = window._dbPush(pathRef('products')).key;
                updates[`products/${id}`] = {
                    nome,
                    valor: parseFloat((campos[idxValor] || '0').replace(',', '.')) || 0,
                    quantidade: parseInt(campos[idxQtd], 10) || 0,
                    condicaoSlug: idxCond !== -1 ? (campos[idxCond] || '') : '',
                    criadoEm: Date.now()
                };
                nomesExistentes.add(nome.toLowerCase());
                novos++;
            });

            if (!novos) { modal({ message: `Nada pra importar (${ignorados} produto(s) já existiam pelo nome).` }); e.target.value = ''; return; }

            window._dbUpdate(dbRoot(), updates)
                .then(() => modal({ message: `✅ ${novos} produto(s) importado(s)!${ignorados ? ` ${ignorados} ignorado(s) por já existir.` : ''}` }))
                .catch(err => modal({ message: `Erro ao importar: ${err.message}` }));
            e.target.value = '';
        };
        reader.readAsText(file, 'utf-8');
    }

    // ══════════════════════ TELA: ARQUIVADOS ══════════════════════
    function renderArquivados() {
        const lista = produtosArquivados();
        el('cpBody').innerHTML = `
            <div id="cpArquivadosList"></div>
            ${!lista.length ? `<div class="stq-hist-empty"><i class="bi bi-archive"></i><br/>Nenhum produto arquivado.</div>` : ''}
        `;
        el('cpArquivadosList').innerHTML = lista.map(p => `
            <div class="cfgA-card mb-2">
                <div class="cfgA-row" style="cursor:default;">
                    <div class="cfgA-icon" style="background:linear-gradient(135deg,#94a3b8,#475569);">📦</div>
                    <div style="flex:1;min-width:0;">
                        <div class="cfgA-name">${esc(p.nome)}</div>
                        <div class="cfgA-row-sub">${p.quantidade || 0} un. em estoque</div>
                    </div>
                    <button type="button" class="cp-restaurar-btn" data-id="${p.id}">Restaurar</button>
                </div>
            </div>
        `).join('');
        el('cpArquivadosList').querySelectorAll('[data-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                window._dbUpdate(pathRef(`products/${btn.dataset.id}`), { arquivado: false })
                    .then(() => renderArquivados())
                    .catch(e => modal({ message: `Erro ao restaurar: ${e.message}` }));
            });
        });
    }

    // ── Ponto de entrada chamado pelo router ──────────────────────
    window._initConfigProdutos = function () {
        tela = 'lista';
        renderTudo();
    };
})();
