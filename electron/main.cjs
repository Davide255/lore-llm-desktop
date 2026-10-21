// Electron main process: owns the window, the login and every call to the
// lore-llm Worker. The knowledge base lives in the user's cloud space (R2,
// behind the Worker); the renderer (React Native via react-native-web) talks
// to it only through the IPC surface exposed in preload.cjs. Optionally a
// local vault (vault.cjs) mirrors it to a folder that Obsidian edits.
const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, protocol, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { structuredPatch } = require('diff');
const auth = require('./auth.cjs');
const { API_URL, request, requestRaw } = require('./api.cjs');
const { toAgent, toPatch, applyAudit, refOf } = require('./agents.cjs');
const { createMirror } = require('./mirror.cjs');
const { scoped, teamOf, projectOf, checkProjectName, canWrite } = require('./spaces.cjs');
const { VaultSync, scanVault, planSync, folderNames, kindOf } = require('./vault.cjs');
const obsidian = require('./obsidian.cjs');
const { createOta } = require('./ota.cjs');
const otaConfig = require('./ota.config.json');

const isMac = process.platform === 'darwin';
// Mac App Store build: App Sandbox, so folders outside the container need the user's pick (and a bookmark).
const MAS = !!process.mas;
const DEV_URL = process.env.LORE_DEV_URL;
// Isolated profile for tests/demos: LORE_USER_DATA=/tmp/profile npm start
if (process.env.LORE_USER_DATA) app.setPath('userData', process.env.LORE_USER_DATA);

// One instance per profile: a second launch (e.g. a lore:// link) hands over to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Attachments are served to the renderer from lore-asset://kb/<path>.
protocol.registerSchemesAsPrivileged([{ scheme: 'lore-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

// How often the change cursor is checked: with the window focused, and in the
// background while the local vault is on (so Obsidian sees agent edits).
const POLL_MS = 5000;
const POLL_BACKGROUND_MS = 30_000;
// Servers without /v1/version: re-list now and then so other devices' edits reach the vault.
const LEGACY_LIST_MS = 60_000;

// ---------------------------------------------------------------------------
// Persistent app state (lives in userData). Activity, authorship and empty
// folders belong to the signed-in user and are reset when the user changes.
// ---------------------------------------------------------------------------
const statePath = () => path.join(app.getPath('userData'), 'lore-state.json');
// agentRefs: id -> { name, kind } for every agent ever seen, so revoked ones keep their identity.
// openProjects: keys of the projects opened lately, loaded again in the background at launch.
let state = { userId: null, activity: [], authors: {}, folders: [], agentRefs: {}, prefs: {}, lastSeenActivity: 0, lastLogId: 0, openProjects: [] };

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
  stopVault();
  releaseAccess();
  primed = false;
  lastInvites = null;
  mirror.reset();
  writers = new Map();
  if (user && user.id !== state.userId) {
    state = { ...state, userId: user.id, activity: [], authors: {}, folders: [], agentRefs: {}, lastSeenActivity: 0, lastLogId: 0, openProjects: [] };
    saveState();
  }
  if (user) startVault().catch(() => {});
}

// ---------------------------------------------------------------------------
// Paths — `Project/folder/file.md`, the same shape the Worker and agents use.
// A team's project is `Name@<teamId>` (spaces.cjs); the HTTP layer turns that
// into `?owner=t:<teamId>`. The Worker validates everything again; this only
// gives early, local errors.
// ---------------------------------------------------------------------------
const isMd = (name) => name.toLowerCase().endsWith('.md');
const isIndex = (rel) => rel.split('/').length === 2 && rel.toLowerCase().endsWith('/index.md');
const under = (rel, prefix) => rel === prefix || rel.startsWith(prefix + '/');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' };
const mimeOf = (rel) => MIME[rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()];

function checkFilePath(rel) {
  if (!rel.includes('/')) throw new Error('I file devono stare dentro un progetto');
  if (!isMd(rel)) throw new Error('Sono ammessi solo file .md');
}

const isKnownProject = (key) => mirror.summaries.has(key) || mirror.loaded.has(key);

/** A project that doesn't exist yet gets a name typed by the user: "@" is reserved for team projects. */
function checkNewProject(rel) {
  const key = projectOf(rel);
  if (!isKnownProject(key)) checkProjectName(key);
}

/** The signed-in user's role on a project: 'owner' in their own space, their team role otherwise. */
function accessOf(rel) {
  const key = projectOf(rel);
  return mirror.summaries.get(key)?.access ?? (teamOf(key) ? mirror.teams.find((t) => t.id === teamOf(key))?.role ?? 'viewer' : 'owner');
}

/** Viewers read only: refused here with a clear message (the Worker answers 403 anyway). */
function assertWritable(...rels) {
  for (const rel of rels) if (!canWrite(accessOf(rel))) throw new Error('Hai accesso in sola lettura a questo progetto');
}

/**
 * Before reading or changing anything in a project, have it mirrored: deleting or
 * renaming a project nobody opened must act on all of its files, not on none.
 */
async function ensureLoaded(...rels) {
  for (const rel of rels) if (isKnownProject(projectOf(rel))) await mirror.loadProject(projectOf(rel));
}

// ---------------------------------------------------------------------------
// Remote mirror (mirror.cjs): project summaries for every space, and listing +
// note contents of the projects that were opened, refetched on etag change.
// ---------------------------------------------------------------------------
const kbRequest = scoped(request);
const mirror = createMirror({ request: kbRequest, requestRaw: scoped(requestRaw) });
const cache = mirror.cache; // rel -> { etag, content }
let writers = new Map(); // rel -> id of the agent that last modified it (from the audit log)
let primed = false;

// How far back the audit log is read to attribute existing files.
const AUDIT_WINDOW = 200;

async function refreshAgents() {
  const agents = (await request('GET', '/v1/agents')).agents.map(toAgent);
  for (const a of agents) state.agentRefs[a.id] = { name: a.name, kind: a.kind };
  saveState();
  return agents;
}

const agentRef = (rel) => refOf(state.agentRefs, writers.get(rel));

// Launch reads one summary row per project (and each checklist), never the notes.
let priming = null;
async function ensurePrimed() {
  if (primed) return;
  priming ??= (async () => {
    await mirror.syncSummaries();
    const [{ items }] = await Promise.all([request('GET', '/v1/audit', { query: { limit: AUDIT_WINDOW } }), refreshAgents()]);
    writers = new Map();
    state.lastLogId = applyAudit(writers, items, 0);
    primed = true;
    warmOpenProjects();
  })().finally(() => (priming = null));
  await priming;
}

// The projects of the last working set load in the background, so they open instantly.
function warmOpenProjects() {
  const keys = state.openProjects.filter((k) => mirror.summaries.has(k) && !mirror.loaded.has(k));
  if (!keys.length) return;
  (async () => {
    for (const key of keys) await mirror.loadProject(key).catch(() => {});
    send('kb:changed', { paths: [], external: false });
  })();
}

function rememberOpen(key) {
  state.openProjects = [key, ...state.openProjects.filter((k) => k !== key)].slice(0, 12);
  saveState();
}

/** Loads every project (search across all of them), reporting progress to the window. */
let loadingAll = null;
function loadAllProjects() {
  loadingAll ??= (async () => {
    const keys = [...mirror.summaries.keys()].filter((k) => !mirror.loaded.has(k));
    let done = 0;
    send('kb:loadProgress', { done, total: keys.length });
    const queue = [...keys];
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) {
          await mirror.loadProject(queue.shift()).catch(() => {});
          send('kb:loadProgress', { done: ++done, total: keys.length });
        }
      }),
    );
  })().finally(() => (loadingAll = null));
  return loadingAll;
}

