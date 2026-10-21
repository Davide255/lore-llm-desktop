import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { lore } from '../kb/bridge';
import type { Author, FileContent } from '../kb/types';
import { basename, dirname, filePaths, findNode, join, withMd } from '../kb/paths';
import { isAttachment, parseWikiLink, resolveHref, resolveWikiTarget } from '../kb/links';
import { useApp } from '../state/app';
import { c, font, t } from '../theme';
import { Btn, Icon, useCompact } from '../ui/primitives';

/** Loads a file and re-reads it when it changes on disk. */
export function useFile(path: string) {
  const app = useApp();
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const f = await lore.read(path);
      if (my === seq.current) {
        setFile(f);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [path]);

  useEffect(() => {
    setFile(null);
    reload();
  }, [reload]);

  // Any revision bump (own write or external change) → refresh.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [app.revision, reload]);

  return { file, setFile, error, reload };
}

/** What a rendered note needs to resolve and follow its links. */
export interface LinkProps {
  onLink: (href: string) => void;
  resolveMention: (name: string) => string | null;
  resolveWiki: (inner: string) => string | null;
  resolveAsset: (href: string) => string | null;
}

/**
 * Resolves links inside a document to KB paths: markdown links (relative or
 * KB-root relative), Obsidian [[wikilinks]] and embedded attachments.
 */
export function useLinkHandler(fromPath: string): LinkProps {
  const app = useApp();
  const paths = useMemo(() => filePaths(app.tree), [app.tree]);
  const exists = useCallback((p: string) => !!findNode(app.tree, p), [app.tree]);

  const resolve = useCallback((href: string): string | null => resolveHref(href, fromPath, exists)?.path ?? null, [fromPath, exists]);

  const resolveMention = useCallback(
    (name: string) => {
      const r = resolve(name);
      if (r) return r;
      // Bare file name mentioned in prose: look in the same project.
      const project = fromPath.split('/')[0];
      const hit = findByName(app.tree, basename(name), project);
      return hit && hit !== fromPath ? hit : null;
    },
    [resolve, app.tree, fromPath],
  );

  const resolveWiki = useCallback(
    (inner: string) => {
      const w = parseWikiLink(inner);
      return w.target ? resolveWikiTarget(w.target, fromPath, paths) : fromPath;
    },
    [fromPath, paths],
  );

  // `![](img/a.png)` or a bare `a.png`, as Obsidian writes them.
  const resolveAsset = useCallback(
    (href: string) => {
      const r = resolveHref(href, fromPath, exists);
      if (r && isAttachment(r.path)) return r.path;
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
      const w = resolveWikiTarget(decodeSafe(href), fromPath, paths);
      return w && isAttachment(w) ? w : null;
    },
    [fromPath, exists, paths],
  );

  const go = useCallback(
    (p: string, heading?: string) => {
      const node = findNode(app.tree, p);
      if (!node) return;
      app.navigate(node.kind === 'folder' ? { name: 'folder', path: p } : { name: 'file', path: p, ...(heading ? { heading } : {}) });
    },
    [app],
  );

  const onLink = useCallback(
    (href: string) => {
      if (/^https?:|^mailto:/i.test(href)) {
        window.open(href, '_blank');
        return;
      }
      if (href.startsWith('[[') && href.endsWith(']]')) {
        const w = parseWikiLink(href.slice(2, -2));
        if (!w.target) {
          if (w.heading) go(fromPath, w.heading);
          return;
        }
        const p = resolveWikiTarget(w.target, fromPath, paths);
        if (p) {
          go(p, w.heading);
          return;
        }
        // Obsidian creates a missing note on click; here it's offered.
        const target = w.target.includes('/') ? withMd(w.target) : join(dirname(fromPath), withMd(w.target));
        app.toast({
          icon: 'link_off',
          mono: w.target,
          text: 'non esiste ancora',
          action: { label: 'Crea nota', run: () => app.ops.createFile(target, `# ${basename(w.target)}\n\n`) },
          ttl: 6000,
        });
        return;
      }
      if (findNode(app.tree, href)) {
        go(href);
        return;
      }
      const r = resolveHref(href, fromPath, exists);
      if (!r) {
        app.toast({ icon: 'link_off', mono: href, text: 'non trovato nella knowledge base' });
        return;
      }
      go(r.path, r.heading);
    },
    [app, go, fromPath, paths, exists],
  );

  return { onLink, resolveMention, resolveWiki, resolveAsset };
}

function decodeSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function findByName(tree: ReturnType<typeof useApp>['tree'], name: string, project: string): string | null {
  const walk = (ns: typeof tree): string | null => {
    for (const n of ns) {
      if (n.kind === 'file' && n.name === name) return n.path;
      if (n.kind === 'folder') {
        const r = walk(n.children);
        if (r) return r;
      }
    }
    return null;
  };
  const proj = tree.find((n) => n.kind === 'folder' && n.name === project);
  return proj && proj.kind === 'folder' ? walk(proj.children) : null;
}

/** Side padding of a screen's scrolling content: wide on desktop, a phone's usual margin otherwise. */
export const usePad = () => (useCompact() ? 16 : 44);

/** Tracks a view's width so layouts can drop the rail on narrow windows. */
export function useWidth(initial = 1000) {
  const [w, setW] = useState(initial);
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), []);
  return { width: w, onLayout };
}

export function FileBar({ title, subtitle, children, pill }: { title: string; subtitle?: string; children?: React.ReactNode; pill?: React.ReactNode }) {
  const compact = useCompact();
  return (
    <View style={{ height: 60, flexDirection: 'row', alignItems: 'center', gap: compact ? 4 : 8, paddingLeft: compact ? 16 : 28, paddingRight: compact ? 10 : 20, borderBottomWidth: 1, borderColor: c.hair }}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: pill ? 'row' : 'column', alignItems: pill ? 'center' : undefined, gap: pill ? 10 : 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.mono, fontWeight: '500', fontSize: 14, lineHeight: 17, color: c.ink }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={t(400, 11.5, 1.3, { color: c.ink3, marginTop: 3 })}>
            {subtitle}
          </Text>
        ) : null}
        {pill}
      </View>
      {children}
    </View>
  );
}

export function RailHeading({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3, marginBottom: 12 })}>{children}</Text>
    </View>
  );
}

export function Rail({ children }: { children: React.ReactNode }) {
  return <View style={{ width: 250, borderLeftWidth: 1, borderColor: c.hair, paddingVertical: 28, paddingHorizontal: 22 }}>{children}</View>;
}

export function EmptyState({ icon, title, body, action }: { icon: string; title: string; body?: string; action?: { label: string; icon?: string; onPress: () => void } }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
      <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: c.purple14, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color={c.purpleTint} />
      </View>
      <Text style={t(600, 17, 1.3, { letterSpacing: -0.3 })}>{title}</Text>
      {body ? <Text style={t(400, 13.5, 1.55, { color: c.ink3, textAlign: 'center', maxWidth: 420 })}>{body}</Text> : null}
      {action ? <Btn variant="primary" icon={action.icon} label={action.label} onPress={action.onPress} style={{ marginTop: 6 }} /> : null}
    </View>
  );
}

export function authorLabel(author: Author) {
  return author === 'you' ? 'Tu' : author === 'teammate' ? 'Collaboratore' : 'Agente';
}
