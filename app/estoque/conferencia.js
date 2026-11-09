// ================================================================
// estoque/conferencia.js — VortexSmart · Estoque · Conferência
// Visual: consistente com Produtos (card expansível, anel de status)
// Node real: /products (mesmo node usado pela Calculadora por Aparelho)
// Campos usados: nome, quantidade, ignorarContagem, cores?[{nome,hex}]
// "Ocultar da Conferência" é decidido AQUI (grava ignorarContagem
// direto no Firebase) — Produtos não tem esse controle.
//
// Rascunho da contagem em andamento vive na NUVEM (não mais localStorage),
// em /estoqueConferenciaAtual — isso permite começar num celular e
// terminar em outro. Só existe 1 conferência ativa por vez.
//
// Ao finalizar, grava o registro completo em /estoqueConferencias/{id}
// (histórico), que fica disponível pra reabrir/baixar o PDF depois.
//
// Expõe via window.*:
//   _renderEstoqueConferencia
// Depende de (via window.*):
//   showCustomModal, escapeHtml, products (populado pelo core.js),
//   _lojaRef, _dbUpdate, _dbPush, _dbGet, _dbRemove,
//   jspdf (global, carregado sob demanda via window._vsLib)
// ================================================================
(function () {
    'use strict';

    const DRAFT_PATH = 'estoqueConferenciaAtual';

    const el  = id => document.getElementById(id);
    const esc = t  => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : t;

    let mounted = false;
    let itens = [];          // [{ id, nome, sistemaQtd, contado, cores:[{nome,hex}], coresAtivas:[nome], oculto }]
    let expandedId = null;
    let busca = '';
    let somenteOcultos = false;
    let addingCorId = null;
    let mostrandoHistorico = false;
    let carregando = true;

    // ── Skeleton ──────────────────────────────────────────────────
    function ensureSkeleton() {
        const container = el('estoqueConferencia');
        if (!container || mounted) return;
        container.classList.add('stq-neon');
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Conferência</h3>
                <div style="grid-column:3;justify-self:end;display:flex;gap:6px;align-items:center;">
                    <button class="stq-conf-header-hist" id="stqConfHistBtn" title="Histórico de conferências"><i class="bi bi-clock-history"></i></button>
                    <button class="stq-conf-header-finalize" id="stqConfFinalizarBtn"><i class="bi bi-file-earmark-pdf-fill"></i> Finalizar</button>
                </div>
            </div>
            <div class="stq-conf-search-row">
                <input class="form-control" id="stqConfBusca" type="text" placeholder="Buscar produto na contagem..."/>
                <button class="stq-conf-filtro-oculto" id="stqConfFiltroOculto" title="Mostrar só ocultos"><i class="bi bi-eye-slash-fill"></i></button>
            </div>
            <div class="stq-conf-progress-block">
                <div class="stq-conf-progress-wrap"><div class="stq-conf-progress-fill" id="stqConfProgressFill" style="width:0%;"></div></div>
                <div class="stq-conf-progress-label" id="stqConfProgressLabel">Carregando...</div>
            </div>
            <div id="stqConfList" class="stq-conf-list"></div>
            <div id="stqConfEmpty" class="stq-empty" style="display:none;">
                <i class="bi bi-clipboard2-x"></i>
                <h4>Nenhum produto encontrado</h4>
                <p class="text-secondary small">Tente outro termo de busca ou tire o filtro de ocultos.</p>
            </div>
        `;
        el('stqConfFinalizarBtn')?.addEventListener('click', finalizarConferencia);
        el('stqConfHistBtn')?.addEventListener('click', () => {
            mostrandoHistorico = !mostrandoHistorico;
            if (mostrandoHistorico) abrirHistorico();
            else renderLista();
        });
        el('stqConfBusca')?.addEventListener('input', e => { busca = e.target.value; renderLista(); });
        el('stqConfFiltroOculto')?.addEventListener('click', () => {
            somenteOcultos = !somenteOcultos;
            el('stqConfFiltroOculto').classList.toggle('active', somenteOcultos);
            renderLista();
        });
        mounted = true;
    }

    // ── Rascunho na nuvem (multi-dispositivo) ─────────────────────
    function carregarDraft() {
        return window._dbGet(window._lojaRef(DRAFT_PATH)).then(snap => snap.val()).catch(() => null);
    }

    function salvarProgressoItem(it) {
        window._dbUpdate(window._lojaRef(DRAFT_PATH), {
            iniciadoEm: window._stqConfIniciadoEm || Date.now(),
            [`itens/${it.id}`]: { contado: it.contado, coresAtivas: it.coresAtivas }
        }).catch(() => {});
    }

    function limparDraft() {
        window._dbRemove(window._lojaRef(DRAFT_PATH)).catch(() => {});
    }

    // ── Monta a lista de itens a conferir (todos os produtos —
    //    inclusive os ocultos, pra dar pra desocultar aqui) ───────
    function montarItens() {
        carregando = true;
        return carregarDraft().then(draft => {
            window._stqConfIniciadoEm = draft && draft.iniciadoEm ? draft.iniciadoEm : Date.now();
            const draftItens = (draft && draft.itens) ? draft.itens : {};
            // Arquivados nem entram na conferência — são tratados como
            // "fora de circulação", diferente de ignorarContagem (que
            // ainda aparece na lista, só marcado como oculto).
            // Na ordem da prateleira (Produtos › Organizar), pra contar na sequência em que o estoque está arrumado.
            const ativos = (window.products || []).filter(p => !p.arquivado);
            const produtos = typeof window._estoqueOrdenarPrateleira === 'function' ? window._estoqueOrdenarPrateleira(ativos) : ativos;
            itens = produtos.map(p => {
                const d = draftItens[p.id];
                const cores = Array.isArray(p.cores) ? p.cores.map(c => ({ nome: c.nome, hex: c.hex || '#666666' })) : [];
                return {
                    id: p.id,
                    nome: p.nome || '(sem nome)',
                    sistemaQtd: p.quantidade || 0,
                    contado: (d && typeof d.contado === 'number') ? d.contado : null,
                    cores,
                    coresAtivas: (d && Array.isArray(d.coresAtivas)) ? d.coresAtivas : cores.map(c => c.nome),
                    oculto: !!p.ignorarContagem
                };
            });
            carregando = false;
        });
    }

    // ── Progresso (Finalizar sempre liberado, mesmo incompleto) ───
    function atualizarProgresso() {
        const contaveis = itens.filter(it => !it.oculto);
        const contados = contaveis.filter(it => it.contado !== null).length;
        const pct = contaveis.length ? Math.round((contados / contaveis.length) * 100) : 0;
        el('stqConfProgressFill').style.width = `${pct}%`;
        const totalOcultos = itens.filter(it => it.oculto).length;
        el('stqConfProgressLabel').textContent = `${contados} de ${contaveis.length} contados` + (totalOcultos ? ` · ${totalOcultos} oculto(s)` : '');
    }

    function statusClasse(it) {
        if (it.contado === null) return 'pend';
        return it.contado === it.sistemaQtd ? 'ok' : 'diff';
    }

    function renderCardHtml(it) {
        return `
            <div class="stq-conf-card ${it.oculto ? 'oculto' : ''} ${expandedId === it.id ? 'expanded' : ''}" data-id="${it.id}">
                <div class="stq-conf-main" data-action="toggle">
                    <div class="stq-conf-ring ${statusClasse(it)}">${it.contado === null ? '—' : it.contado}</div>
                    <div class="stq-conf-info">
                        <div class="stq-conf-nome">${esc(it.nome)}</div>
                        <div class="stq-conf-sys">Sistema: ${it.sistemaQtd} un.${it.oculto ? ' · oculto' : ''}</div>
                    </div>
                    <i class="bi bi-chevron-right stq-conf-chev"></i>
                </div>
                <div class="stq-conf-panel">${expandedId === it.id ? renderPainel(it) : ''}</div>
            </div>
        `;
    }

    // Se um item vier com formato inesperado, isola o erro nesse card
    // em vez de travar a lista inteira.
    function renderCardSafe(it) {
        try {
            return renderCardHtml(it);
        } catch (e) {
            console.error('Erro ao renderizar produto na Conferência:', it, e);
            return `
                <div class="stq-conf-card" data-id="${it.id || ''}">
                    <div class="stq-conf-main">
                        <div class="stq-conf-ring diff"><i class="bi bi-exclamation-triangle"></i></div>
                        <div class="stq-conf-info">
                            <div class="stq-conf-nome">${esc(it.nome || 'Produto com erro')}</div>
                            <div class="stq-conf-sys" style="color:var(--danger);">Erro ao carregar — veja o console</div>
                        </div>
                    </div>
                </div>`;
        }
    }

    // ── Render da lista ──────────────────────────────────────────
    function renderLista() {
        const listEl = el('stqConfList');
        const emptyEl = el('stqConfEmpty');
        if (!listEl) return;

        if (carregando) {
            listEl.innerHTML = `<div class="stq-hist-loading">Carregando contagem...</div>`;
            if (emptyEl) emptyEl.style.display = 'none';
            return;
        }

        let visiveis = itens.filter(it => !busca || it.nome.toLowerCase().includes(busca.toLowerCase()));
        if (somenteOcultos) visiveis = visiveis.filter(it => it.oculto);

        if (!visiveis.length) {
            listEl.innerHTML = '';
            if (emptyEl) emptyEl.style.display = '';
            atualizarProgresso();
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';

        listEl.innerHTML = visiveis.map(it => renderCardSafe(it)).join('');

        listEl.querySelectorAll('.stq-conf-card').forEach(cardEl => {
            const id = cardEl.dataset.id;
            const it = itens.find(x => x.id === id);
            if (!it) return;
            cardEl.querySelector('[data-action="toggle"]').addEventListener('click', () => {
                expandedId = (expandedId === id) ? null : id;
                addingCorId = null;
                renderLista();
            });
            if (expandedId === id) bindPainelEvents(cardEl, it);
        });

        atualizarProgresso();
    }

    // ── Painel expandido: stepper, cores, ocultar, confirmar ──────
    function renderPainel(it) {
        return `
            <div class="stq-conf-panel-label">Quantidade contada</div>
            <div class="stq-conf-stepper">
                <button data-action="menos"><i class="bi bi-dash"></i></button>
                <div class="val">${it.contado === null ? 0 : it.contado}</div>
                <button data-action="mais"><i class="bi bi-plus"></i></button>
            </div>
            ${it.cores.length ? `
            <div class="stq-conf-panel-label">Cores presentes</div>
            <div class="stq-conf-cores-row">
                ${it.cores.map(c => `
                    <button type="button" class="stq-conf-cor-chip ${it.coresAtivas.includes(c.nome) ? 'active' : ''}" data-action="cor" data-cor="${esc(c.nome)}">
                        <span class="dot" style="background:${esc(c.hex)};"></span>${esc(c.nome)}
                    </button>`).join('')}
            </div>` : ''}
            ${addingCorId === it.id ? `
                <div class="stq-conf-cor-add-row">
                    <input type="text" id="stqConfNovaCorNome" placeholder="Nome da cor..."/>
                    <input type="color" id="stqConfNovaCorHex" value="#8b5cf6"/>
                    <button type="button" data-action="confirmar-cor">OK</button>
                </div>
            ` : `<button type="button" class="stq-conf-cor-add-toggle" data-action="abrir-add-cor"><i class="bi bi-plus-circle"></i> Adicionar cor nova</button><br/>`}
            <div class="stq-conf-bottom-row" style="margin-top:10px;">
                <button type="button" class="stq-conf-hide-btn ${it.oculto ? 'active' : ''}" data-action="ocultar">
                    <i class="bi ${it.oculto ? 'bi-eye-fill' : 'bi-eye-slash-fill'}"></i> ${it.oculto ? 'Mostrar' : 'Ocultar'}
                </button>
                <button type="button" class="stq-conf-ok-btn" data-action="confirmar"><i class="bi bi-check-lg"></i> Confirmar</button>
            </div>
        `;
    }

    function bindPainelEvents(cardEl, it) {
        cardEl.querySelector('[data-action="menos"]')?.addEventListener('click', e => {
            e.stopPropagation();
            it.contado = Math.max(0, (it.contado ?? 0) - 1);
            salvarProgressoItem(it);
            renderLista();
        });
        cardEl.querySelector('[data-action="mais"]')?.addEventListener('click', e => {
            e.stopPropagation();
            it.contado = (it.contado ?? 0) + 1;
            salvarProgressoItem(it);
            renderLista();
        });
        cardEl.querySelectorAll('[data-action="cor"]').forEach(chip => {
            chip.addEventListener('click', e => {
                e.stopPropagation();
                const cor = chip.dataset.cor;
                if (it.coresAtivas.includes(cor)) it.coresAtivas = it.coresAtivas.filter(c => c !== cor);
                else it.coresAtivas.push(cor);
                salvarProgressoItem(it);
                renderLista();
            });
        });
        cardEl.querySelector('[data-action="abrir-add-cor"]')?.addEventListener('click', e => {
            e.stopPropagation();
            addingCorId = it.id;
            renderLista();
        });
        cardEl.querySelector('[data-action="confirmar-cor"]')?.addEventListener('click', e => {
            e.stopPropagation();
            const nome = (el('stqConfNovaCorNome')?.value || '').trim();
            const hex = el('stqConfNovaCorHex')?.value || '#8b5cf6';
            if (!nome) return;
            it.cores.push({ nome, hex });
            it.coresAtivas.push(nome);
            addingCorId = null;
            salvarProgressoItem(it);
            window._dbUpdate(window._lojaRef(`products/${it.id}`), { cores: it.cores }).catch(() => {});
            renderLista();
        });
        cardEl.querySelector('[data-action="ocultar"]')?.addEventListener('click', e => {
            e.stopPropagation();
            it.oculto = !it.oculto;
            window._dbUpdate(window._lojaRef(`products/${it.id}`), { ignorarContagem: it.oculto }).catch(() => {});
            renderLista();
        });
        cardEl.querySelector('[data-action="confirmar"]')?.addEventListener('click', e => {
            e.stopPropagation();
            if (it.contado === null) it.contado = 0;
            expandedId = null;
            salvarProgressoItem(it);
            renderLista();
        });
    }

    // ── Finalizar: pode a qualquer momento, mesmo incompleto ──────
    function finalizarConferencia() {
        const contaveis = itens.filter(it => !it.oculto);
        const naoContados = contaveis.filter(it => it.contado === null).length;
        const aviso = naoContados > 0
            ? `Ainda tem ${naoContados} produto(s) não contado(s) — eles vão aparecer como "Não contado" no PDF. Finalizar mesmo assim?`
            : 'Finalizar a conferência e gerar o PDF?';
        window.showCustomModal({
            message: aviso,
            onConfirm: () => {
                const dataFinalizacao = Date.now();
                const itensParaSalvar = contaveis.map(it => ({
                    id: it.id, nome: it.nome, sistemaQtd: it.sistemaQtd,
                    contado: it.contado, cores: it.coresAtivas
                }));
                gerarPDF(itensParaSalvar, dataFinalizacao);
                salvarHistorico(itensParaSalvar, dataFinalizacao);
                limparDraft();
                window.showCustomModal({ message: 'Conferência finalizada. Gerando PDF...' });
                if (typeof window.openEstoqueSection === 'function') window.openEstoqueSection('estoqueHome', null, true);
            },
            onCancel: () => {}
        });
    }

    function salvarHistorico(itensParaSalvar, dataFinalizacao) {
        if (!window._lojaId) return;
        window._dbPush(window._lojaRef('estoqueConferencias'), {
            finalizadoEm: dataFinalizacao,
            itens: itensParaSalvar
        }).catch(() => {});
    }

    // ── Fonte de emoji (carregada só na hora de gerar o PDF, ~880KB) ──
    // Cobre emoji de bolinha colorida (🔴🟠🟡🟢🔵🟣🟤⚫⚪) e maçã (🍎🍏),
    // que é o padrão que os nomes de produto usam. Símbolos de status
    // (✅❌⚠️) também vêm dessa fonte.
    const FONTE_EMOJI_PATH = 'estoque/NotoEmoji-Regular.ttf';
    let fontePromise = null;

    function carregarFonteEmoji(doc) {
        if (fontePromise) return fontePromise;
        fontePromise = fetch(FONTE_EMOJI_PATH)
            .then(r => { if (!r.ok) throw new Error('Fonte não encontrada em ' + FONTE_EMOJI_PATH); return r.arrayBuffer(); })
            .then(buf => {
                let binary = '';
                const bytes = new Uint8Array(buf);
                const chunk = 8192;
                for (let i = 0; i < bytes.length; i += chunk) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                }
                return btoa(binary);
            });
        return fontePromise;
    }

    // Emoji de bolinha/maçã no INÍCIO do nome → cor RGB pra desenhar como
    // círculo vetor (o jsPDF não consegue desenhar esses emoji, só os
    // "simples" tipo ✅❌⚠️ funcionam — testado e confirmado).
    const MAPA_COR_EMOJI = {
        '🔴': [244, 67, 54], '🟠': [255, 152, 0], '🟡': [255, 235, 59],
        '🟢': [76, 175, 80], '🔵': [33, 150, 243], '🟣': [156, 39, 176],
        '🟤': [121, 85, 72], '⚫': [66, 66, 66], '⚪': [180, 180, 180],
        '🍎': [220, 53, 47], '🍏': [76, 175, 80]
    };
    // Faixas de símbolo/emoji a limpar do nome (nunca tocam em letras
    // acentuadas do português, que ficam bem abaixo dessas faixas).
    const REGEX_LIMPEZA_SIMBOLOS = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\uFE00-\uFE0F\u200D]/gu;

    function extrairCorEnomeSemEmoji(nome) {
        const chars = Array.from(nome || '');
        let i = 0;
        let cor = null;
        if (chars[0] && MAPA_COR_EMOJI[chars[0]]) {
            cor = MAPA_COR_EMOJI[chars[0]];
            i = 1;
            // pula seletor de variação (️) ou zero-width joiner colado no emoji
            while (chars[i] === '\uFE0F' || chars[i] === '\u200D') i++;
        }
        const resto = chars.slice(i).join('').replace(REGEX_LIMPEZA_SIMBOLOS, '').trim();
        return { cor, nomeLimpo: resto || nome.replace(REGEX_LIMPEZA_SIMBOLOS, '').trim() || nome };
    }

    // Escreve um texto misto (emoji + texto normal) trocando de fonte só
    // no trecho do emoji — a fonte de emoji não tem letra/número, então
    // misturar tudo na mesma fonte faz o texto normal sumir.
    function textoComEmoji(doc, partes, x, y) {
        let cursorX = x;
        partes.forEach(p => {
            doc.setFont(p.emoji ? 'NotoEmoji' : 'helvetica', p.emoji ? 'normal' : (p.bold ? 'bold' : 'normal'));
            doc.setTextColor(p.cor[0], p.cor[1], p.cor[2]);
            doc.text(p.texto, cursorX, y);
            cursorX += doc.getTextWidth(p.texto);
        });
    }

    // ── Geração de PDF (reutilizável: finalizar agora OU reabrir do histórico) ──
    function gerarPDF(itensParaPDF, dataFinalizacao) {
        // jsPDF carrega sob demanda (ver window._vsLib em core.js): na primeira vez, baixa e repete a chamada.
        if (typeof window.jspdf === 'undefined') {
            window._vsLib('jspdf')
                .then(() => gerarPDF(itensParaPDF, dataFinalizacao))
                .catch(() => window.showCustomModal({ message: 'Erro: biblioteca de PDF não carregada. Confira a conexão e tente de novo.' }));
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        carregarFonteEmoji(doc).then(fontBase64 => {
            doc.addFileToVFS('NotoEmoji-Regular.ttf', fontBase64);
            doc.addFont('NotoEmoji-Regular.ttf', 'NotoEmoji', 'normal');
            desenharPDF(doc, itensParaPDF, dataFinalizacao);
        }).catch(e => {
            console.error('Não deu pra carregar a fonte de emoji, gerando sem emoji:', e);
            desenharPDF(doc, itensParaPDF, dataFinalizacao, true);
        });
    }

    function desenharPDF(doc, itensParaPDF, dataFinalizacao, semEmoji) {
        const dataStr = new Date(dataFinalizacao || Date.now()).toLocaleString('pt-BR');
        const margemEsq = 14, margemDir = 196;
        const colProduto = margemEsq + 6, colCores = 110, colConf = 155;

        doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0, 0, 0);
        doc.text('Relatório de Conferência de Estoque', margemEsq, 18);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 100, 100);
        doc.text(`Gerado em: ${dataStr}`, margemEsq, 25);

        let y = 36;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(0, 0, 0);
        doc.text('Produto', colProduto, y);
        doc.text('Cores', colCores, y);
        doc.text('Conferência', colConf, y);
        y += 3;
        doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.4);
        doc.line(margemEsq, y, margemDir, y);
        y += 7;

        const alturaLinha = 8.5;
        let divergencias = 0, naoContados = 0;
        const topoTabela = 33;

        itensParaPDF.forEach(it => {
            if (y > 270) { doc.addPage(); y = 30; }
            const yBase = y;
            const { cor, nomeLimpo } = extrairCorEnomeSemEmoji(it.nome);

            if (cor && !semEmoji) {
                doc.setFillColor(cor[0], cor[1], cor[2]);
                doc.circle(colProduto - 3.5, yBase - 1.3, 1.6, 'F');
            }

            doc.setFont('helvetica', 'bold'); doc.setFontSize(9.3); doc.setTextColor(20, 20, 20);
            doc.text(doc.splitTextToSize(nomeLimpo, colCores - colProduto - 4)[0] || nomeLimpo, colProduto, yBase);

            doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90, 90, 90);
            const cores = it.cores || [];
            doc.text(cores.length ? cores.join(', ') : '-', colCores, yBase);

            doc.setFontSize(9.5);
            const contadoNulo = (it.contado === null || it.contado === undefined);
            if (contadoNulo) {
                naoContados++;
                if (semEmoji) {
                    doc.setFont('helvetica', 'bold'); doc.setTextColor(140, 140, 140);
                    doc.text(`Não contado (${it.sistemaQtd} sistema)`, colConf, yBase);
                } else {
                    textoComEmoji(doc, [
                        { texto: '⚠', emoji: true, cor: [140, 140, 140] },
                        { texto: ` Não contado (${it.sistemaQtd} sistema)`, cor: [140, 140, 140] }
                    ], colConf, yBase);
                }
            } else if (it.contado === it.sistemaQtd) {
                if (semEmoji) {
                    doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 140, 70);
                    doc.text(`${it.contado} OK`, colConf, yBase);
                } else {
                    textoComEmoji(doc, [
                        { texto: `${it.contado} `, bold: true, cor: [30, 140, 70] },
                        { texto: '✅', emoji: true, cor: [30, 140, 70] }
                    ], colConf, yBase);
                }
            } else {
                divergencias++;
                if (semEmoji) {
                    doc.setFont('helvetica', 'bold'); doc.setTextColor(210, 40, 40);
                    doc.text(`${it.contado} (${it.sistemaQtd} sistema)`, colConf, yBase);
                } else {
                    textoComEmoji(doc, [
                        { texto: `${it.contado} `, bold: true, cor: [210, 40, 40] },
                        { texto: '❌', emoji: true, cor: [210, 40, 40] },
                        { texto: ` (${it.sistemaQtd} sistema)`, cor: [210, 40, 40] }
                    ], colConf, yBase);
                }
            }

            y += alturaLinha;
            doc.setDrawColor(228, 228, 228); doc.setLineWidth(0.2);
            doc.line(margemEsq, y - alturaLinha + 3.2, margemDir, y - alturaLinha + 3.2);
        });

        // linhas verticais separando as 3 colunas
        doc.setDrawColor(205, 205, 205); doc.setLineWidth(0.2);
        doc.line(colCores - 4, topoTabela, colCores - 4, y - alturaLinha + 3.2);
        doc.line(colConf - 4, topoTabela, colConf - 4, y - alturaLinha + 3.2);

        y += 4;
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.4);
        doc.line(margemEsq, y, margemDir, y);
        y += 8;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(0, 0, 0);
        doc.text(`Total de produtos conferidos: ${itensParaPDF.length}`, margemEsq, y); y += 6;
        if (divergencias > 0) {
            doc.setTextColor(210, 40, 40);
            doc.text(`Divergências encontradas: ${divergencias}`, margemEsq, y); y += 6;
        }
        if (naoContados > 0) {
            doc.setTextColor(140, 140, 140);
            doc.text(`Produtos não contados: ${naoContados}`, margemEsq, y); y += 6;
        }
        if (divergencias === 0 && naoContados === 0) {
            doc.setTextColor(16, 150, 100);
            doc.text('Nenhuma divergência — estoque bateu 100%.', margemEsq, y);
        }

        doc.save(`conferencia-estoque-${dataFinalizacao || Date.now()}.pdf`);
    }

    // ── Histórico de conferências finalizadas ─────────────────────
    function abrirHistorico() {
        const listEl = el('stqConfList');
        const emptyEl = el('stqConfEmpty');
        if (emptyEl) emptyEl.style.display = 'none';
        listEl.innerHTML = `<div class="stq-hist-loading">Carregando histórico...</div>`;
        el('stqConfHistBtn').classList.add('active');

        window._dbGet(window._lojaRef('estoqueConferencias')).then(snap => {
            const data = snap.val();
            const registros = data ? Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a, b) => (b.finalizadoEm || 0) - (a.finalizadoEm || 0)) : [];

            if (!registros.length) {
                listEl.innerHTML = `<div class="stq-hist-empty"><i class="bi bi-clock-history"></i><br/>Nenhuma conferência finalizada ainda.</div>`;
                return;
            }

            listEl.innerHTML = `<div class="stq-hist-conf-list">${registros.map(r => {
                const itensR = Array.isArray(r.itens) ? r.itens : [];
                const divergentesR = itensR.filter(it => it.contado !== null && it.contado !== it.sistemaQtd).length;
                const dataStr = new Date(r.finalizadoEm || 0).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                return `
                    <div class="stq-hist-conf-item" data-id="${r.id}">
                        <div class="stq-hist-conf-icon"><i class="bi bi-file-earmark-pdf-fill"></i></div>
                        <div class="stq-hist-conf-info">
                            <div class="stq-hist-conf-data">${dataStr}</div>
                            <div class="stq-hist-conf-resumo">${itensR.length} produtos${divergentesR ? ` · <span class="diverge-txt">${divergentesR} divergência(s)</span>` : ' · sem divergências'}</div>
                        </div>
                        <button class="stq-hist-conf-baixar" data-action="baixar"><i class="bi bi-download"></i> PDF</button>
                    </div>`;
            }).join('')}</div>`;

            listEl.querySelectorAll('.stq-hist-conf-item').forEach(itemEl => {
                const registro = registros.find(r => r.id === itemEl.dataset.id);
                itemEl.querySelector('[data-action="baixar"]')?.addEventListener('click', () => {
                    gerarPDF(registro.itens || [], registro.finalizadoEm);
                });
            });
        }).catch(e => {
            listEl.innerHTML = `<div class="stq-hist-empty">Erro ao carregar histórico: ${esc(e.message)}</div>`;
        });
    }

    // ── Entrada pública ──────────────────────────────────────────
    function renderEstoqueConferencia() {
        ensureSkeleton();
        mostrandoHistorico = false;
        el('stqConfHistBtn')?.classList.remove('active');
        renderLista();
        montarItens().then(() => renderLista());
    }
    window._renderEstoqueConferencia = renderEstoqueConferencia;

})();
