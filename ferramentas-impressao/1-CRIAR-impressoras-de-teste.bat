@echo off
title VortexSmart - criar impressoras de teste
echo.
echo Criando 2 impressoras de TESTE (nao mexe nas suas impressoras de verdade)...
echo.
net session >nul 2>&1
if %errorlevel%==0 goto admin
echo Pedindo permissao de administrador...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b
:admin
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0criar-impressoras-teste.ps1" -NomeRecibo "POS-80 TESTE(copy of 2)" -NomeEtiqueta "LABEL-TESTE"
echo.
echo Agora abra o VortexSmart PDV Beta, escolha estas duas impressoras e use Configuracoes ^> Teste de impressao.
echo.
pause
