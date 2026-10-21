/** Who wrote a file. 'teammate': someone else in a team's project (the server doesn't say who yet). */
export type Author = 'you' | 'agent' | 'teammate';

export type TeamRole = 'owner' | 'editor' | 'viewer';

/** Roles an invitation can grant (owners are made by promoting a member). */
export type InviteRole = Exclude<TeamRole, 'owner'>;

export interface Team {
  id: string;
  name: string;
  /** The signed-in user's role in the team. */
  role: TeamRole;
  createdAt: number;
}

export interface TeamMember {
  userId: string;
  role: TeamRole;
  joinedAt: number;
  name: string | null;
  email: string | null;
  isYou: boolean;
}

/** An invitation the team sent, still waiting for an answer. */
export interface TeamInvite {
  id: string;
  email: string;
  role: InviteRole;
  createdAt: number;
  expiresAt: number;
}

/** An invitation addressed to the signed-in user. */
export interface MyInvite {
  id: string;
  teamId: string;
  teamName: string;
  role: InviteRole;
  invitedBy: string | null;
  createdAt: number;
  expiresAt: number;
}

export type AgentKind = 'claude' | 'codex';

/** Identity snapshot of the agent behind a change. `kind` is null once the agent is revoked and unknown. */
export interface AgentRef {
  id: string;
  name: string;
  kind: AgentKind | null;
}

export interface FileNode {
  kind: 'file';
  /** Images and PDFs stored next to notes (synced from Obsidian). Absent for notes. */
  type?: 'attachment';
  mime?: string;
  name: string;
  path: string;
  mtime: number;
  size: number;
  author: Author;
  /** The agent that wrote the current version (when author is 'agent' and the audit log knows). */
  agent?: AgentRef;
  /** checklist.md only */
  done?: number;
  total?: number;
  /** index.md only: first prose paragraph */
  summary?: string;
}

/** A project at the top of the tree. Projects load when opened: until then `children` is empty and the counts come from the server. */
export interface ProjectMeta {
  /** `Name`, or `Name@<teamId>` for a team's project (the first segment of its paths). */
  key: string;
  /** Display name, without the team. */
  name: string;
  loaded: boolean;
  team: { id: string; name: string } | null;
  /** The signed-in user's role on it ('owner' for their own projects). */
  access: TeamRole;
  fileCount: number;
  updatedAt: number;
  checklist: { done: number; total: number } | null;
}

export interface FolderNode {
  kind: 'folder';
  name: string;
  path: string;
  mtime: number;
  size: 0;
  children: TreeNode[];
  /** Top-level folders (projects) only. */
  project?: ProjectMeta;
}

export type TreeNode = FileNode | FolderNode;

export interface FileContent {
  path: string;
  content: string;
  mtime: number;
  size: number;
  birthtime: number;
  author: Author;
  agent?: AgentRef;
}

export interface SearchHit {
  line: number;
  col: number;
  text: string;
}