/**
 * Sync after the app's own operations. Anything else that changed meanwhile was
 * an agent, unless `agentPaths` (paths in new audit rows) says otherwise: then
 * the rest came from the user's other devices.
 */
async function resync({ agentPaths } = {}) {
  const changes = await mirror.sync();
  for (const ch of changes) {
    if (ch.attachment || isIndex(ch.rel) || state.authors[ch.rel] === mirror.files.get(ch.rel)?.etag) continue;
    // The server doesn't record who wrote a team file yet: anyone but this app is "a teammate".
    if (teamOf(ch.rel)) {
      recordChange(ch.rel, ch.before, ch.after, 'teammate');
      continue;
    }
    const byAgent = !agentPaths || agentPaths.has(ch.rel);
    recordChange(ch.rel, ch.before, ch.after, byAgent ? 'agent' : 'you', byAgent ? agentRef(ch.rel) : undefined, byAgent ? {} : { source: 'device' });
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
  for (const f of [...mirror.files.values(), ...mirror.attachments.values()]) {
    const segs = f.path.split('/');
    dirAt(segs.slice(0, -1)).set(segs[segs.length - 1], { file: f });
  }
  // Projects not opened yet: a node without children, carrying the summary.
  for (const key of mirror.summaries.keys()) dirAt([key]);
  return toNodes(root, true);
}

function toNodes(level, top = false) {
  const out = [];
  for (const [name, entry] of level) {
    if (entry.dir) {
      const children = toNodes(entry.dir);
      const node = { kind: 'folder', name, path: entry.rel, mtime: Math.max(0, ...children.map((c) => c.mtime)), size: 0, children };
      if (top) {
        node.project = projectMeta(name, children);
        node.name = node.project.name;
        if (!node.project.loaded) node.mtime = node.project.updatedAt;
      }
      out.push(node);
    } else if (!isMd(name)) {
      const f = entry.file;
      out.push({ kind: 'file', type: 'attachment', mime: mimeOf(f.path), name, path: f.path, mtime: Date.parse(f.uploaded), size: f.size, author: 'you' });
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

/** What a project card shows, whether the project is loaded or only summarised. */
function projectMeta(key, children) {
  const s = mirror.summaries.get(key);
  const loaded = !s || mirror.loaded.has(key);
  const count = (nodes) => nodes.reduce((n, c) => n + (c.kind === 'file' ? 1 : count(c.children)), 0);
  const text = mirror.checklistText(key);
  const checklist = text != null && (s?.checklist || mirror.files.has(`${key}/checklist.md`)) ? fileMeta('checklist.md', text) : null;
  const team = s?.team ?? null;
  return {
    key,
    name: s?.name ?? key.split('@')[0],
    loaded,
    team,
    access: accessOf(key),
    fileCount: loaded ? count(children) : s.file_count,
    updatedAt: Date.parse(s?.updated_at ?? '') || 0,
    checklist,
  };
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
// In a team's project anybody else is a teammate (agents can't reach team projects yet).
function authorOf(rel) {
  if (state.authors[rel] && state.authors[rel] === mirror.files.get(rel)?.etag) return 'you';
  return teamOf(rel) ? 'teammate' : 'agent';
}

function recordOwnWrite(rel, etag) {
  state.authors[rel] = etag;
  saveState();
}

function filesUnder(rel) {
  return mirror.paths().filter((k) => under(k, rel));
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

// `extra`: { source: 'obsidian' | 'device', note }
function recordChange(rel, before, after, by, agent, extra = {}) {
  if (before === after) return;
  const kind = before == null ? 'created' : after == null ? 'deleted' : 'modified';
  const { added, removed, hunks } = diffStats(before, after);
  pushActivity({ path: rel, kind, by, ...(agent ? { agent } : {}), ...extra, added, removed, hunks, before: before ?? null, after: after ?? null });
}

// ---------------------------------------------------------------------------
// Polling: one cheap read of the change cursor; re-list only when it moved.
// The audit log (agent writes) is read then, for attribution.
// ---------------------------------------------------------------------------
let polling = false;
let versionApi = true;
let lastPollAt = 0;
let lastListAt = 0;
let asleep = false;

async function poll({ force = false } = {}) {
  if (polling || !primed || !auth.user() || asleep) return;
  const focused = !!win && !win.isDestroyed() && win.isFocused();
  if (!focused && !vault?.running) return;
  if (!focused && !force && Date.now() - lastPollAt < POLL_BACKGROUND_MS) return;
  polling = true;
  lastPollAt = Date.now();
  try {
    // Invitations addressed to you show up while the window is in front (one request).
    if (focused) await myInvites().catch(() => {});
    if (versionApi) {
      try {
        // One request: the cursors of the user's own space and of each team.
        if (!(await mirror.changed())) return;
      } catch (err) {
        if (err.status !== 404) throw err;
        versionApi = false; // older server
      }
    }
    const { items } = await request('GET', '/v1/audit', { query: { limit: 50 } });
    const prev = state.lastLogId;
    const agentMoved = (items[0]?.log_id ?? 0) !== prev;
    if (agentMoved) {
      state.lastLogId = applyAudit(writers, items, prev);
      // An agent created elsewhere (another device): learn its identity first.
      if (items.some((r) => !state.agentRefs[r.agent_id])) await refreshAgents().catch(() => {});
      saveState();
    }
    if (!versionApi && !agentMoved && !(vault?.running && Date.now() - lastListAt > LEGACY_LIST_MS)) return;
    lastListAt = Date.now();
    const stamp = summaryStamp();
    const agentPaths = versionApi ? new Set(items.filter((r) => r.log_id > prev).map((r) => r.target_path)) : undefined;
    const changes = await resync({ agentPaths });
    await loadVaultProjects();
    vault?.kick();
    const notes = changes.filter((c) => !isIndex(c.rel));
    const source = notes.some((c) => !teamOf(c.rel) && (agentPaths?.has(c.rel) ?? true)) ? 'agent' : notes.some((c) => teamOf(c.rel)) ? 'teammate' : 'device';
    // A project that isn't open changed only its summary: the tree still refreshes.
    if (changes.length || stamp !== summaryStamp()) send('kb:changed', { paths: changes.map((c) => c.rel), external: notes.length > 0, source });
  } catch {
    /* offline or session gone: try again next tick */
  } finally {
    polling = false;
  }
}

const summaryStamp = () => JSON.stringify([...mirror.summaries.values()].map((s) => [s.key, s.updated_at, s.file_count, s.checklist?.etag, s.access, s.team?.name]));

// ---------------------------------------------------------------------------
// Pending deletes (undo window): contents are kept in memory and written
// back on undo. The server has no trash, so after the window it's gone.
// ---------------------------------------------------------------------------
const pendingDeletes = new Map(); // token -> { rel, folders, contents, blobs }

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

// Raw link targets per note ([[wikilinks]], embeds, markdown links); the renderer resolves them.
const LINK_RE = /!?\[\[([^\]\n]+)\]\]|\]\(\s*<([^>\n]+)>\s*\)|\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
function linkIndex() {
  const out = {};
  for (const [rel, { content }] of cache) {
    const targets = [];
    for (const m of content.matchAll(LINK_RE)) targets.push(m[1] !== undefined ? `[[${m[1]}]]` : (m[2] ?? m[3]));
    if (targets.length) out[rel] = targets;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Local vault (vault.cjs): a folder kept in sync with the cloud, for Obsidian.
// Per-user config and sync state live in userData/sync/<user id>/.
// ---------------------------------------------------------------------------
let vault = null;
let vaultStarting = null;
// Sandbox: access to the vault folder, held while the vault runs (from a security-scoped bookmark).
let releaseVaultAccess = null;
const pickedBookmarks = new Map(); // folder picked in this session -> bookmark (Mac App Store only)
const syncDir = (userId) => path.join(app.getPath('userData'), 'sync', userId);
// In the sandbox ~/Documents isn't reachable until the user picks a folder there.
const defaultVaultRoot = () => (MAS ? null : path.join(app.getPath('documents'), 'Lore LLM'));

/**
 * Which projects the local vault syncs: per-project opt-in, kept in the vault
 * config as `projects: { exclude: [personal keys], include: [team keys] }`.
 * The user's own projects are on unless switched off (new ones too); team
 * projects are off unless switched on.
 */
function vaultSelected(key, cfg = vaultConfig(auth.user()?.id)) {
  const p = cfg.projects ?? {};
  return teamOf(key) ? (p.include ?? []).includes(key) : !(p.exclude ?? []).includes(key);
}

/**
 * The vault's layout (vault.cjs): a project syncs when it is selected and its
 * files are mirrored, so a project still loading never reads as "deleted";
 * a project nobody listed yet (just made in Obsidian) is a new personal one.
 * Team projects sit in `Name (Team)` folders.
 */
function vaultLayout() {
  const names = () => {
    const list = [...mirror.summaries.values()].map((s) => ({ key: s.key, name: s.name, team: s.team }));
    // Projects only mirrored so far (renamed or created a moment ago) keep a stable folder too.
    for (const key of mirror.loaded) {
      if (mirror.summaries.has(key)) continue;
      const team = teamOf(key) ? mirror.teams.find((t) => t.id === teamOf(key)) : null;
      list.push({ key, name: key.split('@')[0], team: team ? { id: team.id, name: team.name } : null });
    }
    return folderNames(list);
  };
  let cache = { stamp: null, map: new Map(), rev: new Map() };
  const map = () => {
    const stamp = summaryStamp() + [...mirror.loaded].join('|');
    if (cache.stamp !== stamp) {
      const m = names();
      cache = { stamp, map: m, rev: new Map([...m].map(([k, f]) => [f, k])) };
    }
    return cache;
  };
  const covers = (key) => {
    if (!mirror.summaries.has(key) && !mirror.loaded.has(key)) return !teamOf(key) && vaultSelected(key);
    return vaultSelected(key) && mirror.loaded.has(key);
  };
  return {
    folderOf: (key) => map().map.get(key) ?? key,
    keyOf: (folder) => map().rev.get(folder) ?? folder,
    covers,
    readonly: (key) => !canWrite(accessOf(key)),
    folders: () => new Map([...map().map].filter(([key]) => covers(key))),
  };
}

/** The selected projects get loaded: the vault waits for them before they take part. */
async function loadVaultProjects() {
  const u = auth.user();
  if (!u || (!vault && !vaultStarting)) return;
  const cfg = vaultConfig(u.id);
  for (const key of mirror.summaries.keys()) if (vaultSelected(key, cfg) && !mirror.loaded.has(key)) await mirror.loadProject(key).catch(() => {});
}

/** The mirror as the vault sees it: after a refresh, newly selected or newly created projects load too. */
const vaultMirror = {
  snapshot: () => mirror.snapshot(),
  sync: async () => {
    await mirror.sync();
    await loadVaultProjects();
  },
  readText: (rel) => mirror.readText(rel),
  readBlob: (rel) => mirror.readBlob(rel),
  putText: (rel, content, opts) => mirror.putText(rel, content, opts),
  putBlob: (rel, buf, opts) => mirror.putBlob(rel, buf, opts),
  remove: (rel) => mirror.remove(rel),
  move: (from, to) => mirror.move(from, to),
};

function releaseAccess() {
  releaseVaultAccess?.();
  releaseVaultAccess = null;
}
const serverId = () => new URL(API_URL).host;

// Read on every scan (which projects sync): kept in memory, refreshed when saved.
let configCache = { userId: null, cfg: null };
function vaultConfig(userId) {
  if (!userId) return { enabled: false, root: null, linkFormat: 'markdown' };
  if (configCache.userId === userId) return configCache.cfg;
  let cfg;
  try {
    cfg = { linkFormat: 'markdown', ...JSON.parse(fs.readFileSync(path.join(syncDir(userId), 'config.json'), 'utf8')) };
  } catch {
    cfg = { enabled: false, root: null, linkFormat: 'markdown' };
  }
  configCache = { userId, cfg };
  return cfg;
}

async function saveVaultConfig(userId, cfg) {
  await fsp.mkdir(syncDir(userId), { recursive: true });
  await fsp.writeFile(path.join(syncDir(userId), 'config.json'), JSON.stringify(cfg, null, 2));
  configCache = { userId, cfg: { linkFormat: 'markdown', ...cfg } };
}

function vaultStatus() {
  const u = auth.user();
  const cfg = u ? vaultConfig(u.id) : { enabled: false, root: null, linkFormat: 'markdown' };
  const live = vault ? vault.status() : { state: 'off', pending: 0, lastSyncAt: null, unsynced: [], conflicts: [], error: null, confirm: null };
  return { ...live, enabled: !!cfg.enabled, root: cfg.root ?? null, defaultRoot: defaultVaultRoot(), linkFormat: cfg.linkFormat };
}

async function startVault() {
  if (vaultStarting) return vaultStarting;
  vaultStarting = (async () => {
    const u = auth.user();
    if (!u) return;
    const cfg = vaultConfig(u.id);
    stopVault();
    if (!cfg.enabled || !cfg.root) return;
    // Never plan against an empty mirror: it would read as "everything was deleted".
    await ensurePrimed();
    await loadVaultProjects();
    if (auth.user()?.id !== u.id) return;
    releaseAccess();
    if (MAS && cfg.bookmark) releaseVaultAccess = app.startAccessingSecurityScopedResource(cfg.bookmark);
    const layout = vaultLayout();
    vault = new VaultSync({
      root: cfg.root,
      stateDir: syncDir(u.id),
      userId: u.id,
      server: serverId(),
      mirror: vaultMirror,
      layout,
      trash: (abs) => shell.trashItem(abs),
      onEvent: onVaultEvent,
      remoteLabel: (rel) => (authorOf(rel) === 'agent' ? agentRef(rel)?.name ?? 'agente' : authorOf(rel) === 'teammate' ? 'collaboratore' : 'cloud'),
    });
    // Lore's local empty folders exist on disk too.
    if (fs.existsSync(cfg.root)) for (const f of state.folders) if (layout.covers(projectOf(f))) await fsp.mkdir(vault.abs(f), { recursive: true }).catch(() => {});
    await vault.start();
  })().finally(() => {
    vaultStarting = null;
    send('vault:status', vaultStatus());
  });
  return vaultStarting;
}

function stopVault() {
  vault?.stop();
  vault = null;
}

function onVaultEvent(ev) {
  switch (ev.type) {
    case 'status':
      send('vault:status', vaultStatus());
      break;
    case 'pushed':
      recordOwnWrite(ev.rel, ev.etag);
      if (ev.kind === 'md') recordChange(ev.rel, ev.before, ev.after, 'you', undefined, { source: 'obsidian', ...(ev.resurrect ? { note: 'Ricreato: era stato eliminato nel cloud mentre lo modificavi' } : {}) });
      break;
    case 'merged':
      recordOwnWrite(ev.rel, ev.etag);
      recordChange(ev.rel, ev.before, ev.after, 'you', undefined, { source: 'obsidian', note: 'Unione automatica con le modifiche arrivate dal cloud' });
      break;
    case 'conflict':
      recordOwnWrite(ev.rel, ev.etag);
      pushActivity({
        path: ev.rel,
        kind: 'conflict',
        by: 'you',
        source: 'obsidian',
        copy: ev.copy,
        note: `Hai modificato in Obsidian le stesse righe cambiate nel cloud. Il file tiene la tua versione; quella del cloud è in ${ev.copy}.`,
        ...diffStats(ev.before, ev.after),
        before: ev.before ?? null,
        after: ev.after ?? null,
      });
      send('vault:conflict', { path: ev.rel, copy: ev.copy });
      break;
    case 'deleted':
      delete state.authors[ev.rel];
      saveState();
      if (ev.before != null) recordChange(ev.rel, ev.before, null, 'you', undefined, { source: 'obsidian' });
      break;
    case 'moved':
      if (state.authors[ev.from]) state.authors[ev.to] = ev.etag;
      delete state.authors[ev.from];
      saveState();
      break;
    case 'changed':
      send('kb:changed', { paths: ev.paths, external: true, source: 'obsidian' });
      break;
    case 'folders': {
      // Empty folders of projects the vault doesn't cover stay as Lore knows them.
      const next = [...ev.dirs, ...state.folders.filter((f) => !ev.covered(f))].sort();
      if (JSON.stringify(next) !== JSON.stringify([...state.folders].sort())) {
        state.folders = next;
        saveState();
        send('kb:changed', { paths: [], external: false });
      }
      break;
    }
    case 'confirm':
      send('vault:confirm-request', { count: ev.count, paths: ev.paths });
      break;
    case 'notice':
      send('vault:notice', { message: ev.message });
      break;
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let win = null;
let allowClose = false;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function focusWindow() {
  if (!win || win.isDestroyed()) return createWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
}

// ---------------------------------------------------------------------------
// Live updates (docs/OTA.md): the renderer can start from a signed bundle downloaded into
// userData instead of the one inside the app. A bundle that never confirms it started is dropped.
// ---------------------------------------------------------------------------
const EMBEDDED_RENDERER = path.join(__dirname, '..', 'dist', 'index.html');
const OTA_CONFIRM_TIMEOUT_MS = 20_000;
let ota = null;
let otaConfirmTimer = null;
let otaConfirmed = false; // the window's current bundle said it started fine

function startOta() {
  ota = createOta({
    dir: path.join(app.getPath('userData'), 'ota'),
    appVersion: app.getVersion(),
    runtimeVersion: otaConfig.runtimeVersion,
    baseUrl: otaConfig.baseUrl,
    channel: process.env.LORE_OTA_CHANNEL === 'beta' ? 'beta' : 'production',
    publicKey: fs.readFileSync(path.join(__dirname, 'ota-public-key.pem'), 'utf8'),
    // Packaged builds only: `electron .` and the dev server always run the working tree
    // (LORE_OTA_DEV=1 lets a local run exercise the update path).
    enabled: (app.isPackaged || !!process.env.LORE_OTA_DEV) && !DEV_URL && !process.env.LORE_NO_OTA,
    onStatus: (status) => send('ota:status', { ...status, ...ota?.info(), phase: status.phase }),
  });
  ota.init();
  setTimeout(() => ota.check(), 10_000);
}

function useEmbeddedRenderer(w, why) {
  console.warn(`[ota] bundle rejected (${why}): back to the one inside the app`);
  clearTimeout(otaConfirmTimer);
  ota.rollback();
  if (!w.isDestroyed()) w.loadFile(EMBEDDED_RENDERER);
}

function loadRenderer(w) {
  const entry = ota?.entryPath();
  if (!entry) return w.loadFile(EMBEDDED_RENDERER);
  const wc = w.webContents;
  otaConfirmed = false;
  // Only until the bundle has confirmed itself: later crashes are not its startup failing.
  const rejectable = () => !otaConfirmed && ota.entryPath();
  wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 && rejectable()) useEmbeddedRenderer(w, `load failed: ${description}`);
  });
  wc.on('render-process-gone', (_e, details) => {
    if (rejectable()) useEmbeddedRenderer(w, `renderer gone: ${details.reason}`);
  });
  // The renderer says `ota:ready` once its UI is on screen; silence means a white screen.
  clearTimeout(otaConfirmTimer);
  otaConfirmTimer = setTimeout(() => {
    if (rejectable()) useEmbeddedRenderer(w, 'no ready signal');
  }, OTA_CONFIRM_TIMEOUT_MS);
  return w.loadFile(entry);
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
    // Packaged apps take the icon from the bundle; this covers Linux windows and dev runs.
    ...(isMac ? {} : { icon: path.join(__dirname, 'icon.png') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else loadRenderer(win);

  // Links in rendered markdown open in the system browser (obsidian:// in Obsidian).
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
  win.on('focus', () => {
    poll({ force: true });
    ota?.check();
  });

  // Let the renderer veto closing when the editor has unsaved changes.
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    send('app:close-requested');
  });
}

// ---------------------------------------------------------------------------
// Deep links: lore://open?path=Project/note.md[&heading=...]
// ---------------------------------------------------------------------------
let pendingLink = null;

function handleDeepLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  if (u.protocol !== 'lore:' || u.hostname !== 'open') return;
  const p = u.searchParams.get('path');
  if (!p) return;
  const link = { path: p.replace(/^\/+/, ''), ...(u.searchParams.get('heading') ? { heading: u.searchParams.get('heading') } : {}) };
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) send('app:navigate', link);
  else pendingLink = link;
  if (app.isReady()) focusWindow();
}

app.on('open-url', (e, url) => {
  e.preventDefault();
  handleDeepLink(url);
});
app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => a.startsWith('lore://'));
  if (url) handleDeepLink(url);
  else focusWindow();
});

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => fn(...args));
}

