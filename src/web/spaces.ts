// Addressing of personal and team projects in the browser build: the TypeScript twin of
// electron/spaces.cjs. A project key is `Name` (the user's own space) or `Name@<teamId>`
// (a team's space); the Worker's project names cannot contain "@", so a key never clashes
// with a personal project. Only the HTTP layer talks in (owner, path): `scoped` wraps it.

export const SEP = '@';
const TEAM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export type Query = Record<string, string | number | undefined>;

export const projectOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : rel);

export const teamKey = (name: string, teamId: string) => `${name}${SEP}${teamId}`;

/** `{ name, teamId }` of a project key; teamId null for the user's own projects. */
export function parseKey(key: string): { name: string; teamId: string | null } {
  const i = key.lastIndexOf(SEP);
  if (i <= 0) return { name: key, teamId: null };
  const teamId = key.slice(i + 1);
  if (!TEAM_ID_RE.test(teamId)) throw new Error('Nome del progetto non valido: non può contenere «@»');
  return { name: key.slice(0, i), teamId };
}

/** The team a rel path belongs to, or null for the user's own space. */
export const teamOf = (rel: string) => {
  try {
    return parseKey(projectOf(rel)).teamId;
  } catch {
    return null;
  }
};

export const ownerOf = (teamId: string | null) => (teamId ? `t:${teamId}` : undefined);

function toWire(rel: string) {
  const slash = rel.indexOf('/');
  const first = slash === -1 ? rel : rel.slice(0, slash);
  const { name, teamId } = parseKey(first);
  return { owner: ownerOf(teamId), path: name + (slash === -1 ? '' : rel.slice(slash)) };
}

/** A server path of a team (or of the user's own space, teamId null) as a rel path. */
export function fromWire(teamId: string | null, wirePath: string) {
  if (!teamId) return wirePath;
  const slash = wirePath.indexOf('/');
  return slash === -1 ? teamKey(wirePath, teamId) : teamKey(wirePath.slice(0, slash), teamId) + wirePath.slice(slash);
}

/** The rel paths a request names (`query.path`, `query.project`, `body.from/to`) as the server sees them. */
export function translate(query: Query = {}, body?: unknown) {
  const out = { query: { ...query } as Query, body, teamId: null as string | null };
  const owners = new Set<string>();
  const take = (rel: string) => {
    const w = toWire(rel);
    owners.add(w.owner ?? '');
    if (w.owner) out.teamId = w.owner.slice(2);
    return w.path;
  };
  if (typeof query.path === 'string') out.query.path = take(query.path);
  if (typeof query.project === 'string') out.query.project = take(query.project);
  const b = body as { from?: unknown; to?: unknown } | undefined;
  if (b && typeof b === 'object' && typeof b.from === 'string' && typeof b.to === 'string') {
    out.body = { ...b, from: take(b.from), to: take(b.to) };
  }
  if (owners.size > 1) throw new Error('Non puoi spostare file tra spazi diversi');
  if (out.teamId && out.query.owner === undefined) out.query.owner = ownerOf(out.teamId);
  return out;
}

/** Paths in a response, back to rel paths of the space they came from. */
export function untranslate<T>(data: T, teamId: string | null): T {
  if (!teamId || !data || typeof data !== 'object') return data;
  const d = data as any;
  const fix = (f: any) => (f && typeof f.path === 'string' ? { ...f, path: fromWire(teamId, f.path) } : f);
  const out = fix(d);
  if (Array.isArray(d.files)) out.files = d.files.map(fix);
  if (d.file) out.file = fix(d.file);
  return out;
}

/** The team a translated request addresses: its rel paths, or an explicit `owner=t:<id>`. */
export const teamOfRequest = (teamId: string | null, query: Query) => teamId ?? (typeof query.owner === 'string' && query.owner.startsWith('t:') ? query.owner.slice(2) : null);
