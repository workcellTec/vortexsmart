@echo off
title VortexSmart - juntar resultado
cd /d "%~dp0"
set "SAIDA=%USERPROFILE%\Desktop\resultado-teste-impressao"
if exist "%SAIDA%" rmdir /s /q "%SAIDA%"
mkdir "%SAIDA%"
copy /y "C:\VortexTeste\*.prn" "%SAIDA%" >nul 2>&1
powershell -NoProfile -Command "Get-Printer | Format-Table Name,ShareName,DriverName,PortName,PrinterStatus -AutoSize | Out-String -Width 250 | Set-Content -Encoding UTF8 '%SAIDA%\impressoras.txt'"
powershell -NoProfile -Command "Compress-Archive -Path '%SAIDA%\*' -DestinationPath '%USERPROFILE%\Desktop\resultado-teste-impressao.zip' -Force"
echo.
dir /b "%SAIDA%"
echo.
echo Pronto: o arquivo resultado-teste-impressao.zip esta na sua Area de Trabalho. Mande ele.
echo.
pause
