const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createMirror } = require('./mirror.cjs');
const { scoped } = require('./spaces.cjs');
const { VaultSync } = require('./vault.cjs');

/**
 * In-memory Worker: the /v1 files API with R2's etag semantics (MD5 of the body),
 * one space per owner (`objects` is the user's own, `space('t:<id>')` a team's),
 * project summaries, teams and per-scope change cursors.
 */
function fakeServer({ attachments = true, teams = [] } = {}) {
  const spaces = new Map([['me', new Map()]]);
  const space = (owner = 'me') => {
    if (!spaces.has(owner)) spaces.set(owner, new Map());
    return spaces.get(owner);
  };
  const versions = new Map(); // owner -> version
  const bump = (owner) => versions.set(owner, (versions.get(owner) ?? 0) + 1);
  const etag = (buf) => crypto.createHash('md5').update(buf).digest('hex');
  const fail = (status, message) => Object.assign(new Error(message), { status });
  const isMd = (p) => p.toLowerCase().endsWith('.md');
  const counts = { get: 0, list: 0, projects: 0, version: 0, requests: 0 };
  const log = [];
  const ownerOf = (query) => {
    const o = query.owner ?? 'me';
    if (o !== 'me' && !teams.some((t) => `t:${t.id}` === o)) throw fail(404, 'Not found');
    return o;
  };
  const put = (objects, rel, buf, { overwrite, ifMatch }) => {
    const cur = objects.get(rel);
    if (cur && !overwrite) throw fail(400, 'Esiste già un file con questo nome');
    if (ifMatch && (!cur || etag(cur) !== ifMatch)) throw fail(409, 'conflict');
    objects.set(rel, buf);
    const meta = { path: rel, size: buf.length, uploaded: '2026-10-14T10:00:00.000Z', etag: etag(buf) };
    return { action: cur ? 'UPDATE' : 'CREATE', file: meta };
  };
  const server = {
    get objects() {
      return space('me');
    },
    space,
    teams,
    counts,
    log,
    bump,
    async request(method, p, { query = {}, body } = {}) {
      counts.requests++;
      log.push(`${method} ${p}${query.owner ? ` ${query.owner}` : ''}${query.project ? ` project=${query.project}` : ''}`);
      if (p === '/v1/teams' && method === 'GET') return { teams: teams.map((t) => ({ ...t })) };
      if (p === '/v1/version' && method === 'GET') {
        counts.version++;
        return { version: versions.get('me') ?? 0, scopes: Object.fromEntries(teams.map((t) => [`t:${t.id}`, { version: versions.get(`t:${t.id}`) ?? 0 }])) };
      }
      const owner = ownerOf(query);
      const objects = space(owner);
      const meta = (rel) => ({ path: rel, size: objects.get(rel).length, uploaded: '2026-10-14T10:00:00.000Z', etag: etag(objects.get(rel)) });
      const write = (fn) => {
        const res = fn();
        bump(owner);
        return res;
      };
      if (p === '/v1/projects' && method === 'GET') {
        counts.projects++;
        const rows = new Map();
        for (const rel of [...objects.keys()].filter(isMd).sort()) {
          const name = rel.slice(0, rel.indexOf('/'));
          const row = rows.get(name) ?? { name, file_count: 0, size: 0, updated_at: '', checklist: null };
          rows.set(name, row);
          row.size += objects.get(rel).length;
          if (rel.toLowerCase() === `${name}/index.md`.toLowerCase()) continue;
          row.file_count++;
          row.updated_at = `${row.file_count}:${row.size}`; // any value that moves with the content
          if (rel.toLowerCase() === `${name}/checklist.md`.toLowerCase()) row.checklist = { path: rel, etag: etag(objects.get(rel)) };
        }
        return { projects: [...rows.values()] };
      }
      if (p === '/v1/files' && method === 'GET') {
        counts.list++;
        return {
          files: [...objects.keys()]
            .filter((k) => (attachments && query.attachments) || isMd(k))
            .filter((k) => !query.project || k.startsWith(query.project + '/'))
            .sort()
            .map(meta),
        };
      }
      if (p === '/v1/file') {
        const rel = query.path;
        if (method === 'GET') {
          if (!isMd(rel)) throw fail(400, 'only .md files are allowed');
          if (!objects.has(rel)) throw fail(404, 'Not found');
          counts.get++;
          return { ...meta(rel), content: objects.get(rel).toString('utf8') };
        }
        if (method === 'PUT') return write(() => put(objects, rel, Buffer.from(body.content, 'utf8'), { overwrite: body.overwrite, ifMatch: body.if_match }));
        if (method === 'DELETE') {
          if (!objects.has(rel)) throw fail(404, 'Not found');
          return write(() => (objects.delete(rel), { ok: true }));
        }
      }
      if (p === '/v1/files/move' && method === 'POST') {
        const { from, to } = body;
        return write(() => {
          for (const k of [...objects.keys()]) {
            if (k === from || k.startsWith(from + '/')) {
              objects.set(to + k.slice(from.length), objects.get(k));
              objects.delete(k);
            }
          }
          return { ok: true };
        });
      }
      throw fail(404, `no route ${method} ${p}`);
    },
    async requestRaw(method, p, { query = {}, body, headers = {} } = {}) {
      if (p !== '/v1/blob') throw fail(404, 'no route');
      const owner = ownerOf(query);
      const objects = space(owner);
      if (method === 'GET') {
        if (!objects.has(query.path)) throw fail(404, 'Not found');
        return { status: 200, headers: new Map([['x-lore-etag', etag(objects.get(query.path))]]), buffer: objects.get(query.path) };
      }
      const json = put(objects, query.path, Buffer.from(body), { overwrite: !!query.overwrite, ifMatch: headers['if-match'] });
      bump(owner);
      return { status: 201, headers: new Map(), json };
    },
  };
  return server;
}

