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

/**
 * Widget "Resumo da loja" (4×2): à esquerda o Hoje e os concertos; à direita as formas de pagamento do mês e a meta
 * (só o Gestor recebe esses dois). Toque → Início.
 */
public class WidgetResumo extends WidgetBase {

    private static final String OCULTO = "R$ ••••";
    private static final int[] LEG = {R.id.leg1, R.id.leg2};
    private static final int[] LEG_PONTO = {R.id.leg1_ponto, R.id.leg2_ponto};
    private static final int[] LEG_NOME = {R.id.leg1_nome, R.id.leg2_nome};
    private static final int[] LEG_PCT = {R.id.leg1_pct, R.id.leg2_pct};
    private static final int ROSCA_LADO = 168;
    private static final float ROSCA_ESPESSURA = 30f;
    private static final float ROSCA_FOLGA_GRAUS = 3f;

    @Override
    protected RemoteViews montar(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_resumo);
        abrir(ctx, rv, R.id.raiz, "inicio");
        abrir(ctx, rv, R.id.rodape, "inicio");

        JSONObject resumo = WidgetsDados.resumo(ctx);
        JSONObject hoje = bloco(resumo, "hoje");
        if (semBloco(ctx, rv, hoje, "o resumo")) return rv;

        long ts = tsDoBloco(resumo, hoje);
        boolean mostrar = WidgetsDados.valoresVisiveis(ctx);
        rv.setViewVisibility(R.id.conteudo, View.VISIBLE);
        rv.setViewVisibility(R.id.estado, View.GONE);
        rv.setTextViewText(R.id.atualizado, atualizadoEm(ts));
        rv.setViewVisibility(R.id.chip_conc, View.GONE);
        rv.setViewVisibility(R.id.chip_conc_perigo, View.GONE);

