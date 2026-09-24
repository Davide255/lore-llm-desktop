import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChecklist, toggleItem, addItem, deleteItem, setItemText, addSection } from './checklist.ts';

const SRC = [
  '## V 2.4',
  '- [x] Nuova struttura API clienti',
  '- [ ] ==Payment system==',
  '\t- [x] createSubscription',
  '\t- [ ] handleSubscriptionUpgrade',
  '\t\t- [ ] deep',
  '- [x] Add usage tracking',
  '    - [x] AI chat messages ',
  '',
  '## V 2.6',
  'Una nota libera.',
  '- [ ] AI',
].join('\n');

test('parses sections, depth and counts', () => {
  const c = parseChecklist(SRC);
  assert.equal(c.sections.length, 2);
  assert.equal(c.total, 8);
  assert.equal(c.done, 4);
  const [a, b] = c.sections;
  assert.equal(a.title, 'V 2.4');
  assert.deepEqual(a.items.map((i) => i.depth), [0, 0, 1, 1, 2, 0, 1]);
  assert.equal(a.items[1].childCount, 3);
  assert.equal(a.items[1].endLine, 5);
  assert.equal(b.notes[0].text, 'Una nota libera.');
  assert.equal(c.indentUnit, '\t');
});

test('toggle only flips the box', () => {
  const out = toggleItem(SRC, 3);
  assert.equal(out.split('\n')[3], '\t- [ ] createSubscription');
  assert.equal(toggleItem(out, 3), SRC);
});

test('toggle preserves CRLF', () => {
  const crlf = '- [ ] a\r\n- [ ] b\r\n';
  assert.equal(toggleItem(crlf, 1), '- [ ] a\r\n- [x] b\r\n');
});

test('add child goes after the last descendant with one more indent', () => {
  const c = parseChecklist(SRC);
  const parent = c.sections[0].items[1];
  const out = addItem(SRC, c, 0, 'nuovo', parent).split('\n');
  assert.equal(out[6], '\t- [ ] nuovo');
});

test('add top-level item appends to the section', () => {
  const c = parseChecklist(SRC);
  const out = addItem(SRC, c, 0, 'fine').split('\n');
  assert.equal(out[8], '- [ ] fine');
  assert.equal(out[10], '## V 2.6');
});

test('add item into an empty section goes under the heading', () => {
  const src = '## Vuota\n\n## Altra\n- [ ] x';
  const c = parseChecklist(src);
  assert.equal(addItem(src, c, 0, 'primo'), '## Vuota\n- [ ] primo\n\n## Altra\n- [ ] x');
});

test('delete removes sub-items too', () => {
  const c = parseChecklist(SRC);
  const out = deleteItem(SRC, c.sections[0].items[1]);
  assert.equal(parseChecklist(out).total, 4);
});

test('rename keeps checkbox state', () => {
  assert.equal(setItemText('- [x] old', 0, 'new'), '- [x] new');
});

test('add section', () => {
  assert.equal(addSection('- [ ] a\n', 'QA'), '- [ ] a\n\n## QA\n');
});
