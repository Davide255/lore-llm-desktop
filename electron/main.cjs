// Electron main process: owns the window and every filesystem operation on the
// knowledge base. The renderer (React Native via react-native-web) talks to it
// only through the IPC surface exposed in preload.cjs.
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { structuredPatch } = require('diff');

const isMac = process.platform === 'darwin';
const DEV_URL = process.env.LORE_DEV_URL;
// Isolated profile for tests/demos: LORE_USER_DATA=/tmp/profile npm start
if (process.env.LORE_USER_DATA) app.setPath('userData', process.env.LORE_USER_DATA);

// ---------------------------------------------------------------------------
// Persistent app state (lives in userData, never inside the shared KB)
// ---------------------------------------------------------------------------
const statePath = () => path.join(app.getPath('userData'), 'lore-state.json');
let state = { root: null, activity: [], authors: {}, prefs: {}, lastSeenActivity: 0 };

function loadState() {
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) };
  } catch {
    /* first run */
  }
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fsp.writeFile(statePath(), JSON.stringify(state, null, 2)).catch(() => {});
  }, 200);
}

// ---------------------------------------------------------------------------
// Path helpers — every renderer-supplied path is relative to the KB root and
// is resolved + checked so nothing can escape it.
// ---------------------------------------------------------------------------
const toPosix = (p) => p.split(path.sep).join('/');

function abs(rel) {
  if (!state.root) throw new Error('Nessuna knowledge base selezionata');
  const full = path.resolve(state.root, rel || '.');
  const rootResolved = path.resolve(state.root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    throw new Error('Percorso fuori dalla knowledge base');
  }
  return full;
}

const isHidden = (name) => name.startsWith('.') || name === 'node_modules';
const isMd = (name) => name.toLowerCase().endsWith('.md');

// ---------------------------------------------------------------------------
// Tree scan + content cache (the cache powers search and activity diffs)
// ---------------------------------------------------------------------------
const cache = new Map(); // rel path -> content

async function scanDir(rel) {
  const dir = abs(rel);
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    const st = await fsp.stat(path.join(dir, e.name)).catch(() => null);
    if (!st) continue;
    if (e.isDirectory()) {
      const children = await scanDir(childRel);
      out.push({
        kind: 'folder',
        name: e.name,
        path: childRel,
        mtime: Math.max(st.mtimeMs, ...children.map((c) => c.mtime)),
        size: 0,
        children,
      });
    } else if (isMd(e.name)) {
      if (!cache.has(childRel)) {
        cache.set(childRel, await fsp.readFile(path.join(dir, e.name), 'utf8').catch(() => ''));
      }
      out.push({ kind: 'file', name: e.name, path: childRel, mtime: st.mtimeMs, size: st.size, author: authorOf(childRel, st.mtimeMs), ...fileMeta(e.name, cache.get(childRel)) });
    }
  }
  const rank = (n) => (n.kind === 'file' && n.name.toLowerCase() === 'index.md' ? 0 : n.kind === 'file' && n.name.toLowerCase() === 'checklist.md' ? 1 : n.kind === 'folder' ? 2 : 3);
  out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
  return out;
}

