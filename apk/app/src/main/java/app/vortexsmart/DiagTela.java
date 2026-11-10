package app.vortexsmart;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Registro curto do ciclo de vida da tela (pausa, volta, JS respondendo, quadro desenhado, toque).
 * Existe pra achar com evidência o bug "tela preta ao voltar do segundo plano até tocar":
 * o relatório sai em Configurações › Diagnóstico do sistema, seção "Tela do app Android".
 */
final class DiagTela {

    private static final String ARQUIVO = "diag-tela.txt";
    /** Só os últimos eventos interessam; acima disso corta o começo. */
    private static final int LIMITE = 8 * 1024;

    private DiagTela() {}

    static synchronized void registrar(Context ctx, String evento) {
        try {
            File arquivo = new File(ctx.getApplicationContext().getFilesDir(), ARQUIVO);
            String texto = (arquivo.exists() ? lerArquivo(arquivo) : "")
                    + new SimpleDateFormat("dd HH:mm:ss.SSS", Locale.US).format(new Date()) + "  " + evento + "\n";
            if (texto.length() > LIMITE) texto = texto.substring(texto.indexOf('\n', texto.length() - LIMITE) + 1);
            try (FileOutputStream out = new FileOutputStream(arquivo)) {
                out.write(texto.getBytes(StandardCharsets.UTF_8));
            }
        } catch (Throwable t) {
            Log.w("DiagTela", "não consegui registrar", t);
        }
    }

    static synchronized String ler(Context ctx) {
        try {
            File arquivo = new File(ctx.getApplicationContext().getFilesDir(), ARQUIVO);
            return arquivo.exists() ? lerArquivo(arquivo) : "";
        } catch (Throwable t) {
            return "(não consegui ler o registro: " + t + ")";
        }
    }

    private static String lerArquivo(File arquivo) throws java.io.IOException {
        return new String(Files.readAllBytes(arquivo.toPath()), StandardCharsets.UTF_8);
    }
}
