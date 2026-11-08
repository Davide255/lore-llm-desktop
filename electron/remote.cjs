// Server-side search (GET /v1/search) and stars (/v1/stars): translation between the
// Worker's (owner, path) answers and the app's rel paths (spaces.cjs). Pure: tested with node.
const { fromWire, toWire } = require('./spaces.cjs');

const MAX_RESULTS = 60;

/** `hits` of one space as the app's SearchResult[] (col = where the first search word starts on the line). */
function hitsToResults(teamId, hits, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return (hits ?? []).map((h) => ({
    score: h.score ?? 0,
    path: fromWire(teamId, h.path),
    nameHit: !!h.pathMatch,
    hits: (h.snippets ?? []).map((s) => {
      const lower = String(s.text).toLowerCase();
      const col = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
      return { line: s.line, col, text: s.text };
    }),
    total: Math.max(1, (h.snippets ?? []).length),
  }));
}

/** Best first across all spaces (scores come from the same ranking), without the score. */
function mergeResults(lists) {
  return lists
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ score, ...r }) => r);
}

/** `GET /v1/stars` rows as `{ path, kind, at }` with the app's rel paths. A team's owner is `t:<id>`; any other owner is the user's own space. */
function starsFromWire(stars) {
  const out = [];
  for (const s of stars ?? []) {
    const m = /^t:(.+)$/.exec(s.owner ?? '');
    out.push({ path: fromWire(m ? m[1] : null, s.path), kind: s.kind === 'project' ? 'project' : 'note', at: s.starred_at });
  }
  return out;
}

/** Query of PUT/DELETE /v1/stars for a rel path (a project key or a note). */
function starQuery(rel) {
  const { owner, path } = toWire(rel);
  return { owner, path };
}

module.exports = { hitsToResults, mergeResults, starsFromWire, starQuery };
