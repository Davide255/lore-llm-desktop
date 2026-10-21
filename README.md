# Lore LLM Desktop

Desktop editor for the knowledge base you share with your agents. UI implemented from the
Claude Design file *KB Desktop* (Athly design system, dark).

Part of Lore LLM: [backend](https://github.com/Davide255/lore-llm) ·
[mobile app](https://github.com/Davide255/lore-llm-mobile).

## Knowledge base model

- The KB lives in your cloud space on the Lore server; each top-level folder is a **project**.
- `index.md` — compiled by the agents. Read-only here: it can be opened and shared, never edited.
  After you change a project's files, its card shows *In attesa di rigenerazione…* until the index is rewritten.
- `checklist.md` — sections (`## …`) of items and sub-items (`- [ ]` / `- [x]`, tab- or space-indented).
  In reading mode a click toggles an item and rewrites only that line; items and sub-items can be added,
  renamed and deleted inline (with undo). `Modifica` opens the raw file.
- Every other `.md` file and folder can be created, edited, renamed, moved, duplicated and deleted.
  Deleting is undoable for 10 s (⌘Z / toast).
- Images and PDFs (`png jpg gif webp svg pdf`, ≤ 10 MB) can sit next to notes as **attachments**: they render
  inline (`![](img/a.png)`, `![[a.png|300]]`) and open in their own view. Agents see them listed, not their bytes.
- Links: markdown links (relative or KB-root relative), bare `name.md` mentions and Obsidian `[[wikilinks]]`
  (`[[Note#Heading|alias]]`). *Citato da* lists the notes that link to a file.

Projects load when you open them. Launch reads one summary row per project (`/v1/projects`: file count,
last change, checklist etag) and each `checklist.md`, so cards show progress without downloading anything
else; a project's notes are fetched the first time it is opened, and the projects you opened lately load in
the background at the next launch. Search, *Citato da* and wikilinks cover the projects already open; in ⌘K,
*Cerca in tutti i progetti* loads the rest.

Changes made elsewhere (agents over MCP, your other devices) are found by polling the server's change
cursors (`/v1/version`, one request: your space and each team's): open views refresh, and each change in an
open project lands in **Attività** with a side-by-side diff and *Ripristina*. Projects not opened only refresh
their card.

## Obsidian

*Impostazioni → Obsidian* turns on a **local copy** of the KB: a plain folder (default `~/Documents/Lore LLM`)
that `electron/vault.cjs` keeps in two-way sync with the cloud. Open it in Obsidian as a vault; notes you
save there reach the agents in a few seconds, and their edits land in Obsidian (also while Lore runs in the
background). *Apri in Obsidian* opens the current note; *Editor predefinito* can make Obsidian the editor for
`Modifica`/`E`/double click.

- Local edits are pushed with the etag last synced; if the cloud changed meanwhile the two versions are
  **three-way merged** (`electron/merge.cjs`). Overlapping edits keep yours in the file and save the cloud's as
  `name (conflitto … ).md`, with an entry in Attività.
- Renames and folder moves are recognised (same content, new path) and become server moves, in both directions.
- `index.md` is written read-only and any local edit is reverted. Files that can't sync (outside a project,
  other types, too large) stay local and are listed in the settings page.
- Cloud deletions go to the OS trash. If many files vanish locally at once, sync pauses and asks.
- Sync state (manifest + merge bases) lives in `<userData>/sync/<user>/`, outside the vault; the vault only
  holds `.lore-sync/vault.json`, which ties it to one account. Lore writes `.obsidian/app.json` once, for a
  folder Obsidian has never opened (markdown links, attachments next to the note).
- `lore://open?path=Project/note.md` opens a note in Lore.

## Stack

- UI: **React Native** components (TypeScript), rendered on desktop through `react-native-web`.
- Shell: **Electron** (`electron/main.cjs`) owns the window and all filesystem access; the renderer only
  sees the narrow `window.lore` bridge (`electron/preload.cjs`, typed in `src/kb/types.ts`).
- A native `react-native-windows` / `react-native-macos` target can reuse `src/` unchanged by
  implementing the same `LoreBridge` interface as a native module (requires Visual Studio 2022 / Xcode).

```
electron/        main process (cloud mirror, activity/diff, undoable delete, local vault sync, Obsidian) + preload bridge
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
npm test           # checklist, links, agents, spaces, mirror, merge, vault sync and Obsidian tests (Node ≥ 22.18; on older 22.x add --experimental-strip-types)
npm run test:ui    # renderer in headless Chrome with a fake bridge (LORE_UI_SHOTS=<dir> saves screenshots, LORE_CHROME=<path> uses another Chromium)
npm run dist       # installer via electron-builder (release/)
```

`LORE_USER_DATA=<dir>` runs the app with an isolated profile (handy for demos and tests).

## Sign in with Google

Optional; the local knowledge base works without an account. Login goes through the
Cognito user pool the [lore-llm](https://github.com/Davide255/lore-llm) Worker trusts, with Google as federated IdP
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
