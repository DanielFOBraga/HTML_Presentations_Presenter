'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  drop: $('drop'),
  pick: $('pick'),
  deck: $('deck'),
  name: $('deck-name'),
  kind: $('deck-kind'),
  clear: $('clear'),
  doClean: $('do-clean'),
  cleanDesc: $('clean-desc'),
  doPresent: $('do-present'),
  screens: $('screens'),
  recents: $('recents-list'),
  recentsEmpty: $('recents-empty'),
  toast: $('toast'),
};

let current = null;
let toastTimer = null;

function toast(message, tone = '') {
  els.toast.textContent = message;
  els.toast.className = `toast ${tone}`.trim();
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 6500);
}

const KIND_LABEL = {
  bundle: 'Apresentação Claude Design (ficheiro único)',
  'deck-stage': 'Apresentação com componente deck-stage',
  generic: 'Apresentação HTML simples',
};

function render() {
  // A zona de largar fica sempre visível, para se poder trocar de ficheiro
  // arrastando outro por cima sem passar pelo botão "Trocar".
  els.deck.hidden = !current;
  if (!current) return;

  els.name.textContent = current.name;
  els.kind.textContent = KIND_LABEL[current.kind] || 'Apresentação HTML';

  const cleanAction = els.doClean.closest('.action');
  if (current.isClean) {
    els.doClean.disabled = true;
    cleanAction.classList.add('blocked');
    els.cleanDesc.textContent = 'Este ficheiro já é uma versão sem barra lateral.';
  } else if (!current.hasRail) {
    els.doClean.disabled = true;
    cleanAction.classList.add('blocked');
    els.cleanDesc.textContent =
      'Esta apresentação não tem barra lateral de slides — já abre em ecrã inteiro. '
      + 'Pode usá-la à mesma no modo apresentador.';
  } else {
    els.doClean.disabled = false;
    cleanAction.classList.remove('blocked');
    els.cleanDesc.textContent =
      'Cria um novo ficheiro ao lado do original, sem a coluna de miniaturas e sem o '
      + 'contador do rodapé — pronto para pôr em ecrã inteiro.';
  }
}

async function setDeck(info) {
  if (!info) return;
  if (info.error) { toast(`Não foi possível ler o ficheiro: ${info.error}`, 'warn'); return; }
  current = info;
  render();
  refreshRecents();
}

async function refreshRecents() {
  const list = await window.app.recents();
  els.recents.innerHTML = '';
  els.recentsEmpty.hidden = list.length > 0;

  for (const item of list) {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'recent-open';
    open.title = item.filePath;
    open.textContent = item.name;

    const path = document.createElement('span');
    path.className = 'path';
    path.textContent = item.filePath.replace(/[/\\][^/\\]+$/, '');
    open.appendChild(path);

    open.addEventListener('click', async () => setDeck(await window.app.inspect(item.filePath)));
    li.appendChild(open);
    els.recents.appendChild(li);
  }
}

async function refreshScreens() {
  const info = await window.app.info();
  els.screens.textContent = info.hasSecondDisplay
    ? `${info.displayCount} ecrãs detetados — o slide vai para o segundo.`
    : 'Só há um ecrã: a janela do slide abre normal e pode movê-la depois.';
}

// ------------------------------------------------------------------ eventos

els.pick.addEventListener('click', async () => setDeck(await window.app.pickDeck()));
els.clear.addEventListener('click', () => { current = null; render(); });

els.doClean.addEventListener('click', async () => {
  els.doClean.disabled = true;
  try {
    const result = await window.app.exportClean(current.filePath);
    if (result.ok) {
      const name = result.destPath.replace(/^.*[/\\]/, '');
      toast(`Criado "${name}" na mesma pasta.`, 'ok');
    } else {
      toast(result.reason, 'warn');
    }
  } finally {
    render();
  }
});

els.doPresent.addEventListener('click', async () => {
  els.doPresent.disabled = true;
  const result = await window.app.present(current.filePath);
  els.doPresent.disabled = false;
  if (!result.ok) toast(result.reason, 'warn');
});

for (const type of ['dragenter', 'dragover']) {
  els.drop.addEventListener(type, (e) => { e.preventDefault(); els.drop.classList.add('over'); });
}
for (const type of ['dragleave', 'drop']) {
  els.drop.addEventListener(type, () => els.drop.classList.remove('over'));
}
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

els.drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (!/\.html?$/i.test(file.name)) { toast('Só ficheiros .html.', 'warn'); return; }
  setDeck(await window.app.inspect(window.app.pathForFile(file)));
});

render();
refreshRecents();
refreshScreens();
