// Sign in with Google or Apple in the browser build: the same Cognito user pool
// as electron/auth.cjs, Authorization Code + PKCE, but with a full-page redirect
// back to the app instead of a loopback server. Tokens live in localStorage.
import type { AuthUser, SignInProvider } from '../kb/types';
import { CLIENT_ID, COGNITO_DOMAIN, redirectUri } from './config';

const SCOPES = 'openid email profile';
const PROVIDERS = { google: 'Google', apple: 'SignInWithApple' } as const;
const STORE = 'lore-auth';
const PENDING = 'lore-auth-pending';

interface Session {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

let session: Session | null = null;
let onChange: (u: AuthUser | null) => void = () => {};
let refreshing: Promise<void> | null = null;
let loginError: Error | null = null;

function load(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null');
  } catch {
    return null;
  }
}

function persist() {
  try {
    if (session) localStorage.setItem(STORE, JSON.stringify(session));
    else localStorage.removeItem(STORE);
  } catch {
    /* storage blocked: the session lasts as long as the tab */
  }
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function claims(jwt: string): Record<string, any> {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  } catch {
    return {};
  }
}

/** Public profile, the same shape electron/auth.cjs gives the renderer. */
export function user(): AuthUser | null {
  if (!session) return null;
  const p = claims(session.idToken);
  const first = p.given_name || p.name;
  const full = !first ? p.family_name : !p.family_name || first.includes(p.family_name) ? first : `${first} ${p.family_name}`;
  let ids = p.identities;
  if (typeof ids === 'string') {
    try {
      ids = JSON.parse(ids);
    } catch {
      ids = [];
    }
  }
  const provider: SignInProvider = Array.isArray(ids) && ids[0]?.providerName === PROVIDERS.apple ? 'apple' : 'google';
  const name = full || p.email || (provider === 'apple' ? 'Account Apple' : 'Account Google');
  return { id: p.sub, name, email: p.email ?? null, provider };
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error_description || body.error || `Cognito ha risposto ${res.status}`), { code: body.error });
  return body;
}

function adopt(tok: TokenResponse, refreshToken?: string) {
  session = {
    idToken: tok.id_token,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token || refreshToken || '',
    expiresAt: Date.now() + (tok.expires_in ?? 3600) * 1000,
  };
  persist();
}

function clear() {
  session = null;
  persist();
  onChange(null);
}

/** A valid ID token for `Authorization: Bearer`, refreshed when close to expiry. Null when signed out. */
export async function idToken(): Promise<string | null> {
  await callback;
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.idToken;
  refreshing ??= (async () => {
    try {
      adopt(await tokenRequest({ grant_type: 'refresh_token', refresh_token: session!.refreshToken }), session!.refreshToken);
    } catch (err) {
      if ((err as { code?: string }).code === 'invalid_grant') clear();
      else throw err;
    } finally {
      refreshing = null;
    }
  })();
  await refreshing;
  return session?.idToken ?? null;
}

/** Leaves the page for Cognito's hosted login; `callback` finishes the job when the browser comes back. */
export async function signIn(provider: SignInProvider = 'google'): Promise<AuthUser | null> {
  if (!CLIENT_ID) throw new Error('Login non configurato: imposta LORE_COGNITO_CLIENT_ID.');
  const verifier = random(32);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = random(16);
  const redirect = redirectUri();
  sessionStorage.setItem(PENDING, JSON.stringify({ state, verifier, redirect, hash: location.hash }));
  const authorize = new URL(`${COGNITO_DOMAIN}/oauth2/authorize`);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirect,
    scope: SCOPES,
    identity_provider: PROVIDERS[provider],
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  location.assign(authorize.toString());
  return new Promise(() => {}); // the page is going away
}

// Back from Cognito: `?code=…&state=…` (or `?error=…`) on the redirect URI.
let callback: Promise<void> = Promise.resolve();
const finishRedirect = async () => {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (!code && !error) return;
  let pending: { state: string; verifier: string; redirect: string; hash: string } | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null');
  } catch {
    /* none */
  }
  sessionStorage.removeItem(PENDING);
  for (const k of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(k);
  history.replaceState(null, '', url.pathname + url.search + (pending?.hash ?? url.hash));
  if (!pending || state !== pending.state) return; // not our login (or a stale tab)
  if (error || !code) {
    loginError = new Error(error || 'Accesso non riuscito');
    return;
  }
  adopt(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: pending.redirect, code_verifier: pending.verifier }));
};

/** The error a login redirect came back with, once (shown as a toast by the bridge's caller). */
export function takeLoginError(): Error | null {
  const e = loginError;
  loginError = null;
  return e;
}

export function cancelSignIn() {
  sessionStorage.removeItem(PENDING);
}

export async function signOut() {
  const refreshToken = session?.refreshToken;
  clear();
  if (!refreshToken) return;
  fetch(`${COGNITO_DOMAIN}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken, client_id: CLIENT_ID }),
  }).catch(() => {});
}

export function init(changed: (u: AuthUser | null) => void) {
  onChange = changed;
  session = load();
  callback = finishRedirect().catch((err) => {
    loginError = err instanceof Error ? err : new Error(String(err));
  });
}

/** Resolves once a login redirect (if any) has been turned into a session. */
export const ready = () => callback;
