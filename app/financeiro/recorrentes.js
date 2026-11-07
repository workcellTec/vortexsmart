// ================================================================
// financeiro/recorrentes.js — VortexSmart · Financeiro → Recorrentes
// Registra: window._renderFinanceiroRecorrentes()
//
// Tela própria (não sanfona) de propósito — precisa aguentar dezenas
// de recorrentes sem virar bagunça, mesmo raciocínio de busca +
// paginação que já resolveu isso nos Concertos.
//
// financeiro/recorrentes/{id} = { nome, categoria, categoriaNome,
//   valor, diaDoMes, ativa, criadoEm }
//
// ⚠️ PENDENTE (só dá pra fazer pelo PC): Cloud Function agendada tipo
// verificarParcelasVencendo (já existe, ver notificações) — uma nova
// verificarRecorrentesVencendo rodando 1x/dia, comparando o dia de
// hoje com 'diaDoMes' de cada recorrente ativa e mandando notificação
// com um botão de ação "Confirmar lançamento" (mesmo padrão de botão
// de ação das notificações que já existem: WhatsApp, atalho de nav).
// O botão deve abrir financeiro/lancamentos.js direto na tela de Nova
// Despesa, categoria e valor já preenchidos com os da recorrente —
// nunca lança sozinho no banco, só ela confirmando (decisão já
// fechada com o Gestor).
// ================================================================
(function () {
    'use strict';
    const el    = id => document.getElementById(id);
    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc   = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt   = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const ref   = p => window._lojaRef(p);
    const refFin = p => window._financeiroRef(p);

    const CAT_DESPESA = window._FINANCEIRO_CATEGORIAS_DESPESA_BASE || [];

    let mounted = false;
    let tela = 'lista'; // 'lista' | 'form'
    let editandoId = null;
    let termoBusca = '';
    const LIMITE_PAGINA = 30;
    let limiteExibicao = LIMITE_PAGINA;

    function ensureSkeleton() {
        const container = el('financeiroRecorrentes');
        if (!container || mounted) return;
        container.innerHTML = `<div id="finRecBody" class="vs-fin-largura"></div>`;
        mounted = true;
    }

    function categoriaEmoji(catId) {
        const mapa = { produto:'📦', aluguel:'🏠', funcionario:'👤', contas:'💡', manutencao:'🔧', marketing:'📣', outras:'📁' };
        return mapa[catId] || '💸';
    }

    function todasRecorrentes() {
        const data = window._financeiroRecorrentes || {};
        return Object.keys(data).map(id => ({ id, ...data[id] }));
    }

    function renderTudo() {
        ensureSkeleton();
        if (tela === 'lista') renderLista(); else renderForm();
    }

    // ══════════════════════ TELA: LISTA ══════════════════════
    function renderLista() {
        const wrap = el('finRecBody');
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Recorrentes</h3>
                <div style="width:36px;"></div>
            </div>
            <div class="content-card w-100">
                <div class="stq-hist-sub mb-2" style="font-size:.72rem;">Quando o dia chegar, avisa por notificação — você confirma, nada lança sozinho.</div>
                <div class="mb-2" style="position:relative;">
                    <div class="bk-search-dash">
                        <i class="bi bi-search"></i>
                        <input type="text" id="finRecBusca" placeholder="Buscar recorrente..." autocomplete="off">
                    </div>
                </div>
                <button type="button" class="ctx-add-btn mb-3" id="finRecNovoBtn"><i class="bi bi-plus-lg"></i> Nova Recorrente</button>
                <div id="finRecList"></div>
            </div>
        `;
        renderListaItens();

        wrap.querySelector('.btn-back').addEventListener('click', () => window.openFinanceiroSection('financeiroHome'));
        el('finRecNovoBtn').addEventListener('click', () => abrirForm());
        el('finRecBusca').addEventListener('input', () => {
            termoBusca = el('finRecBusca').value.trim().toLowerCase();
            limiteExibicao = LIMITE_PAGINA;
            renderListaItens();
        });
    }

    function itensFiltrados() {
        return todasRecorrentes()
            .filter(r => !termoBusca || (r.nome || '').toLowerCase().includes(termoBusca) || (r.categoriaNome || '').toLowerCase().includes(termoBusca))
            .sort((a, b) => (a.diaDoMes || 0) - (b.diaDoMes || 0));
    }

    function renderListaItens() {
        const todos = itensFiltrados();
        const visiveis = todos.slice(0, limiteExibicao);
        const listEl = el('finRecList');
        if (!todos.length) {
            listEl.innerHTML = `<div class="stq-hist-sub text-center py-3">Nenhuma recorrente cadastrada ainda.</div>`;
            return;
        }
        listEl.innerHTML = visiveis.map(r => `
            <div class="pulse-tl-row" data-id="${r.id}" style="border-bottom:none;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:10px 12px;margin-bottom:8px;">
                <div class="pulse-tl-ic">${categoriaEmoji(r.categoria)}</div>
                <div class="pulse-tl-mid" style="cursor:pointer;" data-editar="${r.id}">
                    <div class="pulse-tl-titulo">${esc(r.nome)}</div>
                    <div class="pulse-tl-sub">Todo dia ${r.diaDoMes} · ${fmt(r.valor)} · ${esc(r.categoriaNome || '')}</div>
                </div>
                <button type="button" class="ctx-switch ${r.ativa ? 'on' : ''}" data-toggle="${r.id}" aria-label="Ativa/pausada"></button>
                <button type="button" class="ctx-icon-btn" data-excluir="${r.id}" aria-label="Excluir" style="margin-left:6px;">🗑️</button>
            </div>
        `).join('') + (todos.length > limiteExibicao ? `<button type="button" class="rep-vermais-btn" id="finRecVerMais">Ver mais (${limiteExibicao} de ${todos.length})</button>` : '');

        listEl.querySelectorAll('[data-editar]').forEach(elm => elm.addEventListener('click', () => abrirForm(elm.dataset.editar)));
        listEl.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', () => {
            const id = btn.dataset.toggle;
            const atual = !!(window._financeiroRecorrentes || {})[id]?.ativa;
            window._dbUpdate(refFin(`recorrentes/${id}`), { ativa: !atual }).catch(e => modal({ message: `Erro ao salvar: ${e.message}` }));
        }));
        listEl.querySelectorAll('[data-excluir]').forEach(btn => btn.addEventListener('click', () => {
            const id = btn.dataset.excluir;
            modal({
                message: 'Excluir essa recorrente? Não apaga lançamentos já confirmados antes, só para os avisos futuros.',
                confirmText: 'Excluir', cancelText: 'Cancelar',
                onConfirm: () => window._dbRemove(refFin(`recorrentes/${id}`)).catch(e => modal({ message: `Erro ao excluir: ${e.message}` }))
            });
        }));
        el('finRecVerMais')?.addEventListener('click', () => { limiteExibicao += LIMITE_PAGINA; renderListaItens(); });
    }

    // ══════════════════════ TELA: FORM ══════════════════════
    function abrirForm(id) {
        editandoId = id || null;
        tela = 'form';
        renderTudo();
    }

    function renderForm() {
        const wrap = el('finRecBody');
        const item = editandoId ? (window._financeiroRecorrentes || {})[editandoId] || {} : {};
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-icon-circle" id="finRecFormVoltar" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>${editandoId ? 'Editar' : 'Nova'} Recorrente</h3>
                <div style="width:36px;"></div>
            </div>
            <div class="content-card w-100">
                <div class="cfgA-card mb-3" style="padding:14px;">
                    <label class="ctx-field-label" style="margin-top:0;">Nome</label>
                    <input class="ctx-field-input" id="finRecNome" placeholder="Ex: Aluguel, Funcionário — João" value="${esc(item.nome || '')}">
                    <label class="ctx-field-label mt-2">Categoria</label>
                    <div class="ctx-bandeira-chips-dyn" id="finRecCatGrid" style="display:flex;"></div>
                    <label class="ctx-field-label mt-2">Valor</label>
                    <input class="ctx-field-input" type="number" step="0.01" id="finRecValor" placeholder="R$ 0,00" value="${item.valor ?? ''}">
                    <label class="ctx-field-label mt-2">Todo dia (do mês)</label>
                    <input class="ctx-field-input" type="number" min="1" max="31" id="finRecDia" placeholder="Ex: 5" value="${item.diaDoMes ?? ''}">
                </div>
                <button class="ctx-add-btn ctx-add-btn-solid" type="button" id="finRecSalvarBtn"><i class="bi bi-check-lg"></i> Salvar</button>
            </div>
        `;
        el('finRecCatGrid').innerHTML = CAT_DESPESA.map((c, i) => {
            const ativo = item.categoria ? c.id === item.categoria : i === 0;
            return `<div class="ctx-bandeira-chip-dyn ${ativo ? 'on' : ''}" data-cat="${c.id}" data-nome="${esc(c.nome)}"><span>${categoriaEmoji(c.id)} ${esc(c.nome)}</span></div>`;
        }).join('');
        el('finRecCatGrid').querySelectorAll('[data-cat]').forEach(chip => {
            chip.addEventListener('click', () => {
                el('finRecCatGrid').querySelectorAll('[data-cat]').forEach(c => c.classList.remove('on'));
                chip.classList.add('on');
            });
        });

        el('finRecFormVoltar').addEventListener('click', () => { tela = 'lista'; renderTudo(); });
        el('finRecSalvarBtn').addEventListener('click', salvarRecorrente);
    }

    function salvarRecorrente() {
        const nome = el('finRecNome').value.trim();
        const catBtn = el('finRecCatGrid').querySelector('.ctx-bandeira-chip-dyn.on');
        const valor = parseFloat(el('finRecValor').value);
        const dia = parseInt(el('finRecDia').value, 10);

        if (!nome) { modal({ message: 'Dá um nome pra recorrente.' }); return; }
        if (!catBtn) { modal({ message: 'Escolhe uma categoria.' }); return; }
        if (!valor || valor <= 0) { modal({ message: 'Informa um valor válido.' }); return; }
        if (!dia || dia < 1 || dia > 31) { modal({ message: 'Dia do mês precisa ser entre 1 e 31.' }); return; }

        const btn = el('finRecSalvarBtn');
        const dados = { nome, categoria: catBtn.dataset.cat, categoriaNome: catBtn.dataset.nome, valor, diaDoMes: dia };
        if (!editandoId) { dados.ativa = true; dados.criadoEm = Date.now(); }

        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        const p = editandoId
            ? window._dbUpdate(refFin(`recorrentes/${editandoId}`), dados)
            : window._dbPush(refFin('recorrentes'), dados);

        p.then(() => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            tela = 'lista';
            renderTudo();
        }).catch(e => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            modal({ message: `Erro ao salvar: ${e.message}` });
        });
    }

    // ── Ponto de entrada chamado pelo router ──────────────────────
    window._renderFinanceiroRecorrentes = function () {
        tela = 'lista';
        editandoId = null;
        limiteExibicao = LIMITE_PAGINA;
        // Veio de uma notificação (Despesa recorrente vencendo) com uma
        // recorrente específica em mente — garante que ela apareça
        // (ignora busca deixada de outra vez, e estoura o limite de
        // exibição se precisar) e rola até ela.
        const alvo = window._financeiroContexto && window._financeiroContexto.recorrenteId;
        if (alvo) termoBusca = '';
        renderTudo();
        if (alvo) {
            const todos = todasRecorrentes();
            const idx = todos.sort((a, b) => (a.diaDoMes || 0) - (b.diaDoMes || 0)).findIndex(r => r.id === alvo);
            if (idx >= 0 && idx >= limiteExibicao) { limiteExibicao = idx + 1; renderListaItens(); }
            setTimeout(() => {
                const elAlvo = document.querySelector(`#finRecList [data-id="${alvo}"]`);
                elAlvo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                elAlvo?.classList.add('destaque-notificacao');
                setTimeout(() => elAlvo?.classList.remove('destaque-notificacao'), 2400);
            }, 120);
        }
    };
    window._finOnRecorrentesLoaded = function () {
        if (mounted && tela === 'lista') renderListaItens();
    };
})();
