// ================================================================
// venda/lancar.js — VortexSmart · Venda · Nova Venda (Etapa 1)
// Monta a venda: cliente + carrinho de produtos com valor recebido.
// A venda fica com status PENDENTE até o pagamento ser fechado (Etapa
// 2, venda/fechar.js). Produtos entram no carrinho por busca ou por
// leitor de código de barras (pistola USB = teclado) e são editados na
// própria linha (cor, IMEI, preço). Venda sem cliente pergunta o cliente
// ao salvar. Em PC o salvamento segue direto pro Fechar Venda; no celular
// vai pro Histórico.
//
// Gravação em 2 passos (PASSO 1 venda, PASSO 2 estoque), nessa ordem
// de propósito: se o PASSO 2 falhar depois, a venda já existe (fica
// marcada estoqueSincronizado:false, visível no Histórico) em vez de
// desaparecer sem rastro. Editar uma venda pendente/fechada existente
// ESTORNA (devolve) os itens da versão antiga e dá baixa da versão
// nova — os dois movimentos ficam registrados no histórico do produto
// com o vendaId, pra auditar e pra dar suporte a retry idempotente.
//
// Também funciona como tela de EDIÇÃO: se window._vendaContexto.vendaId
// estiver setado (veio do Histórico), carrega essa venda existente pra
// editar em vez de criar uma nova. Editar uma venda já FECHADA passa
// por reconciliarEdicaoDeFechada() se o total mudar — ver essa função
// pra como o excedente/falta é tratado.
//
// Node: /clientes/{id} = { nome, telefone, criadoEm }
// Node: /vendas/{id} = { clienteId, clienteNome, itens:[{produtoId,
//        produtoNome, quantidade, valorUnitario, valorTotal,
//        custoUnitario, custoIndefinido}], valorTotal,
//        status:'pendente'|'fechada'|'cancelada', pagamentos?,
//        valorLiquidoTotal?, criadoEm, fechadaEm?, numeroVenda,
//        estoqueSincronizado }
// custoUnitario: foto do precoCompra do produto NO MOMENTO da venda —
//        o Relatório usa esse valor (não o custo atual do produto) pra
//        calcular Lucro Real, assim uma venda antiga não muda de lucro
//        sozinha quando o custo do produto muda depois (ex: reposição
//        recalculando a média). Editar a venda preserva esse valor por
//        produtoId (não por posição da linha). Vendas de antes dessa
//        mudança não têm esse campo (undefined) — o Relatório cai pro
//        custo atual como fallback só nesse caso.
// custoIndefinido: true quando o produto não tinha precoCompra
//        cadastrado NO MOMENTO da venda — custoUnitario fica null (não
//        0), e o Relatório (venda/relatorios.js, custoUnitarioDoItem)
//        trata como custo 0 SEMPRE, nunca cai pro custo atual do
//        produto — evita que o Lucro Real de uma venda antiga pareça
//        100% só porque o produto não tinha custo informado na época.
// estoqueSincronizado: false enquanto o PASSO 2 (mover estoque) ainda
//        não confirmou depois do PASSO 1 (gravar a venda). O Histórico
//        mostra um aviso quando false. O retry é retomarVendaOrfa()
//        (venda NOVA, só na sessão) ou retomarEdicaoPendente() (edição).
// estoquePendente: { revisao, itensAntes } — só existe numa EDIÇÃO cujo
//        PASSO 2 ainda não confirmou. Gravado na mesma escrita do PASSO
//        1 e apagado junto com estoqueSincronizado:true; é o que deixa
//        o retry achar o "antes" mesmo depois de sair da tela.
// Node: /contadorVendas = número (int) — só existe pra gerar o próximo
//        numeroVenda via transaction (window._dbTransaction), incrementado
//        na criação de cada venda nova (nunca em edição). Vendas de antes
//        dessa mudança não têm numeroVenda — o Histórico cai pro ID curto
//        do Firebase como fallback nesse caso.
//
// Depende de (via window.*):
//   showCustomModal, _fmt, products (populado pelo core.js),
//   _lojaRef, _dbGet, _dbOnValue, _dbPush, _dbUpdate, _dbTransaction,
//   _estoqueMoverEstoque (estoque/produtos.js),
//   _vendaReduzirPagamentosParaNovoTotal (venda/fechar.js) — usado só
//     ao editar venda fechada com total menor (ver reconciliarEdicaoDeFechada;
//     tem fallback seguro se não estiver carregado),
//   _vendaContexto (venda/router.js)
// Expõe via window.*:
//   _renderLancarVenda, _vendaSincronizarEstoquePendente (usada pelo cancelamento no Histórico)
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const esc   = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt   = v => typeof window._fmt === 'function' ? window._fmt(v) : `R$ ${Number(v || 0).toFixed(2)}`;
    const el    = id => document.getElementById(id);
    // Formata um timestamp pro formato que o <input type="date"> espera (YYYY-MM-DD), no horário local
    const toDateInputValue = ts => {
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    // Nova Venda tem 2 botões "Salvar" (header + coluna Resumo, mesma ação) — aplica loading nos dois
    // juntos, sem duplicar as chamadas de _setBtnLoading espalhadas pela função de salvar.
    const setSalvarBtnsLoading = (loading, texto) => {
        window._setBtnLoading(el('salvarVendaBtn'), loading, texto);
        window._setBtnLoading(el('salvarVendaBtnTop'), loading, texto);
    };

    const centavos2 = n => Math.round((Number(n) || 0) * 100) / 100;   // 3 × 4,35 = 13.049999999999999 → 13.05 antes de gravar

    let mounted = false;
    let clienteSelecionado = null;   // { id, nome }
    let carrinho = [];               // [{ produtoId, produtoNome, quantidade, valorUnitario, estoqueAtual }]
    let clientesCache = null;
    let vendaEmEdicaoId = null;      // se setado, "Salvar" faz update em vez de criar
    let statusOriginal = null;       // status da venda ANTES de editar (preservado ao salvar)
    let fechadaEmOriginal = null;    // preserva a data de fechamento original ao reabrir por causa de edição de valor
    let salvarAposEscolherCliente = false; // true só quando o seletor de cliente foi aberto PELO botão Salvar (venda sem cliente) — ao escolher, salva em seguida
    let ultimaLeitura = { codigo: '', ts: 0 }; // anti-duplicidade da pistola (mesma leitura repetida em poucos ms)

    // CORREÇÃO (A4/A5 — clonagem de venda em falha de rede): quando o
    // PASSO 1 (gravar a venda) tem sucesso mas o PASSO 2 (mover estoque)
    // falha depois, a venda já existe no Firebase — se o usuário só
    // clicar "Salvar" de nervoso, o caminho normal criaria uma SEGUNDA
    // venda (numeroVenda novo, baixa de estoque duplicada), porque
    // vendaEmEdicaoId continua null (é uma venda NOVA que falhou, não
    // uma edição). Esse estado guarda a venda órfã (só na MESMA sessão,
    // decisão de escopo confirmada — reload do app perde isso de
    // propósito, é caso raro demais pra justificar persistir) pra
    // interceptar o próximo clique em Salvar e oferecer retomar/descartar
    // em vez de deixar duplicar direto. null quando não há pendência.
    let vendaOrfaPendente = null; // { vendaId, numeroVenda, itensDepois, clienteNoMomento } — venda NOVA, nunca edição (ver retomarVendaOrfa)
    // Edição com estoque pendente NÃO tem estado em memória: a pendência
    // fica gravada na própria venda (vendas/{id}/estoquePendente) — ver
    // salvarVendaDeVerdade e retomarEdicaoPendente.

    // ── Skeleton ──────────────────────────────────────────────────
    function ensureSkeleton() {
        const container = el('lancarVenda');
        if (!container || mounted) return;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="vs-nv-header">
                <div>
                    <h3 id="lancarVendaTitulo">Nova Venda</h3>
                </div>
                <div class="vs-nv-header-actions">
                    <button type="button" class="btn-back vs-nv-btn-cancelar" aria-label="Voltar"><i class="bi bi-arrow-left vs-nv-ic"></i><span class="vs-nv-txt">Cancelar</span></button>
                    <button type="button" class="vs-nv-btn-salvar" id="salvarVendaBtnTop">
                        <i class="bi bi-save-fill"></i> Salvar Venda
                    </button>
                </div>
            </div>

            <div class="vs-nv-layout">
                <div class="vs-nv-col-main">
                    <div class="content-card w-100">
                        <div class="mb-3">
                            <label class="form-label">Cliente</label>
                            <div class="d-flex align-items-center gap-2">
                                <div class="apr-machine-chip" id="clienteChip" style="flex:1;">
                                    <div class="apr-machine-chip-left">
                                        <div class="apr-machine-chip-icon"><i class="bi bi-person-fill"></i></div>
                                        <div>
                                            <div class="apr-machine-chip-label">Cliente</div>
                                            <div class="apr-machine-chip-value" id="clienteChipValue">Selecionar cliente</div>
                                        </div>
                                    </div>
                                    <i class="bi bi-chevron-down"></i>
                                </div>
                                <button type="button" class="stq-panel-btn editar" id="clienteEditarBtn" style="flex-shrink:0;padding:10px 12px;border-radius:12px;" title="Editar dados do cliente"><i class="bi bi-pencil-fill"></i></button>
                            </div>
                        </div>

                        <label class="form-label">Data da venda</label>
                        <input type="date" class="form-control mb-3" id="vendaDataInput"/>
                    </div>

                    <div class="content-card w-100 vs-nv-carrinho-card">
                        <div class="vs-nv-carrinho-head">
                            <label class="form-label m-0">Carrinho</label>
                            <span class="vs-nv-carrinho-count" id="vendaCarrinhoCount">0 itens</span>
                        </div>
                        <div class="scan-input-principal">
                            <input class="form-control" id="vendaCodigoBarrasPrincipal" placeholder="🔫 Ler código de barras..." autocomplete="off"/>
                        </div>
                        <div id="vendaCarrinhoList"></div>
                        <button type="button" class="venda-add-item-btn" id="vendaAddItemBtn"><i class="bi bi-plus-circle-fill"></i> Adicionar Produto</button>
                    </div>
                </div>

                <div class="vs-nv-col-resumo">
                    <div class="content-card w-100 vs-nv-resumo-card">
                        <label class="form-label">Resumo</label>
                        <div id="vendaResumoItens"></div>
                        <div class="venda-total-row">
                            <span>Total</span>
                            <span id="vendaTotalGeral">R$ 0,00</span>
                        </div>
                        <button type="button" class="btn btn-primary w-100" id="salvarVendaBtn">
                            <i class="bi bi-save-fill"></i> Salvar Venda
                        </button>
                        <div class="stq-hist-sub text-center mt-2">Fica pendente — o pagamento é definido depois, na tela de Fechar Venda.</div>
                    </div>
                </div>
            </div>

            <!-- Modal Cliente (busca, ou cadastro completo — telas separadas) -->
            <div class="stq-modal-backdrop" id="clienteModalBackdrop">
                <div class="stq-modal-card stq-modal-card-fixed">
                    <div class="stq-modal-header primary">
                        <div class="stq-modal-header-title" id="clienteModalTitulo">Escolher Cliente</div>
                        <button class="stq-modal-close" id="clienteModalClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="clienteModalBody"></div>
                </div>
            </div>

            <!-- Modal Produto (busca + confirmar qtd/valor) -->
            <div class="stq-modal-backdrop" id="produtoModalBackdrop">
                <div class="stq-modal-card stq-modal-card-fixed">
                    <div class="stq-modal-header green">
                        <div class="stq-modal-header-title" id="produtoModalTitulo">Escolher Produto</div>
                        <button class="stq-modal-close" id="produtoModalClose"><i class="bi bi-x-lg"></i></button>
                    </div>
                    <div class="stq-modal-body" id="produtoModalBody"></div>
                </div>
            </div>
        `;

        el('clienteChip')?.addEventListener('click', abrirModalCliente);
        el('clienteEditarBtn')?.addEventListener('click', abrirEdicaoClienteAtual);
        el('clienteModalClose')?.addEventListener('click', fecharModalCliente);
        el('clienteModalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'clienteModalBackdrop') fecharModalCliente(); });

        el('vendaAddItemBtn')?.addEventListener('click', abrirModalProdutoBusca);
        el('vendaCodigoBarrasPrincipal')?.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            processarLeituraCodigoBarras(el('vendaCodigoBarrasPrincipal'));
        });
        // Pistola sempre pronta: o foco no campo é dado a CADA abertura da tela (ver _renderLancarVenda)
        // e recuperado por este listener quando se perde (clique no vazio, modal fechado...).
        document.addEventListener('keydown', capturarPistolaSemFoco, true);
        el('produtoModalClose')?.addEventListener('click', fecharModalProduto);
        el('produtoModalBackdrop')?.addEventListener('click', e => { if (e.target.id === 'produtoModalBackdrop') fecharModalProduto(); });

        el('salvarVendaBtn')?.addEventListener('click', salvarVenda);
        el('salvarVendaBtnTop')?.addEventListener('click', salvarVenda);

        mounted = true;
    }

    // ── Pistola (leitor USB = teclado que digita o código rápido e
    //    manda Enter). Ela só "acerta" se o foco estiver no campo de
    //    leitura — então o foco é dado ao abrir a tela e recuperado
    //    sozinho quando se perde. ──
    // No celular focar um campo levanta o teclado — por isso, fora a
    // primeira abertura (comportamento antigo), o foco automático só
    // vale em PC/.exe (Electron ou mouse).
    const ehDesktop = () => typeof window.vsmartPrint === 'object'
        || !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

    function telaVendaVisivel() {
        const tela = el('lancarVenda');
        if (!tela) return false;
        for (let n = tela; n && n !== document.body; n = n.parentElement) {
            if (window.getComputedStyle(n).display === 'none') return false;
        }
        return true;
    }
    // Qualquer modal/aviso com botões aberto (os de cliente/produto, os
    // de outras telas e o showCustomModal de confirmação) — nunca
    // roubar o foco de dentro deles.
    const temModalAberto = () => !!document.querySelector('.stq-modal-backdrop.show, #customModalOverlay.active');

    function focarPistola() {
        if (!telaVendaVisivel() || temModalAberto()) return;
        const inp = el('vendaCodigoBarrasPrincipal');
        if (inp && document.activeElement !== inp) inp.focus();
    }
    const focarPistolaSeDesktop = () => { if (ehDesktop()) focarPistola(); };

    const TIPOS_INPUT_SEM_TEXTO = ['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color', 'image'];
    function focoEmCampoDeTexto(a) {
        if (!a || a === document.body) return false;
        if (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') return true;
        if (a.tagName === 'INPUT') return !TIPOS_INPUT_SEM_TEXTO.includes((a.type || 'text').toLowerCase());
        return false;
    }

    // Foco no vazio (ou num botão, depois de clicar em algo): o 1º
    // caractere da pistola devolve o foco ao campo de leitura antes de
    // ser digitado — o código chega inteiro. Se o foco já está num campo
    // de texto (Cor, IMEI, Preço, data, busca), NÃO rouba: dá pra ler um
    // IMEI direto ali. Sem isso, o Enter final da pistola num botão
    // focado (ex: lixeira do item) ACIONARIA o botão.
    // Enter/Esc num campo do carrinho ou na data devolve o foco à pistola.
    function capturarPistolaSemFoco(e) {
        if (!telaVendaVisivel() || temModalAberto()) return;
        const ativo = document.activeElement;
        if ((e.key === 'Enter' || e.key === 'Escape')
            && ativo && ativo.tagName === 'INPUT' && ativo.id !== 'vendaCodigoBarrasPrincipal'
            && (el('vendaCarrinhoList')?.contains(ativo) || ativo.id === 'vendaDataInput')) {
            e.preventDefault();
            focarPistola();
            return;
        }
        if (!e.key || e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
        if (focoEmCampoDeTexto(ativo)) return;
        focarPistola();
    }

    // ── Cliente ──────────────────────────────────────────────────
    function abrirModalCliente() {
        el('clienteModalBackdrop')?.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        renderClienteBuscaBody();
    }
    function fecharModalCliente() {
        salvarAposEscolherCliente = false; // fechou sem escolher (ou já escolheu) — nunca deixa o "salvar em seguida" pendurado
        el('clienteModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        focarPistolaSeDesktop();
    }

    // Lápis ao lado do chip — edita o cliente JÁ selecionado, sem passar
    // pela tela de busca. Diferente do clique no chip (que troca o
    // cliente). Busca os dados completos primeiro, já que clienteSelecionado
    // só guarda {id, nome} — o resto (CPF, telefone etc) vem do cache ou,
    // se ainda não carregou, direto do Firebase.
    function abrirEdicaoClienteAtual() {
        if (!clienteSelecionado || !clienteSelecionado.id) {
            modal({ message: 'Selecione um cliente (pela busca) antes de editar.' });
            return;
        }
        const doCache = (clientesCache || []).find(c => c.id === clienteSelecionado.id);
        if (doCache) {
            el('clienteModalBackdrop')?.classList.add('show');
            window._vsTravarScroll && window._vsTravarScroll();
            abrirCadastroClienteCompleto(doCache);
            return;
        }
        window._dbGet(window._lojaRef(`clientes/${clienteSelecionado.id}`)).then(snap => {
            const dados = snap.val();
            if (!dados) { modal({ message: 'Não foi possível carregar os dados desse cliente.' }); return; }
            el('clienteModalBackdrop')?.classList.add('show');
            window._vsTravarScroll && window._vsTravarScroll();
            abrirCadastroClienteCompleto({ id: clienteSelecionado.id, ...dados });
        }).catch(e => modal({ message: `Erro ao carregar cliente: ${e.message}` }));
    }

    // Lista de clientes em TEMPO REAL: um ouvinte só, ligado na 1ª vez que alguém precisa.
    // Antes a lista era lida UMA vez e nunca mais — cliente cadastrado em outra tela (ou em
    // outro aparelho) não aparecia aqui até recarregar o app, e se a 1ª leitura falhasse o
    // erro virava lista VAZIA pra sempre ("nenhum cliente").
    // A promessa é COMPARTILHADA e só resolve quando o 1º dado (ou o erro) chega — quem chama
    // várias vezes antes disso espera o mesmo resultado (devolver uma promessa já resolvida com
    // o cache ainda vazio fazia a tela redesenhar em laço, sem nunca soltar o navegador).
    let clientesErro = false;
    let clientesPromessa = null;
    function carregarClientes() {
        if (clientesPromessa) return clientesPromessa;
        clientesPromessa = new Promise(resolve => {
            window._dbOnValue(window._lojaRef('clientes'), snap => {
                const data = snap.val();
                clientesCache = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })) : [];
                clientesErro = false;
                if (el('clienteLista')) renderClienteLista(); // seletor aberto: atualiza na hora
                resolve(clientesCache);
            }, () => {
                clientesPromessa = null; // tenta de novo da próxima vez que abrir
                clientesErro = true;
                if (el('clienteLista')) renderClienteLista();
                resolve(clientesCache);
            });
        });
        return clientesPromessa;
    }

    let clienteListaLimite = 10;

    // ── Tela 1: buscar cliente existente ───────────────────────────
    function renderClienteBuscaBody() {
        el('clienteModalTitulo').textContent = 'Escolher Cliente';
        clienteListaLimite = 10;
        const bodyEl = el('clienteModalBody');
        bodyEl.innerHTML = `
            <div class="d-flex gap-2 mb-2">
                <input class="form-control" id="clienteBusca" placeholder="Buscar cliente..." style="flex:1;"/>
                <button type="button" class="venda-search-add-btn" id="clienteNovoToggleBtn" title="Novo cliente"><i class="bi bi-person-plus-fill"></i></button>
            </div>
            <div id="clienteLista"></div>
        `;
        el('clienteBusca').addEventListener('input', () => renderClienteLista(true));
        el('clienteNovoToggleBtn').addEventListener('click', () => abrirCadastroClienteCompleto());
        if (clientesCache) {
            renderClienteLista();
        } else {
            el('clienteLista').innerHTML = `
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>
                <div class="skeleton-row"></div>`;
            carregarClientes().then(() => renderClienteLista());
        }
    }

    function renderClienteLista(resetarLimite) {
        if (resetarLimite) clienteListaLimite = 10;
        const termo = (el('clienteBusca')?.value || '').trim().toLowerCase();
        const listEl = el('clienteLista');
        if (!listEl) return;
        if (!clientesCache && clientesErro) {
            listEl.innerHTML = `<div class="stq-hist-empty">Não consegui carregar os clientes. Feche e abra de novo.</div>`;
            return;
        }
        const todos = (clientesCache || []).filter(c => !termo || (c.nome || '').toLowerCase().includes(termo));
        const lista = todos.slice(0, clienteListaLimite);
        const temMais = todos.length > lista.length;
        listEl.innerHTML = (lista.length
            ? lista.map(c => `<div class="apr-modal-item" data-id="${c.id}"><span>${esc(c.nome)}${c.telefone ? ` <span class="text-secondary small">· ${esc(c.telefone)}</span>` : ''}</span><i class="bi bi-chevron-right"></i></div>`).join('')
            : `<div class="stq-hist-empty">Nenhum cliente encontrado.</div>`)
            + (temMais ? `<button type="button" class="venda-ver-mais-btn" id="clienteVerMaisBtn">Ver mais (${todos.length - lista.length} restante${todos.length - lista.length > 1 ? 's' : ''})</button>` : '');
        listEl.querySelectorAll('.apr-modal-item').forEach(item => {
            item.addEventListener('click', () => {
                const c = clientesCache.find(x => x.id === item.dataset.id);
                if (c) selecionarCliente(c);
            });
        });
        el('clienteVerMaisBtn')?.addEventListener('click', () => {
            clienteListaLimite += 20;
            renderClienteLista(false);
        });
    }

    function selecionarCliente(c) {
        const salvarEmSeguida = salvarAposEscolherCliente; // lido ANTES de fecharModalCliente(), que zera a flag
        clienteSelecionado = { id: c.id, nome: c.nome };
        el('clienteChipValue').textContent = c.nome;
        fecharModalCliente();
        if (salvarEmSeguida) salvarVenda();
    }

    // ── Tela 2: cadastro completo (mesmos campos do Bookip — assim a
    //    garantia já sai com tudo preenchido depois). Também serve pra
    //    EDITAR o cliente atualmente selecionado (clienteExistente). ──
    function abrirCadastroClienteCompleto(clienteExistente) {
        el('clienteModalTitulo').textContent = clienteExistente ? 'Editar Cliente' : 'Novo Cliente';
        const bodyEl = el('clienteModalBody');
        bodyEl.innerHTML = `
            <div class="stq-panel-back"><button type="button" id="clienteVoltarBuscaBtn"><i class="bi bi-arrow-left"></i> Voltar pra busca</button></div>
            <label class="form-label">Nome</label>
            <input class="form-control mb-2" id="clienteNovoNome" placeholder="Nome completo" value="${esc(clienteExistente?.nome || '')}"/>
            <label class="form-label">CPF</label>
            <input class="form-control mb-2" id="clienteNovoCpf" placeholder="000.000.000-00" value="${esc(clienteExistente?.cpf || '')}"/>
            <label class="form-label">Telefone</label>
            <input class="form-control mb-2" id="clienteNovoTelefone" placeholder="(00) 00000-0000" value="${esc(clienteExistente?.telefone || '')}"/>
            <label class="form-label">Data de nascimento</label>
            <input class="form-control mb-2" id="clienteNovoNascimento" type="date" value="${clienteExistente?.dataNascimento || ''}"/>
            <label class="form-label">Email</label>
            <input class="form-control mb-2" id="clienteNovoEmail" placeholder="email@exemplo.com" value="${esc(clienteExistente?.email || '')}"/>
            <label class="form-label">Endereço</label>
            <input class="form-control mb-3" id="clienteNovoEndereco" placeholder="Rua, número, bairro..." value="${esc(clienteExistente?.endereco || '')}"/>
            <button type="button" class="stq-modal-btn-save w-100" id="clienteNovoConfirmarBtn"><i class="bi bi-person-check-fill"></i> ${clienteExistente ? 'Salvar alterações' : 'Cadastrar e Selecionar'}</button>
        `;
        el('clienteVoltarBuscaBtn').addEventListener('click', renderClienteBuscaBody);
        el('clienteNovoConfirmarBtn').addEventListener('click', () => clienteExistente ? salvarEdicaoCliente(clienteExistente) : criarClienteInline());
        el('clienteNovoNome')?.focus();
    }

    function salvarEdicaoCliente(clienteExistente) {
        if (!clienteExistente || !clienteExistente.id) {
            modal({ message: 'Erro interno: cliente sem identificador válido. Feche esse modal e selecione o cliente de novo pela busca.' });
            return;
        }
        const nome = (el('clienteNovoNome').value || '').trim();
        if (!nome) { modal({ message: 'Digite o nome do cliente.' }); return; }
        const dados = {
            nome,
            cpf:            (el('clienteNovoCpf')?.value || '').trim() || null,
            telefone:       (el('clienteNovoTelefone')?.value || '').trim() || null,
            dataNascimento: el('clienteNovoNascimento')?.value || null,
            email:          (el('clienteNovoEmail')?.value || '').trim() || null,
            endereco:       (el('clienteNovoEndereco')?.value || '').trim() || null,
        };
        window._dbUpdate(window._lojaRef(`clientes/${clienteExistente.id}`), dados)
            .then(() => {
                Object.assign(clienteExistente, dados);
                if (clientesCache) {
                    const idx = clientesCache.findIndex(c => c.id === clienteExistente.id);
                    if (idx >= 0) clientesCache[idx] = { ...clientesCache[idx], ...dados };
                }
                selecionarCliente({ id: clienteExistente.id, nome: dados.nome });
                modal({ message: 'Cliente atualizado!' });
            })
            .catch(e => modal({ message: `Erro ao salvar cliente: ${e.message}` }));
    }

    function criarClienteInline() {
        const nome = (el('clienteNovoNome').value || '').trim();
        if (!nome) { modal({ message: 'Digite o nome do cliente.' }); return; }
        const dados = {
            nome,
            cpf:            (el('clienteNovoCpf')?.value || '').trim() || null,
            telefone:       (el('clienteNovoTelefone')?.value || '').trim() || null,
            dataNascimento: el('clienteNovoNascimento')?.value || null,
            email:          (el('clienteNovoEmail')?.value || '').trim() || null,
            endereco:       (el('clienteNovoEndereco')?.value || '').trim() || null,
            criadoEm: Date.now()
        };
        window._dbPush(window._lojaRef('clientes'), dados)
            .then(res => {
                const novo = { id: res.key, ...dados };
                if (clientesCache && !clientesCache.some(c => c.id === novo.id)) clientesCache.push(novo); // o ouvinte em tempo real pode já ter trazido
                selecionarCliente(novo);
            })
            .catch(e => modal({ message: `Erro ao cadastrar cliente: ${e.message}` }));
    }

    // ── Produto: busca → confirmar qtd/valor → entra no carrinho ──
    // ── Leitura por código de barras — compartilhada entre o campo
    //    principal (sempre visível na tela, pistola pronta assim que
    //    a página abre) e o campo dentro do modal de busca manual
    //    (caso o usuário já tenha aberto a busca e queira ler ali). ──
    function processarLeituraCodigoBarras(inputEl) {
        const codigo = inputEl.value.trim().toUpperCase();
        inputEl.value = '';
        if (!codigo) return;
        // Mesma leitura repetida em menos de 250 ms = disparo duplo da
        // pistola (uma pessoa não consegue ler o mesmo item 2x nesse
        // intervalo) — ignora, senão entraria 2x no carrinho.
        const agora = Date.now();
        if (codigo === ultimaLeitura.codigo && agora - ultimaLeitura.ts < 250) return;
        ultimaLeitura = { codigo, ts: agora };
        const produto = (window.products || []).find(p => p.codigoBarras && p.codigoBarras.trim().toUpperCase() === codigo);
        if (!produto) {
            modal({ message: `Nenhum produto cadastrado com o código "${codigo}".` });
            return;
        }
        // Cada leitura cria uma NOVA linha, mesmo se o produto já
        // estiver no carrinho — diferente de "somar quantidade",
        // porque cada unidade física pode ter cor/IMEI próprios
        // (ex: dois iPhones do mesmo modelo, cores diferentes).
        // Cai direto no carrinho já editável, sem abrir modal —
        // se não mexer em nada, fica com o preço de tabela.
        adicionarAoCarrinho(produto, 1, produto.valor || 0, produto.valor || 0, '', '');
        if (el('produtoModalBackdrop')?.classList.contains('show')) fecharModalProduto();
    }

    function abrirModalProdutoBusca() {
        el('produtoModalTitulo').textContent = 'Escolher Produto';
        renderProdutoBuscaBody();
        el('produtoModalBackdrop')?.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }
    function fecharModalProduto() {
        el('produtoModalBackdrop')?.classList.remove('show');
        window._vsDestravarScroll && window._vsDestravarScroll();
        focarPistolaSeDesktop();
    }

    let produtoListaLimite = 10;

    let produtoSoComEstoque = true; // filtro ativo por padrão — esconde produtos zerados até o usuário pedir pra ver

    function renderProdutoBuscaBody() {
        produtoListaLimite = 10;
        const bodyEl = el('produtoModalBody');
        bodyEl.innerHTML = `
            <div class="mb-2">
                <input class="form-control" id="produtoCodigoBarras" placeholder="🔫 Ler código de barras..." autocomplete="off"/>
            </div>
            <input class="form-control mb-2" id="produtoBusca" placeholder="Buscar produto..."/>
            <div class="d-flex align-items-center justify-content-between mb-2" style="padding:2px 2px;">
                <span class="text-secondary small">Mostrando só produtos com estoque</span>
                <div class="form-check form-switch m-0">
                    <input class="form-check-input" type="checkbox" id="produtoSoComEstoqueToggle" ${produtoSoComEstoque ? 'checked' : ''}/>
                </div>
            </div>
            <div id="produtoLista"></div>
        `;
        // Pistola USB (leitor HID) digita o código e manda Enter sozinha —
        // igual teclado. Enquanto não tem pistola em mãos, digitar manual
        // + Enter simula exatamente o mesmo comportamento pra teste.
        el('produtoCodigoBarras').addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            processarLeituraCodigoBarras(el('produtoCodigoBarras'));
        });
        // Mantém o foco nesse campo sempre que o modal reabre — pistola
        // de verdade precisa que o cursor já esteja aqui pra "digitar"
        // certo, sem o usuário precisar clicar antes de cada leitura.
        setTimeout(() => el('produtoCodigoBarras')?.focus(), 100);
        el('produtoBusca').addEventListener('input', () => renderProdutoLista(true));
        el('produtoSoComEstoqueToggle').addEventListener('change', e => {
            produtoSoComEstoque = e.target.checked;
            renderProdutoLista(true);
        });
        renderProdutoLista();
    }

    function renderProdutoLista(resetarLimite) {
        if (resetarLimite) produtoListaLimite = 10;
        const termo = (el('produtoBusca')?.value || '').trim().toLowerCase();
        const listEl = el('produtoLista');
        if (!listEl) return;

        const servicoHtml = !termo ? `
            <div class="apr-modal-item venda-servico-item" data-servico="1">
                <span><i class="bi bi-tools"></i> Adicionar Serviço</span>
                <i class="bi bi-chevron-right"></i>
            </div>` : '';

        const todos = (window.products || [])
            .filter(p => !termo || (p.nome || '').toLowerCase().includes(termo))
            .filter(p => !produtoSoComEstoque || (p.quantidade || 0) > 0);
        const produtos = todos.slice(0, produtoListaLimite);
        const temMais = todos.length > produtos.length;

        listEl.innerHTML = servicoHtml + (produtos.length
            ? produtos.map(p => `
                <div class="apr-modal-item" data-id="${p.id}">
                    <span>${esc(p.nome)} <span class="text-secondary small">· ${fmt(p.valor || 0)}</span></span>
                    <span class="small ${((p.quantidade || 0) <= 0) ? 'text-danger' : 'text-secondary'}">${p.quantidade ?? 0} un.</span>
                </div>`).join('')
            : (termo ? `<div class="stq-hist-empty">Nenhum produto encontrado.</div>` : ''))
            + (temMais ? `<button type="button" class="venda-ver-mais-btn" id="produtoVerMaisBtn">Ver mais (${todos.length - produtos.length} restante${todos.length - produtos.length > 1 ? 's' : ''})</button>` : '');

        listEl.querySelector('[data-servico]')?.addEventListener('click', () => abrirConfirmarServico());
        listEl.querySelectorAll('.apr-modal-item[data-id]').forEach(item => {
            item.addEventListener('click', () => {
                const p = (window.products || []).find(x => x.id === item.dataset.id);
                // Cai direto no carrinho com o preço de tabela, editável inline (cor/IMEI/preço) — igual à
                // leitura por código de barras, sem modal intermediário repetindo os mesmos campos.
                if (p) {
                    adicionarAoCarrinho(p, 1, p.valor || 0, p.valor || 0, '', '');
                    fecharModalProduto();
                }
            });
        });
        el('produtoVerMaisBtn')?.addEventListener('click', () => {
            produtoListaLimite += 20;
            renderProdutoLista(false);
        });
    }

    function abrirConfirmarServico(itemExistente, idxExistente) {
        el('produtoModalTitulo').textContent = itemExistente ? 'Editar Serviço' : 'Adicionar Serviço';
        const bodyEl = el('produtoModalBody');
        bodyEl.innerHTML = `
            <div class="stq-panel-back"><button type="button" id="servicoVoltarBuscaBtn"><i class="bi bi-arrow-left"></i> Voltar pra busca</button></div>
            <label class="form-label">Nome do serviço</label>
            <input class="form-control mb-3" id="servicoNome" placeholder="Ex: Troca de tela, mão de obra..." value="${esc(itemExistente?.produtoNome || '')}"/>
            <label class="form-label">Valor (R$)</label>
            <input class="form-control form-control-lg mb-3" id="servicoValor" type="number" step="0.01" min="0" placeholder="0,00" value="${itemExistente ? itemExistente.valorUnitario.toFixed(2) : ''}"/>
            <button type="button" class="stq-modal-btn-save w-100" id="servicoAdicionarBtn"><i class="bi bi-cart-plus-fill"></i> ${itemExistente ? 'Salvar alterações' : 'Adicionar ao Carrinho'}</button>
        `;
        el('servicoVoltarBuscaBtn').addEventListener('click', () => { el('produtoModalTitulo').textContent = 'Escolher Produto'; renderProdutoBuscaBody(); });
        el('servicoAdicionarBtn').addEventListener('click', () => {
            const nome = (el('servicoNome').value || '').trim();
            const valor = parseFloat(el('servicoValor').value) || 0;
            if (!nome) { modal({ message: 'Digite o nome do serviço.' }); return; }
            if (valor <= 0) { modal({ message: 'Informe o valor do serviço.' }); return; }
            if (itemExistente) {
                carrinho[idxExistente] = { ...itemExistente, produtoNome: nome, valorUnitario: valor };
                renderCarrinho();
            } else {
                carrinho.push({ produtoId: null, produtoNome: nome, quantidade: 1, valorUnitario: valor, estoqueAtual: Infinity, isServico: true });
                renderCarrinho();
            }
            fecharModalProduto();
        });
    }

    // Clique num item já no carrinho — reabre o modal certo (produto ou
    // serviço) já preenchido com os dados atuais, pra corrigir sem
    // precisar remover e adicionar de novo.
    function editarItemDoCarrinho(idx) {
        const item = carrinho[idx];
        if (!item || !item.isServico) return;
        el('produtoModalBackdrop')?.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
        abrirConfirmarServico(item, idx);
    }


    function adicionarAoCarrinho(produto, quantidade, valorUnitario, precoTabela, cor, obs) {
        carrinho.push({
            produtoId: produto.id,
            produtoNome: produto.nome,
            quantidade,
            valorUnitario,
            precoTabela: precoTabela ?? valorUnitario,
            estoqueAtual: produto.quantidade ?? 0,
            cor: cor || '',
            obs: obs || ''
        });
        renderCarrinho();
    }

    function removerDoCarrinho(idx) {
        carrinho.splice(idx, 1);
        renderCarrinho();
    }

    function renderCarrinho() {
        const listEl = el('vendaCarrinhoList');
        if (!listEl) return;
        if (!carrinho.length) {
            listEl.innerHTML = `<div class="venda-cart-empty">Nenhum produto adicionado ainda.</div>`;
        } else {
            listEl.innerHTML = carrinho.map((it, i) => {
                // Serviços não têm produto/cor/estoque vinculado — mantém
                // o card resumido simples de sempre (nome + valor + lixeira),
                // sem os campos inline que só fazem sentido pra produto real.
                if (it.isServico) {
                    return `
                    <div class="venda-cart-item" data-idx="${i}" style="cursor:pointer;" title="Toque para editar este serviço">
                        <div>
                            <div class="venda-cart-item-nome"><i class="bi bi-tools" style="color:var(--primary);margin-right:4px;"></i>${esc(it.produtoNome)}</div>
                            <div class="venda-cart-item-sub">Serviço · ${fmt(it.valorUnitario)}</div>
                        </div>
                        <button type="button" class="venda-cart-item-remove" data-idx="${i}"><i class="bi bi-trash-fill"></i></button>
                    </div>`;
                }

                const delta = it.valorUnitario - (it.precoTabela ?? it.valorUnitario);
                let ajusteTag = '';
                if (Math.abs(delta) > 0.009) {
                    const cor = delta > 0 ? '#22c55e' : '#ef4444';
                    const rotulo = delta > 0 ? 'acréscimo' : 'desconto';
                    ajusteTag = ` <span style="color:${cor};font-weight:700;">${delta > 0 ? '+' : '-'}${fmt(Math.abs(delta))} (${rotulo})</span>`;
                }
                return `
                <div class="venda-cart-item venda-cart-item-editavel" data-idx="${i}">
                    <div class="venda-cart-item-header">
                        <div class="venda-cart-item-nome">${esc(it.produtoNome)}${it.quantidade > 1 ? ` × ${it.quantidade}` : ''}</div>
                        <button type="button" class="venda-cart-item-remove" data-idx="${i}"><i class="bi bi-trash-fill"></i></button>
                    </div>
                    ${it.quantidade > it.estoqueAtual ? `<div class="text-danger small mb-1">Estoque insuficiente</div>` : ''}
                    <div class="venda-cart-item-campos">
                        <div class="venda-cart-campo">
                            <label>Cor</label>
                            <input class="form-control form-control-sm" data-campo="cor" data-idx="${i}" placeholder="Digite a cor..." value="${esc(it.cor || '')}"/>
                        </div>
                        <div class="venda-cart-campo">
                            <label>IMEI / Obs.</label>
                            <input class="form-control form-control-sm" data-campo="obs" data-idx="${i}" placeholder="Digite o IMEI..." value="${esc(it.obs || '')}"/>
                        </div>
                        <div class="venda-cart-campo">
                            <label>Preço${ajusteTag}</label>
                            <input class="form-control form-control-sm" data-campo="valorUnitario" data-idx="${i}" inputmode="decimal" value="${fmt(it.valorUnitario)}"/>
                        </div>
                    </div>
                </div>`;
            }).join('');

            listEl.querySelectorAll('.venda-cart-item-remove').forEach(btn => {
                btn.addEventListener('click', e => { e.stopPropagation(); removerDoCarrinho(parseInt(btn.dataset.idx, 10)); });
            });
            // Só serviços reabrem modal ao clicar — produtos reais já são
            // editáveis inline (cor/IMEI/preço direto na linha), não
            // precisam de clique nenhum.
            listEl.querySelectorAll('.venda-cart-item:not(.venda-cart-item-editavel)').forEach(cardEl => {
                cardEl.addEventListener('click', () => editarItemDoCarrinho(parseInt(cardEl.dataset.idx, 10)));
            });
            listEl.querySelectorAll('[data-campo="cor"]').forEach(inp => {
                inp.addEventListener('input', () => {
                    const idx = parseInt(inp.dataset.idx, 10);
                    carrinho[idx] = { ...carrinho[idx], cor: inp.value };
                });
            });
            listEl.querySelectorAll('[data-campo="obs"]').forEach(inp => {
                inp.addEventListener('input', () => {
                    const idx = parseInt(inp.dataset.idx, 10);
                    carrinho[idx] = { ...carrinho[idx], obs: inp.value };
                });
            });
            listEl.querySelectorAll('[data-campo="valorUnitario"]').forEach(inp => {
                // Formata como moeda ao digitar (mesmo padrão do resto do
                // app — dígitos brutos viram centavos), e recalcula o
                // total geral + a tag de acréscimo/desconto ao vivo, sem
                // precisar sair do campo pra ver o resultado.
                inp.addEventListener('input', () => {
                    const idx = parseInt(inp.dataset.idx, 10);
                    const digits = inp.value.replace(/\D/g, '');
                    const valor = digits ? parseInt(digits, 10) / 100 : 0;
                    carrinho[idx] = { ...carrinho[idx], valorUnitario: valor };
                    inp.value = valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    // Move o cursor pro fim — sem isso, editar formatação
                    // em tempo real empurra o cursor pro começo do campo.
                    requestAnimationFrame(() => inp.setSelectionRange(inp.value.length, inp.value.length));
                    renderCarrinhoResumoTotais();
                    // Atualiza só a tag de acréscimo/desconto ao lado do
                    // label, sem re-renderizar a linha toda (evita perder
                    // o foco do campo enquanto a pessoa ainda está digitando).
                    const labelEl = inp.closest('.venda-cart-campo')?.querySelector('label');
                    if (labelEl) {
                        const delta = valor - (carrinho[idx].precoTabela ?? valor);
                        if (Math.abs(delta) > 0.009) {
                            const cor = delta > 0 ? '#22c55e' : '#ef4444';
                            const rotulo = delta > 0 ? 'acréscimo' : 'desconto';
                            labelEl.innerHTML = `Preço <span style="color:${cor};font-weight:700;">${delta > 0 ? '+' : '-'}${fmt(Math.abs(delta))} (${rotulo})</span>`;
                        } else {
                            labelEl.textContent = 'Preço';
                        }
                    }
                });
            });
        }
        renderCarrinhoResumoTotais();
    }

    // Recalcula só o total geral exibido — separado de renderCarrinho()
    // pra poder ser chamado a cada tecla digitada no preço sem precisar
    // re-renderizar (e perder o foco de) todos os campos da lista.
    function renderCarrinhoResumoTotais() {
        const total = carrinho.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
        if (el('vendaTotalGeral')) el('vendaTotalGeral').textContent = fmt(total);

        // Contagem de itens no header do card "Carrinho" (ex: "2 itens")
        const countEl = el('vendaCarrinhoCount');
        if (countEl) {
            const qtdTotal = carrinho.reduce((s, it) => s + (it.quantidade || 1), 0);
            countEl.textContent = `${qtdTotal} ${qtdTotal === 1 ? 'item' : 'itens'}`;
        }

        // Lista resumida no painel lateral (nome + valor de cada item,
        // sem os campos de edição — isso já fica no card do carrinho,
        // aqui é só a conferência rápida antes de salvar).
        const resumoEl = el('vendaResumoItens');
        if (resumoEl) {
            if (!carrinho.length) {
                resumoEl.innerHTML = '';
            } else {
                resumoEl.innerHTML = carrinho.map(it => `
                    <div class="venda-resumo-row">
                        <span>${esc(it.produtoNome)}${it.quantidade > 1 ? ` × ${it.quantidade}` : ''}</span>
                        <span>${fmt(it.quantidade * it.valorUnitario)}</span>
                    </div>
                `).join('');
            }
        }
    }

    // ── Salvar (cria pendente, ou atualiza pendente existente) ─────
    // A baixa de estoque acontece AQUI, no lançamento — não espera o
    // fechamento do pagamento. Editar uma venda existente estorna os
    // itens antigos e dá baixa dos itens novos, tudo registrado no
    // histórico do produto (fica auditável).
    function salvarVenda() {
        if (!clienteSelecionado || !clienteSelecionado.id) {
            if (!carrinho.length) { modal({ message: 'Adicione pelo menos um produto ao carrinho.' }); return; }
            // Fluxo da pistola: monta o carrinho primeiro e só pergunta o cliente ao salvar. Escolher (ou
            // cadastrar) o cliente salva em seguida; fechar o seletor cancela sem salvar nada.
            abrirModalCliente();
            salvarAposEscolherCliente = true; // depois do abrir: fechar/reabrir o modal zera essa flag
            el('clienteModalTitulo').textContent = 'Quem é o cliente?';
            if (ehDesktop()) setTimeout(() => el('clienteBusca')?.focus(), 100);
            return;
        }
        if (!carrinho.length) { modal({ message: 'Adicione pelo menos um produto ao carrinho.' }); return; }

        // CORREÇÃO (A4/A5): existe uma venda desta MESMA sessão que já
        // foi gravada (passo 1 ok) mas cujo estoque não terminou de
        // sincronizar (passo 2 falhou) — intercepta ANTES de deixar
        // seguir pro fluxo normal, que criaria uma venda nova do zero
        // (duplicata). Nunca decide sozinho se o carrinho atual ainda
        // corresponde ao daquela tentativa — sempre pergunta. Só vale pra
        // venda NOVA: numa edição o Salvar é de outra venda, e a pergunta
        // "descartar e lançar nova" não faria sentido (a órfã continua
        // guardada pro próximo Salvar de venda nova).
        if (vendaOrfaPendente && !vendaEmEdicaoId) {
            modal({
                message: `A venda anterior (#${vendaOrfaPendente.numeroVenda ?? '—'}) já foi registrada, mas o estoque não terminou de atualizar — provavelmente a rede engasgou. Quer tentar sincronizar o estoque dela de novo, ou descartar essa tentativa (a venda #${vendaOrfaPendente.numeroVenda ?? '—'} fica marcada para você conferir o estoque manualmente depois) e lançar essa daqui como uma venda nova?`,
                confirmText: 'Tentar de novo',
                cancelText: 'Descartar e lançar nova',
                onConfirm: () => retomarVendaOrfa(),
                onCancel: () => { vendaOrfaPendente = null; salvarVenda(); }
            });
            return;
        }

        const seguirComEstoque = () => {
            const temEstoqueInsuficiente = carrinho.some(it => it.quantidade > it.estoqueAtual);
            if (temEstoqueInsuficiente) {
                modal({
                    message: 'Um ou mais itens do carrinho têm quantidade maior que o estoque atual — o estoque vai ficar negativo. Continuar mesmo assim?',
                    onConfirm: () => executarSalvar(),
                    onCancel: () => {}
                });
            } else {
                executarSalvar();
            }
        };

        if (vendaEmEdicaoId && statusOriginal === 'fechada') {
            modal({
                message: 'Essa venda já está fechada, com pagamento registrado. Mudar os itens/valor pode fazer o total não bater mais com o pagamento já lançado — a venda continua fechada, mas confira o pagamento depois. Continuar?',
                onConfirm: seguirComEstoque,
                onCancel: () => {}
            });
        } else {
            seguirComEstoque();
        }
    }

    function executarSalvar() {
        setSalvarBtnsLoading(true, 'Salvando...');
        const total = centavos2(carrinho.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0));

        const dataEscolhida = el('vendaDataInput')?.value;
        const agora = new Date();
        const pad = n => String(n).padStart(2, '0');
        const criadoEm = dataEscolhida
            ? new Date(`${dataEscolhida}T${pad(agora.getHours())}:${pad(agora.getMinutes())}:${pad(agora.getSeconds())}`).getTime()
            : Date.now();

        if (!vendaEmEdicaoId) {
            // PC: depois de lançar, o próximo passo natural é fechar o pagamento — vai direto pra lá
            // (navegarPara usa substituir:true, então "voltar" na tela de Fechar Venda não retorna pra
            // Lançar Venda já salva). Celular: continua indo pro Histórico.
            salvarVendaDeVerdade(total, criadoEm, 'pendente', ehDesktop() ? 'vendaFechar' : 'historicoVendas');
            return;
        }

        // Editando venda existente: confere o estado ATUAL no Firebase
        // antes de decidir — não usa mais o que foi carregado quando a
        // tela abriu. Alguém pode ter mexido nessa venda nesse meio
        // tempo (editando o pagamento em outra aba/dispositivo, por
        // exemplo); decidir com dado velho podia deixar a venda com
        // status e valor inconsistentes sem ninguém perceber.
        const edicaoId = vendaEmEdicaoId;
        window._dbGet(window._lojaRef(`vendas/${edicaoId}`)).then(snap => {
            // Trocou de tela (voltou e abriu outra venda) enquanto a
            // leitura rodava: o carrinho/cliente globais já são de outra
            // venda — salvar agora gravaria a coisa errada. Aborta.
            if (edicaoId !== vendaEmEdicaoId) { setSalvarBtnsLoading(false); return; }
            const atual = snap.val();
            if (!atual) {
                setSalvarBtnsLoading(false);
                modal({ message: 'Essa venda não existe mais — pode ter sido apagada.' });
                return;
            }
            const statusAtual = atual.status || 'pendente';
            if (statusAtual === 'cancelada') {
                setSalvarBtnsLoading(false);
                modal({ message: 'Essa venda foi cancelada enquanto você editava — não dá pra salvar.' });
                // Só chega aqui editando venda existente (vendaEmEdicaoId
                // truthy, garantido pelo retorno antecipado lá em cima) —
                // ou seja, sempre veio do Histórico. Ele já está uma
                // posição abaixo na pilha: VOLTA em vez de trocar de
                // novo pra lá (ver raciocínio completo em fechar.js).
                history.back();
                return;
            }
            // A edição ANTERIOR desta venda foi salva (PASSO 1) mas o
            // estoque não terminou de atualizar (PASSO 2) — a pendência
            // está gravada na própria venda. Editar por cima agora
            // estornaria/daria baixa sobre um estoque ainda inconsistente,
            // então primeiro termina a sincronização daquela versão (todos
            // os movimentos têm chave: o que já foi aplicado não repete).
            if (atual.estoquePendente) {
                setSalvarBtnsLoading(false);
                modal({
                    message: 'A última edição desta venda foi salva, mas o estoque não terminou de atualizar — provavelmente a rede engasgou. Quer terminar de sincronizar o estoque agora? Ou descartar essa pendência (a venda continua marcada no Histórico para você conferir o estoque manualmente)?',
                    confirmText: 'Sincronizar estoque',
                    cancelText: 'Descartar pendência',
                    onConfirm: () => retomarEdicaoPendente(edicaoId, atual),
                    onCancel: () => {
                        window._dbUpdate(window._lojaRef(`vendas/${edicaoId}`), { estoquePendente: null })
                            .then(() => modal({ message: 'Pendência descartada. A venda continua marcada no Histórico até você conferir o estoque. Clique em Salvar de novo para continuar a edição.' }))
                            .catch(e => modal({ message: `Erro ao descartar a pendência: ${e.message}` }));
                    }
                });
                return;
            }
            // CORREÇÃO (statusOriginal desatualizado — achado em revisão
            // adversarial): statusOriginal é capturado só quando a TELA
            // abre (carregarVendaParaEdicao). Se a venda for fechada em
            // OUTRO dispositivo enquanto essa tela está aberta,
            // statusAtual (recém-lido aqui) já reflete isso, mas
            // statusOriginal continuava com o valor velho ('pendente') —
            // e reabrindoPendente (mais abaixo, em salvarVendaDeVerdade)
            // decide com base em statusOriginal, não statusAtual. Sem
            // sincronizar os dois aqui, reabrir como pendente depois de
            // uma reconciliação não era reconhecido como reabertura (
            // mensagem errada, e nenhum reaproveitamento do fechadaEm
            // antigo). Mantém sempre alinhado com a leitura fresca.
            statusOriginal = statusAtual;

            if (statusAtual !== 'fechada') {
                // Ainda pendente (ou voltou a ficar pendente enquanto
                // essa tela estava aberta) — caminho normal, sem reconciliar.
                salvarVendaDeVerdade(total, criadoEm, statusAtual, 'historicoVendas');
                return;
            }
            // Fechada de verdade agora — reconcilia com o pagamento
            // ATUAL (recém-buscado), não com o que tinha quando a tela
            // abriu.
            fechadaEmOriginal = atual.fechadaEm || null;
            const pagamentosAtuais = Array.isArray(atual.pagamentos) ? atual.pagamentos : [];
            reconciliarEdicaoDeFechada(total, criadoEm, pagamentosAtuais);
        }).catch(e => {
            setSalvarBtnsLoading(false);
            modal({ message: `Erro ao verificar a venda: ${e.message}` });
        });
    }

    // ── Trocar produto/qtd/preço numa venda que JÁ ESTAVA fechada pode
    //    mudar o valorTotal, e isso pode deixar de bater com o que já
    //    foi pago. Recebe pagamentosAtuais já buscado fresco do
    //    Firebase (ver executarSalvar) — nunca decide com dado velho.
    function reconciliarEdicaoDeFechada(total, criadoEm, pagamentosAtuais) {
        const TOLERANCIA_VALOR = 0.01;
        const somaPagaAtual = pagamentosAtuais.reduce((s, p) => s + (p.valor || 0), 0);
        const diff = total - somaPagaAtual;

        if (Math.abs(diff) <= TOLERANCIA_VALOR) {
            // Continua batendo (pode ter mudado por uma troca que
            // compensou exatamente) — pergunta se reaproveita o
            // pagamento já lançado, mostrando o que já tá lá.
            const resumoPagamento = pagamentosAtuais.map(p => p.formaLabel || p.forma).join(', ') || '—';
            setSalvarBtnsLoading(false);
            modal({
                message: `O valor da venda continua batendo com o que já foi pago (${resumoPagamento}). Deseja manter esse pagamento assim?`,
                confirmText: 'Manter pagamento',
                cancelText: 'Revisar pagamento',
                onConfirm: () => salvarVendaDeVerdade(total, criadoEm, 'fechada', 'historicoVendas'),
                onCancel: () => salvarVendaDeVerdade(total, criadoEm, 'pendente', 'vendaFechar')
            });
            return;
        }

        if (diff < 0) {
            // CORREÇÃO (C5/A3 — excedente travava a venda em pendente e
            // inflava o Lucro Real): total caiu (ex: item removido) e
            // ficou MENOR que o que já foi pago/prometido. Antes, isso
            // sempre reabria a venda como pendente, esperando o Gestor
            // "ajustar o pagamento" manualmente — e enquanto isso a
            // venda ficava travada, sem fechar, mesmo o excedente sendo
            // um caso totalmente resolvível automaticamente.
            //
            // Decisão de negócio (fechada): o excedente é absorvido
            // reduzindo os PRÓPRIOS pagamentos da venda — primeiro
            // abatendo parcela de promissória ainda não paga (dívida
            // futura do cliente), só reduzindo dinheiro já recebido de
            // verdade (avulso) se não houver dívida futura suficiente
            // pra cobrir tudo. Ver window._vendaReduzirPagamentosParaNovoTotal
            // (venda/fechar.js) pro algoritmo completo.
            //
            // Reduzir o pagamento (em vez de criar um lançamento de
            // "devolução" à parte) corrige os DOIS lados com uma escrita
            // só: financeiroSyncVenda (Cloud Function) já recalcula o
            // Financeiro sozinha a partir dos pagamentos atuais, e o
            // Relatório de Vendas bebe do mesmo valorLiquidoTotal — sem
            // isso, o Lucro Real da venda ficaria inflado pelo excedente
            // não devolvido (era exatamente o bug original).
            const excedente = -diff;
            const resultado = typeof window._vendaReduzirPagamentosParaNovoTotal === 'function'
                ? window._vendaReduzirPagamentosParaNovoTotal(pagamentosAtuais, excedente)
                : { bloqueado: true, mensagem: 'Módulo de fechamento de venda não carregado — não dá pra ajustar o pagamento automaticamente.' };

            setSalvarBtnsLoading(false);

            if (resultado.bloqueado) {
                modal({
                    message: `${resultado.mensagem} A venda vai voltar a ficar pendente até você ajustar o pagamento manualmente.`,
                    confirmText: 'Ajustar pagamento',
                    onConfirm: () => salvarVendaDeVerdade(total, criadoEm, 'pendente', 'vendaFechar')
                });
                return;
            }

            // reduzirPagamentosParaNovoTotal (venda/fechar.js) já devolve
            // todo pagamento — parcelado incluso — com valorLiquido
            // realinhado à soma dos itens restantes (ou intacto, se não
            // foi tocado), então soma direto sem recalcular parcelado
            // separado.
            const novosPagamentos = resultado.pagamentos;
            const novoValorLiquidoTotal = centavos2(novosPagamentos.reduce((s, p) => s + (p.valorLiquido ?? p.valor), 0));

            modal({
                message: `O novo valor da venda (${fmt(total)}) ficou menor que o que já foi pago (${fmt(somaPagaAtual)}) — o excedente de ${fmt(excedente)} vai ser abatido automaticamente do pagamento (priorizando dívida futura não paga). A venda fecha normalmente. Continuar?`,
                confirmText: 'Confirmar e fechar',
                cancelText: 'Cancelar',
                onConfirm: () => salvarVendaDeVerdade(total, criadoEm, 'fechada', 'historicoVendas', { pagamentos: novosPagamentos, valorLiquidoTotal: novoValorLiquidoTotal })
                // Sem onCancel: o botão já foi liberado (linha acima,
                // antes do modal) — soltar de novo seria redundante.
            });
            return;
        }

        // diff > 0 — não bate mais porque FALTA pagamento (venda ficou
        // maior). Aqui sim é obrigatório o Gestor lançar mais dinheiro
        // de verdade — não tem como "inventar" um pagamento que nunca
        // aconteceu, então continua reabrindo como pendente.
        setSalvarBtnsLoading(false);
        const msg = `O novo valor da venda (${fmt(total)}) ficou maior que o que já foi pago (${fmt(somaPagaAtual)}) — ainda falta ${fmt(diff)}. A venda vai voltar a ficar pendente até você ajustar o pagamento.`;
        modal({
            message: msg,
            confirmText: 'Ajustar pagamento',
            onConfirm: () => salvarVendaDeVerdade(total, criadoEm, 'pendente', 'vendaFechar')
        });
    }

    // Revisão usada nas chaves de estoque de uma venda NOVA. Venda nova só
    // tem uma versão de estoque (a do lançamento), então a revisão é
    // fixa; numa edição cada salvamento gera a sua (salvarVendaDeVerdade).
    const REVISAO_VENDA_NOVA = 'n';

    // ── PASSO 2 do salvamento, reaproveitado pelos dois retries: aplica
    //    os movimentos de estoque de UMA versão da venda e, só se todos
    //    confirmarem, marca a venda como sincronizada.
    //      itensAntes  = [{ produtoId, quantidade }] a ESTORNAR (versão
    //                    anterior da venda; [] numa venda nova)
    //      itensDepois = [{ produtoId, quantidade }] a dar BAIXA (versão
    //                    gravada agora)
    //    Cada movimento tem uma chave fixa (vendaId + revisão + posição) e
    //    moverEstoque (estoque/produtos.js) grava o registro na mesma
    //    transaction que muda a quantidade e ignora uma chave que já
    //    existe. Então esta função pode rodar de novo sobre a MESMA
    //    versão quantas vezes precisar: Promise.all rejeita na primeira
    //    falha, mas os outros movimentos seguem em andamento e se
    //    aplicam — o retry os encontra pela chave e não repete nenhum.
    //    Os produtoId com índice usam a posição dentro de itensAntes /
    //    itensDepois, que são sempre montados na mesma ordem.
    function sincronizarEstoqueDaVenda(vendaId, revisao, itensAntes, itensDepois, clienteNome) {
        const movimentos = [];
        itensAntes.forEach((it, i) => movimentos.push(window._estoqueMoverEstoque(
            { id: it.produtoId }, it.quantidade, 'estorno',
            { cliente: clienteNome, vendaId, chaveMovimento: `${vendaId}_${revisao}_e${i}` }
        )));
        itensDepois.forEach((it, i) => movimentos.push(window._estoqueMoverEstoque(
            { id: it.produtoId }, -it.quantidade, 'saida',
            { cliente: clienteNome, vendaId, chaveMovimento: `${vendaId}_${revisao}_s${i}` }
        )));
        return Promise.all(movimentos)
            .then(() => window._dbUpdate(window._lojaRef(`vendas/${vendaId}`), { estoqueSincronizado: true, estoquePendente: null }));
    }

    // ── Retoma uma venda órfã (A4/A5) — venda NOVA que já existe (PASSO 1
    //    ok), só faltou o PASSO 2 (mover estoque). Reexecuta o PASSO 2
    //    inteiro com as MESMAS chaves da tentativa que falhou, então o
    //    que já foi aplicado vira no-op (inclusive os movimentos que o
    //    servidor aceitou mesmo com o cliente relatando falha — fila
    //    local do Realtime Database que sincroniza quando a conexão
    //    volta) e só o que faltava mexe no estoque.
    function retomarVendaOrfa() {
        const pendencia = vendaOrfaPendente;
        if (!pendencia) return;
        setSalvarBtnsLoading(true, 'Verificando estoque...');

        sincronizarEstoqueDaVenda(pendencia.vendaId, REVISAO_VENDA_NOVA, [], pendencia.itensDepois, pendencia.clienteNoMomento).then(() => {
            vendaOrfaPendente = null;
            setSalvarBtnsLoading(false);
            window._showSuccessOverlay(`Venda #${pendencia.numeroVenda ?? ''} — estoque sincronizado`, 1400).then(() => {
                if (typeof window.openVendaSection === 'function') {
                    window.openVendaSection('vendaFechar', { vendaId: pendencia.vendaId }, true);
                }
            });
        }).catch(e => {
            setSalvarBtnsLoading(false);
            // Continua pendente (vendaOrfaPendente não é limpo) — próximo
            // clique em Salvar oferece tentar de novo outra vez.
            modal({ message: `Ainda não deu pra sincronizar o estoque da venda #${pendencia.numeroVenda ?? ''} (${e.message}). Tente de novo quando a conexão estiver melhor.` });
        });
    }

    // ── Retoma a sincronização de estoque de uma EDIÇÃO cujo PASSO 2
    //    falhou. A venda carrega a própria pendência (estoquePendente =
    //    { revisao, itensAntes }, gravada junto com o PASSO 1), então isto
    //    funciona mesmo depois de sair da tela, recarregar o app ou abrir
    //    em outro aparelho. `venda` é a leitura fresca do Firebase: os
    //    itens gravados nela são exatamente a versão "depois" daquele
    //    salvamento. Não salva mais nada: terminado o estoque, a pessoa
    //    segue na tela e pode editar de novo, agora sobre uma venda
    //    consistente.
    function sincronizarEstoquePendenteDaVenda(vendaId, venda) {
        // Edição pendente: revisão e itens "antes" vêm gravados na venda. Venda nova que ficou sem o PASSO 2
        // (estoqueSincronizado:false, sem estoquePendente): revisão 'n' e nada a estornar.
        // (itensAntes pode faltar: o Firebase não guarda array vazio.)
        const pendencia = venda.estoquePendente || null;
        const itensAntes = pendencia && Array.isArray(pendencia.itensAntes) ? pendencia.itensAntes : [];
        const revisao = pendencia ? pendencia.revisao : REVISAO_VENDA_NOVA;
        const itensDepois = (venda.itens || [])
            .filter(it => it.produtoId)
            .map(it => ({ produtoId: it.produtoId, quantidade: it.quantidade }));
        return sincronizarEstoqueDaVenda(vendaId, revisao, itensAntes, itensDepois, venda.clienteNome);
    }
    // Também usada por venda/historico.js: cancelar uma venda com estoque pendente primeiro termina a
    // sincronização (idempotente) e só então devolve os itens — senão devolveria o que nunca saiu.
    window._vendaSincronizarEstoquePendente = sincronizarEstoquePendenteDaVenda;

    function retomarEdicaoPendente(vendaId, venda) {
        setSalvarBtnsLoading(true, 'Sincronizando estoque...');

        sincronizarEstoquePendenteDaVenda(vendaId, venda).then(() => {
            setSalvarBtnsLoading(false);
            window._showSuccessOverlay('Estoque sincronizado', 1400);
        }).catch(e => {
            setSalvarBtnsLoading(false);
            modal({ message: `Ainda não deu pra sincronizar o estoque desta venda (${e.message}). Tente de novo quando a conexão estiver melhor.` });
        });
    }

    // ── Salva de verdade: monta payload, reconcilia estoque, grava no
    //    Firebase e navega. Separado de executarSalvar() porque agora
    //    tem 3 caminhos possíveis (normal / mantém pagamento / reabre
    //    pendente) que só decidem PRA ONDE navegar e QUAL status final
    //    usar — o resto (estoque, payload, gravação) é sempre igual.
    //    extraPayload (opcional): campos extras pra gravar JUNTO, na
    //    mesma escrita — usado só pelo caminho de excedente reduzido
    //    (C5/A3, ver reconciliarEdicaoDeFechada), pra gravar os
    //    pagamentos já ajustados atomicamente com o resto da edição,
    //    em vez de uma segunda escrita separada (que reabriria uma
    //    janela de inconsistência se a 2ª falhasse).
    function salvarVendaDeVerdade(total, criadoEm, statusFinal, navegarPara, extraPayload) {
        setSalvarBtnsLoading(true, 'Salvando...');

        // Cópias LOCAIS do que está na tela AGORA. Tudo daqui pra baixo é
        // assíncrono (leitura dos itens originais, PASSO 1, PASSO 2) e o
        // Voltar não fica travado durante o salvamento: se o usuário sair
        // e abrir a edição de OUTRA venda enquanto isso, as variáveis
        // globais (vendaEmEdicaoId, carrinho, clienteSelecionado) já
        // valem a venda nova quando as callbacks daqui rodarem — gravaria
        // a pendência/estoque da venda errada. Por isso as callbacks só
        // usam estas cópias, nunca as globais.
        const edicaoId = vendaEmEdicaoId;
        const carrinhoSnap = carrinho.map(it => ({ ...it }));
        const clienteSnap = { ...clienteSelecionado };
        const fechadaEmSnap = fechadaEmOriginal;

        const reabrindoPendente = edicaoId && statusOriginal === 'fechada' && statusFinal === 'pendente';

        // CORREÇÃO (C4 — custo histórico reescrito por edição): antes,
        // TODA edição — mesmo só corrigir a cor ou o IMEI — regravava
        // custoUnitario com o precoCompra ATUAL do produto, porque o
        // payload.itens era sempre remontado do zero a partir de
        // window.products. Isso fazia o lucro de vendas antigas já
        // fechadas mudar sozinho quando uma reposição posterior alterava
        // a média do produto. Agora: busca os itens ORIGINAIS da venda
        // no Firebase antes de montar o payload e, pra cada linha do
        // carrinho, preserva o custoUnitario gravado na linha original
        // do MESMO produto (casamento por produtoId — o carrinho não tem
        // ID de linha próprio hoje); só tira foto nova pra linhas
        // genuinamente novas.
        //
        // Reler vendas/{id}/itens aqui é seguro porque uma edição com
        // estoque pendente nunca chega neste ponto: executarSalvar
        // detecta venda.estoquePendente e manda terminar a sincronização
        // da versão anterior antes (ver retomarEdicaoPendente) — então o
        // que está gravado é sempre o "antes de editar" de verdade.
        const preparar = edicaoId
            ? window._dbGet(window._lojaRef(`vendas/${edicaoId}/itens`)).then(snap => snap.val() || [])
            : Promise.resolve([]);

        preparar.then(itensOriginaisCompletos => {
        // Casamento do custo gravado com cada linha do carrinho, em 2 etapas:
        //  1) a linha que veio da venda gravada carrega a posição de origem (itemOrigemIdx) e recebe o
        //     original exato — assim, com duas linhas do mesmo produto e custos diferentes, remover uma
        //     não faz a outra herdar o custo errado;
        //  2) linha sem origem (ou cuja origem não bate com o produto) pega o primeiro original do mesmo
        //     produtoId que sobrou (fila por produtoId).
        const originaisReivindicados = new Set();
        const originalPorLinha = new Map();
        carrinhoSnap.forEach((it, i) => {
            const idx = it.itemOrigemIdx;
            const orig = Number.isInteger(idx) ? itensOriginaisCompletos[idx] : null;
            if (orig && (orig.produtoId ?? null) === (it.produtoId ?? null) && !originaisReivindicados.has(idx)) {
                originaisReivindicados.add(idx);
                originalPorLinha.set(i, orig);
            }
        });
        const filasOriginaisPorProduto = new Map();
        itensOriginaisCompletos.forEach((orig, idx) => {
            if (originaisReivindicados.has(idx)) return;
            const chave = orig.produtoId ?? null;
            if (!filasOriginaisPorProduto.has(chave)) filasOriginaisPorProduto.set(chave, []);
            filasOriginaisPorProduto.get(chave).push(orig);
        });
        const payload = {
            clienteId: clienteSnap.id,
            clienteNome: clienteSnap.nome,
            itens: carrinhoSnap.map((it, i) => {
                const chave = it.produtoId ?? null;
                const fila = filasOriginaisPorProduto.get(chave);
                const original = originalPorLinha.get(i) || (fila && fila.length ? fila.shift() : null);
                // original.custoUnitario pode ser: um número (custo
                // gravado), null (gravado como indefinido de propósito,
                // ver C5 abaixo), ou undefined (item LEGADO, criado antes
                // dessa coluna existir — nunca foi gravado, não é a mesma
                // coisa que "indefinido de propósito"). Só os dois
                // primeiros casos contam como "já tem uma foto pra
                // preservar" — o terceiro cai no fallback de tirar foto
                // nova do custo atual, igual uma linha genuinamente nova.
                const custoPreservado = original && original.custoUnitario !== undefined ? original.custoUnitario : undefined;
                return {
                // ?? null (não só it.produtoId direto): serviço tem
                // produtoId null, mas o Firebase APAGA campos null ao
                // salvar — então ao reler uma venda salva, esse campo
                // volta como undefined, não null. undefined faz o
                // Firebase recusar o update() inteiro. Isso aqui garante
                // que nunca mandamos undefined de volta, não importa de
                // onde o item veio.
                produtoId: it.produtoId ?? null,
                produtoNome: it.produtoNome,
                quantidade: it.quantidade,
                valorUnitario: it.valorUnitario,
                valorTotal: centavos2(it.quantidade * it.valorUnitario),
                precoTabela: it.isServico ? null : (it.precoTabela ?? it.valorUnitario),
                ajusteValor: it.isServico ? 0 : centavos2(it.valorUnitario - (it.precoTabela ?? it.valorUnitario)),
                // Foto do CUSTO no momento exato dessa venda — igual já
                // fazíamos com o preço de venda (valorUnitario/precoTabela).
                // Sem isso, o Relatório calculava lucro usando o custo
                // ATUAL do produto (window.products), não importa quando a
                // venda foi feita — então o lucro de uma venda de janeiro
                // podia "mudar sozinho" só porque uma reposição em março
                // atualizou a média do produto. Serviço não tem custo (null).
                // Linha que já existia antes da edição: preserva o custo
                // já gravado (custoPreservado), não tira foto nova.
                //
                // CORREÇÃO (C5 — custo zero silencioso): produto sem
                // precoCompra cadastrado usava `?? 0`, então uma venda de
                // R$ 2.500 de um produto sem custo virava "R$ 2.500 de
                // lucro" (100%) sem nenhum aviso — número falso, sem jeito
                // de saber depois que aquele custo nunca foi informado de
                // verdade. Agora: fica null (indefinido de verdade, não
                // "zero de verdade") e custoIndefinido:true marca a linha.
                // venda/relatorios.js (custoUnitarioDoItem) respeita essa
                // marca: custo 0 sempre, nunca cai pro custo atual do
                // produto, e itensSemCusto sinaliza a venda no relatório.
                custoUnitario: it.isServico
                    ? null
                    : (custoPreservado !== undefined ? custoPreservado : ((window.products || []).find(p => p.id === it.produtoId)?.precoCompra ?? null)),
                custoIndefinido: it.isServico
                    ? false
                    : (custoPreservado !== undefined ? (custoPreservado == null) : ((window.products || []).find(p => p.id === it.produtoId)?.precoCompra == null)),
                cor: it.cor || '',
                obs: it.obs || ''
                };
            }),
            valorTotal: total,
            status: statusFinal,
            criadoEm
        };
        // fechadaEm: preserva a data ORIGINAL enquanto continuar fechada
        // (não é um fechamento novo, é uma edição) — e se tiver
        // reabrindo como pendente, mantém o valor antigo gravado (não
        // apaga) pra reaproveitar quando fechar de novo lá no
        // fechar.js, em vez de contar como fechamento novo na data de
        // hoje. Só fica sem fechadaEm mesmo quem nunca foi fechada.
        if (statusFinal === 'fechada' && fechadaEmSnap) payload.fechadaEm = fechadaEmSnap;
        if (reabrindoPendente) payload.valorLiquidoTotal = null; // não é mais um valor válido enquanto pendente

        // CORREÇÃO (C5/A3 — excedente na edição de venda fechada): quando
        // reconciliarEdicaoDeFechada já calculou os pagamentos reduzidos
        // (excedente abatido da dívida futura / avulso, ver ali), eles
        // entram AQUI, na MESMA escrita que grava itens/total/status —
        // atomicidade: ou tudo grava junto, ou nada grava. Gravar isso
        // numa chamada separada depois arriscaria a venda ficar com o
        // total novo mas o pagamento antigo, se a segunda escrita falhasse.
        if (extraPayload && Array.isArray(extraPayload.pagamentos)) {
            payload.pagamentos = extraPayload.pagamentos;
            payload.valorLiquidoTotal = extraPayload.valorLiquidoTotal;
        }

        // Anexa quem lançou a venda — só na criação (não sobrescreve em
        // edições, mantém o registro histórico de quem lançou de fato).
        if (!edicaoId) {
            payload.criadoPorUid = window._firebaseAuthUid || null;
            payload.criadoPorNome = window._nomeUsuario || null;
            // registradoEm: quando essa venda foi REALMENTE gravada no
            // sistema pela primeira vez — nunca editável, nunca muda
            // depois disso (edições não tocam nesse campo, só ficam de
            // fora do payload delas). Existe separado de 'criadoEm' (a
            // data ESCOLHIDA da venda, que pode ser retroativa) só pra
            // ordenar o Histórico pela ordem real de lançamento. Sem
            // isso, lançar HOJE uma venda com data retroativa (pra
            // registrar algo que já tinha acontecido) fazia ela sumir lá
            // embaixo na lista, atrás de vendas mais antigas — quando na
            // real ela é a coisa mais recente que aconteceu no sistema.
            payload.registradoEm = Date.now();
        }

        // CORREÇÃO (concorrência + atomicidade):
        // (1) O estorno da edição usa os itens GRAVADOS na venda
        //     (itensOriginaisCompletos, lidos agora há pouco), não um
        //     snapshot de quando a tela abriu — se outra pessoa editou a
        //     mesma venda nesse meio-tempo, o snapshot velho estornaria de
        //     novo itens que ela já tinha estornado.
        // (2) O estoque só é mexido DEPOIS da venda gravada (PASSO 1 =
        //     venda, PASSO 2 = estoque). Se o PASSO 2 falhar, a venda já
        //     existe e fica com estoqueSincronizado:false (aviso no
        //     Histórico) — nunca estoque saindo sem venda pra explicar.
        // (3) Cada movimento leva uma CHAVE fixa (ver
        //     sincronizarEstoqueDaVenda) e moverEstoque grava o registro
        //     dentro da própria transaction do produto, então repetir um
        //     movimento já aplicado é no-op. É isso que deixa o retry
        //     seguro (retomarVendaOrfa pra venda nova, retomarEdicaoPendente
        //     pra edição): reexecuta tudo, só o que faltava mexe no estoque.
        // (4) Numa EDIÇÃO, o "antes" (itensAntes) e a revisão ficam
        //     gravados na própria venda (estoquePendente), na mesma
        //     escrita do PASSO 1 — o retry os encontra mesmo se o usuário
        //     sair da tela, recarregar o app ou abrir em outro aparelho.
        //     Sai (null) junto com estoqueSincronizado:true no PASSO 2.
        const itensAntes = itensOriginaisCompletos
            .filter(it => it.produtoId)
            .map(it => ({ produtoId: it.produtoId, quantidade: it.quantidade }));
        const itensDepois = payload.itens
            .filter(it => it.produtoId)
            .map(it => ({ produtoId: it.produtoId, quantidade: it.quantidade }));
        const revisao = edicaoId ? Date.now().toString(36) : REVISAO_VENDA_NOVA;
        if (edicaoId) payload.estoquePendente = { revisao, itensAntes };

        let idDaVendaNova = null;
        let vendaIdGravadaRef = null; // capturado assim que o PASSO 1 confirma — usado pelo catch do PASSO 2 pra saber que a venda já existe de verdade (não é falha total)
        Promise.resolve()
            .then(() => {
                // PASSO 1 — grava/atualiza a venda primeiro, ainda sem
                // mexer em estoque. payload.estoqueSincronizado marca que
                // o passo 2 (abaixo) ainda não confirmou.
                payload.estoqueSincronizado = false;
                const gravarVenda = edicaoId
                    ? window._dbUpdate(window._lojaRef(`vendas/${edicaoId}`), payload).then(() => edicaoId)
                    : window._dbTransaction(window._lojaRef('contadorVendas'), atual => (atual || 0) + 1)
                        .then(resultado => {
                            if (!resultado.committed) throw new Error('Não foi possível gerar o número da venda, tente salvar de novo.');
                            payload.numeroVenda = resultado.snapshot.val();
                            const novaRef = window._dbPush(window._lojaRef('vendas'), payload);
                            idDaVendaNova = novaRef.key;
                            return novaRef.then(() => idDaVendaNova);
                        });

                return gravarVenda.then(vendaIdGravada => {
                    vendaIdGravadaRef = vendaIdGravada;
                    // PASSO 2 — venda já existe/atualizada. Agora sim mexe
                    // no estoque (estorna o "antes", dá baixa no "depois").
                    return sincronizarEstoqueDaVenda(vendaIdGravada, revisao, itensAntes, itensDepois, clienteSnap.nome)
                        .catch(e => {
                            // Estoque falhou DEPOIS da venda já gravada — a
                            // venda continua existindo (estoqueSincronizado
                            // fica false), então isso é uma inconsistência
                            // identificável e corrigível, não um sumiço.
                            console.error('Estoque não sincronizou após salvar a venda — venda existe, requer conferência manual:', vendaIdGravada, e);
                            throw e;
                        });
                });
            })
            .then(() => {
                setSalvarBtnsLoading(false);
                const msg = reabrindoPendente
                    ? 'Venda reaberta — ajuste o pagamento'
                    : statusFinal === 'fechada'
                        ? 'Venda editada!'
                        : 'Venda lançada — estoque atualizado';
                window._showSuccessOverlay(msg, 1400).then(() => {
                    // Financeiro: sem gancho aqui — financeiroSyncVenda
                    // (Cloud Function, Admin SDK) já reage sozinha a
                    // QUALQUER escrita nessa venda, regime de caixa
                    // completo (ver functions/index.js).
                    // Editando venda existente (edicaoId truthy)
                    // e indo pro Histórico: essa tela só é alcançada
                    // partindo do Histórico, que já está uma posição
                    // abaixo na pilha — VOLTA em vez de trocar de novo
                    // pra lá (ver raciocínio completo em fechar.js).
                    // Venda NOVA (sem edição) não tem Histórico embaixo
                    // — aí sim precisa navegar/trocar de verdade. Indo
                    // pra vendaFechar (não-Histórico) também continua
                    // sendo troca normal, nunca duplica.
                    if (navegarPara === 'historicoVendas' && edicaoId) {
                        history.back();
                    } else if (typeof window.openVendaSection === 'function') {
                        const vendaIdParaAbrir = edicaoId || idDaVendaNova;
                        window.openVendaSection(navegarPara, navegarPara === 'vendaFechar' ? { vendaId: vendaIdParaAbrir } : null, true);
                    }
                });
            })
            .catch(e => {
                setSalvarBtnsLoading(false);
                if (vendaIdGravadaRef && !edicaoId) {
                    // CORREÇÃO (A4/A5): PASSO 1 teve sucesso (a venda
                    // #numeroVenda já existe de verdade no Firebase), só o
                    // PASSO 2 (estoque) falhou. Em vez de só reportar erro
                    // genérico — o que deixaria o próximo clique em
                    // "Salvar" cair no fluxo normal e criar uma SEGUNDA
                    // venda do zero — guarda a pendência (só nesta sessão,
                    // decisão de escopo confirmada) pra interceptar o
                    // próximo clique e oferecer retomar/descartar.
                    vendaOrfaPendente = {
                        vendaId: vendaIdGravadaRef,
                        numeroVenda: payload.numeroVenda,
                        itensDepois,
                        clienteNoMomento: clienteSnap.nome,
                    };
                    modal({ message: `A venda #${payload.numeroVenda ?? ''} foi registrada, mas não consegui atualizar o estoque agora (${e.message}). Clique em Salvar de novo quando a conexão voltar — o sistema vai te perguntar se quer tentar de novo ou descartar essa tentativa, sem duplicar a venda.` });
                } else if (vendaIdGravadaRef && edicaoId) {
                    // EDIÇÃO: nada a guardar em memória. A pendência já
                    // está gravada na própria venda (estoquePendente, no
                    // PASSO 1) — o próximo Salvar dela, nesta ou em outra
                    // sessão, é interceptado por executarSalvar e termina
                    // a sincronização (retomarEdicaoPendente).
                    modal({ message: `A edição foi salva, mas não consegui atualizar o estoque agora (${e.message}). A venda fica marcada no Histórico. Quando a conexão voltar, abra a edição dela e clique em Salvar: o sistema termina de acertar o estoque sem duplicar nada.` });
                } else {
                    modal({ message: `Erro ao salvar venda: ${e.message}` });
                }
            });
        }).catch(e => { setSalvarBtnsLoading(false); modal({ message: `Erro ao carregar dados da venda: ${e.message}` }); });
    }

    function resetarFormulario() {
        clienteSelecionado = null;
        carrinho = [];
        if (el('clienteChipValue')) el('clienteChipValue').textContent = 'Selecionar cliente';
        if (el('vendaDataInput')) el('vendaDataInput').value = toDateInputValue(Date.now());
        renderCarrinho();
        // Rede de segurança: se por algum motivo o botão ficou preso em
        // "Salvando..." de uma vez anterior, libera ao entrar na tela de novo.
        setSalvarBtnsLoading(false);
    }

    // Carrega uma venda pendente existente pra edição (vem do Histórico)
    function carregarVendaParaEdicao(vendaId) {
        return window._dbGet(window._lojaRef(`vendas/${vendaId}`)).then(snap => {
            const v = snap.val();
            if (!v) return;
            // Venda cancelada não se edita por aqui — nem o Histórico
            // mostra o botão pra chegar nesse estado, mas se alguém
            // chegar mesmo assim (link direto, F12...), barra aqui
            // também, sem depender só da tela anterior esconder o botão.
            if (v.status === 'cancelada') {
                modal({ message: 'Essa venda foi cancelada e não pode ser editada.' });
                // Essa função só roda vindo do Histórico (contexto com
                // vendaId, ver render() logo abaixo) — o Histórico já
                // está uma posição abaixo na pilha: VOLTA em vez de
                // trocar de novo pra lá (ver raciocínio completo em
                // fechar.js).
                history.back();
                return;
            }
            vendaEmEdicaoId = vendaId;
            statusOriginal = v.status || 'pendente';
            fechadaEmOriginal = v.fechadaEm || null;
            clienteSelecionado = { id: v.clienteId, nome: v.clienteNome };
            el('clienteChipValue').textContent = v.clienteNome;
            carrinho = (v.itens || []).map((it, idxOriginal) => ({
                // Posição da linha na venda gravada: é por ela que o custo já gravado volta pra MESMA linha
                // ao salvar (salvarVendaDeVerdade), mesmo com duas linhas do mesmo produto.
                itemOrigemIdx: idxOriginal,
                produtoId: it.produtoId ?? null,
                produtoNome: it.produtoNome,
                quantidade: it.quantidade,
                valorUnitario: it.valorUnitario,
                precoTabela: it.precoTabela ?? it.valorUnitario,
                estoqueAtual: it.produtoId ? ((window.products || []).find(p => p.id === it.produtoId)?.quantidade ?? 0) : Infinity,
                isServico: !it.produtoId,
                cor: it.cor || '',
                obs: it.obs || ''
            }));
            if (el('vendaDataInput')) el('vendaDataInput').value = toDateInputValue(v.criadoEm || Date.now());
            renderCarrinho();
            el('lancarVendaTitulo').textContent = 'Editar Venda';
        }).catch(() => {});
    }

    // ── Entrada pública ──────────────────────────────────────────
    window._renderLancarVenda = function () {
        const primeiraAbertura = !mounted;
        ensureSkeleton();
        vendaEmEdicaoId = null;
        statusOriginal = null;
        fechadaEmOriginal = null;
        resetarFormulario();
        el('lancarVendaTitulo').textContent = 'Nova Venda';

        // Pré-carrega clientes em segundo plano assim que a tela abre, não
        // só quando o modal "Escolher Cliente" é clicado — evita o "pulo"
        // de layout (input aparece, teclado sobe, e só depois a lista
        // aparece) quando o usuário abrir o seletor.
        if (!clientesCache) carregarClientes();

        const ctx = window._vendaContexto;
        if (ctx && ctx.vendaId) {
            carregarVendaParaEdicao(ctx.vendaId);
        }

        // Pistola pronta assim que a tela abre — em PC/.exe a CADA abertura; no celular só na 1ª, porque
        // focar um campo levanta o teclado.
        if (primeiraAbertura || ehDesktop()) setTimeout(focarPistola, 150);
    };
})();
