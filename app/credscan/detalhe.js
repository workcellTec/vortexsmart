// ================================================================
// credscan/detalhe.js — VortexSmart · CredScan (resultado completo)
//
// Layout "ticket": cartão de aprovação no topo (com linha picotada
// separando o resumo dos números de pagamento, igual um ticket de
// verdade) + 3 abas embaixo (Negociar / Análise / Mensagem) — só uma
// seção visível de cada vez, em vez de empilhar tudo numa rolagem só.
// Reprovado não tem aba "Negociar" (nada pra negociar).
//
// Página própria (não expande inline) — mesma ideia de Lançar →
// Fechar Venda: navega pra uma tela dedicada, com botão de voltar.
//
// De propósito NÃO mostra (removidos a pedido, não sobrecarrega o
// vendedor com coisa técnica): Conselho pro Vendedor, Raciocínio da
// Nota, Saúde Financeira. Só não aparecem na TELA — o prompt ainda
// pode gerar esses dados (ver csBuildPrompt em functions/index.js),
// só não são renderizados aqui, caso um dia decidam trazer de volta.
//
// Expõe via window.*:
//   _renderCredscanDetalhe
// Depende de (via window.*):
//   _lojaRef, _dbGet, _dbPush, _dbUpdate, showCustomModal,
//   openCredscanSection, _firebaseAuthUid
// ================================================================
(function () {
    'use strict';

    const el = id => document.getElementById(id);
    const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const R$ = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // No tema claro, o verde/vermelho "neon" (feito pro fundo escuro)
    // quase some ou estoura em cima de fundo branco — mesmo problema
    // que .ctw-card.c-green já resolve no style.mobile.css / style.pc.css, usando uma cor
    // mais escura da mesma família só no claro. Replicando aqui pros
    // elementos que são montados via JS (não dá pra resolver só com
    // CSS porque a cor entra inline no template).
    function temaClaro() { return document.body.classList.contains('tema-claro'); }
    function corVerde() { return temaClaro() ? '#047857' : '#4ade80'; }
    function corVerdeRgb() { return temaClaro() ? '4,120,87' : '74,222,128'; }
    function corVermelho() { return temaClaro() ? '#dc2626' : '#f87171'; }
    function corVermelhoRgb() { return temaClaro() ? '220,38,38' : '248,113,113'; }

    let mounted = false;

    function ensureSkeleton() {
        const container = el('credscanDetalhe');
        if (!container || mounted) return;
        container.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Resultado</h3>
            </div>
            <div id="csDetConteudo" style="width:100%;padding:0 14px 24px;"></div>
        `;
        mounted = true;
    }

    // FORTE/MEDIO/FRACO é o nome técnico da faixa (também usado pra
    // calcular a entrada — não pode mudar esse valor). "Risco: Forte"
    // lido por qualquer pessoa soa como risco ALTO, quando na
    // verdade significa o oposto (perfil forte = risco baixo). Essa
    // função só traduz pra EXIBIÇÃO, o dado técnico continua intacto.
    function riscoLabel(tier) {
        const map = { FORTE: 'Baixo', MEDIO: 'Médio', FRACO: 'Alto', REPROVADO: 'Reprovado' };
        return map[tier] || tier || '—';
    }

    function card(titulo, icone, cor, texto) {
        if (!texto || !texto.trim()) return '';
        return `<div style="background:rgba(var(--overlay-rgb),.05);border-radius:14px;padding:14px;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:6px;font-size:.68rem;font-weight:700;color:var(--text-muted);margin-bottom:5px;"><i class="bi ${icone}" style="color:${cor};"></i>${titulo}</div>
            <div style="font-size:.8rem;line-height:1.6;color:var(--text-secondary);white-space:pre-line;">${esc(texto)}</div>
        </div>`;
    }

    // ── Ticket de aprovação (cartão + linha picotada + tira de
    // pagamento). Sem tira quando não tem entrada/parcela (reprovado
    // ou ainda em análise). ──
    function montarTicket(item, r, aprov, temPagamento) {
        const corBg = aprov ? corVerdeRgb() : corVermelhoRgb();
        const corNota = aprov ? corVerde() : corVermelho();
        const raioTopo = temPagamento ? '18px 18px 0 0' : '18px';

        let html = `
        <div style="position:relative;margin-bottom:16px;">
            <div style="background:linear-gradient(160deg,rgba(${corBg},.14),rgba(${corBg},.03));border:1px solid rgba(${corBg},.2);border-radius:${raioTopo};padding:18px 18px 16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="display:flex;align-items:center;gap:5px;font-size:.62rem;font-weight:700;color:${corNota};text-transform:uppercase;letter-spacing:.04em;">
                        <i class="bi ${aprov ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}" style="font-size:.8rem;"></i>${aprov ? 'Aprovado' : 'Reprovado'}
                    </div>
                    <div style="font-size:.56rem;color:var(--text-muted);">risco ${riscoLabel(r.risco).toLowerCase()}</div>
                </div>
                <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:10px;">
                    <div>
                        <div style="font-size:.9rem;font-weight:700;color:var(--text-strong);line-height:1.3;">${esc(item.clienteNome || 'Cliente')}</div>
                        <div style="font-size:.66rem;color:var(--text-muted);margin-top:1px;">${esc(item.produto || '')} · ${R$(item.valor)}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:1.6rem;font-weight:800;color:${corNota};line-height:1;">${r.nota != null ? r.nota : '—'}</div>
                        <div style="font-size:.5rem;color:var(--text-muted);">nota</div>
                    </div>
                </div>
            </div>`;

        if (temPagamento) {
            html += `
            <div style="position:relative;height:0;">
                <div style="position:absolute;left:-15px;top:-9px;width:18px;height:18px;border-radius:50%;background:var(--bg);"></div>
                <div style="position:absolute;right:-15px;top:-9px;width:18px;height:18px;border-radius:50%;background:var(--bg);"></div>
                <div style="border-top:1.5px dashed rgba(${corBg},.35);"></div>
            </div>
            <div style="background:rgba(var(--overlay-rgb),.04);border:1px solid rgba(${corBg},.2);border-top:none;border-radius:0 0 18px 18px;padding:14px 18px;display:flex;">
                <div style="flex:1;text-align:center;">
                    <div style="font-size:.58rem;color:var(--text-muted);">entrada</div>
                    <div id="csTicketEntrada" style="font-size:.8rem;font-weight:700;color:var(--text-strong);margin-top:2px;">${R$(r.entrada)}</div>
                </div>
                <div style="width:1px;background:rgba(var(--overlay-rgb),.1);"></div>
                <div style="flex:1;text-align:center;">
                    <div style="font-size:.58rem;color:var(--text-muted);">${r.parcelas || 12}x de</div>
                    <div id="csTicketParcela" style="font-size:.8rem;font-weight:700;color:${corVerde()};margin-top:2px;">${R$(r.vparcela)}</div>
                </div>
                <div style="width:1px;background:rgba(var(--overlay-rgb),.1);"></div>
                <div style="flex:1;text-align:center;">
                    <div style="font-size:.58rem;color:var(--text-muted);">total</div>
                    <div id="csTicketTotal" style="font-size:.8rem;font-weight:700;color:var(--text-strong);margin-top:2px;">${R$(r.total)}</div>
                </div>
            </div>`;
        }
        html += `</div>`;
        return html;
    }

    function montarAbas(abasDisponiveis, abaInicial) {
        const nomes = { negociar: 'Negociar', analise: 'Análise', mensagem: 'Mensagem' };
        return `<div style="display:flex;gap:4px;background:rgba(var(--overlay-rgb),.04);border-radius:11px;padding:3px;margin-bottom:14px;">
            ${abasDisponiveis.map(k => `
                <button type="button" data-aba="${k}" class="cs-tab-btn" style="flex:1;padding:9px 0;border-radius:8px;border:none;font-size:.68rem;font-weight:700;${k === abaInicial ? 'background:rgba(var(--overlay-rgb),.1);color:var(--text-strong);' : 'background:transparent;color:var(--text-muted);'}">${nomes[k]}</button>
            `).join('')}
        </div>`;
    }

    function renderConteudo(item, taxaJurosLoja) {
        const r = item.resultado || {};
        const aprov = !!r.aprov;
        const concluido = item.status === 'concluido';
        const temPagamento = concluido && aprov && r.entrada != null;

        if (!concluido) {
            el('csDetConteudo').innerHTML = `
                <div style="padding-top:14px;">
                    <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:12px;padding:12px 14px;color:#fbbf24;font-size:.8rem;">
                        <i class="bi bi-hourglass-split"></i> Ainda em análise — essa tela atualiza sozinha quando terminar.
                    </div>
                </div>`;
            return;
        }

        const abasDisponiveis = temPagamento ? ['negociar', 'analise', 'mensagem'] : ['analise', 'mensagem'];
        const abaInicial = abasDisponiveis[0];

        let html = `<div style="padding-top:14px;">`;
        html += montarTicket(item, r, aprov, temPagamento);

        if (r.reaproveitado) {
            html += `<div style="background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.25);border-radius:12px;padding:10px 14px;margin-bottom:14px;color:#60a5fa;font-size:.72rem;">
                <i class="bi bi-info-circle-fill"></i> Reaproveitado de uma análise recente do mesmo CPF — não gastou token novo.
            </div>`;
        }

        html += montarAbas(abasDisponiveis, abaInicial);

        // ── Painel Negociar ──
        if (temPagamento) {
            html += `<div id="csPainelNegociar" class="cs-painel">
                <div style="background:rgba(var(--overlay-rgb),.05);border-radius:14px;padding:16px;">
                    <div style="font-size:.62rem;color:var(--text-muted);margin-bottom:6px;">Entrada</div>
                    <div style="display:flex;gap:6px;margin-bottom:14px;" id="csEntradaChips"></div>

                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                        <span style="font-size:.62rem;color:var(--text-muted);">Juros ao mês</span>
                        <span style="font-size:.56rem;color:var(--text-muted);opacity:.7;">padrão: ${taxaJurosLoja}%</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
                        <button type="button" id="csJurosMenos" style="width:32px;height:32px;border-radius:8px;border:1px solid rgba(var(--overlay-rgb),.15);background:transparent;color:var(--text-strong);font-size:1rem;flex-shrink:0;">−</button>
                        <div style="flex:1;text-align:center;font-size:.9rem;font-weight:700;" id="csJurosVal">${taxaJurosLoja}%</div>
                        <button type="button" id="csJurosMais" style="width:32px;height:32px;border-radius:8px;border:1px solid rgba(var(--overlay-rgb),.15);background:transparent;color:var(--text-strong);font-size:1rem;flex-shrink:0;">+</button>
                    </div>

                    <div style="font-size:.56rem;color:var(--text-muted);margin-bottom:14px;opacity:.7;">Só vale pra essa simulação — não muda o padrão da loja.</div>

                    <div style="height:1px;background:rgba(var(--overlay-rgb),.08);margin-bottom:14px;"></div>

                    <div style="font-size:.62rem;color:var(--text-muted);margin-bottom:8px;">Simular outro produto</div>
                    <div id="csOutroProdutoWrap">
                        ${item.cpfDetectado ? `
                            <button type="button" id="csOutroToggleBtn" style="width:100%;padding:11px;border-radius:10px;border:1px dashed rgba(var(--overlay-rgb),.25);background:transparent;color:var(--text-muted);font-size:.72rem;"><i class="bi bi-plus-lg"></i> Novo produto pra esse cliente</button>
                        ` : `<div style="font-size:.68rem;color:var(--text-muted);">Essa análise não tem CPF identificado, então não dá pra reaproveitar. Só funciona quando o comprovante de renda é um PDF digital com CPF legível.</div>`}
                    </div>
                </div>
            </div>`;
        }

        // ── Painel Análise ──
        html += `<div id="csPainelAnalise" class="cs-painel" style="display:none;">`;
        if (aprov) {
            html += card('Resumo executivo', 'bi-lightbulb-fill', '#60a5fa', r.resumoExec);
            html += card('Perfil do cliente', 'bi-person-fill', '#a78bfa', r.perfil);
            html += card('Análise de renda real', 'bi-cash-coin', corVerde(), r.analiseRenda);
            html += card('Comprometimento', 'bi-bar-chart-fill', '#fbbf24', r.comprometimento);
            html += card('Padrões de risco', 'bi-search', '#fb923c', r.padroesRisco);
        } else {
            html += card('Motivos da reprovação', 'bi-exclamation-triangle-fill', corVermelho(), r.motivos);
            html += card('Perfil do cliente', 'bi-person-fill', '#a78bfa', r.perfil);
            html += card('Análise de renda real', 'bi-cash-coin', corVerde(), r.analiseRenda);
            html += card('Padrões de risco', 'bi-search', corVermelho(), r.padroesRisco);
        }
        html += `</div>`;

        // ── Painel Mensagem ──
        html += `<div id="csPainelMensagem" class="cs-painel" style="display:none;">`;
        if (r.wpp) {
            html += `<div style="background:rgba(var(--overlay-rgb),.05);border:1px solid rgba(var(--overlay-rgb),.1);border-radius:12px;padding:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <div style="font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:${corVerde()};"><i class="bi bi-whatsapp"></i> Mensagem pronta</div>
                    <button type="button" id="csCopiarWppBtn" style="background:rgba(${corVerdeRgb()},.12);border:1px solid rgba(${corVerdeRgb()},.3);color:${corVerde()};font-size:.66rem;font-weight:700;padding:6px 12px;border-radius:8px;">Copiar</button>
                </div>
                <div id="csWppTxt" style="font-size:.76rem;line-height:1.6;color:var(--text-secondary);white-space:pre-line;">${esc(r.wpp)}</div>
            </div>`;
        }
        html += `</div>`;

        html += `</div>`; // fecha o padding-top:14px do início

        el('csDetConteudo').innerHTML = html;

        // ── Abas ──
        function trocarAba(aba) {
            abasDisponiveis.forEach(k => {
                const painel = el('csPainel' + k[0].toUpperCase() + k.slice(1));
                if (painel) painel.style.display = k === aba ? 'block' : 'none';
            });
            document.querySelectorAll('.cs-tab-btn').forEach(btn => {
                const ativo = btn.dataset.aba === aba;
                btn.style.background = ativo ? 'rgba(var(--overlay-rgb),.1)' : 'transparent';
                btn.style.color = ativo ? 'var(--text-strong)' : 'var(--text-muted)';
            });
        }
        document.querySelectorAll('.cs-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => trocarAba(btn.dataset.aba));
        });

        el('csCopiarWppBtn')?.addEventListener('click', () => {
            const texto = r.wpp || '';
            const finalizar = () => {
                const b = el('csCopiarWppBtn');
                b.textContent = 'Copiado!';
                setTimeout(() => { b.textContent = 'Copiar'; }, 1500);
            };
            if (navigator.clipboard) navigator.clipboard.writeText(texto).then(finalizar).catch(finalizar);
            else finalizar();
        });

        // ── Simulação ao vivo (entrada por chips + juros por
        // stepper) — mesma fórmula de amortização do servidor
        // (csPrecoParcela), rodando no celular. Atualiza o TICKET no
        // topo em tempo real. Nunca grava em lugar nenhum — sai da
        // tela, some. ──
        if (temPagamento) {
            const n = r.parcelas || 12;
            let entradaAtual = r.entrada;
            let jurosAtual = taxaJurosLoja;
            const basePct = item.valor > 0 ? Math.round((r.entrada / item.valor) * 100 / 5) * 5 : 30;
            const lowPct = Math.max(10, basePct - 10);
            const highPct = Math.min(70, basePct + 10);

            function recalcularSimulacao() {
                const saldo = item.valor - entradaAtual;
                const t = jurosAtual / 100;
                const parcela = saldo > 0 ? (t === 0 ? saldo / n : saldo * (t * Math.pow(1 + t, n)) / (Math.pow(1 + t, n) - 1)) : 0;
                const total = entradaAtual + parcela * n;
                el('csTicketEntrada').textContent = R$(entradaAtual);
                el('csTicketParcela').textContent = R$(parcela);
                el('csTicketTotal').textContent = R$(total);
                el('csJurosVal').textContent = jurosAtual.toFixed(1).replace(/\.0$/, '') + '%';
            }

            function renderChips() {
                const wrap = el('csEntradaChips');
                const opcoes = [
                    { pct: lowPct, valor: Math.round(item.valor * lowPct / 100 / 10) * 10 },
                    { pct: basePct, valor: Math.round(entradaAtual / 10) * 10, atual: true },
                    { pct: highPct, valor: Math.round(item.valor * highPct / 100 / 10) * 10 },
                ];
                wrap.innerHTML = opcoes.map((o, i) => `
                    <button type="button" data-chip="${i}" class="cs-chip-entrada" style="flex:1;padding:9px 4px;border-radius:9px;font-size:.68rem;font-weight:700;border:1px solid rgba(var(--overlay-rgb),.15);background:transparent;">${o.pct}%</button>
                `).join('') + `<button type="button" id="csChipCustom" style="flex:1;padding:9px 0;border-radius:9px;border:1px dashed rgba(var(--overlay-rgb),.25);background:transparent;color:var(--text-muted);"><i class="bi bi-pencil"></i></button>`;

                function marcarAtivo(idx, valorEntrada) {
                    wrap.querySelectorAll('.cs-chip-entrada').forEach((btn, i) => {
                        const ativo = i === idx;
                        btn.style.border = ativo ? '1.5px solid var(--acento-hero)' : '1px solid rgba(var(--overlay-rgb),.15)';
                        btn.style.background = ativo ? 'rgba(91,61,245,.15)' : 'transparent';
                        btn.textContent = ativo ? R$(valorEntrada) : opcoes[i].pct + '%';
                    });
                }
                wrap.querySelectorAll('.cs-chip-entrada').forEach((btn, i) => {
                    btn.addEventListener('click', () => {
                        entradaAtual = opcoes[i].valor;
                        marcarAtivo(i, entradaAtual);
                        recalcularSimulacao();
                    });
                });
                el('csChipCustom').addEventListener('click', e => ativarEntradaCustom(e.currentTarget));
                marcarAtivo(1, entradaAtual);
            }

            // Troca o lápis por um campinho ali mesmo, no lugar dele —
            // nada de prompt() nativo do navegador, que sai feio e fora
            // do visual do app (mesmo motivo do "+ Nova categoria" em
            // Reposição). Enter confirma, Esc ou o X cancela.
            function ativarEntradaCustom(btnCustom) {
                const holder = document.createElement('span');
                holder.style.cssText = 'display:flex;align-items:center;gap:4px;flex:1.6;background:rgba(var(--overlay-rgb),.05);border:1px solid rgba(var(--overlay-rgb),.15);border-radius:9px;padding:2px 4px 2px 10px;';
                holder.innerHTML = `
                    <input type="number" inputmode="decimal" placeholder="Valor" style="border:none;background:transparent;color:var(--text-strong);font-size:.72rem;font-weight:600;width:100%;outline:none;padding:7px 0;"/>
                    <button type="button" class="cs-entrada-custom-ok" aria-label="Confirmar" style="width:24px;height:24px;border-radius:50%;border:none;background:${corVerde()};color:${temaClaro() ? '#fff' : '#07101f'};flex-shrink:0;padding:0;display:flex;align-items:center;justify-content:center;"><i class="bi bi-check-lg" style="font-size:.65rem;"></i></button>
                    <button type="button" class="cs-entrada-custom-cancelar" aria-label="Cancelar" style="width:24px;height:24px;border-radius:50%;border:none;background:rgba(var(--overlay-rgb),.12);color:var(--text-secondary);flex-shrink:0;padding:0;display:flex;align-items:center;justify-content:center;"><i class="bi bi-x-lg" style="font-size:.6rem;"></i></button>
                `;
                btnCustom.replaceWith(holder);
                const input = holder.querySelector('input');
                input.focus();

                function confirmar() {
                    const v = parseFloat(input.value);
                    if (!v || isNaN(v)) { input.focus(); return; }
                    entradaAtual = v;
                    renderChips();
                    recalcularSimulacao();
                }
                holder.querySelector('.cs-entrada-custom-ok').addEventListener('click', confirmar);
                holder.querySelector('.cs-entrada-custom-cancelar').addEventListener('click', () => renderChips());
                input.addEventListener('keydown', e => {
                    if (e.key === 'Enter') { e.preventDefault(); confirmar(); }
                    if (e.key === 'Escape') renderChips();
                });
            }
            renderChips();

            el('csJurosMenos')?.addEventListener('click', () => { jurosAtual = Math.max(0, Math.round((jurosAtual - 0.5) * 10) / 10); recalcularSimulacao(); });
            el('csJurosMais')?.addEventListener('click', () => { jurosAtual = Math.round((jurosAtual + 0.5) * 10) / 10; recalcularSimulacao(); });

            // ── Simular outro produto: o botão vira o formulário no
            // lugar dele quando tocado (igual "+ Nova categoria" em
            // Reposição) — reaproveita renda/nota via CPF (mesmo
            // caminho que o servidor já usa), recalculando entrada/
            // parcela pro produto/valor novos. Cria um item novo —
            // vira um card próprio na lista, não mexe nesse aqui. ──
            el('csOutroToggleBtn')?.addEventListener('click', () => {
                el('csOutroProdutoWrap').innerHTML = `
                    <input class="form-control" id="csOutroProduto" type="text" placeholder="Produto (ex: Galaxy S23)" style="font-size:.78rem;margin-bottom:8px;"/>
                    <input class="form-control" id="csOutroValor" type="number" inputmode="decimal" placeholder="Valor" style="font-size:.78rem;margin-bottom:10px;"/>
                    <button type="button" class="rep-btn-next" id="csOutroBtn" style="width:100%;padding:11px;">Gerar nova análise (sem gastar IA de novo)</button>
                `;
                el('csOutroBtn').addEventListener('click', () => {
                    const produto = el('csOutroProduto').value.trim();
                    const valor = parseFloat((el('csOutroValor').value || '0').replace(',', '.')) || 0;
                    if (!produto || !valor) {
                        if (window.showCustomModal) window.showCustomModal({ message: 'Preenche produto e valor.' });
                        return;
                    }
                    const btn = el('csOutroBtn');
                    btn.disabled = true;
                    btn.textContent = 'Gerando...';
                    const itemRef = window._dbPush(window._lojaRef('credscan/itens'));
                    window._dbUpdate(itemRef, {
                        clienteNome: null, produto, valor, cpfDetectado: item.cpfDetectado,
                        enviadoPorUid: window._firebaseAuthUid || null, criadoEm: Date.now(),
                        imagensDocCaminhos: [], imagensRendaCaminhos: [], textoDigital: null,
                        apostasPreDetectado: null, forcarIA: false, forcarNovaAnalise: false,
                        status: 'enviado',
                    }).then(() => {
                        if (window.showCustomModal) window.showCustomModal({ message: 'Já era! A nova análise já deve estar pronta na lista.' });
                        if (window.openCredscanSection) window.openCredscanSection('credscanLista');
                    }).catch(e => {
                        if (window.showCustomModal) window.showCustomModal({ message: `Não deu pra gerar: ${e.message}` });
                        btn.disabled = false;
                        btn.textContent = 'Gerar nova análise (sem gastar IA de novo)';
                    });
                });
            });
        }
    }

    function renderCredscanDetalhe(itemId) {
        ensureSkeleton();
        el('csDetConteudo').innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:30px 0;">Carregando...</p>';
        // Não usa listener em tempo real aqui de propósito — se ainda
        // estiver "em análise", a pessoa volta na lista quando a
        // notificação chegar e reabre; evita manter um listener extra
        // pendurado numa tela de detalhe que raramente fica aberta
        // esperando.
        Promise.all([
            window._dbGet(window._lojaRef(`credscan/itens/${itemId}`)),
            window._dbGet(window._lojaRef('credscan/config')).catch(() => null),
        ]).then(([itemSnap, configSnap]) => {
            const item = itemSnap.val();
            if (!item) { el('csDetConteudo').innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:30px 0;">Análise não encontrada.</p>'; return; }
            const taxaJurosLoja = (configSnap && configSnap.val() && configSnap.val().taxaJuros) || 6;
            renderConteudo({ id: itemId, ...item }, taxaJurosLoja);
        }).catch(e => {
            el('csDetConteudo').innerHTML = `<p style="text-align:center;color:var(--danger);padding:30px 0;">Erro ao carregar: ${esc(e.message)}</p>`;
        });
    }
    window._renderCredscanDetalhe = renderCredscanDetalhe;
})();
