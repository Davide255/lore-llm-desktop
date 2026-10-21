import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { c, font, radius, t, web } from './theme';
import { AppProvider, currentDir, useApp } from './state/app';
import { handleItemShortcut } from './state/actions';
import { fileKind, projectKeyOf, unloadedProject } from './kb/paths';
import { canWrite } from './kb/teams';
import { TitleBar } from './shell/TitleBar';
import { Sidebar } from './shell/Sidebar';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { FolderScreen } from './screens/FolderScreen';
import { DocumentScreen } from './screens/DocumentScreen';
import { ChecklistScreen } from './screens/ChecklistScreen';
import { EditorScreen } from './screens/EditorScreen';
import { AttachmentScreen } from './screens/AttachmentScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { DialogHost } from './dialogs/Dialogs';
import { SearchPalette } from './dialogs/SearchPalette';
import { PopupMenuLayer, ToastLayer } from './ui/overlays';
import { Btn, Hover, Spinner, useCompact } from './ui/primitives';
import loreIcon from './assets/lore-icon.png';

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const app = useApp();
  const compact = useCompact();
  useGlobalShortcuts();

  if (!app.ready) return <View style={{ flex: 1, backgroundColor: c.window }} />;

  return (
    // dvh: on phones the browser's toolbars come and go, and 100vh would hide the bottom under them.
    <View style={[{ flex: 1, backgroundColor: c.window }, web({ height: '100dvh', overflow: 'hidden' })]}>
      <TitleBar />
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        {!app.user ? (
          <Login />
        ) : !app.loaded ? (
          <Loading />
        ) : (
          <>
            {!compact && !app.prefs.sidebarCollapsed ? <Sidebar /> : null}
            <View style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <Main />
            </View>
            {compact && app.drawerOpen ? <Drawer /> : null}
          </>
        )}
      </View>
      <DialogHost />
      {app.searchOpen ? <SearchPalette /> : null}
      <PopupMenuLayer />
      <ToastLayer />
    </View>
  );
}

/** Phone layout: the sidebar slides in over the content; a tap outside or any navigation closes it. */
function Drawer() {
  const app = useApp();
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, flexDirection: 'row' }}>
      <Sidebar style={[{ width: 290, maxWidth: '86%' }, web({ boxShadow: '0 0 40px rgba(0,0,0,.5)', animation: 'lore-drawer .16s ease-out' })]} />
      <Hover onPress={() => app.setDrawerOpen(false)} accessibilityLabel="Chiudi menu" style={[{ flex: 1, backgroundColor: 'rgba(0,0,0,.45)' }, web({ cursor: 'default' })]} />
    </View>
  );
}

function Main() {
  const app = useApp();
  const { route } = app;
  // A project opened for the first time: its files are on their way.
  if ((route.name === 'file' || route.name === 'folder') && unloadedProject(app.tree, route.path)) {
    const key = projectKeyOf(route.path);
    return <Loading text={app.opening.has(key) ? 'Apertura del progetto…' : 'Progetto non caricato.'} retry={app.opening.has(key) ? undefined : () => app.openProject(key).catch(() => {})} />;
  }
  switch (route.name) {
    case 'projects':
      return <ProjectsScreen />;
    case 'folder':
      return <FolderScreen key={route.path} path={route.path} />;
    case 'file': {
      const kind = fileKind(route.path);
      if (kind === 'attachment') return <AttachmentScreen key={route.path} path={route.path} />;
      if (route.edit && kind !== 'index' && canWrite(app.accessOf(route.path))) return <EditorScreen key={`e:${route.path}`} path={route.path} line={route.line} />;
      if (kind === 'checklist') return <ChecklistScreen key={route.path} path={route.path} />;
      return <DocumentScreen key={route.path} path={route.path} />;
    }
    case 'activity':
      return <ActivityScreen id={route.id} />;
    case 'settings':
      return <SettingsScreen section={route.section} />;
  }
}

