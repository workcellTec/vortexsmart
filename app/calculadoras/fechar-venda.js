// ================================================================
// calculadoras/fechar-venda.js — VortexSmart · Remover Taxa (calculadora)
// Recriado do zero baseado no CTW fecharVenda.js. Módulo já era
// autocontido (helpers fv* próprios); só precisa de `el` e `fmt`
// locais, que antes vinham do escopo compartilhado do calculadoras.js.
// Depende de (via window.*):
//   _areRatesLoaded, _getRate, products, _fuse, safeStorage,
//   _parseBrazilianCurrencyToFloat, openCalculatorSection
// Expõe via window.*:
//   _fvOnRatesLoaded, _initFecharVenda, _fvSelectProduct
// ================================================================
(function () {
    'use strict';

    const el  = id => document.getElementById(id);
    const fmt = v  => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // ── Acesso ao estado global ───────────────────────────────────
    function fvRatesOk()   { return !!window._areRatesLoaded; }
    function getProds()  { return window.products || []; }
    function getFuse()   { return window._fuse || null; }
    function fvGetRate(machine, brand, inst) {
        return typeof window._getRate === 'function'
            ? window._getRate(machine, brand, inst)
            : undefined;
    }
    function parseMoney(v) {
        return typeof window._parseBrazilianCurrencyToFloat === 'function'
            ? window._parseBrazilianCurrencyToFloat(v)
            : parseFloat(String(v).replace(/\./g,'').replace(',','.')) || 0;
    }
    // fmt — usa a mesma do escopo calculadoras.js
    function safeGet(k) { try { return localStorage.getItem(k); } catch(e) { return null; } }

    // ── Estado ───────────────────────────────────────────────────
    let precoBase    = 0;

    // ── DOM ───────────────────────────────────────────────────────
    // el — usa a mesma do escopo calculadoras.js

    // ── Máquinas ─────────────────────────────────────────────────
    // Vem do que a loja realmente cadastrou (Configurações → Taxas),
    // igual todo o resto do app já faz — não é mais uma lista fixa
    // desconectada do sistema. Só cai em lista vazia se os dados
    // REALMENTE ainda não carregaram (evita mostrar fantasma).
    function getMachines() {
        return typeof window._getMaquininhasVisiveis === 'function' ? window._getMaquininhasVisiveis() : [];
    }
    function maxInst(machine) {
        return getMachines().find(m => m.v === machine)?.maxParcelas || 18;
    }

    // ── Leitores da UI ───────────────────────────────────────────
    const getMachine = () => el('fv_machine')?.value || 'pagbank';
    const getBrand   = () => el('fv_brand')?.value   || 'visa';
    const getInst    = () => parseInt(el('fv_installments')?.value || '0');
    const getModo    = () => el('fv_modo_toggle')?.checked ? 'produto' : 'manual';

    // ── Renderiza botões de máquina ──────────────────────────────
    function renderMachineBtns() {
        const wrap = el('fv_machine_btns');
        if (!wrap) return;

        const machines = getMachines();
        // Se a máquina atual não está mais disponível, muda para a padrão ou primeira
        let cur = getMachine();
        if (!machines.find(m => m.v === cur)) {
            const saved = safeGet('ctwDefaultMachine');
            cur = (saved && machines.find(m => m.v === saved)) ? saved : (machines[0]?.v || 'pagbank');
            if (el('fv_machine')) el('fv_machine').value = cur;
        }

        wrap.innerHTML = machines.length
            ? machines.map(m => `<button class="fv-mbtn${cur===m.v?' active':''}" data-m="${m.v}">${m.l}</button>`).join('')
            : `<div class="fv-maq-vazio">Nenhuma cadastrada</div>`;
        wrap.querySelectorAll('.fv-mbtn').forEach(btn => {
            btn.addEventListener('click', () => {
                el('fv_machine').value = btn.dataset.m;
                renderMachineBtns();
                updateBrandVis();
                renderInstBtns();
                calculate();
            });
        });
    }

    // ── Bandeiras ────────────────────────────────────────────────
    function populateBrands(machine) {
        const sel = el('fv_brand');
        if (!sel) return;
        const valorAntigo = sel.value;
        sel.innerHTML = '';
        const bandeiras = typeof window._getBandeirasDaMaquina === 'function' ? window._getBandeirasDaMaquina(machine) : [];
        const saved = safeGet('ctwDefaultBrand');
        bandeiras.forEach(b => {
            const o = document.createElement('option');
            o.value = b.id; o.textContent = b.nome;
            sel.appendChild(o);
        });
        // Mantém a bandeira já escolhida se ela ainda existir nessa
        // maquininha; senão tenta a preferida salva; senão a primeira.
        if (bandeiras.find(b => b.id === valorAntigo)) sel.value = valorAntigo;
        else if (bandeiras.find(b => b.id === saved)) sel.value = saved;
    }
    function updateBrandVis() {
        const w = el('fv_brand_wrap');
        const machine = getMachine();
        const bandeiras = typeof window._getBandeirasDaMaquina === 'function' ? window._getBandeirasDaMaquina(machine) : [];
        populateBrands(machine);
        if (w) w.classList.toggle('fv-h', !bandeiras.length);
    }

    // ── Botões de parcelas ───────────────────────────────────────
    function renderInstBtns() {
        const wrap = el('fv_inst_btns');
        if (!wrap) return;
        const max = maxInst(getMachine());
        const cur = getInst();
        // Atualiza o max do slider dinamicamente conforme a máquina
        const slider = el('fv_installments');
        if (slider) slider.max = max;
        const vals = [0,1,8,10,12,18,21].filter(v => v===0||v<=max);
        wrap.innerHTML = vals.map(v =>
            `<button class="fv-ibtn${cur===v?' active':''}" data-v="${v}">${v===0?'Déb':`${v}x`}</button>`
        ).join('');
        wrap.querySelectorAll('.fv-ibtn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (el('fv_installments')) el('fv_installments').value = btn.dataset.v;
                renderInstBtns();
                syncInstLabel();
                calculate();
            });
        });
    }
    function syncInstLabel() {
        const v = getInst();
        const lbl = el('fv_inst_label');
        if (lbl) lbl.textContent = v===0?'Déb':`${v}x`;
    }

    // ── Modo manual / produto ────────────────────────────────────
    function onModoChange() {
        const isProd = getModo()==='produto';
        el('fv_produto_area')?.classList.toggle('fv-h', !isProd);
        el('fv_lbl_manual')?.classList.toggle('active', !isProd);
        el('fv_lbl_produto')?.classList.toggle('active', isProd);

        // Mostra/esconde a área de busca produto no bloco de cima
        el('fv_top_prod_area')?.classList.toggle('fv-h', !isProd);

        // Campo de valor: sempre visível exceto quando entrada à vista ativa
        const entradaAtiva = isProd && !!el('fv_entrada_check')?.checked;
        el('fv_value_wrap')?.classList.toggle('fv-h', entradaAtiva);
        el('fv_entrada_fields')?.classList.toggle('fv-h', !entradaAtiva);

        // Rótulo do campo
        const lbl = el('fv_value_label');
        if (lbl) lbl.textContent = 'Você cobrou (R$)';

        if (!isProd) {
            precoBase = 0;
            clearProdUI();
        }
        calculate();
    }

    function clearProdUI() {
        if (el('fv_prod_search')) el('fv_prod_search').value = '';
        const res = el('fv_prod_results');
        if (res) { res.innerHTML=''; res.classList.add('fv-h'); }
        const badge = el('fv_prod_badge');
        if (badge) { badge.innerHTML=''; badge.classList.add('fv-h'); }
        el('fv_entrada_wrap')?.classList.add('fv-h');
        el('fv_entrada_fields')?.classList.add('fv-h');
        el('fv_value_wrap')?.classList.remove('fv-h');
        if (el('fv_entrada_check')) el('fv_entrada_check').checked = false;
    }

    // ── Busca produto ────────────────────────────────────────────
    function onSearchInput() {
        const term = el('fv_prod_search')?.value.trim();
        const box  = el('fv_prod_results');
        if (!box) return;
        if (!term || term.length < 1) { box.innerHTML=''; box.classList.add('fv-h'); return; }

        const fuse = getFuse();
        let matches = fuse
            ? fuse.search(term).slice(0,8).map(r=>r.item)
            : getProds().filter(p=>p.nome?.toLowerCase().includes(term.toLowerCase())).slice(0,8);

        if (!matches.length) {
            box.innerHTML = `<div class="fv-no-result"><i class="bi bi-search"></i> Nenhum produto</div>`;
        } else {
            box.innerHTML = matches.map(p =>
                `<button class="fv-ri" data-id="${p.id}">
                    <span class="fv-rn">${p.nome}</span>
                    <span class="fv-rp">${fmt(parseFloat(p.valor)||0)}</span>
                 </button>`
            ).join('');
            box.querySelectorAll('.fv-ri').forEach(btn =>
                btn.addEventListener('click', () => {
                    const p = getProds().find(p=>p.id===btn.dataset.id);
                    if (p) selectProduct(p);
                })
            );
        }
        box.classList.remove('fv-h');
    }

    function selectProduct(prod) {
        precoBase = parseFloat(prod.valor) || 0;
        if (el('fv_prod_search')) el('fv_prod_search').value = prod.nome;
        const box = el('fv_prod_results');
        if (box) { box.innerHTML=''; box.classList.add('fv-h'); }

        const badge = el('fv_prod_badge');
        if (badge) {
            badge.innerHTML = `
                <i class="bi bi-box-seam-fill"></i>
                <span>${prod.nome}</span>
                <strong>${fmt(precoBase)}</strong>
                <button class="fv-pclear" id="fv_prod_clear"><i class="bi bi-x"></i></button>`;
            badge.classList.remove('fv-h');
            el('fv_prod_clear')?.addEventListener('click', () => {
                precoBase = 0; clearProdUI(); calculate();
            });
        }

        el('fv_entrada_wrap')?.classList.remove('fv-h');

        // Sugere valor cobrado
        const tax = fvGetRate(getMachine(), getBrand(), getInst());
        if (tax !== undefined && el('fv_value') && !el('fv_entrada_check')?.checked) {
            const sug = precoBase / (1 - tax/100);
            el('fv_value').value = sug.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
        }
        calculate();
    }

    // ── Toggle entrada à vista ───────────────────────────────────
    function onEntradaToggle() {
        const checked = el('fv_entrada_check')?.checked;
        el('fv_entrada_fields')?.classList.toggle('fv-h', !checked);
        el('fv_value_wrap')?.classList.toggle('fv-h', !!checked);
        if (!checked) {
            if (el('fv_entrada_valor')) el('fv_entrada_valor').value = '';
            if (el('fv_cartao_valor'))  el('fv_cartao_valor').value  = '';
        }
        calculate();
    }

    // ── Máscara de moeda ─────────────────────────────────────────
    function moneyMask(inp) {
        if (!inp) return;
        inp.addEventListener('input', e => {
            const v = e.target.value.replace(/\D/g,'');
            e.target.value = v ? (parseFloat(v)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}) : '';
            calculate();
        });
    }

    // ── Cálculo principal ─────────────────────────────────────────
    function calculate() {
        const zone = el('fv_result_zone');
        if (!zone) return;

        if (!fvRatesOk()) {
            zone.innerHTML = `<div class="fv-wait"><i class="bi bi-hourglass-split"></i> Carregando taxas...</div>`;
            return;
        }

        const tax = fvGetRate(getMachine(), getBrand(), getInst());
        if (tax === undefined || tax === null) {
            zone.innerHTML = `<div class="fv-wait"><i class="bi bi-exclamation-triangle"></i> Taxa indisponível.</div>`;
            return;
        }

        const isProd  = getModo() === 'produto';
        const isEnt   = isProd && !!el('fv_entrada_check')?.checked;

        // ── Entrada à vista ──────────────────────────────────────
        if (isEnt) {
            if (precoBase <= 0) {
                zone.innerHTML = `<div class="fv-wait"><i class="bi bi-info-circle"></i> Selecione um produto.</div>`;
                return;
            }
            const entrada = parseFloat(el('fv_entrada_valor')?.value)||0;
            const cartao  = parseFloat(el('fv_cartao_valor')?.value)||0;
            if (!entrada && !cartao) { zone.innerHTML=''; return; }
            const liquidCartao  = cartao*(1-tax/100);
            const total         = entrada + liquidCartao;
            const lucro         = total - precoBase;
            showResult(zone, {
                liquid: total,
                sub: `${fmt(entrada)} à vista + ${fmt(cartao)} cartão (${tax.toFixed(2)}%)`,
                lucro,
            });
            return;
        }

        // ── Modo normal ──────────────────────────────────────────
        const raw   = el('fv_value')?.value || '';
        const input = parseMoney(raw);
        if (!input || input <= 0) { zone.innerHTML=''; return; }

        const inst   = getInst();
        const liquid = input*(1-tax/100);
        const lucro  = isProd && precoBase>0 ? liquid-precoBase : null;

        showResult(zone, {
            liquid,
            sub: `Taxa ${tax.toFixed(2)}% · ${inst===0?'Débito':`${inst}x`}`,
            lucro,
        });
    }

    function showResult(zone, {liquid, sub, lucro}) {
        const pos  = lucro===null || lucro>=0;
        const lHtml = lucro!==null
            ? `<div class="fv-lucro ${lucro>=0?'pos':'neg'}">
                   <i class="bi bi-${lucro>=0?'graph-up-arrow':'graph-down-arrow'}"></i>
                   Lucro: ${fmt(lucro)}
               </div>` : '';

        zone.innerHTML = `
        <div class="fv-card ${pos?'ok':'bad'}">
            <div class="fv-clbl">Você recebe</div>
            <div class="fv-cval">${fmt(liquid)}</div>
            <div class="fv-csub">${sub}</div>
            ${lHtml}
        </div>`;
    }


    // ── HTML ─────────────────────────────────────────────────────
    function renderHTML() {
        const c = el('fecharVenda');
        if (!c) return;
        c.innerHTML = `

        <!-- Header -->
        <div class="fv-hdr">
            <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
            <h3>Remover Taxa</h3>
        </div>

        <!-- ══ ZONA FIXA ══
             Teclado nunca cobre esta área.
             Contém TODOS os campos de digitação. -->
        <div class="fv-top">
            <div class="fv-grid">

                <!-- Esquerda: campo de valor + resultado + busca produto -->
                <div class="fv-left">

                    <!-- Campo principal de valor -->
                    <div class="fv-vcard" id="fv_value_wrap">
                        <div class="fv-vlbl" id="fv_value_label">Você cobrou (R$)</div>
                        <div class="fv-vrow">
                            <span class="fv-curr">R$</span>
                            <input type="tel" class="fv-vinput" id="fv_value"
                                   placeholder="0,00" inputmode="decimal" autocomplete="off">
                        </div>
                    </div>

                    <!-- Campos entrada à vista (substitui campo valor) -->
                    <div class="fv-ent-grid fv-h" id="fv_entrada_fields">
                        <div>
                            <div class="fv-ent-lbl"><i class="bi bi-cash"></i> À vista</div>
                            <input type="number" class="fv-ninput" id="fv_entrada_valor" min="0" step="0.01" placeholder="0,00">
                        </div>
                        <div>
                            <div class="fv-ent-lbl"><i class="bi bi-credit-card"></i> No cartão</div>
                            <input type="number" class="fv-ninput" id="fv_cartao_valor" min="0" step="0.01" placeholder="0,00">
                        </div>
                    </div>

                    <!-- Resultado -->
                    <div id="fv_result_zone"></div>

                    <!-- Busca produto — só aparece no modo Produto -->
                    <div id="fv_top_prod_area" class="fv-h">

                        <!-- Badge produto selecionado -->
                        <div class="fv-pbadge fv-h" id="fv_prod_badge"></div>

                        <!-- Campo de busca com dropdown que SOBE (bottom:100%) -->
                        <div class="fv-srchwrap">
                            <div class="fv-results fv-h" id="fv_prod_results"></div>
                            <input type="text" class="fv-sinput" id="fv_prod_search"
                                   placeholder="Buscar produto..." autocomplete="off">
                        </div>

                    </div>

                </div><!-- /fv-left -->

                <!-- Direita: config compacta -->
                <div class="fv-right">
                    <div class="fv-cbox">

                        <!-- Máquina -->
                        <div>
                            <div class="fv-clbl2">Máquina</div>
                            <select id="fv_machine" style="display:none"></select>
                            <div class="fv-mbtns" id="fv_machine_btns"></div>
                        </div>

                        <!-- Bandeira -->
                        <div class="fv-brow fv-h" id="fv_brand_wrap">
                            <span class="fv-clbl2" style="margin:0;flex-shrink:0">Band.</span>
                            <select class="fv-bsel" id="fv_brand"></select>
                        </div>

                        <!-- Parcelas -->
                        <div>
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                                <span class="fv-clbl2">Parcelas</span>
                                <span style="font-size:.65rem;font-weight:700;color:var(--primary-color)" id="fv_inst_label">Déb</span>
                            </div>
                            <div class="fv-ibtns" id="fv_inst_btns"></div>
                            <input type="range" class="fv-islider" id="fv_installments" min="0" max="21" step="1" value="0">
                        </div>

                    </div>
                </div><!-- /fv-right -->

            </div><!-- /fv-grid -->
        </div><!-- /fv-top -->

        <div class="fv-sep"></div>

        <!-- ══ ZONA SCROLLÁVEL ══
             Toggle modo, tipo de valor, entrada à vista.
             Fica abaixo quando teclado sobe — ok,
             pois o usuário não precisa ver isso
             enquanto digita. -->
        <div class="fv-bottom">

            <!-- Toggle Manual / Produto -->
            <div class="fv-mtog">
                <span class="fv-tlbl active" id="fv_lbl_manual">
                    <i class="bi bi-pencil"></i> Manual
                </span>
                <label class="fv-tsw">
                    <input type="checkbox" id="fv_modo_toggle">
                    <span class="fv-tknob"></span>
                </label>
                <span class="fv-tlbl" id="fv_lbl_produto">
                    <i class="bi bi-box-seam"></i> Produto
                </span>
            </div>

            <!-- Área Produto — só mostra toggle entrada à vista -->
            <div id="fv_produto_area" class="fv-h">
                <div class="fv-h" id="fv_entrada_wrap">
                    <label class="fv-eslbl">
                        <input type="checkbox" id="fv_entrada_check">
                        <span><i class="bi bi-cash-coin"></i> Teve valor à vista?</span>
                    </label>
                </div>
            </div>

        </div><!-- /fv-bottom -->
        `;
    }

    // ── Eventos ───────────────────────────────────────────────────
    function bindEvents() {
        el('fv_installments')?.addEventListener('input', () => {
            syncInstLabel(); renderInstBtns(); calculate();
        });
        el('fv_brand')?.addEventListener('change', calculate);
        el('fv_modo_toggle')?.addEventListener('change', onModoChange);

        el('fv_prod_search')?.addEventListener('input', onSearchInput);
        el('fv_prod_search')?.addEventListener('focus', onSearchInput);

        el('fv_entrada_check')?.addEventListener('change', onEntradaToggle);
        el('fv_entrada_valor')?.addEventListener('input', calculate);
        el('fv_cartao_valor')?.addEventListener('input', calculate);

        moneyMask(el('fv_value'));
    }

    // Fecha dropdown de busca ao clicar fora — vive em `document`
    // (não em algum nó de dentro de #fecharVenda), então NÃO é
    // destruído quando renderHTML() troca o innerHTML. Registrar de
    // novo a cada reabertura da tela empilharia um listener idêntico
    // por visita, pra sempre — por isso fica fora de bindEvents(),
    // com a própria trava de "só uma vez" (essa aqui é segura,
    // porque não depende de nenhum nó recriado — sempre busca os
    // elementos atuais via el() no momento do clique).
    let clickForaJaRegistrado = false;
    function bindClickFora() {
        if (clickForaJaRegistrado) return;
        clickForaJaRegistrado = true;
        document.addEventListener('click', e => {
            const res = el('fv_prod_results');
            const inp = el('fv_prod_search');
            if (res && inp && !inp.contains(e.target) && !res.contains(e.target)) {
                res.classList.add('fv-h');
            }
        }, true);
    }

    // ── API chamada pelo app.js quando taxas chegam ──────────────
    // Mesma instrumentação — esse caminho roda separado (disparado por
    // um onValue no core.js sempre que a taxa muda no Firebase, não só
    // na entrada da tela), então precisa da própria proteção.
    window._fvOnRatesLoaded = function() {
        try {
            calculate();
        } catch (e) {
            console.error('[Remover Taxa] Erro ao recalcular com taxa nova:', e);
        }
    };

    // ── Compatibilidade: precoBase externo ───────────────────────
    let precoBaseIntervalId = null;
    function watchPrecoBase() {
        // Limpa o interval anterior antes de criar outro — sem isso,
        // toda reabertura da tela empilhava mais um setInterval rodando
        // pra sempre em paralelo (agora que init() reconstrói tudo a
        // cada visita, isso teria virado um vazamento de verdade).
        if (precoBaseIntervalId) clearInterval(precoBaseIntervalId);
        let last = 0;
        precoBaseIntervalId = setInterval(() => {
            try {
                const ext = window._fecharVendaPrecoBase || 0;
                if (ext !== last) {
                    last = ext; precoBase = ext;
                    el('fv_entrada_wrap')?.classList.remove('fv-h');
                    calculate();
                }
            } catch (e) {
                console.error('[Remover Taxa] Erro no watchPrecoBase:', e);
            }
        }, 500);
    }

    // ── Init ─────────────────────────────────────────────────────
    // SEMPRE reconstrói o HTML do zero, a cada visita — não guarda
    // "já inicializei uma vez, só atualizo o que existe" como fazia
    // antes. Esse padrão de "monta uma vez, reaproveita pra sempre"
    // era o único, entre todas as calculadoras, que presumia que o
    // DOM antigo continuava intacto entre visitas — arriscado, porque
    // QUALQUER coisa que deixasse esse DOM num estado inesperado
    // (mesmo algo fora desse arquivo) quebrava essa tela específica
    // sem quebrar as outras. innerHTML novo destrói os nós antigos
    // JUNTO com os listeners deles — então religar os eventos em
    // cima do HTML fresco é seguro, não duplica nada.
    function init() {
        renderHTML();
        refreshMachineSelect();
        updateBrandVis();
        renderMachineBtns();
        renderInstBtns();
        bindEvents();
        bindClickFora();
        watchPrecoBase();

        setTimeout(() => el('fv_value')?.focus(), 150);
    }

    // Atualiza o select hidden de máquinas com base no padrão e desativadas
    function refreshMachineSelect() {
        const msel = el('fv_machine');
        if (!msel) return;
        const machines = getMachines();
        const saved = safeGet('ctwDefaultMachine') || 'pagbank';
        // Se a máquina padrão está desativada, usa a primeira disponível
        const defaultV = machines.find(m => m.v === saved) ? saved : (machines[0]?.v || 'pagbank');
        msel.innerHTML = machines
            .map(m=>`<option value="${m.v}" ${m.v===defaultV?'selected':''}>${m.l}</option>`)
            .join('');
    }

    // ── API pública ──────────────────────────────────────────────
    // Instrumentado de propósito: se QUALQUER coisa aqui dentro
    // (renderHTML, refreshMachineSelect, calculate, etc) lançar uma
    // exceção, antes isso ficava mudo — a tela simplesmente não
    // terminava de montar e parecia "travada". Agora qualquer erro
    // aparece DE VERDADE na tela, com a mensagem real do JS e um
    // botão de tentar de novo — assim, se acontecer de novo, dá pra
    // ver o motivo exato (e me mandar print) em vez de eu ficar
    // chutando teoria atrás de teoria.
    window._initFecharVenda = () => {
        try {
            init();
            calculate();
        } catch (e) {
            console.error('[Remover Taxa] Erro ao inicializar:', e);
            const c = el('fecharVenda');
            if (c) {
                c.innerHTML = `
                    <div class="fv-hdr">
                        <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                        <h3>Remover Taxa</h3>
                    </div>
                    <div style="padding:30px 20px;text-align:center;">
                        <div style="font-size:2.2rem;margin-bottom:12px;">⚠️</div>
                        <div style="font-weight:700;margin-bottom:8px;color:var(--text-strong);">Essa tela não carregou.</div>
                        <div style="font-size:.76rem;color:var(--text-secondary);word-break:break-word;background:rgba(var(--overlay-rgb),.05);border-radius:10px;padding:10px;margin-top:10px;">${(e && e.message) || String(e)}</div>
                        <button type="button" class="btn btn-secondary w-100 mt-3" id="fvTentarDeNovoBtn">Tentar de novo</button>
                    </div>
                `;
                c.querySelector('.btn-back')?.addEventListener('click', () => window.openCalculatorSection && window.openCalculatorSection('calculatorHome'));
                el('fvTentarDeNovoBtn')?.addEventListener('click', () => window._initFecharVenda());
            }
        }
    };
    window._fvSelectProduct = p  => { if (p) selectProduct(p); };

})();
