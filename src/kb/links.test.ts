import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl, attachmentIcon, attachmentLabel, backlinks, isAttachment, isImage, isOffice, officeKind, parseWikiLink, resolveHref, resolveWikiTarget, sameHeading, wikiLabel } from './links.ts';
import { fileKind } from './paths.ts';

test('parses wikilinks: alias, heading, block, embed width', () => {
  assert.deepEqual(parseWikiLink('Note'), { target: 'Note' });
  assert.deepEqual(parseWikiLink('Note#Setup|see setup'), { target: 'Note', heading: 'Setup', alias: 'see setup' });
  assert.deepEqual(parseWikiLink('Note#^abc123'), { target: 'Note', block: 'abc123' });
  assert.deepEqual(parseWikiLink('#Local heading'), { target: '', heading: 'Local heading' });
  assert.deepEqual(parseWikiLink('img/photo.png|300'), { target: 'img/photo.png', width: 300 });
  assert.deepEqual(parseWikiLink('photo.png|300x200'), { target: 'photo.png', width: 300 });
  assert.equal(wikiLabel(parseWikiLink('notes/Design doc')), 'Design doc');
  assert.equal(wikiLabel(parseWikiLink('Design doc#Risks')), 'Design doc › Risks');
  assert.equal(wikiLabel(parseWikiLink('Design doc|the doc')), 'the doc');
});

const paths = ['Alpha/index.md', 'Alpha/notes/Plan.md', 'Alpha/Plan.md', 'Alpha/img/photo.png', 'Beta/Plan.md', 'Beta/deep/Only Here.md', 'Gamma/x/y/Plan.md'];

test('resolves wikilinks the way Obsidian does', () => {
  // exact vault path, with or without .md, any case
  assert.equal(resolveWikiTarget('Beta/Plan', 'Alpha/a.md', paths), 'Beta/Plan.md');
  assert.equal(resolveWikiTarget('beta/plan.md', 'Alpha/a.md', paths), 'Beta/Plan.md');
  // relative to the note
  assert.equal(resolveWikiTarget('../Plan', 'Alpha/notes/a.md', paths), 'Alpha/Plan.md');
  // by name: same folder first, then same project, then shortest
  assert.equal(resolveWikiTarget('Plan', 'Alpha/notes/a.md', paths), 'Alpha/notes/Plan.md');
  assert.equal(resolveWikiTarget('Plan', 'Alpha/other/a.md', paths), 'Alpha/Plan.md');
  assert.equal(resolveWikiTarget('Plan', 'Delta/a.md', paths), 'Beta/Plan.md'); // shortest path
  assert.equal(resolveWikiTarget('Only Here', 'Alpha/a.md', paths), 'Beta/deep/Only Here.md');
  // attachments by name
  assert.equal(resolveWikiTarget('photo.png', 'Alpha/notes/a.md', paths), 'Alpha/img/photo.png');
  assert.equal(resolveWikiTarget('Missing', 'Alpha/a.md', paths), null);
  assert.equal(resolveWikiTarget('', 'Alpha/a.md', paths), null);
});

test('resolves markdown hrefs relative first, then from the root', () => {
  const exists = (p: string) => paths.includes(p);
  assert.deepEqual(resolveHref('../Plan.md', 'Alpha/notes/a.md', exists), { path: 'Alpha/Plan.md', heading: undefined });
  assert.deepEqual(resolveHref('Beta/deep/Only%20Here.md#Intro', 'Alpha/a.md', exists), { path: 'Beta/deep/Only Here.md', heading: 'Intro' });
  assert.deepEqual(resolveHref('<Beta/deep/Only Here.md>', 'Alpha/a.md', exists), { path: 'Beta/deep/Only Here.md', heading: undefined });
  assert.deepEqual(resolveHref('#Local', 'Alpha/a.md', exists), { path: 'Alpha/a.md', heading: 'Local' });
  assert.equal(resolveHref('https://example.com', 'Alpha/a.md', exists), null);
  assert.equal(resolveHref('../../../../x.md', 'Alpha/a.md', exists), null);
});

test('backlinks resolve both syntaxes', () => {
  const index = {
    'Alpha/a.md': ['[[Plan]]'],
    'Alpha/notes/b.md': ['../Plan.md#Goals'],
    'Beta/c.md': ['[[Plan]]'], // resolves to Beta/Plan.md
    'Alpha/Plan.md': ['[[Plan]]'], // itself
  };
  assert.deepEqual(backlinks('Alpha/Plan.md', index, [...paths, ...Object.keys(index)]), ['Alpha/a.md', 'Alpha/notes/b.md']);
});

test('asset URLs and heading matching', () => {
  assert.equal(assetUrl('Alpha/img/my photo.png'), 'lore-asset://kb/Alpha/img/my%20photo.png');
  assert.ok(sameHeading('**Next**  steps', 'next steps'));
});

test('Office files (docx, xlsx, pptx) are attachments; the old binary formats are not', () => {
  for (const p of ['P/a.docx', 'P/b.XLSX', 'P/c.pptx']) {
    assert.ok(isAttachment(p), p);
    assert.ok(isOffice(p), p);
    assert.ok(!isImage(p), p);
    assert.equal(fileKind(p), 'attachment', p);
  }
  for (const p of ['P/a.doc', 'P/b.xls', 'P/c.ppt', 'P/d.docm', 'P/e.docx.md', 'P/x.constructor']) {
    assert.ok(!isAttachment(p), p);
    assert.equal(officeKind(p), null, p);
  }
  assert.equal(fileKind('P/e.docx.md'), 'doc');
  assert.deepEqual(['P/a.docx', 'P/b.xlsx', 'P/c.pptx'].map(officeKind), ['word', 'excel', 'powerpoint']);
  assert.deepEqual(['P/a.docx', 'P/b.xlsx', 'P/c.pptx', 'P/d.pdf', 'P/e.png'].map(attachmentIcon), ['docs', 'table', 'slideshow', 'picture_as_pdf', 'image']);
  assert.deepEqual(['P/a.docx', 'P/b.xlsx', 'P/c.pptx', 'P/d.pdf'].map(attachmentLabel), ['Documento Word', 'Foglio Excel', 'Presentazione PowerPoint', 'PDF']);
});

test('links to Office files resolve to the file, not to a note', () => {
  const all = [...paths, 'Alpha/docs/Budget 2026.xlsx', 'Alpha/Relazione.docx', 'Beta/Deck.pptx'];
  assert.equal(resolveWikiTarget('Budget 2026.xlsx', 'Alpha/notes/a.md', all), 'Alpha/docs/Budget 2026.xlsx');
  assert.equal(resolveWikiTarget('relazione.DOCX', 'Alpha/a.md', all), 'Alpha/Relazione.docx');
  assert.equal(resolveWikiTarget('Deck.pptx', 'Alpha/a.md', all), 'Beta/Deck.pptx');
  assert.equal(resolveWikiTarget('Deck.ppt', 'Alpha/a.md', all), null);
  const exists = (p: string) => all.includes(p);
  assert.deepEqual(resolveHref('docs/Budget%202026.xlsx', 'Alpha/a.md', exists), { path: 'Alpha/docs/Budget 2026.xlsx', heading: undefined });
  const index = { 'Alpha/a.md': ['[[Relazione.docx]]'], 'Alpha/notes/b.md': ['../Relazione.docx'] };
  assert.deepEqual(backlinks('Alpha/Relazione.docx', index, [...all, ...Object.keys(index)]), ['Alpha/a.md', 'Alpha/notes/b.md']);
});
