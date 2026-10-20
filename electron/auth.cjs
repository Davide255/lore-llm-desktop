// Sign in with Google or Apple, brokered by AWS Cognito (the same user pool the
// lore-llm Worker trusts). Authorization Code + PKCE in the system browser,
// callback caught by a short-lived loopback server. Tokens never reach the
// renderer: they stay in the main process, encrypted at rest with safeStorage.
const { app, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

// Overridable per environment: LORE_COGNITO_DOMAIN=... LORE_COGNITO_CLIENT_ID=... npm run dev
const COGNITO_DOMAIN = (process.env.LORE_COGNITO_DOMAIN || 'https://eu-north-1orshbeg8h.auth.eu-north-1.amazoncognito.com').replace(/\/+$/, '');
// Public "Lore LLM Desktop" app client (no secret) in the dev pool.
const CLIENT_ID = process.env.LORE_COGNITO_CLIENT_ID || '2ij9dpmj7gacqj370obj0lehg2';
// Cognito wants the exact callback URL registered on the app client, so the port is fixed.
const PORT = Number(process.env.LORE_AUTH_PORT || 42813);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'openid email profile';
const LOGIN_TIMEOUT_MS = 5 * 60_000;
// Identity providers configured on the user pool (Cognito's names for them).
const PROVIDERS = { google: 'Google', apple: 'SignInWithApple' };

const storePath = () => path.join(app.getPath('userData'), 'lore-auth.bin');
const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** @type {{ idToken: string, accessToken: string, refreshToken: string, expiresAt: number } | null} */
let session = null;
let onChange = () => {};
let pendingLogin = null; // { cancel(reason) }
let refreshing = null;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function load() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    session = JSON.parse(safeStorage.decryptString(fs.readFileSync(storePath())));
  } catch {
    session = null;
  }
}

async function persist() {
  if (!session) {
    await fsp.rm(storePath(), { force: true });
    return;
  }
  // Without OS encryption the session lives in memory only (sign in again next launch).
  if (!safeStorage.isEncryptionAvailable()) return;
  await fsp.writeFile(storePath(), safeStorage.encryptString(JSON.stringify(session)));
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
function claims(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

/** Public profile for the renderer — never the tokens themselves. */
function user() {
  if (!session) return null;
  const p = claims(session.idToken);
  // The pool maps Google's given name onto `name`, so `name` may be a first
  // name only (add the family name) or already the full name (keep it).
  const first = p.given_name || p.name;
  const full = !first ? p.family_name : !p.family_name || first.includes(p.family_name) ? first : `${first} ${p.family_name}`;
  // Federated users carry the provider they came from (Cognito's `identities` claim).
  let ids = p.identities;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = [];
    }
  }
  const provider = Array.isArray(ids) && ids[0]?.providerName === PROVIDERS.apple ? 'apple' : 'google';
  // Apple shares the name only on the very first sign-in, and may hide the email behind a relay.
  const name = full || p.email || (provider === 'apple' ? 'Account Apple' : 'Account Google');
  return { id: p.sub, name, email: p.email ?? null, provider };
}

async function tokenRequest(params) {
  const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error_description || body.error || `Cognito ha risposto ${res.status}`);
    err.code = body.error;
    throw err;
  }
  return body;
}

function adopt(tok, refreshToken) {
  session = {
    idToken: tok.id_token,
    accessToken: tok.access_token,
    // Refresh responses don't rotate the refresh token unless rotation is on.
    refreshToken: tok.refresh_token || refreshToken,
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
  };
}

/**
 * A valid Cognito ID token for `Authorization: Bearer` calls to the Worker,
 * refreshed when close to expiry. Null when signed out.
 */
async function idToken() {
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.idToken;
  refreshing ??= (async () => {
    try {
      adopt(await tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refreshToken }), session.refreshToken);
      await persist();
    } catch (err) {
      // Refresh token expired or revoked: the user has to sign in again.
      if (err.code === 'invalid_grant') await clear();
      else throw err;
    } finally {
      refreshing = null;
    }
  })();
  await refreshing;
  return session?.idToken ?? null;
}

