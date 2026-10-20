// Link resolution shared by the viewer, the editor preview and backlinks.
// Two syntaxes: markdown links (`[x](../a.md)`, what agents write) and
// Obsidian wikilinks (`[[Note#Heading|alias]]`, `![[image.png|300]]`).

export interface WikiLink {
  /** Note or file the link points at; '' for a link to a heading of the same note. */
  target: string;
  heading?: string;
  block?: string;
  alias?: string;
  /** `![[img.png|300]]` → 300 */
  width?: number;
}

const ATTACHMENT_RE = /\.(png|jpe?g|gif|webp|svg|pdf)$/i;
export const isAttachment = (p: string) => ATTACHMENT_RE.test(p);
export const isImage = (p: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(p);

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Inside of `[[...]]`. */
export function parseWikiLink(inner: string): WikiLink {
  const bar = inner.indexOf('|');
  const left = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const right = bar === -1 ? '' : inner.slice(bar + 1).trim();
  const hash = left.indexOf('#');
  const target = (hash === -1 ? left : left.slice(0, hash)).trim();
  const frag = hash === -1 ? '' : left.slice(hash + 1).trim();
  const out: WikiLink = { target };
  if (frag.startsWith('^')) out.block = frag.slice(1);
  else if (frag) out.heading = frag;
  const size = /^(\d+)(?:x\d+)?$/.exec(right);
  if (size) out.width = Number(size[1]);
  else if (right) out.alias = right;
  return out;
}

/** What a wikilink shows when it has no alias. */
export function wikiLabel(w: WikiLink): string {
  if (w.alias) return w.alias;
  const name = basename(w.target).replace(/\.md$/i, '');
  if (!name) return w.heading ?? w.block ?? '';
  return w.heading ? `${name} › ${w.heading}` : name;
}

/** Collapses `.` and `..`; null when it climbs above the root. */
export function normalize(p: string): string | null {
  const out: string[] = [];
  for (const s of p.split('/')) {
    if (s === '..') {
      if (!out.length) return null;
      out.pop();
    } else if (s && s !== '.') out.push(s);
  }
  return out.join('/');
}

/**
 * Obsidian's resolution order for `[[target]]` seen from `fromPath`:
 * exact vault path → relative to the note's folder → by name, preferring the
 * same folder, then the same project, then the shortest path. Matching is
 * case-insensitive and `.md` may be omitted.
 */
export function resolveWikiTarget(target: string, fromPath: string, paths: string[]): string | null {
  const t = target.replace(/^\/+/, '').trim();
  if (!t) return null;
  const lower = new Map<string, string>();
  for (const p of paths) if (!lower.has(p.toLowerCase())) lower.set(p.toLowerCase(), p);
  const candidates = /\.[a-z0-9]+$/i.test(t) && (t.toLowerCase().endsWith('.md') || isAttachment(t)) ? [t] : [`${t}.md`, t];

  for (const cand of candidates) {
    const exact = lower.get(cand.toLowerCase());
    if (exact) return exact;
    const rel = normalize(`${dirname(fromPath)}/${cand}`);
    const relHit = rel != null ? lower.get(rel.toLowerCase()) : undefined;
    if (relHit) return relHit;
  }

  const dir = dirname(fromPath);
  const project = fromPath.split('/')[0];
  for (const cand of candidates) {
    const tail = cand.toLowerCase();
    const hits = paths.filter((p) => {
      const lp = p.toLowerCase();
      return lp === tail || lp.endsWith(`/${tail}`);
    });
    if (!hits.length) continue;
    const rank = (p: string) => (dirname(p) === dir ? 0 : p.split('/')[0] === project ? 1 : 2);
    hits.sort((a, b) => rank(a) - rank(b) || a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b));
    return hits[0];
  }
  return null;
}

/**
 * A markdown link href (`../a.md`, `/Project/a.md`, `<a b.md>`, `a%20b.md`)
 * relative to the note, falling back to KB-root relative (agents often write
 * paths that way). Returns the path and the `#fragment`, if any.
 */
export function resolveHref(href: string, fromPath: string, exists: (p: string) => boolean): { path: string; heading?: string } | null {
  const raw = href.trim().replace(/^<|>$/g, '');
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  const hash = raw.indexOf('#');
  let clean = hash === -1 ? raw : raw.slice(0, hash);
  const heading = hash === -1 ? undefined : safeDecode(raw.slice(hash + 1)) || undefined;
  clean = safeDecode(clean);
  if (!clean) return heading ? { path: fromPath, heading } : null;
  const fromRoot = clean.startsWith('/');
  const rel = normalize(fromRoot ? clean.slice(1) : `${dirname(fromPath)}/${clean}`);
  if (rel && exists(rel)) return { path: rel, heading };
  const root = normalize(clean);
  if (root && exists(root)) return { path: root, heading };
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Notes linking to `path`, given each note's raw link targets (from the main
 * process: `[[...]]` for wikilinks, the href for markdown links).
 */
export function backlinks(path: string, index: Record<string, string[]>, paths: string[]): string[] {
  const set = new Set(paths);
  const out: string[] = [];
  for (const [source, targets] of Object.entries(index)) {
    if (source === path) continue;
    const hit = targets.some((raw) => {
      if (raw.startsWith('[[') && raw.endsWith(']]')) {
        const w = parseWikiLink(raw.slice(2, -2));
        return !!w.target && resolveWikiTarget(w.target, source, paths) === path;
      }
      return resolveHref(raw, source, (p) => set.has(p))?.path === path;
    });
    if (hit) out.push(source);
  }
  return out.sort();
}

/** URL the window loads an attachment from (served by the main process). */
export function assetUrl(rel: string): string {
  return `lore-asset://kb/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

/** Heading text as Obsidian compares it: case-insensitive, markup and extra spaces ignored. */
export function sameHeading(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[*_`~=]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}