// `fresh`: re-list the server first (manual refresh) instead of using the mirror.
handle('kb:tree', async (fresh) => {
  if (primed && fresh) {
    await resync();
    vault?.kick();
  } else await ensurePrimed();
  return buildTree();
});

// Open a project: its files are listed and its notes downloaded (once; then polling keeps it fresh).
handle('kb:openProject', async (key) => {
  await ensurePrimed();
  if (mirror.summaries.has(key) && !mirror.loaded.has(key)) await mirror.loadProject(key);
  if (mirror.summaries.has(key)) rememberOpen(key);
  return buildTree();
});

// Search across every project: the ones not opened yet are loaded first.
handle('kb:loadAll', async () => {
  await ensurePrimed();
  await loadAllProjects();
  return buildTree();
});

handle('kb:read', async (rel) => {
  await ensurePrimed();
  await ensureLoaded(rel);
  const before = cache.get(rel)?.content ?? null;
  const f = await mirror.fetchFile(rel);
  // Opening a file is also a chance to notice an agent edit.
  if (before !== null && before !== f.content && state.authors[rel] !== f.etag) {
    if (teamOf(rel)) recordChange(rel, before, f.content, 'teammate');
    else recordChange(rel, before, f.content, 'agent', agentRef(rel));
    vault?.kick();
  }
  const mtime = Date.parse(f.uploaded);
  const author = authorOf(rel);
  return { path: rel, content: f.content, mtime, size: f.size, birthtime: mtime, author, agent: author === 'agent' ? agentRef(rel) : undefined };
});

