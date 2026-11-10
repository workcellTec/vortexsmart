// Servidor de teste: serve a pasta app/ (o sistema de verdade) com o Firebase trocado pelo simulado e dados de exemplo.
// O emulador acessa por http://10.0.2.2:8123/ (o endereço do computador, visto de dentro do emulador).
const http = require('http'), fs = require('fs'), path = require('path');
const MODS = require('./firebase-simulado.js');
const RAIZ = path.join(__dirname, '..', 'app');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/__fb/')) {
    const corpo = MODS[url.slice(6)];
    res.writeHead(corpo ? 200 : 404, { 'content-type': TIPOS['.js'] });
    return res.end(corpo || '');
  }
  if (url === '/__teste.js') {
    res.writeHead(200, { 'content-type': TIPOS['.js'] });
    return res.end(String(fs.readFileSync(path.join(__dirname, 'dados-teste.js'))).replace('__OS_QTD__', String(+process.env.OS_QTD || 60)));
  }
  let arq = path.join(RAIZ, url);
  if (!arq.startsWith(RAIZ)) { res.writeHead(403); return res.end(); }
  if (url.endsWith('/')) arq = path.join(arq, 'index.html');
  fs.readFile(arq, (erro, dados) => {
    if (erro) { res.writeHead(404); return res.end(); }
    let corpo = dados;
    const ext = path.extname(arq);
    if (path.basename(arq) === 'index.html') corpo = Buffer.from(String(dados).replace('<head>', '<head><script src="/__teste.js"></script>'));
    else if (ext === '.js') corpo = Buffer.from(String(dados).replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\//g, '/__fb/'));
    res.writeHead(200, { 'content-type': TIPOS[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(corpo);
  });
}).listen(8123, '0.0.0.0', () => console.log('servidor de teste em :8123'));
