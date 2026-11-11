# Arquitetura

## Vista geral

```
                    processo principal (Electron)
       ┌──────────────────────────────────────────────────┐
       │  main.js — IPC, sessão, recentes                  │
       │  server.js — HTTP em 127.0.0.1:<porta aleatória>  │
       │  windows.js — janelas e monitores                 │
       └───────┬─────────────────┬─────────────────┬──────┘
               │ contextBridge   │                 │
        ┌──────┴─────┐   ┌───────┴──────┐   ┌──────┴──────┐
        │  launcher  │   │  presenter   │   │   display   │
        │            │   │ (1.º ecrã)   │   │  (2.º ecrã) │
        └────────────┘   └───────┬──────┘   └──────┬──────┘
                                 │ iframes         │ iframe
                          ┌──────┴─────────────────┴──────┐
                          │  apresentação + deck-agent.js  │
                          └────────────────────────────────┘
```

## Porquê um servidor HTTP local

Parece exagero para uma app de ambiente de trabalho, mas resolve dois problemas
de uma vez:

1. **`file://` isola os iframes.** Cada ficheiro fica numa origem opaca, e a
   janela-mãe não consegue aceder ao `contentWindow` — sem isso não há modo
   apresentador. Servir a interface *e* a apresentação da mesma origem
   `http://127.0.0.1:<porta>` resolve.
2. **Os vídeos precisam de `Range` requests.** As apresentações trazem `.webm`;
   sem respostas `206 Partial Content` não há *seek* e alguns nem começam a
   tocar. O `server.js` implementa `Range`.

O servidor ouve só em `127.0.0.1`, numa porta aleatória por sessão, e passa todos
os caminhos por um `safeJoin` que impede sair da pasta servida. As janelas
mantêm `contextIsolation: true`, `nodeIntegration: false` e `webSecurity` ativo.

## Preparação de uma apresentação

Uma vez por ficheiro, com cache em `%TEMP%/apresentacoes-html/<hash>/`, sendo o
hash de `caminho | mtime | tamanho` — muda o ficheiro, muda a cache. Pastas com
mais de 7 dias são apagadas no arranque.

Para um ficheiro do Claude Design, `unpack.js` escreve:

- `assets/<uuid>.<ext>` — cada recurso do manifest, já descomprimido;
- `deck.html` — o template com os uuids trocados por esses caminhos,
  `window.__resources` reconstruído, `integrity`/`crossorigin` removidos e o
  agente injetado.

Uma apresentação do Claude Code é copiada tal e qual, só com o agente injetado.

A cache evita reprocessar 12 MB a cada arranque e faz com que as três *frames*
(atual, seguinte, ecrã inteiro) partilhem os recursos pela cache HTTP.

## O agente

`src/renderer/agent/deck-agent.js` corre dentro do documento da apresentação,
deteta com que tipo está a lidar e expõe uma interface única (`window.__present`)
com índice, total, títulos, notas e navegação. Os detalhes de cada adaptador
estão em [formato-bundle.md](formato-bundle.md).

O ponto mais subtil é o teclado. O agente ouve `keydown` na **fase de captura**,
em `window`, e faz `stopImmediatePropagation()` a todas as teclas sem
modificadores (exceto quando se escreve num campo):

```js
window.addEventListener('keydown', (event) => {
  if (!event.isTrusted || MODIFIERS.has(event.key)) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (isTyping(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  post({ type: 'present:key', key: event.key, shiftKey: event.shiftKey });
}, true);
```

As apresentações ligam-se na fase de borbulhagem, por isso a captura ganha:
nenhuma navega sozinha (o `<deck-stage>` saltava com `1`..`9` e voltava ao início
com `R`), e as duas janelas nunca se dessincronizam. O teste `event.isTrusted`
deixa passar os eventos sintéticos, que são precisamente os que o adaptador
genérico usa para navegar.

Os cliques seguem o mesmo caminho, com uma exceção: se o alvo é interativo
(botão, link, `tabindex`, ou qualquer coisa com `cursor: pointer` dentro do
slide), o clique fica com o deck. Um clique em `[data-path-opt]` (o seletor de
percurso desenhado no deck) chega à app como `present:path`.

## Sincronização

O processo principal é o centro e a vista do apresentador é o único sítio onde
se decide o que uma tecla faz. A janela do slide não navega: envia `deck:key`, o
`main.js` entrega-o ao apresentador, e este responde com `deck:goto`, que volta à
janela do slide como `deck:index`. O ecrã preto/branco segue como
`display:blank`. Não se usa `BroadcastChannel` entre janelas: com o processo
principal como árbitro, o estado da sessão vive num sítio só.

## Percursos

`transform.detectPaths()` procura slides com `data-path` (pelo menos dois
valores), os nomes nos botões `data-path-opt` e o nome do parâmetro na chamada
`URLSearchParams(...).get('<param>')`. A sessão guarda o percurso escolhido e o
deck é servido como `/deck/deck.html?<param>=<id>`. É o próprio deck que retira os
outros slides, como faz no browser. Trocar de percurso (`present:setPath`) envia
`deck:reload` às duas janelas, que recarregam no mesmo índice.

## As janelas nos monitores

O que decide em que monitor uma janela fica em ecrã inteiro é a posição dela
**antes** de `setFullScreen(true)`. Por isso, `createDisplay()` posiciona a
janela dentro dos limites do monitor pretendido e só depois entra em ecrã
inteiro. `moveToNextDisplay()` faz o mesmo pela ordem certa:
`setFullScreen(false)` → `setBounds(...)` → `setFullScreen(true)`.

Com um só monitor há um caminho alternativo: a janela do slide abre normal, com
moldura, e um botão passa-a para o outro ecrã quando ele aparecer.

## Miniaturas

A grelha usa **clones reais** dos slides, não imagens. Para cada slide, um
elemento com *shadow root* próprio que adota as folhas de estilo do documento da
apresentação e recebe um clone da `<section>`, reduzido por `transform`. É a
técnica que o próprio runtime usa nas suas miniaturas, incluindo reescrever
`:root` para `:host` e espelhar os atributos de `<html>`.

Foi preciso acrescentar uma coisa: como os clones mudam para o documento da
interface, os URLs relativos (`src`, `href`, `poster`, `srcset` e `url()` no CSS)
deixariam de resolver. `thumbs.js` torna-os absolutos a partir do `baseURI` do
documento de origem.

## Escala das apresentações

`shared/deck-frame.js` dá a cada iframe o tamanho exato de desenho da
apresentação e escala o próprio elemento
(`translate(-50%, -50%) scale(s)`, com `left/top: 50%`). Assim a apresentação vê
sempre a janela para que foi desenhada, e nós encolhemo-la por fora.

O reajuste é disparado três vezes — imediatamente, no `requestAnimationFrame`
seguinte e num `setTimeout(0)`. Não é excesso de zelo: o `requestAnimationFrame`
não corre enquanto a janela está escondida, e a janela do slide começa em segundo
plano.
