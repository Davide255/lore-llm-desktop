const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { VaultSync, classify, planSync, folderNames, conflictName } = require('./vault.cjs');

const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s)).digest('hex');

// ---------------------------------------------------------------- classify
test('classify: what syncs, what is read-only, what stays local', () => {
  assert.equal(classify('P/a.md').status, 'sync');
  assert.equal(classify('P/img/a.PNG').status, 'sync');
  assert.equal(classify('P/index.md').status, 'readonly');
  assert.equal(classify('P/sub/index.md').status, 'sync');
  for (const rel of ['.obsidian/app.json', 'P/.trash/a.md', '.lore-sync/vault.json', 'P/.DS_Store', 'P/Thumbs.db', 'P/a.md.swp']) {
    assert.equal(classify(rel).status, 'ignore', rel);
  }
  assert.equal(classify('note.md').status, 'unsynced'); // vault root
  assert.equal(classify('P/a.docx').status, 'unsynced');
  assert.equal(classify('P/a.md', 2 * 1024 * 1024).status, 'unsynced');
  assert.equal(classify('P/a.png', 2 * 1024 * 1024).status, 'sync');
  assert.equal(classify('-bad/a.md').status, 'unsynced');
  assert.equal(classify(`P/${'x'.repeat(130)}.md`).status, 'unsynced');
});

// ---------------------------------------------------------------- planner
const R = (entries) => new Map(Object.entries(entries).map(([k, v]) => [k, { kind: k.endsWith('.md') ? 'md' : 'bin', ...v }]));
const L = (entries) => new Map(Object.entries(entries).map(([k, v]) => [k, { kind: k.endsWith('.md') ? 'md' : 'bin', readonly: /^[^/]+\/index\.md$/i.test(k), ...v }]));
const plan = (manifest, remote, local, extra = {}) => planSync({ manifest, remote: R(remote), local: L(local), ...extra }).map(({ type, rel, from, to, create, folder }) => ({ type, ...(rel ? { rel } : { from, to }), ...(create ? { create } : {}), ...(folder ? { folder } : {}) }));

test('planner: the decision table', () => {
  const m = { 'P/a.md': { etag: 'e1', hash: 'h1' } };
  // in sync
  assert.deepEqual(plan(m, { 'P/a.md': { etag: 'e1' } }, { 'P/a.md': { hash: 'h1' } }), []);
  // remote edit → pull; local edit → push; both → merge (or adopt when equal)
  assert.deepEqual(plan(m, { 'P/a.md': { etag: 'e2' } }, { 'P/a.md': { hash: 'h1' } }), [{ type: 'pull', rel: 'P/a.md' }]);
  assert.deepEqual(plan(m, { 'P/a.md': { etag: 'e1' } }, { 'P/a.md': { hash: 'h2' } }), [{ type: 'push', rel: 'P/a.md' }]);
  assert.deepEqual(plan(m, { 'P/a.md': { etag: 'e2' } }, { 'P/a.md': { hash: 'h2' } }), [{ type: 'merge', rel: 'P/a.md' }]);
  assert.deepEqual(plan(m, { 'P/a.md': { etag: 'e2', hash: 'h2' } }, { 'P/a.md': { hash: 'h2' } }), [{ type: 'adopt', rel: 'P/a.md' }]);
  // deleted in the cloud: trash locally, unless edited locally (then it comes back)
  assert.deepEqual(plan(m, {}, { 'P/a.md': { hash: 'h1' } }), [{ type: 'trashLocal', rel: 'P/a.md' }]);
  assert.deepEqual(plan(m, {}, { 'P/a.md': { hash: 'h2' } }), [{ type: 'push', rel: 'P/a.md', create: true }]);
  // deleted on disk: delete in the cloud, unless edited in the cloud (then it comes back)
  assert.deepEqual(plan(m, { 'P/a.md': { etag: 'e1' } }, {}), [{ type: 'deleteRemote', rel: 'P/a.md' }]);
  assert.deepEqual(plan(m, { 'P/a.md': { etag: 'e2' } }, {}), [{ type: 'pull', rel: 'P/a.md' }]);
  assert.deepEqual(plan(m, {}, {}), [{ type: 'forget', rel: 'P/a.md' }]);
  // new on one side, new on both
  assert.deepEqual(plan({}, {}, { 'P/n.md': { hash: 'x' } }), [{ type: 'push', rel: 'P/n.md', create: true }]);
  assert.deepEqual(plan({}, { 'P/n.md': { etag: 'e' } }, {}), [{ type: 'pull', rel: 'P/n.md' }]);
  assert.deepEqual(plan({}, { 'P/n.md': { etag: 'e', hash: 'x' } }, { 'P/n.md': { hash: 'x' } }), [{ type: 'adopt', rel: 'P/n.md' }]);
  assert.deepEqual(plan({}, { 'P/n.md': { etag: 'e', hash: 'y' } }, { 'P/n.md': { hash: 'x' } }), [{ type: 'merge', rel: 'P/n.md' }]);
});

