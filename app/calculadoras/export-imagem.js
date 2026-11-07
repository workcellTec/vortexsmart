// ================================================================
// calculadoras/export-imagem.js — VortexSmart · Exportar Imagem (compartilhado)
// Usado por Repassar Valores, Calcular Empréstimo e Calcular por Aparelho
// (Fechar Venda NÃO usa isso — resultado é único, não uma tabela de opções).
//
// Desenha DIRETO no Canvas (sem html2canvas) — mais rápido e confiável.
// html2canvas captura HTML/CSS renderizado, o que é pesado e, testado na
// prática, trava/demora demais em alguns aparelhos. Canvas 2D nativo
// desenha só o que precisa, sem esse overhead.
//
// A cor de destaque e o nome da loja vêm do MESMO lugar que já colore a
// barra dos documentos de garantia (configuracoes/documentos).
//
// Depende de (via window.*):
//   showCustomModal, _lojaRef, _dbGet
// Expõe via window.*:
//   _calcExportarImagem({ badge: {texto}, linhas, arquivoSufixo })
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const fmtMoeda = v => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const CFG_PATH = 'configuracoes/documentos';
    const COR_PADRAO = '#16a34a';
    let identidadeCache = null;

    // Quem salva Configurações → Documentos chama isto pra a próxima imagem já sair com o nome/cor novos.
    window._calcInvalidarIdentidade = function () { identidadeCache = null; };

    async function carregarIdentidade() {
        if (identidadeCache) return identidadeCache;
        try {
            const snap = await window._dbGet(window._lojaRef(CFG_PATH));
            const dados = snap.val() || {};
            identidadeCache = {
                storeName: (dados.storeName || window._nomeLojaCadastrada || 'MINHA LOJA').toUpperCase(),
                corBarra: dados.storeCorBarra || COR_PADRAO,
            };
        } catch (e) {
            // Falha de leitura NÃO fica guardada: tenta de novo na próxima imagem.
            return { storeName: (window._nomeLojaCadastrada || 'MINHA LOJA').toUpperCase(), corBarra: COR_PADRAO };
        }
        return identidadeCache;
    }
    window._calcInvalidarCacheIdentidade = () => { identidadeCache = null; };

    // ── Helpers de desenho ──────────────────────────────────────────
    function roundRect(ctx, x, y, w, h, r) {
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }
    function hexRgb(hex) {
        const h = (hex || '#16a34a').replace('#', '');
        const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        const num = parseInt(n, 16);
        return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }
    function corComOpacidade(hex, alpha) {
        const { r, g, b } = hexRgb(hex);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    function corContrasteTexto(hex) {
        const { r, g, b } = hexRgb(hex);
        const luminancia = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminancia > 0.62 ? '#0f172a' : '#ffffff';
    }
    async function garantirFonte() {
        try {
            await Promise.all([
                document.fonts.load('900 32px Poppins'),
                document.fonts.load('800 16px Poppins'),
                document.fonts.load('700 16px Poppins'),
                document.fonts.load('400 14px Poppins'),
            ]);
        } catch (e) {}
    }

    // ── Desenha 1 card (parcela ou débito) ───────────────────────────
    function desenharCard(ctx, x, y, w, h, item, corBarra) {
        roundRect(ctx, x, y, w, h, 12);
        ctx.fillStyle = '#f8fafc';
        ctx.fill();
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.stroke();

        const raio = Math.min(h / 2 - 14, 40);
        const ccx = x + 30 + raio;
        const ccy = y + h / 2;
        ctx.beginPath();
        ctx.arc(ccx, ccy, raio, 0, Math.PI * 2);
        ctx.fillStyle = item.debit ? '#f1f5f9' : corBarra;
        ctx.fill();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = item.debit ? '#64748b' : corContrasteTexto(corBarra);
        ctx.font = `800 ${item.debit ? 20 : 22}px Poppins, sans-serif`;
        ctx.fillText(item.debit ? 'Déb' : item.inst, ccx, ccy + 2);

        const textX = ccx + raio + 26;
        const labelY = y + h * 0.34;
        const valueY = y + h * 0.68;

        ctx.textAlign = 'left';
        ctx.font = '700 17px Poppins, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('PARCELA', textX, labelY);
        ctx.font = '800 27px Poppins, sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.fillText(item.debit ? '–' : fmtMoeda(item.parcela), textX, valueY);

        const rightX = x + w - 26;
        ctx.textAlign = 'right';
        ctx.font = '700 17px Poppins, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('TOTAL', rightX, labelY);
        ctx.font = '800 27px Poppins, sans-serif';
        ctx.fillStyle = corBarra;
        ctx.fillText(fmtMoeda(item.total), rightX, valueY);
    }

    // ── Função pública ──────────────────────────────────────────────
    // badge: { texto: string }
    // linhas: [{ inst, parcela, total, debit }]
    // notaEntrada: string opcional (ex: "+ R$ 100,00 de entrada à vista no dinheiro ou pix")
    async function calcExportarImagem({ badge, linhas, arquivoSufixo, notaEntrada }) {
        if (!linhas || !linhas.length) { modal({ message: 'Nenhum valor para exportar.' }); return; }

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="width:50px;height:50px;border:4px solid rgba(255,255,255,.15);border-top-color:#2979FF;border-radius:50%;animation:vsExpSpin .8s linear infinite;margin-bottom:16px;"></div>
            <style>@keyframes vsExpSpin{to{transform:rotate(360deg)}}</style>
            <span style="color:#fff;font-family:Poppins,sans-serif;font-size:1rem;">Criando Imagem...</span>`;
        document.body.appendChild(overlay);

        try {
            await garantirFonte();
            const { storeName, corBarra } = await carregarIdentidade();

            const W = 1200;
            const H = 1600;
            const PAD = 60;
            const COL_GAP = 24;
            const COL_W = (W - PAD * 2 - COL_GAP) / 2;
            const GAP_Y = 16;

            const debitLinha = linhas.find(l => l.debit);
            const parcelaLinhas = linhas.filter(l => !l.debit);
            const metade = Math.ceil(parcelaLinhas.length / 2);
            const col1 = parcelaLinhas.slice(0, metade);
            const col2 = parcelaLinhas.slice(metade);
            const linhasCol1 = debitLinha ? [debitLinha, ...col1] : col1;
            const linhasCol2 = col2;
            const nLinhas = Math.max(linhasCol1.length, linhasCol2.length, 1);
            const FOOTER_H = 190;

            const canvas = document.createElement('canvas');
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext('2d');

            // Fundo branco
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);

            // Cabeçalho: nome da loja em 2 tons
            const partes = storeName.split(' ');
            const primeira = partes[0] || '';
            const resto = partes.slice(1).join(' ');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.font = '900 52px Poppins, sans-serif';
            let ty = 78;
            ctx.fillStyle = '#0f172a';
            ctx.fillText(primeira, W / 2, ty);
            if (resto) {
                ty += 58;
                ctx.fillStyle = corBarra;
                ctx.fillText(resto, W / 2, ty);
            }

            // Badge (pílula) — nome do produto, só texto, sem bolinha de cor
            ctx.font = '800 30px Poppins, sans-serif';
            const textoW = ctx.measureText(badge.texto).width;
            const badgeW = Math.min(W - 140, textoW + 80);
            const badgeH = 74;
            const badgeX = (W - badgeW) / 2;
            const badgeY = ty + 40;
            roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
            ctx.fillStyle = corBarra;
            ctx.fill();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = corContrasteTexto(corBarra);
            const maxTextoW = badgeW - 60;
            let textoBadge = badge.texto;
            while (ctx.measureText(textoBadge).width > maxTextoW && textoBadge.length > 3) {
                textoBadge = textoBadge.slice(0, -1);
            }
            if (textoBadge !== badge.texto) textoBadge = textoBadge.slice(0, -1) + '…';
            ctx.fillText(textoBadge, W / 2, badgeY + badgeH / 2 + 2);

            // Nota de entrada (opcional) — pílula própria, cor de destaque (âmbar),
            // logo abaixo do nome do produto. Largura calculada e truncada com "…"
            // pra nunca estourar o canvas nem invadir a área dos cards.
            let headerBottom = badgeY + badgeH;
            if (notaEntrada) {
                const notaY = headerBottom + 22;
                const notaH = 58;
                ctx.font = '800 25px Poppins, sans-serif';
                const notaPadX = 32;
                let notaTexto = notaEntrada;
                const notaMaxW = W - 160;
                while (ctx.measureText(notaTexto).width + notaPadX * 2 > notaMaxW && notaTexto.length > 3) {
                    notaTexto = notaTexto.slice(0, -1);
                }
                if (notaTexto !== notaEntrada) notaTexto = notaTexto.slice(0, -1) + '…';
                const notaW = Math.min(notaMaxW, ctx.measureText(notaTexto).width + notaPadX * 2);
                const notaX = (W - notaW) / 2;
                roundRect(ctx, notaX, notaY, notaW, notaH, notaH / 2);
                ctx.fillStyle = '#fef3c7';
                ctx.fill();
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#92400e';
                ctx.fillText(notaTexto, W / 2, notaY + notaH / 2 + 2);
                headerBottom = notaY + notaH;
            }

            const HEADER_H = Math.max(300, headerBottom + 40);
            const alturaDisponivel = H - HEADER_H - FOOTER_H;
            // Card cresce/encolhe pra sempre preencher o mesmo espaço disponível,
            // seja 12x (poucas linhas, cards maiores) ou 21x (mais linhas,
            // cards menores) — a FONTE não muda de tamanho, só o card.
            let cardH = (alturaDisponivel - (nLinhas - 1) * GAP_Y) / nLinhas;
            cardH = Math.max(64, Math.min(170, cardH));

            // Cards
            let y0 = HEADER_H;
            for (let i = 0; i < nLinhas; i++) {
                if (linhasCol1[i]) desenharCard(ctx, PAD, y0 + i * (cardH + GAP_Y), COL_W, cardH, linhasCol1[i], corBarra);
                if (linhasCol2[i]) desenharCard(ctx, PAD + COL_W + COL_GAP, y0 + i * (cardH + GAP_Y), COL_W, cardH, linhasCol2[i], corBarra);
            }

            // Rodapé
            let fy = H - FOOTER_H + 50;
            ctx.font = '700 26px Poppins, sans-serif';
            const footTxt = 'Válido por tempo limitado ⚠️';
            const footW = ctx.measureText(footTxt).width + 88;
            roundRect(ctx, (W - footW) / 2, fy - 40, footW, 80, 40);
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#334155';
            ctx.fillText(footTxt, W / 2, fy);

            fy += 70;
            ctx.font = '400 22px Poppins, sans-serif';
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText('Gerado via App VortexSmart', W / 2, fy);

            // Exporta
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Não foi possível gerar o PNG.');
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${storeName.replace(/\s/g, '-')}-${arquivoSufixo || 'parcelas'}.png`;
            link.click();
            URL.revokeObjectURL(url);

            modal({ message: '✅ Imagem salva com sucesso!' });
        } catch (e) {
            console.error('[export-imagem] erro:', e);
            modal({ message: 'Erro ao gerar imagem: ' + (e?.message || e) });
        } finally {
            overlay.remove();
        }
    }

    window._calcExportarImagem = calcExportarImagem;

})();
