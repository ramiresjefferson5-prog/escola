# CHANGELOG v33 — Refatoração segura

Data: 2026-05-03 23:18:46 UTC

## Objetivo

Organizar o projeto em pastas e arquivos lógicos sem quebrar funcionamento.

## Alterações

- `style.css` monolítico separado em módulos dentro de `assets/css/`.
- `script.js` monolítico separado em:
  - `assets/js/config.js`
  - `assets/js/helpers.js`
  - `assets/js/app.js`
- `index.html` atualizado para carregar os novos arquivos.
- Arquivos originais v32 preservados em `legacy/v32/`.
- Correção CSS isolada na navegação mobile dos pais:
  - desktop mantém navegação sticky no topo;
  - mobile mantém navegação fixa embaixo sem cobrir a página.

## Sem mudanças

- Sem SQL novo.
- Sem alteração de Supabase.
- Sem alteração de regras de login.
- Sem alteração de cadastro, chamada, galeria, perfil ou vínculo.
- Sem remoção de funcionalidades.
