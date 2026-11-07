// ================================================================
// configuracoes/router.js — VortexSmart · Roteador de Configurações
// Responsável apenas por navegar entre as telas do módulo.
// Cada sub-módulo vive em seu próprio arquivo (prefixo "config-"):
//   config-documentos.js → window._initConfigDocumentos()
//   config-produtos.js   → window._initConfigProdutos()
//   config-taxas.js      → window._initConfigTaxas()
//   config-clientes.js   → window._initConfigClientes()
// ================================================================
(function () {
    'use strict';

    const el = id => document.getElementById(id);

    const CONFIG_SUBS = ['configuracoesHome', 'configuracoesProdutos', 'configuracoesTaxas', 'configuracoesClientes', 'configuracoesDocumentos', 'configuracoesCustomizacoes', 'configuracoesBackup', 'configuracoesUsuarios', 'configuracoesNotificacoes', 'configuracoesReparos', 'configuracoesCredscan'];

    // Únicas seções acessíveis pro Funcionário (Fase 0 — o resto de
    // Configurações continua restrito ao Gestor). Se for adicionar mais
    // seções liberadas pro funcionário no futuro, basta somar aqui.
    const SECOES_LIBERADAS_FUNCIONARIO = ['configuracoesCustomizacoes', 'configuracoesNotificacoes'];

    // ── Impressoras (só no programa instalado). Cada uma tem a SUA escolha, guardada neste
    //    computador por impressao/recibo-termico.js e impressao/etiqueta-termica.js — as
    //    chaves abaixo precisam ficar iguais às deles. Aqui só se LÊ o nome pra mostrar
    //    "qual está escolhida" embaixo de cada linha (as duas são térmicas, e só pelo
    //    nome da linha não dava pra saber qual é qual). ──
    const CHAVE_IMPRESSORA_RECIBO = 'vsmart_impressora_termica_escolhida';
    const CHAVE_IMPRESSORA_ETIQUETA = 'vsmart_impressora_etiqueta_escolhida';

    function atualizarNomesImpressoras() {
        const noPrograma = typeof window.vsmartPrint === 'object' && window.vsmartPrint !== null;
        [['cfgImpressoraReciboNome', CHAVE_IMPRESSORA_RECIBO], ['cfgImpressoraEtiquetaNome', CHAVE_IMPRESSORA_ETIQUETA]].forEach(([id, chave]) => {
            const alvo = el(id);
            if (!alvo) return;
            alvo.textContent = noPrograma ? (localStorage.getItem(chave) || 'Nenhuma escolhida ainda — toque para escolher') : '';
        });
    }

    function openConfiguracoesSection(sectionId) {
        if (typeof window.showMainSection === 'function') window.showMainSection('configuracoes');
        // Ver window._vsNavegarParaHub em core.js pro raciocínio completo.
        const ehHubDoModulo = sectionId === 'configuracoesHome' || !sectionId;
        if (window._vsNavegarParaHub) window._vsNavegarParaHub('openConfiguracoesSection', [sectionId], ehHubDoModulo);
        // Configurações é restrita a quem tem a permissão 'configuracoes'
        // (Gestor sempre tem — ver _temPermissao no core.js), EXCETO as
        // seções em SECOES_LIBERADAS_FUNCIONARIO.
        const podeConfiguracoes = typeof window._temPermissao === 'function' ? window._temPermissao('configuracoes') : true;
        if (!podeConfiguracoes && !SECOES_LIBERADAS_FUNCIONARIO.includes(sectionId)) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Você não tem permissão pra acessar Configurações.' });
            if (typeof window.showMainSection === 'function') window.showMainSection('main');
            return;
        }
        // Usuários e Permissões é SEMPRE só do Gestor, travado de propósito
        // — não depende da permissão geral 'configuracoes' (essa só libera
        // as OUTRAS seções). Sem isso, um Funcionário com acesso geral a
        // Configurações conseguiria entrar aqui e mexer nas permissões de
        // outros usuários, inclusive nas próprias — não é uma trava que
        // dá pra deixar como "mais uma seção comum".
        const ehGestor = typeof window._papelAtual === 'function' ? window._papelAtual() === 'gestor' : true;
        if (sectionId === 'configuracoesUsuarios' && !ehGestor) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'Usuários e Permissões é uma área exclusiva do Gestor.' });
            if (typeof window.showMainSection === 'function') window.showMainSection('main');
            return;
        }
        // Modo de conserto (própria/terceirizada) é decisão estrutural
        // da loja — mesma trava exclusiva do Gestor, independente da
        // permissão geral 'configuracoes'.
        if (sectionId === 'configuracoesReparos' && !ehGestor) {
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: 'A configuração de Concertos é uma área exclusiva do Gestor.' });
            if (typeof window.showMainSection === 'function') window.showMainSection('main');
            return;
        }
        // Só o Gestor decide se a loja paga pela API de IA do CredScan
        // — e, enquanto CREDSCAN_LANCADO (core.js) for false, ninguém
        // entra aqui de jeito nenhum, nem digitando a rota direto.
        if (sectionId === 'configuracoesCredscan' && (!window._CREDSCAN_LANCADO || !ehGestor)) {
            const motivo = !window._CREDSCAN_LANCADO ? 'O CredScan ainda não foi lançado nessa versão do sistema.' : 'A configuração do CredScan é uma área exclusiva do Gestor.';
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ message: motivo });
            if (typeof window.showMainSection === 'function') window.showMainSection('main');
            return;
        }
        if (!sectionId || !el(sectionId)) sectionId = 'configuracoesHome';
        CONFIG_SUBS.forEach(id => { const s = el(id); if (s) s.style.display = 'none'; });

        const target = el(sectionId);
        if (target) target.style.display = 'flex';

        const initMap = {
            configuracoesProdutos:      () => typeof window._initConfigProdutos === 'function' && window._initConfigProdutos(),
            configuracoesTaxas:         () => typeof window._initConfigTaxas === 'function' && window._initConfigTaxas(),
            configuracoesClientes:      () => typeof window._initConfigClientes === 'function' && window._initConfigClientes(),
            configuracoesDocumentos:    () => typeof window._initConfigDocumentos === 'function' && window._initConfigDocumentos(),
            configuracoesCustomizacoes: () => typeof window._initConfigCustomizacoes === 'function' && window._initConfigCustomizacoes(),
            configuracoesBackup:        () => typeof window._initConfigBackup === 'function' && window._initConfigBackup(),
            configuracoesUsuarios:      () => typeof window._initConfigUsuarios === 'function' && window._initConfigUsuarios(),
            configuracoesNotificacoes:  () => typeof window._initConfigNotificacoes === 'function' && window._initConfigNotificacoes(),
            configuracoesReparos:       () => typeof window._initConfigReparos === 'function' && window._initConfigReparos(),
            configuracoesCredscan:      () => typeof window._initConfigCredscan === 'function' && window._initConfigCredscan(),
        };
        if (initMap[sectionId]) initMap[sectionId]();

        // Assim que a Home de Configurações abre, já dispara o pré-load
        // da lista de clientes em segundo plano — se o usuário clicar em
        // "Clientes" na sequência, a lista já está pronta (ou quase),
        // sem parecer lento. Não bloqueia nada, roda em paralelo.
        if (sectionId === 'configuracoesHome' && typeof window._preCarregarClientes === 'function') {
            window._preCarregarClientes();
        }
        if (sectionId === 'configuracoesHome') atualizarNomesImpressoras();
    }
    window.openConfiguracoesSection = openConfiguracoesSection;

    document.addEventListener('DOMContentLoaded', () => {
        el('openConfigProdutos2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesProdutos'));
        el('openConfigTaxas2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesTaxas'));
        el('openConfigClientes2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesClientes'));
        el('openConfigDocumentos2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesDocumentos'));
        el('openConfigCustomizacoes2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesCustomizacoes'));
        el('openConfigBackup2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesBackup'));
        // Recibo e Etiquetas são escolhas SEPARADAS: cada linha abre o seletor da sua impressora
        // (as linhas só existem no programa instalado — ver data-electron-only no index.html).
        el('openConfigImpressora2')?.addEventListener('click', () => {
            if (typeof window._abrirSeletorImpressora === 'function') window._abrirSeletorImpressora(atualizarNomesImpressoras);
        });
        el('openConfigImpressoraEtiqueta2')?.addEventListener('click', () => {
            if (typeof window._abrirSeletorImpressoraEtiqueta === 'function') window._abrirSeletorImpressoraEtiqueta(atualizarNomesImpressoras);
        });
        el('openConfigDiagnostico2')?.addEventListener('click', () => {
            if (typeof window._abrirDiagnosticoSistema === 'function') window._abrirDiagnosticoSistema();
        });
        el('openConfigUsuarios2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesUsuarios'));
        el('openConfigNotificacoes2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesNotificacoes'));
        el('openConfigReparos2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesReparos'));
        el('openConfigCredscan2')?.addEventListener('click', () => openConfiguracoesSection('configuracoesCredscan'));
        el('backFromConfiguracoesHome')?.addEventListener('click', () => history.back());
    });

})();