handle('kb:write', async (rel, content) => {
  assertWritable(rel);
  await ensureLoaded(rel);
  const before = cache.get(rel)?.content ?? null;
  const file = await mirror.putText(rel, content, { overwrite: true, ifMatch: cache.get(rel)?.etag });
  recordOwnWrite(rel, file.etag);
  recordChange(rel, before, content, 'you');
  await resync();
  vault?.kick();
  return true;
});

handle('kb:create', async (rel, content) => {
  checkFilePath(rel);
  checkNewProject(rel);
  assertWritable(rel);
  await ensureLoaded(rel);
  const file = await mirror.putText(rel, content, { overwrite: false });
  recordOwnWrite(rel, file.etag);
  recordChange(rel, null, content, 'you');
  await resync();
  vault?.kick();
  return true;
});

// Object storage has no empty folders: they live here (and in the vault) until a file is put in them.
handle('kb:mkdir', async (rel) => {
  checkNewProject(rel);
  assertWritable(rel);
  await ensureLoaded(rel);
  if (state.folders.includes(rel) || filesUnder(rel).length) throw new Error('Esiste già una cartella con questo nome');
  state.folders.push(rel);
  saveState();
  await vault?.mkdirLocal(rel);
  return true;
});

handle('kb:rename', async (fromRel, toRel) => {
  if (teamOf(fromRel) !== teamOf(toRel)) throw new Error('Non puoi spostare file tra spazi diversi: per un progetto usa «Sposta in un team…»');
  if (!fromRel.includes('/')) checkProjectName(projectOf(toRel).split('@')[0]);
  assertWritable(fromRel, toRel);
  await ensureLoaded(fromRel, toRel);
  if (mirror.has(toRel) || filesUnder(toRel).length || state.folders.includes(toRel)) throw new Error('Esiste già un elemento con questo nome');
  const moved = mirror.has(fromRel) ? [fromRel] : filesUnder(fromRel);
  const mine = new Set(moved.filter((k) => authorOf(k) === 'you'));
  const fromAbs = vault?.running ? vault.abs(fromRel) : null;
  // The mirror carries contents over, so the move doesn't look like an agent edit.
  if (moved.length) await mirror.move(fromRel, toRel);
  state.folders = state.folders.map((f) => (under(f, fromRel) ? toRel + f.slice(fromRel.length) : f));
  for (const k of moved) {
    const nk = toRel + k.slice(fromRel.length);
    delete state.authors[k];
    if (mine.has(k) && mirror.files.has(nk)) state.authors[nk] = mirror.files.get(nk).etag;
  }
  saveState();
  await vault?.renameLocal(fromRel, toRel, fromAbs);
  vault?.kick();
  return true;
});

