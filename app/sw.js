// VortexSmart — Service Worker
// Cache "app shell": arquivos locais do app ficam salvos no aparelho,
// pra funcionar offline e reabrir rápido se o Android matar o processo.
//
// Estratégia (revisada — antes era cache-primeiro pra tudo, e isso
// fazia qualquer deploy precisar de aba anônima pra aparecer):
//   - HTML/CSS/JS do app: REDE PRIMEIRO. Sempre busca a versão mais
//     nova; só usa o cache se a rede falhar de verdade (sem internet,
//     ou processo do Android matou o app e reabriu offline). Isso é
//     o que garante que um deploy novo aparece na hora, sem precisar
//     lembrar de bumpar versão nem abrir em anônima.
//   - Ícones/manifest.json: cache primeiro — isso praticamente nunca
//     muda, não vale a pena gastar rede toda vez.
//   - Firebase/CDNs de dado: nunca intercepta, sempre direto pra rede.
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

const CACHE_VERSION = 'vortexsmart-v10';

const APP_SHELL = [
  './',
  './index.html',
  './style.pc.css',
  './style.mobile.css',
  './manifest.json',
  './core.js',
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
  './venda/router.js',
  './venda/lancar.js',
  './venda/historico.js',
  './venda/fechar.js',
  './venda/relatorios.js',
  './configuracoes/router.js',
  './configuracoes/config-documentos.js',
  './configuracoes/config-backup.js',
  './configuracoes/config-produtos.js',
  './configuracoes/config-taxas.js',
  './configuracoes/config-clientes.js',
  './configuracoes/config-usuarios.js',
  './configuracoes/config-customizacoes.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ── Instalação: baixa e guarda o app shell (fallback offline) ──────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
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

// ── Fetch: estratégia por tipo de requisição ────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

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

  const ehEstatico = /\.(png|jpg|jpeg|svg|ico)$/i.test(url.pathname) || url.pathname.endsWith('manifest.json');

  if (ehEstatico) {
    // Ícones/manifest: cache primeiro, atualiza em segundo plano.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // HTML/CSS/JS do app: rede primeiro, e de verdade — cache:'no-store'
  // faz o fetch ignorar qualquer cabeçalho HTTP de cache e sempre bater
  // no servidor. Sem isso, mesmo com a estratégia "rede primeiro", o
  // fetch() ainda podia ser respondido pelo cache do PRÓPRIO navegador
  // por baixo dos panos (não é o cache do Service Worker, é outro nível
  // — por isso um deploy novo podia não aparecer mesmo aqui). Só cai
  // pro cache do SW se a rede falhar de verdade (offline).
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
