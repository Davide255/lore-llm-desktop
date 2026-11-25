// Edits made in Word, Excel or PowerPoint go back to Lore.
//
// An attachment opened with the system app is a copy in the temp folder (unless the
// Obsidian vault holds it, which syncs on its own). EditBack watches that copy and, each
// time the app saves it, uploads the new bytes over the attachment:
//
// - the folder is watched, not the file: Office saves by writing a temp file and renaming
//   it over the original, which ends a watch on the file itself;
// - saves are debounced (Office writes in several steps) and compared by hash, so opening
//   the file or a save without changes uploads nothing;
// - the upload carries the etag of the version the copy came from: if someone changed the
//   attachment on Lore in the meantime, nothing is overwritten and the edit goes up as a
//   conflict copy next to it, which later saves keep updating;
// - offline or a server error: retried with backoff, and the copy is "dirty", so opening
//   the attachment again reopens the copy instead of replacing it with the server's.
//
// Messages for the user go through notify(text) (a toast).

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const nameOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

const DEFAULTS = {
  debounceMs: 2000,
  retryMs: [5000, 15000, 30000, 60000, 120000],
  maxWatched: 20,
  maxBytes: 10 * 1024 * 1024,
};

class EditBack {
  /**
   * deps:
   *   watch(dir, onEvent(filename)) -> { close() }   (fs.watch on the folder)
   *   putBlob(rel, buffer, { overwrite, ifMatch }) -> { etag }   (rejects with err.status)
   *   conflictPath(rel) -> rel of a free conflict copy
   *   notify(text)
   *   readFile, setTimeout, clearTimeout: injectable for tests
   */
  constructor(deps, opts = {}) {
    this.deps = { readFile: (f) => fsp.readFile(f), setTimeout, clearTimeout, ...deps };
    this.opts = { ...DEFAULTS, ...opts };
    this.entries = new Map(); // local file -> entry
  }

  /** Starts (or restarts) watching `file`, the local copy of `rel` downloaded at `etag` with these bytes. */
  track(rel, file, etag, buffer) {
    this.stop(file);
    const entry = { rel, file, etag, hash: sha256(buffer), timer: null, busy: false, again: false, dirty: false, attempt: 0, watcher: null };
    const base = path.basename(file);
    entry.watcher = this.deps.watch(path.dirname(file), (filename) => {
      // Some platforms give no name; Office's own lock and temp files (~$x.docx, ~WRL1234.tmp) are not the copy.
      if (filename && filename !== base) return;
      this.schedule(entry, this.opts.debounceMs);
    });
    this.entries.set(file, entry);
    // Oldest first: past the limit, the copy opened longest ago stops being watched.
    while (this.entries.size > this.opts.maxWatched) this.stop(this.entries.keys().next().value);
  }

  /** True when the local copy of `file` holds edits that haven't reached Lore yet. */
  isDirty(file) {
    return !!this.entries.get(file)?.dirty;
  }

  stop(file) {
    const entry = this.entries.get(file);
    if (!entry) return;
    this.entries.delete(file);
    if (entry.timer) this.deps.clearTimeout(entry.timer);
    entry.timer = null;
    try {
      entry.watcher?.close();
    } catch {
      // already closed
    }
  }

  stopAll() {
    for (const file of [...this.entries.keys()]) this.stop(file);
  }

  /** Uploads every copy still waiting (debounced or dirty) now, e.g. before quitting. */
  async flush() {
    const waiting = [...this.entries.values()].filter((e) => e.timer || e.dirty);
    for (const e of waiting) {
      if (e.timer) this.deps.clearTimeout(e.timer);
      e.timer = null;
    }
    await Promise.all(waiting.map((e) => this.upload(e)));
  }

  schedule(entry, ms) {
    if (this.entries.get(entry.file) !== entry) return;
    if (entry.timer) this.deps.clearTimeout(entry.timer);
    entry.timer = this.deps.setTimeout(() => {
      entry.timer = null;
      this.upload(entry);
    }, ms);
  }

  async upload(entry) {
    if (entry.busy) {
      entry.again = true;
      return;
    }
    entry.busy = true;
    try {
      await this.uploadOnce(entry);
    } finally {
      entry.busy = false;
      if (entry.again) {
        entry.again = false;
        this.schedule(entry, 0);
      }
    }
  }

  async uploadOnce(entry) {
    let buffer;
    try {
      buffer = await this.deps.readFile(entry.file);
    } catch {
      // Mid-save (renamed away for a moment) or locked: the next event or a retry gets it.
      return this.retry(entry, null);
    }
    const hash = sha256(buffer);
    if (hash === entry.hash) {
      entry.dirty = false;
      return;
    }
    const name = nameOf(entry.rel);
    if (buffer.length > this.opts.maxBytes) {
      entry.dirty = true;
      this.deps.notify(`«${name}» supera i 10 MB: le modifiche restano solo sul computer`);
      return;
    }
    entry.dirty = true;
    try {
      const file = await this.deps.putBlob(entry.rel, buffer, { overwrite: true, ifMatch: entry.etag || undefined });
      Object.assign(entry, { etag: file.etag, hash, dirty: false, attempt: 0 });
      this.deps.notify(`Modifiche a «${name}» salvate su Lore`);
    } catch (err) {
      if (err?.status === 412 || err?.status === 409) return this.conflict(entry, buffer, hash);
      if (err?.status === 403) {
        this.stop(entry.file);
        this.deps.notify(`«${name}» è in sola lettura: le modifiche restano solo sul computer`);
        return;
      }
      if (err?.status === 404) {
        // Deleted or moved on Lore meanwhile: keep the edit as a new file where it was.
        entry.etag = null;
        return this.retry(entry, err);
      }
      return this.retry(entry, err);
    }
  }

  async conflict(entry, buffer, hash) {
    const copy = this.deps.conflictPath(entry.rel);
    try {
      const file = await this.deps.putBlob(copy, buffer, { overwrite: false });
      this.deps.notify(`«${nameOf(entry.rel)}» è cambiato su Lore mentre lo modificavi: le tue modifiche sono in «${nameOf(copy)}»`);
      // Later saves of this copy update the conflict copy, not the attachment someone else changed.
      Object.assign(entry, { rel: copy, etag: file.etag, hash, dirty: false, attempt: 0 });
    } catch (err) {
      return this.retry(entry, err);
    }
  }

  retry(entry, err) {
    if (this.entries.get(entry.file) !== entry) return;
    const delays = this.opts.retryMs;
    if (entry.attempt >= delays.length) {
      if (err) this.deps.notify(`Impossibile caricare le modifiche a «${nameOf(entry.rel)}»: ${err.message}. Riprovo al prossimo salvataggio`);
      entry.attempt = 0;
      return;
    }
    if (entry.attempt === 0 && err) this.deps.notify(`Modifiche a «${nameOf(entry.rel)}» non ancora caricate (${err.message}): riprovo tra poco`);
    this.schedule(entry, delays[entry.attempt++]);
  }
}

module.exports = { EditBack, sha256 };
