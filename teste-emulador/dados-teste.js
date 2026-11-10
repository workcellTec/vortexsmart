// Dados de exemplo (loja de teste) e usuário Gestor falso. Entra antes de tudo na página (ver servidor.js).
(function () {
  const T = window.__T = {};
  const agora = Date.now();
  const os = (i, status) => ({ cliente: { nome: 'Cliente ' + i, telefone: '62999990000' }, aparelho: 'Samsung A' + i, defeito: 'Tela quebrada', status, modo: 'propria', criadoEm: agora - i * 3600000, prazoTs: agora + 86400000, timeline: { fila: { ts: agora - i * 3600000 } } });
  T.usuarios = { u1: { lojaId: 'L1', papel: 'gestor', nome: 'Teste' } };
  T.lojas = { L1: { configuracoes: { reparos: { modo: 'propria' } }, reparos: {} } };
  for (let i = 1; i <= 8; i++) T.lojas.L1.reparos['os' + i] = os(i, i === 3 ? 'em_reparo' : 'fila');
  window._testeSimularUsuario = () => ({ lojaId: 'L1', papel: 'gestor', nome: 'Teste', permissoes: null });
})();