test('planner: index.md only ever follows the cloud', () => {
  const m = { 'P/index.md': { etag: 'i1', hash: 'h1' } };
  assert.deepEqual(plan(m, { 'P/index.md': { etag: 'i1' } }, { 'P/index.md': { hash: 'h1' } }), []);
  // a local edit is reverted, never pushed
  assert.deepEqual(plan(m, { 'P/index.md': { etag: 'i1' } }, { 'P/index.md': { hash: 'hacked' } }), [{ type: 'pull', rel: 'P/index.md' }]);
  // a local delete is restored
  assert.deepEqual(plan(m, { 'P/index.md': { etag: 'i1' } }, {}), [{ type: 'pull', rel: 'P/index.md' }]);
  // a hand-made index.md in a new project stays local
  assert.deepEqual(plan({}, {}, { 'Q/index.md': { hash: 'x' } }), [{ type: 'unsynced', rel: 'Q/index.md' }]);
});

test('planner: local renames and folder moves become server moves', () => {
  const m = { 'P/a.md': { etag: 'e1', hash: 'h1' }, 'P/sub/b.md': { etag: 'e2', hash: 'h2' }, 'P/sub/c.png': { etag: 'e3', hash: 'h3' } };
  const remote = { 'P/a.md': { etag: 'e1' }, 'P/sub/b.md': { etag: 'e2' }, 'P/sub/c.png': { etag: 'e3' } };
  // file rename
  assert.deepEqual(plan(m, remote, { 'P/b-renamed.md': { hash: 'h1' }, 'P/sub/b.md': { hash: 'h2' }, 'P/sub/c.png': { hash: 'h3' } }), [
    { type: 'moveRemote', from: 'P/a.md', to: 'P/b-renamed.md' },
  ]);
  // whole folder renamed → one move
  assert.deepEqual(plan(m, remote, { 'P/a.md': { hash: 'h1' }, 'P/other/b.md': { hash: 'h2' }, 'P/other/c.png': { hash: 'h3' } }), [
    { type: 'moveRemote', from: 'P/sub', to: 'P/other', folder: true },
  ]);
  // case-only rename
  assert.deepEqual(plan({ 'P/Note.md': { etag: 'e', hash: 'h' } }, { 'P/Note.md': { etag: 'e' } }, { 'P/note.md': { hash: 'h' } }), [
    { type: 'moveRemote', from: 'P/Note.md', to: 'P/note.md' },
  ]);
  // ambiguous (two identical empty files) → no guessing
  const twin = { 'P/x.md': { etag: 'e1', hash: 'empty' }, 'P/y.md': { etag: 'e2', hash: 'empty' } };
  const moved = plan(twin, { 'P/x.md': { etag: 'e1' }, 'P/y.md': { etag: 'e2' } }, { 'P/z.md': { hash: 'empty' }, 'P/y.md': { hash: 'empty' } });
  assert.deepEqual(moved, [{ type: 'moveRemote', from: 'P/x.md', to: 'P/z.md' }]);
});

test('planner: cloud renames move the local file', () => {
  const m = { 'P/a.md': { etag: 'e1', hash: 'h1' } };
  assert.deepEqual(plan(m, { 'Q/a.md': { etag: 'e1' } }, { 'P/a.md': { hash: 'h1' } }), [{ type: 'moveLocal', from: 'P/a.md', to: 'Q/a.md' }]);
  // edited locally meanwhile: no move guess; the edit survives as a re-created file
  assert.deepEqual(plan(m, { 'Q/a.md': { etag: 'e1' } }, { 'P/a.md': { hash: 'h2' } }), [
    { type: 'push', rel: 'P/a.md', create: true },
    { type: 'pull', rel: 'Q/a.md' },
  ]);
});

