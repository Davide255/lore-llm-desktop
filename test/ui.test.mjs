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
function fakeBridge({ signedIn, vault = false, ota = null }) {
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
      // A team project where the user can only read.
      {
        kind: 'folder', name: 'Piano', path: 'Piano@T2', mtime: now - 3_600_000, size: 0,
        children: [{ kind: 'file', name: 'note.md', path: 'Piano@T2/note.md', mtime: now - 3_600_000, size: 20, author: 'teammate' }],
        project: { key: 'Piano@T2', name: 'Piano', loaded: true, team: { id: 'T2', name: 'Clienti' }, access: 'viewer', fileCount: 1, updatedAt: now - 3_600_000, checklist: null },
      },
    ],
    teams: [
      { id: 'T1', name: 'Squadra', role: 'owner', createdAt: now },
      { id: 'T2', name: 'Clienti', role: 'viewer', createdAt: now },
    ],
    members: {
      T1: [
        { userId: 'u1', role: 'owner', joinedAt: now, name: 'Davide Berardi', email: 'd@example.com', isYou: true },
        { userId: 'u2', role: 'editor', joinedAt: now, name: 'Anna Rossi', email: 'anna@example.com', isYou: false },
      ],
    },
    invites: [{ id: 'inv1', teamId: 'T3', teamName: 'Ricerca', role: 'editor', invitedBy: 'Marco', createdAt: now, expiresAt: now + 7 * 86_400_000 }],
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
    // Uploads: `upload` plans two files and stops half way through the first; the test drives the rest.
    onUpload: (cb) => {
      window.__uploadEmit = cb;
      return () => {};
    },
    upload: rec('upload', async (dir, files, opts) => {
      const size = 4_000_000;
      if (opts?.folder) {
        // A folder with a file in a subfolder: one grey row for the whole folder, bytes added up.
        window.__uploadEmit({ type: 'plan', items: [{ id: 1, path: `${dir}/album/a.png`, name: 'a.png', size: 1000 }, { id: 2, path: `${dir}/album/sub/b.pdf`, name: 'b.pdf', size: 3000 }] });
        window.__uploadEmit({ type: 'progress', id: 1, sent: 1000 });
        window.__uploadEmit({ type: 'progress', id: 2, sent: 1000 });
      } else {
        window.__uploadEmit({ type: 'plan', items: [{ id: 1, path: `${dir}/big.pdf`, name: 'big.pdf', size }, { id: 2, path: `${dir}/next.png`, name: 'next.png', size: 1000 }] });
        window.__uploadEmit({ type: 'progress', id: 1, sent: size / 2 });
      }
      await new Promise((r) => (window.__finishUpload = r));
      window.__uploadEmit({ type: 'done', id: 1 });
      window.__uploadEmit({ type: 'done', id: 2 });
      return { uploaded: [], skipped: [] };
    }),
    onInvites: () => () => {},
    teams: rec('teams', async () => state.teams),
    team: rec('team', async (id) => state.teams.find((t) => t.id === id)),
    createTeam: rec('createTeam', async (name) => {
      const team = { id: 'T9', name, role: 'owner', createdAt: Date.now() };
      state.teams = [...state.teams, team];
      state.members.T9 = [{ userId: 'u1', role: 'owner', joinedAt: Date.now(), name: 'Davide Berardi', email: 'd@example.com', isYou: true }];
      return team;
    }),
    renameTeam: rec('renameTeam', async () => true),
    deleteTeam: rec('deleteTeam', async () => true),
    teamMembers: rec('teamMembers', async (id) => state.members[id] ?? []),
    setMemberRole: rec('setMemberRole', async () => true),
    removeMember: rec('removeMember', async () => true),
    teamInvites: rec('teamInvites', async () => []),
    inviteToTeam: rec('inviteToTeam', async (id, email, role) => ({ id: 'i9', email, role, createdAt: now, expiresAt: now + 7 * 86_400_000 })),
    revokeInvite: rec('revokeInvite', async () => true),
    myInvites: rec('myInvites', async () => state.invites),
    answerInvite: rec('answerInvite', async (id) => (state.invites = state.invites.filter((i) => i.id !== id))),
    moveToTeam: rec('moveToTeam', async (key, teamId) => `${key}@${teamId}`),
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
    otaReady: async () => {},
    otaStatus: async () => ota?.info ?? { enabled: false, phase: 'idle', appVersion: '', channel: 'production', version: null },
    // `ota.result`: what a manual check finds ('ready' = a new version was downloaded).
    otaCheck: rec('otaCheck', async () => {
      if (!ota) return 'idle';
      ota.info = ota.result === 'ready' ? { ...ota.info, phase: 'ready', next: '1.0.7', pending: '1.0.7' } : { ...ota.info, phase: ota.result };
      return ota.result;
    }),
    otaApply: rec('otaApply', async () => true),
    onOtaStatus: noop,
  };
}

