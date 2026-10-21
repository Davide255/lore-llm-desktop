import { basename, dirname, fileKind, findNode, teamIdOf } from '../kb/paths';
import { canWrite } from '../kb/teams';
import type { TeamRole, TreeNode } from '../kb/types';
import type { MenuItem, Route, useApp } from './app';

type App = ReturnType<typeof useApp>;

export type Capability = 'open' | 'edit' | 'obsidian' | 'rename' | 'move' | 'duplicate' | 'copyLink' | 'delete' | 'newHere' | 'moveToTeam';

/** What can be done to an item. index.md is generated, so it's view-only;
 *  checklist.md keeps its name so agents can always find it. In a team's
 *  project where the user is a viewer, everything is read-only. */
export function capabilities(path: string, node: TreeNode | null, access: TeamRole = 'owner'): Set<Capability> {
  if (!node) return new Set();
  if (!canWrite(access)) return new Set(node.kind === 'folder' ? ['open', 'copyLink'] : fileKind(path) === 'attachment' ? ['open', 'copyLink'] : ['open', 'obsidian', 'copyLink']);
  // Only the user's own projects move into a team.
  if (node.kind === 'folder' && !path.includes('/') && !teamIdOf(path)) return new Set(['open', 'newHere', 'rename', 'move', 'copyLink', 'delete', 'moveToTeam']);
  if (node.kind === 'folder') return new Set(['open', 'newHere', 'rename', 'move', 'copyLink', 'delete']);
  const kind = fileKind(path);
  if (kind === 'index') return new Set(['open', 'obsidian', 'copyLink']);
  if (kind === 'checklist') return new Set(['open', 'edit', 'obsidian', 'copyLink', 'delete']);
  if (kind === 'attachment') return new Set(['open', 'rename', 'move', 'copyLink', 'delete']);
  return new Set(['open', 'edit', 'obsidian', 'rename', 'move', 'duplicate', 'copyLink', 'delete']);
}

export function openRoute(node: TreeNode, edit = false): Route {
  const kind = fileKind(node.path);
  return node.kind === 'folder' ? { name: 'folder', path: node.path } : { name: 'file', path: node.path, edit: edit && kind !== 'index' && kind !== 'attachment' };
}

/** Double click / E / "Modifica" on an item: the editor (Lore or Obsidian), or just open it. */
export function editNode(app: App, node: TreeNode) {
  const kind = fileKind(node.path);
  if (node.kind === 'file' && kind !== 'index' && kind !== 'attachment' && canWrite(app.accessOf(node.path))) app.editFile(node.path);
  else app.navigate(openRoute(node));
}

export function itemMenu(app: App, path: string): MenuItem[] {
  const node = findNode(app.tree, path);
  const can = capabilities(path, node, app.accessOf(path));
  if (!node) return [];
  const items: MenuItem[] = [];
  const add = (cap: Capability, item: Exclude<MenuItem, 'sep'>) => can.has(cap) && items.push(item);
  const sep = () => items.length && items[items.length - 1] !== 'sep' && items.push('sep');

  add('open', { icon: 'visibility', label: 'Apri', kbd: '⏎', onPress: () => app.navigate(openRoute(node)) });
  add('edit', { icon: 'edit', label: 'Modifica', kbd: 'E', onPress: () => editNode(app, node) });
  if (app.obsidianReady) add('obsidian', { icon: 'open_in_new', label: 'Apri in Obsidian', onPress: () => app.openInObsidian(path) });
  if (can.has('newHere')) {
    items.push({ icon: 'note_add', label: 'Nuovo file qui', kbd: '⌘N', onPress: () => app.openDialog({ kind: 'newFile', dir: path }) });
    items.push({ icon: 'create_new_folder', label: 'Nuova cartella', onPress: () => app.openDialog({ kind: 'newFolder', dir: path }) });
  }
  sep();
  add('rename', { icon: 'drive_file_rename_outline', label: 'Rinomina', kbd: 'F2', onPress: () => app.openDialog({ kind: 'rename', path }) });
  add('move', { icon: 'drive_file_move', label: 'Sposta in…', kbd: '⇧⌘M', onPress: () => app.openDialog({ kind: 'move', path }) });
  if (app.teams.some((t) => canWrite(t.role))) add('moveToTeam', { icon: 'group', label: 'Sposta in un team…', onPress: () => app.openDialog({ kind: 'moveToTeam', path }) });
  add('duplicate', { icon: 'content_copy', label: 'Duplica', kbd: '⌘D', onPress: () => app.ops.duplicate(path) });
  add('copyLink', { icon: 'link', label: fileKind(path) === 'index' ? 'Condividi link' : 'Copia link', kbd: '⇧⌘C', onPress: () => app.ops.copyLink(path) });
  sep();
  add('delete', { icon: 'delete', label: 'Elimina', kbd: '⌘⌫', danger: true, onPress: () => app.openDialog({ kind: 'delete', path }) });
  if (items[items.length - 1] === 'sep') items.pop();
  return items;
}

export function openItemMenu(app: App, path: string, x: number, y: number) {
  app.setSelected(path);
  app.setMenu({ x, y, items: itemMenu(app, path), target: path });
}

/** Keyboard shortcuts that act on the selected item (outside text fields). */
export function handleItemShortcut(app: App, e: KeyboardEvent): boolean {
  const path = app.selected;
  if (!path) return false;
  const node = findNode(app.tree, path);
  const can = capabilities(path, node, app.accessOf(path));
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (key === 'f2' && can.has('rename')) return app.openDialog({ kind: 'rename', path }), true;
  if (mod && e.shiftKey && key === 'm' && can.has('move')) return app.openDialog({ kind: 'move', path }), true;
  if (mod && e.shiftKey && key === 'c' && can.has('copyLink')) return app.ops.copyLink(path), true;
  if (mod && !e.shiftKey && key === 'd' && can.has('duplicate')) return app.ops.duplicate(path), true;
  if (((mod && key === 'backspace') || key === 'delete') && can.has('delete')) return app.openDialog({ kind: 'delete', path }), true;
  if (!mod && !e.shiftKey && !e.altKey && key === 'e' && can.has('edit') && node) return editNode(app, node), true;
  return false;
}

export const displayName = (path: string) => {
  const node = basename(path);
  return node || path;
};

export const parentLabel = (path: string) => dirname(path) || 'Radice';
