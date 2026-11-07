// ================================================================
// functions/index.js — VortexSmart SaaS · Cloud Functions
//
// Todas "callable" (chamadas direto do app via SDK, sem precisar
// montar fetch/HTTP manual). Ver `exports.` pra lista completa —
// resumo por grupo:
//
//   Loja/usuário (Gestor): criarLoja, criarFuncionario,
//     atualizarPermissoesFuncionario, alterarSenhaFuncionario
//
//   Admin total (admin-criar-loja.html): adminListarLojas,
//     adminBloquearLoja, adminDesbloquearLoja, adminEditarNomeLoja,
//     adminEditarEmailUsuario, adminResetarSenhaUsuario,
//     adminApagarUsuario, adminApagarLoja
//
//   Notificações: enviarNotificacaoBroadcast, enviarNotificacaoLoja,
//     limparNotificacoesExpiradas (agendada)
//
//   Agendadas (verificações periódicas): verificarEstoqueBaixo,
//     verificarVendasAbertas, verificarParcelasVencendo,
//     verificarAniversariosClientes, verificarRecorrentesVencendo,
//     verificarReparosAtrasados
//
//   Triggers de venda: vendaCalcularStatus, financeiroSyncVenda,
//     financeiroSyncReposicao
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
const { getStorage } = require('firebase-admin/storage');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onValueWritten } = require('firebase-functions/v2/database');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const logger = require('firebase-functions/logger');

initializeApp();
const auth = getAuth();
const db = getDatabase();
const messaging = getMessaging();
// getStorage().bucket() NÃO pode ser chamado aqui no topo do arquivo —
// isso roda no momento em que o Node CARREGA o módulo (inclusive
// durante a análise local do `firebase deploy`, antes de qualquer
// function ser executada de verdade). Fora do ambiente do Google
// Cloud, resolver o bucket padrão bate num servidor de metadados que
// só existe dentro da nuvem, e a chamada fica pendurada até estourar
// o timeout de 10s do CLI ("Cannot determine backend specification").
// Por isso vira uma função — só é chamada de dentro de
// adminApagarLoja, quando a function já está rodando de verdade
// (dentro do Cloud Functions, onde o metadados existe).
function getBucket() {
    return getStorage().bucket();
}

// ── Lista de UIDs com permissão de admin (você) ───────────────────
// Depois de criar SEU PRÓPRIO usuário admin (ver instruções no chat),
// troca esse UID pelo real. Pode ter mais de um se precisar.
const ADMIN_UIDS = [
    'wZnsRcmzZeZaQ5NHGnNBg1jAEwz1',
];

function ehAdmin(uid) {
    return ADMIN_UIDS.includes(uid);
}

// Envolve o handler de uma function admin pra que QUALQUER erro não
// tratado (exception de código, .indexOn faltando, permissão do
// Google Cloud, etc.) chegue no painel com a mensagem real, em vez do
// "internal" genérico que o Firebase manda pro client por padrão
// (esconde detalhes de erro não-HttpsError por segurança). Isso evita
// precisar abrir o Console → Functions → Registros pra descobrir o
// que quebrou — o admin-criar-loja.html já mostra o texto direto na
// tela. Erros que já são HttpsError (as validações de invalid-argument
// etc. que cada function já lança) passam direto, sem reembrulhar.
function comErroDetalhado(handler) {
    return async (request) => {
        try {
            return await handler(request);
        } catch (e) {
            if (e instanceof HttpsError) throw e;
            logger.error('[erro-nao-tratado]', e);
            throw new HttpsError('internal', (e && e.message) ? e.message : String(e));
        }
    };
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

// Mesma ideia do enviarNotificacaoBroadcast, mas só pros usuários de
// UMA loja — pra avisos direcionados (ex: "regularize o pagamento")
// sem incomodar todo mundo. Duplica o corpo do broadcast de propósito
// (a filtragem por lojaId muda demais pra valer a pena tentar unificar
// num helper só, e cada um tem seu próprio "tipo" no histórico).
exports.enviarNotificacaoLoja = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx, data } = request;

    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador do sistema pode enviar essa notificação.');
    }

    const { lojaId, titulo, corpo } = data;
    if (!lojaId || !titulo || !corpo) {
        throw new HttpsError('invalid-argument', 'Preencha lojaId, título e corpo.');
    }

    const usuariosSnap = await db.ref('usuarios').orderByChild('lojaId').equalTo(lojaId).get();
    const usuarios = usuariosSnap.val() || {};
    const uids = Object.keys(usuarios);
    if (uids.length === 0) {
        return { mensagem: 'Essa loja não tem usuários.', enviados: 0, falhas: 0 };
    }

    const registrosHistorico = uids.map(uid =>
        db.ref(`usuarios/${uid}/notificacoesRecebidas`).push({
            tipo: 'aviso_loja',
            titulo,
            corpo,
            timestamp: Date.now(),
            lida: false,
        })
    );
    await Promise.all(registrosHistorico);

    const tokenParaUid = {};
    uids.forEach(uid => {
        const u = usuarios[uid];
        if (u && u.fcmTokens) Object.keys(u.fcmTokens).forEach(tok => { tokenParaUid[tok] = uid; });
    });
    const tokens = Object.keys(tokenParaUid);

    if (tokens.length === 0) {
        return { mensagem: 'Ninguém nessa loja ativou notificações ainda.', enviados: 0, falhas: 0 };
    }

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

        const limpezas = [];
        resposta.responses.forEach((r, idx) => {
            if (r.success) return;
            const codigo = (r.error && r.error.code) || '';
            if (codigo.includes('registration-token-not-registered') || codigo.includes('invalid-registration-token')) {
                const tok = loteTokens[idx];
                const uid = tokenParaUid[tok];
                if (uid) limpezas.push(db.ref(`usuarios/${uid}/fcmTokens/${tok}`).remove());
            } else {
                console.error('[enviarNotificacaoLoja] Falha ao enviar push:', codigo, r.error && r.error.message);
            }
        });
        await Promise.all(limpezas);
    }

    return { mensagem: `Enviado pra ${enviados} aparelho(s) da loja.`, enviados, falhas };
}));

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
// ── Calcula e grava venda.emAberto — pra Histórico paginar sem ─────
//    precisar baixar a loja inteira de vendas toda vez.
// emAberto = true pras 3 cores que SEMPRE precisam carregar por
// completo (aberta/parcial/parcelada-pendente) e false pras que só
// carregam nos últimos 2 meses (fechada/cancelada). Espelha EXATAMENTE
// a mesma lógica de venda/historico.js → calcularStatusFinanceiro,
// só que gravada no servidor pra virar campo indexável (orderByChild).
// Trigger SEPARADO da financeiroSyncVenda de propósito — não duplica
// nem depende dela, então continua funcionando mesmo enquanto aquela
// função está em standby/bugada.
// Guarda de loop: só escreve se o valor calculado for DIFERENTE do
// que já tá salvo — como a escrita é no mesmo node que o gatilho
// observa, gravar sempre (mesmo repetindo o valor) dispararia de novo
// e de novo pra sempre.
// Espelha EXATAMENTE a mesma lógica de venda/historico.js →
// calcularStatusFinanceiro (client), só que colapsada num booleano
// pra virar campo indexável no servidor. Compartilhada entre o
// trigger (vendaCalcularStatus, abaixo) e a migração one-off
// (migrarStatusVendas) pra nunca desalinhar as duas.
function calcularEmAberto(venda) {
    if (!venda) return null;
    if (venda.status === 'cancelada') return false;

    let parcelasTotal = 0, parcelasPagas = 0;
    (Array.isArray(venda.pagamentos) ? venda.pagamentos : []).forEach(p => {
        if (p && p.forma === 'parcelado' && Array.isArray(p.itens)) {
            parcelasTotal += p.itens.length;
            parcelasPagas += p.itens.filter(it => it && it.paga).length;
        }
    });
    if (parcelasTotal > 0 && parcelasPagas < parcelasTotal) return true; // parcelada-pendente

    const somaPaga = (Array.isArray(venda.pagamentos) ? venda.pagamentos : [])
        .reduce((s, p) => s + ((p && p.valor) || 0), 0);
    const total = venda.valorTotal ?? venda.valorVendido ?? 0;
    const completa = total > 0 && somaPaga >= total;
    return !completa; // completa=false (fechada) | qualquer outra coisa=true (aberta/parcial)
}