test('planner: case collisions on case-insensitive disks and refused files', () => {
  assert.deepEqual(plan({}, { 'P/A.md': { etag: 'e1' }, 'P/a.md': { etag: 'e2' } }, {}, { caseInsensitive: true }), [
    { type: 'pull', rel: 'P/A.md' },
    { type: 'unsynced', rel: 'P/a.md' },
  ]);
  assert.deepEqual(plan({}, {}, { 'P/n.md': { hash: 'x' } }, { rejected: new Map([['P/n.md', 'x']]) }), []);
});

test('conflict copies get a readable, unique name', () => {
  const d = new Date(2026, 9, 14, 15, 30);
  assert.equal(conflictName('P/notes/a.md', 'Claude', d, () => false), 'P/notes/a (conflitto Claude 2026-10-14 15.30).md');
  const taken = new Set(['P/a (conflitto cloud 2026-10-14 15.30).md']);
  assert.equal(conflictName('P/a.md', undefined, d, (p) => taken.has(p)), 'P/a (conflitto cloud 2026-10-14 15.30 2).md');
});

// ---------------------------------------------------------------- engine
/** In-memory cloud with the Worker's etag semantics. */
function fakeMirror() {
  let n = 0;
  const store = new Map(); // rel -> { etag, data: Buffer, kind }
  const calls = [];
  const err = (status, message) => Object.assign(new Error(message), { status });
  const put = (rel, data, { overwrite, ifMatch } = {}) => {
    const cur = store.get(rel);
    if (cur && !overwrite) throw err(400, 'Esiste già un file con questo nome');
    if (ifMatch && cur?.etag !== ifMatch) throw err(409, 'conflict');
    const etag = `e${++n}`;
    store.set(rel, { etag, data, kind: rel.endsWith('.md') ? 'md' : 'bin' });
    return { path: rel, etag, size: data.length };
  };
  const mirror = {
    store,
    calls,
    snapshot() {
      const out = new Map();
      for (const [rel, f] of store) out.set(rel, { etag: f.etag, size: f.data.length, kind: f.kind, ...(f.kind === 'md' ? { hash: crypto.createHash('sha256').update(f.data).digest('hex') } : {}) });
      return out;
    },
    async sync() {
      return [];
    },
    async readText(rel) {
      const f = store.get(rel);
      return { content: f.data.toString('utf8'), etag: f.etag };
    },
    async readBlob(rel) {
      const f = store.get(rel);
      return { buffer: f.data, etag: f.etag };
    },
    async putText(rel, content, opts) {
      calls.push(['put', rel]);
      return put(rel, Buffer.from(content), opts);
    },
    async putBlob(rel, buf, opts) {
      calls.push(['putBlob', rel]);
      return put(rel, buf, opts);
    },
    async remove(rel) {
      calls.push(['delete', rel]);
      store.delete(rel);
    },
    async move(from, to) {
      calls.push(['move', from, to]);
      for (const [k, v] of [...store]) {
        if (k === from || k.startsWith(from + '/')) {
          store.delete(k);
          store.set(to + k.slice(from.length), v); // same bytes, same etag (R2: MD5)
        }
      }
    },
    /** Simulates someone else writing in the cloud. */
    remoteWrite(rel, content) {
      store.set(rel, { etag: `e${++n}`, data: Buffer.from(content), kind: rel.endsWith('.md') ? 'md' : 'bin' });
    },
  };
  return mirror;
}

/** A layout the test can change between passes: which projects are covered, their folders, the read-only ones. */
function testLayout({ folders = {}, covered = null, readonly = [] } = {}) {
  const st = { folders: { ...folders }, covered: covered && new Set(covered), readonly: new Set(readonly) };
  return {
    st,
    folderOf: (k) => st.folders[k] ?? k,
    keyOf: (f) => Object.keys(st.folders).find((k) => st.folders[k] === f) ?? f,
    covers: (k) => !st.covered || st.covered.has(k),
    readonly: (k) => st.readonly.has(k),
    folders: () => new Map(Object.entries(st.folders).filter(([k]) => !st.covered || st.covered.has(k))),
  };
}