handle('kb:duplicate', async (rel) => {
  assertWritable(rel);
  await ensureLoaded(rel);
  const dot = rel.toLowerCase().lastIndexOf('.md');
  const base = rel.slice(0, dot);
  let n = 1;
  let target;
  do {
    target = `${base} copia${n > 1 ? ' ' + n : ''}.md`;
    n++;
  } while (mirror.has(target));
  const content = cache.get(rel)?.content ?? (await mirror.fetchFile(rel)).content;
  const file = await mirror.putText(target, content, { overwrite: false });
  recordOwnWrite(target, file.etag);
  recordChange(target, null, content, 'you');
  await resync();
  vault?.kick();
  return target;
});

// Delete = keep the contents in memory, remove on the server; undo writes them back.
handle('kb:delete', async (rel) => {
  assertWritable(rel);
  await ensureLoaded(rel);
  const isFile = mirror.has(rel);
  const affected = isFile ? [rel] : filesUnder(rel);
  const contents = Object.fromEntries(affected.filter((k) => isMd(k) && !isIndex(k)).map((k) => [k, cache.get(k)?.content ?? '']));
  // Attachments come back from undo only if their bytes could be kept.
  const blobs = {};
  for (const k of affected.filter((k) => !isMd(k))) {
    try {
      blobs[k] = (await mirror.readBlob(k)).buffer;
    } catch {
      /* best effort */
    }
  }
  const folders = isFile ? [] : [...new Set([...state.folders.filter((f) => under(f, rel)), rel])];
  if (isFile) await kbRequest('DELETE', '/v1/file', { query: { path: rel } });
  else if (affected.length) await kbRequest('DELETE', '/v1/folder', { query: { path: rel } });
  state.folders = state.folders.filter((f) => !under(f, rel));
  for (const k of affected) {
    const before = cache.get(k)?.content ?? null;
    cache.delete(k);
    mirror.files.delete(k);
    mirror.attachments.delete(k);
    delete state.authors[k];
    if (isMd(k) && !isIndex(k)) recordChange(k, before, null, 'you');
  }
  saveState();
  await resync();
  if (!isFile) await vault?.trashLocalFolder(rel);
  vault?.kick();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pendingDeletes.set(token, { rel, folders, contents, blobs });
  setTimeout(() => pendingDeletes.delete(token), 60_000);
  return token;
});

