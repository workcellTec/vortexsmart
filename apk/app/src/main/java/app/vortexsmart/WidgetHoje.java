package app.vortexsmart;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/** Widget "Hoje" (2×2): quanto entrou hoje, comparação com ontem e as barras dos últimos 7 dias. Toque → histórico de vendas. */
public class WidgetHoje extends WidgetBase {

    private static final int BARRAS_L = 272;
    private static final int BARRAS_A = 56;
    private static final int BARRAS_FOLGA = 8;
    private static final int BARRA_MINIMA = 5;

    @Override
    protected RemoteViews montar(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_hoje);
        abrir(ctx, rv, R.id.raiz, "venda:historico");
        abrir(ctx, rv, R.id.rodape, "inicio");

        JSONObject resumo = WidgetsDados.resumo(ctx);
        JSONObject hoje = resumo == null ? null : resumo.optJSONObject("hoje");
        if (hoje == null) {
            if (WidgetsDados.deslogado(ctx)) estado(rv, "Entre no VortexSmart", "para ver as vendas");
            else estado(rv, "Abra o VortexSmart", "para carregar os números");
            abrir(ctx, rv, R.id.raiz, "inicio");
            return rv;
        }

        long ts = resumo.optLong("ts");
        boolean diaAtual = ehHoje(ts);
        boolean mostrar = WidgetsDados.valoresVisiveis(ctx);
        int vendas = hoje.optInt("vendas");
        String qtd = vendas == 1 ? "1 venda" : vendas + " vendas";

        rv.setViewVisibility(R.id.conteudo, View.VISIBLE);
        rv.setViewVisibility(R.id.estado, View.GONE);
        rv.setViewVisibility(R.id.delta_alta, View.GONE);
        rv.setViewVisibility(R.id.delta_queda, View.GONE);
        rv.setViewVisibility(R.id.delta_neutro, View.GONE);

        if (!diaAtual) {
            // O resumo é de outro dia (app não foi aberto hoje): mostrar o valor de ontem como se fosse de hoje enganaria.
            rv.setTextViewText(R.id.titulo, "Hoje");
            rv.setTextViewText(R.id.valor, "–");
            rv.setTextViewText(R.id.delta_neutro, "Abra o app p/ atualizar");
            rv.setViewVisibility(R.id.delta_neutro, View.VISIBLE);
            rv.setViewVisibility(R.id.barras, View.INVISIBLE);
            rv.setTextViewText(R.id.atualizado, atualizadoEm(ts));
            return rv;
        }

        rv.setTextViewText(R.id.titulo, (resumo.optBoolean("proprio") ? "Você vendeu" : "Entrou hoje") + " · " + qtd);
        rv.setTextViewText(R.id.valor, mostrar ? dinheiro(hoje.optDouble("valor")) : "R$ ••••");

        if (hoje.isNull("pct")) {
            rv.setTextViewText(R.id.delta_neutro, "sem vendas ontem");
            rv.setViewVisibility(R.id.delta_neutro, View.VISIBLE);
        } else {
            double pct = hoje.optDouble("pct");
            String numero = mostrar ? percentual(pct) + "%" : "•••";
            if (Math.abs(pct) < 0.05) {
                rv.setTextViewText(R.id.delta_neutro, "igual a ontem");
                rv.setViewVisibility(R.id.delta_neutro, View.VISIBLE);
            } else if (pct > 0) {
                rv.setTextViewText(R.id.delta_alta, "▲ " + numero + " vs. ontem");
                rv.setViewVisibility(R.id.delta_alta, View.VISIBLE);
            } else {
                rv.setTextViewText(R.id.delta_queda, "▼ " + numero + " vs. ontem");
                rv.setViewVisibility(R.id.delta_queda, View.VISIBLE);
            }
        }

        // Valores ocultos: as barras também entregam o faturamento (altura relativa), então somem junto.
        Bitmap barras = mostrar ? desenharBarras(hoje.optJSONArray("serie")) : null;
        if (barras != null) {
            rv.setImageViewBitmap(R.id.barras, barras);
            rv.setViewVisibility(R.id.barras, View.VISIBLE);
        } else {
            rv.setViewVisibility(R.id.barras, View.INVISIBLE);
        }
        rv.setTextViewText(R.id.atualizado, atualizadoEm(ts));
        return rv;
    }

    /**
     * 7 barras (6 dias anteriores + hoje, da esquerda pra direita). Desenhadas em branco com transparência:
     * o ImageView pinta com a cor do tema (android:tint), então claro/escuro funcionam sozinhos.
     */
    private static Bitmap desenharBarras(JSONArray serie) {
        if (serie == null || serie.length() == 0) return null;
        int n = Math.min(serie.length(), 7);
        double[] v = new double[n];
        double maior = 0;
        for (int i = 0; i < n; i++) {
            v[i] = Math.max(0, serie.optDouble(serie.length() - n + i, 0));
            maior = Math.max(maior, v[i]);
        }
        Bitmap bmp = Bitmap.createBitmap(BARRAS_L, BARRAS_A, Bitmap.Config.ARGB_8888);
        Canvas tela = new Canvas(bmp);
        Paint tinta = new Paint(Paint.ANTI_ALIAS_FLAG);
        float largura = (BARRAS_L - (n - 1) * BARRAS_FOLGA) / (float) n;
        for (int i = 0; i < n; i++) {
            float altura = maior > 0 ? (float) (v[i] / maior * BARRAS_A) : 0;
            altura = Math.max(BARRA_MINIMA, altura);
            float x = i * (largura + BARRAS_FOLGA);
            tinta.setColor(0xFFFFFFFF);
            tinta.setAlpha(i == n - 1 ? 255 : 90);
            tela.drawRoundRect(new RectF(x, BARRAS_A - altura, x + largura, BARRAS_A), 6, 6, tinta);
        }
        return bmp;
    }
}
