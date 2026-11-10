package app.vortexsmart;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/** Base dos widgets: monta o RemoteViews com proteção contra erro, toque que abre o app numa tela, e formatação. */
public abstract class WidgetBase extends AppWidgetProvider {

    static final String ACAO_DESTINO = "app.vortexsmart.DESTINO";
    private static final Locale PT_BR = Locale.forLanguageTag("pt-BR");

    /** Monta o widget com o que tem agora. Pode lançar exceção: quem chama protege. */
    protected abstract RemoteViews montar(Context ctx);

    @Override
    public void onUpdate(Context ctx, AppWidgetManager gerente, int[] ids) {
        atualizar(ctx, gerente, ids);
    }

    final void atualizar(Context ctx, AppWidgetManager gerente, int[] ids) {
        try {
            gerente.updateAppWidget(ids, montar(ctx));
        } catch (Throwable erro) {
            // Um widget com defeito não pode derrubar o app: guarda o motivo (aparece na próxima abertura) e segue.
            RelatorioErro.guardar(ctx, erro, "widget " + getClass().getSimpleName());
        }
    }

    /** Redesenha todos os widgets de dados (Hoje, Concertos). Ações rápidas não dependem de dados. */
    static void atualizarTodos(Context ctx) {
        AppWidgetManager gerente = AppWidgetManager.getInstance(ctx);
        atualizarClasse(ctx, gerente, new WidgetHoje());
        atualizarClasse(ctx, gerente, new WidgetConcertos());
    }

    private static void atualizarClasse(Context ctx, AppWidgetManager gerente, WidgetBase widget) {
        int[] ids = gerente.getAppWidgetIds(new ComponentName(ctx, widget.getClass()));
        if (ids.length > 0) widget.atualizar(ctx, gerente, ids);
    }

    // ── Toque: abre o app direto numa tela ────────────────────────

    /** Liga o toque numa área do widget a uma tela do sistema (ex.: "venda:historico"). */
    static void abrir(Context ctx, RemoteViews rv, int idView, String destino) {
        Intent it = new Intent(ACAO_DESTINO, Uri.parse("vortexsmart://destino/" + Uri.encode(destino)), ctx, MainActivity.class);
        it.putExtra("destino", destino);
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // O endereço (data) é diferente por destino: é ele que impede o sistema de juntar dois toques distintos num só.
        rv.setOnClickPendingIntent(idView, PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    // ── Estados sem número ────────────────────────────────────────

    /** Troca o conteúdo do widget por um aviso curto ("Abra o VortexSmart", "Entre na sua conta"...). */
    static void estado(RemoteViews rv, String titulo, String sub) {
        rv.setViewVisibility(R.id.conteudo, View.GONE);
        rv.setViewVisibility(R.id.estado, View.VISIBLE);
        rv.setTextViewText(R.id.estado_titulo, titulo);
        rv.setTextViewText(R.id.estado_sub, sub);
    }

    // ── Formatação ────────────────────────────────────────────────

    /** R$ 84,50 · R$ 1.840 · R$ 123k (cabe no widget pequeno sem quebrar linha). */
    static String dinheiro(double valor) {
        DecimalFormatSymbols simbolos = DecimalFormatSymbols.getInstance(PT_BR);
        double abs = Math.abs(valor);
        String sinal = valor < 0 ? "-" : "";
        if (abs >= 100000) return sinal + "R$ " + Math.round(abs / 1000) + "k";
        if (abs >= 1000) return sinal + "R$ " + new DecimalFormat("#,##0", simbolos).format(Math.round(abs));
        return sinal + "R$ " + new DecimalFormat("0.00", simbolos).format(abs);
    }

    /** 12,4 (sempre com uma casa) — o sinal e a seta ficam por conta de quem chama. */
    static String percentual(double pct) {
        return new DecimalFormat("0.0", DecimalFormatSymbols.getInstance(PT_BR)).format(Math.abs(pct));
    }

    /** O instante {@code ts} (milissegundos) caiu no dia de hoje, no fuso do aparelho? */
    static boolean ehHoje(long ts) {
        if (ts <= 0) return false;
        Calendar a = Calendar.getInstance();
        Calendar b = Calendar.getInstance();
        b.setTimeInMillis(ts);
        return a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR);
    }

    /** "Atualizado 11:42" (hoje) ou "Atualizado 09/11 18:03" (outro dia). */
    static String atualizadoEm(long ts) {
        String padrao = ehHoje(ts) ? "HH:mm" : "dd/MM HH:mm";
        return "Atualizado " + new SimpleDateFormat(padrao, PT_BR).format(new Date(ts));
    }
}
