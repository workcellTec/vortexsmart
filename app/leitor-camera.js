// ================================================================
// leitor-camera.js — VortexSmart · Leitor de código de barras pela câmera (só celular)
//
// window._vsLerCodigoCamera() → Promise<string|null>
//   Abre a câmera em tela cheia, lê UM código e fecha sozinha (nada de ler vários em
//   sequência: quem chamou trata o código e, pra ler outro, abre de novo).
//   Resolve com o texto do código, ou null se a pessoa cancelou/não deu pra ler.
//
// Leitura: usa o BarcodeDetector do próprio navegador quando existe (Chrome no Android);
// nos outros (iPhone, Firefox) carrega sob demanda a biblioteca lib/zxing.min.js.
// A permissão da câmera é pedida na primeira vez, ao abrir. A câmera é desligada de verdade
// (tracks parados) ao ler, cancelar, usar o voltar do Android ou sair do app.
// Nada da imagem sai do aparelho.
//
// Depende de (via window.*): _vsLib (core.js), _vsAbrirModal/_vsFecharModal (voltar do Android)
// ================================================================
(function () {
    'use strict';
    if (document.documentElement.getAttribute('data-shell') !== 'mobile') return;

    const INTERVALO_MS = 120;   // pausa entre tentativas de leitura (~8 por segundo)
    const FORMATOS_NATIVOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
    let sessao = null;          // leitura em andamento (só existe uma por vez)

    const el = (s, cls, html) => { const n = document.createElement(s); if (cls) n.className = cls; if (html) n.innerHTML = html; return n; };

    // ── Decodificador: nativo se o navegador tiver, senão ZXing ──
    async function criarDecodificador() {
        if ('BarcodeDetector' in window) {
            try {
                const suportados = await window.BarcodeDetector.getSupportedFormats();
                const formats = FORMATOS_NATIVOS.filter(f => suportados.includes(f));
                if (formats.length) {
                    const detector = new window.BarcodeDetector({ formats });
                    return async video => { const r = await detector.detect(video); return r.length ? r[0].rawValue : null; };
                }
            } catch (e) { /* cai pro ZXing */ }
        }
        await window._vsLib('zxing');
        const Z = window.ZXing;
        const hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E,
            Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.QR_CODE]);
        hints.set(Z.DecodeHintType.TRY_HARDER, true);
        const leitor = new Z.MultiFormatReader();
        leitor.setHints(hints);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        return async video => {
            const w = video.videoWidth, h = video.videoHeight;
            if (!w || !h) return null;
            // Só a faixa central da imagem (onde fica a moldura): mais rápido e com menos ruído.
            const sw = w, sh = Math.round(h * 0.5);
            canvas.width = sw; canvas.height = sh;
            ctx.drawImage(video, 0, Math.round((h - sh) / 2), sw, sh, 0, 0, sw, sh);
            const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
            try { return leitor.decode(bitmap).getText(); } catch (e) { return null; } // NotFoundException = ainda não achou
        };
    }

    function mensagemDoErro(e) {
        const nome = e && e.name;
        if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'A câmera está bloqueada. Libere o acesso à câmera nas configurações do navegador e tente de novo.';
        if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'Este aparelho não tem uma câmera disponível.';
        if (nome === 'NotReadableError' || nome === 'AbortError') return 'A câmera está sendo usada por outro app. Feche-o e tente de novo.';
        return 'Não foi possível abrir a câmera.';
    }

    // ── Tela ──────────────────────────────────────────────────────
    function montarTela(s) {
        const tela = el('div', 'vs-cam');
        tela.id = 'vsCamera';
        tela.setAttribute('role', 'dialog');
        tela.setAttribute('aria-label', 'Leitor de código de barras');
        s.video = el('video', 'vs-cam-video');
        s.video.setAttribute('playsinline', '');
        s.video.muted = true;
        s.status = el('div', 'vs-cam-status');
        s.status.textContent = 'Abrindo a câmera…';
        const topo = el('div', 'vs-cam-topo');
        const fechar = el('button', 'vs-cam-fechar', '<i class="bi bi-x-lg"></i>');
        fechar.type = 'button';
        fechar.setAttribute('aria-label', 'Fechar');
        fechar.addEventListener('click', () => encerrar(s, null));
        const titulo = el('span', 'vs-cam-titulo');
        titulo.textContent = 'Ler código de barras';
        topo.append(fechar, titulo);
        const moldura = el('div', 'vs-cam-moldura', '<span class="vs-cam-linha"></span>');
        tela.append(s.video, topo, moldura, s.status);
        document.body.appendChild(tela);
        s.tela = tela;
    }

    function pararCamera(s) {
        clearTimeout(s.timer);
        if (s.stream) { s.stream.getTracks().forEach(t => t.stop()); s.stream = null; }
        if (s.video) s.video.srcObject = null;
    }

    // Fecha tudo (idempotente) e entrega o resultado. Só entrega DEPOIS que o histórico assentou:
    // quem recebeu o código pode abrir um aviso na hora, e o history.back() do fechamento é assíncrono.
    function encerrar(s, codigo) {
        if (s.encerrado) return;
        s.encerrado = true;
        pararCamera(s);
        document.removeEventListener('visibilitychange', s.aoSair);
        s.tela.remove();
        const voltaria = !!(history.state && history.state.vsModal);
        if (typeof window._vsFecharModal === 'function') window._vsFecharModal();
        const entregar = () => { if (sessao === s) sessao = null; s.resolver(codigo); };
        if (!voltaria) { entregar(); return; }
        let feito = false;
        const uma = () => { if (feito) return; feito = true; window.removeEventListener('popstate', uma); entregar(); };
        window.addEventListener('popstate', uma);
        setTimeout(uma, 500);
    }

    function falhar(s, texto) {
        if (s.encerrado) return;
        pararCamera(s);
        s.tela.classList.add('vs-cam-erro');
        s.status.textContent = texto;
    }

    // ── Câmera + leitura ──────────────────────────────────────────
    function varrer(s) {
        if (s.encerrado) return;
        s.decodificar(s.video).then(codigo => {
            if (s.encerrado) return;
            const texto = codigo ? String(codigo).trim() : '';
            if (texto) {
                if (navigator.vibrate) navigator.vibrate(60);
                encerrar(s, texto);
                return;
            }
            s.timer = setTimeout(() => varrer(s), INTERVALO_MS);
        }).catch(() => { if (!s.encerrado) s.timer = setTimeout(() => varrer(s), 250); });
    }

    async function iniciar(s) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            falhar(s, 'A câmera não está disponível neste navegador.');
            return;
        }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
        } catch (e) { falhar(s, mensagemDoErro(e)); return; }
        if (s.encerrado) { stream.getTracks().forEach(t => t.stop()); return; } // fechou enquanto pedia a permissão
        s.stream = stream;
        s.video.srcObject = stream;
        try { await s.video.play(); } catch (e) { falhar(s, 'Não foi possível abrir a câmera.'); return; }
        s.status.textContent = 'Carregando o leitor…';
        try { s.decodificar = await criarDecodificador(); } catch (e) { falhar(s, 'Não foi possível carregar o leitor. Confira a conexão e tente de novo.'); return; }
        if (s.encerrado) return;
        s.status.textContent = 'Aponte para o código de barras';
        varrer(s);
    }

    window._vsLerCodigoCamera = function () {
        if (sessao) return sessao.promessa;
        const s = { encerrado: false, stream: null, timer: null };
        s.promessa = new Promise(resolve => { s.resolver = resolve; });
        sessao = s;
        s.aoSair = () => { if (document.visibilityState === 'hidden') encerrar(s, null); }; // câmera nunca fica ligada em segundo plano
        document.addEventListener('visibilitychange', s.aoSair);
        montarTela(s);
        if (typeof window._vsAbrirModal === 'function') window._vsAbrirModal(() => encerrar(s, null), { empilhar: true }); // voltar do Android fecha a câmera (e só ela, se estiver por cima de um formulário)
        iniciar(s);
        return s.promessa;
    };
})();
