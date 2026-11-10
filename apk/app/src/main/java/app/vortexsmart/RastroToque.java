package app.vortexsmart;

import android.content.Context;
import android.os.SystemClock;
import android.util.JsonReader;
import android.util.JsonToken;
import android.webkit.TracingConfig;
import android.webkit.TracingController;

import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Executors;

/**
 * Rastro interno do Chromium (o que o WebView faz com cada toque): o Android entrega o toque ao app, mas em alguns momentos a página
 * não recebe nada. Só o rastro do próprio WebView mostra onde o toque morre. Grava com o TracingController, guarda em arquivo e
 * resume (só eventos de entrada/latência e tarefas longas, em ordem de tempo e com a hora do relógio) pro relatório de diagnóstico.
 */
final class RastroToque {
    private static final String ARQUIVO = "rastro.json";
    private static final String CATEGORIAS = "input,latency,benchmark,rail,toplevel,devtools.timeline";
    private static final int MAX_LINHAS = 2500;
    private static final int MAX_EVENTOS = 200000;
    private static final double TAREFA_LONGA_US = 30000;

    private static volatile String estado = "parado";   // parado | gravando | salvando | pronto | erro: ...

    private RastroToque() {}

    static String estado() { return estado; }

    /** categorias: lista separada por vírgula; vazio = a lista padrão. */
    static synchronized String iniciar(Context ctx, String categorias) {
        try {
            TracingController tc = TracingController.getInstance();
            if (tc.isTracing()) return estado;
            new File(ctx.getFilesDir(), ARQUIVO).delete();   // não misturar com um rastro antigo
            String lista = categorias == null || categorias.trim().isEmpty() ? CATEGORIAS : categorias.trim();
            tc.start(new TracingConfig.Builder()
                    .addCategories(lista.split(","))
                    .setTracingMode(TracingConfig.RECORD_CONTINUOUSLY)
                    .build());
            estado = "gravando";
        } catch (Exception e) {
            estado = "erro: " + e;
        }
        return estado;
    }

    /** Para e grava em arquivo (assíncrono: o estado vira "pronto" quando o WebView termina de escrever). */
    static synchronized String parar(Context ctx) {
        try {
            TracingController tc = TracingController.getInstance();
            if (!tc.isTracing()) return estado;
            OutputStream saida = new BufferedOutputStream(new FileOutputStream(new File(ctx.getFilesDir(), ARQUIVO))) {
                @Override public void close() throws IOException {
                    try { super.close(); } finally { estado = "pronto"; }
                }
            };
            estado = "salvando";
            tc.stop(saida, Executors.newSingleThreadExecutor());
        } catch (Exception e) {
            estado = "erro: " + e;
        }
        return estado;
    }

    private static final class Resumo {
        final List<Object[]> linhas = new ArrayList<>();          // {ts em µs, texto}
        final Map<String, Integer> contagem = new HashMap<>();
        final Map<String, String> nomeProcesso = new HashMap<>();
        final Map<String, String> nomeThread = new HashMap<>();
        long lidos;
    }

    static String ler(Context ctx) {
        if (estado.equals("gravando")) return "(ainda gravando: abra o diagnóstico de novo pra parar e resumir)";
        if (estado.equals("salvando")) return "(salvando o rastro…)";
        File f = new File(ctx.getFilesDir(), ARQUIVO);
        if (!f.exists()) return "(nenhum rastro gravado)";
        long relogio = System.currentTimeMillis() - SystemClock.uptimeMillis();   // CLOCK_MONOTONIC (rastro) → hora do relógio
        Resumo r = new Resumo();
        String aviso = "";
        try (JsonReader leitor = new JsonReader(new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8")))) {
            leitor.setLenient(true);
            if (leitor.peek() == JsonToken.BEGIN_OBJECT) {
                leitor.beginObject();
                while (leitor.hasNext()) {
                    if ("traceEvents".equals(leitor.nextName())) lerEventos(leitor, r); else leitor.skipValue();
                }
            } else {
                lerEventos(leitor, r);
            }
        } catch (Exception e) {
            aviso = "(rastro cortado no meio: " + e + ")\n";
        }
        Collections.sort(r.linhas, new Comparator<Object[]>() {
            @Override public int compare(Object[] a, Object[] b) { return Double.compare((Double) a[0], (Double) b[0]); }
        });
        SimpleDateFormat hora = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);
        StringBuilder s = new StringBuilder(aviso);
        s.append("arquivo ").append(f.length() / 1024).append(" KB · ").append(r.lidos).append(" eventos lidos · ").append(r.linhas.size()).append(" guardados\n");
        List<Map.Entry<String, Integer>> topo = new ArrayList<>(r.contagem.entrySet());
        Collections.sort(topo, new Comparator<Map.Entry<String, Integer>>() {
            @Override public int compare(Map.Entry<String, Integer> a, Map.Entry<String, Integer> b) { return b.getValue() - a.getValue(); }
        });
        s.append("mais frequentes: ");
        for (int i = 0; i < Math.min(25, topo.size()); i++) s.append(topo.get(i).getKey()).append(" ×").append(topo.get(i).getValue()).append(i < 24 ? " | " : "");
        s.append('\n');
        int de = Math.max(0, r.linhas.size() - MAX_LINHAS);
        for (int i = de; i < r.linhas.size(); i++) {
            Object[] l = r.linhas.get(i);
            long ms = (long) (((Double) l[0]) / 1000.0) + relogio;
            s.append(hora.format(new Date(ms))).append("  ").append((String) l[1]).append('\n');
        }
        return s.toString();
    }

