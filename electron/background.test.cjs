const test = require('node:test');
const assert = require('node:assert/strict');
const { supported, normalize, isActive, startsHidden, loginItemSettings, closeAction } = require('./background.cjs');

const on = { platform: 'darwin', settings: { openAtLogin: false, background: true }, vaultEnabled: true, signedIn: true };

test('supported only on macOS and Windows', () => {
  assert.equal(supported('darwin'), true);
  assert.equal(supported('win32'), true);
  assert.equal(supported('linux'), false);
});

test('normalize fills defaults and ignores junk', () => {
  assert.deepEqual(normalize(undefined), { openAtLogin: false, background: true });
  assert.deepEqual(normalize({ openAtLogin: 'yes', background: false }), { openAtLogin: false, background: false });
});

test('runner needs the setting, the vault, a user and a supported platform', () => {
  assert.equal(isActive(on), true);
  assert.equal(isActive({ ...on, vaultEnabled: false }), false);
  assert.equal(isActive({ ...on, signedIn: false }), false);
  assert.equal(isActive({ ...on, settings: { ...on.settings, background: false } }), false);
  assert.equal(isActive({ ...on, platform: 'linux' }), false);
});

test('starts hidden only when launched at login with the runner on', () => {
  assert.equal(startsHidden({ argv: ['app', '--hidden'], platform: 'win32', active: true }), true);
  assert.equal(startsHidden({ argv: ['app'], platform: 'darwin', wasOpenedAtLogin: true, active: true }), true);
  assert.equal(startsHidden({ argv: ['app'], platform: 'win32', wasOpenedAtLogin: true, active: true }), false);
  assert.equal(startsHidden({ argv: ['app', '--hidden'], platform: 'win32', active: false }), false);
  assert.equal(startsHidden({ argv: ['app'], platform: 'darwin', active: true }), false);
});

test('login item: Windows gets the --hidden flag', () => {
  assert.deepEqual(loginItemSettings(true, 'win32'), { openAtLogin: true, args: ['--hidden'] });
  assert.deepEqual(loginItemSettings(false, 'darwin'), { openAtLogin: false });
});

test('close hides when the runner is on, after the renderer agreed', () => {
  assert.equal(closeAction({ allowClose: false, active: true, quitting: false, visible: true }), 'ask');
  assert.equal(closeAction({ allowClose: true, active: true, quitting: false, visible: true }), 'hide');
  assert.equal(closeAction({ allowClose: false, active: false, quitting: false, visible: true }), 'ask');
  assert.equal(closeAction({ allowClose: true, active: false, quitting: false, visible: true }), 'close');
});

test('quitting closes a hidden window without asking', () => {
  assert.equal(closeAction({ allowClose: false, active: true, quitting: true, visible: false }), 'close');
  assert.equal(closeAction({ allowClose: false, active: true, quitting: true, visible: true }), 'ask');
  assert.equal(closeAction({ allowClose: true, active: true, quitting: true, visible: true }), 'close');
});
