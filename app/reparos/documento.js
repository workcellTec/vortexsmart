// ================================================================
// reparos/documento.js — VortexSmart · Concertos · Gerar comprovante
// Um modal só, com 2 passos (mesmo espírito do wizard de
// venda/fechar.js — troca o CONTEÚDO do modal em vez de abrir um
// modal novo em cima do outro):
//   Passo 1: "Qual foi o concerto feito?" + tempo de garantia
//   Passo 2: "Recibo gerado! Deseja editar?"
// Usa window._reciboGerarAutomatico / _reciboAbrirEdicaoComDados
// (documentos/recibo.js) pra criar o recibo de verdade — não duplica
// a lógica de montar/gerar recibo aqui.
// Expõe via window.*:
//   _reparosAbrirModalDoc(os)
// Depende de (via window.*):
//   showCustomModal, escapeHtml, _lojaRef, _dbUpdate,
//   _vsAbrirModal, _vsFecharModal, _vsLimparModalSemVoltar,
//   _vsTravarScroll, _vsDestravarScroll,
//   _reciboGerarAutomatico, _reciboAbrirEdicaoComDados,
//   _reciboCompartilharComDados
// ================================================================
(function () {
    'use strict';

    const el  = id => document.getElementById(id);
    const esc = t  => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : t;

    let backdrop = null;
    let _os = null;
    let _garantiaUnidade = 'dias';
    let _resultado = null; // { id, dados } — preenchido depois de gerar, usado no passo 2

    function ensureBackdrop() {
        if (backdrop) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="stq-modal-backdrop" id="repDocBackdrop">
                <div class="stq-modal-card">
                    <div class="stq-modal-header primary" id="repDocHeader">
                        <div class="stq-modal-header-title" id="repDocTitulo">Gerar comprovante</div>
                        <button class="stq-modal-close" id="repDocCloseBtn"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="repDocBody"></div>
                </div>
            </div>`);
        backdrop = el('repDocBackdrop');
        el('repDocCloseBtn').addEventListener('click', fecharModal);
        backdrop.addEventListener('click', e => { if (e.target.id === 'repDocBackdrop') fecharModal(); });
    }

    function abrirModal() {
        backdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(fecharModal);
    }
    function fecharModal() {
        backdrop?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        _os = null; _resultado = null;
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
    }

    // ── Passo 1 — pergunta ──────────────────────────────────────
    function renderPasso1() {
        el('repDocHeader').className = 'stq-modal-header primary';
        el('repDocTitulo').textContent = 'Gerar comprovante';
        _garantiaUnidade = 'dias';
        el('repDocBody').innerHTML = `
            <div class="rep-form-group">
                <label class="form-label">Qual foi o concerto feito?</label>
                <textarea class="form-control" id="repDocSolucao" rows="3" placeholder="Ex: Troca de tela e bateria"></textarea>
            </div>
            <div class="rep-form-group">
                <label class="form-label">Tempo de garantia</label>
                <div class="rep-garantia-row">
                    <div class="rep-seg-toggle" id="repDocGarantiaUnidade">
                        <button type="button" data-un="dias" class="active">Dias</button>
                        <button type="button" data-un="meses">Meses</button>
                    </div>
                    <input class="form-control" id="repDocGarantiaQtd" type="number" min="0" value="90"/>
                </div>
            </div>
            <button class="rep-btn-next" style="width:100%;padding:12px;" id="repDocGerarBtn"><i class="bi bi-file-earmark-check-fill"></i> Gerar recibo</button>
        `;
        el('repDocGarantiaUnidade').querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                el('repDocGarantiaUnidade').querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                _garantiaUnidade = btn.dataset.un;
            });
        });
        el('repDocGerarBtn').addEventListener('click', gerarDocumento);
    }

    function garantiaTexto(qtd, unidade) {
        if (!qtd || qtd <= 0) return 'Sem garantia';
        return `${qtd} ${unidade === 'meses' ? (qtd === 1 ? 'mês' : 'meses') : (qtd === 1 ? 'dia' : 'dias')}`;
    }

    async function gerarDocumento() {
        if (!_os) return;
        const solucao = el('repDocSolucao')?.value.trim() || '';
        const qtd = parseInt(el('repDocGarantiaQtd')?.value, 10) || 0;
        const garantiaTxt = garantiaTexto(qtd, _garantiaUnidade);

        const btn = el('repDocGerarBtn');
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Gerando...';

        try {
            const item = { nome: 'Concerto', valor: 0, qtd: 1, cor: '', obs: solucao || 'Concerto realizado.' };
            const res = await window._reciboGerarAutomatico({
                nome: _os.cliente?.nome || 'Cliente',
                tel:  _os.cliente?.telefone || '',
                items: [item],
                garantiaTxt,
            });
            _resultado = res;
            // Guarda a referência do recibo na própria OS, pra rastrear
            // depois qual comprovante foi gerado pra ela (não bloqueia
            // o fluxo se falhar — o recibo já foi salvo de qualquer jeito).
            window._dbUpdate(window._lojaRef('reparos/' + _os.id), { reciboId: res.id }).catch(() => {});
            renderPasso2();
        } catch (e) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao gerar recibo: ${e.message}` });
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    // ── Passo 2 — pós-geração ────────────────────────────────────
    function renderPasso2() {
        el('repDocHeader').className = 'stq-modal-header green';
        el('repDocTitulo').textContent = 'Recibo gerado!';
        el('repDocBody').innerHTML = `
            <p style="font-size:.78rem;color:var(--text);line-height:1.6;margin-bottom:16px;">
                Já usei os dados da OS pra montar o recibo simples, na aba Documentos. Quer revisar ou ajustar algo antes de compartilhar?
            </p>
            <div style="display:flex;gap:8px;">
                <button class="rep-btn-manual" style="width:auto;flex:1;height:auto;padding:11px;font-size:.72rem;font-weight:700;" id="repDocPosNao">Não, envia assim</button>
                <button class="rep-btn-next" style="flex:1;" id="repDocPosSim">Sim, editar</button>
            </div>
        `;
        el('repDocPosNao').addEventListener('click', () => {
            const resultado = _resultado;
            backdrop.classList.remove('show');
            window._vsDestravarScroll && window._vsDestravarScroll();
            if (typeof window._vsLimparModalSemVoltar === 'function') window._vsLimparModalSemVoltar();
            _os = null; _resultado = null;
            if (resultado && typeof window._reciboCompartilharComDados === 'function') {
                window._reciboCompartilharComDados(resultado.dados);
            }
        });
        el('repDocPosSim').addEventListener('click', () => {
            const resultado = _resultado;
            // Limpa o registro de modal SEM tocar no histórico (troca de
            // história ASSÍNCRONA, não pode brigar com a navegação que
            // vem em seguida — mesma lição do _vsLimparModalSemVoltar
            // já usada no resto do app) e deixa a navegação pro Recibo
            // cuidar do histórico sozinha.
            backdrop.classList.remove('show');
            window._vsDestravarScroll && window._vsDestravarScroll();
            if (typeof window._vsLimparModalSemVoltar === 'function') window._vsLimparModalSemVoltar();
            _os = null; _resultado = null;
            if (resultado && typeof window._reciboAbrirEdicaoComDados === 'function') {
                window._reciboAbrirEdicaoComDados(resultado.id, resultado.dados);
            }
        });
    }

    // ── Entrada pública ──────────────────────────────────────────
    function abrirModalDoc(os) {
        ensureBackdrop();
        _os = os;
        _resultado = null;
        renderPasso1();
        abrirModal();
    }
    window._reparosAbrirModalDoc = abrirModalDoc;
})();
