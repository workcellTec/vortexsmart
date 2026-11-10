package app.vortexsmart;

import android.accessibilityservice.AccessibilityService;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

/**
 * SÓ NA BUILD DE TESTE (pasta debug: nunca entra no APK de release). Imita o que um serviço de acessibilidade que lê a tela
 * (leitor, "escolha segura", auto-clicker) faz no aparelho: pede o conteúdo das janelas e percorre a árvore de acessibilidade
 * a cada mudança. Serve pra testar, no emulador, se ter um serviço assim ligado atrapalha os toques no WebView.
 */
public class ServicoAcessibilidadeTeste extends AccessibilityService {
    private long ultimaLeitura;

    @Override
    public void onAccessibilityEvent(AccessibilityEvent evento) {
        long agora = SystemClock.uptimeMillis();
        if (agora - ultimaLeitura < 100) return;   // no máximo uma leitura completa a cada 100 ms
        ultimaLeitura = agora;
        AccessibilityNodeInfo raiz = getRootInActiveWindow();
        if (raiz != null) {
            percorrer(raiz);
            raiz.recycle();
        }
    }

    private int percorrer(AccessibilityNodeInfo no) {
        int total = 1;
        no.getText();   // um leitor de tela lê o texto de cada nó
        for (int i = 0; i < no.getChildCount(); i++) {
            AccessibilityNodeInfo filho = no.getChild(i);
            if (filho == null) continue;
            total += percorrer(filho);
            filho.recycle();
        }
        return total;
    }

    @Override
    public void onInterrupt() { }
}
