const { test } = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultGroup, migrateLegacy, overlapping } = require('./vaults.cjs');

/** A VaultSync stand-in: records calls, holds a status. */
function fake(key, status = {}) {
  const calls = [];
  return {
    calls,
    running: false,
    st: { state: 'idle', pending: 0, lastSyncAt: 100, unsynced: [], conflicts: [], error: null, confirm: null, ...status },
    async start() {
      this.running = true;
      calls.push('start');
    },
    stop() {
      this.running = false;
      calls.push('stop');
    },
    async flush() {
      calls.push('flush');
    },
    kick() {
      calls.push('kick');
    },
    async syncNow() {
      calls.push('syncNow');
    },
    async confirm(a) {
      calls.push(`confirm:${a}`);
    },
    status() {
      return this.st;
    },
    abs: (rel) => `/root/${key}/${rel}`,
    async mkdirLocal(rel) {
      calls.push(`mkdir:${rel}`);
    },
    async trashLocalFolder(rel) {
      calls.push(`trash:${rel}`);
    },
    async renameLocal(a, b) {
      calls.push(`rename:${a}>${b}`);
    },
    async rekeyProject(a, b) {
      calls.push(`rekey:${a}>${b}`);
    },
  };
}

function group(extra = {}) {
  const syncs = {};
  const g = new VaultGroup({ create: (key) => (syncs[key] = fake(key, extra[key])) });
  return { g, syncs };
}

test('group: one sync per project, routed by project', async () => {
  const { g, syncs } = group();
  await g.startAll(new Map([['A', { root: '/a' }], ['B', { root: '/b' }]]));
  assert.equal(g.running, true);
  assert.equal(g.abs('A/x.md'), '/root/A/A/x.md');
  assert.equal(g.abs('C/x.md'), null, 'a project without a folder has no path');
  await g.mkdirLocal('B/sub');
  await g.mkdirLocal('C/sub');
  assert.deepEqual(syncs.B.calls.filter((c) => c.startsWith('mkdir')), ['mkdir:B/sub']);
  assert.deepEqual(syncs.A.calls.filter((c) => c.startsWith('mkdir')), []);
  g.kick();
  await g.syncNow();
  assert.ok(syncs.A.calls.includes('syncNow') && syncs.B.calls.includes('kick'));
});

test('group: renames stay inside a project; a project rename is a rekey, a project delete only detaches', async () => {
  const { g, syncs } = group();
  await g.startAll(new Map([['A', { root: '/a' }], ['B', { root: '/b' }]]));
  await g.renameLocal('A/x.md', 'A/y.md');
  await g.renameLocal('A/x.md', 'B/x.md');
  await g.renameLocal('A', 'Z');
  assert.deepEqual(syncs.A.calls.filter((c) => c.startsWith('rename')), ['rename:A/x.md>A/y.md']);
  assert.deepEqual(syncs.B.calls.filter((c) => c.startsWith('rename')), []);

  await g.rekey('A', 'Z');
  assert.ok(g.has('Z') && !g.has('A'));
  assert.deepEqual(syncs.A.calls.filter((c) => c.startsWith('rekey')), ['rekey:A>Z']);
  assert.equal(g.abs('Z/q.md'), '/root/A/Z/q.md');

  await g.trashLocalFolder('B');
  assert.ok(!g.has('B'));
  assert.ok(!syncs.B.calls.some((c) => c.startsWith('trash')), 'the project folder is never trashed');
  assert.ok(syncs.B.calls.includes('stop'));
  await g.trashLocalFolder('Z/sub');
  assert.ok(syncs.A.calls.includes('trash:Z/sub'));
});

test('group: adding a project again restarts it on the new folder', async () => {
  const made = [];
  const g = new VaultGroup({
    create: (key, entry) => {
      const s = fake(key);
      made.push([entry.root, s]);
      return s;
    },
  });
  await g.add('A', { root: '/one' });
  await g.add('A', { root: '/two' });
  assert.equal(made.length, 2);
  assert.ok(made[0][1].calls.includes('stop'));
  assert.equal(g.rootOf('A'), '/two');
});

