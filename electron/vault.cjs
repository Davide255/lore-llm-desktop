// Local vault: a folder on disk kept in two-way sync with the cloud space, so
// any editor (Obsidian first of all) can work on the knowledge base as plain
// files. The cloud stays the source of truth; this module mirrors it to disk,
// pushes local edits back with etag preconditions, and three-way merges when
// both sides changed.
//
// Layout of the pieces (no Electron imports: tested with plain node):
//   classify()  which local paths sync, which are read-only, which are skipped
//   scanVault() what is on disk (hashing only files whose size/mtime moved)
//   planSync()  pure: manifest (last synced state) + remote + local -> actions
//   VaultSync   the engine: watcher, serial queue, executor, manifest, status
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { merge3 } = require('./merge.cjs');

// The Worker's rules (lore-llm/src/storage/paths.ts, store.ts), checked early.
const ATTACHMENT_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf']);
const MAX_NOTE = 1024 * 1024;
const MAX_ATTACHMENT = 10 * 1024 * 1024;
const MAX_PATH = 512;
const MAX_SEGMENT = 128;
const PROJECT_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{0,63}$/u;
// OS and editor droppings that never sync.
const JUNK_RE = /^(thumbs\.db|desktop\.ini|~\$.*|.*\.(tmp|temp|swp|swx|crdownload|part|bak))$/i;

// Above this many cloud deletions in one pass, ask first (e.g. the folder was emptied by mistake).
const MASS_DELETE_COUNT = 20;
const MASS_DELETE_RATIO = 0.3;
const MAX_RETRIES = 3;

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const under = (rel, prefix) => rel === prefix || rel.startsWith(prefix + '/');
const parentOf = (rel) => rel.slice(0, Math.max(0, rel.lastIndexOf('/')));

function kindOf(rel) {
  const name = rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
  if (name.endsWith('.md') && name !== '.md') return 'md';
  const dot = name.lastIndexOf('.');
  return dot > 0 && ATTACHMENT_EXT.has(name.slice(dot + 1)) ? 'bin' : null;
}

const isIndexRel = (rel) => rel.split('/').length === 2 && rel.toLowerCase().endsWith('/index.md');

const REASONS = {
  root: 'Fuori da un progetto: spostalo in una cartella',
  type: 'Tipo di file non sincronizzato (solo note .md e immagini/PDF)',
  size: 'File troppo grande (max 1 MB per le note, 10 MB per gli allegati)',
  name: 'Nome troppo lungo',
  project: 'Nome del progetto non valido',
  case: 'Esiste già un file con lo stesso nome (maiuscole/minuscole diverse)',
  index: 'index.md è generato automaticamente e non viene caricato',
};

/**
 * What to do with a local path. `{status: 'sync'|'readonly'|'ignore'|'unsynced', reason?}`.
 * Dot-segments (.obsidian, .trash, .lore-sync, .DS_Store) are invisible to sync.
 */
function classify(rel, size = 0) {
  const segs = rel.split('/');
  if (segs.some((s) => s.startsWith('.') || s === '') || JUNK_RE.test(segs[segs.length - 1])) return { status: 'ignore' };
  const kind = kindOf(rel);
  if (!kind) return { status: 'unsynced', reason: REASONS.type };
  if (segs.length < 2) return { status: 'unsynced', reason: REASONS.root };
  if (!PROJECT_RE.test(segs[0])) return { status: 'unsynced', reason: REASONS.project };
  if (rel.length > MAX_PATH || segs.some((s) => s.length > MAX_SEGMENT)) return { status: 'unsynced', reason: REASONS.name };
  if (size > (kind === 'md' ? MAX_NOTE : MAX_ATTACHMENT)) return { status: 'unsynced', reason: REASONS.size };
  if (isIndexRel(rel)) return { status: 'readonly' };
  return { status: 'sync' };
}

async function hashFile(abs) {
  return sha256(await fsp.readFile(abs));
}

/**
 * Walk the vault. `prev` is the manifest: files whose size and mtime still
 * match it keep their recorded hash, everything else is hashed again.
 * Returns `{ files: Map(rel -> {size, mtimeMs, kind, hash, readonly}), dirs: Set, unsynced: [] }`.
 */
