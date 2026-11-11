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
  paths: $('paths'),
  pathsOptions: $('paths-options'),
  recents: $('recents-list'),
  recentsEmpty: $('recents-empty'),
  libraryDir: $('library-dir'),
  libraryPick: $('library-pick'),
  libraryList: $('library-list'),
  libraryEmpty: $('library-empty'),
  toast: $('toast'),
};

let current = null;
let chosenPath = null;
let library = { dir: null, items: [] };
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
  renderPaths();

  const cleanAction = els.doClean.closest('.action');
  // A exportação só serve para decks com barra lateral; nos outros o cartão
  // só ocupava espaço, e o modo apresentador fica sozinho.
  const cleanUseful = current.hasRail && !current.isClean;
  cleanAction.hidden = !cleanUseful;
  els.deck.querySelector('.actions').classList.toggle('single', !cleanUseful);
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

/**
 * Decks com slides alternativos (ex.: pedido à Indústria vs à ENESII): o
 * percurso escolhe-se aqui, como as "apresentações personalizadas" do
 * PowerPoint, e pode trocar-se depois na vista do apresentador.
 */
function renderPaths() {
  const paths = current && current.paths;
  els.paths.hidden = !paths;
  els.pathsOptions.innerHTML = '';
  if (!paths) { chosenPath = null; return; }
  if (!paths.options.some((o) => o.id === chosenPath)) chosenPath = paths.options[0].id;

  for (const option of paths.options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(option.id === chosenPath));
    btn.textContent = option.label;
    btn.addEventListener('click', () => { chosenPath = option.id; renderPaths(); });
    els.pathsOptions.appendChild(btn);
  }
}

async function setDeck(info) {
  if (!info) return;
  if (info.error) { toast(`Não foi possível ler o ficheiro: ${info.error}`, 'warn'); return; }
  current = info;
  chosenPath = null;
  render();
  renderLibrary();
  refreshRecents();
}

// -------------------------------------------------------------- biblioteca

const dateFmt = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
const sizeFmt = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function renderLibrary() {
  els.libraryDir.textContent = library.dir || '';
  els.libraryDir.title = library.dir || '';
  els.libraryPick.textContent = library.dir ? 'Mudar pasta…' : 'Escolher pasta…';
  els.libraryList.innerHTML = '';
  els.libraryEmpty.hidden = library.items.length > 0;
  if (library.dir && !library.items.length) {
    els.libraryEmpty.textContent = 'Não foram encontradas apresentações .html nesta pasta.';
  }

  for (const item of library.items) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lib-item';
    if (current && current.filePath === item.filePath) btn.classList.add('current');
    btn.title = item.filePath;

    const title = document.createElement('span');
    title.className = 'lib-title';
    title.textContent = item.folder || item.name;
    const file = document.createElement('span');
    file.className = 'lib-file';
    file.textContent = item.folder ? item.name : '';
    const metaLine = document.createElement('span');
    metaLine.className = 'lib-meta';
    metaLine.textContent = `${dateFmt.format(new Date(item.modifiedAt))} · ${sizeFmt(item.size)}`;

    btn.append(title, file, metaLine);
    btn.addEventListener('click', async () => {
      await setDeck(await window.app.inspect(item.filePath));
      els.deck.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    li.appendChild(btn);
    els.libraryList.appendChild(li);
  }
}

async function refreshLibrary() {
  library = await window.app.library();
  renderLibrary();
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
els.libraryPick.addEventListener('click', async () => {
  const picked = await window.app.pickLibrary();
  if (!picked) return;
  library = picked;
  renderLibrary();
});
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
  const result = await window.app.present(current.filePath, { path: chosenPath });
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

// Ficheiro aberto com a app ("Abrir com", ou arrastado para o executável).
window.app.onOpenFile(async (filePath) => setDeck(await window.app.inspect(filePath)));

// A lista volta a ler a pasta quando a janela regressa (fim de uma
// apresentação, ou um novo standalone gerado entretanto).
window.addEventListener('focus', () => refreshLibrary());

render();
refreshRecents();
refreshScreens();
refreshLibrary();
window.app.initialFile().then(async (filePath) => {
  if (filePath) setDeck(await window.app.inspect(filePath));
});
