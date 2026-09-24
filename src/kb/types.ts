export type Author = 'you' | 'agent';

export interface FileNode {
  kind: 'file';
  name: string;
  path: string;
  mtime: number;
  size: number;
  author: Author;
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
  added: number;
  removed: number;
  hunks: DiffHunk[];
  before: string | null;
  after: string | null;
}

export type Permission = 'read' | 'write';

export interface Agent {
  id: string;
  name: string;
  permission: Permission;
  /** Project folder names, or ['*'] for every project. */
  scope: string[];
  active: boolean;
  lastAccess?: number;
}

export interface Prefs {
  syncScroll?: boolean;
  editorView?: 'preview' | 'split' | 'source';
  sidebarCollapsed?: boolean;
}

/** The bridge the Electron preload exposes. A react-native-windows/macos
 *  target would implement this same interface with a native module. */
export interface LoreBridge {
  getRoot(): Promise<string | null>;
  chooseRoot(): Promise<string | null>;
  tree(): Promise<TreeNode[]>;
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
  readMeta<T>(name: string): Promise<T | null>;
  writeMeta(name: string, data: unknown): Promise<boolean>;
  prefs(): Promise<Prefs>;
  setPrefs(p: Prefs): Promise<Prefs>;
  reveal(path: string): Promise<void>;
  copy(text: string): Promise<void>;
  absPath(path: string): Promise<string>;
  platform(): Promise<string>;
  confirmClose(): Promise<void>;
  onChanged(cb: (ev: { paths: string[]; external: boolean }) => void): () => void;
  onActivity(cb: (ev: ActivityEvent) => void): () => void;
  onCloseRequested(cb: () => void): () => void;
}
