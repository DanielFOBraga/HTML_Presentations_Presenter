'use strict';

/**
 * Agente injetado no documento da apresentação.
 *
 * Dá à app uma interface única sobre dois tipos de deck muito diferentes:
 *
 *   - Claude Design: componente <deck-stage>, com API pública (goTo/next/prev,
 *     .index, .length), evento `slidechange` e notas em #speaker-notes.
 *   - Claude Code: HTML à mão, com a navegação fechada dentro de um IIFE. Não
 *     há API nenhuma, mas o deck ouve teclas em `document` e marca o slide
 *     ativo com a classe .active — dá para conduzir com eventos sintéticos e
 *     observar com um MutationObserver.
 *
 * Comunica com a janela que o embebe por postMessage; a navegação em si é
 * chamada diretamente (mesma origem) através de window.__present.
 */

(function () {
  const NAV_KEYS = new Set([
    'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown',
    'PageDown', 'PageUp', 'Home', 'End', ' ', 'Spacebar', 'Enter', 'Backspace',
  ]);

  const post = (message) => {
    try {
      if (window.parent !== window) window.parent.postMessage(message, '*');
    } catch { /* sem parent acessível: o deck funciona à mesma sozinho */ }
  };

  const isSlideNode = (el) =>
    el.nodeType === 1 && !['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK'].includes(el.tagName);

  /** Mesma precedência de rótulos que o runtime do <deck-stage>. */
  function labelFor(el, i) {
    const explicit = el.getAttribute && el.getAttribute('data-label');
    if (explicit) return explicit;

    const screen = el.getAttribute && el.getAttribute('data-screen-label');
    if (screen) return screen.replace(/^\s*\d+\s*/, '').trim() || screen;

    const h = el.querySelector && el.querySelector('h1, h2, h3, [data-title]');
    const text = h && (h.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return text || `Slide ${i + 1}`;
  }

  /** Notas: atributo por slide primeiro, depois o array #speaker-notes. */
  function notesFor(slides) {
    let json = null;
    const tag = document.getElementById('speaker-notes');
    if (tag) {
      try {
        const parsed = JSON.parse(tag.textContent || '[]');
        if (Array.isArray(parsed)) json = parsed;
      } catch { /* notas ilegíveis não devem impedir a apresentação */ }
    }
    return slides.map((s, i) => {
      const attr = s.getAttribute && s.getAttribute('data-speaker-notes');
      if (attr !== null && attr !== undefined) return attr;
      return json && typeof json[i] === 'string' ? json[i] : '';
    });
  }

  // ------------------------------------------------ adaptador <deck-stage>

  function deckStageAdapter(el) {
    const slides = () => Array.prototype.filter.call(el.children, isSlideNode);

    // O runtime esconde a barra lateral com `no-rail` (antes da primeira
    // pintura) e o overlay do rodapé quando recebe __omelette_presenting.
    el.setAttribute('no-rail', '');
    const announce = () => {
      try { window.postMessage({ __omelette_presenting: true }, '*'); } catch { /* noop */ }
    };
    announce();
    let tries = 0;
    const timer = setInterval(() => { announce(); if (++tries > 25) clearInterval(timer); }, 60);

    return {
      kind: 'deck-stage',
      slides,
      design: {
        width: parseInt(el.getAttribute('width'), 10) || 1920,
        height: parseInt(el.getAttribute('height'), 10) || 1080,
      },
      get index() { return el.index || 0; },
      get total() { return el.length || slides().length; },
      goTo: (i) => el.goTo(i),
      onChange: (fn) => el.addEventListener('slidechange', (e) => fn(e.detail.index)),
    };
  }

  // --------------------------------------------------- adaptador genérico

  function genericAdapter() {
    const pick = () => {
      for (const sel of ['.slide', '#stage > section', '#slides > *', 'body > section']) {
        const found = Array.prototype.filter.call(document.querySelectorAll(sel), isSlideNode);
        if (found.length > 1) return found;
      }
      return [];
    };

    let list = pick();
    const stage = document.querySelector('#stage') || document.querySelector('#viewport') || document.body;

    // Esconder a navegação própria do deck — a app é que passa os slides.
    const style = document.createElement('style');
    style.textContent = '#nav, #progress { display: none !important; }';
    document.head.appendChild(style);

    const activeIndex = () => {
      const byClass = list.findIndex((s) => s.classList && s.classList.contains('active'));
      if (byClass >= 0) return byClass;
      // Sem .active: o slide visível é o que não está transparente.
      const visible = list.findIndex((s) => {
        const cs = getComputedStyle(s);
        return cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5;
      });
      return visible >= 0 ? visible : 0;
    };

    const press = (key) => {
      for (const target of [document, window]) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      }
    };

    // A dimensão de desenho é a do palco ANTES do transform: scale().
    const cs = stage ? getComputedStyle(stage) : null;
    const design = {
      width: (cs && parseFloat(cs.width)) || 1280,
      height: (cs && parseFloat(cs.height)) || 720,
    };

    return {
      kind: 'generic',
      slides: () => list,
      design,
      get index() { return activeIndex(); },
      get total() { return list.length; },
      goTo(target) {
        const clamped = Math.max(0, Math.min(list.length - 1, target));
        // Sem API pública: avançamos à tecla até chegar, com um tecto de
        // segurança para nunca ficar em ciclo se o deck ignorar as setas.
        for (let guard = 0; guard < list.length + 2; guard++) {
          const current = activeIndex();
          if (current === clamped) return;
          press(current < clamped ? 'ArrowRight' : 'ArrowLeft');
          if (activeIndex() === current) return; // não se mexeu: desistir
        }
      },
      onChange(fn) {
        let last = activeIndex();
        const notify = () => {
          const now = activeIndex();
          if (now !== last) { last = now; fn(now); }
        };
        const observer = new MutationObserver(notify);
        for (const slide of list) {
          observer.observe(slide, { attributes: true, attributeFilter: ['class', 'style'] });
        }
        // Slides acrescentados depois (raro, mas barato de cobrir).
        observer.observe(stage || document.body, { childList: true });
      },
    };
  }

  // ---------------------------------------------------------------- arranque

  function install(adapter) {
    const slides = adapter.slides();
    const notes = notesFor(slides);

    window.__present = {
      kind: adapter.kind,
      design: adapter.design,
      get index() { return adapter.index; },
      get total() { return adapter.total; },
      slides: adapter.slides,
      goTo: (i) => adapter.goTo(Math.max(0, Math.min(adapter.total - 1, i))),
      next: () => adapter.goTo(adapter.index + 1),
      prev: () => adapter.goTo(adapter.index - 1),
    };

    adapter.onChange((index) => post({ type: 'present:index', index }));

    // As teclas são tratadas pela app, para as duas janelas andarem sempre
    // juntas. Capture em `window` corre antes de tudo — os dois tipos de deck
    // ligam-se em bubble (window e document). Eventos sintéticos nossos
    // (isTrusted false) passam, senão o adaptador genérico bloqueava-se.
    window.addEventListener('keydown', (event) => {
      if (!event.isTrusted || !NAV_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      post({ type: 'present:key', key: event.key, shiftKey: event.shiftKey });
    }, true);

    post({
      type: 'present:ready',
      kind: adapter.kind,
      total: adapter.total,
      index: adapter.index,
      design: adapter.design,
      slides: slides.map((s, i) => ({ index: i, label: labelFor(s, i) })),
      notes,
    });
  }

  function boot() {
    const stage = document.querySelector('deck-stage');
    if (!stage) return install(genericAdapter());

    customElements.whenDefined('deck-stage').then(() => {
      // O upgrade recolhe os slides de forma assíncrona (slotchange), por isso
      // esperamos pelo primeiro slidechange — que o runtime dispara sempre no
      // arranque — antes de anunciar totais.
      if (stage.length) return install(deckStageAdapter(stage));
      stage.addEventListener('slidechange', () => install(deckStageAdapter(stage)), { once: true });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
