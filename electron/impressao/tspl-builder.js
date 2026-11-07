// ================================================================
// impressao/tspl-builder.js — VortexSmart PDV Desktop
// Monta o BUFFER de comandos TSPL puro para a impressora de etiquetas
// Knup KP-IM600. Não sabe nada sobre impressora, porta, ou Electron —
// só monta bytes. Mesma separação de responsabilidade do
// escpos-builder.js (recibo térmico): layout aqui, transporte no
// main.js, via a mesma enviarBufferParaImpressora() já validada.
//
// TSPL é um protocolo de TEXTO (comandos em ASCII terminados por
// \r\n), diferente do ESC/POS que é binário — não precisa de iconv
// pra comandos, só se o CONTEÚDO impresso tiver acento (ver nota
// abaixo em nomeSeguro()).
//
// Confirmado via SELFTEST físico da impressora (28-Jul-2025,
// PCB V-V1.0): Command standard = TSPL, Paper Selected = GAP,
// Interface = USB, resolução 203dpi (8 dots/mm), 160mm/s.
//
// dots = mm × 8, sempre (203dpi confirmado no self-test — não
// assumir esse valor sem reconfirmar se a impressora mudar).
// ================================================================
'use strict';

const DOTS_POR_MM = 8;

function mm(valor) { return Math.round(valor * DOTS_POR_MM); }

// ── Geometria da etiqueta ────────────────────────────────────────
//    Rolo físico em uso, MEDIDO COM RÉGUA: 45 x 30 mm, gap de 5 mm
//    (o anúncio de compra e versões antigas deste arquivo diziam
//    40x30 / 40x40 — não bater com o papel real desalinha o corte).
//    DIRECTION 0 (não 1): testado fisicamente na KP-IM600 — com
//    DIRECTION 1 o conteúdo saía deslocado para a metade de baixo.
const ETIQUETA_PADRAO = { larguraMm: 45, alturaMm: 30, gapMm: 5 };
const MARGEM_DOTS = 16;          // 2 mm de folga em todas as bordas
const ESPACO_ENTRE_DOTS = 8;     // 1 mm entre nome, barras e número
const COPIAS_MAX = 100;

// Fontes bitmap internas do TSPL (largura x altura de cada caractere,
// em dots, sem multiplicador). Nome fica na "3" (o dobro da antiga
// "1"); o número abaixo das barras usa a maior que couber.
const FONTE_NOME = { id: '3', w: 16, h: 24 };
const FONTES_NUMERO = [FONTE_NOME, { id: '2', w: 12, h: 20 }, { id: '1', w: 8, h: 12 }];

// Largura de um Code128 em "módulos" (1 módulo = 1 barra fina).
// Cada símbolo = 11 módulos, mais 13 do stop. Só dígitos usa o
// subset C (2 dígitos por símbolo). Com qualquer outro caractere o
// pior caso é 1 símbolo por caractere — usado para checar se cabe.
function modulosCode128(cod) {
    const n = cod.length;
    if (/^\d+$/.test(cod)) {
        const simbolosDados = n % 2 === 0 ? n / 2 : (n - 1) / 2 + 2;
        return 11 * (simbolosDados + 2) + 13;
    }
    return 11 * (n + 2) + 13;
}

// Maior espessura de barra fina (dots) em que o código cabe COM a
// zona de silêncio de 10 módulos de cada lado (exigida pelo padrão
// para leitores lerem sem falha). Se nem assim couber, aceita só a
// margem da etiqueta; se ainda não couber, o código é grande demais.
function escolherBarraFina(modulos, larguraDots) {
    for (let n = 4; n >= 1; n--) {
        if ((modulos + 20) * n <= larguraDots) return n;
    }
    for (let n = 2; n >= 1; n--) {
        if (modulos * n <= larguraDots - 2 * MARGEM_DOTS) return n;
    }
    return 0;
}

// Nome: sem acento (o buffer é ASCII), sem aspa/barra invertida (que
// quebrariam o comando TEXT) e sem caractere fora do ASCII imprimível.
function nomeSeguro(valor) {
    return String(valor == null ? '' : valor)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/"/g, "'").replace(/\\/g, '/')
        .replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
}

