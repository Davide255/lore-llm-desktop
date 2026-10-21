// Addressing of personal and team projects, the same scheme as the mobile app.
// A project key is `Name` (the user's own space) or `Name@<teamId>` (a team's
// space): the Worker's project names cannot contain "@", so a key never clashes
// with a personal project, and everything built on "first segment = project"
// (tree, mirror, vault, activity) keeps working on plain rel paths. Only the
// HTTP layer talks in (owner, path); `toWire` / `fromWire` and `scoped()` are
// the one translation point. No Electron imports: tested with node.

const SEP = '@';
const TEAM_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const projectOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : rel);

function teamKey(name, teamId) {
  return `${name}${SEP}${teamId}`;
}

/** `{ name, teamId }` of a project key; teamId null for the user's own projects. */
function parseKey(key) {
  const i = key.lastIndexOf(SEP);
  if (i <= 0) return { name: key, teamId: null };
  const teamId = key.slice(i + 1);
  if (!TEAM_ID_RE.test(teamId)) throw new Error('Nome del progetto non valido: non può contenere «@»');
  return { name: key.slice(0, i), teamId };
}

/** The team a rel path belongs to, or null for the user's own space. */
const teamOf = (rel) => parseKey(projectOf(rel)).teamId;

/** The project's display name, without the team suffix. */
const projectLabel = (rel) => parseKey(projectOf(rel)).name;

const ownerOf = (teamId) => (teamId ? `t:${teamId}` : undefined);

/** A rel path as the server sees it: `{ owner: 't:<id>' | undefined, path }`. */
function toWire(rel) {
  const slash = rel.indexOf('/');
  const first = slash === -1 ? rel : rel.slice(0, slash);
  const { name, teamId } = parseKey(first);
  return { owner: ownerOf(teamId), path: name + (slash === -1 ? '' : rel.slice(slash)) };
}

/** A server path of a team (or of the user's own space, teamId null) as a rel path. */
function fromWire(teamId, wirePath) {
  if (!teamId) return wirePath;
  const slash = wirePath.indexOf('/');
  return slash === -1 ? teamKey(wirePath, teamId) : teamKey(wirePath.slice(0, slash), teamId) + wirePath.slice(slash);
}

/** A local project name typed by the user: "@" is reserved for team keys. */
function checkProjectName(name) {
  if (name.includes(SEP)) throw new Error('Il nome del progetto non può contenere «@»');
}

// Roles, as the Worker names them (lore-llm/src/permissions/access.ts).
const RANK = { viewer: 1, editor: 2, owner: 3 };
const canWrite = (access) => (RANK[access] ?? 0) >= RANK.editor;
const canManage = (role) => role === 'owner';

/** The rel paths a request names: `query.path`, `query.project`, `body.from/to`. */
function translate(query = {}, body) {
  const out = { query: { ...query }, body, teamId: null };
  const owners = new Set();
  const take = (rel) => {
    const w = toWire(rel);
    owners.add(w.owner ?? '');
    if (w.owner) out.teamId = w.owner.slice(2);
    return w.path;
  };
  if (typeof query.path === 'string') out.query.path = take(query.path);
  if (typeof query.project === 'string') out.query.project = take(query.project);
  if (body && typeof body === 'object' && typeof body.from === 'string' && typeof body.to === 'string') {
    out.body = { ...body, from: take(body.from), to: take(body.to) };
  }
  if (owners.size > 1) throw Object.assign(new Error('Non puoi spostare file tra spazi diversi: per un progetto usa «Sposta in un team…»'), { status: 400 });
  if (out.teamId && out.query.owner === undefined) out.query.owner = ownerOf(out.teamId);
  return out;
}

/** Paths in a response, back to rel paths of the space they came from. */
function untranslate(data, teamId) {
  if (!teamId || !data || typeof data !== 'object') return data;
  const fix = (f) => (f && typeof f.path === 'string' ? { ...f, path: fromWire(teamId, f.path) } : f);
  const out = fix(data);
  if (Array.isArray(data.files)) out.files = data.files.map(fix);
  if (data.file) out.file = fix(data.file);
  return out;
}

/**
 * Wraps `request(method, path, {query, body})` (and the binary `requestRaw`) so
 * callers pass rel paths of any space: the owner travels as `?owner=t:<id>`.
 * A request that already names `query.owner` (e.g. `/v1/projects` of a team)
 * keeps it, and `files[].path` in its answer is translated with that team.
 */
function scoped(request) {
  return async (method, p, opts = {}) => {
    const { query, body, teamId } = translate(opts.query, opts.body);
    const team = teamId ?? (typeof query.owner === 'string' && query.owner.startsWith('t:') ? query.owner.slice(2) : null);
    const res = await request(method, p, { ...opts, query, body });
    return untranslate(res, team);
  };
}

module.exports = { SEP, teamKey, parseKey, teamOf, projectOf, projectLabel, ownerOf, toWire, fromWire, checkProjectName, canWrite, canManage, scoped };
