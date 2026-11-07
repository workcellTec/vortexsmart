// ================================================================
// impressao/etiqueta-termica.js — VortexSmart PDV Desktop
// Ponte entre o app (estoque/produtos.js) e a impressão de etiqueta
// de código de barras (TSPL, impressora Knup KP-IM600). A montagem
// real do buffer TSPL acontece no processo Electron
// (impressao/tspl-builder.js, fora deste arquivo) — aqui só se
// recolhe o código/nome do produto e se chama window.vsmartPrint,
// que o preload.js do Electron expõe.
//
// IMPORTANTE: usa uma chave PRÓPRIA no localStorage
// (vsmart_impressora_etiqueta_escolhida), separada da chave da
// impressora de RECIBO (vsmart_impressora_termica_escolhida, em
// recibo-termico.js). São duas impressoras físicas diferentes —
// compartilhar a mesma chave faria configurar uma sobrescrever a
// outra, e o recibo poderia sair impresso na impressora de etiqueta
// (ou vice-versa).
//
// Mesmo padrão de modal próprio (HTML real) que recibo-termico.js
// usa, pelo mesmo motivo: showCustomModal só aceita texto puro.
//
// Depende de (via window.*):
//   showCustomModal, _showSuccessOverlay, escapeHtml
// Expõe via window.*:
//   _etiquetaTermicaDisponivel, _imprimirEtiquetaProduto,
//   _abrirSeletorImpressoraEtiqueta
// ================================================================
(function () {
    'use strict';

    const aviso = texto => typeof window.showCustomModal === 'function' && window.showCustomModal({ message: texto });
    const esc   = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const el    = id => document.getElementById(id);

    // Chave PRÓPRIA — ver nota no cabeçalho do arquivo sobre por que
    // não reaproveita a chave da impressora de recibo.
    const CHAVE_IMPRESSORA_LOCAL = 'vsmart_impressora_etiqueta_escolhida';

    function temElectron() {
        return typeof window.vsmartPrint === 'object' && window.vsmartPrint !== null;
    }
    window._etiquetaTermicaDisponivel = temElectron;

    function getImpressoraSalva() {
        return localStorage.getItem(CHAVE_IMPRESSORA_LOCAL) || '';
    }

    function setImpressoraSalva(nome) {
        localStorage.setItem(CHAVE_IMPRESSORA_LOCAL, nome);
    }

    // ── Modal próprio (HTML real, não texto) — mesma estrutura visual
    //    de recibo-termico.js, com IDs próprios (prefixo "et") pra não
    //    colidir se os dois modais existirem na mesma página. ──
    function ensureBackdrop() {
        if (el('etModalBackdrop')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="stq-modal-backdrop" id="etModalBackdrop">
                <div class="stq-modal-card">
                    <div class="stq-modal-header primary">
                        <div class="stq-modal-header-title" id="etModalTitulo">Impressão de etiqueta</div>
                        <button class="stq-modal-close" id="etModalClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="etModalBody"></div>
                </div>
            </div>`);
        el('etModalClose').addEventListener('click', fecharModal);
        el('etModalBackdrop').addEventListener('click', e => {
            if (e.target.id === 'etModalBackdrop') fecharModal();
        });
    }

    function abrirModal(titulo, corpoHtml) {
        ensureBackdrop();
        el('etModalTitulo').textContent = titulo;
        el('etModalBody').innerHTML = corpoHtml;
        el('etModalBackdrop').classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }

    function fecharModal() {
        el('etModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
    }

    // ── Seletor de impressora de ETIQUETA: modal com <select> populado
    //    via window.vsmartPrint.listarImpressoras() — a mesma lista de
    //    filas do Windows que a de recibo usa, mas a escolha do usuário
    //    aqui vai pra chave própria (CHAVE_IMPRESSORA_LOCAL acima),
    //    nunca sobrescrevendo a impressora de recibo salva. ──
    window._abrirSeletorImpressoraEtiqueta = async function (aoEscolher) {
        if (!temElectron()) {
            aviso('Impressão de etiqueta só está disponível na versão Desktop (.exe) do VortexSmart.');
            return;
        }
        let impressoras = [];
        try {
            impressoras = await window.vsmartPrint.listarImpressoras();
        } catch (e) {
            aviso('Não foi possível listar as impressoras: ' + (e.erro || limparErroIpc(e.message) || 'erro desconhecido'));
            return;
        }
        if (!impressoras.length) {
            aviso('Nenhuma impressora encontrada neste computador.');
            return;
        }
        const atual = getImpressoraSalva();
        const opcoesHtml = impressoras.map(nome =>
            `<option value="${esc(nome)}" ${nome === atual ? 'selected' : ''}>${esc(nome)}</option>`
        ).join('');

        abrirModal('Selecionar impressora de etiqueta', `
            <label class="form-label">Impressora de etiqueta (código de barras)</label>
            <select class="form-control mb-3" id="etSelectImpressora">${opcoesHtml}</select>
            <button type="button" class="stq-modal-btn-save w-100" id="etSalvarImpressoraBtn">
                <i class="bi bi-check-circle-fill"></i> Salvar
            </button>
        `);

        el('etSalvarImpressoraBtn').addEventListener('click', () => {
            const nome = el('etSelectImpressora')?.value || atual;
            setImpressoraSalva(nome);
            fecharModal();
            if (typeof aoEscolher === 'function') aoEscolher(nome);
        });
    };

    // ── Ação principal: imprime a etiqueta de código de barras de um
    //    produto. Chamado pelo botão de imprimir em estoque/produtos.js.
    //    opcoesTamanho (opcional): { copias, larguraMm, alturaMm, gapMm }.
    //    Padrão = rolo físico medido com régua: 45x30mm, gap 5mm (ver
    //    ETIQUETA_PADRAO em tspl-builder.js — mantido só lá; aqui só
    //    repassa o que o chamador informar). ──
    let imprimindo = false; // evita clique duplo gerar 2 impressões

    // O Electron devolve erros do processo principal com o prefixo
    // "Error invoking remote method '...': Error: " — tira, pra
    // mostrar ao usuário só a mensagem útil.
    const limparErroIpc = msg => String(msg || '').replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

    window._imprimirEtiquetaProduto = async function (nomeProduto, codigoBarras, opcoesTamanho) {
        if (!temElectron()) {
            aviso('Impressão de etiqueta só está disponível na versão Desktop (.exe) do VortexSmart.');
            return;
        }
        if (!codigoBarras) {
            aviso('Este produto ainda não tem um código de barras gerado.');
            return;
        }
        let nomeImpressora = getImpressoraSalva();
        if (!nomeImpressora) {
            window._abrirSeletorImpressoraEtiqueta(() => window._imprimirEtiquetaProduto(nomeProduto, codigoBarras, opcoesTamanho));
            return;
        }
        if (imprimindo) return;

        const opcoes = Object.assign({}, opcoesTamanho, { nomeProduto, codigoBarras });

        imprimindo = true;
        try {
            await window.vsmartPrint.imprimirEtiquetaProduto(nomeImpressora, opcoes);
            if (typeof window._showSuccessOverlay === 'function') {
                window._showSuccessOverlay('Etiqueta impressa!');
            }
        } catch (e) {
            abrirModal('Erro ao imprimir etiqueta', `
                <p>${esc(e.erro || limparErroIpc(e.message) || 'Erro desconhecido')}</p>
                ${e.dica ? `<p class="text-secondary" style="font-size:.85rem;">${esc(e.dica)}</p>` : ''}
                <button type="button" class="stq-modal-btn-save w-100 mt-2" id="etTrocarImpressoraBtn">
                    <i class="bi bi-printer-fill"></i> Trocar impressora
                </button>
            `);
            el('etTrocarImpressoraBtn').addEventListener('click', () => {
                fecharModal();
                window._abrirSeletorImpressoraEtiqueta(() => window._imprimirEtiquetaProduto(nomeProduto, codigoBarras, opcoesTamanho));
            });
        } finally {
            imprimindo = false;
        }
    };
})();