async function setup(t, files = {}, { layout } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lore-vault-'));
  const root = path.join(dir, 'vault');
  await fsp.mkdir(root);
  const mirror = fakeMirror();
  for (const [rel, content] of Object.entries(files)) mirror.remoteWrite(rel, content);
  const events = [];
  const trashed = [];
  const make = () =>
    new VaultSync({
      root,
      stateDir: path.join(dir, 'state'),
      userId: 'u1',
      server: 'test',
      mirror,
      layout,
      trash: async (abs) => {
        trashed.push(path.relative(root, abs));
        await fsp.rm(abs, { recursive: true });
      },
      onEvent: (e) => events.push(e),
      remoteLabel: () => 'Claude',
      debounceMs: 20,
      maxWaitMs: 100,
    });
  const engine = make();
  t.after(async () => {
    engine.stop();
    // A pass started by the watcher may still be writing the manifest.
    await engine.queue;
    await fsp.rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  const disk = (rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
  const write = async (rel, content) => {
    const abs = path.join(root, ...rel.split('/'));
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.chmod(abs, 0o644).catch(() => {});
    await fsp.writeFile(abs, content);
  };
  const pass = () => engine.syncNow();
  return { dir, root, mirror, engine, events, trashed, disk, write, pass, make };
}

test('engine: first sync downloads everything, index.md read-only, marker written', async (t) => {
  const { root, engine, mirror, disk } = await setup(t, { 'P/a.md': '# A\n', 'P/index.md': '# P\n', 'P/img/x.png': '\x89PNG' });
  await engine.start();
  assert.equal(disk('P/a.md'), '# A\n');
  assert.equal(disk('P/img/x.png'), '\x89PNG');
  assert.equal(fs.statSync(path.join(root, 'P/index.md')).mode & 0o222, 0); // no write bits
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.lore-sync/vault.json'), 'utf8')).userId, 'u1');
  assert.deepEqual(mirror.calls, []); // nothing uploaded
  assert.equal(engine.status().state, 'idle');
});

test('engine: local edits are pushed with the etag; own writes never echo', async (t) => {
  const { engine, mirror, write, pass, events } = await setup(t, { 'P/a.md': 'one\n' });
  await engine.start();
  const etag = mirror.store.get('P/a.md').etag;
  await write('P/a.md', 'one\ntwo\n');
  await pass();
  assert.equal(mirror.store.get('P/a.md').data.toString(), 'one\ntwo\n');
  assert.notEqual(mirror.store.get('P/a.md').etag, etag);
  const pushed = events.filter((e) => e.type === 'pushed');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].before, 'one\n');
  mirror.calls.length = 0;
  await pass();
  await pass();
  assert.deepEqual(mirror.calls, []);
});

test('engine: cloud edits land on disk; concurrent edits merge', async (t) => {
  const { engine, mirror, write, pass, disk, events } = await setup(t, { 'P/a.md': 'title\n\nalpha\n\nbeta\n' });
  await engine.start();
  mirror.remoteWrite('P/a.md', 'title\n\nalpha\n\nbeta (agent)\n');
  await pass();
  assert.equal(disk('P/a.md'), 'title\n\nalpha\n\nbeta (agent)\n');

  mirror.remoteWrite('P/a.md', 'title (agent)\n\nalpha\n\nbeta (agent)\n');
  await write('P/a.md', 'title\n\nalpha (me)\n\nbeta (agent)\n');
  await pass();
  const merged = 'title (agent)\n\nalpha (me)\n\nbeta (agent)\n';
  assert.equal(disk('P/a.md'), merged);
  assert.equal(mirror.store.get('P/a.md').data.toString(), merged);
  assert.ok(events.some((e) => e.type === 'merged' && e.rel === 'P/a.md'));
});

test('engine: overlapping edits keep mine and save theirs as a conflict copy', async (t) => {
  const { root, engine, mirror, write, pass, disk, events } = await setup(t, { 'P/a.md': 'line\n' });
  await engine.start();
  mirror.remoteWrite('P/a.md', 'line by agent\n');
  await write('P/a.md', 'line by me\n');
  await pass();
  assert.equal(disk('P/a.md'), 'line by me\n');
  assert.equal(mirror.store.get('P/a.md').data.toString(), 'line by me\n');
  const conflict = events.find((e) => e.type === 'conflict');
  assert.match(conflict.copy, /^P\/a \(conflitto Claude .*\)\.md$/);
  assert.equal(disk(conflict.copy), 'line by agent\n');
  assert.equal(mirror.store.get(conflict.copy).data.toString(), 'line by agent\n');
  assert.equal(engine.status().conflicts[0].copy, conflict.copy);
  // and it's stable afterwards
  mirror.calls.length = 0;
  await pass();
  assert.deepEqual(mirror.calls, []);
  assert.ok(fs.existsSync(path.join(root, conflict.copy)));
});

test('engine: a 409 refreshes and merges instead of overwriting', async (t) => {
  const { engine, mirror, write, pass, disk } = await setup(t, { 'P/a.md': 'a\nb\n' });
  await engine.start();
  await write('P/a.md', 'a!\nb\n');
  // The agent writes between our snapshot and our PUT.
  const put = mirror.putText;
  let once = true;
  mirror.putText = async (rel, content, opts) => {
    if (once) {
      once = false;
      mirror.remoteWrite('P/a.md', 'a\nb!\n');
    }
    return put(rel, content, opts);
  };
  await pass();
  // The requeued pass runs on its own shortly after.
  for (let i = 0; i < 60 && mirror.store.get('P/a.md').data.toString() !== 'a!\nb!\n'; i++) await new Promise((r) => setTimeout(r, 50));
  await engine.flush();
  assert.equal(mirror.store.get('P/a.md').data.toString(), 'a!\nb!\n');
  assert.equal(disk('P/a.md'), 'a!\nb!\n');
});

test('engine: deletes and renames go both ways; cloud deletes go to the trash', async (t) => {
  const { root, engine, mirror, pass, trashed } = await setup(t, { 'P/a.md': 'a', 'P/b.md': 'b', 'P/sub/c.md': 'c', 'P/sub/d.md': 'd' });
  await engine.start();
  // cloud delete → trash
  mirror.store.delete('P/b.md');
  await pass();
  assert.deepEqual(trashed, ['P/b.md']);
  // local delete → cloud delete
  await fsp.rm(path.join(root, 'P/a.md'));
  await pass();
  assert.ok(!mirror.store.has('P/a.md'));
  // local folder rename → one move
  mirror.calls.length = 0;
  await fsp.rename(path.join(root, 'P/sub'), path.join(root, 'P/renamed'));
  await pass();
  assert.deepEqual(mirror.calls, [['move', 'P/sub', 'P/renamed']]);
  assert.ok(mirror.store.has('P/renamed/c.md'));
  // cloud rename → local rename, old folder pruned
  await mirror.move('P/renamed/c.md', 'P/moved/c.md');
  mirror.calls.length = 0;
  await pass();
  assert.ok(fs.existsSync(path.join(root, 'P/moved/c.md')));
  assert.ok(!fs.existsSync(path.join(root, 'P/renamed/c.md')));
  assert.deepEqual(mirror.calls, []);
});

test('engine: edits made while the app was closed are reconciled at start', async (t) => {
  const { root, engine, mirror, write, make } = await setup(t, { 'P/a.md': 'a\n', 'P/b.md': 'b\n' });
  await engine.start();
  engine.stop();
  await write('P/a.md', 'a offline\n');
  await fsp.rm(path.join(root, 'P/b.md'));
  await write('P/new.md', 'new\n');
  mirror.remoteWrite('P/c.md', 'from agent\n');
  const again = make();
  t.after(() => again.stop());
  await again.start();
  assert.equal(mirror.store.get('P/a.md').data.toString(), 'a offline\n');
  assert.ok(!mirror.store.has('P/b.md'));
  assert.equal(mirror.store.get('P/new.md').data.toString(), 'new\n');
  assert.equal(fs.readFileSync(path.join(root, 'P/c.md'), 'utf8'), 'from agent\n');
});

test('engine: tampering with index.md is reverted', async (t) => {
  const { root, engine, pass, disk, events } = await setup(t, { 'P/a.md': 'a', 'P/index.md': '# P\n' });
  await engine.start();
  await fsp.chmod(path.join(root, 'P/index.md'), 0o644);
  await fsp.writeFile(path.join(root, 'P/index.md'), 'hacked');
  await pass();
  assert.equal(disk('P/index.md'), '# P\n');
  assert.ok(events.some((e) => e.type === 'notice'));
});

test('engine: mass deletes wait for confirmation; a missing folder never deletes', async (t) => {
  const files = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`P/n${i}.md`, `n${i}`]));
  const { root, engine, mirror, pass, events } = await setup(t, files);
  await engine.start();
  for (let i = 0; i < 25; i++) await fsp.rm(path.join(root, `P/n${i}.md`));
  await pass();
  assert.equal(engine.status().state, 'paused:confirm');
  assert.equal(mirror.store.size, 25);
  assert.ok(events.some((e) => e.type === 'confirm' && e.count === 25));
  await engine.confirm('restore');
  assert.equal(fs.readdirSync(path.join(root, 'P')).length, 25);

  await fsp.rm(root, { recursive: true });
  await pass();
  assert.equal(engine.status().state, 'error');
  assert.equal(mirror.store.size, 25);
});

