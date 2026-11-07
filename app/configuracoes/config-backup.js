// ================================================================
// configuracoes/config-backup.js — VortexSmart · Config → Sistema → Backup
// Registra: window._initConfigBackup()
//
// Cada bloco busca o node correspondente no Firebase (só quando o
// usuário clica em "Baixar" — nada é pré-carregado) e gera um arquivo
// .json pra download. Formato JSON (não CSV) porque Bookip/Venda têm
// dados aninhados (itens dentro da venda, histórico dentro do produto)
// que um CSV achataria e complicaria restaurar depois.
// ================================================================
(function () {
    'use strict';
    const el     = id => document.getElementById(id);
    const modal  = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const pathRef = p => window._lojaRef(p);

    let mounted = false;

    const BLOCOS = [
        { id: 'clientes',  nome: 'Clientes',           emoji: '👥', grad: 'linear-gradient(135deg,#f472b6,#be185d)', nodes: ['clientes'] },
        { id: 'bookips',   nome: 'Garantias (Bookip)',  emoji: '📓', grad: 'linear-gradient(135deg,#5eead4,#0f766e)', nodes: ['bookips'] },
        { id: 'vendas',    nome: 'Vendas',              emoji: '🛒', grad: 'linear-gradient(135deg,#4ade80,#16a34a)', nodes: ['vendas'] },
        { id: 'produtos',  nome: 'Produtos',            emoji: '📦', grad: 'linear-gradient(135deg,#fb923c,#c2410c)', nodes: ['products', 'condicoesProduto', 'categoriasProduto'] },
        { id: 'taxas',     nome: 'Taxas & Máquinas',    emoji: '🏷️', grad: 'linear-gradient(135deg,#a78bfa,#5b3df5)', nodes: ['rates', 'maquininhasConfig', 'formasPagamentoConfig'] },
    ];

    function ensureSkeleton() {
        const wrap = el('configuracoesBackup');
        if (!wrap || mounted) return;
        wrap.innerHTML = `
            <div class="section-header">
                <h3>Backup &amp; Dados</h3>
                <button class="btn-back" id="cbBack" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
            </div>
            <div class="content-card w-100">
                <div class="cb-hero">
                    <div class="cb-hero-top">
                        <div class="cb-hero-ic">🗄️</div>
                        <div class="cb-hero-txt"><b>Backup Completo</b><span>Tudo em um arquivo só (.json)</span></div>
                    </div>
                    <button type="button" class="cb-hero-btn" id="cbBaixarTudoBtn">⬇️ Baixar Tudo</button>
                </div>

                <div class="cfg-section-title">Ou por partes</div>
                <div id="cbBlocosList"></div>

                <div class="cb-notice">⚠️ Backup grande (Clientes/Garantias) pode levar alguns segundos — o app busca tudo do Firebase antes de gerar o arquivo, sem travar a tela.</div>

                <div class="cfg-section-title" style="margin-top:18px;">Restaurar</div>
                <div class="cb-notice" style="background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.25);color:var(--danger);">
                    ⚠️ Restaurar SUBSTITUI os dados atuais pelos do arquivo — apaga o que existe hoje nesse bloco. Não tem volta. Use só se tiver certeza.
                </div>
                <button type="button" class="cb-hero-btn" id="cbRestaurarTudoBtn" style="background:linear-gradient(135deg,#ef4444,#dc2626);margin-top:10px;">⬆️ Restaurar de um Backup Completo</button>
                <div id="cbRestaurarBlocosList" style="margin-top:10px;"></div>
                <input type="file" id="cbRestaurarInput" accept="application/json" style="display:none;">
            </div>
        `;
        el('cbBlocosList').innerHTML = BLOCOS.map(b => `
            <div class="cb-block-card">
                <div class="cb-block-ic" style="background:${b.grad};">${b.emoji}</div>
                <div class="cb-block-txt"><div class="cb-block-name">${b.nome}</div></div>
                <button type="button" class="cb-block-btn" data-bloco="${b.id}">Baixar</button>
            </div>
        `).join('');

        el('cbRestaurarBlocosList').innerHTML = BLOCOS.map(b => `
            <div class="cb-block-card">
                <div class="cb-block-ic" style="background:${b.grad};">${b.emoji}</div>
                <div class="cb-block-txt"><div class="cb-block-name">${b.nome}</div></div>
                <button type="button" class="cb-block-btn" style="background:rgba(239,68,68,.12);color:var(--danger);" data-restaurar-bloco="${b.id}">Restaurar</button>
            </div>
        `).join('');

        el('cbBaixarTudoBtn')?.addEventListener('click', () => baixarTudo());
        el('cbBlocosList').querySelectorAll('[data-bloco]').forEach(btn => {
            btn.addEventListener('click', () => baixarBloco(btn.dataset.bloco, btn));
        });
        el('cbRestaurarTudoBtn')?.addEventListener('click', () => iniciarRestauracao(null));
        el('cbRestaurarBlocosList').querySelectorAll('[data-restaurar-bloco]').forEach(btn => {
            btn.addEventListener('click', () => iniciarRestauracao(btn.dataset.restaurarBloco));
        });
        el('cbRestaurarInput')?.addEventListener('change', handleArquivoRestauracao);
        mounted = true;
    }

    function buscarNode(nome) {
        return window._dbGet(pathRef(nome)).then(snap => snap.val() || null);
    }

    function baixarJSON(objeto, nomeArquivo) {
        const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function baixarBloco(blocoId, btn) {
        const bloco = BLOCOS.find(b => b.id === blocoId);
        if (!bloco) return;
        const textoOriginal = btn.textContent;
        btn.textContent = 'Baixando...';
        btn.disabled = true;

        Promise.all(bloco.nodes.map(buscarNode))
            .then(resultados => {
                const dados = {};
                bloco.nodes.forEach((n, i) => { dados[n] = resultados[i]; });
                baixarJSON(
                    { exportadoEm: new Date().toISOString(), bloco: bloco.id, dados },
                    `vortexsmart-${bloco.id}-${new Date().toLocaleDateString("sv-SE")}.json`
                );
                modal({ message: `✅ ${bloco.nome} exportado!` });
            })
            .catch(e => modal({ message: `Erro ao baixar ${bloco.nome}: ${e.message}` }))
            .finally(() => { btn.textContent = textoOriginal; btn.disabled = false; });
    }

    function baixarTudo() {
        const btn = el('cbBaixarTudoBtn');
        const textoOriginal = btn.textContent;
        btn.textContent = '⏳ Buscando tudo...';
        btn.disabled = true;

        const todosNodes = [...new Set(BLOCOS.flatMap(b => b.nodes))];
        Promise.all(todosNodes.map(buscarNode))
            .then(resultados => {
                const dados = {};
                todosNodes.forEach((n, i) => { dados[n] = resultados[i]; });
                baixarJSON(
                    { exportadoEm: new Date().toISOString(), backupCompleto: true, dados },
                    `vortexsmart-backup-completo-${new Date().toLocaleDateString("sv-SE")}.json`
                );
                modal({ message: '✅ Backup completo baixado!' });
            })
            .catch(e => modal({ message: `Erro ao gerar backup: ${e.message}` }))
            .finally(() => { btn.textContent = textoOriginal; btn.disabled = false; });
    }

    // ── Restaurar ────────────────────────────────────────────────
    // blocoIdAlvo = null → restaurar backup completo (todos os nodes do
    // arquivo). blocoIdAlvo = 'clientes' etc → restaurar só esse bloco,
    // mesmo que o arquivo selecionado seja um backup completo (nesse
    // caso usa só os nodes daquele bloco específico dentro do arquivo).
    let blocoIdAlvo = null;

    function iniciarRestauracao(blocoId) {
        blocoIdAlvo = blocoId;
        el('cbRestaurarInput').value = ''; // permite selecionar o mesmo arquivo de novo
        el('cbRestaurarInput').click();
    }

    function handleArquivoRestauracao(e) {
        const arquivo = e.target.files?.[0];
        if (!arquivo) return;
        const reader = new FileReader();
        reader.onload = () => {
            let json;
            try {
                json = JSON.parse(reader.result);
            } catch {
                modal({ message: 'Arquivo inválido — não é um JSON válido.' });
                return;
            }
            if (!json || typeof json.dados !== 'object' || !json.dados) {
                modal({ message: 'Arquivo não parece ser um backup do VortexSmart (formato inesperado).' });
                return;
            }
            confirmarRestauracao(json);
        };
        reader.onerror = () => modal({ message: 'Erro ao ler o arquivo.' });
        reader.readAsText(arquivo);
    }

    function confirmarRestauracao(json) {
        const bloco = blocoIdAlvo ? BLOCOS.find(b => b.id === blocoIdAlvo) : null;
        // Nodes que serão de fato escritos: se for restauração por bloco,
        // só os nodes daquele bloco (mesmo que o arquivo tenha mais);
        // se for backup completo, todos os nodes presentes no arquivo.
        const nodesAlvo = bloco ? bloco.nodes.filter(n => n in json.dados) : Object.keys(json.dados);
        if (!nodesAlvo.length) {
            modal({ message: bloco ? `Esse arquivo não tem dados de "${bloco.nome}".` : 'Esse arquivo não tem nenhum dado reconhecível.' });
            return;
        }
        const exportadoEm = json.exportadoEm ? new Date(json.exportadoEm).toLocaleString('pt-BR') : 'data desconhecida';
        const alvoTexto = bloco ? `"${bloco.nome}"` : `TODOS os dados (${nodesAlvo.join(', ')})`;
        modal({
            message: `⚠️ ATENÇÃO — isso vai APAGAR os dados atuais de ${alvoTexto} e substituir pelo conteúdo desse arquivo, exportado em ${exportadoEm}. Essa ação NÃO tem volta. Tem certeza que quer continuar?`,
            confirmText: 'Sim, restaurar e apagar o atual',
            cancelText: 'Cancelar',
            onConfirm: () => executarRestauracao(json, nodesAlvo),
            onCancel: () => {}
        });
    }

    function executarRestauracao(json, nodesAlvo) {
        modal({ message: '⏳ Restaurando... não feche o app.' });
        const updates = {};
        nodesAlvo.forEach(n => { updates[n] = json.dados[n] ?? null; });
        const dbRoot = window._lojaRef();
        window._dbUpdate(dbRoot, updates)
            .then(() => modal({ message: `✅ Restaurado! ${nodesAlvo.length} bloco(s) de dados substituído(s).` }))
            .catch(e => modal({ message: `Erro ao restaurar: ${e.message}` }));
    }

    window._initConfigBackup = function () {
        ensureSkeleton();
    };
})();
