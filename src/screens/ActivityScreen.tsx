import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View, type TextStyle } from 'react-native';
import { c, font, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { basename, findNode, projectOf, relTime } from '../kb/paths';
import type { ActivityEvent } from '../kb/types';
import { Avatar, Btn, FilterPill, Hover, Pill } from '../ui/primitives';
import { EmptyState } from './common';

type Filter = 'all' | 'agent' | 'you';

function dayLabel(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === now.toDateString()) return 'Oggi';
  if (d.toDateString() === y.toDateString()) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

const verb = (e: ActivityEvent) => (e.kind === 'created' ? 'Ha creato' : e.kind === 'deleted' ? 'Ha eliminato' : 'Ha modificato');

export function ActivityScreen({ id }: { id?: string }) {
  const app = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | undefined>(id);
  const list = app.activity.filter((a) => filter === 'all' || a.by === filter);
  const selected = list.find((a) => a.id === selectedId) ?? list[0];

  useEffect(() => {
    app.markSeen();
  }, [app.activity.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setSelectedId(id), [id]);

  const groups = useMemo(() => {
    const out: { label: string; items: ActivityEvent[] }[] = [];
    for (const e of list) {
      const label = dayLabel(e.at);
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [list]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ height: 60, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 28, paddingRight: 20, borderBottomWidth: 1, borderColor: c.hair }}>
        <Text style={[t(700, 20, 1, { letterSpacing: -0.5 }), { flex: 1 }]}>Attività</Text>
        <FilterPill label="Tutto" active={filter === 'all'} onPress={() => setFilter('all')} />
        <FilterPill label="Agenti" active={filter === 'agent'} onPress={() => setFilter('agent')} />
        <FilterPill label="Tu" active={filter === 'you'} onPress={() => setFilter('you')} />
      </View>

      {!list.length ? (
        <EmptyState
          icon="bolt"
          title="Nessuna attività"
          body="Qui compaiono le scritture sulla knowledge base: quelle degli agenti, rilevate mentre l’app è aperta, e le tue. Ogni voce mostra il confronto prima/dopo."
        />
      ) : (
        <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
          <ScrollView style={{ width: 360, flexGrow: 0, borderRightWidth: 1, borderColor: c.hair }} contentContainerStyle={{ padding: 10, gap: 2 }}>
            {groups.map((g) => (
              <View key={g.label} style={{ gap: 2 }}>
                <Text style={t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3, marginTop: 10, marginBottom: 8, marginHorizontal: 10 })}>{g.label}</Text>
                {g.items.map((e) => (
                  <EventRow key={e.id} e={e} on={e.id === selected?.id} onPress={() => setSelectedId(e.id)} />
                ))}
              </View>
            ))}
          </ScrollView>
          {selected ? <EventDetail e={selected} /> : null}
        </View>
      )}
    </View>
  );
}

function EventRow({ e, on, onPress }: { e: ActivityEvent; on: boolean; onPress: () => void }) {
  return (
    <Hover onPress={onPress} style={({ hovered }) => ({ flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 12, borderRadius: radius.lg, backgroundColor: on ? c.purple14 : hovered ? c.fill04 : 'transparent' })}>
      {e.by === 'you' ? <Avatar initials="TU" size={30} /> : <Avatar initials="AG" size={30} color={c.purple} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={t(500, 13.5, 1.35)}>
          {verb(e)} <Text style={{ fontFamily: font.mono }}>{basename(e.path)}</Text>
        </Text>
        <Text numberOfLines={1} style={t(400, 12, 1.35, { color: c.ink3, marginTop: 3 })}>
          {projectOf(e.path) ?? 'Radice'} · {relTime(e.at)}
        </Text>
        {e.added || e.removed ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
            {e.added ? <Pill label={`+${e.added} ${e.added === 1 ? 'riga' : 'righe'}`} bg={c.success16} fg={c.success} /> : null}
            {e.removed ? <Pill label={`−${e.removed}`} bg={c.error14} fg={c.error} /> : null}
          </View>
        ) : null}
      </View>
    </Hover>
  );
}

type Row = { left: string | null; right: string | null; kind: 'ctx' | 'del' | 'add' | 'mod' };

function hunkRows(lines: string[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l[0] === ' ' || l[0] === '\\') {
      if (l[0] === ' ') rows.push({ left: l.slice(1), right: l.slice(1), kind: 'ctx' });
      i++;
      continue;
    }
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < lines.length && lines[i][0] === '-') dels.push(lines[i++].slice(1));
    while (i < lines.length && lines[i][0] === '+') adds.push(lines[i++].slice(1));
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null, kind: dels[k] != null && adds[k] != null ? 'mod' : dels[k] != null ? 'del' : 'add' });
  }
  return rows;
}

