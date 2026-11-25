const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { planUpload, cleanName, uniqueName, walkFolder, openCopyPath, MIME, PICKER_EXTENSIONS } = require('./upload.cjs');

const none = () => false;

test('accepts images, pdf and notes', () => {
  const { ok, skipped } = planUpload('P/docs', [{ name: 'a.PNG', size: 10 }, { name: 'b.pdf', size: 10 }, { name: 'c.md', size: 10 }], none);
  assert.deepEqual(ok.map((o) => o.rel), ['P/docs/a.PNG', 'P/docs/b.pdf', 'P/docs/c.md']);
  assert.equal(skipped.length, 0);
});

test('accepts Word, Excel and PowerPoint (OOXML only) with their MIME types', () => {
  const { ok, skipped } = planUpload('P', [
    { name: 'Relazione.docx', size: 10 },
    { name: 'Budget.XLSX', size: 10 },
    { name: 'Deck.pptx', size: 10 * 1024 * 1024 },
    { name: 'old.doc', size: 10 },
    { name: 'old.xls', size: 10 },
    { name: 'old.ppt', size: 10 },
    { name: 'macro.docm', size: 10 },
    { name: 'huge.pptx', size: 10 * 1024 * 1024 + 1 },
  ], none);
  assert.deepEqual(ok.map((o) => o.rel), ['P/Relazione.docx', 'P/Budget.XLSX', 'P/Deck.pptx']);
  assert.deepEqual(skipped.map((s) => [s.name, s.reason]), [
    ['old.doc', 'Tipo non supportato (ammessi: note .md, immagini PNG, JPG, GIF, WebP, SVG, PDF e file Office DOCX, XLSX, PPTX)'],
    ['old.xls', 'Tipo non supportato (ammessi: note .md, immagini PNG, JPG, GIF, WebP, SVG, PDF e file Office DOCX, XLSX, PPTX)'],
    ['old.ppt', 'Tipo non supportato (ammessi: note .md, immagini PNG, JPG, GIF, WebP, SVG, PDF e file Office DOCX, XLSX, PPTX)'],
    ['macro.docm', 'Tipo non supportato (ammessi: note .md, immagini PNG, JPG, GIF, WebP, SVG, PDF e file Office DOCX, XLSX, PPTX)'],
    ['huge.pptx', 'Più grande di 10 MB'],
  ]);
  assert.equal(MIME.docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(MIME.xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(MIME.pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  for (const ext of ['docx', 'xlsx', 'pptx']) assert.ok(PICKER_EXTENSIONS.includes(ext), ext);
  for (const ext of ['doc', 'xls', 'ppt']) assert.ok(!PICKER_EXTENSIONS.includes(ext), ext);
});

test('a folder upload takes Office files too', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'lore-upload-office-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, 'docs'));
  await fsp.writeFile(path.join(root, 'docs', 'a.docx'), 'PK');
  await fsp.writeFile(path.join(root, 'docs', 'b.xls'), 'x');
  const items = await walkFolder(path.join(root, 'docs'), fsp);
  const { ok, skipped } = planUpload('P', items, none);
  assert.deepEqual(ok.map((o) => o.rel), ['P/docs/a.docx']);
  assert.deepEqual(skipped.map((s) => s.name), ['docs/b.xls']);
});

test('openCopyPath: one safe file name per attachment, inside the given folder', () => {
  const dir = path.join(os.tmpdir(), 'lore-attachments');
  const inside = (file) => path.dirname(path.dirname(file)) === dir;
  const name = (rel) => path.basename(openCopyPath(dir, rel));
  // The attachment's own name, in a folder of its own.
  const a = openCopyPath(dir, 'P/notes/Relazione finale.docx');
  assert.ok(inside(a));
  assert.equal(path.basename(a), 'Relazione finale.docx');
  assert.equal(openCopyPath(dir, 'P/notes/Relazione finale.docx'), a, 'stable for the same file');
  assert.notEqual(path.dirname(openCopyPath(dir, 'P/other/Relazione finale.docx')), path.dirname(a), 'same name elsewhere: another folder');
  // Never outside `dir`, whatever the path says.
  for (const rel of ['P/../../etc/passwd.xlsx', '../../x.pptx', 'P/a\\..\\..\\..\\evil.docx', '/abs/olute.docx', 'C:\\Windows\\x.docx', 'P/..docx', 'P/.. .pptx']) {
    const f = openCopyPath(dir, rel);
    assert.ok(f && inside(f), rel);
    assert.ok(!path.basename(f).startsWith('.'), rel);
  }
  assert.equal(name('P/../../etc/passwd.xlsx'), 'passwd.xlsx');
  assert.equal(name('P/..docx'), 'allegato.docx');
  // Characters and names Windows refuses; the extension is kept (lower case).
  assert.equal(name('P/scan: 1?*<>|".PDF'), 'scan 1.pdf');
  assert.equal(name('P/CON.docx'), '_CON.docx');
  assert.equal(name('P/lpt1.xlsx'), '_lpt1.xlsx');
  assert.equal(name('P/name. . .pptx'), 'name.pptx');
  const long = name(`P/${'x'.repeat(300)}.pptx`);
  assert.ok(long.length <= 120 && long.endsWith('.pptx'));
  // Only the types the server stores are ever handed to the system.
  for (const rel of ['P/setup.exe', 'P/run.bat', 'P/link.lnk', 'P/old.doc', 'P/noext', 'P/x.constructor', 'P/a.docx.', 'P/script.docx.js']) {
    assert.equal(openCopyPath(dir, rel), null, rel);
  }
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
