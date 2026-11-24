// ================================================================
// main.js — VortexSmart PDV Desktop
// Processo principal Electron: abre o VortexSmart real (pasta ../app)
// dentro de uma janela desktop, e expõe (via preload.js) a ponte de
// impressão térmica ESC/POS que impressao/recibo-termico.js chama.
// ================================================================
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const iconv = require('iconv-lite');
const { execFile } = require('child_process');
const { montarReciboVenda } = require('./impressao/escpos-builder.js');
const { montarEtiquetaTeste, montarEtiquetaProduto } = require('./impressao/tspl-builder.js');

let mainWindow;
let atualizador = null;   // só existe no programa instalado (ver atualizador.js)

// Pasta do VortexSmart (o site). Em desenvolvimento (npm start) é ../app. No programa
// instalado, o electron-builder copia ela pra resources/web — NÃO pode se chamar "app":
// o Electron trata resources/app como o próprio programa e não abriria.
// Para ver o menu e o console (suporte): abrir com o argumento --debug.
const DEBUG = process.argv.includes('--debug');
const PASTA_WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'app');

// Mesmos valores de --bg (style.pc.css) e da altura da faixa do topo (html[data-janela], style.pc.css).
const COR_FUNDO = '#07101f';
const ALTURA_BARRA = 36;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        icon: path.join(PASTA_WEB, 'icons', 'icon-512.png'),
        // Windows: sem a barra de título nativa (ela pegava a cor de destaque do Windows, vermelha em alguns PCs).
        // Os botões minimizar/maximizar/fechar continuam, desenhados sobre a faixa do app, na cor de fundo dele.
        // A faixa (arrastar a janela) e o espaço dela estão em style.pc.css (html[data-janela]).
        ...(process.platform === 'win32' ? {
            backgroundColor: COR_FUNDO,
            titleBarStyle: 'hidden',
            titleBarOverlay: { color: COR_FUNDO, symbolColor: '#cbd5e1', height: ALTURA_BARRA }
        } : {}),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.maximize();
    mainWindow.loadFile(path.join(PASTA_WEB, 'index.html'));
    if (DEBUG) mainWindow.webContents.openDevTools();
}

// Uma janela só: abrir o programa de novo (clique duplo no atalho) traz a que já está
// aberta pra frente, em vez de abrir um 2º PDV — dois abertos ao mesmo tempo
// duplicariam impressões e confundiriam o caixa.
// Atualização automática: o instalador abre o programa novo com "--updated" quando o antigo ainda pode estar
// terminando de fechar. Nesse caso espera a vaga (até 30 s) em vez de desistir — sem isso o programa sumia
// depois de "Reiniciar agora". Cada início fica registrado em atualizador.log (userData).
function registrarInicio(msg) {
    try {
        const pasta = app.getPath('userData');
        fs.mkdirSync(pasta, { recursive: true });
        fs.appendFileSync(path.join(pasta, 'atualizador.log'), `${new Date().toISOString()} [inicio] ${msg}\n`);
    } catch (e) { /* log nunca pode dar erro */ }
}
async function obterVaga() {
    if (app.requestSingleInstanceLock()) return true;
    if (!process.argv.includes('--updated')) return false;
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (app.requestSingleInstanceLock()) return true;
    }
    return false;
}

function iniciarPrograma() {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });
    app.whenReady().then(() => {
        // Programa instalado: sem a barra "File / Edit / View / Window / Help" do Electron
        // (dava acesso a recarregar a página e ao console).
        if (app.isPackaged && !DEBUG) Menu.setApplicationMenu(null);
        createWindow();
        // Atualização automática (ver atualizador.js). Só no programa instalado, e carregada aqui
        // dentro de um try: se por qualquer motivo ela não subir, o PDV abre e imprime do mesmo jeito.
        if (app.isPackaged) {
            try {
                atualizador = require('./atualizador.js').iniciarAtualizador({ app, dialog, autoUpdater: require('electron-updater').autoUpdater, obterJanela: () => mainWindow });
            } catch (e) {
                console.error('Atualização automática não iniciou:', e);
            }
        }
    });
}