// Cheap per-file facts the sidebar and project cards show without a read.
function fileMeta(name, content = '') {
  const n = name.toLowerCase();
  if (n === 'checklist.md') {
    let done = 0;
    let total = 0;
    for (const m of content.matchAll(/^[ \t]*[-*+] \[( |x|X)\]/gm)) {
      total++;
      if (m[1] !== ' ') done++;
    }
    return { done, total };
  }
  if (n === 'index.md') {
    // First prose paragraph: skip headings, italic banners, lists, quotes, code, tables.
    const para = content
      .split(/\r?\n\s*\r?\n/)
      .map((b) => b.trim())
      .find((b) => b && !/^(#|_|\*[^*]|-|\d+\.|\[|>|```|\|)/.test(b));
    return { summary: para ? para.replace(/\s+/g, ' ').replace(/[*_`]/g, '').slice(0, 160) : '' };
  }
  return {};
}

// A file is "yours" when the app wrote it last and nothing touched it since.
function authorOf(rel, mtime) {
  const a = state.authors[rel];
  if (a && Math.abs(a.mtime - mtime) < 5) return 'you';
  return 'agent';
}

async function recordOwnWrite(rel) {
  const st = await fsp.stat(abs(rel)).catch(() => null);
  if (st) state.authors[rel] = { mtime: st.mtimeMs };
  saveState();
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------
function pushActivity(ev) {
  state.activity.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), ...ev });
  state.activity = state.activity.slice(0, 300);
  saveState();
  send('kb:activity', state.activity[0]);
}

function diffStats(before, after) {
  const patch = structuredPatch('a', 'b', before ?? '', after ?? '', '', '', { context: 2 });
  let added = 0;
  let removed = 0;
  for (const h of patch.hunks) {
    for (const l of h.lines) {
      if (l[0] === '+') added++;
      else if (l[0] === '-') removed++;
    }
  }
  return { added, removed, hunks: patch.hunks };
}

function recordChange(rel, before, after, by) {
  if (before === after) return;
  const kind = before == null ? 'created' : after == null ? 'deleted' : 'modified';
  const { added, removed, hunks } = diffStats(before, after);
  pushActivity({ path: rel, kind, by, added, removed, hunks, before: before ?? null, after: after ?? null });
}

// Paths the app itself just wrote; watcher events for them are ignored.
const ownWrites = new Map();
const markOwn = (rel) => ownWrites.set(rel, Date.now());
const isOwn = (rel) => {
  const t = ownWrites.get(rel);
  return t != null && Date.now() - t < 3000;
};

// ---------------------------------------------------------------------------
// Watcher — external writes (agents) show up in Activity and refresh the UI
// ---------------------------------------------------------------------------
let watcher = null;
let pending = new Set();
let flushTimer = null;

function startWatcher() {
  watcher?.close();
  watcher = null;
  if (!state.root) return;
  try {
    watcher = fs.watch(state.root, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      const rel = toPosix(filename);
      if (rel !== '.lore/agents.json' && rel.split('/').some(isHidden)) return;
      pending.add(rel);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flushWatch, 250);
    });
  } catch (err) {
    console.error('watch failed', err);
  }
}

async function flushWatch() {
  const batch = [...pending];
  pending = new Set();
  const changed = [];
  let external = false;
  for (const rel of batch) {
    if (!isMd(rel)) {
      // Folder-level events: refresh the tree, but they aren't content edits.
      changed.push(rel);
      continue;
    }
    if (isOwn(rel)) continue;
    const before = cache.has(rel) ? cache.get(rel) : null;
    const after = await fsp.readFile(abs(rel), 'utf8').catch(() => null);
    if (after == null) cache.delete(rel);
    else cache.set(rel, after);
    if (before !== after) {
      recordChange(rel, before, after, 'agent');
      delete state.authors[rel];
      changed.push(rel);
      external = true;
    }
  }
  if (changed.length) send('kb:changed', { paths: changed, external });
}

// ---------------------------------------------------------------------------
// Pending deletes (undo window). The item is removed right away and its
// content kept in memory for undo; a copy is also handed to the OS trash in
// the background, so even a committed delete stays recoverable.
// ---------------------------------------------------------------------------
const pendingDeletes = new Map(); // token -> { rel, snapshot }

async function snapshot(full) {
  const st = await fsp.stat(full);
  if (st.isDirectory()) {
    const names = await fsp.readdir(full);
    const children = {};
    for (const n of names) children[n] = await snapshot(path.join(full, n));
    return { dir: true, children };
  }
  return { dir: false, data: await fsp.readFile(full) };
}

// Recreate the snapshot in a staging dir and move it to the OS trash.
async function trashCopy(name, snap) {
  try {
    const stage = path.join(app.getPath('userData'), 'deleted', `${Date.now()}`);
    const target = path.join(stage, name);
    await restore(target, snap);
    await shell.trashItem(target);
    await fsp.rm(stage, { recursive: true, force: true });
  } catch (err) {
    console.error('trash copy failed', err);
  }
}

async function restore(full, snap) {
  if (snap.dir) {
    await fsp.mkdir(full, { recursive: true });
    for (const [n, c] of Object.entries(snap.children)) await restore(path.join(full, n), c);
  } else {
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, snap.data);
  }
}

function cachedUnder(rel) {
  return [...cache.keys()].filter((k) => k === rel || k.startsWith(rel + '/'));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function search(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const [rel, content] of cache) {
    const lower = content.toLowerCase();
    const nameHit = rel.toLowerCase().includes(q);
    if (!lower.includes(q) && !nameHit) continue;
    const lines = content.split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const col = lines[i].toLowerCase().indexOf(q);
      if (col !== -1) hits.push({ line: i + 1, col, text: lines[i] });
    }
    results.push({ path: rel, nameHit, hits: hits.slice(0, 20), total: hits.length });
  }
  results.sort((a, b) => b.total + (b.nameHit ? 5 : 0) - (a.total + (a.nameHit ? 5 : 0)));
  return results.slice(0, 60);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let win = null;
let allowClose = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  allowClose = false;
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#121211',
    title: 'Lore LLM Desktop',
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 18, y: 16 } }
      : { titleBarOverlay: { color: '#141316', symbolColor: '#faf9f5', height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Links in rendered markdown open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  // Let the renderer veto closing when the editor has unsaved changes.
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    send('app:close-requested');
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

handle('kb:getRoot', () => state.root);
handle('kb:chooseRoot', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Scegli la cartella della knowledge base',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return state.root;
  state.root = res.filePaths[0];
  state.authors = {};
  cache.clear();
  saveState();
  startWatcher();
  return state.root;
});

handle('kb:tree', async () => {
  if (!state.root) return [];
  return scanDir('');
});

handle('kb:read', async (rel) => {
  const content = await fsp.readFile(abs(rel), 'utf8');
  cache.set(rel, content);
  const st = await fsp.stat(abs(rel));
  return { path: rel, content, mtime: st.mtimeMs, size: st.size, birthtime: st.birthtimeMs, author: authorOf(rel, st.mtimeMs) };
});

handle('kb:write', async (rel, content) => {
  const before = cache.has(rel) ? cache.get(rel) : await fsp.readFile(abs(rel), 'utf8').catch(() => null);
  markOwn(rel);
  await fsp.mkdir(path.dirname(abs(rel)), { recursive: true });
  await fsp.writeFile(abs(rel), content, 'utf8');
  cache.set(rel, content);
  await recordOwnWrite(rel);
  recordChange(rel, before, content, 'you');
  return true;
});

handle('kb:create', async (rel, content) => {
  const full = abs(rel);
  if (fs.existsSync(full)) throw new Error('Esiste già un file con questo nome');
  markOwn(rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, { encoding: 'utf8', flag: 'wx' });
  cache.set(rel, content);
  await recordOwnWrite(rel);
  recordChange(rel, null, content, 'you');
  return true;
});

handle('kb:mkdir', async (rel) => {
  const full = abs(rel);
  if (fs.existsSync(full)) throw new Error('Esiste già una cartella con questo nome');
  await fsp.mkdir(full, { recursive: true });
  return true;
});

handle('kb:rename', async (fromRel, toRel) => {
  const from = abs(fromRel);
  const to = abs(toRel);
  if (fs.existsSync(to)) throw new Error('Esiste già un elemento con questo nome');
  const moved = cachedUnder(fromRel);
  for (const k of moved) markOwn(k), markOwn(toRel + k.slice(fromRel.length));
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.rename(from, to);
  for (const k of moved) {
    const nk = toRel + k.slice(fromRel.length);
    cache.set(nk, cache.get(k));
    cache.delete(k);
    if (state.authors[k]) {
      state.authors[nk] = state.authors[k];
      delete state.authors[k];
    }
  }
  saveState();
  return true;
});

handle('kb:duplicate', async (rel) => {
  const full = abs(rel);
  const ext = path.extname(rel);
  const base = rel.slice(0, rel.length - ext.length);
  let n = 1;
  let target;
  do {
    target = `${base} copia${n > 1 ? ' ' + n : ''}${ext}`;
    n++;
  } while (fs.existsSync(abs(target)));
  const content = await fsp.readFile(full, 'utf8');
  markOwn(target);
  await fsp.writeFile(abs(target), content, 'utf8');
  cache.set(target, content);
  await recordOwnWrite(target);
  recordChange(target, null, content, 'you');
  return target;
});

// Delete = snapshot + remove now; undo restores the snapshot. After the undo
// window the snapshot is dropped (the item already sits in the OS trash).
handle('kb:delete', async (rel) => {
  const full = abs(rel);
  const snap = await snapshot(full);
  const affected = cachedUnder(rel);
  const before = Object.fromEntries(affected.map((k) => [k, cache.get(k)]));
  for (const k of affected) markOwn(k);
  await fsp.rm(full, { recursive: true, force: true });
  trashCopy(path.basename(full), snap);
  for (const k of affected) {
    cache.delete(k);
    delete state.authors[k];
    recordChange(k, before[k], null, 'you');
  }
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingDeletes.set(token, { rel, snap, before });
  setTimeout(() => pendingDeletes.delete(token), 60_000);
  return token;
});

handle('kb:undoDelete', async (token) => {
  const d = pendingDeletes.get(token);
  if (!d) return false;
  pendingDeletes.delete(token);
  const full = abs(d.rel);
  if (fs.existsSync(full)) throw new Error('Un elemento con lo stesso nome è stato ricreato');
  for (const k of Object.keys(d.before)) markOwn(k);
  await restore(full, d.snap);
  for (const [k, v] of Object.entries(d.before)) {
    cache.set(k, v);
    await recordOwnWrite(k);
    recordChange(k, null, v, 'you');
  }
  return true;
});

handle('kb:search', (q) => search(q));
handle('kb:activity', () => state.activity);
handle('kb:markActivitySeen', () => {
  state.lastSeenActivity = Date.now();
  saveState();
  return state.lastSeenActivity;
});
handle('kb:lastSeenActivity', () => state.lastSeenActivity || 0);

handle('kb:readMeta', async (name) => {
  try {
    return JSON.parse(await fsp.readFile(abs(`.lore/${name}`), 'utf8'));
  } catch {
    return null;
  }
});
handle('kb:writeMeta', async (name, data) => {
  await fsp.mkdir(abs('.lore'), { recursive: true });
  await fsp.writeFile(abs(`.lore/${name}`), JSON.stringify(data, null, 2), 'utf8');
  return true;
});

handle('app:prefs', () => state.prefs);
handle('app:setPrefs', (prefs) => {
  state.prefs = { ...state.prefs, ...prefs };
  saveState();
  return state.prefs;
});
handle('app:reveal', (rel) => shell.showItemInFolder(abs(rel)));
handle('app:copy', (text) => clipboard.writeText(text));
handle('app:absPath', (rel) => abs(rel));
handle('app:platform', () => process.platform);
handle('app:confirmClose', () => {
  allowClose = true;
  win?.close();
});

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  loadState();
  if (state.root && !fs.existsSync(state.root)) state.root = null;
  startWatcher();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
