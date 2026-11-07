// ================================================================
// core.js — VortexSmart SaaS · Core / Firebase / Estado Compartilhado
// Expõe via window.*:
//   _rates, _areRatesLoaded, _getRate, products, _fuse,
//   flagData, safeStorage, showCustomModal, showMainSection,
//   openCalculatorSection, parseBrazilianCurrencyToFloat, escapeHtml,
//   updateFlagDisplay, openFlagSelector, closeFlagModal,
//   _lojaId, _papelUsuario, _permissoesUsuario, _fazerLogout
// ================================================================
import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js';
import { getDatabase, ref, onValue, off, update, push, get, remove, runTransaction, query, orderByChild, equalTo, limitToLast, startAt, endAt } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-functions.js';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js';
import { getMessaging, getToken, onMessage, isSupported as fcmIsSupported } from 'https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging.js';

// 🚧 CREDSCAN — segurado pra uma versão futura, de propósito.
// O módulo inteiro já está pronto e funcionando (credscan/*.js,
// configuracoes/config-credscan.js, Cloud Function credscanProcessar)
// — só os DOIS pontos de entrada (card no hub + item em
// Configurações) ficam escondidos enquanto essa flag for false, pra
// nenhuma loja ver isso antes da hora. Quando for lançar de verdade,
// muda só isso aqui pra true — nada mais precisa mudar.
const CREDSCAN_LANCADO = false;
window._CREDSCAN_LANCADO = CREDSCAN_LANCADO;

// ── Firebase (projeto SaaS: vortex-b3761) ──────────────────────
const firebaseConfig = {
    apiKey:            'AIzaSyC1HuGxN7ko4MdYYJCM5QDQmkpbN5lfxA4',
    authDomain:        'vortex-b3761.firebaseapp.com',
    databaseURL:       'https://vortex-b3761-default-rtdb.firebaseio.com',
    projectId:         'vortex-b3761',
    storageBucket:     'vortex-b3761.firebasestorage.app',
    messagingSenderId: '920463151800',
    appId:             '1:920463151800:web:6011489281000edab365a4d'
};

const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getDatabase(app);
const functions = getFunctions(app);
const storage   = getStorage(app);

window._firebaseDB = db;
// Só informativo (o Diagnóstico do sistema mostra): em qual bucket do Storage o app envia os arquivos.
window._storageBucket = firebaseConfig.storageBucket;
window._firebaseRef = ref;
window._dbOnValue = onValue;
window._dbOff = off;
window._dbUpdate = update;
window._dbPush = push;
window._dbGet = get;
window._dbRemove = remove;
window._dbTransaction = runTransaction;
window._dbQuery = query;
window._dbOrderByChild = orderByChild;
window._dbEqualTo = equalTo;
window._dbLimitToLast = limitToLast;
window._dbStartAt = startAt;
window._dbEndAt = endAt;

window._firebaseStorage = storage;
window._storageRef = storageRef;
window._storageUploadBytes = uploadBytes;
window._storageGetDownloadURL = getDownloadURL;
window._storageDeleteObject = deleteObject;

// ── Notificações push (FCM) ─────────────────────────────────────
// getMessaging() pode falhar em navegador sem suporte (contexto sem
// HTTPS, navegador antigo) — por isso isSupported() primeiro, de
// forma preguiçosa (só na primeira vez que alguém realmente tenta
// ativar notificação), em vez de travar o boot do app inteiro nisso.
//
// Chave VAPID gerada em: Firebase Console → Configurações do Projeto
// → Cloud Messaging → Certificados push da Web. Se um dia precisar
// trocar (ex: revogar acesso antigo), gera outra lá e substitui aqui.
const VAPID_KEY = 'BH-CK0PbsTRPBgP8_qSpJwwZz7MSYT_b6kdR5LUG9TL06tITYisNpaUGyywcC54DKPnVkCQ8Q4pUUhwnXKYi32k';
let messagingInstance = null;

async function getMessagingInstance() {
    if (messagingInstance) return messagingInstance;
    const suportado = await fcmIsSupported().catch(() => false);
    if (!suportado) return null;
    messagingInstance = getMessaging(app);
    return messagingInstance;
}

// Pede permissão, gera o token do aparelho e salva em
// usuarios/{uid}/fcmTokens/{token} — um usuário pode ter vários
// tokens (vários aparelhos/navegadores logados ao mesmo tempo), por
// isso é um mapa, não um campo único.
window._ativarNotificacoes = async function () {
    if (!('Notification' in window)) return { ok: false, motivo: 'Esse navegador não suporta notificações.' };

    const msg = await getMessagingInstance();
    if (!msg) return { ok: false, motivo: 'Esse navegador não suporta notificações push.' };

    const permissao = await Notification.requestPermission();
    if (permissao !== 'granted') return { ok: false, motivo: 'Permissão negada — ative nas configurações do navegador/Android pra esse site.' };

    try {
        // serviceWorkerRegistration explícito: sem isso, o SDK do FCM
        // tenta registrar um Service Worker PRÓPRIO dele, procurando um
        // arquivo chamado exatamente "firebase-messaging-sw.js" na raiz
        // — que não existe aqui, porque a gente já tem o nosso próprio
        // sw.js (com toda a lógica de cache) fazendo esse papel,
        // incluindo o tratamento de notificação em segundo plano que já
        // foi adicionado nele. navigator.serviceWorker.ready aponta pro
        // registro que já está ativo, evitando essa duplicação.
        const registroSW = await navigator.serviceWorker.ready;
        const token = await getToken(msg, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registroSW });
        if (!token) return { ok: false, motivo: 'Não foi possível gerar o token de notificação.' };
        if (!window._firebaseAuthUid) return { ok: false, motivo: 'Sessão inválida — faça login novamente.' };
        await update(ref(db, `usuarios/${window._firebaseAuthUid}/fcmTokens`), { [token]: Date.now() });
        return { ok: true };
    } catch (e) {
        return { ok: false, motivo: e.message };
    }
};

// Notificação chegando com o app ABERTO — o service worker só
// mostra a notificação do sistema quando o app tá fechado/em segundo
// plano; com o app aberto, quem decide o que fazer é aqui. Essa
// chamada só configura o "ouvinte" (não pede permissão nem gera
// token) — por isso pode rodar direto no boot, sem custo.
getMessagingInstance().then(msg => {
    if (!msg) return;
    onMessage(msg, payload => {
        if (!window._lojaId || appInacessivel()) return; // sem sessão ou acesso suspenso: não mostra aviso da loja
        const titulo = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || 'VortexSmart';
        const corpo  = (payload.notification && payload.notification.body)  || (payload.data && payload.data.body)  || '';
        if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: `${titulo}${corpo ? ' — ' + corpo : ''}` });
    });
});

// ── Isolamento por loja ──────────────────────────────────────────
// window._lojaRef(caminho) monta a referência dentro da loja logada,
// ex: window._lojaRef('vendas') → ref(db, 'lojas/{lojaId}/vendas').
// Esse é o ÚNICO ponto de verdade de "onde os dados da loja ficam" —
// se um dia precisar mudar a estrutura de novo, muda só aqui.
// window._lojaId é setado em carregarDadosDoUsuario, depois do login
// (ver mais abaixo neste arquivo). Se ainda não estiver definido
// (chamado cedo demais, antes do login terminar), lança erro em vez de
// silenciosamente gravar num caminho errado — mais seguro do que
// mascarar o problema.
window._lojaRef = function (caminho) {
    if (!window._lojaId) {
        throw new Error('_lojaRef chamado antes de window._lojaId estar definido — login ainda não terminou.');
    }
    const sufixo = caminho ? `/${caminho}` : '';
    return ref(db, `lojas/${window._lojaId}${sufixo}`);
};

// Path da senha do aparelho de um Reparo (Concertos) — fica fora de
// lojas/{lojaId}/..., num node raiz próprio
// (reparosSenhas/{lojaId}/{id}), só por organização — não por
// restrição de acesso. Qualquer usuário da loja lê e escreve
// livremente (decisão do Gestor: assistência técnica, todo mundo ali
// precisa do acesso pra trabalhar — ver firebase-rules-saas.json).
window._reparosSenhaRef = function (repairId) {
    if (!window._lojaId) {
        throw new Error('_reparosSenhaRef chamado antes de window._lojaId estar definido — login ainda não terminou.');
    }
    const sufixo = repairId ? `/${repairId}` : '';
    return ref(db, `reparosSenhas/${window._lojaId}${sufixo}`);
};

// Path do módulo Financeiro — PROPOSITALMENTE fora de lojas/{lojaId}/...,
// num node raiz próprio (financeiro/{lojaId}/...), mesmo raciocínio do
// _reparosSenhaRef acima: a regra de leitura de lojas/{lojaId} já libera
// qualquer membro da loja, e regra filha não restringe regra pai mais
// permissiva no Realtime Database — não dava pra deixar Financeiro
// ilegível pra Funcionário se ele morasse dentro dessa árvore. Por isso
// mora num node raiz separado, com regra própria 100% Gestor (nem
// leitura, nem escrita — ver firebase-rules-saas.json).
window._financeiroRef = function (caminho) {
    if (!window._lojaId) {
        throw new Error('_financeiroRef chamado antes de window._lojaId estar definido — login ainda não terminou.');
    }
    const sufixo = caminho ? `/${caminho}` : '';
    return ref(db, `financeiro/${window._lojaId}${sufixo}`);
};

// Chave da API do CredScan — MESMO motivo do financeiro/reparosSenhas
// acima, só que aqui é ainda mais crítico: é um segredo de verdade
// (custa dinheiro se vazar), não só um dado restrito ao Gestor. Por
// isso mora sozinha na raiz (credscanChaves/{lojaId}/openrouterKey),
// nunca dentro de lojas/{lojaId} — só a Cloud Function
// (Admin SDK, ignora regra) consegue ler.
window._credscanChaveRef = function () {
    if (!window._lojaId) {
        throw new Error('_credscanChaveRef chamado antes de window._lojaId estar definido — login ainda não terminou.');
    }
    return ref(db, `credscanChaves/${window._lojaId}`);
};

// Mesma ideia do _lojaRef, mas pra preferência PESSOAL do usuário
// logado (não compartilhada com o resto da loja) — ex:
// window._usuarioPrefRef('textoRodapeCalculo') →
// usuarios/{uid}/preferencias/textoRodapeCalculo. Só existe o
// sub-node 'preferencias' — o resto de usuarios/{uid} (papel,
// permissoes, lojaId) é travado pra escrita do cliente de propósito
// (só Cloud Function mexe lá), então esse helper nunca aponta fora
// dessa "gaveta" pessoal.
window._usuarioPrefRef = function (caminho) {
    if (!window._firebaseAuthUid) {
        throw new Error('_usuarioPrefRef chamado antes de window._firebaseAuthUid estar definido — login ainda não terminou.');
    }
    const sufixo = caminho ? `/${caminho}` : '';
    return ref(db, `usuarios/${window._firebaseAuthUid}/preferencias${sufixo}`);
};

// Mesma ideia do _lojaRef, só que pro Storage (fotos, logo, assinatura)
// em vez do Realtime Database — window._lojaStorageRef('bookips/xyz.jpg')
// → aponta pra dentro da "pastinha" da loja logada
// (lojas/{lojaId}/bookips/xyz.jpg no bucket), isolada de outras lojas
// pela regra de segurança do Storage (storage.rules).
window._lojaStorageRef = function (caminho) {
    if (!window._lojaId) {
        throw new Error('_lojaStorageRef chamado antes de window._lojaId estar definido — login ainda não terminou.');
    }
    const sufixo = caminho ? `/${caminho}` : '';
    return storageRef(storage, `lojas/${window._lojaId}${sufixo}`);
};

// Chama uma Cloud Function "callable" pelo nome — usado pra criarLoja,
// criarFuncionario, atualizarPermissoesFuncionario (ver functions/index.js).
window._chamarFunction = (nome, dados) => httpsCallable(functions, nome)(dados);

// Permissões que viajam no TOKEN de login — é o que as regras do Storage enxergam ({ lojaId, bloqueada }).
window._tokenClaims = async function (renovar) {
    const user = auth.currentUser;
    if (!user) return null;
    const resultado = await user.getIdTokenResult(!!renovar);
    return resultado.claims || {};
};
// Pede ao servidor pra reescrever a permissão da loja no token DESTE usuário (função
// renovarMinhasPermissoes) e já renova o token, pra valer na hora. Usado quando o Storage nega um envio.
window._renovarPermissoes = async function () {
    await window._chamarFunction('renovarMinhasPermissoes', {});
    if (auth.currentUser) await auth.currentUser.getIdToken(true);
};

// Troca a senha do PRÓPRIO usuário logado — exige a senha ATUAL antes
// (reautenticação), porque o Firebase Auth bloqueia trocar senha numa
// sessão "velha" por segurança. Só funciona pra quem logou com
// email/senha (não cobre login social, que esse app não usa mesmo).
window._alterarMinhaSenha = function (senhaAtual, senhaNova) {
    const user = auth.currentUser;
    if (!user || !user.email) return Promise.reject(new Error('Sessão inválida — faça login novamente.'));
    const credencial = EmailAuthProvider.credential(user.email, senhaAtual);
    return reauthenticateWithCredential(user, credencial).then(() => updatePassword(user, senhaNova));
};

// ── safeStorage ─────────────────────────────────────────────────
const safeStorage = {
    getItem:    k  => { try { return localStorage.getItem(k);    } catch(e) { return null;  } },
    setItem:    (k,v)=>{ try { localStorage.setItem(k,v);        } catch(e) {}               },
    removeItem: k  => { try { localStorage.removeItem(k);        } catch(e) {}               }
};
window.safeStorage = safeStorage;

// ── Tema (Claro/Escuro) e Cor de destaque ─────────────────────────
// CELULAR: as duas escolhas ficam salvas neste aparelho (safeStorage) e valem
// já na primeira pintura (script no <head> do index.html aplica a classe).
// Padrão: escuro + azul. PC / programa instalado: travado em escuro + padrão,
// sem opção de troca (evita bugs de contraste no PDV) — ignora qualquer valor
// salvo por versões antigas.
// Documentos/PDFs e fotos enviadas (Firebase Storage) não leem essas classes —
// usam cor própria (storeCorBarra) — então não são afetados por essa troca.
const EH_CELULAR = document.documentElement.getAttribute('data-shell') === 'mobile';
const TEMA_BG = { escuro: '#141517', claro: '#EEEFF1' };