obterVaga().then(temVaga => {
    registrarInicio(`versão ${app.getVersion()}, argumentos [${process.argv.slice(1).join(' ')}], ${temVaga ? 'abrindo' : 'já há outro programa aberto: saindo'}`);
    if (temVaga) iniciarPrograma(); else app.quit();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// O Electron só entrega ao app a MENSAGEM de um Error: um objeto simples ({erro, dica...})
// chega como "[object Object]" e o motivo real se perde (foi assim que o "não imprime"
// ficou sem explicação). Por isso todo erro de impressão sai como Error, com o texto
// completo e legível — o app tira o prefixo "Error invoking remote method...".
// As mensagens do cmd.exe vêm na página de código OEM do Windows (850 no Brasil), não em UTF-8.
function textoDoWindows(saida) {
    if (!saida || !saida.length) return '';
    const bytes = Buffer.isBuffer(saida) ? saida : Buffer.from(String(saida), 'utf8');
    return iconv.decode(bytes, 'cp850').replace(/\s+/g, ' ').trim();
}

const DICA_COMPARTILHAMENTO = 'Confira: a impressora precisa estar COMPARTILHADA no Windows (botão direito na impressora > Propriedades da impressora > aba Compartilhamento), com o NOME DO COMPARTILHAMENTO IGUAL ao nome da impressora.';

// ── Versão do programa instalado (aparece no Diagnóstico do app: serve pra saber
//    qual versão cada cliente está usando) ──
ipcMain.handle('versao-programa', () => app.getVersion());

// ── Atualização do programa pedida pela tela (Configurações → Atualização do app) ──
ipcMain.handle('verificar-atualizacao', () => (atualizador ? atualizador.conferir() : { estado: 'indisponivel' }));
ipcMain.handle('instalar-atualizacao', () => !!(atualizador && atualizador.instalar()));

// ── Lista as impressoras instaladas no Windows (usa PowerShell,
//    já vem em qualquer Windows 10/11 do cliente, sem instalar nada) ──
ipcMain.handle('listar-impressoras', async () => {
    return new Promise((resolve, reject) => {
        const ps = 'Get-Printer | Select-Object -ExpandProperty Name';
        execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(`Não foi possível listar as impressoras do Windows: ${err.message}${stderr ? ' | ' + String(stderr).trim() : ''}`));
                return;
            }
            const nomes = stdout
                .split(/\r?\n/)
                .map(s => s.trim())
                .filter(Boolean);
            resolve(nomes);
        });
    });
});

// ── Envia um buffer de bytes crus (RAW) para a impressora via
//    compartilhamento local do Windows — único ponto que faz isso,
//    reaproveitado tanto pelo recibo real quanto pelo teste de exemplo ──
function enviarBufferParaImpressora(buffer, nomeImpressora) {
    const tmpFile = path.join(os.tmpdir(), `vsmart-recibo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.prn`);
    fs.writeFileSync(tmpFile, buffer);

    return new Promise((resolve, reject) => {
        // Copia o arquivo binário DIRETO para o compartilhamento de rede
        // local da impressora (\\localhost\NomeDaFila) usando o comando
        // nativo COPY /B do Windows — este método preserva os bytes
        // crus (RAW), diferente do Out-Printer do PowerShell, que
        // processa o conteúdo como texto e corrompe comandos ESC/POS.
        const compartilhamento = `\\\\localhost\\${nomeImpressora}`;
        execFile('cmd.exe', ['/c', 'copy', '/b', tmpFile, compartilhamento], { encoding: 'buffer', windowsHide: true }, (err, stdout, stderr) => {
            fs.unlink(tmpFile, () => {});
            if (err) {
                // O que o Windows respondeu (ex: "O nome de rede não foi encontrado") é o que
                // explica a falha; err.message só é usado se o cmd não disse nada.
                const resposta = [textoDoWindows(stderr), textoDoWindows(stdout)].filter(Boolean).join(' ');
                reject(new Error(`Não foi possível enviar para "${compartilhamento}". ${resposta ? 'O Windows respondeu: ' + resposta : (err.message || String(err))} ${DICA_COMPARTILHAMENTO}`));
                return;
            }
            resolve({ ok: true, metodo: 'copy-compartilhamento', stdout: textoDoWindows(stdout) });
        });
    });
}

// ── Recebe dados REAIS de venda + loja vindos do VortexSmart (via IPC)
//    e imprime o recibo — usado pela integração final em venda/fechar.js ──
ipcMain.handle('imprimir-recibo-venda', async (event, nomeImpressora, venda, loja) => {
    const buffer = montarReciboVenda(venda, loja);
    return enviarBufferParaImpressora(buffer, nomeImpressora);
});

