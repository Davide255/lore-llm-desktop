// Remote mirror of the user's cloud space for the browser build: a port of
// electron/mirror.cjs without the vault-only parts (snapshot hashes).
import { request, requestRaw } from './api';

export const isMd = (name: string) => name.toLowerCase().endsWith('.md');

export interface Meta {
  path: string;
  size: number;
  uploaded: string;
  etag: string;
}

export interface Change {
  rel: string;
  before?: string | null;
  after?: string | null;
  attachment?: boolean;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

export function createMirror() {
  const cache = new Map<string, { etag: string; content: string }>();
  let files = new Map<string, Meta>();
  let attachments = new Map<string, Meta>();

  const setNote = (rel: string, meta: Omit<Meta, 'path'>, content: string) => {
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
    },

    has(rel: string) {
      return files.has(rel) || attachments.has(rel);
    },

    paths() {
      return [...files.keys(), ...attachments.keys()];
    },

    async fetchFile(rel: string): Promise<Meta & { content: string }> {
      const f = await request('GET', '/v1/file', { query: { path: rel } });
      setNote(rel, f, f.content);
      return f;
    },

    /** Re-list the space and pull changed note contents; returns what changed. */
    async sync(): Promise<Change[]> {
      const { files: list } = await request<{ files: Meta[] }>('GET', '/v1/files', { query: { attachments: 1 } });
      const notes = list.filter((f) => isMd(f.path));
      const next = new Map(notes.map((f) => [f.path, f]));
      const nextAtt = new Map(list.filter((f) => !isMd(f.path)).map((f) => [f.path, f]));
      const changes: Change[] = [];
      const stale = notes.filter((f) => cache.get(f.path)?.etag !== f.etag);
      await pool(stale, 6, async (f) => {
        const before = cache.get(f.path)?.content ?? null;
        try {
          const got = await request('GET', '/v1/file', { query: { path: f.path } });
          cache.set(f.path, { etag: got.etag, content: got.content });
          next.set(f.path, { path: f.path, size: got.size, uploaded: got.uploaded, etag: got.etag });
          changes.push({ rel: f.path, before, after: got.content });
        } catch (err) {
          if ((err as { status?: number }).status !== 404) throw err;
          next.delete(f.path);
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

    async readBlob(rel: string): Promise<{ blob: Blob; etag: string | null }> {
      const res = await requestRaw('GET', '/v1/blob', { query: { path: rel } });
      const etag = res.headers.get('x-lore-etag');
      if (etag && attachments.has(rel)) attachments.set(rel, { ...attachments.get(rel)!, etag });
      return { blob: res.blob!, etag };
    },

    async putText(rel: string, content: string, { overwrite, ifMatch }: { overwrite?: boolean; ifMatch?: string } = {}): Promise<Meta> {
      const res = await request('PUT', '/v1/file', {
        query: { path: rel },
        body: { content, overwrite: !!overwrite, ...(ifMatch ? { if_match: ifMatch } : {}) },
      });
      setNote(rel, res.file, content);
      return res.file;
    },

    async putBlob(rel: string, blob: Blob, { overwrite, onProgress }: { overwrite?: boolean; onProgress?: (sent: number, total: number) => void } = {}): Promise<Meta> {
      const res = await requestRaw('PUT', '/v1/blob', { query: { path: rel, ...(overwrite ? { overwrite: 1 } : {}) }, body: blob, onProgress });
      const file = res.json.file;
      attachments.set(rel, { path: rel, size: file.size, uploaded: file.uploaded, etag: file.etag });
      return file;
    },

    /** Move a file or folder on the server, carrying contents over so it doesn't look like a fresh edit. */
    async move(from: string, to: string) {
      await request('POST', '/v1/files/move', { body: { from, to } });
      const under = (k: string) => k === from || k.startsWith(from + '/');
      for (const k of [...cache.keys()].filter(under)) {
        cache.set(to + k.slice(from.length), cache.get(k)!);
        cache.delete(k);
      }
      await mirror.sync();
    },
  };
  return mirror;
}
