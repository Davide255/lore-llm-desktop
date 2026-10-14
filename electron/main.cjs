// Electron main process: owns the window, the login and every call to the
// lore-llm Worker. The knowledge base lives in the user's cloud space (R2,
// behind the Worker); the renderer (React Native via react-native-web) talks
// to it only through the IPC surface exposed in preload.cjs.
const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { structuredPatch } = require('diff');
const auth = require('./auth.cjs');
const { API_URL, request } = require('./api.cjs');
const { toAgent, toPatch, applyAudit, refOf } = require('./agents.cjs');

const isMac = process.platform === 'darwin';
const DEV_URL = process.env.LORE_DEV_URL;
// Isolated profile for tests/demos: LORE_USER_DATA=/tmp/profile npm start
if (process.env.LORE_USER_DATA) app.setPath('userData', process.env.LORE_USER_DATA);

// How often agent writes are looked for (one cheap audit query) while the window has focus.
const POLL_MS = 5000;

// ---------------------------------------------------------------------------
// Persistent app state (lives in userData). Activity, authorship and empty
// folders belong to the signed-in user and are reset when the user changes.
// ---------------------------------------------------------------------------
const statePath = () => path.join(app.getPath('userData'), 'lore-state.json');
// agentRefs: id -> { name, kind } for every agent ever seen, so revoked ones keep their identity.
let state = { userId: null, activity: [], authors: {}, folders: [], agentRefs: {}, prefs: {}, lastSeenActivity: 0, lastLogId: 0 };

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

function onUser(user) {
  primed = false;
  cache.clear();
  files = new Map();
  writers = new Map();
  if (user && user.id !== state.userId) {
    state = { ...state, userId: user.id, activity: [], authors: {}, folders: [], agentRefs: {}, lastSeenActivity: 0, lastLogId: 0 };
    saveState();
  }
}

// ---------------------------------------------------------------------------
// Paths — `Project/folder/file.md`, the same shape the Worker and agents use.
// The Worker validates everything again; this only gives early, local errors.
// ---------------------------------------------------------------------------
const isMd = (name) => name.toLowerCase().endsWith('.md');
const isIndex = (rel) => rel.split('/').length === 2 && rel.toLowerCase().endsWith('/index.md');
const under = (rel, prefix) => rel === prefix || rel.startsWith(prefix + '/');

function checkFilePath(rel) {
  if (!rel.includes('/')) throw new Error('I file devono stare dentro un progetto');
  if (!isMd(rel)) throw new Error('Sono ammessi solo file .md');
}

// ---------------------------------------------------------------------------
// Remote mirror: file listing + content cache (powers tree facts, search and
// activity diffs). Contents are refetched only when the etag changes.
// ---------------------------------------------------------------------------
const cache = new Map(); // rel -> { etag, content }
let files = new Map(); // rel -> { path, size, uploaded, etag }
let writers = new Map(); // rel -> id of the agent that last modified it (from the audit log)
let primed = false;

// How far back the audit log is read to attribute existing files.
const AUDIT_WINDOW = 200;

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

async function fetchFile(rel) {
  const f = await request('GET', '/v1/file', { query: { path: rel } });
  cache.set(rel, { etag: f.etag, content: f.content });
  files.set(rel, { path: rel, size: f.size, uploaded: f.uploaded, etag: f.etag });
  return f;
}

/** Re-list the space and pull changed contents. Returns what changed. */
async function sync() {
  const { files: list } = await request('GET', '/v1/files');
  const next = new Map(list.map((f) => [f.path, f]));
  const changes = [];
  const stale = list.filter((f) => cache.get(f.path)?.etag !== f.etag);
  await pool(stale, 6, async (f) => {
    const before = cache.get(f.path)?.content ?? null;
    try {
      const got = await request('GET', '/v1/file', { query: { path: f.path } });
      cache.set(f.path, { etag: got.etag, content: got.content });
      next.set(f.path, { path: f.path, size: got.size, uploaded: got.uploaded, etag: got.etag });
      changes.push({ rel: f.path, before, after: got.content });
    } catch {
      next.delete(f.path); // deleted between list and get
    }
  });
  for (const [rel, c] of cache) {
    if (!next.has(rel)) {
      cache.delete(rel);
      changes.push({ rel, before: c.content, after: null });
    }
  }
  files = next;
  return changes;
}

