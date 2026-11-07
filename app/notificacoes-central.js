// ================================================================
// notificacoes-central.js — VortexSmart · Central de Notificações
// Expõe: window._abrirIlhaNotificacoes()
//
// Gaveta lateral (desliza da direita) com 2 grupos: as ATIVAS no
// topo, AGRUPADAS por categoria (Vendas, Concertos, Produto,
// Financeiro — só Gestor, Geral) — cada categoria com cor própria
// (mesmo sistema de cor com tema claro/escuro que os cards do hub já
// usam, .ctw-card.c-X). Categoria com mais de 1 notificação aparece
// EMPILHADA (igual notificação agrupada do Android — o card real da
// mais recente na frente, 1-2 bordas "fantasma" espiando atrás),
// toca em "Ver todas" pra desempilhar. Categoria com só 1 notificação
// mostra o card direto, sem pilha (não tem "mais atrás" pra sugerir).
// E — só se houver alguma — uma seção "Limpas" no rodapé, mostrando o
// que foi limpo nas últimas 24h (a limpeza de verdade, apagando do
// banco, roda sozinha numa Cloud Function agendada — aqui só filtra o
// que já passou de 24h, caso a função agendada ainda não tenha
// rodado nesse meio-tempo).
//
// Depende de (via window.*):
//   _notificacoesRecebidas, _onNotificacoesAtualizadas,
//   _marcarNotificacaoLida, _limparNotificacao,
//   _limparTodasNotificacoes, _vsAbrirModal, _vsFecharModal,
//   _papelUsuario, _lojaRef, _dbUpdate
// ================================================================
(function () {
    'use strict';

    const el  = id => document.getElementById(id);
    const esc = s  => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const LIMITE_24H_MS = 24 * 60 * 60 * 1000;

    // Cada tipo de notificação pertence a um GRUPO — é o grupo que
    // define a cor (não o tipo individual), pra tipos parecidos
    // (parcela, venda aberta, aniversário) ficarem visualmente juntos.
    const TIPO_GRUPO = {
        atualizacao:       'geral',
        estoqueBaixo:      'produto',
        parcelaVencendo:   'vendas',
        vendasAbertas:     'vendas',
        aniversario:       'vendas',
        reparoAtrasado:    'concertos',
        despesaRecorrente: 'financeiro',
        credscanConcluido: 'credscan',
    };
    const TIPO_ICONE = {
        atualizacao:       'bi-stars',
        estoqueBaixo:      'bi-box-seam-fill',
        parcelaVencendo:   'bi-credit-card-fill',
        vendasAbertas:     'bi-cart-fill',
        aniversario:       'bi-gift-fill',
        reparoAtrasado:    'bi-wrench-adjustable-circle-fill',
        despesaRecorrente: 'bi-arrow-repeat',
        credscanConcluido: 'bi-cpu-fill',
    };
    // Mesmas cores (com variante clara/escura) que .ctw-card.c-X já usa
    // nos cards do hub — reaproveitadas aqui pra bater com a
    // identidade visual do resto do app, não inventei nada novo.
    const GRUPO_INFO = {
        vendas:      { nome: 'Vendas',      classe: 'c-blue' },
        financeiro:  { nome: 'Financeiro',  classe: 'c-purple' },
        produto:     { nome: 'Produto',     classe: 'c-orange' },
        concertos:   { nome: 'Concertos',   classe: 'c-rose' },
        credscan:    { nome: 'CredScan',    classe: 'c-purple' },
        geral:       { nome: 'Geral',       classe: 'c-teal' },
    };
    function grupoDoTipo(tipo) { return TIPO_GRUPO[tipo] || 'geral'; }
    function iconeDoTipo(tipo) { return TIPO_ICONE[tipo] || 'bi-bell-fill'; }

    function tempoRelativo(timestamp) {
        const diffMs = Date.now() - timestamp;
        const min = Math.floor(diffMs / 60000);
        if (min < 1) return 'agora';
        if (min < 60) return `há ${min} min`;
        const h = Math.floor(min / 60);
        if (h < 24) return `há ${h}h`;
        const d = Math.floor(h / 24);
        if (d === 1) return 'ontem';
        if (d < 7) return `há ${d} dias`;
        return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }

    let painelAberto = false;
    let gruposAbertos = {};       // { [grupo]: true } — ativas desempilhadas
    let gruposLimpasAbertos = {}; // idem, mas pra seção Limpas (estado independente)

    window._abrirIlhaNotificacoes = function () {
        painelAberto = true;
        renderLista();
        el('notifDrawerOverlay')?.classList.add('active');
        if (window._vsAbrirModal) window._vsAbrirModal(fecharPainel);
    };

    // Único ponto que fecha a gaveta — cuida do visual SEMPRE primeiro,
    // e só depois avisa o sistema de navegação (_vsFecharModal), se
    // voltar). Essa ordem é o que faltava antes: eu tava chamando só
    // _vsFecharModal() direto no X/toque fora, que mexe no histórico
    // mas NUNCA esconde a gaveta sozinho — por isso ela ficava presa
    // na tela mesmo "fechando" por dentro.
    function fecharPainel() {
        painelAberto = false;
        el('notifDrawerOverlay')?.classList.remove('active');
    }
    function fecharPainelUsuario() {
        fecharPainel();
        if (window._vsFecharModal) window._vsFecharModal();
    }

    // Monta {label, executar} pra cada tipo — null quando não faz
    // sentido ter botão (ex: aviso de atualização do sistema, ou uma
    // notificação antiga sem o dado necessário salvo). O clique SEMPRE
    // fecha a gaveta antes de navegar, senão ela fica flutuando por
    // cima da tela que abriu.
    function acaoDaNotificacao(n) {
        const dados = n.dados || {};
        if (n.tipo === 'estoqueBaixo' && dados.produtoId) {
            return { label: 'Ver produto', interna: true, executar: () => window.openEstoqueSection && window.openEstoqueSection('estoqueProdutos', { produtoId: dados.produtoId }) };
        }
        if (n.tipo === 'parcelaVencendo' && dados.vendaId) {
            return { label: 'Ver venda', interna: true, executar: () => window.openVendaSection && window.openVendaSection('historicoVendas', { vendaId: dados.vendaId }) };
        }
        if (n.tipo === 'vendasAbertas') {
            return { label: 'Ver histórico', interna: true, executar: () => window.openVendaSection && window.openVendaSection('historicoVendas', null, true) };
        }
        if (n.tipo === 'aniversario' && dados.telefone) {
            const link = linkWhatsApp(dados.telefone);
            // Abre app/aba externa — não é navegação DENTRO do app, então
            // não entra no flash de teletransporte (não tem tela interna
            // pra esconder a troca, só atrasaria à toa).
            if (link) return { label: 'Abrir WhatsApp', interna: false, executar: () => window.open(link, '_blank') };
        }
        if (n.tipo === 'reparoAtrasado' && dados.repairId) {
            return { label: 'Ver OS', interna: true, executar: () => window.openReparosSection && window.openReparosSection('reparosLista', { focarId: dados.repairId }) };
        }
        if (n.tipo === 'credscanConcluido' && dados.credscanId) {
            return { label: 'Ver resultado', interna: true, executar: () => window.openCredscanSection && window.openCredscanSection('credscanDetalhe', { itemId: dados.credscanId }) };
        }
        if (n.tipo === 'despesaRecorrente') {
            return { label: 'Ver Recorrentes', interna: true, executar: () => window.openFinanceiroSection && window.openFinanceiroSection('financeiroRecorrentes', dados.recorrenteId ? { recorrenteId: dados.recorrenteId } : null) };
        }
        return null;
    }

    // Monta o link do WhatsApp a partir do telefone salvo no cadastro
    // do cliente — que pode ter vindo com parênteses/traço/espaço
    // (não tem máscara obrigatória no formulário), por isso limpa tudo
    // e só adiciona o código do Brasil (55) se ainda não tiver.
    function linkWhatsApp(telefoneRaw) {
        let digitos = String(telefoneRaw || '').replace(/\D/g, '');
        if (!digitos) return null;
        if (!digitos.startsWith('55') || digitos.length <= 11) digitos = '55' + digitos;
        return `https://wa.me/${digitos}`;
    }

    // Card de UMA notificação — reaproveitado tanto solto (grupo com 1
    // item, ou dentro da pilha desempilhada) quanto como o item da
    // FRENTE de uma pilha fechada. classeGrupo pinta o cartão inteiro
    // (fundo + borda), não só o ícone, respeitando tema claro/escuro
    // (mesma classe .ctw-card.c-X que os cards do hub já usam).
    function itemHtml(n, ehLimpa, classeGrupo) {
        const acao = ehLimpa ? null : acaoDaNotificacao(n);
        const dados = n.dados || {};
        const podeSilenciarProduto = !ehLimpa && n.tipo === 'estoqueBaixo' && dados.produtoId;
        return `
            <div class="notif-card ${classeGrupo || ''}${!ehLimpa && !n.lida ? ' nao-lida' : ''}${ehLimpa ? ' limpa' : ''}" data-id="${n.id}">
                <div class="ic"><i class="bi ${iconeDoTipo(n.tipo)}"></i></div>
                <div class="txt">
                    <div class="titulo">${esc(n.titulo)}</div>
                    <div class="sub">${esc(n.corpo)}</div>
                    <div class="tempo">${tempoRelativo(n.timestamp)}</div>
                    <div class="notif-card-acoes">
                        ${acao ? `<button type="button" class="notif-drawer-acao">${esc(acao.label)} <i class="bi bi-arrow-right"></i></button>` : ''}
                        ${podeSilenciarProduto ? `<button type="button" class="notif-drawer-acao-silenciar" data-silenciar-produto="${dados.produtoId}"><i class="bi bi-bell-slash"></i> Silenciar esse produto</button>` : ''}
                    </div>
                </div>
                ${ehLimpa ? '' : `<button type="button" class="limpar-x" data-limpar="${n.id}" title="Limpar"><i class="bi bi-x-lg"></i></button>`}
            </div>
        `;
    }

    // Brilho roxo→azul que estoura por cima da tela, escondendo o
    // instante exato da troca — chama callback() no auge do brilho
    // (quando a tela tá mais coberta), então a mudança por baixo fica
    // invisível, parece mágica em vez de corte seco.
    // Monta o HTML de todos os grupos de uma lista (ativas OU limpas).
    // ehLimpa muda o visual do estado FECHADO da pilha: ativas mostram
    // a cor real do grupo de cara; limpas ficam cinza-morto até o
    // usuário expandir (aí sim revela a cor de cada notificação) — é
    // uma seção que já é menos importante por natureza, não precisa
    // competir visualmente com as ativas.
    function montarBlocosDeGrupo(lista, ehLimpa, estadoAberto) {
        const porGrupo = {};
        lista.forEach(n => { const g = grupoDoTipo(n.tipo); (porGrupo[g] = porGrupo[g] || []).push(n); });

        return Object.keys(GRUPO_INFO).filter(g => porGrupo[g]?.length).map(g => {
            const info = GRUPO_INFO[g];
            const itens = porGrupo[g];
            const aberto = !!estadoAberto[g];
            const naoLidas = ehLimpa ? 0 : itens.filter(n => !n.lida).length;
            const classePilhaFechada = ehLimpa ? '' : info.classe;

            let corpo;
            if (itens.length === 1) {
                corpo = itemHtml(itens[0], ehLimpa, info.classe);
            } else if (!aberto) {
                corpo = `
                    <div class="notif-pilha" data-pilha="${g}" data-limpa="${ehLimpa ? '1' : '0'}">
                        ${itens.length > 2 ? `<div class="notif-pilha-fantasma f2 ${classePilhaFechada}"></div>` : ''}
                        <div class="notif-pilha-fantasma f1 ${classePilhaFechada}"></div>
                        ${itemHtml(itens[0], ehLimpa, classePilhaFechada)}
                    </div>
                `;
            } else {
                corpo = itens.map(n => itemHtml(n, ehLimpa, info.classe)).join('');
            }

            return `
                <div class="notif-grupo-label">
                    <span class="notif-grupo-nome">${info.nome}${itens.length > 1 ? ` · ${itens.length}` : ''}</span>
                    ${naoLidas ? `<span class="notif-grupo-count ${info.classe}">${naoLidas} nova(s)</span>` : ''}
                    ${itens.length > 1 ? `<button type="button" class="notif-grupo-seta ${aberto ? 'aberta' : ''}" data-toggle-grupo="${g}" data-limpa="${ehLimpa ? '1' : '0'}">${aberto ? 'Recolher' : 'Ver todas'} <i class="bi bi-chevron-right"></i></button>` : ''}
                </div>
                ${corpo}
            `;
        }).join('');
    }

    function tocarTeleporte(callback) {
        const flash = el('notifTeleportFlash');
        if (!flash) { callback(); return; }
        flash.classList.add('ativo');
        setTimeout(() => {
            callback();
            setTimeout(() => flash.classList.remove('ativo'), 80);
        }, 190);
    }

    function renderLista() {
        const box = el('notifDrawerLista');
        if (!box) return;
        const todas = window._notificacoesRecebidas || [];
        const agora = Date.now();

        const ativas = todas.filter(n => !n.limparEm);
        const limpas = todas.filter(n => n.limparEm && (agora - n.limparEm) < LIMITE_24H_MS);

        if (ativas.length === 0 && limpas.length === 0) {
            box.innerHTML = `<div class="notif-drawer-vazio"><span class="emoji">✅</span>Tudo em dia — nenhuma notificação por aqui ainda.</div>`;
            return;
        }

        let html = '';
        if (ativas.length > 0) {
            html += `<button type="button" class="notif-drawer-limpar-tudo" id="notifLimparTudoBtn">Limpar tudo</button>`;
            html += montarBlocosDeGrupo(ativas, false, gruposAbertos);
        } else {
            html += `<div class="notif-drawer-vazio"><span class="emoji">✅</span>Tudo em dia por aqui.</div>`;
        }
        if (limpas.length > 0) {
            html += `<div class="notif-drawer-sec-limpas">Limpas</div>`;
            html += montarBlocosDeGrupo(limpas, true, gruposLimpasAbertos);
        }
        box.innerHTML = html;

        el('notifLimparTudoBtn')?.addEventListener('click', () => {
            if (window._limparTodasNotificacoes) window._limparTodasNotificacoes();
        });
        box.querySelectorAll('[data-toggle-grupo]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const g = btn.dataset.toggleGrupo;
                const estado = btn.dataset.limpa === '1' ? gruposLimpasAbertos : gruposAbertos;
                estado[g] = !estado[g];
                renderLista();
            });
        });
        // Pilha fechada: tocar em qualquer lugar dela (fora dos botões
        // de ação) também desempilha — não precisa mirar certinho no
        // "Ver todas" pequeno.
        box.querySelectorAll('[data-pilha]').forEach(pilha => {
            pilha.addEventListener('click', e => {
                if (e.target.closest('.notif-drawer-acao, .notif-drawer-acao-silenciar, .limpar-x')) return;
                const estado = pilha.dataset.limpa === '1' ? gruposLimpasAbertos : gruposAbertos;
                estado[pilha.dataset.pilha] = true;
                renderLista();
            });
        });
        // Card inteiro é clicável (não só o botão "Ver X →"): marca
        // como lida e já executa a ação, igual o botão sempre fez —
        // só o botão em si tinha esse comportamento antes, agora o
        // card todo tem. Exceção: card que é a FRENTE de uma pilha
        // fechada (dentro de [data-pilha]) continua desempilhando ao
        // tocar, em vez de já pular pra UMA notificação específica
        // quando na real tem várias ali — esse caso já tem handler
        // próprio logo acima ([data-pilha]).
        box.querySelectorAll('.notif-card:not(.limpa)').forEach(card => {
            if (card.closest('[data-pilha]')) return;
            card.addEventListener('click', e => {
                if (e.target.closest('.notif-drawer-acao-silenciar, .limpar-x')) return;
                const id = card.dataset.id;
                const n = ativas.find(x => x.id === id);
                if (!n) return;
                if (!n.lida && window._marcarNotificacaoLida) window._marcarNotificacaoLida(n.id);
                // Tocar no card já limpa ela na hora — não precisa mais
                // tocar de novo no X separado. Vale pra qualquer
                // notificação, com ou sem ação de navegar (ex: aviso de
                // atualização também limpa, só não navega pra lugar
                // nenhum depois).
                if (window._limparNotificacao) window._limparNotificacao(n.id);
                const acao = acaoDaNotificacao(n);
                if (!acao) return; // sem ação pra essa notificação (ex: aviso de atualização) — já limpou, só isso mesmo
                // Fecha só o VISUAL da gaveta aqui — não usa _vsFecharModal()
                // (que mexe no histórico via history.back()) porque a ação
                // que vem a seguir (abrir Histórico/Estoque/venda) TAMBÉM
                // mexe no histórico, e os dois ao mesmo tempo cancelavam a
                // navegação um do outro (ver comentário em
                // _vsLimparModalSemVoltar no core.js).
                fecharPainel();
                if (window._vsLimparModalSemVoltar) window._vsLimparModalSemVoltar();
                if (acao.interna) tocarTeleporte(acao.executar);
                else acao.executar();
            });
        });
        box.querySelectorAll('[data-limpar]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (window._limparNotificacao) window._limparNotificacao(btn.dataset.limpar);
            });
        });
        box.querySelectorAll('[data-silenciar-produto]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const produtoId = btn.dataset.silenciarProduto;
                btn.disabled = true;
                window._dbUpdate(window._lojaRef(`products/${produtoId}`), { notificacaoEstoqueDesativada: true })
                    .then(() => { btn.innerHTML = '<i class="bi bi-check-lg"></i> Silenciado'; })
                    .catch(() => { btn.disabled = false; btn.innerHTML = '<i class="bi bi-bell-slash"></i> Silenciar esse produto'; });
            });
        });
    }

    el('notifDrawerFecharBtn')?.addEventListener('click', fecharPainelUsuario);
    el('notifDrawerOverlay')?.addEventListener('click', e => {
        if (e.target.id === 'notifDrawerOverlay') fecharPainelUsuario();
    });

    // Reflete atualizações em tempo real (nova notificação chegando,
    // outra marcada como lida/limpa) enquanto a gaveta estiver aberta.
    window._onNotificacoesAtualizadas = function () {
        if (painelAberto) renderLista();
    };
})();
