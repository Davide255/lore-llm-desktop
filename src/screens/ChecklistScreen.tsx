import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, type TextStyle } from 'react-native';
import { c, font, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { addItem, addSection, deleteItem, parseChecklist, setItemText, toggleItem, type Checklist, type ChecklistItem } from '../kb/checklist';
import { relTime } from '../kb/paths';
import { Btn, Hover, Icon, Progress } from '../ui/primitives';
import { InlineMarkdown } from '../ui/Markdown';
import { EmptyState, FileBar, Rail, RailHeading, useFile, useLinkHandler, useWidth } from './common';

type Draft = { kind: 'add'; section: number; parent?: ChecklistItem } | { kind: 'edit'; item: ChecklistItem } | { kind: 'section' };

export function ChecklistScreen({ path }: { path: string }) {
  const app = useApp();
  const { file, error } = useFile(path);
  const { onLink, resolveMention } = useLinkHandler(path);
  const [content, setContent] = useState<string | null>(null);
  const latest = useRef<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const { width, onLayout } = useWidth();

  useEffect(() => {
    if (file) {
      setContent(file.content);
      latest.current = file.content;
    }
  }, [file]);

  const list = useMemo<Checklist | null>(() => (content != null ? parseChecklist(content) : null), [content]);

  if (error) return <EmptyState icon="error" title="Impossibile aprire la checklist" body={error} />;
  if (!file || content == null || !list) return <View style={{ flex: 1 }} />;

  const commit = (next: string, undoLabel?: string) => {
    const prev = latest.current!;
    latest.current = next;
    setContent(next);
    app.ops.write(path, next);
    if (undoLabel) {
      app.toast({
        icon: 'undo',
        text: undoLabel,
        ttl: 6000,
        action: {
          label: 'Annulla',
          run: () => {
            latest.current = prev;
            setContent(prev);
            app.ops.write(path, prev);
          },
        },
      });
    }
  };

  const pct = list.total ? list.done / list.total : 0;
  // Parent of an in-progress sub-item, re-resolved so its range tracks new children.
  const liveParent =
    draft?.kind === 'add' && draft.parent ? list.sections[draft.section]?.items.find((i) => i.line === draft.parent!.line) : undefined;
  const showRail = width > 980;

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <FileBar title="checklist.md" subtitle={`${list.done} di ${list.total} completate · ${relTime(file.mtime)}`}>
        {list.total ? (
          <View style={{ width: 160, flexDirection: 'row', marginRight: 6 }}>
            <Progress value={pct} height={5} />
          </View>
        ) : null}
        <Btn variant="tint" icon="edit" label="Modifica" kbd="E" onPress={() => app.navigate({ name: 'file', path, edit: true })} />
      </FileBar>

      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 48 }}>
          <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', paddingTop: 40, paddingBottom: 80 }}>
            {list.sections.map((sec, si) => (
              <View key={`${si}-${sec.line}`} style={{ marginBottom: 8 }}>
                {sec.title != null ? (
                  <Text style={t(600, sec.level <= 2 ? 19 : 16, 1.3, { letterSpacing: -0.38, marginTop: si === 0 ? 0 : 28, marginBottom: 10 })}>
                    <InlineMarkdown text={sec.title} onLink={onLink} resolveMention={resolveMention} />
                  </Text>
                ) : null}
                <View style={{ gap: 4, marginHorizontal: -8 }}>
                  {sec.items.map((item) => (
                    <React.Fragment key={item.line}>
                      {draft?.kind === 'edit' && draft.item.line === item.line ? (
                        <ItemInput
                          depth={item.depth}
                          initial={item.text}
                          onCancel={() => setDraft(null)}
                          onSubmit={(text) => {
                            setDraft(null);
                            if (text.trim() && text !== item.text) commit(setItemText(latest.current!, item.line, text.trim()));
                          }}
                        />
                      ) : (
                        <ItemRow
                          item={item}
                          onToggle={() => commit(toggleItem(latest.current!, item.line))}
                          onEdit={() => setDraft({ kind: 'edit', item })}
                          onAddChild={() => setDraft({ kind: 'add', section: si, parent: item })}
                          onDelete={() => commit(deleteItem(latest.current!, item), item.childCount ? `Voce e ${item.childCount} sotto-voci eliminate` : 'Voce eliminata')}
                          onLink={onLink}
                          resolveMention={resolveMention}
                        />
                      )}
                      {liveParent && liveParent.section === si && liveParent.endLine === item.line ? (
                        <AddInput depth={liveParent.depth + 1} draft={draft as Extract<Draft, { kind: 'add' }>} commit={commit} latest={latest} close={() => setDraft(null)} />
                      ) : null}
                    </React.Fragment>
                  ))}
                  {sec.notes.length ? (
                    <View style={{ paddingHorizontal: 8, gap: 4, marginTop: sec.items.length ? 6 : 0 }}>
                      {sec.notes.map((n) => (
                        <Text key={n.line} style={t(400, 13.5, 1.55, { color: c.ink3 })}>
                          <InlineMarkdown text={n.text} onLink={onLink} resolveMention={resolveMention} />
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {draft?.kind === 'add' && !draft.parent && draft.section === si ? (
                    <AddInput depth={0} draft={draft} commit={commit} latest={latest} close={() => setDraft(null)} />
                  ) : (
                    <Hover
                      onPress={() => setDraft({ kind: 'add', section: si })}
                      style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 5, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: hovered ? c.fill04 : 'transparent', alignSelf: 'flex-start' })}
                    >
                      <Icon name="add" size={19} color={c.ink3} />
                      <Text style={t(400, 13.5, 1.45, { color: c.ink3 })}>Aggiungi voce</Text>
                    </Hover>
                  )}
                </View>
              </View>
            ))}

            {draft?.kind === 'section' ? (
              <View style={{ marginTop: 24 }}>
                <SimpleInput
                  placeholder="Nome della sezione"
                  big
                  onCancel={() => setDraft(null)}
                  onSubmit={(title) => {
                    setDraft(null);
                    if (title.trim()) commit(addSection(latest.current!, title.trim()));
                  }}
                />
              </View>
            ) : (
              <Hover
                onPress={() => setDraft({ kind: 'section' })}
                style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: hovered ? c.purple40 : c.hair, alignSelf: 'flex-start' })}
              >
                <Icon name="playlist_add" size={18} color={c.ink3} />
                <Text style={t(500, 13, 1, { color: c.ink3 })}>Nuova sezione</Text>
              </Hover>
            )}
          </View>
        </ScrollView>

        {showRail ? (
          <Rail>
            <RailHeading>Sezioni</RailHeading>
            {list.sections
              .filter((s) => s.total)
              .map((s, i) => (
                <View key={i} style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: 'row', marginBottom: 7 }}>
                    <Text numberOfLines={1} style={[t(400, 12.5, 1, { color: c.ink2 }), { flex: 1 }]}>
                      {(s.title ?? 'Senza titolo').replace(/==|\*\*/g, '')}
                    </Text>
                    <Text style={t(400, 12.5, 1, { color: c.ink3 })}>
                      {s.done}/{s.total}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row' }}>
                    <Progress value={s.done / s.total} height={3} />
                  </View>
                </View>
              ))}
            {!list.total ? <Text style={t(400, 12.5, 1.5, { color: c.ink3 })}>Ancora nessuna voce.</Text> : null}
          </Rail>
        ) : null}
      </View>
    </View>
  );
}

