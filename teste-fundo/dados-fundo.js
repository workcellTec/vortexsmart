// Dados mínimos pra todas as telas do PC terem conteúdo na hora da auditoria (ver auditar-fundo.js).
(function () {
  const T = window.__T = {};
  T.usuarios = { u1: { lojaId: 'L1', papel: 'gestor', nome: 'Teste' } };
  T.lojas = { L1: { configuracoes: { reparos: { modo: 'propria' } }, reparos: {}, products: {} } };
  ['CASE A10', 'CASE A54', 'CAPA MOTOROLA G20', 'CABO USB-C 1M', 'CARREGADOR TURBO 25W', 'FONE JBL T110', 'PELICULA 3D IPHONE 11']
    .forEach((n, i) => { T.lojas.L1.products['p' + i] = { nome: n, valor: 20, quantidade: 5 }; });
  window._testeSimularUsuario = () => ({ lojaId: 'L1', papel: 'gestor', nome: 'Teste', permissoes: null });
})();
