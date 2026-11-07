// ================================================================
// reparos/pattern-widget.js — VortexSmart · Concertos · Grid de padrão
// Widget único de "desenho tipo Android" (3x3 pontos), reaproveitado
// tanto no formulário (modo interativo, gesto de arraste) quanto no
// card da OS (modo leitura, só mostra o desenho já salvo). Fica num
// arquivo próprio pra não duplicar essa lógica entre reparos/form.js
// e reparos/lista.js.
//
// Gesto de ARRASTE de verdade (pointerdown → move → up), igual ao
// desbloqueio real de Android — não é clique ponto a ponto.
// touch-action:none isola esse gesto do scroll da tela por baixo,
// sem precisar travar a tela inteira (ver .rep-pattern-wrap no CSS).
//
// Expõe via window.*:
//   _reparosRenderPatternGrid(container, opts)
//     opts.sequence   — array de índices 0-8 (padrão já existente, opcional)
//     opts.interactive — true = aceita desenhar; false = só mostra
//     opts.onChange   — chamado com a sequência atual a cada mudança
//   Retorna { reset() } — limpa o desenho (usado pelo botão "Limpar")
// ================================================================
(function () {
    'use strict';

    function renderPatternGrid(container, opts) {
        opts = opts || {};
        const interactive = !!opts.interactive;
        let sequence = Array.isArray(opts.sequence) ? opts.sequence.slice() : [];
        let dragging = false;
        let liveX = null, liveY = null;

        container.innerHTML = `
            <svg class="rep-pattern-svg"></svg>
            <div class="rep-pattern-grid">
                ${[0,1,2,3,4,5,6,7,8].map(i => `<div class="rep-pattern-dot" data-i="${i}"></div>`).join('')}
            </div>`;

        const svg = container.querySelector('.rep-pattern-svg');
        const dots = Array.from(container.querySelectorAll('.rep-pattern-dot'));

        // Centro (em px, relativo ao container) e raio de cada ponto —
        // medido de verdade no DOM, não estimado, pra funcionar em
        // qualquer tamanho de grid (o pequeno do card, o grande do form).
        function centers() {
            const box = container.getBoundingClientRect();
            return dots.map(d => {
                const r = d.getBoundingClientRect();
                return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, raio: r.width / 2 };
            });
        }

        function redraw() {
            dots.forEach((d, i) => d.classList.toggle('hit', sequence.includes(i)));
            const c = centers();
            let svgHtml = '';
            for (let i = 0; i < sequence.length - 1; i++) {
                const a = c[sequence[i]], b = c[sequence[i + 1]];
                svgHtml += `<line class="rep-pattern-linha-confirmada" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
            }
            // Linha "ao vivo" do último ponto travado até onde o dedo tá
            // agora — some quando solta, vira linha fixa se pegar outro ponto.
            if (dragging && sequence.length && liveX != null) {
                const a = c[sequence[sequence.length - 1]];
                svgHtml += `<line class="rep-pattern-linha-previa" x1="${a.x}" y1="${a.y}" x2="${liveX}" y2="${liveY}"/>`;
            }
            svg.innerHTML = svgHtml;
        }

        function posRelativa(e) {
            const box = container.getBoundingClientRect();
            return { x: e.clientX - box.left, y: e.clientY - box.top };
        }

        // Acha o ponto mais próximo do dedo, com uma margem de tolerância
        // pro toque real (impreciso) sem invadir a zona do ponto vizinho —
        // por isso a margem fica abaixo do raio da célula (raio == metade
        // da distância até o próximo ponto), senão o dedo passando perto
        // de um vizinho "rouba" ele mesmo fora do trajeto pretendido.
        function pontoMaisProximo(pos) {
            const c = centers();
            let melhor = -1, menorDist = Infinity;
            c.forEach((ct, i) => {
                const dist = Math.hypot(ct.x - pos.x, ct.y - pos.y);
                if (dist <= ct.raio * 0.85 && dist < menorDist) { melhor = i; menorDist = dist; }
            });
            return melhor;
        }

        if (interactive) {
            container.addEventListener('pointerdown', e => {
                const pos = posRelativa(e);
                const i = pontoMaisProximo(pos);
                if (i === -1) return;
                container.setPointerCapture(e.pointerId);
                dragging = true;
                sequence = [i];
                liveX = pos.x; liveY = pos.y;
                redraw();
                e.preventDefault();
            });
            container.addEventListener('pointermove', e => {
                if (!dragging) return;
                const pos = posRelativa(e);
                liveX = pos.x; liveY = pos.y;
                const i = pontoMaisProximo(pos);
                if (i !== -1 && !sequence.includes(i)) {
                    sequence.push(i);
                    if (typeof opts.onChange === 'function') opts.onChange(sequence);
                }
                redraw();
                e.preventDefault();
            });
            const finalizar = () => {
                if (!dragging) return;
                dragging = false;
                liveX = liveY = null;
                redraw();
                if (typeof opts.onChange === 'function') opts.onChange(sequence);
            };
            container.addEventListener('pointerup', finalizar);
            container.addEventListener('pointercancel', finalizar);
            container.addEventListener('pointerleave', e => { if (dragging && e.buttons === 0) finalizar(); });
        } else {
            container.classList.add('readonly');
        }

        setTimeout(redraw, 30); // espera o layout assentar antes de medir posição dos pontos
        return {
            reset: () => {
                sequence = []; dragging = false; liveX = liveY = null;
                redraw();
                if (typeof opts.onChange === 'function') opts.onChange(sequence);
            }
        };
    }

    window._reparosRenderPatternGrid = renderPatternGrid;
})();
