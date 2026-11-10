package app.vortexsmart;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Widget "Estoque" (2×2): quantos produtos esgotados e baixos, com os dois mais urgentes. Toque → Estoque. */
public class WidgetEstoque extends WidgetBase {

    private static final int[] LINHA = {R.id.item1, R.id.item2};
    private static final int[] NOME = {R.id.item1_nome, R.id.item2_nome};
    private static final int[] QTD_PERIGO = {R.id.item1_qtd_perigo, R.id.item2_qtd_perigo};
    private static final int[] QTD_ALERTA = {R.id.item1_qtd_alerta, R.id.item2_qtd_alerta};

    @Override
    protected RemoteViews montar(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_estoque);
        abrir(ctx, rv, R.id.raiz, "estoque");
        abrir(ctx, rv, R.id.rodape, "inicio");

        JSONObject resumo = WidgetsDados.resumo(ctx);
        JSONObject e = bloco(resumo, "estoque");
        if (semBloco(ctx, rv, e, "o estoque")) return rv;
        if ("sem-acesso".equals(e.optString("estado", ""))) {
            estado(rv, "Sem acesso", "ao estoque");
            return rv;
        }

        int esgotados = e.optInt("esgotados");
        int baixos = e.optInt("baixos");
        rv.setViewVisibility(R.id.conteudo, View.VISIBLE);
        rv.setViewVisibility(R.id.estado, View.GONE);
        rv.setTextViewText(R.id.esgotados_n, String.valueOf(esgotados));
        rv.setTextViewText(R.id.esgotados_rot, esgotados == 1 ? "esgotado" : "esgotados");
        rv.setTextViewText(R.id.baixos_n, String.valueOf(baixos));
        rv.setTextViewText(R.id.baixos_rot, baixos == 1 ? "baixo" : "baixos");
        rv.setTextViewText(R.id.atualizado, atualizadoEm(tsDoBloco(resumo, e)));

        JSONArray itens = e.optJSONArray("itens");
        int n = itens == null ? 0 : Math.min(itens.length(), LINHA.length);
        for (int i = 0; i < LINHA.length; i++) {
            JSONObject item = i < n ? itens.optJSONObject(i) : null;
            rv.setViewVisibility(LINHA[i], item == null ? View.GONE : View.VISIBLE);
            if (item == null) continue;
            int qtd = item.optInt("q");
            rv.setTextViewText(NOME[i], item.optString("n", "Produto"));
            rv.setTextViewText(QTD_PERIGO[i], String.valueOf(qtd));
            rv.setTextViewText(QTD_ALERTA[i], String.valueOf(qtd));
            rv.setViewVisibility(QTD_PERIGO[i], qtd <= 0 ? View.VISIBLE : View.GONE);
            rv.setViewVisibility(QTD_ALERTA[i], qtd <= 0 ? View.GONE : View.VISIBLE);
        }
        rv.setViewVisibility(R.id.vazio, n == 0 ? View.VISIBLE : View.GONE);
        return rv;
    }
}
