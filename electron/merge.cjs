// Line-based three-way merge (diff3). `diff` dropped its own merge() in v6,
// so this builds one on diffArrays: each side becomes a list of hunks against
// the common base; hunks that don't touch the same base lines both apply.
const { diffArrays } = require('diff');

/** Lines with their line endings kept, so CRLF files and a missing final newline survive. */
function splitLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Base→side changes as `{ start, end, lines }`: base lines [start, end) become `lines`. */
function hunks(base, side) {
  const out = [];
  let pos = 0;
  let cur = null;
  for (const part of diffArrays(base, side)) {
    if (!part.added && !part.removed) {
      if (cur) out.push(cur);
      cur = null;
      pos += part.count;
      continue;
    }
    cur ??= { start: pos, end: pos, lines: [] };
    if (part.removed) {
      pos += part.count;
      cur.end = pos;
    } else {
      cur.lines.push(...part.value);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** One side's version of base[start, end), given that side's hunks inside the range. */
function apply(base, start, end, side) {
  const out = [];
  let pos = start;
  for (const h of side) {
    out.push(...base.slice(pos, h.start), ...h.lines);
    pos = h.end;
  }
  out.push(...base.slice(pos, end));
  return out;
}

const same = (a, b) => a.length === b.length && a.every((l, i) => l === b[i]);

/**
 * Merge `local` and `remote`, both derived from `base`.
 * Returns `{ clean, text, conflicts }`. On conflicting regions `text` keeps the
 * local side (the user's editor keeps their wording); every non-conflicting
 * change from both sides is applied either way.
 */
function merge3(base, local, remote) {
  if (local === remote) return { clean: true, text: local, conflicts: 0 };
  if (base === local) return { clean: true, text: remote, conflicts: 0 };
  if (base === remote) return { clean: true, text: local, conflicts: 0 };

  const b = splitLines(base);
  const all = [
    ...hunks(b, splitLines(local)).map((h) => ({ ...h, side: 'local' })),
    ...hunks(b, splitLines(remote)).map((h) => ({ ...h, side: 'remote' })),
  ].sort((x, y) => x.start - y.start || x.end - y.end);

  // Group hunks touching the same base lines. Two insertions at the same point
  // also collide (the order between them would be a guess).
  const clusters = [];
  for (const h of all) {
    const last = clusters[clusters.length - 1];
    if (last && (h.start < last.end || h.start === last.start)) {
      last.end = Math.max(last.end, h.end);
      last.hunks.push(h);
    } else {
      clusters.push({ start: h.start, end: h.end, hunks: [h] });
    }
  }

  const out = [];
  let pos = 0;
  let conflicts = 0;
  for (const c of clusters) {
    out.push(...b.slice(pos, c.start));
    const mine = c.hunks.filter((h) => h.side === 'local');
    const theirs = c.hunks.filter((h) => h.side === 'remote');
    const localText = apply(b, c.start, c.end, mine);
    if (!mine.length || !theirs.length) {
      out.push(...apply(b, c.start, c.end, mine.length ? mine : theirs));
    } else {
      if (!same(localText, apply(b, c.start, c.end, theirs))) conflicts++;
      out.push(...localText);
    }
    pos = c.end;
  }
  out.push(...b.slice(pos));
  return { clean: conflicts === 0, text: out.join(''), conflicts };
}

module.exports = { merge3, splitLines };
