const test = require('node:test');
const assert = require('node:assert/strict');
const { planUpload, cleanName, uniqueName } = require('./upload.cjs');

const none = () => false;

test('accepts images, pdf and notes', () => {
  const { ok, skipped } = planUpload('P/docs', [{ name: 'a.PNG', size: 10 }, { name: 'b.pdf', size: 10 }, { name: 'c.md', size: 10 }], none);
  assert.deepEqual(ok.map((o) => o.rel), ['P/docs/a.PNG', 'P/docs/b.pdf', 'P/docs/c.md']);
  assert.equal(skipped.length, 0);
});

test('refuses types the server does not store, empty and oversized files', () => {
  const { ok, skipped } = planUpload('P', [
    { name: 'clip.mp4', size: 10 },
    { name: 'noext', size: 10 },
    { name: 'empty.png', size: 0 },
    { name: 'big.pdf', size: 10 * 1024 * 1024 + 1 },
    { name: 'long.md', size: 1024 * 1024 + 1 },
  ], none);
  assert.equal(ok.length, 0);
  assert.deepEqual(skipped.map((s) => s.name), ['clip.mp4', 'noext', 'empty.png', 'big.pdf', 'long.md']);
});

test('a taken name gets a numeric suffix, also within one batch', () => {
  const exists = (rel) => rel === 'P/a.png';
  assert.equal(uniqueName('P', 'a.png', exists), 'a 2.png');
  const { ok } = planUpload('P', [{ name: 'a.png', size: 1 }, { name: 'a.png', size: 1 }], exists);
  assert.deepEqual(ok.map((o) => o.name), ['a 2.png', 'a 3.png']);
});

test('cleans path parts and forbidden characters', () => {
  assert.equal(cleanName('../../etc/photo.png'), 'photo.png');
  assert.equal(cleanName('C:\\Users\\me\\scan: 1?.pdf'), 'scan 1.pdf');
  assert.equal(cleanName('.hidden.png'), 'hidden.png');
});

test('names that are too long are skipped', () => {
  const { ok, skipped } = planUpload('P', [{ name: `${'x'.repeat(130)}.png`, size: 1 }], none);
  assert.equal(ok.length, 0);
  assert.equal(skipped[0].reason, 'Nome troppo lungo');
});
