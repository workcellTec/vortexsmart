// ================================================================
// inicio-mobile.js — VortexSmart · Tela Início do celular
//
// Monta com dados reais o que o mockup aprovado mostra na Início:
//   • topo: iniciais, saudação por horário, nome e contador de notificações (o contador vem do core.js)
//   • "Entrou hoje · N vendas", valor e comparação com ontem
//   • rosca "Entrou por forma de pagamento" (mês) · Meta do mês · Concertos
//   • subtítulos dos módulos em "Seus módulos"
//
// "Entrou" = dinheiro que de fato entrou (regime de caixa, valor líquido, sem taxa de maquininha) —
// a MESMA regra do Resumo do Financeiro (window._percorrerEntradas, em venda/relatorios.js).
//
// Escopo por papel (igual ao antigo resumo da Início): Gestor, ou Funcionário com a permissão
// 'vendas_ver_todas', vê a loja inteira; Funcionário comum vê só as próprias vendas (única consulta
// que a regra do servidor libera) e não vê a Meta, que é da loja.
// A leitura é uma janela: vendas criadas desde o início do mês (ou de ontem, se for mais antigo)
// + todas as pendentes. Parcela de carnê paga agora numa venda de meses atrás só aparece no Financeiro.
//
// Meta do mês: configuracoes/metaMes (número, só o Gestor altera).
//
// Expõe via window.*: _vsInicioAtualizar, _vsInicioPerfil, _vsAbrirConta
// Depende de (via window.*): _lojaId, _lojaRef, _dbGet, _dbQuery, _dbOrderByChild, _dbStartAt, _dbEqualTo,
//   _dbOnValue, _dbUpdate, _firebaseAuthUid, _papelUsuario, _papelAtual, _temPermissao, _nomeUsuario,
//   _reparosConfig, _percorrerEntradas, _notificacoesRecebidas, _nomeLojaCadastrada, _confirmarSair, openConfiguracoesSection, showCustomModal
// ================================================================
(function () {
    'use strict';
    if (document.documentElement.getAttribute('data-shell') !== 'mobile') return;

    const el = id => document.getElementById(id);
    const DIA = 24 * 60 * 60 * 1000;
    const num1 = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    // 18600 → "R$ 18,6k" · 850 → "R$ 850" · 1.250.000 → "R$ 1,3M"
    function brlCurto(n) {
        if (n >= 1e6) return 'R$ ' + (n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
        if (n >= 1e3) return 'R$ ' + (n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
        return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
    }
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
    const ehGestor = () => window._papelUsuario === 'gestor';
    const veTodas = () => ehGestor() || (typeof window._temPermissao === 'function' && window._temPermissao('vendas_ver_todas'));
    const concertosVisivel = () => { const b = el('goToReparos'); return !!b && b.style.display !== 'none'; };

    // ── Topo: iniciais, saudação, nome ─────────────────────────
    function saudacao() {
        const h = new Date().getHours();
        return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    }
    function iniciais(nome) {
        const p = nome.trim().split(/\s+/).filter(Boolean);
        if (!p.length) return '··';
        return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
    }

    // Também decide quais cards existem pra este usuário (Meta só pra quem vê a loja inteira, Concertos
    // só se o módulo está liberado) e a visibilidade de Configurações. Roda a cada render da barra.
    window._vsInicioPerfil = function () {
        const nome = (window._nomeUsuario || '').trim();
        const ini = el('vsTopoIniciais'), nm = el('vsTopoNome'), oi = el('vsTopoSaudacao');
        if (ini) ini.textContent = iniciais(nome);
        if (nm) nm.textContent = nome.split(/\s+/)[0] || 'Usuário';
        if (oi) oi.textContent = saudacao();

        const meta = el('vsIniMeta'), conc = el('vsIniConcertos'), col = document.querySelector('.vs-ini-col');
        if (meta) meta.style.display = veTodas() ? '' : 'none';
        if (conc) conc.style.display = concertosVisivel() ? '' : 'none';
        if (col) col.style.display = (veTodas() || concertosVisivel()) ? '' : 'none';
    };

    // ── Entradas: hoje, ontem e mês por forma de pagamento ─────
    const FORMAS = {
        pix:      { nome: 'Pix',      cor: 'var(--success)' },
        credito:  { nome: 'Crédito',  cor: 'var(--primary)' },
        debito:   { nome: 'Débito',   cor: 'var(--text-secondary)' },
        dinheiro: { nome: 'Dinheiro', cor: 'var(--text-muted)' },
        outros:   { nome: 'Outros',   cor: 'var(--warning)' },
    };
    function formaDe(p) {
        if (p.forma === 'pix') return 'pix';
        if (p.forma === 'dinheiro') return 'dinheiro';
        if (p.forma === 'cartao') return /d[ée]bito/i.test(p.formaLabel || '') ? 'debito' : 'credito';
        return 'outros';
    }
    function somarEntradas(vendas, ini, fim, porForma) {
        let total = 0;
        window._percorrerEntradas(vendas, ini, fim, (p, bruto, liquido) => {
            total += liquido;
            if (porForma) { const f = formaDe(p); porForma[f] = (porForma[f] || 0) + liquido; }
        });
        return total;
    }

    function desenharDia(vendas, pendentes) {
        const agora = new Date();
        const ini = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
        const fim = ini + DIA - 1;
        const hoje = somarEntradas(vendas, ini, fim);
        const ontem = somarEntradas(vendas, ini - DIA, ini - 1);
        const lancadasHoje = vendas.filter(v => (v.status === 'fechada' || v.status === 'pendente') && (v.criadoEm || 0) >= ini && (v.criadoEm || 0) <= fim).length;

        el('vsIniRotulo').textContent = `${veTodas() ? 'Entrou hoje' : 'Você vendeu hoje'} · ${plural(lancadasHoje, 'venda', 'vendas')}` +
            (pendentes > 0 ? ` · ${plural(pendentes, 'pendente', 'pendentes')}` : '');
        el('vsIniValor').textContent = brl(hoje);

        const d = el('vsIniDelta');
        d.className = 'vs-ini-dia-delta';
        if (ontem > 0) {
            const v = (hoje - ontem) / ontem * 100;
            if (Math.abs(v) < 0.05) { d.textContent = 'igual a ontem'; d.classList.add('neutro'); }
            else { d.textContent = `${v > 0 ? '▲' : '▼'} ${num1(Math.abs(v))}% em relação a ontem`; if (v < 0) d.classList.add('neg'); }
        } else {
            d.textContent = '';
        }
    }

    let totalMes = 0;   // entrou no mês: alimenta o centro da rosca e a barra da meta
    function desenharRosca(vendas) {
        const agora = new Date();
        const iniMes = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
        const fimMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 1).getTime() - 1;
        const porForma = {};
        totalMes = somarEntradas(vendas, iniMes, fimMes, porForma);
        desenharMeta();

        el('vsIniRoscaTotal').textContent = brlCurto(totalMes);
        const grupo = el('vsIniRoscaFatias'), leg = el('vsIniLegenda');
        grupo.innerHTML = '';
        leg.innerHTML = '';

        const fatias = Object.keys(porForma).filter(k => porForma[k] > 0.004).sort((a, b) => porForma[b] - porForma[a]);
        if (!fatias.length) {
            const v = document.createElement('div');
            v.className = 'vs-ini-vazio';
            v.textContent = 'Nenhuma entrada neste mês ainda.';
            leg.appendChild(v);
            return;
        }
        // porcentagens inteiras que somam 100 (maior resto)
        const pct = fatias.map(k => Math.floor(porForma[k] / totalMes * 100));
        let resto = 100 - pct.reduce((a, b) => a + b, 0);
        fatias.map((k, i) => [porForma[k] / totalMes * 100 - pct[i], i]).sort((a, b) => b[0] - a[0])
            .forEach(([, i]) => { if (resto > 0) { pct[i] += 1; resto -= 1; } });

        const CIR = 2 * Math.PI * 40;
        let acc = 0;
        fatias.forEach((k, i) => {
            const len = porForma[k] / totalMes * CIR;
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', '40');
            c.style.stroke = FORMAS[k].cor;
            c.setAttribute('stroke-dasharray', `${Math.max(0.01, fatias.length > 1 ? len - 2 : len).toFixed(2)} ${CIR.toFixed(2)}`);
            c.setAttribute('stroke-dashoffset', (-acc).toFixed(2));
            grupo.appendChild(c);
            acc += len;

            const li = document.createElement('div');
            li.className = 'vs-ini-leg';
            li.innerHTML = '<i></i><b></b><span></span>';
            li.firstChild.style.background = FORMAS[k].cor;
            li.querySelector('b').textContent = FORMAS[k].nome;
            li.querySelector('span').textContent = pct[i] ? pct[i] + '%' : '<1%';
            leg.appendChild(li);
        });
    }

    // ── Meta do mês ────────────────────────────────────────────
    let metaMes = 0;
    let ouvindoMetaDaLoja = null;
    function ouvirMeta() {
        if (!window._lojaId || ouvindoMetaDaLoja === window._lojaId || typeof window._dbOnValue !== 'function') return;
        ouvindoMetaDaLoja = window._lojaId;
        window._dbOnValue(window._lojaRef('configuracoes/metaMes'), snap => {
            const v = Number(snap.val());
            metaMes = Number.isFinite(v) && v > 0 ? v : 0;
            desenharMeta();
        }, () => { /* sem permissão de leitura: card fica sem meta */ });
    }
    function desenharMeta() {
        const total = totalMes;
        const pctEl = el('vsIniMetaPct'), barra = el('vsIniMetaBarra'), txt = el('vsIniMetaTxt'), card = el('vsIniMeta');
        if (!pctEl) return;
        card.disabled = !ehGestor();
        if (metaMes > 0) {
            pctEl.textContent = Math.round(total / metaMes * 100) + '%';
            barra.style.width = Math.min(100, total / metaMes * 100) + '%';
            txt.textContent = `${brlCurto(total)} de ${brlCurto(metaMes)}`;
        } else {
            pctEl.textContent = '—';
            barra.style.width = '0';
            txt.textContent = ehGestor() ? 'Toque para definir' : 'Meta não definida';
        }
    }

    function fecharFolhaMeta() { el('vsMetaFolha')?.classList.remove('active'); }
    function paraNumero(t) {
        const n = parseFloat(String(t).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }
    function gravarMeta(valor) {
        const refLoja = window._lojaRef('configuracoes');
        return window._dbUpdate(refLoja, { metaMes: valor > 0 ? Math.round(valor * 100) / 100 : null })
            .then(() => fecharFolhaMeta())
            .catch(e => {
                console.error('Erro ao salvar a meta do mês:', e);
                window.showCustomModal({ message: 'Não foi possível salvar a meta. Confira a conexão e a permissão de Configurações.' });
            });
    }
    function abrirFolhaMeta() {
        if (!ehGestor()) return;
        let f = el('vsMetaFolha');
        if (!f) {
            f = document.createElement('div');
            f.id = 'vsMetaFolha';
            f.className = 'vs-folha-overlay';
            f.innerHTML = `
                <div class="vs-folha" role="dialog" aria-label="Meta do mês">
                    <div class="vs-folha-alca"></div>
                    <div class="vs-folha-titulo">Meta do mês</div>
                    <div class="vs-folha-sub">Quanto a loja quer que entre neste mês. A barra da Início mostra quanto já entrou.</div>
                    <label class="vs-meta-campo"><span>R$</span><input id="vsMetaInput" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-label="Valor da meta"></label>
                    <div class="vs-meta-acoes">
                        <button type="button" class="btn btn-secondary" id="vsMetaRemover">Sem meta</button>
                        <button type="button" class="btn btn-primary" id="vsMetaSalvar">Salvar</button>
                    </div>
                </div>`;
            document.body.appendChild(f);
            f.addEventListener('click', e => { if (e.target === f) fecharFolhaMeta(); });
            f.querySelector('#vsMetaSalvar').addEventListener('click', () => {
                const v = paraNumero(el('vsMetaInput').value);
                if (v <= 0) { window.showCustomModal({ message: 'Informe um valor maior que zero, ou toque em "Sem meta".' }); return; }
                gravarMeta(v);
            });
            f.querySelector('#vsMetaRemover').addEventListener('click', () => gravarMeta(0));
        }
        el('vsMetaInput').value = metaMes > 0 ? metaMes.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        void f.offsetWidth;
        f.classList.add('active');
    }

    // ── Concertos e Reposição ──────────────────────────────────
    const ETAPAS_PRONTO = ['finalizado', 'fin_loja'];
    function desenharConcertos(ordens) {
        const modo = (window._reparosConfig || {}).modo || null;
        if (!modo) {   // Gestor ainda não escolheu o fluxo: o card leva direto pra configuração
            el('vsIniConcN').textContent = '–';
            const aviso = el('vsIniConcSub');
            aviso.textContent = 'configure pra liberar';
            aviso.className = 'vs-ini-conc-sub neutro';
            aviso.style.color = '';
            const t = el('goToReparosSub');
            if (t) t.textContent = 'configure pra liberar';
            return;
        }
        const ativos = ordens.filter(o => o && o.status !== 'entregue');
        const prontos = ativos.filter(o => ETAPAS_PRONTO.includes(o.status)).length;
        const atrasados = ativos.filter(o => o.prazoTs && o.prazoTs < Date.now()).length;

        const partes = [];
        if (prontos) partes.push(plural(prontos, 'pronto', 'prontos'));
        if (atrasados) partes.push(plural(atrasados, 'atrasado', 'atrasados'));
        const sub = el('vsIniConcSub');
        el('vsIniConcN').textContent = String(ativos.length);
        sub.textContent = partes.length ? partes.join(' · ') : (ativos.length ? 'em andamento' : 'nenhum em aberto');
        sub.className = 'vs-ini-conc-sub' + (partes.length ? '' : ' neutro');
        sub.style.color = atrasados ? 'var(--danger)' : '';

        const tile = el('goToReparosSub');
        if (tile) tile.textContent = prontos ? plural(prontos, 'pronto', 'prontos') : `${ativos.length} em aberto`;
    }

    // ── Conta (toque no avatar): folha de baixo ────────────────
    function fecharConta() { el('vsContaFolha')?.classList.remove('active'); }
    function linhaConta(icone, titulo, sub, extra, classe) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vs-linha' + (classe ? ' ' + classe : '');
        b.innerHTML = `<span class="vs-linha-ic"><svg class="vs-ic" width="21" height="21" aria-hidden="true"><use href="#vsi-${icone}"/></svg></span>` +
            '<span class="vs-linha-nome"><span></span><small></small></span>' + (extra ? `<span class="vs-linha-badge">${extra}</span>` : '');
        b.querySelector('.vs-linha-nome span').textContent = titulo;
        const small = b.querySelector('small');
        if (sub) small.textContent = sub; else small.remove();
        return b;
    }
    window._vsAbrirConta = function () {
        let f = el('vsContaFolha');
        if (!f) {
            f = document.createElement('div');
            f.id = 'vsContaFolha';
            f.className = 'vs-folha-overlay';
            f.innerHTML = '<div class="vs-folha" role="dialog" aria-label="Conta"><div class="vs-folha-alca"></div><div class="vs-folha-titulo"></div><div id="vsContaLista"></div></div>';
            document.body.appendChild(f);
            f.addEventListener('click', e => { if (e.target === f) fecharConta(); });
        }
        const nome = (window._nomeUsuario || '').trim();
        const loja = (window._nomeLojaCadastrada || '').trim();
        f.querySelector('.vs-folha-titulo').textContent = [nome.split(/\s+/)[0] || 'Conta', loja].filter(Boolean).join(' · ');
        const novas = (window._notificacoesRecebidas || []).filter(n => !n.lida && !n.limparEm).length;
        const lista = f.querySelector('#vsContaLista');
        lista.innerHTML = '';
        const notif = linhaConta('bell', 'Notificações', novas ? plural(novas, 'nova', 'novas') : 'nenhuma nova', novas ? (novas > 9 ? '9+' : String(novas)) : '');
        notif.addEventListener('click', () => { fecharConta(); el('ctwNavNotif')?.click(); });
        const cust = linhaConta('spark', 'Customizações', 'aparência e cor', '');
        cust.addEventListener('click', () => {
            fecharConta();
            if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesCustomizacoes');
        });
        const sair = linhaConta('exit', 'Sair da conta', loja, '', 'perigo');
        sair.addEventListener('click', () => { fecharConta(); window._confirmarSair(); });
        lista.append(notif, cust, sair);
        void f.offsetWidth;
        f.classList.add('active');
    };

    // Sem isto a falha ficava muda e a Início parecia "zerada"; agora o rótulo diz o que houve.
    function avisarFalhaEntradas(msg) {
        const r = el('vsIniRotulo');
        if (r) r.textContent = msg;
    }

    // ── Atualização ────────────────────────────────────────────
    let seq = 0;
    window._vsInicioAtualizar = function () {
        window._vsInicioPerfil();
        if (!window._lojaId || typeof window._dbGet !== 'function' || typeof window._percorrerEntradas !== 'function') return;
        ouvirMeta();
        const minha = ++seq;
        const ativa = () => minha === seq;

        const agora = new Date();
        const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
        const desde = Math.min(new Date(agora.getFullYear(), agora.getMonth(), 1).getTime(), inicioHoje - DIA);
        const todas = veTodas();
        const consulta = todas
            ? window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('criadoEm'), window._dbStartAt(desde))
            : window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('criadoPorUid'), window._dbEqualTo(window._firebaseAuthUid));
        // Pendentes de qualquer dia (a janela acima deixaria as antigas de fora; o funcionário já recebe todas as dele).
        const consultaPend = todas ? window._dbQuery(window._lojaRef('vendas'), window._dbOrderByChild('status'), window._dbEqualTo('pendente')) : null;

        // Duas leituras independentes: a lista pesada de pendentes (consulta por status, de qualquer dia)
        // nunca segura nem derruba o dia e a rosca, que só dependem da janela do mês.
        let janela = null, pendentes = {};
        const desenhar = () => {
            if (!ativa() || !janela) return;
            const vendas = Object.values(Object.assign({}, pendentes, janela)).filter(Boolean);
            try {
                desenharDia(vendas, vendas.filter(v => v.status === 'pendente').length);
                desenharRosca(vendas);
            } catch (e) {
                console.error('[Início] erro ao desenhar as entradas:', e);
                avisarFalhaEntradas('Erro ao montar as entradas');
            }
        };
        window._dbGet(consulta).then(snap => {
            janela = snap.val() || {};
            desenhar();
        }).catch(e => {
            console.error('[Início] leitura das vendas recusada:', e && e.code, e);
            if (ativa()) avisarFalhaEntradas('Não foi possível carregar as entradas');
        });
        if (consultaPend) {
            window._dbGet(consultaPend).then(snap => {
                pendentes = snap.val() || {};
                desenhar();
            }).catch(e => console.error('[Início] leitura das pendentes recusada:', e && e.code, e));
        }

        if (concertosVisivel()) {
            if (!(window._reparosConfig || {}).modo) desenharConcertos([]);
            else window._dbGet(window._lojaRef('reparos')).then(snap => {
                if (ativa()) desenharConcertos(Object.values(snap.val() || {}));
            }).catch(() => {});
        }

        window._dbGet(window._lojaRef('reposicao/itens')).then(snap => {
            if (!ativa()) return;
            const faltam = Object.values(snap.val() || {}).filter(i => i && !i.comprado).length;
            const sub = el('goToReposicaoSub');
            if (sub) sub.textContent = faltam ? plural(faltam, 'item', 'itens') : 'nada a comprar';
        }).catch(() => {});
    };

    document.addEventListener('DOMContentLoaded', () => {
        el('vsIniMeta')?.addEventListener('click', abrirFolhaMeta);
        el('vsIniConcertos')?.addEventListener('click', () => el('goToReparos')?.click());
        el('goToConfig')?.addEventListener('click', () => {
            if (typeof window.openConfiguracoesSection === 'function') window.openConfiguracoesSection('configuracoesHome');
        });
        window._vsInicioPerfil();
    });
})();
