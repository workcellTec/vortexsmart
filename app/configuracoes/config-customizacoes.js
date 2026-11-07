// ================================================================
// configuracoes/config-customizacoes.js — VortexSmart · Customizações
// Registra: window._initConfigCustomizacoes()
//
// Único sub-módulo de Configurações liberado pro Funcionário (Fase 0
// — ver SECOES_LIBERADAS_FUNCIONARIO em configuracoes/router.js).
//
// 3 seções, todas preferência PESSOAL por usuário (Gestor e
// Funcionário têm cada um a própria, sem afetar o outro):
//   1. Aparência — Modo (Claro/Escuro) + Cor de destaque. Local por
//      aparelho (safeStorage) — aplica na hora, sem botão Salvar.
//   2. Valor adicional padrão (Calculadora) e
//   3. Texto do cálculo (Por Aparelho) — esses SIM vão pro Firebase
//      (usuarios/{uid}/preferencias/…), porque precisam acompanhar
//      o usuário se ele trocar de aparelho, não só esse dispositivo.
//      Cada perfil tem os seus.
//
// Depende de (via window.*):
//   showCustomModal, _usuarioPrefRef, _dbUpdate, _dbGet,
//   _configCustomizacoes, _aplicarTema, _aplicarCorDestaque,
//   _CORES_DESTAQUE, _COR_PADRAO, safeStorage
// ================================================================
(function () {
    'use strict';

    const modal = opts => typeof window.showCustomModal === 'function' && window.showCustomModal(opts);
    const el    = id   => document.getElementById(id);

    let mounted = false;

    function renderShell() {
        const wrap = el('configuracoesCustomizacoes');
        if (!wrap) return;
        const cores = window._CORES_DESTAQUE || {};
        const corPadrao = window._COR_PADRAO || 'padrao';
        wrap.innerHTML = `
            <div class="section-header">
                <button type="button" class="btn-back" aria-label="Voltar"><i class="bi bi-arrow-left"></i></button>
                <h3>Customizações</h3>
            </div>
            <div class="content-card w-100">

                <div class="cz-sec-title">🎨 Aparência</div>
                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#818cf8,#6366f1);">🌗</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">Modo</div>
                        <div class="cz-item-sub">Claro ou escuro, aplica na hora</div>
                        <div class="stq-cats" id="cfgCustomAparenciaPills" style="padding:0;margin-top:10px;">
                            <button type="button" class="stq-cat-pill" data-v="escuro" style="color:var(--primary);">🌙 Escuro</button>
                            <button type="button" class="stq-cat-pill" data-v="claro" style="color:var(--primary);">☀️ Claro</button>
                        </div>
                    </div>
                </div>
                <div class="cz-item">
                    <div class="cz-item-ic" style="background:linear-gradient(135deg,#f472b6,#db2777);">🎨</div>
                    <div class="cz-item-body">
                        <div class="cz-item-title">Cor de destaque</div>
                        <div class="cz-item-sub">Só muda o visual do app — não altera documentos nem fotos</div>
                        <div class="cz-cores-row" id="cfgCustomCoresRow">
                            ${corPadrao === 'padrao' ? '<button type="button" class="cz-cor-swatch" data-v="padrao" style="background:linear-gradient(135deg,#5b3df5,#4f8cff);" title="Padrão"></button>' : ''}
                            ${Object.entries(cores).map(([v, c]) => `<button type="button" class="cz-cor-swatch" data-v="${v}" style="background:${c.hex || c.escuro};" title="${v}"></button>`).join('')}
                        </div>
                    </div>
                </div>

                <div class="cz-sec-title">🧮 Calculadora</div>
                <div class="cz-item cz-item-col">
                    <div class="cz-item-head">
                        <div class="cz-item-ic" style="background:linear-gradient(135deg,#34d399,#059669);">💰</div>
                        <div class="cz-item-body">
                            <div class="cz-item-title">Valor adicional padrão</div>
                            <div class="cz-item-sub">Preenche sozinho o campo "Adicional" no Repassar Valores e no Por Aparelho — só no SEU perfil. Pode trocar ou apagar na hora do cálculo, sem afetar esse padrão.</div>
                        </div>
                    </div>
                    <input type="number" step="0.01" min="0" class="form-control mt-2" id="cfgCustomValorAdicional" placeholder="Ex: 50,00 (deixe vazio pra não preencher nada)"/>
                </div>
                <div class="cz-item cz-item-col">
                    <div class="cz-item-head">
                        <div class="cz-item-ic" style="background:linear-gradient(135deg,#fbbf24,#f59e0b);">✨</div>
                        <div class="cz-item-body">
                            <div class="cz-item-title">Texto do cálculo (Por Aparelho)</div>
                            <div class="cz-item-sub">Adicionado no final da mensagem copiada — só no SEU perfil, cada pessoa tem o próprio</div>
                        </div>
                    </div>
                    <textarea class="form-control mt-2" id="cfgCustomTextoRodape" rows="4"
                        placeholder="Ex: Vai com capinha, película e fone de ouvido de brinde.&#10;Garantia de 3 meses."></textarea>
                    <button type="button" class="stq-modal-btn-save w-100 mt-2" id="cfgCustomSalvarBtn">
                        <i class="bi bi-check-lg"></i> Salvar
                    </button>
                </div>

            </div>
        `;
    }

    function preencherComValorAtual() {
        const textarea = el('cfgCustomTextoRodape');
        if (textarea) {
            const atual = (window._configCustomizacoes && window._configCustomizacoes.textoRodapeCalculo) || '';
            textarea.value = atual;
        }
        const valorAdicionalInput = el('cfgCustomValorAdicional');
        if (valorAdicionalInput) {
            const atual = window._configCustomizacoes && window._configCustomizacoes.valorAdicionalPadrao;
            valorAdicionalInput.value = (atual != null) ? atual : '';
        }
        const temaAtual = (window.safeStorage && window.safeStorage.getItem('vsTema')) || 'escuro';
        document.querySelectorAll('#cfgCustomAparenciaPills .stq-cat-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.v === temaAtual);
        });
        const corAtual = (window.safeStorage && window.safeStorage.getItem('vsCorDestaque')) || window._COR_PADRAO || 'padrao';
        document.querySelectorAll('#cfgCustomCoresRow .cz-cor-swatch').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.v === corAtual);
        });
    }

    function salvar() {
        const textarea = el('cfgCustomTextoRodape');
        if (!textarea) return;
        const btn = el('cfgCustomSalvarBtn');
        const texto = textarea.value; // sem .trim() — permite espaçamento intencional; linhas em branco no fim são responsabilidade do usuário
        const valorAdicionalRaw = el('cfgCustomValorAdicional')?.value;
        const valorAdicionalPadrao = (valorAdicionalRaw !== '' && valorAdicionalRaw != null && !isNaN(parseFloat(valorAdicionalRaw)))
            ? parseFloat(valorAdicionalRaw)
            : null; // vazio/limpou o campo = "não preencher nada", não é o mesmo que 0
        if (typeof window._usuarioPrefRef !== 'function' || typeof window._dbUpdate !== 'function') { modal({ message: 'Erro ao salvar: conexão indisponível.' }); return; }

        window._setBtnLoading && window._setBtnLoading(btn, true, 'Salvando...');
        window._dbUpdate(window._usuarioPrefRef(), { textoRodapeCalculo: texto, valorAdicionalPadrao })
            .then(() => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: 'Salvo!' });
            })
            .catch(e => {
                window._setBtnLoading && window._setBtnLoading(btn, false);
                modal({ message: `Erro ao salvar: ${e.message}` });
            });
    }

    function attachListeners() {
        el('cfgCustomSalvarBtn')?.addEventListener('click', salvar);

        document.querySelectorAll('#cfgCustomAparenciaPills .stq-cat-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                if (typeof window._aplicarTema === 'function') window._aplicarTema(btn.dataset.v);
                document.querySelectorAll('#cfgCustomAparenciaPills .stq-cat-pill').forEach(b => b.classList.toggle('active', b === btn));
            });
        });

        document.querySelectorAll('#cfgCustomCoresRow .cz-cor-swatch').forEach(btn => {
            btn.addEventListener('click', () => {
                if (typeof window._aplicarCorDestaque === 'function') window._aplicarCorDestaque(btn.dataset.v);
                document.querySelectorAll('#cfgCustomCoresRow .cz-cor-swatch').forEach(b => b.classList.toggle('active', b === btn));
            });
        });
    }

    window._initConfigCustomizacoes = function () {
        if (!mounted) {
            renderShell();
            attachListeners();
            mounted = true;
        }
        preencherComValorAtual();
    };
})();