handle('kb:undoDelete', async (token) => {
  const d = pendingDeletes.get(token);
  if (!d) return false;
  pendingDeletes.delete(token);
  await ensureLoaded(d.rel);
  if (mirror.has(d.rel) || filesUnder(d.rel).length) throw new Error('Un elemento con lo stesso nome è stato ricreato');
  for (const [k, content] of Object.entries(d.contents)) {
    const file = await mirror.putText(k, content, { overwrite: false });
    recordOwnWrite(k, file.etag);
    recordChange(k, null, content, 'you');
  }
  for (const [k, buf] of Object.entries(d.blobs)) await mirror.putBlob(k, buf, { overwrite: false });
  // Empty folders come back as local folders.
  for (const f of d.folders) if (!filesUnder(f).length && !state.folders.includes(f)) state.folders.push(f);
  saveState();
  await resync();
  for (const f of d.folders) await vault?.mkdirLocal(f);
  vault?.kick();
  return true;
});

handle('kb:search', (q) => search(q));
handle('kb:links', () => linkIndex());
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

// --- teams and invites -------------------------------------------------------
// A team's projects are reached with the file routes and ?owner=t:<id> (spaces.cjs).
const teamPath = (id, ...rest) => ['/v1/teams', encodeURIComponent(id), ...rest.map(encodeURIComponent)].join('/');
const toTeam = (t) => ({ id: t.id, name: t.name, role: t.role, createdAt: Date.parse(t.created_at) || 0 });
const toInvite = (i) => ({ id: i.id, email: i.email, role: i.role, createdAt: Date.parse(i.created_at) || 0, expiresAt: Date.parse(i.expires_at) || 0 });

/** Teams joined, left, created or deleted: the project list follows at once. */
async function afterTeamsChanged() {
  await mirror.syncSummaries();
  await loadVaultProjects();
  vault?.kick();
  send('kb:changed', { paths: [], external: false });
}

handle('teams:list', async () => (await request('GET', '/v1/teams')).teams.map(toTeam));
handle('teams:get', async (id) => toTeam((await request('GET', teamPath(id))).team));
handle('teams:create', async (name) => {
  const { team } = await request('POST', '/v1/teams', { body: { name } });
  await afterTeamsChanged();
  return toTeam(team);
});
handle('teams:rename', async (id, name) => {
  await request('PATCH', teamPath(id), { body: { name } });
  await afterTeamsChanged();
  return true;
});
handle('teams:delete', async (id) => {
  await request('DELETE', teamPath(id));
  await afterTeamsChanged();
  return true;
});
handle('teams:members', async (id) => {
  const me = auth.user()?.id;
  return (await request('GET', teamPath(id, 'members'))).members.map((m) => ({
    userId: m.user_id,
    role: m.role,
    joinedAt: Date.parse(m.joined_at) || 0,
    name: m.name ?? null,
    email: m.email ?? null,
    isYou: m.user_id === me,
  }));
});
handle('teams:setRole', async (id, userId, role) => {
  await request('PATCH', teamPath(id, 'members', userId), { body: { role } });
  // Your own role changed: what you may do in its projects changes too.
  if (userId === auth.user()?.id) await afterTeamsChanged();
  return true;
});
// Removing someone, or yourself (leave): leaving takes the team's projects away from this app.
handle('teams:removeMember', async (id, userId) => {
  await request('DELETE', teamPath(id, 'members', userId));
  if (userId === auth.user()?.id) await afterTeamsChanged();
  return true;
});
handle('teams:invites', async (id) => (await request('GET', teamPath(id, 'invites'))).invites.map(toInvite));
handle('teams:invite', async (id, email, role) => toInvite((await request('POST', teamPath(id, 'invites'), { body: { email, role } })).invite));
handle('teams:revokeInvite', async (id, inviteId) => {
  await request('DELETE', teamPath(id, 'invites', inviteId));
  return true;
});

const toMyInvite = (i) => ({
  id: i.id,
  teamId: i.team_id,
  teamName: i.team_name,
  role: i.role,
  invitedBy: i.invited_by?.name ?? i.invited_by?.email ?? null,
  createdAt: Date.parse(i.created_at) || 0,
  expiresAt: Date.parse(i.expires_at) || 0,
});
let lastInvites = null;
async function myInvites() {
  const invites = (await request('GET', '/v1/invites')).invites.map(toMyInvite);
  const stamp = JSON.stringify(invites.map((i) => i.id));
  if (lastInvites !== null && stamp !== lastInvites) send('invites:changed', invites);
  lastInvites = stamp;
  return invites;
}
handle('invites:mine', () => myInvites());
handle('invites:answer', async (id, accept) => {
  await request('POST', `/v1/invites/${encodeURIComponent(id)}/${accept ? 'accept' : 'decline'}`);
  // Accepting brings the team's projects in right away.
  if (accept) await afterTeamsChanged();
  return myInvites();
});

