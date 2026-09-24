import type { FolderNode, TreeNode } from './types';

export type FileKind = 'index' | 'checklist' | 'doc';

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const join = (...parts: string[]) => parts.filter(Boolean).join('/');

/** Top-level folder a path belongs to; null for files in the KB root. */
export const projectOf = (p: string): string | null => (p.includes('/') ? p.slice(0, p.indexOf('/')) : null);

export function fileKind(p: string): FileKind {
  const n = basename(p).toLowerCase();
  if (n === 'index.md') return 'index';
  if (n === 'checklist.md') return 'checklist';
  return 'doc';
}

export const isReadOnly = (p: string) => fileKind(p) === 'index';

export function validateName(name: string, kind: 'file' | 'folder'): string | null {
  const n = name.trim();
  if (!n) return 'Inserisci un nome';
  if (/[\\/:*?"<>|]/.test(n)) return 'Caratteri non ammessi: \\ / : * ? " < > |';
  if (n.startsWith('.')) return 'Il nome non può iniziare con un punto';
  if (kind === 'file' && n.replace(/\.md$/i, '').toLowerCase() === 'index') return 'index.md è generato dagli agenti';
  return null;
}

export const withMd = (name: string) => (/\.md$/i.test(name) ? name : `${name}.md`);

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------
export function findNode(tree: TreeNode[], path: string): TreeNode | null {
  for (const n of tree) {
    if (n.path === path) return n;
    if (n.kind === 'folder' && path.startsWith(n.path + '/')) return findNode(n.children, path);
  }
  return null;
}

export function countFiles(node: TreeNode): number {
  if (node.kind === 'file') return 1;
  return node.children.reduce((s, c) => s + countFiles(c), 0);
}

export function allFiles(tree: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.kind === 'file') out.push(n);
      else walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function allFolders(tree: TreeNode[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.kind === 'folder') {
        out.push(n);
        walk(n.children);
      }
    }
  };
  walk(tree);
  return out;
}

export const projects = (tree: TreeNode[]) => tree.filter((n): n is FolderNode => n.kind === 'folder');
export const rootFiles = (tree: TreeNode[]) => tree.filter((n) => n.kind === 'file');

// ---------------------------------------------------------------------------
// Formatting (Italian, as in the design)
// ---------------------------------------------------------------------------
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const pad = (n: number) => String(n).padStart(2, '0');

export function relTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'adesso';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  const d = new Date(ms);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (h < 12 && d.toDateString() === today.toDateString()) return `${h} h fa`;
  if (d.toDateString() === today.toDateString()) return `oggi ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === yesterday.toDateString()) return `ieri ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round(s / 86_400);
  if (days < 7) return `${days} giorni fa`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return weeks === 1 ? '1 settimana fa' : `${weeks} settimane fa`;
  return longDate(ms);
}

export const longDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1).replace('.', ',')} kB`;
}

export const wordCount = (s: string) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Project identity — a stable icon + tint derived from the folder name
// ---------------------------------------------------------------------------
const ICONS = ['fitness_center', 'language', 'dns', 'campaign', 'science', 'rocket_launch', 'palette', 'database', 'hub', 'smartphone', 'school', 'inventory_2'];

export function projectIcon(name: string): { icon: string; tint: 'purple' | 'blue' } {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { icon: ICONS[h % ICONS.length], tint: h % 3 === 1 ? 'blue' : 'purple' };
}

// ---------------------------------------------------------------------------
// Templates for "Nuovo file"
// ---------------------------------------------------------------------------
export type Template = 'empty' | 'sections' | 'checklist';

export function templateContent(t: Template, fileName: string): string {
  const title = fileName
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
  switch (t) {
    case 'empty':
      return '';
    case 'sections':
      return `# ${title}\n\n## Contesto\n\n\n## Decisioni\n\n`;
    case 'checklist':
      return `# ${title}\n\n- [ ] \n`;
  }
}
