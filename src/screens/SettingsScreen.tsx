import React, { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, font, radius, t } from '../theme';
import { useApp, type SettingsSection } from '../state/app';
import { allFiles, projects, relTime } from '../kb/paths';
import type { Agent } from '../kb/types';
import { Avatar, Btn, Card, Field, FieldLabel, Hover, Icon, IconWell, Kbd, Segmented, Toggle } from '../ui/primitives';
import { DialogFooter, DialogFrame, DialogTitle, anchorBelow } from '../ui/overlays';

const SECTIONS: { key: SettingsSection; icon: string; label: string }[] = [
  { key: 'general', icon: 'tune', label: 'Generale' },
  { key: 'editor', icon: 'edit_note', label: 'Editor' },
  { key: 'agents', icon: 'smart_toy', label: 'Agenti' },
  { key: 'shortcuts', icon: 'keyboard', label: 'Scorciatoie' },
];

export function SettingsScreen({ section = 'general' }: { section?: SettingsSection }) {
  const app = useApp();
  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ width: 210, borderRightWidth: 1, borderColor: c.hair, paddingVertical: 24, paddingHorizontal: 12, gap: 2 }}>
        <Text style={t(700, 20, 1, { letterSpacing: -0.5, paddingHorizontal: 10, paddingBottom: 18 })}>Impostazioni</Text>
        {SECTIONS.map((s) => {
          const on = s.key === section;
          return (
            <Hover
              key={s.key}
              onPress={() => app.navigate({ name: 'settings', section: s.key })}
              style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, height: 34, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: on ? c.purple16 : hovered ? c.fill05 : 'transparent' })}
            >
              <Icon name={s.icon} size={18} color={on ? c.purpleTint : c.ink2} />
              <Text style={t(500, 13.5, 1, { color: on ? c.ink : c.ink2 })}>{s.label}</Text>
            </Hover>
          );
        })}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 34, paddingHorizontal: 44, gap: 22, maxWidth: 1000 }}>
        {section === 'general' ? <General /> : section === 'editor' ? <EditorPrefs /> : section === 'agents' ? <Agents /> : <Shortcuts />}
      </ScrollView>
    </View>
  );
}

function Header({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
      <View style={{ flex: 1 }}>
        <Text style={t(700, 24, 1.2, { letterSpacing: -0.72 })}>{title}</Text>
        <Text style={t(400, 13.5, 1.5, { color: c.ink3, marginTop: 6 })}>{body}</Text>
      </View>
      {action}
    </View>
  );
}

function General() {
  const app = useApp();
  const files = allFiles(app.tree).length;
  return (
    <>
      <Header title="Generale" body="La knowledge base è una cartella: ogni sottocartella è un progetto." />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconWell icon="folder" tint="blue" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={t(500, 14, 1.3)}>Cartella della knowledge base</Text>
          <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12.5, color: c.ink3, marginTop: 4 }}>
            {app.root ?? 'Nessuna cartella selezionata'}
          </Text>
          {app.root ? (
            <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 4 })}>
              {projects(app.tree).length} progetti · {files} file .md
            </Text>
          ) : null}
        </View>
        {app.root ? <Btn icon="folder_open" label="Mostra" onPress={() => app.ops.reveal('')} /> : null}
        <Btn variant="primary" label={app.root ? 'Cambia cartella' : 'Scegli cartella'} onPress={app.chooseRoot} />
      </Card>
      <Card style={{ gap: 10 }}>
        <Text style={t(500, 14, 1.3)}>File speciali</Text>
        <Row icon="auto_awesome" color={c.info} name="index.md" body="Compilato automaticamente dagli agenti: si legge e si condivide, non si modifica." />
        <Row icon="checklist" color={c.purpleTint} name="checklist.md" body="Elenco di voci e sotto-voci: in lettura si spuntano con un clic e il sorgente viene riscritto." />
        <Row icon="description" color={c.ink3} name="*.md" body="Tutti gli altri file e cartelle: crei, modifichi, sposti ed elimini liberamente." />
      </Card>
    </>
  );
}

function Row({ icon, color, name, body }: { icon: string; color: string; name: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Icon name={icon} size={17} color={color} style={{ marginTop: 1 }} />
      <Text style={[t(400, 13, 1.5, { color: c.ink2 }), { flex: 1 }]}>
        <Text style={{ fontFamily: font.mono, color: c.ink }}>{name}</Text> — {body}
      </Text>
    </View>
  );
}

