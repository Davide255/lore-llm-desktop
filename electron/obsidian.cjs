// Obsidian as the external editor of the local vault: is it installed, is our
// folder registered as one of its vaults, how to open a note in it, and the
// settings a fresh vault starts with. Read-only towards Obsidian's own files.
// No Electron imports: callers pass in the app paths.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/** Obsidian's vault registry: `<appData>/obsidian/obsidian.json` = { vaults: { id: { path, ts, open } } }. */
function registryPath(appDataDir) {
  return path.join(appDataDir, 'obsidian', 'obsidian.json');
}

function realpath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function registeredVaults(appDataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(registryPath(appDataDir), 'utf8'));
    return Object.values(data.vaults ?? {}).map((v) => v.path).filter((p) => typeof p === 'string');
  } catch {
    return [];
  }
}

function isRegistered(root, appDataDir) {
  const want = realpath(root);
  const norm = (p) => (process.platform === 'linux' ? p : p.toLowerCase());
  return registeredVaults(appDataDir).some((p) => norm(realpath(p)) === norm(want));
}

/** `protocolApp`: what the OS says handles obsidian:// (app.getApplicationNameForProtocol). */
function isInstalled({ protocolApp, platform = process.platform, env = process.env, home = '' } = {}) {
  if (protocolApp) return true;
  const candidates =
    platform === 'darwin'
      ? ['/Applications/Obsidian.app', path.join(home, 'Applications', 'Obsidian.app')]
      : platform === 'win32'
        ? [path.join(env.LOCALAPPDATA ?? '', 'Programs', 'Obsidian', 'Obsidian.exe'), path.join(env.LOCALAPPDATA ?? '', 'Obsidian', 'Obsidian.exe')]
        : ['/usr/bin/obsidian', '/opt/Obsidian/obsidian', '/var/lib/flatpak/exports/bin/md.obsidian.Obsidian', path.join(home, '.local/share/flatpak/exports/bin/md.obsidian.Obsidian')];
  return candidates.some((p) => p && fs.existsSync(p));
}

/** `path=` opens the file in whichever registered vault contains it (vault names are ambiguous). */
function openUri(absPath) {
  return `obsidian://open?path=${encodeURIComponent(absPath)}`;
}

/**
 * Settings that make Obsidian write what Lore, agents and the mobile app read:
 * relative markdown links (or wikilinks, if chosen), attachments next to the
 * note (inside a project, never at the vault root), links kept up to date on rename.
 */
function linkSettings(linkFormat) {
  return linkFormat === 'wikilink'
    ? { useMarkdownLinks: false, newLinkFormat: 'shortest' }
    : { useMarkdownLinks: true, newLinkFormat: 'relative' };
}

/** Writes `.obsidian/app.json` only for a vault Obsidian has never opened. Returns true when written. */
async function writeDefaultConfig(root, { linkFormat = 'markdown' } = {}) {
  const dir = path.join(root, '.obsidian');
  if (fs.existsSync(dir)) return false;
  await fsp.mkdir(dir, { recursive: true });
  const app = {
    ...linkSettings(linkFormat),
    alwaysUpdateLinks: true,
    newFileLocation: 'current',
    attachmentFolderPath: './',
    showUnsupportedFiles: false,
  };
  await fsp.writeFile(path.join(dir, 'app.json'), JSON.stringify(app, null, 2));
  return true;
}

/** Changes only the link keys of an existing config (Obsidian picks it up on restart). */
async function setLinkFormat(root, linkFormat) {
  const file = path.join(root, '.obsidian', 'app.json');
  let app = {};
  try {
    app = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    /* missing or unreadable: start from scratch */
  }
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify({ ...app, ...linkSettings(linkFormat) }, null, 2));
}

module.exports = { registryPath, registeredVaults, isRegistered, isInstalled, openUri, writeDefaultConfig, setLinkFormat };