/** The mirror as main.cjs builds it: rel paths of any space, translated by `scoped`. */
const mirrorOf = (server) => createMirror({ request: scoped(server.request), requestRaw: scoped(server.requestRaw) });

/** Summaries + every project loaded: what the old eager mirror held. */
async function loadAll(mirror) {
  await mirror.syncSummaries();
  for (const key of mirror.summaries.keys()) await mirror.loadProject(key);
}

test('a loaded project lists notes and attachments, fetching only changed notes', async () => {
  const server = fakeServer();
  server.objects.set('P/a.md', Buffer.from('a'));
  server.objects.set('P/img/x.png', Buffer.from([1, 2, 3]));
  const mirror = mirrorOf(server);
  await loadAll(mirror);
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

test('launch reads summaries and checklists only: no other note is downloaded', async () => {
  const server = fakeServer();
  server.objects.set('A/a.md', Buffer.from('a'));
  server.objects.set('A/checklist.md', Buffer.from('- [x] one\n- [ ] two\n'));
  server.objects.set('B/b.md', Buffer.from('b'));
  server.objects.set('B/c.md', Buffer.from('c'));
  const mirror = mirrorOf(server);
  await mirror.syncSummaries();
  assert.deepEqual([...mirror.summaries.keys()].sort(), ['A', 'B']);
  assert.equal(mirror.summaries.get('B').file_count, 2);
  assert.equal(server.counts.list, 0);
  assert.equal(server.counts.get, 1, 'only the checklist');
  assert.equal(mirror.checklistText('A'), '- [x] one\n- [ ] two\n');
  assert.deepEqual(mirror.paths(), []);
  // The checklist is not fetched again while its etag holds.
  await mirror.syncSummaries();
  assert.equal(server.counts.get, 1);
});

test('loadProject lists only that project, once', async () => {
  const server = fakeServer();
  server.objects.set('A/a.md', Buffer.from('a'));
  server.objects.set('B/b.md', Buffer.from('b'));
  const mirror = mirrorOf(server);
  await mirror.syncSummaries();
  await Promise.all([mirror.loadProject('B'), mirror.loadProject('B')]);
  assert.deepEqual(server.log.filter((l) => l.startsWith('GET /v1/files')), ['GET /v1/files project=B']);
  assert.deepEqual(mirror.paths(), ['B/b.md']);
  assert.deepEqual([...mirror.loaded], ['B']);
  await mirror.loadProject('B');
  assert.equal(server.counts.list, 1);
});

test('sync re-lists only loaded projects; an unloaded project only refreshes its summary', async () => {
  const server = fakeServer();
  server.objects.set('A/a.md', Buffer.from('a'));
  server.objects.set('B/b.md', Buffer.from('b'));
  const mirror = mirrorOf(server);
  await mirror.syncSummaries();
  await mirror.loadProject('A');
  const gets = server.counts.get;
  server.objects.set('B/new.md', Buffer.from('new'));
  assert.deepEqual(await mirror.sync(), []);
  assert.equal(server.counts.get, gets, 'nothing of B downloaded');
  assert.ok(server.log.every((l) => l !== 'GET /v1/files project=B'));
  assert.equal(mirror.summaries.get('B').file_count, 2);
  assert.ok(!mirror.has('B/new.md'));
});

test('an unchanged poll is one request', async () => {
  const server = fakeServer({ teams: [{ id: 'T1', name: 'Squadra', role: 'editor' }] });
  server.objects.set('A/a.md', Buffer.from('a'));
  const mirror = mirrorOf(server);
  assert.equal(await mirror.changed(), true); // first look
  await loadAll(mirror);
  const before = server.counts.requests;
  assert.equal(await mirror.changed(), false);
  assert.equal(server.counts.requests, before + 1);
  // A teammate writes in the team's space: its cursor moves the fingerprint.
  server.space('t:T1').set('X/x.md', Buffer.from('x'));
  server.bump('t:T1');
  assert.equal(await mirror.changed(), true);
});

test('team projects: keys carry the team, requests carry ?owner=', async () => {
  const server = fakeServer({ teams: [{ id: 'T1', name: 'Squadra', role: 'viewer' }] });
  server.objects.set('P/a.md', Buffer.from('mine'));
  server.space('t:T1').set('P/a.md', Buffer.from('theirs'));
  server.space('t:T1').set('P/img/x.png', Buffer.from([1]));
  const mirror = mirrorOf(server);
  await mirror.syncSummaries();
  assert.deepEqual([...mirror.summaries.keys()].sort(), ['P', 'P@T1']);
  const s = mirror.summaries.get('P@T1');
  assert.deepEqual([s.name, s.team, s.access], ['P', { id: 'T1', name: 'Squadra' }, 'viewer']);
  assert.ok(server.log.includes('GET /v1/projects t:T1'));

  await mirror.loadProject('P@T1');
  assert.ok(server.log.includes('GET /v1/files t:T1 project=P'));
  assert.deepEqual(mirror.paths().sort(), ['P@T1/a.md', 'P@T1/img/x.png']);
  assert.equal((await mirror.readText('P@T1/a.md')).content, 'theirs');
  assert.deepEqual([...(await mirror.readBlob('P@T1/img/x.png')).buffer], [1]);

  await mirror.putText('P@T1/b.md', 'new', { overwrite: false });
  assert.equal(server.space('t:T1').get('P/b.md').toString(), 'new');
  assert.ok(!server.objects.has('P/b.md'), 'the personal project is untouched');
  // Moving across spaces is refused before it reaches the server.
  await assert.rejects(mirror.move('P@T1/b.md', 'P/b.md'), /spazi diversi/);
});

test('leaving a team takes its projects away without reporting deletions', async () => {
  const server = fakeServer({ teams: [{ id: 'T1', name: 'Squadra', role: 'editor' }] });
  server.space('t:T1').set('X/x.md', Buffer.from('x'));
  const mirror = mirrorOf(server);
  await loadAll(mirror);
  assert.deepEqual(mirror.paths(), ['X@T1/x.md']);
  server.teams.length = 0;
  assert.deepEqual(await mirror.sync(), []);
  assert.deepEqual(mirror.paths(), []);
  assert.deepEqual([...mirror.summaries.keys()], []);
  assert.deepEqual([...mirror.loaded], []);
});

test('works with servers that know nothing about attachments', async () => {
  const server = fakeServer({ attachments: false });
  server.objects.set('P/a.md', Buffer.from('a'));
  server.objects.set('P/img/x.png', Buffer.from([1]));
  const mirror = mirrorOf(server);
  await loadAll(mirror);
  assert.deepEqual(mirror.paths(), ['P/a.md']);
});

test('own writes and moves do not show up as changes', async () => {
  const server = fakeServer();
  server.objects.set('P/a.md', Buffer.from('a'));
  const mirror = mirrorOf(server);
  await loadAll(mirror);
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
  let engine;
  // Stop the engine before removing its folders: a pass started by the watcher may still be running.
  t.after(async () => {
    engine?.stop();
    await engine?.queue;
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  const root = path.join(dir, 'vault');
  await fsp.mkdir(root);
  const server = fakeServer();
  server.objects.set('P/a.md', Buffer.from('# A\n'));
  server.objects.set('P/img/x.png', Buffer.from([137, 80, 78, 71]));
  const mirror = mirrorOf(server);
  await loadAll(mirror);
  engine = new VaultSync({ root, stateDir: path.join(dir, 'state'), userId: 'u1', server: 'test', mirror, trash: (abs) => fsp.rm(abs), debounceMs: 20 });
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
