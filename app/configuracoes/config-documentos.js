// ================================================================
// configuracoes/config-documentos.js — VortexSmart · Config → Documentos
// Registra: window._initConfigDocumentos()
// Guarda no Firebase (configuracoes/documentos): dados da loja,
// logo, assinatura e termos que os módulos de documentos
// (ex: bookip.js) leem na hora de gerar.
//
// Campos salvos em configuracoes/documentos:
//   storeName, storeEmail, storeCNPJ, storeEndereco, storeTelefone,
//   storeLogoUrl, storeAssinaturaUrl, termosGarantia
// ================================================================
(function () {
    'use strict';

    const modal  = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const el     = id   => document.getElementById(id);
    // dbref(caminho) agora monta a referência DENTRO da loja logada.
    const dbref = (caminho) => window._lojaRef(caminho);
    const CFG_PATH = 'configuracoes/documentos';

    const CD = { initialized: false, logoBlob: null, assinaturaBlob: null };

    window._initConfigDocumentos = function () {
        if (!CD.initialized) {
            renderShell();
            attachListeners();
            CD.initialized = true;
        }
        loadFromFirebase();
    };

    function renderShell() {
        const wrap = el('configuracoesDocumentos');
        if (!wrap) return;
        wrap.innerHTML = `
            <div class="section-header">
                <h3>Documentos</h3>
                <button class="btn-back" id="cdBack" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
            </div>
            <div class="content-card w-100" style="padding-bottom:110px;">

                <h5 class="mb-3"><i class="bi bi-shop"></i> Identidade da Loja</h5>
                <div class="d-flex align-items-center gap-3 mb-3">
                    <div id="cdLogoPreviewWrap" style="width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.05);border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                        <img id="cdLogoPreview" style="display:none;width:100%;height:100%;object-fit:cover;">
                        <i class="bi bi-image text-secondary" id="cdLogoIconPlaceholder" style="font-size:1.4rem;"></i>
                    </div>
                    <button class="btn btn-secondary" id="cdLogoBtn" type="button" style="flex:1;">
                        <i class="bi bi-upload"></i> Escolher Logo
                    </button>
                    <input type="file" accept="image/*" id="cdLogoInput" class="hidden">
                </div>
                <div class="mb-3"><label class="form-label">Nome da Loja</label><input class="form-control" id="cdNome" placeholder="Nome da sua loja"></div>

                <div class="mb-4">
                    <label class="form-label">Tamanho da Logo no documento</label>
                    <div class="d-flex align-items-center gap-3">
                        <input type="range" id="cdLogoSize" min="40" max="140" step="2" value="76" style="flex:1;accent-color:var(--primary);">
                        <span class="text-secondary small" id="cdLogoSizeLabel" style="min-width:44px;">76px</span>
                    </div>
                </div>

                <div class="mb-1"><label class="form-label"><i class="bi bi-pen"></i> Assinatura</label></div>
                <p class="text-secondary small mb-2">Aparece no final do documento de garantia, no lugar da linha em branco.</p>
                <div class="d-flex align-items-center gap-3 mb-4">
                    <div id="cdAssinaturaPreviewWrap" style="width:120px;height:60px;border-radius:10px;background:rgba(255,255,255,.05);border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;">
                        <img id="cdAssinaturaPreview" style="display:none;width:100%;height:100%;object-fit:contain;">
                        <i class="bi bi-pen text-secondary" id="cdAssinaturaIconPlaceholder" style="font-size:1.2rem;"></i>
                    </div>
                    <button class="btn btn-secondary" id="cdAssinaturaBtn" type="button" style="flex:1;">
                        <i class="bi bi-upload"></i> Escolher Assinatura
                    </button>
                    <input type="file" accept="image/*" id="cdAssinaturaInput" class="hidden">
                </div>

                <h5 class="mb-3 mt-4"><i class="bi bi-telephone-fill"></i> Dados de Contato</h5>
                <div class="mb-2"><label class="form-label">Email</label><input class="form-control" id="cdEmail" type="email" placeholder="contato@sualoja.com"></div>
                <div class="mb-2"><label class="form-label">CNPJ</label><input class="form-control" id="cdCnpj" placeholder="00.000.000/0000-00"></div>
                <div class="mb-2"><label class="form-label">Endereço</label><input class="form-control" id="cdEndereco" placeholder="Rua, número, bairro, cidade/UF"></div>
                <div class="mb-2"><label class="form-label">Local (Cidade/UF)</label><input class="form-control" id="cdCidadeUf" placeholder="Ex: Goiânia - GO"></div>
                <p class="text-secondary small mt-1 mb-2" style="margin-top:-6px;">Usado na linha de local e data automática dos documentos.</p>
                <div class="mb-3"><label class="form-label">Telefone(s)</label><input class="form-control" id="cdTelefone" placeholder="(62) 99999-9999 / (62) 98888-8888"></div>

                <div class="mb-4">
                    <label class="form-label">Cor primária da minha empresa</label>
                    <div class="d-flex align-items-center gap-3">
                        <input type="color" id="cdCorBarra" value="#16a34a" style="width:52px;height:38px;border-radius:10px;border:1.5px solid var(--border);background:none;padding:2px;cursor:pointer;">
                        <span class="text-secondary small">Usada no cabeçalho dos documentos e nas imagens geradas pela calculadora e pelo orçamento</span>
                    </div>
                </div>

                <div class="mb-4">
                    <label class="form-label">Nome do Documento</label>
                    <input class="form-control" id="cdNomeDocumento" placeholder="Ex: Termo de compra e garantia">
                    <p class="text-secondary small mt-1 mb-0">Usado no nome do arquivo e no assunto ao compartilhar. Ex: "Termo de compra e garantia de João Silva.pdf"</p>
                </div>

                <h5 class="mb-2 mt-4"><i class="bi bi-chat-left-text"></i> Mensagem Padrão</h5>
                <p class="text-secondary small mb-2">Usada ao compartilhar a garantia. O sistema adiciona "Olá [Nome do Cliente]," automaticamente antes deste texto.</p>
                <textarea class="form-control mb-4" id="cdMensagemPadrao" rows="4" placeholder="Ex: Segue em anexo o comprovante da sua compra e garantia. Qualquer dúvida, estamos à disposição!" style="font-size:.82rem;"></textarea>

                <h5 class="mb-2 mt-4"><i class="bi bi-shield-check"></i> Termos de Garantia — Venda</h5>
                <p class="text-secondary small mb-2">Este texto aparece no documento de garantia de uma <b>venda</b>. Use <b>**texto**</b> para deixar algo em negrito.</p>
                <textarea class="form-control mb-4" id="cdTermos" rows="10" style="font-size:.78rem;line-height:1.5;" placeholder="Escreva aqui os termos de garantia da sua loja..."></textarea>

                <h5 class="mb-2 mt-4"><i class="bi bi-tools"></i> Termos de Garantia — Concerto</h5>
                <p class="text-secondary small mb-2">Este texto aparece no documento de garantia gerado a partir de um <b>reparo</b> (aba Concertos) — geralmente diferente do termo de venda. Se deixar em branco, usa o termo de venda no lugar.</p>
                <textarea class="form-control mb-4" id="cdTermosConcerto" rows="10" style="font-size:.78rem;line-height:1.5;" placeholder="Escreva aqui os termos de garantia dos consertos da sua loja (pode ser diferente do de venda)..."></textarea>

                <h5 class="mb-2 mt-4"><i class="bi bi-file-earmark-text"></i> Modelo de Contrato</h5>
                <p class="text-secondary small mb-2">
                    Cole aqui o contrato da sua loja. Use tags <b>{{tipo:id:rótulo}}</b> nos pontos que o cliente vai preencher — o sistema cria os campos automaticamente na tela de Contrato.
                </p>
                <div class="content-card mb-3" style="padding:12px 14px;">
                    <div class="d-flex align-items-center justify-content-between mb-2">
                        <span class="small"><b><i class="bi bi-stars"></i> Já tem um contrato pronto?</b></span>
                        <button class="btn btn-sm btn-secondary" id="cdIaToggle" type="button">Ver prompt pra IA</button>
                    </div>
                    <div id="cdIaBox" style="display:none;">
                        <p class="text-secondary small mb-2">Copie o prompt abaixo, cole numa IA (ChatGPT, Claude, etc.) junto com o texto do seu contrato original, e cole a resposta dela no campo do modelo mais abaixo.</p>
                        <textarea class="form-control mb-2" id="cdIaPrompt" rows="11" readonly style="font-size:.72rem;line-height:1.5;"></textarea>
                        <button class="btn btn-info w-100" id="cdIaCopiar" type="button"><i class="bi bi-clipboard"></i> Copiar Prompt</button>
                    </div>
                </div>

                <div class="content-card mb-3" style="padding:12px 14px;">
                    <div class="text-secondary small mb-1"><b>Tipos disponíveis:</b></div>
                    <div class="text-secondary small" style="line-height:1.7;">
                        <code>{{texto:nome_cliente:Nome Completo}}</code> — campo de texto<br>
                        <code>{{numero:cpf:CPF/CNPJ}}</code> — número/documento<br>
                        <code>{{moeda:valor_parcela:Valor da Parcela}}</code> — valor em R$<br>
                        <code>{{data:data_pagamento:Data de Pagamento}}</code> — data<br>
                        <code>{{calc:total:valor_parcela*qtd_parcelas}}</code> — calculado automaticamente<br>
                        <code>{{hoje:data_assinatura:Data de Assinatura}}</code> — preenche sozinho com a data de hoje<br>
                        <code>{{diadata:dia_vencimento:data_inicio_pagamento}}</code> — pega o dia de outro campo <b>data</b><br>
                        <code>{{escolha:estado:Estado|Novo|Seminovo}}</code> — interruptor com opções, em vez de texto livre<br>
                        <span class="text-secondary">Dica: repetir o mesmo <code>id</code> em dois pontos do contrato (ex: prazo em meses e qtd. de parcelas) mantém os dois sempre iguais, com um único campo.</span>
                    </div>
                </div>

                <div class="mb-3"><label class="form-label">Título do Contrato</label><input class="form-control" id="cdContratoTitulo" placeholder="Ex: CONTRATO DE PRESTAÇÃO DE SERVIÇO"></div>
                <p class="text-secondary small mb-2" style="margin-top:-8px;">Aparece em destaque, maior e em negrito, no topo do documento gerado.</p>

                <textarea class="form-control mb-1" id="cdContratoTemplate" rows="14" placeholder="CONTRATANTE: {{texto:nome_cliente:Nome Completo}}, inscrito(a) no CPF/CNPJ sob nº {{numero:cpf:CPF/CNPJ}}...

Valor da parcela: {{moeda:valor_parcela:Valor da Parcela}} x {{numero:qtd_parcelas:Qtd. Parcelas}} = {{calc:total:valor_parcela*qtd_parcelas}}" style="font-size:.78rem;line-height:1.6;"></textarea>
                <p class="text-secondary small mb-3">O mesmo id não pode se repetir com tipos diferentes. Use <b>**texto**</b> para negrito.</p>

                <div class="form-check mb-2">
                    <input class="form-check-input" type="checkbox" id="cdContratoDataAutomatica">
                    <label class="form-check-label small" for="cdContratoDataAutomatica">Adicionar local e data automáticos antes da(s) assinatura(s)</label>
                </div>
                <p class="text-secondary small mb-3" style="margin-top:-6px;">Usa sempre a data de hoje e o "Local (Cidade/UF)" salvo em Dados de Contato — nunca precisa editar.</p>

                <div class="form-check mb-2">
                    <input class="form-check-input" type="checkbox" id="cdContratoAssinaturaLocador">
                    <label class="form-check-label small" for="cdContratoAssinaturaLocador">Incluir linha de assinatura da Locadora (sua loja)</label>
                </div>
                <div class="form-check mb-4">
                    <input class="form-check-input" type="checkbox" id="cdContratoAssinatura">
                    <label class="form-check-label small" for="cdContratoAssinatura">Incluir linha de assinatura do Locatário</label>
                </div>

                <button class="btn btn-primary w-100" id="cdSave">
                    <i class="bi bi-check-circle-fill"></i> Salvar Configurações
                </button>
            </div>
        `;
    }

    function attachListeners() {
        el('cdLogoBtn')?.addEventListener('click', () => el('cdLogoInput')?.click());
        el('cdLogoInput')?.addEventListener('change', handleLogoSelect);
        el('cdAssinaturaBtn')?.addEventListener('click', () => el('cdAssinaturaInput')?.click());
        el('cdAssinaturaInput')?.addEventListener('change', handleAssinaturaSelect);
        el('cdLogoSize')?.addEventListener('input', () => {
            const lbl = el('cdLogoSizeLabel');
            if (lbl) lbl.textContent = el('cdLogoSize').value + 'px';
        });
        el('cdSave')?.addEventListener('click', saveConfig);
        el('cdIaToggle')?.addEventListener('click', () => {
            const box = el('cdIaBox');
            if (!box) return;
            const abrindo = box.style.display === 'none';
            box.style.display = abrindo ? 'block' : 'none';
            if (abrindo && el('cdIaPrompt')) el('cdIaPrompt').value = IA_PROMPT;
        });
        el('cdIaCopiar')?.addEventListener('click', copiarPromptIA);
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

    function handleLogoSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        CD.logoBlob = file;
        const preview   = el('cdLogoPreview');
        const iconPlace = el('cdLogoIconPlaceholder');
        const reader = new FileReader();
        reader.onload = ev => {
            if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
            if (iconPlace) iconPlace.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    function handleAssinaturaSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        CD.assinaturaBlob = file;
        const preview   = el('cdAssinaturaPreview');
        const iconPlace = el('cdAssinaturaIconPlaceholder');
        const reader = new FileReader();
        reader.onload = ev => {
            if (preview) { preview.src = ev.target.result; preview.style.display = 'block'; }
            if (iconPlace) iconPlace.style.display = 'none';
        };
        reader.readAsDataURL(file);
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
        if (dados.storeLogoUrl && logoPreview) { logoPreview.src = dados.storeLogoUrl; logoPreview.style.display = 'block'; if (logoIcon) logoIcon.style.display = 'none'; }

        const assinaturaPreview = el('cdAssinaturaPreview');
        const assinaturaIcon    = el('cdAssinaturaIconPlaceholder');
        if (dados.storeAssinaturaUrl && assinaturaPreview) { assinaturaPreview.src = dados.storeAssinaturaUrl; assinaturaPreview.style.display = 'block'; if (assinaturaIcon) assinaturaIcon.style.display = 'none'; }
    }

    async function loadFromFirebase() {
        // Já carregou uma vez nessa sessão — preenche na hora com o que
        // já tem, sem esperar rede nenhuma. Continua abaixo buscando de
        // novo em segundo plano (não trava a tela nisso), só pra pegar
        // alguma mudança feita em outro aparelho nesse meio tempo.
        if (dadosCache) preencherForm(dadosCache);

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
        preencherForm(dados);
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
            const imagens = [
                { blob: CD.logoBlob, caminho: 'documentos/logo.jpg', campo: 'storeLogoUrl', rotulo: 'logo', limpar: () => { CD.logoBlob = null; } },
                { blob: CD.assinaturaBlob, caminho: 'documentos/assinatura.jpg', campo: 'storeAssinaturaUrl', rotulo: 'assinatura', limpar: () => { CD.assinaturaBlob = null; } },
            ];
            for (const img of imagens) {
                if (!img.blob) continue;
                emAndamento('Enviando ' + img.rotulo + '...');
                const r = await uploadImagemStorage(img.blob, img.caminho);
                if (!r.url) { falhas.push('a ' + img.rotulo + ' NÃO foi enviada: ' + r.erro); continue; }
                try {
                    await window._dbUpdate(dbref(CFG_PATH), { [img.campo]: r.url });
                    dadosCache = { ...dadosCache, [img.campo]: r.url };
                    img.limpar(); // já está no servidor: não precisa subir de novo
                } catch (e) {
                    falhas.push('a ' + img.rotulo + ' foi enviada mas não consegui registrar: ' + e.message);
                }
            }

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
