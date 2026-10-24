const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOta, verifySignature, safeRelPath, parseManifest, isNewer, baseVersion } = require('./ota.cjs');

const keys = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const { publicKey, privateKey } = keys();
const other = keys();
const sign = (body, key = privateKey) => crypto.createSign('RSA-SHA256').update(body).sign(key, 'base64');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lore-ota-'));

// A tiny "server": a signed manifest plus its files, served through a fake fetch.
function server({ version = '1.0.1-ota.d20261021t1000.gaaa', createdAt = '2026-10-21T10:00:00.000Z', runtimeVersion = '1', files, signWith = privateKey } = {}) {
  files ??= { 'index.html': '<html>v1</html>', 'assets/app.js': 'console.log(1)' };
  const manifest = { version, runtimeVersion, createdAt, entry: 'index.html', files: Object.entries(files).map(([p, c]) => ({ path: p, sha256: sha(c), size: Buffer.byteLength(c) })) };
  const body = JSON.stringify(manifest);
  const routes = new Map([
    ['/prod/manifest.json', body],
    ['/prod/manifest.sig', sign(body, signWith)],
    ...Object.values(files).map((c) => [`/prod/files/${sha(c)}`, c]),
  ]);
  const hits = [];
  const fetch = async (url) => {
    hits.push(url);
    const hit = routes.get(new URL(url).pathname.replace('/ota/lore/desktop', ''));
    return hit === undefined ? new Response('Not found', { status: 404 }) : new Response(hit);
  };
  return { fetch, routes, hits, manifest };
}

const make = (dir, srv, extra = {}) =>
  createOta({ dir, appVersion: '1.0.1', runtimeVersion: '1', baseUrl: 'https://example.test/ota/lore/desktop', channel: 'prod', publicKey, enabled: true, fetch: srv.fetch, ...extra });

test('verifySignature accepts the signer and rejects tampering and other keys', () => {
  const body = Buffer.from('{"a":1}');
  assert.equal(verifySignature(body, sign(body), publicKey), true);
  assert.equal(verifySignature(Buffer.from('{"a":2}'), sign(body), publicKey), false);
  assert.equal(verifySignature(body, sign(body, other.privateKey), publicKey), false);
  assert.equal(verifySignature(body, 'not base64!', publicKey), false);
});

test('safeRelPath only allows plain relative paths', () => {
  for (const ok of ['index.html', 'assets/a-1.js', 'a/b/c.css']) assert.equal(safeRelPath(ok), true, ok);
  for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'a//b', './a', 'a\\b', 'a/', 'x\0y', 5]) assert.equal(safeRelPath(bad), false, String(bad));
});

test('parseManifest rejects malformed manifests', () => {
  const good = server().manifest;
  assert.doesNotThrow(() => parseManifest(JSON.stringify(good)));
  const bad = [
    { ...good, version: '../1.0.0' },
    { ...good, version: 'latest' },
    { ...good, entry: 'missing.html' },
    { ...good, files: [] },
    { ...good, files: [{ ...good.files[0], path: '../escape' }, ...good.files.slice(1)] },
    { ...good, files: [{ ...good.files[0], sha256: 'abc' }, ...good.files.slice(1)] },
    { ...good, files: [good.files[0], good.files[0]] },
    { ...good, createdAt: 'yesterday' },
  ];
  for (const m of bad) assert.throws(() => parseManifest(JSON.stringify(m)));
  assert.throws(() => parseManifest('nope'));
});

test('isNewer: runtime, app build, bad list and ordering', () => {
  const ctx = { appVersion: '1.0.1', runtimeVersion: '1', loaded: null, pending: null, bad: [] };
  const m = { version: '1.0.2', runtimeVersion: '1', createdAt: '2026-10-21T10:00:00Z' };
  assert.equal(isNewer(m, ctx), true);
  assert.equal(isNewer({ ...m, runtimeVersion: '2' }, ctx), false, 'other runtime');
  assert.equal(isNewer({ ...m, version: '1.0.0' }, ctx), false, 'older than the app build');
  assert.equal(isNewer(m, { ...ctx, bad: ['1.0.2'] }), false);
  assert.equal(isNewer(m, { ...ctx, loaded: { version: '1.0.2', createdAt: m.createdAt } }), false, 'already running');
  assert.equal(isNewer(m, { ...ctx, pending: { version: '1.0.2', createdAt: m.createdAt } }), false, 'already downloaded');
  assert.equal(isNewer(m, { ...ctx, loaded: { version: '1.0.3', createdAt: '2026-10-22T00:00:00Z' } }), false, 'older than the running bundle');
  assert.deepEqual(baseVersion('1.2.3-ota.d1'), [1, 2, 3]);
});

test('download, apply on the next launch, confirm', async () => {
  const dir = tmp();
  const srv = server();
  const ota = make(dir, srv);
  assert.equal(ota.init(), null, 'nothing downloaded yet');

  assert.equal(await ota.check({ force: true }), 'ready');
  assert.equal(ota.entryPath(), null, 'the running window is not swapped');

  const next = make(dir, srv);
  const entry = next.init();
  assert.equal(entry, path.join(dir, 'bundles', srv.manifest.version, 'index.html'));
  assert.equal(fs.readFileSync(entry, 'utf8'), '<html>v1</html>');
  assert.equal(fs.readFileSync(path.join(path.dirname(entry), 'assets', 'app.js'), 'utf8'), 'console.log(1)');
  assert.equal(next.info().version, srv.manifest.version);

  // Confirmed: it survives the next launch.
  next.confirm();
  assert.equal(make(dir, srv).init(), entry);
});

