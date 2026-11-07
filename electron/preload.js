// ================================================================
// preload.js — VortexSmart PDV Desktop
// Ponte segura (contextIsolation) entre o app web e o main.js.
// Expõe window.vsmartPrint para o app (estoque, venda, recibo).
// ================================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vsmartPrint', {
    listarImpressoras:      ()                      => ipcRenderer.invoke('listar-impressoras'),
    imprimirReciboVenda:    (impressora, venda, loja) => ipcRenderer.invoke('imprimir-recibo-venda', impressora, venda, loja),
    // Mesmo canal, com o nome que o app (impressao/recibo-termico.js) chama. Sem ele o recibo dava
    // "imprimirRecibo is not a function" — e a tela ainda mostrava "Trocar impressora", que enganava.
    imprimirRecibo:         (impressora, venda, loja) => ipcRenderer.invoke('imprimir-recibo-venda', impressora, venda, loja),
    imprimirEtiquetaProduto:(impressora, opcoes)    => ipcRenderer.invoke('imprimir-etiqueta-produto', impressora, opcoes),
    testeImpressao:         (impressora)            => ipcRenderer.invoke('teste-impressao', impressora),
    testeImpressaoEtiqueta: (impressora, opcoes)    => ipcRenderer.invoke('teste-impressao-etiqueta', impressora, opcoes)
});
