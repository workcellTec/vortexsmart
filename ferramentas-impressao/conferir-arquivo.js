#!/usr/bin/env node
// ================================================================
// conferir-arquivo.js — VortexSmart PDV
// Confere um arquivo gravado por uma impressora de teste (criar-impressoras-teste.ps1):
//   node conferir-arquivo.js C:\VortexTeste\recibo.prn
//   node conferir-arquivo.js C:\VortexTeste\etiqueta.prn
// Diz se os bytes que chegaram são os que o programa deveria enviar. Etiqueta: regenera pelo
// mesmo código do programa e compara byte a byte. Recibo: confere a estrutura (inicialização,
// página de código, corte) e, quando é o recibo de exemplo do botão "Imprimir teste", também
// regenera e compara byte a byte (a data é lida do próprio arquivo).
// ================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const iconv = (() => { try { return require('iconv-lite'); } catch (e) { return require('../electron/node_modules/iconv-lite'); } })();
const { montarReciboVenda } = require('../electron/impressao/escpos-builder.js');
const { montarEtiquetaProduto } = require('../electron/impressao/tspl-builder.js');

const arq = process.argv[2];
if (!arq) { console.error('Uso: node conferir-arquivo.js <arquivo.prn>'); process.exit(2); }
const b = fs.readFileSync(arq);
const ok = [], erro = [];
const confere = (cond, msg) => (cond ? ok : erro).push(msg);
console.log(`${path.basename(arq)}: ${b.length} bytes`);

if (b[0] === 0x1b && b[1] === 0x40) {
    // ── RECIBO (ESC/POS) ──
    confere(b[2] === 0x1b && b[3] === 0x74 && b[4] === 0x03, 'começa com ESC @ + página de código cp860 (ESC t 3)');
    const fim = Buffer.from([0x1d, 0x56, 0x42, 0x03]);
    confere(b.slice(-4).equals(fim), 'termina com o comando de corte (GS V B 3)');
    const texto = iconv.decode(b, 'cp860');
    const mData = texto.match(/Data: (\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})/);
    confere(!!mData, 'tem a linha de data');
    console.log('\n--- texto do recibo (como a impressora lê) ---');
    console.log(texto.replace(/[\x00-\x09\x0b-\x1f]/g, ''));
    console.log('---');
    if (/LOJA DE TESTE/.test(texto) && /Cliente de Teste/.test(texto) && mData) {
        const d = new Date(+mData[3], +mData[2] - 1, +mData[1], +mData[4], +mData[5], +mData[6]);
        const esperado = montarReciboVenda({
            id: 'venda-teste-0001', clienteNome: 'Cliente de Teste', fechadaEm: d.getTime(),
            itens: [{ produtoNome: 'Tela iPhone 11 Original', valorUnitario: 350, quantidade: 1, obs: 'IMEI 358240051234567' }, { produtoNome: 'Pelicula 3D', valorUnitario: 25, quantidade: 2, obs: '' }],
            valorTotal: 400, pagamentos: [{ formaLabel: 'PagBank · Crédito 3x', valor: 400 }]
        }, { storeName: 'LOJA DE TESTE', storeCNPJ: '00.000.000/0000-00', storeEndereco: 'Rua Exemplo, 123 - Centro, Sua Cidade/UF', storeTelefone: '(00) 00000-0000' });
        confere(esperado.equals(b), 'recibo de exemplo: IDÊNTICO byte a byte ao que o programa gera');
    }
} else if (b.slice(0, 5).toString('ascii') === 'SIZE ') {
    // ── ETIQUETA (TSPL) ──
    const t = b.toString('ascii');
    console.log('\n--- comandos recebidos ---\n' + t.trim() + '\n---');
    const m = t.match(/SIZE (\d+) mm,(\d+) mm\r\nGAP (\d+) mm,0 mm\r\n[\s\S]*?"128",\d+,0,0,\d+,\d+,"([^"]+)"[\s\S]*PRINT 1,(\d+)/);
    const nome = (t.match(/TEXT \d+,\d+,"\w+",0,1,1,"([^"]*)"/) || [])[1];
    confere(!!m, 'estrutura TSPL completa (SIZE, GAP, CLS, TEXT, BARCODE, PRINT)');
    if (m) {
        let esperado;
        try {
            // se o nome foi cortado com "...", a regeneração com o nome cortado reproduz o mesmo texto
            esperado = montarEtiquetaProduto({ nomeProduto: nome, codigoBarras: m[4], copias: +m[5], larguraMm: +m[1], alturaMm: +m[2], gapMm: +m[3] });
        } catch (e) { erro.push('regenerar a etiqueta falhou: ' + e.message); }
        if (esperado) confere(esperado.equals(b), 'etiqueta: IDÊNTICA byte a byte ao que o programa gera pra esse nome/código/medidas');
    }
} else {
    erro.push('não parece nem recibo (ESC @) nem etiqueta (SIZE ...): primeiros bytes ' + b.slice(0, 8).toString('hex'));
}
console.log('');
ok.forEach(m => console.log('  OK    ' + m));
erro.forEach(m => console.log('  ERRO  ' + m));
process.exit(erro.length ? 1 : 0);