        if (!ehHoje(ts)) {
            rv.setTextViewText(R.id.titulo, "Hoje");
            rv.setTextViewText(R.id.valor, "–");
            rv.setViewVisibility(R.id.delta_alta, View.GONE);
            rv.setViewVisibility(R.id.delta_queda, View.GONE);
            rv.setTextViewText(R.id.delta_neutro, "Abra o app p/ atualizar");
            rv.setViewVisibility(R.id.delta_neutro, View.VISIBLE);
        } else {
            rv.setTextViewText(R.id.titulo, tituloHoje(hoje));
            rv.setTextViewText(R.id.valor, mostrar ? dinheiro(hoje.optDouble("valor")) : "R$ ••••");
            deltaVsOntem(rv, hoje, mostrar);
            concertos(rv, bloco(resumo, "concertos"));
        }
        direita(rv, resumo, mostrar);
        return rv;
    }

    /** "2 concertos · 1 atrasado" (vermelho quando há atrasado). Sem concertos, ou módulo fechado/sem configurar: nada. */
    private static void concertos(RemoteViews rv, JSONObject c) {
        if (c == null || !c.optString("estado", "").isEmpty()) return;
        int andamento = c.optInt("andamento");
        int atrasados = c.optInt("atrasados");
        if (andamento <= 0) return;
        String texto = plural(andamento, "concerto", "concertos");
        if (atrasados > 0) {
            rv.setTextViewText(R.id.chip_conc_perigo, texto + " · " + plural(atrasados, "atrasado", "atrasados"));
            rv.setViewVisibility(R.id.chip_conc_perigo, View.VISIBLE);
        } else {
            rv.setTextViewText(R.id.chip_conc, texto);
            rv.setViewVisibility(R.id.chip_conc, View.VISIBLE);
        }
    }

    // ── Lado direito: formas de pagamento + meta ─────────────────

    private static void avisoDireita(RemoteViews rv, String titulo, String sub) {
        rv.setViewVisibility(R.id.dir_conteudo, View.GONE);
        rv.setViewVisibility(R.id.dir_bloqueado, View.VISIBLE);
        rv.setTextViewText(R.id.dir_bloq_titulo, titulo);
        rv.setTextViewText(R.id.dir_bloq_sub, sub);
    }

    private static void direita(RemoteViews rv, JSONObject resumo, boolean mostrar) {
        JSONObject pg = bloco(resumo, "pagamentos");
        JSONObject meta = bloco(resumo, "meta");
        if ((pg != null && "sem-acesso".equals(pg.optString("estado"))) || (meta != null && "sem-acesso".equals(meta.optString("estado")))) {
            avisoDireita(rv, "Meta e pagamentos", "Só o Gestor vê");
            return;
        }
        if (pg == null || meta == null) {
            avisoDireita(rv, "Meta e pagamentos", "abra o app p/ carregar");
            return;
        }
        if (!ehMesAtual(tsDoBloco(resumo, pg)) || (!"sem-meta".equals(meta.optString("estado")) && !ehMesAtual(tsDoBloco(resumo, meta)))) {
            avisoDireita(rv, "Meta e pagamentos", "abra o app p/ atualizar");
            return;
        }
        rv.setViewVisibility(R.id.dir_conteudo, View.VISIBLE);
        rv.setViewVisibility(R.id.dir_bloqueado, View.GONE);
        pagamentos(rv, pg.optJSONArray("formas"));
        meta(rv, meta, mostrar);
    }

    private static void pagamentos(RemoteViews rv, JSONArray formas) {
        int n = formas == null ? 0 : formas.length();
        double soma = 0;
        for (int i = 0; i < n; i++) soma += Math.max(0, formas.optJSONObject(i).optDouble("v"));
        rv.setImageViewBitmap(R.id.rosca, rosca(formas, n, soma));
        for (int i = 0; i < LEG.length; i++) {
            if (i >= n || soma <= 0) {
                // Sem entradas no mês: a primeira linha avisa, a segunda some.
                rv.setViewVisibility(LEG[i], i == 0 ? View.VISIBLE : View.GONE);
                rv.setViewVisibility(LEG_PONTO[i], View.INVISIBLE);
                rv.setTextViewText(LEG_NOME[i], "Nenhuma entrada");
                rv.setTextViewText(LEG_PCT[i], "");
                continue;
            }
            JSONObject f = formas.optJSONObject(i);
            rv.setViewVisibility(LEG[i], View.VISIBLE);
            rv.setViewVisibility(LEG_PONTO[i], View.VISIBLE);
            rv.setInt(LEG_PONTO[i], "setColorFilter", corDaForma(f.optString("k")));
            rv.setTextViewText(LEG_NOME[i], nomeDaForma(f.optString("k")));
            rv.setTextViewText(LEG_PCT[i], Math.round(f.optDouble("v") / soma * 100) + "%");
        }
    }

    private static void meta(RemoteViews rv, JSONObject meta, boolean mostrar) {
        if ("sem-meta".equals(meta.optString("estado"))) {
            rv.setTextViewText(R.id.meta_pct, "—");
            rv.setProgressBar(R.id.meta_barra, 100, 0, false);
            rv.setTextViewText(R.id.meta_txt, "Meta não definida");
            return;
        }
        double total = meta.optDouble("total");
        double alvo = meta.optDouble("meta");
        int pct = alvo > 0 ? (int) Math.round(total / alvo * 100) : 0;
        rv.setTextViewText(R.id.meta_pct, mostrar ? pct + "%" : "••%");
        rv.setProgressBar(R.id.meta_barra, 100, mostrar ? Math.min(100, pct) : 0, false);
        rv.setTextViewText(R.id.meta_txt, mostrar ? dinheiroCurto(total) + " de " + dinheiroCurto(alvo) : OCULTO + " de " + OCULTO);
    }

    // ── Rosca ────────────────────────────────────────────────────

    /** Cores fixas de meio-tom: leem bem tanto no fundo claro quanto no escuro (a rosca é um Bitmap, não acompanha o tema). */
    private static int corDaForma(String forma) {
        switch (forma) {
            case "pix": return 0xFF10B981;
            case "credito": return 0xFF3B82F6;
            case "debito": return 0xFF94A3B8;
            case "dinheiro": return 0xFFA8A29E;
            default: return 0xFFF59E0B;
        }
    }

    private static String nomeDaForma(String forma) {
        switch (forma) {
            case "pix": return "Pix";
            case "credito": return "Crédito";
            case "debito": return "Débito";
            case "dinheiro": return "Dinheiro";
            default: return "Outros";
        }
    }

    private static Bitmap rosca(JSONArray formas, int n, double soma) {
        Bitmap bmp = Bitmap.createBitmap(ROSCA_LADO, ROSCA_LADO, Bitmap.Config.ARGB_8888);
        Canvas tela = new Canvas(bmp);
        Paint tinta = new Paint(Paint.ANTI_ALIAS_FLAG);
        tinta.setStyle(Paint.Style.STROKE);
        tinta.setStrokeWidth(ROSCA_ESPESSURA);
        float m = ROSCA_ESPESSURA / 2f;
        RectF caixa = new RectF(m, m, ROSCA_LADO - m, ROSCA_LADO - m);
        if (n == 0 || soma <= 0) {
            tinta.setColor(0x33808080);
            tela.drawArc(caixa, 0, 360, false, tinta);
            return bmp;
        }
        float inicio = -90f;
        for (int i = 0; i < n; i++) {
            JSONObject f = formas.optJSONObject(i);
            float fatia = (float) (Math.max(0, f.optDouble("v")) / soma * 360f);
            float folga = n > 1 ? Math.min(ROSCA_FOLGA_GRAUS, fatia / 2f) : 0f;
            tinta.setColor(corDaForma(f.optString("k")));
            tela.drawArc(caixa, inicio + folga / 2f, Math.max(0.5f, fatia - folga), false, tinta);
            inicio += fatia;
        }
        return bmp;
    }
}
