const test = require('node:test');
const assert = require('node:assert/strict');
const { EditBack } = require('./edit-back.cjs');

/** EditBack over a fake disk, a fake server and hand-driven timers and watch events. */
function setup({ server = {}, opts = {} } = {}) {
  const disk = new Map();
  const watchers = [];
  const timers = new Set();
  const notes = [];
  const puts = [];
  const remote = new Map(Object.entries(server)); // rel -> etag
  let etagN = 100;
  const eb = new EditBack(
    {
      watch(dir, onEvent) {
        const w = { dir, onEvent, closed: false, close() { this.closed = true; } };
        watchers.push(w);
        return w;
      },
      async readFile(f) {
        if (!disk.has(f)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        const v = disk.get(f);
        if (v instanceof Error) throw v;
        return v;
      },
      async putBlob(rel, buffer, o) {
        puts.push({ rel, text: buffer.toString(), ...o });
        if (eb.failNext) {
          const err = eb.failNext;
          eb.failNext = null;
          throw err;
        }
        if (!o.overwrite && remote.has(rel)) throw Object.assign(new Error('exists'), { status: 409 });
        if (o.ifMatch && remote.get(rel) !== o.ifMatch) throw Object.assign(new Error('changed'), { status: 409 });
        const etag = `e${++etagN}`;
        remote.set(rel, etag);
        return { etag };
      },
      conflictPath: (rel) => rel.replace(/(\.\w+)$/, ' (conflitto modifiche locali)$1'),
      notify: (t) => notes.push(t),
      setTimeout(fn, ms) {
        const t = { fn, ms };
        timers.add(t);
        return t;
      },
      clearTimeout: (t) => timers.delete(t),
    },
    opts,
  );
  /** Fires every pending timer once, then lets the uploads settle. */
  const tick = async () => {
    const due = [...timers];
    timers.clear();
    for (const t of due) t.fn();
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };
  const save = (file, text) => {
    disk.set(file, Buffer.from(text));
    for (const w of watchers) if (!w.closed) w.onEvent(require('node:path').basename(file));
  };
  return { eb, disk, watchers, timers, notes, puts, remote, tick, save };
}

const FILE = '/tmp/lore-attachments/abc/voti.xlsx';
const REL = 'Scuola/voti.xlsx';

test('a save uploads the new bytes over the attachment, with the etag it was opened at', async () => {
  const s = setup({ server: { [REL]: 'e1' } });
  s.disk.set(FILE, Buffer.from('v1'));
  s.eb.track(REL, FILE, 'e1', Buffer.from('v1'));
  assert.equal(s.watchers[0].dir, '/tmp/lore-attachments/abc');

  s.save(FILE, 'v2');
  assert.equal(s.puts.length, 0, 'debounced, not uploaded on the first event');
  await s.tick();
  assert.deepEqual(s.puts, [{ rel: REL, text: 'v2', overwrite: true, ifMatch: 'e1' }]);
  assert.match(s.notes.at(-1), /salvate su Lore/);

  // The next save is checked against the etag the upload returned.
  s.save(FILE, 'v3');
  await s.tick();
  assert.deepEqual(s.puts[1], { rel: REL, text: 'v3', overwrite: true, ifMatch: 'e101' });
});

test('opening, saves without changes and other files in the folder upload nothing', async () => {
  const s = setup({ server: { [REL]: 'e1' } });
  s.disk.set(FILE, Buffer.from('v1'));
  s.eb.track(REL, FILE, 'e1', Buffer.from('v1'));
  s.watchers[0].onEvent('~$voti.xlsx'); // Excel's lock file
  assert.equal(s.timers.size, 0);
  s.save(FILE, 'v1');
  await s.tick();
  assert.equal(s.puts.length, 0);
});

test('several events of one save make a single upload', async () => {
  const s = setup({ server: { [REL]: 'e1' } });
  s.eb.track(REL, FILE, 'e1', Buffer.from('v1'));
  s.save(FILE, 'v2');
  s.save(FILE, 'v2');
  s.watchers[0].onEvent(null); // platform without a file name
  assert.equal(s.timers.size, 1);
  await s.tick();
  assert.equal(s.puts.length, 1);
});

test('changed on Lore meanwhile: the edit goes to a conflict copy, which later saves update', async () => {
  const s = setup({ server: { [REL]: 'e-someone-else' } });
  s.eb.track(REL, FILE, 'e1', Buffer.from('v1'));
  s.save(FILE, 'mine');
  await s.tick();
  const copy = 'Scuola/voti (conflitto modifiche locali).xlsx';
  assert.deepEqual(s.puts.map((p) => [p.rel, p.overwrite]), [[REL, true], [copy, false]]);
  assert.equal(s.remote.get(REL), 'e-someone-else', 'the other version is untouched');
  assert.match(s.notes.at(-1), /cambiato su Lore.*voti \(conflitto modifiche locali\)\.xlsx/);

  s.save(FILE, 'mine 2');
  await s.tick();
  assert.deepEqual(s.puts.at(-1), { rel: copy, text: 'mine 2', overwrite: true, ifMatch: 'e101' });
});

test('a failed upload is retried, and the copy stays dirty until it gets through', async () => {
  const s = setup({ server: { [REL]: 'e1' } });
  s.eb.track(REL, FILE, 'e1', Buffer.from('v1'));
  s.eb.failNext = Object.assign(new Error('offline'), { status: 0 });
  s.save(FILE, 'v2');
  await s.tick();
  assert.equal(s.eb.isDirty(FILE), true);
  assert.match(s.notes.at(-1), /non ancora caricate \(offline\)/);
  assert.equal([...s.timers][0].ms, 5000, 'first retry after 5 s');
  await s.tick();
  assert.equal(s.eb.isDirty(FILE), false);
  assert.equal(s.puts.length, 2);
});

test('read-only attachments stop being watched; too large ones stay local', async () => {
  const s = setup({ server: { [REL]: 'e1' }, opts: { maxBytes: 5 } });
  s.eb.track(REL, FILE, 'e1', Buffer.from('v1'));
  s.save(FILE, 'too large');
  await s.tick();
  assert.equal(s.puts.length, 0);
  assert.match(s.notes.at(-1), /supera i 10 MB/);
  assert.equal(s.eb.isDirty(FILE), true);

  s.eb.failNext = Object.assign(new Error('forbidden'), { status: 403 });
  s.save(FILE, 'v3');
  await s.tick();
  assert.match(s.notes.at(-1), /sola lettura/);
  assert.equal(s.watchers[0].closed, true);
});

test('flush uploads pending saves at once; past maxWatched the oldest copy is dropped', async () => {
  const s = setup({ server: { [REL]: 'e1' }, opts: { maxWatched: 2 } });
  s.eb.track(REL, FILE, 'e1', Buffer.from('v1'));
  s.save(FILE, 'v2');
  await s.eb.flush();
  assert.equal(s.puts.length, 1);
  assert.equal(s.timers.size, 0);

  s.eb.track('P/a.docx', '/t/1/a.docx', 'x', Buffer.from('a'));
  s.eb.track('P/b.docx', '/t/2/b.docx', 'x', Buffer.from('b'));
  assert.equal(s.watchers[0].closed, true);
  assert.equal(s.eb.entries.size, 2);
  s.eb.stopAll();
  assert.ok(s.watchers.every((w) => w.closed));
});

test('real folder watch: an Office-style save (temp file renamed over the copy) is uploaded, twice', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-back-'));
  const file = path.join(dir, 'relazione.docx');
  fs.writeFileSync(file, 'v1');
  const puts = [];
  let uploaded;
  const eb = new EditBack(
    {
      watch(d, onEvent) {
        const w = fs.watch(d, (_e, name) => onEvent(name ? String(name) : null));
        w.on('error', () => {});
        return w;
      },
      async putBlob(rel, buffer) {
        puts.push(buffer.toString());
        uploaded?.();
        return { etag: `e${puts.length}` };
      },
      conflictPath: (rel) => rel,
      notify: () => {},
    },
    { debounceMs: 50 },
  );
  const saved = () => new Promise((r) => (uploaded = r));
  const officeSave = (text) => {
    const tmp = path.join(dir, `~WRL${Math.random().toString().slice(2, 6)}.tmp`);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  };
  try {
    eb.track('P/relazione.docx', file, 'e0', Buffer.from('v1'));
    let wait = saved();
    officeSave('v2');
    await wait;
    wait = saved();
    officeSave('v3');
    await wait;
    assert.deepEqual(puts, ['v2', 'v3']);
  } finally {
    eb.stopAll();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
