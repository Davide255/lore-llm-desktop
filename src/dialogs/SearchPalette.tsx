import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, type TextStyle } from 'react-native';
import { c, font, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { lore } from '../kb/bridge';
import { allFiles, basename, fileKind, projectOf, relTime } from '../kb/paths';
import type { FileNode, SearchResult } from '../kb/types';
import { FilterPill, Hover, Icon, Kbd } from '../ui/primitives';
import { DialogFrame } from '../ui/overlays';

type Item = { path: string; line?: number; snippet?: string; col?: number; extra?: number; recent?: number };

export function SearchPalette() {
  const app = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [project, setProject] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const listRef = useRef<ScrollView>(null);

  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setResults([]);
      return;
    }
    const h = setTimeout(() => lore.search(query).then(setResults), 110);
    return () => clearTimeout(h);
  }, [q]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) {
      const p = projectOf(r.path) ?? 'Radice';
      m.set(p, (m.get(p) ?? 0) + Math.max(1, r.total));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [results]);

  const items: Item[] = useMemo(() => {
    if (!q.trim()) {
      return (allFiles(app.tree) as FileNode[])
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 8)
        .map((f) => ({ path: f.path, recent: f.mtime }));
    }
    return results
      .filter((r) => !project || (projectOf(r.path) ?? 'Radice') === project)
      .map((r) => (r.hits[0] ? { path: r.path, line: r.hits[0].line, col: r.hits[0].col, snippet: r.hits[0].text, extra: r.total - 1 } : { path: r.path }));
  }, [q, results, project, app.tree]);

  useEffect(() => setActive(0), [q, project]);

  const cur = items[active];

  // Preview: load the active file's text around the hit.
  useEffect(() => {
    if (!cur) return setPreview(null);
    let live = true;
    lore
      .read(cur.path)
      .then((f) => live && setPreview(f.content))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [cur?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => app.setSearchOpen(false);
  const open = (it: Item | undefined, edit: boolean) => {
    if (!it) return;
    close();
    app.navigate({ name: 'file', path: it.path, edit: edit && fileKind(it.path) !== 'index', line: it.line });
  };

  const onKey = (e: any) => {
    const k = e.nativeEvent.key;
    if (k === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (k === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (k === 'Enter') {
      e.preventDefault();
      open(cur, e.nativeEvent.metaKey || e.nativeEvent.ctrlKey);
    }
  };

  const totalHits = results.reduce((s, r) => s + Math.max(1, r.total), 0);
  const needle = q.trim();

  return (
    <DialogFrame width={820} align="top" onDismiss={close} style={{ overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 58, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: c.hair }}>
        <Icon name="search" size={21} color={c.ink3} />
        <TextInput
          autoFocus
          value={q}
          onChangeText={setQ}
          onKeyPress={onKey}
          placeholder="Cerca in tutti i progetti…"
          placeholderTextColor={c.ink3}
          style={web<TextStyle>({ flex: 1, outlineStyle: 'none', fontFamily: font.sf, fontSize: 17, letterSpacing: -0.25, color: c.ink, caretColor: c.purpleTint })}
        />
        <Kbd>esc</Kbd>
      </View>

      {needle && counts.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: c.hair }}>
          <FilterPill label={`Tutti · ${totalHits}`} active={!project} onPress={() => setProject(null)} />
          {counts.map(([p, n]) => (
            <FilterPill key={p} label={`${p} · ${n}`} active={project === p} onPress={() => setProject(p)} />
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', height: 360 }}>
        <ScrollView ref={listRef} style={{ width: 400, flexGrow: 0, borderRightWidth: 1, borderColor: c.hair }} contentContainerStyle={{ padding: 8, gap: 2 }}>
          <Text style={t(400, 11.5, 1, { color: c.ink3, paddingVertical: 8, paddingHorizontal: 10 })}>
            {needle ? (items.length ? `${totalHits} risultati in ${results.length} file` : 'Nessun risultato') : 'Aperti di recente'}
          </Text>
          {items.map((it, i) => {
            const on = i === active;
            const kind = fileKind(it.path);
            return (
              <Hover
                key={it.path}
                onPress={() => open(it, false)}
                onHoverIn={() => setActive(i)}
                style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, gap: 6, backgroundColor: on ? c.purple14 : 'transparent' }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name={kind === 'index' ? 'auto_awesome' : kind === 'checklist' ? 'checklist' : 'description'} size={16} color={kind === 'index' ? c.info : kind === 'checklist' ? c.purpleTint : c.ink3} />
                  <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12.5, fontWeight: '500', color: c.ink, flexShrink: 1 }}>
                    {basename(it.path)}
                  </Text>
                  <Text numberOfLines={1} style={[t(400, 11, 1, { color: c.ink3 }), { flexShrink: 1 }]}>
                    · {projectOf(it.path) ?? 'Radice'}
                  </Text>
                  <View style={{ flex: 1 }} />
                  {on ? <Kbd>⏎</Kbd> : it.recent ? <Text style={t(400, 11, 1, { color: c.ink3 })}>{relTime(it.recent)}</Text> : null}
                </View>
                {it.snippet != null ? (
                  <Text numberOfLines={2} style={t(400, 12.5, 1.5, { color: c.ink2 })}>
                    <Marked text={snippetAround(it.snippet, needle)} needle={needle} />
                  </Text>
                ) : null}
                {it.extra ? <Text style={t(400, 11, 1, { color: c.ink3 })}>+{it.extra} {it.extra === 1 ? 'occorrenza' : 'occorrenze'}</Text> : null}
              </Hover>
            );
          })}
        </ScrollView>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 20, paddingHorizontal: 26 }}>
          {cur && preview != null ? <Preview path={cur.path} content={preview} line={cur.line} needle={needle} /> : null}
        </ScrollView>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 11, paddingHorizontal: 20, borderTopWidth: 1, borderColor: c.hair }}>
        <Hint k="↑↓" label="naviga" />
        <Hint k="⏎" label="apri" />
        <Hint k="⌘⏎" label="modifica" />
        <View style={{ flex: 1 }} />
        <Hint k="⌘K" label="apri la ricerca ovunque" />
      </View>
    </DialogFrame>
  );
}

