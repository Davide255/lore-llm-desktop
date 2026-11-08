const test = require('node:test');
const assert = require('node:assert/strict');
const { hitsToResults, mergeResults, starsFromWire, starQuery } = require('./remote.cjs');

test('hits of a team come back as rel paths with the column of the first word', () => {
  const r = hitsToResults('abc', [{ path: 'Chimica/a.md', score: 2, pathMatch: true, snippets: [{ line: 4, text: 'Il Calore specifico' }] }], 'specifico calore');
  assert.deepEqual(r, [{ score: 2, path: 'Chimica@abc/a.md', nameHit: true, hits: [{ line: 4, col: 3, text: 'Il Calore specifico' }], total: 1 }]);
});

test('merge orders by score across spaces and drops the score', () => {
  const a = hitsToResults(null, [{ path: 'P/a.md', score: 1, snippets: [] }], 'x');
  const b = hitsToResults('t1', [{ path: 'Q/b.md', score: 3, snippets: [] }], 'x');
  assert.deepEqual(mergeResults([a, b]).map((x) => x.path), ['Q@t1/b.md', 'P/a.md']);
  assert.ok(!('score' in mergeResults([a])[0]));
});

test('stars map owners to project keys', () => {
  const s = starsFromWire([
    { owner: 'user-1', path: 'Lore', kind: 'project', starred_at: 5 },
    { owner: 't:x1', path: 'Team/n.md', kind: 'note', starred_at: 4 },
  ]);
  assert.deepEqual(s, [
    { path: 'Lore', kind: 'project', at: 5 },
    { path: 'Team@x1/n.md', kind: 'note', at: 4 },
  ]);
});

test('star query splits a rel path into owner and path', () => {
  assert.deepEqual(starQuery('Team@x1'), { owner: 't:x1', path: 'Team' });
  assert.deepEqual(starQuery('P/n.md'), { owner: undefined, path: 'P/n.md' });
});
