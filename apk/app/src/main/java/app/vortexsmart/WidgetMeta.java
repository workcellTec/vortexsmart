package app.vortexsmart;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

/** Widget "Meta do mês" (2×2, só Gestor): quanto da meta já entrou, quanto falta e quantos dias restam. Toque → Início. */
public class WidgetMeta extends WidgetBase {

    private static final String OCULTO = "R$ ••••";

    @Override
    protected RemoteViews montar(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_meta);
        abrir(ctx, rv, R.id.raiz, "inicio");

        JSONObject resumo = WidgetsDados.resumo(ctx);
        JSONObject meta = bloco(resumo, "meta");
        if (semBloco(ctx, rv, meta, "a meta")) return rv;
        String situacao = meta.optString("estado", "");
        if ("sem-acesso".equals(situacao)) {
            estado(rv, "Só o Gestor vê", "a meta da loja");
            return rv;
        }
        if ("sem-meta".equals(situacao)) {
            estado(rv, "Sem meta definida", "defina na Início do app");
            return rv;
        }

        long ts = tsDoBloco(resumo, meta);
        rv.setViewVisibility(R.id.conteudo, View.VISIBLE);
        rv.setViewVisibility(R.id.estado, View.GONE);
        rv.setTextViewText(R.id.atualizado, atualizadoEm(ts));

        if (!ehMesAtual(ts)) {
            // Resumo do mês passado: o total de lá não vale pra este mês.
            rv.setTextViewText(R.id.pct, "–");
            rv.setProgressBar(R.id.barra, 100, 0, false);
            rv.setTextViewText(R.id.total, "–");
            rv.setTextViewText(R.id.de, "");
            rv.setTextViewText(R.id.falta, "Abra o app p/ atualizar");
            rv.setTextViewText(R.id.dias, "");
            return rv;
        }

        boolean mostrar = WidgetsDados.valoresVisiveis(ctx);
        double total = meta.optDouble("total");
        double alvo = meta.optDouble("meta");
        int pct = alvo > 0 ? (int) Math.round(total / alvo * 100) : 0;
        rv.setTextViewText(R.id.pct, mostrar ? pct + "%" : "••%");
        // Valores ocultos: a barra entregaria o percentual, então fica vazia.
        rv.setProgressBar(R.id.barra, 100, mostrar ? Math.min(100, pct) : 0, false);
        rv.setTextViewText(R.id.total, mostrar ? dinheiroCurto(total) : OCULTO);
        rv.setTextViewText(R.id.de, " de " + (mostrar ? dinheiroCurto(alvo) : OCULTO));
        rv.setTextViewText(R.id.falta, !mostrar ? "Faltam " + OCULTO : total >= alvo ? "Meta batida!" : "Faltam " + dinheiroCurto(alvo - total));
        rv.setTextViewText(R.id.dias, diasParaFimDoMes());
        return rv;
    }
}
