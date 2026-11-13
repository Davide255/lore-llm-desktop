// When to look for team invitations again: right after launch, then at most once per
// `intervalMs` however often the window regains focus. No Electron imports: tested with node.
const INVITES_INTERVAL_MS = 5 * 60 * 1000;

function createInviteGate(intervalMs = INVITES_INTERVAL_MS, now = Date.now) {
  let last = null;
  return {
    /** True when a check is due (never checked, or the interval has passed). */
    due: () => last === null || now() - last >= intervalMs,
    /** Record that the invitations were just read (by anyone: launch, focus, answering one). */
    mark: () => {
      last = now();
    },
    reset: () => {
      last = null;
    },
  };
}

module.exports = { INVITES_INTERVAL_MS, createInviteGate };