// ── Trigger: recalcula venda.emAberto toda vez que a venda muda ────
// Trigger SEPARADO da financeiroSyncVenda de propósito — não duplica
// nem depende dela, então continua funcionando mesmo enquanto aquela
// função está em standby/bugada.
// Guarda de loop: só escreve se o valor calculado for DIFERENTE do
// que já tá salvo — como a escrita é no mesmo node que o gatilho
// observa, gravar sempre (mesmo repetindo o valor) dispararia de novo
// e de novo pra sempre.
exports.vendaCalcularStatus = onValueWritten('lojas/{lojaId}/vendas/{vendaId}', async (event) => {
    const depois = event.data.after.val();
    if (!depois) return null; // venda apagada — nada a calcular

    const emAbertoCalculado = calcularEmAberto(depois);
    if (depois.emAberto === emAbertoCalculado) return null; // já tá certo, não reescreve (evita loop)

    try {
        await event.data.after.ref.child('emAberto').set(emAbertoCalculado);
    } catch (e) {
        logger.error('[vendaCalcularStatus] Falha ao gravar emAberto', {
            lojaId: event.params.lojaId, vendaId: event.params.vendaId, error: e.message,
        });
    }
    return null;
});

// ================================================================
// auditarIntegridadeVenda — 2ª camada de defesa (A10/A11 da auditoria)
//
// As regras do Realtime Database (firebase-rules-saas.json) já travam
// QUEM pode escrever o quê numa venda — mas não conseguem somar o
// array 'itens[]' pra conferir se bate com 'valorTotal' (limitação da
// própria linguagem de regras do RTDB, que só compara valores simples,
// não arrays/objetos). Essa function fecha esse buraco: roda em toda
// escrita de venda, confere a matemática de verdade em JavaScript, e
// se algo não bater, CORRIGE o valor errado sozinha e deixa um registro
// em auditoria/{lojaId}/violacoes pra o Gestor conferir depois — nunca
// cancela nem apaga a venda por conta própria, só corrige o número.
//
// Trigger SEPARADO de vendaCalcularStatus e financeiroSyncVenda de
// propósito — mesma convenção já usada neste arquivo: cada function
// cuida de uma responsabilidade só (aqui: integridade financeira).
//
// Proteção contra loop infinito: se o valor já bate (dentro de 1
// centavo de tolerância, por causa de arredondamento), a function não
// escreve nada — então a correção que ela mesma faz não dispara um
// novo ciclo (na 2ª vez que ela rodar, por causa da própria escrita,
// vai encontrar tudo certo e não fazer nada — mesmo padrão de
// vendaCalcularStatus, acima).
// ================================================================
exports.auditarIntegridadeVenda = onValueWritten('lojas/{lojaId}/vendas/{vendaId}', async (event) => {
    const { lojaId, vendaId } = event.params;
    const depois = event.data.after.val();
    if (!depois) return null; // venda apagada — nada a auditar

    if (depois.status === 'cancelada' || depois.status === 'cancelando') return null;

    const itens = Array.isArray(depois.itens) ? depois.itens
        : (depois.itens && typeof depois.itens === 'object') ? Object.values(depois.itens) : [];
    if (!itens.length) return null; // sem itens não há o que somar

    const TOLERANCIA = 0.01;
    const somaItens = Math.round(itens.reduce((s, it) => s + (Number(it && it.valorTotal) || 0), 0) * 100) / 100;
    const valorTotalAtual = Number(depois.valorTotal) || 0;

    const violacoes = [];
    let valorTotalCorrigido = null;

    if (Math.abs(valorTotalAtual - somaItens) > TOLERANCIA) {
        violacoes.push({
            campo: 'valorTotal', valorRecebido: valorTotalAtual, valorEsperado: somaItens,
            motivo: 'valorTotal não bate com a soma de itens[].valorTotal',
        });
        valorTotalCorrigido = somaItens;
    }

    // Líquido nunca pode ser maior que o bruto — o sistema não modela
    // nenhum caso (juros, multa) em que isso seria legítimo hoje.
    const valorLiquidoTotal = depois.valorLiquidoTotal;
    if (valorLiquidoTotal != null && valorLiquidoTotal > valorTotalAtual + TOLERANCIA) {
        violacoes.push({
            campo: 'valorLiquidoTotal', valorRecebido: valorLiquidoTotal, valorEsperado: valorTotalAtual,
            motivo: 'valorLiquidoTotal maior que valorTotal (líquido não pode superar o bruto)',
        });
    }

    if (!violacoes.length) return null; // tudo bate — não escreve nada (evita loop, ver comentário acima)

    logger.error('[auditarIntegridadeVenda] Divergência detectada — corrigindo', {
        lojaId, vendaId, violacoes, criadoPorUid: depois.criadoPorUid || null,
    });

    try {
        const escritas = [];
        if (valorTotalCorrigido !== null) {
            escritas.push(event.data.after.ref.child('valorTotal').set(valorTotalCorrigido));
        }
        escritas.push(db.ref(`auditoria/${lojaId}/violacoes`).push({
            vendaId, numeroVenda: depois.numeroVenda || null, violacoes,
            criadoPorUid: depois.criadoPorUid || null, criadoPorNome: depois.criadoPorNome || null,
            detectadoEm: Date.now(),
        }));
        await Promise.all(escritas);
    } catch (e) {
        logger.error('[auditarIntegridadeVenda] Erro ao corrigir/registrar', {
            lojaId, vendaId, error: e.message,
        });
    }
    return null;
});

// ================================================================
// Admin total — painel administrativo (admin-criar-loja.html)
// Todas as funções abaixo são admin-only (ehAdmin(uid)) e operam
// sobre QUALQUER loja, sem checagem de "é gestor dessa loja" — é
// justamente esse override que separa o admin do Gestor comum.
// ================================================================

// Lista todas as lojas com um resumo pra montar o dashboard do admin.
// Evita ler lojas/{lojaId} inteiro (que traria vendas, produtos etc.
// junto — pesado e desnecessário aqui): descobre os lojaIds a partir
// de /usuarios (todo usuário sempre tem lojaId) e lê só o /info de
// cada loja, que é pequeno.
exports.adminListarLojas = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx } = request;
    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador pode listar as lojas.');
    }

    const usuariosSnap = await db.ref('usuarios').get();
    const usuarios = usuariosSnap.val() || {};

    const membrosPorLoja = {};
    Object.entries(usuarios).forEach(([uid, u]) => {
        if (!u || !u.lojaId) return;
        if (!membrosPorLoja[u.lojaId]) membrosPorLoja[u.lojaId] = [];
        membrosPorLoja[u.lojaId].push({ uid, nome: u.nome || '', email: u.email || '', papel: u.papel || '' });
    });

    const lojaIds = Object.keys(membrosPorLoja);
    const lojas = await Promise.all(lojaIds.map(async lojaId => {
        const infoSnap = await db.ref(`lojas/${lojaId}/info`).get();
        const info = infoSnap.val() || {};
        return {
            lojaId,
            nome: info.nome || '(sem nome)',
            criadoEm: info.criadoEm || null,
            plano: info.plano || null,
            bloqueada: !!info.bloqueada,
            bloqueioMotivo: info.bloqueioMotivo || null,
            membros: membrosPorLoja[lojaId],
        };
    }));
    lojas.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    return { lojas };
}));

// Bloqueia/desbloqueia o acesso de uma loja (ex: falta de pagamento).
// A checagem de verdade acontece no client, em carregarDadosDoUsuario
// (core.js), que lê lojas/{lojaId}/info/bloqueada no login — ver o
// comentário lá sobre isso ainda não estar reforçado nas regras do
// Realtime Database.
exports.adminBloquearLoja = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx, data } = request;
    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador pode bloquear uma loja.');
    }
    const { lojaId, motivo } = data;
    if (!lojaId || !motivo || !motivo.trim()) {
        throw new HttpsError('invalid-argument', 'Preencha lojaId e motivo.');
    }
    await db.ref(`lojas/${lojaId}/info`).update({
        bloqueada: true,
        bloqueioMotivo: motivo.trim(),
        bloqueadaEm: Date.now(),
    });
    return { mensagem: 'Loja bloqueada.' };
}));

