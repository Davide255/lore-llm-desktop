// One local vault per project: every project that syncs with Obsidian has its own folder, and
// each folder is a flat VaultSync (vault.cjs, layout.flat). The group looks like a single vault
// to main.cjs (status, kick, flush, abs, ...) and routes project-specific calls to the right one.
const fsp = require('node:fs/promises');
const path = require('node:path');

const projectOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : rel);

// Worst first: what the user most needs to see wins when projects disagree.
const STATE_ORDER = ['error', 'paused:confirm', 'paused:auth', 'offline', 'syncing', 'idle', 'off'];

class VaultGroup {
  /** create(key, entry) -> a VaultSync (not started) for that project. */
  constructor({ create }) {
    this.create = create;
    this.members = new Map(); // key -> { sync, entry }
    this.stopped = false;
  }

  get running() {
    return [...this.members.values()].some((m) => m.sync.running);
  }

  has(key) {
    return this.members.has(key);
  }

  rootOf(key) {
    return this.members.get(key)?.entry.root ?? null;
  }

  /** Starts (or restarts, when the folder changed) the vault of one project. */
  async add(key, entry) {
    await this.remove(key);
    const sync = this.create(key, entry);
    this.members.set(key, { sync, entry });
    await sync.start();
  }

  /** Stops the project's vault after pushing what is pending; the folder stays on disk. */
  async remove(key) {
    const m = this.members.get(key);
    if (!m) return;
    this.members.delete(key);
    await m.sync.flush({ timeoutMs: 5000 }).catch(() => {});
    m.sync.stop(); // its manifest stays: choosing the same folder again resumes
  }

  stop() {
    this.stopped = true;
    for (const m of this.members.values()) m.sync.stop();
    this.members.clear();
  }

  async startAll(entries) {
    await Promise.all([...entries].map(([key, entry]) => this.add(key, entry)));
  }

  kick(delay) {
    for (const m of this.members.values()) m.sync.kick(delay);
  }

  syncNow() {
    return Promise.all([...this.members.values()].map((m) => m.sync.syncNow()));
  }

  flush(opts) {
    return Promise.all([...this.members.values()].map((m) => m.sync.flush(opts)));
  }

  /** Answers the mass-delete prompt of the projects that asked. */
  confirm(answer) {
    return Promise.all([...this.members.values()].filter((m) => m.sync.status().confirm).map((m) => m.sync.confirm(answer)));
  }

  /** The projects' states as one: worst state, summed pending, every conflict and unsynced file. */
  status() {
    const all = [...this.members].map(([key, m]) => ({ key, ...m.sync.status() }));
    if (!all.length) return { state: 'off', pending: 0, lastSyncAt: null, unsynced: [], conflicts: [], error: null, confirm: null };
    const state = STATE_ORDER.find((s) => all.some((x) => x.state === s)) ?? 'off';
    const label = (x) => x.key.replace(/@[A-Za-z0-9-]{1,64}$/, '');
    const seen = all.map((x) => x.lastSyncAt).filter((n) => n != null);
    const failed = all.find((x) => x.error);
    const asking = all.find((x) => x.confirm);
    return {
      state,
      pending: all.reduce((n, x) => n + x.pending, 0),
      // The oldest one: "synced N minutes ago" must hold for every project.
      lastSyncAt: seen.length === all.length ? Math.min(...seen) : null,
      unsynced: all.flatMap((x) => x.unsynced.map((u) => ({ ...u, path: all.length > 1 ? `${label(x)}/${u.path}` : u.path }))),
      conflicts: all.flatMap((x) => x.conflicts).sort((a, b) => b.at - a.at),
      error: failed ? (all.length > 1 ? `${label(failed)}: ${failed.error}` : failed.error) : null,
      confirm: asking?.confirm ?? null,
    };
  }

  /** Where a cloud path sits on disk, or null when its project has no folder. */
  abs(rel) {
    return this.members.get(projectOf(rel))?.sync.abs(rel) ?? null;
  }

  mkdirLocal(rel) {
    return this.members.get(projectOf(rel))?.sync.mkdirLocal(rel);
  }

  trashLocalFolder(rel) {
    // A whole project deleted in Lore: its folder is the user's, so it only stops syncing.
    if (!rel.includes('/')) return this.remove(rel);
    return this.members.get(projectOf(rel))?.sync.trashLocalFolder(rel);
  }

  /** Lore moved something: inside one project it moves on disk too; between projects sync does the rest. */
  renameLocal(from, to, fromAbs) {
    if (!from.includes('/') || !to.includes('/')) return Promise.resolve(); // a project rename is rekey()
    const a = this.members.get(projectOf(from));
    if (!a || a !== this.members.get(projectOf(to))) return Promise.resolve();
    return a.sync.renameLocal(from, to, fromAbs);
  }

  /** The project got a new key (renamed, or moved to a team): same folder. */
  async rekey(from, to) {
    const m = this.members.get(from);
    if (!m) return;
    this.members.delete(from);
    this.members.set(to, m);
    await m.sync.rekeyProject(from, to);
  }
}

/**
 * Before: one folder for everything, a project per subfolder. Now each project has its own
 * vault: the subfolder itself, with what was synced so far carried over so nothing is read as new.
 * `old`: { stateDir, root }. `entries`: Map(key -> { root, id }). Returns the keys migrated.
 */
async function migrateLegacy({ oldStateDir, userId, entries, stateDirOf }) {
  let old;
  try {
    old = JSON.parse(await fsp.readFile(path.join(oldStateDir, 'manifest.json'), 'utf8'));
  } catch {
    return [];
  }
  if (old.userId !== userId) return [];
  const done = [];
  for (const [key, entry] of entries) {
    const files = Object.fromEntries(Object.entries(old.files ?? {}).filter(([rel]) => projectOf(rel) === key));
    const dir = stateDirOf(entry);
    await fsp.mkdir(path.join(dir, 'bases'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, root: path.resolve(entry.root), userId, files, folders: {} }));
    for (const f of Object.values(files)) {
      if (f.base) await fsp.copyFile(path.join(oldStateDir, 'bases', f.base), path.join(dir, 'bases', f.base)).catch(() => {});
    }
    done.push(key);
  }
  return done;
}

/** A folder may not be (inside, or around) the folder of another project: files would sync twice. */
function overlapping(root, others) {
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === 'linux' ? r : r.toLowerCase();
  };
  const a = norm(root);
  return others.find((o) => {
    const b = norm(o);
    return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
  });
}

module.exports = { VaultGroup, migrateLegacy, overlapping, projectOf };
