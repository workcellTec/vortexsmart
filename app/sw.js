// VortexSmart — Service Worker
// Cache "app shell": arquivos locais do app ficam salvos no aparelho,
// pra funcionar offline e reabrir rápido se o Android matar o processo.
//
// Estratégia:
//   - HTML/CSS/JS do app: REDE PRIMEIRO, mas revalidando (cache:'no-cache'):
//     o servidor responde 304 quando nada mudou (sem baixar o arquivo de novo)
//     e manda o arquivo inteiro quando houve deploy — então a versão nova
//     sempre aparece, sem gastar a banda de baixar tudo a cada abertura.
//     Se a rede falhar OU demorar mais que TIMEOUT_REDE_MS e já existir cópia
//     guardada, usa a cópia (offline / conexão ruim); a atualização automática
//     (atualizacao.js) traz a versão nova assim que a conexão voltar.
//   - Ícones/manifest.json: cache primeiro, atualiza em segundo plano.
//   - Bibliotecas de CDN com versão no endereço (jsdelivr, cdnjs, SDK do
//     Firebase, arquivos de fonte): CACHE PRIMEIRO — o conteúdo daquele
//     endereço nunca muda, então depois da 1ª vez abrem sem rede.
//   - CSS das fontes do Google: guarda e atualiza em segundo plano.
//   - Dados do Firebase (banco, Storage, funções): nunca intercepta.
//
// CACHE_VERSION ainda existe (serve pra limpar caches velhos quando
// muda), mas não é mais ele quem decide se você vê conteúdo
// atualizado — isso agora é automático.

// ── Notificações push (FCM) em segundo plano ────────────────────
// Precisa do SDK "compat" (importScripts, não import/export) porque
// esse service worker é registrado como script clássico, não módulo
// — é o único jeito de carregar uma lib externa aqui dentro.
// onBackgroundMessage só dispara quando o app está FECHADO ou em
// segundo plano; com o app aberto, quem mostra o aviso é o core.js
// (onMessage, no processo principal) — os dois juntos cobrem os dois
// casos.
importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            'AIzaSyC1HuGxN7ko4MdYYJCM5QDQmkpbN5lfxA4',
  authDomain:        'vortex-b3761.firebaseapp.com',
  databaseURL:       'https://vortex-b3761-default-rtdb.firebaseio.com',
  projectId:         'vortex-b3761',
  storageBucket:     'vortex-b3761.firebasestorage.app',
  messagingSenderId: '920463151800',
  appId:             '1:920463151800:web:6011489281000edab365a4d'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const titulo = (payload.notification && payload.notification.title) || (payload.data && payload.data.title) || 'VortexSmart';
  const corpo  = (payload.notification && payload.notification.body)  || (payload.data && payload.data.body)  || '';
  self.registration.showNotification(titulo, {
    body: corpo,
    icon: './icons/icon-192.png',      // ícone colorido — usado na notificação expandida
    badge: './icons/icon-notif.png',   // silhueta branca sem fundo — o Android EXIGE
                                        // esse estilo pro ícone pequeno da barra de
                                        // status, e recorta a cor sozinho de qualquer
                                        // jeito; usar já um ícone pensado pra isso evita
                                        // o resultado feio/genérico de antes.
    data: payload.data || {},
  });
});

// Ao tocar na notificação, abre o app (ou foca a aba já aberta) —
// sem isso, o toque some sem fazer nada visível.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

const CACHE_VERSION = 'vortexsmart-v43';

const APP_SHELL = [
  './',
  './index.html',
  './style.pc.css',
  './style.mobile.css',
  './manifest.json',
  './lib/jsbarcode.min.js',
  './lib/bootstrap-icons.subset.css',
  './lib/bootstrap-icons.subset.woff2',
  './lib/plus-jakarta-sans.woff2',
  './abertura.js',
  './acesso-loja.js',
  './core.js',
  './diagnostico-sistema.js',
  './atualizacao.js',
  './calculadoras/router.js',
  './calculadoras/export-imagem.js',
  './calculadoras/repassar-valores.js',
  './calculadoras/emprestimo.js',
  './calculadoras/por-aparelho.js',
  './calculadoras/fechar-venda.js',
  './documentos/router.js',
  './documentos/bookip.js',
  './documentos/contrato.js',
  './documentos/recibo.js',
  './documentos/orcamento.js',
  './estoque/router.js',
  './estoque/produtos.js',
  './estoque/conferencia.js',
  './estoque/movimentacao.js',
  './venda/router.js',
  './venda/lancar.js',
  './venda/historico.js',
  './impressao/recibo-termico.js',
  './impressao/etiqueta-termica.js',
  './venda/fechar.js',
  './venda/relatorios.js',
  './reparos/pattern-widget.js',
  './reparos/router.js',
  './reparos/lista.js',
  './reparos/form.js',
  './financeiro/router.js',
  './financeiro/painel-dinheiro.js',
  './financeiro/lancamentos.js',
  './financeiro/recorrentes.js',
  './financeiro/graficos.js',
  './reparos/documento.js',
  './reparos/finalizar-entrega.js',
  './reposicao/router.js',
  './reposicao/lista.js',
  './credscan/motor.js',
  './credscan/router.js',
  './credscan/lista.js',
  './credscan/detalhe.js',
  './configuracoes/router.js',
  './configuracoes/config-documentos.js',
  './configuracoes/config-backup.js',
  './configuracoes/config-produtos.js',
  './configuracoes/config-taxas.js',
  './configuracoes/config-clientes.js',
  './configuracoes/config-usuarios.js',
  './configuracoes/config-customizacoes.js',
  './configuracoes/config-notificacoes.js',
  './configuracoes/config-reparos.js',
  './configuracoes/config-credscan.js',
  './notificacoes-central.js',
  './navegacao-mobile.js',
  './leitor-camera.js',
  './inicio-mobile.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

// Bibliotecas externas que o app usa (todas com versão fixa no endereço);
// html2canvas e jsPDF só carregam quando alguém usa, mas já ficam guardadas aqui pra funcionar offline.
// Baixadas já na instalação, uma a uma e sem travar: se alguma falhar, o
// restante continua e a falha é tratada na 1ª vez que ela for pedida.
const CDN_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://www.gstatic.com/firebasejs/11.9.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.9.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.9.1/firebase-database.js',
  'https://www.gstatic.com/firebasejs/11.9.1/firebase-functions.js',
  'https://www.gstatic.com/firebasejs/11.9.1/firebase-storage.js',
  'https://www.gstatic.com/firebasejs/11.9.1/firebase-messaging.js'
];