exports.adminDesbloquearLoja = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx, data } = request;
    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador pode desbloquear uma loja.');
    }
    const { lojaId } = data;
    if (!lojaId) throw new HttpsError('invalid-argument', 'Preencha lojaId.');
    await db.ref(`lojas/${lojaId}/info`).update({
        bloqueada: false,
        bloqueioMotivo: null,
        bloqueadaEm: null,
    });
    return { mensagem: 'Loja desbloqueada.' };
}));

exports.adminEditarNomeLoja = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx, data } = request;
    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador pode editar o nome da loja.');
    }
    const { lojaId, novoNome } = data;
    if (!lojaId || !novoNome || !novoNome.trim()) {
        throw new HttpsError('invalid-argument', 'Preencha lojaId e novoNome.');
    }
    await db.ref(`lojas/${lojaId}/info`).update({ nome: novoNome.trim() });
    return { mensagem: 'Nome da loja atualizado.' };
}));

// Troca o email de LOGIN de qualquer usuário (gestor ou funcionário)
// de qualquer loja. Diferente de alterarSenhaFuncionario (que só o
// Gestor da própria loja chama), essa é admin-only e sem restrição de
// loja — condizente com o "admin total".
exports.adminEditarEmailUsuario = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx, data } = request;
    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador pode editar o email de um usuário.');
    }
    const { uid, novoEmail } = data;
    if (!uid || !novoEmail) {
        throw new HttpsError('invalid-argument', 'Preencha uid e novoEmail.');
    }
    try {
        await auth.updateUser(uid, { email: novoEmail });
    } catch (e) {
        throw new HttpsError('already-exists', `Erro ao trocar email: ${e.message}`);
    }
    await db.ref(`usuarios/${uid}`).update({ email: novoEmail });
    return { mensagem: 'Email atualizado.' };
}));

exports.adminResetarSenhaUsuario = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx, data } = request;
    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador pode resetar a senha de um usuário.');
    }
    const { uid, novaSenha } = data;
    if (!uid || typeof novaSenha !== 'string' || novaSenha.length < 6) {
        throw new HttpsError('invalid-argument', 'A senha precisa ter pelo menos 6 caracteres.');
    }
    await auth.updateUser(uid, { password: novaSenha });
    return { mensagem: 'Senha atualizada.' };
}));

// Apaga UM usuário (gestor ou funcionário) — Auth + /usuarios/{uid} +
// o índice /lojas/{lojaId}/membros/{uid}. Não mexe no resto da loja.
// Não impede apagar o único Gestor de uma loja (é uma ferramenta de
// admin, a checagem de bom senso fica por conta de quem usa) — o
// client mostra um aviso antes de confirmar nesse caso.
exports.adminApagarUsuario = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx, data } = request;
    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador pode apagar um usuário.');
    }
    const { uid } = data;
    if (!uid) throw new HttpsError('invalid-argument', 'Preencha uid.');

    const usuSnap = await db.ref(`usuarios/${uid}`).get();
    const usu = usuSnap.val();
    if (!usu) throw new HttpsError('not-found', 'Usuário não encontrado.');

    try {
        await auth.deleteUser(uid);
    } catch (e) {
        if (e.code !== 'auth/user-not-found') {
            throw new HttpsError('internal', `Erro ao apagar do Auth: ${e.message}`);
        }
    }
    await db.ref(`usuarios/${uid}`).remove();
    if (usu.lojaId) await db.ref(`lojas/${usu.lojaId}/membros/${uid}`).remove();

    return { mensagem: `Usuário "${usu.nome || usu.email}" apagado.` };
}));

// Apaga uma loja INTEIRA: Realtime Database (lojas/, financeiro/,
// reparosSenhas/), arquivos no Storage e todos os usuários (Auth +
// /usuarios) vinculados a ela. Não tem como desfazer.
//
// Duas camadas de proteção contra apagar a loja errada: o client só
// habilita o botão depois de digitar o nome exato da loja, e aqui a
// Function confere de novo esse mesmo nome antes de tocar em
// qualquer coisa — protege contra uma chamada adulterada vinda de
// fora do client normal, não só contra clique errado.
//
// Antes de apagar, monta um snapshot com TUDO (loja + financeiro +
// reparosSenhas + dados dos usuários) e devolve na resposta — o
// client baixa isso como .json assim que a chamada retorna, sempre,
// sem exigir um passo manual separado. É a única cópia que sobra
// depois desse ponto.
exports.adminApagarLoja = onCall(comErroDetalhado(async (request) => {
    const { auth: authCtx, data } = request;
    if (!authCtx || !ehAdmin(authCtx.uid)) {
        throw new HttpsError('permission-denied', 'Só o administrador pode apagar uma loja.');
    }

    const { lojaId, confirmacaoNome } = data;
    if (!lojaId || !confirmacaoNome) {
        throw new HttpsError('invalid-argument', 'Preencha lojaId e confirmacaoNome.');
    }

    const infoSnap = await db.ref(`lojas/${lojaId}/info`).get();
    const info = infoSnap.val();
    if (!info) throw new HttpsError('not-found', 'Loja não encontrada.');
    if (confirmacaoNome.trim() !== info.nome) {
        throw new HttpsError('failed-precondition', 'O nome digitado não bate com o nome da loja — nada foi apagado.');
    }

    const [lojaSnap, financeiroSnap, reparosSenhasSnap] = await Promise.all([
        db.ref(`lojas/${lojaId}`).get(),
        db.ref(`financeiro/${lojaId}`).get(),
        db.ref(`reparosSenhas/${lojaId}`).get(),
    ]);
    const membrosIds = Object.keys((lojaSnap.val() || {}).membros || {});
    const usuariosDump = {};
    for (const uid of membrosIds) {
        const uSnap = await db.ref(`usuarios/${uid}`).get();
        if (uSnap.exists()) usuariosDump[uid] = uSnap.val();
    }
    const backup = {
        geradoEm: Date.now(),
        lojaId,
        loja: lojaSnap.val(),
        financeiro: financeiroSnap.val(),
        reparosSenhas: reparosSenhasSnap.val(),
        usuarios: usuariosDump,
    };

    const erros = [];
    for (const uid of membrosIds) {
        try {
            await auth.deleteUser(uid);
        } catch (e) {
            if (e.code !== 'auth/user-not-found') erros.push(`Usuário ${uid}: ${e.message}`);
        }
    }

    await Promise.all([
        db.ref(`lojas/${lojaId}`).remove(),
        db.ref(`financeiro/${lojaId}`).remove(),
        db.ref(`reparosSenhas/${lojaId}`).remove(),
        ...membrosIds.map(uid => db.ref(`usuarios/${uid}`).remove()),
    ]);

    try {
        await getBucket().deleteFiles({ prefix: `lojas/${lojaId}/` });
    } catch (e) {
        erros.push(`Storage: ${e.message}`);
    }

    logger.info('[adminApagarLoja] Loja apagada', { lojaId, nome: info.nome, membros: membrosIds.length, erros });
    return { mensagem: `Loja "${info.nome}" apagada.`, backup, erros };
}));

