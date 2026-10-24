// Uploading files from the app: which ones the server takes and under what name.
// The Worker accepts attachments of these types up to 10 MB (vault.cjs holds the same limits).

const path = require('node:path');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' };
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_PATH = 512;
const MAX_SEGMENT = 128;
// One drop or pick of a folder goes up in one go; a bigger tree would take forever and fill the window with rows.
const MAX_FILES = 500;

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
 * Decides, for each `{ name, size, dir?, skip? }`, whether it goes up and where. `dir` is the folder
 * the file sits in inside a folder being uploaded ("photos/2024"), kept under the target folder.
 * `skip` is a reason already known (a type or size the sender refused to read). `exists(rel)` says
 * whether a path is taken (also by files planned earlier in the same batch).
 * -> { ok: [{ index, name, rel }], skipped: [{ name, reason }] }
 */
function planUpload(dir, files, exists) {
  const taken = new Set();
  const isTaken = (rel) => taken.has(rel) || exists(rel);
  const ok = [];
  const skipped = [];
  files.forEach((f, index) => {
    const shown = f.dir ? `${f.dir}/${f.name}` : f.name;
    const sub = f.dir ? String(f.dir).split(/[\\/]/).filter(Boolean) : [];
    // Hidden files and folders (.git, .DS_Store) are noise in a folder, not something to report.
    if (sub.some((s) => s.startsWith('.')) || (sub.length && String(f.name).startsWith('.'))) return;
    const folders = sub.map(cleanName);
    const clean = cleanName(f.name);
    const dot = clean.lastIndexOf('.');
    const ext = dot > 0 ? extOf(clean) : '';
    if (f.skip) return skipped.push({ name: shown, reason: f.skip });
    if (!clean || dot < 1 || folders.some((s) => !s)) return skipped.push({ name: shown, reason: 'Nome non valido' });
    if (ext !== 'md' && !MIME[ext]) return skipped.push({ name: shown, reason: 'Tipo non supportato (ammessi: immagini PNG, JPG, GIF, WebP, SVG, PDF e note .md)' });
    if (!(f.size > 0)) return skipped.push({ name: shown, reason: 'File vuoto' });
    if (f.size > (ext === 'md' ? MAX_NOTE_BYTES : MAX_BYTES)) return skipped.push({ name: shown, reason: ext === 'md' ? 'Più grande di 1 MB' : 'Più grande di 10 MB' });
    if (ok.length >= MAX_FILES) return skipped.push({ name: shown, reason: `Oltre il limite di ${MAX_FILES} file per caricamento` });
    const parent = [dir, ...folders].join('/');
    const name = uniqueName(parent, clean, isTaken);
    const rel = `${parent}/${name}`;
    if ([...folders, name].some((s) => s.length > MAX_SEGMENT) || rel.length > MAX_PATH) return skipped.push({ name: shown, reason: 'Nome troppo lungo' });
    taken.add(rel);
    ok.push({ index, name, rel });
  });
  return { ok, skipped };
}

/**
 * The files under a folder on disk as upload items, each with its `dir` inside the folder (the folder's
 * own name first). Hidden entries and links are left out; reading stops at MAX_WALK files.
 */
const MAX_WALK = 5000;
async function walkFolder(root, fsp) {
  const items = [];
  const visit = async (abs, rel) => {
    const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (items.length >= MAX_WALK) return;
      if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
      const child = path.join(abs, e.name);
      if (e.isDirectory()) await visit(child, `${rel}/${e.name}`);
      else if (e.isFile()) items.push({ name: e.name, dir: rel, size: (await fsp.stat(child).catch(() => null))?.size ?? 0, read: () => fsp.readFile(child) });
    }
  };
  const base = path.basename(root);
  await visit(root, base);
  return items;
}

module.exports = { walkFolder, MIME, MAX_BYTES, MAX_FILES, PICKER_EXTENSIONS, extOf, cleanName, uniqueName, planUpload };
