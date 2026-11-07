// ================================================================
// reparos/form.js — VortexSmart · Concertos · Nova/Editar OS
// Grava em dois nodes:
//   lojas/{lojaId}/reparos/{id}        — dados gerais (sem senha)
//   reparosSenhas/{lojaId}/{id}        — senha do aparelho (node
//     raiz separado — ver window._reparosSenhaRef). Continua isolado
//     por organização, mas sem regra restritiva: qualquer usuário da
//     loja vê e edita a senha, sem permissão nenhuma envolvida
//     (decisão do Gestor — assistência técnica, todo mundo ali
//     precisa do acesso pra trabalhar).
//
// Expõe via window.*:
//   _renderReparosForm(repairId?)
// Depende de (via window.*):
//   showCustomModal, escapeHtml, _temPermissao, _papelUsuario,
//   _lojaRef, _reparosSenhaRef, _dbGet, _dbPush, _dbUpdate,
//   _reparosRenderPatternGrid, _REPAROS_FLOWS (reparos/lista.js),
//   _comprimirImagem, _uploadFotoStorage, _fmt,
//   _parseBrazilianCurrencyToFloat (core.js),
//   openReparosSection
// ================================================================
(function () {
    'use strict';

    const el  = id => document.getElementById(id);
    const esc = t  => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : t;
    const tp  = chave => typeof window._temPermissao === 'function' ? window._temPermissao(chave) : true;
    const ehGestor = () => window._papelUsuario === 'gestor';

    let mounted = false;
    let editingId = null;
    let clientesCache = null;
    let clienteSelecionado = null; // { id?, nome, telefone }
    let senhaTipo = 'nenhuma';
    let senhaSequencia = [];
    let patternHandle = null;
    let fotosChegada = []; // [{ blob, previewUrl }] — até 4, mínimo 1 pra salvar
    const MAX_FOTOS_CHEGADA = 4;

    // ── Skeleton (montado 1x) ────────────────────────────────────
    function ensureSkeleton() {
        const container = el('reparosForm');
        if (!container || mounted) return;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3 id="repFormTitulo">Nova OS</h3>
                <div style="width:36px;"></div>
            </div>
            <div class="content-card w-100 vs-rep-form-largura">

                <div class="rep-form-group">
                    <label class="form-label"><i class="bi bi-person-fill"></i> Cliente</label>
                    <div class="rep-cliente-wrap">
                        <input class="form-control" id="repFormClienteBusca" type="text" placeholder="Buscar cliente cadastrado..." autocomplete="off"/>
                        <div class="rep-cliente-results" id="repClienteResults" style="display:none;"></div>
                    </div>
                    <div class="rep-cliente-picked" id="repClientePicked" style="display:none;">
                        <i class="bi bi-check-circle-fill"></i> <span id="repClientePickedTxt"></span>
                        <span class="rep-cliente-trocar" id="repClienteTrocar">trocar</span>
                    </div>
                </div>

                <div class="rep-form-group">
                    <label class="form-label"><i class="bi bi-phone-fill"></i> Aparelho</label>
                    <input class="form-control" id="repFormAparelho" type="text" placeholder="Ex: iPhone 12 128GB"/>
                </div>

                <div class="rep-form-group">
                    <label class="form-label"><i class="bi bi-exclamation-circle-fill"></i> Defeito relatado</label>
                    <textarea class="form-control" id="repFormDefeito" rows="3" placeholder="Ex: Tela não acende, caiu na água ontem..."></textarea>
                </div>

                <div class="rep-form-group">
                    <label class="form-label"><i class="bi bi-cash-coin"></i> Valor cobrado (opcional)</label>
                    <input class="form-control" id="repFormValor" type="text" inputmode="decimal" placeholder="Ex: 150,00"/>
                    <p style="font-size:.62rem;color:var(--text-muted);margin-top:4px;">Dá pra deixar em branco e preencher depois — na hora de entregar, o sistema pergunta de novo (às vezes o valor muda com o diagnóstico).</p>
                </div>

                <div class="rep-form-group">
                    <label class="form-label"><i class="bi bi-flag-fill"></i> Prazo de entrega (opcional)</label>
                    <input class="form-control" id="repFormPrazo" type="datetime-local"/>
                </div>

                <div class="rep-form-group">
                    <label class="form-label"><i class="bi bi-camera-fill"></i> Fotos do aparelho (1 a 4, pelo menos 1)</label>
                    <div class="rep-foto-btns">
                        <button type="button" class="rep-foto-btn" id="repFotoBtnCam"><i class="bi bi-camera-fill"></i> Tirar foto</button>
                        <button type="button" class="rep-foto-btn" id="repFotoBtnGal"><i class="bi bi-image-fill"></i> Da galeria</button>
                    </div>
                    <input type="file" accept="image/*" capture="environment" id="repFotoInputCam" class="hidden">
                    <input type="file" accept="image/*" id="repFotoInputGal" class="hidden">
                    <div class="rep-foto-strip" id="repFotoStrip"></div>
                    <div class="rep-fotos-contador incompleto" id="repFotoContador">0/4 fotos (mínimo 1)</div>
                </div>

                <div class="rep-form-group" id="repFormSenhaGroup">
                    <label class="form-label"><i class="bi bi-shield-lock-fill"></i> Senha do aparelho</label>
                    <div class="rep-seg-toggle" id="repSenhaToggle">
                        <button type="button" data-senha="nenhuma" class="active">Nenhuma</button>
                        <button type="button" data-senha="pin">PIN</button>
                        <button type="button" data-senha="senha">Senha</button>
                        <button type="button" data-senha="padrao">Padrão</button>
                    </div>
                    <div id="repSenhaCampoPin" style="display:none;margin-top:10px;">
                        <input class="form-control" id="repFormPin" type="text" inputmode="numeric" maxlength="8" style="-webkit-text-security:disc;letter-spacing:.3em;" placeholder="PIN numérico"/>
                    </div>
                    <div id="repSenhaCampoSenha" style="display:none;margin-top:10px;">
                        <input class="form-control" id="repFormSenhaTexto" type="text" style="-webkit-text-security:disc;" placeholder="Digite a senha do aparelho"/>
                        <p style="font-size:.62rem;color:var(--text-muted);margin-top:4px;">Some enquanto digita (evita autofill do Android) — mas fica visível depois, no card da OS.</p>
                    </div>
                    <div id="repSenhaCampoPadrao" style="display:none;margin-top:12px;text-align:center;">
                        <p style="font-size:.72rem;color:var(--text-secondary);margin-bottom:8px;">Arraste o dedo pelos pontos para desenhar o padrão</p>
                        <div class="rep-pattern-wrap lg" id="repPatternInput"></div>
                        <div class="rep-pattern-info" id="repPatternInfo"></div>
                        <button type="button" class="rep-pattern-clear" id="repPatternClear">Limpar Padrão</button>
                    </div>
                </div>

                <button class="rep-btn-next" id="repFormSalvar" style="width:100%;padding:13px;margin-top:6px;">
                    <i class="bi bi-check-lg"></i> <span id="repFormSalvarTxt">Cadastrar OS</span>
                </button>
            </div>
        `;

        el('repSenhaToggle').querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                el('repSenhaToggle').querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                senhaTipo = btn.dataset.senha;
                atualizarCamposSenha();
            });
        });
        el('repPatternClear').addEventListener('click', () => patternHandle && patternHandle.reset());

        el('repFormClienteBusca').addEventListener('input', onBuscaClienteInput);
        el('repClienteTrocar').addEventListener('click', trocarCliente);
        el('repFotoBtnCam').addEventListener('click', () => el('repFotoInputCam').click());
        el('repFotoBtnGal').addEventListener('click', () => el('repFotoInputGal').click());
        el('repFotoInputCam').addEventListener('change', handleFotoSelect);
        el('repFotoInputGal').addEventListener('change', handleFotoSelect);
        el('repFormSalvar').addEventListener('click', salvar);

        mounted = true;
    }

    // ── Fotos da chegada (1 a 4, mínimo 1 pra salvar) ────────────
    async function handleFotoSelect(e) {
        const file = e.target.files?.[0];
        e.target.value = ''; // permite escolher o mesmo arquivo de novo depois de remover
        if (!file || fotosChegada.length >= MAX_FOTOS_CHEGADA) return;
        const previewUrl = URL.createObjectURL(file);
        const item = { blob: file, previewUrl };
        fotosChegada.push(item);
        renderFotoStrip();
        try {
            item.blob = await window._comprimirImagem(file);
        } catch (err) {
            console.error('Erro ao comprimir foto, usando original sem comprimir:', err);
        }
    }

    function renderFotoStrip() {
        const strip = el('repFotoStrip');
        strip.innerHTML = fotosChegada.map((f, i) => `
            <div class="rep-foto-thumb">
                <img src="${f.url || f.previewUrl}"/>
                <div class="remover" data-remover-foto="${i}"><i class="bi bi-x"></i></div>
            </div>`).join('');
        strip.querySelectorAll('[data-remover-foto]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = parseInt(btn.dataset.removerFoto, 10);
                if (fotosChegada[i].previewUrl && fotosChegada[i].previewUrl.startsWith('blob:')) URL.revokeObjectURL(fotosChegada[i].previewUrl);
                fotosChegada.splice(i, 1);
                renderFotoStrip();
            });
        });
        const n = fotosChegada.length;
        const contador = el('repFotoContador');
        contador.textContent = `${n}/${MAX_FOTOS_CHEGADA} fotos (mínimo 1)`;
        contador.className = 'rep-fotos-contador ' + (n >= 1 ? 'completo' : 'incompleto');
        el('repFotoBtnCam').disabled = n >= MAX_FOTOS_CHEGADA;
        el('repFotoBtnGal').disabled = n >= MAX_FOTOS_CHEGADA;
    }

    function atualizarCamposSenha() {
        el('repSenhaCampoSenha').style.display = senhaTipo === 'senha' ? 'block' : 'none';
        el('repSenhaCampoPin').style.display = senhaTipo === 'pin' ? 'block' : 'none';
        el('repSenhaCampoPadrao').style.display = senhaTipo === 'padrao' ? 'block' : 'none';
        if (senhaTipo === 'padrao' && !patternHandle) {
            patternHandle = window._reparosRenderPatternGrid(el('repPatternInput'), {
                interactive: true,
                sequence: senhaSequencia,
                onChange: seq => { senhaSequencia = seq; },
                onInfo: msg => { const infoEl = el('repPatternInfo'); if (infoEl) infoEl.textContent = msg; }
            });
        }
    }

    // ── Cliente: busca com autopreenchimento ────────────────────
    function carregarClientesSeNecessario() {
        if (clientesCache) return Promise.resolve(clientesCache);
        return window._dbGet(window._lojaRef('clientes')).then(snap => {
            const dados = snap.val() || {};
            clientesCache = Object.keys(dados).map(id => ({ id, ...dados[id] }));
            return clientesCache;
        }).catch(() => { clientesCache = []; return clientesCache; });
    }

    function onBuscaClienteInput() {
        const q = el('repFormClienteBusca').value.trim().toLowerCase();
        const results = el('repClienteResults');
        if (!q) { results.style.display = 'none'; return; }
        carregarClientesSeNecessario().then(lista => {
            const achou = lista.filter(c => (c.nome || '').toLowerCase().includes(q));
            if (!achou.length) {
                results.innerHTML = `<div class="rep-cliente-item" data-novo="1"><b>+ Usar "${esc(el('repFormClienteBusca').value)}" (sem cadastro)</b><span>Nenhum cliente encontrado com esse nome</span></div>`;
            } else {
                results.innerHTML = achou.slice(0, 8).map(c => `<div class="rep-cliente-item" data-id="${c.id}"><b>${esc(c.nome)}</b><span>${esc(c.telefone || 'sem telefone')}</span></div>`).join('');
            }
            results.style.display = 'block';
            results.querySelectorAll('.rep-cliente-item').forEach(item => {
                item.addEventListener('click', () => {
                    if (item.dataset.novo) {
                        selecionarCliente({ nome: el('repFormClienteBusca').value.trim(), telefone: '' });
                    } else {
                        const c = lista.find(x => x.id === item.dataset.id);
                        if (c) selecionarCliente({ id: c.id, nome: c.nome, telefone: c.telefone || '' });
                    }
                });
            });
        });
    }

    function selecionarCliente(c) {
        clienteSelecionado = c;
        el('repClienteResults').style.display = 'none';
        el('repFormClienteBusca').style.display = 'none';
        el('repClientePicked').style.display = 'flex';
        el('repClientePickedTxt').textContent = c.telefone ? `${c.nome} · ${c.telefone}` : c.nome;
    }

    function trocarCliente() {
        clienteSelecionado = null;
        el('repClientePicked').style.display = 'none';
        el('repFormClienteBusca').style.display = 'block';
        el('repFormClienteBusca').value = '';
        el('repFormClienteBusca').focus();
    }

    // ── Reset / carregar pra edição ──────────────────────────────
    function resetForm() {
        editingId = null;
        clienteSelecionado = null;
        senhaTipo = 'nenhuma';
        senhaSequencia = [];
        patternHandle = null;
        fotosChegada.forEach(f => f.previewUrl && f.previewUrl.startsWith('blob:') && URL.revokeObjectURL(f.previewUrl));
        fotosChegada = [];
        el('repFormTitulo').textContent = 'Nova OS';
        el('repFormSalvarTxt').textContent = 'Cadastrar OS';
        el('repFormClienteBusca').style.display = 'block';
        el('repFormClienteBusca').value = '';
        el('repClientePicked').style.display = 'none';
        el('repClienteResults').style.display = 'none';
        el('repFormAparelho').value = '';
        el('repFormDefeito').value = '';
        el('repFormValor').value = '';
        el('repFormPrazo').value = '';
        renderFotoStrip();
        el('repSenhaToggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.senha === 'nenhuma'));
        atualizarCamposSenha();
    }

    function carregarParaEdicao(id) {
        window._dbGet(window._lojaRef('reparos/' + id)).then(snap => {
            const os = snap.val();
            if (!os) {
                if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Essa OS não foi encontrada (pode ter sido apagada).' });
                if (typeof window.openReparosSection === 'function') window.openReparosSection('reparosLista');
                return;
            }
            el('repFormTitulo').textContent = 'Editar OS';
            el('repFormSalvarTxt').textContent = 'Salvar alterações';
            if (os.cliente) selecionarCliente({ id: os.cliente.clienteId || undefined, nome: os.cliente.nome, telefone: os.cliente.telefone || '' });
            el('repFormAparelho').value = os.aparelho || '';
            el('repFormDefeito').value = os.defeito || '';
            if (os.valorCobrado) el('repFormValor').value = window._fmt ? window._fmt(os.valorCobrado).replace('R$', '').trim() : String(os.valorCobrado);
            if (os.prazoTs) {
                const d = new Date(os.prazoTs);
                const pad = n => String(n).padStart(2, '0');
                el('repFormPrazo').value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            }
            if (Array.isArray(os.fotosChegada)) {
                fotosChegada = os.fotosChegada.map(url => ({ url }));
                renderFotoStrip();
            }

            window._dbGet(window._reparosSenhaRef(id)).then(senhaSnap => {
                const senha = senhaSnap.val() || { tipo: 'nenhuma' };
                senhaTipo = senha.tipo || 'nenhuma';
                el('repSenhaToggle').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.senha === senhaTipo));
                if (senhaTipo === 'senha' && el('repFormSenhaTexto')) el('repFormSenhaTexto').value = senha.valor || '';
                if (senhaTipo === 'pin' && el('repFormPin')) el('repFormPin').value = senha.valor || '';
                if (senhaTipo === 'padrao') senhaSequencia = Array.isArray(senha.sequencia) ? senha.sequencia : [];
                // atualizarCamposSenha() já cria o grid (patternHandle
                // ainda é null aqui) usando senhaSequencia, que acabou
                // de ser setada acima — não precisa recriar de novo.
                atualizarCamposSenha();
            }).catch(e => console.error('Erro ao carregar senha do aparelho:', e));
        }).catch(e => {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao carregar OS: ${e.message}` });
        });
    }

    // ── Salvar ────────────────────────────────────────────────────
    function salvar() {
        const aparelho = el('repFormAparelho').value.trim();
        const defeito = el('repFormDefeito').value.trim();
        if (!clienteSelecionado || !clienteSelecionado.nome) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Selecione ou digite o nome do cliente.' }); return; }
        if (!aparelho) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Preencha o aparelho.' }); return; }
        if (!defeito) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Descreva o defeito relatado.' }); return; }
        if (fotosChegada.length < 1) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Adicione pelo menos 1 foto do aparelho.' }); return; }

        const prazoRaw = el('repFormPrazo').value;
        const prazoTs = prazoRaw ? new Date(prazoRaw).getTime() : null;
        const valorRaw = el('repFormValor').value.trim();
        const valorCobrado = valorRaw ? (window._parseBrazilianCurrencyToFloat ? window._parseBrazilianCurrencyToFloat(valorRaw) : parseFloat(valorRaw.replace(',', '.')) || 0) : null;

        const btn = el('repFormSalvar');
        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');

        const payload = {
            cliente: { nome: clienteSelecionado.nome, telefone: clienteSelecionado.telefone || '', clienteId: clienteSelecionado.id || null },
            aparelho,
            defeito,
            prazoTs: prazoTs || null,
            valorCobrado: valorCobrado || null,
        };

        const salvarPrincipal = () => {
            if (editingId) {
                return window._dbUpdate(window._lojaRef('reparos/' + editingId), payload).then(() => editingId);
            }
            const modo = (window._reparosConfig || {}).modo || 'terceirizada';
            const etapas = (window._REPAROS_FLOWS || {})[modo] || [];
            const primeiraEtapa = etapas[0] ? etapas[0].k : 'fila';
            payload.modo = modo;
            payload.status = primeiraEtapa;
            payload.criadoEm = Date.now();
            payload.criadoPorUid = window._firebaseAuthUid || null;
            payload.timeline = { [primeiraEtapa]: { ts: Date.now(), uid: window._firebaseAuthUid || null } };
            return window._dbPush(window._lojaRef('reparos'), payload).then(res => res.key);
        };

        // Fotos já salvas (tinham .url, vieram de uma edição) ficam
        // como estão; só as pendentes (.blob, escolhidas nessa sessão)
        // sobem pro Storage agora — o nome do arquivo usa o próprio id
        // da OS, só disponível depois que salvarPrincipal() resolve.
        const subirFotosPendentes = id => {
            const pendentes = fotosChegada.filter(f => f.blob);
            const primeiraFotoMudouNessaSessao = fotosChegada[0] && fotosChegada[0].blob;

            const uploadFotos = pendentes.length
                ? (() => {
                    let contador = fotosChegada.filter(f => f.url).length;
                    return Promise.all(pendentes.map(f => {
                        contador++;
                        return window._uploadFotoStorage(f.blob, `reparos/${id}/chegada/${contador}.jpg`);
                    })).then(novasUrls => {
                        const urlsExistentes = fotosChegada.filter(f => f.url).map(f => f.url);
                        const todasUrls = [...urlsExistentes, ...novasUrls];
                        return window._dbUpdate(window._lojaRef('reparos/' + id), { fotosChegada: todasUrls });
                    });
                })()
                : Promise.resolve();

            // Miniatura pequena (~120px) só da PRIMEIRA foto — é ela
            // que o card em Concertos → Lista usa como avatar, pra
            // não precisar baixar a foto grande (até 1280px) em cada
            // card renderizado. Gerada a partir do blob JÁ comprimido
            // (barato, só canvas local, sem custo extra de Storage
            // além da própria miniatura). Só roda quando a primeira
            // foto muda nessa sessão — OS antiga sem miniatura
            // continua caindo no ícone de sempre, sem custo nenhum.
            const uploadThumb = primeiraFotoMudouNessaSessao
                ? window._comprimirImagem(fotosChegada[0].blob, 120, 0.55)
                    .then(thumbBlob => window._uploadFotoStorage(thumbBlob, `reparos/${id}/chegada/thumb.jpg`))
                    .then(thumbUrl => window._dbUpdate(window._lojaRef('reparos/' + id), { fotoThumbUrl: thumbUrl }))
                : Promise.resolve();

            return Promise.all([uploadFotos, uploadThumb]).then(() => id);
        };

        salvarPrincipal().then(id => {
            // valor/sequencia sempre nos 3 campos, com null pro que não
            // se aplica ao tipo escolhido — update() com null APAGA o
            // campo (não deixa resíduo de um tipo de senha anterior,
            // tipo "sequencia" de um Padrão que virou PIN).
            const senhaPayload = { tipo: senhaTipo, valor: null, sequencia: null };
            if (senhaTipo === 'senha') senhaPayload.valor = el('repFormSenhaTexto')?.value.trim() || '';
            else if (senhaTipo === 'pin') senhaPayload.valor = el('repFormPin')?.value.trim() || '';
            else if (senhaTipo === 'padrao') senhaPayload.sequencia = senhaSequencia;
            return window._dbUpdate(window._reparosSenhaRef(id), senhaPayload).then(() => {
                // A lista (reparos/lista.js) guarda a senha em memória
                // pra não reler à toa toda vez que o card abre — sem
                // isso aqui, o card continuava mostrando a senha velha
                // depois de editar, mesmo já salva certa no banco.
                window._reparosInvalidarSenhaCache && window._reparosInvalidarSenhaCache(id);
                return id;
            });
        }).then(subirFotosPendentes).then(() => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: editingId ? 'OS atualizada!' : 'OS cadastrada!' });
            if (typeof window.openReparosSection === 'function') window.openReparosSection('reparosLista', null, true);
        }).catch(e => {
            window._setBtnLoading && window._setBtnLoading(btn, false);
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `Erro ao salvar: ${e.message}` });
        });
    }

    // ── Entrada pública ──────────────────────────────────────────
    function renderReparosForm(repairId) {
        ensureSkeleton();
        resetForm();
        editingId = repairId || null;

        // Ver/editar senha: sempre liberado, qualquer usuário da loja
        // (decisão do Gestor: assistência técnica, todo mundo ali
        // precisa do acesso pra trabalhar — sem permissão de propósito).
        el('repFormSenhaGroup').style.display = 'block';

        if (editingId) carregarParaEdicao(editingId);
    }
    window._renderReparosForm = renderReparosForm;
})();
