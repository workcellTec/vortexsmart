// ================================================================
// reparos/finalizar-entrega.js — VortexSmart · Concertos · Wizard de entrega
// Disparado só quando uma OS avança PRA "Entregue" (via botão Avançar
// ou escolha manual — ver abrirFluxoMudancaEtapa em reparos/lista.js).
// Qualquer outra etapa continua no modal simples de foto de sempre.
//
// REESCRITO — versão simplificada. A anterior gerava um "recibo"
// próprio pra Concertos; essa foi abolida. Agora Concertos usa
// EXATAMENTE o mesmo caminho de documento que Vendas já usa (Bookip),
// só que com um termo de garantia diferente (configurável separado —
// ver configuracoes/config-documentos.js e o toggle no topo do
// Bookip). Nada de gerar documento por conta própria aqui.
//
// Visual: no celular (data-shell="mobile") os passos aparecem na mesma folha de baixo de "Finalizar reparo"
// (window._reparosFolha, exposta por reparos/lista.js) e trocam o conteúdo dentro dela; no computador continua
// a janela central de sempre. Regras, textos e gravações são os mesmos nos dois.
//
// Passo 1 — Foto (opcional)
// Passo 2 — "Deseja criar uma venda de concerto?"
//   Sim → lança a venda (aberta, sem forma de pagamento — mesma
//         trava de transaction contra duplicar, como já era) e
//         NAVEGA direto pro histórico de Vendas, no topo, mostrando
//         essa venda. O botão "Documento" que já existe lá cuida do
//         resto (puxa o termo de Concerto automaticamente, porque a
//         venda ficou marcada com origemReparoId).
//   Não → Passo 3 — "Deseja criar a garantia desse concerto?"
//     Sim → NAVEGA direto pro Bookip, já com os dados da OS
//           preenchidos (cliente + um item de serviço) e o toggle de
//           termo em "Concerto".
//     Não → só finaliza a OS, fecha.
//
// Expõe via window.*:
//   _reparosAbrirWizardEntrega(os)
// Depende de (via window.*):
//   showCustomModal, escapeHtml, _lojaRef, _dbGet, _dbPush, _dbUpdate,
//   _dbTransaction, _fmt, _comprimirImagem, _uploadFotoStorage,
//   _firebaseAuthUid, _nomeUsuario,
//   _vsAbrirModal, _vsFecharModal, _vsLimparModalSemVoltar,
//   _vsTravarScroll, _vsDestravarScroll,
//   _reparosSalvarStatus, _renderReparosLista, _reparosFolha (reparos/lista.js),
//   openVendaSection, showMainSection, openDocumentosSection
// ================================================================
(function () {
    'use strict';

    const el  = id => document.getElementById(id);
    const esc = t  => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : t;

    const MOB = document.documentElement.getAttribute('data-shell') === 'mobile';
    const folha = () => (MOB && window._reparosFolha) || null;   // celular: a folha de baixo; senão, a janela central

    let backdrop = null;
    let _os = null;
    let _fotoBlobPendente = null;

    // ── Skeleton (montado 1x) ────────────────────────────────────
    function ensureBackdrop() {
        if (backdrop) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div class="stq-modal-backdrop" id="repWizardBackdrop">
                <div class="stq-modal-card">
                    <div class="stq-modal-header primary" id="repWizardHeader">
                        <div class="stq-modal-header-title" id="repWizardTitulo">Entregar</div>
                        <button class="stq-modal-close" id="repWizardClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="repWizardConteudo"></div>
                </div>
            </div>`);
        backdrop = el('repWizardBackdrop');
        el('repWizardClose').addEventListener('click', fecharSemConfirmar);
        backdrop.addEventListener('click', e => { if (e.target.id === 'repWizardBackdrop') fecharSemConfirmar(); });
    }

    function abrirModal() {
        backdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(fecharSemConfirmar);
    }
    function fecharSemConfirmar() {
        const F = folha();
        if (F) {
            F.fechar(true);
            if (typeof window._renderReparosLista === 'function') window._renderReparosLista();
            return;
        }
        backdrop?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
        if (typeof window._renderReparosLista === 'function') window._renderReparosLista();
    }
    function fecharLimpo() {
        const F = folha();
        if (F) { F.fecharLimpo(); return; }
        backdrop?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (typeof window._vsLimparModalSemVoltar === 'function') window._vsLimparModalSemVoltar();
    }

    // ── Passo 1 — Foto (opcional) ─────────────────────────────────
    function renderPasso1() {
        const titulo = 'Entregar: ' + (_os.cliente?.nome || 'cliente');
        const F = folha();
        if (F) {
            F.abrir(`
                <div class="vs-folha-titulo">${esc(titulo)}</div>
                <div class="vs-folha-sub">Entregue ao cliente? Tire uma foto com o cliente recebendo o aparelho.</div>
                <div class="rep-prev" id="repWizFotoPreview">${F.ic('cam')}<span>Nenhuma foto ainda</span></div>
                <div class="rep-duo">
                    <button type="button" id="repWizFotoCam">${F.ic('cam')}Câmera</button>
                    <button type="button" id="repWizFotoGal">${F.ic('img')}Galeria</button>
                </div>
                <input type="file" accept="image/*" capture="environment" id="repWizFotoInputCam" class="hidden">
                <input type="file" accept="image/*" id="repWizFotoInputGal" class="hidden">
                <button type="button" class="rep-btn-pri" id="repWizP1Continuar">Continuar</button>
                <button type="button" class="rep-pular" id="repWizP1Pular">Pular sem foto</button>`);
        } else {
            el('repWizardTitulo').textContent = titulo;
            el('repWizardConteudo').innerHTML = `
                <p style="font-size:.78rem;color:var(--text);margin-bottom:12px;">Entregue ao cliente? Tire uma foto com o cliente recebendo o aparelho.</p>
                <div class="rep-foto-modal-preview" id="repWizFotoPreview"><i class="bi bi-camera-fill ic"></i><span class="txt">Nenhuma foto ainda</span></div>
                <div class="rep-foto-btns" style="margin-bottom:10px;">
                    <button type="button" class="rep-foto-btn" id="repWizFotoCam"><i class="bi bi-camera-fill"></i> Câmera</button>
                    <button type="button" class="rep-foto-btn" id="repWizFotoGal"><i class="bi bi-image-fill"></i> Galeria</button>
                </div>
                <input type="file" accept="image/*" capture="environment" id="repWizFotoInputCam" class="hidden">
                <input type="file" accept="image/*" id="repWizFotoInputGal" class="hidden">
                <button type="button" class="rep-btn-next" style="width:100%;" id="repWizP1Continuar">Continuar</button>
                <button type="button" class="rep-foto-modal-pular" id="repWizP1Pular">Pular sem foto</button>
            `;
        }
        function onArquivo(e) {
            const file = e.target.files?.[0];
            if (!file) return;
            _fotoBlobPendente = file;
            const reader = new FileReader();
            reader.onload = ev => { el('repWizFotoPreview').innerHTML = `<img src="${ev.target.result}"/>`; };
            reader.readAsDataURL(file);
        }
        el('repWizFotoInputCam').addEventListener('change', onArquivo);
        el('repWizFotoInputGal').addEventListener('change', onArquivo);
        el('repWizFotoCam').addEventListener('click', () => el('repWizFotoInputCam').click());
        el('repWizFotoGal').addEventListener('click', () => el('repWizFotoInputGal').click());
        el('repWizP1Continuar').addEventListener('click', renderPasso2Venda);
        el('repWizP1Pular').addEventListener('click', () => { _fotoBlobPendente = null; renderPasso2Venda(); });   // "sem foto" não pode mandar a que já foi escolhida
    }

    // ── Passo 2 — Criar venda de concerto? ────────────────────────
    function renderPasso2Venda() {
        if (_os.vendaId) {
            // Já tem venda lançada (de uma tentativa anterior) — não
            // pergunta de novo, só segue.
            const Fj = folha();
            if (Fj) {
                Fj.abrir(`
                    <div class="vs-folha-titulo">Venda de concerto</div>
                    <div class="vs-folha-sub">Essa OS já tem uma venda lançada.</div>
                    <button type="button" class="rep-btn-pri" id="repWizP2Continuar">Continuar</button>`);
            } else {
                el('repWizardConteudo').innerHTML = `
                    <div class="rep-doc-skip-note"><i class="bi bi-check-circle-fill"></i> Essa OS já tem uma venda lançada.</div>
                    <button type="button" class="rep-btn-next" style="width:100%;" id="repWizP2Continuar">Continuar</button>
                `;
            }
            el('repWizP2Continuar').addEventListener('click', () => finalizarComResultado('venda-ja-existia'));
            return;
        }
        const valorFmt = window._fmt(_os.valorCobrado || 0);
        const resumo = `
            <div class="rep-venda-resumo">
                <div class="linha"><span class="item-nome">Serviço de Concerto — ${esc(_os.aparelho || '')}</span></div>
                <div class="linha total"><span>Total</span><span class="item-valor">${valorFmt}</span></div>
            </div>
            <div class="rep-venda-nota"><i class="bi bi-info-circle-fill"></i> Fica em aberto, sem forma de pagamento — você fecha depois no histórico de Vendas (o botão "Documento" de lá já usa o termo de garantia de Concerto sozinho).</div>`;
        const F2 = folha();
        if (F2) {
            F2.abrir(`
                <div class="vs-folha-titulo">Criar venda de concerto?</div>
                <div class="vs-folha-sub">O serviço entra como venda em aberto.</div>
                ${resumo}
                <div class="rep-acts2">
                    <button type="button" class="rep-btn-sec" id="repWizP2Nao">Não</button>
                    <button type="button" class="rep-btn-pri" id="repWizP2Sim">Sim, criar venda</button>
                </div>`);
        } else {
            el('repWizardConteudo').innerHTML = `
                <p style="font-size:.78rem;color:var(--text);margin-bottom:6px;">Deseja criar uma venda de concerto?</p>
                ${resumo}
                <div style="display:flex;gap:8px;margin-top:14px;">
                    <button type="button" class="rep-btn-manual" style="width:auto;flex:1;height:auto;padding:11px;font-size:.72rem;font-weight:700;" id="repWizP2Nao">Não</button>
                    <button type="button" class="rep-btn-next" style="flex:1;" id="repWizP2Sim">Sim, criar venda</button>
                </div>
            `;
        }
        el('repWizP2Nao').addEventListener('click', renderPasso3Garantia);
        el('repWizP2Sim').addEventListener('click', async () => {
            const btn = el('repWizP2Sim');
            const original = btn.innerHTML;
            btn.disabled = true;
            el('repWizP2Nao').disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Lançando...';
            folha()?.travar(true);   // lançando a venda: não deixa fechar a folha por fora
            try {
                const resultado = await lancarVenda(_os, _os.valorCobrado || 0);
                _os.vendaId = resultado.id;
                finalizarComResultado('venda', resultado);
            } catch (e) {
                if (e && e.code === 'JA_LANCADA') {
                    if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Essa OS já teve uma venda lançada (por outra pessoa, ou antes).' });
                    _os.vendaId = _os.vendaId || 'ja-lancada';
                    renderPasso2Venda();
                } else {
                    if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao lançar venda: ${e.message}` });
                    folha()?.travar(false);
                    btn.disabled = false;
                    el('repWizP2Nao').disabled = false;
                    btn.innerHTML = original;
                }
            }
        });
    }

    // Reserva o campo reparos/{id}/vendaId via TRANSACTION antes de
    // criar a venda de verdade — só quem ganhar essa corrida segue
    // adiante. Evita duas vendas duplicadas se dois vendedores
    // confirmarem "Sim" quase ao mesmo tempo.
    function lancarVenda(os, valorCobrado) {
        const novaVendaRef = window._dbPush(window._lojaRef('vendas'));
        const novoVendaId = novaVendaRef.key;

        return window._dbTransaction(window._lojaRef('reparos/' + os.id + '/vendaId'), atual => {
            if (atual) return; // já tem — aborta, não sobrescreve
            return novoVendaId;
        }).then(resultado => {
            if (!resultado.committed || resultado.snapshot.val() !== novoVendaId) {
                throw Object.assign(new Error('Essa OS já teve uma venda lançada.'), { code: 'JA_LANCADA' });
            }
            return window._dbTransaction(window._lojaRef('contadorVendas'), atual => (atual || 0) + 1).then(res2 => {
                if (!res2.committed) throw new Error('Não foi possível gerar o número da venda, tenta de novo.');
                const numeroVenda = res2.snapshot.val();
                const payload = {
                    clienteId: os.cliente?.clienteId || null,
                    clienteNome: os.cliente?.nome || 'Cliente',
                    itens: [{
                        produtoId: null,
                        produtoNome: `Serviço de Concerto — ${os.aparelho || ''}`,
                        quantidade: 1,
                        valorUnitario: valorCobrado,
                        valorTotal: valorCobrado,
                        precoTabela: null,
                        ajusteValor: 0,
                        custoUnitario: null,
                        cor: '',
                        obs: os.defeito || '',
                    }],
                    valorTotal: valorCobrado,
                    status: 'pendente',
                    criadoEm: Date.now(),
                    numeroVenda,
                    criadoPorUid: window._firebaseAuthUid || null,
                    criadoPorNome: window._nomeUsuario || null,
                    origemReparoId: os.id,
                };
                return window._dbUpdate(novaVendaRef, payload).then(() => ({ id: novoVendaId, numeroVenda }));
            });
        });
    }

    // ── Passo 3 — Criar a garantia (Bookip) sem venda? ────────────
    function renderPasso3Garantia() {
        const F3 = folha();
        if (F3) {
            F3.abrir(`
                <div class="vs-folha-titulo">Criar a garantia?</div>
                <div class="vs-folha-sub">Gera o termo de garantia desse concerto, sem lançar venda.</div>
                <div class="rep-acts2">
                    <button type="button" class="rep-btn-sec" id="repWizP3Nao">Não, só entregar</button>
                    <button type="button" class="rep-btn-pri" id="repWizP3Sim">Sim, criar garantia</button>
                </div>`);
        } else {
            el('repWizardConteudo').innerHTML = `
                <p style="font-size:.78rem;color:var(--text);margin-bottom:14px;">Deseja criar a garantia desse concerto (sem lançar venda)?</p>
                <div style="display:flex;gap:8px;">
                    <button type="button" class="rep-btn-manual" style="width:auto;flex:1;height:auto;padding:11px;font-size:.72rem;font-weight:700;" id="repWizP3Nao">Não, só entregar</button>
                    <button type="button" class="rep-btn-next" style="flex:1;" id="repWizP3Sim">Sim, criar garantia</button>
                </div>
            `;
        }
        el('repWizP3Nao').addEventListener('click', () => finalizarComResultado('nenhum'));
        el('repWizP3Sim').addEventListener('click', async () => {
            const btn = el('repWizP3Sim');
            btn.disabled = true;
            el('repWizP3Nao').disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Preparando...';
            try {
                await prepararEIrProBookip(_os);
                finalizarComResultado('garantia-navegando');
            } catch (e) {
                if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro: ${e.message}` });
                renderPasso3Garantia();
            }
        });
    }

    // Monta window._bookipContexto com os dados da OS (cliente + um
    // item de serviço) — busca CPF/endereço no cadastro do cliente
    // vinculado, se tiver (mesmo jeito que a Venda já faz hoje pro
    // documento normal, não inventei um caminho novo).
    async function prepararEIrProBookip(os) {
        let cliente = {};
        if (os.cliente?.clienteId) {
            try {
                const snap = await window._dbGet(window._lojaRef('clientes/' + os.cliente.clienteId));
                cliente = snap.val() || {};
            } catch (e) { /* segue sem os dados extras do cadastro */ }
        }
        window._bookipContexto = {
            nome: os.cliente?.nome || '',
            cpf: cliente.cpf || '',
            tel: os.cliente?.telefone || cliente.telefone || '',
            dataNascimento: cliente.dataNascimento || '',
            email: cliente.email || '',
            end: cliente.endereco || '',
            gerarDireto: false, // usuário revisa/edita no Bookip antes de gerar
            tipoTermo: 'concerto',
            items: [{
                nome: `Concerto — ${os.aparelho || ''}`,
                valor: os.valorCobrado || 0,
                qtd: 1,
                cor: '',
                obs: os.defeito || '',
            }],
        };
    }

    // ── Fecha o ciclo: avança a OS pra "Entregue" de verdade (com a
    //    foto do passo 1, se teve), e só DEPOIS navega/fecha ────────
    function finalizarComResultado(tipo, dados) {
        const Ff = folha();
        if (Ff) Ff.salvando('Finalizando a entrega...');
        else el('repWizardConteudo').innerHTML = `<div style="text-align:center;padding:30px 0;"><span class="spinner-border"></span></div>`;
        const prosseguir = () => {
            fecharLimpo();
            if (tipo === 'venda' && typeof window.openVendaSection === 'function') {
                window.openVendaSection('historicoVendas', null, true);
            } else if (tipo === 'garantia-navegando') {
                if (typeof window.showMainSection === 'function') window.showMainSection('documentos');
                if (typeof window.openDocumentosSection === 'function') window.openDocumentosSection('documentosGarantia');
            } else {
                if (typeof window._renderReparosLista === 'function') window._renderReparosLista();
            }
        };
        if (typeof window._reparosSalvarStatus === 'function') {
            window._reparosSalvarStatus(_os, 'entregue', _fotoBlobPendente).then(prosseguir).catch(e => {
                if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao finalizar: ${e.message}` });
                fecharSemConfirmar();
            });
        } else {
            prosseguir();
        }
    }

    // ── Entrada pública ──────────────────────────────────────────
    function abrirWizardEntrega(os) {
        _os = os;
        _fotoBlobPendente = null;
        if (folha()) { renderPasso1(); return; }   // celular: a folha cuida de abrir, travar a rolagem e do voltar do Android
        ensureBackdrop();
        renderPasso1();
        abrirModal();
    }
    window._reparosAbrirWizardEntrega = abrirWizardEntrega;
})();
