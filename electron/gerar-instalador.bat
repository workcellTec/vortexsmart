@echo off
cd /d "%~dp0"
echo ============================================================
echo   VortexSmart PDV - gerando o instalador do Windows
echo   (a primeira vez demora alguns minutos: baixa o Electron)
echo ============================================================
echo.

where npm >nul 2>nul
if errorlevel 1 goto semnode

call npm install
if errorlevel 1 goto erro

call npm run dist
if errorlevel 1 (
  echo.
  echo A geracao completa falhou ^(comum no Windows sem permissao de administrador^).
  echo Tentando o modo simples ^(o programa funciona igual; so o icone do .exe fica o padrao^)...
  echo.
  call npm run dist:simples
  if errorlevel 1 goto erro
)

set "INSTALADOR=%~dp0dist\VortexSmart-PDV-Setup-1.0.0.exe"
if not exist "%INSTALADOR%" goto semarquivo

set "AREA="
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do set "AREA=%%D"
if defined AREA copy /y "%INSTALADOR%" "%AREA%\" >nul

echo.
echo ============================================================
echo   PRONTO! O instalador foi criado em:
echo   %INSTALADOR%
if defined AREA echo   Copiei tambem para a sua Area de Trabalho.
echo   E ESSE arquivo que voce leva para as lojas.
echo ============================================================
explorer /select,"%INSTALADOR%"
pause
exit /b 0

:semarquivo
echo.
echo ============================================================
echo   A geracao terminou, mas NAO encontrei o instalador em:
echo   %~dp0dist
echo   Estes sao os arquivos que existem nessa pasta:
echo.
dir /b "%~dp0dist"
echo ============================================================
pause
exit /b 1

:semnode
echo ============================================================
echo   O Node.js ^(npm^) NAO esta instalado neste computador.
echo.
echo   Este arquivo serve SO para GERAR o instalador, e isso so
echo   se faz no computador do desenvolvedor.
echo.
echo   * Se voce esta numa LOJA ou no computador de um cliente:
echo     NAO use este arquivo. Use o instalador que ja foi gerado:
echo         VortexSmart-PDV-Setup-1.0.0.exe
echo     Ele instala sozinho e NAO precisa de Node nem de npm.
echo.
echo   * Se voce quer GERAR o instalador neste computador:
echo     1^) Instale o Node.js ^(versao LTS^) em https://nodejs.org
echo     2^) Feche esta janela e de dois cliques neste arquivo de novo.
echo ============================================================
pause
exit /b 1

:erro
echo.
echo ============================================================
echo   DEU ERRO. Copie a mensagem que apareceu acima e mande pro suporte.
echo   Dica: clique com o botao direito neste arquivo e escolha
echo   "Executar como administrador".
echo ============================================================
pause
exit /b 1
