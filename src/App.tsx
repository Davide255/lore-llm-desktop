import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { c, font, t, web } from './theme';
import { AppProvider, currentDir, useApp } from './state/app';
import { handleItemShortcut } from './state/actions';
import { fileKind } from './kb/paths';
import { TitleBar } from './shell/TitleBar';
import { Sidebar } from './shell/Sidebar';
import { ProjectsScreen } from './screens/ProjectsScreen';
import { FolderScreen } from './screens/FolderScreen';
import { DocumentScreen } from './screens/DocumentScreen';
import { ChecklistScreen } from './screens/ChecklistScreen';
import { EditorScreen } from './screens/EditorScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { DialogHost } from './dialogs/Dialogs';
import { SearchPalette } from './dialogs/SearchPalette';
import { PopupMenuLayer, ToastLayer } from './ui/overlays';
import { Btn, IconWell, Kbd } from './ui/primitives';

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const app = useApp();
  useGlobalShortcuts();

  if (!app.ready) return <View style={{ flex: 1, backgroundColor: c.window }} />;

  return (
    <View style={[{ flex: 1, backgroundColor: c.window }, web({ height: '100vh', overflow: 'hidden' })]}>
      <TitleBar />
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        {app.root ? (
          <>
            {!app.prefs.sidebarCollapsed ? <Sidebar /> : null}
            <View style={{ flex: 1, minWidth: 0, position: 'relative' }}>
              <Main />
            </View>
          </>
        ) : (
          <Welcome />
        )}
      </View>
      <DialogHost />
      {app.searchOpen ? <SearchPalette /> : null}
      <PopupMenuLayer />
      <ToastLayer />
    </View>
  );
}

function Main() {
  const { route } = useApp();
  switch (route.name) {
    case 'projects':
      return <ProjectsScreen />;
    case 'folder':
      return <FolderScreen key={route.path} path={route.path} />;
    case 'file': {
      const kind = fileKind(route.path);
      if (route.edit && kind !== 'index') return <EditorScreen key={`e:${route.path}`} path={route.path} line={route.line} />;
      if (kind === 'checklist') return <ChecklistScreen key={route.path} path={route.path} />;
      return <DocumentScreen key={route.path} path={route.path} />;
    }
    case 'activity':
      return <ActivityScreen id={route.id} />;
    case 'settings':
      return <SettingsScreen section={route.section} />;
  }
}

function Welcome() {
  const app = useApp();
  return (
    <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }, web({ backgroundImage: c.bgGradient })]}>
      <View style={{ maxWidth: 520, alignItems: 'center', gap: 16 }}>
        <IconWell icon="auto_stories" tint="purple" size={56} />
        <Text style={[t(700, 34, 1.1, { letterSpacing: -1.2, textAlign: 'center' }), web({ backgroundImage: c.gradient, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' })]}>
          Lore LLM Desktop
        </Text>
        <Text style={t(400, 14.5, 1.6, { color: c.ink78, textAlign: 'center' })}>
          La knowledge base che condividi con i tuoi agenti. Scegli la cartella che la contiene: ogni sottocartella è un progetto, con il suo <Text style={{ fontFamily: font.mono }}>index.md</Text> generato e la sua{' '}
          <Text style={{ fontFamily: font.mono }}>checklist.md</Text>.
        </Text>
        <Btn variant="primary" icon="folder_open" label="Scegli la cartella della knowledge base" onPress={app.chooseRoot} style={{ marginTop: 8 }} />
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <Kbd>⌘K</Kbd>
          <Text style={t(400, 12, 1, { color: c.ink3 })}>cerca ovunque, una volta aperta</Text>
        </View>
      </View>
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
      if (!a.root) return;
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
