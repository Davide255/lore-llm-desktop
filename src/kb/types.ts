export type Author = 'you' | 'agent';

export type AgentKind = 'claude' | 'codex';

/** Identity snapshot of the agent behind a change. `kind` is null once the agent is revoked and unknown. */
export interface AgentRef {
  id: string;
  name: string;
  kind: AgentKind | null;
}

export interface FileNode {
  kind: 'file';
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

export interface FolderNode {
  kind: 'folder';
  name: string;
  path: string;
  mtime: number;
  size: 0;
  children: TreeNode[];
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

export interface ActivityEvent {
  id: string;
  at: number;
  path: string;
  kind: 'created' | 'modified' | 'deleted';
  by: Author;
  agent?: AgentRef;
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
}

/** Signed-in Google account (via Cognito). Tokens stay in the main process. */
export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
}

/** The bridge the Electron preload exposes. A react-native-windows/macos
 *  target would implement this same interface with a native module. */
export interface LoreBridge {
  tree(fresh?: boolean): Promise<TreeNode[]>;
  read(path: string): Promise<FileContent>;
  write(path: string, content: string): Promise<boolean>;
  create(path: string, content: string): Promise<boolean>;
  mkdir(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<boolean>;
  duplicate(path: string): Promise<string>;
  remove(path: string): Promise<string>;
  undoDelete(token: string): Promise<boolean>;
  search(q: string): Promise<SearchResult[]>;
  activity(): Promise<ActivityEvent[]>;
  markActivitySeen(): Promise<number>;
  lastSeenActivity(): Promise<number>;
  agents(): Promise<Agent[]>;
  createAgent(a: { kind: AgentKind; name: string; permission: Permission; scope: string[]; days?: number }): Promise<NewAgent>;
  updateAgent(id: string, patch: Partial<Pick<Agent, 'name' | 'kind' | 'permission' | 'scope'>>): Promise<boolean>;
  deleteAgent(id: string): Promise<boolean>;
  audit(opts?: { limit?: number; before?: number }): Promise<{ items: AuditItem[]; nextBefore: number | null }>;
  /** Host of the Lore server the app talks to. */
  server(): Promise<string>;
  prefs(): Promise<Prefs>;
  setPrefs(p: Prefs): Promise<Prefs>;
  copy(text: string): Promise<void>;
  platform(): Promise<string>;
  confirmClose(): Promise<void>;
  authUser(): Promise<AuthUser | null>;
  signIn(): Promise<AuthUser | null>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  onAuthChanged(cb: (user: AuthUser | null) => void): () => void;
  onChanged(cb: (ev: { paths: string[]; external: boolean }) => void): () => void;
  onActivity(cb: (ev: ActivityEvent) => void): () => void;
  onCloseRequested(cb: () => void): () => void;
}
