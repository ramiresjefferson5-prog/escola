# ERP Escolar — Projeto organizado v33

Esta versão reorganiza a base v32 em pastas sem alterar a lógica funcional do sistema.

## Estrutura

```text
erp-escolar-refatorado-v33/
├── index.html
├── assets/
│   ├── css/
│   │   ├── main.css
│   │   ├── 01-base.css
│   │   ├── 02-profile-modals.css
│   │   ├── 03-teacher-login-attendance.css
│   │   ├── 04-gallery.css
│   │   ├── 05-school-theme.css
│   │   ├── 06-parent-auth-social.css
│   │   ├── 07-parent-native-search.css
│   │   ├── 08-parent-polish-fixes.css
│   │   ├── 09-parent-app-v30.css
│   │   ├── 10-parent-child-profile-v31.css
│   │   └── 11-parent-child-docs-v32.css
│   └── js/
│       ├── config.js
│       ├── helpers.js
│       └── app.js
├── legacy/
│   └── v32/
│       ├── index.v32.html
│       ├── script.v32.js
│       └── style.v32.css
└── patches/
    └── CHANGELOG-v33.md
```

## O que mudou

- O CSS foi separado por responsabilidade.
- O JavaScript foi separado em configuração, helpers e aplicação principal.
- O `index.html` agora aponta para `assets/css/main.css` e para os três scripts em `assets/js/`.
- A base antiga foi preservada em `legacy/v32`.
- Foi aplicado um fix visual isolado na barra de abas mobile para impedir que ela estique pela tela.

## Como publicar

Suba todos os arquivos e pastas para o repositório mantendo a estrutura acima.

O arquivo principal continua sendo:

```text
index.html
```

## Observação

Não houve alteração de banco de dados nesta versão.


## Atualização v34

Refinamento focado na aba **Perfil do filho**. A estrutura v33 foi mantida, com ajuste apenas em `assets/js/app.js`, `assets/css/10-parent-child-profile-v31.css`, `index.html` e changelog em `patches/CHANGELOG-v34.md`.