async function refreshAgents() {
  const agents = (await request('GET', '/v1/agents')).agents.map(toAgent);
  for (const a of agents) state.agentRefs[a.id] = { name: a.name, kind: a.kind };
  saveState();
  return agents;
}

const agentRef = (rel) => refOf(state.agentRefs, writers.get(rel));

async function ensurePrimed() {
  if (primed) return;
  await sync();
  const [{ items }] = await Promise.all([request('GET', '/v1/audit', { query: { limit: AUDIT_WINDOW } }), refreshAgents()]);
  writers = new Map();
  state.lastLogId = applyAudit(writers, items, 0);
  primed = true;
}

/** Sync after the app's own operations. Anything else that changed meanwhile was an agent. */
async function resync() {
  const changes = await sync();
  for (const ch of changes) {
    if (!isIndex(ch.rel) && state.authors[ch.rel] !== files.get(ch.rel)?.etag) {
      recordChange(ch.rel, ch.before, ch.after, 'agent', agentRef(ch.rel));
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------
function buildTree() {
  const root = new Map(); // name -> { dir: Map } | { file }
  const dirAt = (segs) => {
    let level = root;
    let rel = '';
    for (const s of segs) {
      rel = rel ? `${rel}/${s}` : s;
      if (!level.has(s) || !level.get(s).dir) level.set(s, { dir: new Map(), rel });
      level = level.get(s).dir;
    }
    return level;
  };
  for (const rel of state.folders) dirAt(rel.split('/'));
  for (const f of files.values()) {
    const segs = f.path.split('/');
    dirAt(segs.slice(0, -1)).set(segs[segs.length - 1], { file: f });
  }
  return toNodes(root);
}

function toNodes(level) {
  const out = [];
  for (const [name, entry] of level) {
    if (entry.dir) {
      const children = toNodes(entry.dir);
      out.push({ kind: 'folder', name, path: entry.rel, mtime: Math.max(0, ...children.map((c) => c.mtime)), size: 0, children });
    } else {
      const f = entry.file;
      const author = authorOf(f.path);
      out.push({ kind: 'file', name, path: f.path, mtime: Date.parse(f.uploaded), size: f.size, author, agent: author === 'agent' ? agentRef(f.path) : undefined, ...fileMeta(name, cache.get(f.path)?.content) });
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

// A file is "yours" when the app wrote the version that is on the server now.
function authorOf(rel) {
  return state.authors[rel] && state.authors[rel] === files.get(rel)?.etag ? 'you' : 'agent';
}

function recordOwnWrite(rel, etag) {
  state.authors[rel] = etag;
  saveState();
}

function filesUnder(rel) {
  return [...files.keys()].filter((k) => under(k, rel));
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

function recordChange(rel, before, after, by, agent) {
  if (before === after) return;
  const kind = before == null ? 'created' : after == null ? 'deleted' : 'modified';
  const { added, removed, hunks } = diffStats(before, after);
  pushActivity({ path: rel, kind, by, ...(agent ? { agent } : {}), added, removed, hunks, before: before ?? null, after: after ?? null });
}

// ---------------------------------------------------------------------------
// Agent writes: poll the audit log (one row) and resync only when it moved.
// ---------------------------------------------------------------------------
let polling = false;
async function poll() {
  if (polling || !primed || !auth.user() || !win || win.isDestroyed() || !win.isFocused()) return;
  polling = true;
  try {
    const { items } = await request('GET', '/v1/audit', { query: { limit: 50 } });
    const top = items[0]?.log_id ?? 0;
    if (top === state.lastLogId) return;
    state.lastLogId = applyAudit(writers, items, state.lastLogId);
    // An agent created elsewhere (another device): learn its identity first.
    if (items.some((r) => !state.agentRefs[r.agent_id])) await refreshAgents().catch(() => {});
    saveState();
    const changes = await resync();
    send('kb:changed', { paths: changes.map((c) => c.rel), external: changes.some((c) => !isIndex(c.rel)) });
  } catch {
    /* offline or session gone: try again next tick */
  } finally {
    polling = false;
  }
}

// ---------------------------------------------------------------------------
// Pending deletes (undo window): contents are kept in memory and written
// back on undo. The server has no trash, so after the window it's gone.
// ---------------------------------------------------------------------------
const pendingDeletes = new Map(); // token -> { rel, folders, contents }

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
function search(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const [rel, { content }] of cache) {
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
// Agents (permissions live in the Worker's D1; tokens are shown once)
// ---------------------------------------------------------------------------
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

  // Coming back to the app: look for agent writes right away.
  win.on('focus', () => poll());

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

// `fresh`: re-list the server first (manual refresh) instead of using the mirror.
handle('kb:tree', async (fresh) => {
  if (primed && fresh) await resync();
  else await ensurePrimed();
  return buildTree();
});

handle('kb:read', async (rel) => {
  await ensurePrimed();
  const before = cache.get(rel)?.content ?? null;
  const f = await fetchFile(rel);
  // Opening a file is also a chance to notice an agent edit.
  if (before !== null && before !== f.content && state.authors[rel] !== f.etag) recordChange(rel, before, f.content, 'agent', agentRef(rel));
  const mtime = Date.parse(f.uploaded);
  const author = authorOf(rel);
  return { path: rel, content: f.content, mtime, size: f.size, birthtime: mtime, author, agent: author === 'agent' ? agentRef(rel) : undefined };
});

handle('kb:write', async (rel, content) => {
  const before = cache.get(rel)?.content ?? null;
  const res = await request('PUT', '/v1/file', {
    query: { path: rel },
    body: { content, overwrite: true, ...(cache.get(rel) ? { if_match: cache.get(rel).etag } : {}) },
  });
  cache.set(rel, { etag: res.file.etag, content });
  files.set(rel, res.file);
  recordOwnWrite(rel, res.file.etag);
  recordChange(rel, before, content, 'you');
  await resync();
  return true;
});

handle('kb:create', async (rel, content) => {
  checkFilePath(rel);
  const res = await request('PUT', '/v1/file', { query: { path: rel }, body: { content, overwrite: false } });
  cache.set(rel, { etag: res.file.etag, content });
  files.set(rel, res.file);
  recordOwnWrite(rel, res.file.etag);
  recordChange(rel, null, content, 'you');
  await resync();
  return true;
});

// Object storage has no empty folders: they live here until a file is put in them.
handle('kb:mkdir', async (rel) => {
  if (state.folders.includes(rel) || filesUnder(rel).length) throw new Error('Esiste già una cartella con questo nome');
  state.folders.push(rel);
  saveState();
  return true;
});

handle('kb:rename', async (fromRel, toRel) => {
  if (files.has(toRel) || filesUnder(toRel).length || state.folders.includes(toRel)) throw new Error('Esiste già un elemento con questo nome');
  const moved = files.has(fromRel) ? [fromRel] : filesUnder(fromRel);
  const mine = new Set(moved.filter((k) => authorOf(k) === 'you'));
  if (moved.length) await request('POST', '/v1/files/move', { body: { from: fromRel, to: toRel } });
  state.folders = state.folders.map((f) => (under(f, fromRel) ? toRel + f.slice(fromRel.length) : f));
  for (const k of moved) {
    const nk = toRel + k.slice(fromRel.length);
    // Carry content over so the move doesn't look like an agent edit.
    if (cache.has(k)) cache.set(nk, cache.get(k));
    cache.delete(k);
    delete state.authors[k];
  }
  await sync();
  for (const k of mine) {
    const nk = toRel + k.slice(fromRel.length);
    if (files.has(nk)) state.authors[nk] = files.get(nk).etag;
  }
  saveState();
  return true;
});

handle('kb:duplicate', async (rel) => {
  const dot = rel.toLowerCase().lastIndexOf('.md');
  const base = rel.slice(0, dot);
  let n = 1;
  let target;
  do {
    target = `${base} copia${n > 1 ? ' ' + n : ''}.md`;
    n++;
  } while (files.has(target));
  const content = cache.get(rel)?.content ?? (await fetchFile(rel)).content;
  const res = await request('PUT', '/v1/file', { query: { path: target }, body: { content, overwrite: false } });
  cache.set(target, { etag: res.file.etag, content });
  files.set(target, res.file);
  recordOwnWrite(target, res.file.etag);
  recordChange(target, null, content, 'you');
  await resync();
  return target;
});

// Delete = keep the contents in memory, remove on the server; undo writes them back.
handle('kb:delete', async (rel) => {
  const isFile = files.has(rel);
  const affected = isFile ? [rel] : filesUnder(rel);
  const contents = Object.fromEntries(affected.filter((k) => !isIndex(k)).map((k) => [k, cache.get(k)?.content ?? '']));
  const folders = isFile ? [] : [...new Set([...state.folders.filter((f) => under(f, rel)), rel])];
  if (isFile) await request('DELETE', '/v1/file', { query: { path: rel } });
  else if (affected.length) await request('DELETE', '/v1/folder', { query: { path: rel } });
  state.folders = state.folders.filter((f) => !under(f, rel));
  for (const k of affected) {
    const before = cache.get(k)?.content ?? null;
    cache.delete(k);
    files.delete(k);
    delete state.authors[k];
    if (!isIndex(k)) recordChange(k, before, null, 'you');
  }
  saveState();
  await resync();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingDeletes.set(token, { rel, folders, contents });
  setTimeout(() => pendingDeletes.delete(token), 60_000);
  return token;
});

handle('kb:undoDelete', async (token) => {
  const d = pendingDeletes.get(token);
  if (!d) return false;
  pendingDeletes.delete(token);
  if (files.has(d.rel) || filesUnder(d.rel).length) throw new Error('Un elemento con lo stesso nome è stato ricreato');
  for (const [k, content] of Object.entries(d.contents)) {
    const res = await request('PUT', '/v1/file', { query: { path: k }, body: { content, overwrite: false } });
    cache.set(k, { etag: res.file.etag, content });
    files.set(k, res.file);
    recordOwnWrite(k, res.file.etag);
    recordChange(k, null, content, 'you');
  }
  // Empty folders come back as local folders.
  for (const f of d.folders) if (!filesUnder(f).length && !state.folders.includes(f)) state.folders.push(f);
  saveState();
  await resync();
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

handle('agents:list', () => refreshAgents());
handle('agents:create', async ({ kind, name, permission, scope, days }) => {
  const res = await request('POST', '/v1/agents', {
    body: { name, ...toPatch({ kind, permission, scope }), ...(days ? { expires_in_days: days } : {}) },
  });
  const agent = toAgent(res.agent);
  state.agentRefs[agent.id] = { name: agent.name, kind: agent.kind };
  saveState();
  return { agent, token: res.token, expiresAt: Date.parse(res.expires_at), mcpUrl: `${API_URL}/mcp` };
});
handle('agents:update', async (id, patch) => {
  await request('PATCH', `/v1/agents/${encodeURIComponent(id)}`, { body: toPatch(patch) });
  const ref = state.agentRefs[id];
  if (ref) state.agentRefs[id] = { name: patch.name ?? ref.name, kind: patch.kind ?? ref.kind };
  saveState();
  return true;
});
handle('agents:delete', async (id) => {
  await request('DELETE', `/v1/agents/${encodeURIComponent(id)}`);
  return true;
});
handle('audit:list', async (opts = {}) => {
  const { items, next_before } = await request('GET', '/v1/audit', { query: { limit: opts.limit ?? 50, before: opts.before } });
  return {
    items: items.map((r) => ({ id: r.log_id, at: Date.parse(r.timestamp), agent: refOf(state.agentRefs, r.agent_id), action: r.action, path: r.target_path })),
    nextBefore: next_before,
  };
});

handle('app:server', () => new URL(API_URL).host);
handle('app:prefs', () => state.prefs);
handle('app:setPrefs', (prefs) => {
  state.prefs = { ...state.prefs, ...prefs };
  saveState();
  return state.prefs;
});
handle('app:copy', (text) => clipboard.writeText(text));
handle('app:platform', () => process.platform);
handle('app:confirmClose', () => {
  allowClose = true;
  win?.close();
});

handle('auth:user', () => auth.user());
handle('auth:signIn', async () => {
  const u = await auth.signIn();
  // The browser had focus during login; bring the app back.
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  return u;
});
handle('auth:cancelSignIn', () => auth.cancelSignIn());
handle('auth:signOut', () => auth.signOut());

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  loadState();
  auth.init((u) => {
    onUser(u);
    send('auth:changed', u);
  });
  onUser(auth.user());
  setInterval(poll, POLL_MS);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
