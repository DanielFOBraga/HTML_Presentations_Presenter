'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectPaths } = require('../src/core/transform');

const DECK = `
<deck-stage width="1920" height="1080">
  <section data-label="Capa">
    <button data-path-opt="industria" title="x">Indústria</button>
    <button data-path-opt="enesii">ENESII</button>
  </section>
  <section data-label="Pedido · Indústria" data-path="industria"></section>
  <section data-label="Pedido · ENESII" data-path="enesii"></section>
</deck-stage>
<script>
  var p = new URLSearchParams(window.location.search).get('p');
  document.querySelectorAll('deck-stage > section[data-path]');
</script>`;

test('deteta os percursos, os nomes dos botões e o parâmetro do URL', () => {
  assert.deepEqual(detectPaths(DECK), {
    param: 'p',
    options: [{ id: 'industria', label: 'Indústria' }, { id: 'enesii', label: 'ENESII' }],
  });
});

test('sem botões, o nome vem do próprio id; o parâmetro por omissão é "p"', () => {
  const html = '<section data-path="curto"></section><section data-path="longo"></section>';
  assert.deepEqual(detectPaths(html), {
    param: 'p',
    options: [{ id: 'curto', label: 'Curto' }, { id: 'longo', label: 'Longo' }],
  });
});

test('um parâmetro com outro nome é respeitado', () => {
  const html = `${DECK}`.replace(".get('p')", ".get('publico')");
  assert.equal(detectPaths(html).param, 'publico');
});

test('decks sem slides alternativos não têm percursos', () => {
  assert.equal(detectPaths('<section class="slide"></section><button data-path-opt="a">A</button>'), null);
  assert.equal(detectPaths('<section data-path="so-um"></section>'), null);
});
