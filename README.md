# Lore LLM Desktop

Desktop editor for the knowledge base you share with your agents. UI implemented from the
Claude Design file *KB Desktop* (Athly design system, dark).

## Knowledge base model

- The KB is a folder; each subfolder is a **project**.
- `index.md` — compiled by the agents. Read-only here: it can be opened and shared, never edited.
  After you change a project's files, its card shows *In attesa di rigenerazione…* until the index is rewritten.
- `checklist.md` — sections (`## …`) of items and sub-items (`- [ ]` / `- [x]`, tab- or space-indented).
  In reading mode a click toggles an item and rewrites only that line; items and sub-items can be added,
  renamed and deleted inline (with undo). `Modifica` opens the raw file.
- Every other `.md` file and folder can be created, edited, renamed, moved, duplicated and deleted.
  Deleting is undoable for 10 s (⌘Z / toast), and a copy always goes to the OS trash.

External writes (agents) are picked up by a file watcher: open views refresh, and each write lands in
**Attività** with a side-by-side diff and *Ripristina*. The agents registry in *Impostazioni → Agenti* is
stored in `<kb>/.lore/agents.json` so an MCP server can read it; enforcing it is up to that server.

## Stack

- UI: **React Native** components (TypeScript), rendered on desktop through `react-native-web`.
- Shell: **Electron** (`electron/main.cjs`) owns the window and all filesystem access; the renderer only
  sees the narrow `window.lore` bridge (`electron/preload.cjs`, typed in `src/kb/types.ts`).
- A native `react-native-windows` / `react-native-macos` target can reuse `src/` unchanged by
  implementing the same `LoreBridge` interface as a native module (requires Visual Studio 2022 / Xcode).

```
electron/        main process (fs, watcher, activity/diff, undoable delete) + preload bridge
src/kb/          bridge, types, path rules, checklist parser/editor (+ tests)
src/state/       app state, routing with unsaved-changes guard, item actions & shortcuts
src/screens/     Projects, Folder, Document/index.md, Checklist, Editor, Activity, Settings
src/dialogs/     New file/folder/project, rename, move, delete, unsaved changes, ⌘K search
src/ui/          design-system primitives, markdown renderer, menus, toasts, tables
src/theme/       tokens from the Athly design system
```

## Scripts

```sh
npm install
npm run dev        # Vite + Electron with hot reload
npm run build      # typecheck + production bundle in dist/
npm start          # run Electron on the built bundle
npm test           # checklist parser + agent mapping/attribution tests
npm run test:ui    # renderer in headless Chrome with a fake bridge (LORE_UI_SHOTS=<dir> saves screenshots)
npm run dist       # installer via electron-builder (release/)
```

`LORE_USER_DATA=<dir>` runs the app with an isolated profile (handy for demos and tests).

## Sign in with Google

Optional; the local knowledge base works without an account. Login goes through the
Cognito user pool the lore-llm Worker trusts, with Google as federated IdP
(`electron/auth.cjs`): Authorization Code + PKCE in the system browser, callback on
`http://localhost:42813/callback`. Tokens stay in the main process, encrypted with
`safeStorage` in `<userData>/lore-auth.bin`; the renderer only sees name and email.
`auth.idToken()` returns a fresh ID token for `Authorization: Bearer` calls to `/v1/*`.

The Cognito app client must be public (no secret), allow the `code` flow, the
`openid email profile` scopes, the `Google` IdP and the callback URL above. Its id
also goes in the Worker's `COGNITO_CLIENT_IDS`.

| Env var | Default |
| --- | --- |
| `LORE_COGNITO_CLIENT_ID` | `2ij9dpmj7gacqj370obj0lehg2` ("Lore LLM Desktop", dev pool) |
| `LORE_COGNITO_DOMAIN` | `https://eu-north-1orshbeg8h.auth.eu-north-1.amazoncognito.com` |
| `LORE_AUTH_PORT` | `42813` |

## Shortcuts

⌘K search · ⌘N new file · ⇧⌘N new folder · E edit · ⌘S save · ⌘B/⌘I bold/italic · Esc close editor ·
F2 rename · ⇧⌘M move · ⌘D duplicate · ⇧⌘C copy link · ⌘⌫ delete · ⌘Z undo delete · ⌘\ toggle sidebar.
On Windows/Linux ⌘ is Ctrl. Right-click any row in the tree or tables for the same actions.