// ── Monta uma etiqueta de PRODUTO: nome (1 linha, centralizado, com
//    "..." se não couber) + Code128 centralizado com a maior barra que
//    couber + número legível embaixo. Usada por estoque/produtos.js.
//    Erros (código inválido/grande demais, medidas ou cópias
//    inválidas) são lançados ANTES de qualquer byte ir à impressora.
// ── ────────────────────────────────────────────────────────────
function montarEtiquetaProduto({ nomeProduto, codigoBarras, copias = 1,
        larguraMm = ETIQUETA_PADRAO.larguraMm, alturaMm = ETIQUETA_PADRAO.alturaMm, gapMm = ETIQUETA_PADRAO.gapMm }) {
    if (![larguraMm, alturaMm].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(gapMm) || gapMm < 0) {
        throw new Error('Medidas da etiqueta inválidas.');
    }
    if (!Number.isInteger(copias) || copias < 1 || copias > COPIAS_MAX) {
        throw new Error(`Quantidade de etiquetas inválida (use de 1 a ${COPIAS_MAX}).`);
    }
    // O código NUNCA é alterado em silêncio: se a etiqueta saísse com
    // um valor diferente do cadastrado, o leitor não acharia o produto.
    const cod = String(codigoBarras == null ? '' : codigoBarras).trim();
    if (!cod || !/^[\x20-\x7E]+$/.test(cod) || /["\\]/.test(cod)) {
        throw new Error('O código de barras tem caracteres que a etiqueta não consegue imprimir (acentos, aspas ou barra invertida).');
    }

    const larguraDots = mm(larguraMm);
    const alturaDots = mm(alturaMm);
    const larguraUtil = larguraDots - 2 * MARGEM_DOTS;

    // Código de barras
    const modulos = modulosCode128(cod);
    const barra = escolherBarraFina(modulos, larguraDots);
    if (!barra) {
        throw new Error('O código de barras é grande demais para caber na etiqueta.');
    }
    // Centraliza pelo tamanho provável (exato para códigos só de
    // dígitos de tamanho par, como os gerados pelo sistema).
    const xBarras = Math.max(0, Math.round((larguraDots - modulos * barra) / 2));

    // Nome (1 linha)
    const maxChars = Math.floor(larguraUtil / FONTE_NOME.w);
    let nome = nomeSeguro(nomeProduto);
    if (nome.length > maxChars) nome = nome.slice(0, maxChars - 3).trimEnd() + '...';

    // Layout vertical: nome no topo, número na base, barras no meio
    const yNome = MARGEM_DOTS;
    const yBarras = yNome + FONTE_NOME.h + ESPACO_ENTRE_DOTS;
    const yNumero = alturaDots - MARGEM_DOTS - FONTE_NOME.h;
    const alturaBarras = yNumero - ESPACO_ENTRE_DOTS - yBarras;
    if (alturaBarras < 40) {
        throw new Error('A etiqueta é baixa demais para nome + código de barras + número.');
    }

    // Número: maior fonte em que o código inteiro cabe na largura útil
    const fonteNum = FONTES_NUMERO.find(f => cod.length * f.w <= larguraUtil) || FONTES_NUMERO[FONTES_NUMERO.length - 1];
    const xNumero = Math.max(0, Math.round((larguraDots - cod.length * fonteNum.w) / 2));
    const xNome = Math.max(0, Math.round((larguraDots - nome.length * FONTE_NOME.w) / 2));

    const linhas = [
        `SIZE ${larguraMm} mm,${alturaMm} mm`,
        `GAP ${gapMm} mm,0 mm`,
        'DIRECTION 0',
        'CLS',
    ];
    if (nome) linhas.push(`TEXT ${xNome},${yNome},"${FONTE_NOME.id}",0,1,1,"${nome}"`);
    linhas.push(
        `BARCODE ${xBarras},${yBarras},"128",${alturaBarras},0,0,${barra},${barra},"${cod}"`,
        `TEXT ${xNumero},${yNumero},"${fonteNum.id}",0,1,1,"${cod}"`,
        `PRINT 1,${copias}`
    );
    return Buffer.from(linhas.join('\r\n') + '\r\n', 'ascii');
}

// ── Etiqueta de TESTE: mesmo layout da real (não diverge), com nome
//    fixo — valida no papel sem depender de produto cadastrado. ──
function montarEtiquetaTeste({ codigo, ...medidas }) {
    return montarEtiquetaProduto({ nomeProduto: 'TESTE VORTEXSMART', codigoBarras: codigo || '00000001', ...medidas });
}

module.exports = { montarEtiquetaTeste, montarEtiquetaProduto };
