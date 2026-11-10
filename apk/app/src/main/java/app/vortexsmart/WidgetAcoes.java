package app.vortexsmart;

import android.content.Context;
import android.widget.RemoteViews;

/** Widget "Ações rápidas" (4×1): atalhos que abrem o app direto na tela (Vender, Escanear, Concerto, Calculadora). Não usa dados. */
public class WidgetAcoes extends WidgetBase {

    @Override
    protected RemoteViews montar(Context ctx) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_acoes);
        abrir(ctx, rv, R.id.raiz, "inicio");
        abrir(ctx, rv, R.id.acao_vender, "venda:nova");
        abrir(ctx, rv, R.id.acao_escanear, "venda:escanear");
        abrir(ctx, rv, R.id.acao_concerto, "reparos:novo");
        abrir(ctx, rv, R.id.acao_calculadora, "calculadora");
        return rv;
    }
}
