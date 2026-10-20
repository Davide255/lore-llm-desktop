const { test } = require('node:test');
const assert = require('node:assert/strict');
const { merge3, splitLines } = require('./merge.cjs');

const base = '# Title\n\nIntro line.\n\n## A\nalpha\n\n## B\nbeta\n';

test('trivial cases short-circuit', () => {
  assert.deepEqual(merge3(base, base, base), { clean: true, text: base, conflicts: 0 });
  assert.equal(merge3(base, base, 'x\n').text, 'x\n');
  assert.equal(merge3(base, 'y\n', base).text, 'y\n');
  assert.equal(merge3(base, 'same\n', 'same\n').text, 'same\n');
});

test('edits to different sections both apply', () => {
  const local = base.replace('alpha', 'alpha (mine)');
  const remote = base.replace('beta', 'beta (agent)').replace('Intro line.', 'Intro line, edited.');
  const r = merge3(base, local, remote);
  assert.equal(r.clean, true);
  assert.equal(r.text, '# Title\n\nIntro line, edited.\n\n## A\nalpha (mine)\n\n## B\nbeta (agent)\n');
});

test('insertions at different points and appends merge', () => {
  const local = base.replace('## A\n', '## A\nnew first\n');
  const remote = `${base}\n## C\ngamma\n`;
  const r = merge3(base, local, remote);
  assert.equal(r.clean, true);
  assert.ok(r.text.includes('## A\nnew first\nalpha'));
  assert.ok(r.text.endsWith('## C\ngamma\n'));
});

test('identical changes on both sides apply once', () => {
  const both = base.replace('alpha', 'ALPHA');
  const local = both.replace('beta', 'beta 2');
  const r = merge3(base, local, both);
  assert.equal(r.clean, true);
  assert.equal(r.text, local);
});

test('overlapping changes conflict and keep the local side plus clean hunks', () => {
  const local = base.replace('alpha', 'alpha by me').replace('Intro line.', 'Intro (mine).');
  const remote = base.replace('alpha', 'alpha by agent').replace('beta', 'beta by agent');
  const r = merge3(base, local, remote);
  assert.equal(r.clean, false);
  assert.equal(r.conflicts, 1);
  assert.ok(r.text.includes('alpha by me'));
  assert.ok(!r.text.includes('alpha by agent'));
  assert.ok(r.text.includes('Intro (mine).'));
  assert.ok(r.text.includes('beta by agent'));
});

test('two appends at the same end point conflict', () => {
  const r = merge3('a\n', 'a\nb\n', 'a\nc\n');
  assert.equal(r.clean, false);
  assert.equal(r.text, 'a\nb\n');
});

test('line endings and a missing final newline survive', () => {
  const crlf = 'one\r\ntwo\r\nthree';
  const r = merge3(crlf, 'one!\r\ntwo\r\nthree', 'one\r\ntwo\r\nthree!');
  assert.equal(r.clean, true);
  assert.equal(r.text, 'one!\r\ntwo\r\nthree!');
  assert.deepEqual(splitLines('a\nb'), ['a\n', 'b']);
  assert.deepEqual(splitLines(''), []);
});

test('an empty base (first sync of two different files) merges or conflicts as a whole', () => {
  const r = merge3('', 'local\n', 'remote\n');
  assert.equal(r.clean, false);
  assert.equal(r.text, 'local\n');
});
