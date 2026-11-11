# Apresentações HTML

App de ambiente de trabalho (Windows) para apresentar ficheiros HTML de
apresentações — as geradas no **Claude Design** e as geradas no **Claude Code** —
com o conforto do *Presenter View* do PowerPoint.

Faz duas coisas:

1. **Exporta uma versão sem barra lateral.** As apresentações do Claude Design
   mostram sempre uma coluna com as miniaturas de todos os slides e um contador
   no rodapé. A app cria um novo ficheiro, ao lado do original, sem esses dois
   elementos — pronto a pôr em ecrã inteiro e a projetar. Continua a ser um
   ficheiro único, que abre em qualquer browser sem precisar da app.
2. **Modo apresentador em dois ecrãs.** O slide em ecrã inteiro no segundo
   monitor; no primeiro, o slide atual, o seguinte, as notas do orador, um
   cronómetro e a grelha com todos os slides. Funciona com os dois tipos de
   apresentação.

---

## Instalar

### Para usar

Descarregue um dos executáveis (ver [Compilar](#compilar) para os gerar):

| Ficheiro | O que é |
| --- | --- |
| `Apresentacoes-HTML-<versão>-portatil.exe` | Ficheiro único, não instala nada. O mais simples para partilhar. |
| `Apresentacoes-HTML-<versão>-instalador.exe` | Instalador com atalhos no ambiente de trabalho e no menu Iniciar. |

> **Aviso do Windows.** O executável não está assinado digitalmente, por isso o
> SmartScreen mostra *"O Windows protegeu o seu PC"*. Para abrir: **Mais
> informações → Executar mesmo assim**.

### Para desenvolver

Requer [Node.js](https://nodejs.org/) 20 ou superior.

```bash
npm install
```

```bash
npm start
```

---

## Como se usa

1. Arraste um `.html` para a janela, ou clique em **Escolher ficheiro**. A app diz
   que tipo de apresentação é.
2. **Exportar sem barra lateral** cria `<nome> (apresentação).html` na mesma
   pasta. Nunca substitui nada: se já existir, acrescenta ` (2)`, ` (3)`…
3. **Apresentar** abre as duas janelas. Com um só monitor, a janela do slide abre
   normal e há um botão para a passar para o outro ecrã quando o ligar.

### Teclas no modo apresentador

| Tecla | Ação |
| --- | --- |
| `→` `↓` `PageDown` `Enter` | Slide seguinte |
| `←` `↑` `PageUp` `Backspace` | Slide anterior |
| `Espaço` / `Shift`+`Espaço` | Seguinte / anterior |
| `Home` `End` | Primeiro / último slide |
| `G` | Mostrar ou esconder a grelha de slides |
| `Esc` | Terminar a apresentação |

As teclas funcionam nas duas janelas — carregar numa move as duas em sincronia.

---

## Compilar os executáveis

```bash
npm run dist
```

Escreve para `dist/` a versão portátil e o instalador (Windows x64). O ícone é
gerado por `scripts/make-icon.js`, que escreve `build/icon.png`; o
electron-builder converte-o para `.ico` sozinho.

```bash
npm run make-icon
```

---

## Testes

```bash
npm test
```

A suite (`node --test`) verifica a parte mais delicada: que ler, transformar e
reescrever um ficheiro do Claude Design devolve os blocos de dados **byte a
byte** iguais, que a exportação acrescenta `no-rail` exatamente uma vez, que
aplicá-la duas vezes não muda nada, e que a app recusa exportar uma apresentação
que não tem barra lateral.

Os testes usam as apresentações em `examples/`, que não estão no repositório
(ver [`examples/README.md`](examples/README.md)); sem elas, os testes que delas
dependem são saltados em vez de falharem.

---

## Estrutura

```
src/
  main/        processo principal do Electron
    main.js      ciclo de vida, IPC, sessão de apresentação
    server.js    servidor HTTP local (127.0.0.1, porta aleatória)
    windows.js   criação e posicionamento das janelas nos monitores
  core/        lógica pura, sem Electron — é o que os testes cobrem
    bundle.js       ler/escrever o formato de ficheiro do Claude Design
    transform.js    esconder a barra lateral; injetar o agente
    unpack.js       extrair os recursos para cache, uma vez por ficheiro
    export-clean.js a exportação, ponta a ponta
  renderer/    interface (HTML/CSS/JS), toda em português
    launcher/    ecrã inicial
    presenter/   slide atual + seguinte + notas + cronómetro + grelha
    display/     a janela em ecrã inteiro
    agent/       injetado dentro da apresentação, fala com a app
    shared/      código comum às três janelas
  preload/     ponte contextBridge, uma por janela
docs/          notas técnicas
examples/      apresentações para testar (fora do repositório)
scripts/       utilitários de build
test/          suite de testes
```

Documentação técnica em [`docs/`](docs/):
[arquitetura](docs/arquitetura.md) e
[formato dos ficheiros Claude Design](docs/formato-bundle.md).

---

## Histórico

### 1.0.1

Corrige a navegação nas apresentações do Claude Code que marcam o slide ativo
com `.on` e animam a troca (`transition: opacity`). Nessas, o modo apresentador
ficava preso nos primeiros slides: uma tecla em cada duas não fazia nada e a
outra saltava dois slides.

Eram dois defeitos no agente, a somar-se:

- a tecla sintética era disparada em `document` **e** em `window`; como o evento
  borbulha de um para o outro, o deck recebia-a duas vezes e andava dois slides
  por cada passo pedido;
- o slide ativo era procurado pela classe `.active`, que estes decks não usam. O
  plano B — ler o estilo computado — engana-se durante a animação, porque quem
  ainda está opaco é o slide que *sai*; a app lia sempre o slide anterior.

O nome da classe passa a ser descoberto (é a que está num slide só), em vez de
adivinhado. Pelo caminho: o rodapé `#hud` destes decks deixa de aparecer no
projetor, e o clique no slide passa pela app em vez de o deck navegar por si —
que era mais uma forma de as duas janelas se desencontrarem.

### 1.0.0

Primeira versão.

---

## Notas

- **Sem dependências em produção.** Só Electron e o electron-builder, ambos de
  desenvolvimento. Nada de bundlers nem de frameworks.
- **Segurança.** As janelas correm com `contextIsolation: true`,
  `nodeIntegration: false` e `webSecurity` ativo. A comunicação entre a interface
  e o sistema passa toda por `contextBridge`. O servidor HTTP ouve apenas em
  `127.0.0.1`, numa porta aleatória, e valida os caminhos pedidos.
- **O original nunca é alterado.** A exportação escreve sempre um ficheiro novo.