export interface SearchResult {
  path: string;
  nameHit: boolean;
  hits: SearchHit[];
  total: number;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/** Where one of your own changes came from: Lore itself (absent), Obsidian via the local vault, or another device. */
export type ChangeSource = 'obsidian' | 'device';

export interface ActivityEvent {
  id: string;
  at: number;
  path: string;
  kind: 'created' | 'modified' | 'deleted' | 'conflict';
  by: Author;
  agent?: AgentRef;
  source?: ChangeSource;
  /** Extra explanation (automatic merge, re-created file, conflict copy). */
  note?: string;
  /** kind 'conflict': where the cloud version was saved. */
  copy?: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
  before: string | null;
  after: string | null;
}

export type Permission = 'read' | 'write';

/** An agent registered on the Lore server (its token is shown only at creation). */
export interface Agent {
  id: string;
  /** Friendly name chosen by the user. */
  name: string;
  kind: AgentKind;
  permission: Permission;
  /** Project names, or ['*'] for every project. */
  scope: string[];
  createdAt: number;
}

export interface NewAgent {
  agent: Agent;
  /** Bearer token for the MCP endpoint — not stored anywhere, shown once. */
  token: string;
  expiresAt: number;
  mcpUrl: string;
}

/** A file modification made by an agent, from the server's audit log. */
export interface AuditItem {
  id: number;
  at: number;
  agent?: AgentRef;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  path: string;
}

export interface Prefs {
  syncScroll?: boolean;
  editorView?: 'preview' | 'split' | 'source';
  sidebarCollapsed?: boolean;
  /** Where "Modifica" opens notes. Obsidian needs the local vault. */
  defaultEditor?: 'lore' | 'obsidian';
  obsidianBannerDismissed?: boolean;
}

export type LinkFormat = 'markdown' | 'wikilink';

/** The local vault: a folder kept in sync with the cloud, edited with Obsidian. */
export interface VaultStatus {
  state: 'off' | 'idle' | 'syncing' | 'offline' | 'paused:auth' | 'paused:confirm' | 'error';
  enabled: boolean;
  root: string | null;
  /** Null in the Mac App Store build: the folder must be picked. */
  defaultRoot: string | null;
  linkFormat: LinkFormat;
  pending: number;
  lastSyncAt: number | null;
  unsynced: { path: string; reason: string }[];
  conflicts: { path: string; copy: string; at: number }[];
  error: string | null;
  confirm: { count: number; paths: string[] } | null;
}

/** A project in the local copy's selection. Team projects sit in `Name (Team)` folders. */
export interface VaultProject {
  key: string;
  name: string;
  team: { id: string; name: string } | null;
  access: TeamRole;
  selected: boolean;
  /** Its folder in the local copy. */
  folder: string;
}

export interface VaultPreview {
  ok: boolean;
  root: string;
  error?: string;
  exists?: boolean;
  empty?: boolean;
  /** The folder was already this account's vault. */
  resume?: boolean;
  download?: number;
  upload?: number;
  merge?: number;
  same?: number;
  unsynced?: number;
}

export interface ObsidianStatus {
  installed: boolean;
  /** The vault folder is registered in Obsidian ("Apri cartella come vault"). */
  registered: boolean;
}

export interface ChangedEvent {
  paths: string[];
  external: boolean;
  /** Who made an external change. */
  source?: 'agent' | 'device' | 'obsidian' | 'teammate';
}

export type SignInProvider = 'google' | 'apple';

/** Signed-in Google or Apple account (via Cognito). Tokens stay in the main process. */
export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  provider?: SignInProvider;
}

/** The bridge the Electron preload exposes (src/web/bridge.ts implements it for the browser).
 *  A react-native-windows/macos target would implement this same interface with a native module. */
