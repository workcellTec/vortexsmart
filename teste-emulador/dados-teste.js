// Dados de exemplo (loja de teste) e usuário Gestor falso. Entra antes de tudo na página (ver servidor.js).
(function () {
  const T = window.__T = {};
  const agora = Date.now();
  const os = (i, status) => ({ cliente: { nome: 'Cliente ' + i, telefone: '62999990000' }, aparelho: 'Samsung A' + i, defeito: 'Tela quebrada', status, modo: 'propria', criadoEm: agora - i * 3600000, prazoTs: agora + 86400000, timeline: { fila: { ts: agora - i * 3600000 } } });
  T.usuarios = { u1: { lojaId: 'L1', papel: 'gestor', nome: 'Teste' } };
  T.lojas = { L1: { configuracoes: { reparos: { modo: 'propria' } }, reparos: {} } };
  for (let i = 1; i <= __OS_QTD__; i++) T.lojas.L1.reparos['os' + i] = os(i, i === 3 ? 'em_reparo' : 'fila');   // quantidade vem do servidor (OS_QTD, padrão 60); os5..os8 são as usadas pelo roteiro
  window._testeSimularUsuario = () => ({ lojaId: 'L1', papel: 'gestor', nome: 'Teste', permissoes: null });
})();
