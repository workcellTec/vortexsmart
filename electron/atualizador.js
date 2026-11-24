// ================================================================
// atualizador.js — VortexSmart PDV Desktop
// Atualização automática do programa instalado (electron-updater).
//
// Como funciona: o instalador novo é publicado numa Release do GitHub (workflow
// "Gerar instalador do Windows"). O programa confere ao abrir e a cada 30 minutos;
// se há versão nova, baixa sozinho em segundo plano e avisa UMA vez: "Reiniciar
// agora" ou "Depois" — com "Depois" ela é instalada quando o programa for fechado.
//
// Regras de segurança (o PDV não pode parar de imprimir por causa de atualização):
//  - nenhum erro daqui (sem internet, Release fora do ar, arquivo corrompido) chega
//    a derrubar ou travar o programa: tudo vira uma linha em atualizador.log;
//  - sem internet o programa abre e funciona normal, só não confere;
//  - nada aqui toca em impressora, compartilhamento ou configuração: a atualização
//    só troca os arquivos do programa. Os dados do usuário (impressora escolhida,
//    login) ficam na pasta de dados do Windows e sobrevivem à troca.
//
// Recebe tudo por parâmetro (app, dialog, autoUpdater) pra poder ser testado sem
// o Electron de verdade.
// ================================================================
const fs = require('fs');
const path = require('path');

const INTERVALO_MS = 30 * 60 * 1000;   // de quanto em quanto tempo confere
const ATRASO_INICIAL_MS = 30 * 1000;       // espera o programa abrir e o caixa começar a usar
const LOG_MAX_BYTES = 200 * 1024;          // passou disso, recomeça o arquivo

function iniciarAtualizador({ app, dialog, autoUpdater, obterJanela, intervaloMs = INTERVALO_MS, atrasoMs = ATRASO_INICIAL_MS }) {
    const arquivoLog = path.join(app.getPath('userData'), 'atualizador.log');
    function log(nivel, msg) {
        try {
            if (fs.existsSync(arquivoLog) && fs.statSync(arquivoLog).size > LOG_MAX_BYTES) fs.unlinkSync(arquivoLog);
            fs.appendFileSync(arquivoLog, `${new Date().toISOString()} [${nivel}] ${String(msg && msg.stack || msg)}\n`);
        } catch (e) { /* log nunca pode dar erro */ }
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: m => log('info', m), warn: m => log('aviso', m), error: m => log('erro', m), debug: () => {} };

    let versaoBaixada = null;   // versão já baixada e esperando instalar (não confere mais até reiniciar)
    let conferindo = false;

    // precisa existir: um 'error' sem ouvinte derruba o programa. O detalhe já vai pro log pelo logger/conferir.
    autoUpdater.on('error', e => log('erro', `falha do atualizador: ${e && e.message}`.split('\n')[0]));
    autoUpdater.on('update-available', info => log('info', `versão nova disponível: ${info && info.version}`));
    autoUpdater.on('update-downloaded', info => {
        versaoBaixada = info && info.version;
        log('info', `versão ${versaoBaixada} baixada`);
        avisar(versaoBaixada);
    });

    // quitAndInstall(true, true): instala em silêncio (sem o assistente do instalador) e abre o programa de novo sozinho.
    function avisar(versao) {
        const janela = typeof obterJanela === 'function' ? obterJanela() : null;
        const opcoes = {
            type: 'info',
            title: 'VortexSmart PDV',
            message: `A versão ${versao} do VortexSmart já foi baixada.`,
            detail: 'Reiniciar agora leva alguns segundos. Se escolher "Depois", ela é instalada sozinha quando você fechar o programa.',
            buttons: ['Reiniciar agora', 'Depois'],
            defaultId: 1,
            cancelId: 1,
            noLink: true
        };
        Promise.resolve(janela && !janela.isDestroyed() ? dialog.showMessageBox(janela, opcoes) : dialog.showMessageBox(opcoes))
            .then(r => { if (r && r.response === 0) instalar(); })
            .catch(e => log('erro', e));
    }

    // Devolve { estado, versao }: 'atualizado' (já é a mais nova), 'pronta' (baixada, falta reiniciar),
    // 'ocupado' (outra conferência em andamento) ou 'erro' (sem internet, Release fora do ar...).
    function conferir() {
        if (versaoBaixada) return Promise.resolve({ estado: 'pronta', versao: versaoBaixada });
        if (conferindo) return Promise.resolve({ estado: 'ocupado' });
        conferindo = true;
        let p;
        try { p = Promise.resolve(autoUpdater.checkForUpdates()); } catch (e) { p = Promise.reject(e); }
        // o download roda à parte (downloadPromise): se ele falhar e ninguém olhar, vira "unhandled rejection"
        return p.then(r => (r && r.downloadPromise
                ? Promise.resolve(r.downloadPromise).then(() => (versaoBaixada ? { estado: 'pronta', versao: versaoBaixada } : { estado: 'erro' }))
                : { estado: 'atualizado' }))
            .catch(e => { log('erro', e); return { estado: 'erro' }; })
            .then(res => { conferindo = false; return res; });
    }

    // Reinicia e instala a versão já baixada (o mesmo que "Reiniciar agora" do aviso).
    function instalar() {
        if (!versaoBaixada) return false;
        autoUpdater.quitAndInstall(true, true);
        return true;
    }

    log('info', `atualizador ligado (programa ${app.getVersion()})`);
    const t1 = setTimeout(conferir, atrasoMs);
    const t2 = setInterval(conferir, intervaloMs);
    // não segura o programa aberto por causa dos temporizadores
    if (t1.unref) t1.unref();
    if (t2.unref) t2.unref();
    return { conferir, instalar, parar: () => { clearTimeout(t1); clearInterval(t2); } };
}

module.exports = { iniciarAtualizador };