export interface LoreBridge {
  tree(fresh?: boolean): Promise<TreeNode[]>;
  /** Loads a project's files (once) and returns the updated tree. */
  openProject(key: string): Promise<TreeNode[]>;
  /** Loads every project not opened yet (for search across all of them). */
  loadAll(): Promise<TreeNode[]>;
  read(path: string): Promise<FileContent>;
  write(path: string, content: string): Promise<boolean>;
  create(path: string, content: string): Promise<boolean>;
  mkdir(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<boolean>;
  duplicate(path: string): Promise<string>;
  remove(path: string): Promise<string>;
  undoDelete(token: string): Promise<boolean>;
  search(q: string): Promise<SearchResult[]>;
  /** Raw link targets per note: `[[...]]` for wikilinks, the href for markdown links. */
  links(): Promise<Record<string, string[]>>;
  activity(): Promise<ActivityEvent[]>;
  markActivitySeen(): Promise<number>;
  lastSeenActivity(): Promise<number>;
  agents(): Promise<Agent[]>;
  createAgent(a: { kind: AgentKind; name: string; permission: Permission; scope: string[]; days?: number }): Promise<NewAgent>;
  updateAgent(id: string, patch: Partial<Pick<Agent, 'name' | 'kind' | 'permission' | 'scope'>>): Promise<boolean>;
  deleteAgent(id: string): Promise<boolean>;
  audit(opts?: { limit?: number; before?: number }): Promise<{ items: AuditItem[]; nextBefore: number | null }>;
  teams(): Promise<Team[]>;
  team(id: string): Promise<Team>;
  createTeam(name: string): Promise<Team>;
  renameTeam(id: string, name: string): Promise<boolean>;
  /** Only when the team has no files left. */
  deleteTeam(id: string): Promise<boolean>;
  teamMembers(id: string): Promise<TeamMember[]>;
  setMemberRole(id: string, userId: string, role: TeamRole): Promise<boolean>;
  /** Removes a member, or the signed-in user (leave). */
  removeMember(id: string, userId: string): Promise<boolean>;
  teamInvites(id: string): Promise<TeamInvite[]>;
  inviteToTeam(id: string, email: string, role: InviteRole): Promise<TeamInvite>;
  revokeInvite(id: string, inviteId: string): Promise<boolean>;
  myInvites(): Promise<MyInvite[]>;
  /** Accept or decline; resolves to the invitations still pending. */
  answerInvite(id: string, accept: boolean): Promise<MyInvite[]>;
  /** Moves one of the user's own projects into a team; resolves to its new key. */
  moveToTeam(key: string, teamId: string): Promise<string>;
  vaultStatus(): Promise<VaultStatus>;
  vaultChooseRoot(): Promise<string | null>;
  vaultPreview(root?: string): Promise<VaultPreview>;
  vaultEnable(opts: { root?: string; linkFormat?: LinkFormat }): Promise<VaultStatus>;
  vaultDisable(opts?: { deleteLocal?: boolean }): Promise<VaultStatus>;
  vaultSyncNow(): Promise<VaultStatus>;
  vaultConfirm(answer: 'delete' | 'restore'): Promise<VaultStatus>;
  /** Shows a file (or the vault folder) in Finder/Explorer. */
  vaultReveal(path?: string): Promise<boolean>;
  vaultSetLinkFormat(format: LinkFormat): Promise<VaultStatus>;
  /** The projects the local copy can hold, and whether each one syncs. */
  vaultProjects(): Promise<VaultProject[]>;
  vaultSetProject(key: string, on: boolean): Promise<boolean>;
  obsidianStatus(): Promise<ObsidianStatus>;
  /** Opens a note (or the vault) in Obsidian. */
  openInObsidian(path?: string): Promise<boolean>;
  launchObsidian(): Promise<void>;
  /** Opens an attachment in the system viewer. */
  openAttachment(path: string): Promise<string>;
  /** Browser build only: a URL the page can load an attachment from. Electron serves lore-asset:// instead. */
  assetUrl?(path: string): Promise<string>;
  /** A lore:// link that arrived before the window was ready. */
  takePendingLink(): Promise<{ path: string; heading?: string } | null>;
  /** Host of the Lore server the app talks to. */
  server(): Promise<string>;
  prefs(): Promise<Prefs>;
  setPrefs(p: Prefs): Promise<Prefs>;
  copy(text: string): Promise<void>;
  platform(): Promise<string>;
  confirmClose(): Promise<void>;
  authUser(): Promise<AuthUser | null>;
  signIn(provider?: SignInProvider): Promise<AuthUser | null>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  onAuthChanged(cb: (user: AuthUser | null) => void): () => void;
  onChanged(cb: (ev: ChangedEvent) => void): () => void;
  onActivity(cb: (ev: ActivityEvent) => void): () => void;
  onLoadProgress(cb: (ev: { done: number; total: number }) => void): () => void;
  onInvites(cb: (invites: MyInvite[]) => void): () => void;
  onCloseRequested(cb: () => void): () => void;
  onVaultStatus(cb: (s: VaultStatus) => void): () => void;
  onVaultConflict(cb: (ev: { path: string; copy: string }) => void): () => void;
  onVaultConfirm(cb: (ev: { count: number; paths: string[] }) => void): () => void;
  onVaultNotice(cb: (ev: { message: string }) => void): () => void;
  /** lore://open?path=… */
  onNavigate(cb: (ev: { path: string; heading?: string }) => void): () => void;
}
