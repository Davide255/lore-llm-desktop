import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isWeb, lore } from '../kb/bridge';
import type { ActivityEvent, Agent, AgentKind, AuditItem, AuthUser, ChangedEvent, MyInvite, NewAgent, ObsidianStatus, PendingUpload, Permission, Prefs, SignInProvider, Team, TeamRole, TreeNode, UploadFile, VaultStatus } from '../kb/types';
import { basename, dirname, fileKind, findNode, projectKeyOf, projectLabel as projectLabelOf, unloadedProject } from '../kb/paths';

export type Route =
  | { name: 'projects' }
  | { name: 'folder'; path: string }
  | { name: 'file'; path: string; edit?: boolean; line?: number; heading?: string }
  | { name: 'activity'; id?: string }
  | { name: 'settings'; section?: SettingsSection };

export type SettingsSection = 'account' | 'general' | 'team' | 'editor' | 'obsidian' | 'system' | 'agents' | 'shortcuts';

export type Dialog =
  | { kind: 'newFile'; dir: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'newProject' }
  | { kind: 'rename'; path: string }
  | { kind: 'move'; path: string }
  | { kind: 'delete'; path: string }
  | { kind: 'unsaved'; next: () => void }
  | { kind: 'vaultSetup' }
  | { kind: 'vaultConfirm'; count: number; paths: string[] }
  | { kind: 'vaultDisable' }
  | { kind: 'moveToTeam'; path: string }
  | { kind: 'otaUpdate'; version: string };

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
  /** Host of the Lore server holding the knowledge base. */
  server: string;
  ready: boolean;
  /** The signed-in user's knowledge base finished its first load. */
  loaded: boolean;
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
  /** Restarts into the downloaded update (asks about unsaved edits first). */
  restartForUpdate: () => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  /** Phone layout: the sidebar slid in over the content. */
  drawerOpen: boolean;
  setDrawerOpen: (v: boolean) => void;
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
  createAgent: (a: { kind: AgentKind; name: string; permission: Permission; scope: string[] }) => Promise<NewAgent | undefined>;
  updateAgent: (id: string, patch: Partial<Pick<Agent, 'name' | 'kind' | 'permission' | 'scope'>>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  audit: AuditItem[];
  loadAudit: () => Promise<void>;
  user: AuthUser | null;
  signingIn: boolean;
  signIn: (provider?: SignInProvider) => Promise<void>;
  cancelSignIn: () => void;
  signOut: () => Promise<void>;
  sync: Sync;
  setSync: (s: Sync) => void;
  /** The local vault for Obsidian (null until known). */
  vault: VaultStatus | null;
  obsidian: ObsidianStatus;
  refreshVault: () => Promise<void>;
  /** The vault is on and Obsidian can open its notes. */
  obsidianReady: boolean;
  openInObsidian: (path?: string) => Promise<void>;
  /** "Modifica": the Lore editor, or Obsidian when it's the default editor. */
  editFile: (path: string) => void;
  /** Who made the latest external change (agent, Obsidian, another device). */
  changedSource: ChangedEvent['source'];
  /** Bumped whenever files change on disk; screens re-read on change. */
  revision: number;
  changedPaths: string[];
  refresh: () => Promise<void>;
  /** Loads a project's files (projects load when first opened). */
  openProject: (key: string) => Promise<void>;
  /** Projects being loaded right now. */
  opening: Set<string>;
  /** Loads every project not opened yet (search across all of them). */
  loadAll: () => Promise<void>;
  /** Progress of loadAll, null when idle. */
  loadProgress: { done: number; total: number } | null;
  /** Files uploading right now: shown greyed out in their folder until they are in the tree. */
  uploads: PendingUpload[];
  /** The teams the user belongs to, with their role. */
  teams: Team[];
  refreshTeams: () => Promise<void>;
  /** Invitations addressed to the user. */
  invites: MyInvite[];
  answerInvite: (id: string, accept: boolean) => Promise<void>;
  /** The user's role on the project a path belongs to ('owner' for their own projects). */
  accessOf: (path: string) => TeamRole;
  editorRef: React.MutableRefObject<EditorHandle | null>;
  ops: {
    createFile: (path: string, content: string) => Promise<void>;
    createFolder: (path: string) => Promise<void>;
    /** Uploads files into a folder: the given ones, or picked with the system dialog. */
    upload: (dir: string, files?: UploadFile[], opts?: { folder?: boolean }) => Promise<void>;
    rename: (from: string, to: string) => Promise<void>;
    duplicate: (path: string) => Promise<void>;
    remove: (path: string) => Promise<void>;
    copyLink: (path: string) => Promise<void>;
    write: (path: string, content: string) => Promise<void>;
    moveToTeam: (key: string, teamId: string) => Promise<void>;
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
  const [server, setServer] = useState('');
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [route, setRoute] = useState<Route>({ name: 'projects' });
  const history = useRef<Route[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, openDialog] = useState<Dialog | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState<PopupMenu | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [lastSeen, setLastSeen] = useState(0);
  const [prefs, setPrefsState] = useState<Prefs>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [sync, setSync] = useState<Sync>('synced');
  const [revision, setRevision] = useState(0);
  const [changedPaths, setChangedPaths] = useState<string[]>([]);
  const [changedSource, setChangedSource] = useState<ChangedEvent['source']>();
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [obsidian, setObsidian] = useState<ObsidianStatus>({ installed: false, registered: false });
  const [opening, setOpening] = useState<Set<string>>(new Set());
  const [loadProgress, setLoadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const editorRef = useRef<EditorHandle | null>(null);
  const lastUndo = useRef<{ run: () => void; until: number } | null>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const refresh = useCallback(async () => {
    const t = await lore.tree();
    setTree(t);
  }, []);

  const openingRef = useRef(new Set<string>());
  const openProject = useCallback(async (key: string) => {
    if (openingRef.current.has(key)) return;
    openingRef.current.add(key);
    setOpening(new Set(openingRef.current));
    try {
      setTree(await lore.openProject(key));
    } finally {
      openingRef.current.delete(key);
      setOpening(new Set(openingRef.current));
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoadProgress({ done: 0, total: 0 });
    try {
      setTree(await lore.loadAll());
      setRevision((v) => v + 1);
    } finally {
      setLoadProgress(null);
    }
  }, []);

  const refreshTeams = useCallback(async () => {
    setTeams(await lore.teams());
  }, []);

  const loadAgents = useCallback(async () => {
    setAgents(await lore.agents());
  }, []);

  const loadAudit = useCallback(async () => {
    setAudit((await lore.audit({ limit: 50 })).items);
  }, []);

  // Boot
  useEffect(() => {
    (async () => {
      const [s, p, u] = await Promise.all([lore.server(), lore.prefs(), lore.authUser()]);
      setServer(s);
      setPrefsState(p);
      setUser(u);
      setReady(true);
    })();
  }, []);

  // Disk changes from agents (or any other program)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const offChanged = lore.onChanged(async ({ paths, external, source }) => {
      await refresh();
      if (!paths.length) refreshTeams().catch(() => {});
      setChangedPaths(paths);
      if (external) setChangedSource(source ?? 'agent');
      setRevision((v) => v + 1);
      if (external) {
        setSync('external');
        clearTimeout(t);
        t = setTimeout(() => setSync('synced'), 2500);
      }
      if (external) loadAudit().catch(() => {});
    });
    const offActivity = lore.onActivity((ev) => setActivity((a) => [ev, ...a.filter((x) => x.id !== ev.id)].slice(0, 300)));
    // Sign-in, sign-out, or a session that expired for good.
    const offAuth = lore.onAuthChanged(setUser);
    const offVault = lore.onVaultStatus(setVault);
    const offProgress = lore.onLoadProgress((p) => setLoadProgress((cur) => (cur ? p : cur)));
    const offUpload = lore.onUpload((ev) =>
      setUploads((list) => {
        if (ev.type === 'plan') return [...list, ...ev.items.map((i) => ({ ...i, sent: 0, started: false }))];
        if (ev.type === 'progress') return list.map((u) => (u.id === ev.id ? { ...u, sent: ev.sent, started: true } : u));
        return list.filter((u) => u.id !== ev.id);
      }),
    );
    const offInvites = lore.onInvites(setInvites);
    return () => {
      offUpload();
      offProgress();
      offInvites();
      offChanged();
      offActivity();
      offAuth();
      offVault();
      clearTimeout(t);
    };
  }, [refresh, loadAudit, refreshTeams]);

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

  // Each account has its own knowledge base: (re)load everything when the user changes.
  const userId = user?.id ?? null;
  useEffect(() => {
    setLoaded(false);
    setTree([]);
    setAgents([]);
    setAudit([]);
    setTeams([]);
    setInvites([]);
    setRoute({ name: 'projects' });
    history.current = [];
    setExpanded(new Set());
    setSelected(null);
    if (!userId) return;
    let live = true;
    (async () => {
      try {
        const [a, seen] = await Promise.all([lore.activity(), lore.lastSeenActivity()]);
        if (!live) return;
        setActivity(a);
        setLastSeen(seen);
        await refresh();
        await Promise.all([loadAgents(), loadAudit(), refreshTeams().catch(() => {}), lore.myInvites().then((i) => live && setInvites(i)).catch(() => {})]);
      } catch (e) {
        if (live) fail(e);
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [userId, refresh, loadAgents, loadAudit, refreshTeams, fail]);

  // ------------------------------------------------------------- navigation
  const guard = useCallback((next: () => void, force?: boolean) => {
    const ed = editorRef.current;
    if (!force && ed && ed.dirty()) {
      openDialog({ kind: 'unsaved', next });
      return;
    }
    next();
  }, []);

  const restartForUpdate = useCallback(
    () =>
      guard(async () => {
        try {
          if (!(await lore.otaApply())) toast({ icon: 'info', text: "Aggiornamento scaricato: si installa al prossimo avvio dell'app", ttl: 6000 });
        } catch (e) {
          fail(e);
        }
      }),
    [guard, toast, fail],
  );

  const navigate = useCallback(
    (r: Route, opts?: { force?: boolean }) => {
      guard(() => {
        setRoute((cur) => {
          history.current.push(cur);
          if (history.current.length > 50) history.current.shift();
          return r;
        });
        setMenu(null);
        setDrawerOpen(false);
        if (r.name === 'file' || r.name === 'folder') {
          // Projects load when first opened; the screen shows a spinner meanwhile.
          if (unloadedProject(treeRef.current, r.path)) openProject(projectKeyOf(r.path)).catch(fail);
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
    [guard, openProject, fail],
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

  // ----------------------------------------------------------- local vault
  const refreshVault = useCallback(async () => {
    const [v, o] = await Promise.all([lore.vaultStatus(), lore.obsidianStatus()]);
    setVault(v);
    setObsidian(o);
  }, []);

  useEffect(() => {
    // The browser build has no local vault to sync with Obsidian.
    if (userId && !isWeb) refreshVault().catch(() => {});
  }, [userId, refreshVault]);

  useEffect(() => {
    const offConflict = lore.onVaultConflict(({ path, copy }) =>
      toast({
        icon: 'sync_problem',
        mono: basename(path),
        text: 'modificato anche nel cloud: la loro versione è in una copia',
        action: { label: 'Apri copia', run: () => navigate({ name: 'file', path: copy }) },
        ttl: 10_000,
      }),
    );
    const offConfirm = lore.onVaultConfirm(({ count, paths }) => openDialog({ kind: 'vaultConfirm', count, paths }));
    const offNotice = lore.onVaultNotice(({ message }) => toast({ icon: 'info', text: message, ttl: 6000 }));
    const offNavigate = lore.onNavigate(({ path, heading }) => navigate({ name: 'file', path, ...(heading ? { heading } : {}) }));
    return () => {
      offConflict();
      offConfirm();
      offNotice();
      offNavigate();
    };
  }, [toast, navigate]);

  // A lore:// link that started the app is opened once the knowledge base is there.
  useEffect(() => {
    if (!loaded || !userId) return;
    lore.takePendingLink().then((link) => {
      if (link && (findNode(treeRef.current, link.path) || unloadedProject(treeRef.current, link.path))) navigate({ name: 'file', path: link.path, ...(link.heading ? { heading: link.heading } : {}) });
    });
  }, [loaded, userId, navigate]);

  const obsidianReady = !isWeb && !!vault?.enabled && vault.state !== 'off' && obsidian.installed;

  const openInObsidian = useCallback(
    async (path?: string) => {
      if (isWeb) return;
      try {
        if (!obsidian.registered) {
          // Obsidian has no link that adds a vault: the setup explains the one manual step.
          await refreshVault();
          const o = await lore.obsidianStatus();
          if (!o.registered) {
            openDialog({ kind: 'vaultSetup' });
            return;
          }
        }
        await lore.openInObsidian(path);
      } catch (e) {
        fail(e);
      }
    },
    [obsidian.registered, refreshVault, fail],
  );

  const editFile = useCallback(
    (path: string) => {
      if (prefs.defaultEditor === 'obsidian' && obsidianReady && fileKind(path) === 'doc') openInObsidian(path);
      else navigate({ name: 'file', path, edit: true });
    },
    [prefs.defaultEditor, obsidianReady, openInObsidian, navigate],
  );

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
      upload: async (dir, files, opts) => {
        const res = await withSync(() => lore.upload(dir, files, opts));
        if (!res) return;
        const n = res.uploaded.length;
        if (n) toast({ icon: 'upload_file', text: n === 1 ? `Caricato ${basename(res.uploaded[0])}` : `Caricati ${n} file`, ttl: 3000 });
        // One toast per skipped file would bury the result: say how many, and why for the first.
        if (res.skipped.length) {
          const first = res.skipped[0];
          toast({ icon: 'error', text: res.skipped.length === 1 ? `${first.name}: ${first.reason}` : `${res.skipped.length} file non caricati (${first.name}: ${first.reason})`, ttl: 6000 });
        }
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
      write: async (path, content) => {
        await withSync(() => lore.write(path, content));
      },
      moveToTeam: async (key, teamId) => {
        const next = await withSync(() => lore.moveToTeam(key, teamId));
        if (!next) return;
        remap(key, next);
        toast({ icon: 'group', mono: projectLabelOf(next), text: 'ora è del team' });
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

  const setPrefs = useCallback((p: Prefs) => {
    setPrefsState((cur) => ({ ...cur, ...p }));
    lore.setPrefs(p);
  }, []);

  const createAgent = useCallback<AppCtx['createAgent']>(
    async (a) => {
      try {
        const res = await lore.createAgent(a);
        setAgents((cur) => [res.agent, ...cur]);
        return res;
      } catch (e) {
        fail(e);
        return undefined;
      }
    },
    [fail],
  );

  const updateAgent = useCallback<AppCtx['updateAgent']>(
    async (id, patch) => {
      setAgents((cur) => cur.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      try {
        await lore.updateAgent(id, patch);
      } catch (e) {
        fail(e);
        loadAgents().catch(() => {});
      }
    },
    [fail, loadAgents],
  );

  // Revoking is immediate on the server: the agent's next MCP call gets 401.
  const deleteAgent = useCallback<AppCtx['deleteAgent']>(
    async (id) => {
      try {
        await lore.deleteAgent(id);
        setAgents((cur) => cur.filter((a) => a.id !== id));
        toast({ icon: 'block', text: 'Agente revocato' });
      } catch (e) {
        fail(e);
      }
    },
    [fail, toast],
  );

  const signIn = useCallback(async (provider: SignInProvider = 'google') => {
    setSigningIn(true);
    try {
      const u = await lore.signIn(provider);
      setUser(u);
      if (u) toast({ icon: 'check_circle', text: `Accesso eseguito come ${u.email ?? u.name}` });
    } catch (e) {
      // Closing the login on purpose isn't an error worth a toast.
      if (!(e instanceof Error && e.message.includes('Accesso annullato'))) fail(e);
    } finally {
      setSigningIn(false);
    }
  }, [toast, fail]);

  const cancelSignIn = useCallback(() => {
    lore.cancelSignIn();
  }, []);

  const signOut = useCallback(async () => {
    try {
      await lore.signOut();
      setUser(null);
      toast({ icon: 'logout', text: 'Disconnesso' });
    } catch (e) {
      fail(e);
    }
  }, [toast, fail]);

  const answerInvite = useCallback(
    async (id: string, accept: boolean) => {
      const inv = invites.find((i) => i.id === id);
      try {
        setInvites(await lore.answerInvite(id, accept));
        if (accept) {
          await Promise.all([refresh(), refreshTeams()]);
          toast({ icon: 'group_add', text: `Sei entrato in ${inv?.teamName ?? 'un team'}` });
        }
      } catch (e) {
        fail(e);
      }
    },
    [invites, refresh, refreshTeams, toast, fail],
  );

  const accessOf = useCallback((path: string): TeamRole => {
    const key = projectKeyOf(path);
    const node = treeRef.current.find((n) => n.kind === 'folder' && n.path === key);
    return (node?.kind === 'folder' && node.project?.access) || 'owner';
  }, []);

  const markSeen = useCallback(() => {
    lore.markActivitySeen().then(setLastSeen);
  }, []);

  const unseen = activity.filter((a) => a.by === 'agent' && a.at > lastSeen).length;

  const value: AppCtx = {
    server,
    ready,
    loaded,
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
    restartForUpdate,
    searchOpen,
    setSearchOpen,
    drawerOpen,
    setDrawerOpen,
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
    createAgent,
    updateAgent,
    deleteAgent,
    audit,
    loadAudit,
    user,
    signingIn,
    signIn,
    cancelSignIn,
    signOut,
    sync,
    setSync,
    vault,
    obsidian,
    refreshVault,
    obsidianReady,
    openInObsidian,
    editFile,
    changedSource,
    revision,
    changedPaths,
    refresh,
    openProject,
    opening,
    loadAll,
    loadProgress,
    uploads,
    teams,
    refreshTeams,
    invites,
    answerInvite,
    accessOf,
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

