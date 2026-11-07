// ================================================================
// credscan/motor.js — VortexSmart · CredScan (motor local)
//
// Tudo aqui roda NO CELULAR, sem custo de IA nenhum — é a mesma
// filosofia do CreditoScan original: só chama a API paga depois de
// passar por esses filtros gratuitos. Portado do arquivo original
// (creditoscan.js v16), com os validadores que na prática nunca eram
// chamados removidos (zero resíduo — não fazia sentido portar código
// morto).
//
// Expõe via window.*:
//   _csComprimirBase64, _csExtrairTextoPdfDigital, _csPdfParaImagens,
//   _csOcrImagens, _csDetectarApostas, _csValidarQualidadeDocumentos
//
// Depende de (via window.*):
//   _comprimirImagem (core.js)
// ================================================================
(function () {
    'use strict';

    const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const TESSERACT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js';
    const MAX_PDF_PGS = 50;

    function carregarScript(src) {
        return new Promise((ok, fail) => {
            const s = document.createElement('script');
            s.src = src; s.onload = ok; s.onerror = fail;
            document.head.appendChild(s);
        });
    }

    async function garantirPdfJs() {
        if (window.pdfjsLib) return;
        await carregarScript(PDFJS_URL);
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    }

    // Comprime uma foto e devolve como base64 puro (sem o prefixo
    // data:image/...) — formato que a API de IA espera. Reaproveita o
    // _comprimirImagem que já existe (mesma compressão usada em
    // Concertos/Reposição), só converte o Blob resultante pra base64.
    function comprimirParaBase64(file, maxDimensao, qualidade) {
        return window._comprimirImagem(file, maxDimensao || 1280, qualidade || 0.85).then(blob => new Promise((ok, fail) => {
            const r = new FileReader();
            r.onload = () => ok(r.result.split(',')[1]);
            r.onerror = fail;
            r.readAsDataURL(blob);
        }));
    }

    // Extrai texto de PDF DIGITAL (extrato exportado direto do app do
    // banco — zero OCR, zero custo). Reconstrói quebra de linha pela
    // posição Y de cada item, já que o PDF não guarda linhas de
    // verdade, só posições de caracteres soltas.
    async function extrairTextoPdfDigital(file) {
        try {
            await garantirPdfJs();
            const ab = await file.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;
            const limite = Math.min(pdf.numPages, MAX_PDF_PGS);
            const textos = [];
            let totalChars = 0;
            for (let i = 1; i <= limite; i++) {
                const pg = await pdf.getPage(i);
                const content = await pg.getTextContent();
                let lastY = null, linhas = [], linhaAtual = [];
                content.items.forEach(item => {
                    const y = item.transform ? Math.round(item.transform[5]) : 0;
                    if (lastY !== null && Math.abs(y - lastY) > 3) {
                        if (linhaAtual.length) linhas.push(linhaAtual.join(' '));
                        linhaAtual = [];
                    }
                    linhaAtual.push(item.str);
                    lastY = y;
                });
                if (linhaAtual.length) linhas.push(linhaAtual.join(' '));
                const textoPagina = linhas.join('\n');
                textos.push(textoPagina);
                totalChars += textoPagina.length;
            }
            const ehDigital = (totalChars / limite) > 50;
            return { textos, ehDigital };
        } catch (e) {
            console.error('Erro ao extrair texto de PDF digital:', e);
            return { textos: [], ehDigital: false };
        }
    }

    // Renderiza cada página do PDF como imagem (JPEG) — usado quando o
    // PDF é escaneado (não digital) e precisa ir pra IA de Vision, ou
    // pro OCR local.
    async function pdfParaImagens(file) {
        try {
            await garantirPdfJs();
            const ab = await file.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument({ data: ab }).promise;
            const limite = Math.min(pdf.numPages, MAX_PDF_PGS);
            const OCR_MAX = 1280;
            const saida = [];
            for (let i = 1; i <= limite; i++) {
                const pg = await pdf.getPage(i);
                const vp = pg.getViewport({ scale: 1.5 });
                const cv = document.createElement('canvas');
                cv.width = vp.width; cv.height = vp.height;
                await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
                let fc = cv;
                if (vp.width > OCR_MAX || vp.height > OCR_MAX) {
                    const sc = Math.min(OCR_MAX / vp.width, OCR_MAX / vp.height);
                    fc = document.createElement('canvas');
                    fc.width = Math.round(vp.width * sc); fc.height = Math.round(vp.height * sc);
                    fc.getContext('2d').drawImage(cv, 0, 0, fc.width, fc.height);
                }
                const base64 = await new Promise(res => {
                    fc.toBlob(bl => {
                        const r = new FileReader();
                        r.onload = () => res(r.result.split(',')[1]);
                        r.readAsDataURL(bl);
                    }, 'image/jpeg', 0.85);
                });
                saida.push({ base64, blob: await (await fetch(fc.toDataURL('image/jpeg', 0.85))).blob() });
            }
            return saida;
        } catch (e) {
            console.error('Erro ao converter PDF em imagens:', e);
            return [];
        }
    }

    // OCR local em lotes paralelos de 6 workers — só roda quando o
    // documento é foto/escaneado (PDF digital nunca precisa disso).
    async function ocrImagens(basesEmBase64, aoProgredir) {
        if (!window.Tesseract) await carregarScript(TESSERACT_URL);
        const LOTE = 6;
        const textos = new Array(basesEmBase64.length).fill('');
        const totalLotes = Math.ceil(basesEmBase64.length / LOTE);
        for (let lote = 0; lote < totalLotes; lote++) {
            const inicio = lote * LOTE, fim = Math.min(inicio + LOTE, basesEmBase64.length);
            if (aoProgredir) aoProgredir(inicio, fim, basesEmBase64.length);
            const tarefas = [];
            for (let j = inicio; j < fim; j++) {
                tarefas.push((async idx => {
                    try {
                        const w = await window.Tesseract.createWorker('eng', 1, { logger: () => {} });
                        try {
                            const r = await w.recognize('data:image/jpeg;base64,' + basesEmBase64[idx]);
                            textos[idx] = (r.data && r.data.text) || '';
                        } finally { await w.terminate(); }
                    } catch (e) { /* página ilegível — segue sem texto dela */ }
                })(j));
            }
            await Promise.all(tarefas);
        }
        return textos;
    }

    // ── Pré-filtro local de apostas — MESMA lista de palavras-chave da
    // Cloud Function (CS_CASAS_APOSTAS_KEYWORDS em functions/index.js).
    // Se mudar uma lista, muda a outra também — texto duplicado de
    // propósito (um lado é browser, outro é Cloud Function, não dá
    // pra compartilhar arquivo entre os dois ambientes). ──
    const APOSTAS_KEYWORDS = [
        'phoenix gaming', 'm v d s m technology', 'atm publicidade', 'smart cluster',
        'banks tech', 'apostaraiz', 'royal crest', 'lottopay', 'gm intermediacao',
        'wiinpay', 'ajc gateway', 'nexumpay', 'univebet', 'vaidebet', 'betnacional',
        'pixbet', 'blaze', 'betano', 'esportes da sorte', 'superbet',
        'r torres', 'norbe fintech', 'norbe', 'gold now', 'luxtak',
        'futbol bet', 'betgaming', 'bet gaming', 'betfair', 'sportingbet', 'betway',
        'bet365', 'pinnacle', '1xbet', 'stake', 'f12 bet', 'galera bet', 'kto',
    ];

    function detectarApostas(texto) {
        const textoLower = texto.toLowerCase();
        const porMes = {};
        let totalOcorr = 0, totalValor = 0;
        const destinatarios = {};

        APOSTAS_KEYWORDS.forEach(keyword => {
            let idx = 0;
            while (true) {
                const pos = textoLower.indexOf(keyword, idx);
                if (pos === -1) break;
                idx = pos + keyword.length;
                destinatarios[keyword] = (destinatarios[keyword] || 0) + 1;
                totalOcorr++;
                const antes = texto.substring(Math.max(0, pos - 250), pos + 30);
                const datas = antes.match(/(\d{2})\/(\d{2})\/(\d{2,4})/g) || [];
                if (datas.length) {
                    const m = datas[datas.length - 1].match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
                    let ano = m[3]; if (ano.length === 2) ano = '20' + ano;
                    const chaveMes = m[2] + '/' + ano;
                    if (!porMes[chaveMes]) porMes[chaveMes] = { ocorr: 0, total: 0, dias: {} };
                    porMes[chaveMes].ocorr++;
                    porMes[chaveMes].dias[m[1] + '/' + m[2] + '/' + ano] = true;
                }
            }
        });

        const mesesComAposta = Object.keys(porMes).length;
        const destStr = Object.keys(destinatarios).map(k => `${k} (${destinatarios[k]}x)`).join(', ');

        let gatilho = null, detalhe = '';
        Object.keys(porMes).forEach(m => {
            const dias = Object.keys(porMes[m].dias || {}).length;
            if (!gatilho && dias >= 15) { gatilho = 'APOSTADOR_DIARIO'; detalhe = `${dias} dias com apostas no mês ${m}`; }
        });
        if (!gatilho && mesesComAposta >= 3) { gatilho = 'HABITO_CRONICO'; detalhe = `apostas em ${mesesComAposta} meses distintos (compulsivo)`; }
        if (!gatilho && totalOcorr >= 10) { gatilho = 'VOLUME_TOTAL'; detalhe = `${totalOcorr} transações de apostas no período`; }
        if (!gatilho && totalOcorr >= 5) { gatilho = 'APOSTADOR_FREQUENTE'; detalhe = `${totalOcorr} transações de apostas`; }
        if (detalhe) detalhe += ` | Casas: ${destStr}`;

        return { gatilho, detalhe, totalOcorr, totalValor, mesesComAposta };
    }

    // ── Validador local de qualidade dos documentos — zero custo de
    // IA, roda antes de criar a análise. Portado do original, sem o
    // check V5 (valores redondos) que era mais ruído que sinal. ──
    function detectarExtratoCego(texto) {
        const tl = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const ehContaCega = ['caixa tem', 'conta poupanca caixa', 'poupanca caixa', 'conta poupanca digital', 'agencia digital']
            .some(i => tl.indexOf(i) !== -1);
        let saidasDetalhadas = 0;
        texto.split('\n').forEach(l => {
            const ll = l.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (/pix\s*(enviado|-\s*enviado)/.test(ll)) saidasDetalhadas++;
            if (/compra com cart/i.test(ll)) saidasDetalhadas++;
            if (/boleto/i.test(ll)) saidasDetalhadas++;
        });
        let tipo = '';
        if (tl.indexOf('caixa tem') !== -1) tipo = 'Conta poupança CAIXA Tem';
        else if (tl.indexOf('poupanca') !== -1) tipo = 'Conta poupança';
        const cego = ehContaCega && saidasDetalhadas <= 3;
        return { cego, tipo };
    }

    function validarQualidadeDocumentos(textosLocais) {
        const problemas = [];
        const textoTotal = textosLocais.join('\n');
        if (textoTotal.trim().length < 300) return { ok: true, problemas: [] };

        const linhasComValor = (textoTotal.match(/R\$\s*[\d.,]+/gi) || []).length;
        const temExtratoBancario = /(extrato|movimenta[cç][aã]o|saldo\s+(anterior|atual|disponivel)|historico\s*(de\s*)?lan[cç]amento)/i.test(textoTotal);
        const temPix = /pix\s*(enviado|recebido|credito|debito)/i.test(textoTotal.toLowerCase());
        const temComprovante = /comprovante\s*(de\s*)?(pix|transfer[eê]ncia|pagamento|deposito)/i.test(textoTotal);

        if (temComprovante && !temExtratoBancario && linhasComValor < 8) {
            problemas.push({
                nivel: 'erro', titulo: 'Comprovante de PIX — não é extrato',
                mensagem: 'O arquivo parece ser um comprovante de transação avulsa, não um extrato bancário completo.',
                pedirCliente: 'Peça pro cliente exportar o extrato completo pelo app do banco (últimos 3 meses), não um comprovante avulso.',
            });
        }

        if (!problemas.some(p => p.nivel === 'erro')) {
            const todasDatas = [];
            const reData = /\b(\d{2})\/(\d{2})\/(\d{2,4})\b/g;
            let m;
            while ((m = reData.exec(textoTotal)) !== null) {
                const dia = parseInt(m[1], 10), mes = parseInt(m[2], 10);
                let ano = parseInt(m[3], 10); if (ano < 100) ano += 2000;
                if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31 && ano >= 2020 && ano <= 2030) {
                    const ts = new Date(ano, mes - 1, dia).getTime();
                    if (ts > 0 && ts <= Date.now() + 86400000) todasDatas.push(ts);
                }
            }
            if (todasDatas.length >= 3) {
                const minDate = Math.min(...todasDatas), maxDate = Math.max(...todasDatas);
                const difDias = (maxDate - minDate) / 86400000;
                const diasAtras = (Date.now() - maxDate) / 86400000;
                if (diasAtras > 120) {
                    problemas.push({
                        nivel: 'erro', titulo: 'Extrato desatualizado',
                        mensagem: `O extrato mais recente é de mais de 4 meses atrás — não reflete a situação financeira atual.`,
                        pedirCliente: 'Peça um extrato atualizado, cobrindo os últimos 3 meses.',
                    });
                } else if (difDias < 55 && todasDatas.length >= 5) {
                    problemas.push({
                        nivel: 'aviso', titulo: `Extrato muito curto (~${Math.round(difDias)} dias)`,
                        mensagem: 'Precisamos de pelo menos 2–3 meses de extrato pra uma análise confiável.',
                        pedirCliente: 'Peça pro cliente exportar 3 meses de extrato em PDF.',
                    });
                }
            }
        }

        const cego = detectarExtratoCego(textoTotal);
        if (cego.cego) {
            problemas.push({
                nivel: 'aviso', titulo: 'Extrato com visibilidade limitada',
                mensagem: `O extrato é de ${cego.tipo || 'conta poupança/benefício'} e não mostra pra onde o dinheiro vai — só entradas.`,
                pedirCliente: 'Se o cliente tiver conta em outro banco, peça o extrato dela também.',
            });
        }

        const temHolerite = /holerite|contracheque|folha\s+de\s+pagamento|proventos.*desconto|desconto.*inss|competencia\s*\d/i.test(textoTotal);
        if (temHolerite && !temExtratoBancario && !temPix) {
            problemas.push({
                nivel: 'aviso', titulo: 'Apenas holerite — sem extrato bancário',
                mensagem: 'A análise fica incompleta sem o extrato bancário, o que pode resultar em reprovação desnecessária.',
                pedirCliente: 'Peça também o extrato bancário dos últimos 3 meses em PDF.',
            });
        }

        return { ok: !problemas.some(p => p.nivel === 'erro'), problemas };
    }

    window._csComprimirBase64 = comprimirParaBase64;
    window._csExtrairTextoPdfDigital = extrairTextoPdfDigital;
    window._csPdfParaImagens = pdfParaImagens;
    window._csOcrImagens = ocrImagens;
    window._csDetectarApostas = detectarApostas;
    window._csValidarQualidadeDocumentos = validarQualidadeDocumentos;
})();
