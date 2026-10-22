// `LoreBridge` for the browser build (GitHub Pages and the like): what
// electron/main.cjs does behind IPC, done in the page against the Worker.
// No local vault or Obsidian here — a browser has no folder to keep in sync.
import { structuredPatch } from 'diff';
import type { ActivityEvent, AgentKind, AgentRef, AuthUser, ChangedEvent, LoreBridge, Prefs, TreeNode, VaultStatus } from '../kb/types';
import * as auth from './auth';
import { request } from './api';
import { API_URL } from './config';
import { createMirror, isMd, type Meta } from './mirror';

const POLL_MS = 5000;
const STATE_KEY = 'lore-state';
const AUDIT_WINDOW = 200;
// localStorage is small (≈5 MB) and events carry both versions of a note.
const MAX_ACTIVITY = 150;

const KINDS: AgentKind[] = ['claude', 'codex'];
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf' };
const mimeOf = (rel: string) => MIME[rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()];
const isIndex = (rel: string) => rel.split('/').length === 2 && rel.toLowerCase().endsWith('/index.md');
const under = (rel: string, prefix: string) => rel === prefix || rel.startsWith(prefix + '/');

// --- agents (same mapping as electron/agents.cjs) ----------------------------
const toScope = (scope: string[]) => (scope.includes('*') ? '*' : scope.map((p) => `${p}/*`).join(','));
const fromScope = (s: string) => (s === '*' || s.split(',').includes('*') ? ['*'] : s.split(',').map((p) => p.replace(/\/\*$/, '')));
const toAgent = (row: any) => ({
  id: row.agent_id,
  name: row.name,
  kind: (KINDS.includes(row.agent_type) ? row.agent_type : 'claude') as AgentKind,
  permission: row.access_level === 'read_write' ? ('write' as const) : ('read' as const),
  scope: fromScope(row.project_scope),
  createdAt: Date.parse(row.created_at),
});
const toPatch = (p: { name?: string; kind?: AgentKind; permission?: string; scope?: string[] }) => ({
  ...(p.name !== undefined ? { name: p.name } : {}),
  ...(p.kind !== undefined ? { agent_type: p.kind } : {}),
  ...(p.permission !== undefined ? { access_level: p.permission === 'write' ? 'read_write' : 'read_only' } : {}),
  ...(p.scope !== undefined ? { project_scope: toScope(p.scope) } : {}),
});
function applyAudit(writers: Map<string, string>, rows: any[], after = 0) {
  const fresh = rows.filter((r) => r.log_id > after).sort((a, b) => a.log_id - b.log_id);
  for (const r of fresh) writers.set(r.target_path, r.agent_id);
  return fresh.length ? fresh[fresh.length - 1].log_id : after;
}
const refOf = (refs: Record<string, { name: string; kind: AgentKind | null }>, id?: string): AgentRef | undefined =>
  id && refs[id] ? { id, ...refs[id] } : id ? { id, name: 'Agente revocato', kind: null } : undefined;

