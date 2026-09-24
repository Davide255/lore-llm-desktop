import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { lore } from '../kb/bridge';
import type { FileContent } from '../kb/types';
import { basename, dirname, findNode, join } from '../kb/paths';
import { useApp } from '../state/app';
import { c, font, t } from '../theme';
import { Btn, Icon } from '../ui/primitives';

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

/** Resolves links inside a document to KB paths. */
export function useLinkHandler(fromPath: string) {
  const app = useApp();
  const resolve = useCallback(
    (href: string): string | null => {
      const clean = decodeURIComponent(href.replace(/^<|>$/g, '').split('#')[0]);
      if (!clean || /^[a-z]+:/i.test(clean)) return null;
      const segs = (clean.startsWith('/') ? clean.slice(1) : join(dirname(fromPath), clean)).split('/');
      const out: string[] = [];
      for (const s of segs) {
        if (s === '..') out.pop();
        else if (s && s !== '.') out.push(s);
      }
      const p = out.join('/');
      if (findNode(app.tree, p)) return p;
      // Fallback: KB-root relative (agents often write paths that way).
      if (findNode(app.tree, clean)) return clean;
      return null;
    },
    [app.tree, fromPath],
  );

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

  const onLink = useCallback(
    (href: string) => {
      if (/^https?:|^mailto:/i.test(href)) {
        window.open(href, '_blank');
        return;
      }
      const p = findNode(app.tree, href) ? href : resolve(href);
      if (!p) {
        app.toast({ icon: 'link_off', mono: href, text: 'non trovato nella knowledge base' });
        return;
      }
      const node = findNode(app.tree, p)!;
      app.navigate(node.kind === 'folder' ? { name: 'folder', path: p } : { name: 'file', path: p });
    },
    [app, resolve],
  );

  return { onLink, resolveMention };
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

/** Tracks a view's width so layouts can drop the rail on narrow windows. */
export function useWidth(initial = 1000) {
  const [w, setW] = useState(initial);
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), []);
  return { width: w, onLayout };
}

export function FileBar({ title, subtitle, children, pill }: { title: string; subtitle?: string; children?: React.ReactNode; pill?: React.ReactNode }) {
  return (
    <View style={{ height: 60, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 28, paddingRight: 20, borderBottomWidth: 1, borderColor: c.hair }}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: pill ? 'row' : 'column', alignItems: pill ? 'center' : undefined, gap: pill ? 10 : 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.mono, fontWeight: '500', fontSize: 14, lineHeight: 17, color: c.ink }}>
          {title}
        </Text>
        {subtitle ? <Text style={t(400, 11.5, 1.3, { color: c.ink3, marginTop: 3 })}>{subtitle}</Text> : null}
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

export function authorLabel(author: 'you' | 'agent') {
  return author === 'you' ? 'Tu' : 'Agente';
}
