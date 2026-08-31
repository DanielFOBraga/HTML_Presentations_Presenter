'use strict';

/**
 * Grelha de miniaturas reais, sem abrir um iframe por slide.
 *
 * Cada miniatura é um clone estático do <section> do slide, dentro de um shadow
 * root que adota o CSS do documento da apresentação. É a mesma técnica que o
 * runtime do <deck-stage> usa na sua barra lateral, e por isso precisa dos
 * mesmos cuidados:
 *
 *  - `:root` (e `html`) num stylesheet adotado não casa com nada dentro de um
 *    shadow root, por isso reescreve-se para `:host`;
 *  - como isso fixa cada custom property no valor por omissão da folha de
 *    estilos, copiam-se os valores COMPUTADOS para o host, inline;
 *  - os atributos data-, class e lang do <html> são espelhados no host, senão
 *    seletores como `:host([data-voice="modern"])` deixam de casar.
 *
 * Acrescento nosso: os clones saem do documento do deck (/deck/deck.html) para
 * o documento da UI (/ui/presenter/…), e os URLs relativos passariam a resolver
 * contra a base errada — por isso são todos absolutizados.
 */
window.ThumbGrid = (function () {
  const URL_ATTRS = ['src', 'href', 'poster', 'data-src'];
  const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i;

  const absolutize = (value, base) => {
    const trimmed = String(value).trim();
    if (!trimmed || ABSOLUTE.test(trimmed)) return trimmed;
    try { return new URL(trimmed, base).href; } catch { return trimmed; }
  };

  /** Reescreve url(...) numa folha de estilos serializada. */
  const absolutizeCss = (css, base) =>
    css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, value) =>
      `url(${quote}${absolutize(value, base)}${quote})`);

  function authorCssFrom(doc) {
    const css = Array.from(doc.styleSheets).map((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
      } catch {
        return ''; // folha inacessível (cross-origin): ignorar
      }
    }).join('\n')
      // O host é "featureless" fora da forma funcional :host(...), por isso
      // qualquer composto em :root — [attr], .classe, #id, :pseudo — tem de
      // virar :host(<composto>) e não :host<composto>.
      .replace(/:root((?:\[[^\]]*\]|[.#][-\w]+|:[-\w]+(?:\([^)]*\))?)+)/g, ':host($1)')
      .replace(/:root\b/g, ':host')
      .replace(/(^|[\s,>~+(}])html((?:\[[^\]]*\]|[.#][-\w]+|:[-\w]+(?:\([^)]*\))?)+)(?![-\w])/g, '$1:host($2)')
      .replace(/(^|[\s,>~+(}])html(?![-\w])/g, '$1:host');

    return absolutizeCss(css, doc.baseURI);
  }

  /** Um custom element clonado faria upgrade ao ser inserido; troca-se por div. */
  function neuter(el) {
    const box = el.ownerDocument.createElement('div');
    for (const attr of el.attributes) {
      if (attr.name === 'class' || attr.name === 'style' || attr.name.startsWith('data-')
          || attr.name === 'lang' || attr.name === 'dir') {
        box.setAttribute(attr.name, attr.value);
      }
    }
    while (el.firstChild) box.appendChild(el.firstChild);
    return box;
  }

  function prepareClone(slide, doc, design) {
    let clone = slide.cloneNode(true);
    if (clone.tagName.includes('-')) clone = neuter(clone);
    clone.querySelectorAll('*').forEach((el) => {
      if (el.tagName.includes('-')) el.replaceWith(neuter(el));
    });

    // Os URLs passam a ser absolutos: o clone vai viver noutro documento.
    const base = doc.baseURI;
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of URL_ATTRS) {
        if (el.hasAttribute && el.hasAttribute(attr)) {
          el.setAttribute(attr, absolutize(el.getAttribute(attr), base));
        }
      }
      if (el.hasAttribute && el.hasAttribute('srcset')) {
        el.setAttribute('srcset', el.getAttribute('srcset').split(',').map((part) => {
          const [url, ...rest] = part.trim().split(/\s+/);
          return [absolutize(url, base), ...rest].join(' ');
        }).join(', '));
      }
      if (el.style && el.style.cssText.includes('url(')) {
        el.style.cssText = absolutizeCss(el.style.cssText, base);
      }
    }

    // O <deck-stage> posiciona os slides a partir do shadow CSS dele, que não
    // chega aqui; o clone tem de se posicionar sozinho. E fica sempre visível,
    // ao contrário do original que está hidden fora do slide ativo.
    clone.style.cssText += ';position:absolute;top:0;left:0;transform-origin:0 0;'
      + 'pointer-events:none;box-sizing:border-box;overflow:hidden;'
      + `width:${design.width}px;height:${design.height}px;`
      + 'visibility:visible;opacity:1;margin:0;';
    return clone;
  }

  class ThumbGrid {
    /**
     * @param {HTMLElement} container
     * @param {{onPick: (index:number)=>void}} options
     */
    constructor(container, { onPick } = {}) {
      this.container = container;
      this.onPick = onPick;
      this.cells = [];
      this.design = { width: 1920, height: 1080 };
      this.observer = new ResizeObserver(() => this.rescale());
    }

    /** (Re)constrói a grelha a partir de um DeckFrame já carregado. */
    build(frame) {
      const doc = frame.doc;
      const api = frame.api;
      if (!doc || !api) return;

      const slides = api.slides();
      this.design = api.design || this.design;
      this.container.innerHTML = '';
      this.cells = [];
      this.observer.disconnect();

      let sheet = null;
      const css = authorCssFrom(doc);
      try {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
      } catch {
        sheet = null; // navegador sem CSSStyleSheet construível: <style> em vez disso
      }

      const rootAttrs = doc.documentElement.attributes;
      const liveStyle = getComputedStyle(doc.querySelector('deck-stage') || doc.documentElement);
      const vars = new Set(css.match(/--[\w-]+/g) || []);

      slides.forEach((slide, index) => {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'thumb';
        cell.style.aspectRatio = `${this.design.width} / ${this.design.height}`;
        cell.title = (frame.meta && frame.meta.slides[index] && frame.meta.slides[index].label) || '';
        cell.addEventListener('click', () => this.onPick && this.onPick(index));

        const host = document.createElement('div');
        host.className = 'thumb-host';
        for (const attr of rootAttrs) {
          if (attr.name.startsWith('data-') || attr.name === 'class' || attr.name === 'lang') {
            host.setAttribute(attr.name, attr.value);
          }
        }
        // O valor computado ganha à omissão que a reescrita :root→:host fixou.
        vars.forEach((name) => {
          const value = liveStyle.getPropertyValue(name);
          if (value) host.style.setProperty(name, value.trim());
        });

        const shadow = host.attachShadow({ mode: 'open' });
        if (sheet) {
          shadow.adoptedStyleSheets = [sheet];
        } else {
          const style = document.createElement('style');
          style.textContent = css;
          shadow.appendChild(style);
        }

        const clone = prepareClone(slide, doc, this.design);
        shadow.appendChild(clone);

        const number = document.createElement('span');
        number.className = 'thumb-num';
        number.textContent = index + 1;

        cell.append(host, number);
        this.container.appendChild(cell);
        this.cells.push({ cell, clone });
      });

      this.observer.observe(this.container);
      requestAnimationFrame(() => this.rescale());
    }

    rescale() {
      if (!this.cells.length) return;
      const width = this.cells[0].cell.clientWidth;
      if (!width) return;
      const scale = width / this.design.width;
      for (const { clone } of this.cells) clone.style.transform = `scale(${scale})`;
    }

    setActive(index) {
      this.cells.forEach(({ cell }, i) => cell.classList.toggle('active', i === index));
      const active = this.cells[index];
      if (active) active.cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  return ThumbGrid;
})();
