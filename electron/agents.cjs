// Agent rows from the Worker <-> the renderer's Agent shape, and who-wrote-what
// from the audit log. Pure functions, so they're unit-tested in agents.test.cjs.

const KINDS = ['claude', 'codex'];

const toScope = (scope) => (scope.includes('*') ? '*' : scope.map((p) => `${p}/*`).join(','));
const fromScope = (s) => (s === '*' || s.split(',').includes('*') ? ['*'] : s.split(',').map((p) => p.replace(/\/\*$/, '')));

const toAgent = (row) => ({
  id: row.agent_id,
  name: row.name,
  kind: KINDS.includes(row.agent_type) ? row.agent_type : 'claude',
  permission: row.access_level === 'read_write' ? 'write' : 'read',
  scope: fromScope(row.project_scope),
  createdAt: Date.parse(row.created_at),
});

const toPatch = (p) => ({
  ...(p.name !== undefined ? { name: p.name } : {}),
  ...(p.kind !== undefined ? { agent_type: p.kind } : {}),
  ...(p.permission !== undefined ? { access_level: p.permission === 'write' ? 'read_write' : 'read_only' } : {}),
  ...(p.scope !== undefined ? { project_scope: toScope(p.scope) } : {}),
});

/**
 * Latest agent per path from audit rows (any order). Only rows newer than
 * `after` are applied, so polling can feed just what's new into `writers`.
 */
function applyAudit(writers, rows, after = 0) {
  const fresh = rows.filter((r) => r.log_id > after).sort((a, b) => a.log_id - b.log_id);
  for (const r of fresh) writers.set(r.target_path, r.agent_id);
  return fresh.length ? fresh[fresh.length - 1].log_id : after;
}

/** The identity snapshot stored on events, so revoked agents keep their name. */
const refOf = (refs, id) => (id && refs[id] ? { id, ...refs[id] } : id ? { id, name: 'Agente revocato', kind: null } : undefined);

module.exports = { KINDS, toScope, fromScope, toAgent, toPatch, applyAudit, refOf };