function ItemRow({
  item,
  onToggle,
  onEdit,
  onAddChild,
  onDelete,
  onLink,
  resolveMention,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  onLink: (h: string) => void;
  resolveMention: (n: string) => string | null;
}) {
  const top = item.depth === 0;
  return (
    <Hover
      onPress={onToggle}
      onDoubleClick={onEdit}
      style={({ hovered }) => ({ flexDirection: 'row', gap: 11, alignItems: 'center', marginLeft: item.depth * 32, paddingVertical: 5, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: hovered ? c.fill05 : 'transparent' })}
    >
      {({ hovered }) => (
        <>
          <Icon
            name={item.checked ? 'check_circle' : 'radio_button_unchecked'}
            filled={item.checked}
            size={top ? 21 : 19}
            color={item.checked || hovered ? c.purpleTint : c.ink3}
          />
          <Text
            style={[
              t(400, top ? 15.5 : 14.5, 1.45, { color: item.checked ? c.ink3 : c.ink }),
              { flex: 1 },
              item.checked && { textDecorationLine: 'line-through' },
            ]}
          >
            <InlineMarkdown text={item.text || ' '} onLink={onLink} resolveMention={resolveMention} />
          </Text>
          {hovered ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text style={t(400, 11.5, 1, { color: c.ink3, marginRight: 6 })}>Clic per spuntare</Text>
              <RowAction icon="subdirectory_arrow_right" label="Aggiungi sotto-voce" onPress={onAddChild} />
              <RowAction icon="edit" label="Rinomina" onPress={onEdit} />
              <RowAction icon="close" label="Elimina" onPress={onDelete} danger />
            </View>
          ) : null}
        </>
      )}
    </Hover>
  );
}