async function scanVault(root, prev = {}) {
  const files = new Map();
  const dirs = new Set();
  const unsynced = [];
  async function walk(absDir, relDir) {
    let entries;
    try {
      entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch (err) {
      if (!relDir) throw err;
      return; // vanished while walking
    }
    for (const e of entries) {
      // macOS can hand back decomposed (NFD) names; the server stores NFC.
      const name = e.name.normalize('NFC');
      const rel = relDir ? `${relDir}/${name}` : name;
      if (name.startsWith('.') || JUNK_RE.test(name)) continue;
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) {
        dirs.add(rel);
        await walk(abs, rel);
        continue;
      }
      if (!e.isFile()) continue; // symlinks and specials stay local
      const st = await fsp.stat(abs).catch(() => null);
      if (!st) continue;
      const c = classify(rel, st.size);
      if (c.status === 'ignore') continue;
      if (c.status === 'unsynced') {
        unsynced.push({ path: rel, reason: c.reason });
        continue;
      }
      files.set(rel, { size: st.size, mtimeMs: st.mtimeMs, kind: kindOf(rel), readonly: c.status === 'readonly' });
    }
  }
  await walk(root, '');
  for (const [rel, f] of files) {
    const m = prev[rel];
    try {
      f.hash = m && m.size === f.size && m.mtimeMs === f.mtimeMs ? m.hash : await hashFile(path.join(root, ...rel.split('/')));
    } catch {
      files.delete(rel); // deleted while scanning: the next pass sees it gone
    }
  }
  return { files, dirs, unsynced };
}

/** Pairs a→b where a key is unique on both sides. */
function uniquePairs(fromList, toList, keyFrom, keyTo) {
  const count = (list, key) => {
    const m = new Map();
    for (const x of list) {
      const k = key(x);
      if (k !== undefined) m.set(k, m.has(k) ? null : x);
    }
    return m;
  };
  const a = count(fromList, keyFrom);
  const b = count(toList, keyTo);
  const pairs = [];
  for (const [k, from] of a) {
    const to = b.get(k);
    if (from !== null && to) pairs.push([from, to]);
  }
  return pairs;
}

/** `a/b/c.md` → `x/b/c.md`: the folders that were renamed, when the tail is the same. */
function folderOfMove(from, to) {
  const f = from.split('/');
  const t = to.split('/');
  let n = 0;
  while (n < f.length - 1 && n < t.length - 1 && f[f.length - 1 - n] === t[t.length - 1 - n]) n++;
  if (n === 0) return null;
  const fp = f.slice(0, f.length - n).join('/');
  const tp = t.slice(0, t.length - n).join('/');
  return fp && tp && fp !== tp ? { from: fp, to: tp } : null;
}

/**
 * Pure sync planner. Compares, per path, the last synced state (manifest) with
 * the cloud (remote) and the disk (local):
 *
 *   manifest[rel] = { etag, hash }   remote: Map(rel -> {etag, kind, hash?})   local: Map(rel -> {hash, kind, readonly})
 *
 * Renames are recognised first (same content under a new path) so they move
 * instead of being deleted and re-created. Returns a list of actions.
 */