// Cada cor tem um tom por tema, escolhido pra manter contraste com o texto branco dos botões.
const CORES_DESTAQUE = EH_CELULAR ? {
    azul:    { escuro: '#2979FF', claro: '#2563EB' },
    verde:   { escuro: '#16A34A', claro: '#15803D' },
    rosa:    { escuro: '#DB2777', claro: '#BE185D' },
    laranja: { escuro: '#EA580C', claro: '#C2410C' },
} : {
    roxo:     { hex: '#5b3df5', rgb: '91,61,245',   hex2: '#4f8cff' },
    verde:    { hex: '#16a34a', rgb: '22,163,74',   hex2: '#4ade80' },
    laranja:  { hex: '#f97316', rgb: '249,115,22',  hex2: '#fbbf24' },
    rosa:     { hex: '#db2777', rgb: '219,39,119',  hex2: '#f472b6' },
    vermelho: { hex: '#dc2626', rgb: '220,38,38',   hex2: '#f87171' },
};
const COR_PADRAO = EH_CELULAR ? 'azul' : 'padrao';

function hexParaRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function aplicarCorDestaque(cor) {
    if (!CORES_DESTAQUE[cor]) cor = COR_PADRAO;
    const preset = CORES_DESTAQUE[cor];
    const props = ['--primary', '--primary-rgb', '--acento-hero', '--acento-hero-2', '--acento-hero-rgb'];
    if (EH_CELULAR) {
        const hex = preset[document.body.classList.contains('tema-claro') ? 'claro' : 'escuro'];
        const rgb = hexParaRgb(hex);
        // Identidade sólida: o antigo "roxo do Hero" (--acento-hero) agora é a própria cor de destaque.
        [hex, rgb, hex, hex, rgb].forEach((v, i) => document.body.style.setProperty(props[i], v));
    } else if (preset) {
        [preset.hex, preset.rgb, preset.hex, preset.hex2, preset.rgb].forEach((v, i) => document.body.style.setProperty(props[i], v));
    } else {
        props.forEach(p => document.body.style.removeProperty(p));
    }
    safeStorage.setItem('vsCorDestaque', cor);
}

function aplicarTema(tema) {
    if (tema !== 'claro') tema = 'escuro';
    document.body.classList.toggle('tema-claro', tema === 'claro');
    document.documentElement.classList.toggle('tema-claro', tema === 'claro');
    safeStorage.setItem('vsTema', tema);
    // Barra de status/notificação do PWA segue a cor de fundo de cada tema.
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', EH_CELULAR ? TEMA_BG[tema] : '#07101f');
    // O tom do destaque muda com o tema (contraste) — reaplica a cor escolhida.
    if (EH_CELULAR) aplicarCorDestaque(safeStorage.getItem('vsCorDestaque'));
}

if (EH_CELULAR) {
    aplicarTema(safeStorage.getItem('vsTema'));
    aplicarCorDestaque(safeStorage.getItem('vsCorDestaque'));
} else {
    safeStorage.setItem('vsCorDestaque', 'padrao');
    aplicarTema('escuro');
    aplicarCorDestaque('padrao');
}
window._aplicarTema = aplicarTema;
window._aplicarCorDestaque = aplicarCorDestaque;
window._CORES_DESTAQUE = CORES_DESTAQUE;
window._COR_PADRAO = COR_PADRAO;


// Ao terminar o login o app sempre abre no hub Início ('main').
function abrirTelaInicial() {
    // onAuthStateChanged é assíncrono e pode disparar ANTES do
    // DOMContentLoaded terminar (sessão já persistida, login quase
    // instantâneo) — nesse caso window._vsNavegarParaHub e a guarda de
    // saída (vsBase/vsExitGuard) ainda não foram montados, e navegar
    // agora deixaria o histórico do navegador dessincronizado do que o
    // app espera (voltar físico se comportava errado só nesse caminho).
    // Se o DOM ainda não terminou, adia pro DOMContentLoaded: o listener
    // que monta essas peças foi registrado antes e sempre roda primeiro.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', abrirTelaInicial, { once: true });
        return;
    }
    showMainSection('main');
    precarregarModulosOciosos();
}

// ── Estado global ───────────────────────────────────────────────
let rates = {}, areRatesLoaded = false, products = [], fuse = null;
let currentMainSectionId = 'main';
let currentCalculatorSectionId = 'calculatorHome';
let productsListener = null;

// ── Bandeiras por maquininha ───────────────────────────────────────
// Cada maquininha tem sua PRÓPRIA lista de bandeiras (0, 2, 3, 4... o
// que o Gestor cadastrar em Configurações → Taxas), guardada em
// maquininhasConfig/{id}/bandeiras = [{id, nome}, ...]. Lista vazia =
// maquininha "achatada", sem diferenciar por bandeira (mesma taxa pra
// qualquer cartão — é o que o PagBank sempre fez, agora generalizado
// pra qualquer maquininha).
//
// Máquina antiga (cadastrada antes dessa lista existir) ainda não tem
// esse campo — infere a partir das taxas que já existem em 'rates' e
// CURA SOZINHA (grava uma vez, não fica reinferindo), mesmo padrão já
// usado pro maxParcelas de máquina antiga.
const NOMES_BANDEIRA_CONHECIDOS = {
    visa: 'Visa', mastercard: 'Mastercard', elo: 'Elo',
    hipercard: 'Hipercard', hiper: 'Hiper', amex: 'Amex'
};
const _bandeirasInferidasCache = {};
function inferirBandeirasDaMaquina(maquinaId) {
    const rt = (window._rates || {})[maquinaId];
    if (!rt) return [];
    // debito/credito direto na raiz (sem sub-chave de bandeira) =
    // maquininha achatada, tipo PagBank.
    if (rt.debito !== undefined || rt.credito !== undefined) return [];
    return Object.keys(rt).map(id => ({ id, nome: NOMES_BANDEIRA_CONHECIDOS[id] || (id.charAt(0).toUpperCase() + id.slice(1)) }));
}
function getBandeirasDaMaquina(maquinaId) {
    if (!maquinaId) return [];
    const cfg = (window._maquininhasConfig || {})[maquinaId];
    if (cfg && Array.isArray(cfg.bandeiras)) return cfg.bandeiras;
    if (_bandeirasInferidasCache[maquinaId]) return _bandeirasInferidasCache[maquinaId];
    const inferidas = inferirBandeirasDaMaquina(maquinaId);
    // Só guarda e GRAVA o que foi realmente inferido de uma máquina que EXISTE (tem taxas). Antes,
    // qualquer id — inclusive o "pagbank" de reserva de getMaquininhaPadrao numa loja SEM máquinas,
    // ou uma inferência feita antes das taxas chegarem (lista vazia) — era cacheado pra sempre e
    // gravado no banco, criando uma "máquina fantasma" (Pagbank, sem taxa nem bandeira) que aparecia
    // nas listas e quebrava o cartão.
    if (!inferidas.length || !(window._rates && window._rates[maquinaId])) return inferidas;
    _bandeirasInferidasCache[maquinaId] = inferidas;
    if (window._lojaId) {
        window._dbUpdate(window._lojaRef(`maquininhasConfig/${maquinaId}`), { bandeiras: inferidas }).catch(() => {});
    }
    return inferidas;
}
window._getBandeirasDaMaquina = getBandeirasDaMaquina;

// ── flagData ────────────────────────────────────────────────────
const flagData = {
    visa:       { name: 'Visa',       icon: 'bi-credit-card-2-front' },
    mastercard: { name: 'Mastercard', icon: 'bi-credit-card-2-back'  },
    hiper:      { name: 'Hiper',      icon: 'bi-credit-card'         },
    hipercard:  { name: 'Hipercard',  icon: 'bi-credit-card'         },
    elo:        { name: 'Elo',        icon: 'bi-credit-card'         },
    amex:       { name: 'Amex',       icon: 'bi-credit-card'         }
};
window.flagData = flagData;