function Hint({ k, label }: { k: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Kbd>{k}</Kbd>
      <Text style={t(400, 11.5, 1, { color: c.ink3 })}>{label}</Text>
    </View>
  );
}

/** Markdown syntax stripped for display in results and previews. */
const plainMd = (l: string) =>
  l
    .replace(/^#{1,6}\s+/, '')
    .replace(/^(\s*)[-*+] (\[[ xX]\] )?/, '$1• ')
    .replace(/^>\s?/, '')
    .replace(/\*\*|__|==|`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

function snippetAround(raw: string, needle: string) {
  const s = plainMd(raw).trim();
  const at = Math.max(0, s.toLowerCase().indexOf(needle.toLowerCase()));
  if (at < 60) return s.length > 140 ? s.slice(0, 140) + '…' : s;
  return '…' + s.slice(at - 40, at + needle.length + 90) + (s.length > at + needle.length + 90 ? '…' : '');
}

function Marked({ text, needle, style }: { text: string; needle: string; style?: TextStyle }) {
  if (!needle) return <Text style={style}>{text}</Text>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const j = lower.indexOf(n, i);
    if (j === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (j > i) parts.push(text.slice(i, j));
    parts.push(
      <Text key={k++} style={{ backgroundColor: c.purple28, color: c.ink, borderRadius: 4, paddingHorizontal: 3 }}>
        {text.slice(j, j + needle.length)}
      </Text>,
    );
    i = j + needle.length;
  }
  return <Text style={style}>{parts}</Text>;
}

/** Lines around the hit, with the nearest heading above as context. */
function Preview({ path, content, line, needle }: { path: string; content: string; line?: number; needle: string }) {
  const lines = content.split(/\r?\n/);
  const hit = (line ?? 1) - 1;
  let headingIdx = -1;
  for (let i = hit; i >= 0; i--) if (/^#{1,6}\s/.test(lines[i])) {
    headingIdx = i;
    break;
  }
  const from = Math.max(headingIdx + 1, hit - 4);
  const to = Math.min(lines.length, hit + 8);
  const clean = plainMd;
  return (
    <View>
      <Text style={t(400, 11.5, 1, { color: c.ink3, marginBottom: 14 })}>
        <Text style={{ fontFamily: font.mono }}>{basename(path)}</Text>
        {line ? ` · riga ${line}` : ''}
      </Text>
      {headingIdx >= 0 ? <Text style={t(600, 15, 1.3, { marginBottom: 10 })}>{clean(lines[headingIdx])}</Text> : null}
      {lines.slice(from, to).map((l, i) => {
        const idx = from + i;
        const isHit = line != null && idx === hit;
        const isHeading = /^#{1,6}\s/.test(l);
        if (!l.trim()) return <View key={idx} style={{ height: 8 }} />;
        return (
          <View key={idx} style={isHit ? { paddingVertical: 4, paddingHorizontal: 8, marginVertical: 2, marginHorizontal: -8, borderRadius: 6, backgroundColor: c.fill05 } : null}>
            <Marked
              text={clean(l)}
              needle={needle}
              style={isHeading ? t(600, 15, 1.3, { color: c.ink2, marginTop: 16, marginBottom: 10 }) : t(400, 13.5, 1.65, { color: isHit ? c.ink : c.ink3 })}
            />
          </View>
        );
      })}
    </View>
  );
}
