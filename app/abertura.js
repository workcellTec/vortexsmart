// ================================================================
// abertura.js — VortexSmart · tela de abertura (substitui o "Carregando...")
// Roda logo depois do #loadingOverlay, antes do core.js. O redemoinho aparece,
// gira e acelera; quando o app termina de carregar (core.js chama
// window._vsAbertura.fechar()) ele "mergulha": cresce e o app aparece por
// dentro dele. Dura ~2s no mínimo; se o app demorar, segue girando.
// Fica sempre escura (igual ao splash do app): celular = cinza chapado, PC = azul
// escuro com brilho. Movimento reduzido ou aparelho fraco: só um fade.
// Expõe via window.*: _vsAbertura.fechar()
// ================================================================
(function () {
    'use strict';
    const ov = document.getElementById('loadingOverlay');
    if (!ov) return;
    const NS = 'http://www.w3.org/2000/svg';
    const pc = document.documentElement.getAttribute('data-shell') === 'pc';
    const BG = pc ? '#07101f' : '#141517';
    const K = pc ? 1.05 : 0.78;                  // tamanho do redemoinho
    const MIN_MS = 1150;                         // tempo mínimo antes de poder abrir (a aceleração)
    const VOLTA = 900;                           // ms por volta depois de acelerar
    const reduzido = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const fraco = !!(navigator.deviceMemory && navigator.deviceMemory <= 2);
    const simples = reduzido || fraco;           // sem giro nem mergulho, só fade
    const t0 = performance.now();
    let fechando = false, volta = null;

    // Braços do redemoinho: espirais que afunilam nas duas pontas.
    const BRACOS = 5;
    function braco(i) {
        const N = 26, a0 = i * (360 / BRACOS), ext = [], inn = [];
        for (let j = 0; j <= N; j++) {
            const t = j / N, r = 17 + 78 * Math.pow(t, 0.9), th = (a0 + t * 118) * Math.PI / 180;
            const w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.04)), 0.75) * (17 + 10 * t) / r;
            ext.push([r * Math.cos(th + w), r * Math.sin(th + w)]);
            inn.push([r * Math.cos(th - w), r * Math.sin(th - w)]);
        }
        const f = p => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
        return 'M' + ext.map(f).join('L') + 'L' + inn.reverse().map(f).join('L') + 'Z';
    }
    const bracos = Array.from({ length: BRACOS }, (_, i) => `<path d="${braco(i)}"/>`).join('');
    const satelites = `
        <g class="sat" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
            <g transform="translate(-92 -78) rotate(-14)"><rect x="-12" y="-20" width="24" height="40" rx="6" fill="#fff" fill-opacity=".14"/><path d="M-4 14h8"/></g>
            <g transform="translate(94 -4) rotate(12)"><rect x="-17" y="-19" width="34" height="38" rx="6" fill="#fff" fill-opacity=".14"/><path d="M-9 -9h18M-9 3h2M0 3h2M-9 11h2M0 11h2" stroke-width="4.5"/></g>
            <g transform="translate(-26 96)"><circle r="19" fill="#fff" fill-opacity=".16"/><path d="M5 -8c-3 -4 -11 -3 -11 2s11 3 11 8 -8 6 -12 2M0 -13v26" stroke-width="4"/></g>
        </g>`;

    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;';
    ov.setAttribute('role', 'status');
    ov.setAttribute('aria-label', 'Carregando VortexSmart');
    // Sem viewBox em pixels: retângulos em % e o centro vem de um <svg> aninhado em 50%/50%,
    // então acompanha qualquer tamanho de janela sem JS.
    const DY = pc ? -14 : -10;                    // sobe um pouco, pro nome caber embaixo
    ov.innerHTML = `
        <svg class="vsa" style="position:absolute;inset:0;width:100%;height:100%;display:block" aria-hidden="true">
            <defs>
                <linearGradient id="vsa-gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9b84ff"/><stop offset="1" stop-color="#4f9bff"/></linearGradient>
                <radialGradient id="vsa-gl" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#6d4dff" stop-opacity=".45"/><stop offset="1" stop-color="#6d4dff" stop-opacity="0"/></radialGradient>
                <g id="vsa-vx">${bracos}</g>
                <mask id="vsa-mk" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
                    <rect width="100%" height="100%" fill="#fff"/>
                    <svg x="50%" y="50%" overflow="visible"><g transform="translate(0 ${DY}) scale(${K})"><g class="vsa-zm"><g class="vsa-rm" fill="#000"><circle r="19"/><use href="#vsa-vx"/></g></g></g></svg>
                </mask>
            </defs>
            <g mask="url(#vsa-mk)">
                <rect width="100%" height="100%" fill="${BG}"/>
                ${pc ? '<ellipse class="vsa-glow" cx="50%" cy="50%" rx="42%" ry="55%" fill="url(#vsa-gl)" style="opacity:0"/>' : ''}
            </g>
            <svg x="50%" y="50%" overflow="visible"><g transform="translate(0 ${DY}) scale(${K})"><g class="vsa-zv"><g class="vsa-logo" style="opacity:0">
                <g class="vsa-rv"><use href="#vsa-vx" fill="url(#vsa-gr)"/></g>
                <circle class="vsa-core" r="19" fill="${BG}"/>
                ${satelites}
            </g></g></g></svg>
        </svg>
        <div class="vsa-nome" style="position:absolute;left:0;right:0;top:calc(50% + ${Math.round(DY + 118 * K + 34)}px);text-align:center;font:800 ${pc ? 15 : 13}px system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.06em;color:#cfd3ff;opacity:0">VORTEXSMART</div>`;

    const q = s => ov.querySelector(s);
    const rot = [q('.vsa-rv'), q('.vsa-rm')], zoom = [q('.vsa-zv'), q('.vsa-zm')];
    const logo = q('.vsa-logo'), nome = q('.vsa-nome'), sat = q('.sat'), glow = q('.vsa-glow');

    function terminar() {
        ov.classList.add('d-none');
    }
    function fade(ms) {
        ov.style.pointerEvents = 'none';
        const a = ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: 'forwards' });
        a.onfinish = terminar;
    }

    // ── Entrada ──
    logo.animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'scale(1)' }], { duration: simples ? 200 : 480, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    nome.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 450, delay: simples ? 0 : 250, fill: 'forwards', easing: 'ease-out' });
    if (glow) glow.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, fill: 'forwards' });
    if (!simples) {
        sat.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-360deg)' }], { duration: 2600, iterations: Infinity });
        // acelera 0 -> 420 graus e depois segue em velocidade constante
        const acel = rot.map(e => e.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(420deg)' }], { duration: MIN_MS - 50, easing: 'cubic-bezier(.45,0,.9,.6)', fill: 'forwards' }));
        acel[0].onfinish = () => {
            if (fechando) return;
            volta = rot.map(e => e.animate([{ transform: 'rotate(420deg)' }, { transform: 'rotate(780deg)' }], { duration: VOLTA, iterations: Infinity }));
        };
    }

    // ── Saída: chamada pelo core.js quando o app está pronto ──
    function mergulhar() {
        const ang = volta ? 420 + ((volta[0].currentTime % VOLTA) / VOLTA) * 360 : 420;
        rot.forEach(e => { e.getAnimations().forEach(a => a.cancel()); e.style.transform = `rotate(${ang}deg)`; });
        ov.style.pointerEvents = 'none';
        sat.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
        nome.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
        if (glow) glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: 'forwards' });
        q('.vsa-rv').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
        q('.vsa-core').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' });
        rot.forEach(e => e.animate([{ transform: `rotate(${ang}deg)` }, { transform: `rotate(${ang + 260}deg)` }], { duration: 800, easing: 'cubic-bezier(.6,0,.9,.5)', fill: 'forwards' }));
        const z = zoom.map(e => e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1)', offset: 0.05 }, { transform: 'scale(70)' }], { duration: 800, easing: 'cubic-bezier(.7,0,.95,.4)', fill: 'forwards' }));
        z[0].onfinish = terminar;
    }
    window._vsAbertura = {
        fechar() {
            if (fechando) return;
            fechando = true;
            const espera = Math.max(0, MIN_MS - (performance.now() - t0));
            setTimeout(() => (simples ? fade(250) : mergulhar()), simples ? Math.max(0, 600 - (performance.now() - t0)) : espera);
        }
    };
})();
