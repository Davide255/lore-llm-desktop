import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPickedFolder } from './dropped.ts';

/** A file picked with `<input webkitdirectory>`: it knows its path inside the folder. */
const picked = (rel: string, size = 3) => {
  const f = new File(['x'.repeat(size)], rel.slice(rel.lastIndexOf('/') + 1));
  Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
};

test('dropped or picked Office files (docx, xlsx, pptx) are read; doc, xls, ppt are left unread', async () => {
  const out = await readPickedFolder([
    picked('cartella/Relazione.docx'),
    picked('cartella/sub/Budget.XLSX'),
    picked('cartella/Deck.pptx'),
    picked('cartella/vecchio.doc'),
    picked('cartella/vecchio.xls'),
    picked('cartella/vecchio.ppt'),
    picked('cartella/.~lock.Relazione.docx#'),
  ]);
  assert.deepEqual(
    out.map((f) => [f.dir, f.name, f.skip ? 'skipped' : f.data.byteLength]),
    [
      ['cartella', 'Relazione.docx', 3],
      ['cartella/sub', 'Budget.XLSX', 3],
      ['cartella', 'Deck.pptx', 3],
      ['cartella', 'vecchio.doc', 'skipped'],
      ['cartella', 'vecchio.xls', 'skipped'],
      ['cartella', 'vecchio.ppt', 'skipped'],
    ],
  );
  assert.match(out[3].skip!, /DOCX, XLSX, PPTX/);
});

test('an Office file over 10 MB is left unread with the reason', async () => {
  const [f] = await readPickedFolder([picked('a/big.pptx', 10 * 1024 * 1024 + 1)]);
  assert.equal(f.skip, 'Più grande di 10 MB');
  assert.equal(f.data.byteLength, 0);
});
