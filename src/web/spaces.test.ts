import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromWire, parseKey, teamOf, translate, untranslate } from './spaces.ts';

const TEAM = 'd9729dc7-aaaa-bbbb-cccc-111122223333';

test('a team project key splits into name and team; personal keys have none', () => {
  assert.deepEqual(parseKey(`Politecnico@${TEAM}`), { name: 'Politecnico', teamId: TEAM });
  assert.deepEqual(parseKey('Politecnico'), { name: 'Politecnico', teamId: null });
  assert.equal(teamOf(`Politecnico@${TEAM}/note.md`), TEAM);
  assert.equal(teamOf('Politecnico/note.md'), null);
});

test('requests for a team path carry owner=t:<id> and the plain server path', () => {
  const t = translate({ path: `Politecnico@${TEAM}/a/b.md` });
  assert.equal(t.query.path, 'Politecnico/a/b.md');
  assert.equal(t.query.owner, `t:${TEAM}`);
  assert.equal(t.teamId, TEAM);
  const own = translate({ path: 'Politecnico/a.md' });
  assert.equal(own.query.owner, undefined);
});

test('a listing of a team comes back as team keys', () => {
  const res = untranslate({ files: [{ path: 'P/a.md' }, { path: 'P/sub/b.md' }] }, TEAM);
  assert.deepEqual(res.files.map((f) => f.path), [`P@${TEAM}/a.md`, `P@${TEAM}/sub/b.md`]);
  assert.equal(fromWire(null, 'P/a.md'), 'P/a.md');
});

test('moving between spaces is refused', () => {
  assert.throws(() => translate({}, { from: 'P/a.md', to: `P@${TEAM}/a.md` }));
});
