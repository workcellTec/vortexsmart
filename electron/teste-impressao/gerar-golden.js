#!/usr/bin/env node
// ================================================================
// gerar-golden.js — grava golden/ a partir de uma pasta "electron" de REFERÊNCIA (código de
// impressão já validado no papel). Uso:  node gerar-golden.js <pasta-electron-de-referencia>
// Só se roda de propósito, quando a impressão foi alterada e validada no papel. Nunca no dia a dia.
// ================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { selos, bytes } = require('./nucleo.js');

const ref = process.argv[2];
if (!ref) { console.error('Uso: node gerar-golden.js <pasta-electron-de-referencia>'); process.exit(2); }
const pasta = path.resolve(ref), dest = path.join(__dirname, 'golden');
fs.mkdirSync(dest, { recursive: true });
for (const f of fs.readdirSync(dest)) fs.unlinkSync(path.join(dest, f));
const b = bytes(pasta);
for (const [nome, buf] of Object.entries(b)) fs.writeFileSync(path.join(dest, nome + '.bin'), buf);
fs.writeFileSync(path.join(dest, 'selos.json'), JSON.stringify(selos(pasta), null, 2) + '\n');
console.log(`Gravado em ${dest}: ${Object.keys(b).length} casos + selos.json (de ${pasta})`);
