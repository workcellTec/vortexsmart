package app.vortexsmart;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.MotionEvent;
import android.view.PixelCopy;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * VortexSmart no Android: uma janela de navegador (WebView) própria que abre o sistema.
 * Tem dados e login separados do Chrome — limpar ou fechar o Chrome não mexe aqui.
 * Como o sistema é carregado do endereço oficial, cada deploy já atualiza o app sozinho.
 */
public class MainActivity extends Activity {

    private static final int PEDIDO_ARQUIVO = 1;
    private static final int PEDIDO_CAMERA = 2;
    private static final int PEDIDO_CAMERA_INICIAL = 3;

    /** Funções que o WebView do Android não tem: baixar blob, compartilhar arquivo, notificar. */
    private static final String JS_PONTE =
        "(function(){if(window.__vsAndroid||!window.VortexAndroid)return;window.__vsAndroid=true;"
        + "function b64(b){return new Promise(function(ok,er){var r=new FileReader();"
        + "r.onload=function(){ok(String(r.result).split(',')[1]||'')};r.onerror=function(){er(r.error)};r.readAsDataURL(b)})}"
        + "function ehLocal(h){return /^(blob:|data:)/.test(h||'')}"
        + "function baixar(a){fetch(a.href).then(function(r){return r.blob()}).then(function(b){return b64(b).then(function(d){"
        + "VortexAndroid.salvarArquivo(d,a.download||'arquivo',b.type||'application/octet-stream')})})"
        + ".catch(function(e){console.error('[apk] falha ao salvar arquivo',e)})}"
        + "var clickOriginal=HTMLAnchorElement.prototype.click;"
        + "HTMLAnchorElement.prototype.click=function(){if(this.hasAttribute('download')&&ehLocal(this.href)){baixar(this);return}"
        + "return clickOriginal.apply(this,arguments)};"
        + "document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[download]');"
        + "if(a&&ehLocal(a.href)){e.preventDefault();e.stopPropagation();baixar(a)}},true);"
        + "navigator.canShare=function(d){return !!d&&((d.files&&d.files.length>0)||!!d.text||!!d.url||!!d.title)};"
        + "navigator.share=function(d){d=d||{};"
        + "var texto=[d.text,d.url].filter(Boolean).join('\\n');"
        + "if(d.files&&d.files.length){var f=d.files[0];"
        + "return b64(f).then(function(x){VortexAndroid.compartilhar(x,f.name||'arquivo',f.type||'application/octet-stream',d.title||'',texto)})}"
        + "VortexAndroid.compartilharTexto(d.title||'',texto);return Promise.resolve()};"
        + "var ultimaCor='';function cor(){var m=document.querySelectorAll('meta[name=\"theme-color\"]');var c=m.length?m[m.length-1].content:'';if(c&&c!==ultimaCor){ultimaCor=c;VortexAndroid.corBarras(c)}}"
        + "cor();new MutationObserver(cor).observe(document.head||document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['content']});"
        + "document.addEventListener('DOMContentLoaded',cor);"
        + "function tela(){var i=['mainMenu','calculatorContainer','documentosContainer','estoqueContainer','vendaContainer','configuracoesContainer','reparosContainer','reposicaoContainer','credscanContainer','financeiroContainer'];"
        + "for(var k=0;k<i.length;k++){var e=document.getElementById(i[k]);if(e&&e.style.display!=='none'&&!e.classList.contains('hidden'))return i[k]}return'?'}"
        + "document.addEventListener('visibilitychange',function(){VortexAndroid.diag('visibilitychange → '+document.visibilityState+' · tela='+tela())});"
        + "})();";

    /** Sonda de estado da página (rodada quando a janela está vazia): o que está de fato à vista, na frente e em animação. */
    private static final String JS_SONDA = "(function(){try{"
        + "var ids=['mainMenu','calculatorContainer','documentosContainer','estoqueContainer','vendaContainer','configuracoesContainer','reparosContainer','reposicaoContainer','credscanContainer','financeiroContainer'];"
        + "var nome=function(e){return e?(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\\s+/).slice(0,3).join('.'):'')):'null'};"
        + "var sec=[];ids.forEach(function(i){var e=document.getElementById(i);if(!e)return;var c=getComputedStyle(e);if(c.display==='none')return;var b=e.getBoundingClientRect();sec.push(i+' op='+c.opacity+' vis='+c.visibility+' '+Math.round(b.width)+'x'+Math.round(b.height)+(e.classList.contains('hidden')?' HIDDEN':''))});"
        + "var cen=document.elementFromPoint(innerWidth/2,innerHeight/2),cad=[];for(var e=cen,n=0;e&&n<4;e=e.parentElement,n++)cad.push(nome(e));"
        + "var fix=[];Array.prototype.forEach.call(document.body.children,function(e){var c=getComputedStyle(e);if(c.display==='none'||c.visibility==='hidden'||+c.opacity===0)return;var b=e.getBoundingClientRect();if(b.width>=innerWidth*0.9&&b.height>=innerHeight*0.9)fix.push(nome(e)+' '+c.position+' bg='+c.backgroundColor+' op='+c.opacity)});"
        + "var an=document.getAnimations().map(function(a){var t=a.effect&&a.effect.target;return a.playState+':'+(t?nome(t):'?')+'@'+Math.round(a.currentTime||0)}).slice(0,6);"
        + "return JSON.stringify({vis:document.visibilityState,secoes:sec,centro:cad,cobrindo:fix,animacoes:an,corpo:getComputedStyle(document.body).opacity+' '+document.body.className,login:(document.getElementById('loginScreen')||{style:{}}).style.display||'-'})"
        + "}catch(e){return 'sonda falhou: '+e}})()";

