package app.vortexsmart;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.MotionEvent;
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
        + "function cor(){var m=document.querySelectorAll('meta[name=\"theme-color\"]');var c=m.length?m[m.length-1].content:'';if(c)VortexAndroid.corBarras(c)}"
        + "cor();new MutationObserver(cor).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['content']});"
        + "document.addEventListener('DOMContentLoaded',cor);"
        + "document.addEventListener('visibilitychange',function(){VortexAndroid.diag('visibilitychange → '+document.visibilityState)});"
        + "})();";

    private WebView web;
    private String hostApp;
    private ValueCallback<Uri[]> retornoArquivo;
    private PermissionRequest pedidoPermissao;
    private Atualizador atualizador;
    /** Tela pedida por um toque num widget (ex.: "venda:nova"); entregue ao sistema assim que a página carrega. */
    private String destinoPendente;
    // Diagnóstico da tela preta ao voltar do segundo plano (ver DiagTela).
    private long pausadoEm;
    private long voltouEm;
    private boolean aguardandoToque;

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
        web = new WebView(this);
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

        atualizador = new Atualizador(this);
        if (estado == null) atualizador.aoAbrir();
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
        DiagTela.registrar(this, "onResume" + (pausadoEm > 0 ? " (fora da tela há " + (SystemClock.elapsedRealtime() - pausadoEm) / 1000 + " s)" : ""));
        if (web != null) {
            web.onResume();
            web.resumeTimers();
            repintar();
            sondar();
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
    public void onWindowFocusChanged(boolean temFoco) {
        super.onWindowFocusChanged(temFoco);
        DiagTela.registrar(this, "foco da janela: " + temFoco);
        if (temFoco) repintar();
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (aguardandoToque && ev.getActionMasked() == MotionEvent.ACTION_DOWN) {
            aguardandoToque = false;
            DiagTela.registrar(this, "1º toque, " + (SystemClock.elapsedRealtime() - voltouEm) + " ms depois do onResume");
        }
        return super.dispatchTouchEvent(ev);
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
        web.evaluateJavascript("(function(){var t=Date.now(),ok=false;"
            + "requestAnimationFrame(function(){ok=true;VortexAndroid.diag('quadro desenhado '+(Date.now()-t)+' ms depois')});"
            + "setTimeout(function(){if(!ok)VortexAndroid.diag('NENHUM quadro desenhado em 2 s')},2000);"
            + "return document.visibilityState+' hidden='+document.hidden})()", resultado -> {
                respondeu[0] = true;
                DiagTela.registrar(this, "JS respondeu em " + (SystemClock.elapsedRealtime() - inicio) + " ms: " + resultado);
            });
        web.postDelayed(() -> { if (!respondeu[0]) DiagTela.registrar(this, "JS SEM resposta em 2 s"); }, 2000);
    }

    /** Ao voltar do segundo plano o WebView às vezes continua sem desenhar (tela preta) até o primeiro toque: força o redesenho. */
    private void repintar() {
        if (web == null) return;
        web.requestLayout();
        web.invalidate();
        web.postDelayed(() -> { if (web != null) { web.requestLayout(); web.invalidate(); } }, 250);
    }

    @Override
    protected void onPause() {
        pausadoEm = SystemClock.elapsedRealtime();
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
            DiagTela.registrar(MainActivity.this, "página: " + (mensagem == null ? "" : mensagem.substring(0, Math.min(mensagem.length(), 200))));
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
