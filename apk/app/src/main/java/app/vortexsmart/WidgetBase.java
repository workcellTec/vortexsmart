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

import org.json.JSONObject;

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

    /** Redesenha todos os widgets de dados. Ações rápidas não dependem de dados. */
    static void atualizarTodos(Context ctx) {
        AppWidgetManager gerente = AppWidgetManager.getInstance(ctx);
        atualizarClasse(ctx, gerente, new WidgetHoje());
        atualizarClasse(ctx, gerente, new WidgetConcertos());
        atualizarClasse(ctx, gerente, new WidgetMeta());
        atualizarClasse(ctx, gerente, new WidgetEstoque());
        atualizarClasse(ctx, gerente, new WidgetResumo());
        atualizarClasse(ctx, gerente, new WidgetContas());
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

    /**
     * Bloco do resumo ainda não chegou (app nunca aberto logado) ou foi apagado (logout): mostra o aviso e devolve true.
     * Quem chama só segue se devolver false.
     */
    static boolean semBloco(Context ctx, RemoteViews rv, JSONObject bloco, String paraVer) {
        if (bloco != null) return false;
        if (WidgetsDados.deslogado(ctx)) estado(rv, "Entre no VortexSmart", "para ver " + paraVer);
        else estado(rv, "Abra o VortexSmart", "para carregar os números");
        abrir(ctx, rv, R.id.raiz, "inicio");
        return true;
    }

    static JSONObject bloco(JSONObject resumo, String nome) {
        return resumo == null ? null : resumo.optJSONObject(nome);
    }

    /** Instante em que o bloco foi calculado pelo sistema (o app pode ficar aberto de um dia pro outro). */
    static long tsDoBloco(JSONObject resumo, JSONObject bloco) {
        return bloco.optLong("ts", resumo.optLong("ts"));
    }

    // ── Pedaços que Hoje e Resumo da loja repetem ─────────────────

    /** "Entrou hoje · 3 vendas" (ou "Você vendeu" quando a pessoa só vê as próprias vendas). */
    static String tituloHoje(JSONObject hoje) {
        return (hoje.optBoolean("proprio") ? "Você vendeu" : "Entrou hoje") + " · " + plural(hoje.optInt("vendas"), "venda", "vendas");
    }

    /** ▲ 12,4% vs. ontem / ▼ 3,0% vs. ontem / igual a ontem / sem vendas ontem. Valores ocultos: o número vira •••. */
    static void deltaVsOntem(RemoteViews rv, JSONObject hoje, boolean mostrar) {
        rv.setViewVisibility(R.id.delta_alta, View.GONE);
        rv.setViewVisibility(R.id.delta_queda, View.GONE);
        rv.setViewVisibility(R.id.delta_neutro, View.GONE);
        if (hoje.isNull("pct")) {
            rv.setTextViewText(R.id.delta_neutro, "sem vendas ontem");
            rv.setViewVisibility(R.id.delta_neutro, View.VISIBLE);
            return;
        }
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

    // ── Formatação ────────────────────────────────────────────────

    static String plural(int n, String um, String varios) {
        return n == 1 ? "1 " + um : n + " " + varios;
    }

    /** R$ 850 · R$ 26,7k · R$ 1,3M — mesmo formato do "brlCurto" da Início. */
    static String dinheiroCurto(double valor) {
        DecimalFormat uma = new DecimalFormat("0.#", DecimalFormatSymbols.getInstance(PT_BR));
        double abs = Math.abs(valor);
        String sinal = valor < 0 ? "-" : "";
        if (abs >= 1e6) return sinal + "R$ " + uma.format(abs / 1e6) + "M";
        if (abs >= 1e3) return sinal + "R$ " + uma.format(abs / 1e3) + "k";
        return sinal + "R$ " + Math.round(abs);
    }

    /** Dias que faltam pro fim do mês, no texto do widget da meta. */
    static String diasParaFimDoMes() {
        Calendar c = Calendar.getInstance();
        int resto = c.getActualMaximum(Calendar.DAY_OF_MONTH) - c.get(Calendar.DAY_OF_MONTH);
        return resto == 0 ? "último dia do mês" : resto == 1 ? "1 dia para o fim do mês" : resto + " dias para o fim do mês";
    }

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

    /** O instante {@code ts} caiu no mês corrente, no fuso do aparelho? */
    static boolean ehMesAtual(long ts) {
        if (ts <= 0) return false;
        Calendar a = Calendar.getInstance();
        Calendar b = Calendar.getInstance();
        b.setTimeInMillis(ts);
        return a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.MONTH) == b.get(Calendar.MONTH);
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
