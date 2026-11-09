// ================================================================
// configuracoes/config-documentos.js — VortexSmart · Config → Documentos
// Registra: window._initConfigDocumentos()
// Guarda no Firebase (configuracoes/documentos): dados da loja,
// logo, assinatura e termos que os módulos de documentos
// (ex: bookip.js) leem na hora de gerar.
//
// A tela tem 3 abas (Loja · Garantia · Contrato) e UM Salvar só, que grava
// tudo de uma vez em configuracoes/documentos (ver saveConfig pra lista dos campos).
// ================================================================
(function () {
    'use strict';

    const modal  = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const el     = id   => document.getElementById(id);
    // dbref(caminho) agora monta a referência DENTRO da loja logada.
    const dbref = (caminho) => window._lojaRef(caminho);
    const CFG_PATH = 'configuracoes/documentos';

    const CD = { initialized: false, logoBlob: null, logoMini: null, assinaturaBlob: null, preparando: null, aba: 'loja' };
    const ABAS = [['loja', 'Loja'], ['garantia', 'Garantia'], ['contrato', 'Contrato']];
    const ehPc = () => document.documentElement.getAttribute('data-shell') === 'pc';

    // Alterações ainda não salvas, por aba (bolinha amarela na aba + aviso ao sair).
    const sujo = { loja: false, garantia: false, contrato: false };
    const estaSujo = () => ABAS.some(([id]) => sujo[id]);

    window._initConfigDocumentos = function () {
        if (!CD.initialized) {
            renderShell();
            attachListeners();
            CD.initialized = true;
        }
        ajustarBarra();
        loadFromFirebase();
    };

    // Tags que o modelo de contrato aceita. Uma lista só: alimenta a folha (celular) e o painel (PC).
    const TAGS = [
        ['{{texto:nome_cliente:Nome Completo}}', 'campo de texto'],
        ['{{numero:cpf:CPF/CNPJ}}', 'número/documento'],
        ['{{moeda:valor_parcela:Valor da Parcela}}', 'valor em R$'],
        ['{{data:data_pagamento:Data de Pagamento}}', 'data'],
        ['{{calc:total:valor_parcela*qtd_parcelas}}', 'calculado automaticamente'],
        ['{{hoje:data_assinatura:Data de Assinatura}}', 'preenche sozinho com a data de hoje'],
        ['{{diadata:dia_vencimento:data_inicio_pagamento}}', 'pega o dia de outro campo <b>data</b>'],
        ['{{escolha:estado:Estado|Novo|Seminovo}}', 'interruptor com opções, em vez de texto livre'],
    ];
    const tagsHtml = comInserir => `
        <div class="cd-tags">${TAGS.map(([tag, desc]) => `
            <div class="cd-tag"><div class="cd-tag-txt"><code>${tag}</code><div>${desc}</div></div>${comInserir ? `<button type="button" class="cd-tag-ins" data-cd-inserir="${tag.replace(/"/g, '&quot;')}">Inserir</button>` : ''}</div>`).join('')}
        </div>
        <p class="text-secondary small mt-2 mb-0">Dica: repetir o mesmo <code>id</code> em dois pontos do contrato (ex: prazo em meses e qtd. de parcelas) mantém os dois sempre iguais, com um único campo.</p>`;
    const iaHtml = `
        <p class="text-secondary small mb-2">Copie o prompt abaixo, cole numa IA (ChatGPT, Claude, etc.) junto com o texto do seu contrato original, e cole a resposta dela no campo do modelo.</p>
        <textarea class="form-control mb-2" id="cdIaPrompt" rows="11" readonly style="font-size:.72rem;line-height:1.5;"></textarea>
        <button class="btn btn-info w-100" id="cdIaCopiar" type="button"><i class="bi bi-clipboard"></i> Copiar Prompt</button>`;

    // Interruptor (no lugar da caixinha): o <input> continua sendo um checkbox, só muda o visual.
    const interruptor = (id, titulo, desc) => `
        <label class="cd-sw" for="${id}"><span class="cd-sw-t">${titulo}<small>${desc}</small></span><input class="form-check-input" type="checkbox" id="${id}"></label>`;

    function renderShell() {
        const wrap = el('configuracoesDocumentos');
        if (!wrap) return;
        const pc = ehPc();
        wrap.innerHTML = `
            <div class="section-header">
                <h3>Documentos</h3>
                <button class="btn-back" id="cdBack" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
            </div>
            <div class="cd-corpo">
                <div class="cd-seg" id="cdSeg" role="tablist">
                    ${ABAS.map(([id, nome]) => `<button type="button" role="tab" data-cd-aba="${id}" aria-selected="false">${nome}<i class="cd-dot"></i></button>`).join('')}
                </div>

                <section class="cd-pane cd-pane-loja" data-cd-pane="loja" role="tabpanel">
                    <div class="content-card cd-card">
                        <h5><i class="bi bi-shop"></i> Identidade da Loja</h5>
                        <div class="d-flex align-items-center gap-3 mb-3">
                            <div id="cdLogoPreviewWrap" style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.05);border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                                <img id="cdLogoPreview" decoding="async" style="display:none;width:100%;height:100%;object-fit:cover;">
                                <i class="bi bi-image text-secondary" id="cdLogoIconPlaceholder" style="font-size:1.4rem;"></i>
                            </div>
                            <button class="btn btn-secondary" id="cdLogoBtn" type="button" style="flex:1;">
                                <i class="bi bi-upload"></i> Escolher Logo
                            </button>
                            <input type="file" accept="image/*" id="cdLogoInput" class="hidden">
                        </div>
                        <div class="mb-3"><label class="form-label">Nome da Loja</label><input class="form-control" id="cdNome" placeholder="Nome da sua loja"></div>

                        <div class="mb-3">
                            <label class="form-label">Tamanho da Logo no documento</label>
                            <div class="d-flex align-items-center gap-3">
                                <input type="range" id="cdLogoSize" min="40" max="140" step="2" value="76" style="flex:1;accent-color:var(--primary);">
                                <span class="text-secondary small" id="cdLogoSizeLabel" style="min-width:44px;">76px</span>
                            </div>
                        </div>

                        <div class="mb-3">
                            <label class="form-label">Cor primária da minha empresa</label>
                            <div class="d-flex align-items-center gap-3">
                                <input type="color" id="cdCorBarra" value="#16a34a" style="width:52px;height:38px;border-radius:10px;border:1.5px solid var(--border);background:none;padding:2px;cursor:pointer;">
                                <span class="text-secondary small">Usada no cabeçalho dos documentos e nas imagens geradas pela calculadora e pelo orçamento</span>
                            </div>
                        </div>

                        <div class="mb-1"><label class="form-label"><i class="bi bi-pen"></i> Assinatura</label></div>
                        <div class="d-flex align-items-center gap-3">
                            <div id="cdAssinaturaPreviewWrap" style="width:120px;height:60px;border-radius:10px;background:rgba(255,255,255,.05);border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                                <img id="cdAssinaturaPreview" decoding="async" style="display:none;width:100%;height:100%;object-fit:contain;">
                                <i class="bi bi-pen text-secondary" id="cdAssinaturaIconPlaceholder" style="font-size:1.2rem;"></i>
                            </div>
                            <button class="btn btn-secondary" id="cdAssinaturaBtn" type="button" style="flex:1;">
                                <i class="bi bi-upload"></i> Escolher Assinatura
                            </button>
                            <input type="file" accept="image/*" id="cdAssinaturaInput" class="hidden">
                        </div>
                        <p class="text-secondary small mt-2 mb-0">Aparece no final do documento de garantia, no lugar da linha em branco.</p>
                    </div>

                    <div class="content-card cd-card">
                        <h5><i class="bi bi-telephone-fill"></i> Dados de Contato</h5>
                        <div class="cd-contato">
                            <div class="cd-f-email"><label class="form-label">Email</label><input class="form-control" id="cdEmail" type="email" placeholder="contato@sualoja.com"></div>
                            <div class="cd-f-cnpj"><label class="form-label">CNPJ</label><input class="form-control" id="cdCnpj" placeholder="00.000.000/0000-00"></div>
                            <div class="cd-f-end"><label class="form-label">Endereço</label><input class="form-control" id="cdEndereco" placeholder="Rua, número, bairro, cidade/UF"></div>
                            <div class="cd-f-local"><label class="form-label">Local (Cidade/UF)</label><input class="form-control" id="cdCidadeUf" placeholder="Ex: Goiânia - GO"><p class="text-secondary small mt-1 mb-0">Usado na linha de local e data automática dos documentos.</p></div>
                            <div class="cd-f-tel"><label class="form-label">Telefone(s)</label><input class="form-control" id="cdTelefone" placeholder="(62) 99999-9999 / (62) 98888-8888"></div>
                        </div>
                    </div>
                </section>

                <section class="cd-pane cd-pane-garantia" data-cd-pane="garantia" role="tabpanel" hidden>
                    <div class="content-card cd-card">
                        <h5><i class="bi bi-file-earmark-text"></i> Nome do Documento</h5>
                        <input class="form-control" id="cdNomeDocumento" placeholder="Ex: Termo de compra e garantia">
                        <p class="text-secondary small mt-2 mb-0">Usado no nome do arquivo e no assunto ao compartilhar. Ex: "Termo de compra e garantia de João Silva.pdf"</p>
                    </div>
                    <div class="content-card cd-card">
                        <h5><i class="bi bi-chat-left-text"></i> Mensagem Padrão</h5>
                        <textarea class="form-control" id="cdMensagemPadrao" rows="4" placeholder="Ex: Segue em anexo o comprovante da sua compra e garantia. Qualquer dúvida, estamos à disposição!" style="font-size:.82rem;"></textarea>
                        <p class="text-secondary small mt-2 mb-0">Usada ao compartilhar a garantia. O sistema adiciona "Olá [Nome do Cliente]," automaticamente antes deste texto.</p>
                    </div>
                    <div class="content-card cd-card cd-card-termos">
                        <h5><i class="bi bi-shield-check"></i> Termos de Garantia — Venda</h5>
                        <textarea class="form-control" id="cdTermos" rows="10" style="font-size:.78rem;line-height:1.5;" placeholder="Escreva aqui os termos de garantia da sua loja..."></textarea>
                        <p class="text-secondary small mt-2 mb-0">Aparece no documento de garantia de uma <b>venda</b>. Use <b>**texto**</b> para deixar algo em negrito.</p>
                    </div>
                    <div class="content-card cd-card cd-card-termos">
                        <h5><i class="bi bi-tools"></i> Termos de Garantia — Concerto</h5>
                        <textarea class="form-control" id="cdTermosConcerto" rows="10" style="font-size:.78rem;line-height:1.5;" placeholder="Escreva aqui os termos de garantia dos consertos da sua loja (pode ser diferente do de venda)..."></textarea>
                        <p class="text-secondary small mt-2 mb-0">Aparece no documento gerado a partir de um <b>reparo</b> (aba Concertos). Se deixar em branco, usa o termo de venda no lugar.</p>
                    </div>
                </section>

                <section class="cd-pane cd-pane-contrato" data-cd-pane="contrato" role="tabpanel" hidden>
                    <div class="cd-contrato">
                        <div class="cd-col-modelo">
                            ${pc ? '' : `
                            <div class="content-card cd-card">
                                <h5><i class="bi bi-stars"></i> Já tem um contrato pronto?</h5>
                                <p class="text-secondary small mb-2">Cole o contrato da loja no campo do modelo, com tags <b>{{tipo:id:rótulo}}</b> nos pontos que o cliente vai preencher — o sistema cria os campos na tela de Contrato.</p>
                                <div class="d-flex gap-2">
                                    <button class="btn btn-sm btn-secondary" id="cdIaToggle" type="button" style="flex:1;">Ver prompt pra IA</button>
                                    <button class="btn btn-sm btn-secondary" id="cdTagsToggle" type="button" style="flex:1;">Como usar as tags</button>
                                </div>
                            </div>`}
                            <div class="content-card cd-card">
                                <h5><i class="bi bi-file-earmark-text"></i> Modelo de Contrato</h5>
                                <div class="mb-3"><label class="form-label">Título do Contrato</label><input class="form-control" id="cdContratoTitulo" placeholder="Ex: CONTRATO DE PRESTAÇÃO DE SERVIÇO"><p class="text-secondary small mt-1 mb-0">Aparece em destaque, maior e em negrito, no topo do documento gerado.</p></div>
                                <textarea class="form-control" id="cdContratoTemplate" rows="${pc ? 22 : 14}" placeholder="CONTRATANTE: {{texto:nome_cliente:Nome Completo}}, inscrito(a) no CPF/CNPJ sob nº {{numero:cpf:CPF/CNPJ}}...

Valor da parcela: {{moeda:valor_parcela:Valor da Parcela}} x {{numero:qtd_parcelas:Qtd. Parcelas}} = {{calc:total:valor_parcela*qtd_parcelas}}" style="font-size:.78rem;line-height:1.6;"></textarea>
                                <p class="text-secondary small mt-2 mb-0">O mesmo id não pode se repetir com tipos diferentes. Use <b>**texto**</b> para negrito.</p>
                            </div>
                            <div class="content-card cd-card">
                                <h5><i class="bi bi-pen"></i> Assinaturas do contrato</h5>
                                ${interruptor('cdContratoDataAutomatica', 'Local e data automáticos', 'Antes da(s) assinatura(s). Usa a data de hoje e o "Local (Cidade/UF)" da aba Loja.')}
                                ${interruptor('cdContratoAssinaturaLocador', 'Assinatura da Locadora', 'Linha para a sua loja assinar.')}
                                ${interruptor('cdContratoAssinatura', 'Assinatura do Locatário', 'Linha para o cliente assinar.')}
                            </div>
                        </div>
                        ${pc ? `
                        <div class="cd-col-tags">
                            <div class="content-card cd-card">
                                <h5><i class="bi bi-stars"></i> Tags do contrato</h5>
                                <p class="text-secondary small mb-2">Use <b>{{tipo:id:rótulo}}</b> nos pontos que o cliente vai preencher. Passe o mouse numa tag e clique em Inserir para colocá-la no modelo.</p>
                                ${tagsHtml(true)}
                                <button class="btn btn-sm btn-secondary w-100 mt-3" id="cdIaToggle" type="button">Já tem um contrato? Ver prompt pra IA</button>
                                <div id="cdIaBox" class="mt-3" style="display:none;">${iaHtml}</div>
                            </div>
                        </div>` : ''}
                    </div>
                </section>
            </div>

            <div class="cd-savebar">
                <span class="cd-status" id="cdStatus" aria-live="polite"></span>
                <button class="btn btn-primary" id="cdSave">
                    <i class="bi bi-check-circle-fill"></i> Salvar Configurações
                </button>
            </div>
        `;
        mostrarAba(CD.aba);
        ajustarBarra();
    }

    // ── Abas ───────────────────────────────────────────────────────
    function mostrarAba(id) {
        if (!ABAS.some(([a]) => a === id)) id = 'loja';
        CD.aba = id;
        document.querySelectorAll('#cdSeg [data-cd-aba]').forEach(b => {
            const on = b.dataset.cdAba === id;
            b.classList.toggle('on', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('#configuracoesDocumentos [data-cd-pane]').forEach(p => { p.hidden = p.dataset.cdPane !== id; });
    }

    // Bolinha amarela na aba com alteração + aviso em cima do Salvar.
    function marcarSujo(aba) {
        if (!aba || sujo[aba]) return;
        sujo[aba] = true;
        atualizarIndicadores();
    }
    function limparSujo() {
        ABAS.forEach(([id]) => { sujo[id] = false; });
        atualizarIndicadores();
    }
    function atualizarIndicadores() {
        document.querySelectorAll('#cdSeg [data-cd-aba]').forEach(b => b.classList.toggle('sujo', !!sujo[b.dataset.cdAba]));
        const st = el('cdStatus');
        if (st) st.textContent = estaSujo() ? 'Alterações não salvas' : '';
    }
    function aoEditar(e) {
        const pane = e.target.closest && e.target.closest('[data-cd-pane]');
        if (pane) marcarSujo(pane.dataset.cdPane);
    }

    // No celular a barra Salvar fica logo acima da barra de navegação; mede a altura dela.
    function ajustarBarra() {
        const wrap = el('configuracoesDocumentos');
        const nav = document.getElementById('ctwBottomNav');
        const h = nav && nav.offsetHeight ? nav.offsetHeight : 0;
        if (wrap) wrap.style.setProperty('--cd-nav-h', h + 'px');
    }

    // Folha de baixo (celular): "Como usar as tags" e "Prompt pra IA".
    function abrirFolha(tipo) {
        let f = el('cdFolha');
        if (!f) {
            f = document.createElement('div');
            f.id = 'cdFolha';
            f.className = 'vs-folha-overlay';
            f.innerHTML = `
                <div class="vs-folha" role="dialog">
                    <div class="vs-folha-alca"></div>
                    <div class="vs-folha-titulo" id="cdFolhaTitulo"></div>
                    <div class="cd-folha-corpo" id="cdFolhaCorpo"></div>
                </div>`;
            document.body.appendChild(f);
            f.addEventListener('click', e => {
                if (e.target === f) fecharFolha();
                else if (e.target.closest('#cdIaCopiar')) copiarPromptIA();
            });
        }
        el('cdFolhaTitulo').textContent = tipo === 'ia' ? 'Prompt pra IA' : 'Como usar as tags';
        el('cdFolhaCorpo').innerHTML = tipo === 'ia' ? iaHtml : tagsHtml(false);
        if (tipo === 'ia' && el('cdIaPrompt')) el('cdIaPrompt').value = IA_PROMPT;
        void f.offsetWidth;
        f.classList.add('active');
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(fecharFolha);
    }
    function fecharFolha() {
        const f = el('cdFolha');
        if (f && f.classList.contains('active')) {
            f.classList.remove('active');
            if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
        }
    }

    // Insere a tag clicada (PC) no ponto do cursor do modelo de contrato.
    function inserirTag(tag) {
        const t = el('cdContratoTemplate');
        if (!t) return;
        const ini = t.selectionStart ?? t.value.length, fim = t.selectionEnd ?? ini;
        t.value = t.value.slice(0, ini) + tag + t.value.slice(fim);
        t.focus();
        t.selectionStart = t.selectionEnd = ini + tag.length;
        marcarSujo('contrato');
    }

    // Ao tocar em "voltar" com alterações pendentes: pergunta antes de descartar. O core.js chama isto
    // no "voltar" (botão ← e gesto do Android); true = segurei a saída.
    window._vsGuardaSaida = function () {
        const wrap = el('configuracoesDocumentos');
        if (!estaSujo() || !wrap || !wrap.getClientRects().length) return false;
        modal({
            message: 'Você tem alterações não salvas em Documentos. Sair e descartar?',
            confirmText: 'Descartar',
            cancelText: 'Continuar editando',
            onConfirm: () => { descartarAlteracoes(); history.back(); },
            onCancel: () => {},
        });
        return true;
    };
    function descartarAlteracoes() {
        CD.logoBlob = null; CD.logoMini = null; CD.assinaturaBlob = null;
        ['cdLogoInput', 'cdAssinaturaInput'].forEach(id => { if (el(id)) el(id).value = ''; });
        limparSujo();
        if (dadosCache) preencherForm(dadosCache);
    }

    function attachListeners() {
        const wrap = el('configuracoesDocumentos');
        wrap?.addEventListener('input', aoEditar);
        wrap?.addEventListener('change', aoEditar);
        wrap?.addEventListener('click', e => {
            const aba = e.target.closest('[data-cd-aba]');
            if (aba) { mostrarAba(aba.dataset.cdAba); window.scrollTo(0, 0); return; }
            const ins = e.target.closest('[data-cd-inserir]');
            if (ins) { inserirTag(ins.dataset.cdInserir); return; }
            if (e.target.closest('#cdIaCopiar')) copiarPromptIA();
        });
        window.addEventListener('resize', ajustarBarra);
        el('cdLogoBtn')?.addEventListener('click', () => el('cdLogoInput')?.click());
        el('cdLogoInput')?.addEventListener('change', handleLogoSelect);
        el('cdAssinaturaBtn')?.addEventListener('click', () => el('cdAssinaturaInput')?.click());
        el('cdAssinaturaInput')?.addEventListener('change', handleAssinaturaSelect);
        el('cdLogoSize')?.addEventListener('input', () => {
            const lbl = el('cdLogoSizeLabel');
            if (lbl) lbl.textContent = el('cdLogoSize').value + 'px';
        });
        el('cdSave')?.addEventListener('click', saveConfig);
        el('cdTagsToggle')?.addEventListener('click', () => abrirFolha('tags'));
        el('cdIaToggle')?.addEventListener('click', () => {
            if (!ehPc()) { abrirFolha('ia'); return; }
            const box = el('cdIaBox');
            if (!box) return;
            const abrindo = box.style.display === 'none';
            box.style.display = abrindo ? 'block' : 'none';
            if (abrindo && el('cdIaPrompt')) el('cdIaPrompt').value = IA_PROMPT;
        });
    }

    // ── Prompt pronto pra usar em qualquer IA externa (ChatGPT, Claude...) ──
    // O usuário copia isso, cola numa IA junto do contrato dele, e cola a
    // resposta de volta no campo do modelo. Nenhuma chamada de API aqui.
    const IA_PROMPT = `Você vai transformar um contrato em um modelo dinâmico para um sistema de gestão. Regras:
- Identifique cada trecho que deve ser preenchido pelo cliente (nome, CPF/CNPJ, endereço, valores, datas, quantidades etc.) e substitua por uma tag no formato {{tipo:id:Rótulo}}.
- Tipos disponíveis: texto, numero, moeda, data, calc, hoje, diadata, escolha.
- Para campos calculados (ex: total = valor x quantidade), use {{calc:id:formula}}, referenciando os ids de campos moeda/numero na fórmula (ex: valor_parcela*qtd_parcelas).
- Para uma data que deve ser sempre a data atual (ex: data de assinatura), use {{hoje:id:Rótulo}} — não pede preenchimento.
- Para um dia do mês que deve ser igual ao dia de outro campo data (ex: vencimento = dia do início do pagamento), use {{diadata:id:id_do_campo_data}} — não pede preenchimento.
- Para um campo de múltipla escolha em vez de texto livre (ex: Novo ou Seminovo), use {{escolha:id:Rótulo|Opção1|Opção2}}.
- Se dois pontos do contrato representam o mesmo valor (ex: prazo em meses e quantidade de parcelas), use o mesmo id nas duas tags em vez de criar dois campos.
- Ids em snake_case, sem espaços ou acentos, sem repetir o mesmo id com tipos diferentes.
- Não altere o restante do texto do contrato, apenas substitua os pontos preenchíveis pelas tags.
- Responda APENAS com o texto final do contrato já com as tags, sem nenhuma explicação antes ou depois.

Segue o meu contrato original abaixo. Gere a versão com as tags:

[COLE SEU CONTRATO ORIGINAL AQUI]`;

    async function copiarPromptIA() {
        try {
            await navigator.clipboard.writeText(IA_PROMPT);
            modal({ message: 'Prompt copiado! Cole numa IA junto com o texto do seu contrato, e depois cole a resposta no campo do modelo.' });
        } catch (e) {
            const area = el('cdIaPrompt');
            if (area) { area.focus(); area.select(); }
            modal({ message: 'Não consegui copiar automaticamente — selecionei o texto pra você copiar manualmente (Ctrl+C).' });
        }
    }

    // A câmera do celular entrega fotos de vários MB: sem reduzir, a pré-visualização, o envio e o PDF ficavam
    // pesados. A logo vira no máximo 512 px (e ganha uma miniatura de 128 px, que a Início e esta tela mostram
    // na hora); a assinatura, 800 px. PNG/WebP/GIF continuam PNG (mantém a transparência); o resto vira JPEG.
    async function abrirImagem(file) {
        try { return await createImageBitmap(file); } catch (e) { /* cai pro <img> */ }
        const url = URL.createObjectURL(file);
        try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
    }
    async function reduzirImagem(file, ladoMax, ladoMini) {
        const img = await abrirImagem(file);
        const largura = img.naturalWidth || img.width, altura = img.naturalHeight || img.height;
        const png = /^image\/(png|webp|gif)$/.test(file.type);
        const tipo = png ? 'image/png' : 'image/jpeg';
        const desenhar = lado => {
            const esc = Math.min(1, lado / Math.max(largura, altura));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(largura * esc)); c.height = Math.max(1, Math.round(altura * esc));
            const ctx = c.getContext('2d');
            if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
            ctx.drawImage(img, 0, 0, c.width, c.height);
            return c;
        };
        try {
            let blob = null;
            if (ladoMax) {
                blob = await new Promise((ok, falha) => desenhar(ladoMax).toBlob(b => b ? ok(b) : falha(new Error('imagem')), tipo, 0.85));
                if (blob.size >= file.size && (file.type === 'image/png' || file.type === 'image/jpeg')) blob = file; // já era pequena
            }
            return { blob, mini: ladoMini ? desenhar(ladoMini).toDataURL(tipo, 0.8) : null };
        } finally { if (img.close) img.close(); }
    }

    // Escolheu um arquivo: reduz, guarda pra enviar no "Salvar" e mostra na pré-visualização. Nunca rejeita:
    // se o aparelho não conseguir reduzir, segue com o arquivo original.
    async function escolherImagem(file, { campo, ladoMax, ladoMini, previewId, iconeId }) {
        let blob = file, mini = null;
        try { ({ blob, mini } = await reduzirImagem(file, ladoMax, ladoMini)); } catch (e) { console.error('Reduzir imagem:', e); }
        CD[campo] = blob;
        if (campo === 'logoBlob') CD.logoMini = mini;
        const preview = el(previewId), icone = el(iconeId);
        if (preview) {
            if (preview.dataset.obj) URL.revokeObjectURL(preview.dataset.obj);
            preview.dataset.obj = URL.createObjectURL(blob);
            preview.src = preview.dataset.obj;
            preview.style.display = 'block';
        }
        if (icone) icone.style.display = 'none';
    }
    function handleLogoSelect(e) {
        const file = e.target.files?.[0];
        if (file) CD.preparando = escolherImagem(file, { campo: 'logoBlob', ladoMax: 512, ladoMini: 128, previewId: 'cdLogoPreview', iconeId: 'cdLogoIconPlaceholder' });
    }
    function handleAssinaturaSelect(e) {
        const file = e.target.files?.[0];
        if (file) CD.preparando = escolherImagem(file, { campo: 'assinaturaBlob', ladoMax: 800, ladoMini: 0, previewId: 'cdAssinaturaPreview', iconeId: 'cdAssinaturaIconPlaceholder' });
    }

    // Logo enviada antes da miniatura existir: tenta gerar a miniatura uma vez (precisa de CORS no Storage;
    // sem ele, ou sem rede, segue mostrando a URL direta — reenviar a logo resolve de vez).
    let miniTentadaPara = null;
    async function migrarMiniLogo(url) {
        if (miniTentadaPara === url) return;
        miniTentadaPara = url;
        try {
            const { mini } = await reduzirImagem(await (await fetch(url)).blob(), 0, 128);
            if (!mini) return;
            await window._dbUpdate(dbref(CFG_PATH), { storeLogoMini: mini });
            dadosCache = { ...dadosCache, storeLogoMini: mini };
            if (typeof window._vsLogoLojaAtualizar === 'function') window._vsLogoLojaAtualizar(dadosCache);
        } catch (e) { /* segue com a URL direta */ }
    }

    // Envia pra "pastinha" da PRÓPRIA loja no Firebase Storage
    // (lojas/{lojaId}/caminho) — isolada de outras lojas pela regra
    // de segurança (storage.rules). Nome fixo (logo.jpg/assinatura.jpg)
    // de propósito — subir de novo SOBRESCREVE a anterior, que é
    // exatamente o comportamento esperado (só existe uma logo e uma
    // assinatura por loja de cada vez).
    // cacheControl: reduz o "busca de novo toda vez" sem arriscar ficar
    // preso numa versão velha depois de trocar a logo/assinatura — como
    // esses dois usam nome de arquivo FIXO (subir de novo sobrescreve o
    // mesmo caminho), um cache longo (tipo 1 ano, que uso na foto do
    // Bookip/Orçamento) seria arriscado aqui: se o link devolvido pelo
    // Storage não mudar ao sobrescrever, o navegador poderia continuar
    // mostrando a imagem antiga por muito tempo sem perceber a troca.
    // 1 hora é suficiente pra matar a demora dentro de uma sessão de
    // uso normal, sem esse risco de logo desatualizada por muito tempo.
    //
    // Limite de tempo por envio: com internet lenta/bloqueada o Firebase Storage tenta de novo
    // sozinho por até ~10 MINUTOS, e o botão ficava em "Salvando..." esse tempo todo. Agora desiste
    // depois de alguns segundos e diz o motivo (ajustável só pra teste).
    const tempoEnvioMs = () => window._VS_TEMPO_ENVIO_MS || 30000;
    function comTempo(promessa, ms) {
        return Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('tempo esgotado'), { code: 'vs/tempo-esgotado' })), ms))]);
    }
    function motivoDoEnvio(e) {
        const c = (e && e.code) || '';
        if (c === 'vs/tempo-esgotado' || c === 'storage/retry-limit-exceeded') return 'demorou demais (internet lenta ou bloqueada)';
        if (c === 'storage/unauthorized' || c === 'storage/unauthenticated') return 'sem permissão para enviar (abra Configurações → Diagnóstico do sistema → "Testar envio de imagem" para ver o motivo)';
        if (c === 'storage/canceled') return 'o envio foi cancelado';
        if (c === 'storage/quota-exceeded') return 'o armazenamento da loja está cheio';
        return (e && (e.code || e.message)) || 'erro desconhecido';
    }
    async function enviarEPegarLink(blob, caminho) {
        const fileRef = window._lojaStorageRef(caminho);
        await comTempo(window._storageUploadBytes(fileRef, blob, { cacheControl: 'public, max-age=3600' }), tempoEnvioMs());
        return comTempo(window._storageGetDownloadURL(fileRef), tempoEnvioMs());
    }
    // Devolve { url } se enviou, ou { erro: 'motivo' } — nunca lança e nunca fica pendurado.
    async function uploadImagemStorage(blob, caminho) {
        try {
            try {
                return { url: await enviarEPegarLink(blob, caminho) };
            } catch (e) {
                // Permissão negada costuma ser o TOKEN sem a permissão da loja (usuário criado por uma versão
                // antiga). Pede ao servidor pra renovar a permissão deste usuário e tenta UMA vez de novo.
                const c = (e && e.code) || '';
                const negado = c === 'storage/unauthorized' || c === 'storage/unauthenticated';
                if (!negado || typeof window._renovarPermissoes !== 'function') throw e;
                try { await window._renovarPermissoes(); } catch (_) { throw e; } // função indisponível: mantém o erro original
                return { url: await enviarEPegarLink(blob, caminho) };
            }
        } catch (e) {
            console.error('Erro upload imagem:', e);
            return { erro: motivoDoEnvio(e) };
        }
    }

    // Cache em memória — só existe enquanto o app está aberto (não é
    // Firebase nem localStorage). Sem isso, toda visita a essa tela
    // esperava um round-trip novo ao Firebase do zero, mesmo sem nada
    // ter mudado desde a última vez que a pessoa olhou nela.
    let dadosCache = null;

    function preencherForm(dados) {
        // Sem nome salvo ainda, mostra o nome com que a loja foi cadastrada (é o que sai nos documentos).
        if (el('cdNome'))     el('cdNome').value     = dados.storeName || window._nomeLojaCadastrada || '';
        if (el('cdEmail'))    el('cdEmail').value     = dados.storeEmail || '';
        if (el('cdCnpj'))     el('cdCnpj').value      = dados.storeCNPJ || '';
        if (el('cdEndereco')) el('cdEndereco').value  = dados.storeEndereco || '';
        if (el('cdCidadeUf')) el('cdCidadeUf').value  = dados.storeCidadeUf || '';
        if (el('cdTelefone')) el('cdTelefone').value  = dados.storeTelefone || '';
        if (el('cdTermos'))   el('cdTermos').value    = dados.termosGarantia || '';
        if (el('cdTermosConcerto')) el('cdTermosConcerto').value = dados.termosGarantiaConcerto || '';
        if (el('cdMensagemPadrao')) el('cdMensagemPadrao').value = dados.mensagemPadrao || '';
        if (el('cdContratoTemplate')) el('cdContratoTemplate').value = dados.contratoTemplate || '';
        if (el('cdContratoTitulo')) el('cdContratoTitulo').value = dados.contratoTitulo || '';
        if (el('cdContratoAssinatura')) el('cdContratoAssinatura').checked = !!dados.contratoAssinatura;
        if (el('cdContratoAssinaturaLocador')) el('cdContratoAssinaturaLocador').checked = !!dados.contratoAssinaturaLocador;
        if (el('cdContratoDataAutomatica')) el('cdContratoDataAutomatica').checked = !!dados.contratoDataAutomatica;
        if (el('cdNomeDocumento')) el('cdNomeDocumento').value = dados.nomeDocumento || 'Termo de compra e garantia';

        const logoSize = dados.storeLogoSize || 76;
        if (el('cdLogoSize'))      el('cdLogoSize').value = logoSize;
        if (el('cdLogoSizeLabel')) el('cdLogoSizeLabel').textContent = logoSize + 'px';

        if (el('cdCorBarra')) el('cdCorBarra').value = dados.storeCorBarra || '#16a34a';

        const logoPreview   = el('cdLogoPreview');
        const logoIcon      = el('cdLogoIconPlaceholder');
        if (logoPreview) {
            const logoSrc = dados.storeLogoMini || dados.storeLogoUrl;
            if (logoSrc) logoPreview.src = logoSrc; else logoPreview.removeAttribute('src');
            logoPreview.style.display = logoSrc ? 'block' : 'none';
            if (logoIcon) logoIcon.style.display = logoSrc ? 'none' : '';
        }

        const assinaturaPreview = el('cdAssinaturaPreview');
        const assinaturaIcon    = el('cdAssinaturaIconPlaceholder');
        if (assinaturaPreview) {
            if (dados.storeAssinaturaUrl) assinaturaPreview.src = dados.storeAssinaturaUrl; else assinaturaPreview.removeAttribute('src');
            assinaturaPreview.style.display = dados.storeAssinaturaUrl ? 'block' : 'none';
            if (assinaturaIcon) assinaturaIcon.style.display = dados.storeAssinaturaUrl ? 'none' : '';
        }
    }

    async function loadFromFirebase() {
        // Já carregou uma vez nessa sessão — preenche na hora com o que
        // já tem, sem esperar rede nenhuma. Continua abaixo buscando de
        // novo em segundo plano (não trava a tela nisso), só pra pegar
        // alguma mudança feita em outro aparelho nesse meio tempo.
        // (Se há alterações não salvas — ex: voltou de uma folha — o que foi digitado fica como está.)
        if (dadosCache && !estaSujo()) preencherForm(dadosCache);

        let dados = {};
        try {
            const snap = await window._dbGet(dbref(CFG_PATH));
            if (snap.exists()) dados = snap.val();
        } catch (e) {
            console.error('Erro ao carregar configurações:', e);
            // Antes a tela ficava em branco SEM avisar (parecia que nada tinha sido salvo) — e salvar assim
            // apagaria os dados que existem no banco. Agora avisa o motivo (e o Salvar fica travado, ver saveConfig).
            modal({ message: 'Não consegui carregar os dados salvos de Documentos: ' + (e.code || e.message || 'erro desconhecido') + '. Feche e abra esta tela de novo.' });
            if (dadosCache) return; // já tem algo válido na tela — um erro de rede não deve apagar isso
            return;                 // sem dados carregados: NÃO preenche com "vazio" como se fosse o salvo
        }

        dadosCache = dados;
        if (!estaSujo()) preencherForm(dados);
        if (typeof window._vsLogoLojaAtualizar === 'function') window._vsLogoLojaAtualizar(dados);
        if (dados.storeLogoUrl && !dados.storeLogoMini) migrarMiniLogo(dados.storeLogoUrl);
    }

    async function saveConfig() {
        // Se os dados salvos nunca chegaram (leitura falhou), o formulário está em branco por engano:
        // salvar agora SOBRESCREVERIA os dados reais com campos vazios. Trava até carregar.
        if (!dadosCache) {
            modal({ message: 'Os dados salvos de Documentos ainda não foram carregados — não dá pra salvar por cima. Feche e abra esta tela de novo.' });
            return;
        }
        const saveBtn = el('cdSave');
        const originalHtml = saveBtn.innerHTML;
        const emAndamento = texto => { saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> ' + texto; };
        emAndamento('Salvando...');
        saveBtn.disabled = true;
        const falhas = [];

        try {
            const dados = {
                storeName:      el('cdNome')?.value.trim() || '',
                storeEmail:     el('cdEmail')?.value.trim() || '',
                storeCNPJ:      el('cdCnpj')?.value.trim() || '',
                storeEndereco:  el('cdEndereco')?.value.trim() || '',
                storeCidadeUf:  el('cdCidadeUf')?.value.trim() || '',
                storeTelefone:  el('cdTelefone')?.value.trim() || '',
                termosGarantia: el('cdTermos')?.value || '',
                termosGarantiaConcerto: el('cdTermosConcerto')?.value || '',
                mensagemPadrao: el('cdMensagemPadrao')?.value.trim() || '',
                contratoTemplate: el('cdContratoTemplate')?.value || '',
                contratoTitulo: el('cdContratoTitulo')?.value.trim() || '',
                contratoAssinatura: !!el('cdContratoAssinatura')?.checked,
                contratoAssinaturaLocador: !!el('cdContratoAssinaturaLocador')?.checked,
                contratoDataAutomatica: !!el('cdContratoDataAutomatica')?.checked,
                nomeDocumento:  el('cdNomeDocumento')?.value.trim() || 'Termo de compra e garantia',
                storeLogoSize:  parseInt(el('cdLogoSize')?.value) || 76,
                storeCorBarra:  el('cdCorBarra')?.value || '#16a34a',
            };

            // 1º os DADOS (nome, contato, termos...): é rápido e nunca fica preso esperando imagem.
            await window._dbUpdate(dbref(CFG_PATH), dados);

            // Atualiza o cache local também — sem isso, salvar e voltar
            // pra essa tela em seguida mostraria o valor ANTIGO por um
            // instante (o cache só seria corrigido depois que a busca em
            // segundo plano terminasse).
            dadosCache = { ...dadosCache, ...dados };
            // a calculadora guarda o nome/cor pra exportar imagem: manda ler de novo
            if (typeof window._calcInvalidarIdentidade === 'function') window._calcInvalidarIdentidade();

            // 2º as imagens, uma de cada vez, cada uma com limite de tempo. Se uma falhar, os dados
            // já estão salvos e a imagem fica escolhida pra tentar de novo no próximo "Salvar".
            if (CD.preparando) await CD.preparando; // imagem escolhida agora há pouco ainda sendo reduzida
            const imagens = [
                { blob: CD.logoBlob, caminho: 'documentos/logo.jpg', campo: 'storeLogoUrl', rotulo: 'logo', extra: () => ({ storeLogoMini: CD.logoMini || null }), limpar: () => { CD.logoBlob = null; CD.logoMini = null; } },
                { blob: CD.assinaturaBlob, caminho: 'documentos/assinatura.jpg', campo: 'storeAssinaturaUrl', rotulo: 'assinatura', limpar: () => { CD.assinaturaBlob = null; } },
            ];
            for (const img of imagens) {
                if (!img.blob) continue;
                emAndamento('Enviando ' + img.rotulo + '...');
                const r = await uploadImagemStorage(img.blob, img.caminho);
                if (!r.url) { falhas.push('a ' + img.rotulo + ' NÃO foi enviada: ' + r.erro); continue; }
                try {
                    const campos = { [img.campo]: r.url, ...(img.extra ? img.extra() : {}) };
                    await window._dbUpdate(dbref(CFG_PATH), campos);
                    dadosCache = { ...dadosCache, ...campos };
                    img.limpar(); // já está no servidor: não precisa subir de novo
                } catch (e) {
                    falhas.push('a ' + img.rotulo + ' foi enviada mas não consegui registrar: ' + e.message);
                }
            }

            if (typeof window._vsLogoLojaAtualizar === 'function') window._vsLogoLojaAtualizar(dadosCache);
            limparSujo();
            if (falhas.length) marcarSujo('loja'); // a imagem que não subiu continua pendente

            // UMA mensagem só e honesta (antes o "erro de imagem" era coberto pelo "salvo com sucesso").
            modal({ message: falhas.length
                ? 'Dados salvos! Mas ' + falhas.join(' e ') + '. Toque em Salvar de novo para tentar outra vez.'
                : 'Configurações salvas com sucesso!' });
        } catch (e) {
            modal({ message: 'Erro ao salvar: ' + e.message });
        } finally {
            saveBtn.innerHTML = originalHtml;
            saveBtn.disabled = false;
        }
    }

})();
