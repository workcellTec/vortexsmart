# VortexSmart

SaaS multi-loja de gestão para lojas de celular (Firebase).

- `app/` — o site (celular, navegador do PC e programa .exe usam o mesmo código; o formato de tela é escolhido sozinho)
- `electron/` — programa .exe do PC (impressora térmica, etiquetas, leitor de código de barras) — não alterar os arquivos de impressão sem teste no hardware
- `functions/` — Cloud Functions
- `firebase.json`, `storage.rules`, `cors.json` — configuração do Firebase (deploy só pelo PC)

Teste: cada envio na `main` publica `app/` no GitHub Pages. Oficial: `firebase deploy --only hosting` na raiz.