// ── Helpers ──────────────────────────────────────────────────────
function parseBrazilianCurrencyToFloat(v) {
    let s = String(v).replace(/R\$?\s?|💰|\$\s?/g, '').trim();
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return parseFloat(s) || 0;
}
function escapeHtml(text) {
    const m = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' };
    return text ? String(text).replace(/[&<>"']/g, c => m[c]) : '';
}
function fmt(v) { return v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }

window._parseBrazilianCurrencyToFloat = parseBrazilianCurrencyToFloat;
window.escapeHtml = escapeHtml;
window._fmt = fmt;

// ── getRate ──────────────────────────────────────────────────────
function getRate(machine, brand, installments) {
    if (!areRatesLoaded || !rates[machine]) return undefined;
    const set = rates[machine];
    // Maquininha achatada (0 bandeiras cadastradas) — debito/credito
    // direto na raiz, sem sub-chave de bandeira nenhuma. Generaliza o
    // que só o PagBank fazia antes (hardcoded); agora qualquer
    // maquininha com 0 bandeiras funciona assim.
    if (set.debito !== undefined || set.credito !== undefined) {
        return installments === 0 ? set.debito : set.credito[installments - 1];
    }
    // 'hiper' historicamente cai na chave 'hipercard' pra maioria das
    // maquininhas (formato herdado do CTW) — só a Infinity tem uma
    // chave 'hiper' de verdade e separada. Preservado tal e qual pras
    // máquinas antigas; bandeiras novas (nome/id livre, cadastradas
    // pelo Gestor) não colidem com essa regra.
    const bandeiraSet = (machine === 'infinity' && brand === 'hiper') ? rates.infinity.hiper : set[brand === 'hiper' ? 'hipercard' : brand];
    return bandeiraSet ? (installments === 0 ? bandeiraSet.debito : bandeiraSet.credito[installments - 1]) : undefined;
}
window._getRate = getRate;

// ── updateFlagDisplay ────────────────────────────────────────────
function updateFlagDisplay(sectionNumber) {
    const brandSelect   = document.getElementById(`brand${sectionNumber}`);
    const displayButton = document.getElementById(`flagDisplayButton${sectionNumber}`);
    if (!brandSelect || !displayButton) return;
    const machine = document.getElementById(`machine${sectionNumber}`)?.value;
    const bandeiras = getBandeirasDaMaquina(machine);
    // Bandeira selecionada não existe (mais) nessa maquininha — troca
    // de máquina, ou a bandeira foi removida em Configurações. Nunca
    // deixa um valor fantasma travado no select.
    if (!bandeiras.find(b => b.id === brandSelect.value)) brandSelect.value = bandeiras[0]?.id || '';
    const encontrada = bandeiras.find(b => b.id === brandSelect.value);
    displayButton.innerHTML = `<i class="bi bi-credit-card-2-front"></i> ${escapeHtml(encontrada?.nome || 'Selecione')}`;
}
window.updateFlagDisplay = updateFlagDisplay;

// ── Flag Selector Modal ──────────────────────────────────────────
let _flagTargetSection = null;
function openFlagSelector(sectionNumber) {
    _flagTargetSection = sectionNumber;
    const overlay  = document.getElementById('flagSelectorModalOverlay');
    const title    = document.getElementById('flagSelectorTitle');
    const btnsDiv  = document.getElementById('flagSelectorButtons');
    if (!overlay) return;
    const machine = document.getElementById(`machine${sectionNumber}`)?.value;
    const bandeiras = getBandeirasDaMaquina(machine);
    title.textContent = 'Selecione a Bandeira';
    btnsDiv.innerHTML = bandeiras.length ? bandeiras.map(b =>
        `<button class="btn btn-outline-secondary w-100" onclick="window._selectFlag('${b.id}')">`+
        `<i class="bi bi-credit-card me-2"></i>${escapeHtml(b.nome)}</button>`
    ).join('') : `<div class="stq-hist-sub text-center py-2">Essa maquininha não tem bandeira cadastrada.</div>`;
    overlay.classList.add('active');
}
window._selectFlag = function(brand) {
    if (!_flagTargetSection) return;
    const sel = document.getElementById(`brand${_flagTargetSection}`);
    if (sel) { sel.value = brand; }
    closeFlagModal();
    updateFlagDisplay(_flagTargetSection);
    // Recalcular após mudança de bandeira
    const recalc = { '2': window.updateRepassarValoresUI, '3': window.updateCalcularPorAparelhoUI, '4': window.updateCalcularEmprestimoUI };
    if (recalc[_flagTargetSection]) recalc[_flagTargetSection]();
};
function closeFlagModal() {
    const overlay = document.getElementById('flagSelectorModalOverlay');
    if (overlay) overlay.classList.remove('active');
}
window.openFlagSelector = openFlagSelector;
window.closeFlagModal   = closeFlagModal;

// ── showCustomModal ──────────────────────────────────────────────
function showCustomModal({ message, onConfirm, onCancel, showPassword = false, confirmText = 'OK', cancelText = 'Cancelar' }) {
    const isInfo = typeof onConfirm !== 'function' && typeof onCancel !== 'function' && !showPassword;
    if (isInfo) {
        const toast = document.getElementById('toastNotification');
        if (!toast) return;
        toast.className = '';
        const low = message.toLowerCase();
        let icon = '<i class="bi bi-info-circle-fill" style="color:var(--primary-color);"></i>';
        if (low.includes('sucesso') || low.includes('copiado') || low.includes('salvo') || low.includes('atualizado')) {
            icon = '<i class="bi bi-check-circle-fill"></i>'; toast.classList.add('success');
        } else if (low.includes('erro') || low.includes('falha') || low.includes('inválido')) {
            icon = '<i class="bi bi-x-circle-fill"></i>'; toast.classList.add('error');
        }
        toast.innerHTML = `${icon} <span>${message}</span>`;
        if (toast.currentTimeout) clearTimeout(toast.currentTimeout);
        requestAnimationFrame(() => toast.classList.add('show'));
        if (navigator.vibrate) navigator.vibrate(20);
        toast.currentTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
        return;
    }
    const overlay   = document.getElementById('customModalOverlay');
    const messageEl = document.getElementById('customModalMessage');
    const passInput = document.getElementById('customModalPasswordInput');
    const okBtn     = overlay.querySelector('.btn-ok');
    const cancelBtn = overlay.querySelector('.btn-cancel');
    const btnsDiv   = document.getElementById('customModalButtons');
    const close     = () => overlay.classList.remove('active');
    messageEl.textContent = message;
    passInput.value = '';
    passInput.style.webkitTextSecurity = 'disc'; // reset pro padrão — quem reaproveita p/ texto comum desliga isso explicitamente depois
    passInput.classList.toggle('hidden', !showPassword);
    btnsDiv.classList.remove('hidden');
    if (typeof onConfirm === 'function') {
        okBtn.textContent = confirmText; okBtn.style.display = 'inline-flex';
        okBtn.onclick = () => { close(); onConfirm(passInput.value); };
    } else { okBtn.style.display = 'none'; }
    if (typeof onCancel === 'function') {
        cancelBtn.textContent = cancelText; cancelBtn.style.display = 'inline-flex';
        cancelBtn.onclick = () => { close(); onCancel(); };
    } else { cancelBtn.style.display = 'none'; }
    overlay.classList.add('active');
    if (showPassword) passInput.focus();
}
window.showCustomModal = showCustomModal;

// ── Botão em estado "carregando" ───────────────────────────────
// Reaproveitável em qualquer botão de ação assíncrona (salvar venda,
// fechar venda, confirmar pagamento...). Guarda o conteúdo original
// no próprio elemento e troca por um spinner + texto, desabilitando
// o botão pra evitar duplo clique. Chamar de novo com loading=false
// devolve o botão ao normal.
function setBtnLoading(btn, loading, loadingText = 'Aguarde...') {
    if (!btn) return;
    if (loading) {
        if (btn.dataset.originalHtml === undefined) btn.dataset.originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.classList.add('btn-loading');
        btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
    } else {
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        if (btn.dataset.originalHtml !== undefined) {
            btn.innerHTML = btn.dataset.originalHtml;
            delete btn.dataset.originalHtml;
        }
    }
}
window._setBtnLoading = setBtnLoading;

// ── Overlay grande de confirmação (não é toast) ─────────────────
// Usado após ações importantes terminarem de salvar (fechar venda,
// salvar venda...). Sobrepõe a tela por ~1.1s com um check animado
// na cor do sistema, depois some sozinho.
function showSuccessOverlay(message, duration = 1100) {
    let ov = document.getElementById('successOverlay');
    if (!ov) {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="success-overlay" id="successOverlay">
                <div class="success-card">
                    <div class="success-icon-circle">
                        <svg class="success-checkmark" viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>
                    </div>
                    <div class="success-text" id="successOverlayText"></div>
                </div>
            </div>`);
        ov = document.getElementById('successOverlay');
    }
    document.getElementById('successOverlayText').textContent = message;
    // reinicia a animação do check mesmo se chamado de novo em seguida
    const checkPath = ov.querySelector('.success-checkmark path');
    ov.classList.remove('show');
    checkPath.style.animation = 'none';
    void ov.offsetWidth; // força reflow
    ov.classList.add('show');
    checkPath.style.animation = '';
    clearTimeout(ov._hideTimer);
    ov._hideTimer = setTimeout(() => ov.classList.remove('show'), duration);
    return new Promise(resolve => setTimeout(resolve, duration));
}
window._showSuccessOverlay = showSuccessOverlay;

// ── Hero "Vendas Hoje" — mostra QUANTIDADE de vendas do dia,
// não valor em R$. Conta fechada + pendente (cancelada não conta). O
// dia da venda é SEMPRE o dia em que foi lançada, não o dia em que foi
// fechada.
// Escopo por papel: Gestor vê a SOMA de todos os vendedores da loja
// (lê o node inteiro); Funcionário vê só a PRÓPRIA contagem — usando a
// MESMA query seletiva que venda/historico.js usa pra Funcionário
// (orderByChild('criadoPorUid').equalTo(seu uid)), porque é a única
// forma que a regra de segurança do servidor libera leitura pra quem
// não é Gestor. Funcionário com a permissão 'vendas_ver_todas' ligada
// (Gestor libera) vê a soma de todos também — mesma exceção usada no
// Histórico.
function atualizarHeroVendasHoje() {
    const valorEl = document.getElementById('pulseHeroValor');
    const labelEl = document.getElementById('pulseHeroLabel');
    // O app tem dois layouts no mesmo HTML (celular e PC); os números do resumo existem nos dois, com ids
    // diferentes — atualiza todos que existirem.
    const achar = (...ids) => ids.map(id => document.getElementById(id)).filter(Boolean);
    const faturadoEls = achar('pulseHeroFaturado', 'vsStatFaturadoValor');
    const faturadoDeltaEls = achar('pulseHeroFaturadoDelta', 'vsStatFaturadoDelta');
    const pendentesEls = achar('pulseHeroPendentes', 'vsStatPendentesValor');
    const poeTexto = (els, txt) => els.forEach(e => { e.textContent = txt; });
    if (!valorEl) return;
    if (!window._lojaId || typeof window._dbGet !== 'function') return;

    const ehGestor = typeof window._papelAtual === 'function' ? window._papelAtual() === 'gestor' : true;
    const veTodas = ehGestor || (typeof window._temPermissao === 'function' && window._temPermissao('vendas_ver_todas'));
    if (labelEl) labelEl.textContent = veTodas ? 'VENDAS HOJE' : 'SUAS VENDAS HOJE';

    const agora = new Date();
    const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 0, 0, 0).getTime();
    const fimHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), 23, 59, 59, 999).getTime();
    const inicioOntem = inicioHoje - 24 * 60 * 60 * 1000;
    const fimOntem = inicioHoje - 1;

    // Quem vê todas as vendas pede SÓ de ontem pra cá (é o que o contador e o comparativo usam) — antes
    // baixava TODAS as vendas da loja a cada vez que a tela inicial abria. Funcionário continua pedindo só
    // as próprias (é a única forma que a regra de segurança libera).
    const refOuQuery = veTodas
        ? window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('criadoEm'), window._dbStartAt(inicioOntem))
        : window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('criadoPorUid'), window._dbEqualTo(window._firebaseAuthUid));

    // Pendentes contam TODAS as vendas pendentes, de qualquer dia (uma venda de 3 dias atrás ainda sem
    // pagamento continua pendente hoje). Quem vê todas precisa de uma consulta própria por status, porque a
    // janela "de ontem pra cá" acima deixaria as mais antigas de fora; o funcionário já recebe todas as suas.
    const pendentesQuery = veTodas
        ? window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('status'), window._dbEqualTo('pendente'))
        : null;

    const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    window._dbGet(refOuQuery).then(snap => {
        const data = snap.val();
        const vendas = data ? Object.values(data) : [];

        const vendasHoje = vendas.filter(v => {
            if (v.status !== 'fechada' && v.status !== 'pendente') return false;
            const ts = v.criadoEm || 0;
            return ts >= inicioHoje && ts <= fimHoje;
        });
        valorEl.textContent = String(vendasHoje.length);

        // Faturado hoje: soma das vendas FECHADAS hoje (pendente ainda não é dinheiro na conta).
        if (faturadoEls.length) {
            const faturadoHoje = vendasHoje
                .filter(v => v.status === 'fechada')
                .reduce((s, v) => s + (v.valorTotal || 0), 0);
            poeTexto(faturadoEls, brl(faturadoHoje));

            // Comparativo com ontem — só aparece se ontem teve faturamento (evita "↑ 400%" saindo de zero).
            if (faturadoDeltaEls.length) {
                const faturadoOntem = vendas
                    .filter(v => v.status === 'fechada' && (v.criadoEm || 0) >= inicioOntem && (v.criadoEm || 0) <= fimOntem)
                    .reduce((s, v) => s + (v.valorTotal || 0), 0);
                if (faturadoOntem > 0) {
                    const variacao = Math.round(((faturadoHoje - faturadoOntem) / faturadoOntem) * 100);
                    poeTexto(faturadoDeltaEls, `${variacao >= 0 ? '↑' : '↓'} ${Math.abs(variacao)}% vs ontem`);
                    faturadoDeltaEls.forEach(e => { e.style.color = variacao >= 0 ? '#4ade80' : '#f87171'; });
                } else {
                    poeTexto(faturadoDeltaEls, '');
                }
            }
        }

        if (pendentesEls.length && !pendentesQuery) {
            poeTexto(pendentesEls, String(vendas.filter(v => v.status === 'pendente').length));
        }
    }).catch(e => {
        console.error('Erro ao carregar Hero Vendas Hoje:', e);
        valorEl.textContent = '0';
        poeTexto(faturadoEls, brl(0));
        poeTexto(faturadoDeltaEls, '');
        if (!pendentesQuery) poeTexto(pendentesEls, '0');
    });

    if (pendentesEls.length && pendentesQuery) {
        window._dbGet(pendentesQuery).then(snap => {
            const data = snap.val();
            poeTexto(pendentesEls, String(data ? Object.values(data).filter(v => v.status === 'pendente').length : 0));
        }).catch(e => {
            console.error('Erro ao contar vendas pendentes:', e);
            poeTexto(pendentesEls, '0');
        });
    }
}
window._atualizarHeroVendasHoje = atualizarHeroVendasHoje;

// ── Vendas em TEMPO REAL (sinal) ────────────────────────────────
// Venda nova, pagamento ou cancelamento feito em OUTRO computador (ou aparelho) não aparecia nas telas
// que já estavam abertas: Histórico e contador da tela inicial só liam o banco ao ABRIR. Agora uma escuta
// barata (só as 20 vendas mais recentes, mesmo com milhares de vendas) avisa as telas quando algo muda
// depois da 1ª leitura; cada tela se registra com window._aoMudarVendas(fn) e decide o que atualizar.
const aoMudarVendasHooks = [];
window._aoMudarVendas = function (fn) { if (typeof fn === 'function' && !aoMudarVendasHooks.includes(fn)) aoMudarVendasHooks.push(fn); };
function loadSinalDeVendas() {
    if (!window._lojaId || typeof window._dbQuery !== 'function') return;
    const ehGestor = typeof window._papelAtual === 'function' ? window._papelAtual() === 'gestor' : true;
    const veTodas = ehGestor || (typeof window._temPermissao === 'function' && window._temPermissao('vendas_ver_todas'));
    // Mesmas consultas que a regra de segurança já libera (gestor/ver-todas: por data; funcionário: só as próprias).
    const consulta = veTodas
        ? query(window._lojaRef('vendas'), orderByChild('criadoEm'), limitToLast(20))
        : query(window._lojaRef('vendas'), orderByChild('criadoPorUid'), equalTo(window._firebaseAuthUid), limitToLast(20));
    let primeiraLeitura = true;
    let temporizador = null;
    onValue(consulta, () => {
        if (primeiraLeitura) { primeiraLeitura = false; return; } // a 1ª só confirma o que as telas já leram
        clearTimeout(temporizador);
        temporizador = setTimeout(() => aoMudarVendasHooks.forEach(fn => { try { fn(); } catch (e) { console.error('[vendas ao vivo]', e); } }), 400);
    }, err => console.error('[vendas ao vivo] escuta recusada:', err && err.code));
}
// Tela inicial: atualiza o contador quando as vendas mudam e ela está na tela.
window._aoMudarVendas(() => {
    const inicio = document.getElementById('mainMenu');
    if (inicio && inicio.style.display !== 'none') atualizarHeroVendasHoje();
});

// ── showMainSection ──────────────────────────────────────────────
function appInacessivel() {
    const login = document.getElementById('loginScreen');
    return (!!login && login.style.display === 'flex') || !!document.getElementById('acessoSuspensoScreen');
}
// ── Carga sob demanda ─────────────────────────────────────────────
// Bibliotecas pesadas (PDF, captura de tela, código de barras) e módulos
// pouco usados (Calculadoras, Documentos, CredScan) não são lidos no boot:
// entram na primeira vez que alguém precisa, ou sozinhos logo depois do
// app abrir, em momentos ociosos (precarregarModulosOciosos). Assim a tela
// inicial aparece mais rápido e quase nunca dá pra perceber a espera.
//   window._vsLib('jspdf', 'html2canvas') → Promise (bibliotecas)
//   carregarModulo('documentos')           → Promise (módulos)
// Módulos que falharam no meio (sem internet, por exemplo) podem ser
// pedidos de novo: só os arquivos que faltam são baixados outra vez.
const _VS_LIBS = {
    html2canvas: { arquivos: ['https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'], pronto: () => typeof window.html2canvas === 'function' },
    jspdf:       { arquivos: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],     pronto: () => !!(window.jspdf && window.jspdf.jsPDF) },
    jsbarcode:   { arquivos: ['lib/jsbarcode.min.js'],                                                    pronto: () => typeof window.JsBarcode === 'function' }
};
const _VS_MODULOS = {
    calculadoras: {
        arquivos: ['calculadoras/router.js', 'calculadoras/export-imagem.js', 'calculadoras/repassar-valores.js', 'calculadoras/emprestimo.js', 'calculadoras/por-aparelho.js', 'calculadoras/fechar-venda.js'],
        // As taxas podem ter chegado antes do módulo existir: refaz agora o que os avisos de "taxas carregadas" teriam feito.
        aposCarregar: () => {
            if (!window._areRatesLoaded) return;
            if (typeof window._fvOnRatesLoaded === 'function') window._fvOnRatesLoaded();
            if (typeof window._calcOnRatesLoaded === 'function') window._calcOnRatesLoaded();
        }
    },
    documentos: { arquivos: ['documentos/router.js', 'documentos/bookip.js', 'documentos/contrato.js', 'documentos/recibo.js', 'documentos/orcamento.js'] },
    credscan:   { arquivos: ['credscan/motor.js', 'credscan/router.js', 'credscan/lista.js', 'credscan/detalhe.js'] }
};
const _vsCargas = {};
const _vsArquivosCarregados = new Set();
function _vsCarregarArquivos(chave, arquivos) {
    if (_vsCargas[chave]) return _vsCargas[chave];
    const promessa = new Promise((resolve, reject) => {
        const faltam = arquivos.filter(src => !_vsArquivosCarregados.has(src));
        if (!faltam.length) { resolve(); return; }
        let restantes = faltam.length;
        const falhas = [];
        const terminou = () => {
            if (--restantes > 0) return;
            if (falhas.length) reject(new Error('Falha ao carregar: ' + falhas.join(', ')));
            else resolve();
        };
        faltam.forEach(src => {
            const s = document.createElement('script');
            s.src = src;
            // Scripts criados por código são assíncronos por padrão; false mantém a ORDEM de execução da lista.
            s.async = false;
            s.onload = () => { _vsArquivosCarregados.add(src); terminou(); };
            s.onerror = () => { falhas.push(src); s.remove(); terminou(); };
            document.head.appendChild(s);
        });
    });
    _vsCargas[chave] = promessa;
    promessa.catch(() => { delete _vsCargas[chave]; });
    return promessa;
}
window._vsLib = function (...nomes) {
    return Promise.all(nomes.map(nome => {
        const lib = _VS_LIBS[nome];
        if (!lib) return Promise.reject(new Error('Biblioteca desconhecida: ' + nome));
        if (lib.pronto()) return Promise.resolve();
        return _vsCarregarArquivos('lib:' + nome, lib.arquivos);
    })).then(() => undefined);
};
function carregarModulo(nome) {
    const modulo = _VS_MODULOS[nome];
    return _vsCarregarArquivos('mod:' + nome, modulo.arquivos).then(() => {
        if (!modulo.iniciado) {
            modulo.iniciado = true;
            if (typeof modulo.aposCarregar === 'function') modulo.aposCarregar();
        }
    });
}
// Os módulos sob demanda registravam suas telas em DOMContentLoaded, que já
// passou quando eles chegam: roda na hora se o documento já está pronto.
window._vsQuandoDomPronto = function (fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
};
// Roda fn depois que o módulo carregou, preservando o "estou voltando pelo
// botão do navegador" (window._vsNavRestoring): essa marca só vale durante
// a chamada síncrona do voltar, e sem restaurá-la o módulo empilharia uma
// entrada nova no histórico em vez de voltar.
function _vsComModulo(nome, fn) {
    const restaurando = window._vsNavRestoring;
    return carregarModulo(nome).then(() => {
        const anterior = window._vsNavRestoring;
        window._vsNavRestoring = restaurando;
        try { return fn(); } finally { window._vsNavRestoring = anterior; }
    });
}
function _vsAvisarFalhaModulo(erro) {
    console.error('[modulo] falha ao carregar sob demanda:', erro);
    if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Não foi possível abrir esta tela agora. Confira a conexão e tente de novo.' });
}
// Até o módulo carregar, a função "de entrada" é um atalho que carrega o
// módulo e chama a função de verdade (que o módulo coloca no lugar do atalho).
// propaga=true: quem chama trata o erro (a função devolve valor/Promise).
function _vsAtalhosDoModulo(nome, funcoes, propaga) {
    funcoes.forEach(nomeFn => {
        const atalho = function (...args) {
            return _vsComModulo(nome, () => {
                const real = window[nomeFn];
                if (typeof real !== 'function' || real === atalho) throw new Error(nomeFn + ' não foi definida pelo módulo ' + nome);
                return real.apply(window, args);
            }).catch(erro => {
                if (propaga) throw erro;
                _vsAvisarFalhaModulo(erro);
            });
        };
        window[nomeFn] = atalho;
    });
}
_vsAtalhosDoModulo('documentos', ['openDocumentosSection', '_reciboAbrirEdicaoComDados', '_reciboCompartilharComDados'], false);
_vsAtalhosDoModulo('documentos', ['_reciboGerarAutomatico'], true);
_vsAtalhosDoModulo('credscan', ['openCredscanSection'], false);

let _vsPrecargaAgendada = false;
function precarregarModulosOciosos() {
    if (_vsPrecargaAgendada) return;
    _vsPrecargaAgendada = true;
    if (navigator.connection && navigator.connection.saveData) return;
    const ordem = ['calculadoras', 'documentos', 'credscan'];
    const quandoOcioso = cb => (window.requestIdleCallback ? window.requestIdleCallback(cb, { timeout: 8000 }) : setTimeout(cb, 3000));
    const proximo = () => {
        const nome = ordem.shift();
        if (!nome) return;
        carregarModulo(nome).catch(() => { /* sem rede agora: carrega na hora que alguém abrir a tela */ }).then(() => quandoOcioso(proximo));
    };
    setTimeout(() => quandoOcioso(proximo), 2500);
}

// ── Transição entre telas (só no celular) ────────────────────────
// Dá a sensação de "empurrar" a tela: entrar numa tela desliza e
// aparece vindo da direita, voltar vem da esquerda, e trocar de aba
// só faz fade. Quem pede é quem navega (showMainSection, _vsPushNav,
// _vsReplaceNav e o voltar do navegador); vários pedidos no mesmo
// quadro viram UMA animação só (vale o mais forte: voltar > entrar >
// fade). Anima só opacidade e transform (compostos pela GPU, não
// refazem o layout). Respeita "reduzir movimento" do sistema.
// Enquanto anima, a classe vs-transicao esconde botões flutuantes
// (position:fixed) que moram dentro da tela: com transform no
// container eles se posicionam em relação a ele e "pulariam".
const _VS_SECOES_PRINCIPAIS = ['mainMenu', 'calculatorContainer', 'documentosContainer', 'estoqueContainer', 'vendaContainer', 'configuracoesContainer', 'reparosContainer', 'reposicaoContainer', 'credscanContainer', 'financeiroContainer'];
const _VS_PESO_TRANSICAO = { fade: 1, frente: 2, tras: 3 };
let _vsTransicaoPendente = null;
let _vsTransicaoAgendada = false;
let _vsTransicaoAtual = null;
function _vsAnimarTransicao(direcao) {
    const el = _VS_SECOES_PRINCIPAIS.map(id => document.getElementById(id))
        .find(e => e && e.style.display !== 'none' && !e.classList.contains('hidden'));
    if (!el || typeof el.animate !== 'function') return;
    if (_vsTransicaoAtual) _vsTransicaoAtual.cancel();
    const desloc = direcao === 'frente' ? 32 : direcao === 'tras' ? -32 : 0;
    const quadros = desloc
        ? [{ opacity: 0, transform: `translate3d(${desloc}px,0,0)` }, { opacity: 1, transform: 'translate3d(0,0,0)' }]
        : [{ opacity: 0 }, { opacity: 1 }];
    el.classList.add('vs-transicao');
    const anim = el.animate(quadros, { duration: desloc ? 240 : 160, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
    _vsTransicaoAtual = anim;
    const fim = () => { if (_vsTransicaoAtual === anim) _vsTransicaoAtual = null; el.classList.remove('vs-transicao'); };
    anim.onfinish = fim;
    anim.oncancel = fim;
}
function pedirTransicao(direcao) {
    if (document.documentElement.getAttribute('data-shell') !== 'mobile') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!_vsTransicaoPendente || _VS_PESO_TRANSICAO[direcao] > _VS_PESO_TRANSICAO[_vsTransicaoPendente]) _vsTransicaoPendente = direcao;
    if (_vsTransicaoAgendada) return;
    _vsTransicaoAgendada = true;
    requestAnimationFrame(() => {
        _vsTransicaoAgendada = false;
        const d = _vsTransicaoPendente;
        _vsTransicaoPendente = null;
        if (d && !appInacessivel()) _vsAnimarTransicao(d);
    });
}
window._vsPedirTransicao = pedirTransicao;

function showMainSection(sectionId) {
    // Rede de segurança contra o flash de transição (usado nas
    // notificações, ver notificacoes-central.js) ficar PRESO cobrindo a
    // tela — ele soma dois setTimeout encadeados pra sumir sozinho, e
    // se o navegador atrasar isso (aba foi pro fundo, troca de app no
    // meio, etc), a classe que ativa o flash nunca é removida e a tela
    // fica coberta por um brilho enorme pra sempre, parecendo "não
    // carregou". Toda navegação de verdade passa por aqui — então é o
    // ponto certo pra garantir que isso nunca sobrevive a uma troca de
    // tela, não importa a causa.
    document.getElementById('notifTeleportFlash')?.classList.remove('ativo');

    // Sem sessão (tela de login à vista) ou com o acesso da loja suspenso
    // (tela de bloqueio), NENHUMA navegação pode reabrir o app: voltar do
    // navegador, clique numa notificação, timer atrasado... tudo passa por
    // aqui. Sem essa trava, uma chamada atrasada desfazia o
    // mostrarTelaLogin / mostrarTelaBloqueio e o app reaparecia por baixo.
    if (appInacessivel()) {
        console.warn(`[sessao] navegação para "${sectionId}" ignorada: sem sessão ou acesso suspenso`, new Error().stack);
        return;
    }

    _VS_SECOES_PRINCIPAIS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.classList.add('hidden'); }
    });
    const map = { 'main': 'mainMenu', 'calculator': 'calculatorContainer', 'documentos': 'documentosContainer', 'estoque': 'estoqueContainer', 'venda': 'vendaContainer', 'configuracoes': 'configuracoesContainer', 'reparos': 'reparosContainer', 'reposicao': 'reposicaoContainer', 'credscan': 'credscanContainer', 'financeiro': 'financeiroContainer' };
    const target = document.getElementById(map[sectionId] || sectionId);
    if (target) {
        target.style.display = '';
        target.classList.remove('hidden');
        currentMainSectionId = sectionId;
    }
    // Navbar: ativa o botão da seção (Início, ou o atalho do módulo aberto — ver navegacao-mobile.js)
    document.querySelectorAll('.ctw-nav-btn').forEach(b => b.classList.remove('ctw-nav-active'));
    document.getElementById('ctwNavHome')?.classList.toggle('ctw-nav-active', sectionId === 'main');
    if (typeof window._vsBarraAtiva === 'function') window._vsBarraAtiva(sectionId);
    if (sectionId === 'main') {
        atualizarHeroVendasHoje();
        atualizarContagemConcertosHub();
    }
    pedirTransicao(window._vsNavRestoring ? 'tras' : 'fade');
}
window.showMainSection = showMainSection;
window.openCalculatorSection = openCalculatorSection;

// ── openCalculatorSection ────────────────────────────────────────
function openCalculatorSection(sectionId, substituir) {
    // Calculadoras carregam sob demanda (ver carregarModulo): se ainda não
    // chegaram, carrega e repete a mesma chamada em seguida.
    if (!_VS_MODULOS.calculadoras.iniciado) {
        _vsComModulo('calculadoras', () => openCalculatorSection(sectionId, substituir)).catch(_vsAvisarFalhaModulo);
        return;
    }
    showMainSection('calculator');
    // Ver window._vsNavegarParaHub (definido mais abaixo, nos listeners
    // globais deste mesmo arquivo) pro raciocínio completo.
    const ehHubDoModulo = sectionId === 'calculatorHome' || !sectionId;
    if (window._vsNavegarParaHub) window._vsNavegarParaHub('openCalculatorSection', [sectionId], ehHubDoModulo, substituir);
    if (!sectionId || !document.getElementById(sectionId)) sectionId = 'calculatorHome';
    // Celular: o hub do módulo não existe — abre direto na aba padrão (ver navegacao-mobile.js).
    if (window._vsAbas) sectionId = window._vsAbas.redirecionar('calculadora', sectionId);
    const subs = ['calculatorHome','fecharVenda','repassarValores','calcularEmprestimo','calcularPorAparelho'];
    subs.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

    // Limpa carrinho ao entrar no Por Aparelho
    if (sectionId === 'calcularPorAparelho' && typeof window._calcResetCarrinho === 'function') window._calcResetCarrinho();

    const el = document.getElementById(sectionId);
    if (el) el.style.display = 'flex';
    if (window._vsAbas) window._vsAbas.atualizar('calculadora', sectionId);
    currentCalculatorSectionId = sectionId;

    // Aplica máquina/bandeira padrão e chama init
    // Prioridade: preferência local antiga (ctwDefaultMachine, se existir)
    // > máquina marcada como padrão em Configurações → Taxas (Firebase).
    const defaultMachine = safeStorage.getItem('ctwDefaultMachine') ||
        (typeof window._getMaquininhaPadrao === 'function' ? window._getMaquininhaPadrao() : null);
    const defaultBrand   = safeStorage.getItem('ctwDefaultBrand');
    const map = {
        'fecharVenda':        { init: () => { if (typeof window._initFecharVenda === 'function') window._initFecharVenda(); } },
        'repassarValores':    { m: 'machine2', b: 'brand2', init: () => { if (typeof window.updateRepassarValoresUI === 'function') window.updateRepassarValoresUI(); } },
        'calcularEmprestimo': { m: 'machine4', b: 'brand4', init: () => { if (typeof window.updateCalcularEmprestimoUI === 'function') window.updateCalcularEmprestimoUI(); } },
        'calcularPorAparelho':{ m: 'machine3', b: 'brand3', init: () => { if (typeof window.updateCalcularPorAparelhoUI === 'function') window.updateCalcularPorAparelhoUI(); } },
    };
    const cfg = map[sectionId];
    if (cfg) {
        if (cfg.m && defaultMachine) { const s = document.getElementById(cfg.m); if (s) s.value = defaultMachine; }
        if (cfg.b && defaultBrand)   { const s = document.getElementById(cfg.b); if (s) s.value = defaultBrand;   }
        if (cfg.m) updateFlagDisplay(cfg.m.replace('machine', ''));

        // Pré-preenche o "Adicional" com o valor padrão configurado em
        // Customizações (preferência pessoal, por perfil) — só na
        // ENTRADA da tela, nunca de novo depois disso na mesma visita
        // (trocar de máquina no meio do cálculo não deve apagar o que
        // o usuário já ajustou manualmente).
        const camposAdicional = { repassarValores: 'repassarExtra', calcularPorAparelho: 'valorExtraAparelho' };
        if (camposAdicional[sectionId]) {
            const valorPadrao = window._configCustomizacoes && window._configCustomizacoes.valorAdicionalPadrao;
            const campo = document.getElementById(camposAdicional[sectionId]);
            if (campo && valorPadrao != null) campo.value = valorPadrao;
        }

        cfg.init();
    }
}
window.openCalculatorSection = openCalculatorSection;

// ── Fuse.js ──────────────────────────────────────────────────────
function setupFuse() {
    if (typeof Fuse === 'undefined' || !products.length) return;
    fuse = new Fuse(products, { keys: ['nome'], threshold: 0.35, minMatchCharLength: 2 });
    window._fuse = fuse;
}

// ── loadRates ────────────────────────────────────────────────────
function loadRates() {
    if (!window._lojaId) return;
    const ratesRef = window._lojaRef('rates');
    onValue(ratesRef, snap => {
        // Node vazio/ausente é um estado LEGÍTIMO (loja sem nenhuma
        // máquina cadastrada — ou acabou de excluir todas de propósito
        // pra testar). Antes disso aqui disparava um "Erro ao carregar
        // taxas do servidor" falso E retornava cedo, o que também
        // pulava a linha que marca _areRatesLoaded = true — quebrando
        // em cascata qualquer tela que checa essa flag antes de
        // calcular taxa (ficava presa achando que "ainda tá carregando"
        // pra sempre).
        rates = snap.val() || {};

        areRatesLoaded = true;
        window._rates          = rates;
        window._areRatesLoaded = true;
        window._getRate        = getRate;

        // Notifica módulos dependentes
        if (typeof window._fvOnRatesLoaded === 'function') window._fvOnRatesLoaded();
        if (typeof window._calcOnRatesLoaded === 'function') window._calcOnRatesLoaded();
    });
}

// ── Config das maquininhas (VortexSmart) ──────────────────────────
// Separado do node 'rates' (taxa por bandeira/parcela) — aqui só
// guardamos metadado próprio do VortexSmart: nome de exibição, máximo
// de parcelas, se está oculta, se é a padrão.
let maquininhasConfig = {};

// ── Info da loja (VortexSmart) ──────────────────────────────────
// Usado pra:
//  - saber se o CredScan tá habilitado (info/credscanHabilitado, ligado
//    pelo Gestor em Configurações → CredScan) — o card do hub só aparece
//    pra quem tiver isso ligado;
//  - o nome com que a loja foi CADASTRADA (info/nome), exposto em
//    window._nomeLojaCadastrada. É a reserva do recibo, orçamento,
//    garantia, contrato e imagem da calculadora quando a loja ainda não
//    preencheu "Nome da Loja" em Configurações → Documentos — assim
//    nunca sai "VORTEXSMART"/"MINHA LOJA" genérico no papel.
let infoLoja = {};
window._nomeLojaCadastrada = '';
function loadInfoLoja() {
    if (!window._lojaId) return;
    onValue(window._lojaRef('info'), snap => {
        infoLoja = snap.val() || {};
        window._infoLoja = infoLoja;
        window._nomeLojaCadastrada = infoLoja.nome || '';
        aplicarVisibilidadePorPapel();
    });
}
window._loadInfoLoja = loadInfoLoja;

function loadMaquininhasConfig() {
    if (!window._lojaId) return;
    onValue(window._lojaRef('maquininhasConfig'), snap => {
        maquininhasConfig = snap.val() || {};
        window._maquininhasConfig = maquininhasConfig;
        if (typeof window._calcOnMaquininhasLoaded === 'function') window._calcOnMaquininhasLoaded();
        if (typeof window._fvOnMaquininhasLoaded === 'function') window._fvOnMaquininhasLoaded();
        if (typeof window._ctxOnMaquininhasLoaded === 'function') window._ctxOnMaquininhasLoaded();
    });
}
window._loadMaquininhasConfig = loadMaquininhasConfig;

// ── Financeiro (VortexSmart) — módulo 100% Gestor ──────────────────
// financeiro/lancamentos/{id} = { tipo:'receita'|'despesa', categoria,
//   categoriaNome, valor, criadoEm, origem:'automatica'|'manual',
//   origemDescricao?, fotoUrl?, criadoPorUid, criadoPorNome,
//   editadoPorNome?, editadoEm? }
// financeiro/recorrentes/{id} = { nome, categoria, categoriaNome,
//   valor, diaDoMes, ativa, criadoEm }
//
// Lançamento AUTOMÁTICO usa chave DETERMINÍSTICA em vez de push() —
// 'venda_{vendaId}' ou 'estoque_{produtoId}_{historicoId}' — de
// propósito: se o gancho disparar 2x por qualquer motivo (rede
// instável, novo clique), a segunda gravação só sobrescreve a mesma
// entrada com o mesmo conteúdo, nunca duplica a receita/despesa.
const CATEGORIAS_DESPESA_BASE = [
    { id: 'produto',      nome: 'Compra de Produto' },
    { id: 'aluguel',      nome: 'Aluguel' },
    { id: 'funcionario',  nome: 'Funcionário' },
    { id: 'contas',       nome: 'Contas (água/luz/internet)' },
    { id: 'manutencao',   nome: 'Manutenção' },
    { id: 'marketing',    nome: 'Marketing' },
    { id: 'outras',       nome: 'Outras' },
];
const CATEGORIAS_RECEITA_BASE = [
    { id: 'venda',   nome: 'Venda' },
    { id: 'avulsa',  nome: 'Avulsa' },
    { id: 'servico', nome: 'Serviço' },
    { id: 'outras',  nome: 'Outras' },
];
window._FINANCEIRO_CATEGORIAS_DESPESA_BASE = CATEGORIAS_DESPESA_BASE;
window._FINANCEIRO_CATEGORIAS_RECEITA_BASE = CATEGORIAS_RECEITA_BASE;

let financeiroLancamentos = {};
function loadFinanceiroLancamentos() {
    if (!window._lojaId || window._papelUsuario !== 'gestor') return;
    onValue(window._financeiroRef('lancamentos'), snap => {
        financeiroLancamentos = snap.val() || {};
        window._financeiroLancamentos = financeiroLancamentos;
        if (typeof window._finOnLancamentosLoaded === 'function') window._finOnLancamentosLoaded();
        if (typeof window._finOnLancamentosLoadedGraficos === 'function') window._finOnLancamentosLoadedGraficos();
    });
}
window._loadFinanceiroLancamentos = loadFinanceiroLancamentos;

let financeiroRecorrentes = {};
function loadFinanceiroRecorrentes() {
    if (!window._lojaId || window._papelUsuario !== 'gestor') return;
    onValue(window._financeiroRef('recorrentes'), snap => {
        financeiroRecorrentes = snap.val() || {};
        window._financeiroRecorrentes = financeiroRecorrentes;
        if (typeof window._finOnRecorrentesLoaded === 'function') window._finOnRecorrentesLoaded();
    });
}
window._loadFinanceiroRecorrentes = loadFinanceiroRecorrentes;

// Registro/remoção de receita de venda no Financeiro NÃO tem mais
// gancho aqui — vivia em financeiroRegistrarReceitaVenda/
// financeiroRemoverReceitaVenda, mas isso implementava o modelo antigo
// (competência: valor inteiro de uma vez, na data da venda). Foi
// substituído pela Cloud Function financeiroSyncVenda
// (functions/index.js), que reage sozinha a QUALQUER escrita numa
// venda e já implementa regime de CAIXA (cada pagamento avulso e cada
// parcela paga vira receita na própria data, não tudo de uma vez) —
// ela roda no servidor (Admin SDK, ignora regra), então funciona não
// importa quem mexeu na venda, o que o client-side nunca conseguia
// garantir sozinho.
//
// Mesmo raciocínio pra despesa de reposição do Estoque — vivia em
// financeiroRegistrarDespesaEstoque/financeiroRemoverDespesaEstoque,
// substituído pela Cloud Function financeiroSyncReposicao
// (functions/index.js). Um gancho client-side aqui exigiria que quem
// fez a reposição também tivesse permissão de escrever em
// financeiro/, que é 100% Gestor de propósito — Funcionário com
// permissão de repor estoque nunca teria essa permissão, e a escrita
// falhava em silêncio (foi exatamente esse o bug relatado e corrigido).

// Remove do Financeiro os lançamentos AUTOMÁTICOS que o filtro aceitar
// (filtro(chave, lancamento) → boolean). É a retirada feita pelo próprio
// app, na hora — não depende da Cloud Function ter reagido a um
// cancelamento/estorno. Só o Gestor consegue (a regra do banco só deixa
// o Gestor escrever em financeiro/); pra qualquer outro papel não faz
// nada e devolve 0 — nesse caso o reconciliador de financeiro/lancamentos.js
// limpa na próxima vez que o Gestor abrir o Financeiro. Nunca toca em
// lançamento manual. Resolve com a quantidade removida.
window._financeiroRemoverAutomaticos = function (filtro) {
    if (!window._lojaId || window._papelUsuario !== 'gestor') return Promise.resolve(0);
    const todos = window._financeiroLancamentos || {};
    const chaves = Object.keys(todos).filter(k => todos[k] && todos[k].origem === 'automatica' && filtro(k, todos[k]));
    if (!chaves.length) return Promise.resolve(0);
    return Promise.all(chaves.map(k => remove(window._financeiroRef(`lancamentos/${k}`)))).then(() => chaves.length);
};

// ── Config do módulo Concertos (VortexSmart) ──────────────────────
// Só guarda o "modo" escolhido pelo Gestor (própria loja resolve o
// reparo, ou terceiriza pra um técnico) — enquanto for null, a aba
// de Concertos fica travada (ver aplicarVisibilidadePorPapel abaixo
// e configuracoes/config-reparos.js).
let reparosConfig = {};
function loadReparosConfig() {
    if (!window._lojaId) return;
    onValue(window._lojaRef('configuracoes/reparos'), snap => {
        reparosConfig = snap.val() || {};
        window._reparosConfig = reparosConfig;
        aplicarVisibilidadePorPapel();
        if (typeof window._reparosOnConfigLoaded === 'function') window._reparosOnConfigLoaded();
    });
}
window._loadReparosConfig = loadReparosConfig;

// ── Comprimir imagem antes de subir pro Storage (compartilhado) ──
// Redimensiona pro maior lado caber em maxDimensao e reexporta como
// JPEG na qualidade dada — usado por qualquer módulo que sobe foto
// (documentos/bookip.js, reparos/*). Ter isso num lugar só evita
// cada módulo reimplementar a mesma lógica de canvas.
window._comprimirImagem = function (file, maxDimensao = 1280, qualidade = 0.82) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width > maxDimensao || height > maxDimensao) {
                if (width > height) { height = Math.round(height * (maxDimensao / width)); width = maxDimensao; }
                else { width = Math.round(width * (maxDimensao / height)); height = maxDimensao; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Falha ao comprimir imagem.')), 'image/jpeg', qualidade);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao carregar imagem pra comprimir.')); };
        img.src = url;
    });
};

// Sobe um blob pro Storage da própria loja e devolve a URL final —
// mesmo padrão já usado no bookip (cache de 1 ano é seguro pq o
// caminho é travado por registro, nunca reaproveitado pra foto diferente).
window._uploadFotoStorage = async function (blob, caminho) {
    const fileRef = window._lojaStorageRef(caminho);
    await window._storageUploadBytes(fileRef, blob, { cacheControl: 'public, max-age=31536000' });
    return await window._storageGetDownloadURL(fileRef);
};

let formasPagamentoConfig = {};
function loadFormasPagamentoConfig() {
    if (!window._lojaId) return;
    onValue(window._lojaRef('formasPagamentoConfig'), snap => {
        formasPagamentoConfig = snap.val() || {};
        window._formasPagamentoConfig = formasPagamentoConfig;
        if (typeof window._ctxOnFormasPagamentoLoaded === 'function') window._ctxOnFormasPagamentoLoaded();
    });
}
window._loadFormasPagamentoConfig = loadFormasPagamentoConfig;

let condicoesProduto = {};
function loadCondicoesProduto() {
    if (!window._lojaId) return;
    onValue(window._lojaRef('condicoesProduto'), snap => {
        condicoesProduto = snap.val() || {};
        window._condicoesProduto = condicoesProduto;
    });
}
window._loadCondicoesProduto = loadCondicoesProduto;

// Categorias do filtro de Estoque → Produtos (Capas, Películas...).
// Sem nada gravado a tela usa o padrão que mora em estoque/produtos.js;
// só o Gestor grava (regra do banco). Aviso o estoque pra redesenhar
// os chips quando outro aparelho mudar a lista.
let categoriasProduto = null;
function loadCategoriasProduto() {
    if (!window._lojaId) return;
    onValue(window._lojaRef('categoriasProduto'), snap => {
        categoriasProduto = snap.val() || null;
        window._categoriasProduto = categoriasProduto;
        if (typeof window._onCategoriasProdutoAtualizadas === 'function') window._onCategoriasProdutoAtualizadas();
    }, () => {}); // sem permissão ou offline: segue com o padrão
}
window._loadCategoriasProduto = loadCategoriasProduto;

// Texto livre definido em Configurações → Customizações, anexado ao
// final do texto copiado no cálculo de aparelho (calculadoras/por-
// aparelho.js). Preferência PESSOAL — cada usuário (Gestor ou
// Funcionário) tem o próprio texto, não é mais compartilhado pra
// loja inteira (antes vinha de lojas/{lojaId}/configCustomizacoes).
let configCustomizacoes = {};
function loadConfigCustomizacoes() {
    if (!window._firebaseAuthUid) return;
    onValue(window._usuarioPrefRef(), snap => {
        configCustomizacoes = snap.val() || {};
        window._configCustomizacoes = configCustomizacoes;
        if (typeof window._vsBarraSincronizar === 'function') window._vsBarraSincronizar();
    });
}
window._loadConfigCustomizacoes = loadConfigCustomizacoes;

// ── Central de notificações — carrega e mantém o contador ──────
// Últimas 30 (não a caixa inteira — mesmo motivo do log de produto:
// pode crescer bastante ao longo de meses/anos). onValue mantém a
// lista e o contador de não-lidas sempre atualizados sozinhos, sem
// precisar recarregar a tela.
let notificacoesRecebidas = [];
function loadNotificacoesRecebidas() {
    if (!window._firebaseAuthUid) return;
    // 50 (não 30) porque agora também mostramos, por baixo, as que
    // foram limpas nas últimas 24h (seção "Limpas") — precisa de
    // margem extra além só das ativas.
    const q = query(ref(db, `usuarios/${window._firebaseAuthUid}/notificacoesRecebidas`), orderByChild('timestamp'), limitToLast(50));
    onValue(q, snap => {
        const data = snap.val() || {};
        notificacoesRecebidas = Object.keys(data)
            .map(id => ({ id, ...data[id] }))
            .sort((a, b) => b.timestamp - a.timestamp);
        window._notificacoesRecebidas = notificacoesRecebidas;
        atualizarBadgeNotificacoes();
        if (typeof window._onNotificacoesAtualizadas === 'function') window._onNotificacoesAtualizadas();
    });
}
window._loadNotificacoesRecebidas = loadNotificacoesRecebidas;

function atualizarBadgeNotificacoes() {
    const dot = document.getElementById('ctwNavNotifDot');
    if (!dot) return;
    // Só conta o que está ativo (não limpo) E não lido — uma limpa,
    // mesmo nunca tendo sido aberta, já some do contador na hora.
    const naoLidas = notificacoesRecebidas.filter(n => !n.lida && !n.limparEm).length;
    if (naoLidas > 0) {
        dot.style.display = 'flex';
        dot.textContent = naoLidas > 9 ? '9+' : String(naoLidas);
    } else {
        dot.style.display = 'none';
        dot.textContent = '';
    }
}

window._marcarNotificacaoLida = function (id) {
    if (!window._firebaseAuthUid || !id) return Promise.resolve();
    return update(ref(db, `usuarios/${window._firebaseAuthUid}/notificacoesRecebidas/${id}`), { lida: true });
};

// "Limpar" é uma ação DIFERENTE de "marcar como lida" — tira da lista
// principal e joga na seção "Limpas" (últimas 24h), sem apagar na
// hora. A limpeza de verdade (apagar do banco) roda sozinha lá na
// Cloud Function limparNotificacoesExpiradas, de 6 em 6 horas.
window._limparNotificacao = function (id) {
    if (!window._firebaseAuthUid || !id) return Promise.resolve();
    return update(ref(db, `usuarios/${window._firebaseAuthUid}/notificacoesRecebidas/${id}`), { limparEm: Date.now() });
};

// Limpa TODAS as ativas de uma vez (lidas ou não, tanto faz) — não
// mexe nas que já estavam limpas antes (não reinicia o prazo de 24h
// delas por engano).
window._limparTodasNotificacoes = function () {
    if (!window._firebaseAuthUid) return Promise.resolve();
    const agora = Date.now();
    const atualizacoes = {};
    notificacoesRecebidas.forEach(n => {
        if (!n.limparEm) atualizacoes[`${n.id}/limparEm`] = agora;
    });
    if (Object.keys(atualizacoes).length === 0) return Promise.resolve();
    return update(ref(db, `usuarios/${window._firebaseAuthUid}/notificacoesRecebidas`), atualizacoes);
};

// ── Papel do usuário (Gestor/Funcionário) ──────────────────────
// Antes (Fase 0) isso era um interruptor local simulado, sem login de
// verdade. Agora lê o papel REAL, definido no momento do login
// (window._papelUsuario, setado em carregarDadosDoUsuario logo após
// autenticar) — vem de /usuarios/{uid}/papel no Firebase, gravado
// pelas Cloud Functions criarLoja/criarFuncionario. Ninguém troca o
// próprio papel mais — só o Gestor consegue mudar permissão de
// funcionário, e só pela Cloud Function correspondente.
function getPapelAtual() {
    return window._papelUsuario || 'funcionario'; // fallback conservador: nunca assume Gestor por padrão
}
window._papelAtual = getPapelAtual;

// Checagem central de permissão granular. Gestor sempre tem acesso a
// tudo (ele nunca tem objeto 'permissoes' gravado — só Funcionário
// tem). Funcionário sem a chave específica ligada = sem acesso àquela
// ação (fallback seguro: nega por padrão, não libera por engano).
function temPermissao(chave) {
    if (getPapelAtual() !== 'funcionario') return true; // Gestor (ou papel desconhecido, fallback conservador acima) tem tudo
    return !!(window._permissoesUsuario && window._permissoesUsuario[chave]);
}
window._temPermissao = temPermissao;

// Aplica a visibilidade nos pontos já mapeados como "só Gestor":
// Relatórios (card no hub de Vendas e atalho na tela Início) e Configurações (item do menu Perfil).
// Cancelar/Apagar/Editar-venda-fechada e Custo do produto são aplicados
// nos próprios arquivos (historico.js, produtos.js), não aqui.
function aplicarVisibilidadePorPapel() {
    ['openRelatoriosVendas2', 'homeRelatoriosTile'].forEach(id => {
        const relCard = document.getElementById(id);
        if (relCard) relCard.style.display = temPermissao('relatorios') ? '' : 'none';
    });
    const cfgBtn = document.getElementById('profileOpenConfig');
    if (cfgBtn) cfgBtn.style.display = temPermissao('configuracoes') ? '' : 'none';
    // Usuários e Permissões é sempre exclusivo do Gestor (ver
    // configuracoes/router.js) — o clique já era bloqueado com um
    // aviso, mas o card continuava visível pro Funcionário até ele
    // tocar nele. Agora nem aparece.
    const usuariosCard = document.getElementById('openConfigUsuarios2');
    if (usuariosCard) usuariosCard.style.display = (window._papelUsuario === 'gestor') ? '' : 'none';
    // Config de Concertos — mesma regra, exclusiva do Gestor.
    const reparosCard = document.getElementById('openConfigReparos2');
    if (reparosCard) reparosCard.style.display = (window._papelUsuario === 'gestor') ? '' : 'none';
    // Movimentação de Produto — mesma regra, exclusiva do Gestor.
    const movimentacaoCard = document.getElementById('openEstoqueMovimentacao2');
    if (movimentacaoCard) movimentacaoCard.style.display = (window._papelUsuario === 'gestor') ? '' : 'none';

    // Financeiro — 100% exclusivo do Gestor, sem exceção (Funcionário
    // não vê nem lançamento avulso). Trava aqui na UI, mas quem
    // protege de verdade são as regras do RTDB (ver notas de deploy
    // no final do financeiro/router.js) — a UI é só conveniência.
    const financeiroCard = document.getElementById('goToFinanceiro');
    if (financeiroCard) financeiroCard.style.display = (window._papelUsuario === 'gestor') ? '' : 'none';
    // CredScan — segurado globalmente por CREDSCAN_LANCADO (topo do
    // arquivo) até o lançamento de verdade; quando ligado, aí sim
    // segue a regra normal (só aparece nas lojas que o Gestor
    // habilitou, colando a chave da API em Configurações → CredScan).
    const credscanCard = document.getElementById('goToCredscan');
    if (credscanCard) credscanCard.style.display = (CREDSCAN_LANCADO && (window._infoLoja || {}).credscanHabilitado) ? '' : 'none';

    // Mesma flag esconde o item na lista de Configurações também —
    // sem isso, mesmo com o card do hub escondido, a linha ainda
    // apareceria lá dentro (Configurações não passa pelo mesmo
    // caminho de visibilidade que os cards do hub).
    const credscanConfigRow = document.getElementById('openConfigCredscan2');
    if (credscanConfigRow) credscanConfigRow.style.display = CREDSCAN_LANCADO ? '' : 'none';

    // Espelha no item correspondente da sidebar — mesmo cálculo,
    // sem duplicar a regra de negócio (só reflete o resultado).
    const sideFinanceiro = document.getElementById('vsSideFinanceiro');
    if (sideFinanceiro) sideFinanceiro.style.display = (window._papelUsuario === 'gestor') ? '' : 'none';

    // Concertos — some do menu enquanto o Gestor não escolher o modo
    // (própria loja / terceirizada) em Configurações. Pro Gestor, o
    // item continua visível mas travado (cadeado), levando direto pra
    // tela de configuração em vez de sumir — ele PRECISA achar essa
    // opção pra poder configurar. Pro Funcionário, some de vez: não
    // adianta mostrar uma área que ele não tem como liberar.
    const itemConcertos = document.getElementById('goToReparos');
    const sideReparos = document.getElementById('vsSideReparos');
    if (itemConcertos) {
        const modo = (window._reparosConfig || {}).modo || null;
        const ehGestor = window._papelUsuario === 'gestor';
        if (!modo && !ehGestor) {
            itemConcertos.style.display = 'none';
            if (sideReparos) sideReparos.style.display = 'none';
        } else {
            itemConcertos.style.display = '';
            if (sideReparos) sideReparos.style.display = '';
            itemConcertos.classList.toggle('locked', !modo);
            const sub = document.getElementById('goToReparosSub');
            const lock = document.getElementById('goToReparosLock');
            if (sub) sub.textContent = modo ? (modo === 'propria' ? 'Fluxo: loja mesma conserta' : 'Fluxo: terceirizado') : 'Configure pra liberar essa área';
            if (lock) lock.style.display = modo ? 'none' : 'inline-flex';
        }
    }
    // Barra inferior e grade da Início dependem de quem está visível acima (celular).
    if (typeof window._vsBarraRender === 'function') window._vsBarraRender();
}
window._aplicarVisibilidadePorPapel = aplicarVisibilidadePorPapel;

// ── Contagem de Concertos ativos/atrasados no Hub — mesma regra de
//    negócio já usada em reparos/lista.js (não duplica cálculo
//    diferente, só espelha o resultado no subtítulo do card do Hub).
function atualizarContagemConcertosHub() {
    const subEl = document.getElementById('goToReparosSub');
    if (!subEl || !window._lojaId || typeof window._dbGet !== 'function') return;
    // Só sobrescreve o texto quando o modo já está configurado — antes
    // disso o subtítulo precisa continuar dizendo "Configure pra
    // liberar essa área" (ver aplicarVisibilidadePorPapel), não "0 ativos".
    const modo = (window._reparosConfig || {}).modo || null;
    if (!modo) return;

    window._dbGet(window._lojaRef('reparos')).then(snap => {
        const data = snap.val();
        const ordens = data ? Object.values(data) : [];
        const ativos = ordens.filter(o => o.status !== 'entregue');
        const atrasados = ativos.filter(o => o.prazoTs && o.prazoTs < Date.now());
        subEl.textContent = atrasados.length > 0
            ? `${ativos.length} ativo${ativos.length !== 1 ? 's' : ''} · ${atrasados.length} atrasado${atrasados.length !== 1 ? 's' : ''}`
            : `${ativos.length} ativo${ativos.length !== 1 ? 's' : ''}`;
    }).catch(() => {});
}
window._atualizarContagemConcertosHub = atualizarContagemConcertosHub;

// Lista de máquinas visíveis (não ocultadas), com a padrão primeiro.
// 'rates' é a fonte da verdade de QUAIS máquinas existem; 'maquininhasConfig'
// só complementa com nome bonito/max de parcelas/oculta/padrão.
// Deriva o máximo de parcelas real a partir do que já está gravado em
// 'rates' — usado quando 'maquininhasConfig' ainda não tem esse campo
// (máquinas cadastradas antes dessa tela existir, como as 4 originais).
function inferirMaxParcelas(id) {
    const rt = (window._rates || {})[id];
    if (!rt) return null;
    if (id === 'pagbank') return rt.credito?.length || null;
    const algumaBandeira = Object.values(rt).find(b => Array.isArray(b?.credito));
    return algumaBandeira?.credito?.length || null;
}
window._inferirMaxParcelas = inferirMaxParcelas;

function getMaquininhasVisiveis() {
    const cfg = window._maquininhasConfig || {};
    const idsComTaxa = window._rates ? Object.keys(window._rates) : [];
    // Config sem taxa E sem nome não é máquina de verdade: é o resíduo "só bandeiras" que versões
    // antigas gravavam sozinhas (máquina fantasma). Máquina cadastrada pela tela de Taxas sempre tem nome.
    const idsSoConfig = Object.keys(cfg).filter(id => !idsComTaxa.includes(id) && cfg[id]?.nome);
    const todas = [...idsComTaxa, ...idsSoConfig].map(id => ({
        v: id,
        l: cfg[id]?.nome || (id.charAt(0).toUpperCase() + id.slice(1)),
        maxParcelas: cfg[id]?.maxParcelas || inferirMaxParcelas(id) || 12,
        oculta: !!cfg[id]?.oculta,
        padrao: !!cfg[id]?.padrao
    }));
    return todas.filter(m => !m.oculta).sort((a, b) => (b.padrao ? 1 : 0) - (a.padrao ? 1 : 0));
}
window._getMaquininhasVisiveis = getMaquininhasVisiveis;

function getMaquininhaPadrao() {
    const visiveis = getMaquininhasVisiveis();
    return (visiveis.find(m => m.padrao) || visiveis[0] || { v: 'pagbank' }).v;
}
window._getMaquininhaPadrao = getMaquininhaPadrao;

// ── loadProducts ─────────────────────────────────────────────────
function loadProducts() {
    if (!window._lojaId) return;
    const productsRef = window._lojaRef('products');
    if (productsListener) off(productsRef, 'value', productsListener);
    productsListener = onValue(productsRef, snap => {
        const data = snap.val();
        products = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })) : [];
        window.products = products;
        setupFuse();

        // Atualiza placeholder de busca
        const placeholder = products.length > 0 ? `Pesquisar entre ${products.length} produtos...` : 'Nenhum produto cadastrado';
        const aparelhoSearch = document.getElementById('aparelhoSearch');
        if (aparelhoSearch) aparelhoSearch.placeholder = placeholder;

        // Estado vazio no Por Aparelho
        const wrapper  = document.getElementById('aparelhoContentWrapper');
        const empty    = document.getElementById('aparelhoEmptyStateWrapper');
        if (wrapper && empty) {
            if (products.length === 0) { wrapper.classList.add('hidden'); empty.classList.remove('hidden'); }
            else                       { wrapper.classList.remove('hidden'); empty.classList.add('hidden'); }
        }

        // Notifica módulos dependentes (ex: Estoque)
        if (typeof window._onProductsUpdated === 'function') window._onProductsUpdated();
    });
}

// ── Auth + Boot ──────────────────────────────────────────────────
function hideLoading() {
    const ov = document.getElementById('loadingOverlay');
    if (ov) ov.classList.add('d-none');
}
function mostrarTelaLogin() {
    hideLoading();
    if (typeof window._pararVigiaAcesso === 'function') window._pararVigiaAcesso();
    const tela = document.getElementById('loginScreen');
    if (tela) tela.style.display = 'flex';
    // Reseta o botão "Entrar" toda vez que a tela de login vai ficar
    // visível — sem isso, ele ficava preso mostrando "Entrando..." pra
    // sempre depois do PRIMEIRO login bem-sucedido (fazerLogin nunca
    // desliga o loading no sucesso, só no erro — não precisava antes
    // porque a tela toda ficava escondida logo em seguida). Agora que o
    // logout esconde tudo direito, esse resíduo ficou visível: reabrir
    // a tela de login (seja no boot sem sessão, seja depois de Sair)
    // sempre mostra o botão fresco, nunca travado num clique antigo.
    const loginBtn = document.getElementById('loginEntrarBtn');
    if (loginBtn) setBtnLoading(loginBtn, false);
    // Sem sessão ativa, ninguém deveria ver navegação nenhuma — só a
    // tela de login e mais nada. Escondida aqui em vez de já nascer
    // escondida no HTML porque a navegação existe fora do fluxo normal de
    // showMainSection (é um elemento fixo, sempre no DOM). O app tem as duas:
    // a barra lateral (#vsSidebar, telas largas) e a barra inferior (#ctwBottomNav,
    // celular) — esconde as duas, senão a que sobrar fica por cima do login.
    ['vsSidebar', 'ctwBottomNav'].forEach(id => {
        const nav = document.getElementById(id);
        if (nav) nav.style.display = 'none';
    });
    // Menu do usuário (balão com "Sair") e gaveta de notificações: se
    // estavam abertos no momento da saída, ficariam flutuando sobre o login.
    ['profileSheetOverlay', 'notifDrawerOverlay'].forEach(id => document.getElementById(id)?.classList.remove('active'));
    // Esconde TUDO que possa estar aberto por baixo — sem isso, a seção
    // que estava visível no momento do "Sair" (Início, Vendas, etc.)
    // continuava lá, só coberta pela tela de login por cima; rolar pra
    // baixo revelava ela ainda ativa e usável. Mesma lista de
    // showMainSection + fecharVenda, que é a única tela que vive FORA
    // dos 6 containers principais (sibling solto no body).
    ['mainMenu', 'calculatorContainer', 'documentosContainer', 'estoqueContainer', 'vendaContainer', 'configuracoesContainer', 'reparosContainer', 'reposicaoContainer', 'financeiroContainer', 'fecharVenda'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.style.display = 'none'; el.classList.add('hidden'); }
    });
}
function esconderTelaLogin() {
    const tela = document.getElementById('loginScreen');
    if (tela) tela.style.display = 'none';
    ['vsSidebar', 'ctwBottomNav'].forEach(id => {
        const nav = document.getElementById(id);
        if (nav) nav.style.display = '';
    });
}
function mostrarErroLogin(msg) {
    const el = document.getElementById('loginErro');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function limparErroLogin() {
    const el = document.getElementById('loginErro');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
}

// Mensagens de erro do Firebase Auth são em inglês e técnicas
// ("auth/invalid-credential" etc) — traduz pros casos mais comuns
// que um usuário de loja realmente vai encontrar no dia a dia.
function traduzErroLogin(codigo) {
    const mapa = {
        'auth/invalid-email': 'Email inválido.',
        'auth/invalid-credential': 'Email ou senha incorretos.',
        'auth/wrong-password': 'Email ou senha incorretos.',
        'auth/user-not-found': 'Email ou senha incorretos.',
        'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco antes de tentar de novo.',
        'auth/network-request-failed': 'Sem conexão com a internet.',
    };
    return mapa[codigo] || 'Não foi possível entrar. Tente novamente.';
}

function fazerLogin() {
    const email = (document.getElementById('loginEmail')?.value || '').trim();
    const senha = document.getElementById('loginSenha')?.value || '';
    limparErroLogin();
    if (!email || !senha) { mostrarErroLogin('Preencha email e senha.'); return; }

    const btn = document.getElementById('loginEntrarBtn');
    setBtnLoading(btn, true, 'Entrando...');
    signInWithEmailAndPassword(auth, email, senha)
        .catch(e => {
            setBtnLoading(btn, false);
            mostrarErroLogin(traduzErroLogin(e.code));
        });
    // Sucesso não precisa de .then aqui — onAuthStateChanged detecta
    // a mudança de sessão sozinho e segue o fluxo de boot a partir daí.
}

// Exposta pro botão "Sair" que vai entrar no menu do Perfil.
function fazerLogout() {
    window._lojaId = null;
    window._nomeLojaCadastrada = '';
    window._papelUsuario = null;
    window._permissoesUsuario = null;
    categoriasProduto = null;
    window._categoriasProduto = null; // outra loja que logar depois não herda as categorias desta
    signOut(auth).catch(() => {});
}
window._fazerLogout = fazerLogout;

// Depois do login, busca /usuarios/{uid} pra saber a QUAL LOJA esse
// usuário pertence e qual o papel dele (gestor/funcionario). Sem esse
// registro (ex: usuário criado direto no Auth sem passar pelas Cloud
// Functions), a pessoa consegue autenticar mas não consegue usar o
// app — não tem loja pra mostrar. Isso é intencional: só existe pelas
// Functions criarLoja/criarFuncionario, que sempre criam os dois
// junto (usuário no Auth + registro em /usuarios).
// Busca os dados do usuário logado em /usuarios/{uid}. Tem um hook de
// teste opcional (window._testeSimularUsuario) — se definido, usa ele
// em vez de ir no Firebase de verdade. Existe só pra permitir uma
// página de teste isolada (teste-usuarios.html) simular sessão de
// Gestor sem precisar das Cloud Functions estarem no ar ainda. Em
// produção (index.html real) esse hook nunca é definido, então o
// comportamento é 100% o mesmo de sempre.
function carregarDadosDoUsuario(uid) {
    if (typeof window._testeSimularUsuario === 'function') {
        return Promise.resolve(window._testeSimularUsuario()).then(dados => {
            window._lojaId = dados.lojaId;
            window._papelUsuario = dados.papel;
            window._permissoesUsuario = dados.permissoes || null;
            window._nomeUsuario = dados.nome || '';
            window._firebaseAuthUid = uid;
            return dados;
        });
    }
    return get(ref(db, `usuarios/${uid}`)).then(snap => {
        const dados = snap.val();
        if (!dados) {
            throw new Error('Esse usuário não está vinculado a nenhuma loja. Fale com o administrador.');
        }
        window._lojaId = dados.lojaId;
        window._papelUsuario = dados.papel;
        window._permissoesUsuario = dados.permissoes || null;
        window._nomeUsuario = dados.nome || '';
        window._firebaseAuthUid = uid;

        // ── DIAGNÓSTICO TEMPORÁRIO (storage/unauthorized em Concertos) ──
        // As regras do Storage checam request.auth.token.lojaId (o que
        // está GRAVADO NO TOKEN), enquanto window._lojaId vem do
        // Realtime Database. Se por algum motivo esses dois valores
        // não baterem — token desatualizado, migração de loja, conta
        // antiga sem o custom claim — o app funciona normal em tudo
        // que usa o banco, mas TODO upload no Storage falha, mesmo com
        // a regra publicada certinha. Isso aqui expõe os dois valores
        // lado a lado pra confirmar ou descartar essa causa de vez.
        if (auth.currentUser) {
            auth.currentUser.getIdTokenResult().then(resultado => {
                const lojaIdNoToken = resultado.claims.lojaId;
                const bate = lojaIdNoToken === window._lojaId;
                console.log(
                    `%c[diag-storage] lojaId no banco: "${window._lojaId}" | lojaId no token: "${lojaIdNoToken}" | ${bate ? '✅ BATEM' : '❌ NÃO BATEM — essa é a causa do storage/unauthorized'}`,
                    `background:${bate ? '#16a34a' : '#dc2626'};color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold;`
                );
            }).catch(e => console.error('[diag-storage] erro ao ler o token:', e));
        }

        return dados;
    });
}

// true depois que a loja foi carregada (login completo). Se a sessão acabar
// com o app nesse estado — "Sair", conta desativada, token revogado — os
// dados da loja e todos os listeners (vendas, estoque, notificações...)
// ainda estariam vivos na memória, e nenhum deles é desligado no logout.
// Recarregar o app é o jeito certo de zerar tudo de uma vez.
let sessaoCarregada = false;

onAuthStateChanged(auth, async user => {
    if (user) {
        // Força buscar um ID token novo do servidor (ignorando o cache
        // local) antes de carregar os dados. As regras do Storage leem
        // request.auth.token.lojaId — um custom claim gravado no
        // TOKEN, não no Realtime Database — então, se esse claim foi
        // setado pelas Cloud Functions depois do token atual já ter
        // sido emitido, o app funciona normal (window._lojaId vem do
        // Database) mas todo upload/download no Storage cai em
        // storage/unauthorized até o token ser renovado. Isso evita
        // esse descompasso.
        user.getIdToken(true).catch(() => {}).then(() => carregarDadosDoUsuario(user.uid))
            // Loja com acesso suspenso (falta de pagamento etc.): mostra a
            // tela de bloqueio e NÃO carrega nada da loja. Quem barra de
            // verdade são as regras do servidor — ver acesso-loja.js.
            .then(dados => (typeof window._verificarAcessoLoja === 'function' ? window._verificarAcessoLoja() : Promise.resolve(false))
                .then(suspensa => ({ dados, suspensa })))
            .then(({ dados, suspensa }) => {
                if (suspensa) { hideLoading(); return; }
                esconderTelaLogin();
                const nameEl = document.getElementById('userName');
                if (nameEl) nameEl.textContent = dados.nome || user.email || 'Usuário';

                // Reaplica a visibilidade Gestor/Funcionário agora que o
                // papel REAL já chegou. A primeira chamada (no
                // DOMContentLoaded, mais abaixo) roda antes do login
                // terminar — nesse momento window._papelUsuario ainda não
                // existe, então getPapelAtual() cai no fallback
                // conservador 'funcionario' e esconde Configurações mesmo
                // pra quem é Gestor de verdade. Essa segunda chamada, já
                // com o papel certo, corrige isso.
                aplicarVisibilidadePorPapel();

                loadRates();
                loadProducts();
                loadMaquininhasConfig();
                loadInfoLoja();
                loadSinalDeVendas();
                loadFormasPagamentoConfig();
                loadReparosConfig();
                loadFinanceiroLancamentos();
                loadFinanceiroRecorrentes();
                loadCondicoesProduto();
                loadCategoriasProduto();
                loadConfigCustomizacoes();
                loadNotificacoesRecebidas();
                sessaoCarregada = true;
                hideLoading();
                abrirTelaInicial();
            })
            .catch(e => {
                // Usuário autenticado mas sem loja vinculada — não dá
                // pra usar o app. Desloga de volta pra tela de login
                // com uma mensagem clara, em vez de deixar preso num
                // app vazio sem explicação.
                hideLoading();
                signOut(auth).then(() => mostrarTelaLogin());
                setTimeout(() => mostrarErroLogin(e.message), 300);
            });
    } else {
        mostrarTelaLogin();
        if (sessaoCarregada) {
            sessaoCarregada = false;
            window.location.reload(); // após o reload não há sessão → cai no else com a flag false (sem loop)
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loginEntrarBtn')?.addEventListener('click', fazerLogin);
    document.getElementById('loginSenha')?.addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });
});

// ── Listeners globais ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // ── Botão "←" central, pra sempre ──────────────────────────────
    // Qualquer botão com a classe .btn-back (existente ou de uma tela
    // nova que ainda nem foi criada) chama history.back() automaticamente,
    // sem precisar escrever isso em cada arquivo. Resolve de vez o "cada
    // tela nova tem que lembrar de fazer certo".
    document.addEventListener('click', e => {
        if (e.target.closest('.btn-back')) history.back();
    });

    // Aplica a visibilidade Gestor/Funcionário assim que a tela carrega
    // (não depende do Firebase, só do que já foi simulado antes)
    aplicarVisibilidadePorPapel();

    // Navegação principal
    // (botões "←" dessas telas não têm listener próprio aqui — o handler
    // central delegado em .btn-back já cuida de todos, sem duplicar)
    document.getElementById('goToCalculator')?.addEventListener('click', () => {
        openCalculatorSection('calculatorHome');
    });
    document.getElementById('goToDocumentos')?.addEventListener('click', () => {
        if (typeof window.openDocumentosSection === 'function') window.openDocumentosSection('documentosHome');
    });
    document.getElementById('goToEstoque')?.addEventListener('click', () => {
        if (typeof window.openEstoqueSection === 'function') window.openEstoqueSection('estoqueHome');
    });
    document.getElementById('goToVenda')?.addEventListener('click', () => {
        if (typeof window.openVendaSection === 'function') window.openVendaSection('vendaHome');
    });
    document.getElementById('goToReparos')?.addEventListener('click', () => {
        const modo = (window._reparosConfig || {}).modo || null;
        if (!modo) {
            if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesReparos');
            return;
        }
        if (typeof window.openReparosSection === 'function') window.openReparosSection('reparosLista');
    });
    document.getElementById('goToReposicao')?.addEventListener('click', () => {
        if (typeof window.openReposicaoSection === 'function') window.openReposicaoSection();
    });
    document.getElementById('goToCredscan')?.addEventListener('click', () => {
        if (typeof window.openCredscanSection === 'function') window.openCredscanSection();
    });
    document.getElementById('closeFlagModalBtn')?.addEventListener('click', closeFlagModal);
    document.getElementById('ctwNavHome')?.addEventListener('click', () => {
        showMainSection('main');
        // Regra: apertou Início, vai pra tela inicial — sem exceção,
        // não importa de onde veio nem quantas telas empilhou no
        // caminho. A versão anterior tentava "voltar N passos" contando
        // quantos _vsPushNav aconteceram desde o último toque em Início
        // (history.go(-N)) — mas navegação vinda de notificação usa
        // _vsReplaceNav (substituir=true), que NÃO soma nesse contador.
        // Resultado: o contador ficava atrasado em relação à pilha real,
        // e history.go(-N) pousava em qualquer tela no meio do caminho
        // (Concertos, Customizações...), nunca garantidamente no Início.
        //
        // Correção: em vez de tentar voltar pela pilha existente, cria
        // um novo "chão" (vsBase + vsExitGuard) EMPILHADO por cima de
        // onde o usuário estava agora — dali em diante, o botão/gesto
        // de voltar só desfaz o que for navegado A PARTIR desse ponto,
        // nunca volta pro que veio antes do toque em Início. Zero
        // dependência de contagem, zero chance de dessincronizar.
        history.pushState({ vsFn: 'showMainSection', vsArgs: ['main'], vsBase: true }, '');
        history.pushState({ vsExitGuard: true }, '');
    });
    document.getElementById('ctwNavNotif')?.addEventListener('click', () => {
        if (typeof window._abrirIlhaNotificacoes === 'function') window._abrirIlhaNotificacoes();
    });

    // ── Perfil FAB Menu (ancorado no botão, não bottom-sheet) ────
    const profileOverlay = document.getElementById('profileSheetOverlay');
    const profileSheet    = document.getElementById('profileSheet');
    const profileBtn      = document.getElementById('ctwNavProfile');

    const openProfileSheet = () => {
        const nameEl  = document.getElementById('profileSheetName');
        const avatarEl = document.getElementById('profileSheetAvatar');
        const papelEl  = document.getElementById('profileSheetPapel');
        const nome = window._nomeUsuario || 'Usuário';
        const ehGestor = getPapelAtual() === 'gestor';

        if (nameEl) nameEl.textContent = nome;
        if (papelEl) papelEl.textContent = ehGestor ? '👑 Gestor' : '👤 Funcionário';
        if (avatarEl) {
            const partes = nome.trim().split(/\s+/);
            const iniciais = ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase();
            avatarEl.textContent = iniciais || '👤';
        }

        if (profileBtn && profileSheet) {
            const rect = profileBtn.getBoundingClientRect();
            if (profileBtn.closest('#vsSidebar')) {
                // Barra lateral (telas largas): o botão de Perfil mora na base da barra à esquerda, e o menu
                // abre ao LADO dele, alinhado pela base do botão.
                profileSheet.style.left   = (rect.right + 10) + 'px';
                profileSheet.style.right  = 'auto';
                profileSheet.style.bottom = (window.innerHeight - rect.bottom) + 'px';
            } else {
                // Celular: o botão de Perfil mora no topo da Início, então o menu abre logo ABAIXO dele.
                profileSheet.style.left   = 'auto';
                profileSheet.style.right  = (window.innerWidth - rect.right) + 'px';
                profileSheet.style.bottom = 'auto';
                profileSheet.style.top    = (rect.bottom + 10) + 'px';
                profileSheet.style.transformOrigin = 'top right';
            }
        }
        profileOverlay?.classList.add('active');
    };
    const closeProfileSheet = () => profileOverlay?.classList.remove('active');

    profileBtn?.addEventListener('click', openProfileSheet);
    profileOverlay?.addEventListener('click', e => { if (e.target === profileOverlay) closeProfileSheet(); });

    document.getElementById('profileOpenConfig')?.addEventListener('click', () => {
        closeProfileSheet();
        if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesHome');
    });
    document.getElementById('profileOpenCustomizacoes')?.addEventListener('click', () => {
        closeProfileSheet();
        if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesCustomizacoes');
    });
    document.getElementById('profileOpenNotificacoes')?.addEventListener('click', () => {
        closeProfileSheet();
        if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesNotificacoes');
    });

    // fechar modal clicando no fundo
    document.getElementById('flagSelectorModalOverlay')?.addEventListener('click', e => {
        if (e.target.id === 'flagSelectorModalOverlay') closeFlagModal();
    });
    document.getElementById('customModalOverlay')?.addEventListener('click', e => {
        if (e.target.id === 'customModalOverlay') e.currentTarget.classList.remove('active');
    });

    // ── Sair (logout) ────────────────────────────────────────────
    document.getElementById('profileOpenSair')?.addEventListener('click', () => {
        closeProfileSheet();
        showCustomModal({
            message: 'Sair da conta?',
            confirmText: 'Sair',
            cancelText: 'Cancelar',
            onConfirm: () => { if (typeof window._fazerLogout === 'function') window._fazerLogout(); },
            onCancel: () => {}
        });
    });

    // ── Campo focado sempre visível acima do teclado ─────────────
    // Em vários formulários (Fechar Venda, Lançar Venda, etc.) o teclado
    // virtual cobria o campo que acabou de ganhar foco, principalmente
    // quando ele ficava logo abaixo de outro campo já digitado. Isso
    // rola o campo até ficar visível assim que o teclado termina de
    // abrir (aguarda a animação do teclado com o timeout).
    //
    // NOTA: a altura dos modais (.stq-modal-card) NÃO é mais ajustada
    // via JS reagindo a visualViewport.resize — essa abordagem foi
    // removida por ser instável (o Android dispara esses eventos de
    // forma inconsistente entre fabricantes, deixando o card "preso"
    // num tamanho errado). A altura do card agora é fixa via CSS
    // (dvh, que o Chrome recalcula corretamente quando o teclado abre,
    // ao contrário de vh) — ver .stq-modal-card em style.mobile.css / style.pc.css.
    const isCampoEditavel = el => el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    const rolarCampoFocadoParaVisivel = () => {
        const ativo = document.activeElement;
        if (isCampoEditavel(ativo)) ativo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    document.addEventListener('focusin', e => {
        if (isCampoEditavel(e.target)) setTimeout(rolarCampoFocadoParaVisivel, 300);
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            setTimeout(rolarCampoFocadoParaVisivel, 50);
        });
    }

    // ── Navegação com histórico real (botão físico/gesto de voltar) ──
    // O app troca de tela só escondendo/mostrando divs — o navegador não
    // sabe que você "andou" entre telas, então o botão voltar do celular
    // não tem pra onde ir.
    //
    // Tentativa anterior: embrulhar window.openXSection por fora. Não
    // funcionou pra cliques DENTRO do próprio arquivo que define a
    // função (ex: o botão "Garantia" dentro de documentos/router.js
    // chama a função local openDocumentosSection(...), não
    // window.openDocumentosSection(...) — são referências diferentes
    // em JS, trocar uma não afeta a outra). Por isso o log mostrava só
    // o primeiro push e nada mais depois.
    //
    // Correção: expõe um helper global (window._vsPushNav) que cada
    // função de navegação chama na PRÓPRIA definição, logo na primeira
    // linha — assim funciona não importa se foi chamada via window.foo()
    // de outro arquivo ou via foo() direto de dentro do mesmo arquivo.
    window._vsNavRestoring = false;


    window._vsPushNav = function (fnName, args) {
        if (!window._vsNavRestoring) {
            history.pushState({ vsFn: fnName, vsArgs: args }, '');
        }
        pedirTransicao(window._vsNavRestoring ? 'tras' : 'frente');
    };

    // Variante de _vsPushNav pra navegações AUTOMÁTICAS que acontecem
    // como consequência de uma ação já concluída (ex: fechar uma venda
    // → vai pro Histórico; salvar um cliente → vai pra lista). Nesses
    // casos a tela de origem (Fechar Venda, formulário do cliente) não
    // faz mais sentido ficar no meio do histórico — se usasse pushState
    // normal, o botão voltar levaria de volta pra ela (ex: "Essa venda
    // já está fechada"), em vez de ir pra tela anterior de verdade
    // (o hub de Vendas). replaceState troca o estado atual em vez de
    // empilhar mais um, então o botão voltar pula direto a etapa
    // intermediária.
    window._vsReplaceNav = function (fnName, args) {
        if (!window._vsNavRestoring) {
            history.replaceState({ vsFn: fnName, vsArgs: args }, '');
        }
        pedirTransicao(window._vsNavRestoring ? 'tras' : 'fade');
    };

    // Helper central pros routers de módulo (Vendas, Estoque, Documentos,
    // Reparos, Configurações, Calculadora): decide se a entrada no HUB do
    // módulo (a tela "inicial" daquele módulo — vendaHome, estoqueHome...)
    // deve empilhar ou trocar o topo da pilha.
    //
    // Precisa trocar o topo quando o usuário já está DENTRO de algum
    // módulo e volta pro hub (ex: acabou de lançar uma venda e toca no
    // ícone "Vendas" de novo pra lançar outra) — sem isso, cada ciclo
    // empilhava mais uma entrada e o voltar físico ficava com "pilhas"
    // de repetições do mesmo hub, precisando de vários toques pra sair.
    //
    // MAS não pode trocar o topo quando o usuário está saindo do Início
    // pela PRIMEIRA vez (topo da pilha ainda é a guarda de saída
    // vsExitGuard, ou até o próprio vsBase se ainda não tiver nem
    // guarda) — nesse caso TEM que empilhar por cima, preservando a
    // guarda embaixo. Foi exatamente essa distinção que faltou numa
    // primeira versão desse helper: trocar o topo bateu em cima da
    // vsExitGuard direto na primeira entrada em qualquer hub, apagando
    // a guarda da pilha — daí voltar de QUALQUER hub caía direto no
    // vsBase, e o popstate tratava isso como "tentando fechar o app"
    // (mostrando "toque voltar de novo pra sair" e saindo de verdade,
    // em vez de simplesmente mostrar a tela Início).
    window._vsNavegarParaHub = function (fnName, args, ehHubDoModulo, substituir) {
        const estadoAtual = history.state;
        const topoEhGuardaOuBase = !estadoAtual || estadoAtual.vsExitGuard || estadoAtual.vsBase;
        const deveTrocarTopo = substituir || (ehHubDoModulo && !topoEhGuardaOuBase);
        if (deveTrocarTopo) {
            window._vsReplaceNav(fnName, args);
        } else {
            window._vsPushNav(fnName, args);
        }
    };

    // Estado-base: garante que sempre tem "pra onde voltar" — a raiz é
    // sempre a tela Início, mesmo se o usuário nunca tiver navegado ainda.
    // vsBase:true é a marca que identifica ESSE estado especificamente —
    // sem essa marca própria, não dava pra distinguir "caiu na base" de
    // "navegou normalmente pra Início" (os dois tinham vsFn:'showMainSection'
    // idêntico, então a detecção por "tá vazio" nunca disparava).
    history.replaceState({ vsFn: 'showMainSection', vsArgs: ['main'], vsBase: true }, '');

    // Guarda de saída — fica permanentemente empilhada logo acima da
    // base, criada uma vez só aqui no boot. Sem ela, o PRIMEIRO voltar
    // físico na tela de Início fecharia o app na hora, sem chance de
    // avisar nada (não sobraria nada pra esse popstate consumir).
    history.pushState({ vsExitGuard: true }, '');
    let ultimoAvisoSair = 0;

    // ── Modal genérico + botão/gesto físico de voltar ────────────────
    // Sem isso, um modal (ex: Editar Produto) fica só como uma div
    // mostrada/escondida por CSS — não empilha nada no histórico, então
    // o voltar físico do Android pula direto pra navegação de SEÇÃO por
    // baixo dele, deixando o modal preso aberto por cima da tela errada.
    //
    // Uso: ao ABRIR o modal, chama window._vsAbrirModal(suaFuncaoFechar)
    // — isso empilha uma entrada de histórico só pro modal. Dentro da
    // sua função de fechar (a mesma que já roda no X/backdrop/Cancelar),
    // chama window._vsFecharModal() como último passo. Funciona pros
    // dois caminhos: fechar pela tela (desempilha a entrada sozinho) ou
    // fechar pelo voltar físico (o navegador já desempilhou, só reusa a
    // MESMA função de fechar pra limpar a tela).
    let modalFecharCallback = null;
    let modalFechandoViaPopstate = false;

    window._vsAbrirModal = function (fecharFn) {
        modalFecharCallback = fecharFn;
        history.pushState({ vsModal: true }, '');
    };

    window._vsFecharModal = function () {
        if (!modalFecharCallback) return; // já fechado — evita disparo duplo
        modalFecharCallback = null;
        if (!modalFechandoViaPopstate && history.state && history.state.vsModal) {
            history.back();
        }
    };

    // Pra quando um modal precisa fechar E IMEDIATAMENTE navegar pra
    // outra tela (ex: notificação abre um modal-like e o botão de ação
    // leva pro Histórico) — usar _vsFecharModal() nesse caso cria uma
    // corrida: o history.back() dele é assíncrono, e se history.replaceState
    // de _vsReplaceNav rodar antes desse back() realmente acontecer, o
    // navegador acaba voltando pra tela ANTERIOR ao modal, cancelando a
    // navegação sem erro nenhum aparecer. Essa versão só limpa o registro
    // do modal (sem mexer no histórico) — a PRÓPRIA navegação que vier
    // em seguida (via _vsPushNav/_vsReplaceNav) já cuida do histórico.
    window._vsLimparModalSemVoltar = function () {
        modalFecharCallback = null;
    };

    // Mesma ideia do modal acima, só que pra operações que NÃO têm uma
    // forma segura de cancelar no meio (salvando no Firebase, gerando
    // PDF). Diferente da guarda de "toque voltar pra sair" (que
    // funciona porque checa vsBase — um marcador FIXO que sempre fica
    // bem embaixo dela), aqui não tem como usar essa técnica: o estado
    // logo abaixo dessa proteção é a tela de conteúdo que o usuário
    // já estava, que muda toda hora e não tem marcador fixo pra
    // reconhecer. Solução: uma bandeira simples — se estiver ligada
    // quando o popstate disparar, empurra de volta o MESMO estado que
    // acabamos de "cair", cancelando a navegação na hora (sem chamar
    // nenhuma função de tela, então nada muda visualmente).
    let operacaoBloqueanteMsg = 'Aguarde a operação terminar...';
    window._vsOperacaoBloqueante = false;
    window._vsIniciarProtecaoNavegacao = function (mensagem) {
        operacaoBloqueanteMsg = mensagem || 'Aguarde a operação terminar...';
        window._vsOperacaoBloqueante = true;
    };
    window._vsFinalizarProtecaoNavegacao = function () {
        window._vsOperacaoBloqueante = false;
    };

    // Trava de rolagem de verdade — CSS (overflow:hidden) sozinho é
    // conhecido por não ser confiável pra isso em navegador de celular
    // (foi o que tentamos antes e não pegou). A forma que realmente
    // funciona: interceptar o próprio gesto de toque que rola a tela
    // e cancelar ele — precisa do {passive:false} explícito, porque
    // por padrão o navegador registra esse tipo de listener como
    // "passivo" (só de olho, sem poder cancelar) por performance —
    // sem isso, o preventDefault() abaixo seria ignorado silenciosamente.
    let travaScrollHandler = null;
    window._vsTravarScroll = function () {
        document.documentElement.classList.add('vs-scroll-locked');
        document.body.classList.add('vs-scroll-locked');
        if (!travaScrollHandler) {
            // Só cancela o toque se ele NÃO estiver dentro de uma área
            // com scroll próprio (ex: corpo de um modal aberto por cima
            // do fundo travado) — senão o modal também ficava congelado.
            travaScrollHandler = e => { if (!e.target.closest('.stq-modal-body')) e.preventDefault(); };
            document.addEventListener('touchmove', travaScrollHandler, { passive: false });
        }
    };
    window._vsDestravarScroll = function () {
        document.documentElement.classList.remove('vs-scroll-locked');
        document.body.classList.remove('vs-scroll-locked');
        if (travaScrollHandler) {
            document.removeEventListener('touchmove', travaScrollHandler, { passive: false });
            travaScrollHandler = null;
        }
    };

    window.addEventListener('popstate', e => {
        if (window._vsOperacaoBloqueante) {
            history.pushState(e.state, ''); // reempurra o estado que acabamos de sair, anulando o "voltar" na prática
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: operacaoBloqueanteMsg });
            return;
        }

        if (modalFecharCallback) {
            modalFechandoViaPopstate = true;
            const fechar = modalFecharCallback;
            fechar();
            modalFechandoViaPopstate = false;
            return; // não deixa cair pra navegação de seção normal também
        }

        const st = e.state;

        // ── "Toque voltar de novo pra sair" ─────────────────────
        // Caiu na base (vsBase:true, marca própria e única desse estado
        // específico) só acontece consumindo a guarda que fica
        // permanentemente logo acima dela — ou seja, é sinal de "acabou
        // de tentar fechar o app". Avisa uma vez e repõe a guarda; se a
        // pessoa apertar voltar de novo dentro de 2s, deixa cair pro
        // comportamento nativo do Android/Chrome de vez (não repõe nada).
        if (st && st.vsBase) {
            const agora = Date.now();
            if (agora - ultimoAvisoSair < 2000) return; // segunda vez rápida — deixa sair de verdade
            ultimoAvisoSair = agora;
            history.pushState({ vsExitGuard: true }, '');
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Toque voltar de novo pra sair' });
            return;
        }

        // Chegou na guarda vindo de uma seção mais funda (voltando
        // "normalmente" até o Início) — trata igual chegar no Início,
        // não é tentativa de sair.
        if (st && st.vsExitGuard) {
            pedirTransicao('tras');
            if (typeof window.showMainSection === 'function') window.showMainSection('main');
            return;
        }

        window._vsNavRestoring = true;
        if (st && st.vsFn && typeof window[st.vsFn] === 'function') {
            window[st.vsFn](...(st.vsArgs || []));
        } else if (typeof window.showMainSection === 'function') {
            window.showMainSection('main');
        }
        window._vsNavRestoring = false;
    });
});

// ── Aviso de conexão (só no celular) ─────────────────────────────
// Faixa discreta no topo quando o aparelho fica sem internet, e um aviso
// curto quando volta. O Firebase guarda as alterações feitas offline só
// enquanto o app continua aberto, por isso o texto pede pra não fechar.
(function () {
    if (document.documentElement.getAttribute('data-shell') !== 'mobile') return;
    let barra = null;
    let timerSumir = null;
    function barraConexao() {
        if (!barra) {
            barra = document.createElement('div');
            barra.id = 'vsConexaoBar';
            barra.setAttribute('role', 'status');
            barra.setAttribute('aria-live', 'polite');
            document.body.appendChild(barra);
        }
        return barra;
    }
    function mostrar(offline) {
        const el = barraConexao();
        clearTimeout(timerSumir);
        el.className = offline ? 'vs-conexao-off' : 'vs-conexao-on';
        el.textContent = offline
            ? 'Sem internet. Não feche o app: as alterações são salvas quando a conexão voltar.'
            : 'Conexão restabelecida.';
        void el.offsetWidth;
        el.classList.add('visivel');
        if (!offline) timerSumir = setTimeout(() => el.classList.remove('visivel'), 2500);
    }
    window.addEventListener('offline', () => mostrar(true));
    window.addEventListener('online', () => mostrar(false));
    if (!navigator.onLine) mostrar(true);
})();
