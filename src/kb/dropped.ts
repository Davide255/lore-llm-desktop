// Files and folders handed over by the browser (drop or picker) as `UploadFile`s.
// Only what the server stores is read into memory: a dropped folder can hold gigabytes of other things.

import type { UploadFile } from './types';

const TYPES = new Set(['md', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf']);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NOTE_BYTES = 1024 * 1024;
/** A tree bigger than this is cut short; the upload itself takes at most 500 of it. */
const MAX_WALK = 5000;

const hidden = (name: string) => name.startsWith('.');

/** Reads one file, or says why it is left out. Hidden files in a folder are dropped without a word. */
async function take(file: File, dir?: string): Promise<UploadFile | null> {
  if (dir && (hidden(file.name) || dir.split('/').some(hidden))) return null;
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : '';
  let skip: string | undefined;
  if (!TYPES.has(ext)) skip = 'Tipo non supportato (ammessi: immagini PNG, JPG, GIF, WebP, SVG, PDF e note .md)';
  else if (file.size > (ext === 'md' ? MAX_NOTE_BYTES : MAX_BYTES)) skip = ext === 'md' ? 'Più grande di 1 MB' : 'Più grande di 10 MB';
  return { name: file.name, dir, skip, data: skip ? new ArrayBuffer(0) : await file.arrayBuffer() };
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

async function children(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  // readEntries hands over a batch at a time (100 in Chrome) until it returns an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return all;
    all.push(...batch);
  }
}

async function walk(entry: FileSystemEntry, dir: string | undefined, out: UploadFile[], budget: { left: number }) {
  if (budget.left <= 0 || hidden(entry.name)) return;
  if (entry.isFile) {
    budget.left--;
    const f = await take(await fileOf(entry as FileSystemFileEntry), dir);
    if (f) out.push(f);
  } else if (entry.isDirectory) {
    const here = dir ? `${dir}/${entry.name}` : entry.name;
    for (const child of await children(entry as FileSystemDirectoryEntry)) await walk(child, here, out, budget);
  }
}

/** What was dropped: plain files and folders (walked to the bottom). Call it inside the drop event. */
export function readDropped(data: DataTransfer): Promise<UploadFile[]> {
  // The entries must be taken now: the DataTransfer is emptied once the event handler returns.
  const entries = [...data.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.() ?? null);
  const plain = [...data.files];
  return (async () => {
    if (!entries.length || entries.some((e) => !e)) return (await Promise.all(plain.map((f) => take(f)))).filter((f): f is UploadFile => !!f);
    const out: UploadFile[] = [];
    const budget = { left: MAX_WALK };
    for (const e of entries) {
      if (e!.isFile) {
        const f = await take(await fileOf(e as FileSystemFileEntry));
        if (f) out.push(f);
      } else await walk(e!, undefined, out, budget);
    }
    return out;
  })();
}

/** The files of a folder chosen with `<input webkitdirectory>`: each knows its path inside it. */
export async function readPickedFolder(files: File[]): Promise<UploadFile[]> {
  const out: UploadFile[] = [];
  for (const f of files.slice(0, MAX_WALK)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const cut = rel.lastIndexOf('/');
    const t = await take(f, cut > 0 ? rel.slice(0, cut) : undefined);
    if (t) out.push(t);
  }
  return out;
}
