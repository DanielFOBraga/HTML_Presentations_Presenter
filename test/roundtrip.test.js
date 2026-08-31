'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bundle = require('../src/core/bundle');
const transform = require('../src/core/transform');
const { exportClean } = require('../src/core/export-clean');

const ROOT = path.join(__dirname, '..');
const DESIGN = path.join(ROOT, 'examples', 'claude-design');
const CODE = path.join(ROOT, 'examples', 'claude-code');

/** Os exemplos nao estao no repositorio (ver examples/README.md), por isso os
 *  testes que dependem deles saltam-se em vez de falhar num clone limpo. */
const decksIn = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, f))
  : []);

const designDecks = decksIn(DESIGN);
const SEM_EXEMPLOS = 'sem exemplos Claude Design em examples/claude-design';

/** A pasta pode conter versoes ja exportadas (sem barra lateral); essas nao
 *  servem de origem para o teste de exportacao. */
const porExportar = () => designDecks.filter((f) => !transform.isClean(bundle.read(f).template));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apres-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('encodeBlock reproduz byte a byte os blocos originais', (t) => {
  if (!designDecks.length) return t.skip(SEM_EXEMPLOS);
  for (const file of designDecks) {
    const raw = fs.readFileSync(file, 'utf8');
    const deck = bundle.read(file);
    for (const [tag, value] of [
      ['manifest', deck.manifest],
      ['ext_resources', deck.extResources],
      ['template', deck.template],
    ]) {
      const original = raw.match(bundle.blockRe(tag))[1];
      assert.strictEqual(bundle.encodeBlock(value), original,
        `bloco ${tag} de ${path.basename(file)} não é reproduzido exatamente`);
    }
  }
});

test('escrever sem alterações devolve o ficheiro original inalterado', (t) => {
  if (!designDecks.length) return t.skip(SEM_EXEMPLOS);
  for (const file of designDecks) {
    const deck = bundle.read(file);
    const dest = path.join(tmp, 'copia-' + path.basename(file));
    bundle.write(dest, deck, {
      manifest: deck.manifest,
      extResources: deck.extResources,
      template: deck.template,
    });
    assert.ok(fs.readFileSync(dest).equals(fs.readFileSync(file)),
      `${path.basename(file)} mudou ao ser reescrito sem alterações`);
  }
});

test('exportClean tira a barra lateral e preserva o manifest', (t) => {
  const origens = porExportar();
  if (!origens.length) return t.skip(SEM_EXEMPLOS);
  for (const file of origens) {
    const dest = path.join(tmp, 'limpo-' + path.basename(file));
    const result = exportClean(file, dest);
    assert.strictEqual(result.ok, true, `${path.basename(file)}: ${result.reason}`);

    const before = bundle.read(file);
    const after = bundle.read(dest);

    assert.deepStrictEqual(after.manifest, before.manifest, 'o manifest foi alterado');
    assert.deepStrictEqual(after.extResources, before.extResources, 'ext_resources foi alterado');

    const tags = after.template.match(/<deck-stage(?=[\s>])[^>]*>/gi) || [];
    assert.ok(tags.length, 'não há <deck-stage> no resultado');
    for (const tag of tags) assert.match(tag, /\sno-rail(\s|>)/i);

    assert.strictEqual((after.template.match(/no-rail/gi) || []).length, tags.length,
      'no-rail aparece um número inesperado de vezes');
    assert.ok(transform.isClean(after.template), 'falta o script de modo apresentação');

    // Todos os slides continuam lá.
    const slidesBefore = (before.template.match(/<section/gi) || []).length;
    const slidesAfter = (after.template.match(/<section/gi) || []).length;
    assert.strictEqual(slidesAfter, slidesBefore, 'o número de <section> mudou');
  }
});

test('toCleanPresentation é idempotente', (t) => {
  if (!designDecks.length) return t.skip(SEM_EXEMPLOS);
  for (const file of designDecks) {
    const { template } = bundle.read(file);
    const once = transform.toCleanPresentation(template);
    assert.strictEqual(transform.toCleanPresentation(once), once);
  }
});

test('exportClean recusa um deck sem barra lateral', (t) => {
  const generic = decksIn(CODE);
  if (!generic.length) return t.skip('sem exemplo Claude Code');

  for (const file of generic) {
    const deck = bundle.read(file);
    assert.strictEqual(deck.kind, 'generic');
    const result = exportClean(file, path.join(tmp, 'nao-usado.html'));
    assert.strictEqual(result.ok, false);
    assert.match(result.reason, /ecrã inteiro/);
  }
});

test('freePath nunca devolve um caminho existente', () => {
  const base = 'colisao';
  const first = require('../src/core/export-clean').freePath(tmp, base, '.html');
  fs.writeFileSync(first, 'x');
  const second = require('../src/core/export-clean').freePath(tmp, base, '.html');
  assert.notStrictEqual(second, first);
  assert.ok(!fs.existsSync(second));
});
