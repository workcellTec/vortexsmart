package app.vortexsmart;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Atualização do próprio APK sem Play Store.
 * O workflow "Gerar APK" publica, junto do APK, um apk-versao.json (versão, novidades, tamanho, SHA-256, obrigatória).
 * Ao abrir o app (e ao voltar, no máximo a cada 6 h) ele é consultado; havendo versão maior, pergunta, baixa,
 * confere o SHA-256 e abre o instalador do Android. A assinatura é conferida pelo próprio Android: só aceita
 * atualização assinada com a mesma chave do app instalado.
 */
final class Atualizador {

    private static final String BASE = "https://github.com/workcellTec/vortexsmart/releases/download/apk-latest/";
    private static final String URL_VERSAO = BASE + "apk-versao.json";
    private static final String URL_APK = BASE + "VortexSmart.apk";
    private static final long INTERVALO_MS = 6L * 60 * 60 * 1000;
    private static final String PREFS = "atualizador";
    private static final String PREF_ULTIMA = "ultimaChecagem";
    private static final String TAG = "Atualizador";

    private final Activity act;
    private final SharedPreferences prefs;
    private final File pasta;

    private JSONObject nova;            // versão mais recente encontrada (maior que a instalada)
    private File apkBaixado;            // APK já baixado e conferido
    private boolean aguardandoPermissao; // usuário foi liberar "Instalar apps desconhecidos"
    private boolean baixando;
    private volatile boolean cancelado;
    private AlertDialog dialogo;

    Atualizador(Activity act) {
        this.act = act;
        this.prefs = act.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.pasta = new File(act.getCacheDir(), "atualizacao");
        limparPasta(); // sobras de uma atualização anterior (o APK velho já cumpriu o papel)
    }

    /** Abertura do app: sempre consulta e, havendo versão nova, mostra o aviso. */
    void aoAbrir() {
        verificar(true);
    }

    /** Volta do segundo plano: continua o que estava pendente; senão consulta se já faz mais de 6 h. */
    void aoVoltar() {
        if (aguardandoPermissao) {
            aguardandoPermissao = false;
            if (podeInstalar()) instalar();
            else if (nova != null && nova.optBoolean("obrigatoria")) pedirPermissao();
            return;
        }
        if (baixando || (dialogo != null && dialogo.isShowing())) return;
        if (nova != null && nova.optBoolean("obrigatoria")) { mostrarAviso(); return; }
        if (System.currentTimeMillis() - prefs.getLong(PREF_ULTIMA, 0) > INTERVALO_MS) verificar(false);
    }

    // ── Consulta ─────────────────────────────────────────────────

    private void verificar(final boolean mostrarSempre) {
        prefs.edit().putLong(PREF_ULTIMA, System.currentTimeMillis()).apply();
        new Thread(() -> {
            try {
                JSONObject json = new JSONObject(new String(baixarBytes(URL_VERSAO, 64 * 1024), "UTF-8"));
                if (json.optInt("versionCode", 0) <= BuildConfig.VERSION_CODE) { nova = null; return; }
                nova = json;
                if (mostrarSempre || json.optBoolean("obrigatoria")) act.runOnUiThread(this::mostrarAviso);
            } catch (Exception e) {
                Log.w(TAG, "consulta de versão falhou (segue sem atualizar)", e); // sem rede/sem release: não incomoda
            }
        }, "atualizador-consulta").start();
    }

