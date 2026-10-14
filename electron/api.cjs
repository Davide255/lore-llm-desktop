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
  if (status === 409) return 'Il file è stato modificato da un agente nel frattempo: ricarica e riprova';
  if (/already exists/i.test(error ?? '')) return 'Esiste già un file con questo nome';
  if (/too large/i.test(error ?? '')) return 'File o cartella troppo grande';
  return error || `Errore del server (${status})`;
}

async function request(method, path, { query, body } = {}) {
  const token = await auth.idToken();
  if (!token) throw new ApiError('Accesso richiesto', 401);
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
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

module.exports = { API_URL, ApiError, request };