// Personal project -> team (server-side copy + delete). It keeps its place in Lore and in the local copy.
handle('projects:moveToTeam', async (key, teamId) => {
  if (teamOf(key)) throw new Error('Il progetto è già di un team');
  const team = mirror.teams.find((t) => t.id === teamId);
  if (!team || !canWrite(team.role)) throw new Error('Puoi spostare progetti solo nei team in cui puoi scrivere');
  await ensurePrimed();
  const wasLoaded = mirror.loaded.has(key);
  const synced = vaultSelected(key);
  const next = `${key}@${teamId}`;
  await request('POST', `/v1/projects/${encodeURIComponent(key)}/move-to-team`, { body: { team_id: teamId } });
  // Same bytes under the new key: authorship, empty folders and the open list follow.
  const rekey = (rel) => (under(rel, key) ? next + rel.slice(key.length) : rel);
  state.authors = Object.fromEntries(Object.entries(state.authors).map(([rel, etag]) => [rekey(rel), etag]));
  state.folders = state.folders.map(rekey);
  state.openProjects = state.openProjects.map(rekey);
  saveState();
  // A project the local copy had keeps syncing there, now in its team folder.
  const u = auth.user();
  if (u && synced && vaultConfig(u.id).enabled) {
    const cfg = vaultConfig(u.id);
    const include = [...new Set([...(cfg.projects?.include ?? []), next])];
    await saveVaultConfig(u.id, { ...cfg, projects: { exclude: cfg.projects?.exclude ?? [], include } });
  }
  mirror.forget(key);
  await mirror.syncSummaries();
  if (wasLoaded || synced) await mirror.loadProject(next).catch(() => {});
  await resync();
  vault?.kick();
  send('kb:changed', { paths: [], external: false });
  return next;
});

// --- local vault -------------------------------------------------------------
handle('vault:status', () => vaultStatus());

handle('vault:chooseRoot', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Cartella per la copia locale',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    // Mac App Store: keep access to the folder across launches.
    ...(MAS ? { securityScopedBookmarks: true } : {}),
  });
  if (res.canceled) return null;
  if (MAS && res.bookmarks?.[0]) pickedBookmarks.set(res.filePaths[0], res.bookmarks[0]);
  return res.filePaths[0];
});

// Dry run for a folder about to become the vault: what would move where.
handle('vault:preview', async (root) => {
  const u = auth.user();
  if (!u) throw new Error('Accesso richiesto');
  await ensurePrimed();
  if (!root && !defaultVaultRoot()) return { ok: false, root: '', error: 'Scegli una cartella per la copia locale.' };
  const cfg = vaultConfig(u.id);
  for (const key of mirror.summaries.keys()) if (vaultSelected(key, cfg)) await mirror.loadProject(key);
  const layout = vaultLayout();
  const abs = path.resolve(root || defaultVaultRoot());
  const exists = fs.existsSync(abs);
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(path.join(abs, '.lore-sync', 'vault.json'), 'utf8'));
  } catch {
    /* not a vault yet */
  }
  if (marker && (marker.userId !== u.id || marker.server !== serverId())) {
    return { ok: false, root: abs, error: 'Questa cartella è la copia locale di un altro account: scegline un\'altra.' };
  }
  const visible = exists ? fs.readdirSync(abs).filter((n) => !n.startsWith('.')) : [];
  const scan = visible.length ? await scanVault(abs, {}, layout) : { files: new Map(), unsynced: [] };
  const remote = new Map([...mirror.snapshot()].filter(([rel]) => rel.includes('/') && layout.covers(projectOf(rel))));
  const readonly = (rel) => layout.readonly(projectOf(rel));
  const actions = planSync({ manifest: {}, remote, local: scan.files, caseInsensitive: process.platform !== 'linux', readonly });
  const count = (type) => actions.filter((a) => a.type === type).length;
  return {
    ok: true,
    root: abs,
    exists,
    empty: visible.length === 0,
    resume: !!marker,
    download: count('pull'),
    upload: count('push'),
    merge: count('merge'),
    same: count('adopt'),
    unsynced: scan.unsynced.length,
  };
});

handle('vault:enable', async ({ root, linkFormat = 'markdown' } = {}) => {
  const u = auth.user();
  if (!u) throw new Error('Accesso richiesto');
  if (!root && !defaultVaultRoot()) throw new Error('Scegli una cartella per la copia locale');
  const abs = path.resolve(root || defaultVaultRoot());
  if (under(abs, app.getPath('userData'))) throw new Error('Scegli una cartella fuori dai dati dell\'app');
  const prev = vaultConfig(u.id);
  const bookmark = pickedBookmarks.get(abs) ?? (prev.root === abs ? prev.bookmark : undefined);
  if (MAS && !bookmark) throw new Error('Scegli di nuovo la cartella con «Scegli…» per darle accesso');
  await fsp.mkdir(abs, { recursive: true });
  await obsidian.writeDefaultConfig(abs, { linkFormat });
  await saveVaultConfig(u.id, { enabled: true, root: abs, linkFormat, ...(bookmark ? { bookmark } : {}), ...(prev.projects ? { projects: prev.projects } : {}) });
  await startVault();
  return vaultStatus();
});

handle('vault:disable', async ({ deleteLocal = false } = {}) => {
  const u = auth.user();
  if (!u) return vaultStatus();
  const cfg = vaultConfig(u.id);
  if (vault) {
    await vault.flush({ timeoutMs: 5000 });
    stopVault();
  }
  await saveVaultConfig(u.id, { ...cfg, enabled: false });
  if (deleteLocal && cfg.root) {
    // Still inside the sandbox grant: released right after.
    await shell.trashItem(cfg.root).catch(() => {});
    await fsp.rm(path.join(syncDir(u.id), 'manifest.json'), { force: true });
    await fsp.rm(path.join(syncDir(u.id), 'bases'), { recursive: true, force: true });
  }
  releaseAccess();
  send('vault:status', vaultStatus());
  return vaultStatus();
});

handle('vault:syncNow', async () => {
  if (primed) await resync();
  if (vault) await vault.syncNow();
  else await startVault();
  return vaultStatus();
});

handle('vault:confirm', async (answer) => {
  await vault?.confirm(answer);
  return vaultStatus();
});

handle('vault:reveal', async (rel) => {
  const cfg = auth.user() ? vaultConfig(auth.user().id) : null;
  if (!cfg?.root) return false;
  if (rel && vault) shell.showItemInFolder(vault.abs(rel));
  else await shell.openPath(cfg.root);
  return true;
});

handle('vault:setLinkFormat', async (linkFormat) => {
  const u = auth.user();
  if (!u) return vaultStatus();
  const cfg = vaultConfig(u.id);
  await saveVaultConfig(u.id, { ...cfg, linkFormat });
  if (cfg.root && fs.existsSync(cfg.root)) await obsidian.setLinkFormat(cfg.root, linkFormat);
  return vaultStatus();
});