test('engine: refuses a folder that belongs to another account', async (t) => {
  const { root, mirror, dir } = await setup(t);
  await fsp.mkdir(path.join(root, '.lore-sync'), { recursive: true });
  await fsp.writeFile(path.join(root, '.lore-sync/vault.json'), JSON.stringify({ userId: 'someone-else', server: 'test' }));
  const engine = new VaultSync({ root, stateDir: path.join(dir, 's2'), userId: 'u1', server: 'test', mirror, trash: async () => {} });
  t.after(() => engine.stop());
  await engine.start();
  assert.equal(engine.status().state, 'error');
});

test('engine: files that cannot sync are listed with a reason, empty folders reported', async (t) => {
  const { engine, write, pass, events, root } = await setup(t, { 'P/a.md': 'a' });
  await engine.start();
  await write('loose.md', 'x');
  await write('P/doc.docx', 'x');
  await fsp.mkdir(path.join(root, 'P/empty'));
  await pass();
  const reasons = Object.fromEntries(engine.status().unsynced.map((u) => [u.path, u.reason]));
  assert.ok(reasons['loose.md']);
  assert.ok(reasons['P/doc.docx']);
  const folders = events.filter((e) => e.type === 'folders').pop();
  assert.deepEqual(folders.dirs, ['P/empty']);
});

