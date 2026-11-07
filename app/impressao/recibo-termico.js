// ================================================================
// impressao/recibo-termico.js — VortexSmart PDV Desktop
// Ponte entre o app (venda/historico.js) e a impressão térmica ESC/POS.
// A montagem real do buffer ESC/POS acontece no processo Electron
// (impressao/escpos-builder.js, fora deste arquivo) — aqui só se
// recolhe os dados da venda/loja e se chama window.vsmartPrint,
// que o preload.js do Electron expõe.
//
// Usa um modal PRÓPRIO (não window.showCustomModal) porque aquele
// modal genérico injeta a mensagem via `textContent` (ver core.js),
// então não renderiza HTML — não dá pra colocar um <select> dentro
// dele. Este modal segue o mesmo padrão visual (.stq-modal-backdrop)
// já usado em outras telas do projeto (ex: venda/fechar.js).
//
// Se o app estiver rodando fora do Electron (ex: ainda no navegador
// mobile, ou build antiga sem o wrapper), window.vsmartPrint não
// existe — todas as funções aqui checam isso e avisam com toast
// simples (showCustomModal só com texto) em vez de quebrar.
//
// Depende de (via window.*):
//   showCustomModal, _lojaRef, _dbGet, _showSuccessOverlay, escapeHtml
// Expõe via window.*:
//   _reciboTermicoDisponivel, _imprimirReciboTermico,
//   _abrirSeletorImpressora
// ================================================================
(function () {
    'use strict';

    const aviso = texto => typeof window.showCustomModal === 'function' && window.showCustomModal({ message: texto });
    const esc   = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const el    = id => document.getElementById(id);

    // O Electron devolve erros do processo principal com o prefixo
    // "Error invoking remote method '...': Error: " — tira, pra
    // mostrar ao usuário só a mensagem útil.
    const limparErroIpc = msg => String(msg || '').replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

    // Nome da impressora escolhida fica salvo localmente (não precisa
    // ir pro Firebase — é configuração da MÁQUINA, não da loja; cada
    // PC/caixa pode ter uma impressora física diferente ligada nele).
    const CHAVE_IMPRESSORA_LOCAL = 'vsmart_impressora_termica_escolhida';

    function temElectron() {
        return typeof window.vsmartPrint === 'object' && window.vsmartPrint !== null;
    }
    window._reciboTermicoDisponivel = temElectron;

    function getImpressoraSalva() {
        return localStorage.getItem(CHAVE_IMPRESSORA_LOCAL) || '';
    }

    function setImpressoraSalva(nome) {
        localStorage.setItem(CHAVE_IMPRESSORA_LOCAL, nome);
    }

    // ── Busca os dados da loja (mesmo caminho usado pelo recibo em
    //    PNG, documentos/recibo.js: configuracoes/documentos) ──
    async function getDadosLoja() {
        let dados = {};
        try {
            const snap = await window._dbGet(window._lojaRef('configuracoes/documentos'));
            dados = snap.val() || {};
        } catch (e) {
            dados = {};
        }
        // O recibo sai sempre com o nome da loja: o salvo em Configurações → Documentos ou,
        // se ainda não preencheu, o nome com que a loja foi cadastrada (antes saía "LOJA").
        if (!dados.storeName) dados.storeName = window._nomeLojaCadastrada || '';
        return dados;
    }

    // ── Modal próprio (HTML real, não texto) ────────────────────────
    function ensureBackdrop() {
        if (el('rtModalBackdrop')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="stq-modal-backdrop" id="rtModalBackdrop">
                <div class="stq-modal-card">
                    <div class="stq-modal-header primary">
                        <div class="stq-modal-header-title" id="rtModalTitulo">Impressão</div>
                        <button class="stq-modal-close" id="rtModalClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="rtModalBody"></div>
                </div>
            </div>`);
        el('rtModalClose').addEventListener('click', fecharModal);
        el('rtModalBackdrop').addEventListener('click', e => {
            if (e.target.id === 'rtModalBackdrop') fecharModal();
        });
    }

    function abrirModal(titulo, corpoHtml) {
        ensureBackdrop();
        el('rtModalTitulo').textContent = titulo;
        el('rtModalBody').innerHTML = corpoHtml;
        el('rtModalBackdrop').classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }

    function fecharModal() {
        el('rtModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
    }

    // ── Seletor de impressora: modal com <select> populado via
    //    window.vsmartPrint.listarImpressoras(). Sempre acessível de
    //    novo depois — a fila de impressão varia de PC pra PC. ──
    window._abrirSeletorImpressora = async function (aoEscolher) {
        if (!temElectron()) {
            aviso('Impressão térmica só está disponível na versão Desktop (.exe) do VortexSmart.');
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

        abrirModal('Selecionar impressora', `
            <label class="form-label">Impressora térmica</label>
            <select class="form-control mb-3" id="rtSelectImpressora">${opcoesHtml}</select>
            <button type="button" class="stq-modal-btn-save w-100" id="rtSalvarImpressoraBtn">
                <i class="bi bi-check-circle-fill"></i> Salvar
            </button>
        `);

        el('rtSalvarImpressoraBtn').addEventListener('click', () => {
            const nome = el('rtSelectImpressora')?.value || atual;
            setImpressoraSalva(nome);
            fecharModal();
            if (typeof aoEscolher === 'function') aoEscolher(nome);
        });
    };

    // ── Ação principal: imprime o recibo térmico de uma venda fechada.
    //    Chamado pelo botão "Recibo" em venda/historico.js. ──
    window._imprimirReciboTermico = async function (venda) {
        if (!temElectron()) {
            aviso('Impressão térmica só está disponível na versão Desktop (.exe) do VortexSmart.');
            return;
        }
        let nomeImpressora = getImpressoraSalva();
        if (!nomeImpressora) {
            window._abrirSeletorImpressora(() => window._imprimirReciboTermico(venda));
            return;
        }

        const loja = await getDadosLoja();

        try {
            await window.vsmartPrint.imprimirRecibo(nomeImpressora, venda, loja);
            if (typeof window._showSuccessOverlay === 'function') {
                window._showSuccessOverlay('Recibo impresso!');
            }
        } catch (e) {
            abrirModal('Erro ao imprimir', `
                <p>${esc(e.erro || limparErroIpc(e.message) || 'Erro desconhecido')}</p>
                ${e.dica ? `<p class="text-secondary" style="font-size:.85rem;">${esc(e.dica)}</p>` : ''}
                <button type="button" class="stq-modal-btn-save w-100 mt-2" id="rtTrocarImpressoraBtn">
                    <i class="bi bi-printer-fill"></i> Trocar impressora
                </button>
            `);
            el('rtTrocarImpressoraBtn').addEventListener('click', () => {
                fecharModal();
                window._abrirSeletorImpressora(() => window._imprimirReciboTermico(venda));
            });
        }
    };
})();
