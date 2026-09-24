import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, type TextStyle } from 'react-native';
import { diffLines } from 'diff';
import { c, font, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { basename, fileKind, wordCount } from '../kb/paths';
import { Btn, Hover, Icon, IconBtn, Pill, Segmented, Toggle, VSep } from '../ui/primitives';
import { Markdown } from '../ui/Markdown';
import { useOverlayKeys } from '../ui/overlays';
import { EmptyState, useFile, useLinkHandler } from './common';

type View3 = 'preview' | 'split' | 'source';
type Sel = { start: number; end: number };
type Snap = { text: string; sel: Sel };

const LINE_H = 25; // 13px × 1.95, as in the design
const GUTTER = 52;
const MONO: TextStyle = { fontFamily: font.mono, fontSize: 13, lineHeight: LINE_H };

export function EditorScreen({ path, line: initialLine }: { path: string; line?: number }) {
  const app = useApp();
  const { file, error } = useFile(path);
  const [text, setText] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>({ start: 0, end: 0 });
  const [conflict, setConflict] = useState<string | null>(null);
  const [view, setView] = useState<View3>(app.prefs.editorView ?? 'split');
  const syncScroll = app.prefs.syncScroll ?? true;
  const inputRef = useRef<any>(null);
  const undoStack = useRef<Snap[]>([]);
  const redoStack = useRef<Snap[]>([]);
  const lastPush = useRef(0);
  const textRef = useRef<string | null>(null);
  const baselineRef = useRef<string | null>(null);
  textRef.current = text;
  baselineRef.current = baseline;

  // Load / external changes
  useEffect(() => {
    if (!file) return;
    if (textRef.current == null) {
      setText(file.content);
      setBaseline(file.content);
      if (initialLine) {
        const pos = offsetOfLine(file.content, initialLine - 1);
        setSel({ start: pos, end: pos });
        requestAnimationFrame(() => applySel({ start: pos, end: pos }));
      }
      return;
    }
    if (file.content === baselineRef.current) return;
    if (textRef.current === baselineRef.current) {
      // Clean buffer: follow the agent's edit silently.
      setText(file.content);
      setBaseline(file.content);
    } else setConflict(file.content);
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = text != null && baseline != null && text !== baseline;

  const save = useCallback(async () => {
    const cur = textRef.current;
    if (cur == null) return;
    setBaseline(cur);
    baselineRef.current = cur;
    setConflict(null);
    await app.ops.write(path, cur);
  }, [app.ops, path]);

  // Expose to the navigation guard.
  useEffect(() => {
    app.editorRef.current = {
      path,
      dirty: () => textRef.current != null && textRef.current !== baselineRef.current,
      changedLines: () => {
        let n = 0;
        for (const part of diffLines(baselineRef.current ?? '', textRef.current ?? '')) if (part.added || part.removed) n += part.count ?? 0;
        return n;
      },
      save,
    };
    return () => {
      if (app.editorRef.current?.path === path) app.editorRef.current = null;
    };
  }, [app.editorRef, path, save]);

  // ------------------------------------------------------------- editing
  const applySel = (s: Sel) => {
    const el = inputRef.current as HTMLTextAreaElement | null;
    if (el?.setSelectionRange) {
      el.focus();
      el.setSelectionRange(s.start, s.end);
    }
  };

  const change = useCallback((next: string, nextSel?: Sel, group = false) => {
    const cur = textRef.current ?? '';
    const now = Date.now();
    if (!group || now - lastPush.current > 700) {
      undoStack.current.push({ text: cur, sel });
      if (undoStack.current.length > 300) undoStack.current.shift();
    }
    lastPush.current = now;
    redoStack.current = [];
    setText(next);
    if (nextSel) {
      setSel(nextSel);
      requestAnimationFrame(() => applySel(nextSel));
    }
  }, [sel]);

  const undo = () => {
    const s = undoStack.current.pop();
    if (!s) return;
    redoStack.current.push({ text: textRef.current ?? '', sel });
    setText(s.text);
    setSel(s.sel);
    requestAnimationFrame(() => applySel(s.sel));
  };
  const redo = () => {
    const s = redoStack.current.pop();
    if (!s) return;
    undoStack.current.push({ text: textRef.current ?? '', sel });
    setText(s.text);
    setSel(s.sel);
    requestAnimationFrame(() => applySel(s.sel));
  };

  const cmd = (fn: (src: string, s: Sel) => { text: string; sel: Sel }) => {
    if (text == null) return;
    const r = fn(text, sel);
    change(r.text, r.sel);
  };

  const close = () => app.navigate({ name: 'file', path });

  useOverlayKeys((e) => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 's') return save(), true;
    if (mod && k === 'z' && !e.shiftKey) return undo(), true;
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) return redo(), true;
    if (mod && k === 'b') return cmd(wrap('**', '**', 'testo')), true;
    if (mod && k === 'i') return cmd(wrap('_', '_', 'testo')), true;
    if (mod && k === 'k' && e.shiftKey) return cmd(link), true;
    if (e.key === 'Escape' && !app.dialog && !app.searchOpen && !app.menu) return close(), true;
  });

  const onKeyPress = (e: any) => {
    const ne = e.nativeEvent as KeyboardEvent;
    if (text == null) return;
    if (ne.key === 'Tab') {
      e.preventDefault();
      cmd(ne.shiftKey ? outdent : indent);
    } else if (ne.key === 'Enter' && !ne.shiftKey && !ne.metaKey && !ne.ctrlKey) {
      const r = continueList(text, sel);
      if (r) {
        e.preventDefault();
        change(r.text, r.sel);
      }
    }
  };

  // ------------------------------------------------------------- derived
  const src = text ?? '';
  const lines = useMemo(() => src.split('\n'), [src]);
  const caretLine = useMemo(() => countNl(src.slice(0, sel.start)), [src, sel.start]);
  const caretCol = sel.start - (src.lastIndexOf('\n', sel.start - 1) + 1) + 1;

  // Scroll sync + caret follow
  const srcScroll = useRef<ScrollView>(null);
  const prevScroll = useRef<ScrollView>(null);
  const srcMetrics = useRef({ view: 1, content: 1 });
  const prevMetrics = useRef({ view: 1, content: 1 });
  const srcY = useRef(0);
  const rowY = useRef<number[]>([]);

  const onSrcScroll = (e: any) => {
    srcY.current = e.nativeEvent.contentOffset.y;
    if (!syncScroll || view !== 'split') return;
    const s = srcMetrics.current;
    const ratio = s.content > s.view ? srcY.current / (s.content - s.view) : 0;
    const p = prevMetrics.current;
    prevScroll.current?.scrollTo({ y: ratio * Math.max(0, p.content - p.view), animated: false });
  };

  useEffect(() => {
    const y = rowY.current[caretLine];
    if (y == null) return;
    const top = y + 20;
    const vh = srcMetrics.current.view;
    if (top < srcY.current + 10) srcScroll.current?.scrollTo({ y: Math.max(0, top - 40), animated: false });
    else if (top + LINE_H > srcY.current + vh - 10) srcScroll.current?.scrollTo({ y: top + LINE_H - vh + 40, animated: false });
  }, [caretLine, text]);

  const { onLink, resolveMention } = useLinkHandler(path);

  if (fileKind(path) === 'index') {
    return <EmptyState icon="lock" title="index.md è in sola lettura" body="Viene compilato automaticamente dagli agenti: modifica i file sorgente e verrà rigenerato." action={{ label: 'Apri in lettura', onPress: close }} />;
  }
  if (error) return <EmptyState icon="error" title="Impossibile aprire il file" body={error} />;
  if (text == null) return <View style={{ flex: 1 }} />;

  const setViewPersist = (v: View3) => {
    setView(v);
    app.setPrefs({ editorView: v });
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Bar */}
      <View style={{ height: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 28, paddingRight: 20, borderBottomWidth: 1, borderColor: c.hair }}>
        <Text numberOfLines={1} style={{ fontFamily: font.mono, fontWeight: '500', fontSize: 14, color: c.ink, flexShrink: 1 }}>
          {basename(path)}
        </Text>
        {dirty ? <Pill label="Non salvato" bg={c.warning14} fg={c.warning} style={{ alignSelf: 'center' }} /> : <Pill label="Salvato" bg={c.success16} fg={c.success} style={{ alignSelf: 'center' }} />}
        <View style={{ flex: 1 }} />
        <Segmented
          width={300}
          value={view}
          onChange={setViewPersist}
          options={[
            { value: 'preview', label: 'Anteprima' },
            { value: 'split', label: 'Affiancato' },
            { value: 'source', label: 'Sorgente' },
          ]}
        />
        <View style={{ width: 6 }} />
        <Btn variant="plain" label={dirty ? 'Annulla' : 'Chiudi'} onPress={close} />
        <Btn variant="primary" label="Salva" kbd="⌘S" onPress={save} disabled={!dirty} />
      </View>

      {conflict != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 20, backgroundColor: c.warning14, borderBottomWidth: 1, borderColor: c.hair }}>
          <Icon name="sync_problem" size={18} color={c.warning} />
          <Text style={[t(400, 13, 1.4, { color: c.ink }), { flex: 1 }]}>Un agente ha modificato questo file mentre lo stavi modificando.</Text>
          <Btn
            height={30}
            label="Carica la loro versione"
            onPress={() => {
              change(conflict);
              setBaseline(conflict);
              setConflict(null);
            }}
          />
          <Btn height={30} variant="tint" label="Tieni la mia" onPress={() => {
            setBaseline(conflict);
            baselineRef.current = conflict;
            setConflict(null);
          }} />
        </View>
      ) : null}

      {/* Toolbar */}
      {view !== 'preview' ? (
        <View style={{ height: 42, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 20, borderBottomWidth: 1, borderColor: c.hair }}>
          <Tool icon="format_bold" title="Grassetto (⌘B)" onPress={() => cmd(wrap('**', '**', 'testo'))} />
          <Tool icon="format_italic" title="Corsivo (⌘I)" onPress={() => cmd(wrap('_', '_', 'testo'))} />
          <Tool icon="format_h1" title="Titolo 1" onPress={() => cmd(linePrefix('# ', /^#{1,6} /))} />
          <Tool icon="format_h2" title="Titolo 2" onPress={() => cmd(linePrefix('## ', /^#{1,6} /))} />
          <VSep />
          <Tool icon="format_list_bulleted" title="Elenco puntato" onPress={() => cmd(linePrefix('- ', /^([-*+] (\[[ xX]\] )?|\d+\. )/))} />
          <Tool icon="format_list_numbered" title="Elenco numerato" onPress={() => cmd(numbered)} />
          <Tool icon="checklist" title="Casella di controllo" onPress={() => cmd(linePrefix('- [ ] ', /^([-*+] (\[[ xX]\] )?|\d+\. )/))} />
          <Tool icon="format_quote" title="Citazione" onPress={() => cmd(linePrefix('> ', /^> /))} />
          <VSep />
          <Tool icon="link" title="Link (⇧⌘K)" onPress={() => cmd(link)} />
          <Tool icon="code" title="Codice" onPress={() => cmd(code)} />
          <Tool icon="table" title="Tabella" onPress={() => cmd(table)} />
          <View style={{ flex: 1 }} />
          <Tool icon="undo" title="Annulla (⌘Z)" onPress={undo} disabled={!undoStack.current.length} />
          <Tool icon="redo" title="Ripeti (⇧⌘Z)" onPress={redo} disabled={!redoStack.current.length} />
        </View>
      ) : null}

      {/* Panes */}
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        {view !== 'preview' ? (
          <ScrollView
            ref={srcScroll}
            style={[{ flex: 1 }, view === 'split' && { borderRightWidth: 1, borderColor: c.hair }]}
            contentContainerStyle={{ paddingVertical: 20 }}
            onScroll={onSrcScroll}
            scrollEventThrottle={16}
            onLayout={(e) => (srcMetrics.current.view = e.nativeEvent.layout.height)}
            onContentSizeChange={(_w, h) => (srcMetrics.current.content = h)}
          >
            <View style={{ position: 'relative' }}>
              <HighlightLines lines={lines} activeLine={caretLine} rowY={rowY} />
              <TextInput
                ref={inputRef}
                multiline
                value={text}
                autoFocus
                spellCheck={false}
                onChangeText={(v) => change(v, undefined, true)}
                onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
                onKeyPress={onKeyPress}
                style={web<TextStyle>({
                  ...MONO,
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: GUTTER,
                  right: 24,
                  padding: 0,
                  margin: 0,
                  borderWidth: 0,
                  outlineStyle: 'none',
                  resize: 'none',
                  overflow: 'hidden',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  tabSize: 4,
                  color: 'transparent',
                  caretColor: c.purpleTint,
                  backgroundColor: 'transparent',
                })}
              />
            </View>
          </ScrollView>
        ) : null}

        {view !== 'source' ? (
          <ScrollView
            ref={prevScroll}
            style={{ flex: 1 }}
            contentContainerStyle={view === 'preview' ? { paddingHorizontal: 48 } : { paddingVertical: 24, paddingHorizontal: 44 }}
            onLayout={(e) => (prevMetrics.current.view = e.nativeEvent.layout.height)}
            onContentSizeChange={(_w, h) => (prevMetrics.current.content = h)}
          >
            <View style={view === 'preview' ? { width: '100%', maxWidth: 680, alignSelf: 'center', paddingVertical: 40 } : null}>
              {text.trim() ? (
                <Markdown source={text} compact={view === 'split'} activeLine={view === 'split' ? caretLine : undefined} onLink={onLink} resolveMention={resolveMention} />
              ) : (
                <Text style={t(400, 14, 1.5, { color: c.ink3 })}>L’anteprima apparirà qui.</Text>
              )}
            </View>
          </ScrollView>
        ) : null}
      </View>

      {/* Status */}
      <View style={{ height: 30, flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 20, borderTopWidth: 1, borderColor: c.hair }}>
        <Text style={status}>
          Riga {caretLine + 1}, col {caretCol}
        </Text>
        <Text style={status}>Markdown</Text>
        <Text style={status}>{wordCount(text)} parole</Text>
        <View style={{ flex: 1 }} />
        {view === 'split' ? (
          <>
            <Text style={status}>Scorrimento sincronizzato</Text>
            <View style={{ transform: [{ scale: 0.8 }] }}>
              <Toggle value={syncScroll} onChange={(v) => app.setPrefs({ syncScroll: v })} />
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

const status = t(400, 11.5, 1, { color: c.ink3 });

function Tool({ icon, title, onPress, disabled }: { icon: string; title: string; onPress: () => void; disabled?: boolean }) {
  return <IconBtn icon={icon} title={title} onPress={onPress} size={{ w: 32, h: 30 }} iconSize={18} disabled={disabled} />;
}

// ---------------------------------------------------------------------------
// Source highlighting (rendered under a transparent textarea)
// ---------------------------------------------------------------------------
const HighlightLines = memo(function HighlightLines({ lines, activeLine, rowY }: { lines: string[]; activeLine: number; rowY: React.MutableRefObject<number[]> }) {
  let inFence = false;
  return (
    <View>
      {lines.map((l, i) => {
        const fence = /^\s*```/.test(l);
        const code = inFence || fence;
        if (fence) inFence = !inFence;
        const on = i === activeLine;
        return (
          <View
            key={i}
            onLayout={(e) => (rowY.current[i] = e.nativeEvent.layout.y)}
            style={{ flexDirection: 'row', backgroundColor: on ? c.purple12 : 'transparent' }}
          >
            <Text style={[MONO, web({ width: GUTTER, paddingRight: 18, textAlign: 'right', color: on ? c.purpleTint : c.ink4, userSelect: 'none', flexShrink: 0 })]}>{i + 1}</Text>
            <Text style={[MONO, web({ flex: 1, marginRight: 24, color: c.ink2, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', tabSize: 4 })]}>{code ? <Text style={{ color: fence ? c.ink3 : c.info }}>{l || ' '}</Text> : <LineSyntax line={l} />}</Text>
          </View>
        );
      })}
    </View>
  );
});

function LineSyntax({ line }: { line: string }) {
  if (!line) return <Text> </Text>;
  const h = /^(#{1,6} )(.*)$/.exec(line);
  if (h)
    return (
      <>
        <Text style={{ color: c.purpleTint, fontWeight: '700' }}>{h[1]}</Text>
        <Text style={{ color: c.ink, fontWeight: h[1].length === 2 ? '700' : '600' }}>{h[2]}</Text>
      </>
    );
  const li = /^([ \t]*)([-*+] |\d+[.)] )(\[[ xX]\] )?(.*)$/.exec(line);
  if (li)
    return (
      <>
        {li[1]}
        <Text style={{ color: c.blueTint }}>{li[2]}</Text>
        {li[3] ? <Text style={{ color: c.purpleTint }}>{li[3]}</Text> : null}
        <InlineSyntax s={li[4]} />
      </>
    );
  const q = /^(>\s?)(.*)$/.exec(line);
  if (q)
    return (
      <>
        <Text style={{ color: c.ink3 }}>{q[1]}</Text>
        <InlineSyntax s={q[2]} />
      </>
    );
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*\|/.test(line)) return <Text style={{ color: c.ink3 }}>{line}</Text>;
  return <InlineSyntax s={line} />;
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|==[^=]+==|\[[^\]]*\]\([^)]*\))/g;
function InlineSyntax({ s }: { s: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of s.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    const style: TextStyle =
      tok.startsWith('**') ? { color: c.ink } : tok.startsWith('`') ? { color: c.info } : tok.startsWith('==') ? { color: c.ink, backgroundColor: c.purple28 } : { color: c.blueTint };
    out.push(
      <Text key={k++} style={style}>
        {tok}
      </Text>,
    );
    last = m.index! + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return <>{out}</>;
}

// ---------------------------------------------------------------------------
// Text commands
// ---------------------------------------------------------------------------
const countNl = (s: string) => {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
};

function offsetOfLine(src: string, line: number) {
  let pos = 0;
  for (let i = 0; i < line; i++) {
    const nx = src.indexOf('\n', pos);
    if (nx === -1) return src.length;
    pos = nx + 1;
  }
  return pos;
}

function lineRange(src: string, s: Sel) {
  const start = src.lastIndexOf('\n', s.start - 1) + 1;
  let end = src.indexOf('\n', s.end > s.start && src[s.end - 1] === '\n' ? s.end - 1 : s.end);
  if (end === -1) end = src.length;
  return { start, end };
}

const wrap = (before: string, after: string, placeholder: string) => (src: string, s: Sel) => {
  const selected = src.slice(s.start, s.end);
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    return { text: src.slice(0, s.start) + inner + src.slice(s.end), sel: { start: s.start, end: s.start + inner.length } };
  }
  const body = selected || placeholder;
  const text = src.slice(0, s.start) + before + body + after + src.slice(s.end);
  return { text, sel: { start: s.start + before.length, end: s.start + before.length + body.length } };
};

/** Toggle a prefix on every selected line, replacing any matching prefix. */
const linePrefix = (prefix: string, existing: RegExp) => (src: string, s: Sel) => {
  const r = lineRange(src, s);
  const block = src.slice(r.start, r.end).split('\n');
  const all = block.every((l) => l.replace(/^[ \t]*/, '').startsWith(prefix));
  const out = block.map((l) => {
    const ws = /^[ \t]*/.exec(l)![0];
    const rest = l.slice(ws.length);
    if (all) return ws + rest.slice(prefix.length);
    return ws + prefix + rest.replace(existing, '');
  });
  const joined = out.join('\n');
  const text = src.slice(0, r.start) + joined + src.slice(r.end);
  const caret = r.start + joined.length;
  return { text, sel: block.length === 1 ? { start: caret, end: caret } : { start: r.start, end: caret } };
};

const numbered = (src: string, s: Sel) => {
  const r = lineRange(src, s);
  const block = src.slice(r.start, r.end).split('\n');
  const all = block.every((l) => /^\s*\d+\. /.test(l));
  const out = block.map((l, i) => {
    const ws = /^[ \t]*/.exec(l)![0];
    const rest = l.slice(ws.length).replace(/^([-*+] (\[[ xX]\] )?|\d+\. )/, '');
    return all ? ws + rest : `${ws}${i + 1}. ${rest}`;
  });
  const joined = out.join('\n');
  return { text: src.slice(0, r.start) + joined + src.slice(r.end), sel: { start: r.start + joined.length, end: r.start + joined.length } };
};

const link = (src: string, s: Sel) => {
  const label = src.slice(s.start, s.end) || 'testo';
  const ins = `[${label}](url)`;
  const text = src.slice(0, s.start) + ins + src.slice(s.end);
  const urlStart = s.start + label.length + 3;
  return { text, sel: { start: urlStart, end: urlStart + 3 } };
};

const code = (src: string, s: Sel) => {
  const selected = src.slice(s.start, s.end);
  if (selected.includes('\n') || (!selected && lineRange(src, s).start === lineRange(src, s).end)) {
    const body = selected || '';
    const ins = '```\n' + body + (body.endsWith('\n') || !body ? '' : '\n') + '```';
    const text = src.slice(0, s.start) + ins + src.slice(s.end);
    const caret = s.start + 4;
    return { text, sel: { start: caret, end: caret + body.length } };
  }
  return wrap('`', '`', 'codice')(src, s);
};

const table = (src: string, s: Sel) => {
  const r = lineRange(src, s);
  const tpl = '| Colonna | Colonna |\n| --- | --- |\n|  |  |';
  const lead = src.slice(r.start, r.end).trim() ? '\n\n' : '';
  const at = src.slice(r.start, r.end).trim() ? r.end : r.start;
  const text = src.slice(0, at) + lead + tpl + src.slice(at);
  const caret = at + lead.length + 2;
  return { text, sel: { start: caret, end: caret + 7 } };
};

const indent = (src: string, s: Sel) => {
  if (s.start === s.end) {
    const text = src.slice(0, s.start) + '\t' + src.slice(s.end);
    return { text, sel: { start: s.start + 1, end: s.start + 1 } };
  }
  const r = lineRange(src, s);
  const block = src
    .slice(r.start, r.end)
    .split('\n')
    .map((l) => '\t' + l)
    .join('\n');
  return { text: src.slice(0, r.start) + block + src.slice(r.end), sel: { start: r.start, end: r.start + block.length } };
};

const outdent = (src: string, s: Sel) => {
  const r = lineRange(src, s);
  let removedFirst = 0;
  const block = src
    .slice(r.start, r.end)
    .split('\n')
    .map((l, i) => {
      const m = /^(\t| {1,4})/.exec(l);
      if (i === 0) removedFirst = m ? m[0].length : 0;
      return m ? l.slice(m[0].length) : l;
    })
    .join('\n');
  const text = src.slice(0, r.start) + block + src.slice(r.end);
  if (s.start === s.end) {
    const p = Math.max(r.start, s.start - removedFirst);
    return { text, sel: { start: p, end: p } };
  }
  return { text, sel: { start: r.start, end: r.start + block.length } };
};

/** Enter inside a list item continues the list; on an empty item ends it. */
function continueList(src: string, s: Sel) {
  if (s.start !== s.end) return null;
  const ls = src.lastIndexOf('\n', s.start - 1) + 1;
  const line = src.slice(ls, s.start);
  const m = /^([ \t]*)([-*+] (\[[ xX]\] )?|(\d+)([.)]) )(.*)$/.exec(line);
  if (!m) return null;
  const [, ws, marker, task, num, dot, rest] = m;
  if (!rest.trim() && s.start === (src.indexOf('\n', s.start) === -1 ? src.length : src.indexOf('\n', s.start))) {
    // Empty item: drop the marker.
    const text = src.slice(0, ls) + src.slice(s.start);
    return { text, sel: { start: ls, end: ls } };
  }
  const next = num ? `${Number(num) + 1}${dot} ` : task ? marker.replace(/\[[xX]\]/, '[ ]') : marker;
  const ins = '\n' + ws + next;
  const text = src.slice(0, s.start) + ins + src.slice(s.end);
  const p = s.start + ins.length;
  return { text, sel: { start: p, end: p } };
}