function EditorPrefs() {
  const app = useApp();
  return (
    <>
      <Header title="Editor" body="Come si apre un file quando premi Modifica." />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={t(500, 14, 1.3)}>Vista predefinita</Text>
          <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 3 })}>Affiancato mostra sorgente e anteprima insieme.</Text>
        </View>
        <Segmented
          width={300}
          value={app.prefs.editorView ?? 'split'}
          onChange={(v) => app.setPrefs({ editorView: v })}
          options={[
            { value: 'preview', label: 'Anteprima' },
            { value: 'split', label: 'Affiancato' },
            { value: 'source', label: 'Sorgente' },
          ]}
        />
      </Card>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ flex: 1 }}>
          <Text style={t(500, 14, 1.3)}>Scorrimento sincronizzato</Text>
          <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 3 })}>L’anteprima segue il sorgente mentre scorri.</Text>
        </View>
        <Toggle value={app.prefs.syncScroll ?? true} onChange={(v) => app.setPrefs({ syncScroll: v })} />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
function Agents() {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const update = (id: string, patch: Partial<Agent>) => app.saveAgents(app.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const names = projects(app.tree).map((p) => p.name);

  return (
    <>
      <Header title="Agenti" body="L’unico posto dove si decide chi può scrivere nella base." action={<Btn variant="primary" icon="add" label="Collega un agente" onPress={() => setAdding(true)} />} />
      <View style={{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden' }}>
        <View style={[rowStyle, { height: 38, borderTopWidth: 0 }]}>
          <Text style={[head, { flex: 1 }]}>Agente</Text>
          <Text style={[head, { width: 170 }]}>Permessi</Text>
          <Text style={[head, { width: 160 }]}>Progetti</Text>
          <Text style={[head, { width: 100 }]}>Ultimo accesso</Text>
          <Text style={[head, { width: 50 }]}>Attivo</Text>
          <View style={{ width: 24 }} />
        </View>
        {app.agents.map((a) => (
          <View key={a.id} style={[rowStyle, { height: 58 }]}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Avatar name={a.name} size={28} />
              <Text numberOfLines={1} style={[t(500, 13.5, 1.2), { flexShrink: 1 }]}>
                {a.name}
              </Text>
            </View>
            <View style={{ width: 170 }}>
              <Select
                label={a.permission === 'write' ? 'Lettura e scrittura' : 'Sola lettura'}
                options={[
                  { label: 'Lettura e scrittura', checked: a.permission === 'write', onPress: () => update(a.id, { permission: 'write' }) },
                  { label: 'Sola lettura', checked: a.permission === 'read', onPress: () => update(a.id, { permission: 'read' }) },
                ]}
              />
            </View>
            <View style={{ width: 160 }}>
              <Select
                label={a.scope.includes('*') ? 'Tutti' : a.scope.length === 1 ? a.scope[0] : `${a.scope.length} progetti`}
                options={[
                  { label: 'Tutti', checked: a.scope.includes('*'), onPress: () => update(a.id, { scope: ['*'] }) },
                  ...names.map((n) => ({
                    label: n,
                    checked: !a.scope.includes('*') && a.scope.includes(n),
                    onPress: () => {
                      const cur = a.scope.includes('*') ? [] : a.scope;
                      const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
                      update(a.id, { scope: next.length ? next : ['*'] });
                    },
                  })),
                ]}
              />
            </View>
            <Text style={[t(400, 13.5, 1, { color: c.ink3 }), { width: 100 }]}>{a.lastAccess ? relTime(a.lastAccess) : '—'}</Text>
            <View style={{ width: 50 }}>
              <Toggle value={a.active} onChange={(v) => update(a.id, { active: v })} />
            </View>
            <Hover
              onPress={() => app.saveAgents(app.agents.filter((x) => x.id !== a.id))}
              accessibilityLabel="Rimuovi"
              style={({ hovered }) => ({ width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? c.error13 : 'transparent' })}
            >
              <Icon name="close" size={15} color={c.ink3} />
            </Hover>
          </View>
        ))}
        {!app.agents.length ? (
          <View style={{ padding: 24, alignItems: 'center', borderTopWidth: 1, borderColor: c.hair }}>
            <Text style={t(400, 13, 1.5, { color: c.ink3, textAlign: 'center' })}>Nessun agente registrato. Collega Claude, Codex o qualsiasi client MCP che scrive nella base.</Text>
          </View>
        ) : null}
      </View>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconWell icon="info" tint="info" />
        <View style={{ flex: 1 }}>
          <Text style={t(500, 14, 1.3)}>
            Salvato in <Text style={{ fontFamily: font.mono }}>.lore/agents.json</Text>
          </Text>
          <Text style={t(400, 12, 1.45, { color: c.ink3, marginTop: 3 })}>
            Il file vive nella knowledge base, così il server MCP degli agenti può leggerlo e applicare permessi e ambito. L’app registra ogni scrittura esterna in Attività.
          </Text>
        </View>
      </Card>
      {adding ? <AddAgentDialog onClose={() => setAdding(false)} /> : null}
    </>
  );
}

function Select({ label, options }: { label: string; options: { label: string; checked: boolean; onPress: () => void }[] }) {
  const app = useApp();
  const ref = useRef<View>(null);
  return (
    <View ref={ref}>
      <Hover
        onPress={() => {
          const a = anchorBelow(ref.current, 4);
          app.setMenu({ x: a.x, y: a.y, width: Math.max(a.width, 200), items: options.map((o) => ({ ...o, icon: undefined })) });
        }}
        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: hovered ? c.fill08 : c.fill06, borderWidth: 1, borderColor: c.hair })}
      >
        <Text numberOfLines={1} style={[t(400, 12.5, 1, { color: c.ink2 }), { flex: 1 }]}>
          {label}
        </Text>
        <Icon name="unfold_more" size={15} color={c.ink3} />
      </Hover>
    </View>
  );
}

function AddAgentDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [perm, setPerm] = useState<'read' | 'write'>('write');
  const submit = () => {
    if (!name.trim()) return;
    app.saveAgents([...app.agents, { id: `${Date.now().toString(36)}`, name: name.trim(), permission: perm, scope: ['*'], active: true }]);
    onClose();
  };
  return (
    <DialogFrame width={460} onDismiss={onClose} onSubmit={submit}>
      <DialogTitle onClose={onClose}>Collega un agente</DialogTitle>
      <View style={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 22, gap: 18 }}>
        <View>
          <FieldLabel>Nome</FieldLabel>
          <Field autoFocus value={name} onChangeText={setName} placeholder="Claude, Codex, GPT Desktop…" />
        </View>
        <View>
          <FieldLabel>Permessi</FieldLabel>
          <Segmented
            value={perm}
            onChange={setPerm}
            options={[
              { value: 'write', label: 'Lettura e scrittura' },
              { value: 'read', label: 'Sola lettura' },
            ]}
          />
        </View>
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="primary" label="Collega" kbd="⏎" onPress={submit} disabled={!name.trim()} />
      </DialogFooter>
    </DialogFrame>
  );
}

// ---------------------------------------------------------------------------
function Shortcuts() {
  const list: [string, string][] = [
    ['⌘K', 'Cerca in tutta la knowledge base'],
    ['⌘N', 'Nuovo file nella cartella corrente'],
    ['⇧⌘N', 'Nuova cartella'],
    ['E', 'Modifica il file aperto'],
    ['⌘S', 'Salva (nell’editor)'],
    ['⌘B / ⌘I', 'Grassetto / corsivo (nell’editor)'],
    ['Esc', 'Chiudi l’editor o il dialog'],
    ['F2', 'Rinomina l’elemento selezionato'],
    ['⇧⌘M', 'Sposta l’elemento selezionato'],
    ['⌘D', 'Duplica il file selezionato'],
    ['⇧⌘C', 'Copia il link'],
    ['⌘⌫', 'Elimina (con conferma)'],
    ['⌘Z', 'Annulla l’ultima eliminazione (10 s)'],
    ['⌘\\', 'Mostra/nascondi la sidebar'],
  ];
  return (
    <>
      <Header title="Scorciatoie" body="Il clic destro su qualsiasi riga apre lo stesso menu con queste azioni." />
      <View style={{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden' }}>
        {list.map(([k, d], i) => (
          <View key={k} style={[rowStyle, { height: 44, borderTopWidth: i ? 1 : 0 }]}>
            <Text style={[t(400, 13.5, 1, { color: c.ink2 }), { flex: 1 }]}>{d}</Text>
            <Kbd>{k}</Kbd>
          </View>
        ))}
      </View>
    </>
  );
}

const rowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 18, borderTopWidth: 1, borderColor: c.hair };
const head = t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3 });
