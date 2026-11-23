# ================================================================
# criar-impressoras-teste.ps1 — VortexSmart PDV
# Cria no Windows duas impressoras FALSAS (uma de recibo, uma de etiqueta) que, em vez de
# imprimir, gravam tudo que recebem num arquivo. Servem pra testar o programa SEM a
# impressora térmica: o programa envia exatamente como enviaria pra de verdade
# (copy /b até \\localhost\<nome da impressora>) e o arquivo gravado mostra os bytes que
# chegaram. Nada é instalado além de duas filas de impressão — e o remover-impressoras-teste.ps1
# apaga tudo.
#
# COMO USAR
#   1. Botão direito em "Windows PowerShell" > Executar como administrador.
#   2. Rodar (ajuste o caminho):   powershell -ExecutionPolicy Bypass -File .\criar-impressoras-teste.ps1
#      Pra usar os MESMOS nomes das impressoras do cliente:
#      powershell -ExecutionPolicy Bypass -File .\criar-impressoras-teste.ps1 -NomeRecibo "KP-IM602" -NomeEtiqueta "KP-IM600"
#   3. No programa: Configurações > Impressora de recibo / Etiquetas > escolher as impressoras de teste.
#   4. Imprimir um recibo e uma etiqueta. Os arquivos ficam em C:\VortexTeste\ (recibo.prn e etiqueta.prn).
#   5. Mandar os dois arquivos pra conferência.
#   Antes de cada teste novo, rode de novo com -Limpar pra zerar os arquivos.
# ================================================================
param(
    [string]$NomeRecibo = 'TESTE-RECIBO',
    [string]$NomeEtiqueta = 'TESTE-ETIQUETA',
    [string]$Pasta = 'C:\VortexTeste',
    [switch]$Limpar          # só apaga os arquivos de saída (zera o teste), sem recriar as impressoras
)

$ErrorActionPreference = 'Stop'

function Falha($msg) { Write-Host ''; Write-Host "ERRO: $msg" -ForegroundColor Red; exit 1 }

$ehAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $ehAdmin) { Falha 'Abra o PowerShell como ADMINISTRADOR (botão direito > Executar como administrador) e rode de novo.' }

$arquivoRecibo   = Join-Path $Pasta 'recibo.prn'
$arquivoEtiqueta = Join-Path $Pasta 'etiqueta.prn'

if ($Limpar) {
    foreach ($a in @($arquivoRecibo, $arquivoEtiqueta)) { if (Test-Path -LiteralPath $a) { Remove-Item -LiteralPath $a -Force } }
    Write-Host 'Arquivos de saída apagados. Pode imprimir um novo teste.' -ForegroundColor Green
    exit 0
}

try {
    New-Item -ItemType Directory -Force -Path $Pasta | Out-Null

    # Driver que já vem no Windows. Não instala nada de fora.
    $driver = 'Generic / Text Only'
    if (-not (Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue)) { Add-PrinterDriver -Name $driver }

    function Criar-Impressora($nome, $arquivo) {
        if (Test-Path -LiteralPath $arquivo) { Remove-Item -LiteralPath $arquivo -Force }
        # Impressora existente com esse nome (de um teste anterior): refaz do zero. Só mexe nas
        # que usam o driver de teste — nunca apaga uma impressora real com o mesmo nome.
        $velha = Get-Printer -Name $nome -ErrorAction SilentlyContinue
        if ($velha) {
            if ($velha.DriverName -ne $driver) { Falha "Já existe uma impressora chamada '$nome' que NÃO é de teste (driver '$($velha.DriverName)'). Use outro nome com -NomeRecibo / -NomeEtiqueta." }
            Remove-Printer -Name $nome
        }
        # Porta = o próprio arquivo: o Windows grava ali os bytes do trabalho de impressão.
        if (-not (Get-PrinterPort -Name $arquivo -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name $arquivo }
        Add-Printer -Name $nome -DriverName $driver -PortName $arquivo
        # Compartilhamento com o MESMO nome da impressora, como o programa exige.
        Set-Printer -Name $nome -Shared $true -ShareName $nome
    }

    Criar-Impressora $NomeRecibo $arquivoRecibo
    Criar-Impressora $NomeEtiqueta $arquivoEtiqueta

    # Autoteste: manda 7 bytes pelo MESMO caminho do programa e confere se chegaram no arquivo.
    Write-Host ''
    Write-Host 'Autoteste do caminho de impressão do Windows...'
    $falhou = $false
    foreach ($par in @(@($NomeRecibo, $arquivoRecibo), @($NomeEtiqueta, $arquivoEtiqueta))) {
        $nome = $par[0]; $arquivo = $par[1]
        $tmp = Join-Path $env:TEMP ('vsmart-autoteste-' + [guid]::NewGuid().ToString('N') + '.prn')
        [IO.File]::WriteAllBytes($tmp, [byte[]](0x1B, 0x40, 0x56, 0x53, 0x4D, 0x41, 0x52))
        $saida = (& cmd.exe /c copy /b "$tmp" "\\localhost\$nome" 2>&1 | Out-String).Trim()
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        $ok = $false
        for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
            Start-Sleep -Milliseconds 500
            if ((Test-Path -LiteralPath $arquivo) -and ((Get-Item -LiteralPath $arquivo).Length -ge 7)) { $ok = $true }
        }
        if ($ok) { Write-Host "  OK   \\localhost\$nome -> $arquivo" -ForegroundColor Green }
        else { $falhou = $true; Write-Host "  FALHOU  \\localhost\$nome. O Windows respondeu: $saida" -ForegroundColor Red }
        if (Test-Path -LiteralPath $arquivo) { Remove-Item -LiteralPath $arquivo -Force -ErrorAction SilentlyContinue }
    }
    if ($falhou) { Falha 'O caminho de impressão do Windows não funcionou (veja a resposta acima). Mande um print desta tela.' }

    Write-Host ''
    Write-Host 'Pronto. Impressoras de teste criadas e compartilhadas:' -ForegroundColor Green
    Write-Host "  Recibo:   $NomeRecibo   -> $arquivoRecibo"
    Write-Host "  Etiqueta: $NomeEtiqueta -> $arquivoEtiqueta"
    Write-Host 'Agora escolha essas impressoras no programa e imprima. Depois mande os arquivos .prn.'
}
catch {
    Falha ("$($_.Exception.Message)")
}