// --- tiny event emitter -------------------------------------------------------
function channel<T>() {
  const subs = new Set<(v: T) => void>();
  return {
    emit: (v: T) => subs.forEach((cb) => cb(v)),
    on: (cb: (v: T) => void) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
}

const VAULT_OFF: VaultStatus = {
  state: 'off',
  enabled: false,
  root: null,
  defaultRoot: null,
  linkFormat: 'markdown',
  pending: 0,
  lastSyncAt: null,
  unsynced: [],
  conflicts: [],
  error: null,
  confirm: null,
};
const noVault = () => Promise.reject(new Error('La copia locale per Obsidian è disponibile solo nell’app desktop'));
const noTeams = () => Promise.reject(new Error('I team si gestiscono solo nell’app desktop'));

export function createWebBridge(): LoreBridge {
  const changed = channel<ChangedEvent>();
  const activityCh = channel<ActivityEvent>();
  const authCh = channel<AuthUser | null>();
  const notice = channel<{ message: string }>();

  // ------------------------------------------------------------------ state
  type State = {
    userId: string | null;
    activity: ActivityEvent[];
    authors: Record<string, string>;
    folders: string[];
    agentRefs: Record<string, { name: string; kind: AgentKind | null }>;
    prefs: Prefs;
    lastSeenActivity: number;
    lastLogId: number;
    lastVersion: unknown;
  };
  let state: State = { userId: null, activity: [], authors: {}, folders: [], agentRefs: {}, prefs: {}, lastSeenActivity: 0, lastLogId: 0, lastVersion: null };
  try {
    state = { ...state, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') };
  } catch {
    /* first run */
  }
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const saveState = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      for (;;) {
        try {
          localStorage.setItem(STATE_KEY, JSON.stringify(state));
          return;
        } catch {
          // Over quota: drop the oldest half of the activity and retry.
          if (!state.activity.length) return;
          state.activity = state.activity.slice(0, Math.floor(state.activity.length / 2));
        }
      }
    }, 200);
  };

  const mirror = createMirror();
  const cache = mirror.cache;
  let writers = new Map<string, string>();
  let primed = false;
  let priming: Promise<void> | null = null;
  const assets = new Map<string, { etag: string; url: Promise<string> }>();

  function onUser(u: AuthUser | null) {
    primed = false;
    mirror.reset();
    writers = new Map();
    state.lastVersion = null;
    for (const a of assets.values()) a.url.then(URL.revokeObjectURL, () => {});
    assets.clear();
    if (u && u.id !== state.userId) {
      state = { ...state, userId: u.id, activity: [], authors: {}, folders: [], agentRefs: {}, lastSeenActivity: 0, lastLogId: 0 };
      saveState();
    }
  }
  auth.init((u) => {
    onUser(u);
    authCh.emit(u);
  });

  async function refreshAgents() {
    const agents = (await request('GET', '/v1/agents')).agents.map(toAgent);
    for (const a of agents) state.agentRefs[a.id] = { name: a.name, kind: a.kind };
    saveState();
    return agents;
  }
  const agentRef = (rel: string) => refOf(state.agentRefs, writers.get(rel));

  async function ensurePrimed() {
    if (primed) return;
    priming ??= (async () => {
      await mirror.sync();
      const [{ items }] = await Promise.all([request('GET', '/v1/audit', { query: { limit: AUDIT_WINDOW } }), refreshAgents()]);
      writers = new Map();
      state.lastLogId = applyAudit(writers, items, 0);
      primed = true;
    })().finally(() => (priming = null));
    await priming;
  }

  async function resync({ agentPaths }: { agentPaths?: Set<string> } = {}) {
    const changes = await mirror.sync();
    for (const ch of changes) {
      if (ch.attachment || isIndex(ch.rel) || state.authors[ch.rel] === mirror.files.get(ch.rel)?.etag) continue;
      const byAgent = !agentPaths || agentPaths.has(ch.rel);
      recordChange(ch.rel, ch.before ?? null, ch.after ?? null, byAgent ? 'agent' : 'you', byAgent ? agentRef(ch.rel) : undefined, byAgent ? {} : { source: 'device' });
    }
    return changes;
  }

  // ------------------------------------------------------------------- tree
  function buildTree(): TreeNode[] {
    type Level = Map<string, { dir?: Level; rel?: string; file?: Meta }>;
    const root: Level = new Map();
    const dirAt = (segs: string[]) => {
      let level = root;
      let rel = '';
      for (const s of segs) {
        rel = rel ? `${rel}/${s}` : s;
        if (!level.get(s)?.dir) level.set(s, { dir: new Map(), rel });
        level = level.get(s)!.dir!;
      }
      return level;
    };
    for (const rel of state.folders) dirAt(rel.split('/'));
    for (const f of [...mirror.files.values(), ...mirror.attachments.values()]) {
      const segs = f.path.split('/');
      dirAt(segs.slice(0, -1)).set(segs[segs.length - 1], { file: f });
    }
    const toNodes = (level: Level): TreeNode[] => {
      const out: TreeNode[] = [];
      for (const [name, entry] of level) {
        if (entry.dir) {
          const children = toNodes(entry.dir);
          out.push({ kind: 'folder', name, path: entry.rel!, mtime: Math.max(0, ...children.map((c) => c.mtime)), size: 0, children });
        } else if (!isMd(name)) {
          const f = entry.file!;
          out.push({ kind: 'file', type: 'attachment', mime: mimeOf(f.path), name, path: f.path, mtime: Date.parse(f.uploaded), size: f.size, author: 'you' });
        } else {
          const f = entry.file!;
          const author = authorOf(f.path);
          out.push({ kind: 'file', name, path: f.path, mtime: Date.parse(f.uploaded), size: f.size, author, agent: author === 'agent' ? agentRef(f.path) : undefined, ...fileMeta(name, cache.get(f.path)?.content) });
        }
      }
      const rank = (n: TreeNode) => (n.kind === 'file' && n.name.toLowerCase() === 'index.md' ? 0 : n.kind === 'file' && n.name.toLowerCase() === 'checklist.md' ? 1 : n.kind === 'folder' ? 2 : 3);
      out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
      return out;
    };
    return toNodes(root);
  }

  function fileMeta(name: string, content = '') {
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
      const para = content
        .split(/\r?\n\s*\r?\n/)
        .map((b) => b.trim())
        .find((b) => b && !/^(#|_|\*[^*]|-|\d+\.|\[|>|```|\|)/.test(b));
      return { summary: para ? para.replace(/\s+/g, ' ').replace(/[*_`]/g, '').slice(0, 160) : '' };
    }
    return {};
  }

  const authorOf = (rel: string) => (state.authors[rel] && state.authors[rel] === mirror.files.get(rel)?.etag ? 'you' : 'agent');
  const recordOwnWrite = (rel: string, etag: string) => {
    state.authors[rel] = etag;
    saveState();
  };
  const filesUnder = (rel: string) => mirror.paths().filter((k) => under(k, rel));

  // --------------------------------------------------------------- activity
  function pushActivity(ev: Omit<ActivityEvent, 'id' | 'at'>) {
    state.activity.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), ...ev });
    state.activity = state.activity.slice(0, MAX_ACTIVITY);
    saveState();
    activityCh.emit(state.activity[0]);
  }

  function recordChange(rel: string, before: string | null, after: string | null, by: 'you' | 'agent', agent?: AgentRef, extra: Partial<ActivityEvent> = {}) {
    if (before === after) return;
    const kind = before == null ? 'created' : after == null ? 'deleted' : 'modified';
    const patch = structuredPatch('a', 'b', before ?? '', after ?? '', '', '', { context: 2 });
    let added = 0;
    let removed = 0;
    for (const h of patch.hunks) for (const l of h.lines) l[0] === '+' ? added++ : l[0] === '-' && removed++;
    pushActivity({ path: rel, kind, by, ...(agent ? { agent } : {}), ...extra, added, removed, hunks: patch.hunks, before, after });
  }

  // ---------------------------------------------------------------- polling
  let polling = false;
  async function poll() {
    if (polling || !primed || !auth.user() || document.hidden) return;
    polling = true;
    try {
      const { version } = await request('GET', '/v1/version');
      if (version === state.lastVersion) return;
      state.lastVersion = version;
      const { items } = await request('GET', '/v1/audit', { query: { limit: 50 } });
      const prev = state.lastLogId;
      if ((items[0]?.log_id ?? 0) !== prev) {
        state.lastLogId = applyAudit(writers, items, prev);
        if (items.some((r: any) => !state.agentRefs[r.agent_id])) await refreshAgents().catch(() => {});
        saveState();
      }
      const agentPaths = new Set<string>(items.filter((r: any) => r.log_id > prev).map((r: any) => r.target_path));
      const changes = await resync({ agentPaths });
      const notes = changes.filter((c) => !isIndex(c.rel));
      if (changes.length) changed.emit({ paths: changes.map((c) => c.rel), external: notes.length > 0, source: notes.some((c) => agentPaths.has(c.rel)) ? 'agent' : 'device' });
    } catch {
      /* offline or session gone: try again next tick */
    } finally {
      polling = false;
    }
  }
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => void poll());

  // --------------------------------------------------------------- deletes
  const pendingDeletes = new Map<string, { rel: string; folders: string[]; contents: Record<string, string>; blobs: Record<string, Blob> }>();

  // --------------------------------------------------------------- search
  function search(query: string) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results = [];
    for (const [rel, { content }] of cache) {
      const nameHit = rel.toLowerCase().includes(q);
      if (!content.toLowerCase().includes(q) && !nameHit) continue;
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

  const LINK_RE = /!?\[\[([^\]\n]+)\]\]|\]\(\s*<([^>\n]+)>\s*\)|\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  function linkIndex() {
    const out: Record<string, string[]> = {};
    for (const [rel, { content }] of cache) {
      const targets = [];
      for (const m of content.matchAll(LINK_RE)) targets.push(m[1] !== undefined ? `[[${m[1]}]]` : (m[2] ?? m[3]));
      if (targets.length) out[rel] = targets;
    }
    return out;
  }

  // ------------------------------------------------------------ attachments
  /** Object URL for an attachment, downloaded once per etag. */
  function assetUrl(rel: string): Promise<string> {
    const etag = mirror.attachments.get(rel)?.etag ?? '';
    const hit = assets.get(rel);
    if (hit && hit.etag === etag) return hit.url;
    hit?.url.then(URL.revokeObjectURL, () => {});
    const url = mirror.readBlob(rel).then(({ blob }) => URL.createObjectURL(new Blob([blob], { type: mimeOf(rel) ?? blob.type })));
    url.catch(() => assets.delete(rel));
    assets.set(rel, { etag, url });
    return url;
  }

  // A link like `…/?open=Project/note.md&heading=…` opens that note (the web's lore://open).
  let pendingLink: { path: string; heading?: string } | null = (() => {
    const q = new URLSearchParams(location.search);
    const p = q.get('open');
    if (!p) return null;
    q.delete('open');
    const heading = q.get('heading');
    q.delete('heading');
    history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
    return { path: p.replace(/^\/+/, ''), ...(heading ? { heading } : {}) };
  })();

  const none = () => () => {};

  return {
    async tree(fresh) {
      if (primed && fresh) await resync();
      else await ensurePrimed();
      return buildTree();
    },
    // The web build mirrors everything up front: nothing is lazy.
    async openProject() {
      await ensurePrimed();
      return buildTree();
    },
    async loadAll() {
      await ensurePrimed();
      return buildTree();
    },

    async read(rel) {
      await ensurePrimed();
      const before = cache.get(rel)?.content ?? null;
      const f = await mirror.fetchFile(rel);
      if (before !== null && before !== f.content && state.authors[rel] !== f.etag) recordChange(rel, before, f.content, 'agent', agentRef(rel));
      const mtime = Date.parse(f.uploaded);
      const author = authorOf(rel);
      return { path: rel, content: f.content, mtime, size: f.size, birthtime: mtime, author, agent: author === 'agent' ? agentRef(rel) : undefined };
    },

    async write(rel, content) {
      const before = cache.get(rel)?.content ?? null;
      const file = await mirror.putText(rel, content, { overwrite: true, ifMatch: cache.get(rel)?.etag });
      recordOwnWrite(rel, file.etag);
      recordChange(rel, before, content, 'you');
      await resync();
      return true;
    },

    async create(rel, content) {
      if (!rel.includes('/')) throw new Error('I file devono stare dentro un progetto');
      if (!isMd(rel)) throw new Error('Sono ammessi solo file .md');
      const file = await mirror.putText(rel, content, { overwrite: false });
      recordOwnWrite(rel, file.etag);
      recordChange(rel, null, content, 'you');
      await resync();
      return true;
    },

    async mkdir(rel) {
      if (state.folders.includes(rel) || filesUnder(rel).length) throw new Error('Esiste già una cartella con questo nome');
      state.folders.push(rel);
      saveState();
      return true;
    },

    async rename(fromRel, toRel) {
      if (mirror.has(toRel) || filesUnder(toRel).length || state.folders.includes(toRel)) throw new Error('Esiste già un elemento con questo nome');
      const moved = mirror.has(fromRel) ? [fromRel] : filesUnder(fromRel);
      const mine = new Set(moved.filter((k) => authorOf(k) === 'you'));
      if (moved.length) await mirror.move(fromRel, toRel);
      state.folders = state.folders.map((f) => (under(f, fromRel) ? toRel + f.slice(fromRel.length) : f));
      for (const k of moved) {
        const nk = toRel + k.slice(fromRel.length);
        delete state.authors[k];
        if (mine.has(k) && mirror.files.has(nk)) state.authors[nk] = mirror.files.get(nk)!.etag;
      }
      saveState();
      return true;
    },

    async duplicate(rel) {
      const base = rel.slice(0, rel.toLowerCase().lastIndexOf('.md'));
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
      return target;
    },

    async remove(rel) {
      const isFile = mirror.has(rel);
      const affected = isFile ? [rel] : filesUnder(rel);
      const contents = Object.fromEntries(affected.filter((k) => isMd(k) && !isIndex(k)).map((k) => [k, cache.get(k)?.content ?? '']));
      const blobs: Record<string, Blob> = {};
      for (const k of affected.filter((k) => !isMd(k))) {
        try {
          blobs[k] = (await mirror.readBlob(k)).blob;
        } catch {
          /* best effort */
        }
      }
      const folders = isFile ? [] : [...new Set([...state.folders.filter((f) => under(f, rel)), rel])];
      if (isFile) await request('DELETE', '/v1/file', { query: { path: rel } });
      else if (affected.length) await request('DELETE', '/v1/folder', { query: { path: rel } });
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
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pendingDeletes.set(token, { rel, folders, contents, blobs });
      setTimeout(() => pendingDeletes.delete(token), 60_000);
      return token;
    },

    async undoDelete(token) {
      const d = pendingDeletes.get(token);
      if (!d) return false;
      pendingDeletes.delete(token);
      if (mirror.has(d.rel) || filesUnder(d.rel).length) throw new Error('Un elemento con lo stesso nome è stato ricreato');
      for (const [k, content] of Object.entries(d.contents)) {
        const file = await mirror.putText(k, content, { overwrite: false });
        recordOwnWrite(k, file.etag);
        recordChange(k, null, content, 'you');
      }
      for (const [k, blob] of Object.entries(d.blobs)) await mirror.putBlob(k, blob, { overwrite: false });
      for (const f of d.folders) if (!filesUnder(f).length && !state.folders.includes(f)) state.folders.push(f);
      saveState();
      await resync();
      return true;
    },

    search: async (q) => search(q),
    links: async () => linkIndex(),
    activity: async () => state.activity,
    async markActivitySeen() {
      state.lastSeenActivity = Date.now();
      saveState();
      return state.lastSeenActivity;
    },
    lastSeenActivity: async () => state.lastSeenActivity || 0,

    agents: () => refreshAgents(),
    async createAgent({ kind, name, permission, scope, days }) {
      const res = await request('POST', '/v1/agents', { body: { name, ...toPatch({ kind, permission, scope }), ...(days ? { expires_in_days: days } : {}) } });
      const agent = toAgent(res.agent);
      state.agentRefs[agent.id] = { name: agent.name, kind: agent.kind };
      saveState();
      return { agent, token: res.token, expiresAt: Date.parse(res.expires_at), mcpUrl: `${API_URL}/mcp` };
    },
    async updateAgent(id, patch) {
      await request('PATCH', `/v1/agents/${encodeURIComponent(id)}`, { body: toPatch(patch) });
      const ref = state.agentRefs[id];
      if (ref) state.agentRefs[id] = { name: patch.name ?? ref.name, kind: patch.kind ?? ref.kind };
      saveState();
      return true;
    },
    async deleteAgent(id) {
      await request('DELETE', `/v1/agents/${encodeURIComponent(id)}`);
      return true;
    },
    async audit(opts = {}) {
      const { items, next_before } = await request('GET', '/v1/audit', { query: { limit: opts.limit ?? 50, before: opts.before } });
      return {
        items: items.map((r: any) => ({ id: r.log_id, at: Date.parse(r.timestamp), agent: refOf(state.agentRefs, r.agent_id), action: r.action, path: r.target_path })),
        nextBefore: next_before,
      };
    },

    // Teams are managed from the desktop app; the browser sees none.
    teams: async () => [],
    team: noTeams,
    createTeam: noTeams,
    renameTeam: noTeams,
    deleteTeam: noTeams,
    teamMembers: noTeams,
    setMemberRole: noTeams,
    removeMember: noTeams,
    teamInvites: noTeams,
    inviteToTeam: noTeams,
    revokeInvite: noTeams,
    myInvites: async () => [],
    answerInvite: noTeams,
    moveToTeam: noTeams,
    vaultProjects: async () => [],
    vaultSetProject: noVault,
    onInvites: none,

    // No local vault / Obsidian in a browser.
    vaultStatus: async () => VAULT_OFF,
    vaultChooseRoot: async () => null,
    vaultPreview: noVault,
    vaultEnable: noVault,
    vaultDisable: async () => VAULT_OFF,
    vaultSyncNow: async () => VAULT_OFF,
    vaultConfirm: async () => VAULT_OFF,
    vaultReveal: async () => false,
    vaultSetLinkFormat: async () => VAULT_OFF,
    obsidianStatus: async () => ({ installed: false, registered: false }),
    openInObsidian: noVault,
    launchObsidian: async () => {
      window.open('obsidian://open');
    },

    openAttachment(rel) {
      // Opened before the download so the popup blocker sees the click.
      const tab = window.open('', '_blank');
      return assetUrl(rel).then(
        (url) => {
          if (tab) tab.location.href = url;
          else window.open(url, '_blank');
          return '';
        },
        (err) => {
          tab?.close();
          throw err;
        },
      );
    },
    assetUrl,

    async takePendingLink() {
      const link = pendingLink;
      pendingLink = null;
      return link;
    },
    server: async () => new URL(API_URL).host,
    prefs: async () => state.prefs,
    async setPrefs(prefs) {
      state.prefs = { ...state.prefs, ...prefs };
      saveState();
      return state.prefs;
    },
    copy: (text) => navigator.clipboard.writeText(text),
    platform: async () => 'web',
    confirmClose: async () => {},
    otaReady: async () => {},
    otaStatus: async () => ({ enabled: false, phase: 'idle', appVersion: '', channel: 'production', version: null }),
    otaCheck: async () => 'idle',

    async authUser() {
      await auth.ready();
      const err = auth.takeLoginError();
      if (err) setTimeout(() => notice.emit({ message: `Accesso non riuscito: ${err.message}` }), 500);
      const u = auth.user();
      if (u && u.id !== state.userId) onUser(u);
      return u;
    },
    signIn: (provider) => auth.signIn(provider),
    cancelSignIn: async () => auth.cancelSignIn(),
    signOut: () => auth.signOut(),
    deleteAccount: async () => {
      await request('DELETE', '/v1/account');
      state = { ...state, userId: null, activity: [], authors: {}, folders: [], agentRefs: {}, lastSeenActivity: 0, lastLogId: 0 };
      saveState();
      return auth.signOut();
    },
    onAuthChanged: authCh.on,
    onChanged: changed.on,
    onActivity: activityCh.on,
    onCloseRequested: none,
    onVaultStatus: none,
    onVaultConflict: none,
    onVaultConfirm: none,
    onVaultNotice: notice.on,
    onNavigate: none,
    onOtaStatus: none,
    onLoadProgress: none,
  };
}
