import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { lore } from '../kb/bridge';
import type { ActivityEvent, Agent, Prefs, TreeNode } from '../kb/types';
import { basename, dirname, fileKind, findNode } from '../kb/paths';

export type Route =
  | { name: 'projects' }
  | { name: 'folder'; path: string }
  | { name: 'file'; path: string; edit?: boolean; line?: number }
  | { name: 'activity'; id?: string }
  | { name: 'settings'; section?: SettingsSection };

export type SettingsSection = 'general' | 'editor' | 'agents' | 'shortcuts';

export type Dialog =
  | { kind: 'newFile'; dir: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'newProject' }
  | { kind: 'rename'; path: string }
  | { kind: 'move'; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'unsaved'; next: () => void };

export type MenuItem =
  | 'sep'
  | { icon?: string; label: string; kbd?: string; danger?: boolean; checked?: boolean; disabled?: boolean; onPress: () => void };

export interface PopupMenu {
  x: number;
  y: number;
  items: MenuItem[];
  width?: number;
  /** Tree/table row the menu was opened on (gets the purple outline). */
  target?: string;
}

export interface Toast {
  id: number;
  icon: string;
  text: string;
  mono?: string;
  action?: { label: string; kbd?: string; run: () => void };
  ttl?: number;
}

/** What the open editor exposes so navigation can guard unsaved changes. */
export interface EditorHandle {
  path: string;
  dirty: () => boolean;
  changedLines: () => number;
  save: () => Promise<void>;
}

type Sync = 'synced' | 'saving' | 'external' | 'error';

interface AppCtx {
  root: string | null;
  ready: boolean;
  tree: TreeNode[];
  route: Route;
  navigate: (r: Route, opts?: { force?: boolean }) => void;
  back: () => void;
  expanded: Set<string>;
  toggleExpanded: (path: string, open?: boolean) => void;
  selected: string | null;
  setSelected: (p: string | null) => void;
  dialog: Dialog | null;
  openDialog: (d: Dialog | null) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  menu: PopupMenu | null;
  setMenu: (m: PopupMenu | null) => void;
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  activity: ActivityEvent[];
  unseen: number;
  markSeen: () => void;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  agents: Agent[];
  saveAgents: (a: Agent[]) => Promise<void>;
  sync: Sync;
  setSync: (s: Sync) => void;
  /** Bumped whenever files change on disk; screens re-read on change. */
  revision: number;
  changedPaths: string[];
  refresh: () => Promise<void>;
  chooseRoot: () => Promise<void>;
  editorRef: React.MutableRefObject<EditorHandle | null>;
  ops: {
    createFile: (path: string, content: string) => Promise<void>;
    createFolder: (path: string) => Promise<void>;
    rename: (from: string, to: string) => Promise<void>;
    duplicate: (path: string) => Promise<void>;
    remove: (path: string) => Promise<void>;
    copyLink: (path: string) => Promise<void>;
    reveal: (path: string) => Promise<void>;
    write: (path: string, content: string) => Promise<void>;
  };
}

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
};

