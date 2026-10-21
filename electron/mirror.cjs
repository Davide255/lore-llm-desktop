// Remote mirror of the user's cloud spaces (their own and their teams').
//
// Projects load lazily: launch reads one summary row per project (`/v1/projects`,
// once per space) plus the checklist of each, so cards show counts and progress
// without a single other note. A project's listing and note contents are pulled
// when it is opened (`loadProject`), and from then on `sync()` keeps it fresh.
// `files`, `attachments` and `cache` only ever hold loaded projects, so tree
// facts, search, activity diffs and the local vault see a consistent subset.
//
// Contents are refetched only when the etag changes. Attachments are listed but
// their bytes are fetched on demand. `request` takes rel paths of any space
// (see spaces.cjs `scoped`). No Electron imports: tested with node.
const crypto = require('node:crypto');
const { parseKey, projectOf, teamKey } = require('./spaces.cjs');

const isMd = (name) => name.toLowerCase().endsWith('.md');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const inProject = (rel, key) => rel.startsWith(key + '/');

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    }),
  );
}

/**
 * `request(method, path, {query, body})` → JSON; `requestRaw(...)` → `{buffer, headers}` or `{json}`.
 * Errors carry `.status` (0 = offline).
 */
function createMirror({ request, requestRaw }) {
  const cache = new Map(); // note rel -> { etag, content }
  let files = new Map(); // note rel -> { path, size, uploaded, etag }
  let attachments = new Map(); // attachment rel -> { path, size, uploaded, etag }
  const hashes = new Map(); // etag -> sha256 of the note's bytes
  // key -> { key, name, team: {id, name} | null, access, file_count, size, updated_at, checklist: {path, etag} | null }
  let summaries = new Map();
  let teams = []; // [{ id, name, role }]
  const loaded = new Set(); // project keys whose files are mirrored
  const loading = new Map(); // key -> promise
  const checklists = new Map(); // checklist rel of an unloaded project -> { etag, content }
  let fingerprint = null;

  const setNote = (rel, meta, content) => {
    cache.set(rel, { etag: meta.etag, content });
    files.set(rel, { path: rel, size: meta.size, uploaded: meta.uploaded, etag: meta.etag });
  };

  // Writing into a project nobody listed yet (a brand-new one) makes it a loaded project.
  const touch = (rel) => {
    const key = projectOf(rel);
    if (rel.includes('/') && !summaries.has(key)) loaded.add(key);
  };

  const drop = (key) => {
    for (const rel of [...cache.keys()]) if (inProject(rel, key)) cache.delete(rel);
    for (const rel of [...files.keys()]) if (inProject(rel, key)) files.delete(rel);
    for (const rel of [...attachments.keys()]) if (inProject(rel, key)) attachments.delete(rel);
    loaded.delete(key);
  };

  /**
   * Re-list one project and pull changed note contents. Returns what changed:
   * `{ rel, before, after }` for notes, `{ rel, attachment: true }` for attachments.
   * Servers without attachment support ignore `attachments=1`.
   */
  async function syncProject(key) {
    let list;
    try {
      ({ files: list } = await request('GET', '/v1/files', { query: { project: key, attachments: 1 } }));
    } catch (err) {
      // The team was left or deleted: its projects quietly go away, they were not deleted.
      if (parseKey(key).teamId && (err.status === 403 || err.status === 404)) {
        drop(key);
        summaries.delete(key);
        return [];
      }
      throw err;
    }
    const notes = list.filter((f) => isMd(f.path));
    const next = new Map(notes.map((f) => [f.path, f]));
    const nextAtt = new Map(list.filter((f) => !isMd(f.path)).map((f) => [f.path, f]));
    const changes = [];
    const stale = notes.filter((f) => cache.get(f.path)?.etag !== f.etag);
    await pool(stale, 6, async (f) => {
      const before = cache.get(f.path)?.content ?? null;
      try {
        const got = await request('GET', '/v1/file', { query: { path: f.path } });
        cache.set(f.path, { etag: got.etag, content: got.content });
        next.set(f.path, { path: f.path, size: got.size, uploaded: got.uploaded, etag: got.etag });
        changes.push({ rel: f.path, before, after: got.content });
      } catch (err) {
        if (err.status !== 404) throw err;
        next.delete(f.path); // deleted between list and get
      }
    });
    for (const [rel, c] of cache) {
      if (inProject(rel, key) && !next.has(rel)) {
        cache.delete(rel);
        changes.push({ rel, before: c.content, after: null });
      }
    }
    const mine = (m) => [...m.keys()].filter((rel) => inProject(rel, key));
    for (const [rel, a] of nextAtt) if (attachments.get(rel)?.etag !== a.etag) changes.push({ rel, attachment: true });
    for (const rel of mine(attachments)) if (!nextAtt.has(rel)) changes.push({ rel, attachment: true });
    for (const rel of mine(files)) files.delete(rel);
    for (const rel of mine(attachments)) attachments.delete(rel);
    for (const [rel, f] of next) files.set(rel, f);
    for (const [rel, a] of nextAtt) attachments.set(rel, a);
    loaded.add(key);
    return changes;
  }

  const mirror = {
    cache,
    get files() {
      return files;
    },
    get attachments() {
      return attachments;
    },
    get summaries() {
      return summaries;
    },
    get teams() {
      return teams;
    },
    get loaded() {
      return loaded;
    },
    /** Content of a project's checklist.md, loaded or not (for progress on cards). */
    checklistText(key) {
      const s = summaries.get(key);
      const rel = s?.checklist?.path ?? `${key}/checklist.md`;
      return cache.get(rel)?.content ?? checklists.get(rel)?.content ?? null;
    },

    reset() {
      cache.clear();
      files = new Map();
      attachments = new Map();
      hashes.clear();
      summaries = new Map();
      teams = [];
      loaded.clear();
      loading.clear();
      checklists.clear();
      fingerprint = null;
    },

    has(rel) {
      return files.has(rel) || attachments.has(rel);
    },

    /** Every path of the loaded projects, notes and attachments. */
    paths() {
      return [...files.keys(), ...attachments.keys()];
    },

    /**
     * One row per project of every space (`/v1/projects`, plus `?owner=t:<id>` for
     * each team), and the checklist of any unloaded project whose etag moved.
     * Returns the keys of projects that appeared, changed or went away.
     */
    async syncSummaries() {
      ({ teams } = await request('GET', '/v1/teams').catch((err) => {
        if (err.status === 404) return { teams: [] }; // server without teams
        throw err;
      }));
      const spaces = [null, ...teams];
      const rows = await Promise.all(
        spaces.map(async (team) => {
          try {
            const { projects } = await request('GET', '/v1/projects', { query: team ? { owner: `t:${team.id}` } : {} });
            return projects.map((p) => {
              const key = team ? teamKey(p.name, team.id) : p.name;
              return {
                key,
                name: p.name,
                team: team ? { id: team.id, name: team.name } : null,
                access: team ? team.role : 'owner',
                file_count: p.file_count,
                size: p.size,
                updated_at: p.updated_at,
                checklist: p.checklist ? { path: `${key}/${p.checklist.path.slice(p.checklist.path.indexOf('/') + 1)}`, etag: p.checklist.etag } : null,
              };
            });
          } catch (err) {
            // A team just left: its space reads as empty.
            if (team && (err.status === 403 || err.status === 404)) return [];
            throw err;
          }
        }),
      );
      const next = new Map(rows.flat().map((s) => [s.key, s]));
      const changed = [];
      for (const [key, s] of next) {
        const prev = summaries.get(key);
        if (!prev || prev.updated_at !== s.updated_at || prev.file_count !== s.file_count || prev.checklist?.etag !== s.checklist?.etag || prev.access !== s.access || prev.team?.name !== s.team?.name) changed.push(key);
      }
      for (const key of summaries.keys()) if (!next.has(key)) changed.push(key);
      summaries = next;

      // Checklists of unloaded projects, fetched only when their etag moved.
      const want = [...next.values()].filter((s) => s.checklist && !loaded.has(s.key) && checklists.get(s.checklist.path)?.etag !== s.checklist.etag);
      await pool(want, 6, async (s) => {
        try {
          const got = await request('GET', '/v1/file', { query: { path: s.checklist.path } });
          checklists.set(s.checklist.path, { etag: got.etag, content: got.content });
        } catch (err) {
          if (err.status !== 404) throw err;
        }
      });
      for (const rel of [...checklists.keys()]) if (next.get(projectOf(rel))?.checklist?.path !== rel) checklists.delete(rel);
      // Projects gone from the server (deleted elsewhere, team left) stop being mirrored.
      for (const key of [...loaded]) if (!next.has(key) && ![...files.keys(), ...attachments.keys()].some((r) => inProject(r, key))) loaded.delete(key);
      return changed;
    },

    /** Lists one project and downloads its notes; resolves once it is mirrored. */
    async loadProject(key) {
      if (!key || loaded.has(key)) return;
      if (!loading.has(key)) {
        loading.set(
          key,
          syncProject(key).finally(() => loading.delete(key)),
        );
      }
      await loading.get(key);
    },

    /**
     * Re-list the loaded projects (and nothing else), then the summaries.
     * Returns the changes of loaded projects; unloaded ones only refresh their summary.
     */
    async sync() {
      const changes = [];
      for (const key of [...loaded]) changes.push(...(await syncProject(key)));
      await mirror.syncSummaries();
      return changes;
    },

    /**
     * The server's change cursors (own space + each team's) as one fingerprint.
     * Resolves true when something moved since the last call (always on the first).
     * Older servers answer 404: the caller falls back to listing.
     */
    async changed() {
      const { version, scopes = {} } = await request('GET', '/v1/version');
      const next = JSON.stringify([version, Object.entries(scopes).map(([k, v]) => [k, v?.version ?? v]).sort()]);
      if (next === fingerprint) return false;
      fingerprint = next;
      return true;
    },

    async fetchFile(rel) {
      const f = await request('GET', '/v1/file', { query: { path: rel } });
      setNote(rel, f, f.content);
      return f;
    },

    /** rel -> { etag, size, kind, hash? } for the vault planner. Notes carry the hash of their content. */
    snapshot() {
      const out = new Map();
      for (const [rel, f] of files) {
        const c = cache.get(rel);
        let hash;
        if (c && c.etag === f.etag) {
          hash = hashes.get(c.etag);
          if (!hash) hashes.set(c.etag, (hash = sha256(Buffer.from(c.content, 'utf8'))));
        }
        out.set(rel, { etag: f.etag, size: f.size, kind: 'md', hash });
      }
      for (const [rel, a] of attachments) out.set(rel, { etag: a.etag, size: a.size, kind: 'bin' });
      return out;
    },

    /** Current content of a note: the mirror's copy when it is up to date with the listing. */
    async readText(rel) {
      const c = cache.get(rel);
      if (c && files.get(rel)?.etag === c.etag) return { content: c.content, etag: c.etag };
      const f = await mirror.fetchFile(rel);
      return { content: f.content, etag: f.etag };
    },

    async readBlob(rel) {
      const res = await requestRaw('GET', '/v1/blob', { query: { path: rel } });
      const etag = res.headers.get('x-lore-etag');
      if (etag && attachments.has(rel)) attachments.set(rel, { ...attachments.get(rel), etag });
      return { buffer: res.buffer, etag };
    },

    async putText(rel, content, { overwrite, ifMatch } = {}) {
      const res = await request('PUT', '/v1/file', {
        query: { path: rel },
        body: { content, overwrite: !!overwrite, ...(ifMatch ? { if_match: ifMatch } : {}) },
      });
      touch(rel);
      setNote(rel, res.file, content);
      return res.file;
    },

    async putBlob(rel, buffer, { overwrite, ifMatch } = {}) {
      const res = await requestRaw('PUT', '/v1/blob', {
        query: { path: rel, ...(overwrite ? { overwrite: 1 } : {}) },
        body: buffer,
        headers: ifMatch ? { 'if-match': ifMatch } : {},
      });
      const file = res.json.file;
      touch(rel);
      attachments.set(rel, { path: rel, size: file.size, uploaded: file.uploaded, etag: file.etag });
      return file;
    },

    async remove(rel) {
      try {
        await request('DELETE', '/v1/file', { query: { path: rel } });
      } catch (err) {
        if (err.status !== 404) throw err;
      }
      cache.delete(rel);
      files.delete(rel);
      attachments.delete(rel);
    },

    /** Move a file or folder on the server, carrying contents over so it doesn't look like a fresh edit. */
    async move(from, to) {
      await request('POST', '/v1/files/move', { body: { from, to } });
      const under = (k) => k === from || k.startsWith(from + '/');
      for (const k of [...cache.keys()].filter(under)) {
        cache.set(to + k.slice(from.length), cache.get(k));
        cache.delete(k);
      }
      // A renamed project keeps being mirrored under its new key; a move into another project loads it.
      const fromKey = projectOf(from);
      const toKey = projectOf(to);
      if (!from.includes('/')) {
        for (const k of [...files.keys(), ...attachments.keys()].filter(under)) {
          files.delete(k);
          attachments.delete(k);
        }
        loaded.delete(fromKey);
        summaries.delete(fromKey);
      }
      loaded.add(toKey);
      await mirror.sync();
    },
  };
  return mirror;
}

module.exports = { createMirror, isMd, sha256 };
