// Trava do fundo (PC). O fundo do app é UM só (--bg + brilho do body::before); cabeçalho e corpo de uma tela não podem
// pintar cor própria por cima dele — era isso que deixava "retalhos" (faixa de cabeçalho, placa do conteúdo, tiras cinzas).
// Abre cada tela do PC no app de verdade (Firebase simulado) e falha se algum bloco estrutural, quase da largura da tela,
// tiver fundo. Cards de verdade (nome com "card", hero, aviso, busca...) e controles (input/botão) são permitidos;
// `.content-card` de largura total NÃO é: ele só pode ter fundo quando é um card avulso, mais estreito que a tela.
// Uso (na raiz do projeto):  npm i --no-save playwright && node teste-fundo/auditar-fundo.js
const http = require('http'), fs = require('fs'), path = require('path');
const MODS = require('../teste-emulador/firebase-simulado.js');
const RAIZ = path.join(__dirname, '..', 'app');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

// [módulo, função que abre a tela, tela]
const TELAS = [
  ['estoque', 'openEstoqueSection', 'estoqueProdutos'], ['estoque', 'openEstoqueSection', 'estoqueConferencia'], ['estoque', 'openEstoqueSection', 'estoqueMovimentacao'],
  ['venda', 'openVendaSection', 'lancarVenda'], ['venda', 'openVendaSection', 'historicoVendas'], ['venda', 'openVendaSection', 'vendaRelatorios'],
  ['reparos', 'openReparosSection', 'reparosLista'], ['reparos', 'openReparosSection', 'reparosForm'],
  ['documentos', 'openDocumentosSection', 'documentosRecibo'], ['documentos', 'openDocumentosSection', 'documentosContrato'],
  ['financeiro', 'openFinanceiroSection', 'financeiroLancamentos'], ['financeiro', 'openFinanceiroSection', 'financeiroRecorrentes'], ['financeiro', 'openFinanceiroSection', 'financeiroGraficos'],
  ['reposicao', 'openReposicaoSection', null], ['credscan', 'openCredscanSection', 'credscanLista'],
  ...['configuracoesHome', 'configuracoesProdutos', 'configuracoesClientes', 'configuracoesUsuarios', 'configuracoesDocumentos', 'configuracoesCustomizacoes',
      'configuracoesNotificacoes', 'configuracoesBackup', 'configuracoesReparos'].map(t => ['configuracoes', 'openConfiguracoesSection', t]),
];

function servir() {
  return new Promise(ok => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url.startsWith('/__fb/')) { const c = MODS[url.slice(6)]; res.writeHead(c ? 200 : 404, { 'content-type': TIPOS['.js'] }); return res.end(c || ''); }
      if (url === '/__teste.js') { res.writeHead(200, { 'content-type': TIPOS['.js'] }); return res.end(fs.readFileSync(path.join(__dirname, 'dados-fundo.js'))); }
      let arq = path.join(RAIZ, url);
      if (!arq.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
      if (url.endsWith('/')) arq = path.join(arq, 'index.html');
      fs.readFile(arq, (erro, dados) => {
        if (erro) { res.writeHead(404); return res.end(); }
        let corpo = dados; const ext = path.extname(arq);
        if (path.basename(arq) === 'index.html') corpo = Buffer.from(String(dados).replace('<head>', '<head><script src="/__teste.js"></script>'));
        else if (ext === '.js') corpo = Buffer.from(String(dados).replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\//g, '/__fb/'));
        res.writeHead(200, { 'content-type': TIPOS[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(corpo);
      });
    }).listen(0, '127.0.0.1', () => ok(srv));
  });
}

// Roda dentro da página: devolve os blocos estruturais que pintam fundo próprio na tela aberta.
function blocosComFundo(telaId) {
  const tela = document.getElementById(telaId) || document.querySelector('#reposicaoContainer');
  if (!tela) return ['(tela não encontrada)'];
  const L = tela.getBoundingClientRect().width, achados = [];
  const rotulo = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '');
  const controle = e => e.matches('input,textarea,select,button,label');
  const cardDeVerdade = e => /card|hero|notice|search|seg|savebar|backdrop|modal|chip|pill|badge/i.test(typeof e.className === 'string' ? e.className.replace(/content-card/g, '') + ' ' + e.id : '');
  tela.querySelectorAll('*').forEach(e => {
    const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || controle(e) || e.closest('.stq-modal-backdrop,[id$="ModalBackdrop"]')) return;
    const r = e.getBoundingClientRect(); if (r.width < L * 0.9 || r.height < 20) return;
    const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/), a = m ? (m[1].split(',')[3] === undefined ? 1 : parseFloat(m[1].split(',')[3])) : 0;
    if (a <= 0.02 && cs.backgroundImage === 'none') return;
    if (cardDeVerdade(e)) return;
    achados.push(`${rotulo(e)} ${Math.round(r.width)}x${Math.round(r.height)} fundo=${a > 0.02 ? cs.backgroundColor : cs.backgroundImage.slice(0, 40)}`);
  });
  return achados;
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.error('Falta o Playwright: npm i --no-save playwright'); process.exit(2); }
  const srv = await servir(), porta = srv.address().port;
  const nav = await chromium.launch(), pag = await (await nav.newContext({ viewport: { width: 1366, height: 800 } })).newPage();
  await pag.goto(`http://127.0.0.1:${porta}/?shell=pc`, { waitUntil: 'load' });
  await pag.waitForFunction(() => typeof window.openConfiguracoesSection === 'function', null, { timeout: 30000 }); await pag.waitForTimeout(2500);
  let falhas = 0;
  for (const [modulo, abrir, tela] of TELAS) {
    await pag.evaluate(m => window.showMainSection(m), modulo); await pag.waitForTimeout(200);
    await pag.evaluate(([f, t]) => window[f](t), [abrir, tela]); await pag.waitForTimeout(800);
    const achados = await pag.evaluate(blocosComFundo, tela || 'reposicaoContainer');
    if (achados.length) { falhas += achados.length; console.log(`✗ ${tela || modulo}`); achados.forEach(a => console.log('    ' + a)); }
    else console.log(`✓ ${tela || modulo}`);
  }
  await nav.close(); srv.close();
  if (falhas) { console.log(`\nFALHOU — ${falhas} bloco(s) com fundo próprio (retalho). Cabeçalho/corpo da tela devem usar o fundo do app.`); process.exit(1); }
  console.log(`\nOK — ${TELAS.length} telas do PC sem retalho de fundo.`);
})();