let toastSeq = 1;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [root, setRoot] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [route, setRoute] = useState<Route>({ name: 'projects' });
  const history = useRef<Route[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, openDialog] = useState<Dialog | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<PopupMenu | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [lastSeen, setLastSeen] = useState(0);
  const [prefs, setPrefsState] = useState<Prefs>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sync, setSync] = useState<Sync>('synced');
  const [revision, setRevision] = useState(0);
  const [changedPaths, setChangedPaths] = useState<string[]>([]);
  const editorRef = useRef<EditorHandle | null>(null);
  const lastUndo = useRef<{ run: () => void; until: number } | null>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const refresh = useCallback(async () => {
    const t = await lore.tree();
    setTree(t);
  }, []);

  const loadAgents = useCallback(async () => {
    setAgents((await lore.readMeta<Agent[]>('agents.json')) ?? []);
  }, []);

  // Boot
  useEffect(() => {
    (async () => {
      const [r, p, a, seen] = await Promise.all([lore.getRoot(), lore.prefs(), lore.activity(), lore.lastSeenActivity()]);
      setRoot(r);
      setPrefsState(p);
      setActivity(a);
      setLastSeen(seen);
      if (r) {
        await refresh();
        await loadAgents();
      }
      setReady(true);
    })();
  }, [refresh, loadAgents]);

  // Disk changes from agents (or any other program)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const offChanged = lore.onChanged(async ({ paths, external }) => {
      await refresh();
      setChangedPaths(paths);
      setRevision((v) => v + 1);
      if (external) {
        setSync('external');
        clearTimeout(t);
        t = setTimeout(() => setSync('synced'), 2500);
      }
      if (paths.some((p) => p.startsWith('.lore/'))) loadAgents();
    });
    const offActivity = lore.onActivity((ev) => setActivity((a) => [ev, ...a.filter((x) => x.id !== ev.id)].slice(0, 300)));
    return () => {
      offChanged();
      offActivity();
      clearTimeout(t);
    };
  }, [refresh, loadAgents]);

  // ------------------------------------------------------------------ toasts
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (tt: Omit<Toast, 'id'>) => {
      const id = toastSeq++;
      setToasts((ts) => [...ts.slice(-2), { ...tt, id }]);
      setTimeout(() => dismissToast(id), tt.ttl ?? 4000);
    },
    [dismissToast],
  );
  const fail = useCallback((e: unknown) => toast({ icon: 'error', text: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e), ttl: 5000 }), [toast]);

  // ------------------------------------------------------------- navigation
  const guard = useCallback((next: () => void, force?: boolean) => {
    const ed = editorRef.current;
    if (!force && ed && ed.dirty()) {
      openDialog({ kind: 'unsaved', next });
      return;
    }
    next();
  }, []);

  const navigate = useCallback(
    (r: Route, opts?: { force?: boolean }) => {
      guard(() => {
        setRoute((cur) => {
          history.current.push(cur);
          if (history.current.length > 50) history.current.shift();
          return r;
        });
        setMenu(null);
        if (r.name === 'file' || r.name === 'folder') {
          setSelected(r.path);
          // Reveal the target in the sidebar tree.
          const parts = r.path.split('/');
          setExpanded((s) => {
            const n = new Set(s);
            for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join('/'));
            if (r.name === 'folder') n.add(r.path);
            return n;
          });
        }
      }, opts?.force);
    },
    [guard],
  );

  const back = useCallback(() => {
    const prev = history.current.pop();
    if (prev) guard(() => setRoute(prev));
  }, [guard]);

  const toggleExpanded = useCallback((path: string, open?: boolean) => {
    setExpanded((s) => {
      const n = new Set(s);
      const want = open ?? !n.has(path);
      if (want) n.add(path);
      else n.delete(path);
      return n;
    });
  }, []);

  // Window close with unsaved edits
  useEffect(
    () =>
      lore.onCloseRequested(() => {
        guard(() => lore.confirmClose());
      }),
    [guard],
  );

  // -------------------------------------------------------------------- ops
  const withSync = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setSync('saving');
      try {
        const r = await fn();
        await refresh();
        setRevision((v) => v + 1);
        setSync('synced');
        return r;
      } catch (e) {
        setSync('error');
        setTimeout(() => setSync('synced'), 3000);
        fail(e);
        return undefined;
      }
    },
    [refresh, fail],
  );

  // Paths that moved: keep route/selection pointing at the right place.
  const remap = useCallback((from: string, to: string) => {
    const map = (p: string) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p);
    setRoute((r) => (r.name === 'file' || r.name === 'folder' ? { ...r, path: map(r.path) } : r));
    setSelected((s) => (s ? map(s) : s));
    setExpanded((s) => new Set([...s].map(map)));
  }, []);

  const ops = useMemo<AppCtx['ops']>(
    () => ({
      createFile: async (path, content) => {
        const ok = await withSync(async () => {
          await lore.create(path, content);
          return true;
        });
        if (ok) navigate({ name: 'file', path, edit: fileKind(path) !== 'index' }, { force: true });
      },
      createFolder: async (path) => {
        const ok = await withSync(async () => {
          await lore.mkdir(path);
          return true;
        });
        if (ok) navigate({ name: 'folder', path }, { force: true });
      },
      rename: async (from, to) => {
        if (from === to) return;
        const ok = await withSync(async () => {
          await lore.rename(from, to);
          return true;
        });
        if (ok) remap(from, to);
      },
      duplicate: async (path) => {
        const target = await withSync(() => lore.duplicate(path));
        if (target) toast({ icon: 'content_copy', mono: basename(target), text: 'creato' });
      },
      remove: async (path) => {
        const node = findNode(treeRef.current, path);
        const token = await withSync(() => lore.remove(path));
        if (!token) return;
        // Leave views that pointed inside the deleted item.
        setRoute((r) => {
          if ((r.name === 'file' || r.name === 'folder') && (r.path === path || r.path.startsWith(path + '/'))) {
            const parent = dirname(path);
            return parent ? { name: 'folder', path: parent } : { name: 'projects' };
          }
          return r;
        });
        const undo = async () => {
          const ok = await withSync(() => lore.undoDelete(token));
          if (ok) toast({ icon: 'restore_from_trash', mono: basename(path), text: 'ripristinato' });
        };
        lastUndo.current = { run: undo, until: Date.now() + 10_000 };
        toast({
          icon: 'delete',
          mono: node?.kind === 'folder' ? basename(path) + '/' : basename(path),
          text: 'eliminato',
          action: { label: 'Annulla', kbd: '⌘Z', run: undo },
          ttl: 10_000,
        });
      },
      copyLink: async (path) => {
        await lore.copy(path.includes(' ') ? `<${path}>` : path);
        toast({ icon: 'link', mono: path, text: 'copiato negli appunti' });
      },
      reveal: (path) => lore.reveal(path),
      write: async (path, content) => {
        await withSync(() => lore.write(path, content));
      },
    }),
    [withSync, navigate, remap, toast],
  );


  // ⌘Z outside text fields undoes the last delete (within 10 s).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
      const u = lastUndo.current;
      if (u && Date.now() < u.until) {
        e.preventDefault();
        lastUndo.current = null;
        u.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const chooseRoot = useCallback(async () => {
    const r = await lore.chooseRoot();
    if (r && r !== root) {
      setRoot(r);
      setRoute({ name: 'projects' });
      history.current = [];
      await refresh();
      await loadAgents();
    }
  }, [root, refresh, loadAgents]);

  const setPrefs = useCallback((p: Prefs) => {
    setPrefsState((cur) => ({ ...cur, ...p }));
    lore.setPrefs(p);
  }, []);

  const saveAgents = useCallback(
    async (a: Agent[]) => {
      setAgents(a);
      try {
        await lore.writeMeta('agents.json', a);
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const markSeen = useCallback(() => {
    lore.markActivitySeen().then(setLastSeen);
  }, []);

  const unseen = activity.filter((a) => a.by === 'agent' && a.at > lastSeen).length;

  const value: AppCtx = {
    root,
    ready,
    tree,
    route,
    navigate,
    back,
    expanded,
    toggleExpanded,
    selected,
    setSelected,
    dialog,
    openDialog,
    searchOpen,
    setSearchOpen,
    menu,
    setMenu,
    toasts,
    toast,
    dismissToast,
    activity,
    unseen,
    markSeen,
    prefs,
    setPrefs,
    agents,
    saveAgents,
    sync,
    setSync,
    revision,
    changedPaths,
    refresh,
    chooseRoot,
    editorRef,
    ops,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Folder that "Nuovo file" should target for the current route. */
export function currentDir(route: Route): string {
  if (route.name === 'folder') return route.path;
  if (route.name === 'file') return dirname(route.path);
  return '';
}

