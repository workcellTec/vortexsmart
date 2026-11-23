// ================================================================
// casos.js — entradas fixas usadas pela trava de impressão (conferir.js / gerar-golden.js).
// Cada caso vira um arquivo em golden/ com os bytes que o código de referência gerou.
// ================================================================
'use strict';

const T0 = Date.UTC(2026, 0, 15, 15, 30, 45);

const LOJA_COMPLETA = {
    storeName: 'LOJA DE TESTE', storeCNPJ: '00.000.000/0000-00',
    storeEndereco: 'Rua Exemplo, 123 - Centro, Sua Cidade/UF', storeTelefone: '(00) 00000-0000'
};

const recibos = {
    'recibo-exemplo': [{
        id: 'venda-teste-0001', clienteNome: 'Cliente de Teste', fechadaEm: T0,
        itens: [
            { produtoNome: 'Tela iPhone 11 Original', valorUnitario: 350.00, quantidade: 1, obs: 'IMEI 358240051234567' },
            { produtoNome: 'Pelicula 3D', valorUnitario: 25.00, quantidade: 2, obs: '' }
        ],
        valorTotal: 400.00, pagamentos: [{ formaLabel: 'PagBank · Crédito 3x', valor: 400.00 }]
    }, LOJA_COMPLETA],

    'recibo-acentos-e-quebras': [{
        numeroVenda: 1234, clienteNome: 'José da Conceição Ação Ünico', fechadaEm: T0,
        itens: [
            { produtoNome: 'Capa Antichoque Samsung Galaxy A54 5G Transparente Reforçada Premium Edição Limitada', valorUnitario: 49.9, quantidade: 3, valorTotal: 140, obs: 'Cor: azul-marinho; entregar até sexta-feira à tarde, com nota fiscal e garantia estendida' },
            { produtoNome: 'Carregador Turbo 25W', valorUnitario: 89.9, quantidade: 1 },
            { produtoNome: 'Palavra' + 'x'.repeat(60), valorUnitario: 1, quantidade: 1 },
            { valorUnitario: 0.5, quantidade: 0 }
        ],
        valorTotal: 1234.56,
        pagamentos: [
            { formaLabel: 'Dinheiro', valor: 200 },
            { forma: 'pix', valor: 500.5 },
            { valor: 534.06 }
        ]
    }, { storeName: 'Assistência Técnica & Cia — Ação', storeCNPJ: '12.345.678/0001-90', storeEndereco: 'Avenida Presidente Juscelino Kubitschek de Oliveira, 1500, Sala 12, Bairro São João, Cidade Grande/SP', storeTelefone: '(11) 91234-5678' }],

    'recibo-minimo': [{ fechadaEm: T0 }, {}]
};

const etiquetas = {
    'etiqueta-padrao': { nomeProduto: 'Capa iPhone 11 Transparente', codigoBarras: '00000123' },
    'etiqueta-teste': { nomeProduto: 'TESTE VORTEXSMART', codigoBarras: '00000001' },
    'etiqueta-nome-longo-acentos': { nomeProduto: 'Película de Vidro 3D Ação Premium "Anti-Risco" \\ Samsung Galaxy A54', codigoBarras: '7891234567895', copias: 3 },
    'etiqueta-codigo-alfanumerico': { nomeProduto: 'Cabo USB-C', codigoBarras: 'AB-123/x', copias: 100 },
    'etiqueta-medidas': { nomeProduto: 'Fone Bluetooth', codigoBarras: '12345', larguraMm: 60, alturaMm: 40, gapMm: 3 },
    'etiqueta-sem-nome': { nomeProduto: '', codigoBarras: '0000000099' },
    'etiqueta-erro-aspas': { nomeProduto: 'X', codigoBarras: 'ab"c' },
    'etiqueta-erro-acento': { nomeProduto: 'X', codigoBarras: 'açaí' },
    'etiqueta-erro-copias': { nomeProduto: 'X', codigoBarras: '1', copias: 0 },
    'etiqueta-erro-medida': { nomeProduto: 'X', codigoBarras: '1', larguraMm: 0 },
    'etiqueta-erro-codigo-grande': { nomeProduto: 'X', codigoBarras: 'A'.repeat(40) },
    'etiqueta-erro-baixa': { nomeProduto: 'X', codigoBarras: '1', alturaMm: 8 }
};

module.exports = { recibos, etiquetas };
