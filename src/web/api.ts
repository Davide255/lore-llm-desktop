// HTTP client for the lore-llm Worker, browser twin of electron/api.cjs. The
// Worker must list this page's origin in ALLOWED_ORIGINS (CORS).
import * as auth from './auth';
import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// Server messages are English; the UI is Italian.
function message(status: number, error?: string) {
  if (status === 401) return 'Sessione non valida: esci e accedi di nuovo';
  if (status === 409) return 'Il file è stato modificato nel frattempo (da un agente o da un altro dispositivo): ricarica e riprova';
  if (/already exists/i.test(error ?? '')) return 'Esiste già un file con questo nome';
  if (/too large/i.test(error ?? '')) return 'File o cartella troppo grande';
  return error || `Errore del server (${status})`;
}

type Query = Record<string, string | number | undefined>;

function urlFor(path: string, query?: Query) {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  return url;
}

async function send(method: string, path: string, query: Query | undefined, init: RequestInit) {
  const token = await auth.idToken();
  if (!token) throw new ApiError('Accesso richiesto', 401);
  try {
    return await fetch(urlFor(path, query), { ...init, method, headers: { authorization: `Bearer ${token}`, ...init.headers } });
  } catch {
    throw new ApiError('Server Lore non raggiungibile', 0);
  }
}

export async function request<T = any>(method: string, path: string, { query, body }: { query?: Query; body?: unknown } = {}): Promise<T> {
  const res = await send(method, path, query, body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(message(res.status, data.error), res.status);
  return data;
}

/** Binary twin of `request` for attachments. */
export async function requestRaw(
  method: string,
  path: string,
  { query, body, headers, onProgress }: { query?: Query; body?: BodyInit; headers?: Record<string, string>; onProgress?: (sent: number, total: number) => void } = {},
): Promise<{ status: number; headers: Headers; json?: any; blob?: Blob }> {
  // fetch cannot report upload progress: a body with a listener goes through XMLHttpRequest.
  if (body instanceof Blob && onProgress) return putWithProgress(method, path, query, body, { 'content-type': 'application/octet-stream', ...headers }, onProgress);
  const res = await send(method, path, query, { body, headers: { ...(body !== undefined ? { 'content-type': 'application/octet-stream' } : {}), ...headers } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(message(res.status, data.error), res.status);
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return { status: res.status, headers: res.headers, json: await res.json() };
  return { status: res.status, headers: res.headers, blob: await res.blob() };
}

async function putWithProgress(method: string, path: string, query: Query | undefined, body: Blob, headers: Record<string, string>, onProgress: (sent: number, total: number) => void) {
  const token = await auth.idToken();
  if (!token) throw new ApiError('Accesso richiesto', 401);
  return new Promise<{ status: number; headers: Headers; json?: any }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, urlFor(path, query).toString());
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
    xhr.onerror = () => reject(new ApiError('Server Lore non raggiungibile', 0));
    xhr.onload = () => {
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve({ status: xhr.status, headers: new Headers(), json: data });
      else reject(new ApiError(message(xhr.status, data.error), xhr.status));
    };
    xhr.send(body);
  });
}
