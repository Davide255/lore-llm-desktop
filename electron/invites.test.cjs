const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createInviteGate } = require('./invites.cjs');

test('invite gate: due at first, then only every 5 minutes', () => {
  let t = 1000;
  const gate = createInviteGate(5 * 60 * 1000, () => t);
  assert.equal(gate.due(), true);
  gate.mark();
  assert.equal(gate.due(), false);
  t += 4 * 60 * 1000 + 59_000;
  assert.equal(gate.due(), false);
  t += 1000;
  assert.equal(gate.due(), true);
  gate.mark();
  assert.equal(gate.due(), false);
});

test('invite gate: a read by anyone (launch, answering) postpones the next check; reset makes it due', () => {
  let t = 0;
  const gate = createInviteGate(300_000, () => t);
  gate.mark();
  t = 299_000;
  assert.equal(gate.due(), false);
  gate.reset();
  assert.equal(gate.due(), true);
});
