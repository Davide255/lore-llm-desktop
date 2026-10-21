import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManage, canWrite, looksLikeEmail, sortMembers } from './teams.ts';

test('roles: owners and editors write, only owners manage', () => {
  assert.deepEqual((['owner', 'editor', 'viewer', undefined] as const).map(canWrite), [true, true, false, false]);
  assert.deepEqual((['owner', 'editor', 'viewer'] as const).map(canManage), [true, false, false]);
});

test('members: owners first, then by name', () => {
  const sorted = sortMembers([
    { role: 'viewer' as const, name: 'Anna', email: null },
    { role: 'editor' as const, name: 'zeno', email: null },
    { role: 'owner' as const, name: null, email: 'b@x.it' },
    { role: 'editor' as const, name: 'Bea', email: null },
  ]);
  assert.deepEqual(sorted.map((m) => m.name ?? m.email), ['b@x.it', 'Bea', 'zeno', 'Anna']);
});

test('emails', () => {
  assert.ok(looksLikeEmail(' a@b.it '));
  assert.ok(!looksLikeEmail('a@b'));
  assert.ok(!looksLikeEmail('a b@c.it'));
});
