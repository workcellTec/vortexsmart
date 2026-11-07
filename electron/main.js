// ================================================================
// main.js — VortexSmart PDV Desktop
// Processo principal Electron: abre o VortexSmart real (pasta ../app)
// dentro de uma janela desktop, e expõe (via preload.js) a ponte de
// impressão térmica ESC/POS que impressao/recibo-termico.js chama.
// ================================================================
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const iconv = require('iconv-lite');
const { execFile } = require('child_process');
const { montarReciboVenda } = require('./impressao/escpos-builder.js');
const { montarEtiquetaTeste, montarEtiquetaProduto } = require('./impressao/tspl-builder.js');

let mainWindow;

// Pasta do VortexSmart (o site). Em desenvolvimento (npm start) é ../app. No programa
// instalado, o electron-builder copia ela pra resources/web — NÃO pode se chamar "app":
// o Electron trata resources/app como o próprio programa e não abriria.
// Para ver o menu e o console (suporte): abrir com o argumento --debug.
const DEBUG = process.argv.includes('--debug');
const PASTA_WEB = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'app');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        icon: path.join(PASTA_WEB, 'icons', 'icon-512.png'),
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
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
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
    });
}

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
