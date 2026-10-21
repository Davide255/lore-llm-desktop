// Live updates for the renderer bundle (dist/), see docs/OTA.md.
//
// The app polls <baseUrl>/<channel>/manifest.json, checks its RSA-SHA256 signature (manifest.sig)
// against the public key embedded in the app, then downloads every file listed in it into
// userData/ota/bundles/<version>/ and checks each one against the sha256 in the signed manifest.
// The bundle is used from the NEXT launch, never while the app is running. The preload, the main
// process and Electron itself are not replaced: they need a new build (and a new runtimeVersion).
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MIN_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const MANIFEST_TIMEOUT_MS = 15_000;
const FILE_TIMEOUT_MS = 60_000;
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_BAD = 20;
const CHANNELS = ['beta', 'production'];

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** "1.2.3" or "1.2.3-ota.d20261021t1927.gabc" -> [1, 2, 3]; null when it does not start with x.y.z. */
function baseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareBase(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Signature over the exact manifest bytes: RSA-SHA256, base64 (the file manifest.sig). */
function verifySignature(body, signatureBase64, publicKeyPem) {
  try {
    return crypto.createVerify('RSA-SHA256').update(body).verify(publicKeyPem, String(signatureBase64).trim(), 'base64');
  } catch {
    return false;
  }
}

/** Relative path of a file inside the bundle: no absolute paths, no "..", no backslashes. */
function safeRelPath(p) {
  if (typeof p !== 'string' || !p || p.length > 300 || p.includes('\\') || p.includes('\0') || p.startsWith('/')) return false;
  return p.split('/').every((seg) => seg && seg !== '.' && seg !== '..');
}

/** Validates the shape of a (signed) manifest. Throws with a readable reason. */
function parseManifest(body) {
  let m;
  try {
    m = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    throw new Error('manifest is not JSON');
  }
  if (!m || typeof m !== 'object') throw new Error('manifest is not an object');
  if (typeof m.version !== 'string' || !VERSION.test(m.version) || !baseVersion(m.version)) throw new Error('bad version');
  if (typeof m.runtimeVersion !== 'string' || !m.runtimeVersion) throw new Error('bad runtimeVersion');
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) throw new Error('bad createdAt');
  if (!Array.isArray(m.files) || !m.files.length || m.files.length > MAX_FILES) throw new Error('bad file list');
  const seen = new Set();
  let total = 0;
  for (const f of m.files) {
    if (!f || !safeRelPath(f.path) || seen.has(f.path)) throw new Error('bad file path');
    if (typeof f.sha256 !== 'string' || !SHA256.test(f.sha256)) throw new Error(`bad sha256 for ${f.path}`);
    if (!Number.isInteger(f.size) || f.size < 0 || f.size > MAX_FILE_BYTES) throw new Error(`bad size for ${f.path}`);
    seen.add(f.path);
    total += f.size;
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('bundle too large');
  if (!seen.has(m.entry)) throw new Error('entry is not in the file list');
  return m;
}

/**
 * Is `manifest` worth installing? Same runtimeVersion, not marked bad, not older than this app build,
 * and strictly newer than what is running or already downloaded.
 */
function isNewer(manifest, { appVersion, runtimeVersion, loaded, pending, bad }) {
  if (manifest.runtimeVersion !== runtimeVersion) return false;
  if (bad.includes(manifest.version)) return false;
  const base = baseVersion(manifest.version);
  const app = baseVersion(appVersion);
  if (app && compareBase(base, app) < 0) return false;
  const at = Date.parse(manifest.createdAt);
  for (const known of [loaded, pending]) {
    if (!known) continue;
    if (known.version === manifest.version || at <= Date.parse(known.createdAt)) return false;
  }
  return true;
}

const sha256Hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * @param {object} o
 * @param {string} o.dir            userData/ota
 * @param {string} o.appVersion     the app build (app.getVersion())
 * @param {string} o.runtimeVersion bump with any change to main/preload/Electron
 * @param {string} o.baseUrl        https://…/ota/lore/desktop
 * @param {string} o.channel
 * @param {string} o.publicKey      PEM
 * @param {boolean} o.enabled
 * @param {(s: object) => void} [o.onStatus]
 * @param {typeof fetch} [o.fetch]
 */
function createOta({ dir, appVersion, runtimeVersion, baseUrl, channel: defaultChannel, publicKey, enabled, onStatus = () => {}, fetch: doFetch = globalThis.fetch }) {
  const statePath = path.join(dir, 'state.json');
  const bundlesDir = path.join(dir, 'bundles');
  const bundleDir = (version) => path.join(bundlesDir, version);
  const base = String(baseUrl).replace(/\/+$/, '');

  let loaded = null; // bundle the window was started from (null: the one inside the app)
  let phase = 'idle';
  let lastCheck = 0;
  let checking = false;

  const emit = (next, extra = {}) => {
    phase = next;
    onStatus({ phase, ...extra });
    return phase;
  };

  const readState = () => {
    try {
      const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return { current: s.current ?? null, pending: s.pending ?? null, bad: Array.isArray(s.bad) ? s.bad : [], channel: CHANNELS.includes(s.channel) ? s.channel : null };
    } catch {
      return { current: null, pending: null, bad: [], channel: null };
    }
  };
  const writeState = (s) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...s, bad: s.bad.slice(-MAX_BAD) }));
    fs.renameSync(tmp, statePath);
  };

  const readBundleManifest = (version) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(bundleDir(version), '.manifest.json'), 'utf8'));
    } catch {
      return null;
    }
  };

  /** Every file is there with the right size (hashes were checked when downloading). */
  const bundleIntact = (version) => {
    if (!VERSION.test(version)) return false;
    const m = readBundleManifest(version);
    if (!m) return false;
    try {
      return m.files.every((f) => fs.statSync(path.join(bundleDir(version), f.path)).size === f.size);
    } catch {
      return false;
    }
  };

  function markBad(s, version) {
    if (version && !s.bad.includes(version)) s.bad.push(version);
  }

  /**
   * Call once at startup, before the first window: decides which renderer bundle to start from.
   * Returns the absolute path of its index.html, or null for the bundle inside the app.
   */
  function init() {
    loaded = null;
    if (!enabled) return null;
    const s = readState();

    // The previous launch started this bundle and never confirmed it: it is broken.
    if (s.current?.launching) {
      markBad(s, s.current.version);
      s.current = null;
    }
    // A newer app build ships its own renderer: whatever was downloaded for the old one is stale.
    if (s.current && s.current.appVersion !== appVersion) s.current = null;
    if (s.pending) {
      const p = s.pending;
      if (p.appVersion === appVersion && !s.bad.includes(p.version) && bundleIntact(p.version)) s.current = { ...p, launching: false };
      s.pending = null;
    }
    if (s.current && !bundleIntact(s.current.version)) s.current = null;

    if (s.current) {
      s.current.launching = true;
      const m = readBundleManifest(s.current.version);
      loaded = { version: s.current.version, createdAt: s.current.createdAt, entry: path.join(bundleDir(s.current.version), m.entry) };
    }
    try {
      writeState(s);
      // Only the running bundle is kept; downloads in progress live in *.tmp and are cleaned too.
      for (const name of fs.existsSync(bundlesDir) ? fs.readdirSync(bundlesDir) : []) {
        if (name !== loaded?.version) fs.rmSync(path.join(bundlesDir, name), { recursive: true, force: true });
      }
    } catch {
      /* a read-only profile just means no OTA */
    }
    return loaded?.entry ?? null;
  }

  /** index.html of the running bundle, or null when the window starts from the app itself. */
  const entryPath = () => loaded?.entry ?? null;

  /** The renderer mounted: the bundle is good. */
  function confirm() {
    if (!loaded) return;
    const s = readState();
    if (s.current?.version === loaded.version && s.current.launching) {
      s.current.launching = false;
      writeState(s);
    }
  }

  /** The bundle failed to start: never use it again, go back to the one inside the app. */
  function rollback() {
    if (!loaded) return;
    const s = readState();
    markBad(s, loaded.version);
    if (s.current?.version === loaded.version) s.current = null;
    writeState(s);
    loaded = null;
  }

  /** The user's choice (Settings), else the build's default. */
  const channel = () => readState().channel ?? defaultChannel;

  /** Follow `beta` or `production` from now on; the next check looks there. */
  function setChannel(next) {
    if (!CHANNELS.includes(next)) throw new Error('unknown channel');
    const s = readState();
    s.channel = next === defaultChannel ? null : next;
    writeState(s);
    lastCheck = 0;
    return info();
  }

  const getBuffer = async (url, timeoutMs) => {
    const res = await doFetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-cache' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  };

  async function download(manifest) {
    const root = `${base}/${channel()}`;
    const tmp = path.join(bundlesDir, `${manifest.version}.tmp`);
    const final = bundleDir(manifest.version);
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    // Files the running bundle already has are copied, not downloaded again.
    const have = new Map();
    const running = loaded && readBundleManifest(loaded.version);
    for (const f of running?.files ?? []) have.set(f.sha256, path.join(bundleDir(loaded.version), f.path));

    for (const f of manifest.files) {
      const target = path.join(tmp, f.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const local = have.get(f.sha256);
      let data = null;
      if (local) data = await fsp.readFile(local).catch(() => null);
      if (!data || data.length !== f.size || sha256Hex(data) !== f.sha256) {
        data = await getBuffer(`${root}/files/${f.sha256}`, FILE_TIMEOUT_MS);
        if (!data) throw new Error(`file missing on the server: ${f.path}`);
      }
      if (data.length !== f.size || sha256Hex(data) !== f.sha256) throw new Error(`file does not match the manifest: ${f.path}`);
      await fsp.writeFile(target, data);
    }
    await fsp.writeFile(path.join(tmp, '.manifest.json'), JSON.stringify(manifest));
    await fsp.rm(final, { recursive: true, force: true });
    await fsp.rename(tmp, final);
  }

  /** Looks for a newer bundle and downloads it. Resolves with the resulting phase; never throws. */
  async function check({ force = false } = {}) {
    if (!enabled || checking) return phase;
    if (!force && Date.now() - lastCheck < MIN_CHECK_INTERVAL_MS) return phase;
    checking = true;
    lastCheck = Date.now();
    emit('checking');
    try {
      const root = `${base}/${channel()}`;
      if (!/^https:\/\//i.test(root)) throw new Error('baseUrl must be https');
      const body = await getBuffer(`${root}/manifest.json`, MANIFEST_TIMEOUT_MS);
      if (!body) return emit('current'); // nothing published on this channel yet
      const sig = await getBuffer(`${root}/manifest.sig`, MANIFEST_TIMEOUT_MS);
      if (!sig || !verifySignature(body, sig.toString('utf8'), publicKey)) throw new Error('manifest signature is not valid');
      const manifest = parseManifest(body);

      const s = readState();
      if (!isNewer(manifest, { appVersion, runtimeVersion, loaded, pending: s.pending, bad: s.bad })) return emit('current');

      emit('downloading', { version: manifest.version });
      await download(manifest);
      const next = readState();
      next.pending = { version: manifest.version, createdAt: manifest.createdAt, appVersion };
      writeState(next);
      return emit('ready', { version: manifest.version });
    } catch (e) {
      // Offline, server down, bad signature, tampered file…: keep what is running.
      console.warn('[ota] update check failed:', e?.message ?? e);
      return emit('error');
    } finally {
      checking = false;
    }
  }

  const info = () => ({
    enabled,
    phase,
    appVersion,
    channel: channel(),
    /** Version of the running downloaded bundle, null when the app runs its own. */
    version: loaded?.version ?? null,
  });

  return { init, entryPath, confirm, rollback, check, info, setChannel };
}

module.exports = { createOta, baseVersion, compareBase, verifySignature, safeRelPath, parseManifest, isNewer };
