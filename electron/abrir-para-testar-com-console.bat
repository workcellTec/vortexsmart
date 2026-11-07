@echo off
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 goto semnode
if not exist node_modules (
  echo Primeira vez: preparando ^(demora alguns minutos, so desta vez^)...
  call npm install
  if errorlevel 1 goto erro
)
echo ============================================================
echo   VortexSmart - MODO TESTE com CONSOLE (para ver erros)
echo   NAO instala nada: abre direto da pasta "app".
echo   Mudou algum arquivo? Na janela do programa aperte Ctrl+R
echo   ^(ou Ctrl+Shift+R^) para recarregar. Nao precisa fechar.
echo   O console aparece ao lado: erros ficam em VERMELHO.
echo ============================================================
echo.
call npm run start:debug
exit /b 0

:semnode
echo O Node.js nao esta instalado neste computador.
echo Instale a versao LTS em https://nodejs.org e tente de novo.
pause
exit /b 1

:erro
echo Deu erro. Copie a mensagem acima e mande pro suporte.
pause
exit /b 1
