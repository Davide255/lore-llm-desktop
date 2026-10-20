// HTTP client for the lore-llm Worker. Every call carries the signed-in user's
// Cognito ID token; the Worker scopes everything to that user.
const auth = require('./auth.cjs');

const API_URL = (process.env.LORE_API_URL || 'https://lore-llm-dev.davide-bera2021.workers.dev').replace(/\/+$/, '');

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Server messages are English; the UI is Italian.
function message(status, error) {
  if (status === 401) return 'Sessione non valida: esci e accedi di nuovo';
  if (status === 409) return 'Il file è stato modificato nel frattempo (da un agente o da un altro dispositivo): ricarica e riprova';
  if (/already exists/i.test(error ?? '')) return 'Esiste già un file con questo nome';
  if (/too large/i.test(error ?? '')) return 'File o cartella troppo grande';
  return error || `Errore del server (${status})`;
}

function urlFor(path, query) {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  return url;
}

async function request(method, path, { query, body } = {}) {
  const token = await auth.idToken();
  if (!token) throw new ApiError('Accesso richiesto', 401);
  const url = urlFor(path, query);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Server Lore non raggiungibile', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(message(res.status, data.error), res.status);
  return data;
}

/**
 * Binary twin of `request` for attachments: sends/returns raw bytes.
 * Resolves to `{ status, headers, buffer }`; JSON error bodies become ApiErrors.
 */
async function requestRaw(method, path, { query, body, headers } = {}) {
  const token = await auth.idToken();
  if (!token) throw new ApiError('Accesso richiesto', 401);
  let res;
  try {
    res = await fetch(urlFor(path, query), {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/octet-stream' } : {}), ...headers },
      body,
    });
  } catch {
    throw new ApiError('Server Lore non raggiungibile', 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(message(res.status, data.error), res.status);
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return { status: res.status, headers: res.headers, json: await res.json() };
  return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
}

module.exports = { API_URL, ApiError, request, requestRaw };