function RowAction({ icon, label, onPress, danger }: { icon: string; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Hover
      onPress={onPress}
      accessibilityLabel={label}
      {...({ title: label } as object)}
      style={({ hovered }) => ({ width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? (danger ? c.error13 : c.fill08) : 'transparent' })}
    >
      {({ hovered }) => <Icon name={icon} size={15} color={hovered && danger ? c.error : c.ink2} />}
    </Hover>
  );
}

function AddInput({
  depth,
  draft,
  commit,
  latest,
  close,
}: {
  depth: number;
  draft: Extract<Draft, { kind: 'add' }>;
  commit: (s: string) => void;
  latest: React.MutableRefObject<string | null>;
  close: () => void;
}) {
  return (
    <ItemInput
      depth={depth}
      initial=""
      keepOpen
      onCancel={close}
      onSubmit={(text) => {
        if (!text.trim()) return close();
        // Re-parse the latest content so consecutive adds stack correctly.
        const fresh = parseChecklist(latest.current!);
        const parent = draft.parent ? fresh.sections[draft.section]?.items.find((i) => i.line === draft.parent!.line) : undefined;
        commit(addItem(latest.current!, fresh, draft.section, text.trim(), parent));
      }}
    />
  );
}

function ItemInput({ depth, initial, onSubmit, onCancel, keepOpen }: { depth: number; initial: string; onSubmit: (s: string) => void; onCancel: () => void; keepOpen?: boolean }) {
  const [v, setV] = useState(initial);
  const ref = useRef<TextInput>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 11, alignItems: 'center', marginLeft: depth * 32, paddingVertical: 3, paddingHorizontal: 8, borderRadius: radius.sm, backgroundColor: c.fill05 }}>
      <Icon name="radio_button_unchecked" size={depth === 0 ? 21 : 19} color={c.purpleTint} />
      <TextInput
        ref={ref}
        value={v}
        onChangeText={setV}
        placeholder={keepOpen ? 'Nuova voce — Invio per aggiungere, Esc per chiudere' : ''}
        placeholderTextColor={c.ink3}
        onKeyPress={(e: any) => {
          if (e.nativeEvent.key === 'Escape') {
            e.preventDefault?.();
            onCancel();
          }
        }}
        onSubmitEditing={() => {
          onSubmit(v);
          if (keepOpen) {
            setV('');
            setTimeout(() => ref.current?.focus(), 0);
          }
        }}
        onBlur={() => !keepOpen && onCancel()}
        blurOnSubmit={false}
        style={web<TextStyle>({ flex: 1, outlineStyle: 'none', fontFamily: font.sf, fontSize: depth === 0 ? 15.5 : 14.5, lineHeight: 22, color: c.ink, caretColor: c.purpleTint, paddingVertical: 2 })}
      />
    </View>
  );
}

function SimpleInput({ placeholder, onSubmit, onCancel, big }: { placeholder: string; onSubmit: (s: string) => void; onCancel: () => void; big?: boolean }) {
  const [v, setV] = useState('');
  return (
    <TextInput
      autoFocus
      value={v}
      onChangeText={setV}
      placeholder={placeholder}
      placeholderTextColor={c.ink3}
      onSubmitEditing={() => onSubmit(v)}
      onKeyPress={(e: any) => e.nativeEvent.key === 'Escape' && onCancel()}
      onBlur={onCancel}
      style={web<TextStyle>({ outlineStyle: 'none', fontFamily: font.sf, fontWeight: '600', fontSize: big ? 19 : 15, color: c.ink, caretColor: c.purpleTint, borderBottomWidth: 1, borderColor: c.purple, paddingVertical: 6 })}
    />
  );
}