// Which projects the local copy holds: the user's own by default, team projects on request.
handle('vault:projects', async () => {
  const u = auth.user();
  if (!u) return [];
  await ensurePrimed();
  const layout = vaultLayout();
  return [...mirror.summaries.values()]
    .map((s) => ({ key: s.key, name: s.name, team: s.team, access: s.access, selected: vaultSelected(s.key), folder: layout.folderOf(s.key) }))
    .sort((a, b) => (!a.team === !b.team ? 0 : a.team ? 1 : -1) || a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
});

handle('vault:setProject', async (key, on) => {
  const u = auth.user();
  if (!u) throw new Error('Accesso richiesto');
  const cfg = vaultConfig(u.id);
  const p = { exclude: [...(cfg.projects?.exclude ?? [])], include: [...(cfg.projects?.include ?? [])] };
  const list = teamOf(key) ? p.include : p.exclude;
  const want = teamOf(key) ? on : !on; // personal projects are listed when switched off
  const i = list.indexOf(key);
  if (want && i === -1) list.push(key);
  if (!want && i !== -1) list.splice(i, 1);
  await saveVaultConfig(u.id, { ...cfg, projects: p });
  if (vault) {
    if (on) {
      // Loaded first, then merged by the usual planner.
      await mirror.loadProject(key);
      vault.kick();
    } else {
      // The local folder stays as it is; it just stops syncing.
      await vault.forgetProject(key);
      send('vault:notice', { message: `«${vault.abs(key).split(path.sep).pop()}» non è più sincronizzato: la cartella resta sul computer` });
    }
  }
  return true;
});

handle('obsidian:status', () => {
  const cfg = auth.user() ? vaultConfig(auth.user().id) : {};
  return {
    installed: obsidian.isInstalled({ protocolApp: app.getApplicationNameForProtocol('obsidian://open'), home: app.getPath('home') }),
    registered: cfg.root ? obsidian.isRegistered(cfg.root, app.getPath('appData')) : false,
  };
});

// Open a note (or the whole vault) in Obsidian. Pending local writes land first.
handle('obsidian:open', async (rel) => {
  if (!vault?.running) throw new Error('Attiva prima la copia locale per Obsidian');
  let target = vault.root;
  if (rel) {
    await vault.flush({ timeoutMs: 3000 });
    if (fs.existsSync(vault.abs(rel))) target = vault.abs(rel);
  }
  await shell.openExternal(obsidian.openUri(target));
  return true;
});

handle('obsidian:launch', () => shell.openExternal('obsidian://open'));

// Attachments that the window can't show inline (PDF) open in the system viewer.
handle('app:openAttachment', async (rel) => {
  if (vault?.running && fs.existsSync(vault.abs(rel))) return shell.openPath(vault.abs(rel));
  const { buffer } = await mirror.readBlob(rel);
  const dir = path.join(app.getPath('temp'), 'lore-attachments');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, path.basename(rel));
  await fsp.writeFile(file, buffer);
  return shell.openPath(file);
});

handle('app:takePendingLink', () => {
  const link = pendingLink;
  pendingLink = null;
  return link;
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
handle('ota:ready', () => {
  otaConfirmed = true;
  clearTimeout(otaConfirmTimer);
  ota?.confirm();
});
handle('ota:status', () => ota?.info() ?? { enabled: false, phase: 'idle', appVersion: app.getVersion(), channel: 'production', version: null });
handle('ota:check', () => ota?.check({ force: true }));
handle('ota:setChannel', (channel) => ota.setChannel(channel));
handle('app:confirmClose', () => {
  allowClose = true;
  win?.close();
});

handle('auth:user', () => auth.user());
handle('auth:signIn', async (provider) => {
  const u = await auth.signIn(provider);
  // The browser had focus during login; bring the app back.
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  return u;
});
handle('auth:cancelSignIn', () => auth.cancelSignIn());
// Local edits still on their way up are flushed first; the vault folder stays on disk.
handle('auth:signOut', async () => {
  if (vault) {
    await vault.flush({ timeoutMs: 5000 });
    stopVault();
  }
  return auth.signOut();
});

// ---------------------------------------------------------------------------
// Attachments for the renderer: from the vault when it's on, else downloaded
// once and cached by etag.
// ---------------------------------------------------------------------------
async function serveAsset(req) {
  const notFound = () => new Response('Not found', { status: 404 });
  let rel;
  try {
    rel = new URL(req.url).pathname.replace(/^\/+/, '').split('/').map(decodeURIComponent).join('/');
  } catch {
    return notFound();
  }
  const type = mimeOf(rel);
  if (kindOf(rel) !== 'bin' || !type || rel.split('/').some((s) => s === '..' || s === '')) return notFound();
  const headers = { 'content-type': type, 'cache-control': 'no-cache' };
  try {
    if (vault?.running) {
      const buf = await fsp.readFile(vault.abs(rel)).catch(() => null);
      if (buf) return new Response(buf, { headers });
    }
    const meta = mirror.attachments.get(rel);
    if (!meta) return notFound();
    const cached = path.join(app.getPath('userData'), 'assets', `${meta.etag}.${rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()}`);
    let buf = await fsp.readFile(cached).catch(() => null);
    if (!buf) {
      buf = (await mirror.readBlob(rel)).buffer;
      await fsp.mkdir(path.dirname(cached), { recursive: true });
      await fsp.writeFile(cached, buf);
    }
    return new Response(buf, { headers });
  } catch {
    return notFound();
  }
}

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  loadState();
  // `electron .` shows Electron's own icon in the Dock; the packaged app has the 1c icon in its bundle.
  if (isMac && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'icon.png'));
  protocol.handle('lore-asset', serveAsset);
  startOta();
  if (process.defaultApp) app.setAsDefaultProtocolClient('lore', process.execPath, [path.resolve(process.argv[1] ?? '.')]);
  else app.setAsDefaultProtocolClient('lore');
  auth.init((u) => {
    onUser(u);
    send('auth:changed', u);
  });
  onUser(auth.user());
  setInterval(poll, POLL_MS);
  // Retry a vault that couldn't start (offline at launch).
  setInterval(() => {
    const u = auth.user();
    if (u && !vault && !vaultStarting && vaultConfig(u.id).enabled) startVault().catch(() => {});
  }, POLL_BACKGROUND_MS);
  powerMonitor.on('suspend', () => (asleep = true));
  powerMonitor.on('resume', () => {
    asleep = false;
    poll({ force: true });
    vault?.kick(2000);
  });
  createWindow();
  const initial = process.argv.find((a) => a.startsWith('lore://'));
  if (initial) handleDeepLink(initial);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quitting: let the vault push what's still pending (bounded).
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting || !vault) return;
  e.preventDefault();
  quitting = true;
  vault.flush({ timeoutMs: 4000 }).finally(() => {
    stopVault();
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