    private WebView web;
    private String hostApp;
    private ValueCallback<Uri[]> retornoArquivo;
    private PermissionRequest pedidoPermissao;
    private Atualizador atualizador;
    /** Tela pedida por um toque num widget (ex.: "venda:nova"); entregue ao sistema assim que a página carrega. */
    private String destinoPendente;
    // Diagnóstico da tela preta ao voltar do segundo plano (ver DiagTela).
    private long pausadoEm;
    /** Última cor aplicada às barras do sistema (só na thread principal); 0 = nenhuma ainda. */
    private int corAplicada;
    private long voltouEm;
    private boolean aguardandoToque;
    /** true entre onResume e onPause; a ponte (outra thread) lê para saber se a página "oculta" é anormal. */
    private volatile boolean resumido;
    /** Últimos toques que o sistema entregou ao app (antes do WebView), pra comparar com os que a página recebeu. */
    private final java.util.ArrayDeque<String> toquesNativos = new java.util.ArrayDeque<>();
    private long toqueBaixoEm;
    private int webRecebeuDown;      // quantos ACTION_DOWN chegaram em WebView.onTouchEvent (o degrau entre a janela e o Chromium)
    /** Muda a cada volta e a cada saída do app: verificações de tela agendadas numa volta antiga se cancelam sozinhas. */
    private int geracaoTela;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        RelatorioErro.instalar(this);
        // Só na abertura nova: se o sistema está restaurando o app, o extra do intent é de um toque antigo.
        if (estado == null) lerDestino(getIntent());
        DiagTela.registrar(this, "onCreate " + (estado == null ? "abertura nova" : "RESTAURANDO estado salvo (o sistema tinha fechado o app)"));
        // Se o app caiu na vez anterior, mostra o motivo antes de abrir (e deixa abrir de novo se a pessoa quiser).
        String relatorio = RelatorioErro.lerEApagar(this);
        if (relatorio != null) {
            RelatorioErro.mostrar(this, relatorio, () -> iniciar(estado));
            return;
        }
        iniciar(estado);
    }

    /** Monta a tela. Um erro aqui dentro aparece na hora (com o motivo) em vez de derrubar o app. */
    private void iniciar(Bundle estado) {
        try {
            montarTela(estado);
        } catch (Throwable erro) {
            RelatorioErro.guardar(this, erro, "onCreate");
            String relatorio = RelatorioErro.lerEApagar(this);
            RelatorioErro.mostrar(this, relatorio != null ? relatorio : String.valueOf(erro), null);
        }
    }

    private void montarTela(Bundle estado) {
        hostApp = Uri.parse(BuildConfig.START_URL).getHost();
        if (BuildConfig.TESTE) WebView.setWebContentsDebuggingEnabled(true);   // build de teste: o DevTools enxerga a página
        web = new WebView(this) {
            @Override
            public boolean onTouchEvent(MotionEvent ev) {
                if (ev.getActionMasked() == MotionEvent.ACTION_DOWN) webRecebeuDown++;
                return super.onTouchEvent(ev);
            }
        };
        web.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(0xFF141517);
        setContentView(web);

        // Só depois do setContentView: antes disso a janela ainda não tem DecorView e getInsetsController() dá NullPointerException (Android 17).
        String corGuardada = getPreferences(MODE_PRIVATE).getString("corBarras", null);
        if (corGuardada != null) aplicarBarras(corGuardada, false);

        WebSettings cfg = web.getSettings();
        cfg.setJavaScriptEnabled(true);
        cfg.setDomStorageEnabled(true);
        cfg.setDatabaseEnabled(true);
        cfg.setMediaPlaybackRequiresUserGesture(false);
        cfg.setSupportMultipleWindows(true);
        cfg.setJavaScriptCanOpenWindowsAutomatically(true);
        cfg.setAllowFileAccess(false);
        cfg.setAllowContentAccess(false);
        cfg.setBuiltInZoomControls(false);
        cfg.setTextZoom(100);
        cfg.setUserAgentString(cfg.getUserAgentString() + " VortexSmartApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);

        web.addJavascriptInterface(new Ponte(), "VortexAndroid");
        web.setWebViewClient(new ClienteWeb());
        web.setWebChromeClient(new ClienteChrome());
        web.setDownloadListener((url, ua, disp, mime, tam) -> abrirFora(url));

        // Pede a câmera já na 1ª abertura: assim o leitor de código de barras não depende de um pedido no meio do getUserMedia.
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, PEDIDO_CAMERA_INICIAL);
        }

        if (estado != null) web.restoreState(estado);
        else web.loadUrl(BuildConfig.START_URL);

        // Build de teste (emulador): sem janela de atualização por cima da tela.
        if (!BuildConfig.TESTE) {
            atualizador = new Atualizador(this);
            if (estado == null) atualizador.aoAbrir();
        }
        registrarAmbiente();
    }

    /** Uma linha com o que do aparelho costuma interferir em toque/desempenho de WebView: acessibilidade, preenchimento automático, economia de bateria. */
    private void registrarAmbiente() {
        try {
            android.view.accessibility.AccessibilityManager am = (android.view.accessibility.AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
            String servicos = android.provider.Settings.Secure.getString(getContentResolver(), android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            android.view.autofill.AutofillManager af = getSystemService(android.view.autofill.AutofillManager.class);
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
            android.content.pm.PackageInfo wv = WebView.getCurrentWebViewPackage();
            DiagTela.registrar(this, "ambiente: acessibilidade=" + (am != null && am.isEnabled()) + " exploração por toque=" + (am != null && am.isTouchExplorationEnabled())
                + " serviços=" + (servicos == null ? "nenhum" : servicos) + " · autofill=" + (af != null && af.isEnabled())
                + " · economia de bateria=" + pm.isPowerSaveMode() + " · WebView " + (wv != null ? wv.packageName + " " + wv.versionName : "?")
                + " · tela " + getWindowManager().getDefaultDisplay().getRefreshRate() + " Hz");
        } catch (Throwable erro) {
            DiagTela.registrar(this, "ambiente: não deu pra ler (" + erro + ")");
        }
    }

    // ── Widgets: abrir o app direto numa tela ─────────────────────

    /** Guarda a tela pedida pelo widget e tira o extra do intent, pra não repetir se a Activity for recriada. */
    private void lerDestino(Intent it) {
        if (it == null) return;
        String destino = it.getStringExtra("destino");
        if (destino == null) return;
        it.removeExtra("destino");
        destinoPendente = destino;
    }

    /** Pede ao sistema pra abrir a tela. Se ele ainda estiver carregando (login, scripts), tenta de novo por até ~20 s. */
    private void entregarDestino() {
        if (destinoPendente == null || web == null) return;
        String destino = JSONObject.quote(destinoPendente);
        destinoPendente = null;
        web.evaluateJavascript("(function(d){var n=0;(function t(){if(window._vsAbrirDestino)window._vsAbrirDestino(d);"
            + "else if(n++<40)setTimeout(t,500)})()})(" + destino + ")", null);
    }

    /** Com o app já aberto, o toque no widget chega aqui (launchMode singleTask) em vez de abrir uma segunda janela. */
    @Override
    protected void onNewIntent(Intent it) {
        super.onNewIntent(it);
        setIntent(it);
        lerDestino(it);
        entregarDestino();
    }

    @Override
    protected void onSaveInstanceState(Bundle saida) {
        super.onSaveInstanceState(saida);
        if (web != null) web.saveState(saida);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumido = true;
        DiagTela.registrar(this, "onResume" + (pausadoEm > 0 ? " (fora da tela há " + (SystemClock.elapsedRealtime() - pausadoEm) / 1000 + " s)" : ""));
        if (web != null) {
            web.onResume();
            web.resumeTimers();
            sondar();
            verificarTela(1, ++geracaoTela);
        }
        if (atualizador != null) atualizador.aoVoltar();
    }

    @Override
    protected void onStart() {
        super.onStart();
        DiagTela.registrar(this, "onStart");
    }

    @Override
    protected void onStop() {
        DiagTela.registrar(this, "onStop");
        super.onStop();
    }

    @Override
    public void onTrimMemory(int nivel) {
        super.onTrimMemory(nivel);
        DiagTela.registrar(this, "onTrimMemory nível " + nivel);
    }

    @Override
    public void onTopResumedActivityChanged(boolean noTopo) {
        super.onTopResumedActivityChanged(noTopo);
        DiagTela.registrar(this, "activity no topo: " + noTopo);
    }

    @Override
    public void onWindowFocusChanged(boolean temFoco) {
        super.onWindowFocusChanged(temFoco);
        DiagTela.registrar(this, "foco da janela: " + temFoco);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (aguardandoToque && ev.getActionMasked() == MotionEvent.ACTION_DOWN) {
            aguardandoToque = false;
            DiagTela.registrar(this, "1º toque, " + (SystemClock.elapsedRealtime() - voltouEm) + " ms depois do onResume");
        }
        int antes = webRecebeuDown;
        boolean tratou = super.dispatchTouchEvent(ev);
        anotarToqueNativo(ev, tratou, webRecebeuDown != antes);
        return tratou;
    }

    /**
     * Guarda (60 linhas) cada dedo que desce/sobe/é cancelado, em dp (= px do CSS da página), com a hora e, na descida,
     * se alguém na janela aceitou o toque (true = o WebView tratou; false = ninguém quis, e a página não recebe nada) e
     * se o toque chegou a WebView.onTouchEvent (se não chegou, o sumiço é entre a janela e o WebView; se chegou, é dentro do Chromium).
     */
    private void anotarToqueNativo(MotionEvent ev, boolean tratou, boolean chegouNoWebView) {
        int acao = ev.getActionMasked();
        if (acao != MotionEvent.ACTION_DOWN && acao != MotionEvent.ACTION_UP && acao != MotionEvent.ACTION_CANCEL) return;
        float d = getResources().getDisplayMetrics().density;
        String hora = new java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US).format(new java.util.Date());
        String linha;
        if (acao == MotionEvent.ACTION_DOWN) {
            toqueBaixoEm = ev.getEventTime();
            linha = hora + "  dedo desceu em " + Math.round(ev.getX() / d) + "," + Math.round(ev.getY() / d)
                + " · " + (tratou ? "aceito" : "NÃO ACEITO pela janela") + " · " + (chegouNoWebView ? "WebView.onTouchEvent recebeu" : "WebView.onTouchEvent NÃO recebeu") + " · foco do WebView=" + (web != null && web.hasFocus())
                + " · flags=0x" + Integer.toHexString(ev.getFlags()) + " (1=janela coberta por outra, 2=coberta em parte)"
                + " · tamanho do toque=" + String.format(java.util.Locale.US, "%.2f", ev.getSize());
        } else {
            linha = hora + "  dedo " + (acao == MotionEvent.ACTION_UP ? "subiu" : "CANCELADO") + " após " + (ev.getEventTime() - toqueBaixoEm) + " ms";
        }
        synchronized (toquesNativos) {
            toquesNativos.addLast(linha);
            if (toquesNativos.size() > 60) toquesNativos.removeFirst();
        }
    }

    /**
     * Ao voltar do segundo plano, anota o que o WebView e a página estão fazendo: o JS responde? A página acha que está
     * visível? Um quadro (requestAnimationFrame) é desenhado antes do toque? Com isso dá pra separar "página morta" de
     * "página viva que o sistema só não desenhou".
     */
    private void sondar() {
        final long inicio = SystemClock.elapsedRealtime();
        voltouEm = inicio;
        aguardandoToque = true;
        final boolean[] respondeu = {false};
        DiagTela.registrar(this, "webview " + web.getWidth() + "x" + web.getHeight() + " visível=" + web.isShown() + " foco=" + hasWindowFocus());
        android.app.ActivityManager.MemoryInfo mem = new android.app.ActivityManager.MemoryInfo();
        ((android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE)).getMemoryInfo(mem);
        DiagTela.registrar(this, "memória do aparelho: livre " + mem.availMem / 1048576 + " MB de " + mem.totalMem / 1048576 + " MB, pouca memória=" + mem.lowMemory
            + " · app usa " + ((android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE)).getProcessMemoryInfo(new int[]{android.os.Process.myPid()})[0].getTotalPss() / 1024 + " MB");
        web.evaluateJavascript("(function(){var t=Date.now(),ok=false;"
            + "requestAnimationFrame(function(){ok=true;VortexAndroid.diag('quadro desenhado '+(Date.now()-t)+' ms depois')});"
            + "setTimeout(function(){if(!ok)VortexAndroid.diag('NENHUM quadro desenhado em 2 s')},2000);"
            + "return document.visibilityState+' hidden='+document.hidden})()", resultado -> {
                respondeu[0] = true;
                DiagTela.registrar(this, "JS respondeu em " + (SystemClock.elapsedRealtime() - inicio) + " ms: " + resultado);
            });
        web.postDelayed(() -> { if (!respondeu[0]) DiagTela.registrar(this, "JS SEM resposta em 2 s"); }, 2000);
    }

    // ── Tela preta ao voltar do segundo plano ─────────────────────
    // O registro de diagnóstico mostrou que, nas voltas com tela escura, o JS responde em ms e a página desenha quadros
    // (requestAnimationFrame) antes do 1º toque: a página está viva, o que falta é o WebView aparecer na janela.
    // Por isso olhamos o que a JANELA realmente mostra (PixelCopy) e, se estiver vazia, "cutucamos" o WebView em degraus
    // cada vez mais fortes, registrando qual degrau resolveu.

    /**
     * A página avisou "hidden" mas a Activity está em primeiro plano. Registra o estado nativo, pergunta à página se
     * continua oculta e, se sim, empurra o WebView de volta (onResume/resumeTimers, depois INVISIBLE→VISIBLE).
     */
    private void paginaOcultaComAppAberto(final int geracao, final int degrau) {
        if (web == null || geracao != geracaoTela || !resumido || isFinishing() || isDestroyed()) return;
        web.postDelayed(() -> {
            if (web == null || geracao != geracaoTela || !resumido) return;
            DiagTela.registrar(this, "oculta com app aberto (degrau " + degrau + "): web.visibility=" + web.getVisibility()
                + " isShown=" + web.isShown() + " janela.visivel=" + web.getWindowVisibility()
                + " foco=" + hasWindowFocus() + " multijanela=" + isInMultiWindowMode()
                + " pip=" + isInPictureInPictureMode());
            web.evaluateJavascript("document.visibilityState", valor -> {
                if (web == null || geracao != geracaoTela || !resumido) return;
                boolean aindaOculta = valor != null && valor.contains("hidden");
                DiagTela.registrar(this, "oculta com app aberto: visibilityState agora = " + valor);
                if (!aindaOculta || degrau >= 2) return;
                web.onResume();
                web.resumeTimers();
                cutucarWebView(3);   // INVISIBLE→VISIBLE devolve a visibilidade ao WebView
                paginaOcultaComAppAberto(geracao, degrau + 1);
            });
        }, 300);
    }

    /** 350 ms (depois 600 ms) após a volta, confere se a janela tem conteúdo; se estiver vazia, aplica o próximo ajuste. */
    private void verificarTela(int tentativa, int geracao) {
        if (web == null) return;
        web.postDelayed(() -> {
            if (web == null || geracao != geracaoTela || isFinishing() || isDestroyed()) return;
            final Bitmap amostra = Bitmap.createBitmap(48, 96, Bitmap.Config.ARGB_8888);
            try {
                PixelCopy.request(getWindow(), amostra, copia -> {
                    if (web == null || geracao != geracaoTela) return;
                    if (copia != PixelCopy.SUCCESS) {
                        DiagTela.registrar(this, "tela (verificação " + tentativa + "): cópia falhou, código " + copia);
                        return;
                    }
                    double diferentes = fracaoDiferenteDoFundo(amostra);
                    boolean vazia = diferentes < 0.015;
                    DiagTela.registrar(this, "tela (verificação " + tentativa + "): " + (vazia ? "VAZIA" : "com conteúdo")
                        + ", " + Math.round(diferentes * 1000) / 10.0 + "% dos pontos diferentes do fundo");
                    if (!vazia) return;
                    if (tentativa == 1 || tentativa > 3) detalharTelaVazia(amostra);
                    if (tentativa > 3) {
                        DiagTela.registrar(this, "tela continua vazia depois dos 3 ajustes");
                        return;
                    }
                    cutucarWebView(tentativa);
                    verificarTela(tentativa + 1, geracao);
                }, new Handler(Looper.getMainLooper()));
            } catch (IllegalArgumentException e) {
                DiagTela.registrar(this, "tela (verificação " + tentativa + "): a janela recusou a cópia: " + e.getMessage());
            }
        }, tentativa == 1 ? 350 : 600);
    }

    /** Quando a janela está vazia: de que cor ela está e se o WebView, desenhado direto num Bitmap, tem conteúdo (separa "a página está em branco" de "a página não está sendo mostrada"). */
    private void detalharTelaVazia(Bitmap amostra) {
        DiagTela.registrar(this, String.format("tela vazia: cor da janela #%06X (fundo nativo do WebView #%06X)", amostra.getPixel(1, amostra.getHeight() / 2) & 0xFFFFFF, 0x141517));
        DiagTela.registrar(this, "tela vazia: WebView alpha=" + web.getAlpha() + " visibilidade=" + web.getVisibility() + " janela=" + web.getWindowVisibility()
            + " hardware=" + web.isHardwareAccelerated() + " camada=" + web.getLayerType() + " " + web.getWidth() + "x" + web.getHeight());
        web.evaluateJavascript(JS_SONDA, valor -> DiagTela.registrar(this, "tela vazia: página = " + (valor == null ? "sem resposta" : valor.length() > 1200 ? valor.substring(0, 1200) + "…" : valor)));
        try {
            int w = web.getWidth(), h = web.getHeight();
            if (w <= 0 || h <= 0) return;
            Bitmap direto = Bitmap.createBitmap(48, 96, Bitmap.Config.ARGB_8888);
            Canvas tela = new Canvas(direto);
            tela.scale(48f / w, 96f / h);
            web.draw(tela);
            double d = fracaoDiferenteDoFundo(direto);
            DiagTela.registrar(this, "tela vazia: desenho direto do WebView " + (d < 0.015 ? "TAMBÉM VAZIO" : "COM conteúdo") + ", " + Math.round(d * 1000) / 10.0 + "%");
        } catch (RuntimeException e) {
            DiagTela.registrar(this, "tela vazia: desenho direto falhou: " + e);
        }
    }

    /** Parte dos pontos da amostra (sem o topo e o rodapé, onde ficam as barras do sistema) que difere do ponto de referência. */
    private static double fracaoDiferenteDoFundo(Bitmap b) {
        int ref = b.getPixel(1, b.getHeight() / 2);
        int diferentes = 0, total = 0;
        for (int y = b.getHeight() / 10; y < b.getHeight() * 9 / 10; y++) {
            for (int x = 0; x < b.getWidth(); x++) {
                int c = b.getPixel(x, y);
                int d = Math.abs(Color.red(c) - Color.red(ref)) + Math.abs(Color.green(c) - Color.green(ref)) + Math.abs(Color.blue(c) - Color.blue(ref));
                if (d > 12) diferentes++;
                total++;
            }
        }
        return total == 0 ? 1 : diferentes / (double) total;
    }

    /** Degrau 1: toque de mentira (o único gesto que já fez a tela aparecer). 2: nova medição, foco e um toque quase invisível de transparência. 3: tira e recoloca o WebView. */
    private void cutucarWebView(int degrau) {
        if (web == null) return;
        if (degrau == 1) {
            DiagTela.registrar(this, "ajuste 1: toque sintético (DOWN + CANCEL no canto)");
            long t = SystemClock.uptimeMillis();
            MotionEvent baixo = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, 1f, 1f, 0);
            web.dispatchTouchEvent(baixo);
            baixo.recycle();
            MotionEvent cancela = MotionEvent.obtain(t, SystemClock.uptimeMillis(), MotionEvent.ACTION_CANCEL, 1f, 1f, 0);
            web.dispatchTouchEvent(cancela);
            cancela.recycle();
        } else if (degrau == 2) {
            DiagTela.registrar(this, "ajuste 2: foco + nova medição + transparência 0,99");
            web.requestFocus();
            web.requestLayout();
            web.invalidate();
            web.setAlpha(0.99f);
            web.postDelayed(() -> { if (web != null) web.setAlpha(1f); }, 80);
        } else {
            DiagTela.registrar(this, "ajuste 3: WebView invisível e visível de novo");
            web.setVisibility(View.INVISIBLE);
            web.postDelayed(() -> { if (web != null) web.setVisibility(View.VISIBLE); }, 80);
        }
    }

    @Override
    protected void onPause() {
        resumido = false;
        pausadoEm = SystemClock.elapsedRealtime();
        geracaoTela++;   // cancela verificações de tela agendadas
        DiagTela.registrar(this, "onPause");
        if (web != null) {
            CookieManager.getInstance().flush();
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ── Barras do sistema ─────────────────────────────────────────

    /** Pinta barra de status e de navegação com a cor do tema do sistema (meta theme-color) e ajusta os ícones. */
    @SuppressWarnings("deprecation")
    private void aplicarBarras(String hex, boolean guardar) {
        int cor;
        try { cor = Color.parseColor(hex.trim()); } catch (IllegalArgumentException e) { return; }
        cor |= 0xFF000000;
        if (cor == corAplicada) return;   // mesma cor: não mexe na janela (cada ajuste de barra é uma ida ao sistema e pode refazer a medição)
        corAplicada = cor;
        getWindow().setStatusBarColor(cor);
        getWindow().setNavigationBarColor(cor);
        boolean claro = (0.299 * Color.red(cor) + 0.587 * Color.green(cor) + 0.114 * Color.blue(cor)) > 160;
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int mascara = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(claro ? mascara : 0, mascara);
            }
        } else {
            View d = getWindow().getDecorView();
            int f = d.getSystemUiVisibility();
            int mascara = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            d.setSystemUiVisibility(claro ? (f | mascara) : (f & ~mascara));
        }
        if (guardar) getPreferences(MODE_PRIVATE).edit().putString("corBarras", hex).apply();
    }

    // ── Navegação ─────────────────────────────────────────────────

    private boolean ehDoApp(Uri uri) {
        if (uri == null) return false;
        String esq = uri.getScheme();
        if ("file".equals(esq) && uri.toString().startsWith("file:///android_asset/")) return true;
        return ("https".equals(esq) || "http".equals(esq)) && hostApp != null && hostApp.equalsIgnoreCase(uri.getHost());
    }

    private void abrirFora(String url) {
        try {
            Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            it.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(it);
        } catch (ActivityNotFoundException | SecurityException e) {
            Toast.makeText(this, "Não há app para abrir este link.", Toast.LENGTH_SHORT).show();
        }
    }

    private class ClienteWeb extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            Uri uri = req.getUrl();
            if (ehDoApp(uri)) return false;
            abrirFora(uri.toString());
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, Bitmap icone) {
            v.evaluateJavascript(JS_PONTE, null);
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            v.evaluateJavascript(JS_PONTE, null);
            entregarDestino();
        }

        @Override
        public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail detalhe) {
            DiagTela.registrar(MainActivity.this, "PROCESSO DO WEBVIEW MORREU (didCrash=" + detalhe.didCrash() + "; false = o sistema matou por falta de memória)");
            return false;
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError erro) {
            if (req.isForMainFrame()) v.loadUrl("file:///android_asset/offline.html");
        }
    }

    private class ClienteChrome extends WebChromeClient {
        // window.open / target=_blank (WhatsApp, fotos, links): abre no app certo do aparelho.
        @Override
        public boolean onCreateWindow(WebView v, boolean dialogo, boolean gesto, Message msg) {
            WebView temp = new WebView(MainActivity.this);
            temp.setWebViewClient(new WebViewClient() {
                private boolean tratou;
                private void tratar(WebView w, String url) {
                    if (tratou || url == null || url.equals("about:blank")) return;
                    tratou = true;
                    abrirFora(url);
                    w.stopLoading();
                    w.destroy();
                }
                @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r) { tratar(w, r.getUrl().toString()); return true; }
                @Override public void onPageStarted(WebView w, String url, Bitmap ic) { tratar(w, url); }
            });
            ((WebView.WebViewTransport) msg.obj).setWebView(temp);
            msg.sendToTarget();
            return true;
        }

        // Sem isso o WebView desenha um ícone de "play" gigante no lugar do vídeo enquanto a câmera abre.
        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }

        // Câmera (leitor de código de barras): só pro endereço do próprio sistema.
        @Override
        public void onPermissionRequest(PermissionRequest req) {
            if (!ehDoApp(req.getOrigin())) { req.deny(); return; }
            List<String> ok = new ArrayList<>();
            for (String r : req.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) ok.add(r);
            if (ok.isEmpty()) { req.deny(); return; }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                req.grant(ok.toArray(new String[0]));
            } else {
                if (pedidoPermissao != null) pedidoPermissao.deny();
                pedidoPermissao = req;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, PEDIDO_CAMERA);
            }
        }

        // Escolher foto/arquivo (logo da loja, fotos do concerto etc.).
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> retorno, FileChooserParams params) {
            if (retornoArquivo != null) retornoArquivo.onReceiveValue(null);
            retornoArquivo = retorno;
            try {
                startActivityForResult(params.createIntent(), PEDIDO_ARQUIVO);
            } catch (ActivityNotFoundException e) {
                retornoArquivo = null;
                Toast.makeText(MainActivity.this, "Não foi possível abrir o seletor de arquivos.", Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int pedido, int resultado, Intent dados) {
        super.onActivityResult(pedido, resultado, dados);
        if (pedido != PEDIDO_ARQUIVO || retornoArquivo == null) return;
        retornoArquivo.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultado, dados));
        retornoArquivo = null;
    }

    @Override
    public void onRequestPermissionsResult(int pedido, String[] perms, int[] res) {
        super.onRequestPermissionsResult(pedido, perms, res);
        if (pedido != PEDIDO_CAMERA && pedido != PEDIDO_CAMERA_INICIAL) return;
        if (res.length == 0) return; // pedido cancelado por outro que já estava na tela: o resultado de verdade vem depois
        boolean ok = res[0] == PackageManager.PERMISSION_GRANTED;
        if (!ok) Toast.makeText(this, "Câmera bloqueada. Ative em Configurações do Android › Apps › VortexSmart › Permissões.", Toast.LENGTH_LONG).show();
        if (pedidoPermissao == null) return;
        PermissionRequest req = pedidoPermissao;
        pedidoPermissao = null;
        if (ok) req.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else req.deny();
    }

    // ── Ponte JS ↔ Android ────────────────────────────────────────

    private static String nomeSeguro(String nome) {
        String n = nome == null ? "" : nome.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return n.isEmpty() ? "arquivo" : n;
    }

    private class Ponte {
        // Widgets: o sistema manda o resumo do dia (já calculado) e os widgets só desenham.
        @JavascriptInterface
        public void salvarResumo(String json) {
            if (WidgetsDados.salvarResumo(MainActivity.this, json)) WidgetBase.atualizarTodos(MainActivity.this);
        }

        // Diagnóstico da tela: a página avisa eventos (visibilidade, quadro desenhado) e o relatório lê tudo de volta.
        @JavascriptInterface
        public void diag(String mensagem) {
            String m = mensagem == null ? "" : mensagem.substring(0, Math.min(mensagem.length(), 200));
            DiagTela.registrar(MainActivity.this, "página: " + m);
            // Página "oculta" com o app aberto na frente = anormal (o WebView para de desenhar e os botões parecem mortos).
            if (resumido && m.startsWith("visibilitychange → hidden")) {
                final int geracao = geracaoTela;
                runOnUiThread(() -> paginaOcultaComAppAberto(geracao, 1));
            }
        }

        @JavascriptInterface
        public String lerToquesNativos() {
            synchronized (toquesNativos) {
                return android.text.TextUtils.join("\n", toquesNativos);
            }
        }

        // Rastro interno do WebView (o que o Chromium faz com cada toque). Começar/parar rodam na thread da tela, como o WebView exige.
        @JavascriptInterface
        public String rastroIniciar(String categorias) {
            runOnUiThread(() -> RastroToque.iniciar(MainActivity.this, categorias));
            return "iniciando";
        }

        @JavascriptInterface
        public String rastroParar() {
            runOnUiThread(() -> RastroToque.parar(MainActivity.this));
            return "parando";
        }

        @JavascriptInterface
        public String rastroEstado() {
            return RastroToque.estado();
        }

        @JavascriptInterface
        public String rastroLer() {
            return RastroToque.ler(MainActivity.this);
        }

        @JavascriptInterface
        public String lerDiagnosticoTela() {
            return DiagTela.ler(MainActivity.this);
        }

        @JavascriptInterface
        public void limparResumo() {
            WidgetsDados.limpar(MainActivity.this);
            WidgetBase.atualizarTodos(MainActivity.this);
        }

        @JavascriptInterface
        public boolean widgetsValoresVisiveis() {
            return WidgetsDados.valoresVisiveis(MainActivity.this);
        }

        @JavascriptInterface
        public void widgetsMostrarValores(boolean visiveis) {
            WidgetsDados.definirValoresVisiveis(MainActivity.this, visiveis);
            WidgetBase.atualizarTodos(MainActivity.this);
        }

        @JavascriptInterface
        public void corBarras(String hex) {
            runOnUiThread(() -> aplicarBarras(hex, true));
        }

        @JavascriptInterface
        public void recarregar() {
            runOnUiThread(() -> web.loadUrl(BuildConfig.START_URL));
        }

        // Baixar PDF/imagem gerados pelo sistema → pasta Downloads.
        @JavascriptInterface
        public void salvarArquivo(String base64, String nome, String mime) {
            final String arquivo = nomeSeguro(nome);
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                ContentResolver cr = getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, arquivo);
                v.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("MediaStore recusou");
                try (OutputStream out = cr.openOutputStream(uri)) { out.write(bytes); }
                v.clear();
                v.put(MediaStore.Downloads.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Salvo em Downloads: " + arquivo, Toast.LENGTH_LONG).show());
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Não foi possível salvar o arquivo.", Toast.LENGTH_LONG).show());
            }
        }

        // Compartilhar PDF/imagem (WhatsApp etc.): equivale ao navigator.share do Chrome.
        @JavascriptInterface
        public void compartilhar(String base64, String nome, String mime, String titulo, String texto) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                File pasta = new File(getCacheDir(), "compartilhar");
                if (!pasta.exists() && !pasta.mkdirs()) throw new IllegalStateException("sem pasta");
                File[] velhos = pasta.listFiles();
                if (velhos != null) for (File f : velhos) //noinspection ResultOfMethodCallIgnored
                    f.delete();
                File arq = new File(pasta, nomeSeguro(nome));
                try (FileOutputStream out = new FileOutputStream(arq)) { out.write(bytes); }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".arquivos", arq);
                Intent it = new Intent(Intent.ACTION_SEND);
                it.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                it.putExtra(Intent.EXTRA_STREAM, uri);
                if (titulo != null && !titulo.isEmpty()) it.putExtra(Intent.EXTRA_SUBJECT, titulo);
                if (texto != null && !texto.isEmpty()) it.putExtra(Intent.EXTRA_TEXT, texto);
                it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(it, "Compartilhar")));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Não foi possível compartilhar o arquivo.", Toast.LENGTH_LONG).show());
            }
        }

        @JavascriptInterface
        public void compartilharTexto(String titulo, String texto) {
            Intent it = new Intent(Intent.ACTION_SEND);
            it.setType("text/plain");
            if (titulo != null && !titulo.isEmpty()) it.putExtra(Intent.EXTRA_SUBJECT, titulo);
            it.putExtra(Intent.EXTRA_TEXT, texto == null ? "" : texto);
            runOnUiThread(() -> startActivity(Intent.createChooser(it, "Compartilhar")));
        }
    }
}