test('group: status is the worst state, with every conflict and unsynced file', async () => {
  const { g } = group({
    A: { lastSyncAt: 300, pending: 1, unsynced: [{ path: 'a.docx', reason: 'tipo' }], conflicts: [{ path: 'A/n.md', copy: 'c1', at: 10 }] },
    'B@T1': { state: 'error', error: 'Cartella non trovata', lastSyncAt: 200, pending: 2, conflicts: [{ path: 'B/n.md', copy: 'c2', at: 20 }] },
  });
  await g.startAll(new Map([['A', { root: '/a' }], ['B@T1', { root: '/b' }]]));
  const s = g.status();
  assert.equal(s.state, 'error');
  assert.equal(s.pending, 3);
  assert.equal(s.lastSyncAt, 200);
  assert.equal(s.error, 'B: Cartella non trovata');
  assert.deepEqual(s.conflicts.map((c) => c.copy), ['c2', 'c1']);
  assert.equal(s.unsynced[0].path, 'A/a.docx');
  assert.equal(new VaultGroup({ create: () => fake('x') }).status().state, 'off');
});

test('group: a mass-delete answer goes only to the projects that asked', async () => {
  const { g, syncs } = group({ B: { state: 'paused:confirm', confirm: { count: 30, paths: [] } } });
  await g.startAll(new Map([['A', { root: '/a' }], ['B', { root: '/b' }]]));
  await g.confirm('restore');
  assert.ok(syncs.B.calls.includes('confirm:restore'));
  assert.ok(!syncs.A.calls.some((c) => c.startsWith('confirm')));
  assert.equal(g.status().state, 'paused:confirm');
});

test('migrateLegacy: each project takes its slice of the old manifest and its bases', async (t) => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lore-mig-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  const oldState = path.join(dir, 'old');
  await fsp.mkdir(path.join(oldState, 'bases'), { recursive: true });
  await fsp.writeFile(path.join(oldState, 'bases', 'b1'), 'one');
  await fsp.writeFile(path.join(oldState, 'bases', 'b2'), 'two');
  await fsp.writeFile(
    path.join(oldState, 'manifest.json'),
    JSON.stringify({ version: 1, root: '/old', userId: 'u1', files: { 'A/x.md': { etag: 'e', hash: 'h', base: 'b1' }, 'B/y.md': { etag: 'f', hash: 'i', base: 'b2' } }, folders: {} }),
  );
  const entries = new Map([['A', { root: path.join(dir, 'old', 'A'), id: 'ida' }], ['B', { root: path.join(dir, 'old', 'B'), id: 'idb' }]]);
  const stateDirOf = (e) => path.join(dir, 'projects', e.id);
  assert.deepEqual(await migrateLegacy({ oldStateDir: oldState, userId: 'u1', entries, stateDirOf }), ['A', 'B']);
  const a = JSON.parse(await fsp.readFile(path.join(stateDirOf({ id: 'ida' }), 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(a.files), ['A/x.md']);
  assert.equal(a.root, path.resolve(entries.get('A').root));
  assert.equal(await fsp.readFile(path.join(stateDirOf({ id: 'ida' }), 'bases', 'b1'), 'utf8'), 'one');
  await assert.rejects(fsp.access(path.join(stateDirOf({ id: 'ida' }), 'bases', 'b2')));
  // Another account's state is never carried over.
  assert.deepEqual(await migrateLegacy({ oldStateDir: oldState, userId: 'u2', entries, stateDirOf }), []);
});

test('overlapping: a folder can not be, contain or sit inside another project folder', () => {
  const base = path.resolve('/notes/a');
  assert.equal(overlapping(base, [path.resolve('/notes/b')]), undefined);
  assert.ok(overlapping(base, [base]));
  assert.ok(overlapping(path.join(base, 'sub'), [base]));
  assert.ok(overlapping(path.resolve('/notes'), [base]));
  assert.equal(overlapping(path.resolve('/notes/ab'), [base]), undefined);
});
