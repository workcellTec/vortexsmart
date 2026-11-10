package app.vortexsmart;

import android.content.Context;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Widget "Contas de hoje" (4×2, só Gestor): contas fixas que vencem hoje ou estão atrasadas. Toque → Financeiro. */
public class WidgetContas extends WidgetBase {

    private static final String OCULTO = "R$ ••••";
    private static final int[] LINHA = {R.id.conta1, R.id.conta2, R.id.conta3};
    private static final int[] NOME = {R.id.conta1_nome, R.id.conta2_nome, R.id.conta3_nome};
    private static final int[] HOJE = {R.id.conta1_hoje, R.id.conta2_hoje, R.id.conta3_hoje};
    private static final int[] ATRASO = {R.id.conta1_atraso, R.id.conta2_atraso, R.id.conta3_atraso};
    private static final int[] VALOR = {R.id.conta1_valor, R.id.conta2_valor, R.id.conta3_valor};

    @Override
    protected RemoteViews montar(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_contas);
        abrir(ctx, rv, R.id.raiz, "financeiro");
        abrir(ctx, rv, R.id.rodape, "inicio");

        JSONObject resumo = WidgetsDados.resumo(ctx);
        JSONObject c = bloco(resumo, "contas");
        if (semBloco(ctx, rv, c, "as contas")) return rv;
        if ("sem-acesso".equals(c.optString("estado", ""))) {
            estado(rv, "Só o Gestor vê", "as contas de hoje");
            abrir(ctx, rv, R.id.raiz, "inicio");
            return rv;
        }

        long ts = tsDoBloco(resumo, c);
        rv.setViewVisibility(R.id.conteudo, View.VISIBLE);
        rv.setViewVisibility(R.id.estado, View.GONE);
        rv.setTextViewText(R.id.atualizado, atualizadoEm(ts));

        // "Hoje" e "atrasada" dependem do dia: um resumo de outro dia mostraria conta que já mudou de situação.
        if (!ehHoje(ts)) {
            rv.setTextViewText(R.id.total, "–");
            for (int linha : LINHA) rv.setViewVisibility(linha, View.GONE);
            rv.setViewVisibility(R.id.vazio, View.GONE);
            rv.setTextViewText(R.id.mais, "Abra o app p/ atualizar");
            rv.setViewVisibility(R.id.mais, View.VISIBLE);
            return rv;
        }

        boolean mostrar = WidgetsDados.valoresVisiveis(ctx);
        JSONArray itens = c.optJSONArray("itens");
        int n = itens == null ? 0 : Math.min(itens.length(), LINHA.length);
        int qtd = c.optInt("qtd", n);
        rv.setTextViewText(R.id.total, mostrar ? dinheiro(c.optDouble("total")) : OCULTO);
        rv.setViewVisibility(R.id.total, qtd > 0 ? View.VISIBLE : View.GONE);
        for (int i = 0; i < LINHA.length; i++) {
            JSONObject conta = i < n ? itens.optJSONObject(i) : null;
            rv.setViewVisibility(LINHA[i], conta == null ? View.GONE : View.VISIBLE);
            if (conta == null) continue;
            int atraso = conta.optInt("d");
            rv.setTextViewText(NOME[i], conta.optString("n", "Conta"));
            rv.setTextViewText(VALOR[i], mostrar ? dinheiro(conta.optDouble("v")) : OCULTO);
            rv.setViewVisibility(HOJE[i], atraso <= 0 ? View.VISIBLE : View.GONE);
            rv.setViewVisibility(ATRASO[i], atraso > 0 ? View.VISIBLE : View.GONE);
            rv.setTextViewText(ATRASO[i], plural(atraso, "dia", "dias"));
        }
        rv.setViewVisibility(R.id.mais, qtd > n ? View.VISIBLE : View.GONE);
        rv.setTextViewText(R.id.mais, "+ " + plural(qtd - n, "conta", "contas"));
        rv.setTextViewText(R.id.vazio, "Nenhuma conta vence hoje");
        rv.setViewVisibility(R.id.vazio, qtd == 0 ? View.VISIBLE : View.GONE);
        return rv;
    }
}
