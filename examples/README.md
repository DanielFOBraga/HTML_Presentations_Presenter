# Apresentações de exemplo

Esta pasta guarda os ficheiros usados para desenvolver e testar a app. O
conteúdo `.html` **não está no repositório** (ver `.gitignore`): são ficheiros de
4 a 12 MB com apresentações reais de clientes, que não devem ser publicados.

```
examples/
  claude-design/   apresentações standalone geradas no Claude Design
  claude-code/     apresentações HTML simples geradas no Claude Code
```

## Para que servem

Os testes em `test/roundtrip.test.js` leem estas pastas. Se estiverem vazias, os
testes que dependem delas são **saltados** em vez de falharem — um clone limpo
do repositório passa na suite na mesma, mas só valida por completo quem tiver
exemplos aqui.

## Como pôr exemplos

Basta copiar para cá qualquer apresentação HTML:

- **`claude-design/`** — um ficheiro exportado do Claude Design ("standalone" ou
  "offline"). Reconhece-se por ter um bloco `<script type="__bundler/manifest">`
  e por mostrar a barra lateral com as miniaturas de todos os slides.
- **`claude-code/`** — um `.html` normal com os slides em `<section class="slide">`.

Versões já exportadas sem barra lateral (`… (apresentação).html`) podem ficar
aqui à vontade: os testes reconhecem-nas e não as usam como origem de exportação.