/** Nearest markdown heading above a line, used as the hunk label. */
function headingAbove(src: string | null, line: number) {
  if (!src) return null;
  const lines = src.split('\n');
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = /^#{1,6}\s+(.*)$/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

function EventDetail({ e }: { e: ActivityEvent }) {
  const app = useApp();
  const exists = !!findNode(app.tree, e.path);
  const agent = e.by === 'agent';

  const restore = async () => {
    if (e.kind === 'created') {
      app.openDialog({ kind: 'delete', path: e.path });
      return;
    }
    if (e.before == null) return;
    if (exists) await app.ops.write(e.path, e.before);
    else await app.ops.createFile(e.path, e.before);
    app.toast({ icon: 'history', mono: basename(e.path), text: 'riportato alla versione precedente' });
  };

  const cell = (text: string | null, kind: Row['kind'], side: 'l' | 'r'): TextStyle => {
    const changed = side === 'l' ? kind === 'del' || kind === 'mod' : kind === 'add' || kind === 'mod';
    return {
      ...({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as object),
      backgroundColor: text == null ? 'rgba(250,249,245,.02)' : changed ? (side === 'l' ? c.error13 : c.success13) : 'transparent',
      color: changed && text != null ? (side === 'l' ? c.errorText : c.successText) : c.ink2,
    };
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: 28, gap: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {agent ? <Avatar initials="AG" size={36} color={c.purple} /> : <Avatar initials="TU" size={36} />}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={t(600, 16, 1.3, { letterSpacing: -0.24 })}>{agent ? 'Modifica di un agente' : 'Tua modifica'}</Text>
          <Text numberOfLines={1} style={t(400, 12, 1.3, { color: c.ink3, marginTop: 2 })}>
            <Text style={{ fontFamily: font.mono }}>{basename(e.path)}</Text> · {projectOf(e.path) ?? 'Radice'} · {relTime(e.at)} · {e.kind === 'created' ? 'creazione' : e.kind === 'deleted' ? 'eliminazione' : 'modifica'}
          </Text>
        </View>
        {e.kind !== 'created' || exists ? <Btn icon="history" label={e.kind === 'created' ? 'Elimina file' : 'Ripristina'} onPress={restore} /> : null}
        {exists ? <Btn variant="primary" label="Apri file" onPress={() => app.navigate({ name: 'file', path: e.path })} /> : null}
      </View>

      <View style={[{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden' }, web({ fontFamily: font.mono })]}>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: c.hair }}>
          <Text style={[headCell, { borderRightWidth: 1, borderColor: c.hair }]}>Prima</Text>
          <Text style={headCell}>
            Dopo · <Text style={{ color: c.success }}>+{e.added}</Text> <Text style={{ color: c.error }}>−{e.removed}</Text>
          </Text>
        </View>
        {e.hunks.map((h, hi) => {
          const label = headingAbove(e.after ?? e.before, h.newStart) ?? headingAbove(e.before, h.oldStart);
          return (
            <View key={hi}>
              <Text style={[t(400, 12.5, 1.85, { color: c.ink3, fontFamily: font.mono }), { paddingVertical: 7, paddingHorizontal: 14, backgroundColor: 'rgba(250,249,245,.03)', borderTopWidth: hi ? 1 : 0, borderBottomWidth: 1, borderColor: c.hair }]}>
                @@ {label ?? `righe ${h.newStart}–${h.newStart + Math.max(0, h.newLines - 1)}`}
              </Text>
              {hunkRows(h.lines).map((r, ri) => (
                <View key={ri} style={{ flexDirection: 'row' }}>
                  <Text style={[diffCell, cell(r.left, r.kind, 'l'), { borderRightWidth: 1, borderColor: c.hair }]}>{r.left ?? ' '}</Text>
                  <Text style={[diffCell, cell(r.right, r.kind, 'r')]}>{r.right ?? ' '}</Text>
                </View>
              ))}
            </View>
          );
        })}
        {!e.hunks.length ? <Text style={[diffCell, { color: c.ink3 }]}>Nessuna differenza di contenuto.</Text> : null}
      </View>

      <Text style={t(400, 12, 1.5, { color: c.ink3 })}>
        {e.kind === 'created'
          ? 'Il file è stato creato con questa modifica: “Elimina file” lo rimuove (con possibilità di annullare).'
          : 'Il ripristino riscrive il file con la versione “Prima”. Anche il ripristino compare in Attività e può essere annullato allo stesso modo.'}
      </Text>
    </ScrollView>
  );
}

const headCell = t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3, flex: 1, paddingVertical: 11, paddingHorizontal: 14 });
const diffCell: TextStyle = { flex: 1, minWidth: 0, paddingVertical: 3, paddingHorizontal: 14, fontFamily: font.mono, fontSize: 12.5, lineHeight: 23 };
