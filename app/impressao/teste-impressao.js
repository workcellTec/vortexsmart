// ================================================================
// impressao/teste-impressao.js — VortexSmart PDV Desktop
// Tela "Teste e diagnóstico de impressão" (Configurações → Sistema, só no programa instalado).
//   • "Imprimir teste": manda pra impressora escolhida o recibo de exemplo / a etiqueta de exemplo
//     (os MESMOS botões de teste do programa: window.vsmartPrint.testeImpressao / testeImpressaoEtiqueta).
//   • Diagnóstico: lê do Windows as impressoras, o compartilhamento, o driver, o estado e o serviço de
//     impressão, e diz em português o que está errado em cada impressora escolhida. Tem "Copiar relatório".
// Este arquivo NÃO monta bytes nem mexe no envio: só chama o que já existe e lê o estado do Windows.
// ================================================================
(function () {
    'use strict';

    const CHAVES = { recibo: 'vsmart_impressora_termica_escolhida', etiqueta: 'vsmart_impressora_etiqueta_escolhida' };
    const ROTULO = { recibo: 'Recibo', etiqueta: 'Etiqueta' };

    // Estados do Windows (PrinterStatus) que impedem de imprimir, com o que fazer.
    const STATUS_RUIM = {
        Paused: 'está PAUSADA (botão direito na impressora → Retomar impressão)',
        Error: 'está com ERRO',
        PaperJam: 'está com papel ATOLADO',
        PaperOut: 'está SEM PAPEL',
        PaperProblem: 'está com problema de papel',
        Offline: 'está OFFLINE (desligada ou cabo USB solto)',
        NotAvailable: 'está INDISPONÍVEL',
        NoToner: 'está sem tinta/fita',
        DoorOpen: 'está com a TAMPA aberta',
        UserIntervention: 'está pedindo intervenção (veja a impressora)',
        PendingDeletion: 'está sendo removida do Windows'
    };

    const limparErroIpc = msg => String(msg || '').replace(/^Error invoking remote method '[^']*': (Error: )?/, '');
    const igual = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

    // Confere UMA impressora escolhida contra o que o Windows informou. Devolve { problemas: [...], linhas: [...] }.
    function avaliar(dados, escolhida) {
        if (!escolhida) return { problemas: ['nenhuma impressora escolhida — escolha em Configurações → Impressora'], linhas: [] };
        const imp = (dados.impressoras || []).find(i => igual(i.nome, escolhida));
        if (!imp) return { problemas: [`"${escolhida}" não existe mais neste Windows — escolha a impressora de novo em Configurações`], linhas: [] };
        const problemas = [];
        if (!imp.compartilhada) {
            problemas.push('NÃO está compartilhada. Botão direito na impressora → Propriedades da impressora → aba Compartilhamento → marcar "Compartilhar esta impressora"');
        } else if (!imp.compartilhamento || !igual(imp.compartilhamento, imp.nome)) {
            problemas.push(`o nome do compartilhamento é "${imp.compartilhamento}", mas o programa envia para "\\\\localhost\\${imp.nome}". Na aba Compartilhamento, deixe o nome IGUAL ao da impressora: ${imp.nome}`);
        }
        if (imp.offline) problemas.push('está marcada como "Usar impressora offline" (botão direito → Ver o que está sendo impresso → menu Impressora → desmarcar)');
        if (STATUS_RUIM[imp.status]) problemas.push(STATUS_RUIM[imp.status]);
        if (dados.spooler && !igual(dados.spooler, 'Running')) problemas.push(`o serviço de impressão do Windows (Spooler) está "${dados.spooler}" — precisa estar Running`);
        return {
            problemas,
            linhas: [`driver: ${imp.driver || '?'} · porta: ${imp.porta || '?'} · estado: ${imp.status || '?'}${imp.compartilhada ? ' · compartilhada como "' + imp.compartilhamento + '"' : ''}`]
        };
    }

    function montarRelatorio(dados, escolhidas, testes) {
        const L = [];
        L.push('DIAGNÓSTICO DE IMPRESSÃO — VortexSmart PDV');
        L.push('Data/hora: ' + new Date().toLocaleString('pt-BR'));
        L.push(`Programa instalado: versão ${dados.programa || '?'} · ${dados.windows || '?'}`);
        L.push(`Serviço de impressão do Windows (Spooler): ${dados.spooler || '?'}`);
        L.push('');
        const lista = dados.impressoras || [];
        L.push(`Impressoras no Windows (${lista.length}):`);
        if (!lista.length) L.push('  (nenhuma)');
        lista.forEach(i => L.push(`  • ${i.nome} — ${i.compartilhada ? 'compartilhada como "' + i.compartilhamento + '"' : 'NÃO compartilhada'} · driver ${i.driver || '?'} · porta ${i.porta || '?'} · estado ${i.status || '?'}${i.offline ? ' · OFFLINE' : ''}`));
        L.push('');
        let tudoCerto = true;
        ['recibo', 'etiqueta'].forEach(k => {
            const nome = escolhidas[k];
            const r = avaliar(dados, nome);
            L.push(`Impressora de ${ROTULO[k].toLowerCase()} escolhida: ${nome ? '"' + nome + '"' : '(nenhuma)'}`);
            r.linhas.forEach(l => L.push('  ' + l));
            if (r.problemas.length) { tudoCerto = false; r.problemas.forEach(p => L.push('  ✗ ' + p)); }
            else L.push('  ✓ Windows: nome, compartilhamento e estado conferem com o que o programa usa');
        });
        if (escolhidas.recibo && escolhidas.etiqueta && igual(escolhidas.recibo, escolhidas.etiqueta)) {
            L.push('');
            L.push('Atenção: recibo e etiqueta estão com a MESMA impressora escolhida. Um deles vai sair errado (são protocolos diferentes).');
            tudoCerto = false;
        }
        if (testes.length) {
            L.push('');
            L.push('Testes feitos nesta janela:');
            testes.forEach(t => L.push(`  ${t.hora} · ${t.tipo} → ${t.ok ? 'enviado ao Windows' : 'FALHOU: ' + t.erro}`));
            if (testes.some(t => !t.ok)) tudoCerto = false;
        }
        L.push('');
        L.push(tudoCerto ? 'RESULTADO: configuração do Windows OK. "Enviado ao Windows" só prova que a fila aceitou: confirme no papel.' : 'RESULTADO: há problema(s) acima (linhas com ✗ ou teste que falhou). Corrija e rode de novo.');
        return L.join('\n');
    }

    // ── Janela ──────────────────────────────────────────────────────
    const el = id => document.getElementById(id);
    const esc = t => typeof window.escapeHtml === 'function' ? window.escapeHtml(t) : String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const lerLocal = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
    const noPrograma = () => typeof window.vsmartPrint === 'object' && window.vsmartPrint !== null;

    function fechar() {
        const f = el('vsTesteImpFundo');
        if (f) { f.remove(); if (window._vsDestravarScroll) window._vsDestravarScroll(); }
    }

    async function copiar(texto, botao) {
        try { await navigator.clipboard.writeText(texto); botao.textContent = 'Copiado! Cole na conversa'; }
        catch (e) { const ta = el('vsTesteImpTexto'); if (ta) { ta.focus(); ta.select(); } botao.textContent = 'Selecione e copie (Ctrl+C)'; }
    }

    window._abrirTesteImpressao = async function () {
        if (!noPrograma()) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'O teste de impressão só existe no programa instalado (.exe) do VortexSmart.' });
            return;
        }
        fechar();
        const testes = [];
        const fundo = document.createElement('div');
        fundo.id = 'vsTesteImpFundo';
        fundo.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;';
        const bloco = k => `
            <div style="border:1px solid rgba(128,128,128,.3);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px;">
                <div style="font-weight:600;">${k === 'recibo' ? '🖨️ Impressora de Recibo' : '🏷️ Impressora de Etiquetas'}</div>
                <div id="vsTesteImpNome_${k}" style="font-size:.85rem;opacity:.8;"></div>
                <button type="button" class="btn btn-ok" id="vsTesteImpBtn_${k}">Imprimir teste de ${k === 'recibo' ? 'recibo' : 'etiqueta'}</button>
                <div id="vsTesteImpRes_${k}" style="font-size:.85rem;min-height:1.2em;"></div>
            </div>`;
        fundo.innerHTML = `
            <div style="background:var(--modal-card-bg);color:var(--text-strong);border-radius:16px;width:min(780px,100%);max-height:92dvh;overflow:auto;display:flex;flex-direction:column;padding:16px;gap:10px;box-shadow:0 20px 60px rgba(0,0,0,.5);">
                <div style="display:flex;align-items:center;gap:8px;"><strong style="flex:1;">🖨️ Teste e diagnóstico de impressão</strong><button type="button" id="vsTesteImpFechar" class="btn btn-sm" style="min-width:40px;">✕</button></div>
                <div style="font-size:.8rem;opacity:.75;">O teste imprime um recibo/etiqueta de EXEMPLO ("LOJA DE TESTE") — não registra venda nem mexe no estoque.</div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">${bloco('recibo')}${bloco('etiqueta')}</div>
                <textarea id="vsTesteImpTexto" readonly spellcheck="false" style="min-height:34dvh;width:100%;font:12px/1.45 Consolas,monospace;background:#0a0818;color:#d7d3ff;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;resize:none;white-space:pre-wrap;">Lendo as impressoras do Windows…</textarea>
                <div style="display:flex;gap:8px;"><button type="button" id="vsTesteImpCopiar" class="btn btn-ok" style="flex:1;" disabled>Copiar relatório</button><button type="button" id="vsTesteImpAtualizar" class="btn" style="flex:0 0 auto;">Verificar de novo</button></div>
            </div>`;
        document.body.appendChild(fundo);
        if (window._vsTravarScroll) window._vsTravarScroll();
        el('vsTesteImpFechar').addEventListener('click', fechar);
        fundo.addEventListener('click', e => { if (e.target === fundo) fechar(); });

        const escolhidas = () => ({ recibo: lerLocal(CHAVES.recibo), etiqueta: lerLocal(CHAVES.etiqueta) });
        const pintarNomes = () => {
            const e = escolhidas();
            ['recibo', 'etiqueta'].forEach(k => {
                const alvo = el('vsTesteImpNome_' + k);
                if (alvo) alvo.textContent = e[k] ? 'Escolhida: ' + e[k] : 'Nenhuma escolhida — escolha em Configurações → Impressora';
            });
        };

        const verificar = async () => {
            const ta = el('vsTesteImpTexto'), botao = el('vsTesteImpCopiar');
            if (!ta) return;
            pintarNomes();
            ta.value = 'Lendo as impressoras do Windows…'; botao.disabled = true; botao.textContent = 'Copiar relatório';
            let texto;
            try {
                if (typeof window.vsmartPrint.diagnosticoImpressoras !== 'function') {
                    texto = 'Esta versão do programa é antiga e não tem o diagnóstico. Instale a versão nova.';
                } else {
                    texto = montarRelatorio(await window.vsmartPrint.diagnosticoImpressoras(), escolhidas(), testes);
                }
            } catch (e) { texto = 'Não consegui ler as impressoras do Windows:\n' + limparErroIpc(e && e.message ? e.message : e); }
            if (!el('vsTesteImpTexto')) return; // janela fechada enquanto lia
            ta.value = texto; botao.disabled = false; botao.onclick = () => copiar(texto, botao);
        };

        const testar = async k => {
            const botao = el('vsTesteImpBtn_' + k), res = el('vsTesteImpRes_' + k);
            if (!botao || botao.disabled) return;
            const nome = escolhidas()[k];
            const hora = new Date().toLocaleTimeString('pt-BR');
            if (!nome) { res.innerHTML = '<span style="color:#f87171;">Escolha a impressora primeiro (Configurações → Impressora).</span>'; return; }
            botao.disabled = true; res.textContent = 'Enviando…';
            try {
                if (k === 'recibo') await window.vsmartPrint.testeImpressao(nome);
                else await window.vsmartPrint.testeImpressaoEtiqueta(nome, {});
                testes.push({ hora, tipo: k === 'recibo' ? 'recibo' : 'etiqueta', ok: true });
                if (el('vsTesteImpRes_' + k)) res.innerHTML = `<span style="color:#34d399;">✓ Enviado ao Windows às ${esc(hora)}.</span> Saiu no papel? Se não, veja o relatório abaixo.`;
            } catch (e) {
                const erro = limparErroIpc(e && (e.erro || e.message));
                testes.push({ hora, tipo: k === 'recibo' ? 'recibo' : 'etiqueta', ok: false, erro });
                if (el('vsTesteImpRes_' + k)) res.innerHTML = `<span style="color:#f87171;">✗ Não imprimiu:</span> ${esc(erro)}`;
            }
            if (el('vsTesteImpBtn_' + k)) botao.disabled = false;
            verificar();
        };

        el('vsTesteImpBtn_recibo').addEventListener('click', () => testar('recibo'));
        el('vsTesteImpBtn_etiqueta').addEventListener('click', () => testar('etiqueta'));
        el('vsTesteImpAtualizar').addEventListener('click', verificar);
        await verificar();
    };

    window._vsTesteImpressaoNucleo = { avaliar, montarRelatorio };
})();
