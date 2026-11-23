#!/usr/bin/env node
// ================================================================
// conferir.js — TRAVA DA IMPRESSÃO (roda no workflow antes de gerar o instalador:  npm run test:impressao)
// Garante que o que vai pro cliente imprime EXATAMENTE como o código de referência validado no papel:
//   1) os bytes de recibo e etiqueta, para vários casos (acentos, quebras, erros), são idênticos aos de golden/;
//   2) os arquivos e trechos do main.js que montam e enviam a impressão têm o mesmo selo (sha256).
// Se falhar, o instalador NÃO é gerado. Só se atualiza o golden/ de propósito (gerar-golden.js),
// depois de validar a mudança em impressora de verdade.
// ================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { selos, bytes } = require('./nucleo.js');

const GOLDEN = path.join(__dirname, 'golden');
const erros = [];
let n = 0;

const esperados = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'selos.json'), 'utf8'));
const atuais = selos(path.join(__dirname, '..'));
for (const k of new Set([...Object.keys(esperados), ...Object.keys(atuais)])) {
    n++;
    if (esperados[k] !== atuais[k]) erros.push(`SELO DIFERENTE: ${k}`);
}
const b = bytes(path.join(__dirname, '..'));
const arquivos = fs.readdirSync(GOLDEN).filter(f => f.endsWith('.bin')).map(f => f.slice(0, -4));
for (const nome of new Set([...arquivos, ...Object.keys(b)])) {
    n++;
    if (!arquivos.includes(nome) || !b[nome]) { erros.push(`CASO SEM PAR: ${nome}`); continue; }
    const gold = fs.readFileSync(path.join(GOLDEN, nome + '.bin'));
    if (!gold.equals(b[nome])) erros.push(`BYTES DIFERENTES: ${nome} (referência ${gold.length} B, agora ${b[nome].length} B)`);
}

if (erros.length) {
    console.error(`\nTRAVA DA IMPRESSÃO: FALHOU (${erros.length} de ${n} conferências)`);
    erros.forEach(e => console.error('  ✗ ' + e));
    console.error('\nA impressão mudou em relação à versão validada no papel. Não gere o instalador.');
    process.exit(1);
}
console.log(`Trava da impressão: OK — ${n} conferências (bytes de recibo/etiqueta + selos do código de envio) idênticas ao código validado.`);
