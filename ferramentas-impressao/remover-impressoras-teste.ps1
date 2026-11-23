# ================================================================
# remover-impressoras-teste.ps1 — VortexSmart PDV
# Apaga as impressoras de teste criadas por criar-impressoras-teste.ps1 (e as portas/arquivos).
# Só remove impressoras que usam o driver "Generic / Text Only" E cuja porta é um arquivo dentro
# da pasta de teste — nunca toca numa impressora real.
# Rodar como ADMINISTRADOR:  powershell -ExecutionPolicy Bypass -File .\remover-impressoras-teste.ps1
# ================================================================
param(
    [string]$NomeRecibo = 'TESTE-RECIBO',
    [string]$NomeEtiqueta = 'TESTE-ETIQUETA',
    [string]$Pasta = 'C:\VortexTeste'
)
$ErrorActionPreference = 'Stop'
$ehAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $ehAdmin) { Write-Host 'ERRO: abra o PowerShell como ADMINISTRADOR e rode de novo.' -ForegroundColor Red; exit 1 }

foreach ($nome in @($NomeRecibo, $NomeEtiqueta)) {
    $p = Get-Printer -Name $nome -ErrorAction SilentlyContinue
    if (-not $p) { Write-Host "  (não existe: $nome)"; continue }
    if ($p.DriverName -ne 'Generic / Text Only' -or -not $p.PortName.StartsWith($Pasta, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Host "  IGNORADA: '$nome' não parece ser de teste (driver '$($p.DriverName)', porta '$($p.PortName)')." -ForegroundColor Yellow
        continue
    }
    $porta = $p.PortName
    Remove-Printer -Name $nome
    if (Get-PrinterPort -Name $porta -ErrorAction SilentlyContinue) { Remove-PrinterPort -Name $porta -ErrorAction SilentlyContinue }
    Write-Host "  removida: $nome" -ForegroundColor Green
}
foreach ($a in @('recibo.prn', 'etiqueta.prn')) {
    $f = Join-Path $Pasta $a
    if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
}
Write-Host 'Pronto.' -ForegroundColor Green
