// ================================================================
// atualizacao.js — VortexSmart · Atualização automática do app
// Registra: window._vsAtualizacao { verificar, aplicar, estado, setAuto }
//           window._abrirAtualizacaoApp()   (Configurações → Atualização do app)
// Também é chamado pelo index.html (swNovo) quando um Service Worker novo assume o controle.
//
// Como funciona: o app compara a versão que está rodando (window._VS_VERSAO, no
// index.html) com a que o servidor tem AGORA (lê o index.html com cache desligado).
// Se forem diferentes, mostra "Atualização encontrada", espera uns segundos e recarrega
// sozinho — sem limpar cache, sem esperar o navegador decidir buscar o Service Worker novo.
// A versão no servidor muda a cada envio ao GitHub (o fluxo do GitHub Pages carimba a data
// e o código do envio; no Firebase vale o número que está no index.html).
//
// Quando checa: ~8s depois de abrir, a cada 10 min com o app aberto, ao voltar pro app e
// ao recuperar a internet. Nunca recarrega no meio de uma digitação. "Ignorar" no aviso vale até
// fechar o app (dos recentes) e abrir de novo: nada recarrega sozinho enquanto ele estiver aberto.
// Não roda no programa instalado do computador (.exe): ele é uma cópia congelada de propósito.
// ================================================================
(function () {
    'use strict';

    const CHAVE_AUTO = 'vsmart_atualizar_sozinho';   // '0' = só avisa, não recarrega sozinho
    const CHAVE_TENTATIVA = 'vsAtualizando';          // sessionStorage: versão que acabamos de tentar aplicar
    const INTERVALO_MS = 10 * 60 * 1000;
    const MINIMO_ENTRE_MS = 60 * 1000;
    const ESPERA_S = 6;

    const el = id => document.getElementById(id);
    const lerLS = c => { try { return localStorage.getItem(c); } catch (e) { return null; } };
    const gravarLS = (c, v) => { try { localStorage.setItem(c, v); } catch (e) { /* sem armazenamento: usa o padrão */ } };
    const lerSS = c => { try { return sessionStorage.getItem(c); } catch (e) { return null; } };
    const gravarSS = (c, v) => { try { sessionStorage.setItem(c, v); } catch (e) { /* idem */ } };
    const apagarSS = c => { try { sessionStorage.removeItem(c); } catch (e) { /* idem */ } };

    const instalada = () => String(window._VS_VERSAO || '');
    const noPrograma = () => typeof window.vsmartPrint === 'object' && window.vsmartPrint !== null;
    const ehWeb = () => location.protocol === 'http:' || location.protocol === 'https:';
    const ativo = () => !noPrograma() && ehWeb();
    const automatico = () => lerLS(CHAVE_AUTO) !== '0';

    let ultimaChecagem = 0;
    let resultado = 'Ainda não verificado.';
    let servidor = null;       // versão que o servidor tem, quando é diferente da instalada
    let checando = null;       // promessa da checagem em andamento (evita duas ao mesmo tempo)
    let contagem = null;       // intervalo da contagem regressiva do aviso
    let ignorada = null;       // versão que a pessoa mandou ignorar; vale só até o app ser fechado (fica na memória da página)

    // ── Leitura da versão no servidor ───────────────────────────────────────
    // O Service Worker responde "rede primeiro" e grava a resposta no cache dele; usar sempre
    // a MESMA url (sem carimbo de hora) mantém um único item lá e ainda renova o index offline.
    async function versaoDoServidor() {
        const resp = await fetch(new URL('index.html', location.href).href, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const m = (await resp.text()).match(/_VS_VERSAO\s*=\s*'([^']+)'/);
        if (!m) throw new Error('sem versão no arquivo');
        return m[1];
    }

    function verificar(opcoes) {
        const manual = !!(opcoes && opcoes.manual);
        if (!ativo()) { resultado = 'Atualização automática não se aplica a este formato.'; return Promise.resolve(estado()); }
        if (checando) return checando;
        const forcar = !!(opcoes && opcoes.forcar);
        if (!manual && !forcar && Date.now() - ultimaChecagem < MINIMO_ENTRE_MS) return Promise.resolve(estado());
        checando = versaoDoServidor().then(v => {
            ultimaChecagem = Date.now();
            if (v === instalada()) { servidor = null; resultado = 'Você está na versão mais recente.'; }
            else { servidor = v; resultado = 'Há uma versão nova.'; anunciar(manual); }
        }).catch(e => {
            ultimaChecagem = Date.now();
            resultado = navigator.onLine === false ? 'Sem internet agora. Tento de novo quando voltar.' : 'Não consegui verificar agora (' + (e && e.message ? e.message : 'erro') + ').';
        }).then(() => { checando = null; avisarPainel(); return estado(); });
        return checando;
    }

    function estado() {
        return { instalada: instalada(), servidor, ultimaChecagem, resultado, auto: automatico(), ativo: ativo() };
    }

    // ── Aplicar: recarrega já com a versão nova ─────────────────────────────
    function aplicar() {
        if (!servidor) return;
        gravarSS(CHAVE_TENTATIVA, servidor);   // se, mesmo recarregando, a versão não mudar, não entra em loop
        pararContagem();
        location.reload();
    }

    // ── Aviso na tela ───────────────────────────────────────────────────────
    function ignorar() { ignorada = servidor; fecharAviso(); }
    function fecharAviso() { pararContagem(); const a = el('vsAtualizacaoAviso'); if (a) a.remove(); }
    function pararContagem() { if (contagem) { clearInterval(contagem); contagem = null; } }

    function emUsoAgora() {
        // Não recarrega com a pessoa no meio de uma digitação.
        const a = document.activeElement;
        return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && (a.value || '').length > 0 && a.type !== 'checkbox' && a.type !== 'radio');
    }

    function desenharAviso(textoFn, botoes) {
        let a = el('vsAtualizacaoAviso');
        if (!a) {
            a = document.createElement('div');
            a.id = 'vsAtualizacaoAviso';
            a.setAttribute('role', 'status');
            a.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top,0px));z-index:100000;display:flex;align-items:center;gap:10px;width:min(94vw,440px);box-sizing:border-box;padding:10px 12px 10px 16px;border-radius:16px;background:var(--modal-card-bg);color:var(--text-strong);border:1px solid rgba(var(--primary-rgb,91,61,245),.6);box-shadow:0 12px 36px rgba(0,0,0,.5);font:600 .82rem/1.3 Poppins,system-ui,sans-serif;';
            document.body.appendChild(a);
        }
        a.innerHTML = '';
        const t = document.createElement('span');
        t.id = 'vsAtualizacaoTexto';
        t.style.flex = '1';
        t.textContent = textoFn(ESPERA_S);
        a.appendChild(t);
        botoes.forEach(([rotulo, acao, destaque]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = rotulo;
            b.style.cssText = 'flex:0 0 auto;height:34px;padding:0 12px;border-radius:10px;cursor:pointer;font:700 .76rem Poppins,system-ui,sans-serif;border:1px solid var(--border);' +
                (destaque ? 'background:var(--primary);color:var(--on-primary,#fff);border-color:transparent;' : 'background:transparent;color:inherit;');
            b.addEventListener('click', acao);
            a.appendChild(b);
        });
        return t;
    }

    function anunciar(manual) {
        if (!servidor) return;
        // Já tentei esta mesma versão nesta sessão e o app continuou na antiga: algo (cache) está segurando.
        // Não recarrega de novo (seria um loop); o painel em Configurações explica.
        if (lerSS(CHAVE_TENTATIVA) === servidor) {
            resultado = 'Há uma versão nova, mas este aparelho não conseguiu carregá-la. Feche o app por completo e abra de novo.';
            return;
        }
        if (!manual && ignorada === servidor) return;
        if (document.visibilityState !== 'visible') return;   // volta a anunciar quando a pessoa voltar pro app
        if (el('vsAtualizacaoAviso')) return;

        if (!automatico()) {
            desenharAviso(() => 'Atualização encontrada.', [['Atualizar agora', aplicar, true], ['Ignorar', ignorar]]);
            return;
        }
        let restante = ESPERA_S;
        const texto = n => 'Atualização encontrada · atualizando em ' + n + 's';
        const t = desenharAviso(texto, [['Agora', aplicar, true], ['Ignorar', ignorar]]);
        contagem = setInterval(() => {
            if (emUsoAgora()) { restante = ESPERA_S; t.textContent = 'Atualização encontrada · espero você terminar de digitar'; return; }
            restante -= 1;
            if (restante <= 0) { aplicar(); return; }
            t.textContent = texto(restante);
        }, 1000);
    }

    // ── Painel em Configurações → Atualização do app ────────────────────────
    function quando(ms) {
        if (!ms) return 'ainda não verificou';
        return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }

    function avisarPainel() {
        const sub = el('cfgAtualizacaoSub');
        if (sub) sub.textContent = 'Versão ' + (instalada() || '—') + (servidor ? ' · há versão nova' : '');
        if (el('vsAtualFundo')) desenharPainel();
    }

    function desenharPainel() {
        const caixa = el('vsAtualCaixa');
        if (!caixa) return;
        const e = estado();
        const fixo = !e.ativo;
        caixa.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;"><strong style="flex:1;">🔄 Atualização do app</strong><button type="button" id="vsAtualFechar" class="btn btn-sm" style="min-width:40px;" aria-label="Fechar">✕</button></div>
            <div style="font-size:.84rem;line-height:1.7;">
                <div>Versão em uso: <b>${instalada() || '—'}</b></div>
                <div>Última verificação: <b>${quando(e.ultimaChecagem)}</b></div>
                <div id="vsAtualStatus" style="margin-top:4px;color:${servidor ? 'var(--warning)' : 'var(--text-secondary)'};">${fixo ? 'Este é o programa instalado no computador: ele só muda quando o programa for trocado.' : e.resultado}</div>
            </div>
            ${fixo ? '' : `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);">
                <div><b style="font-size:.86rem;">Atualizar sozinho</b><div style="font-size:.72rem;opacity:.7;margin-top:2px;">Ao achar versão nova, avisa e recarrega em poucos segundos. Desligado, só avisa.</div></div>
                <button type="button" class="ctx-switch${e.auto ? ' on' : ''}" id="vsAtualAuto" role="switch" aria-checked="${e.auto ? 'true' : 'false'}" aria-label="Atualizar sozinho"></button>
            </div>
            <div style="display:flex;gap:8px;">
                <button type="button" id="vsAtualVerificar" class="btn" style="flex:1;">Verificar agora</button>
                ${servidor ? '<button type="button" id="vsAtualAplicar" class="btn btn-ok" style="flex:1;">Atualizar agora</button>' : ''}
            </div>`}`;
        el('vsAtualFechar').addEventListener('click', fecharPainel);
        if (fixo) return;
        el('vsAtualAuto').addEventListener('click', () => { setAuto(!automatico()); desenharPainel(); });
        el('vsAtualVerificar').addEventListener('click', () => {
            const b = el('vsAtualVerificar');
            b.disabled = true; b.textContent = 'Verificando…';
            verificar({ manual: true }).then(() => { fecharAviso(); desenharPainel(); });
        });
        el('vsAtualAplicar')?.addEventListener('click', aplicar);
    }

    function fecharPainel() { const f = el('vsAtualFundo'); if (f) f.remove(); if (window._vsDestravarScroll) window._vsDestravarScroll(); }

    window._abrirAtualizacaoApp = function () {
        fecharPainel();
        const fundo = document.createElement('div');
        fundo.id = 'vsAtualFundo';
        fundo.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;';
        fundo.innerHTML = '<div id="vsAtualCaixa" style="background:var(--modal-card-bg);color:var(--text-strong);border-radius:16px;width:min(460px,100%);display:flex;flex-direction:column;padding:16px;gap:12px;box-shadow:0 20px 60px rgba(0,0,0,.5);"></div>';
        document.body.appendChild(fundo);
        fundo.addEventListener('click', e => { if (e.target === fundo) fecharPainel(); });
        desenharPainel();
        verificar({ manual: true }).then(() => { fecharAviso(); desenharPainel(); });   // abre já conferindo
    };

    function setAuto(ligado) { gravarLS(CHAVE_AUTO, ligado ? '1' : '0'); }

    // ── Gatilhos ────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        avisarPainel();
        el('openConfigAtualizacao2')?.addEventListener('click', () => window._abrirAtualizacaoApp());
        if (!ativo()) return;
        // Recarregou depois de aceitar uma atualização: confirma que deu certo.
        const tentada = lerSS(CHAVE_TENTATIVA);
        if (tentada && tentada === instalada()) {
            apagarSS(CHAVE_TENTATIVA);
            setTimeout(() => { if (typeof window._showSuccessOverlay === 'function') window._showSuccessOverlay('✅ App atualizado'); }, 1200);
        }
        setTimeout(() => verificar(), 8000);
        setInterval(() => { if (document.visibilityState === 'visible') verificar(); }, INTERVALO_MS);
        window.addEventListener('online', () => verificar());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (servidor) anunciar(false);   // achou enquanto estava em segundo plano: avisa ao voltar
            else verificar();
        });
    });

    // Chamado pelo index.html quando um Service Worker novo assume o controle de um app que já estava
    // aberto. Antes ele recarregava a página na hora, sem avisar e sem respeitar "Ignorar"; agora
    // confere a versão e segue o mesmo caminho do aviso (contagem, "Ignorar", não recarrega digitando).
    function swNovo() { return verificar({ forcar: true }); }

    window._vsAtualizacao = { verificar, aplicar, estado, setAuto, swNovo };
})();
