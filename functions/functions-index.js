// ================================================================
// functions/index.js — VortexSmart SaaS · Cloud Functions
//
// 3 funções, todas "callable" (chamadas direto do app via SDK, sem
// precisar montar fetch/HTTP manual):
//
//   criarLoja(nomeLoja, emailGestor, senhaGestor, nomeGestor)
//     — SÓ o admin (você) chama. Cria a loja + o usuário Gestor.
//
//   criarFuncionario(nomeFuncionario, emailFuncionario, senhaFuncionario)
//     — o Gestor chama, logado, pela tela de Configurações → Usuários.
//     Cria o funcionário JÁ vinculado à mesma loja do Gestor que
//     chamou, respeitando o limite de 3 funcionários por loja.
//
//   atualizarPermissoesFuncionario(funcionarioUid, permissoes)
//     — o Gestor chama pra ligar/desligar as permissões granulares
//     (módulos + ações específicas, ver CHAVES_VALIDAS abaixo) de um
//     funcionário da PRÓPRIA loja.
//
// Por que Cloud Function e não o SDK client-side direto:
//   1. Criar usuário no Firebase Auth pelo client DESLOGA quem está
//      criando (limitação conhecida do SDK) — aqui roda no servidor,
//      com Admin SDK, sem afetar a sessão de quem chamou.
//   2. Só assim dá pra checar "é admin?" ou "é gestor da loja X?"
//      de forma confiável antes de criar algo — checagem no client
//      pode ser burlada, checagem aqui não.
//
// Depende de (no projeto Firebase):
//   - Realtime Database em /usuarios/{uid} e /lojas/{lojaId}/...
//   - Regras de segurança (firebase-rules-saas.json) já publicadas
//
// Setup necessário antes do deploy (rodar uma vez, no Termux):
//   cd functions && npm install firebase-admin firebase-functions
// ================================================================

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onValueWritten } = require('firebase-functions/v2/database');

initializeApp();
const auth = getAuth();
const db = getDatabase();
const messaging = getMessaging();

// ── Lista de UIDs com permissão de admin (você) ───────────────────
// Depois de criar SEU PRÓPRIO usuário admin (ver instruções no chat),
// troca esse UID pelo real. Pode ter mais de um se precisar.
const ADMIN_UIDS = [
    'wZnsRcmzZeZaQ5NHGnNBg1jAEwz1',
];

function ehAdmin(uid) {
    return ADMIN_UIDS.includes(uid);
}

// ================================================================
// criarLoja — só admin chama
// ================================================================
exports.criarLoja = onCall(async (request) => {
    const { auth: authCtx, data } = request;

    if (!authCtx) {
        throw new HttpsError('unauthenticated', 'Precisa estar logado.');
    }
    if (!ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o admin pode criar lojas.');
    }

    const { nomeLoja, emailGestor, senhaGestor, nomeGestor } = data;
    if (!nomeLoja || !emailGestor || !senhaGestor || !nomeGestor) {
        throw new HttpsError('invalid-argument', 'Preencha nomeLoja, emailGestor, senhaGestor e nomeGestor.');
    }
    if (senhaGestor.length < 6) {
        throw new HttpsError('invalid-argument', 'Senha do Gestor precisa ter pelo menos 6 caracteres.');
    }

    // Cria o usuário Gestor no Firebase Auth
    let userRecord;
    try {
        userRecord = await auth.createUser({
            email: emailGestor,
            password: senhaGestor,
            displayName: nomeGestor,
        });
    } catch (e) {
        throw new HttpsError('already-exists', `Erro ao criar usuário: ${e.message}`);
    }

    // Cria o registro da loja (chave gerada automaticamente pelo push)
    const lojaRef = db.ref('lojas').push();
    const lojaId = lojaRef.key;

    await lojaRef.child('info').set({
        nome: nomeLoja,
        criadoEm: Date.now(),
        plano: 'saas',
    });

    // Vincula o Gestor à loja + grava o índice inverso (membros), que a
    // regra de segurança usa pra permitir o Gestor listar quem pertence
    // à PRÓPRIA loja, sem precisar de acesso de leitura ao node
    // 'usuarios' inteiro (que exporia dados de outras lojas também).
    await db.ref(`usuarios/${userRecord.uid}`).set({
        lojaId,
        papel: 'gestor',
        nome: nomeGestor,
        email: emailGestor,
        criadoEm: Date.now(),
    });
    await db.ref(`lojas/${lojaId}/membros/${userRecord.uid}`).set(true);

    // Grava a lojaId direto no TOKEN de login (custom claim) — é o que
    // a regra do Firebase Storage usa pra isolar a "pastinha" de cada
    // loja (Storage não consegue consultar o Realtime Database pra
    // conferir isso, só o que já vem gravado no próprio token).
    await auth.setCustomUserClaims(userRecord.uid, { lojaId });

    return { lojaId, uid: userRecord.uid, mensagem: `Loja "${nomeLoja}" criada com sucesso.` };
});

