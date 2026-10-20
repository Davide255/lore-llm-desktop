const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createMirror } = require('./mirror.cjs');
const { VaultSync } = require('./vault.cjs');

/** In-memory Worker: the /v1 files API with R2's etag semantics (MD5 of the body). */
function fakeServer({ attachments = true } = {}) {
  const objects = new Map(); // rel -> Buffer
  const etag = (buf) => crypto.createHash('md5').update(buf).digest('hex');
  const meta = (rel) => ({ path: rel, size: objects.get(rel).length, uploaded: '2026-10-14T10:00:00.000Z', etag: etag(objects.get(rel)) });
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const isMd = (p) => p.toLowerCase().endsWith('.md');
  const counts = { get: 0, list: 0 };
  const put = (rel, buf, { overwrite, ifMatch }) => {
    const cur = objects.get(rel);
    if (cur && !overwrite) throw fail(400, 'Esiste già un file con questo nome');
    if (ifMatch && (!cur || etag(cur) !== ifMatch)) throw fail(409, 'conflict');
    objects.set(rel, buf);
    return { action: cur ? 'UPDATE' : 'CREATE', file: meta(rel) };
  };
  const server = {
    objects,
    counts,
    async request(method, p, { query = {}, body } = {}) {
      if (p === '/v1/files' && method === 'GET') {
        counts.list++;
        return { files: [...objects.keys()].filter((k) => (attachments && query.attachments) || isMd(k)).sort().map(meta) };
      }
      if (p === '/v1/file') {
        const rel = query.path;
        if (method === 'GET') {
          if (!isMd(rel)) throw fail(400, 'only .md files are allowed');
          if (!objects.has(rel)) throw fail(404, 'Not found');
          counts.get++;
          return { ...meta(rel), content: objects.get(rel).toString('utf8') };
        }
        if (method === 'PUT') return put(rel, Buffer.from(body.content, 'utf8'), { overwrite: body.overwrite, ifMatch: body.if_match });
        if (method === 'DELETE') {
          if (!objects.delete(rel)) throw fail(404, 'Not found');
          return { ok: true };
        }
      }
      if (p === '/v1/files/move' && method === 'POST') {
        const { from, to } = body;
        for (const k of [...objects.keys()]) {
          if (k === from || k.startsWith(from + '/')) {
            objects.set(to + k.slice(from.length), objects.get(k));
            objects.delete(k);
          }
        }
        return { ok: true };
      }
      throw fail(404, `no route ${method} ${p}`);
    },
    async requestRaw(method, p, { query = {}, body, headers = {} } = {}) {
      if (p !== '/v1/blob') throw fail(404, 'no route');
      if (method === 'GET') {
        if (!objects.has(query.path)) throw fail(404, 'Not found');
        return { status: 200, headers: new Map([['x-lore-etag', etag(objects.get(query.path))]]), buffer: objects.get(query.path) };
      }
      return { status: 201, headers: new Map(), json: put(query.path, Buffer.from(body), { overwrite: !!query.overwrite, ifMatch: headers['if-match'] }) };
    },
  };
  return server;
}

test('sync lists notes and attachments, fetching only changed notes', async () => {
  const server = fakeServer();
  server.objects.set('P/a.md', Buffer.from('a'));
  server.objects.set('P/img/x.png', Buffer.from([1, 2, 3]));
  const mirror = createMirror(server);
  const first = await mirror.sync();
  assert.deepEqual(first.map((c) => c.rel).sort(), ['P/a.md', 'P/img/x.png']);
  assert.equal(server.counts.get, 1); // attachment bytes are not fetched
  assert.deepEqual([...mirror.files.keys()], ['P/a.md']);
  assert.deepEqual([...mirror.attachments.keys()], ['P/img/x.png']);

  const snap = mirror.snapshot();
  assert.equal(snap.get('P/a.md').hash, crypto.createHash('sha256').update('a').digest('hex'));
  assert.equal(snap.get('P/img/x.png').kind, 'bin');

  assert.deepEqual(await mirror.sync(), []);
  assert.equal(server.counts.get, 1);

  server.objects.set('P/a.md', Buffer.from('a2'));
  server.objects.delete('P/img/x.png');
  const changes = await mirror.sync();
  assert.deepEqual(changes, [{ rel: 'P/a.md', before: 'a', after: 'a2' }, { rel: 'P/img/x.png', attachment: true }]);
});

test('works with servers that know nothing about attachments', async () => {
  const server = fakeServer({ attachments: false });
  server.objects.set('P/a.md', Buffer.from('a'));
  server.objects.set('P/img/x.png', Buffer.from([1]));
  const mirror = createMirror(server);
  await mirror.sync();
  assert.deepEqual(mirror.paths(), ['P/a.md']);
});

test('own writes and moves do not show up as changes', async () => {
  const server = fakeServer();
  server.objects.set('P/a.md', Buffer.from('a'));
  const mirror = createMirror(server);
  await mirror.sync();
  const file = await mirror.putText('P/a.md', 'mine', { overwrite: true, ifMatch: mirror.files.get('P/a.md').etag });
  assert.equal(mirror.cache.get('P/a.md').etag, file.etag);
  assert.deepEqual(await mirror.sync(), []);
  await mirror.move('P', 'Q');
  assert.deepEqual(mirror.paths(), ['Q/a.md']);
  assert.equal(mirror.cache.get('Q/a.md').content, 'mine');
  // a stale etag is refused
  await assert.rejects(mirror.putText('Q/a.md', 'x', { overwrite: true, ifMatch: 'stale' }), { status: 409 });
});

test('vault over the real mirror: notes and attachments both ways', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lore-mirror-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'vault');
  await fsp.mkdir(root);
  const server = fakeServer();
  server.objects.set('P/a.md', Buffer.from('# A\n'));
  server.objects.set('P/img/x.png', Buffer.from([137, 80, 78, 71]));
  const mirror = createMirror(server);
  await mirror.sync();
  const engine = new VaultSync({ root, stateDir: path.join(dir, 'state'), userId: 'u1', server: 'test', mirror, trash: (abs) => fsp.rm(abs), debounceMs: 20 });
  t.after(() => engine.stop());
  await engine.start();
  assert.equal(fs.readFileSync(path.join(root, 'P/a.md'), 'utf8'), '# A\n');
  assert.deepEqual([...fs.readFileSync(path.join(root, 'P/img/x.png'))], [137, 80, 78, 71]);

  // Obsidian pastes an image and links it.
  await fsp.writeFile(path.join(root, 'P/img/new.png'), Buffer.from([1, 2, 3, 4]));
  await fsp.writeFile(path.join(root, 'P/a.md'), '# A\n\n![[new.png]]\n');
  await engine.syncNow();
  assert.deepEqual([...server.objects.get('P/img/new.png')], [1, 2, 3, 4]);
  assert.equal(server.objects.get('P/a.md').toString(), '# A\n\n![[new.png]]\n');

  // Cloud-side folder move (Lore UI, another device) → moved on disk, nothing re-uploaded.
  await mirror.move('P/img', 'P/media');
  await engine.syncNow();
  assert.ok(fs.existsSync(path.join(root, 'P/media/new.png')));
  assert.ok(!fs.existsSync(path.join(root, 'P/img')));
  assert.equal(engine.status().state, 'idle');
});