async function clear() {
  session = null;
  await persist();
  onChange(user());
}

// ---------------------------------------------------------------------------
// Login: PKCE + loopback redirect
// ---------------------------------------------------------------------------
// Cognito only accepts plain http for `localhost`, which the browser may
// resolve to either loopback family — listen on both, never on the LAN.
function listenLoopback(handler) {
  const servers = [];
  const listenOn = (host) =>
    new Promise((resolve, reject) => {
      const s = http.createServer(handler);
      s.once('error', reject);
      s.listen(PORT, host, () => {
        servers.push(s);
        resolve();
      });
    });
  return Promise.allSettled([listenOn('127.0.0.1'), listenOn('::1')]).then((results) => {
    if (!servers.length) {
      const reason = results[0].status === 'rejected' ? results[0].reason : null;
      throw new Error(reason?.code === 'EADDRINUSE' ? `La porta ${PORT} è già in uso: chiudi l’altro processo e riprova.` : 'Impossibile avviare il login.');
    }
    return () => servers.forEach((s) => s.close());
  });
}

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:15px system-ui;background:#121211;color:#faf9f5;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#a3a29c;margin:0">${body}</p></div>`;

/** `provider`: 'google' | 'apple'. */
async function signIn(provider = 'google') {
  const identityProvider = PROVIDERS[provider];
  if (!identityProvider) throw new Error(`Provider di accesso sconosciuto: ${provider}`);
  if (!CLIENT_ID) throw new Error('Login non configurato: imposta LORE_COGNITO_CLIENT_ID.');
  pendingLogin?.cancel('superseded');

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const code = await new Promise((resolve, reject) => {
    let close = () => {};
    let timer = null;
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      close();
      if (pendingLogin === login) pendingLogin = null;
      if (err) reject(err);
      else resolve(value);
    };
    const login = { cancel: (reason) => finish(Object.assign(new Error('Accesso annullato'), { code: reason })) };
    pendingLogin = login;

    listenLoopback((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const respond = (title, body) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(title, body));
      if (url.searchParams.get('state') !== state) {
        respond('Richiesta non valida', 'Torna a Lore LLM Desktop e riprova.');
        return;
      }
      const error = url.searchParams.get('error');
      const got = url.searchParams.get('code');
      if (error || !got) {
        respond('Accesso non riuscito', 'Torna a Lore LLM Desktop e riprova.');
        finish(new Error(url.searchParams.get('error_description') || error || 'Accesso non riuscito'));
        return;
      }
      respond('Accesso completato', 'Puoi chiudere questa scheda e tornare a Lore LLM Desktop.');
      finish(null, got);
    }).then(
      (closeServers) => {
        if (done) return closeServers(); // cancelled while binding
        close = closeServers;
        timer = setTimeout(() => finish(Object.assign(new Error('Tempo scaduto per l’accesso'), { code: 'timeout' })), LOGIN_TIMEOUT_MS);
        const authorize = new URL(`${COGNITO_DOMAIN}/oauth2/authorize`);
        authorize.search = new URLSearchParams({
          response_type: 'code',
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          scope: SCOPES,
          identity_provider: identityProvider,
          state,
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }).toString();
        shell.openExternal(authorize.toString());
      },
      (err) => finish(err),
    );
  });

  adopt(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier }));
  await persist();
  onChange(user());
  return user();
}

function cancelSignIn() {
  pendingLogin?.cancel('cancelled');
}

async function signOut() {
  const refreshToken = session?.refreshToken;
  await clear();
  if (!refreshToken) return;
  // Best effort: invalidate the refresh token server-side too.
  fetch(`${COGNITO_DOMAIN}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken, client_id: CLIENT_ID }),
  }).catch(() => {});
}

function init(changed) {
  onChange = changed;
  load();
}

module.exports = { init, user, idToken, signIn, cancelSignIn, signOut };
