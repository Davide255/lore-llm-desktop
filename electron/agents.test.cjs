const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toAgent, toPatch, toScope, fromScope, applyAudit, refOf } = require('./agents.cjs');

test('agent rows map to the renderer shape and back', () => {
  const row = { agent_id: 'a1', name: 'My Codex', agent_type: 'codex', access_level: 'read_only', project_scope: 'Alpha/*,Beta/*', created_at: '2026-10-14T10:00:00.000Z' };
  assert.deepEqual(toAgent(row), { id: 'a1', name: 'My Codex', kind: 'codex', permission: 'read', scope: ['Alpha', 'Beta'], createdAt: Date.parse(row.created_at) });
  // Rows from before agent_type existed, or unknown kinds, show as Claude.
  assert.equal(toAgent({ ...row, agent_type: undefined }).kind, 'claude');
  assert.deepEqual(toPatch({ kind: 'claude', permission: 'write', scope: ['*'] }), { agent_type: 'claude', access_level: 'read_write', project_scope: '*' });
  assert.deepEqual(toPatch({ name: 'x' }), { name: 'x' });
});

test('scopes round-trip', () => {
  for (const s of [['*'], ['Alpha'], ['Alpha', 'Beta']]) assert.deepEqual(fromScope(toScope(s)), s);
  assert.deepEqual(fromScope('Alpha/*,*'), ['*']);
});

test('audit rows give the latest writer per path, applying only new rows', () => {
  const writers = new Map();
  const rows = [
    { log_id: 3, agent_id: 'b', target_path: 'P/a.md' },
    { log_id: 1, agent_id: 'a', target_path: 'P/a.md' },
    { log_id: 2, agent_id: 'a', target_path: 'P/b.md' },
  ];
  assert.equal(applyAudit(writers, rows), 3);
  assert.deepEqual([...writers], [['P/a.md', 'b'], ['P/b.md', 'a']]);
  assert.equal(applyAudit(writers, [{ log_id: 2, agent_id: 'z', target_path: 'P/b.md' }, { log_id: 4, agent_id: 'a', target_path: 'P/a.md' }], 3), 4);
  assert.equal(writers.get('P/a.md'), 'a');
  assert.equal(writers.get('P/b.md'), 'a'); // log 2 was already applied
  assert.equal(applyAudit(writers, [], 4), 4);
});

test('identity refs survive revocation', () => {
  const refs = { a: { name: 'Claude', kind: 'claude' } };
  assert.deepEqual(refOf(refs, 'a'), { id: 'a', name: 'Claude', kind: 'claude' });
  assert.deepEqual(refOf(refs, 'gone'), { id: 'gone', name: 'Agente revocato', kind: null });
  assert.equal(refOf(refs, undefined), undefined);
});
