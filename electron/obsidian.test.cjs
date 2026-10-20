const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const obsidian = require('./obsidian.cjs');

async function tmp(t) {
  const dir = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'lore-obsidian-')));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('detects whether a folder is a registered vault (through symlinks)', async (t) => {
  const dir = await tmp(t);
  const appData = path.join(dir, 'appData');
  const vault = path.join(dir, 'My Vault');
  await fsp.mkdir(vault);
  await fsp.symlink(vault, path.join(dir, 'link'));
  assert.equal(obsidian.isRegistered(vault, appData), false); // no registry yet
  await fsp.mkdir(path.join(appData, 'obsidian'), { recursive: true });
  await fsp.writeFile(obsidian.registryPath(appData), JSON.stringify({ vaults: { abc: { path: path.join(dir, 'link'), ts: 1, open: true } } }));
  assert.equal(obsidian.isRegistered(vault, appData), true);
  assert.equal(obsidian.isRegistered(path.join(dir, 'other'), appData), false);
});

test('builds path-based open URIs', () => {
  assert.equal(obsidian.openUri('/Users/me/Lore LLM/P/a b.md'), 'obsidian://open?path=%2FUsers%2Fme%2FLore%20LLM%2FP%2Fa%20b.md');
});

test('installed when the OS knows a handler for obsidian://', () => {
  assert.equal(obsidian.isInstalled({ protocolApp: 'Obsidian' }), true);
  assert.equal(obsidian.isInstalled({ protocolApp: '', platform: 'linux', home: '/nonexistent' }), false);
});

test('writes the default config only into a fresh vault; link format can change later', async (t) => {
  const dir = await tmp(t);
  assert.equal(await obsidian.writeDefaultConfig(dir), true);
  const app = JSON.parse(fs.readFileSync(path.join(dir, '.obsidian/app.json'), 'utf8'));
  assert.equal(app.useMarkdownLinks, true);
  assert.equal(app.newLinkFormat, 'relative');
  assert.equal(app.attachmentFolderPath, './');
  // never touches an existing config
  fs.writeFileSync(path.join(dir, '.obsidian/app.json'), JSON.stringify({ theme: 'mine' }));
  assert.equal(await obsidian.writeDefaultConfig(dir, { linkFormat: 'wikilink' }), false);
  await obsidian.setLinkFormat(dir, 'wikilink');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.obsidian/app.json'), 'utf8')), { theme: 'mine', useMarkdownLinks: false, newLinkFormat: 'shortest' });
});
