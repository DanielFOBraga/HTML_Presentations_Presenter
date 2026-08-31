# O formato dos ficheiros do Claude Design

Notas de engenharia reversa. Não há documentação oficial deste formato: tudo o
que está aqui foi lido dos próprios ficheiros e confirmado com testes.

## O invólucro

Um `.html` exportado do Claude Design ("standalone" ou "offline") é um invólucro
fixo com **três blocos de dados**:

| Bloco | Conteúdo |
| --- | --- |
| `<script type="__bundler/manifest">` | JSON `{ uuid: { data, mime, compressed } }` — imagens, vídeos webm, tipos de letra, JS. `data` é base64, muitas vezes por cima de gzip. |
| `<script type="__bundler/ext_resources">` | `[{ id, uuid }]`, exposto no arranque como `window.__resources`. |
| `<script type="__bundler/template">` | Uma **string JSON** com o HTML verdadeiro da apresentação. |

No arranque, o invólucro descomprime tudo para *blob URLs*, faz
`template.split(uuid).join(blobUrl)` para cada recurso e substitui o
`documentElement` pelo resultado. Dentro do template, as referências a recursos
são o uuid nu: `src="a1b2…"`, `url("a1b2…")`.

## Reescrever sem estragar

`src/core/bundle.js` lê e escreve estes blocos. Dois pormenores que custaram a
descobrir e que os testes protegem:

1. **A codificação tem de ser reproduzida exatamente.** O bloco original é
   `'\n' + JSON.stringify(valor).replace(/<\//g, '<\\u002F') + '\n  '`. O escape
   de `</` existe para o conteúdo não fechar o `<script>` a meio. Reescrever um
   ficheiro sem alterações devolve bytes idênticos ao original — há um teste só
   para isso.
2. **Substituir por índice, não com `replace()`.** O conteúdo dos blocos contém
   `$&` e afins, que o `String.replace` interpretaria como padrões de
   substituição. `bundle.write()` corta e cola com `slice()`.

Por isso é que a exportação sem barra lateral é uma **edição cirúrgica**: mexe só
no template e deixa o manifest de 12 MB intacto. O ficheiro exportado continua a
ser único e a abrir em qualquer browser.

## O componente `<deck-stage>`

O runtime da apresentação vive no manifest. Da leitura dele:

- **`no-rail`** é um atributo suportado e observado
  (`observedAttributes` inclui `'no-rail'`; no CSS, `:host([no-rail]) .rail
  { display: none; }`). É a chave da exportação limpa.
- **`window.postMessage({ __omelette_presenting: true }, '*')`** ativa o modo
  apresentação: esconde a barra lateral **e** o rodapé com o contador
  `1 / 19 · Reset R`, e refaz o cálculo de escala.
- API pública no elemento: `.index`, `.length`, `goTo(i)`, `next()`, `prev()`,
  `reset()`.
- Evento **`slidechange`** (`bubbles` + `composed`) com
  `{ index, previousIndex, total, slide, reason }`.
- Notas do orador: `<script type="application/json" id="speaker-notes">` (um
  array por slide), com precedência para o atributo `data-speaker-notes` de cada
  `<section>`.
- *Deep link* por `location.hash` = `#N`, começando em 1.
- `attachShadow({ mode: 'open' })` — dá para clonar os slides de fora, que é como
  a grelha de miniaturas é construída.
- `?_snthumb=` no URL ativa `no-rail` automaticamente: é a convenção que o
  próprio *presenter popup* do Claude usa.

O script que a app injeta faz `postMessage` no carregamento, no primeiro
`slidechange` e ainda com algumas repetições curtas — o runtime só começa a ouvir
no `connectedCallback`, e ele é carregado por `src`.

## As apresentações do Claude Code

Formato bem mais simples: `#viewport > #stage`, slides em
`<section class="slide">`, o ativo com `.active`. A navegação está num IIFE
fechado, sem API, a ouvir `keydown` no `document`.

Logo, o adaptador genérico:

- **navega** com `KeyboardEvent` sintéticos;
- **observa** o índice com um `MutationObserver` na classe `.active`;
- **conta** os slides por `.slide`.

## Um detalhe de layout

O `#stage` do Claude Code tem 1280×720 fixos e escala-se por `transform`. Metido
num iframe mais estreito, `place-items: center` deixa de centrar (a coluna da
grelha fica do tamanho do conteúdo e transborda) e o slide aparece cortado. A
solução em `src/renderer/shared/deck-frame.js` é dar ao iframe exatamente o
tamanho de desenho da apresentação e escalar o **elemento iframe**, para a
apresentação ver sempre a janela para que foi feita.