function planSync({ manifest, remote, local, caseInsensitive = false, rejected = new Map() }) {
  const actions = [];
  const done = new Set();
  const M = manifest;

  // Moved in the cloud (Lore, mobile, another machine): same etag, new path; local copy untouched.
  const goneRemote = Object.keys(M).filter((r) => !isIndexRel(r) && !remote.has(r) && local.get(r)?.hash === M[r].hash);
  const newRemote = [...remote.keys()].filter((r) => !M[r] && !local.has(r) && !isIndexRel(r));
  for (const [from, to] of uniquePairs(goneRemote, newRemote, (r) => M[r].etag, (r) => remote.get(r).etag)) {
    actions.push({ type: 'moveLocal', from, to });
    done.add(from).add(to);
  }

  // Moved on disk (Obsidian rename/move): same bytes, new path; cloud copy untouched.
  const goneLocal = Object.keys(M).filter((r) => !isIndexRel(r) && !done.has(r) && !local.has(r) && remote.get(r)?.etag === M[r].etag);
  const newLocal = [...local.keys()].filter((r) => !M[r] && !remote.has(r) && !local.get(r).readonly && !done.has(r));
  const moves = uniquePairs(goneLocal, newLocal, (r) => M[r].hash, (r) => local.get(r).hash);
  // A whole folder renamed becomes one server move.
  const byFolder = new Map();
  for (const [from, to] of moves) {
    const f = folderOfMove(from, to);
    const key = f ? `${f.from}\0${f.to}` : `\0${from}`;
    if (!byFolder.has(key)) byFolder.set(key, { folder: f, pairs: [] });
    byFolder.get(key).pairs.push([from, to]);
  }
  for (const { folder, pairs } of byFolder.values()) {
    const whole =
      folder &&
      Object.keys(M).filter((r) => under(r, folder.from) && !isIndexRel(r)).every((r) => pairs.some(([f]) => f === r)) &&
      ![...remote.keys()].some((r) => under(r, folder.to));
    if (whole) actions.push({ type: 'moveRemote', from: folder.from, to: folder.to, pairs, folder: true });
    else for (const [from, to] of pairs) actions.push({ type: 'moveRemote', from, to, pairs: [[from, to]] });
    for (const [from, to] of pairs) done.add(from).add(to);
  }

  // On a case-insensitive disk two cloud paths differing only by case can't both exist.
  const taken = new Set(caseInsensitive ? [...local.keys(), ...Object.keys(M)].map((r) => r.toLowerCase()) : []);

  const all = new Set([...Object.keys(M), ...remote.keys(), ...local.keys()]);
  for (const rel of [...all].sort()) {
    if (done.has(rel)) continue;
    const m = M[rel];
    const r = remote.get(rel);
    const l = local.get(rel);
    const kind = (r ?? l ?? m).kind;

    if (isIndexRel(rel)) {
      // Generated by the server: the disk copy only ever follows the cloud.
      if (r) {
        if (!l || !m || m.etag !== r.etag || l.hash !== m.hash) actions.push({ type: 'pull', rel, kind, readonly: true });
      } else if (l) {
        actions.push(m ? { type: 'trashLocal', rel } : { type: 'unsynced', rel, reason: REASONS.index });
      } else if (m) actions.push({ type: 'forget', rel });
      continue;
    }

    const skip = (l && rejected.get(rel) === l.hash) || false; // the server refused this exact content
    if (!m) {
      if (l && !r) {
        if (!skip) actions.push({ type: 'push', rel, kind, create: true });
      } else if (r && !l) {
        if (caseInsensitive && taken.has(rel.toLowerCase())) actions.push({ type: 'unsynced', rel, reason: REASONS.case });
        else {
          taken.add(rel.toLowerCase());
          actions.push({ type: 'pull', rel, kind });
        }
      } else if (r && l) {
        actions.push(r.hash && r.hash === l.hash ? { type: 'adopt', rel, kind } : { type: 'merge', rel, kind });
      }
      continue;
    }
    const rChanged = r && r.etag !== m.etag;
    const lChanged = l && l.hash !== m.hash;
    if (r && l) {
      if (rChanged && lChanged) actions.push(r.hash && r.hash === l.hash ? { type: 'adopt', rel, kind } : { type: 'merge', rel, kind });
      else if (rChanged) actions.push({ type: 'pull', rel, kind });
      else if (lChanged && !skip) actions.push({ type: 'push', rel, kind });
    } else if (l) {
      // Deleted in the cloud: a local edit brings it back, otherwise it goes to the trash.
      if (lChanged) {
        if (!skip) actions.push({ type: 'push', rel, kind, create: true, resurrect: true });
      } else actions.push({ type: 'trashLocal', rel });
    } else if (r) {
      // Deleted on disk: a cloud edit wins and comes back, otherwise the cloud copy goes too.
      actions.push(rChanged ? { type: 'pull', rel, kind } : { type: 'deleteRemote', rel });
    } else actions.push({ type: 'forget', rel });
  }
  return actions;
}

