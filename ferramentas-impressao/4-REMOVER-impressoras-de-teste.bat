@echo off
title VortexSmart - remover impressoras de teste
echo.
net session >nul 2>&1
if %errorlevel%==0 goto admin
echo Pedindo permissao de administrador...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b
:admin
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0remover-impressoras-teste.ps1" -NomeRecibo "POS-80 TESTE(copy of 2)" -NomeEtiqueta "LABEL-TESTE"
echo.
pause
