#!/usr/bin/env bash
# Roda DENTRO do emulador (chamado pelo workflow .github/workflows/emulador.yml): sobe o servidor de teste, instala o APK de
# teste, abre o app, executa o roteiro de toques e guarda tudo em resultado/ (vídeo, logcat, relatórios do app, prints).
set -u
SAIDA="$PWD/resultado"; mkdir -p "$SAIDA"

{
  echo "Android: $(adb shell getprop ro.build.version.release) (API $(adb shell getprop ro.build.version.sdk))"
  echo "Aparelho: $(adb shell getprop ro.product.model)  tela: $(adb shell wm size | tail -1)  densidade: $(adb shell wm density | tail -1)"
  adb shell dumpsys webviewupdate | grep -iE "current|package|version" | head -8
} > "$SAIDA/aparelho.txt" 2>&1

node teste-emulador/servidor.js > "$SAIDA/servidor.log" 2>&1 &
sleep 1

adb logcat -c
adb logcat -v time > "$SAIDA/logcat.txt" 2>&1 &
adb shell screenrecord --time-limit 170 /sdcard/roteiro.mp4 > /dev/null 2>&1 &

adb install -g -r apk/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.vortexsmart.beta/app.vortexsmart.MainActivity
sleep 15

SAIDA="$SAIDA" node teste-emulador/roteiro.js
CODIGO=$?

adb shell pkill -2 screenrecord
sleep 3
adb pull /sdcard/roteiro.mp4 "$SAIDA/" || true
echo "roteiro terminou com código $CODIGO"

# Os arquivos de resultado também vão pro log da execução (o log dá pra ler pela API do GitHub; os artefatos nem sempre).
mostrar() { [ -s "$2" ] && { echo "::group::$1"; cat "$2"; echo "::endgroup::"; }; }
mostrar "aparelho" "$SAIDA/aparelho.txt"
mostrar "servidor de teste" "$SAIDA/servidor.log"
echo "::group::logcat (WebView, rede, app)"
grep -iE "chromium|cleartext|net::|ERR_|vortexsmart|AndroidRuntime|FATAL" "$SAIDA/logcat.txt" | tail -80
echo "::endgroup::"
mostrar "roteiro" "$SAIDA/roteiro.txt"
mostrar "diagnóstico do app (seção 7)" "$SAIDA/diagnostico-android.txt"
mostrar "toques que o Android entregou (seção 9)" "$SAIDA/toques-do-android.txt"
mostrar "toques que chegaram na página (seção 8)" "$SAIDA/toques-da-pagina.txt"
exit 0
