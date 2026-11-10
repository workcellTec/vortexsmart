package app.vortexsmart;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Build;
import android.util.Log;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Registro do último erro que derrubou o app. O Android só diz "o app tem um bug" sem mostrar o motivo;
 * aqui o motivo (pilha completa, versão e aparelho) é guardado num arquivo e mostrado na próxima abertura,
 * com botão pra copiar, em vez de o app cair de novo no mesmo ponto.
 */
final class RelatorioErro {

    private static final String ARQUIVO = "ultimo-erro.txt";
    private static final int LIMITE = 12 * 1024;

    private static boolean instalado;

    private RelatorioErro() {}

    /** Passa a gravar qualquer erro não tratado (de qualquer thread) antes de o Android derrubar o app. */
    static synchronized void instalar(Context ctx) {
        if (instalado) return;
        instalado = true;
        final Context app = ctx.getApplicationContext();
        final Thread.UncaughtExceptionHandler anterior = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, erro) -> {
            guardar(app, erro, thread.getName());
            if (anterior != null) anterior.uncaughtException(thread, erro);
        });
    }

    static void guardar(Context ctx, Throwable erro, String thread) {
        try {
            StringWriter pilha = new StringWriter();
            erro.printStackTrace(new PrintWriter(pilha));
            String texto = "VortexSmart " + BuildConfig.VERSION_NAME + " (código " + BuildConfig.VERSION_CODE + ")\n"
                    + Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")\n"
                    + "thread: " + thread + "\n\n" + pilha;
            if (texto.length() > LIMITE) texto = texto.substring(0, LIMITE);
            try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), ARQUIVO))) {
                out.write(texto.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Throwable t) {
            Log.w("RelatorioErro", "não consegui gravar o relatório", t);
        }
    }

    /** O relatório do erro anterior (e já o apaga, pra não aparecer duas vezes); null se não houve. */
    static String lerEApagar(Context ctx) {
        File f = new File(ctx.getFilesDir(), ARQUIVO);
        if (!f.exists()) return null;
        try {
            return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        } finally {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }

    /** Mostra o relatório. continuar != null: botão "Abrir o app" segue a abertura normal; null: só "Fechar". */
    static void mostrar(Activity act, String texto, Runnable continuar) {
        TextView t = new TextView(act);
        t.setText(texto);
        t.setTextSize(11);
        t.setTypeface(Typeface.MONOSPACE);
        t.setTextIsSelectable(true);
        int p = (int) (16 * act.getResources().getDisplayMetrics().density);
        t.setPadding(p, p, p, p);
        ScrollView rolagem = new ScrollView(act);
        rolagem.addView(t);
        AlertDialog.Builder b = new AlertDialog.Builder(act)
                .setTitle("O app fechou por um erro")
                .setView(rolagem)
                .setCancelable(false)
                .setNeutralButton("Copiar", null)
                .setNegativeButton("Fechar", (d, w) -> act.finish());
        if (continuar != null) b.setPositiveButton("Abrir o app", (d, w) -> continuar.run());
        AlertDialog dialogo = b.show();
        // "Copiar" não fecha a janela (o botão padrão fecharia).
        dialogo.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
            ClipboardManager cm = (ClipboardManager) act.getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("erro do VortexSmart", texto));
            Toast.makeText(act, "Copiado", Toast.LENGTH_SHORT).show();
        });
    }
}