exports.financeiroSyncVenda = onValueWritten('lojas/{lojaId}/vendas/{vendaId}', async (event) => {
    const { lojaId, vendaId } = event.params;
    const depois = event.data.after.val();
    const financeiroRef = db.ref(`financeiro/${lojaId}/lancamentos`);
    const chaveAntiga = `venda_${vendaId}`;
    const prefixo = `venda_${vendaId}_`;

    // Busca só as chaves DESSA venda (range query por prefixo) — não
    // lê o node financeiro inteiro da loja, só a fatia relevante.
    const snapAtual = await financeiroRef.orderByKey().startAt(prefixo).endAt(prefixo + '\uf8ff').get();
    const existentes = snapAtual.val() || {};

    if (!depois || depois.status === 'cancelada') {
        // Venda apagada ou cancelada — reversão completa: tira a
        // entrada antiga (se sobrou de antes) e toda entrada granular
        // que essa venda tinha gerado.
        const remocoes = [financeiroRef.child(chaveAntiga).remove()];
        Object.keys(existentes).forEach(k => remocoes.push(financeiroRef.child(k).remove()));
        await Promise.all(remocoes);
        return null;
    }

    const desc = `Venda${depois.numeroVenda ? ' #' + depois.numeroVenda : ''}${depois.clienteNome ? ' · ' + depois.clienteNome : ''}`;
    const escritas = [financeiroRef.child(chaveAntiga).remove()]; // limpa o modelo antigo se sobrou de antes
    const chavesValidas = new Set();

    (Array.isArray(depois.pagamentos) ? depois.pagamentos : []).forEach((p, pIdx) => {
        if (!p) return;
        if (p.forma === 'parcelado' && Array.isArray(p.itens)) {
            p.itens.forEach((item, iIdx) => {
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
// ================================================================
// CredScan — análise de crédito via IA (Qwen, via OpenRouter),
// rodando em segundo plano.
//
// Fluxo: o CLIENTE faz o pré-processamento local (extrai texto de
// PDF digital, roda OCR se for foto/escaneado, aplica os filtros
// locais de apostas e qualidade do documento — tudo isso é JS puro,
// sem custo nenhum de IA) e sobe as fotos comprimidas pro Storage.
// Depois disso grava direto em lojas/{lojaId}/credscan/itens/{id}
// com status:'enviado' — e pode sair da tela na hora, sem esperar
// nada (ver credscan/captura.js).
//
// credscanProcessar (TRIGGER, não callable) dispara sozinha nesse
// write. É ela que faz a parte lenta: lê a chave da API salva pelo
// Gestor (nunca exposta ao client — ver regras), chama a IA, aplica
// as validações finais e grava o resultado. Quando termina, notifica
// quem enviou.
// ================================================================

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CS_MODEL_VL  = 'qwen/qwen3-vl-235b-a22b-instruct';
const CS_MODEL_TXT = 'qwen/qwen3-235b-a22b-2507';

function csR$(v) {
    return 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function csOpenRouterCall(apiKey, model, messages) {
    const resp = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: 6000, temperature: 0, messages }),
    });
    if (!resp.ok) {
        const e = await resp.json().catch(() => ({}));
        throw new Error((e.error && e.error.message) || `Erro na API (HTTP ${resp.status})`);
    }
    const d = await resp.json();
    return ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
}

function csAiCallTexto(apiKey, prompt) {
    return csOpenRouterCall(apiKey, CS_MODEL_TXT, [{ role: 'user', content: prompt }]);
}

function csAiCallVision(apiKey, imagensBase64, textoExtra, prompt) {
    const content = imagensBase64.map(b64 => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }));
    if (textoExtra && textoExtra.trim()) content.push({ type: 'text', text: textoExtra });
    content.push({ type: 'text', text: prompt });
    return csOpenRouterCall(apiKey, CS_MODEL_VL, [{ role: 'user', content }]);
}

function csBuildPromptRenda(textoExtrato) {
    return 'Voce e um analista financeiro. Leia o extrato bancario abaixo e calcule a RENDA MENSAL REAL do titular.\n\n' +
        'EXTRATO:\n' + textoExtrato.substring(0, 15000) + '\n\n' +
        'REGRAS CRITICAS:\n' +
        '1. Identifique o nome e CPF do TITULAR no cabecalho.\n' +
        '2. Exclua 100% entradas do proprio CPF (autotransferencias entre contas proprias).\n' +
        '3. Inclua: salarios (TED/Proventos do empregador), PIX de terceiros reais, pagamentos de clientes.\n' +
        '4. Para autonomos: some entradas de terceiros distintos por mes e calcule a media mensal.\n' +
        '5. Ignore: juros, rendimentos, correcao monetaria, estornos.\n' +
        '6. Calcule movimentacao total mensal (soma de TODAS as entradas brutas, incluindo autotransferencias).\n\n' +
        'Retorne APENAS JSON valido, sem texto extra:\n' +
        '{"rendaMensal":0.00,"movimentacaoMensal":0.00,"fontesPrincipais":["fonte1","fonte2"],"padrao":"regular ou irregular","meses":3}\n' +
        'rendaMensal = renda real liquida de terceiros.\n' +
        'movimentacaoMensal = total bruto de entradas por mes (incluindo tudo).\n' +
        'Nao invente. Se nao conseguir calcular, retorne rendaMensal=0.';
}

function csBuildPrompt(nomeLoja, produto, valor, rendaPreCalculada, ignorarApostas, regrasExtras, rendaMinima, taxaJuros) {
    const taxa = taxaJuros > 0 ? taxaJuros : 6;
    const rendaMin = rendaMinima || 1000;
    const rendaMinFmt = Number(rendaMin).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const vf = Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const vn = Number(valor);
    const e33 = (vn * 0.33).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const e35 = (vn * 0.35).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const e60 = (vn * 0.60).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const regraApostas = ignorarApostas
        ? ('2. Apostador compulsivo: NESTE CASO ESPECIFICO, NAO reprove automaticamente por apostas.\n' +
           '   Um analista humano ja revisou e decidiu forcar a analise mesmo com apostas detectadas.\n' +
           '   Ainda assim preencha casasDeJogoEncontradas normalmente (transparencia), mas a decisao\n' +
           '   final de aprovar/reprovar deve se basear no restante do comportamento financeiro\n' +
           '   (renda, dividas, comprometimento), sem aplicar reprovacao automatica por volume de apostas.\n\n')
        : ('2. Apostador compulsivo = REPROVADO\n' +
           '   Casas: PHOENIX GAMING, PIXBET, BLAZE, APOSTARAIZ, BANKS TECH, ATM PUBLICIDADE,\n' +
           '   SMART CLUSTER, M V D S M TECHNOLOGY, LOTTOPAY, GM INTERMEDIACAO, WIINPAY,\n' +
           '   AJC GATEWAY, NEXUMPAY, UNIVEBET, VAIDEBET, BETNACIONAL, R TORRES, NORBE FINTECH,\n' +
           '   GOLD NOW, LUXTAK, ou nome contendo BET/GAMING/APOSTAS/CASSINO.\n' +
           '   "SAQUE DIN LOTERICO" NAO e aposta — e operacao bancaria.\n' +
           '   10+ transacoes OU R$800+/mes OU 3+ meses = REPROVADO.\n' +
           '   1-4 esporadicas = penaliza nota mas nao reprova.\n\n');
    // Regras que o Gestor escreveu em Configurações → CredScan
    // (lojas/{lojaId}/credscan/config/regrasAdicionais). Entram como
    // consideracao extra, NUNCA mexendo na secao "=== JSON ===" — é
    // isso que garante que a IA sempre devolve o formato que o
    // csExtrairResultado sabe ler, não importa o que a loja escreva
    // aqui.
    const blocoRegrasExtras = (regrasExtras && regrasExtras.trim())
        ? ('=== REGRAS ADICIONAIS DESSA LOJA ===\n' +
           'Alem dos criterios acima, essa loja pediu que voce tambem leve isso em conta\n' +
           '(pode ser criterio de reprovacao, atencao especial, ou qualquer outra orientacao):\n' +
           regrasExtras.trim() + '\n\n')
        : '';
    return (
        `Voce e um analista de credito senior da ${nomeLoja}, loja de celulares.\n` +
        'Analise os documentos do cliente e retorne APENAS um JSON valido, sem texto adicional.\n\n' +
        'PRODUTO: ' + produto + ' | VALOR: R$ ' + vf + '\n\n' +
        '=== CONTEXTO ===\n' +
        `A ${nomeLoja} vende celulares parcelados no boleto. Queremos VENDER — seu trabalho e encontrar\n` +
        'a melhor condicao pra cada cliente, nao barrar. So reprova quem realmente nao pode pagar.\n' +
        'Voce recebera imagens (RG/CNH, holerites) e/ou texto digital de extratos bancarios.\n\n' +
        '=== TITULARIDADE ===\n' +
        'Se houver RG/CNH: extraia o nome (IGNORE filiacao/mae/pai) e compare com o nome do extrato.\n' +
        'Nomes diferentes = fraude = nota 0 REPROVADO. Sem documento pessoal: nomesBatem null.\n\n' +
        '=== RENDA ===\n' +
        '- Extrato: some APENAS entradas de terceiros. Pix do proprio CPF/nome = autotransferencia, ignore.\n' +
        '- Proventos TED do mesmo CPF de outro banco = salario (conta).\n' +
        '- Holerite: valor LIQUIDO.\n' +
        '- Motorista app: deduza 35% como custo operacional.\n' +
        (rendaPreCalculada ? `⚠️ RENDA PRE-CALCULADA: R$ ${rendaPreCalculada.toFixed(2)}. Use este valor.\n\n` : '\n') +
        '=== SUA ANALISE (livre — use sua inteligencia) ===\n' +
        'Analise o comportamento financeiro como um consultor experiente.\n' +
        'Observe tudo: perfil de gastos, comprometimento, disciplina, dividas, apostas, padroes.\n' +
        'De uma nota de 0 a 100 baseada no seu julgamento completo.\n' +
        'Voce e o especialista — nao precisa de regras rigidas.\n\n' +
        '=== APENAS 2 REPROVACOES OBRIGATORIAS ===\n' +
        `1. Renda real < R$ ${rendaMinFmt}/mes = REPROVADO (nao tem como pagar)\n` +
        regraApostas +
        blocoRegrasExtras +
        'Todo o resto APROVA com condicoes:\n' +
        '  FORTE (85-100): entrada 20% = R$ ' + e33 + ' | teto parcela 30% renda\n' +
        '  MEDIO (60-84):  entrada 35% = R$ ' + e35 + ' | teto parcela 20% renda\n' +
        '  FRACO (40-59):  entrada 60% = R$ ' + e60 + ' | teto parcela 10% renda\n\n' +
        ('Parcela = (Valor - Entrada) / 12 + juros ' + taxa + '%am.\n') +
        'Se parcela > teto: SUGESTAO_ENTRADA_ALTA (entrada turbinada = Valor - teto*8.4).\n' +
        'Se entrada turbinada > 80% valor: SUGESTAO_DOWNGRADE.\n\n' +
        '=== INSTRUCOES DOS CAMPOS NARRATIVOS ===\n' +
        'Seja DETALHADO. Use \\n dentro das strings para separar topicos. O vendedor precisa entender tudo.\n\n' +
        'analiseFinanceira: Organize em secoes com estes cabecalhos EXATOS (so inclua se tiver dados):\n' +
        '  RENDA: mes a mes com empresa e valor. Ex: "ALL MOTORS: R$1.795 (jan) / R$1.675 (fev) — media R$1.686"\n' +
        '  CASAS DE JOGO: se encontradas, mes a mes, nome da casa, valor enviado e recebido\n' +
        '  COMPROMISSOS FIXOS: cada boleto/crediario/emprestimo com nome e valor mensal\n' +
        '  COMPROMETIMENTO: % da renda comprometida (ex: "Aproximadamente 70% da renda comprometida")\n' +
        '  PADROES DE RISCO: comportamentos que chamaram atencao\n\n' +
        'casasDeJogoEncontradas: CAMPO CRITICO. Array OBRIGATORIO com nomes EXATOS de casas de jogos/apostas\n' +
        'encontradas no extrato. Se nenhuma: []. Exemplos de nomes a buscar:\n' +
        'R Torres, Royal Crest, Nexabet, Nexumpay, Smart Cluster, Ganha Sorte, Vendifootball,\n' +
        'GM Intermediacao, Norbe Fintech, Phoenix Gaming, Pixbet, Blaze, Vaidebet, Betnacional,\n' +
        'ou qualquer nome contendo BET, GAMING, APOSTAS, CASSINO, LOTERIA.\n\n' +
        '=== JSON ===\n' +
        '{\n' +
        '  "nomeDocumentoPessoal": "",\n' +
        '  "nomeComprovanteRenda": "",\n' +
        '  "nomesBatem": true,\n' +
        '  "confiancaLeitura": "ALTA",\n' +
        '  "resumoExecutivo": "1 frase: nome, renda, veredicto.",\n' +
        '  "perfilCliente": "Perfil detalhado 4-6 linhas: fonte de renda, estabilidade, comportamento.",\n' +
        '  "analiseFinanceira": "Analise completa com cabecalhos RENDA:, COMPROMISSOS FIXOS:, etc.",\n' +
        '  "casasDeJogoEncontradas": [],\n' +
        '  "rendaEstimada": 0.00,\n' +
        '  "nota": 0,\n' +
        '  "nivel": "FORTE ou MEDIO ou FRACO ou REPROVADO",\n' +
        '  "decisao": "VENDER ou REPROVADO ou SUGESTAO_DOWNGRADE ou SUGESTAO_ENTRADA_ALTA",\n' +
        '  "entradaTurbinadaCalculada": 0.00,\n' +
        '  "motivosReprovacao": "Topicos detalhados se reprovado. Vazio se aprovado."\n' +
        '}\n'
    );
}

// Lista compartilhada entre o pré-filtro local (client, ver
// credscan/captura.js) e a re-checagem pós-IA aqui embaixo — as duas
// pontas usam a MESMA lista de propósito, pra nunca ficarem
// dessincronizadas uma da outra.
const CS_CASAS_APOSTAS_KEYWORDS = [
    'phoenix gaming', 'm v d s m technology', 'atm publicidade', 'smart cluster',
    'banks tech', 'apostaraiz', 'royal crest', 'lottopay', 'gm intermediacao',
    'wiinpay', 'ajc gateway', 'nexumpay', 'univebet', 'vaidebet', 'betnacional',
    'pixbet', 'blaze', 'betano', 'esportes da sorte', 'superbet',
    'r torres', 'norbe fintech', 'norbe', 'gold now', 'luxtak',
    'futbol bet', 'betgaming', 'bet gaming', 'betfair', 'sportingbet', 'betway',
    'bet365', 'pinnacle', '1xbet', 'stake', 'f12 bet', 'galera bet', 'kto',
    'betsson', 'mrjack', 'f12bet', 'realsbet', 'onabet', 'brabet', 'betninja',
    'jogomix', 'galera.bet', 'estrela bet', 'vcoin', 'syncpay', 'sync pay',
    'pagbet', 'betpix', 'sportbetio', 'sport bet', 'betcris', 'rivalo',
    'betmotion', 'betsul', 'velozbet', 'veloz bet', 'fortune tiger', 'cassino',
];

// Re-checa o texto que a PRÓPRIA IA devolveu (analiseFinanceira +
// perfilCliente) atrás de casas de apostas — rede de segurança pro
// caso o pré-filtro local (que roda em cima do texto bruto, antes de
// qualquer OCR/IA) não tenha pego algo que só ficou visível depois
// da IA processar. 3+ casas = reprova na marra, mesmo que a IA tenha
// aprovado; 1-2 = penaliza a nota mas não reprova sozinho.
function csValidarApostasNaResposta(d, forcarIA) {
    if (forcarIA || d.reprovado) return;
    const textoIA = ((d.analise || '') + ' ' + (d.perfil || '')).toLowerCase();
    const casas = [];
    CS_CASAS_APOSTAS_KEYWORDS.forEach(c => { if (textoIA.indexOf(c) !== -1) casas.push(c); });
    (d.casasJogo || []).forEach(c => { if (c && !casas.includes(c.toLowerCase())) casas.push(c.toLowerCase()); });

    if (casas.length >= 3) {
        const notaOriginal = d.nota;
        d.aprov = false; d.reprovado = true; d.nota = 0;
        d.risco = 'REPROVADO'; d.entradaPct = 0.60;
        d.casasJogo = casas;
        d.motivos = `REPROVADO — Apostador Identificado\n${casas.length} casas detectadas: ${casas.join(', ')}\n(IA original: ${notaOriginal} pts — corrigido para 0)`;
    } else if (casas.length >= 1 && casas.length <= 2 && d.nota > 39) {
        const penalidade = casas.length === 1 ? 10 : 20;
        d.nota = Math.max(40, d.nota - penalidade);
        d.casasJogo = casas;
        if (d.nota < 60) { d.risco = 'FRACO'; d.entradaPct = 0.60; }
        else if (d.nota < 85) { d.risco = 'MEDIO'; d.entradaPct = 0.35; }
    }
}

function csValidarMovimentacaoAlta(d, movimentacaoMensal) {
    if (d.reprovado || !movimentacaoMensal || movimentacaoMensal < 6000) return;
    d.nota = Math.min(100, d.nota + 5);
    if (d.nota >= 85 && d.entradaPct > 0.33) d.entradaPct = 0.33;
    else if (d.nota >= 60 && d.entradaPct > 0.35) d.entradaPct = 0.35;
}

function csParsearSecoes(texto) {
    if (!texto) return {};
    const KEYS = ['RENDA', 'CASAS DE JOGO', 'COMPROMISSOS FIXOS', 'COMPROMETIMENTO', 'PADROES DE RISCO'];
    const res = {};
    KEYS.forEach(k => {
        const ix = texto.indexOf(k + ':');
        if (ix === -1) return;
        const s = ix + k.length + 1;
        let e = texto.length;
        KEYS.forEach(k2 => {
            if (k2 === k) return;
            const i2 = texto.indexOf(k2 + ':', s);
            if (i2 !== -1 && i2 < e) e = i2;
        });
        res[k] = texto.substring(s, e).trim().replace(/\n{3,}/g, '\n\n').replace(/^[\s\-]+/, '');
    });
    return res;
}

// Extrai e valida o JSON que a IA devolveu — a aprovação NUNCA confia
// cegamente no campo "decisao" da IA, é sempre recalculada a partir
// da nota (a IA erra a decisão de vez em quando, mas acerta a nota).
function csExtrairResultado(texto) {
    let jsonStr = texto;
    try {
        const i1 = texto.indexOf('{'), i2 = texto.lastIndexOf('}');
        if (i1 !== -1 && i2 !== -1 && i2 > i1) jsonStr = texto.substring(i1, i2 + 1);
        const obj = JSON.parse(jsonStr);

        const nomesBatem = obj.nomesBatem !== false;
        let nota = typeof obj.nota === 'number' ? obj.nota : parseInt(obj.nota || 0, 10);
        if (nota > 92) nota = 92; // teto: nenhum cliente é perfeito

        let motivosReprovacao = obj.motivosReprovacao || '';
        if (!nomesBatem) {
            nota = 0;
            motivosReprovacao = `Alerta de Fraude: Divergência de Titularidade.\nDocumento Pessoal: ${obj.nomeDocumentoPessoal || 'Não encontrado'}\nComprovante de Renda: ${obj.nomeComprovanteRenda || 'Não encontrado'}`;
        }

        const dec = (obj.decisao || '').toUpperCase();
        const downgrade = dec.includes('DOWNGRADE');
        const entradaAlta = dec.includes('ENTRADA_ALTA');
        let aprov = nota >= 40;
        if (!nomesBatem) aprov = false;

        const renda = typeof obj.rendaEstimada === 'number' ? obj.rendaEstimada : parseFloat(obj.rendaEstimada || 0);
        const entAltaCalc = typeof obj.entradaTurbinadaCalculada === 'number' ? obj.entradaTurbinadaCalculada : parseFloat(obj.entradaTurbinadaCalculada || 0);
        const nomeCompleto = obj.nomeComprovanteRenda || obj.nomeDocumentoPessoal || 'Cliente';
        const confianca = (obj.confiancaLeitura || 'ALTA').toUpperCase();

        let risco = 'REPROVADO', entradaPct = 0.60;
        if (nota >= 85) { risco = 'FORTE'; entradaPct = 0.33; }
        else if (nota >= 60) { risco = 'MEDIO'; entradaPct = 0.35; }
        else if (nota >= 40) { risco = 'FRACO'; entradaPct = 0.60; }
        else { risco = 'REPROVADO'; aprov = false; }

        return {
            aprov, downgrade, entradaAlta, reprovado: !aprov,
            nota, risco, entradaPct, rendaEstimada: renda,
            entrada: entAltaCalc || null,
            nomeCliente: nomeCompleto.split(' ')[0], nomeCompleto,
            nomeDocPessoal: obj.nomeDocumentoPessoal || '', nomeRenda: obj.nomeComprovanteRenda || '',
            nomesBatem: obj.nomesBatem, confianca,
            perfil: obj.perfilCliente || '', analise: obj.analiseFinanceira || '',
            resumoExec: obj.resumoExecutivo || '', motivos: motivosReprovacao,
            casasJogo: Array.isArray(obj.casasDeJogoEncontradas) ? obj.casasDeJogoEncontradas.filter(Boolean) : [],
        };
    } catch (e) {
        return {
            aprov: false, downgrade: false, entradaAlta: false, reprovado: true,
            nota: 0, risco: 'ERRO', entradaPct: 0.60, rendaEstimada: 0,
            nomeCliente: 'Erro', nomeCompleto: 'Erro na leitura da IA', confianca: 'ALTA',
            nomeDocPessoal: '', nomeRenda: '', nomesBatem: null,
            perfil: '', analise: '', resumoExec: '', casasJogo: [],
            motivos: 'A IA não devolveu uma resposta no formato esperado. Tenta de novo — se persistir, os documentos podem estar ilegíveis.',
        };
    }
}

function csPrecoParcela(valor, entrada, n, taxaMes) {
    const s = valor - entrada;
    if (s <= 0 || n <= 0) return 0;
    const t = taxaMes / 100;
    if (t === 0) return s / n;
    return s * (t * Math.pow(1 + t, n)) / (Math.pow(1 + t, n) - 1);
}

// Recalcula a decisão final de aprovação/entrada/parcela a partir da
// nota — matemática pura, sem IA nenhuma envolvida. taxaJuros em % ao
// mês (ex: 6 = 6%); usa o padrão 6 se não vier nada.
function csReavaliarDecisao(d, valor, taxaJuros) {
    const taxa = taxaJuros > 0 ? taxaJuros : 6;
    if (d.reprovado || !(d.rendaEstimada > 0)) return d;
    const tetoPct = d.nota >= 85 ? 0.30 : d.nota >= 60 ? 0.20 : 0.10;
    const teto = d.rendaEstimada * tetoPct;
    const enMin = Math.ceil(valor * d.entradaPct / 10) * 10;
    // Fator PMT de 12 parcelas na taxa configurada — com taxa=6 dá
    // ~8.4, que era o número fixo usado antes (só generalizado agora).
    const i = taxa / 100;
    const fator = i > 0 ? (1 - Math.pow(1 + i, -12)) / i : 12;
    const saldo = valor - enMin;
    const parcelaBase = saldo / fator;

    if (parcelaBase <= teto) {
        d.aprov = true; d.entradaAlta = false; d.downgrade = false;
        d.entrada = enMin; d.parcelas = 12; d.vparcela = csPrecoParcela(valor, enMin, 12, taxa);
        d.total = enMin + d.vparcela * 12;
        return d;
    }
    // Parcela normal estoura o teto — turbina a entrada.
    const entradaTurbinada = Math.ceil((valor - teto * fator) / 10) * 10;
    if (entradaTurbinada > valor * 0.80) {
        d.aprov = false; d.downgrade = true; d.reprovado = false;
        d.entrada = null; d.parcelas = null; d.vparcela = null;
        return d;
    }
    d.aprov = true; d.entradaAlta = true; d.downgrade = false;
    d.entrada = entradaTurbinada; d.parcelas = 12;
    d.vparcela = csPrecoParcela(valor, entradaTurbinada, 12, taxa);
    d.total = entradaTurbinada + d.vparcela * 12;
    return d;
}

// Troca {placeholders} pelo valor real — usado quando a loja
// personalizou a mensagem em Configurações → CredScan. Placeholders
// que não existirem no objeto viram string vazia, nunca quebram.
function csAplicarTemplate(template, valores) {
    return template.replace(/\{(\w+)\}/g, (m, chave) => (valores[chave] != null ? valores[chave] : ''));
}

function csGerarWppReprovado(nomeCliente, templateCustom) {
    if (templateCustom && templateCustom.trim()) {
        return csAplicarTemplate(templateCustom, { cliente: nomeCliente });
    }
    return `Opa! ☺️\n\nEntão, infelizmente a financeira não aprovou essa tentativa no momento 😞\nMas calma, isso é normal e pode mudar com o tempo!\n\nUma sugestão: se tiver alguém próximo (como mãe, pai, irmão, esposa...) que possa fazer a análise no nome dela(e), talvez dê certo. 😉\nÉ só me avisar que eu mando as informações de novo rapidinho! 📄✅\n\nE claro, seguimos com outras opções também: cartão de crédito em até 18x sem juros, ou modelos mais acessíveis no boleto.\n\nTô por aqui pra te ajudar no que for preciso! 🤝📲`;
}

function csGerarWpp(produto, d, templateCustom) {
    if (!d.aprov) return csGerarWppReprovado(d.nomeCliente, templateCustom);
    if (d.downgrade) return `Olá ${d.nomeCliente}! Boas notícias, liberamos crédito pra você! ✅\n\nO ${produto} ultrapassou sua margem ideal, MAS temos um limite mais acessível aprovado AGORA! 🚀\nTemos ótimas opções no estoque que cabem no seu bolso!\nMe fala qual modelo te interessa 👇`;
    if (d.entradaAlta) return `Olá ${d.nomeCliente}, tudo bem? 😊📲\nSeu cadastro foi avaliado! ✅\n\nPara liberar o aparelho e manter a parcela suave, o sistema calculou uma entrada de ${csR$(d.entrada)}.\nSua parcela fica em apenas ${d.parcelas}x de ${csR$(d.vparcela)} MENSAL no boleto! 📉\n\nVocê tem esse valor disponível (FGTS, acerto, poupança)? 👇`;
    if (templateCustom && templateCustom.trim()) {
        return csAplicarTemplate(templateCustom, {
            cliente: d.nomeCliente, produto,
            entrada: csR$(d.entrada), parcelas: d.parcelas, parcela: csR$(d.vparcela), total: csR$(d.total),
        });
    }
    return `Olá ${d.nomeCliente}, tudo bem? 😊📲\nSeu cadastro foi APROVADO! ✅\n\n📱 ${produto}\n💰 Entrada: ${csR$(d.entrada)}\n💳 + ${d.parcelas}x de ${csR$(d.vparcela)} MENSAL no boleto\n\n✔ Aparelho revisado e com garantia\nMe confirma aqui pra gente seguir com a liberação 👇`;
}

function csMontarResultadoApostasReprovado(item) {
    const ap = item.apostasPreDetectado || {};
    const motivo = `REPROVADO AUTOMÁTICO — Apostador Compulsivo\nGatilho: ${ap.gatilho}\nDetalhe: ${ap.detalhe || ''}`;
    return {
        aprov: false, downgrade: false, entradaAlta: false, reprovado: true,
        nota: 0, risco: 'REPROVADO', confianca: 'ALTA', rendaEstimada: 0,
        entrada: null, parcelas: null, vparcela: null,
        nomeCliente: item.clienteNome || 'Cliente', nomeCompleto: item.clienteNome || 'Cliente',
        nomeDocPessoal: '', nomeRenda: '', nomesBatem: null,
        perfil: 'Apostador compulsivo identificado automaticamente pela análise local do extrato, antes de qualquer chamada à IA.',
        analise: '', resumoExec: motivo, motivos: motivo, casasJogo: [],
        wpp: csGerarWppReprovado(item.clienteNome || 'Cliente'),
    };
}

function csResultadoErro(mensagem) {
    return {
        aprov: false, downgrade: false, entradaAlta: false, reprovado: true,
        nota: 0, risco: 'ERRO', confianca: 'BAIXA', rendaEstimada: 0,
        entrada: null, parcelas: null, vparcela: null,
        nomeCliente: 'Cliente', nomeCompleto: 'Cliente',
        nomeDocPessoal: '', nomeRenda: '', nomesBatem: null,
        perfil: '', analise: '', resumoExec: '', casasJogo: [],
        motivos: mensagem, wpp: '',
    };
}

async function csBaixarComoBase64(bucket, caminho) {
    const [buf] = await bucket.file(caminho).download();
    return buf.toString('base64');
}

async function csNotificarConclusao(lojaId, item, itemId, resultado) {
    if (!item.enviadoPorUid) return;
    try {
        const usuarioSnap = await db.ref(`usuarios/${item.enviadoPorUid}`).get();
        const usuarioVal = usuarioSnap.val();
        if (!usuarioVal) return;
        const titulo = resultado.aprov ? 'Crédito aprovado ✅' : 'Análise concluída';
        const corpo = `${item.clienteNome || 'Cliente'} — ${resultado.aprov ? 'aprovado, nota ' + resultado.nota : 'reprovado'}`;
        await processarEEnviarAvisos(
            { [item.enviadoPorUid]: [{ titulo, corpo, dados: { credscanId: itemId } }] },
            { [item.enviadoPorUid]: usuarioVal },
            'credscanConcluido',
            qtd => `${qtd} análises de crédito concluídas`
        );
    } catch (e) {
        logger.error('[credscanProcessar] Falha ao notificar', { lojaId, itemId, error: e.message });
    }
}

exports.credscanProcessar = onValueWritten('lojas/{lojaId}/credscan/itens/{itemId}', async (event) => {
    const item = event.data.after.val();
    if (!item || item.status !== 'enviado') return null; // já processado, ou apagado — nada a fazer

    const { lojaId, itemId } = event.params;
    const itemRef = event.data.after.ref;

    try {
        const [chaveSnap, configSnap, infoSnap] = await Promise.all([
            db.ref(`credscanChaves/${lojaId}/openrouterKey`).get(),
            db.ref(`lojas/${lojaId}/credscan/config`).get(),
            db.ref(`lojas/${lojaId}/info`).get(),
        ]);
        const apiKey = chaveSnap.val();
        const cfg = configSnap.val() || {};
        const regrasExtras = cfg.regrasAdicionais || '';
        // Default true/1000 quando a loja nunca mexeu nisso — mantém
        // o comportamento de sempre pra quem não configurou nada.
        const reprovarApostas = cfg.reprovarApostas !== false;
        const rendaMinima = cfg.rendaMinima > 0 ? cfg.rendaMinima : 1000;
        const taxaJuros = cfg.taxaJuros > 0 ? cfg.taxaJuros : 6;
        const mensagemAprovado = cfg.mensagemAprovado || '';
        const mensagemReprovado = cfg.mensagemReprovado || '';
        const nomeLoja = (infoSnap.val() || {}).nome || 'loja';

        if (!apiKey) {
            await itemRef.update({
                status: 'concluido', concluidoEm: Date.now(),
                resultado: csResultadoErro('CredScan não está configurado pra essa loja. Peça pro Gestor salvar a chave em Configurações → CredScan.'),
            });
            return null;
        }

        // ── Curto-circuito: apostas já pegas no filtro local (client),
        // sem gastar nenhum token de IA — só roda se a loja não
        // desligou "reprovar por apostas" em Configurações → CredScan ──
        if (reprovarApostas && item.apostasPreDetectado && item.apostasPreDetectado.gatilho && !item.forcarIA) {
            const resultado = csMontarResultadoApostasReprovado(item);
            await itemRef.update({ status: 'concluido', concluidoEm: Date.now(), resultado });
            await csNotificarConclusao(lojaId, item, itemId, resultado);
            return null;
        }

        // ── Reaproveita análise recente (30 dias) do mesmo CPF, se o
        // CPF já veio identificado por regex do lado do cliente (de
        // graça — não vale a pena gastar uma chamada de IA só pra
        // tentar achar CPF de novo aqui). O client já pergunta antes
        // de mandar se a pessoa quer reaproveitar ou forçar uma
        // análise nova — !item.forcarNovaAnalise é justamente essa
        // escolha chegando aqui. ──
        if (item.cpfDetectado && item.cpfDetectado.length === 11 && !item.forcarNovaAnalise) {
            const trintaDiasAtras = Date.now() - 30 * 86400000;
            const itensSnap = await db.ref(`lojas/${lojaId}/credscan/itens`)
                .orderByChild('cpfDetectado').equalTo(item.cpfDetectado).get();
            const itens = itensSnap.val() || {};
            const anterior = Object.entries(itens)
                .filter(([id, v]) => id !== itemId && v.status === 'concluido' && v.criadoEm > trintaDiasAtras && v.resultado)
                .sort((a, b) => b[1].criadoEm - a[1].criadoEm)[0];
            if (anterior) {
                const rAntigo = anterior[1].resultado;
                let resultado = { ...rAntigo, reaproveitado: true };
                // Recalcula entrada/parcela/total pro produto/valor
                // DESSE item (pode ser o mesmo produto de antes, ou um
                // produto diferente — "Simular outro produto" na tela
                // de resultado usa esse mesmo caminho). Matemática
                // pura, sem gastar IA — só roda se a análise antiga
                // tinha sido aprovada, reprovado não tem preço pra
                // recalcular.
                if (rAntigo.aprov && rAntigo.risco !== 'REPROVADO') {
                    const dRecalc = csReavaliarDecisao({ ...rAntigo }, item.valor, taxaJuros);
                    resultado = { ...resultado, ...dRecalc };
                    resultado.wpp = csGerarWpp(item.produto, dRecalc, mensagemAprovado);
                }
                await itemRef.update({ status: 'concluido', concluidoEm: Date.now(), clienteNome: anterior[1].clienteNome || null, resultado });
                item.clienteNome = anterior[1].clienteNome; // pra notificação usar o nome certo, não "Cliente" genérico
                await csNotificarConclusao(lojaId, item, itemId, resultado);
                return null;
            }
        }

        // ── Pipeline de IA ──
        const bucket = getBucket();
        const imagensRendaBase64 = item.imagensRendaCaminhos && item.imagensRendaCaminhos.length
            ? await Promise.all(item.imagensRendaCaminhos.map(c => csBaixarComoBase64(bucket, c)))
            : [];
        const imagensDocBase64 = item.imagensDocCaminhos && item.imagensDocCaminhos.length
            ? await Promise.all(item.imagensDocCaminhos.map(c => csBaixarComoBase64(bucket, c)))
            : [];
        const todasImagens = imagensDocBase64.concat(imagensRendaBase64);

        const temSoTexto = todasImagens.length === 0 && item.textoDigital;
        // ignorarApostas fica true se QUALQUER um dos dois pedir:
        // forcarIA (o vendedor decidiu forçar essa análise específica
        // mesmo com apostas) OU reprovarApostas=false (a loja inteira
        // desligou isso em Configurações → CredScan).
        const ignorarApostas = item.forcarIA || !reprovarApostas;
        let rendaPreCalculada = null, movimentacaoMensal = 0, resp;

        if (temSoTexto) {
            try {
                const respRenda = await csAiCallTexto(apiKey, csBuildPromptRenda(item.textoDigital));
                const ir1 = respRenda.indexOf('{'), ir2 = respRenda.lastIndexOf('}');
                if (ir1 !== -1 && ir2 > ir1) {
                    const objRenda = JSON.parse(respRenda.substring(ir1, ir2 + 1));
                    if (objRenda.rendaMensal > 0) rendaPreCalculada = objRenda.rendaMensal;
                    if (objRenda.movimentacaoMensal > 0) movimentacaoMensal = objRenda.movimentacaoMensal;
                }
            } catch (eR) {
                logger.warn('[credscanProcessar] Etapa de renda falhou, seguindo sem pré-cálculo', { lojaId, itemId, error: eR.message });
            }
            const textoParaAnalise = '=== EXTRATO ===\n' + item.textoDigital.substring(0, 25000) + '\n\n';
            resp = await csAiCallTexto(apiKey, textoParaAnalise + csBuildPrompt(nomeLoja, item.produto, item.valor, rendaPreCalculada, ignorarApostas, regrasExtras, rendaMinima, taxaJuros));
        } else if (todasImagens.length > 0) {
            resp = await csAiCallVision(apiKey, todasImagens, item.textoDigital || '', csBuildPrompt(nomeLoja, item.produto, item.valor, null, ignorarApostas, regrasExtras, rendaMinima, taxaJuros));
        } else {
            await itemRef.update({ status: 'concluido', concluidoEm: Date.now(), resultado: csResultadoErro('Nenhum documento legível foi enviado.') });
            return null;
        }

        const d = csExtrairResultado(resp);
        if (reprovarApostas) csValidarApostasNaResposta(d, item.forcarIA);

        if (d.rendaEstimada > 0 && d.rendaEstimada < rendaMinima && !d.reprovado) {
            d.aprov = false; d.reprovado = true; d.nota = Math.min(d.nota, 30);
            d.risco = 'REPROVADO';
            d.motivos = (d.motivos ? d.motivos + '\n' : '') + `Renda de R$ ${d.rendaEstimada} abaixo do mínimo de R$ ${rendaMinima}. Impossível parcelar.`;
        }
        if (!(d.rendaEstimada > 0) && !d.reprovado) {
            d.aprov = false; d.reprovado = true; d.nota = 0;
            d.risco = 'REPROVADO';
            d.motivos = (d.motivos ? d.motivos + '\n' : '') + 'Renda estimada = R$ 0,00. Impossível aprovar sem comprovação de renda.';
        }

        csValidarMovimentacaoAlta(d, movimentacaoMensal);
        csReavaliarDecisao(d, item.valor, taxaJuros);
        d.wpp = csGerarWpp(item.produto, d, d.aprov ? mensagemAprovado : mensagemReprovado);

        const secoes = csParsearSecoes(d.analise);
        const resultado = {
            aprov: d.aprov, downgrade: d.downgrade, entradaAlta: d.entradaAlta, reprovado: d.reprovado,
            nota: d.nota, risco: d.risco, confianca: d.confianca, rendaEstimada: d.rendaEstimada,
            entrada: d.entrada, parcelas: d.parcelas, vparcela: d.vparcela, total: d.total,
            resumoExec: d.resumoExec, perfil: d.perfil,
            analiseRenda: secoes['RENDA'] || '', comprometimento: [secoes['COMPROMISSOS FIXOS'], secoes['COMPROMETIMENTO']].filter(Boolean).join('\n\n'),
            padroesRisco: secoes['PADROES DE RISCO'] || '', motivos: d.motivos,
            casasJogo: d.casasJogo, nomeDocPessoal: d.nomeDocPessoal, nomeRenda: d.nomeRenda,
            nomesBatem: d.nomesBatem, wpp: d.wpp,
        };

        // O modal de nova análise não pede mais nome digitado — o
        // cliente já preenche sozinho aqui, com o nomeCompleto que o
        // csExtrairResultado já monta (comprovante de renda > doc
        // pessoal > "Cliente" genérico).
        await itemRef.update({ status: 'concluido', concluidoEm: Date.now(), clienteNome: d.nomeCompleto, resultado });
        item.clienteNome = d.nomeCompleto; // pra notificação usar o nome certo, não "Cliente" genérico (item ainda tinha null)
        await csNotificarConclusao(lojaId, item, itemId, resultado);
    } catch (e) {
        logger.error('[credscanProcessar] Erro', { lojaId, itemId, error: e.message });
        try {
            await itemRef.update({ status: 'concluido', concluidoEm: Date.now(), resultado: csResultadoErro(`Erro ao processar: ${e.message}`) });
        } catch (e2) { /* nem isso deu — fica em 'enviado' pra sempre, mas não tinha mais o que tentar */ }
    }
    return null;
});
