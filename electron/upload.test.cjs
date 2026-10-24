const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { planUpload, cleanName, uniqueName, walkFolder } = require('./upload.cjs');

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

test('files of a folder keep their subfolders under the target', () => {
  const exists = (rel) => rel === 'P/photos/2024/a.png';
  const { ok, skipped } = planUpload('P', [
    { name: 'a.png', dir: 'photos/2024', size: 1 },
    { name: 'b.pdf', dir: 'photos', size: 1 },
    { name: 'a.png', dir: 'photos/2024', size: 1 },
  ], exists);
  assert.deepEqual(ok.map((o) => o.rel), ['P/photos/2024/a 2.png', 'P/photos/b.pdf', 'P/photos/2024/a 3.png']);
  assert.equal(skipped.length, 0);
});

test('hidden files and folders inside a folder are ignored without a report', () => {
  const { ok, skipped } = planUpload('P', [
    { name: '.DS_Store', dir: 'f', size: 1 },
    { name: 'a.png', dir: 'f/.git', size: 1 },
    { name: 'a.png', dir: 'f', size: 1 },
  ], none);
  assert.deepEqual(ok.map((o) => o.rel), ['P/f/a.png']);
  assert.equal(skipped.length, 0);
});

test('skipped files of a folder are named with their path, and a known reason is kept', () => {
  const { ok, skipped } = planUpload('P', [
    { name: 'clip.mp4', dir: 'f/sub', size: 1 },
    { name: 'big.pdf', dir: 'f', size: 0, skip: 'Più grande di 10 MB' },
  ], none);
  assert.equal(ok.length, 0);
  assert.deepEqual(skipped.map((s) => s.name), ['f/sub/clip.mp4', 'f/big.pdf']);
  assert.equal(skipped[1].reason, 'Più grande di 10 MB');
});

test('one upload takes at most 500 files, the rest are reported', () => {
  const files = Array.from({ length: 503 }, (_, i) => ({ name: `n${i}.png`, dir: 'f', size: 1 }));
  const { ok, skipped } = planUpload('P', files, none);
  assert.equal(ok.length, 500);
  assert.equal(skipped.length, 3);
  assert.match(skipped[0].reason, /500/);
});

test('walkFolder lists a folder tree under its own name, without hidden entries or links', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-'));
  const top = path.join(root, 'album');
  try {
    await fsp.mkdir(path.join(top, 'sub', 'deep'), { recursive: true });
    await fsp.mkdir(path.join(top, '.git'));
    await fsp.writeFile(path.join(top, 'a.png'), 'aaa');
    await fsp.writeFile(path.join(top, '.DS_Store'), 'x');
    await fsp.writeFile(path.join(top, '.git', 'config.md'), 'x');
    await fsp.writeFile(path.join(top, 'sub', 'deep', 'n.md'), 'hello');
    await fsp.symlink(path.join(top, 'a.png'), path.join(top, 'link.png'));
    const items = await walkFolder(top, fsp);
    assert.deepEqual(items.map((i) => [i.dir, i.name, i.size]).sort(), [['album', 'a.png', 3], ['album/sub/deep', 'n.md', 5]]);
    assert.equal((await items[0].read()).length > 0, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
