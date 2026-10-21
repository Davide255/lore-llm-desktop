// UI tests: the real renderer (Vite dev server) in the system Chrome, with the
// Electron bridge (`window.lore`) replaced by an in-page fake.
//   npm run test:ui                     (LORE_UI_SHOTS=<dir> also saves screenshots)
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.LORE_UI_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const CLAUDE_AVATAR = 'avatars.githubusercontent.com/u/81847';
const CODEX_AVATAR = 'avatars.githubusercontent.com/u/14957082';

let server;
let browser;
let url;

before(async () => {
  // Port 0: never collides with a running `npm run dev`.
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', server: { port: 0, strictPort: false } });
  await server.listen();
  url = server.resolvedUrls.local[0];
  // LORE_CHROME=<path> uses that Chromium instead of the installed Chrome.
  browser = await chromium.launch({ ...(process.env.LORE_CHROME ? { executablePath: process.env.LORE_CHROME } : { channel: 'chrome' }), headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** Installs a fake `window.lore`; every call is recorded in `window.__calls`. */
function fakeBridge({ signedIn, vault = false }) {
  const now = Date.now();
  const claude = { id: 'a-claude', name: 'Claude', kind: 'claude', permission: 'write', scope: ['*'], createdAt: now - 3_600_000 };
  const hunk = (lines) => [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((l) => `+${l}`) }];
  const state = {
    user: signedIn ? { id: 'u1', name: 'Davide Berardi', email: 'd@example.com' } : null,
    agents: [claude],
    tree: [
      {
        kind: 'folder', name: 'Athly', path: 'Athly', mtime: now, size: 0,
        children: [
          { kind: 'file', name: 'index.md', path: 'Athly/index.md', mtime: now, size: 120, author: 'agent', summary: '' },
          { kind: 'file', name: 'Test.md', path: 'Athly/Test.md', mtime: now - 60_000, size: 40, author: 'you' },
          { kind: 'file', name: 'test 1.md', path: 'Athly/test 1.md', mtime: now, size: 60, author: 'agent', agent: { id: 'a-claude', name: 'Claude', kind: 'claude' } },
          { kind: 'file', type: 'attachment', mime: 'image/png', name: 'pic.png', path: 'Athly/pic.png', mtime: now, size: 68, author: 'you' },
        ],
        project: { key: 'Athly', name: 'Athly', loaded: true, team: null, access: 'owner', fileCount: 4, updatedAt: now, checklist: null },
      },
      // Not opened yet: no children, counts and progress from the server's summary.
      {
        kind: 'folder', name: 'Archivio', path: 'Archivio', mtime: now - 86_400_000, size: 0, children: [],
        project: { key: 'Archivio', name: 'Archivio', loaded: false, team: null, access: 'owner', fileCount: 5, updatedAt: now - 86_400_000, checklist: { done: 1, total: 3 } },
      },
    ],
    archivio: [
      { kind: 'file', name: 'checklist.md', path: 'Archivio/checklist.md', mtime: now - 86_400_000, size: 30, author: 'you', done: 1, total: 3 },
      { kind: 'file', name: 'vecchio.md', path: 'Archivio/vecchio.md', mtime: now - 86_400_000, size: 30, author: 'agent' },
    ],
    activity: [
      { id: 'e1', at: now - 5_000, path: 'Athly/test 1.md', kind: 'created', by: 'agent', agent: { id: 'a-claude', name: 'Claude', kind: 'claude' }, added: 3, removed: 0, hunks: hunk(['# Test 1', '', 'Creato da Claude.']), before: null, after: '# Test 1\n\nCreato da Claude.\n' },
      { id: 'e2', at: now - 180_000, path: 'Athly/Test.md', kind: 'modified', by: 'you', added: 1, removed: 0, hunks: hunk(['Una riga mia.']), before: '# Test\n', after: '# Test\nUna riga mia.\n' },
      { id: 'e3', at: now - 240_000, path: 'Athly/old.md', kind: 'deleted', by: 'agent', agent: { id: 'gone', name: 'Agente revocato', kind: null }, added: 0, removed: 1, hunks: [], before: 'x', after: null },
    ],
    audit: [{ id: 7, at: now - 5_000, agent: { id: 'a-claude', name: 'Claude', kind: 'claude' }, action: 'CREATE', path: 'Athly/test 1.md' }],
    contents: {
      'Athly/Test.md': '# Test\n\nVedi [[test 1]], [[test 1#Sezione|la sezione]] e [[Nota mancante]].\n\n![[pic.png|120]]\n',
    },
    links: { 'Athly/Test.md': ['[[test 1]]', '[[test 1#Sezione|la sezione]]', '[[Nota mancante]]', '[[pic.png|120]]'] },
    vault: {
      state: vault ? 'idle' : 'off',
      enabled: vault,
      root: vault ? '/Users/me/Documents/Lore LLM' : null,
      defaultRoot: '/Users/me/Documents/Lore LLM',
      linkFormat: 'markdown',
      pending: 0,
      lastSyncAt: vault ? now - 30_000 : null,
      unsynced: vault ? [{ path: 'nota.md', reason: 'Fuori da un progetto: spostalo in una cartella' }] : [],
      conflicts: [],
      error: null,
      confirm: null,
    },
    obsidian: { installed: true, registered: vault },
    vaultProjects: [
      { key: 'Athly', name: 'Athly', team: null, access: 'owner', selected: true, folder: 'Athly' },
      { key: 'Archivio', name: 'Archivio', team: null, access: 'owner', selected: true, folder: 'Archivio' },
      { key: 'Athly@T1', name: 'Athly', team: { id: 'T1', name: 'Squadra' }, access: 'viewer', selected: false, folder: 'Athly (Squadra)' },
    ],
  };
  window.__calls = [];
  const rec = (name, fn) => async (...args) => {
    window.__calls.push({ name, args });
    return fn(...args);
  };
  const noop = () => () => {};
  const load = (key) => {
    const p = state.tree.find((n) => n.path === key);
    if (p && !p.project.loaded) state.tree = state.tree.map((n) => (n === p ? { ...p, children: state[key.toLowerCase()] ?? [], project: { ...p.project, loaded: true } } : n));
  };
  window.lore = {
    tree: rec('tree', async () => state.tree),
    openProject: rec('openProject', async (key) => {
      await new Promise((r) => setTimeout(r, 150));
      load(key);
      return state.tree;
    }),
    loadAll: rec('loadAll', async () => {
      for (const n of state.tree) load(n.path);
      return state.tree;
    }),
    onLoadProgress: () => () => {},
    read: rec('read', async (p) => ({ path: p, content: state.contents[p] ?? '# x\n\n## Sezione\n', mtime: now, size: 3, birthtime: now, author: 'agent' })),
    write: rec('write', async () => true),
    create: rec('create', async () => true),
    mkdir: rec('mkdir', async () => true),
    rename: rec('rename', async () => true),
    duplicate: rec('duplicate', async (p) => p),
    remove: rec('remove', async () => 't'),
    undoDelete: rec('undoDelete', async () => true),
    search: rec('search', async () => []),
    links: rec('links', async () => state.links),
    vaultStatus: rec('vaultStatus', async () => state.vault),
    vaultChooseRoot: rec('vaultChooseRoot', async () => null),
    vaultPreview: rec('vaultPreview', async (root) => ({ ok: true, root: root ?? state.vault.defaultRoot, exists: false, empty: true, download: 3 })),
    vaultEnable: rec('vaultEnable', async ({ root }) => {
      state.vault = { ...state.vault, enabled: true, state: 'idle', root: root ?? state.vault.defaultRoot };
      return state.vault;
    }),
    vaultDisable: rec('vaultDisable', async () => (state.vault = { ...state.vault, enabled: false, state: 'off' })),
    vaultSyncNow: rec('vaultSyncNow', async () => state.vault),
    vaultConfirm: rec('vaultConfirm', async () => state.vault),
    vaultReveal: rec('vaultReveal', async () => true),
    vaultSetLinkFormat: rec('vaultSetLinkFormat', async (f) => (state.vault = { ...state.vault, linkFormat: f })),
    vaultProjects: rec('vaultProjects', async () => state.vaultProjects),
    vaultSetProject: rec('vaultSetProject', async (key, on) => {
      state.vaultProjects = state.vaultProjects.map((p) => (p.key === key ? { ...p, selected: on } : p));
      return true;
    }),
    obsidianStatus: rec('obsidianStatus', async () => state.obsidian),
    openInObsidian: rec('openInObsidian', async () => true),
    launchObsidian: rec('launchObsidian', async () => {}),
    openAttachment: rec('openAttachment', async () => ''),
    takePendingLink: rec('takePendingLink', async () => null),
    activity: rec('activity', async () => state.activity),
    markActivitySeen: rec('markActivitySeen', async () => now),
    lastSeenActivity: rec('lastSeenActivity', async () => 0),
    agents: rec('agents', async () => state.agents),
    createAgent: rec('createAgent', async (a) => {
      const agent = { id: `a-${a.kind}-new`, ...a, createdAt: Date.now() };
      state.agents = [agent, ...state.agents];
      return { agent, token: 'tok.' + 'x'.repeat(180), expiresAt: Date.now() + 90 * 86_400_000, mcpUrl: 'https://lore.test/mcp' };
    }),
    updateAgent: rec('updateAgent', async () => true),
    deleteAgent: rec('deleteAgent', async () => true),
    audit: rec('audit', async () => ({ items: state.audit, nextBefore: null })),
    server: rec('server', async () => 'lore.test'),
    prefs: rec('prefs', async () => ({})),
    setPrefs: rec('setPrefs', async (p) => p),
    copy: rec('copy', async () => {}),
    platform: rec('platform', async () => 'win32'),
    confirmClose: rec('confirmClose', async () => {}),
    authUser: rec('authUser', async () => state.user),
    signIn: rec('signIn', async () => state.user),
    cancelSignIn: rec('cancelSignIn', async () => {}),
    signOut: rec('signOut', async () => {}),
    onAuthChanged: noop,
    onChanged: noop,
    onActivity: noop,
    onCloseRequested: noop,
    onVaultStatus: noop,
    onVaultConflict: noop,
    onVaultConfirm: noop,
    onVaultNotice: noop,
    onNavigate: noop,
  };
}

async function open({ signedIn = true, vault = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(fakeBridge, { signedIn, vault });
  await page.goto(url);
  return { page, errors };
}

// Dialogs fade/pop in (~140 ms): let the animation settle before capturing.
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};
const calls = (page, name) => page.evaluate((n) => window.__calls.filter((c) => c.name === n).map((c) => c.args), name);

test('signed out: the login screen is the only thing reachable', async () => {
  const { page, errors } = await open({ signedIn: false });
  await page.getByText('Accedi con Google').waitFor();
  for (const chrome of ['Progetti', 'Cerca', 'Sincronizzato', 'Impostazioni']) {
    assert.equal(await page.getByText(chrome, { exact: true }).count(), 0, `"${chrome}" must not show before login`);
  }
  assert.deepEqual(await calls(page, 'tree'), [], 'the knowledge base is not loaded before login');
  // Sign in with Apple sits next to Google (App Store rule 4.8) and asks for the Apple provider.
  await page.getByText('Accedi con Apple').click();
  assert.deepEqual(await calls(page, 'signIn'), [['apple']]);
  await shot(page, '1-login');
  assert.deepEqual(errors, []);
  await page.close();
});

test('activity says who edited what, with the agent picture', async () => {
  const { page, errors } = await open();
  await page.getByText('Attività', { exact: true }).first().click();
  await page.getByText('Claude ha creato').waitFor();
  assert.equal(await page.getByText('Hai modificato').count(), 1);
  assert.equal(await page.getByText('Un agente ha eliminato').count(), 0, 'revoked agents keep their snapshot name');
  assert.equal(await page.getByText('Agente revocato ha eliminato').count(), 1);
  // Row + detail header use Claude's picture.
  assert.ok((await page.locator(`img[src*="${CLAUDE_AVATAR}"]`).count()) >= 2);
  await page.getByText('Modifica di Claude').waitFor();
  await shot(page, '2-activity');
  assert.deepEqual(errors, []);
  await page.close();
});

test('file tables name the agent that wrote the file', async () => {
  const { page, errors } = await open();
  await page.getByText('Athly', { exact: true }).first().click();
  await page.getByText('Claude', { exact: true }).first().waitFor();
  assert.ok((await page.locator(`img[src*="${CLAUDE_AVATAR}"]`).count()) >= 1);
  await shot(page, '3-folder');
  assert.deepEqual(errors, []);
  await page.close();
});

test('create agent: type selector, friendly name, permission', async () => {
  const { page, errors } = await open();
  await page.getByText('Impostazioni', { exact: true }).first().click();
  await page.getByText('Agenti', { exact: true }).first().click();
  await page.getByText('Collega un agente').first().click();

  const radios = page.getByRole('radio');
  assert.equal(await radios.count(), 2);
  assert.equal(await page.getByRole('radio', { name: 'Claude' }).getAttribute('aria-checked'), 'true', 'Claude is the default');
  assert.ok((await page.locator(`img[src*="${CODEX_AVATAR}"]`).count()) >= 1, 'Codex option shows its picture');
  await shot(page, '4-create-dialog');

  // Empty name: the button falls back to the client's name.
  await page.getByRole('radio', { name: 'Codex' }).click();
  assert.equal(await page.getByRole('radio', { name: 'Codex' }).getAttribute('aria-checked'), 'true');
  await page.getByText('Collega Codex').waitFor();

  await page.getByPlaceholder(/Codex/).fill('Codex lavoro');
  await page.getByText('Sola lettura', { exact: true }).click();
  await page.getByText('Collega Codex lavoro').click();

  assert.deepEqual(await calls(page, 'createAgent'), [[{ kind: 'codex', name: 'Codex lavoro', permission: 'read', scope: ['*'] }]]);
  // Token dialog: Codex identity + Codex config snippet, shown once.
  await page.getByText('Codex lavoro è collegato').waitFor();
  await page.getByText('Codex · ~/.codex/config.toml').waitFor();
  assert.equal(await page.getByText('Codex · sola lettura').count(), 1);
  await shot(page, '5-token-dialog');
  await page.getByText('Fatto', { exact: true }).click();

  // The new agent is listed with its type under the friendly name.
  await page.getByText('Codex lavoro', { exact: true }).waitFor();
  await shot(page, '6-agents');
  assert.deepEqual(errors, []);
  await page.close();
});

test('create agent with defaults: Claude, read and write', async () => {
  const { page } = await open();
  await page.getByText('Impostazioni', { exact: true }).first().click();
  await page.getByText('Agenti', { exact: true }).first().click();
  await page.getByText('Collega un agente').first().click();
  await page.keyboard.press('Enter');
  assert.deepEqual(await calls(page, 'createAgent'), [[{ kind: 'claude', name: 'Claude', permission: 'write', scope: ['*'] }]]);
  await page.getByText('claude mcp add --transport http lore', { exact: false }).waitFor();
  await page.close();
});

test('wikilinks render, resolve and navigate; missing ones are dimmed and offer to create', async () => {
  const { page, errors } = await open();
  await page.getByText('Athly', { exact: true }).first().click();
  await page.getByText('Test.md', { exact: true }).first().click();
  await page.getByText('la sezione', { exact: true }).waitFor();
  // The embed resolves to the attachment (its bytes come from Electron's lore-asset:// protocol,
  // which a plain browser can't load: then the image falls back to its name).
  assert.equal(await page.locator('[data-asset="Athly/pic.png"]').count(), 1);
  await shot(page, '7-wikilinks');
  // A missing note: toast with "Crea nota".
  await page.getByText('Nota mancante', { exact: true }).click();
  await page.getByText('non esiste ancora').waitFor();
  await page.getByText('Crea nota', { exact: true }).click();
  assert.deepEqual(await calls(page, 'create'), [['Athly/Nota mancante.md', '# Nota mancante\n\n']]);
  // A resolved one navigates.
  await page.getByText('Test.md', { exact: true }).first().click();
  await page.getByText('test 1', { exact: true }).first().click();
  await page.getByText('Citato da').waitFor();
  assert.ok((await calls(page, 'read')).some(([p]) => p === 'Athly/test 1.md'));
  assert.deepEqual(errors, []);
  await page.close();
});

test('attachments open in their own screen', async () => {
  const { page, errors } = await open();
  await page.getByText('Athly', { exact: true }).first().click();
  await page.getByText('pic.png', { exact: true }).first().click();
  await page.getByText('Usato in').waitFor();
  await page.getByText('Apri', { exact: true }).click();
  assert.deepEqual(await calls(page, 'openAttachment'), [['Athly/pic.png']]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('projects load when opened: cards show the summary, the project loads on click', async () => {
  const { page, errors } = await open();
  await page.getByText('Archivio', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('5 file', { exact: false }).count() > 0, true, 'the server count stands in');
  await page.getByText('1/3', { exact: true }).first().waitFor();
  assert.deepEqual(await calls(page, 'openProject'), [], 'nothing loads at launch');
  await shot(page, '11-lazy-projects');
  await page.getByText('Archivio', { exact: true }).last().click();
  await page.getByText('Apertura del progetto…').waitFor();
  await page.getByText('vecchio.md', { exact: true }).first().waitFor();
  assert.deepEqual(await calls(page, 'openProject'), [['Archivio']]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('search offers to load the projects not opened yet', async () => {
  const { page, errors } = await open();
  await page.getByText('Cerca', { exact: true }).first().click();
  await page.getByPlaceholder('Cerca in tutti i progetti…').fill('zebra');
  await page.getByText('Cerca in tutti i progetti (1 non ancora aperti)').click();
  await page.waitForFunction(() => window.__calls.some((c) => c.name === 'loadAll'));
  await page.getByText('Cerca in tutti i progetti (1 non ancora aperti)').waitFor({ state: 'detached' });
  // The query runs again over every project.
  await page.waitForFunction(() => window.__calls.filter((c) => c.name === 'search').length >= 2);
  assert.deepEqual(errors, []);
  await page.close();
});

test('obsidian: setup from settings enables the local vault', async () => {
  const { page, errors } = await open();
  await page.getByText('Usi Obsidian?').waitFor();
  await page.getByText('Impostazioni', { exact: true }).first().click();
  await page.getByText('Obsidian', { exact: true }).first().click();
  await page.getByText('Copia locale della knowledge base').waitFor();
  await page.getByRole('switch').first().click();
  await page.getByText('Copia locale per Obsidian').waitFor();
  await page.getByText('Verrà creata: 3 file da scaricare.').waitFor();
  await shot(page, '8-vault-setup');
  await page.getByText('Attiva', { exact: true }).click();
  assert.deepEqual(await calls(page, 'vaultEnable'), [[{ root: '/Users/me/Documents/Lore LLM', linkFormat: 'markdown' }]]);
  // Next step explains the one manual step in Obsidian.
  await page.getByText('Scegli «Apri cartella come vault» (Open folder as vault)').waitFor();
  await shot(page, '9-vault-register');
  assert.deepEqual(errors, []);
  await page.close();
});

test('obsidian: status, "Apri in Obsidian" and the default editor', async () => {
  const { page, errors } = await open({ vault: true });
  await page.getByText('Impostazioni', { exact: true }).first().click();
  await page.getByText('Obsidian', { exact: true }).first().click();
  await page.getByText('Sincronizzata', { exact: true }).waitFor();
  await page.getByText('Non sincronizzati (1)').waitFor();
  // Per-project selection: the team project is off until switched on.
  await page.getByText('Progetti nella copia locale').waitFor();
  const switches = page.getByRole('switch');
  const n = await switches.count();
  await switches.nth(n - 1).click();
  assert.deepEqual(await calls(page, 'vaultSetProject'), [['Athly@T1', true]]);
  await page.getByText('Athly (Squadra)/ · sola lettura').waitFor();
  await shot(page, '10-vault-status');
  // Default editor → Obsidian: "Modifica" hands the note over.
  await page.getByText('Obsidian', { exact: true }).last().click();
  assert.ok((await calls(page, 'setPrefs')).some(([p]) => p.defaultEditor === 'obsidian'));
  await page.getByText('Athly', { exact: true }).first().click();
  await page.getByText('Test.md', { exact: true }).first().click();
  await page.getByLabel('Apri in Obsidian').click();
  await page.getByText('Modifica in Obsidian').click();
  assert.deepEqual(await calls(page, 'openInObsidian'), [['Athly/Test.md'], ['Athly/Test.md']]);
  assert.deepEqual(errors, []);
  await page.close();
});
