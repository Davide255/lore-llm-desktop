// Background runner: with the local vault (Obsidian) on, closing the window hides the app
// instead of quitting it, so the vault keeps syncing. Pure decisions live here; main.cjs
// owns the window, the tray and the login item.

/** Windows and macOS only: a tray / menu-bar icon is what keeps the app reachable once the window is hidden. */
const supported = (platform) => platform === 'darwin' || platform === 'win32';

const DEFAULTS = { openAtLogin: false, background: true };

/** Stored settings, tolerating missing or malformed values. */
function normalize(raw) {
  return {
    openAtLogin: typeof raw?.openAtLogin === 'boolean' ? raw.openAtLogin : DEFAULTS.openAtLogin,
    background: typeof raw?.background === 'boolean' ? raw.background : DEFAULTS.background,
  };
}

/** The runner is on when the user wants it, the vault is on and somebody is signed in. */
function isActive({ platform, settings, vaultEnabled, signedIn }) {
  return supported(platform) && !!settings.background && !!vaultEnabled && !!signedIn;
}

/**
 * Launched by the login item (or with --hidden): start without a window, but only when the
 * runner is on. Otherwise a hidden app would have no way back besides the Dock / taskbar.
 */
function startsHidden({ argv, platform, wasOpenedAtLogin, active }) {
  if (!active) return false;
  return argv.includes('--hidden') || (platform === 'darwin' && !!wasOpenedAtLogin);
}

/** Arguments for app.setLoginItemSettings. Windows passes a flag; macOS reports wasOpenedAtLogin. */
function loginItemSettings(openAtLogin, platform) {
  return platform === 'win32' ? { openAtLogin, args: ['--hidden'] } : { openAtLogin };
}

/**
 * What a close request should do. `confirmed`: the renderer already agreed (nothing unsaved).
 * Quitting with the window hidden must not ask the renderer anything nobody can see.
 */
function closeAction({ allowClose, active, quitting, visible }) {
  if (quitting) return visible && !allowClose ? 'ask' : 'close';
  if (!active) return allowClose ? 'close' : 'ask';
  return allowClose ? 'hide' : 'ask';
}

module.exports = { supported, DEFAULTS, normalize, isActive, startsHidden, loginItemSettings, closeAction };
