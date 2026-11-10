// ================================================================
// diagnostico-sistema.js — VortexSmart · Diagnóstico do sistema
// Mostra, num relatório que dá pra COPIAR e mandar pro suporte, o que o app
// realmente está vendo neste computador: versão, arquivos carregados, sessão,
// o que está na memória × o que o banco tem de verdade (lido na hora),
// leituras negadas, impressoras, os erros capturados desde que o app abriu e,
// só no APK, o registro do ciclo de vida da tela (pausa/volta, JS, quadro desenhado, toque),
// o registro dos últimos toques que chegaram na página (seção 8) e os que o aparelho entregou ao app (seção 9).
// Só LÊ — não grava nada.
// Abrir: Configurações → Diagnóstico do sistema, ou Ctrl+Alt+D.
// ================================================================
(function () {
    'use strict';

    const el = id => document.getElementById(id);
    const tempoLeitura = () => window._VS_DIAG_TEMPO_MS || 8000; // ajustável só pra teste

    // Conferência das telas: cada botão do menu só funciona se o arquivo que define
    // a função existir (se o arquivo faltar, o clique não faz NADA e não dá erro).
    const ABRIDORES = ['openVendaSection', 'openEstoqueSection', 'openFinanceiroSection', 'openDocumentosSection', 'openReparosSection', 'openReposicaoSection', 'openConfiguracoesSection', 'openCalculatorSection'];
    const BIBLIOTECAS = [['Fuse (busca)', () => typeof window.Fuse, false], ['html2canvas', () => typeof window.html2canvas, true], ['jsPDF', () => typeof window.jspdf, true], ['JsBarcode', () => typeof window.JsBarcode, true]];
    const PASTAS_DA_LOJA = ['clientes', 'products', 'rates', 'maquininhasConfig', 'formasPagamentoConfig', 'vendas'];
    const CHAVES_IMPRESSORA = { recibo: 'vsmart_impressora_termica_escolhida', etiqueta: 'vsmart_impressora_etiqueta_escolhida' };

    // Registro de TODOS os toques que chegam na página (seção 8): uma linha por toque, com o alvo, quanto o dedo andou, se o botão foi
    // trocado na tela no meio do toque e, principalmente, se o toque virou clique. "clique NÃO" = a página recebeu o dedo e nada aconteceu;
    // toque que nem aparece aqui mas aparece na seção 9 (APK) = o aparelho entregou ao app e o WebView não passou pra página.
    // Fica salvo no aparelho (120 linhas) pra sobreviver a recarregamentos da página, que antes apagavam a evidência.
    const CHAVE_TOQUES = 'vs_diag_toques';
    const toques = [];
    try { JSON.parse(localStorage.getItem(CHAVE_TOQUES) || '[]').forEach(l => toques.push(l)); } catch (_) { /* sem armazenamento: só memória */ }
    window._vsAnotarToque = t => {
        toques.push(new Date().toTimeString().slice(0, 8) + '.' + String(Date.now() % 1000).padStart(3, '0') + '  ' + t);
        if (toques.length > 120) toques.shift();
        try { localStorage.setItem(CHAVE_TOQUES, JSON.stringify(toques)); } catch (_) { /* idem */ }
    };
    window._vsAnotarToque('── página carregada, versão ' + (window._VS_VERSAO || '?') + ' ──');
    (function () {
        const ALVO = '.rep-btn-pri, .rep-btn-sq, .rep-pular, .rep-duo button, .rep-tb, #repFolha button';
        const nome = el => {
            if (!el || !el.tagName) return '?';
            const b = (el.closest && el.closest(ALVO)) || el;
            const id = (b.dataset && b.dataset.action) || b.id || (typeof b.className === 'string' ? b.className.split(' ')[0] : '');
            const texto = b.matches && b.matches('button, a, [role=button]') ? ' "' + (b.textContent || '').trim().slice(0, 18) + '"' : '';
            return b.tagName.toLowerCase() + (id ? '.' + id : '') + texto;
        };
        let t = null;
        const fechar = (x, motivo) => {
            if (x.fim) return;
            x.fim = true;
            const ms = Math.round((x.tUp || performance.now()) - x.t0);
            let l = 'toque ' + Math.round(x.x) + ',' + Math.round(x.y) + ' em ' + x.nome + ' · ' + ms + ' ms · dedo andou ' + Math.round(x.dist) + 'px';
            if (x.btn && !x.btn.isConnected) l += ' · botão SUBSTITUÍDO na tela no meio do toque';
            if (x.soltouEm && x.soltouEm !== x.nome) l += ' · soltou em ' + x.soltouEm;
            l += motivo ? ' · ' + motivo : x.cancelado ? ' · CANCELADO pelo navegador (rolagem?)' : x.clicou ? ' · clique SIM' : ' · clique NÃO';
            if (x.oculta) l += ' · página OCULTA';
            window._vsAnotarToque(l);
            if (x.clicou && x.btn) setTimeout(() => window._vsAnotarToque('   400 ms depois: folha ' + (document.querySelector('#repFolha.active') ? 'ABERTA' : 'fechada') + (document.documentElement.classList.contains('vs-scroll-locked') ? ' · rolagem TRAVADA' : '')), 400);
        };
        document.addEventListener('pointerdown', e => {
            if (t) fechar(t, 'sem fim antes do toque seguinte');
            t = { x: e.clientX, y: e.clientY, t0: performance.now(), dist: 0, nome: nome(e.target), btn: e.target.closest && e.target.closest(ALVO), oculta: document.hidden };
            const meu = t;
            setTimeout(() => fechar(meu, 'sem soltar nem cancelar em 3 s'), 3000);
        }, true);
        document.addEventListener('pointerup', e => {
            if (!t) return;
            const meu = t;
            meu.tUp = performance.now();
            meu.dist = Math.hypot(e.clientX - meu.x, e.clientY - meu.y);
            meu.soltouEm = nome(e.target);
            setTimeout(() => fechar(meu), 450);   // dá tempo do "click" chegar
        }, true);
        document.addEventListener('click', e => { if (t) { t.clicou = true; if (!t.soltouEm) t.soltouEm = nome(e.target); } }, true);
        const cancelou = () => { if (t) { t.cancelado = true; t.tUp = performance.now(); fechar(t); } };
        document.addEventListener('pointercancel', cancelou, true);
        document.addEventListener('touchcancel', cancelou, true);
    })();

    const comTempo = (promessa, ms) => Promise.race([promessa, new Promise((_, rej) => setTimeout(() => rej(new Error('sem resposta em ' + (ms / 1000) + 's')), ms))]);
    const lista = (obj, max = 12) => { const ks = Object.keys(obj || {}); return ks.length ? ks.slice(0, max).join(', ') + (ks.length > max ? ` … (+${ks.length - max})` : '') : '(nenhum)'; };

    // Leitura NOVA do banco (não o que o app guardou na memória): conta e lista chaves,
    // ou devolve o erro de verdade (ex: PERMISSION_DENIED).
    async function lerDoBanco(caminho) {
        try {
            let ref = window._lojaRef(caminho);
            // vendas pode ser enorme: basta provar que a leitura funciona
            if (caminho === 'vendas' && typeof window._dbQuery === 'function' && typeof window._dbLimitToLast === 'function') ref = window._dbQuery(ref, window._dbLimitToLast(3));
            const snap = await comTempo(window._dbGet(ref), tempoLeitura());
            const v = snap.val();
            return { ok: true, n: v ? Object.keys(v).length : 0, chaves: v ? Object.keys(v) : [], amostra: caminho === 'vendas' };
        } catch (e) {
            return { ok: false, erro: ((e && e.code) ? e.code + ' — ' : '') + ((e && e.message) || e) };
        }
    }

    // Lê uma chave do armazenamento local sem derrubar o relatório se o navegador bloquear.
    function lerLocal(chave) {
        try { return localStorage.getItem(chave) || ''; } catch (e) { return '(armazenamento indisponível)'; }
    }

    async function coletar() {
        const L = [];
        const alertas = [];
        // Cada seção é independente: se uma falhar (ambiente estranho é justamente quando se
        // usa o diagnóstico), as outras saem normalmente e a falha vira um aviso.
        async function secao(titulo, corpo) {
            L.push(''); L.push('── ' + titulo + ' ' + '─'.repeat(Math.max(2, 58 - titulo.length)));
            try { await corpo(); }
            catch (e) { const m = (e && e.message) || String(e); L.push('(esta seção falhou: ' + m + ')'); alertas.push('A seção "' + titulo + '" do diagnóstico falhou: ' + m); }
        }

        await secao('1) Versão e ambiente', async () => {
            L.push('Versão do app: ' + (window._VS_VERSAO || '(não informada)'));
            L.push('Aberto como: ' + location.protocol + '//' + (location.pathname.split('/').slice(-3).join('/')));
            L.push('Formato da tela: ' + (document.documentElement.getAttribute('data-shell') === 'mobile' ? 'celular' : 'computador'));
            L.push('Programa instalado (impressão): ' + (typeof window.vsmartPrint === 'object' && window.vsmartPrint ? 'SIM' : 'não (navegador/celular)'));
            L.push('Internet: ' + (navigator.onLine ? 'conectado' : 'SEM CONEXÃO'));
            if (window._storageBucket) L.push('Bucket do Storage que o app usa: gs://' + window._storageBucket);
            L.push('Sistema: ' + navigator.userAgent.replace(/\s+/g, ' ').slice(0, 150));
            L.push('Data/hora do computador: ' + new Date().toLocaleString('pt-BR'));
        });

        await secao('2) Arquivos e telas', async () => {
            const faltam = ABRIDORES.filter(f => typeof window[f] !== 'function');
            L.push('Telas do menu: ' + (faltam.length ? 'FALTAM → ' + faltam.join(', ') : 'todas carregadas (' + ABRIDORES.length + ')'));
            if (faltam.length) alertas.push('Faltam arquivos das telas: ' + faltam.join(', ') + ' (o clique no menu não faz nada).');
            const naoCarregaram = window.__vsFalhasDeCarga || [];
            L.push('Arquivos que NÃO carregaram: ' + (naoCarregaram.length ? naoCarregaram.join(', ') : 'nenhum'));
            if (naoCarregaram.length) alertas.push('Arquivos que não carregaram: ' + naoCarregaram.join(', '));
            L.push('Scripts na página: ' + document.scripts.length);
            L.push('Bibliotecas: ' + BIBLIOTECAS.map(([n, f, sobDemanda]) => n + '=' + (f() !== 'undefined' ? 'ok' : (sobDemanda ? 'sob demanda' : 'NÃO'))).join(' | '));
        });

        await secao('3) Sessão', async () => {
            const perms = window._permissoesUsuario ? Object.keys(window._permissoesUsuario).filter(k => window._permissoesUsuario[k]) : [];
            L.push('Usuário (uid): ' + (window._firebaseAuthUid || '(sem sessão)'));
            L.push('Loja (lojaId): ' + (window._lojaId || '(nenhuma)') + (window._nomeLojaCadastrada ? '  — cadastrada como "' + window._nomeLojaCadastrada + '"' : ''));
            L.push('Papel: ' + (window._papelUsuario || '(nenhum)') + (window._papelUsuario === 'funcionario' ? ' — permissões: ' + (perms.length ? perms.join(', ') : 'nenhuma') : ''));
            if (!window._lojaId) alertas.push('Sem loja logada: nada do banco pode ser lido.');
            // Permissões do TOKEN: é o que as regras do Storage (envio de logo/fotos) enxergam.
            if (typeof window._tokenClaims === 'function') {
                try {
                    const c = await comTempo(window._tokenClaims(), tempoLeitura());
                    if (!c) L.push('Token de acesso: (sem sessão)');
                    else {
                        L.push('Token de acesso (Storage): lojaId = ' + (c.lojaId || '(AUSENTE)') + (c.bloqueada ? ' | bloqueada = SIM' : ''));
                        if (!c.lojaId) alertas.push('O seu token de login NÃO tem a permissão da loja (lojaId): o envio de imagens (logo, assinatura, fotos) é NEGADO pelo Storage. Use o botão "Testar envio de imagem" — ele tenta renovar a permissão sozinho.');
                        else if (window._lojaId && c.lojaId !== window._lojaId) alertas.push('O lojaId do token (' + c.lojaId + ') é diferente da loja logada (' + window._lojaId + ').');
                        if (c.bloqueada) alertas.push('O token marca a loja como BLOQUEADA.');
                    }
                } catch (e) { L.push('Token de acesso: não consegui ler (' + ((e && e.message) || e) + ')'); }
            }
        });

        await secao('4) O que o app tem na memória × o que o banco tem agora', async () => {
            const memoria = {
                products: Array.isArray(window.products) ? window.products.length : null,
                rates: window._rates ? Object.keys(window._rates).length : null,
                maquininhasConfig: window._maquininhasConfig ? Object.keys(window._maquininhasConfig).length : null
            };
            L.push('Taxas carregadas (flag): ' + (window._areRatesLoaded ? 'sim' : 'NÃO'));
            L.push('Máquinas que o app mostra: ' + (typeof window._getMaquininhasVisiveis === 'function' ? window._getMaquininhasVisiveis().map(m => m.l).join(', ') || '(nenhuma)' : '(função ausente)'));
            L.push('Índice de busca de produtos (_fuse): ' + (window._fuse ? 'pronto' : 'não criado'));
            L.push('');
            const banco = {};
            if (window._lojaId && typeof window._dbGet === 'function') {
                for (const pasta of PASTAS_DA_LOJA) banco[pasta] = await lerDoBanco(pasta);
            }
            for (const pasta of PASTAS_DA_LOJA) {
                const b = banco[pasta];
                if (!b) { L.push(pasta.padEnd(22) + '(não lido)'); continue; }
                if (!b.ok) { L.push(pasta.padEnd(22) + 'ERRO ao ler o banco → ' + b.erro); alertas.push('Leitura de "' + pasta + '" FALHOU: ' + b.erro); continue; }
                const mem = memoria[pasta];
                let comparacao = '';
                if (mem !== undefined && mem !== null && !b.amostra) {
                    comparacao = mem === b.n ? '   (memória: ' + mem + ' ✓ igual)' : '   (memória: ' + mem + ' ≠ banco: ' + b.n + ' ⚠)';
                    if (mem !== b.n) alertas.push('"' + pasta + '": o app tem ' + mem + ' na memória mas o banco tem ' + b.n + '.');
                }
                L.push(pasta.padEnd(22) + (b.amostra ? 'leitura ok (' + b.n + ' amostra)' : b.n + ' itens') + comparacao + (!b.amostra && b.n ? '  → ' + lista(Object.fromEntries(b.chaves.map(k => [k, 1])), 6) : ''));
            }
            // O que está SALVO para os documentos desta loja: é exatamente o que qualquer outra guia,
            // aparelho ou o site vai mostrar (se aqui está vazio, o salvar não chegou ao banco).
            if (window._lojaId && typeof window._dbGet === 'function') {
                L.push('');
                try {
                    const d = (await comTempo(window._dbGet(window._lojaRef('configuracoes/documentos')), tempoLeitura())).val();
                    const host = u => { try { return new URL(u).host; } catch (e) { return 'link inválido'; } };
                    if (!d) { L.push('Documentos salvos no banco: (NADA — nenhum dado de Configurações → Documentos foi salvo nesta loja)'); }
                    else {
                        L.push('Documentos salvos no banco: nome = "' + (d.storeName || '(vazio)') + '"');
                        L.push('   logo: ' + (d.storeLogoUrl ? 'SIM (' + host(d.storeLogoUrl) + ')' : 'NÃO') + ' | assinatura: ' + (d.storeAssinaturaUrl ? 'SIM (' + host(d.storeAssinaturaUrl) + ')' : 'NÃO'));
                        L.push('   e-mail: ' + (d.storeEmail ? 'sim' : 'não') + ' | CNPJ: ' + (d.storeCNPJ ? 'sim' : 'não') + ' | endereço: ' + (d.storeEndereco ? 'sim' : 'não') + ' | telefone: ' + (d.storeTelefone ? 'sim' : 'não'));
                    }
                } catch (e) { L.push('Documentos salvos no banco: ERRO ao ler → ' + ((e && e.code) ? e.code + ' — ' : '') + ((e && e.message) || e)); alertas.push('Não consegui ler os Documentos salvos da loja: ' + ((e && e.code) || (e && e.message) || e)); }
            }
            if (banco.rates && banco.rates.ok) {
                const semConfig = banco.rates.chaves.filter(id => !(banco.maquininhasConfig && banco.maquininhasConfig.chaves.includes(id)));
                if (semConfig.length) L.push('Máquinas com taxa mas SEM cadastro em maquininhasConfig: ' + semConfig.join(', '));
            }
        });

        await secao('5) Impressoras', async () => {
            L.push('Recibo escolhida: ' + (lerLocal(CHAVES_IMPRESSORA.recibo) || '(nenhuma)'));
            L.push('Etiqueta escolhida: ' + (lerLocal(CHAVES_IMPRESSORA.etiqueta) || '(nenhuma)'));
            if (typeof window.vsmartPrint === 'object' && window.vsmartPrint && typeof window.vsmartPrint.listarImpressoras === 'function') {
                try {
                    const nomes = await comTempo(window.vsmartPrint.listarImpressoras(), tempoLeitura());
                    L.push('Impressoras do Windows: ' + (nomes.length ? nomes.join(' | ') : '(nenhuma)'));
                    [['Recibo', CHAVES_IMPRESSORA.recibo], ['Etiqueta', CHAVES_IMPRESSORA.etiqueta]].forEach(([rotulo, chave]) => {
                        const escolhida = lerLocal(chave);
                        if (escolhida && !escolhida.startsWith('(') && !nomes.includes(escolhida)) alertas.push('A impressora de ' + rotulo.toLowerCase() + ' escolhida ("' + escolhida + '") NÃO existe mais no Windows.');
                    });
                } catch (e) { L.push('Impressoras do Windows: ERRO → ' + String(e.message || e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')); }
            } else L.push('Impressoras do Windows: (só no programa instalado)');
        });

        await secao('6) Erros capturados desde que o app abriu', async () => {
            const erros = (window.__vsErros || []).slice(-30);
            if (erros.length) { erros.forEach(e => L.push('• ' + e)); alertas.push(erros.length + ' erro(s) capturado(s) — veja a seção 6.'); }
            else L.push('Nenhum erro capturado.');
        });

        await secao('7) Tela do app Android (tela preta ao voltar do segundo plano)', async () => {
            if (!window.VortexAndroid || typeof window.VortexAndroid.lerDiagnosticoTela !== 'function') { L.push('(só existe no app Android)'); return; }
            L.push((window.VortexAndroid.lerDiagnosticoTela() || '').trim() || '(nada registrado ainda)');
        });

        await secao('8) Toques que chegaram na página (cada linha = um toque; "clique NÃO" = não virou clique)', async () => {
            L.push(toques.length ? toques.join('\n') : '(nenhum toque registrado ainda — use os botões de Concertos e gere o relatório de novo)');
        });

        await secao('9) Toques que o aparelho entregou ao app (Android) — compare com a seção 8', async () => {
            if (!window.VortexAndroid || typeof window.VortexAndroid.lerToquesNativos !== 'function') { L.push('(só existe no app Android, versão nova)'); return; }
            L.push((window.VortexAndroid.lerToquesNativos() || '').trim() || '(nenhum toque ainda)');
        });

        const topo = ['DIAGNÓSTICO DO SISTEMA — VortexSmart', 'Gerado em ' + new Date().toLocaleString('pt-BR'), ''];
        topo.push(alertas.length ? 'PROBLEMAS ENCONTRADOS (' + alertas.length + '):' : 'NENHUM PROBLEMA ENCONTRADO pelo diagnóstico.');
        alertas.forEach(a => topo.push('  ⚠ ' + a));
        return topo.concat(L).join('\n');
    }

    // Tenta enviar um arquivinho ao Storage da loja (e apaga em seguida) pra descobrir, com evidência,
    // por que o envio de imagens é negado: falta a permissão no token OU as regras publicadas negam.
    async function testarEnvioStorage() {
        const L = ['', '── TESTE DE ENVIO AO STORAGE ' + '─'.repeat(30)];
        if (!window._lojaId || typeof window._storageUploadBytes !== 'function' || typeof window._lojaStorageRef !== 'function') {
            L.push('Não dá pra testar: sem loja logada ou o Storage não está disponível neste app.');
            return L.join('\n');
        }
        const lerToken = async () => { try { return typeof window._tokenClaims === 'function' ? await comTempo(window._tokenClaims(), tempoLeitura()) : null; } catch (e) { return null; } };
        const lojaIdDoToken = c => (c && c.lojaId) || '(AUSENTE)';
        // Resposta crua do servidor (o Firebase guarda no erro): é ela que distingue "regra negou" de
        // "bucket errado", "App Check" etc.
        const respostaDoServidor = e => {
            const r = e && e.customData && e.customData.serverResponse;
            return r ? String(r).replace(/\s+/g, ' ').slice(0, 300) : '';
        };
        let ultimoCaminho = '';
        const tentar = async () => {
            const arquivo = window._lojaStorageRef('diagnostico/teste-' + Date.now() + '.txt');
            ultimoCaminho = arquivo.fullPath || '';
            await comTempo(window._storageUploadBytes(arquivo, new Blob(['teste do diagnostico'], { type: 'text/plain' })), tempoLeitura());
            try { if (typeof window._storageDeleteObject === 'function') await window._storageDeleteObject(arquivo); } catch (e) { /* o arquivinho de teste fica; é inofensivo */ }
        };
        let claims = await lerToken();
        if (window._storageBucket) L.push('Bucket usado: gs://' + window._storageBucket);
        L.push('Token antes: lojaId = ' + lojaIdDoToken(claims));
        try {
            await tentar();
            L.push('RESULTADO: OK — o Storage aceitou o envio (o arquivo de teste foi removido). Logo, assinatura e fotos devem funcionar.');
            return L.join('\n');
        } catch (e) {
            const codigo = (e && e.code) || '';
            L.push('1ª tentativa: NEGADA/FALHOU → ' + (codigo || (e && e.message) || e));
            if (ultimoCaminho) L.push('Caminho tentado: ' + ultimoCaminho);
            if (respostaDoServidor(e)) L.push('Resposta do servidor: ' + respostaDoServidor(e));
            if (!/unauthorized|unauthenticated/.test(codigo)) {
                L.push('RESULTADO: a falha NÃO é de permissão. ' + (/tempo|sem resposta|retry-limit/.test(codigo + ' ' + ((e && e.message) || '')) ? 'O Storage não respondeu: confira a internet e se o Storage está ativo no projeto Firebase (aba Storage).' : 'Mande este relatório para o suporte.'));
                return L.join('\n');
            }
            if (typeof window._renovarPermissoes === 'function') {
                try { await window._renovarPermissoes(); L.push('Pedi ao servidor para renovar a permissão do seu usuário.'); }
                catch (e2) { L.push('Não consegui renovar a permissão (a função "renovarMinhasPermissoes" está publicada no Firebase?): ' + String((e2 && (e2.code || e2.message)) || e2).slice(0, 120)); }
            }
            claims = await lerToken();
            L.push('Token depois: lojaId = ' + lojaIdDoToken(claims));
            try {
                await tentar();
                L.push('RESULTADO: AGORA FUNCIONOU — o problema era a permissão do seu usuário (faltava o lojaId no token). Já está corrigido para você.');
            } catch (e3) {
                L.push('2ª tentativa: NEGADA → ' + ((e3 && e3.code) || (e3 && e3.message) || e3));
                if (respostaDoServidor(e3)) L.push('Resposta do servidor: ' + respostaDoServidor(e3));
                if (claims && claims.lojaId) {
                    L.push('RESULTADO: o token TEM o lojaId certo e o Storage continua negando. Confira, nesta ordem:');
                    L.push('  1) Firebase Console → Storage: o seletor de bucket (no alto da tela) está em gs://' + (window._storageBucket || '(o bucket do app)') + '? As regras valem SÓ para o bucket em que foram publicadas.');
                    L.push('  2) Na aba Regras: o texto é o de storage.rules e o botão Publicar foi clicado (aparece a data da última publicação)?');
                    L.push('  3) Firebase Console → App Check → Storage: se estiver "Aplicado/Enforced", desative (o app não envia App Check).');
                    L.push('  4) Espere 1 minuto, feche e abra o app, e teste de novo.');
                } else {
                    L.push('RESULTADO: o seu token continua SEM lojaId. Publique a função (firebase deploy --only functions:renovarMinhasPermissoes) ou, no painel admin, suspenda e reative a loja; depois saia e entre de novo.');
                }
            }
            return L.join('\n');
        }
    }

    // ── Janela ──────────────────────────────────────────────────────
    function fechar() { const f = el('vsDiagFundo'); if (f) f.remove(); if (window._vsDestravarScroll) window._vsDestravarScroll(); }

    async function copiar(texto, botao) {
        try { await navigator.clipboard.writeText(texto); botao.textContent = 'Copiado! Cole na conversa'; }
        catch (e) { const ta = el('vsDiagTexto'); ta.focus(); ta.select(); botao.textContent = 'Selecione e copie (Ctrl+C)'; }
    }

    window._abrirDiagnosticoSistema = async function () {
        fechar();
        const fundo = document.createElement('div');
        fundo.id = 'vsDiagFundo';
        fundo.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;';
        fundo.innerHTML = `
            <div style="background:var(--modal-card-bg);color:var(--text-strong);border-radius:16px;width:min(780px,100%);max-height:92dvh;display:flex;flex-direction:column;padding:16px;gap:10px;box-shadow:0 20px 60px rgba(0,0,0,.5);">
                <div style="display:flex;align-items:center;gap:8px;"><strong style="flex:1;">🩺 Diagnóstico do sistema</strong><button type="button" id="vsDiagFechar" class="btn btn-sm" style="min-width:40px;">✕</button></div>
                <textarea id="vsDiagTexto" readonly spellcheck="false" style="flex:1;min-height:50dvh;width:100%;font:12px/1.45 Consolas,monospace;background:#0a0818;color:#d7d3ff;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px;resize:none;white-space:pre;">Lendo o sistema e o banco… (até alguns segundos)</textarea>
                <div style="display:flex;gap:8px;"><button type="button" id="vsDiagCopiar" class="btn btn-ok" style="flex:1;" disabled>Copiar relatório</button><button type="button" id="vsDiagAtualizar" class="btn" style="flex:0 0 auto;">Atualizar</button></div>
                <button type="button" id="vsDiagStorage" class="btn btn-secondary" style="width:100%;">Testar envio de imagem (Storage)</button>
            </div>`;
        document.body.appendChild(fundo);
        el('vsDiagFechar').addEventListener('click', fechar);
        fundo.addEventListener('click', e => { if (e.target === fundo) fechar(); });
        const preencher = async () => {
            const ta = el('vsDiagTexto'), botao = el('vsDiagCopiar');
            if (!ta) return;
            ta.value = 'Lendo o sistema e o banco… (até alguns segundos)'; botao.disabled = true; botao.textContent = 'Copiar relatório';
            let texto;
            try { texto = await coletar(); } catch (e) { texto = 'O diagnóstico em si falhou: ' + (e && e.message ? e.message : e); }
            if (!el('vsDiagTexto')) return; // janela fechada enquanto lia
            ta.value = texto; botao.disabled = false; botao.onclick = () => copiar(texto, botao);
        };
        el('vsDiagAtualizar').addEventListener('click', preencher);
        el('vsDiagStorage').addEventListener('click', async () => {
            const botao = el('vsDiagStorage'), ta = el('vsDiagTexto'), copiarBtn = el('vsDiagCopiar');
            if (!botao || !ta) return;
            botao.disabled = true; botao.textContent = 'Testando…';
            let extra;
            try { extra = await testarEnvioStorage(); } catch (e) { extra = '\nO teste falhou: ' + ((e && e.message) || e); }
            if (!el('vsDiagTexto')) return;
            ta.value = ta.value + '\n' + extra; ta.scrollTop = ta.scrollHeight;
            if (copiarBtn) { const texto = ta.value; copiarBtn.onclick = () => copiar(texto, copiarBtn); }
            botao.disabled = false; botao.textContent = 'Testar envio de imagem (Storage)';
        });
        await preencher();
    };

    // Atalho: Ctrl+Alt+D
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); window._abrirDiagnosticoSistema(); }
    });
})();