// ================================================================
// criarFuncionario — o Gestor chama, logado
// ================================================================
exports.criarFuncionario = onCall(async (request) => {
    const { auth: authCtx, data } = request;

    if (!authCtx) {
        throw new HttpsError('unauthenticated', 'Precisa estar logado.');
    }

    // Confirma que quem chamou é Gestor de alguma loja
    const chamadorSnap = await db.ref(`usuarios/${authCtx.uid}`).get();
    const chamador = chamadorSnap.val();
    if (!chamador || chamador.papel !== 'gestor') {
        throw new HttpsError('permission-denied', 'Só o Gestor da loja pode criar funcionários.');
    }
    const lojaId = chamador.lojaId;

    const { nomeFuncionario, emailFuncionario, senhaFuncionario, permissoes } = data;
    if (!nomeFuncionario || !emailFuncionario || !senhaFuncionario) {
        throw new HttpsError('invalid-argument', 'Preencha nomeFuncionario, emailFuncionario e senhaFuncionario.');
    }
    if (senhaFuncionario.length < 6) {
        throw new HttpsError('invalid-argument', 'Senha precisa ter pelo menos 6 caracteres.');
    }

    // Checa o limite de 3 funcionários NESSA loja — varre /usuarios
    // procurando quem já é funcionario dessa lojaId. Não é a consulta
    // mais barata do mundo (varre todos os usuários do sistema), mas
    // pro tamanho do app isso é desprezível; se crescer muito, dá pra
    // trocar por um contador em /lojas/{lojaId}/info/qtdFuncionarios.
    const todosUsuariosSnap = await db.ref('usuarios').orderByChild('lojaId').equalTo(lojaId).get();
    let qtdFuncionarios = 0;
    todosUsuariosSnap.forEach(child => {
        if (child.val().papel === 'funcionario') qtdFuncionarios++;
    });
    if (qtdFuncionarios >= 3) {
        throw new HttpsError('resource-exhausted', 'Essa loja já tem o máximo de 3 funcionários.');
    }

    let userRecord;
    try {
        userRecord = await auth.createUser({
            email: emailFuncionario,
            password: senhaFuncionario,
            displayName: nomeFuncionario,
        });
    } catch (e) {
        throw new HttpsError('already-exists', `Erro ao criar usuário: ${e.message}`);
    }

    // Permissões — default: tudo desligado, Gestor liga o que quiser
    // depois (ou já manda ligado, se vier em data.permissoes). 2 chaves
    // de MÓDULO (acesso à tela inteira — Vendas e Estoque NÃO entram
    // aqui de propósito, ficam sempre visíveis pro Funcionário) + 14
    // chaves de AÇÃO específica dentro de um módulo (ex: cancelar
    // venda é separado de acessar Vendas).
    // 'vendas_ver_todas' é diferente das outras: não é sobre uma ação
    // dentro do módulo Vendas, é sobre ENXERGAR vendas de outros
    // funcionários (por padrão cada um só vê a própria) — também
    // depende da regra de segurança liberar isso (ver firebase-rules-saas.json).
    const permissoesDefault = {
        // Módulos
        relatorios: false,
        configuracoes: false,
        // Ações — Vendas
        vendas_cancelar: false,
        vendas_editar_fechada: false,
        vendas_ver_valor_fechado: false,
        vendas_baixa_parcela: false,
        vendas_ver_parcelas: false,
        vendas_ver_todas: false,
        // Ações — Estoque
        estoque_criar_produto: false,
        estoque_editar_produto: false,
        estoque_arquivar_produto: false,
        estoque_apagar_produto: false,
        estoque_ver_log: false,
        // Ação — Calculadora
        calc_editar_lucro: false,
    };

    await db.ref(`usuarios/${userRecord.uid}`).set({
        lojaId,
        papel: 'funcionario',
        nome: nomeFuncionario,
        email: emailFuncionario,
        permissoes: { ...permissoesDefault, ...(permissoes || {}) },
        criadoEm: Date.now(),
    });
    await db.ref(`lojas/${lojaId}/membros/${userRecord.uid}`).set(true);

    // Grava a lojaId direto no TOKEN de login (custom claim) — mesma
    // razão do criarLoja: é o que a regra do Firebase Storage usa pra
    // isolar a "pastinha" de cada loja.
    await auth.setCustomUserClaims(userRecord.uid, { lojaId });

    return { uid: userRecord.uid, mensagem: `Funcionário "${nomeFuncionario}" criado com sucesso.` };
});

// ================================================================
// atualizarPermissoesFuncionario — o Gestor chama
// ================================================================
exports.atualizarPermissoesFuncionario = onCall(async (request) => {
    const { auth: authCtx, data } = request;

    if (!authCtx) {
        throw new HttpsError('unauthenticated', 'Precisa estar logado.');
    }

    const chamadorSnap = await db.ref(`usuarios/${authCtx.uid}`).get();
    const chamador = chamadorSnap.val();
    if (!chamador || chamador.papel !== 'gestor') {
        throw new HttpsError('permission-denied', 'Só o Gestor pode alterar permissões.');
    }

    const { funcionarioUid, permissoes } = data;
    if (!funcionarioUid || typeof permissoes !== 'object') {
        throw new HttpsError('invalid-argument', 'Preencha funcionarioUid e permissoes.');
    }

    // Confirma que o funcionário é da MESMA loja do Gestor que chamou
    // — impede um Gestor mexer nas permissões de funcionário de outra
    // loja, mesmo sabendo o UID dele.
    const funcSnap = await db.ref(`usuarios/${funcionarioUid}`).get();
    const func = funcSnap.val();
    if (!func || func.lojaId !== chamador.lojaId || func.papel !== 'funcionario') {
        throw new HttpsError('permission-denied', 'Esse funcionário não pertence à sua loja.');
    }

    // Só aceita as 4 chaves conhecidas — ignora qualquer campo extra
    // que venha no payload, pra não abrir brecha de escrever coisa
    // arbitrária em /usuarios/{uid}/permissoes.
    const CHAVES_VALIDAS = [
        'relatorios', 'configuracoes',
        'vendas_cancelar', 'vendas_editar_fechada',
        'vendas_ver_valor_fechado', 'vendas_baixa_parcela', 'vendas_ver_parcelas',
        'vendas_ver_todas',
        'estoque_criar_produto', 'estoque_editar_produto', 'estoque_arquivar_produto',
        'estoque_apagar_produto', 'estoque_ver_log',
        'calc_editar_lucro',
    ];
    const permissoesLimpas = {};
    CHAVES_VALIDAS.forEach(chave => {
        if (chave in permissoes) permissoesLimpas[chave] = !!permissoes[chave];
    });

    await db.ref(`usuarios/${funcionarioUid}/permissoes`).update(permissoesLimpas);

    return { mensagem: 'Permissões atualizadas.' };
});

