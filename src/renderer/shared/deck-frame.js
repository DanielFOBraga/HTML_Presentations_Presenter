'use strict';

/**
 * Um iframe com uma apresentação lá dentro.
 *
 * O agente injetado anuncia-se por postMessage; a partir daí, como a UI e a
 * apresentação são servidas da mesma origem, chamamos window.__present
 * diretamente — sem protocolo de mensagens para cada navegação.
 */
window.DeckFrame = (function () {
  const frames = new Set();

  window.addEventListener('message', (event) => {
    for (const frame of frames) {
      if (frame.el.contentWindow === event.source) {
        frame._receive(event.data);
        return;
      }
    }
  });

  class DeckFrame {
    /**
     * @param {HTMLIFrameElement} el
     * @param {{onIndex?: (i:number)=>void, onKey?: (e:object)=>void}} handlers
     */
    constructor(el, handlers = {}) {
      this.el = el;
      this.handlers = handlers;
      this.meta = null;
      this._resolveReady = null;
      this.ready = new Promise((resolve) => { this._resolveReady = resolve; });
      // Tamanho de desenho até o agente dizer o verdadeiro. Tem de ser pelo
      // menos tão grande como o do deck (ver fit()); 1920×1080 cobre os dois.
      this.design = { width: 1920, height: 1080 };
      frames.add(this);

      this.box = el.parentElement || el;
      this._resize = new ResizeObserver(() => this.fit());
      this._resize.observe(this.box);
      this.fit();
    }

    /**
     * Dá ao iframe exatamente o tamanho de desenho do deck e encolhe-o com um
     * transform do lado de cá.
     *
     * Podia deixar-se o iframe a preencher a caixa e o deck a escalar-se
     * sozinho — mas nenhum dos dois se comporta bem quando a janela é mais
     * estreita do que o palco: no deck do Claude Code o `place-items: center`
     * deixa de centrar (a coluna da grelha fica com a largura do palco e
     * transborda), e o slide aparecia encostado e cortado. Com o iframe sempre
     * à medida do palco, o deck vê a janela para que foi desenhado, escala-se
     * a 1 e o enquadramento é o mesmo do ecrã inteiro.
     */
    fit() {
      const box = this.box.getBoundingClientRect();
      if (!box.width || !box.height) return;
      const { width, height } = this.design;
      const scale = Math.min(box.width / width, box.height / height);
      this.el.style.width = `${width}px`;
      this.el.style.height = `${height}px`;
      this.el.style.transform = `translate(-50%, -50%) scale(${scale})`;

      // Os dois decks só reescalam o palco quando apanham um `resize` na sua
      // janela, e redimensionar o elemento iframe não o dispara de forma
      // fiável. Sem este empurrão o palco ficava com a escala do tamanho
      // anterior (1920×1080 por omissão) e transbordava.
      const view = this.el.contentWindow;
      if (!view) return;
      const nudge = () => {
        try { view.dispatchEvent(new Event('resize')); } catch { /* ainda a carregar */ }
      };
      nudge();
      // De novo depois do layout assentar — e fora do rAF, que fica suspenso
      // quando a janela está escondida (a do slide arranca em segundo plano).
      requestAnimationFrame(nudge);
      setTimeout(nudge, 0);
    }

    /** Carrega o deck. Resolve com os metadados quando o agente responder. */
    load(url, startIndex = 0) {
      this.meta = null;
      this.ready = new Promise((resolve) => { this._resolveReady = resolve; });
      this.el.src = `${url}#${startIndex + 1}`;
      return this.ready;
    }

    _receive(data) {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'present:ready') {
        this.meta = data;
        if (data.design && data.design.width && data.design.height) {
          this.design = data.design;
          this.fit();
        }
        if (this._resolveReady) { this._resolveReady(data); this._resolveReady = null; }
      } else if (data.type === 'present:index') {
        if (this.handlers.onIndex) this.handlers.onIndex(data.index, this);
      } else if (data.type === 'present:key') {
        if (this.handlers.onKey) this.handlers.onKey(data, this);
      }
    }

    get api() {
      try {
        return this.el.contentWindow && this.el.contentWindow.__present;
      } catch {
        return null;
      }
    }

    /** Navega assim que o agente estiver pronto. */
    async goTo(index) {
      await this.ready;
      const api = this.api;
      if (api) api.goTo(index);
    }

    /** Documento do deck — usado para clonar slides para as miniaturas. */
    get doc() {
      try {
        return this.el.contentDocument;
      } catch {
        return null;
      }
    }
  }

  return DeckFrame;
})();
