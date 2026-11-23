# Ferramentas de teste de impressão (rodam no PC de quem desenvolve, NÃO vão pro cliente)

Servem pra provar, sem a impressora térmica do cliente, que o programa manda pra impressora os bytes certos
pelo caminho certo (`copy /b` para `\\localhost\<nome da impressora>`).

## 1) Criar impressoras de teste (Windows, PowerShell **como Administrador**)
```powershell
cd ferramentas-impressao
.\criar-impressoras-teste.ps1 -NomeRecibo 'TESTE-RECIBO' -NomeEtiqueta 'TESTE-ETIQUETA'
```
- Cria duas impressoras virtuais (driver "Generic / Text Only", porta = arquivo em `C:\VortexTeste`), **compartilhadas
  com o mesmo nome da impressora** — exatamente o que o programa exige.
- Use `-NomeRecibo`/`-NomeEtiqueta` com os MESMOS nomes que o Windows do cliente usa, se quiser simular a configuração dele.
- Faz um autoteste (copia 7 bytes pelo mesmo comando do programa e confere o arquivo). Se ele falhar, o próprio script diz o motivo.
- Remover tudo depois: `.\remover-impressoras-teste.ps1` (só remove impressoras criadas pelo script).

## 2) Imprimir pelo programa
No VortexSmart PDV (ou Beta): Configurações → **Impressora de Recibo / de Etiquetas** → escolher a impressora de teste →
Configurações → **Teste de impressão** → "Imprimir teste de recibo" / "de etiqueta". Também vale uma venda real → Recibo.
Os bytes caem em `C:\VortexTeste\recibo.prn` e `etiqueta.prn`.

## 3) Conferir o que chegou (precisa de Node.js)
```
node conferir-arquivo.js C:\VortexTeste\recibo.prn
node conferir-arquivo.js C:\VortexTeste\etiqueta.prn
python previa.py C:\VortexTeste\recibo.prn recibo.png     # imagem aproximada do papel (pip install pillow python-barcode)
```
`conferir-arquivo.js` diz se os bytes são idênticos aos que o programa deveria gerar (etiqueta e recibo de teste: byte a byte).

## O que isso prova e o que NÃO prova
Prova: nomes, compartilhamento, caminho, bytes, acentos (cp860), comandos de corte/inicialização/TSPL.
Não prova: o papel físico (largura real, alinhamento, densidade) nem o driver da térmica real — isso só a impressora do cliente mostra.