// Gestor troca a senha de um FUNCIONÁRIO da própria loja. Precisa de
// Admin SDK porque o cliente nunca tem permissão de mudar a senha de
// outra pessoa (só a própria, via reautenticação no app) — só o
// backend, com credenciais de admin, pode fazer isso.
exports.alterarSenhaFuncionario = onCall(async (request) => {
    const { auth: authCtx, data } = request;

    if (!authCtx) {
        throw new HttpsError('unauthenticated', 'Precisa estar logado.');
    }

    const chamadorSnap = await db.ref(`usuarios/${authCtx.uid}`).get();
    const chamador = chamadorSnap.val();
    if (!chamador || chamador.papel !== 'gestor') {
        throw new HttpsError('permission-denied', 'Só o Gestor pode alterar a senha de um funcionário.');
    }

    const { funcionarioUid, novaSenha } = data;
    if (!funcionarioUid || typeof novaSenha !== 'string' || novaSenha.length < 6) {
        throw new HttpsError('invalid-argument', 'A senha precisa ter pelo menos 6 caracteres.');
    }

    // Mesma checagem de "é da minha loja" usada em atualizarPermissoesFuncionario
    // — impede o Gestor mexer na senha de alguém de outra loja.
    const funcSnap = await db.ref(`usuarios/${funcionarioUid}`).get();
    const func = funcSnap.val();
    if (!func || func.lojaId !== chamador.lojaId || func.papel !== 'funcionario') {
        throw new HttpsError('permission-denied', 'Esse funcionário não pertence à sua loja.');
    }

    await auth.updateUser(funcionarioUid, { password: novaSenha });

    return { mensagem: 'Senha do funcionário atualizada.' };
});

// Só o admin do sistema (você) chama — manda um aviso pra TODOS os
// usuários de TODAS as lojas de uma vez (changelog/atualização do
// sistema). Diferente das notificações da Parte 1 (que são por loja
// e o usuário liga/desliga), esse canal é fixo — não tem preferência
// pra desligar, é aviso direto do dono do sistema.
exports.enviarNotificacaoBroadcast = onCall(async (request) => {
    const { auth: authCtx, data } = request;

    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador do sistema pode enviar essa notificação.');
    }

    const { titulo, corpo } = data;
    if (!titulo || !corpo) {
        throw new HttpsError('invalid-argument', 'Título e corpo são obrigatórios.');
    }

    // Coleta os tokens de TODOS os usuários (todas as lojas), guardando
    // qual uid é dono de cada token — precisa disso pra saber de onde
    // apagar um token morto (usuário desinstalou/limpou dados).
    const usuariosSnap = await db.ref('usuarios').get();
    const usuarios = usuariosSnap.val() || {};

    // Grava no histórico de CADA usuário, mesmo quem ainda não ativou
    // push nesse aparelho — assim ele aparece na central de
    // notificações do app de qualquer forma, não só como push.
    const registrosHistorico = Object.keys(usuarios).map(uid =>
        db.ref(`usuarios/${uid}/notificacoesRecebidas`).push({
            tipo: 'atualizacao',
            titulo,
            corpo,
            timestamp: Date.now(),
            lida: false,
        })
    );
    await Promise.all(registrosHistorico);

    const tokenParaUid = {};
    Object.entries(usuarios).forEach(([uid, u]) => {
        if (u && u.fcmTokens) Object.keys(u.fcmTokens).forEach(tok => { tokenParaUid[tok] = uid; });
    });
    const tokens = Object.keys(tokenParaUid);

    if (tokens.length === 0) {
        return { mensagem: 'Nenhum usuário com notificações ativadas ainda.', enviados: 0, falhas: 0 };
    }

    // sendEachForMulticast aceita até 500 tokens por chamada — divide
    // em lotes se a base de usuários crescer além disso.
    const LOTE = 500;
    let enviados = 0;
    let falhas = 0;
    for (let i = 0; i < tokens.length; i += LOTE) {
        const loteTokens = tokens.slice(i, i + LOTE);
        const resposta = await messaging.sendEachForMulticast({
            tokens: loteTokens,
            notification: { title: titulo, body: corpo },
        });
        enviados += resposta.successCount;
        falhas += resposta.failureCount;

        // Limpa token morto — evita a lista crescer pra sempre com
        // aparelho que nunca mais vai receber nada. Qualquer OUTRO tipo
        // de erro (não é token morto) fica logado de verdade agora —
        // antes ficava só contado em "falhas", sem dar pra saber POR QUE
        // falhou.
        const limpezas = [];
        resposta.responses.forEach((r, idx) => {
            if (r.success) return;
            const codigo = (r.error && r.error.code) || '';
            if (codigo.includes('registration-token-not-registered') || codigo.includes('invalid-registration-token')) {
                const tok = loteTokens[idx];
                const uid = tokenParaUid[tok];
                if (uid) limpezas.push(db.ref(`usuarios/${uid}/fcmTokens/${tok}`).remove());
            } else {
                // Erro de verdade (não é só "token morto") — loga
                // detalhado, senão só aparece como número em "falhas",
                // sem dar pra saber POR QUE falhou.
                console.error('[enviarNotificacaoBroadcast] Falha ao enviar push:', codigo, r.error && r.error.message);
            }
        });
        await Promise.all(limpezas);
    }

    return { mensagem: `Enviado pra ${enviados} aparelho(s).`, enviados, falhas };
});

// Roda sozinha, sem ninguém chamar — apaga de vez notificações que já
// foram "limpas" (limparEm preenchido) há mais de 24h. É o que faz a
// seção "Limpas" da gaveta realmente sumir depois de um tempo, em vez
// de ficar guardando lixo pra sempre no banco.
exports.limparNotificacoesExpiradas = onSchedule('every 6 hours', async () => {
    const LIMITE_24H = 24 * 60 * 60 * 1000;
    const agora = Date.now();

    const usuariosSnap = await db.ref('usuarios').get();
    const usuarios = usuariosSnap.val() || {};
    const remocoes = [];

    Object.entries(usuarios).forEach(([uid, u]) => {
        if (!u || !u.notificacoesRecebidas) return;
        Object.entries(u.notificacoesRecebidas).forEach(([id, n]) => {
            if (n && n.limparEm && (agora - n.limparEm) > LIMITE_24H) {
                remocoes.push(db.ref(`usuarios/${uid}/notificacoesRecebidas/${id}`).remove());
            }
        });
    });

    await Promise.all(remocoes);
    return null;
});

