const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseKey, teamKey, teamOf, projectLabel, toWire, fromWire, checkProjectName, canWrite, canManage, scoped } = require('./spaces.cjs');

test('project keys: personal names stay as they are, team keys carry the team id', () => {
  assert.deepEqual(parseKey('Athly'), { name: 'Athly', teamId: null });
  assert.deepEqual(parseKey('Athly@3f2a-9c'), { name: 'Athly', teamId: '3f2a-9c' });
  assert.equal(teamKey('Athly', 'T1'), 'Athly@T1');
  assert.equal(teamOf('Athly@T1/docs/a.md'), 'T1');
  assert.equal(teamOf('Athly/docs/a@b.md'), null, 'only the project segment counts');
  assert.equal(projectLabel('Athly@T1/a.md'), 'Athly');
  assert.throws(() => parseKey('a@b c'), /@/);
});

test('toWire and fromWire round-trip', () => {
  for (const [rel, wire] of [
    ['P/a.md', { owner: undefined, path: 'P/a.md' }],
    ['P', { owner: undefined, path: 'P' }],
    ['P@T1/x/y.md', { owner: 't:T1', path: 'P/x/y.md' }],
    ['P@T1', { owner: 't:T1', path: 'P' }],
  ]) {
    assert.deepEqual(toWire(rel), wire);
    assert.equal(fromWire(wire.owner?.slice(2) ?? null, wire.path), rel);
  }
});

test('"@" is refused in a project name typed by the user', () => {
  assert.throws(() => checkProjectName('me@work'), /@/);
  assert.doesNotThrow(() => checkProjectName('Lavoro'));
});

test('roles', () => {
  assert.deepEqual(['owner', 'editor', 'viewer', undefined].map(canWrite), [true, true, false, false]);
  assert.deepEqual(['owner', 'editor', 'viewer'].map(canManage), [true, false, false]);
});

test('scoped requests: paths and project names become (owner, path) and come back as rel paths', async () => {
  const seen = [];
  const request = scoped(async (method, p, opts) => {
    seen.push([method, p, opts.query, opts.body]);
    if (p === '/v1/files') return { files: [{ path: 'P/a.md' }] };
    if (p === '/v1/file' && method === 'PUT') return { file: { path: opts.query.path } };
    return {};
  });
  assert.deepEqual(await request('GET', '/v1/files', { query: { project: 'P@T1' } }), { files: [{ path: 'P@T1/a.md' }] });
  assert.deepEqual(await request('PUT', '/v1/file', { query: { path: 'P@T1/b.md' }, body: { content: '' } }), { file: { path: 'P@T1/b.md' } });
  await request('POST', '/v1/files/move', { body: { from: 'P@T1/a', to: 'P@T1/b' } });
  await request('GET', '/v1/file', { query: { path: 'Mine/a.md' } });
  assert.deepEqual(await request('GET', '/v1/files', { query: { owner: 't:T2' } }), { files: [{ path: 'P@T2/a.md' }] });
  assert.deepEqual(seen, [
    ['GET', '/v1/files', { project: 'P', owner: 't:T1' }, undefined],
    ['PUT', '/v1/file', { path: 'P/b.md', owner: 't:T1' }, { content: '' }],
    ['POST', '/v1/files/move', { owner: 't:T1' }, { from: 'P/a', to: 'P/b' }],
    ['GET', '/v1/file', { path: 'Mine/a.md' }, undefined],
    ['GET', '/v1/files', { owner: 't:T2' }, undefined],
  ]);
  await assert.rejects(request('POST', '/v1/files/move', { body: { from: 'P@T1/a.md', to: 'P/a.md' } }), /spazi diversi/);
  assert.equal(seen.length, 5, 'a cross-space move never reaches the server');
});
