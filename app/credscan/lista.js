// ================================================================
// credscan/lista.js — VortexSmart · CredScan (lista + nova análise)
//
// Fluxo de "nova análise": tudo que é RÁPIDO e GRÁTIS roda aqui
// (extrair texto do PDF, OCR se for foto/escaneado, filtro local de
// apostas, validador de qualidade do documento). Só depois disso o
// item é criado no banco com status:'enviado' — nesse momento o
// usuário já pode sair da tela, a Cloud Function credscanProcessar
// (functions/index.js) cuida do resto sozinha e notifica quando
// terminar.
//
// Expõe via window.*:
//   _renderCredscanLista
// Depende de (via window.*):
//   _lojaRef, _dbOnValue, _dbPush, _dbUpdate, _comprimirImagem,
//   _uploadFotoStorage, showCustomModal,
//   _csComprimirBase64, _csExtrairTextoPdfDigital, _csPdfParaImagens,
//   _csOcrImagens, _csDetectarApostas, _csValidarQualidadeDocumentos,
//   openCredscanSection (credscan/router.js)
// ================================================================
(function () {
    'use strict';

    const el = id => document.getElementById(id);
    const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);

    const MAX_DOCS_ID = 3;
    const MAX_DOCS_RENDA = 20;

    let mounted = false;
    let itens = [];
    let docsId = [];      // [{file, nome}]
    let docsRenda = [];   // [{file, nome}]
    let enviando = false;

    function ensureSkeleton() {
        const listaEl = el('credscanLista');
        if (listaEl && !mounted) {
            listaEl.innerHTML = `
                <div class="section-header">
                    <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                    <h3>CredScan</h3>
                    <button class="btn-header-action" id="csNovoBtn" aria-label="Nova análise"><i class="bi bi-plus-lg"></i></button>
                </div>
                <div style="width:100%; padding:0 12px 10px;">
                    <div id="csHero" style="background:rgba(var(--overlay-rgb),.05); border-radius:14px; padding:14px; margin-bottom:12px;">
                        <div style="font-size:.6rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); margin-bottom:8px;">Últimos 30 dias</div>
                        <div style="display:flex; align-items:baseline; gap:6px; margin-bottom:8px;">
                            <span id="csHeroTaxa" style="font-size:1.7rem; font-weight:700; color:#4ade80;">—</span>
                            <span style="font-size:.68rem; color:var(--text-secondary);">taxa de aprovação</span>
                        </div>
                        <div style="display:flex; gap:16px;">
                            <div><span id="csHeroQtd" style="font-size:.8rem; font-weight:700;">—</span><span style="font-size:.62rem; color:var(--text-muted);"> análises</span></div>
                            <div><span id="csHeroNota" style="font-size:.8rem; font-weight:700;">—</span><span style="font-size:.62rem; color:var(--text-muted);"> nota média</span></div>
                        </div>
                    </div>
                    <input class="form-control" id="csBusca" type="text" placeholder="Buscar por nome do cliente"/>
                </div>
                <div class="stq-list" id="csItensList"></div>
                <div class="repo-vazio" id="csVazio" style="display:none;"><i class="bi bi-shield-check"></i>Nenhuma análise ainda.</div>

                <div class="stq-modal-backdrop" id="csModalBackdrop">
                    <div class="stq-modal-card">
                        <div class="stq-modal-header">
                            <div class="stq-modal-header-title">Nova análise</div>
                            <button class="stq-modal-close" id="csModalClose" aria-label="Fechar"><i class="bi bi-x-lg"></i></button>
                        </div>
                        <div class="stq-modal-body" id="csModalBody"></div>
                    </div>
                </div>
            `;
            el('csNovoBtn')?.addEventListener('click', abrirModalNovo);
            el('csBusca')?.addEventListener('input', renderLista);
            el('csModalClose')?.addEventListener('click', fecharModal);
            el('csModalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'csModalBackdrop') fecharModal(); });
            mounted = true;
        }
    }

    function iconeStatus(item) {
        if (item.status !== 'concluido') return { icone: 'bi-hourglass-split', cor: '#fbbf24', label: 'Em análise' };
        if (item.resultado && item.resultado.aprov) return { icone: 'bi-check-lg', cor: '#4ade80', label: item.resultado.downgrade ? 'Aprovado (downgrade)' : 'Aprovado' };
        return { icone: 'bi-x-lg', cor: '#f87171', label: 'Reprovado' };
    }

    // Calcula em cima do que já está carregado em memória — sem
    // consulta nova no banco. Só considera análises concluídas (não
    // conta as que ainda estão em processamento) dos últimos 30 dias.
    function renderHero() {
        const trintaDiasAtras = Date.now() - 30 * 86400000;
        const concluidas = itens.filter(it => it.status === 'concluido' && it.criadoEm > trintaDiasAtras && it.resultado);
        if (!concluidas.length) {
            el('csHeroTaxa').textContent = '—';
            el('csHeroQtd').textContent = '0';
            el('csHeroNota').textContent = '—';
            return;
        }
        const aprovadas = concluidas.filter(it => it.resultado.aprov).length;
        const taxa = Math.round((aprovadas / concluidas.length) * 100);
        const notas = concluidas.map(it => it.resultado.nota).filter(n => typeof n === 'number');
        const notaMedia = notas.length ? Math.round(notas.reduce((a, b) => a + b, 0) / notas.length) : null;

        el('csHeroTaxa').textContent = taxa + '%';
        el('csHeroTaxa').style.color = taxa >= 50 ? '#4ade80' : '#f87171';
        el('csHeroQtd').textContent = concluidas.length;
        el('csHeroNota').textContent = notaMedia != null ? notaMedia : '—';
    }

    function renderLista() {
        const listEl = el('csItensList');
        if (!listEl) return;
        const termo = (el('csBusca')?.value || '').trim().toLowerCase();
        let ordenados = itens.slice().sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
        if (termo) ordenados = ordenados.filter(it => (it.clienteNome || '').toLowerCase().includes(termo));
        el('csVazio').style.display = ordenados.length ? 'none' : 'flex';
        el('csVazio').innerHTML = termo
            ? '<i class="bi bi-search"></i>Nenhum cliente com esse nome.'
            : '<i class="bi bi-shield-check"></i>Nenhuma análise ainda.';
        listEl.style.display = ordenados.length ? 'flex' : 'none';

        listEl.innerHTML = ordenados.map(it => {
            const st = iconeStatus(it);
            return `
            <div class="repo-card" data-id="${it.id}" style="cursor:pointer;">
                <div class="repo-card-check" style="width:44px;"><i class="bi ${st.icone}" style="color:${st.cor};font-size:1rem;"></i></div>
                <div class="repo-card-info" style="padding:12px 10px 12px 0;">
                    <div class="repo-card-nome">${esc(it.clienteNome || (it.status === 'concluido' ? 'Cliente' : 'Analisando documento...'))}</div>
                    <div class="repo-card-meta"><span class="repo-badge" style="background:${st.cor}22;color:${st.cor};">${st.label}</span><span class="repo-qtd">${esc(it.produto || '')}</span></div>
                </div>
                <i class="bi bi-chevron-right" style="color:var(--text-muted);font-size:.9rem;align-self:center;margin-right:12px;"></i>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.repo-card').forEach(card => {
            card.addEventListener('click', () => {
                const item = itens.find(i => i.id === card.dataset.id);
                if (!item) return;
                if (item.status !== 'concluido') { modal({ message: 'Essa análise ainda está sendo processada — volta aqui daqui a pouco.' }); return; }
                if (window.openCredscanSection) window.openCredscanSection('credscanDetalhe', { itemId: item.id });
            });
        });
    }

    let listenerAtivo = false;
    function ligarListener() {
        if (listenerAtivo) return;
        listenerAtivo = true;
        window._dbOnValue(window._lojaRef('credscan/itens'), snap => {
            const val = snap.val() || {};
            itens = Object.keys(val).map(id => ({ id, ...val[id] }));
            renderHero();
            renderLista();
        });
    }

    // ── Modal: nova análise ──────────────────────────────────────
    function abrirModalNovo() {
        docsId = []; docsRenda = [];
        el('csModalBody').innerHTML = `
            <label class="form-label">Produto</label>
            <input class="form-control" id="csProduto" type="text" placeholder="Ex: iPhone 13 128GB"/>

            <label class="form-label" style="margin-top:12px;">Valor (R$)</label>
            <input class="form-control" id="csValor" type="number" inputmode="decimal" placeholder="2200"/>

            <label class="form-label" style="margin-top:16px;color:#4ade80;"><i class="bi bi-person-badge-fill"></i> Documento pessoal (RG/CNH) <span style="font-weight:400;color:var(--text-muted);">· opcional</span></label>
            <div class="rep-foto-btns">
                <button type="button" class="rep-foto-btn" id="csDocCam"><i class="bi bi-camera-fill"></i> Câmera</button>
                <button type="button" class="rep-foto-btn" id="csDocGal"><i class="bi bi-image-fill"></i> Galeria</button>
                <button type="button" class="rep-foto-btn" id="csDocPdf"><i class="bi bi-file-earmark-pdf-fill"></i> PDF</button>
            </div>
            <input type="file" accept="image/*" capture="environment" id="csDocInputCam" class="hidden">
            <input type="file" accept="image/*" id="csDocInputGal" class="hidden" multiple>
            <input type="file" accept="application/pdf,.pdf" id="csDocInputPdf" class="hidden" multiple>
            <div id="csDocLista" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>

            <label class="form-label" style="margin-top:16px;"><i class="bi bi-file-earmark-text-fill"></i> Comprovante de renda <span style="font-weight:400;color:var(--text-muted);">· extrato ou holerite</span></label>
            <div class="rep-foto-btns">
                <button type="button" class="rep-foto-btn" id="csRendaCam"><i class="bi bi-camera-fill"></i> Câmera</button>
                <button type="button" class="rep-foto-btn" id="csRendaGal"><i class="bi bi-image-fill"></i> Galeria</button>
                <button type="button" class="rep-foto-btn" id="csRendaPdf"><i class="bi bi-file-earmark-pdf-fill"></i> PDF</button>
            </div>
            <input type="file" accept="image/*" capture="environment" id="csRendaInputCam" class="hidden">
            <input type="file" accept="image/*" id="csRendaInputGal" class="hidden" multiple>
            <input type="file" accept="application/pdf,.pdf" id="csRendaInputPdf" class="hidden" multiple>
            <div id="csRendaLista" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>

            <button type="button" class="rep-btn-next" id="csAnalisarBtn" style="width:100%;padding:13px;margin-top:18px;"><i class="bi bi-cpu-fill"></i> Mandar pra análise</button>
        `;
        el('csDocCam').addEventListener('click', () => el('csDocInputCam').click());
        el('csDocGal').addEventListener('click', () => el('csDocInputGal').click());
        el('csDocPdf').addEventListener('click', () => el('csDocInputPdf').click());
        [['csDocInputCam', docsId], ['csDocInputGal', docsId], ['csDocInputPdf', docsId]].forEach(([id]) => {
            el(id).addEventListener('change', e => handleArquivo(e, docsId, 'csDocLista', MAX_DOCS_ID));
        });
        el('csRendaCam').addEventListener('click', () => el('csRendaInputCam').click());
        el('csRendaGal').addEventListener('click', () => el('csRendaInputGal').click());
        el('csRendaPdf').addEventListener('click', () => el('csRendaInputPdf').click());
        [['csRendaInputCam'], ['csRendaInputGal'], ['csRendaInputPdf']].forEach(([id]) => {
            el(id).addEventListener('change', e => handleArquivo(e, docsRenda, 'csRendaLista', MAX_DOCS_RENDA));
        });
        el('csAnalisarBtn').addEventListener('click', iniciarAnalise);

        el('csModalBackdrop').classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(fecharModal);
    }

    function fecharModal() {
        if (enviando) return; // não deixa fechar no meio do envio
        el('csModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
    }

    function handleArquivo(e, listaDestino, wrapId, max) {
        const arquivos = Array.from(e.target.files || []);
        e.target.value = '';
        if (!arquivos.length) return;
        const espacoLivre = max - listaDestino.length;
        if (espacoLivre <= 0) { modal({ message: `Máximo de ${max} arquivos.` }); return; }
        const aceitos = arquivos.slice(0, espacoLivre);
        aceitos.forEach(file => listaDestino.push({ file, nome: file.name }));
        if (arquivos.length > aceitos.length) modal({ message: `Só cabia mais ${aceitos.length} — o resto ficou de fora (máximo ${max}).` });
        renderListaArquivos(listaDestino, wrapId);
    }

    function renderListaArquivos(lista, wrapId) {
        const wrap = el(wrapId);
        if (!wrap) return;
        wrap.innerHTML = lista.map((d, i) => `
            <div style="display:flex;align-items:center;gap:6px;background:rgba(var(--overlay-rgb),.06);border-radius:8px;padding:6px 10px;font-size:.72rem;">
                <i class="bi ${d.file.type === 'application/pdf' ? 'bi-file-earmark-pdf-fill' : 'bi-image-fill'}"></i>
                <span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.nome)}</span>
                <button type="button" data-rm="${i}" style="border:none;background:none;color:var(--danger);padding:0;margin:0;font-size:.9rem;">×</button>
            </div>
        `).join('');
        wrap.querySelectorAll('[data-rm]').forEach(btn => {
            btn.addEventListener('click', () => { lista.splice(parseInt(btn.dataset.rm, 10), 1); renderListaArquivos(lista, wrapId); });
        });
    }

    // ── Processa um arquivo de renda: extrai texto (digital ou OCR) e
    // prepara a imagem pra Vision quando não for PDF digital ──
    // ── Processa um arquivo do documento pessoal (RG/CNH): se for
    // PDF, converte cada página em imagem primeiro (não dá pra
    // comprimir PDF como se fosse foto — era exatamente esse o bug).
    // Se já for foto, só comprime. ──
    async function processarArquivoDoc(file) {
        const ehPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (ehPdf) {
            const imgs = await window._csPdfParaImagens(file);
            return imgs.map(i => i.blob);
        }
        const blob = await window._comprimirImagem(file, 1280, 0.85);
        return [blob];
    }

    async function processarArquivoRenda(file) {
        const ehPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (ehPdf) {
            const { textos, ehDigital } = await window._csExtrairTextoPdfDigital(file);
            if (ehDigital && textos.length) {
                return { textoDigital: textos.join('\n--- PRÓXIMA PÁGINA ---\n'), textoFiltros: textos.join('\n'), blobs: [] };
            }
            const imgs = await window._csPdfParaImagens(file);
            const ocr = await window._csOcrImagens(imgs.map(i => i.base64));
            return { textoDigital: '', textoFiltros: ocr.join('\n'), blobs: imgs.map(i => i.blob) };
        }
        const blob = await window._comprimirImagem(file, 1280, 0.85);
        const base64 = await blobParaBase64(blob);
        const [ocr] = await window._csOcrImagens([base64]);
        return { textoDigital: '', textoFiltros: ocr || '', blobs: [blob] };
    }

    function blobParaBase64(blob) {
        return new Promise((ok, fail) => {
            const r = new FileReader();
            r.onload = () => ok(r.result.split(',')[1]);
            r.onerror = fail;
            r.readAsDataURL(blob);
        });
    }

    async function iniciarAnalise() {
        if (enviando) return;
        const produto = el('csProduto').value.trim();
        const valor = parseFloat((el('csValor').value || '0').replace(',', '.')) || 0;
        let cpf = '';

        if (!produto || !valor) { modal({ message: 'Preenche produto e valor.' }); return; }
        if (docsRenda.length === 0) { modal({ message: 'Anexa ao menos um comprovante de renda.' }); return; }

        enviando = true;
        const btn = el('csAnalisarBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Lendo documentos...';

        try {
            // ── Processa renda (texto local, zero custo) ──
            const resultadosRenda = [];
            for (const d of docsRenda) resultadosRenda.push(await processarArquivoRenda(d.file));

            const textosDigitais = resultadosRenda.filter(r => r.textoDigital).map(r => r.textoDigital);
            const textoDigitalFinal = textosDigitais.length === resultadosRenda.length ? textosDigitais.join('\n--- PRÓXIMO DOCUMENTO ---\n') : '';
            const textoLocalCompleto = resultadosRenda.map(r => r.textoFiltros).join('\n');

            if (!cpf) {
                const m = textoLocalCompleto.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
                if (m) cpf = m[0].replace(/\D/g, '');
            }

            // ── Já tem análise recente desse CPF? Pergunta antes de
            // continuar — não decide sozinho. Usa a lista que já está
            // carregada em memória (o listener de renderLista já traz
            // tudo), sem precisar de uma consulta nova no banco. ──
            let forcarNovaAnalise = false;
            if (cpf && cpf.length === 11) {
                const candidato = buscarAnaliseRecente(cpf);
                if (candidato) {
                    const escolha = await mostrarModalReaproveitar(candidato);
                    if (escolha === 'reaproveitar') {
                        btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...';
                        const itemRef = window._dbPush(window._lojaRef('credscan/itens'));
                        await window._dbUpdate(itemRef, {
                            clienteNome: null, produto, valor, cpfDetectado: cpf,
                            enviadoPorUid: window._firebaseAuthUid || null, criadoEm: Date.now(),
                            imagensDocCaminhos: [], imagensRendaCaminhos: [], textoDigital: null,
                            apostasPreDetectado: null, forcarIA: false, forcarNovaAnalise: false,
                            status: 'enviado',
                        });
                        fecharModalForcado();
                        modal({ message: 'Reaproveitando a análise recente — já deve aparecer na lista em instantes.' });
                        return;
                    }
                    forcarNovaAnalise = true; // escolheu "nova análise" — pula o reaproveitamento automático lá no servidor
                }
            }

            // ── Filtro local de apostas (grátis) ──
            const apostas = window._csDetectarApostas(textoLocalCompleto);

            // ── Validador de qualidade (grátis) ──
            const qualidade = window._csValidarQualidadeDocumentos([textoLocalCompleto]);
            if (!qualidade.ok) {
                const prosseguir = await mostrarModalQualidade(qualidade.problemas);
                if (!prosseguir) { enviando = false; btn.disabled = false; btn.innerHTML = '<i class="bi bi-cpu-fill"></i> Mandar pra análise'; return; }
            }

            btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...';

            // A regra do banco só permite criar o item com UM write
            // atômico só, já com status:'enviado' — não dá pra criar
            // "rascunho" e completar depois (de propósito: impede o
            // client de deixar um item pela metade ou editar depois
            // de criado). Por isso: push(ref) sem valor só RESERVA o
            // id (gerado no próprio celular, sem gravar nada ainda —
            // documentado assim no SDK do Firebase), sobe as fotos
            // usando esse id reservado, e só no final grava tudo de
            // uma vez com _dbUpdate.
            const itemRef = window._dbPush(window._lojaRef('credscan/itens'));
            const itemId = itemRef.key;

            // ── Upload das imagens (documento pessoal + renda que não
            // era PDF digital) ──
            const lojaId = window._lojaId;
            const imagensDocCaminhos = [];
            let contadorDoc = 0;
            for (const d of docsId) {
                const blobs = await processarArquivoDoc(d.file);
                for (const blob of blobs) {
                    contadorDoc++;
                    await window._uploadFotoStorage(blob, `credscan/${itemId}/doc${contadorDoc}.jpg`);
                    imagensDocCaminhos.push(`lojas/${lojaId}/credscan/${itemId}/doc${contadorDoc}.jpg`);
                }
            }
            const imagensRendaCaminhos = [];
            let contadorRenda = 0;
            for (const r of resultadosRenda) {
                for (const blob of r.blobs) {
                    contadorRenda++;
                    await window._uploadFotoStorage(blob, `credscan/${itemId}/renda${contadorRenda}.jpg`);
                    imagensRendaCaminhos.push(`lojas/${lojaId}/credscan/${itemId}/renda${contadorRenda}.jpg`);
                }
            }

            // ── Grava tudo de uma vez — esse write é o gatilho da
            // Cloud Function credscanProcessar ──
            await window._dbUpdate(itemRef, {
                clienteNome: null, produto, valor,
                cpfDetectado: cpf && cpf.length === 11 ? cpf : null,
                enviadoPorUid: window._firebaseAuthUid || null,
                criadoEm: Date.now(),
                imagensDocCaminhos, imagensRendaCaminhos,
                textoDigital: textoDigitalFinal || null,
                apostasPreDetectado: apostas.gatilho ? apostas : null,
                forcarIA: false,
                forcarNovaAnalise,
                status: 'enviado',
            });

            fecharModalForcado();
            modal({ message: 'Análise enviada! Você já pode sair da tela — avisamos quando ficar pronta.' });
        } catch (e) {
            console.error('Erro ao iniciar análise CredScan:', e);
            modal({ message: `Não deu pra enviar: ${e.message}` });
        } finally {
            enviando = false;
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-cpu-fill"></i> Mandar pra análise';
        }
    }

    function fecharModalForcado() {
        el('csModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
    }

    // Mesma janela de 30 dias e mesmas condições da Cloud Function
    // (ver credscanProcessar em functions/index.js) — só que checando
    // na lista que já está em memória, sem gastar uma leitura nova no
    // banco pra isso.
    function buscarAnaliseRecente(cpf) {
        const trintaDiasAtras = Date.now() - 30 * 86400000;
        return itens
            .filter(it => it.cpfDetectado === cpf && it.status === 'concluido' && it.criadoEm > trintaDiasAtras && it.resultado)
            .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0))[0] || null;
    }

    function mostrarModalReaproveitar(candidato) {
        return new Promise(resolve => {
            const r = candidato.resultado || {};
            const diasAtras = Math.max(0, Math.round((Date.now() - candidato.criadoEm) / 86400000));
            const quandoTxt = diasAtras === 0 ? 'hoje' : diasAtras === 1 ? 'ontem' : `há ${diasAtras} dias`;
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:6000;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = `
                <div style="background:var(--surface-2,#0e1a30);border:1.5px solid rgba(251,146,60,.4);border-radius:16px;max-width:380px;padding:18px;">
                    <div style="font-weight:700;font-size:.95rem;color:#fb923c;margin-bottom:10px;"><i class="bi bi-exclamation-circle-fill"></i> Já existe uma análise recente</div>
                    <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:12px 14px;margin-bottom:14px;">
                        <div style="font-size:.8rem;font-weight:700;">${esc(candidato.clienteNome || 'Cliente')}</div>
                        <div style="font-size:.72rem;color:var(--text-secondary);margin-top:3px;">${r.aprov ? 'Aprovado' : 'Reprovado'} · nota ${r.nota != null ? r.nota : '—'} · feita ${quandoTxt}</div>
                    </div>
                    <div style="font-size:.78rem;color:var(--text-secondary);margin-bottom:14px;">Quer reaproveitar esse resultado (grátis, na hora) ou mandar pra uma análise nova (gasta um token de IA de novo)?</div>
                    <button type="button" id="csReaproveitarBtn" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--acento-hero),var(--acento-hero-2));color:#fff;font-weight:700;font-size:.8rem;">Reaproveitar esse resultado</button>
                    <button type="button" id="csNovaAnaliseBtn" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:transparent;color:var(--text-secondary);font-size:.72rem;margin-top:8px;">Fazer análise nova mesmo assim</button>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#csReaproveitarBtn').addEventListener('click', () => { document.body.removeChild(overlay); resolve('reaproveitar'); });
            overlay.querySelector('#csNovaAnaliseBtn').addEventListener('click', () => { document.body.removeChild(overlay); resolve('nova'); });
        });
    }

    function mostrarModalQualidade(problemas) {
        return new Promise(resolve => {
            const temErro = problemas.some(p => p.nivel === 'erro');
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:6000;display:flex;align-items:center;justify-content:center;padding:16px;';
            overlay.innerHTML = `
                <div style="background:var(--surface-2,#0e1a30);border:1.5px solid ${temErro ? 'rgba(248,113,113,.4)' : 'rgba(251,191,36,.4)'};border-radius:16px;max-width:380px;max-height:85vh;overflow-y:auto;padding:18px;">
                    <div style="font-weight:700;font-size:.95rem;color:${temErro ? '#f87171' : '#fbbf24'};margin-bottom:10px;">${temErro ? '⛔ Documentos insuficientes' : '⚠️ Atenção aos documentos'}</div>
                    ${problemas.map(p => `
                        <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;margin-bottom:8px;">
                            <div style="font-weight:700;font-size:.8rem;color:${p.nivel === 'erro' ? '#f87171' : '#fbbf24'};">${esc(p.titulo)}</div>
                            <div style="font-size:.74rem;color:var(--text-secondary);margin-top:3px;">${esc(p.mensagem)}</div>
                            <div style="font-size:.72rem;color:var(--text-muted);margin-top:5px;">📲 ${esc(p.pedirCliente)}</div>
                        </div>
                    `).join('')}
                    <button type="button" id="csQualFechar" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--acento-hero),var(--acento-hero-2));color:#fff;font-weight:700;font-size:.8rem;margin-top:6px;">Voltar e corrigir</button>
                    ${!temErro ? `<button type="button" id="csQualContinuar" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(251,191,36,.3);background:transparent;color:#fbbf24;font-size:.72rem;margin-top:8px;">Continuar mesmo assim</button>` : ''}
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector('#csQualFechar').addEventListener('click', () => { document.body.removeChild(overlay); resolve(false); });
            overlay.querySelector('#csQualContinuar')?.addEventListener('click', () => { document.body.removeChild(overlay); resolve(true); });
        });
    }

    function renderCredscanLista() {
        ensureSkeleton();
        ligarListener();
        renderLista();
    }
    window._renderCredscanLista = renderCredscanLista;
})();