test('a bundle that never confirms is dropped on the next launch and not offered again', async () => {
  const dir = tmp();
  const srv = server();
  await make(dir, srv).check({ force: true });
  assert.ok(make(dir, srv).init(), 'first launch uses it');
  // …but it never called confirm(): the following launch rolls back.
  const third = make(dir, srv);
  assert.equal(third.init(), null);
  assert.equal(await third.check({ force: true }), 'current', 'marked bad: not downloaded again');
});

test('rollback during the session marks the bundle bad', async () => {
  const dir = tmp();
  const srv = server();
  await make(dir, srv).check({ force: true });
  const ota = make(dir, srv);
  assert.ok(ota.init());
  ota.rollback();
  assert.equal(ota.entryPath(), null);
  assert.equal(make(dir, srv).init(), null);
});

test('a manifest with a wrong signature is rejected', async () => {
  const dir = tmp();
  const srv = server({ signWith: other.privateKey });
  const ota = make(dir, srv);
  ota.init();
  assert.equal(await ota.check({ force: true }), 'error');
  assert.equal(make(dir, srv).init(), null);
  assert.ok(!srv.hits.some((u) => u.includes('/files/')), 'no file was even requested');
});

test('a file that does not match the signed hash is rejected and nothing is installed', async () => {
  const dir = tmp();
  const srv = server();
  const target = srv.manifest.files.find((f) => f.path === 'assets/app.js');
  srv.routes.set(`/prod/files/${target.sha256}`, 'console.log(evil)');
  const ota = make(dir, srv);
  ota.init();
  assert.equal(await ota.check({ force: true }), 'error');
  assert.equal(make(dir, srv).init(), null);
});

test('a bundle made for another runtime is ignored', async () => {
  const dir = tmp();
  const srv = server({ runtimeVersion: '2' });
  const ota = make(dir, srv);
  ota.init();
  assert.equal(await ota.check({ force: true }), 'current');
  assert.equal(srv.hits.filter((u) => u.includes('/files/')).length, 0);
});

test('nothing published on the channel (404) is not an error', async () => {
  const ota = make(tmp(), { fetch: async () => new Response('Not found', { status: 404 }) });
  ota.init();
  assert.equal(await ota.check({ force: true }), 'current');
});

test('a new app build drops the downloaded bundle', async () => {
  const dir = tmp();
  const srv = server();
  await make(dir, srv).check({ force: true });
  const ota = make(dir, srv);
  assert.ok(ota.init());
  ota.confirm();
  assert.equal(make(dir, srv, { appVersion: '1.0.2' }).init(), null, 'the store build is newer');
});

test('checks are throttled unless forced, and disabled builds never touch the network', async () => {
  const srv = server();
  const ota = make(tmp(), srv);
  ota.init();
  await ota.check({ force: true });
  const calls = srv.hits.length;
  await ota.check();
  assert.equal(srv.hits.length, calls, 'second check inside 15 minutes does nothing');

  const off = make(tmp(), srv, { enabled: false });
  assert.equal(off.init(), null);
  await off.check({ force: true });
  assert.equal(srv.hits.length, calls);
});

test('http base URLs are refused', async () => {
  const srv = server();
  const ota = make(tmp(), srv, { baseUrl: 'http://example.test/ota' });
  ota.init();
  assert.equal(await ota.check({ force: true }), 'error');
  assert.equal(srv.hits.length, 0);
});

test('a downloaded update stays "ready" (with its version) until the app restarts into it', async () => {
  const dir = tmp();
  const srv = server();
  const seen = [];
  const ota = make(dir, srv, { onStatus: (s) => seen.push(s) });
  ota.init();
  assert.equal(ota.pendingVersion(), null);
  assert.equal(await ota.check({ force: true }), 'ready');
  assert.deepEqual(seen.map((s) => [s.phase, s.next]), [['checking', undefined], ['downloading', srv.manifest.version], ['ready', srv.manifest.version]]);
  assert.equal(ota.pendingVersion(), srv.manifest.version);
  assert.equal(ota.info().pending, srv.manifest.version);

  // Asking again (the user pressing "Controlla" once more) must not say "up to date".
  assert.equal(await ota.check({ force: true }), 'ready');
  assert.equal(seen.at(-1).next, srv.manifest.version);

  // The restart: the new launch starts from it and nothing is pending any more.
  const next = make(dir, srv);
  assert.ok(next.init());
  assert.equal(next.pendingVersion(), null);
  assert.equal(await next.check({ force: true }), 'current');
});

test('a downloaded bundle that was damaged on disk is not offered for a restart', async () => {
  const dir = tmp();
  const srv = server();
  const ota = make(dir, srv);
  ota.init();
  await ota.check({ force: true });
  fs.rmSync(path.join(dir, 'bundles', srv.manifest.version, 'assets', 'app.js'));
  assert.equal(ota.pendingVersion(), null);
});
