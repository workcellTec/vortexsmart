// ================================================================
// venda/historico.js — VortexSmart · Venda · Histórico
// Lista as vendas (node /vendas), mais recentes primeiro, com busca
// por cliente ou produto. Mostra status (Pendente/Fechada/Cancelada):
//   - Pendente: Editar, Documento (obriga escolher forma de pagamento
//     no Bookip antes de salvar/enviar, já que a venda ainda não tem
//     uma definida), Fechar Venda, Observação, Cancelar
//   - Fechada: Ver Parcelas, Editar, Documento, Observação, Cancelar
//   - Cancelada: só visualização (já foi estornada)
// Cancelar SEMPRE devolve o estoque de todos os itens da venda,
// registrado como 'estorno' no histórico do produto — de forma idempotente
// (chave por item) e, se o estoque da venda ainda estava pendente de
// sincronização, terminando essa sincronização antes de devolver.
// Depende de (via window.*):
//   _fmt, _lojaRef, _dbGet, _dbUpdate, _dbTransaction, openVendaSection,
//   _estoqueMoverEstoque (estoque/produtos.js),
//   _vendaSincronizarEstoquePendente (venda/lancar.js),
//   _comprimirImagem, _uploadFotoStorage, _setBtnLoading (core.js —
//   usados no comprovante de baixa de parcela)
// Expõe via window.*:
//   _renderHistoricoVendas
// ================================================================
(function () {
    'use strict';

    const esc = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t);
    const fmt = v => typeof window._fmt === 'function' ? window._fmt(v) : `R$ ${Number(v || 0).toFixed(2)}`;
    const el  = id => document.getElementById(id);
    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);

    const FORMAS_LABEL = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', parcelado: 'Parcelado' };
    // Dinheiro, Pix e cartão têm nome fixo (cartão mostra a máquina ao lado). Parcelado e as formas
    // cadastradas mostram o nome que tinham NA HORA do pagamento (formaLabel): renomear a forma depois
    // (ex: Parcelado → Promissória) vale pras vendas novas e não reescreve as antigas.
    const FORMAS_NOME_FIXO = ['dinheiro', 'pix', 'cartao', 'debito', 'credito'];
    const rotuloDaForma = p => (p.forma === 'parcelado' || !FORMAS_NOME_FIXO.includes(p.forma))
        ? (p.formaLabel || FORMAS_LABEL[p.forma] || p.forma)
        : (FORMAS_LABEL[p.forma] || p.forma);

    // Paleta por status financeiro — combinada com o usuário: vermelho
    // (aberta/nada pago), amarelo (parcial), verde (completa), azul
    // (parcelada com baixa pendente), cinza (cancelada). Usada tanto no
    // card da lista quanto nos chips de filtro (mesma cor nos dois).
    const PALETA_STATUS = {
        aberta:              { bg: 'rgba(239,68,68,.12)',  cor: '#ef4444', emoji: '🛒', label: 'Aberta' },
        parcial:             { bg: 'rgba(245,158,11,.13)', cor: '#f59e0b', emoji: '⏳', label: 'Parcial' },
        'parcelada-pendente':{ bg: 'rgba(59,130,246,.13)', cor: '#3b82f6', emoji: '📆', label: 'Parcelada' },
        completa:            { bg: 'rgba(34,197,94,.13)',  cor: '#22c55e', emoji: '✅', label: 'Fechada' },
        cancelada:           { bg: 'rgba(160,160,160,.13)', cor: '#9ca3af', emoji: '✕', label: 'Cancelada' },
    };

    let mounted = false;
    let vendasCache = null;
    let expandidaId = null;
    // Quantos cards mostrar na tela por vez — a busca/filtro continua
    // rodando em cima de TODAS as vendas já carregadas (não fica cego
    // pra nada), só a QUANTIDADE DE CARDS DESENHADOS que fica limitada.
    // É isso que evita o app travar com muita venda: criar centenas de
    // elementos na tela de uma vez é o que pesa de verdade, não ter os
    // dados na memória. "Ver mais" só aumenta esse número — não busca
    // nada de novo no Firebase, já tá tudo ali.
    let limiteExibicao = 30;

    // Quantos dias pra trás o carregamento "normal" cobre pra vendas já
    // FECHADAS/CANCELADAS — aberta/parcial/parcelada-pendente carregam
    // por completo sempre, não importa a idade (ver carregarVendas()).
    // Vendas fechadas mais antigas que isso só entram no vendasCache se
    // o usuário buscar um período que alcance elas (buscarPeriodoExtra).
    const JANELA_DIAS_FECHADAS = 60;
    let janelaCarregadaDesde = null;   // corte (timestamp) usado na última carga normal
    let periodosExtrasBuscados = [];   // [{de, ate}] já buscados nessa sessão — evita repetir a mesma busca no Firebase

    function ensureSkeleton() {
        const container = el('historicoVendas');
        if (!container || mounted) return;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Histórico</h3>
            </div>
            <div class="content-card w-100">
                <div class="pulse-hist-search-row">
                    <input class="form-control" id="histVendasBusca" placeholder="Buscar por cliente ou produto..."/>
                    <button type="button" class="pulse-icon-btn" id="histDataToggleBtn" title="Filtrar por período" aria-expanded="false"><i class="bi bi-calendar3"></i></button>
                </div>
                <div class="pulse-status-filtro-row" id="histStatusFiltroRow"></div>
                <div class="pulse-hist-date-panel" id="histDataPanel" hidden>
                    <span class="pulse-hist-date-lbl">De</span>
                    <input type="date" id="histDataDe"/>
                    <span class="pulse-hist-date-sep">→</span>
                    <span class="pulse-hist-date-lbl">Até</span>
                    <input type="date" id="histDataAte"/>
                    <button type="button" class="pulse-hist-date-clear" id="histDataLimparBtn" title="Limpar período"><i class="bi bi-x-lg"></i></button>
                </div>
                <div class="pulse-stat-strip" id="histVendasResumo"></div>
                <div id="histVendasList"></div>
            </div>
        `;
        el('histVendasBusca')?.addEventListener('input', () => { limiteExibicao = 30; renderLista(); });
        el('histDataDe')?.addEventListener('change', () => { limiteExibicao = 30; atualizarFiltroBtn(); aoMudarPeriodo(); });
        el('histDataAte')?.addEventListener('change', () => { limiteExibicao = 30; atualizarFiltroBtn(); aoMudarPeriodo(); });
        el('histDataToggleBtn')?.addEventListener('click', () => {
            const painel = el('histDataPanel');
            if (!painel) return;
            const abrir = painel.hasAttribute('hidden');
            if (abrir) painel.removeAttribute('hidden'); else painel.setAttribute('hidden', '');
            el('histDataToggleBtn')?.setAttribute('aria-expanded', String(abrir));
        });
        el('histDataLimparBtn')?.addEventListener('click', () => {
            if (el('histDataDe')) el('histDataDe').value = '';
            if (el('histDataAte')) el('histDataAte').value = '';
            el('histDataPanel')?.setAttribute('hidden', '');
            el('histDataToggleBtn')?.setAttribute('aria-expanded', 'false');
            limiteExibicao = 30;
            renderLista();
            atualizarFiltroBtn();
        });
        renderStatusFiltroRow();
        mounted = true;
    }

    // ── Chips de filtro por status financeiro (cor igual a do card) ──
    // "Todas" é o padrão — igual já era antes, esconde cancelada por
    // padrão nesse estado. Escolher um status específico (inclusive
    // Cancelada) filtra só por ele, substituindo o antigo botão único
    // de "ver canceladas".
    const STATUS_FILTRO_OPCOES = [
        { key: null,                  label: 'Todas' },
        { key: 'aberta',              label: 'Aberta' },
        { key: 'parcial',             label: 'Parcial' },
        { key: 'parcelada-pendente',  label: 'Parcelada' },
        { key: 'completa',            label: 'Fechada' },
        { key: 'cancelada',           label: 'Cancelada' },
    ];
    function renderStatusFiltroRow() {
        const row = el('histStatusFiltroRow');
        if (!row) return;
        row.innerHTML = STATUS_FILTRO_OPCOES.map(op => {
            const p = op.key ? PALETA_STATUS[op.key] : null;
            const ativo = filtroStatus === op.key;
            const cor = p ? p.cor : 'var(--primary)';
            const bg = p ? p.bg : 'rgba(var(--primary-rgb),.12)';
            return `<button type="button" class="pulse-status-filtro-chip ${ativo ? 'active' : ''}" data-status="${op.key ?? ''}"
                style="${ativo ? `background:${bg};border-color:${cor};color:${cor};` : ''}">${op.label}</button>`;
        }).join('');
        row.querySelectorAll('[data-status]').forEach(btn => {
            btn.addEventListener('click', () => {
                filtroStatus = btn.dataset.status || null;
                limiteExibicao = 30;
                renderStatusFiltroRow();
                renderLista();
            });
        });
    }

    function atualizarFiltroBtn() {
        const ativo = !!(el('histDataDe')?.value || el('histDataAte')?.value);
        el('histDataToggleBtn')?.classList.toggle('active', ativo);
    }

    // Transforma o objeto cru do Firebase (chave => venda) em array
    // normalizado, SEM ordenar ainda (ordenação acontece uma vez só,
    // depois de já ter combinado todas as fontes — ver ordenarCache).
    function mapObjParaLista(data) {
        return data ? Object.keys(data).map(k => ({ id: k, ...normalizarVenda(data[k]) })) : [];
    }

    // Ordena pela ordem REAL de lançamento, não por criadoEm (a data
    // escolhida da venda, que pode ser retroativa):
    //  1º numeroVenda — contador atômico que só cresce, sempre na
    //     ordem real de gravação. Existe em toda venda feita pelo
    //     sistema (inclusive as antigas), então corrige o problema
    //     retroativamente, não só daqui pra frente.
    //  2º registradoEm — mesma ideia, só que é o timestamp; só usado
    //     se por algum motivo faltar numeroVenda.
    //  3º criadoEm — último fallback, pra venda muito antiga que não
    //     tenha nem um nem outro.
    function ordenarCache() {
        vendasCache.sort((a, b) => {
            if (a.numeroVenda != null && b.numeroVenda != null) return b.numeroVenda - a.numeroVenda;
            return (b.registradoEm || b.criadoEm || 0) - (a.registradoEm || a.criadoEm || 0);
        });
    }

    // Junta uma lista nova no vendasCache, sem duplicar por id (uma
    // venda que já tava carregada e voltou numa busca extra só
    // atualiza os dados, não vira uma segunda entrada).
    function mesclarNoCache(lista) {
        if (!vendasCache) vendasCache = [];
        const porId = new Map(vendasCache.map(v => [v.id, v]));
        lista.forEach(v => porId.set(v.id, v));
        vendasCache = Array.from(porId.values());
        ordenarCache();
    }

    // silencioso: releitura em segundo plano (venda mudou em outro computador) — sem o "Carregando...", sem
    // descartar o que já está na tela (buscas por período, cache) e sem esvaziar a lista se a leitura falhar.
    function carregarVendas(opcoes) {
        const silencioso = !!(opcoes && opcoes.silencioso) && !!vendasCache;
        const listEl = el('histVendasList');
        if (!silencioso) {
            if (listEl) listEl.innerHTML = `<div class="stq-hist-loading">Carregando vendas...</div>`;
            periodosExtrasBuscados = [];
        }

        // Funcionário PRECISA pedir com essa query exata (orderByChild
        // + equalTo no próprio uid) — é o que a regra de segurança do
        // servidor exige pra liberar leitura (ver firebase-rules-saas.json).
        // Pedir o node inteiro sem essa query dá PERMISSION_DENIED pra
        // quem não é Gestor, de propósito.
        // ⚠️ Vendas lançadas ANTES dessa mudança não têm criadoPorUid
        // gravado — pra um Funcionário, elas ficam invisíveis (a query
        // nunca bate com undefined). Só o Gestor continua vendo essas
        // vendas antigas, porque ele lê o node inteiro sem filtro.
        //
        // Exceção "Gestor libera": Funcionário com a permissão
        // 'vendas_ver_todas' ligada lê o node inteiro igual ao Gestor —
        // pensado pra ele enxergar vendas dos colegas quando o Gestor
        // decidir liberar isso especificamente. Depende da regra do
        // Firebase também aceitar essa condição (pendente, ver
        // firebase-rules-saas.json) — enquanto a regra não sobe, essa
        // permissão fica sem efeito prático (a leitura ainda seria
        // negada no servidor), mas o app já fica pronto pro dia que subir.
        const ehGestor = typeof window._papelAtual === 'function' ? window._papelAtual() === 'gestor' : true;
        const veTodas = ehGestor || (typeof window._temPermissao === 'function' && window._temPermissao('vendas_ver_todas'));

        if (!veTodas) {
            // Volume de vendas de UM funcionário só tende a ser pequeno
            // (é uma fração da loja inteira) — não compensa a
            // complexidade das 2 queries aqui, mantém como sempre foi.
            const query = window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('criadoPorUid'), window._dbEqualTo(window._firebaseAuthUid));
            return window._dbGet(query).then(snap => {
                if (silencioso) mesclarNoCache(mapObjParaLista(snap.val()));
                else { vendasCache = mapObjParaLista(snap.val()); ordenarCache(); }
            }).catch(e => {
                console.error('[Histórico] Erro ao carregar vendas — papel: funcionario | uid usado na query:', window._firebaseAuthUid, '| erro:', e);
                if (!silencioso) vendasCache = [];
            });
        }

        // Gestor (ou "vê todas"): em vez de puxar o node "vendas" inteiro
        // da loja (o que ficaria enorme com o tempo), 2 buscas mais
        // enxutas em paralelo:
        //   A) TUDO que ainda está em aberto (aberta/parcial/parcelada-
        //      -pendente) — precisa aparecer sempre, não importa a idade.
        //      Depende do campo "emAberto" gravado pela Cloud Function
        //      vendaCalcularStatus (functions/index.js).
        //   B) Qualquer venda (de qualquer status) dos últimos
        //      JANELA_DIAS_FECHADAS dias — cobre fechada/cancelada
        //      recente sem puxar o histórico inteiro da loja.
        // Uma venda que bate nas duas é mesclada por id, sem duplicar.
        janelaCarregadaDesde = Date.now() - JANELA_DIAS_FECHADAS * 24 * 60 * 60 * 1000;
        const queryAbertas = window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('emAberto'), window._dbEqualTo(true));
        const queryRecentes = window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('criadoEm'), window._dbStartAt(janelaCarregadaDesde));

        return Promise.all([
            window._dbGet(queryAbertas).catch(e => { console.error('[Histórico] Erro ao carregar vendas em aberto:', e); return null; }),
            window._dbGet(queryRecentes).catch(e => { console.error('[Histórico] Erro ao carregar vendas recentes:', e); return null; }),
        ]).then(([snapAbertas, snapRecentes]) => {
            if (!silencioso) vendasCache = [];
            mesclarNoCache(mapObjParaLista(snapAbertas && snapAbertas.val()));
            mesclarNoCache(mapObjParaLista(snapRecentes && snapRecentes.val()));
        });
    }

    // Chamado quando o usuário mexe no filtro de período (De/Até).
    // Se o "De" pedir uma data mais antiga do que a janela normal já
    // carregada, dispara uma busca extra pontual só daquele intervalo
    // (por isso a busca "acha qualquer venda, dado um período" mesmo
    // sem carregar a loja inteira o tempo todo).
    function aoMudarPeriodo() {
        const deStr = el('histDataDe')?.value;
        const ateStr = el('histDataAte')?.value;
        const deTs = deStr ? new Date(`${deStr}T00:00:00`).getTime() : null;

        if (!deTs || !janelaCarregadaDesde || deTs >= janelaCarregadaDesde) {
            renderLista();
            return;
        }
        const ateTs = ateStr ? new Date(`${ateStr}T23:59:59`).getTime() : janelaCarregadaDesde - 1;
        const jaBuscado = periodosExtrasBuscados.some(p => deTs >= p.de && ateTs <= p.ate);
        if (jaBuscado) { renderLista(); return; }

        const listEl = el('histVendasList');
        if (listEl) listEl.innerHTML = `<div class="stq-hist-loading">Buscando vendas do período...</div>`;

        const query = window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('criadoEm'), window._dbStartAt(deTs), window._dbEndAt(ateTs));
        window._dbGet(query).then(snap => {
            mesclarNoCache(mapObjParaLista(snap.val()));
            periodosExtrasBuscados.push({ de: deTs, ate: ateTs });
            renderLista();
        }).catch(e => {
            console.error('[Histórico] Erro ao buscar vendas do período estendido:', e);
            renderLista();
        });
    }

    // Aceita formatos antigos (venda de produto único, sem status) sem quebrar.
    function normalizarVenda(v) {
        const itens = Array.isArray(v.itens) ? v.itens : (v.produtoNome ? [{ produtoNome: v.produtoNome, quantidade: v.quantidade, valorUnitario: v.valorVendido, valorTotal: v.valorVendido }] : []);
        return {
            ...v,
            itens,
            valorTotal: v.valorTotal ?? v.valorVendido ?? 0,
            status: v.status || 'fechada' // vendas antigas (sem esse campo) eram sempre fechadas na hora
        };
    }

    let filtroStatus = null; // null = "Todas" | 'aberta' | 'parcial' | 'parcelada-pendente' | 'completa' | 'cancelada'

    function renderLista() {
        const listEl = el('histVendasList');
        const resumoEl = el('histVendasResumo');
        if (!listEl || !vendasCache) return;

        const termo = (el('histVendasBusca')?.value || '').trim().toLowerCase();
        const dataDeStr = el('histDataDe')?.value;
        const dataAteStr = el('histDataAte')?.value;
        // "De" começa às 00:00 do dia escolhido; "Até" vai até 23:59:59 do dia escolhido
        const dataDeTs = dataDeStr ? new Date(`${dataDeStr}T00:00:00`).getTime() : null;
        const dataAteTs = dataAteStr ? new Date(`${dataAteStr}T23:59:59`).getTime() : null;

        const vendas = vendasCache.filter(v => {
            const statusFin = calcularStatusFinanceiro(v);
            if (filtroStatus) {
                if (statusFin !== filtroStatus) return false;
            } else if (statusFin === 'cancelada') {
                return false; // "Todas" continua escondendo cancelada por padrão, igual sempre foi
            }
            const bateTexto = !termo ||
                (v.clienteNome || '').toLowerCase().includes(termo) ||
                v.itens.some(it => (it.produtoNome || '').toLowerCase().includes(termo));
            const bateData =
                (!dataDeTs || (v.criadoEm || 0) >= dataDeTs) &&
                (!dataAteTs || (v.criadoEm || 0) <= dataAteTs);
            return bateTexto && bateData;
        });

        // O resumo (os 3 numerozinhos) é calculado sempre em cima do
        // vendasCache INTEIRO, não da lista já filtrada por busca/chip —
        // são números fixos de referência, não um total do que tá na
        // tela no momento. Cada um só usa dados que o carregamento
        // GARANTE estar completo, pra nunca mentir:
        //   • Vendas (mês) / Fechado (mês) — só olham o mês atual, que
        //     sempre está dentro da janela normal carregada.
        //   • Pendentes — aberta+parcial (vermelho+amarelo) carregam
        //     por completo sempre, então esse número vale pra loja
        //     inteira, não só pro mês.
        const agora = new Date();
        const inicioMesTs = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0).getTime();
        const podeVerValorFechado = typeof window._temPermissao === 'function' ? window._temPermissao('vendas_ver_valor_fechado') : true;
        const vendasDoMes = vendasCache.filter(v => v.status !== 'cancelada' && (v.criadoEm || 0) >= inicioMesTs).length;
        const pendentes = vendasCache.filter(v => {
            const sf = calcularStatusFinanceiro(v);
            return sf === 'aberta' || sf === 'parcial';
        }).length;
        const totalFechadoMes = vendasCache
            .filter(v => v.status === 'fechada' && (v.criadoEm || 0) >= inicioMesTs)
            .reduce((s, v) => s + (v.valorTotal || 0), 0);
        if (resumoEl) {
            resumoEl.innerHTML = vendasCache.length ? `
                <div class="pulse-stat-mini"><div class="n">${vendasDoMes}</div><div class="l">Venda${vendasDoMes === 1 ? '' : 's'} (mês)</div></div>
                <div class="pulse-stat-mini"><div class="n">${pendentes}</div><div class="l">Pendente${pendentes === 1 ? '' : 's'}</div></div>
                ${podeVerValorFechado ? `<div class="pulse-stat-mini"><div class="n success">${fmt(totalFechadoMes)}</div><div class="l">Fechado (mês)</div></div>` : ''}
            ` : '';
        }

        if (!vendas.length) {
            listEl.innerHTML = `<div class="stq-hist-empty"><i class="bi bi-cart-x"></i><br/>Nenhuma venda encontrada.</div>`;
            return;
        }

        const vendasParaExibir = vendas.slice(0, limiteExibicao);
        const restantes = vendas.length - vendasParaExibir.length;

        const podeParcelas = typeof window._temPermissao === 'function' ? window._temPermissao('vendas_ver_parcelas') : true;
        const podeEditarFechada = typeof window._temPermissao === 'function' ? window._temPermissao('vendas_editar_fechada') : true;
        const podeCancelar = typeof window._temPermissao === 'function' ? window._temPermissao('vendas_cancelar') : true;
        listEl.innerHTML = vendasParaExibir.map(v => {
            const expandida = expandidaId === v.id;
            const pendente = v.status === 'pendente';
            const cancelada = v.status === 'cancelada';
            const statusFin = calcularStatusFinanceiro(v);
            const p = PALETA_STATUS[statusFin];
            // Número da venda: usa o contador sequencial (numeroVenda,
            // gravado via transaction no lancar.js) quando existe; vendas
            // antigas (de antes dessa mudança) caem pro ID curto do
            // Firebase como fallback, pra não ficar sem nenhum número.
            const numeroExibido = v.numeroVenda ? `#${v.numeroVenda}` : `#${v.id.slice(-6).toUpperCase()}`;
            const dataHoraStr = new Date(v.criadoEm || 0).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
            const nomeVendedor = v.criadoPorNome ? esc(v.criadoPorNome) : '—';
            const somaPaga = (v.pagamentos || []).reduce((s, pg) => s + (pg.valor || 0), 0);
            const valorPendente = Math.max(0, (v.valorTotal || 0) - somaPaga);
            // "Valor pendente" só faz sentido pra parcial/aberta — pra
            // parcelada-pendente o valor combinado já entrou em
            // somaPaga (dá 0 aqui, ia confundir), quem mostra o que
            // falta de verdade é o botão Parcelas (X/Y pagas).
            const mostraPendente = statusFin === 'parcial' || statusFin === 'aberta';
            // CORREÇÃO (A4/A5 — clonagem de venda em falha de rede): uma
            // venda com estoqueSincronizado === false (explicitamente
            // false, não apenas ausente — vendas de antes dessa correção
            // nem têm esse campo, e ausência não significa problema)
            // teve o PASSO 2 (baixa/estorno de estoque) interrompido no
            // meio — a venda existe, mas o estoque físico pode estar
            // divergente do sistema. Tag visível já no card fechado (não
            // precisa expandir pra notar) — é justamente esse tipo de
            // inconsistência silenciosa que fica invisível pra sempre
            // sem um aviso, mesmo depois da causa raiz ser corrigida
            // (vendas antigas, já gravadas com o bug, continuam com o
            // campo assim até alguém conferir manualmente).
            const furoDeEstoque = v.estoqueSincronizado === false;
            return `
                <div class="pulse-sale-row pulse-sale-row-lg" data-id="${v.id}" style="flex-direction:column;align-items:stretch;border-left:4px solid ${p.cor};--glow-cor:${p.cor};${cancelada ? 'opacity:.6;' : ''}">
                    <div style="display:flex;align-items:flex-start;gap:13px;cursor:pointer;" data-action="toggle">
                        <div class="pulse-icon-box pulse-icon-box-lg" style="background:${p.bg};color:${p.cor};">${p.emoji}</div>
                        <div style="flex:1;min-width:0;">
                            <div class="pulse-sale-title-row">
                                <div class="pulse-sale-title pulse-sale-title-lg">${esc(v.clienteNome)}</div>
                                <div class="pulse-sale-valor" style="color:${p.cor};">${fmt(v.valorTotal)}</div>
                            </div>
                            ${furoDeEstoque ? `<div style="margin-top:2px;"><span style="display:inline-flex;align-items:center;gap:4px;font-size:.66rem;font-weight:800;color:#fff;background:#dc2626;padding:2px 8px;border-radius:999px;">⚠️ Furo de Estoque</span></div>` : ''}
                            <div class="pulse-sale-sub pulse-sale-sub-lg"><span class="pulse-sale-meta-num">${numeroExibido}</span> · ${dataHoraStr} · ${nomeVendedor}${v.origemReparoId ? ' · <span style="color:var(--acento-hero-2);">🔧 via Concertos</span>' : ''}</div>
                        </div>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex-shrink:0;">
                            <span class="pulse-status-pill" style="background:${p.bg};color:${p.cor};">${p.label}</span>
                            <i class="bi bi-chevron-${expandida ? 'up' : 'down'}" style="color:var(--text-secondary);opacity:.5;font-size:.85rem;"></i>
                        </div>
                    </div>
                    ${expandida ? `
                    <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
                        ${furoDeEstoque ? `
                            <div style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:8px 10px;font-size:.72rem;font-weight:600;margin-bottom:10px;">
                                ⚠️ A baixa/estorno de estoque dessa venda não terminou de sincronizar (rede caiu no meio do lançamento ou de uma edição). O estoque físico do(s) produto(s) desta venda pode estar divergente — confira e ajuste manualmente em Estoque se necessário.
                            </div>` : ''}
                        ${mostraPendente ? `
                            <div class="pulse-pendente-row" style="background:${p.bg};color:${p.cor};">
                                <span class="lbl">Valor pendente</span>
                                <span>${fmt(valorPendente)}</span>
                            </div>` : ''}
                        ${v.itens.map(it => `
                            <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-secondary);padding:4px 0;">
                                <span>${esc(it.produtoNome)} × ${it.quantidade}</span>
                                <span>${fmt(it.valorTotal ?? (it.quantidade * it.valorUnitario))}</span>
                            </div>`).join('')}
                        ${!cancelada && (v.pagamentos || []).length ? `
                            <div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">
                                <div class="stq-hist-sub mb-1">Pagamento</div>
                                ${v.pagamentos.map(p2 => `
                                    <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--success);padding:2px 0;">
                                        <span>${esc(rotuloDaForma(p2))}${p2.maquina ? ` <span class="text-secondary">(${p2.forma === 'debito' ? 'déb.' : p2.parcelas + 'x'})</span>` : ''}${p2.forma === 'parcelado' ? ` <span class="text-secondary">(${p2.parcelas}x)</span>` : ''}${p2.criadoEm ? ` <span class="text-secondary">· ${new Date(p2.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>` : ''}</span>
                                        <span>${fmt(p2.valor)}</span>
                                    </div>`).join('')}
                                ${v.valorLiquidoTotal != null ? `
                                <div style="display:flex;justify-content:space-between;font-size:.7rem;color:var(--text-secondary);padding:4px 0 0;margin-top:4px;border-top:1px dashed var(--border);">
                                    <span>Líquido recebido</span>
                                    <span style="font-weight:700;">${fmt(v.valorLiquidoTotal)}</span>
                                </div>` : ''}
                            </div>` : ''}
                        ${!cancelada ? `
                            <div class="venda-panel-actions">
                                ${pendente ? `
                                    <button type="button" class="stq-panel-btn editar" data-action="editar"><i class="bi bi-pencil-fill"></i>Editar</button>
                                    <button type="button" class="stq-panel-btn hist" data-action="garantia"><i class="bi bi-file-earmark-text-fill"></i>Documento</button>
                                    <button type="button" class="stq-panel-btn add" data-action="fechar"><i class="bi bi-lock-fill"></i>Receber pagamento</button>
                                ` : `
                                    ${podeParcelas ? `<button type="button" class="stq-panel-btn hist" data-action="parcelas"><i class="bi bi-list-ol"></i>Parcelas</button>` : ''}
                                    ${podeEditarFechada ? `<button type="button" class="stq-panel-btn editar" data-action="editar-fechada-escolha"><i class="bi bi-pencil-fill"></i>Editar</button>` : ''}
                                    <button type="button" class="stq-panel-btn add" data-action="garantia"><i class="bi bi-file-earmark-text-fill"></i>Documento PDF</button>
                                    ${typeof window._reciboTermicoDisponivel === 'function' && window._reciboTermicoDisponivel() ? `<button type="button" class="stq-panel-btn hist" data-action="imprimir-recibo"><i class="bi bi-printer-fill"></i>Gerar recibo</button>` : ''}
                                `}
                                <button type="button" class="stq-panel-btn obs" data-action="observacao"><i class="bi bi-chat-left-text-fill"></i>Obs.</button>
                                ${podeCancelar ? `<button type="button" class="stq-panel-btn apagar" data-action="cancelar"><i class="bi bi-x-circle-fill"></i>Cancelar</button>` : ''}
                            </div>
                        ` : `<div class="stq-hist-sub mt-2"><i class="bi bi-arrow-counterclockwise"></i> Estoque devolvido ao cancelar.</div>`}
                        ${v.observacao ? `<div class="stq-hist-sub mt-2" style="font-style:italic;"><i class="bi bi-chat-left-text"></i> ${esc(v.observacao)}</div>` : ''}
                    </div>` : ''}
                </div>`;
        }).join('') + (restantes > 0 ? `
            <button type="button" class="stq-ver-mais-btn" id="histVerMaisBtn">
                Ver mais ${Math.min(restantes, 30)} ${restantes > 30 ? `(${restantes} restantes)` : ''}
            </button>` : '');

        el('histVerMaisBtn')?.addEventListener('click', () => {
            limiteExibicao += 30;
            renderLista();
        });

        listEl.querySelectorAll('.pulse-sale-row').forEach(itemEl => {
            const id = itemEl.dataset.id;
            itemEl.querySelector('[data-action="toggle"]').addEventListener('click', () => {
                expandidaId = expandidaId === id ? null : id;
                renderLista();
            });
            itemEl.querySelector('[data-action="editar"]')?.addEventListener('click', e => {
                e.stopPropagation();
                window.openVendaSection('lancarVenda', { vendaId: id });
            });
            itemEl.querySelector('[data-action="fechar"]')?.addEventListener('click', e => {
                e.stopPropagation();
                window.openVendaSection('vendaFechar', { vendaId: id });
            });
            itemEl.querySelector('[data-action="editar-fechada-escolha"]')?.addEventListener('click', e => {
                e.stopPropagation();
                abrirEscolhaEdicaoFechada(id);
            });
            itemEl.querySelector('[data-action="cancelar"]')?.addEventListener('click', e => {
                e.stopPropagation();
                cancelarVenda(id);
            });
            itemEl.querySelector('[data-action="garantia"]')?.addEventListener('click', e => {
                e.stopPropagation();
                abrirGarantiaVenda(id);
            });
            itemEl.querySelector('[data-action="imprimir-recibo"]')?.addEventListener('click', e => {
                e.stopPropagation();
                const venda = vendasCache.find(v => v.id === id);
                if (venda && typeof window._imprimirReciboTermico === 'function') {
                    window._imprimirReciboTermico(venda);
                }
            });
            itemEl.querySelector('[data-action="parcelas"]')?.addEventListener('click', e => {
                e.stopPropagation();
                verParcelas(id);
            });
            itemEl.querySelector('[data-action="observacao"]')?.addEventListener('click', e => {
                e.stopPropagation();
                abrirObservacao(id);
            });
        });
    }

    // ── Ver Parcelas — pra vendas fechadas com pagamento parcelado
    //    (ex: promissória, controle de crediário) ──────────────────
    // ── Ver/Marcar Parcelas — só "Parcelado" (promissória) conta aqui,
    //    parcelamento no cartão é taxa de máquina, outra coisa. ────────
    function verParcelas(vendaId) {
        const venda = (vendasCache || []).find(v => v.id === vendaId);
        if (!venda) return;
        const parcelados = (venda.pagamentos || [])
            .map((p, pIdx) => ({ ...p, pIdx }))
            .filter(p => p.forma === 'parcelado');
        if (!parcelados.length) { modal({ message: 'Essa venda não tem pagamento parcelado (promissória) — só à vista ou no cartão.', onConfirm: () => {} }); return; }

        let backdrop = el('vendaParcelasBackdrop');
        if (!backdrop) {
            document.body.insertAdjacentHTML('beforeend', `
                <div class="stq-modal-backdrop" id="vendaParcelasBackdrop">
                    <div class="stq-modal-card">
                        <div class="stq-modal-header primary">
                            <div class="stq-modal-header-title">Parcelas</div>
                            <button class="stq-modal-close" id="vendaParcelasClose"><i class="bi bi-x-lg"></i></button>
                        </div>
                        <div class="stq-modal-body" id="vendaParcelasBody"></div>
                    </div>
                </div>`);
            backdrop = el('vendaParcelasBackdrop');
            el('vendaParcelasClose').addEventListener('click', () => { backdrop.classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); });
            backdrop.addEventListener('click', e => { if (e.target === backdrop) { backdrop.classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); } });
        }
        renderParcelasBody(vendaId);
        backdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }

    function renderParcelasBody(vendaId) {
        const venda = (vendasCache || []).find(v => v.id === vendaId);
        const bodyEl = el('vendaParcelasBody');
        if (!venda || !bodyEl) return;
        const parcelados = (venda.pagamentos || [])
            .map((p, pIdx) => ({ ...p, pIdx }))
            .filter(p => p.forma === 'parcelado');
        const podeBaixarParcela = typeof window._temPermissao === 'function' ? window._temPermissao('vendas_baixa_parcela') : true;

        bodyEl.innerHTML = parcelados.map(p => {
            if (!Array.isArray(p.itens)) {
                return `<div class="stq-hist-sub mb-2">Parcelamento antigo (lançado antes do controle por parcela) — ${p.parcelas}x de ${fmt(p.valor / p.parcelas)}, sem controle individual.</div>`;
            }
            return p.itens.map((it, iIdx) => `
                <div class="apr-modal-item venda-parcela-item ${it.paga ? 'paga' : ''}" data-pidx="${p.pIdx}" data-iidx="${iIdx}" style="${podeBaixarParcela ? '' : 'cursor:default;'}">
                    <span>${it.numero}/${p.parcelas} · ${fmt(it.valor)} <span class="text-secondary small">· vence ${new Date(it.vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}</span></span>
                    <span class="venda-parcela-right">
                        ${it.paga && it.comprovanteUrl ? `<button type="button" class="venda-parcela-comprovante-btn" data-comprovante="${esc(it.comprovanteUrl)}" title="Ver comprovante"><i class="bi bi-image"></i></button>` : ''}
                        <span class="venda-parcela-status">${it.paga ? `<i class="bi bi-check-circle-fill"></i> ${new Date(it.pagaEm).toLocaleDateString('pt-BR')}` : (podeBaixarParcela ? 'Marcar paga' : 'Pendente')}</span>
                    </span>
                </div>`).join('');
        }).join('');

        bodyEl.querySelectorAll('[data-comprovante]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                window.open(btn.dataset.comprovante, '_blank');
            });
        });

        if (podeBaixarParcela) {
            bodyEl.querySelectorAll('[data-pidx]').forEach(row => {
                row.addEventListener('click', () => confirmarToggleParcela(vendaId, parseInt(row.dataset.pidx, 10), parseInt(row.dataset.iidx, 10)));
            });
        }
    }

    function confirmarToggleParcela(vendaId, pIdx, iIdx) {
        const venda = (vendasCache || []).find(v => v.id === vendaId);
        const item = venda?.pagamentos?.[pIdx]?.itens?.[iIdx];
        if (!item) return;
        if (!item.paga) {
            // Marcar como paga — abre o modal rico com opção de anexar
            // foto do comprovante (câmera/galeria), igual ao padrão já
            // usado no Financeiro (financeiro/lancamentos.js).
            abrirModalBaixaParcela(vendaId, pIdx, iIdx);
            return;
        }
        // Desfazer pagamento — não precisa de comprovante, confirmação simples.
        modal({
            message: `Desfazer o pagamento da parcela ${item.numero}/${venda.pagamentos[pIdx].parcelas}?`,
            confirmText: 'Desfazer',
            onConfirm: () => toggleParcelaPaga(vendaId, pIdx, iIdx, null)
        });
    }

    // ── Modal de baixa de parcela — com anexo opcional de comprovante ──
    let baixaParcelaFotoBlob = null;
    function abrirModalBaixaParcela(vendaId, pIdx, iIdx) {
        const venda = (vendasCache || []).find(v => v.id === vendaId);
        const item = venda?.pagamentos?.[pIdx]?.itens?.[iIdx];
        if (!item) return;
        baixaParcelaFotoBlob = null;

        let backdrop = el('vendaBaixaParcelaBackdrop');
        if (!backdrop) {
            document.body.insertAdjacentHTML('beforeend', `
                <div class="stq-modal-backdrop" id="vendaBaixaParcelaBackdrop">
                    <div class="stq-modal-card">
                        <div class="stq-modal-header primary">
                            <div class="stq-modal-header-title">Marcar parcela paga</div>
                            <button class="stq-modal-close" id="vendaBaixaParcelaClose"><i class="bi bi-x-lg"></i></button>
                        </div>
                        <div class="stq-modal-body" id="vendaBaixaParcelaBody"></div>
                    </div>
                </div>`);
            backdrop = el('vendaBaixaParcelaBackdrop');
            const fechar = () => { backdrop.classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); };
            el('vendaBaixaParcelaClose').addEventListener('click', fechar);
            backdrop.addEventListener('click', e => { if (e.target === backdrop) fechar(); });
        }

        el('vendaBaixaParcelaBody').innerHTML = `
            <p style="font-size:.82rem;color:var(--text);margin-bottom:12px;">Marcar a parcela ${item.numero}/${venda.pagamentos[pIdx].parcelas} (${fmt(item.valor)}) como paga?</p>
            <label class="form-label" style="margin-top:0;"><i class="bi bi-camera-fill"></i> Comprovante (opcional)</label>
            <div class="row g-2 mb-1">
                <div class="col-6"><button class="btn btn-secondary w-100" type="button" id="baixaParcelaFotoCam" style="border-style:dashed;"><i class="bi bi-camera-fill text-success"></i> Tirar foto</button></div>
                <div class="col-6"><button class="btn btn-secondary w-100" type="button" id="baixaParcelaFotoGal" style="border-style:dashed;"><i class="bi bi-image-fill text-success"></i> Galeria</button></div>
            </div>
            <input type="file" accept="image/*" capture="environment" id="baixaParcelaFotoInputCam" class="hidden">
            <input type="file" accept="image/*" id="baixaParcelaFotoInputGal" class="hidden">
            <img id="baixaParcelaFotoPreview" style="display:none;max-width:140px;border-radius:10px;margin-bottom:10px;">
            <button type="button" class="stq-panel-btn add" style="width:100%;justify-content:center;" id="baixaParcelaConfirmarBtn"><i class="bi bi-check-lg"></i> Marcar como paga</button>
        `;

        function handleFoto(e) {
            const file = e.target.files?.[0];
            if (!file) return;
            baixaParcelaFotoBlob = file;
            const preview = el('baixaParcelaFotoPreview');
            const reader = new FileReader();
            reader.onload = ev => { preview.src = ev.target.result; preview.style.display = 'block'; };
            reader.readAsDataURL(file);
        }
        el('baixaParcelaFotoInputCam').addEventListener('change', handleFoto);
        el('baixaParcelaFotoInputGal').addEventListener('change', handleFoto);
        el('baixaParcelaFotoCam').addEventListener('click', () => el('baixaParcelaFotoInputCam').click());
        el('baixaParcelaFotoGal').addEventListener('click', () => el('baixaParcelaFotoInputGal').click());
        el('baixaParcelaConfirmarBtn').addEventListener('click', () => confirmarBaixaParcela(vendaId, pIdx, iIdx, backdrop));

        backdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }

    function confirmarBaixaParcela(vendaId, pIdx, iIdx, backdrop) {
        const btn = el('baixaParcelaConfirmarBtn');
        const fechar = () => { backdrop.classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); };

        const finalizar = comprovanteUrl => {
            fechar();
            toggleParcelaPaga(vendaId, pIdx, iIdx, comprovanteUrl);
        };

        if (baixaParcelaFotoBlob && window._comprimirImagem && window._uploadFotoStorage) {
            window._setBtnLoading && window._setBtnLoading(btn, true, 'Enviando...');
            window._comprimirImagem(baixaParcelaFotoBlob)
                .then(blob => window._uploadFotoStorage(blob, `vendas/${vendaId}/parcelas/p${pIdx}_i${iIdx}.jpg`))
                .then(finalizar)
                .catch(e => {
                    console.error('[Parcelas] Erro ao subir comprovante:', e);
                    // Sobe a foto falhou, mas isso não pode travar a baixa da
                    // parcela — segue marcando como paga sem o comprovante,
                    // em vez de fingir que nada foi confirmado.
                    modal({ message: 'Não deu pra salvar a foto do comprovante, mas a parcela vai ser marcada como paga mesmo assim.', onConfirm: () => finalizar(null) });
                });
        } else {
            finalizar(null);
        }
    }

    function toggleParcelaPaga(vendaId, pIdx, iIdx, comprovanteUrl) {
        const venda = (vendasCache || []).find(v => v.id === vendaId);
        const item = venda?.pagamentos?.[pIdx]?.itens?.[iIdx];
        if (!item) return;
        const novoPaga = !item.paga;
        const updates = { paga: novoPaga };
        if (novoPaga) {
            updates.pagaEm = Date.now();
            if (comprovanteUrl) updates.comprovanteUrl = comprovanteUrl;
        } else {
            // Revogação: guarda QUANDO foi revogada (pra timeline conseguir
            // mostrar o evento riscado), sem apagar pagaEm — assim ainda dá
            // pra saber que já tinha sido paga em algum momento antes.
            updates.revogadaEm = Date.now();
        }
        window._dbUpdate(window._lojaRef(`vendas/${vendaId}/pagamentos/${pIdx}/itens/${iIdx}`), updates).then(() => {
            item.paga = novoPaga;
            if (novoPaga) { item.pagaEm = updates.pagaEm; item.revogadaEm = null; if (comprovanteUrl) item.comprovanteUrl = comprovanteUrl; }
            else { item.revogadaEm = updates.revogadaEm; }
            renderParcelasBody(vendaId);
            renderLista();
            if (novoPaga && typeof window._showSuccessOverlay === 'function') {
                window._showSuccessOverlay('Parcela paga!');
            }
        }).catch(e => modal({ message: `Erro ao atualizar parcela: ${e.message}` }));
    }

    // Conta parcelas pagas/total de uma venda (só onde tem controle individual)
    function contarParcelas(venda) {
        let pagas = 0, total = 0;
        (venda.pagamentos || []).forEach(p => {
            if (p.forma === 'parcelado' && Array.isArray(p.itens)) {
                total += p.itens.length;
                pagas += p.itens.filter(it => it.paga).length;
            }
        });
        return { pagas, total };
    }

    // Calcula o status financeiro visual de uma venda (cor do card),
    // em ordem de prioridade combinada:
    //   1. Cancelada — sempre cinza, vence tudo.
    //   2. Azul   — tem parcelamento (promissória) com pelo menos 1
    //      parcela ainda não paga (precisa de baixa manual). PRECISA
    //      vir antes do "completa" — o valor cheio do parcelamento já
    //      entra em somaPaga assim que a venda fecha (é o valor
    //      combinado, não o que já foi recebido de fato), então se
    //      "completa" fosse checado primeiro toda venda parcelada
    //      apareceria verde na hora, mesmo sem nenhuma parcela paga.
    //   3. Verde  — soma paga >= total (fechada de verdade, à vista
    //      ou parcelas todas quitadas).
    //   4. Amarelo — soma paga > 0 mas < total, sem parcelamento
    //      pendente (pagamento parcial simples).
    //   5. Vermelho — nada pago ainda (venda aberta).
    // 'pendente' (rascunho, sem nenhum pagamento definido) sempre cai
    // em vermelho por soma zero, então não precisa de caso especial.
    function calcularStatusFinanceiro(venda) {
        if (venda.status === 'cancelada') return 'cancelada';
        const { pagas, total: totalParcelas } = contarParcelas(venda);
        if (totalParcelas > 0 && pagas < totalParcelas) return 'parcelada-pendente';
        const somaPaga = (venda.pagamentos || []).reduce((s, p) => s + (p.valor || 0), 0);
        const total = venda.valorTotal || 0;
        if (total > 0 && somaPaga >= total) return 'completa';
        if (somaPaga > 0) return 'parcial';
        return 'aberta';
    }

    // ── Escolha de edição pra venda fechada: Cliente/Produto ou
    //    Pagamento. Um botão só, um modal só — os dois caminhos usam a
    //    MESMA permissão (vendas_editar_fechada), então não faz sentido
    //    ter dois botões perguntando a mesma coisa duas vezes.
    function abrirEscolhaEdicaoFechada(vendaId) {
        let backdrop = el('vendaEscolhaEdicaoBackdrop');
        if (!backdrop) {
            document.body.insertAdjacentHTML('beforeend', `
                <div class="stq-modal-backdrop" id="vendaEscolhaEdicaoBackdrop">
                    <div class="stq-modal-card">
                        <div class="stq-modal-header primary">
                            <div class="stq-modal-header-title">O que editar?</div>
                            <button class="stq-modal-close" id="vendaEscolhaEdicaoClose"><i class="bi bi-x-lg"></i></button>
                        </div>
                        <div class="stq-modal-body">
                            <div class="apr-modal-item" data-opcao="produto" style="border:1px solid rgba(var(--overlay-rgb),.06);margin-bottom:6px;">
                                <span><i class="bi bi-box-seam-fill" style="margin-right:8px;color:var(--primary);"></i>Cliente / Produto</span>
                                <i class="bi bi-chevron-right"></i>
                            </div>
                            <div class="apr-modal-item" data-opcao="pagamento" style="border:1px solid rgba(var(--overlay-rgb),.06);">
                                <span><i class="bi bi-credit-card-2-front-fill" style="margin-right:8px;color:var(--primary);"></i>Pagamento</span>
                                <i class="bi bi-chevron-right"></i>
                            </div>
                        </div>
                    </div>
                </div>`);
            backdrop = el('vendaEscolhaEdicaoBackdrop');
            el('vendaEscolhaEdicaoClose').addEventListener('click', () => { backdrop.classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); });
            backdrop.addEventListener('click', e => { if (e.target === backdrop) { backdrop.classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); } });
        }
        backdrop.querySelectorAll('[data-opcao]').forEach(item => {
            item.onclick = () => {
                backdrop.classList.remove('show');
                window._vsDestravarScroll && window._vsDestravarScroll();
                const secao = item.dataset.opcao === 'produto' ? 'lancarVenda' : 'vendaFechar';
                window.openVendaSection(secao, { vendaId });
            };
        });
        backdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }

    // ── Observação livre (pendente ou fechada) ─────────────────────
    function abrirObservacao(vendaId) {
        const venda = (vendasCache || []).find(v => v.id === vendaId);
        if (!venda) return;
        let backdrop = el('vendaObsBackdrop');
        if (!backdrop) {
            document.body.insertAdjacentHTML('beforeend', `
                <div class="stq-modal-backdrop" id="vendaObsBackdrop">
                    <div class="stq-modal-card">
                        <div class="stq-modal-header primary">
                            <div class="stq-modal-header-title">Observação</div>
                            <button class="stq-modal-close" id="vendaObsClose"><i class="bi bi-x-lg"></i></button>
                        </div>
                        <div class="stq-modal-body">
                            <textarea class="form-control mb-3" id="vendaObsTexto" rows="4" placeholder="Ex: cliente pediu pra entregar sexta-feira..."></textarea>
                            <button type="button" class="stq-modal-btn-save w-100" id="vendaObsSalvarBtn"><i class="bi bi-check-lg"></i> Salvar</button>
                        </div>
                    </div>
                </div>`);
            backdrop = el('vendaObsBackdrop');
            el('vendaObsClose').addEventListener('click', () => { backdrop.classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); });
            backdrop.addEventListener('click', e => { if (e.target === backdrop) { backdrop.classList.remove('show'); window._vsDestravarScroll && window._vsDestravarScroll(); } });
        }
        el('vendaObsTexto').value = venda.observacao || '';
        el('vendaObsSalvarBtn').onclick = () => {
            const texto = el('vendaObsTexto').value.trim();
            window._dbUpdate(window._lojaRef(`vendas/${vendaId}`), { observacao: texto || null })
                .then(() => {
                    backdrop.classList.remove('show');
                    window._vsDestravarScroll && window._vsDestravarScroll();
                    carregarVendas().then(renderLista);
                })
                .catch(e => modal({ message: `Erro ao salvar observação: ${e.message}` }));
        };
        backdrop.classList.add('show');
        window._vsTravarScroll && window._vsTravarScroll();
    }

    // ── Gerar Garantia (Bookip) a partir de uma venda ───────────────
    // Busca o cadastro completo do cliente (cpf/tel/nascimento/email/
    // endereço) pra levar tudo pronto — a garantia usa o valor CHEIO
    // (bruto) dos itens, nunca o líquido descontado da taxa.
    //
    // Venda FECHADA: já tem forma de pagamento definida, então oferece
    // "Gerar direto" (usa o que a venda já tem) ou "Editar antes".
    //
    // Venda PENDENTE (ainda não fechada): não existe forma de pagamento
    // definida ainda, então NÃO oferece "Gerar direto" — manda sempre
    // pro editor com exigirPagamento=true, que trava o Salvar/Enviar do
    // Bookip até o usuário marcar a forma de pagamento manualmente
    // (ver bookip.js → aplicarContextoVenda/saveGarantia).
    function abrirGarantiaVenda(vendaId) {
        const venda = (vendasCache || []).find(v => v.id === vendaId);
        if (!venda) return;
        const pendente = venda.status === 'pendente';

        window._dbGet(window._lojaRef(`clientes/${venda.clienteId}`)).then(snap => {
            const cliente = snap.val() || {};
            const resumo = `${venda.itens.length} item(ns) · ${fmt(venda.valorTotal)}`;

            if (pendente) {
                modal({
                    message: `Documento (garantia) pra ${esc(venda.clienteNome)} — ${resumo}. Edite e adicione a forma de pagamento antes de enviar.`,
                    confirmText: 'Editar documento',
                    onConfirm: () => {
                        prepararContextoBookip(venda, cliente, false, true);
                        navegarParaBookip();
                    }
                });
                return;
            }

            modal({
                message: `Documento (garantia) pra ${esc(venda.clienteNome)} — ${resumo}. Gerar direto, ou editar antes?`,
                confirmText: 'Gerar',
                cancelText: 'Editar antes',
                onConfirm: () => {
                    prepararContextoBookip(venda, cliente, true);
                    navegarParaBookip();
                },
                onCancel: () => {
                    prepararContextoBookip(venda, cliente, false);
                    navegarParaBookip();
                }
            });
        }).catch(() => {
            prepararContextoBookip(venda, {}, false, pendente);
            navegarParaBookip();
        });
    }

    function prepararContextoBookip(venda, cliente, gerarDireto, exigirPagamento = false) {
        const deConcerto = !!venda.origemReparoId;
        window._bookipContexto = {
            nome: venda.clienteNome,
            cpf: cliente.cpf || '',
            tel: cliente.telefone || '',
            dataNascimento: cliente.dataNascimento || '',
            email: cliente.email || '',
            end: cliente.endereco || '',
            gerarDireto,
            // Sinaliza pro Bookip que essa venda ainda não tem forma de
            // pagamento definida (veio pendente) — ele bloqueia salvar/
            // enviar até o usuário marcar uma manualmente.
            exigirPagamento,
            tipoTermo: deConcerto ? 'concerto' : 'venda',
            formasPagamento: (venda.pagamentos || []).map(p => p.forma),
            // Vendas normais só levam item de PRODUTO pro documento de
            // garantia (produtoId truthy) — mas uma venda de concerto é
            // feita inteira de item de SERVIÇO (produtoId null), então
            // pra ela o filtro precisa deixar passar também, senão o
            // documento chegaria sem nenhum item.
            items: venda.itens.filter(it => it.produtoId || deConcerto).map(it => ({
                nome: it.produtoNome,
                valor: it.valorUnitario,
                qtd: it.quantidade,
                cor: it.cor || '',
                obs: it.obs || ''
            }))
        };
    }

    function navegarParaBookip() {
        if (typeof window.showMainSection === 'function') window.showMainSection('documentos');
        if (typeof window.openDocumentosSection === 'function') window.openDocumentosSection('documentosGarantia');
    }

    // Cancelamento em duas camadas:
    //  1) Reivindicação por transaction no status (venda → 'cancelando'): impede dois cancelamentos
    //     simultâneos (duplo clique, ou dois computadores/aparelhos). A reivindicação expira
    //     (CANCELANDO_EXPIRA_MS) — se a conexão cair no meio e o status ficar preso em 'cancelando',
    //     tentar de novo depois funciona.
    //  2) Devolução idempotente: cada item tem chave própria (vendaId + posição + produto + quantidade) e
    //     moverEstoque ignora chave já aplicada — repetir um cancelamento interrompido devolve só o que
    //     faltou, nunca em dobro. Se o estoque da venda ainda estava pendente de sincronização
    //     (salvamento interrompido), essa sincronização termina ANTES de devolver; senão voltaria pro
    //     estoque o que nunca saiu.
    const CANCELANDO_EXPIRA_MS = 2 * 60 * 1000;
    function cancelarVenda(vendaId) {
        const venda = (vendasCache || []).find(v => v.id === vendaId);
        if (!venda) return;
        modal({
            message: `Cancelar a venda de ${esc(venda.clienteNome)} (${fmt(venda.valorTotal)})? O estoque de todos os itens volta pro sistema.`,
            onConfirm: () => {
                const vendaRef = window._lojaRef(`vendas/${vendaId}`);
                let statusAntes = null; // status de antes da reivindicação (volta pra ele se o cancelamento falhar)
                // Reconsulta a venda de dentro da transaction (nunca vendasCache, que pode estar desatualizado).
                window._dbTransaction(vendaRef, atual => {
                    if (atual === null) return null; // cache frio — null faz o SDK reexecutar com o dado real (undefined abortaria)
                    if (atual.status === 'cancelada') return undefined;
                    if (atual.status === 'cancelando' && Date.now() - (atual.cancelandoEm || 0) < CANCELANDO_EXPIRA_MS) return undefined;
                    statusAntes = atual.status === 'cancelando' ? (atual.statusAntesCancelar || 'fechada') : atual.status;
                    return { ...atual, status: 'cancelando', cancelandoEm: Date.now(), statusAntesCancelar: statusAntes };
                }).then(result => {
                    if (!result.committed || !result.snapshot.exists()) {
                        modal({ message: 'Essa venda já está sendo cancelada (ou já foi cancelada) em outra tela.' });
                        carregarVendas().then(renderLista);
                        return Promise.reject(new Error('__silencioso__')); // não cai no catch genérico de erro
                    }
                    const vendaReal = result.snapshot.val();

                    // PASSO 1 — termina a sincronização de estoque pendente, se houver.
                    const estoquePendente = !!vendaReal.estoquePendente || vendaReal.estoqueSincronizado === false;
                    const sincronizar = estoquePendente && typeof window._vendaSincronizarEstoquePendente === 'function'
                        ? window._vendaSincronizarEstoquePendente(vendaId, vendaReal)
                        : Promise.resolve();

                    // PASSO 2 — devolve cada item, individualmente. Produto excluído do catálogo é falha
                    // definitiva (registrada e avisada, sem travar o resto); qualquer outro erro (rede) aborta
                    // o cancelamento inteiro, e tentar de novo continua de onde parou, sem duplicar.
                    const itens = (vendaReal.itens || []).map((it, i) => ({ it, i })).filter(x => x.it.produtoId);
                    return sincronizar.then(() => Promise.allSettled(
                        itens.map(({ it, i }) => window._estoqueMoverEstoque({ id: it.produtoId }, it.quantidade, 'estorno', {
                            cliente: vendaReal.clienteNome, vendaId,
                            chaveMovimento: `${vendaId}_c${i}_${it.produtoId}_${it.quantidade}`
                        }))
                    )).then(resultados => {
                        const falhas = resultados
                            .map((r, i) => ({ r, item: itens[i].it }))
                            .filter(x => x.r.status === 'rejected');
                        const erroTransitorio = falhas.find(f => !(f.r.reason && f.r.reason.message === 'Produto não encontrado.'));
                        if (erroTransitorio) throw erroTransitorio.r.reason;
                        return window._dbUpdate(vendaRef, {
                            status: 'cancelada', canceladaEm: Date.now(), estoqueSincronizado: true, estoquePendente: null,
                            cancelandoEm: null, statusAntesCancelar: null
                        }).then(() => falhas);
                    });
                })
                .then(falhas => {
                    // Financeiro: tira AGORA tudo que essa venda tinha
                    // gerado no caixa (pagamentos avulsos 'venda_{id}_p…'
                    // e cada parcela paga 'venda_{id}_p…_i…') — sem esperar
                    // a Cloud Function. Só o Gestor consegue escrever em
                    // financeiro/; se quem cancelou for Funcionário, o
                    // reconciliador de financeiro/lancamentos.js limpa na
                    // próxima vez que o Gestor abrir o Financeiro.
                    const prefixoVenda = `venda_${vendaId}`;
                    const limpezaFinanceiro = window._financeiroRemoverAutomaticos
                        ? window._financeiroRemoverAutomaticos(k => k === prefixoVenda || k.indexOf(`${prefixoVenda}_`) === 0).catch(e => { console.error('[Histórico] Erro ao limpar financeiro da venda cancelada:', e); })
                        : Promise.resolve();
                    // Confere o que ficou gravado: se algo (ex: Cloud
                    // Function de status) devolveu a venda pra outro
                    // status, avisa em vez de dizer que cancelou.
                    return Promise.all([
                        limpezaFinanceiro,
                        new Promise(r => setTimeout(r, 2000)) // dá tempo de qualquer reação do servidor chegar antes de conferir
                            .then(() => window._dbGet(window._lojaRef(`vendas/${vendaId}/status`)))
                            .then(s => s.val()).catch(() => 'cancelada')
                    ]).then(([, statusFinal]) => ({ falhas, statusFinal }));
                })
                .then(resultado => {
                    const { falhas, statusFinal } = resultado;
                    if (statusFinal !== 'cancelada') {
                        modal({ message: `⚠️ O cancelamento foi gravado, mas a venda voltou para o status "${esc(statusFinal || 'desconhecido')}" logo depois — algo no servidor (Cloud Function) está desfazendo o cancelamento. O estoque JÁ foi devolvido; não cancele de novo.` });
                        carregarVendas().then(renderLista);
                        return;
                    }
                    if (falhas.length) {
                        const nomes = falhas.map(f => f.item.produtoNome || f.item.produtoId).join(', ');
                        modal({ message: `Venda cancelada, mas o estoque de "${esc(nomes)}" não pôde ser devolvido automaticamente (produto pode ter sido excluído do catálogo) — ajuste manual pode ser necessário.` });
                    } else {
                        modal({ message: '✅ Venda cancelada e estoque devolvido!' });
                    }
                    carregarVendas().then(renderLista);
                })
                .catch(e => {
                    if (e && e.message === '__silencioso__') return;
                    // Falhou no meio: solta a reivindicação pra poder tentar de novo na hora. O que já foi
                    // devolvido fica registrado por chave, então a nova tentativa não duplica nada.
                    const soltar = statusAntes
                        ? window._dbUpdate(vendaRef, { status: statusAntes, cancelandoEm: null, statusAntesCancelar: null }).catch(() => {})
                        : Promise.resolve();
                    soltar.then(() => {
                        modal({ message: `Erro ao cancelar venda: ${esc(e && e.message)}. Nada foi duplicado — pode tentar de novo.` });
                        carregarVendas().then(renderLista);
                    });
                });
            },
            onCancel: () => {}
        });
    }

    // Tempo real: venda nova/paga/cancelada em OUTRO computador atualiza a lista aberta sozinha.
    let aoVivoRegistrado = false;
    let atualizandoAoVivo = false;
    let novaAtualizacaoPendente = false;
    function atualizarAoVivo() {
        const secao = el('historicoVendas');
        if (!mounted || !el('histVendasList') || !vendasCache || (secao && secao.style.display === 'none')) return;
        if (atualizandoAoVivo) { novaAtualizacaoPendente = true; return; } // não empilha leituras
        atualizandoAoVivo = true;
        carregarVendas({ silencioso: true }).then(renderLista).catch(() => {}).then(() => {
            atualizandoAoVivo = false;
            if (novaAtualizacaoPendente) { novaAtualizacaoPendente = false; atualizarAoVivo(); }
        });
    }

    window._renderHistoricoVendas = function () {
        ensureSkeleton();
        if (!aoVivoRegistrado && typeof window._aoMudarVendas === 'function') { window._aoMudarVendas(atualizarAoVivo); aoVivoRegistrado = true; }
        // Veio de uma notificação (Parcela vencendo, por exemplo) com
        // uma venda específica em mente — abre já com ela expandida e
        // rolada até a tela, em vez de cair na lista genérica do topo.
        const alvo = window._vendaContexto && window._vendaContexto.vendaId;
        expandidaId = alvo || null;
        if (alvo) filtroStatus = null; // garante que nenhum filtro deixado ligado esconda a venda-alvo
        window._vendaContexto = null; // consumido — não deve persistir se o usuário navegar de novo depois
        carregarVendas().then(() => {
            if (!alvo) return null;
            // Garante que a venda-alvo apareça mesmo que ela esteja além
            // do limite normal de paginação (ex: venda antiga, enterrada
            // lá embaixo na lista ordenada).
            const idxCarregada = vendasCache.findIndex(v => v.id === alvo);
            if (idxCarregada >= 0) {
                if (idxCarregada >= limiteExibicao) limiteExibicao = idxCarregada + 1;
                return null;
            }
            // Não veio nem na leva "em aberto" nem nos últimos 2 meses —
            // caso raro (ex: notificação antiga apontando pra uma venda
            // já fechada há mais tempo), busca ela direto pelo id em vez
            // de simplesmente não achar.
            return window._dbGet(window._lojaRef(`vendas/${alvo}`)).then(snap => {
                const v = snap.val();
                if (v) mesclarNoCache([{ id: alvo, ...normalizarVenda(v) }]);
                const idx = vendasCache.findIndex(x => x.id === alvo);
                if (idx >= 0 && idx >= limiteExibicao) limiteExibicao = idx + 1;
            }).catch(e => console.error('[Histórico] Erro ao buscar venda-alvo da notificação:', e));
        }).then(() => {
            renderLista();
            if (alvo) {
                setTimeout(() => {
                    const elAlvo = document.querySelector(`#histVendasList [data-id="${alvo}"]`);
                    elAlvo?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    elAlvo?.classList.add('destaque-notificacao');
                    setTimeout(() => elAlvo?.classList.remove('destaque-notificacao'), 2400);
                }, 120);
            }
        });
    };
})();