// The first thing on screen: nothing else is reachable until the user signs in.
function Login() {
  const app = useApp();
  return (
    <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }, web({ backgroundImage: c.bgGradient })]}>
      <View style={{ maxWidth: 520, alignItems: 'center', gap: 16 }}>
        <img src={loreIcon} alt="Lore LLM" width={72} height={72} style={{ filter: 'drop-shadow(0 14px 40px rgba(143,92,255,.25))' }} />
        <Text style={[t(700, 34, 1.1, { letterSpacing: -1.2, textAlign: 'center' }), web({ backgroundImage: c.gradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' })]}>
          Lore LLM Desktop
        </Text>
        <Text style={t(400, 14.5, 1.6, { color: c.ink78, textAlign: 'center' })}>
          La knowledge base che condividi con i tuoi agenti. Ogni progetto ha il suo <Text style={{ fontFamily: font.mono }}>index.md</Text> generato e la sua{' '}
          <Text style={{ fontFamily: font.mono }}>checklist.md</Text>. Accedi per aprirla.
        </Text>
        {app.signingIn ? (
          <View style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
            <Text style={t(500, 13.5, 1.4, { color: c.ink2 })}>Completa l’accesso nella scheda del browser che si è aperta…</Text>
            <Btn label="Annulla" onPress={app.cancelSignIn} />
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 8, width: 280 }}>
            <AppleButton onPress={() => app.signIn('apple')} />
            <GoogleButton onPress={() => app.signIn('google')} />
          </View>
        )}
        <Text style={t(400, 12, 1, { color: c.ink3, marginTop: 4 })}>Server: {app.server}</Text>
      </View>
    </View>
  );
}

// Sign in with Apple, drawn per Apple's guidelines: white button, black logo and label, same size as the others.
function AppleButton({ onPress }: { onPress: () => void }) {
  return (
    <Hover
      onPress={onPress}
      accessibilityLabel="Accedi con Apple"
      style={({ hovered }) => ({ height: 44, borderRadius: radius.md, backgroundColor: hovered ? '#ececec' : '#ffffff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 })}
    >
      <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden="true" style={{ marginTop: -2 }}>
        <path
          fill="#000"
          d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
        />
      </svg>
      <Text style={t(600, 14.5, 1, { color: '#000' })}>Accedi con Apple</Text>
    </Hover>
  );
}

// Same shape as the Btn "ghost" variant, with the Gemini sparkle in place of an icon-font glyph.
function GoogleButton({ onPress }: { onPress: () => void }) {
  return (
    <Hover
      onPress={onPress}
      accessibilityLabel="Accedi con Google"
      style={({ hovered, pressed }) => ({ height: 44, borderRadius: radius.md, backgroundColor: hovered || pressed ? c.fill12 : c.fill07, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 })}
    >
      <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="gemini-sparkle" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1c7dff" />
            <stop offset=".55" stopColor="#6c8bff" />
            <stop offset="1" stopColor="#d96570" />
          </linearGradient>
        </defs>
        <path fill="url(#gemini-sparkle)" d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z" />
      </svg>
      <Text style={t(600, 14.5, 1, { color: c.ink })}>Accedi con Google</Text>
    </Hover>
  );
}

function Loading({ text = 'Caricamento della knowledge base…', retry }: { text?: string; retry?: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      {retry ? null : <Spinner size={22} />}
      <Text style={t(400, 13.5, 1, { color: c.ink3 })}>{text}</Text>
      {retry ? <Btn icon="refresh" label="Riprova" onPress={retry} /> : null}
    </View>
  );
}

function useGlobalShortcuts() {
  const app = useApp();
  const ref = React.useRef(app);
  ref.current = app;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = ref.current;
      if (!a.user || !a.loaded) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const overlay = !!a.dialog || a.searchOpen || !!a.menu;

      if (mod && key === 'k' && !e.shiftKey) {
        e.preventDefault();
        a.setSearchOpen(!a.searchOpen);
        return;
      }
      if (overlay) return;
      if (mod && key === 'n') {
        e.preventDefault();
        const dir = currentDir(a.route);
        if (dir && !canWrite(a.accessOf(dir))) return;
        if (e.shiftKey) a.openDialog({ kind: 'newFolder', dir });
        else a.openDialog({ kind: 'newFile', dir });
        return;
      }
      if (mod && e.key === '\\') {
        e.preventDefault();
        a.setPrefs({ sidebarCollapsed: !a.prefs.sidebarCollapsed });
        return;
      }
      if (typing) return;
      if (e.altKey && key === 'arrowleft') {
        e.preventDefault();
        a.back();
        return;
      }
      if (handleItemShortcut(a, e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
