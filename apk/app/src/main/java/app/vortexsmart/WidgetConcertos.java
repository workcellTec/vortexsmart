package app.vortexsmart;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Widget "Concertos" (2×2): quantos estão em andamento, quantos atrasados e quantos vencem hoje. Toque → lista de concertos. */
public class WidgetConcertos extends WidgetBase {

    @Override
    protected RemoteViews montar(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_concertos);
        abrir(ctx, rv, R.id.raiz, "reparos:lista");
        abrir(ctx, rv, R.id.rodape, "inicio");

        JSONObject resumo = WidgetsDados.resumo(ctx);
        JSONObject c = bloco(resumo, "concertos");
        if (semBloco(ctx, rv, c, "os concertos")) return rv;
        String situacao = c.optString("estado", "");
        if ("configurar".equals(situacao)) {
            estado(rv, "Configure no app", "o modo de concertos");
            abrir(ctx, rv, R.id.raiz, "inicio");
            return rv;
        }
        if ("sem-acesso".equals(situacao)) {
            estado(rv, "Sem acesso", "aos concertos");
            abrir(ctx, rv, R.id.raiz, "inicio");
            return rv;
        }

        long ts = tsDoBloco(resumo, c);
        int andamento = c.optInt("andamento");
        int atrasados = c.optInt("atrasados");
        // "Vence hoje" é contado em relação ao dia em que o app mandou o resumo: de outro dia, o número não vale mais.
        int vencemHoje = ehHoje(ts) ? c.optInt("vencemHoje") : 0;

        rv.setViewVisibility(R.id.conteudo, View.VISIBLE);
        rv.setViewVisibility(R.id.estado, View.GONE);
        rv.setTextViewText(R.id.numero, String.valueOf(andamento));
        rv.setTextViewText(R.id.chip_atrasado, plural(atrasados, "atrasado", "atrasados"));
        rv.setViewVisibility(R.id.chip_atrasado, atrasados > 0 ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.chip_hoje, vencemHoje == 1 ? "1 vence hoje" : vencemHoje + " vencem hoje");
        rv.setViewVisibility(R.id.chip_hoje, vencemHoje > 0 ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.atualizado, atualizadoEm(ts));
        return rv;
    }
}
