# VortexSmart para Android (APK)

App Android mínimo: uma janela de navegador (WebView) própria que abre o sistema. Tem dados e login
separados do Chrome. Leva junto as coisas que o WebView não faz sozinho: câmera (código de barras),
escolher foto/arquivo, baixar e compartilhar PDF/imagem, abrir WhatsApp/links fora, botão voltar.

- Gerar: GitHub › Actions › **Gerar APK (Android)** › Run workflow. O arquivo sai em Releases › "VortexSmart APK".
- O app abre o endereço oficial; cada deploy do site já atualiza o app. APK novo só se mudar ícone/nome/permissões.
- Assinatura: chave criada na 1ª execução e guardada criptografada em `vortexsmart.jks.enc`; a senha é o segredo `APK_SENHA` (você escolhe).
  **Guarde a chave e a senha**: sem elas não dá pra atualizar um APK já instalado (teria de desinstalar).