test('engine: watcher picks up edits on its own', async (t) => {
  const { engine, mirror, write } = await setup(t, { 'P/a.md': 'a' });
  await engine.start();
  await write('P/a.md', 'watched');
  for (let i = 0; i < 50 && mirror.store.get('P/a.md').data.toString() !== 'watched'; i++) await new Promise((r) => setTimeout(r, 50));
  await engine.flush();
  assert.equal(mirror.store.get('P/a.md').data.toString(), 'watched');
});

test('folderNames: team projects are "Name (Team)", clashes get a number', () => {
  const names = folderNames([
    { key: 'Athly', name: 'Athly', team: null },
    { key: 'athly (squadra)', name: 'athly (squadra)', team: null },
    { key: 'Athly@T2', name: 'Athly', team: { id: 'T2', name: 'Squadra' } },
    { key: 'Athly@T1', name: 'Athly', team: { id: 'T1', name: 'Squadra' } },
    { key: 'Note@T3', name: 'Note', team: { id: 'T3', name: 'R&D: 2026/27' } },
  ]);
  assert.deepEqual(Object.fromEntries(names), {
    Athly: 'Athly',
    'athly (squadra)': 'athly (squadra)',
    'Athly@T1': 'Athly (Squadra) (2)', // the user's own project keeps its name (case-insensitive clash)
    'Athly@T2': 'Athly (Squadra) (3)',
    'Note@T3': 'Note (R&D 2026 27)',
  });
});

test('classify: team keys are validated by name; read-only projects', () => {
  assert.equal(classify('Athly@T1/a.md', 1).status, 'sync');
  assert.equal(classify('Athly@T1/a.md', 1, (k) => k === 'Athly@T1').status, 'readonly');
  assert.equal(classify('Bad (name)/a.md', 1).status, 'unsynced');
});

test('selection: only covered projects sync; the others are never read as deleted or new', async (t) => {
  const layout = testLayout({ covered: ['P'] });
  const { root, engine, mirror, write, pass, disk, trashed } = await setup(t, { 'P/a.md': 'a\n', 'Q/b.md': 'b\n' }, { layout });
  // A local folder for Q exists already (synced before, or made by hand).
  await write('Q/local.md', 'mine\n');
  await engine.start();
  assert.equal(disk('P/a.md'), 'a\n');
  assert.ok(!fs.existsSync(path.join(root, 'Q/b.md')), 'Q is not downloaded');
  assert.deepEqual(mirror.calls, [], 'Q/local.md is not uploaded');

  // Q selected: merged by the usual planner.
  layout.st.covered.add('Q');
  await pass();
  assert.equal(disk('Q/b.md'), 'b\n');
  assert.equal(mirror.store.get('Q/local.md').data.toString(), 'mine\n');

  // Q deselected (or not loaded yet): its files stay, its cloud copy too, local edits wait.
  layout.st.covered.delete('Q');
  mirror.calls.length = 0;
  await fsp.rm(path.join(root, 'Q/b.md'));
  await write('Q/local.md', 'edited while not synced\n');
  mirror.remoteWrite('Q/new.md', 'n\n');
  await pass();
  assert.deepEqual(mirror.calls, []);
  assert.ok(mirror.store.has('Q/b.md'));
  assert.deepEqual(trashed, []);
  assert.ok(!fs.existsSync(path.join(root, 'Q/new.md')));
  assert.ok(Object.keys(engine.manifest.files).includes('Q/b.md'), 'Q keeps its manifest entries while uncovered');

  // Deselecting for good forgets Q; the folder stays on disk.
  await engine.forgetProject('Q');
  assert.ok(!Object.keys(engine.manifest.files).some((k) => k.startsWith('Q/')));
  assert.equal(disk('Q/local.md'), 'edited while not synced\n');
});