    private static void lerEventos(JsonReader leitor, Resumo r) throws IOException {
        leitor.beginArray();
        while (leitor.hasNext()) lerEvento(leitor, r);
        leitor.endArray();
    }

    private static String valor(JsonReader leitor) throws IOException {
        JsonToken t = leitor.peek();
        if (t == JsonToken.STRING || t == JsonToken.NUMBER) return leitor.nextString();
        if (t == JsonToken.BOOLEAN) return String.valueOf(leitor.nextBoolean());
        if (t == JsonToken.NULL) { leitor.nextNull(); return ""; }
        leitor.skipValue();
        return "{…}";
    }

    private static void lerEvento(JsonReader leitor, Resumo r) throws IOException {
        String nome = "", cat = "", ph = "", pid = "", tid = "", nomeArg = "";
        double ts = 0, dur = 0;
        StringBuilder args = new StringBuilder();
        leitor.beginObject();
        while (leitor.hasNext()) {
            String k = leitor.nextName();
            switch (k) {
                case "name": nome = valor(leitor); break;
                case "cat": cat = valor(leitor); break;
                case "ph": ph = valor(leitor); break;
                case "pid": pid = valor(leitor); break;
                case "tid": tid = valor(leitor); break;
                case "ts": try { ts = Double.parseDouble(valor(leitor)); } catch (NumberFormatException e) { ts = 0; } break;
                case "dur": try { dur = Double.parseDouble(valor(leitor)); } catch (NumberFormatException e) { dur = 0; } break;
                case "args":
                    if (leitor.peek() == JsonToken.BEGIN_OBJECT) {
                        leitor.beginObject();
                        while (leitor.hasNext()) {
                            String ak = leitor.nextName(), av = valor(leitor);
                            if (ak.equals("name")) nomeArg = av;
                            if (args.length() < 110) args.append(' ').append(ak).append('=').append(av.length() > 40 ? av.substring(0, 40) : av);
                        }
                        leitor.endObject();
                    } else leitor.skipValue();
                    break;
                default: leitor.skipValue();
            }
        }
        leitor.endObject();
        r.lidos++;
        if (ph.equals("M")) {
            if (nome.equals("process_name")) r.nomeProcesso.put(pid, nomeArg);
            else if (nome.equals("thread_name")) r.nomeThread.put(pid + ":" + tid, nomeArg);
            return;
        }
        String low = nome.toLowerCase(Locale.ROOT);
        // Só o caminho do toque dentro do Chromium (a categoria "input" também traz edição de texto/cursor, que é ruído).
        boolean entrada = low.contains("touch") || low.contains("gesture") || low.contains("inputrouter") || low.contains("inputevent")
                || low.contains("fling") || low.contains("widgetinputhandler") || low.contains("mainthreadeventqueue") || low.contains("inputlatency")
                || low.contains("eventlatency") || low.contains("allowed") || low.contains("pointer") || low.contains("currentlyscrolling")
                || low.equals("generationtobrowsermain") || low.equals("browsermaintorenderercompositor")
                || low.equals("renderercompositorqueueingdelay") || low.equals("renderermainprocessing");
        if (!entrada && dur < TAREFA_LONGA_US) return;
        if (r.linhas.size() >= MAX_EVENTOS) return;
        String quem = (r.nomeProcesso.containsKey(pid) ? r.nomeProcesso.get(pid) : "p" + pid) + "/" + (r.nomeThread.containsKey(pid + ":" + tid) ? r.nomeThread.get(pid + ":" + tid) : "t" + tid);
        String chave = nome + (entrada ? "" : " (tarefa longa)");
        Integer c = r.contagem.get(chave);
        r.contagem.put(chave, c == null ? 1 : c + 1);
        r.linhas.add(new Object[]{ts, quem + " " + ph + " " + nome + (dur > 0 ? " dur=" + Math.round(dur / 1000) + "ms" : "") + " [" + cat + "]" + args});
    }
}
