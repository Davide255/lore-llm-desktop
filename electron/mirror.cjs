// Remote mirror of the user's cloud space: the file listing plus the content of
// every note (powers tree facts, search, activity diffs and the local vault).
// Contents are refetched only when the etag changes. Attachments are listed
// but their bytes are fetched on demand. No Electron imports: tested with node.
const crypto = require('node:crypto');

const isMd = (name) => name.toLowerCase().endsWith('.md');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

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

  const setNote = (rel, meta, content) => {
    cache.set(rel, { etag: meta.etag, content });
    files.set(rel, { path: rel, size: meta.size, uploaded: meta.uploaded, etag: meta.etag });
  };

  const mirror = {
    cache,
    get files() {
      return files;
    },
    get attachments() {
      return attachments;
    },

    reset() {
      cache.clear();
      files = new Map();
      attachments = new Map();
      hashes.clear();
    },

    has(rel) {
      return files.has(rel) || attachments.has(rel);
    },

    /** Every path, notes and attachments. */
    paths() {
      return [...files.keys(), ...attachments.keys()];
    },

    async fetchFile(rel) {
      const f = await request('GET', '/v1/file', { query: { path: rel } });
      setNote(rel, f, f.content);
      return f;
    },

    /**
     * Re-list the space and pull changed note contents. Returns what changed:
     * `{ rel, before, after }` for notes, `{ rel, attachment: true }` for attachments.
     * Servers without attachment support ignore `attachments=1`.
     */
    async sync() {
      const { files: list } = await request('GET', '/v1/files', { query: { attachments: 1 } });
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
        if (!next.has(rel)) {
          cache.delete(rel);
          changes.push({ rel, before: c.content, after: null });
        }
      }
      for (const [rel, a] of nextAtt) if (attachments.get(rel)?.etag !== a.etag) changes.push({ rel, attachment: true });
      for (const rel of attachments.keys()) if (!nextAtt.has(rel)) changes.push({ rel, attachment: true });
      files = next;
      attachments = nextAtt;
      return changes;
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
      await mirror.sync();
    },
  };
  return mirror;
}

module.exports = { createMirror, isMd, sha256 };