// Roda todo dia de manhã, sozinha. Confere TODOS os produtos de
// TODAS as lojas contra o limite configurado por cada loja
// (lojas/{lojaId}/notificacoesConfig/estoqueLimiteBaixo, padrão 2) —
// avisa só o(s) Gestor(es) daquela loja especificamente, respeitando:
//   - o toggle "não avisar sobre esse produto" (produto.notificacaoEstoqueDesativada)
//   - a preferência pessoal do Gestor de ter esse tipo de aviso desligado
//   - "avisa de novo todo dia enquanto o problema continuar" — controlado
//     por um campo no próprio produto (ultimoAvisoEstoqueBaixo, guarda
//     a DATA — não o timestamp — do último aviso; se já é hoje, pula)
// ── Utilidades compartilhadas por todas as funções agendadas ────
// Data/hora no fuso de Brasília — o servidor roda em UTC por padrão,
// então sem isso "hoje" e "que horas são" saem errados pra quem
// configurou um horário pensando no fuso local.
function agoraNoFusoSP() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}
function dataStringSP(data) {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

// Grava o histórico (um registro por aviso) e manda UM push resumido
// por aparelho — usada por TODAS as funções agendadas de notificação,
// pra não repetir essa cauda em cada uma. avisosPorUsuario tem o
// formato { uid: [{titulo, corpo}, ...] }. tituloResumoMultiplo(qtd)
// monta o título do push quando o usuário tem mais de um aviso desse
// tipo de uma vez (cada tipo tem sua própria frase).
async function processarEEnviarAvisos(avisosPorUsuario, usuarios, tipo, tituloResumoMultiplo) {
    const escritasHistorico = [];
    const tokenParaUid = {};

    Object.entries(avisosPorUsuario).forEach(([uid, avisos]) => {
        avisos.forEach(av => {
            const registro = { tipo, titulo: av.titulo, corpo: av.corpo, timestamp: Date.now(), lida: false };
            if (av.dados) registro.dados = av.dados; // ex: {produtoId}, {vendaId}, {clienteId, telefone} — usado pro botão de ação na notificação
            escritasHistorico.push(db.ref(`usuarios/${uid}/notificacoesRecebidas`).push(registro));
        });
        const u = usuarios[uid];
        if (u && u.fcmTokens) Object.keys(u.fcmTokens).forEach(tok => { tokenParaUid[tok] = uid; });
    });

    await Promise.all(escritasHistorico);

    const tokens = Object.keys(tokenParaUid);
    const LOTE = 500;
    for (let i = 0; i < tokens.length; i += LOTE) {
        const loteTokens = tokens.slice(i, i + LOTE);
        await Promise.all(loteTokens.map(async tok => {
            const uid = tokenParaUid[tok];
            const avisos = avisosPorUsuario[uid] || [];
            if (avisos.length === 0) return;
            const titulo = avisos.length === 1 ? avisos[0].titulo : tituloResumoMultiplo(avisos.length);
            const corpo = avisos.length === 1 ? avisos[0].corpo : 'Confere a lista completa na central de notificações.';
            try {
                await messaging.send({ token: tok, notification: { title: titulo, body: corpo } });
                console.log(`[processarEEnviarAvisos:${tipo}] Push enviado com sucesso pro token ${tok.slice(0, 12)}...`);
            } catch (e) {
                const codigo = e.code || '';
                if (codigo.includes('registration-token-not-registered') || codigo.includes('invalid-registration-token')) {
                    await db.ref(`usuarios/${uid}/fcmTokens/${tok}`).remove();
                } else {
                    // Erro de verdade — antes isso desaparecia sem deixar
                    // rastro nenhum. Agora aparece nos Logs da função.
                    console.error(`[processarEEnviarAvisos:${tipo}] Falha ao enviar push:`, codigo, e.message);
                }
            }
        }));
    }
}

exports.verificarEstoqueBaixo = onSchedule('every day 08:00', async () => {
    const [lojasSnap, usuariosSnap] = await Promise.all([
        db.ref('lojas').get(),
        db.ref('usuarios').get(),
    ]);
    const lojas = lojasSnap.val() || {};
    const usuarios = usuariosSnap.val() || {};
    const hoje = dataStringSP(agoraNoFusoSP());

    // uid do Gestor -> lista de {titulo, corpo} (pode ter mais de um
    // produto baixo no mesmo dia pro mesmo Gestor).
    const avisosPorUsuario = {};
    const escritasMarcador = [];

    Object.entries(lojas).forEach(([lojaId, loja]) => {
        if (!loja || !loja.products) return;

        const gestores = Object.entries(usuarios)
            .filter(([, u]) => u && u.papel === 'gestor' && u.lojaId === lojaId)
            .map(([uid]) => uid);
        if (gestores.length === 0) return;

        const limite = (loja.notificacoesConfig && loja.notificacoesConfig.estoqueLimiteBaixo != null)
            ? loja.notificacoesConfig.estoqueLimiteBaixo : 2;

        Object.entries(loja.products).forEach(([produtoId, produto]) => {
            if (!produto || produto.arquivado || produto.notificacaoEstoqueDesativada) return;
            const qtd = produto.quantidade ?? 0;
            if (qtd > limite) return;
            if (produto.ultimoAvisoEstoqueBaixo === hoje) return; // já avisou hoje sobre esse

            const zerado = qtd <= 0;
            const titulo = zerado ? `${produto.nome} — estoque zerado` : `${produto.nome} — estoque baixo`;
            const corpo = zerado ? 'Esse produto zerou o estoque.' : `Só restam ${qtd} unidade(s) (limite: ${limite}).`;

            gestores.forEach(uidGestor => {
                const prefs = (usuarios[uidGestor].preferencias && usuarios[uidGestor].preferencias.notificacoes) || {};
                if (prefs.estoqueBaixo === false) return; // Gestor desligou esse tipo
                if (!avisosPorUsuario[uidGestor]) avisosPorUsuario[uidGestor] = [];
                avisosPorUsuario[uidGestor].push({ titulo, corpo, dados: { produtoId } });
            });

            escritasMarcador.push(db.ref(`lojas/${lojaId}/products/${produtoId}/ultimoAvisoEstoqueBaixo`).set(hoje));
        });
    });

    await Promise.all(escritasMarcador);
    await processarEEnviarAvisos(avisosPorUsuario, usuarios, 'estoqueBaixo',
        qtd => `${qtd} produtos com estoque baixo`);
    return null;
});

// ── Vendas em aberto ─────────────────────────────────────────────
// Mesma lógica de status já usada em venda/historico.js
// (calcularStatusFinanceiro/contarParcelas) — copiada aqui porque
// Cloud Function não pode importar código do front-end. Se um dia
// mudar a regra de status lá, precisa espelhar aqui também.
function contarParcelasServer(venda) {
    let pagas = 0, total = 0;
    (venda.pagamentos || []).forEach(p => {
        if (p.forma === 'parcelado' && Array.isArray(p.itens)) {
            total += p.itens.length;
            pagas += p.itens.filter(it => it.paga).length;
        }
    });
    return { pagas, total };
}
function statusFinanceiroServer(venda) {
    if (venda.status === 'cancelada') return 'cancelada';
    const { pagas, total: totalParcelas } = contarParcelasServer(venda);
    if (totalParcelas > 0 && pagas < totalParcelas) return 'parcelada-pendente';
    const somaPaga = (venda.pagamentos || []).reduce((s, p) => s + (p.valor || 0), 0);
    const total = venda.valorTotal || 0;
    if (total > 0 && somaPaga >= total) return 'completa';
    if (somaPaga > 0) return 'parcial';
    return 'aberta';
}

// Roda a cada 15min — é o jeito de suportar "cada usuário escolhe o
// próprio horário" sem precisar de uma função agendada por pessoa.
// Cada rodada confere: é agora (±8min) o horário que ALGUÉM
// configurou? Se sim e ainda não avisou hoje, manda.
exports.verificarVendasAbertas = onSchedule('every 15 minutes', async () => {
    const [lojasSnap, usuariosSnap] = await Promise.all([
        db.ref('lojas').get(),
        db.ref('usuarios').get(),
    ]);
    const lojas = lojasSnap.val() || {};
    const usuarios = usuariosSnap.val() || {};

    const agoraSP = agoraNoFusoSP();
    const minutosAgora = agoraSP.getHours() * 60 + agoraSP.getMinutes();
    const hojeSP = dataStringSP(agoraSP);
    const TOLERANCIA_MIN = 8; // um pouco mais que metade do intervalo de 15min

    const tarefas = [];
    const avisosPorUsuario = {};

    Object.entries(usuarios).forEach(([uid, u]) => {
        if (!u || !u.lojaId) return;
        const prefs = (u.preferencias && u.preferencias.notificacoes) || {};
        if (!prefs.vendasAbertas || !prefs.vendasAbertasHorario) return;

        const [hh, mm] = prefs.vendasAbertasHorario.split(':').map(Number);
        if (isNaN(hh) || isNaN(mm)) return;
        const diff = Math.abs(minutosAgora - (hh * 60 + mm));
        if (diff > TOLERANCIA_MIN) return;

        if (u.preferencias && u.preferencias.ultimoAvisoVendasAbertas === hojeSP) return; // já avisou hoje

        const loja = lojas[u.lojaId];
        if (!loja || !loja.vendas) return;

        const ehGestor = u.papel === 'gestor';
        let count = 0;
        Object.values(loja.vendas).forEach(venda => {
            if (!venda) return;
            if (!ehGestor && venda.criadoPorUid !== uid) return; // Funcionário só conta as próprias
            const status = statusFinanceiroServer(venda);
            // 'parcelada-pendente' (tem datas futuras a receber) fica de
            // fora de propósito — ela já tem aviso dedicado
            // (verificarParcelasVencendo), contar aqui também seria a
            // MESMA pendência aparecendo em duas notificações diferentes.
            // "Em aberto" é só pra venda sem plano nenhum de recebimento
            // organizado — aberta (nada pago) ou parcial (pagou uma parte
            // sem programar o resto).
            if (status === 'aberta' || status === 'parcial') count++;
        });

        // Marca "já checou hoje" mesmo com 0 em aberto — sem isso ficaria
        // reprocessando esse usuário toda rodada até acabar o dia.
        tarefas.push(db.ref(`usuarios/${uid}/preferencias/ultimoAvisoVendasAbertas`).set(hojeSP));
        if (count === 0) return;

        const titulo = count === 1 ? 'Você tem 1 venda em aberto' : `Você tem ${count} vendas em aberto`;
        avisosPorUsuario[uid] = [{ titulo, corpo: 'Confere antes de fechar a loja.' }];
    });

    await Promise.all(tarefas);
    await processarEEnviarAvisos(avisosPorUsuario, usuarios, 'vendasAbertas',
        () => 'Você tem vendas em aberto'); // esse tipo nunca tem mais de 1 aviso por usuário, mas mantém padrão
    return null;
});

// ── Parcela vencendo/atrasada ────────────────────────────────────
// Roda uma vez por dia — confere toda parcela de toda venda (não
// cancelada) de toda loja, avisando o(s) Gestor(es) quando o
// vencimento já chegou (hoje) ou já passou (atrasada). Marca aviso
// POR PARCELA (não por venda inteira), porque uma venda pode ter
// várias parcelas vencendo em dias diferentes.
exports.verificarParcelasVencendo = onSchedule('every day 08:00', async () => {
    const [lojasSnap, usuariosSnap] = await Promise.all([
        db.ref('lojas').get(),
        db.ref('usuarios').get(),
    ]);
    const lojas = lojasSnap.val() || {};
    const usuarios = usuariosSnap.val() || {};
    const hoje = dataStringSP(agoraNoFusoSP());

    const avisosPorUsuario = {};
    const escritasMarcador = [];

    Object.entries(lojas).forEach(([lojaId, loja]) => {
        if (!loja || !loja.vendas) return;
        const gestores = Object.entries(usuarios)
            .filter(([, u]) => u && u.papel === 'gestor' && u.lojaId === lojaId)
            .map(([uid]) => uid);
        if (gestores.length === 0) return;

        Object.entries(loja.vendas).forEach(([vendaId, venda]) => {
            if (!venda || venda.status === 'cancelada') return;
            (venda.pagamentos || []).forEach((pagamento, pagIdx) => {
                if (pagamento.forma !== 'parcelado' || !Array.isArray(pagamento.itens)) return;
                pagamento.itens.forEach((item, itemIdx) => {
                    if (item.paga || !item.vencimento || item.vencimento > hoje) return;

                    const chave = `${pagIdx}_${itemIdx}`;
                    if (venda.avisosParcela && venda.avisosParcela[chave] === hoje) return; // já avisou hoje sobre essa parcela

                    const atrasada = item.vencimento < hoje;
                    const clienteNome = venda.clienteNome || 'Cliente';
                    const titulo = atrasada ? `Parcela atrasada — ${clienteNome}` : `Parcela vence hoje — ${clienteNome}`;
                    const corpo = `${item.numero}/${pagamento.parcelas} — R$ ${(item.valor || 0).toFixed(2).replace('.', ',')}`;

                    gestores.forEach(uidGestor => {
                        const prefs = (usuarios[uidGestor].preferencias && usuarios[uidGestor].preferencias.notificacoes) || {};
                        if (prefs.parcelaVencendo === false) return;
                        if (!avisosPorUsuario[uidGestor]) avisosPorUsuario[uidGestor] = [];
                        avisosPorUsuario[uidGestor].push({ titulo, corpo, dados: { vendaId } });
                    });

                    escritasMarcador.push(db.ref(`lojas/${lojaId}/vendas/${vendaId}/avisosParcela/${chave}`).set(hoje));
                });
            });
        });
    });

    await Promise.all(escritasMarcador);
    await processarEEnviarAvisos(avisosPorUsuario, usuarios, 'parcelaVencendo',
        qtd => `${qtd} parcelas vencendo ou atrasadas`);
    return null;
});

// ── Aniversário de cliente ───────────────────────────────────────
// Roda uma vez por dia — confere todo cliente de toda loja com
// aniversário hoje (compara só mês/dia, ignora o ano de nascimento).
// Avisa o(s) Gestor(es) da loja E quem cadastrou aquele cliente
// (só funciona pra cliente cadastrado depois que o app passou a
// gravar isso — clientes antigos não têm criadoPorUid). Marca "já
// avisou" por ANO (não por dia), porque um aniversário só acontece
// uma vez por ano — sem isso avisaria de novo amanhã por engano.
exports.verificarAniversariosClientes = onSchedule('every day 08:00', async () => {
    const [lojasSnap, usuariosSnap] = await Promise.all([
        db.ref('lojas').get(),
        db.ref('usuarios').get(),
    ]);
    const lojas = lojasSnap.val() || {};
    const usuarios = usuariosSnap.val() || {};
    const hoje = dataStringSP(agoraNoFusoSP());
    const mesDiaHoje = hoje.slice(5);   // "MM-DD"
    const anoAtual = hoje.slice(0, 4);

    const avisosPorUsuario = {};
    const escritasMarcador = [];

    Object.entries(lojas).forEach(([lojaId, loja]) => {
        if (!loja || !loja.clientes) return;
        const gestores = Object.entries(usuarios)
            .filter(([, u]) => u && u.papel === 'gestor' && u.lojaId === lojaId)
            .map(([uid]) => uid);

        Object.entries(loja.clientes).forEach(([clienteId, cliente]) => {
            if (!cliente || !cliente.dataNascimento) return;
            if (cliente.dataNascimento.slice(5) !== mesDiaHoje) return; // não é hoje
            if (cliente.ultimoAvisoAniversario === anoAtual) return; // já avisou esse ano

            const titulo = `Hoje é aniversário de ${cliente.nome}`;
            const corpo = 'Que tal mandar uma mensagem?';

            const destinatarios = new Set(gestores);
            if (cliente.criadoPorUid && usuarios[cliente.criadoPorUid] && usuarios[cliente.criadoPorUid].lojaId === lojaId) {
                destinatarios.add(cliente.criadoPorUid);
            }

            destinatarios.forEach(uid => {
                const prefs = (usuarios[uid].preferencias && usuarios[uid].preferencias.notificacoes) || {};
                if (prefs.aniversarioCliente === false) return;
                if (!avisosPorUsuario[uid]) avisosPorUsuario[uid] = [];
                avisosPorUsuario[uid].push({ titulo, corpo, dados: { clienteId, telefone: cliente.telefone || null } });
            });

            escritasMarcador.push(db.ref(`lojas/${lojaId}/clientes/${clienteId}/ultimoAvisoAniversario`).set(anoAtual));
        });
    });

    await Promise.all(escritasMarcador);
    await processarEEnviarAvisos(avisosPorUsuario, usuarios, 'aniversario',
        qtd => `${qtd} clientes fazem aniversário hoje`);
    return null;
});

// ── Despesa recorrente vencendo (Financeiro) ─────────────────────
// Roda uma vez por dia — confere toda recorrente ATIVA de toda loja
// cujo 'diaDoMes' bate com o dia de hoje. Só avisa Gestor — Financeiro
// é módulo exclusivo dele (ver financeiro/router.js). NUNCA lança a
// despesa sozinha, só avisa — o Gestor confirma manual abrindo
// Financeiro → Recorrentes (decisão já fechada faz tempo).
//
// financeiro/{lojaId}/... mora FORA de lojas/{lojaId} de propósito
// (regra própria, 100% Gestor) — por isso essa função lê
// db.ref('financeiro') direto, separado de db.ref('lojas').
exports.verificarRecorrentesVencendo = onSchedule('every day 08:00', async () => {
    const [financeiroSnap, usuariosSnap] = await Promise.all([
        db.ref('financeiro').get(),
        db.ref('usuarios').get(),
    ]);
    const financeiroPorLoja = financeiroSnap.val() || {};
    const usuarios = usuariosSnap.val() || {};
    const hoje = dataStringSP(agoraNoFusoSP());
    const diaHoje = parseInt(hoje.slice(8, 10), 10);

    const avisosPorUsuario = {};
    const escritasMarcador = [];

    Object.entries(financeiroPorLoja).forEach(([lojaId, dadosFinanceiro]) => {
        if (!dadosFinanceiro || !dadosFinanceiro.recorrentes) return;
        const gestores = Object.entries(usuarios)
            .filter(([, u]) => u && u.papel === 'gestor' && u.lojaId === lojaId)
            .map(([uid]) => uid);
        if (gestores.length === 0) return;

        Object.entries(dadosFinanceiro.recorrentes).forEach(([recId, rec]) => {
            if (!rec || rec.ativa === false) return;
            if ((rec.diaDoMes || 0) !== diaHoje) return;
            if (rec.ultimoAvisoRecorrente === hoje) return; // já avisou hoje sobre essa

            const valorFmt = (rec.valor || 0).toFixed(2).replace('.', ',');
            const titulo = `${rec.nome} vence hoje`;
            const corpo = `R$ ${valorFmt} · ${rec.categoriaNome || 'Despesa recorrente'}`;

            gestores.forEach(uidGestor => {
                const prefs = (usuarios[uidGestor].preferencias && usuarios[uidGestor].preferencias.notificacoes) || {};
                if (prefs.despesaRecorrente === false) return;
                if (!avisosPorUsuario[uidGestor]) avisosPorUsuario[uidGestor] = [];
                avisosPorUsuario[uidGestor].push({ titulo, corpo, dados: { recorrenteId: recId } });
            });

            escritasMarcador.push(db.ref(`financeiro/${lojaId}/recorrentes/${recId}/ultimoAvisoRecorrente`).set(hoje));
        });
    });

    await Promise.all(escritasMarcador);
    await processarEEnviarAvisos(avisosPorUsuario, usuarios, 'despesaRecorrente',
        qtd => `${qtd} despesas recorrentes vencendo hoje`);
    return null;
});

// ── Concerto (OS) atrasado ────────────────────────────────────────
// Roda uma vez por dia — confere toda OS de Concertos que já passou
// do prazo (mesma condição que o filtro "Atrasados" da lista já usa:
// status !== 'entregue' && prazoTs no passado). Avisa TODO mundo da
// loja, não só Gestor — é assistência técnica, todo mundo ali
// trabalha em cima disso (mesma decisão já usada pra senha do
// aparelho). Só avisa 1x por dia por OS (marca ultimoAvisoAtraso).
exports.verificarReparosAtrasados = onSchedule('every day 08:00', async () => {
    const [lojasSnap, usuariosSnap] = await Promise.all([
        db.ref('lojas').get(),
        db.ref('usuarios').get(),
    ]);
    const lojas = lojasSnap.val() || {};
    const usuarios = usuariosSnap.val() || {};
    const hoje = dataStringSP(agoraNoFusoSP());
    const agora = Date.now();

    const avisosPorUsuario = {};
    const escritasMarcador = [];

    Object.entries(lojas).forEach(([lojaId, loja]) => {
        if (!loja || !loja.reparos) return;
        const membros = Object.entries(usuarios)
            .filter(([, u]) => u && u.lojaId === lojaId)
            .map(([uid]) => uid);
        if (membros.length === 0) return;

        Object.entries(loja.reparos).forEach(([repairId, os]) => {
            if (!os || os.status === 'entregue' || !os.prazoTs || os.prazoTs >= agora) return;
            if (os.ultimoAvisoAtraso === hoje) return; // já avisou hoje sobre essa

            const titulo = `OS atrasada — ${os.cliente?.nome || 'Cliente'}`;
            const corpo = `${os.aparelho || 'Aparelho'} · prazo era ${new Date(os.prazoTs).toLocaleDateString('pt-BR')}.`;

            membros.forEach(uid => {
                const prefs = (usuarios[uid].preferencias && usuarios[uid].preferencias.notificacoes) || {};
                if (prefs.reparoAtrasado === false) return;
                if (!avisosPorUsuario[uid]) avisosPorUsuario[uid] = [];
                avisosPorUsuario[uid].push({ titulo, corpo, dados: { repairId } });
            });

            escritasMarcador.push(db.ref(`lojas/${lojaId}/reparos/${repairId}/ultimoAvisoAtraso`).set(hoje));
        });
    });

    await Promise.all(escritasMarcador);
    await processarEEnviarAvisos(avisosPorUsuario, usuarios, 'reparoAtrasado',
        qtd => `${qtd} OS de concerto atrasada(s)`);
    return null;
});

// ── Sincronização SERVER-SIDE do Financeiro (a correção de verdade) ──
// Os ganchos client-side (venda/fechar.js, venda/lancar.js,
// estoque/produtos.js) continuam existindo — eles dão feedback
// instantâneo quando quem age é Gestor. Mas Financeiro é 100% Gestor,
// inclusive pra ESCRITA — se um Funcionário fecha a venda ou faz a
// reposição (ambos têm permissão própria pra isso —
// 'vendas_baixa_parcela', 'estoque_editar_produto'), a gravação
// client-side é rejeitada pela regra do RTDB, em silêncio (só um
// console.error que ninguém vê). A venda/reposição fica certa, só a
// entrada no Financeiro nunca nasce — até um Gestor abrir Lançamentos
// e a sincronização de "antigas" pegar ela por trás; uma entrada bem
// recente acaba sendo reconhecida como "backfill" só por causa disso.
//
// Essas duas funções rodam com Admin SDK, que IGNORA regra — por
// isso são o jeito confiável de garantir que toda venda fechada e
// toda reposição com valor viram entrada no Financeiro na hora, não
// importa quem foi que agiu. Mesma chave determinística de sempre
// (venda_{id} / estoque_{produtoId}_{historicoId}) — rodar em cima do
// que o gancho client-side já gravou é inofensivo, só reescreve com
// o mesmo valor.
// Regime de CAIXA (decisão do Gestor) — cada pagamento avulso
// (dinheiro/cartão/pix) vira receita no instante em que foi
// registrado; cada PARCELA de um plano parcelado só vira receita no
// dia em que for marcada como paga, pelo valor daquela parcela
// específica — nunca o plano inteiro de uma vez. Roda em qualquer
// mudança na venda (não só quando ela "fecha") — pagamento parcial
// numa venda ainda 'aberta'/'parcial' já é dinheiro de verdade que
// entrou, não espera o resto fechar pra contar.
//
// Cada pagamento/parcela vira uma chave PRÓPRIA
// (venda_{id}_p{idx} ou venda_{id}_p{idx}_i{idx}) — assim dá pra
// adicionar/remover uma parcela específica (marcar/desmarcar "paga")
// sem afetar as outras. A chave antiga de versões anteriores
// (venda_{id}, o valor inteiro de uma vez) é sempre removida — é o
// jeito de migrar dado velho pro modelo novo sem duplicar.
exports.financeiroSyncVenda = onValueWritten('lojas/{lojaId}/vendas/{vendaId}', async (event) => {
    const { lojaId, vendaId } = event.params;
    const depois = event.data.after.val();
    const financeiroRef = db.ref(`financeiro/${lojaId}/lancamentos`);
    const chaveAntiga = `venda_${vendaId}`;
    const prefixo = `venda_${vendaId}_`;

    // .get() direto no node inteiro (sem query orderByKey/startAt/endAt)
    // — mesmo padrão simples e comprovado de financeiroSyncReposicao,
    // só filtra pelo prefixo aqui em JS puro. A versão anterior usava
    // uma range query, e era o único ponto estrutural diferente entre
    // essa function (que não funcionava) e a de reposição (que sempre
    // funcionou) — trocado por segurança, mesmo sem 100% de certeza de
    // que era a causa exata.
    let existentes = {};
    try {
        const snapAtual = await financeiroRef.get();
        const tudo = snapAtual.val() || {};
        Object.keys(tudo).forEach(k => { if (k.startsWith(prefixo)) existentes[k] = tudo[k]; });
    } catch (e) {
        console.error(`[financeiroSyncVenda] Erro ao buscar lançamentos existentes (lojaId=${lojaId}, vendaId=${vendaId}):`, e);
    }

    if (!depois || depois.status === 'cancelada') {
        // Venda apagada ou cancelada — reversão completa: tira a
        // entrada antiga (se sobrou de antes) e toda entrada granular
        // que essa venda tinha gerado.
        const remocoes = [financeiroRef.child(chaveAntiga).remove()];
        Object.keys(existentes).forEach(k => remocoes.push(financeiroRef.child(k).remove()));
        await Promise.all(remocoes);
        return null;
    }

    try {
        const desc = `Venda${depois.numeroVenda ? ' #' + depois.numeroVenda : ''}${depois.clienteNome ? ' · ' + depois.clienteNome : ''}`;
        const escritas = [financeiroRef.child(chaveAntiga).remove()]; // limpa o modelo antigo se sobrou de antes
        const chavesValidas = new Set();

        // Object.values em vez de assumir array puro — o Firebase RTDB
        // devolve um OBJETO (não array) quando o array do lado do cliente
        // fica com "buraco" no meio (item removido no meio, não só no
        // fim) — se isso acontecesse, Array.isArray(depois.pagamentos)
        // seria false e a função inteira pularia isso em silêncio.
        const pagamentosArr = Array.isArray(depois.pagamentos) ? depois.pagamentos
            : (depois.pagamentos && typeof depois.pagamentos === 'object') ? Object.values(depois.pagamentos) : [];

        pagamentosArr.forEach((p, pIdx) => {
            if (!p) return;
            if (p.forma === 'parcelado' && p.itens) {
                const itensArr = Array.isArray(p.itens) ? p.itens : Object.values(p.itens);
                itensArr.forEach((item, iIdx) => {
                    if (!item || !item.paga) return; // não paga ainda — não é receita, não escreve nada
                    const chave = `${prefixo}p${pIdx}_i${iIdx}`;
                    chavesValidas.add(chave);
                    escritas.push(financeiroRef.child(chave).update({
                        tipo: 'receita', categoria: 'venda', categoriaNome: 'Venda',
                        valor: item.valor || 0,
                        criadoEm: item.pagaEm || depois.criadoEm || Date.now(),
                        origem: 'automatica',
                        origemDescricao: `${desc} · Parcela ${item.numero || iIdx + 1}/${p.itens.length}`,
                    }));
                });
            } else {
                // Pagamento avulso (dinheiro, cartão, pix...) — dinheiro que
                // já entrou no ato, vira receita na hora.
                const chave = `${prefixo}p${pIdx}`;
                chavesValidas.add(chave);
                escritas.push(financeiroRef.child(chave).update({
                    tipo: 'receita', categoria: 'venda', categoriaNome: 'Venda',
                    valor: p.valorLiquido ?? p.valor ?? 0,
                    criadoEm: p.criadoEm || depois.criadoEm || Date.now(),
                    origem: 'automatica', origemDescricao: desc,
                }));
            }
        });

        // Chave que EXISTIA antes mas não devia mais existir agora (parcela
        // foi desmarcada como paga, ou o pagamento foi removido/editado) —
        // tira do Financeiro.
        Object.keys(existentes).forEach(k => {
            if (!chavesValidas.has(k)) escritas.push(financeiroRef.child(k).remove());
        });

        await Promise.all(escritas);
        console.log(`[financeiroSyncVenda] OK — lojaId=${lojaId} vendaId=${vendaId} — ${chavesValidas.size} chave(s) de receita ativa(s).`);
    } catch (e) {
        console.error(`[financeiroSyncVenda] Erro ao processar (lojaId=${lojaId}, vendaId=${vendaId}):`, e);
    }
    return null;
});

exports.financeiroSyncReposicao = onValueWritten('lojas/{lojaId}/products/{produtoId}/historico/{historicoId}', async (event) => {
    const { lojaId, produtoId, historicoId } = event.params;
    const depois = event.data.after.val();
    const refFinanceiro = db.ref(`financeiro/${lojaId}/lancamentos/estoque_${produtoId}_${historicoId}`);

    if (!depois) return null; // entrada de histórico apagada — não deveria acontecer normalmente, deixa como está

    if (depois.tipo === 'entrada' && depois.valorUnitario != null && !depois.estornadoEm) {
        const produtoSnap = await db.ref(`lojas/${lojaId}/products/${produtoId}/nome`).get();
        const desc = `Reposição · ${produtoSnap.val() || 'Produto'}${depois.fornecedor ? ' · ' + depois.fornecedor : ''}`;
        await refFinanceiro.update({
            tipo: 'despesa', categoria: 'produto', categoriaNome: 'Compra de Produto',
            valor: depois.valorUnitario * Math.abs(depois.delta || 0),
            criadoEm: depois.timestamp || Date.now(),
            origem: 'automatica', origemDescricao: desc,
        });
    } else if (depois.tipo === 'entrada' && depois.estornadoEm) {
        // Foi estornada depois de virar despesa — tira do Financeiro.
        await refFinanceiro.remove();
    }
    return null;
});