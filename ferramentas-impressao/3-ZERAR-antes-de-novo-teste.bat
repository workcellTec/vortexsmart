@echo off
title VortexSmart - zerar arquivos de teste
echo.
net session >nul 2>&1
if %errorlevel%==0 goto admin
echo Pedindo permissao de administrador...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b
:admin
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0criar-impressoras-teste.ps1" -NomeRecibo "POS-80 TESTE(copy of 2)" -NomeEtiqueta "LABEL-TESTE" -Limpar
echo.
pause
