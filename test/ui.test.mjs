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
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** Installs a fake `window.lore`; every call is recorded in `window.__calls`. */
function fakeBridge({ signedIn }) {
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
        ],
      },
    ],
    activity: [
      { id: 'e1', at: now - 5_000, path: 'Athly/test 1.md', kind: 'created', by: 'agent', agent: { id: 'a-claude', name: 'Claude', kind: 'claude' }, added: 3, removed: 0, hunks: hunk(['# Test 1', '', 'Creato da Claude.']), before: null, after: '# Test 1\n\nCreato da Claude.\n' },
      { id: 'e2', at: now - 180_000, path: 'Athly/Test.md', kind: 'modified', by: 'you', added: 1, removed: 0, hunks: hunk(['Una riga mia.']), before: '# Test\n', after: '# Test\nUna riga mia.\n' },
      { id: 'e3', at: now - 240_000, path: 'Athly/old.md', kind: 'deleted', by: 'agent', agent: { id: 'gone', name: 'Agente revocato', kind: null }, added: 0, removed: 1, hunks: [], before: 'x', after: null },
    ],
    audit: [{ id: 7, at: now - 5_000, agent: { id: 'a-claude', name: 'Claude', kind: 'claude' }, action: 'CREATE', path: 'Athly/test 1.md' }],
  };
  window.__calls = [];
  const rec = (name, fn) => async (...args) => {
    window.__calls.push({ name, args });
    return fn(...args);
  };
  const noop = () => () => {};
  window.lore = {
    tree: rec('tree', async () => state.tree),
    read: rec('read', async (p) => ({ path: p, content: '# x', mtime: now, size: 3, birthtime: now, author: 'agent' })),
    write: rec('write', async () => true),
    create: rec('create', async () => true),
    mkdir: rec('mkdir', async () => true),
    rename: rec('rename', async () => true),
    duplicate: rec('duplicate', async (p) => p),
    remove: rec('remove', async () => 't'),
    undoDelete: rec('undoDelete', async () => true),
    search: rec('search', async () => []),
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
  };
}

async function open({ signedIn = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(fakeBridge, { signedIn });
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
