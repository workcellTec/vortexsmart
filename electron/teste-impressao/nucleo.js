// ================================================================
// nucleo.js — o que a trava de impressão mede (usado por conferir.js e gerar-golden.js).
// Dado uma pasta "electron" (a de agora ou a de referência), devolve:
//   • os bytes (ou a mensagem de erro) de cada caso de casos.js;
//   • o selo (sha256) dos arquivos e trechos do main.js que montam e enviam a impressão.
// ================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { recibos, etiquetas } = require('./casos.js');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const norm = t => t.replace(/\r\n/g, '\n');

// A linha "Data: ..." depende do fuso/idioma do computador: é trocada por um marcador antes de comparar.
function mascararData(buf) {
    const i = buf.indexOf('Data: ');
    if (i < 0) return buf;
    const f = buf.indexOf(0x0a, i);
    return Buffer.concat([buf.slice(0, i), Buffer.from('Data: <MASCARADA>'), buf.slice(f)]);
}

function trecho(main, inicio, fim) {
    const a = main.indexOf(inicio);
    if (a < 0) throw new Error(`não achei no main.js: ${inicio}`);
    const b = main.indexOf(fim, a);
    if (b < 0) throw new Error(`não achei o fim de: ${inicio}`);
    return main.slice(a, b + fim.length);
}

function selos(pasta) {
    const lerArq = f => norm(fs.readFileSync(path.join(pasta, f), 'utf8'));
    const main = lerArq('main.js');
    const out = {
        'impressao/escpos-builder.js': sha(lerArq('impressao/escpos-builder.js')),
        'impressao/tspl-builder.js': sha(lerArq('impressao/tspl-builder.js')),
        'main.js: textoDoWindows': sha(trecho(main, 'function textoDoWindows', '\n}\n')),
        'main.js: DICA_COMPARTILHAMENTO': sha(trecho(main, 'const DICA_COMPARTILHAMENTO', '\n')),
        'main.js: listar-impressoras': sha(trecho(main, "ipcMain.handle('listar-impressoras'", '\n});\n')),
        'main.js: enviarBufferParaImpressora': sha(trecho(main, 'function enviarBufferParaImpressora', '\n}\n'))
    };
    for (const h of ['imprimir-recibo-venda', 'teste-impressao', 'teste-impressao-etiqueta', 'imprimir-etiqueta-produto']) {
        out[`main.js: handler ${h}`] = sha(trecho(main, `ipcMain.handle('${h}'`, '\n});\n'));
    }
    return out;
}

function bytes(pasta) {
    const esc = require(path.join(pasta, 'impressao/escpos-builder.js'));
    const tspl = require(path.join(pasta, 'impressao/tspl-builder.js'));
    const out = {};
    for (const [nome, args] of Object.entries(recibos)) out[nome] = mascararData(esc.montarReciboVenda(...args));
    for (const [nome, op] of Object.entries(etiquetas)) {
        try { out[nome] = tspl.montarEtiquetaProduto(op); }
        catch (e) { out[nome] = Buffer.from('ERRO: ' + e.message, 'utf8'); }
    }
    return out;
}

module.exports = { selos, bytes };