    private static byte[] baixarBytes(String endereco, int limite) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(endereco).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > limite) throw new IllegalStateException("resposta grande demais");
            }
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    // ── Aviso ────────────────────────────────────────────────────

    private void mostrarAviso() {
        if (nova == null || act.isFinishing() || act.isDestroyed()) return;
        if (dialogo != null && dialogo.isShowing()) return;
        final boolean obrigatoria = nova.optBoolean("obrigatoria");
        String notas = nova.optString("notas", "").trim();
        String texto = "Versão " + nova.optString("versionName", "nova") + " do VortexSmart."
                + (notas.isEmpty() ? "" : "\n\n" + notas)
                + (obrigatoria ? "\n\nEsta atualização é necessária para continuar usando o app." : "");
        AlertDialog.Builder b = new AlertDialog.Builder(act)
                .setTitle("Atualização disponível")
                .setMessage(texto)
                .setCancelable(!obrigatoria)
                .setPositiveButton("Atualizar agora", (d, w) -> baixar());
        if (!obrigatoria) b.setNegativeButton("Depois", null);
        dialogo = b.show();
    }

    // ── Download ─────────────────────────────────────────────────

    private void baixar() {
        if (apkBaixado != null && apkBaixado.exists()) { instalar(); return; }
        if (baixando) return;
        baixando = true;
        cancelado = false;

        final ProgressBar barra = new ProgressBar(act, null, android.R.attr.progressBarStyleHorizontal);
        barra.setMax(100);
        final TextView rotulo = new TextView(act);
        rotulo.setText("Baixando… 0%");
        LinearLayout caixa = new LinearLayout(act);
        caixa.setOrientation(LinearLayout.VERTICAL);
        int p = (int) (24 * act.getResources().getDisplayMetrics().density);
        caixa.setPadding(p, p / 2, p, 0);
        caixa.addView(rotulo);
        caixa.addView(barra);
        dialogo = new AlertDialog.Builder(act)
                .setTitle("Atualizando o VortexSmart")
                .setView(caixa)
                .setCancelable(false)
                .setNegativeButton("Cancelar", (d, w) -> cancelado = true)
                .show();

        final long esperado = nova.optLong("tamanho", 0);
        final String shaEsperado = nova.optString("sha256", "").toLowerCase();
        new Thread(() -> {
            File destino = new File(pasta, "VortexSmart.apk");
            String erro = null;
            try {
                if (!pasta.exists() && !pasta.mkdirs()) throw new IllegalStateException("sem pasta");
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                HttpURLConnection c = (HttpURLConnection) new URL(URL_APK).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                long total = c.getContentLengthLong() > 0 ? c.getContentLengthLong() : esperado;
                long lidos = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(destino)) {
                    byte[] buf = new byte[16384];
                    int n;
                    int ultimoPct = -1;
                    while (!cancelado && (n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        sha.update(buf, 0, n);
                        lidos += n;
                        final int pct = total > 0 ? (int) (lidos * 100 / total) : 0;
                        if (pct != ultimoPct) {
                            ultimoPct = pct;
                            act.runOnUiThread(() -> { barra.setProgress(pct); rotulo.setText("Baixando… " + pct + "%"); });
                        }
                    }
                } finally {
                    c.disconnect();
                }
                if (cancelado) { erro = ""; }
                else if (esperado > 0 && lidos != esperado) erro = "Download incompleto. Tente de novo.";
                else if (!shaEsperado.isEmpty() && !hex(sha.digest()).equals(shaEsperado)) erro = "O arquivo baixado não confere. Tente de novo mais tarde.";
            } catch (Exception e) {
                Log.w(TAG, "download falhou", e);
                erro = "Não foi possível baixar a atualização. Confira a internet e tente de novo.";
            }
            final String msg = erro;
            act.runOnUiThread(() -> {
                baixando = false;
                if (dialogo != null) dialogo.dismiss();
                if (msg == null) { apkBaixado = destino; instalar(); return; }
                //noinspection ResultOfMethodCallIgnored
                destino.delete();
                if (!msg.isEmpty()) Toast.makeText(act, msg, Toast.LENGTH_LONG).show();
                if (nova != null && nova.optBoolean("obrigatoria")) mostrarAviso();
            });
        }, "atualizador-download").start();
    }

    private static String hex(byte[] bytes) {
        StringBuilder s = new StringBuilder();
        for (byte b : bytes) s.append(String.format("%02x", b));
        return s.toString();
    }

    // ── Instalação ───────────────────────────────────────────────

    private boolean podeInstalar() {
        return act.getPackageManager().canRequestPackageInstalls();
    }

    private void instalar() {
        if (apkBaixado == null || !apkBaixado.exists()) return;
        if (!podeInstalar()) { pedirPermissao(); return; }
        try {
            Uri uri = FileProvider.getUriForFile(act, act.getPackageName() + ".arquivos", apkBaixado);
            Intent it = new Intent(Intent.ACTION_VIEW);
            it.setDataAndType(uri, "application/vnd.android.package-archive");
            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            act.startActivity(it);
        } catch (Exception e) {
            Log.w(TAG, "não abriu o instalador", e);
            Toast.makeText(act, "Não foi possível abrir o instalador do Android.", Toast.LENGTH_LONG).show();
        }
    }

    /** O Android exige liberar, uma vez, "Instalar apps desconhecidos" para este app. */
    private void pedirPermissao() {
        if (act.isFinishing() || act.isDestroyed()) return;
        dialogo = new AlertDialog.Builder(act)
                .setTitle("Permitir instalar a atualização")
                .setMessage("O Android precisa da sua permissão, uma única vez, para instalar a atualização do VortexSmart.\n\n"
                        + "Toque em \"Abrir ajustes\", ative \"Permitir deste app\" e volte para cá.")
                .setCancelable(false)
                .setPositiveButton("Abrir ajustes", (d, w) -> {
                    aguardandoPermissao = true;
                    act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName())));
                })
                .setNegativeButton("Agora não", null)
                .show();
    }

    private void limparPasta() {
        File[] arquivos = pasta.listFiles();
        if (arquivos != null) for (File f : arquivos) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }
}
