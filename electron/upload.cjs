// Uploading files from the app: which ones the server takes and under what name.
// The Worker accepts attachments of these types up to 10 MB (vault.cjs holds the same limits).

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' };
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_PATH = 512;
const MAX_SEGMENT = 128;

const extOf = (name) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

/** What the user can pick: notes and the attachment types the server stores. */
const PICKER_EXTENSIONS = ['md', ...Object.keys(MIME)];

/** A file name the server accepts: no folders, no leading dots, no control characters. */
function cleanName(name) {
  const base = String(name).split(/[\\/]/).pop().replace(/[\u0000-\u001f:*?"<>|]/g, '').trim().replace(/^\.+/, '');
  return base;
}

/** `photo.png` taken -> `photo 2.png`, `photo 3.png`, … */
function uniqueName(dir, name, exists) {
  if (!exists(`${dir}/${name}`)) return name;
  const dot = name.lastIndexOf('.');
  const stem = name.slice(0, dot);
  const ext = name.slice(dot);
  for (let n = 2; ; n++) if (!exists(`${dir}/${stem} ${n}${ext}`)) return `${stem} ${n}${ext}`;
}

/**
 * Decides, for each `{ name, size }`, whether it goes up and where. `exists(rel)` says whether a
 * path is taken (also by files planned earlier in the same batch).
 * -> { ok: [{ index, name, rel }], skipped: [{ name, reason }] }
 */
function planUpload(dir, files, exists) {
  const taken = new Set();
  const isTaken = (rel) => taken.has(rel) || exists(rel);
  const ok = [];
  const skipped = [];
  files.forEach((f, index) => {
    const clean = cleanName(f.name);
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 ? extOf(clean) : '';
    const shown = f.name;
    if (!clean || dot < 1) return skipped.push({ name: shown, reason: 'Nome non valido' });
    if (ext !== 'md' && !MIME[ext]) return skipped.push({ name: shown, reason: 'Tipo non supportato (ammessi: immagini PNG, JPG, GIF, WebP, SVG, PDF e note .md)' });
    if (!(f.size > 0)) return skipped.push({ name: shown, reason: 'File vuoto' });
    if (f.size > (ext === 'md' ? MAX_NOTE_BYTES : MAX_BYTES)) return skipped.push({ name: shown, reason: ext === 'md' ? 'Più grande di 1 MB' : 'Più grande di 10 MB' });
    const name = uniqueName(dir, clean, isTaken);
    const rel = `${dir}/${name}`;
    if (name.length > MAX_SEGMENT || rel.length > MAX_PATH) return skipped.push({ name: shown, reason: 'Nome troppo lungo' });
    taken.add(rel);
    ok.push({ index, name, rel });
  });
  return { ok, skipped };
}

module.exports = { MIME, MAX_BYTES, PICKER_EXTENSIONS, extOf, cleanName, uniqueName, planUpload };