// ── Botão de teste com dados de EXEMPLO (mantido só para validar
//    o layout do recibo isoladamente, sem depender do app completo) ──
ipcMain.handle('teste-impressao', async (event, nomeImpressora) => {
    const vendaExemplo = {
        id: 'venda-teste-0001',
        clienteNome: 'Cliente de Teste',
        fechadaEm: Date.now(),
        itens: [
            { produtoNome: 'Tela iPhone 11 Original', valorUnitario: 350.00, quantidade: 1, obs: 'IMEI 358240051234567' },
            { produtoNome: 'Pelicula 3D', valorUnitario: 25.00, quantidade: 2, obs: '' },
        ],
        valorTotal: 400.00,
        pagamentos: [
            { formaLabel: 'PagBank · Crédito 3x', valor: 400.00 }
        ]
    };
    const lojaExemplo = {
        storeName: 'LOJA DE TESTE',
        storeCNPJ: '00.000.000/0000-00',
        storeEndereco: 'Rua Exemplo, 123 - Centro, Sua Cidade/UF',
        storeTelefone: '(00) 00000-0000'
    };

    const buffer = montarReciboVenda(vendaExemplo, lojaExemplo);
    return enviarBufferParaImpressora(buffer, nomeImpressora);
});

// ── Teste isolado de ETIQUETA (TSPL) — impressora Knup KP-IM600.
//    Separado do teste de recibo acima: protocolo diferente (TSPL,
//    não ESC/POS), impressora diferente. larguraMm/alturaMm/gapMm
//    ajustáveis na chamada porque o tamanho real do rolo de etiqueta
//    ainda está em validação física (self-test confirmou 203dpi e
//    modo GAP, mas não o tamanho exato da etiqueta em uso). ──
ipcMain.handle('teste-impressao-etiqueta', async (event, nomeImpressora, opcoes) => {
    const buffer = montarEtiquetaTeste(opcoes || {});
    return enviarBufferParaImpressora(buffer, nomeImpressora);
});

// ── Impressão REAL de etiqueta de produto (nome + código de barras) —
//    usada pela integração final em estoque/produtos.js, via
//    impressao/etiqueta-termica.js. Separado do teste acima. ──
ipcMain.handle('imprimir-etiqueta-produto', async (event, nomeImpressora, opcoes) => {
    const buffer = montarEtiquetaProduto(opcoes || {});
    return enviarBufferParaImpressora(buffer, nomeImpressora);
});

// ── Diagnóstico de impressão (SÓ LEITURA): devolve o que o Windows tem de impressoras — nome,
//    compartilhamento, driver, porta, estado — e se o serviço de impressão está rodando. Alimenta a tela
//    "Teste e diagnóstico de impressão" (app/impressao/teste-impressao.js). Não imprime nem altera nada. ──
ipcMain.handle('diagnostico-impressoras', async () => {
    const ps = [
        "$ErrorActionPreference='Stop'",
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
        '$i=@(Get-Printer | ForEach-Object { [pscustomobject]@{ nome=[string]$_.Name; compartilhamento=[string]$_.ShareName; compartilhada=[bool]$_.Shared; driver=[string]$_.DriverName; porta=[string]$_.PortName; status=[string]$_.PrinterStatus; offline=[bool]$_.WorkOffline } })',
        '$s=[string](Get-Service -Name Spooler).Status',
        '@{ spooler=$s; impressoras=$i } | ConvertTo-Json -Depth 4 -Compress'
    ].join('; ');
    const saida = await new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(`Não foi possível ler as impressoras do Windows: ${err.message}${stderr ? ' | ' + String(stderr).trim() : ''}`));
            else resolve(String(stdout));
        });
    });
    let dados;
    try { dados = JSON.parse(saida.replace(/^﻿/, '')); }
    catch (e) { throw new Error('O Windows respondeu algo que não deu pra entender: ' + saida.slice(0, 300)); }
    const lista = dados.impressoras == null ? [] : (Array.isArray(dados.impressoras) ? dados.impressoras : [dados.impressoras]);
    return { programa: app.getVersion(), windows: `${os.type()} ${os.release()} (${os.arch()})`, spooler: dados.spooler || '', impressoras: lista };
});