async function open({ signedIn = true, vault = false, ota = null } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(fakeBridge, { signedIn, vault, ota });
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

test('uploading: the file shows greyed out with a bar and its percentage until it is done', async () => {
  const { page, errors } = await open();
  await page.getByText('Athly', { exact: true }).first().click();
  await page.getByText('Nuovo', { exact: true }).click();
  await page.getByText('Carica file…').click();
  const big = page.getByRole('progressbar', { name: /big\.pdf/ });
  await big.waitFor();
  assert.match(await big.innerText(), /50%/);
  assert.match(await big.innerText(), /Caricamento/);
  const next = page.getByRole('progressbar', { name: /next\.png/ });
  assert.match(await next.innerText(), /In attesa/);
  assert.match(await next.innerText(), /0%/);
  await shot(page, 'upload-progress');
  // Greyed rows are not links: clicking one goes nowhere.
  await big.click();
  assert.equal(await page.getByText('Nuovo', { exact: true }).count(), 1);
  await page.evaluate(() => window.__finishUpload());
  await big.waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('progressbar').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('uploading a folder: one greyed row for the folder with the bytes of all its files', async () => {
  const { page, errors } = await open();
  await page.getByText('Athly', { exact: true }).first().click();
  await page.getByText('Nuovo', { exact: true }).click();
  await page.getByText('Carica cartella…').click();
  const row = page.getByRole('progressbar', { name: /album/ });
  await row.waitFor();
  // 2000 of 4000 bytes sent across a.png and sub/b.pdf.
  assert.match(await row.innerText(), /50%/);
  assert.match(await row.innerText(), /2 file/);
  assert.equal(await page.getByRole('progressbar').count(), 1, 'the files inside are not listed one by one');
  assert.deepEqual((await calls(page, 'upload'))[0].slice(1), [undefined, { folder: true }]);
  await page.evaluate(() => window.__finishUpload());
  await row.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  await page.close();
});

test('dropping a folder walks it: subfolders kept, hidden files dropped, other types left unread', async () => {
  const { page, errors } = await open();
  await page.getByText('Athly', { exact: true }).first().click();
  await page.getByText('Nuovo', { exact: true }).waitFor();
  await page.evaluate(() => {
    const file = (name, text) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok(new File([text], name)) });
    const dir = (name, kids) => ({
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => {
        let done = false;
        return { readEntries: (ok) => ok(done ? [] : ((done = true), kids)) };
      },
    });
    const album = dir('album', [file('a.png', 'aaa'), file('.DS_Store', 'x'), file('clip.mp4', 'video'), dir('sub', [file('n.md', 'hello')]), dir('.git', [file('c.md', 'x')])]);
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [], items: [{ kind: 'file', webkitGetAsEntry: () => album }] } });
    document.dispatchEvent(event);
  });
  await page.waitForFunction(() => window.__calls.some((c) => c.name === 'upload'));
  const [, files] = (await calls(page, 'upload'))[0];
  assert.deepEqual(files.map((f) => [f.dir, f.name, f.skip ? 'skipped' : 'read']), [['album', 'a.png', 'read'], ['album', 'clip.mp4', 'skipped'], ['album/sub', 'n.md', 'read']]);
  await page.evaluate(() => window.__finishUpload?.());
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