// Depois disso, usa a cópia guardada em vez de esperar a rede (conexão ruim).
const TIMEOUT_REDE_MS = 6000;

// CORS de propósito: a resposta fica legível (não "opaca"), então o navegador
// não reserva ~7 MB de cota por arquivo e dá pra conferir o status.
function buscarCdn(url) {
  return fetch(url, { mode: 'cors', credentials: 'omit' });
}

// Baixa cada arquivo do app direto do servidor (cache:'reload'): addAll()
// aceitaria cópias do cache HTTP do navegador, de até 10 min atrás. Se um
// único arquivo falhar, a instalação inteira falha (todo ou nada).
function baixarShell(cache) {
  return Promise.all(APP_SHELL.map((caminho) =>
    fetch(caminho, { cache: 'reload' }).then((resp) => {
      if (!resp.ok) throw new Error('Falha ao guardar ' + caminho + ' (' + resp.status + ')');
      return cache.put(caminho, resp);
    })
  ));
}

// ── Instalação: baixa e guarda o app shell (fallback offline) ──────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      baixarShell(cache).then(() =>
        Promise.allSettled(CDN_PRECACHE.map((url) =>
          buscarCdn(url).then((resp) => { if (resp.ok) return cache.put(url, resp); })
        ))
      )
    )
  );
  self.skipWaiting();
});

// ── Ativação: apaga caches de versões antigas ───────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function guardar(request, response) {
  const copia = response.clone();
  caches.open(CACHE_VERSION).then((cache) => cache.put(request, copia));
}

// Endereços com versão fixa: o conteúdo nunca muda, vale cache primeiro.
function ehCdnVersionado(url) {
  return url.hostname === 'cdn.jsdelivr.net'
    || url.hostname === 'cdnjs.cloudflare.com'
    || url.hostname === 'fonts.gstatic.com'
    || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
}

function cachePrimeiroCdn(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return buscarCdn(request.url)
      .then((resp) => { if (resp.ok) guardar(request, resp); return resp; })
      .catch(() => fetch(request));
  });
}

// Guarda o que já tem e atualiza em segundo plano (CSS das fontes).
function guardarEAtualizar(request) {
  return caches.match(request).then((cached) => {
    const rede = fetch(request)
      .then((resp) => { if (resp && resp.ok) guardar(request, resp); return resp; })
      .catch(() => cached);
    return cached || rede;
  });
}

// Rede primeiro revalidando; cai pra cópia se falhar ou demorar demais.
function redePrimeiro(request) {
  const rede = fetch(request, { cache: 'no-cache' }).then((resp) => {
    if (resp && resp.status === 200) guardar(request, resp);
    return resp;
  });
  return caches.match(request).then((cached) => {
    if (!cached) return rede;
    return Promise.race([
      rede.catch(() => cached),
      new Promise((resolve) => setTimeout(() => resolve(cached), TIMEOUT_REDE_MS))
    ]);
  });
}

// ── Fetch: estratégia por tipo de requisição ────────────────────────────
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // CSS das fontes do Google: tem que vir ANTES da regra abaixo (o domínio
  // googleapis.com também é do banco/Storage do Firebase, que não se guarda).
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(guardarEAtualizar(request));
    return;
  }

  // Nunca cachear chamadas ao Firebase (dados precisam vir sempre frescos)
  // — googleapis.com já cobre o Firebase Storage também (mesmo domínio).
  // cloudfunctions.net é onde vivem as Cloud Functions (onCall) — domínio
  // TOTALMENTE diferente dos outros três, não tava coberto antes, o que
  // quebrava chamadas de função (a resposta do fetch chegava mangled pelo
  // SW, virando "Failed to convert value to Response").
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudfunctions.net')
  ) {
    return; // deixa passar direto pra rede, sem interceptar
  }

  if (ehCdnVersionado(url)) {
    event.respondWith(cachePrimeiroCdn(request));
    return;
  }

  // Qualquer outro domínio (imagens de terceiros etc.): não intercepta.
  if (url.origin !== self.location.origin) return;

  const ehEstatico = /\.(png|jpg|jpeg|svg|ico)$/i.test(url.pathname) || url.pathname.endsWith('manifest.json');

  if (ehEstatico) {
    // Ícones/manifest: cache primeiro, atualiza em segundo plano.
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.status === 200) guardar(request, response);
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // HTML/CSS/JS do app: rede primeiro, revalidando (ver redePrimeiro).
  event.respondWith(redePrimeiro(request));
});