/** `Progetto/note.md` → `Progetto/note (conflitto Claude 2026-10-14 15.30).md` */
function conflictName(rel, label, date, exists) {
  const dir = parentOf(rel);
  const name = rel.slice(dir.length ? dir.length + 1 : 0);
  const dot = name.lastIndexOf('.');
  const stem = name.slice(0, dot);
  const ext = name.slice(dot);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
  const safeLabel = String(label || 'cloud').replace(/[\\/:*?"<>|.]/g, ' ').trim().slice(0, 40) || 'cloud';
  for (let n = 1; ; n++) {
    const candidate = `${dir ? dir + '/' : ''}${stem} (conflitto ${safeLabel} ${stamp}${n > 1 ? ' ' + n : ''})${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

class Requeue extends Error {}

/**
 * The sync engine for one user and one folder.
 *
 * mirror: { snapshot(), sync(), readText(rel), readBlob(rel), putText(rel, text, opts), putBlob(rel, buf, opts), remove(rel), move(from, to) }
 * trash(abs): moves a file or folder to the OS trash (recoverable).
 * onEvent({type, ...}): pushed | deleted | moved | merged | conflict | changed | folders | status | confirm | notice
 */
class VaultSync {
  constructor({
    root,
    stateDir,
    userId,
    server,
    mirror,
    trash,
    onEvent = () => {},
    remoteLabel = () => 'cloud',
    caseInsensitive = process.platform !== 'linux',
    debounceMs = 1500,
    maxWaitMs = 10000,
    fullEveryMs = 10 * 60 * 1000,
    now = () => new Date(),
  }) {
    Object.assign(this, { root: path.resolve(root), stateDir, userId, server, mirror, trashFn: trash, onEvent, remoteLabel, caseInsensitive, debounceMs, maxWaitMs, fullEveryMs, now });
    this.manifest = { version: 1, root: this.root, userId, files: {} };
    this.queue = Promise.resolve();
    this.queued = false;
    this.running = false;
    this.stopped = true;
    this.timers = { debounce: null, kick: null, retry: null, full: null };
    this.firstEventAt = 0;
    this.retries = new Map(); // rel -> attempts after 409s
    this.rejected = new Map(); // rel -> hash the server refused (400), with its message
    this.rejectedReasons = new Map();
    this.decision = null; // answer to a mass-delete prompt
    this.state = { state: 'off', root: this.root, lastSyncAt: null, pending: 0, unsynced: [], conflicts: [], error: null, confirm: null };
    this.backoff = 0;
  }

  // -------------------------------------------------------------- lifecycle
  async start() {
    this.stopped = false;
    try {
      const st = await fsp.stat(this.root);
      if (!st.isDirectory()) throw new Error('not a directory');
    } catch {
      return this.setState('error', { error: `Cartella della copia locale non trovata: ${this.root}` });
    }
    if (!(await this.checkMarker())) return;
    await this.loadManifest();
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_ev, filename) => this.onFsEvent(filename));
      this.watcher.on('error', () => this.kick(1000));
    } catch {
      // Without a watcher the periodic pass still syncs, just later.
    }
    this.timers.full = setInterval(() => this.enqueue(), this.fullEveryMs);
    this.running = true;
    await this.enqueue();
  }

  stop() {
    this.stopped = true;
    this.running = false;
    this.watcher?.close();
    this.watcher = null;
    clearTimeout(this.timers.debounce);
    clearTimeout(this.timers.kick);
    clearTimeout(this.timers.retry);
    clearInterval(this.timers.full);
    this.setState('off');
  }

  /** Let pending work finish (sign-out, quit), bounded. */
  async flush({ timeoutMs = 5000 } = {}) {
    if (this.timers.debounce || this.timers.kick) {
      clearTimeout(this.timers.debounce);
      clearTimeout(this.timers.kick);
      this.timers.debounce = this.timers.kick = null;
      this.enqueue();
    }
    let timer;
    await Promise.race([this.queue, new Promise((r) => (timer = setTimeout(r, timeoutMs)))]);
    clearTimeout(timer);
  }

  /** The cloud side changed (poll, Lore UI): reconcile soon. */
  kick(delay = 200) {
    if (this.stopped) return;
    clearTimeout(this.timers.kick);
    this.timers.kick = setTimeout(() => {
      this.timers.kick = null;
      this.enqueue();
    }, delay);
  }

  syncNow() {
    this.backoff = 0;
    return this.enqueue();
  }

  /** Answer to a mass-delete prompt: 'delete' (propagate to the cloud) or 'restore' (download again). */
  confirm(answer) {
    this.decision = answer === 'delete' ? 'delete' : 'restore';
    this.state.confirm = null;
    return this.enqueue();
  }

  status() {
    return { ...this.state };
  }

  abs(rel) {
    const abs = path.resolve(this.root, ...rel.split('/'));
    if (!abs.startsWith(this.root + path.sep)) throw new Error('Percorso non valido');
    return abs;
  }

  // ------------------------------------------- local ops requested by Lore UI
  async mkdirLocal(rel) {
    if (this.running) await fsp.mkdir(this.abs(rel), { recursive: true });
  }

  /** Lore renamed/moved something in the cloud: move it on disk too, keeping Obsidian's tabs and history. */
  renameLocal(from, to) {
    if (!this.running) return Promise.resolve();
    return this.enqueue(async () => {
      const a = this.abs(from);
      const b = this.abs(to);
      if (!(await exists(a)) || (await exists(b))) return;
      await fsp.mkdir(path.dirname(b), { recursive: true });
      await fsp.rename(a, b);
      const snap = this.mirror.snapshot();
      for (const k of Object.keys(this.manifest.files).filter((k) => under(k, from))) {
        const nk = to + k.slice(from.length);
        this.manifest.files[nk] = { ...this.manifest.files[k], etag: snap.get(nk)?.etag ?? this.manifest.files[k].etag };
        delete this.manifest.files[k];
      }
      await this.pruneDirs(parentOf(from));
      await this.saveManifest();
    });
  }

  /** Lore deleted a folder in the cloud: send the local folder to the trash as a whole. */
  trashLocalFolder(rel) {
    if (!this.running) return Promise.resolve();
    return this.enqueue(async () => {
      const a = this.abs(rel);
      if (await exists(a)) await this.trash(a);
      for (const k of Object.keys(this.manifest.files)) if (under(k, rel)) delete this.manifest.files[k];
      await this.pruneDirs(parentOf(rel));
      await this.saveManifest();
    });
  }

  // ---------------------------------------------------------------- plumbing
  onFsEvent(filename) {
    if (filename) {
      const segs = String(filename).split(/[\\/]/);
      if (segs.some((s) => s.startsWith('.'))) return; // .obsidian, .lore-sync, .trash, .DS_Store
    }
    // Obsidian saves ~2 s after typing stops: wait for quiet, but never longer than maxWaitMs.
    const t = Date.now();
    if (!this.firstEventAt) this.firstEventAt = t;
    const wait = Math.max(0, Math.min(this.debounceMs, this.maxWaitMs - (t - this.firstEventAt)));
    clearTimeout(this.timers.debounce);
    this.timers.debounce = setTimeout(() => {
      this.timers.debounce = null;
      this.firstEventAt = 0;
      this.enqueue();
    }, wait);
  }

  /** Everything (scans, plans, writes) runs on one serial queue. */
  enqueue(task) {
    if (!task) {
      if (this.queued) return this.queue;
      this.queued = true;
      task = () => {
        this.queued = false;
        return this.reconcile();
      };
    }
    this.queue = this.queue.then(() => (this.stopped ? undefined : task())).catch((err) => this.setState('error', { error: String(err.message ?? err) }));
    return this.queue;
  }

  setState(state, extra = {}) {
    this.state = { ...this.state, state, ...(state === 'idle' ? { error: null } : {}), ...extra };
    this.onEvent({ type: 'status', status: this.status() });
  }

  emit(ev) {
    try {
      this.onEvent(ev);
    } catch {
      /* a listener failing must not break sync */
    }
  }

  async trash(abs) {
    try {
      await this.trashFn(abs);
    } catch {
      // No OS trash available: keep a copy inside the vault's hidden folder instead.
      const dest = path.join(this.root, '.lore-sync', 'trash', `${Date.now()}`, path.relative(this.root, abs));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(abs, dest);
    }
  }

  // ------------------------------------------------------- manifest & bases
  get manifestPath() {
    return path.join(this.stateDir, 'manifest.json');
  }

  async loadManifest() {
    try {
      const m = JSON.parse(await fsp.readFile(this.manifestPath, 'utf8'));
      // Another folder (or user) means a fresh start: the old state describes a different disk.
      if (m.version === 1 && m.root === this.root && m.userId === this.userId) this.manifest = m;
    } catch {
      /* first sync */
    }
  }

  async saveManifest() {
    await fsp.mkdir(this.stateDir, { recursive: true });
    const tmp = `${this.manifestPath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.manifest));
    await fsp.rename(tmp, this.manifestPath);
  }

  /** Last synced text of a note, content-addressed: the base of a three-way merge. */
  async storeBase(content) {
    const id = sha256(Buffer.from(content, 'utf8'));
    const p = path.join(this.stateDir, 'bases', id);
    if (!(await exists(p))) {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, content);
    }
    return id;
  }

  async readBase(id) {
    if (!id) return '';
    return fsp.readFile(path.join(this.stateDir, 'bases', id), 'utf8').catch(() => '');
  }

  async gcBases() {
    const dir = path.join(this.stateDir, 'bases');
    const keep = new Set(Object.values(this.manifest.files).map((f) => f.base).filter(Boolean));
    for (const name of await fsp.readdir(dir).catch(() => [])) if (!keep.has(name)) await fsp.rm(path.join(dir, name), { force: true });
  }

  /** `.lore-sync/vault.json` ties the folder to one account, so two KBs never mix. */
  async checkMarker() {
    const p = path.join(this.root, '.lore-sync', 'vault.json');
    try {
      const m = JSON.parse(await fsp.readFile(p, 'utf8'));
      if (m.userId !== this.userId || m.server !== this.server) {
        this.setState('error', { error: 'Questa cartella è la copia locale di un altro account o server: scegline un\'altra.' });
        return false;
      }
    } catch {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, JSON.stringify({ userId: this.userId, server: this.server, createdAt: this.now().toISOString() }, null, 2));
    }
    return true;
  }

  // ------------------------------------------------------------ disk access
  /** Atomic write (tmp + rename) so Obsidian never reads half a file. */
  async writeLocal(rel, data, { readonly = false } = {}) {
    const abs = this.abs(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = path.join(this.root, '.lore-sync', 'tmp', `${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
    await fsp.mkdir(path.dirname(tmp), { recursive: true });
    await fsp.writeFile(tmp, data);
    await fsp.chmod(abs, 0o644).catch(() => {}); // Windows refuses to replace a read-only file
    await fsp.rename(tmp, abs);
    if (readonly) await fsp.chmod(abs, 0o444).catch(() => {});
    return fsp.stat(abs);
  }

  /** Read a file the plan saw; if it moved since the scan, the plan is stale. */
  async readLocal(rel, seen) {
    const abs = this.abs(rel);
    const buf = await fsp.readFile(abs).catch(() => null);
    const st = await fsp.stat(abs).catch(() => null);
    if (!buf || !st || st.size !== seen.size || st.mtimeMs !== seen.mtimeMs) throw new Requeue(rel);
    return buf;
  }

  async assertUnchanged(rel, seen) {
    const st = await fsp.stat(this.abs(rel)).catch(() => null);
    if (seen ? !st || st.size !== seen.size || st.mtimeMs !== seen.mtimeMs : st) throw new Requeue(rel);
  }

  /** Remove folders emptied by a sync (never the vault root). */
  async pruneDirs(rel) {
    while (rel) {
      try {
        await fsp.rmdir(this.abs(rel));
      } catch {
        return; // not empty (or already gone)
      }
      rel = parentOf(rel);
    }
  }

  // -------------------------------------------------------------- reconcile
  async reconcile() {
    if (this.stopped) return;
    if (!(await exists(this.root))) {
      // Never read a missing folder as "everything was deleted".
      return this.setState('error', { error: `Cartella della copia locale non trovata: ${this.root}` });
    }
    this.setState('syncing');
    const scan = await scanVault(this.root, this.manifest.files);
    const remote = this.mirror.snapshot();
    // A refused file stays refused until its content changes.
    for (const [rel, hash] of this.rejected) if (scan.files.get(rel)?.hash !== hash) this.rejected.delete(rel);
    let actions = planSync({ manifest: this.manifest.files, remote, local: scan.files, caseInsensitive: this.caseInsensitive, rejected: this.rejected });

    const unsynced = [...scan.unsynced];
    for (const [rel] of this.rejected) unsynced.push({ path: rel, reason: this.rejectedReasons.get(rel) ?? 'Rifiutato dal server' });
    for (const a of actions.filter((a) => a.type === 'unsynced')) unsynced.push({ path: a.rel, reason: a.reason });
    actions = actions.filter((a) => a.type !== 'unsynced');

    // Mass-delete guard: many files gone from disk at once is more often an accident than intent.
    const deletes = actions.filter((a) => a.type === 'deleteRemote');
    const tracked = Object.keys(this.manifest.files).length;
    let confirm = null;
    if (deletes.length > MASS_DELETE_COUNT || (tracked >= 10 && deletes.length / tracked > MASS_DELETE_RATIO)) {
      if (this.decision === 'restore') actions = actions.map((a) => (a.type === 'deleteRemote' ? { ...a, type: 'pull', kind: remote.get(a.rel)?.kind } : a));
      else if (this.decision !== 'delete') {
        confirm = { count: deletes.length, paths: deletes.slice(0, 8).map((a) => a.rel) };
        actions = actions.filter((a) => a.type !== 'deleteRemote');
      }
    }
    this.decision = null;

    const changed = new Set();
    let halt = null;
    let requeue = false;
    this.state.pending = actions.length;
    for (const a of actions) {
      if (this.stopped) return;
      try {
        await this.execute(a, scan, remote, changed);
        if (a.rel) this.retries.delete(a.rel);
      } catch (err) {
        if (err instanceof Requeue) {
          requeue = true;
        } else if (err.status === 401) {
          halt = { state: 'paused:auth', error: 'Sessione scaduta: accedi di nuovo per sincronizzare' };
          break;
        } else if (err.status === 0) {
          halt = { state: 'offline', error: 'Server non raggiungibile: le modifiche verranno caricate appena torna la rete' };
          break;
        } else if (err.status === 409 || (err.status === 400 && /esiste già/i.test(err.message) && a.create)) {
          // Someone wrote in the meantime: refresh and plan this path again (then it merges).
          const n = (this.retries.get(a.rel) ?? 0) + 1;
          this.retries.set(a.rel, n);
          if (n <= MAX_RETRIES) {
            await this.mirror.sync().catch(() => {});
            requeue = true;
          }
        } else if (err.status === 400 && a.rel) {
          const l = scan.files.get(a.rel);
          if (l) {
            this.rejected.set(a.rel, l.hash);
            this.rejectedReasons.set(a.rel, err.message);
            unsynced.push({ path: a.rel, reason: err.message });
          }
        } else {
          this.state.error = `${a.rel ?? a.from}: ${err.message ?? err}`;
        }
      }
      this.state.pending--;
    }

    // Empty folders on disk are Lore's local folders (object storage has none).
    const withFiles = new Set();
    for (const rel of [...scan.files.keys(), ...scan.unsynced.map((u) => u.path)]) for (let p = parentOf(rel); p; p = parentOf(p)) withFiles.add(p);
    this.emit({ type: 'folders', dirs: [...scan.dirs].filter((d) => !withFiles.has(d) && isDirSync(this.abs(d))) });

    await this.saveManifest();
    await this.gcBases();
    if (changed.size) this.emit({ type: 'changed', paths: [...changed] });

    this.state.unsynced = unsynced;
    this.state.pending = 0;
    if (halt) {
      this.setState(halt.state, { error: halt.error });
      // Offline: try again with backoff; auth: wait for the next sign-in.
      if (halt.state === 'offline') {
        this.backoff = Math.min(this.backoff ? this.backoff * 2 : 5000, 5 * 60 * 1000);
        clearTimeout(this.timers.retry);
        this.timers.retry = setTimeout(() => this.enqueue(), this.backoff);
      }
      return;
    }
    this.backoff = 0;
    if (confirm) {
      this.setState('paused:confirm', { confirm });
      this.emit({ type: 'confirm', ...confirm });
    } else this.setState('idle', { lastSyncAt: Date.now(), confirm: null });
    if (requeue) this.kick(500);
  }

  async execute(a, scan, remote, changed) {
    const M = this.manifest.files;
    const l = a.rel ? scan.files.get(a.rel) : null;
    const r = a.rel ? remote.get(a.rel) : null;
    switch (a.type) {
      case 'pull': {
        await this.assertUnchanged(a.rel, l);
        if (a.readonly && l && M[a.rel] && l.hash !== M[a.rel].hash) {
          this.emit({ type: 'notice', message: `${a.rel} è generato automaticamente: la modifica locale è stata annullata` });
        }
        if (a.kind === 'md') {
          const { content, etag } = await this.mirror.readText(a.rel);
          const buf = Buffer.from(content, 'utf8');
          const st = await this.writeLocal(a.rel, buf, { readonly: a.readonly });
          M[a.rel] = { etag, hash: sha256(buf), size: st.size, mtimeMs: st.mtimeMs, kind: 'md', base: a.readonly ? undefined : await this.storeBase(content) };
        } else {
          const { buffer, etag } = await this.mirror.readBlob(a.rel);
          const st = await this.writeLocal(a.rel, buffer);
          M[a.rel] = { etag: etag ?? r.etag, hash: sha256(buffer), size: st.size, mtimeMs: st.mtimeMs, kind: 'bin' };
        }
        return;
      }

      case 'push': {
        const buf = await this.readLocal(a.rel, l);
        const opts = { overwrite: !a.create, ifMatch: a.create ? undefined : M[a.rel].etag };
        if (a.kind === 'md') {
          const content = buf.toString('utf8');
          const before = a.create ? null : await this.readBase(M[a.rel]?.base);
          const file = await this.mirror.putText(a.rel, content, opts);
          M[a.rel] = { etag: file.etag, hash: l.hash, size: l.size, mtimeMs: l.mtimeMs, kind: 'md', base: await this.storeBase(content) };
          this.emit({ type: 'pushed', rel: a.rel, kind: 'md', before, after: content, etag: file.etag, resurrect: !!a.resurrect });
        } else {
          const file = await this.mirror.putBlob(a.rel, buf, opts);
          M[a.rel] = { etag: file.etag, hash: l.hash, size: l.size, mtimeMs: l.mtimeMs, kind: 'bin' };
          this.emit({ type: 'pushed', rel: a.rel, kind: 'bin', etag: file.etag, created: !!a.create });
        }
        changed.add(a.rel);
        return;
      }

      case 'adopt': {
        // Same content on both sides already: just remember it as synced.
        const base = a.kind === 'md' ? await this.storeBase((await this.readLocal(a.rel, l)).toString('utf8')) : undefined;
        M[a.rel] = { etag: r.etag, hash: l.hash, size: l.size, mtimeMs: l.mtimeMs, kind: a.kind, base };
        return;
      }

      case 'merge':
        return a.kind === 'md' ? this.mergeNote(a, l, changed) : this.mergeBinary(a, l, changed);

      case 'trashLocal': {
        await this.assertUnchanged(a.rel, l);
        await this.trash(this.abs(a.rel));
        delete M[a.rel];
        await this.pruneDirs(parentOf(a.rel));
        return;
      }

      case 'deleteRemote': {
        const before = M[a.rel]?.kind === 'md' ? await this.readBase(M[a.rel].base) : null;
        await this.mirror.remove(a.rel);
        delete M[a.rel];
        this.emit({ type: 'deleted', rel: a.rel, before });
        changed.add(a.rel);
        return;
      }

      case 'forget':
        delete M[a.rel];
        return;

      case 'moveRemote': {
        await this.mirror.move(a.from, a.to);
        const snap = this.mirror.snapshot();
        for (const [from, to] of a.pairs) {
          const seen = scan.files.get(to);
          M[to] = { ...M[from], etag: snap.get(to)?.etag ?? M[from].etag, size: seen.size, mtimeMs: seen.mtimeMs };
          delete M[from];
          this.emit({ type: 'moved', from, to, etag: M[to].etag });
          changed.add(from).add(to);
        }
        return;
      }

      case 'moveLocal': {
        const src = this.abs(a.from);
        const dest = this.abs(a.to);
        if (await exists(dest)) throw new Requeue(a.to);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.rename(src, dest);
        const st = await fsp.stat(dest);
        M[a.to] = { ...M[a.from], etag: remote.get(a.to).etag, size: st.size, mtimeMs: st.mtimeMs };
        delete M[a.from];
        await this.pruneDirs(parentOf(a.from));
        return;
      }

      default:
        throw new Error(`Unknown action ${a.type}`);
    }
  }

  async mergeNote(a, l, changed) {
    const M = this.manifest.files;
    const buf = await this.readLocal(a.rel, l);
    const local = buf.toString('utf8');
    const base = await this.readBase(M[a.rel]?.base);
    const remote = await this.mirror.readText(a.rel);
    const result = merge3(base, local, remote.content);
    let copy = null;
    if (!result.clean) {
      // Overlapping edits: the cloud version is kept beside the file, nothing is lost.
      const snap = this.mirror.snapshot();
      copy = conflictName(a.rel, this.remoteLabel(a.rel), this.now(), (p) => snap.has(p) || fs.existsSync(this.abs(p)));
      const file = await this.mirror.putText(copy, remote.content, { overwrite: false });
      const st = await this.writeLocal(copy, Buffer.from(remote.content, 'utf8'));
      M[copy] = { etag: file.etag, hash: sha256(Buffer.from(remote.content, 'utf8')), size: st.size, mtimeMs: st.mtimeMs, kind: 'md', base: await this.storeBase(remote.content) };
      changed.add(copy);
    }
    let etag = remote.etag;
    if (result.text !== remote.content) {
      const file = await this.mirror.putText(a.rel, result.text, { overwrite: true, ifMatch: remote.etag });
      etag = file.etag;
      changed.add(a.rel);
    }
    const out = Buffer.from(result.text, 'utf8');
    let st = l;
    if (result.text !== local) {
      await this.assertUnchanged(a.rel, l);
      st = await this.writeLocal(a.rel, out);
    }
    M[a.rel] = { etag, hash: sha256(out), size: st.size, mtimeMs: st.mtimeMs, kind: 'md', base: await this.storeBase(result.text) };
    if (copy) this.noteConflict(a.rel, copy);
    this.emit({ type: copy ? 'conflict' : 'merged', rel: a.rel, copy, before: remote.content, after: result.text, etag });
  }

  noteConflict(rel, copy) {
    this.state.conflicts = [{ path: rel, copy, at: Date.now() }, ...this.state.conflicts.filter((c) => c.copy !== copy)].slice(0, 20);
  }

  async mergeBinary(a, l, changed) {
    const M = this.manifest.files;
    const buf = await this.readLocal(a.rel, l);
    const remote = await this.mirror.readBlob(a.rel);
    if (sha256(remote.buffer) === l.hash) {
      M[a.rel] = { etag: remote.etag, hash: l.hash, size: l.size, mtimeMs: l.mtimeMs, kind: 'bin' };
      return;
    }
    // Images can't be merged: keep the local one, save the cloud one beside it.
    const snap = this.mirror.snapshot();
    const copy = conflictName(a.rel, this.remoteLabel(a.rel), this.now(), (p) => snap.has(p) || fs.existsSync(this.abs(p)));
    const copyFile = await this.mirror.putBlob(copy, remote.buffer, { overwrite: false });
    const st = await this.writeLocal(copy, remote.buffer);
    M[copy] = { etag: copyFile.etag, hash: sha256(remote.buffer), size: st.size, mtimeMs: st.mtimeMs, kind: 'bin' };
    const file = await this.mirror.putBlob(a.rel, buf, { overwrite: true, ifMatch: remote.etag });
    M[a.rel] = { etag: file.etag, hash: l.hash, size: l.size, mtimeMs: l.mtimeMs, kind: 'bin' };
    changed.add(a.rel).add(copy);
    this.noteConflict(a.rel, copy);
    this.emit({ type: 'conflict', rel: a.rel, copy, etag: file.etag });
  }
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function isDirSync(abs) {
  try {
    return fs.statSync(abs).isDirectory();
  } catch {
    return false;
  }
}

module.exports = { VaultSync, classify, scanVault, planSync, conflictName, kindOf, isIndexRel, REASONS };
