// ================================================================
// impressao/escpos-builder.js — VortexSmart PDV Desktop
// Monta o BUFFER ESC/POS (bytes) do recibo de venda para a impressora
// térmica de cupom. Não sabe nada sobre impressora, porta ou Electron —
// só monta bytes. O envio é feito pelo main.js (enviarBufferParaImpressora).
// ================================================================
'use strict';

const iconv = require('iconv-lite');

const COLUNAS = 48;            // 80 mm. Para bobina de 58 mm use 32.
const CODEPAGE = 'cp860';      // português (ESC t 3)

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
const CMD = {
    iniciar:      Buffer.from([ESC, 0x40]),
    codepage:     Buffer.from([ESC, 0x74, 0x03]),
    alinharEsq:   Buffer.from([ESC, 0x61, 0x00]),
    alinharCentro:Buffer.from([ESC, 0x61, 0x01]),
    negritoOn:    Buffer.from([ESC, 0x45, 0x01]),
    negritoOff:   Buffer.from([ESC, 0x45, 0x00]),
    cortar:       Buffer.from([GS, 0x56, 0x42, 0x03])
};

const dinheiro = n => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');
const txt = s => iconv.encode(String(s == null ? '' : s), CODEPAGE);

function linha(s = '') { return Buffer.concat([txt(s), Buffer.from([LF])]); }
function separador(c = '-') { return linha(c.repeat(COLUNAS)); }

// "esquerda ........ direita" na largura da bobina
function duasColunas(esq, dir) {
    esq = String(esq); dir = String(dir);
    if (esq.length + dir.length + 1 > COLUNAS) esq = esq.slice(0, COLUNAS - dir.length - 1);
    return linha(esq + ' '.repeat(Math.max(1, COLUNAS - esq.length - dir.length)) + dir);
}

// Quebra texto longo em várias linhas (sem cortar palavra no meio quando possível)
function quebrar(texto, largura = COLUNAS) {
    const out = [];
    let atual = '';
    for (const palavra of String(texto || '').split(/\s+/).filter(Boolean)) {
        if ((atual + ' ' + palavra).trim().length <= largura) {
            atual = (atual + ' ' + palavra).trim();
        } else {
            if (atual) out.push(atual);
            atual = palavra.length > largura ? palavra.slice(0, largura) : palavra;
        }
    }
    if (atual) out.push(atual);
    return out;
}

function montarReciboVenda(venda = {}, loja = {}) {
    const p = [CMD.iniciar, CMD.codepage, CMD.alinharCentro, CMD.negritoOn];

    // ── Cabeçalho da loja ──
    // O app manda o nome (Documentos, ou o do cadastro da loja). Se por algum motivo vier
    // vazio, não imprime um "LOJA" genérico: simplesmente não escreve a linha do nome.
    if (loja.storeName) p.push(linha(loja.storeName));
    p.push(CMD.negritoOff);
    if (loja.storeCNPJ)     p.push(linha('CNPJ: ' + loja.storeCNPJ));
    if (loja.storeEndereco) quebrar(loja.storeEndereco).forEach(l => p.push(linha(l)));
    if (loja.storeTelefone) p.push(linha('Tel: ' + loja.storeTelefone));
    p.push(CMD.alinharEsq, separador('='));

    // ── Dados da venda ──
    const data = new Date(venda.fechadaEm || Date.now());
    p.push(linha('Data: ' + data.toLocaleString('pt-BR')));
    if (venda.numeroVenda) p.push(linha('Venda: #' + venda.numeroVenda));
    if (venda.clienteNome) p.push(linha('Cliente: ' + venda.clienteNome));
    p.push(separador());

    // ── Itens ──
    for (const it of venda.itens || []) {
        const qtd = Number(it.quantidade) || 1;
        const unit = Number(it.valorUnitario) || 0;
        const total = it.valorTotal != null ? Number(it.valorTotal) : qtd * unit;
        quebrar(it.produtoNome || 'Item').forEach(l => p.push(linha(l)));
        p.push(duasColunas(`  ${qtd} x ${dinheiro(unit)}`, dinheiro(total)));
        if (it.obs) quebrar(it.obs, COLUNAS - 2).forEach(l => p.push(linha('  ' + l)));
    }
    p.push(separador());

    // ── Total e pagamentos ──
    p.push(CMD.negritoOn, duasColunas('TOTAL', dinheiro(venda.valorTotal)), CMD.negritoOff);
    for (const pg of venda.pagamentos || []) {
        p.push(duasColunas(pg.formaLabel || pg.forma || 'Pagamento', dinheiro(pg.valor)));
    }

    // ── Rodapé ──
    p.push(separador('='), CMD.alinharCentro, linha('Obrigado pela preferencia!'),
           Buffer.from([LF, LF, LF, LF]), CMD.cortar);

    return Buffer.concat(p);
}

module.exports = { montarReciboVenda };
