// Roteiro de toques: repete, num celular de verdade (emulador), o que dá errado no app: Concertos funciona logo depois de abrir e,
// depois de navegar um pouco (ou voltar do segundo plano), os botões passam a pedir vários toques.
// Cada passo toca (adb input tap = o mesmo caminho do dedo, passando pelo WebView de verdade) e confere na página, via DevTools,
// se o toque fez efeito; se não fez, toca de novo e conta quantos toques foram precisos.
//   MODO=adb (padrão): toca pelo adb no emulador.   MODO=cdp: bancada local no Chromium (só pra validar este script).
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const MODO = process.env.MODO || 'adb';
const PACOTE = process.env.PACOTE || 'app.vortexsmart.beta';
const PORTA = +process.env.PORTA_DEVTOOLS || 9222;
const SAIDA = process.env.SAIDA || 'resultado';
fs.mkdirSync(SAIDA, { recursive: true });

const dorme = ms => new Promise(r => setTimeout(r, ms));
const linhas = [];
const log = t => { const l = new Date().toISOString().slice(11, 23) + '  ' + t; linhas.push(l); console.log(l); };
const adb = (...a) => execFileSync('adb', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ── DevTools (CDP) ────────────────────────────────────────────
let ws, proxId = 1; const pend = new Map();
async function conectar() {
  if (MODO === 'adb') {
    const un = adb('shell', 'cat', '/proc/net/unix');
    const m = un.match(/@(webview_devtools_remote_\d+)/);
    if (!m) throw new Error('o WebView não abriu o DevTools (build de teste?)');
    adb('forward', 'tcp:' + PORTA, 'localabstract:' + m[1]);
  }
  const lista = await (await fetch(`http://127.0.0.1:${PORTA}/json`)).json();
  const alvo = lista.find(x => x.type === 'page' && /(10\.0\.2\.2|localhost|127\.0\.0\.1):8123/.test(x.url));
  if (!alvo) throw new Error('página do sistema não encontrada: ' + JSON.stringify(lista.map(x => x.url)));
  ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((ok, falha) => { ws.onopen = ok; ws.onerror = falha; });
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
}
const cdp = (method, params = {}) => new Promise((ok, falha) => {
  const id = proxId++; pend.set(id, m => m.error ? falha(new Error(method + ': ' + m.error.message)) : ok(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('JS na página: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result.value;
}
async function evSeguro(expr) { try { return await ev(expr); } catch (e) { try { await conectar(); return await ev(expr); } catch (e2) { return 'erro: ' + e2.message; } } }

// ── Toque ────────────────────────────────────────────────────
let offX = 0, offY = 0, dpr = 1;
async function tocarFisico(px, py) {
  if (MODO === 'adb') { const x = String(Math.round(px)), y = String(Math.round(py)); adb('shell', 'input', 'swipe', x, y, x, y, '60'); return; }   // dedo parado por 60 ms (nos relatórios do aparelho: 50 a 75 ms)
  const x = px / dpr, y = py / dpr;
  await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await dorme(40);
  await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function calibrar() {
  dpr = await ev('devicePixelRatio');
  log('página: ' + await ev('location.href') + ' · ' + JSON.stringify(await evSeguro(JS_ESTADO)) + ' · tela ' + await ev('innerWidth+"x"+innerHeight'));
  if (MODO === 'adb') log('janela em foco: ' + adb('shell', 'dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | head -3').trim().replace(/\n/g, ' | '));
  // Uma cobertura transparente segura o toque da calibragem: ele não aciona nada do sistema por baixo.
  await ev(`window.__pd=[];const c=document.createElement('div');c.id='__calib';c.style.cssText='position:fixed;inset:0;z-index:2147483647;background:transparent';
    c.addEventListener('pointerdown',e=>window.__pd.push([e.clientX,e.clientY]),true);document.body.appendChild(c);0`);
  const alvoX = 540, alvoY = 1200;
  let pd = null;
  for (let tentativa = 1; tentativa <= 3 && !pd; tentativa++) {
    await tocarFisico(alvoX, alvoY);
    await dorme(1200);
    pd = await ev('window.__pd[window.__pd.length-1]');
    if (!pd) log(`calibragem: toque ${tentativa} não chegou na página`);
  }
  await ev(`document.getElementById('__calib').remove();0`);
  if (!pd) { await captura('calibragem-falhou'); throw new Error('a calibragem não recebeu o toque'); }
  offX = alvoX - pd[0] * dpr; offY = alvoY - pd[1] * dpr;
  log(`calibragem: dpr=${dpr}, deslocamento da janela x=${offX.toFixed(1)} y=${offY.toFixed(1)} px (barra de status)`);
}
const JS_ESTADO = `(()=>{const ids=['mainMenu','reparosContainer','configuracoesContainer','estoqueContainer','vendaContainer'];
  const t=ids.find(i=>{const e=document.getElementById(i);return e&&e.style.display!=='none'&&!e.classList.contains('hidden')});
  return {tela:t||'?',exp:document.querySelectorAll('.rep-card.expanded').length,folha:!!document.querySelector('#repFolha.active'),
  pilha:history.length,trava:document.body.classList.contains('vs-scroll-locked'),vis:document.visibilityState}})()`;
const estado = () => evSeguro(JS_ESTADO);
async function posicao(sel) {
  return ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
    let r=e.getBoundingClientRect();
    if(r.top<60||r.bottom>innerHeight-90){e.scrollIntoView({block:'center',behavior:'instant'});r=e.getBoundingClientRect();}
    return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
}
let nCap = 0;
// Print da tela (a de verdade, com barras e janelas do sistema). Vai pra pasta de resultados E, em texto (base64), pro log da execução,
// que dá pra ler pela API do GitHub: decodificar as linhas "FOTO:<n>:<rotulo>:<parte>:" juntas gera o PNG.
async function captura(rotulo) {
  if (MODO !== 'adb') return;
  try {
    const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
    const n = String(++nCap).padStart(2, '0'), nome = rotulo.replace(/[^a-z0-9]+/gi, '_');
    fs.writeFileSync(`${SAIDA}/tela-${n}-${nome}.png`, png);
    const b64 = png.toString('base64');
    for (let i = 0; i * 3000 < b64.length; i++) console.log(`FOTO:${n}:${nome}:${i}:${b64.slice(i * 3000, (i + 1) * 3000)}`);
  } catch (e) { log('captura falhou: ' + e.message); }
}

const resultados = [];
async function passo(rotulo, sel, confere, { maxToques = 6, espera = 450 } = {}) {
  const antes = await estado();
  let toques = 0, ok = false, depois = antes;
  while (toques < maxToques && !ok) {
    const c = await posicao(sel);
    if (!c) { log(`${rotulo}: elemento não encontrado (${sel})`); break; }
    await tocarFisico(c.x * dpr + offX, c.y * dpr + offY);
    toques++;
    await dorme(espera);
    depois = await estado();
    ok = confere(antes, depois);
  }
  log(`${rotulo.padEnd(30)} ${ok ? 'OK' : 'FALHOU'} com ${toques} toque(s)   antes=${JSON.stringify(antes)}  depois=${JSON.stringify(depois)}`);
  resultados.push({ rotulo, toques, ok });
  if (toques > 1 || !ok) await captura(rotulo);
}
async function ciclo(nome, id) {
  log(`── ${nome}`);
  await passo('abrir Concertos', '#goToReparos', (a, d) => d.tela === 'reparosContainer');
  await dorme(500);
  await passo(`expandir card ${id}`, `.rep-card[data-id="${id}"] .rep-card-main`, (a, d) => d.exp === 1);
  await passo('Iniciar reparo', `.rep-card[data-id="${id}"] [data-action="avancar"]`, (a, d) => d.folha);
  await passo('Pular sem foto', '#repFolhaPular', (a, d) => !d.folha);
  await passo('recolher card', `.rep-card[data-id="${id}"] .rep-card-main`, (a, d) => d.exp === 0);
  await passo('voltar ao Início (barra)', '#ctwNavHome', (a, d) => d.tela === 'mainMenu');
  await dorme(400);
}
async function rajadaInicio(n) {
  log(`── ${n} toques seguidos em Início (como o usuário fez pra provocar o bug)`);
  const c = await posicao('#ctwNavHome');
  const px = c.x * dpr + offX, py = c.y * dpr + offY;
  if (MODO === 'adb') spawnSync('adb', ['shell', Array.from({ length: n }, () => `input swipe ${Math.round(px)} ${Math.round(py)} ${Math.round(px)} ${Math.round(py)} 60`).join('; ')], { encoding: 'utf8' });
  else for (let i = 0; i < n; i++) { await tocarFisico(px, py); await dorme(150); }
  await dorme(700);
  log('depois da rajada: ' + JSON.stringify(await estado()));
}
// Experimento de controle: o toque de 60 ms vira clique quando a página trava por um tempo? E quando o dedo fica parado mais de 500 ms?
// Cada condição toca N vezes no mesmo card (página parada, ou travada por um laço ocupado iniciado logo antes do toque) e conta os cliques.
async function experimentoMecanismo(n = 8) {
  log(`── EXPERIMENTO: toque de 60 ms com a página parada, travada e com o dedo parado por mais tempo (${n} toques cada)`);
  await passo('abrir Concertos (experimento)', '#goToReparos', (a, d) => d.tela === 'reparosContainer');
  await dorme(1500);
  const sel = '.rep-card[data-id="os5"] .rep-card-main';
  await ev(`window.__cl=0;window.__pdn=0;document.addEventListener('click',()=>window.__cl++,true);document.addEventListener('pointerdown',()=>window.__pdn++,true);0`);
  const condicoes = [
    { nome: 'página parada, dedo 60 ms', trava: 0, dedo: 60 },
    { nome: 'página travada 300 ms, dedo 60 ms', trava: 300, dedo: 60 },
    { nome: 'página travada 700 ms, dedo 60 ms', trava: 700, dedo: 60 },
    { nome: 'página travada 1500 ms, dedo 60 ms', trava: 1500, dedo: 60 },
    { nome: 'página parada, dedo 700 ms', trava: 0, dedo: 700 },
  ];
  for (const c of condicoes) {
    let cliques = 0, downs = 0;
    for (let i = 0; i < n; i++) {
      const p = await posicao(sel);
      const x = String(Math.round(p.x * dpr + offX)), y = String(Math.round(p.y * dpr + offY));
      await ev('window.__cl=0;window.__pdn=0;0');
      if (c.trava) cdp('Runtime.evaluate', { expression: `(()=>{const t=performance.now()+${c.trava};while(performance.now()<t){}})()` }).catch(() => {});
      adb('shell', 'input', 'swipe', x, y, x, y, String(c.dedo));
      await dorme(c.trava + 1200);
      cliques += await ev('window.__cl'); downs += await ev('window.__pdn');
      if ((await estado()).exp) await ev(`document.querySelector(${JSON.stringify(sel)}).click();0`);   // recolhe o card pra próxima tentativa
      await dorme(500);
    }
    log(`EXPERIMENTO  ${c.nome.padEnd(38)} pointerdown ${downs}/${n} · clique ${cliques}/${n}`);
  }
}
async function segundoPlano(segundos) {
  log(`── app em segundo plano por ${segundos} s e volta`);
  if (MODO === 'adb') {
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await dorme(segundos * 1000);
    adb('shell', 'am', 'start', '-n', `${PACOTE}/app.vortexsmart.MainActivity`);
    await dorme(2500);
    await conectar();
  } else await dorme(500);
  log('ao voltar: ' + JSON.stringify(await estado()));
}

(async () => {
  await conectar();
  log('conectado ao DevTools do WebView');
  await dorme(1500);
  await captura('inicio');
  await calibrar();
  await ciclo('1º uso (logo depois de abrir o app)', 'os5');
  await rajadaInicio(10);
  await ciclo('2º uso (depois de 10 toques em Início)', 'os6');
  await segundoPlano(5);
  await ciclo('3º uso (depois de voltar do segundo plano)', 'os7');
  await segundoPlano(25);
  await ciclo('4º uso (depois de 25 s fora)', 'os8');
  if (process.env.EXPERIMENTO !== 'nao') await experimentoMecanismo();

  const ruins = resultados.filter(r => !r.ok || r.toques > 1);
  log(`\nRESUMO: ${resultados.length} passos, ${ruins.length} com problema (precisaram de mais de 1 toque ou falharam)`);
  ruins.forEach(r => log(`  - ${r.rotulo}: ${r.ok ? 'funcionou só no toque ' + r.toques : 'NÃO funcionou em ' + r.toques + ' toques'}`));

  fs.writeFileSync(`${SAIDA}/toques-da-pagina.txt`, String(await evSeguro(`JSON.parse(localStorage.getItem('vs_diag_toques')||'[]').join('\\n')`)));
  if (MODO === 'adb') {
    fs.writeFileSync(`${SAIDA}/diagnostico-android.txt`, String(await evSeguro(`window.VortexAndroid&&VortexAndroid.lerDiagnosticoTela()`)));
    fs.writeFileSync(`${SAIDA}/toques-do-android.txt`, String(await evSeguro(`window.VortexAndroid&&VortexAndroid.lerToquesNativos()`)));
  }
  fs.writeFileSync(`${SAIDA}/roteiro.txt`, linhas.join('\n'));
  fs.writeFileSync(`${SAIDA}/resumo.json`, JSON.stringify({ passos: resultados.length, comProblema: ruins }, null, 1));
  process.exit(0);
})().catch(e => { log('ERRO: ' + (e.stack || e)); fs.writeFileSync(`${SAIDA}/roteiro.txt`, linhas.join('\n')); process.exit(1); });
