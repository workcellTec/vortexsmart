# VortexSmart para Android (APK)

App Android mínimo: uma janela de navegador (WebView) própria que abre o sistema. Tem dados e login
separados do Chrome. Leva junto as coisas que o WebView não faz sozinho: câmera (código de barras),
escolher foto/arquivo, baixar e compartilhar PDF/imagem, abrir WhatsApp/links fora, botão voltar.

- Gerar: GitHub › Actions › **Gerar APK (Android)** › Run workflow, escolhendo o **canal**:
  - **beta** (padrão): app "VortexSmart Beta" (`app.vortexsmart.beta`), instala ao lado do oficial, abre o site de teste (GitHub Pages, atualizado a cada envio na main) e se atualiza pela Release `apk-beta` (marcada como pré-lançamento). Login e dados do aparelho são separados do oficial; o banco do Firebase é o mesmo (teste na loja de demonstração).
  - **oficial**: app dos clientes (`app.vortexsmart`), abre o Firebase Hosting e se atualiza pela Release `apk-latest`. O workflow recusa gerar o oficial apontando pro site de teste.
  Os canais nunca se misturam: publicar o beta não mexe no APK que os clientes recebem.
- O app abre o endereço do canal; cada deploy do site já atualiza o app. APK novo só se mudar a parte Android (ícone/nome/permissões/ponte). Quem tem APK instalado recebe o aviso de versão nova sozinho (`Atualizador.java` + `apk-versao.json` da Release): preencha "novidades" e, se quiser, marque "obrigatória" ao rodar o workflow.
- Assinatura: chave criada na 1ª execução e guardada criptografada em `vortexsmart.jks.enc`; a senha é o segredo `APK_SENHA` (você escolhe).
  **Guarde a chave e a senha**: sem elas não dá pra atualizar um APK já instalado (teria de desinstalar).
