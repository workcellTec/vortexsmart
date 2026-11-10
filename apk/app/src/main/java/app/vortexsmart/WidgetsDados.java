package app.vortexsmart;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.Iterator;

/**
 * Dados que os widgets da tela inicial mostram. O sistema (dentro do WebView) manda um resumo pronto
 * pela ponte; os widgets só leem daqui — não têm login nem acesso ao Firebase.
 */
final class WidgetsDados {

    private static final String PREFS = "widgets";
    private static final String RESUMO = "resumo";
    private static final String DESLOGADO = "deslogado";
    private static final String VALORES_VISIVEIS = "valoresVisiveis";
    /** O resumo real tem poucas centenas de bytes; acima disso é lixo e não vale guardar. */
    private static final int LIMITE_BYTES = 20 * 1024;

    private WidgetsDados() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Junta o resumo enviado pelo sistema ao que já estava guardado: cada bloco (hoje, concertos, meta, estoque...) que veio
     * preenchido substitui o antigo; bloco que ainda não foi calculado (null) mantém o último valor. Assim abrir o app sem
     * internet não apaga os números dos widgets. Devolve false (e não guarda nada) se não for um JSON de objeto válido.
     */
    static boolean salvarResumo(Context ctx, String json) {
        if (json == null || json.length() > LIMITE_BYTES) return false;
        try {
            JSONObject novo = new JSONObject(json);
            JSONObject atual = resumo(ctx);
            if (atual == null) atual = new JSONObject();
            for (Iterator<String> chaves = novo.keys(); chaves.hasNext(); ) {
                String chave = chaves.next();
                if (!novo.isNull(chave)) atual.put(chave, novo.get(chave));
            }
            prefs(ctx).edit().putString(RESUMO, atual.toString()).putBoolean(DESLOGADO, false).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Logout: apaga os números da loja (outra conta pode entrar no mesmo aparelho) e marca o estado "deslogado". */
    static void limpar(Context ctx) {
        prefs(ctx).edit().remove(RESUMO).putBoolean(DESLOGADO, true).apply();
    }

    /** Último resumo, ou null se ainda não há (app nunca aberto logado) ou se foi apagado. */
    static JSONObject resumo(Context ctx) {
        String json = prefs(ctx).getString(RESUMO, null);
        if (json == null) return null;
        try {
            return new JSONObject(json);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean deslogado(Context ctx) {
        return prefs(ctx).getBoolean(DESLOGADO, false);
    }

    /** Valores em dinheiro nos widgets: visíveis por padrão; quem quiser esconder (quem pegar o celular não vê o faturamento) liga em Customizações. */
    static boolean valoresVisiveis(Context ctx) {
        return prefs(ctx).getBoolean(VALORES_VISIVEIS, true);
    }

    static void definirValoresVisiveis(Context ctx, boolean visiveis) {
        prefs(ctx).edit().putBoolean(VALORES_VISIVEIS, visiveis).apply();
    }
}