test('team projects: pill on the card, read-only for a viewer', async () => {
  const { page, errors } = await open();
  await page.getByText('Piano', { exact: true }).first().waitFor();
  assert.ok((await page.getByLabel('Team Clienti').count()) >= 1, 'the card carries the team');
  await page.getByText('Piano', { exact: true }).first().click(); // the sidebar row
  await page.getByText('Sei in sola lettura in questo progetto del team', { exact: false }).waitFor();
  assert.equal(await page.getByText('Nuovo', { exact: true }).count(), 0, 'no "Nuovo" for a viewer');
  await shot(page, '12-team-viewer');
  await page.getByText('note.md', { exact: true }).first().click();
  await page.getByText('Sola lettura', { exact: true }).waitFor();
  assert.equal(await page.getByText('Modifica', { exact: true }).count(), 0);
  // The item menu only reads.
  await page.getByText('note.md', { exact: true }).nth(1).click({ button: 'right' }); // breadcrumb, then the sidebar row
  await page.getByText('Copia link', { exact: true }).waitFor();
  assert.equal(await page.getByText('Elimina', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Rinomina', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});

test('invites: accepted from the projects screen', async () => {
  const { page, errors } = await open();
  await page.getByText('Invito al team Ricerca').waitFor();
  await page.getByText('Marco ti invita come editor', { exact: false }).waitFor();
  await shot(page, '13-invite');
  await page.getByText('Accetta', { exact: true }).click();
  assert.deepEqual(await calls(page, 'answerInvite'), [['inv1', true]]);
  await page.getByText('Invito al team Ricerca').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  await page.close();
});

test('settings: create a team, see its members, invite someone', async () => {
  const { page, errors } = await open();
  await page.getByText('Impostazioni', { exact: true }).first().click();
  await page.getByText('Team', { exact: true }).first().click();
  await page.getByText('Squadra', { exact: true }).first().click();
  await page.getByText('Anna Rossi', { exact: true }).waitFor();
  await page.getByPlaceholder('nome@esempio.it').fill('luca@example.com');
  await page.getByText('Sola lettura', { exact: true }).last().click();
  await page.getByText('Invita', { exact: true }).last().click();
  assert.deepEqual(await calls(page, 'inviteToTeam'), [['T1', 'luca@example.com', 'viewer']]);
  await shot(page, '14-team-settings');
  await page.getByPlaceholder('Nome del nuovo team').fill('Nuovo team');
  await page.getByText('Crea team', { exact: true }).click();
  assert.deepEqual(await calls(page, 'createTeam'), [['Nuovo team']]);
  await page.getByText('Team Nuovo team creato').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('"Sposta in un team…" moves one of your projects into a team you can write in', async () => {
  const { page, errors } = await open();
  await page.getByText('Athly', { exact: true }).first().click({ button: 'right' }); // the sidebar row
  await page.getByText('Sposta in un team…').click();
  await page.getByText('Sposta in un team', { exact: true }).waitFor();
  assert.equal(await page.getByRole('radio', { name: 'Clienti' }).count(), 0, 'not a team where you only read');
  await shot(page, '15-move-to-team');
  await page.getByText('Sposta', { exact: true }).click();
  assert.deepEqual(await calls(page, 'moveToTeam'), [['Athly', 'T1']]);
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

test('the unseen-activity badge is centred in its sidebar row', async () => {
  const { page, errors } = await open();
  await page.getByText('Attività', { exact: true }).first().waitFor();
  const off = await page.evaluate(() => {
    const label = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && d.textContent === 'Attività');
    const row = label.parentElement;
    const badge = [...row.querySelectorAll('div')].find((d) => d.children.length === 0 && /^\d+$/.test(d.textContent)).parentElement;
    const r = row.getBoundingClientRect();
    const b = badge.getBoundingClientRect();
    return Math.abs(r.top + r.height / 2 - (b.top + b.height / 2));
  });
  assert.ok(off < 1, `badge is ${off}px off the row centre`);
  await shot(page, '4-sidebar-badge');
  assert.deepEqual(errors, []);
  await page.close();
});

const OTA_INFO = { enabled: true, phase: 'idle', appVersion: '1.0.6', channel: 'production', version: null, pending: null };

test('checking for updates: a new version is downloaded and the user is asked to restart', async () => {
  const { page, errors } = await open({ ota: { info: OTA_INFO, result: 'ready' } });
  await page.getByText('Impostazioni', { exact: true }).first().click();
  await page.getByText('Generale', { exact: true }).first().click();
  await page.getByText('Controlla', { exact: true }).click();
  await page.getByText('Nuova versione pronta').waitFor();
  await page.getByText('Vuoi aggiornare adesso?', { exact: false }).waitFor();
  await shot(page, '5-update-dialog');
  // "Più tardi" keeps working and leaves a restart button next to the check.
  await page.getByText('Più tardi', { exact: true }).click();
  await page.getByText('Riavvia e aggiorna', { exact: true }).waitFor();
  assert.deepEqual(await calls(page, 'otaApply'), [], 'nothing restarts until the user says so');
  // "Sì": the main process is asked to restart.
  await page.getByText('Controlla', { exact: true }).click();
  await page.getByText('Nuova versione pronta').waitFor();
  await page.getByText('Riavvia e aggiorna', { exact: true }).last().click();
  await page.waitForFunction(() => window.__calls.some((c) => c.name === 'otaApply'));
  assert.deepEqual(await calls(page, 'otaApply'), [[]]);
  assert.deepEqual(errors, []);
  await page.close();
});

test('checking for updates: already up to date says so', async () => {
  const { page, errors } = await open({ ota: { info: OTA_INFO, result: 'current' } });
  await page.getByText('Impostazioni', { exact: true }).first().click();
  await page.getByText('Generale', { exact: true }).first().click();
  await page.getByText('Controlla', { exact: true }).click();
  await page.getByText("Sei già all'ultima versione").waitFor();
  assert.equal(await page.getByText('Nuova versione pronta').count(), 0);
  assert.deepEqual(errors, []);
  await page.close();
});