test('team projects sit in "Name (Team)" folders and move when the team is renamed', async (t) => {
  const layout = testLayout({ folders: { 'X@T1': 'X (Squadra)' } });
  const { root, engine, mirror, write, pass, disk, events } = await setup(t, { 'X@T1/c.md': 'c\n', 'P/a.md': 'a\n' }, { layout });
  await engine.start();
  assert.equal(disk('X (Squadra)/c.md'), 'c\n');
  assert.ok(!fs.existsSync(path.join(root, 'X@T1')));

  await write('X (Squadra)/c.md', 'c2\n');
  await write('X (Squadra)/d.md', 'd\n');
  await pass();
  assert.equal(mirror.store.get('X@T1/c.md').data.toString(), 'c2\n');
  assert.equal(mirror.store.get('X@T1/d.md').data.toString(), 'd\n');

  mirror.calls.length = 0;
  layout.st.folders['X@T1'] = 'X (Nuovo nome)';
  await pass();
  assert.equal(disk('X (Nuovo nome)/c.md'), 'c2\n');
  assert.ok(!fs.existsSync(path.join(root, 'X (Squadra)')));
  assert.deepEqual(mirror.calls, [], 'a renamed team moves nothing in the cloud');
  assert.ok(events.some((e) => e.type === 'notice' && /ora si chiama/.test(e.message)));

  // The project renamed in Lore: its folder is resolved before the cloud move, then moved as a whole.
  const before = engine.abs('X@T1');
  await mirror.move('X@T1', 'Y@T1');
  delete layout.st.folders['X@T1'];
  layout.st.folders['Y@T1'] = 'Y (Nuovo nome)';
  mirror.calls.length = 0;
  await engine.renameLocal('X@T1', 'Y@T1', before);
  await pass();
  assert.equal(disk('Y (Nuovo nome)/c.md'), 'c2\n');
  assert.ok(!fs.existsSync(before));
  assert.deepEqual(mirror.calls, []);
  assert.ok(Object.keys(engine.manifest.files).includes('Y@T1/c.md'));
});

test('read-only projects: files are read-only, local edits are reverted, new files stay local', async (t) => {
  const layout = testLayout({ folders: { 'V@T1': 'V (Squadra)' }, readonly: ['V@T1'] });
  const { root, engine, mirror, write, pass, disk, events } = await setup(t, { 'V@T1/a.md': 'a\n' }, { layout });
  await engine.start();
  assert.equal(fs.statSync(path.join(root, 'V (Squadra)/a.md')).mode & 0o222, 0);

  await write('V (Squadra)/a.md', 'hacked\n');
  await write('V (Squadra)/new.md', 'new\n');
  await pass();
  assert.equal(disk('V (Squadra)/a.md'), 'a\n');
  assert.ok(events.some((e) => e.type === 'notice' && /sola lettura/.test(e.message)));
  assert.deepEqual(mirror.calls, []);
  assert.ok(engine.status().unsynced.some((u) => u.path === 'V (Squadra)/new.md' && /sola lettura/.test(u.reason)));

  // Deleting it locally doesn't delete it for the team: it comes back.
  await fsp.chmod(path.join(root, 'V (Squadra)/a.md'), 0o644);
  await fsp.rm(path.join(root, 'V (Squadra)/a.md'));
  await pass();
  assert.equal(disk('V (Squadra)/a.md'), 'a\n');
  assert.ok(mirror.store.has('V@T1/a.md'));
});
