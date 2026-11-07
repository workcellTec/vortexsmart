// ================================================================
// reposicao/lista.js — VortexSmart · Módulo Reposição (lista de compras)
// Expõe: window._renderReposicaoLista
// Depende de (via window.*):
//   _lojaRef, _dbOnValue, _dbPush, _dbUpdate, _dbRemove,
//   _comprimirImagem, _uploadFotoStorage,
//   _vsAbrirModal, _vsFecharModal, _vsTravarScroll, _vsDestravarScroll
//
// lojas/{lojaId}/reposicao/categorias/{id} = { nome, cor, criadoEm }
// lojas/{lojaId}/reposicao/itens/{id} = { nome, categoriaId, quantidade,
//   fotoUrl, comprado, criadoEm, compradoEm }
//
// Acesso: qualquer membro da loja (Gestor ou Funcionário) — sem
// restrição de papel, mesma regra de reparos. Decisão do Brendon: é
// ferramenta de trabalho do dia a dia, todo mundo que compra/confere
// mercadoria precisa mexer aqui.
// ================================================================
(function () {
    'use strict';

    const el  = id => document.getElementById(id);
    const esc = s  => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Cor de categoria nova sai sozinha dessa paleta, ciclando — evita
    // ter que fazer o usuário escolher cor toda vez que cria uma
    // categoria (Capinha, Película...), foco fica em nomear, não em
    // decorar.
    const PALETA_CORES = ['#8b5cf6', '#ec4899', '#22d3ee', '#fbbf24', '#4ade80', '#f87171', '#60a5fa', '#fb923c'];

    let mounted = false;
    let categorias = [];
    let itens = [];
    let filtroCategoria = null;
    let editingId = null;       // id do item em edição no modal, null = item novo
    let fotoPendente = null;    // { blob, previewUrl } — escolhida no modal, ainda não subiu
    let fotoUrlAtual = null;    // url já salva (edição) mantida se não trocar a foto
    let categoriaSelecionadaModal = null;
    let listenersAtivos = false;
    let catalogoCache = null;      // lista de produtos já cadastrados alguma vez (sobrevive ao "Finalizar reposição" — é isso que alimenta a sugestão)
    let fotoDoHistorico = null;    // { fotoUrl, fotoThumbUrl } — quando escolhe uma sugestão do catálogo, reaproveita a foto sem subir de novo

    function corCat(id) { return (categorias.find(c => c.id === id) || {}).cor || '#64748b'; }
    function nomeCat(id) { return (categorias.find(c => c.id === id) || {}).nome || 'Sem categoria'; }

    // ── Skeleton (montado 1x) ────────────────────────────────────
    function ensureSkeleton() {
        const container = el('reposicaoLista');
        if (!container || mounted) return;
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Reposição</h3>
                <button class="btn-header-action" id="repoNovoBtn" aria-label="Novo item"><i class="bi bi-plus-lg"></i></button>
            </div>
            <div class="stq-cats" id="repoCats"></div>
            <button type="button" class="repo-limpar-btn" id="repoLimparBtn" style="display:none;"></button>
            <div class="stq-list" id="repoList"></div>
            <div class="repo-vazio" id="repoVazio" style="display:none;"><i class="bi bi-cart3"></i>Nenhum item aqui ainda.</div>

            <div class="stq-modal-backdrop" id="repoModalBackdrop">
                <div class="stq-modal-card">
                    <div class="stq-modal-header" id="repoModalHeader">
                        <div class="stq-modal-header-title" id="repoModalTitle">Novo item</div>
                        <button class="stq-modal-close" id="repoModalClose" aria-label="Fechar"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="repoModalBody"></div>
                </div>
            </div>
        `;

        el('repoNovoBtn')?.addEventListener('click', () => abrirModalItem(null));
        el('repoModalClose')?.addEventListener('click', fecharModal);
        el('repoModalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'repoModalBackdrop') fecharModal(); });
        el('repoLimparBtn')?.addEventListener('click', limparComprados);

        mounted = true;
    }

    // ── Dados em tempo real ──────────────────────────────────────
    function ligarListeners() {
        if (listenersAtivos) return;
        listenersAtivos = true;
        window._dbOnValue(window._lojaRef('reposicao/categorias'), snap => {
            const val = snap.val() || {};
            categorias = Object.keys(val).map(id => ({ id, ...val[id] })).sort((a, b) => (a.criadoEm || 0) - (b.criadoEm || 0));
            renderCats();
            renderLista();
        });
        window._dbOnValue(window._lojaRef('reposicao/itens'), snap => {
            const val = snap.val() || {};
            itens = Object.keys(val).map(id => ({ id, ...val[id] }));
            renderLista();
        });
    }

    // ── Chips de categoria (filtro, e também usado dentro do modal) ──
    // Um render só pras duas situações (filtro da lista e seletor do
    // modal de item) — evita duplicar a lógica de "+ Nova" em dois
    // lugares. onClicar troca a seleção de uma categoria já existente;
    // onCriar já entra direto selecionada, sem precisar clicar de novo.
    function renderChipsCategoria(wrapId, selecionadaId, onClicar, onCriar) {
        const wrap = el(wrapId);
        if (!wrap) return;
        wrap.innerHTML = categorias.map(c => `
            <button type="button" class="stq-cat-pill${selecionadaId === c.id ? ' active' : ''}" data-cat="${c.id}"
                style="background:${c.cor}22;color:${c.cor};">${esc(c.nome)}</button>
        `).join('') + `<button type="button" class="stq-cat-pill repo-nova-cat" data-nova-cat="1" style="border-style:dashed;">+ Nova</button>`;

        wrap.querySelectorAll('[data-cat]').forEach(btn => {
            btn.addEventListener('click', () => onClicar(btn.dataset.cat));
        });
        wrap.querySelector('[data-nova-cat]')?.addEventListener('click', e => ativarFormNovaCategoria(e.currentTarget, onCriar));
    }

    function renderCats() {
        renderChipsCategoria('repoCats', filtroCategoria,
            id => { filtroCategoria = filtroCategoria === id ? null : id; renderCats(); renderLista(); },
            id => { filtroCategoria = id; renderCats(); renderLista(); });
    }

    // Troca o botão "+ Nova" por um campinho de texto ali mesmo, no
    // lugar dele — nada de prompt() nativo do navegador, que sai feio
    // e fora do visual do app. Enter confirma, Esc ou o X cancela (só
    // volta a renderizar os chips normais, sem mexer no banco).
    function ativarFormNovaCategoria(btnNovaCat, aoCriar) {
        const holder = document.createElement('span');
        holder.className = 'repo-nova-cat-form';
        holder.innerHTML = `
            <input type="text" placeholder="Nome da categoria" maxlength="24"/>
            <button type="button" class="repo-nova-cat-ok" aria-label="Confirmar"><i class="bi bi-check-lg"></i></button>
            <button type="button" class="repo-nova-cat-cancelar" aria-label="Cancelar"><i class="bi bi-x-lg"></i></button>
        `;
        btnNovaCat.replaceWith(holder);
        const input = holder.querySelector('input');
        input.focus();

        function cancelar() { renderCats(); renderCatsModal(); }
        function confirmar() {
            const nome = input.value.trim();
            if (!nome) { input.focus(); return; }
            const cor = PALETA_CORES[categorias.length % PALETA_CORES.length];
            window._dbPush(window._lojaRef('reposicao/categorias'), { nome, cor, criadoEm: Date.now() })
                .then(res => aoCriar(res.key))
                .catch(() => window.showCustomModal && window.showCustomModal({ message: 'Não deu pra criar a categoria. Tenta de novo.' }));
        }
        holder.querySelector('.repo-nova-cat-ok').addEventListener('click', confirmar);
        holder.querySelector('.repo-nova-cat-cancelar').addEventListener('click', cancelar);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
            if (e.key === 'Escape') cancelar();
        });
    }

    // ── Lista de itens ───────────────────────────────────────────
    function renderLista() {
        const listEl = el('repoList');
        if (!listEl) return;

        let visiveis = filtroCategoria ? itens.filter(i => i.categoriaId === filtroCategoria) : itens.slice();
        // Não comprados primeiro (mais novo primeiro); comprados afundam
        // pro fim da lista — igual qualquer lista de compras normal,
        // sem sumir da tela (só "Limpar comprados" tira de vez).
        visiveis.sort((a, b) => {
            if (!!a.comprado !== !!b.comprado) return a.comprado ? 1 : -1;
            return (b.criadoEm || 0) - (a.criadoEm || 0);
        });

        el('repoVazio').style.display = visiveis.length ? 'none' : 'flex';
        listEl.style.display = visiveis.length ? 'flex' : 'none';

        listEl.innerHTML = visiveis.map(it => `
            <div class="repo-card${it.comprado ? ' comprado' : ''}" data-id="${it.id}">
                <div class="repo-card-check" data-action="check"><i class="bi bi-check-lg"></i></div>
                <div class="repo-card-foto" data-action="editar">
                    ${it.fotoThumbUrl || it.fotoUrl
                        ? `<img src="${esc(it.fotoThumbUrl || it.fotoUrl)}" loading="lazy" alt=""/>`
                        : `<i class="bi bi-bag-fill" style="color:${corCat(it.categoriaId)};"></i>`}
                </div>
                <div class="repo-card-info" data-action="editar">
                    <div class="repo-card-nome">${esc(it.nome)}</div>
                    <div class="repo-card-meta">
                        <span class="repo-badge" style="background:${corCat(it.categoriaId)}22;color:${corCat(it.categoriaId)};">${esc(nomeCat(it.categoriaId))}</span>
                        ${it.quantidade && it.quantidade > 1 ? `<span class="repo-qtd">Qtd: ${it.quantidade}</span>` : ''}
                    </div>
                </div>
                <button type="button" class="repo-card-del" data-action="apagar" aria-label="Apagar"><i class="bi bi-trash"></i></button>
            </div>
        `).join('');

        const totalComprados = itens.filter(i => i.comprado).length;
        const btnLimpar = el('repoLimparBtn');
        btnLimpar.style.display = totalComprados ? 'block' : 'none';
        btnLimpar.textContent = `Finalizar reposição (${totalComprados} comprado${totalComprados > 1 ? 's' : ''})`;

        listEl.querySelectorAll('.repo-card').forEach(card => {
            const id = card.dataset.id;
            const item = itens.find(i => i.id === id);
            if (!item) return;
            card.querySelector('[data-action="check"]')?.addEventListener('click', e => {
                e.stopPropagation();
                window._dbUpdate(window._lojaRef('reposicao/itens/' + id), {
                    comprado: !item.comprado,
                    compradoEm: !item.comprado ? Date.now() : null,
                });
            });
            card.querySelectorAll('[data-action="editar"]').forEach(elx => {
                elx.addEventListener('click', () => abrirModalItem(item));
            });
            card.querySelector('[data-action="apagar"]')?.addEventListener('click', e => {
                e.stopPropagation();
                if (typeof window.showCustomModal !== 'function') return;
                window.showCustomModal({
                    message: `Apagar "${item.nome}"?`,
                    confirmText: 'Apagar',
                    cancelText: 'Cancelar',
                    onConfirm: () => {
                        window._dbRemove(window._lojaRef('reposicao/itens/' + id));
                        if (item.fotoUrl) { /* foto órfã no Storage — custo desprezível, não vale a complexidade de apagar por aqui */ }
                    },
                    onCancel: () => {},
                });
            });
        });
    }

    function limparComprados() {
        const comprados = itens.filter(i => i.comprado);
        if (!comprados.length) return;
        if (typeof window.showCustomModal !== 'function') return; // sem fallback pro confirm() nativo — melhor não finalizar do que abrir feio
        window.showCustomModal({
            message: `Finalizar essa reposição? Os ${comprados.length} item(ns) já comprado(s) somem da lista — quem ficou desmarcado continua aqui pra próxima.`,
            confirmText: 'Finalizar',
            cancelText: 'Cancelar',
            onConfirm: () => {
                const updates = {};
                comprados.forEach(i => { updates[i.id] = null; });
                window._dbUpdate(window._lojaRef('reposicao/itens'), updates);
            },
            onCancel: () => {},
        });
    }

    // ── Modal: novo item / editar item ──────────────────────────
    // ── Catálogo de produtos — sobrevive ao "Finalizar reposição"
    // (que só apaga o ITEM da lista de compras, nunca o catálogo).
    // É essa memória que alimenta a sugestão ao digitar. ──
    function carregarCatalogoSeNecessario() {
        if (catalogoCache) return Promise.resolve(catalogoCache);
        return window._dbGet(window._lojaRef('reposicao/catalogo')).then(snap => {
            const dados = snap.val() || {};
            catalogoCache = Object.keys(dados).map(id => ({ id, ...dados[id] }));
            return catalogoCache;
        }).catch(() => { catalogoCache = []; return catalogoCache; });
    }

    function onBuscaProdutoInput() {
        const q = el('repoFormNome').value.trim().toLowerCase();
        const results = el('repoCatalogoResults');
        if (!results) return; // não existe no modo edição, de propósito
        if (!q) { results.style.display = 'none'; return; }
        carregarCatalogoSeNecessario().then(lista => {
            const achou = lista.filter(p => (p.nome || '').toLowerCase().includes(q));
            if (!achou.length) { results.style.display = 'none'; return; }
            results.innerHTML = achou.slice(0, 6).map(p => `
                <div class="rep-cliente-item" data-id="${p.id}">
                    <b>${esc(p.nome)}</b>
                    <span>${p.categoriaId ? esc((categorias.find(c => c.id === p.categoriaId) || {}).nome || '') : 'já comprado antes'}</span>
                </div>
            `).join('');
            results.style.display = 'block';
            results.querySelectorAll('.rep-cliente-item').forEach(el2 => {
                el2.addEventListener('click', () => {
                    const p = lista.find(x => x.id === el2.dataset.id);
                    if (p) selecionarDoCatalogo(p);
                });
            });
        });
    }

    function selecionarDoCatalogo(p) {
        el('repoFormNome').value = p.nome;
        el('repoCatalogoResults').style.display = 'none';
        categoriaSelecionadaModal = p.categoriaId || categoriaSelecionadaModal;
        renderCatsModal();
        if (p.fotoUrl) {
            fotoPendente = null;
            fotoDoHistorico = { fotoUrl: p.fotoUrl, fotoThumbUrl: p.fotoThumbUrl || null };
            renderFotoPreview();
        }
        // Foco na quantidade — é literalmente a única coisa que falta
        // preencher depois de escolher uma sugestão.
        el('repoFormQtd')?.focus();
        el('repoFormQtd')?.select();
    }

    // Upsert por nome (sem acento/maiúscula não importa) — cria na
    // primeira vez que um produto aparece, atualiza (foto mais
    // recente, se tiver) nas próximas.
    function upsertCatalogo(nome, categoriaId, fotoUrl, fotoThumbUrl) {
        const nomeNorm = nome.trim().toLowerCase();
        return carregarCatalogoSeNecessario().then(lista => {
            const existente = lista.find(p => (p.nome || '').trim().toLowerCase() === nomeNorm);
            const dados = { nome: nome.trim(), categoriaId: categoriaId || null, ultimaVez: Date.now() };
            if (fotoUrl) { dados.fotoUrl = fotoUrl; dados.fotoThumbUrl = fotoThumbUrl || null; }
            if (existente) {
                return window._dbUpdate(window._lojaRef('reposicao/catalogo/' + existente.id), dados).then(() => {
                    Object.assign(existente, dados);
                });
            }
            return window._dbPush(window._lojaRef('reposicao/catalogo'), dados).then(res => {
                catalogoCache.push({ id: res.key, ...dados });
            });
        }).catch(e => console.error('Erro ao atualizar catálogo de produtos (não crítico, item já foi salvo):', e));
    }

    function abrirModalItem(item) {
        editingId = item ? item.id : null;
        fotoPendente = null;
        fotoDoHistorico = null;
        fotoUrlAtual = item ? (item.fotoUrl || null) : null;
        categoriaSelecionadaModal = item ? (item.categoriaId || null) : filtroCategoria;

        el('repoModalTitle').textContent = item ? 'Editar item' : 'Novo item';
        el('repoModalBody').innerHTML = `
            <label class="form-label">Nome do produto</label>
            <div style="position:relative;">
                <input class="form-control" id="repoFormNome" type="text" placeholder="Ex: Capinha iPhone 13" value="${esc(item?.nome || '')}" autocomplete="off"/>
                ${!item ? `<div class="rep-cliente-results" id="repoCatalogoResults" style="display:none;"></div>` : ''}
            </div>

            <label class="form-label" style="margin-top:12px;">Categoria</label>
            <div class="stq-cats" id="repoCatsModal" style="padding:0;margin:0 0 4px;"></div>

            <label class="form-label" style="margin-top:12px;">Quantidade</label>
            <input class="form-control" id="repoFormQtd" type="number" inputmode="numeric" min="1" value="${item?.quantidade || 1}" style="max-width:110px;"/>

            <label class="form-label" style="margin-top:12px;"><i class="bi bi-camera-fill"></i> Foto (opcional)</label>
            <div class="rep-foto-btns">
                <button type="button" class="rep-foto-btn" id="repoFotoBtnCam"><i class="bi bi-camera-fill"></i> Tirar foto</button>
                <button type="button" class="rep-foto-btn" id="repoFotoBtnGal"><i class="bi bi-image-fill"></i> Da galeria</button>
            </div>
            <input type="file" accept="image/*" capture="environment" id="repoFotoInputCam" class="hidden">
            <input type="file" accept="image/*" id="repoFotoInputGal" class="hidden">
            <div id="repoFotoPreviewWrap"></div>

            <button type="button" class="rep-btn-next" id="repoSalvarBtn" style="width:100%;padding:13px;margin-top:18px;">${item ? 'Salvar' : 'Adicionar'}</button>
        `;
        renderCatsModal();
        renderFotoPreview();

        el('repoFotoBtnCam')?.addEventListener('click', () => el('repoFotoInputCam').click());
        el('repoFotoBtnGal')?.addEventListener('click', () => el('repoFotoInputGal').click());
        el('repoFotoInputCam')?.addEventListener('change', handleFotoSelect);
        el('repoFotoInputGal')?.addEventListener('change', handleFotoSelect);
        el('repoSalvarBtn')?.addEventListener('click', salvarItem);
        el('repoFormNome')?.addEventListener('input', onBuscaProdutoInput);

        const backdrop = el('repoModalBackdrop');
        backdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(fecharModal);
    }

    function fecharModal() {
        el('repoModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        const body = el('repoModalBody');
        if (body) body.innerHTML = '';
        editingId = null;
        fotoPendente = null;
        fotoUrlAtual = null;
        fotoDoHistorico = null;
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
    }

    function renderCatsModal() {
        renderChipsCategoria('repoCatsModal', categoriaSelecionadaModal,
            id => { categoriaSelecionadaModal = categoriaSelecionadaModal === id ? null : id; renderCatsModal(); },
            id => { categoriaSelecionadaModal = id; renderCatsModal(); });
    }

    function renderFotoPreview() {
        const wrap = el('repoFotoPreviewWrap');
        if (!wrap) return;
        const url = fotoPendente ? fotoPendente.previewUrl : (fotoDoHistorico ? fotoDoHistorico.fotoUrl : fotoUrlAtual);
        wrap.innerHTML = url
            ? `<div class="repo-foto-preview"><img src="${url}" alt=""/><button type="button" id="repoFotoRemoverBtn" aria-label="Remover foto"><i class="bi bi-x-lg"></i></button></div>`
            : '';
        el('repoFotoRemoverBtn')?.addEventListener('click', () => {
            fotoPendente = null;
            fotoUrlAtual = null;
            fotoDoHistorico = null;
            renderFotoPreview();
        });
    }

    async function handleFotoSelect(e) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const previewUrl = URL.createObjectURL(file);
        fotoPendente = { blob: file, previewUrl };
        fotoDoHistorico = null;
        renderFotoPreview();
        try {
            // 480px basta — é só uma referência visual pra quem vai
            // comprar, nunca precisa de qualidade de "prova", e assim o
            // card da lista (que mostra ela em bloco pequeno) nunca
            // baixa nada pesado à toa.
            fotoPendente.blob = await window._comprimirImagem(file, 480, 0.75);
        } catch (err) {
            console.error('Erro ao comprimir foto do item, usando original sem comprimir:', err);
        }
    }

    function salvarItem() {
        const nome = el('repoFormNome')?.value.trim();
        const quantidade = Math.max(1, parseInt(el('repoFormQtd')?.value, 10) || 1);
        if (!nome) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Dá um nome pro produto.' });
            return;
        }

        const btn = el('repoSalvarBtn');
        btn.disabled = true;
        btn.textContent = 'Salvando...';

        const payloadBase = {
            nome,
            categoriaId: categoriaSelecionadaModal || null,
            quantidade,
        };

        const salvarMetadados = id => {
            const dados = { ...payloadBase };
            if (!fotoPendente) {
                dados.fotoUrl = fotoUrlAtual || null;
                if (!fotoUrlAtual) dados.fotoThumbUrl = null; // foto removida — limpa a miniatura junto
            }
            return window._dbUpdate(window._lojaRef('reposicao/itens/' + id), dados).then(() => id);
        };

        // Miniatura pequena (~120px), gerada a partir do blob que JÁ
        // foi comprimido pra 480px — é ela que a lista usa (cartão de
        // 48px não precisa de imagem de 480px pra mostrar, só deixa
        // mais lento carregar a lista à toa). Mesma ideia já usada em
        // Concertos.
        //
        const resolverFoto = id => {
            if (fotoPendente) {
                return Promise.all([
                    window._uploadFotoStorage(fotoPendente.blob, `reposicao/${id}.jpg`),
                    window._comprimirImagem(fotoPendente.blob, 120, 0.6)
                        .then(thumbBlob => window._uploadFotoStorage(thumbBlob, `reposicao/${id}-thumb.jpg`)),
                ]).then(([fotoUrl, fotoThumbUrl]) =>
                    window._dbUpdate(window._lojaRef('reposicao/itens/' + id), { fotoUrl, fotoThumbUrl }).then(() => ({ id, fotoUrl, fotoThumbUrl }))
                );
            }
            if (fotoDoHistorico) {
                return window._dbUpdate(window._lojaRef('reposicao/itens/' + id), { fotoUrl: fotoDoHistorico.fotoUrl, fotoThumbUrl: fotoDoHistorico.fotoThumbUrl })
                    .then(() => ({ id, fotoUrl: fotoDoHistorico.fotoUrl, fotoThumbUrl: fotoDoHistorico.fotoThumbUrl }));
            }
            return Promise.resolve({ id, fotoUrl: null, fotoThumbUrl: null });
        };

        const ehNovo = !editingId;
        const acao = editingId
            ? salvarMetadados(editingId).then(resolverFoto)
            : window._dbPush(window._lojaRef('reposicao/itens'), {
                ...payloadBase,
                fotoUrl: fotoDoHistorico ? fotoDoHistorico.fotoUrl : null,
                fotoThumbUrl: fotoDoHistorico ? fotoDoHistorico.fotoThumbUrl : null,
                comprado: false, criadoEm: Date.now(),
            }).then(res => res.key).then(resolverFoto);

        acao.then(({ fotoUrl, fotoThumbUrl }) => {
                // Só alimenta o catálogo em item NOVO — editar um item
                // existente não precisa re-registrar o que já tá lá.
                // Usa a foto que REALMENTE terminou salva (nova subida
                // ou reaproveitada do histórico), nunca fica de fora.
                if (ehNovo) return upsertCatalogo(nome, categoriaSelecionadaModal, fotoUrl, fotoThumbUrl);
            })
            .then(() => fecharModal())
            .catch(e => {
                console.error('Erro ao salvar item de reposição:', e);
                if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Não deu pra salvar: ${e.message}` });
            })
            .finally(() => {
                btn.disabled = false;
                btn.textContent = editingId ? 'Salvar' : 'Adicionar';
            });
    }

    // ── Entrada pública ──────────────────────────────────────────
    function renderReposicaoLista() {
        ensureSkeleton();
        ligarListeners();
        renderCats();
        renderLista();
    }
    window._renderReposicaoLista = renderReposicaoLista;
})();
