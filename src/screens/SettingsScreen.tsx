import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, font, radius, t, web } from '../theme';
import { useApp, type SettingsSection } from '../state/app';
import { allFiles, countFiles, projects, relTime } from '../kb/paths';
import { isWeb, lore } from '../kb/bridge';
import type { Agent, AgentKind, OtaInfo, OtaPhase, InviteRole, NewAgent, Permission, Team, TeamInvite, TeamMember, TeamRole, VaultProject, VaultStatus } from '../kb/types';
import { canManage, INVITE_ROLES, looksLikeEmail, ROLE_HINT, ROLE_LABEL, sortMembers } from '../kb/teams';
import { AGENT_KIND_LIST, AGENT_KINDS } from '../kb/agents';
import { AgentAvatar } from '../ui/identity';
import { Avatar, Btn, Card, Field, FieldLabel, Hover, Icon, IconWell, isTouch, Kbd, Segmented, Spinner, Toggle, useCompact } from '../ui/primitives';
import { DialogFooter, DialogFrame, DialogTitle, anchorBelow } from '../ui/overlays';

const SECTIONS = ([
  { key: 'account', icon: 'account_circle', label: 'Account' },
  { key: 'general', icon: 'tune', label: 'Generale' },
  { key: 'team', icon: 'groups', label: 'Team' },
  { key: 'editor', icon: 'edit_note', label: 'Editor' },
  { key: 'obsidian', icon: 'hub', label: 'Obsidian' },
  { key: 'agents', icon: 'smart_toy', label: 'Agenti' },
  { key: 'shortcuts', icon: 'keyboard', label: 'Scorciatoie' },
] as { key: SettingsSection; icon: string; label: string }[])
  // A browser has no folder to keep in sync for Obsidian; a touch screen has no keyboard shortcuts.
  .filter((s) => !(isWeb && s.key === 'obsidian') && !(isTouch && s.key === 'shortcuts'));

export function SettingsScreen({ section: asked = 'general' }: { section?: SettingsSection }) {
  const app = useApp();
  const compact = useCompact();
  const section = isWeb && asked === 'obsidian' ? 'general' : asked;
  return (
    <View style={{ flex: 1, flexDirection: compact ? 'column' : 'row' }}>
      {/* A phone shows the sections as a scrolling strip of tabs above the page. */}
      <View
        style={[
          compact
            ? { flexDirection: 'row', gap: 2, paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderColor: c.hair }
            : { width: 210, borderRightWidth: 1, borderColor: c.hair, paddingVertical: 24, paddingHorizontal: 12, gap: 2 },
          compact && web({ overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 }),
        ]}
      >
        {compact ? null : <Text style={t(700, 20, 1, { letterSpacing: -0.5, paddingHorizontal: 10, paddingBottom: 18 })}>Impostazioni</Text>}
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: compact ? 22 : 34, paddingHorizontal: compact ? 16 : 44, gap: 22, maxWidth: 1000 }}>
        {section === 'account' ? <Account /> : section === 'general' ? <General /> : section === 'team' ? <Teams /> : section === 'editor' ? <EditorPrefs /> : section === 'obsidian' ? <ObsidianPrefs /> : section === 'agents' ? <Agents /> : <Shortcuts />}
      </ScrollView>
    </View>
  );
}

function Header({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  const compact = useCompact();
  return (
    <View style={compact ? { gap: 14, alignItems: 'flex-start' } : { flexDirection: 'row', alignItems: 'flex-end' }}>
      <View style={compact ? null : { flex: 1 }}>
        <Text style={t(700, 24, 1.2, { letterSpacing: -0.72 })}>{title}</Text>
        <Text style={t(400, 13.5, 1.5, { color: c.ink3, marginTop: 6 })}>{body}</Text>
      </View>
      {action}
    </View>
  );
}

function Account() {
  const app = useApp();
  const { user } = app;
  return (
    <>
      <Header title="Account" body="La knowledge base è legata al tuo account: ogni account ha la sua." />
      {user ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={user.name} size={34} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={t(500, 14, 1.3)}>
              {user.name}
            </Text>
            <Text numberOfLines={1} style={t(400, 12.5, 1.4, { color: c.ink3, marginTop: 3 })}>
              {user.email ?? (user.provider === 'apple' ? 'Account Apple' : 'Account Google')}
            </Text>
          </View>
          <Btn icon="logout" label="Esci" onPress={app.signOut} />
        </Card>
      ) : null}
    </>
  );
}

function General() {
  const app = useApp();
  const files = projects(app.tree).reduce((n, p) => n + countFiles(p), 0);
  return (
    <>
      <Header title="Generale" body="La knowledge base vive sul server Lore: ogni progetto è una cartella, condivisa con i tuoi agenti." />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconWell icon="cloud" tint="blue" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={t(500, 14, 1.3)}>Server della knowledge base</Text>
          <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12.5, color: c.ink3, marginTop: 4 }}>
            {app.server}
          </Text>
          <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 4 })}>
            {projects(app.tree).length} progetti · {files} file
          </Text>
        </View>
        <Btn
          icon="refresh"
          label="Aggiorna"
          onPress={() =>
            lore
              .tree(true)
              .then(() => app.refresh())
              .catch(() => {})
          }
        />
      </Card>
      {!isWeb && <Updates />}
      <Card style={{ gap: 10 }}>
        <Text style={t(500, 14, 1.3)}>File speciali</Text>
        <Row icon="auto_awesome" color={c.info} name="index.md" body="Compilato automaticamente dagli agenti: si legge e si condivide, non si modifica." />
        <Row icon="checklist" color={c.purpleTint} name="checklist.md" body="Elenco di voci e sotto-voci: in lettura si spuntano con un clic e il sorgente viene riscritto." />
        <Row icon="description" color={c.ink3} name="*.md" body="Tutti gli altri file e cartelle: crei, modifichi, sposti ed elimini liberamente." />
      </Card>
    </>
  );
}

const OTA_STATUS: Record<OtaPhase, string> = {
  idle: 'Nessun controllo',
  checking: 'Controllo…',
  downloading: 'Download in corso…',
  ready: "Scaricato: si installa al prossimo avvio dell'app",
  current: 'Aggiornato',
  error: 'Impossibile controllare',
};

/** Live updates (docs/OTA.md): the app build, the downloaded bundle it runs, and a manual check. */
function Updates() {
  const [info, setInfo] = useState<OtaInfo | null>(null);
  useEffect(() => {
    lore.otaStatus().then(setInfo).catch(() => {});
    return lore.onOtaStatus(setInfo);
  }, []);
  if (!info) return null;
  const busy = info.phase === 'checking' || info.phase === 'downloading';
  return (
    <>
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <IconWell icon="system_update" tint="blue" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={t(500, 14, 1.3)}>Aggiornamenti</Text>
        <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12.5, color: c.ink3, marginTop: 4 }}>
          {info.appVersion}
          {info.version ? ` · ${info.version}` : ''}
        </Text>
        <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 4 })}>
          {info.enabled ? OTA_STATUS[info.phase] : 'Disattivati in questa build'}
        </Text>
      </View>
      {busy ? (
        <Spinner />
      ) : (
        info.enabled && <Btn icon="refresh" label="Controlla" onPress={() => lore.otaCheck().catch(() => {})} />
      )}
    </Card>
    {info.enabled && (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconWell icon="science" tint="info" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={t(500, 14, 1.3)}>Versioni beta</Text>
          <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 4 })}>
            Ricevi gli aggiornamenti in anteprima, prima del rilascio a tutti. Possono contenere errori.
          </Text>
        </View>
        <Toggle value={info.channel === 'beta'} disabled={busy} onChange={(on) => lore.otaSetChannel(on ? 'beta' : 'production').then((next) => { setInfo(next); return lore.otaCheck(); }).catch(() => {})} />
      </Card>
    )}
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
      {isWeb ? null : <DefaultEditorCard />}
    </>
  );
}

function DefaultEditorCard() {
  const app = useApp();
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View style={{ flex: 1 }}>
        <Text style={t(500, 14, 1.3)}>Editor predefinito</Text>
        <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 3 })}>
          {app.obsidianReady
            ? 'Modifica, il tasto E e il doppio clic aprono le note qui o in Obsidian. Le checklist restano in Lore.'
            : 'Per usare Obsidian attiva prima la copia locale nella sezione Obsidian.'}
        </Text>
      </View>
      <Segmented
        width={220}
        value={app.obsidianReady ? (app.prefs.defaultEditor ?? 'lore') : 'lore'}
        onChange={(v) => (app.obsidianReady || v === 'lore' ? app.setPrefs({ defaultEditor: v }) : app.navigate({ name: 'settings', section: 'obsidian' }))}
        options={[
          { value: 'lore', label: 'Lore' },
          { value: 'obsidian', label: 'Obsidian' },
        ]}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Obsidian: local vault kept in sync with the cloud
// ---------------------------------------------------------------------------
function ObsidianPrefs() {
  const app = useApp();
  const v = app.vault;
  const o = app.obsidian;
  const on = !!v?.enabled;
  const { refreshVault } = app;

  // Registration happens in Obsidian: keep looking while this page is open.
  useEffect(() => {
    refreshVault().catch(() => {});
    const id = setInterval(() => refreshVault().catch(() => {}), 4000);
    return () => clearInterval(id);
  }, [refreshVault]);

  return (
    <>
      <Header
        title="Obsidian"
        body="Modifica la knowledge base con Obsidian. Lore ne tiene una copia in una cartella del computer e la sincronizza con il cloud nei due sensi: le modifiche degli agenti arrivano in Obsidian, le tue arrivano agli agenti."
      />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconWell icon="hub" tint="purple" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={t(500, 14, 1.3)}>Obsidian</Text>
          <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 3 })}>
            {!o.installed ? 'Non trovato su questo computer.' : o.registered ? 'Installato · la copia locale è aperta come vault.' : on ? 'Installato · apri la cartella della copia locale come vault.' : 'Installato.'}
          </Text>
        </View>
        {o.installed ? (
          on ? <Btn icon="open_in_new" label="Apri in Obsidian" onPress={() => app.openInObsidian()} /> : null
        ) : (
          <Btn icon="download" label="Scarica Obsidian" onPress={() => window.open('https://obsidian.md/download', '_blank')} />
        )}
      </Card>

      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={t(500, 14, 1.3)}>Copia locale della knowledge base</Text>
            <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 3 })}>
              Una cartella normale con un file .md per nota. Obsidian (o qualsiasi editor) lavora lì; Lore carica e scarica le modifiche.
            </Text>
          </View>
          <Toggle value={on} onChange={(next) => app.openDialog(next ? { kind: 'vaultSetup' } : { kind: 'vaultDisable' })} />
        </View>
        {on && v?.root ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.md, backgroundColor: c.fill04 }}>
            <Icon name="folder" filled size={17} color={c.blueTint} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.mono, fontSize: 12.5, color: c.ink2 }}>
              {v.root}
            </Text>
            <Btn height={30} icon="content_copy" label="Copia percorso" onPress={() => lore.copy(v.root!)} />
            <Btn height={30} icon="folder_open" label="Mostra cartella" onPress={() => lore.vaultReveal()} />
          </View>
        ) : null}
      </Card>

      {on && v ? <VaultStatusCard v={v} /> : null}

      {on && v ? <VaultProjectsCard /> : null}

      {on && v ? (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={t(500, 14, 1.3)}>Formato dei link</Text>
            <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 3 })}>
              Come Obsidian scrive i nuovi link. I link Markdown li leggono anche agenti e app mobile; Lore capisce entrambi. Riavvia Obsidian per applicare.
            </Text>
          </View>
          <Segmented
            width={240}
            value={v.linkFormat}
            onChange={(f) => lore.vaultSetLinkFormat(f).then(() => refreshVault())}
            options={[
              { value: 'markdown', label: 'Markdown' },
              { value: 'wikilink', label: '[[Wikilink]]' },
            ]}
          />
        </Card>
      ) : null}

      <DefaultEditorCard />
    </>
  );
}

/** Per-project switches: your own projects sync by default, team projects when you turn them on. */
function VaultProjectsCard() {
  const app = useApp();
  const [list, setList] = useState<VaultProject[] | null>(null);
  const load = React.useCallback(() => lore.vaultProjects().then(setList).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load, app.tree]);
  const set = async (p: VaultProject, on: boolean) => {
    setList((cur) => cur?.map((x) => (x.key === p.key ? { ...x, selected: on } : x)) ?? cur);
    try {
      await lore.vaultSetProject(p.key, on);
    } catch (e) {
      app.toast({ icon: 'error', text: e instanceof Error ? e.message : String(e) });
    }
    load();
  };
  if (!list?.length) return null;
  return (
    <Card style={{ gap: 4 }}>
      <Text style={t(500, 14, 1.3)}>Progetti nella copia locale</Text>
      <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 3, marginBottom: 8 })}>
        I tuoi progetti sono inclusi, quelli dei team li aggiungi tu. Togliere un progetto lascia la sua cartella sul computer: smette solo di sincronizzarsi.
      </Text>
      {list.map((p) => (
        <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, borderTopWidth: 1, borderColor: c.hair }}>
          <Icon name={p.team ? 'groups' : 'folder_special'} size={17} color={p.team ? c.blueTint : c.purpleTint} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={t(500, 13, 1.3)}>
              {p.name}
              {p.team ? <Text style={{ color: c.ink3, fontWeight: '400' }}>{` · ${p.team.name}`}</Text> : null}
            </Text>
            {p.selected && p.folder !== p.name ? (
              <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 11.5, color: c.ink3, marginTop: 2 }}>
                {p.folder}/{p.access === 'viewer' ? ' · sola lettura' : ''}
              </Text>
            ) : p.access === 'viewer' ? (
              <Text style={t(400, 11.5, 1.3, { color: c.ink3, marginTop: 2 })}>Sola lettura</Text>
            ) : null}
          </View>
          <Toggle value={p.selected} onChange={(next) => set(p, next)} />
        </View>
      ))}
    </Card>
  );
}

const STATE_LABEL: Record<VaultStatus['state'], { icon: string; color: string; label: string }> = {
  off: { icon: 'cloud_off', color: c.ink3, label: 'Non attiva' },
  idle: { icon: 'cloud_done', color: c.success, label: 'Sincronizzata' },
  syncing: { icon: 'sync', color: c.purpleTint, label: 'Sincronizzazione in corso…' },
  offline: { icon: 'cloud_off', color: c.warning, label: 'Offline' },
  'paused:auth': { icon: 'lock', color: c.warning, label: 'In pausa: accesso scaduto' },
  'paused:confirm': { icon: 'help', color: c.warning, label: 'In attesa di conferma' },
  error: { icon: 'error', color: c.danger, label: 'Errore' },
};

function VaultStatusCard({ v }: { v: VaultStatus }) {
  const app = useApp();
  const s = STATE_LABEL[v.state];
  const [syncing, setSyncing] = useState(false);
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name={s.icon} size={20} color={s.color} />
        <View style={{ flex: 1 }}>
          <Text style={t(500, 14, 1.3)}>{s.label}</Text>
          <Text style={t(400, 12, 1.4, { color: c.ink3, marginTop: 3 })}>
            {v.error ?? (v.lastSyncAt ? `Ultima sincronizzazione ${relTime(v.lastSyncAt)}` : 'Le modifiche salvate in Obsidian arrivano qui in pochi secondi.')}
          </Text>
        </View>
        {v.state === 'paused:confirm' && v.confirm ? (
          <Btn label="Rivedi" variant="tint" onPress={() => app.openDialog({ kind: 'vaultConfirm', count: v.confirm!.count, paths: v.confirm!.paths })} />
        ) : null}
        <Btn
          icon="sync"
          label="Sincronizza ora"
          disabled={syncing}
          onPress={async () => {
            setSyncing(true);
            try {
              await lore.vaultSyncNow();
              await app.refreshVault();
            } finally {
              setSyncing(false);
            }
          }}
        />
      </View>
      {v.conflicts.length ? (
        <View style={{ gap: 6 }}>
          <Text style={t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3 })}>Conflitti recenti</Text>
          {v.conflicts.slice(0, 5).map((cf) => (
            <Hover key={cf.copy} onPress={() => app.navigate({ name: 'file', path: cf.copy })} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="sync_problem" size={15} color={c.warning} />
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.mono, fontSize: 12, color: c.purpleTint }}>
                {cf.copy}
              </Text>
              <Text style={t(400, 11.5, 1, { color: c.ink3 })}>{relTime(cf.at)}</Text>
            </Hover>
          ))}
        </View>
      ) : null}
      {v.unsynced.length ? (
        <View style={{ gap: 6 }}>
          <Text style={t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3 })}>Non sincronizzati ({v.unsynced.length})</Text>
          {v.unsynced.slice(0, 8).map((u) => (
            <View key={u.path} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="block" size={15} color={c.ink3} />
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: font.mono, fontSize: 12, color: c.ink2 }}>
                {u.path}
              </Text>
              <Text numberOfLines={1} style={[t(400, 11.5, 1.3, { color: c.ink3 }), { flex: 1 }]}>
                — {u.reason}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Teams: members, roles and invitations. A team's projects sit with yours.
// ---------------------------------------------------------------------------
function Teams() {
  const app = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { refreshTeams } = app;
  useEffect(() => {
    refreshTeams().catch(() => {});
  }, [refreshTeams]);
  const fail = (e: unknown) => app.toast({ icon: 'error', text: errorText(e), ttl: 5000 });
  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const team = await lore.createTeam(name.trim());
      setName('');
      await refreshTeams();
      setOpen(team.id);
      app.toast({ icon: 'groups', text: `Team ${team.name} creato` });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const current = app.teams.find((t) => t.id === open) ?? null;
  return (
    <>
      <Header title="Team" body="Lavora sugli stessi progetti con altre persone. I progetti di un team compaiono tra i tuoi, con il nome del team; chi è in sola lettura li legge senza modificarli." />
      {app.invites.length ? (
        <Card style={{ gap: 10 }}>
          <Text style={t(500, 14, 1.3)}>Inviti ricevuti</Text>
          {app.invites.map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="group_add" size={18} color={c.blueTint} />
              <Text numberOfLines={1} style={[t(400, 13, 1.4, { color: c.ink2 }), { flex: 1 }]}>
                <Text style={{ color: c.ink, fontWeight: '500' }}>{i.teamName}</Text> · {ROLE_LABEL[i.role].toLowerCase()}
                {i.invitedBy ? ` · da ${i.invitedBy}` : ''}
              </Text>
              <Btn height={30} label="Rifiuta" onPress={() => app.answerInvite(i.id, false)} />
              <Btn height={30} variant="primary" label="Accetta" onPress={() => app.answerInvite(i.id, true)} />
            </View>
          ))}
        </Card>
      ) : null}
      <View style={{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden' }}>
        {app.teams.map((tm, i) => {
          const on = tm.id === open;
          return (
            <Hover
              key={tm.id}
              onPress={() => setOpen(on ? null : tm.id)}
              style={({ hovered }) => [rowStyle, { height: 52, borderTopWidth: i ? 1 : 0, backgroundColor: on ? c.purple10 : hovered ? c.fill04 : 'transparent' }]}
            >
              <Icon name="groups" size={19} color={c.blueTint} />
              <Text numberOfLines={1} style={[t(500, 13.5, 1.2), { flex: 1 }]}>
                {tm.name}
              </Text>
              <Text style={t(400, 12.5, 1, { color: c.ink3 })}>{ROLE_LABEL[tm.role]}</Text>
              <Icon name={on ? 'expand_less' : 'expand_more'} size={18} color={c.ink3} />
            </Hover>
          );
        })}
        <View style={[rowStyle, { height: 60, borderTopWidth: app.teams.length ? 1 : 0 }]}>
          <View style={{ flex: 1 }}>
            <Field value={name} onChangeText={setName} icon="group_add" placeholder="Nome del nuovo team" onSubmitEditing={create} />
          </View>
          <Btn variant="primary" icon="add" label={busy ? 'Creo…' : 'Crea team'} disabled={!name.trim() || busy} onPress={create} />
        </View>
      </View>
      {current ? <TeamPanel key={current.id} team={current} onGone={() => setOpen(null)} /> : null}
    </>
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

function TeamPanel({ team, onGone }: { team: Team; onGone: () => void }) {
  const app = useApp();
  const manage = canManage(team.role);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [rename, setRename] = useState(team.name);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('editor');
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);
  const fail = (e: unknown) => app.toast({ icon: 'error', text: errorText(e), ttl: 5000 });
  const load = React.useCallback(async () => {
    try {
      const [m, i] = await Promise.all([lore.teamMembers(team.id), manage ? lore.teamInvites(team.id) : Promise.resolve([])]);
      setMembers(sortMembers(m));
      setInvites(i);
    } catch (e) {
      app.toast({ icon: 'error', text: errorText(e), ttl: 5000 });
    }
  }, [team.id, manage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    try {
      await fn();
      after?.();
      await load();
    } catch (e) {
      fail(e);
    }
  };
  const owners = members?.filter((m) => m.role === 'owner').length ?? 0;
  const me = members?.find((m) => m.isYou);
  const invite = () =>
    looksLikeEmail(email)
      ? run(
          () => lore.inviteToTeam(team.id, email.trim(), role),
          () => {
            app.toast({ icon: 'outgoing_mail', mono: email.trim(), text: 'invitato: vedrà l’invito accedendo a Lore' });
            setEmail('');
          },
        )
      : fail(new Error('Inserisci un’email valida'));
  const leaveOrDelete = async (what: 'delete' | 'leave') => {
    try {
      if (what === 'delete') await lore.deleteTeam(team.id);
      else await lore.removeMember(team.id, me!.userId);
      await app.refreshTeams();
      await app.refresh();
      app.toast({ icon: what === 'delete' ? 'delete' : 'logout', text: what === 'delete' ? `Team ${team.name} eliminato` : `Sei uscito da ${team.name}` });
      onGone();
    } catch (e) {
      setConfirm(null);
      fail(e);
    }
  };
  return (
    <Card style={{ gap: 18 }}>
      {manage ? (
        <View>
          <FieldLabel>Nome del team</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field value={rename} onChangeText={setRename} />
            </View>
            <Btn
              label="Rinomina"
              disabled={!rename.trim() || rename.trim() === team.name}
              onPress={() => run(() => lore.renameTeam(team.id, rename.trim()), () => app.refreshTeams())}
            />
          </View>
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <Text style={[t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3 }), { marginBottom: 6 }]}>Membri</Text>
        {(members ?? []).map((m) => (
          <View key={m.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42 }}>
            <Avatar name={m.name ?? m.email ?? '?'} size={26} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={t(500, 13, 1.3)}>
                {m.name ?? m.email ?? 'Utente'}
                {m.isYou ? <Text style={{ color: c.ink3, fontWeight: '400' }}> (tu)</Text> : null}
              </Text>
              {m.name && m.email ? (
                <Text numberOfLines={1} style={t(400, 11.5, 1.3, { color: c.ink3 })}>
                  {m.email}
                </Text>
              ) : null}
            </View>
            {manage && !(m.isYou && owners <= 1) ? (
              <View style={{ width: 170 }}>
                <Select
                  label={ROLE_LABEL[m.role]}
                  options={(['owner', 'editor', 'viewer'] as TeamRole[]).map((r) => ({
                    label: `${ROLE_LABEL[r]} — ${ROLE_HINT[r]}`,
                    checked: m.role === r,
                    onPress: () => r !== m.role && run(() => lore.setMemberRole(team.id, m.userId, r), () => m.isYou && app.refreshTeams()),
                  }))}
                />
              </View>
            ) : (
              <Text style={t(400, 12.5, 1, { color: c.ink3 })}>{ROLE_LABEL[m.role]}</Text>
            )}
            {manage && !m.isYou ? (
              <Hover
                onPress={() => run(() => lore.removeMember(team.id, m.userId), () => app.toast({ icon: 'person_remove', text: `${m.name ?? m.email ?? 'Membro'} rimosso dal team` }))}
                accessibilityLabel="Rimuovi dal team"
                style={({ hovered }) => ({ width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? c.error13 : 'transparent' })}
              >
                <Icon name="close" size={15} color={c.ink3} />
              </Hover>
            ) : (
              <View style={{ width: 26 }} />
            )}
          </View>
        ))}
        {!members ? <Spinner size={16} /> : null}
      </View>

      {manage ? (
        <View style={{ gap: 8 }}>
          <Text style={t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3 })}>Invita</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Field value={email} onChangeText={setEmail} icon="mail" placeholder="nome@esempio.it" onSubmitEditing={invite} />
            </View>
            <Segmented width={220} value={role} onChange={setRole} options={INVITE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            <Btn variant="primary" label="Invita" disabled={!email.trim()} onPress={invite} />
          </View>
          <Text style={t(400, 11.5, 1.4, { color: c.ink3 })}>L’invito arriva nell’app: la persona lo accetta accedendo a Lore con questa email. Scade dopo qualche giorno.</Text>
          {invites.map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 34 }}>
              <Icon name="schedule_send" size={16} color={c.ink3} />
              <Text numberOfLines={1} style={[t(400, 12.5, 1.3, { color: c.ink2 }), { flex: 1 }]}>
                {i.email} · {ROLE_LABEL[i.role].toLowerCase()} · in attesa, scade {relTime(i.expiresAt).replace(/ fa$/, '')}
              </Text>
              <Btn height={28} label="Revoca" onPress={() => run(() => lore.revokeInvite(team.id, i.id))} />
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, borderTopWidth: 1, borderColor: c.hair, paddingTop: 14 }}>
        <View style={{ flex: 1 }} />
        {me && !(me.role === 'owner' && owners <= 1) ? (
          confirm === 'leave' ? (
            <Btn variant="danger" label="Conferma: esci dal team" onPress={() => leaveOrDelete('leave')} />
          ) : (
            <Btn icon="logout" label="Esci dal team" onPress={() => setConfirm('leave')} />
          )
        ) : null}
        {manage ? (
          confirm === 'delete' ? (
            <Btn variant="danger" label="Conferma: elimina il team" onPress={() => leaveOrDelete('delete')} />
          ) : (
            <Btn icon="delete" label="Elimina team" textColor={c.error} onPress={() => setConfirm('delete')} />
          )
        ) : null}
      </View>
      {me?.role === 'owner' && owners <= 1 ? (
        <Text style={t(400, 11.5, 1.4, { color: c.ink3, marginTop: -10 })}>Sei l’unico proprietario: per uscire nomina prima un altro proprietario. Un team si elimina solo quando non ha più file.</Text>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
function Agents() {
  const app = useApp();
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<NewAgent | null>(null);
  const [revoking, setRevoking] = useState<Agent | null>(null);
  const update = (id: string, patch: Partial<Pick<Agent, 'permission' | 'scope'>>) => app.updateAgent(id, patch);
  // Agents reach the user's own projects only (team projects come with phase 5 on the server).
  const names = projects(app.tree)
    .filter((p) => !p.project?.team)
    .map((p) => p.name);
  const lastWrite = (id: string) => app.audit.find((i) => i.agent?.id === id)?.at;
  const compact = useCompact();

  return (
    <>
      <Header title="Agenti" body="L’unico posto dove si decide chi può scrivere nella base." action={<Btn variant="primary" icon="add" label="Collega un agente" onPress={() => setAdding(true)} />} />
      <View style={{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden' }}>
        <View style={[rowStyle, { height: 38, borderTopWidth: 0 }, compact && { display: 'none' }]}>
          <Text style={[head, { flex: 1 }]}>Agente</Text>
          <Text style={[head, { width: 170 }]}>Permessi</Text>
          <Text style={[head, { width: 160 }]}>Progetti</Text>
          <Text style={[head, { width: 140 }]}>Ultima scrittura</Text>
          <View style={{ width: 24 }} />
        </View>
        {app.agents.map((a) => {
          const name = (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <AgentAvatar agent={a} size={30} />
              <View style={{ flexShrink: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={t(500, 13.5, 1.2)}>
                  {a.name}
                </Text>
                {a.name !== AGENT_KINDS[a.kind].label ? (
                  <Text numberOfLines={1} style={t(400, 11.5, 1.2, { color: c.ink3, marginTop: 2 })}>
                    {AGENT_KINDS[a.kind].label}
                  </Text>
                ) : null}
              </View>
            </View>
          );
          const permission = (
            <Select
              label={a.permission === 'write' ? 'Lettura e scrittura' : 'Sola lettura'}
              options={[
                { label: 'Lettura e scrittura', checked: a.permission === 'write', onPress: () => update(a.id, { permission: 'write' }) },
                { label: 'Sola lettura', checked: a.permission === 'read', onPress: () => update(a.id, { permission: 'read' }) },
              ]}
            />
          );
          const scope = (
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
          );
          const revoke = (
            <Hover
              onPress={() => setRevoking(a)}
              accessibilityLabel="Revoca"
              style={({ hovered }) => ({ width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: hovered ? c.error13 : 'transparent' })}
            >
              <Icon name="close" size={15} color={c.ink3} />
            </Hover>
          );
          // A phone stacks the two pickers under the name instead of in columns.
          return compact ? (
            <View key={a.id} style={[rowStyle, { flexDirection: 'column', alignItems: 'stretch', paddingVertical: 12, paddingHorizontal: 14, gap: 10 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {name}
                {revoke}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>{permission}</View>
                <View style={{ flex: 1 }}>{scope}</View>
              </View>
            </View>
          ) : (
            <View key={a.id} style={[rowStyle, { height: 58 }]}>
              {name}
              <View style={{ width: 170 }}>{permission}</View>
              <View style={{ width: 160 }}>{scope}</View>
              <Text style={[t(400, 13.5, 1, { color: c.ink3 }), { width: 140 }]}>{lastWrite(a.id) ? relTime(lastWrite(a.id)!) : '—'}</Text>
              {revoke}
            </View>
          );
        })}
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
            Gli agenti si collegano a <Text style={{ fontFamily: font.mono }}>{app.server}/mcp</Text>
          </Text>
          <Text style={t(400, 12, 1.45, { color: c.ink3, marginTop: 3 })}>
            Ogni agente ha il suo token: il server applica permessi e progetti a ogni chiamata. Revocarlo lo blocca subito.
          </Text>
        </View>
      </Card>
      <ClaudeConnector />
      <AuditLog />
      {adding ? (
        <AddAgentDialog
          onClose={() => setAdding(false)}
          onCreated={(res) => {
            setAdding(false);
            setCreated(res);
          }}
        />
      ) : null}
      {created ? <TokenDialog created={created} onClose={() => setCreated(null)} /> : null}
      {revoking ? <RevokeDialog agent={revoking} onClose={() => setRevoking(null)} /> : null}
    </>
  );
}

/** Claude (claude.ai / Desktop) adds the server as a custom connector and signs in with OAuth: no token to paste. */
function ClaudeConnector() {
  const app = useApp();
  const url = `https://${app.server}/mcp`;
  const copy = async () => {
    await lore.copy(url);
    app.toast({ icon: 'content_copy', text: 'URL copiato negli appunti' });
  };
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconWell icon="key" tint="info" />
        <View style={{ flex: 1 }}>
          <Text style={t(500, 14, 1.3)}>Claude · connettore con OAuth</Text>
          <Text style={t(400, 12, 1.45, { color: c.ink3, marginTop: 3 })}>
            In Claude apri Impostazioni → Connettori → Aggiungi connettore personalizzato e incolla questo URL. L’accesso avviene con il tuo account, senza token.
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text selectable numberOfLines={1} style={[codeBox, { flex: 1, minWidth: 0 }]}>
          {app.server ? url : '—'}
        </Text>
        <Btn icon="content_copy" label="Copia" onPress={copy} />
      </View>
    </Card>
  );
}

const ACTION_LABEL ={ CREATE: 'creato', UPDATE: 'modificato', DELETE: 'eliminato' } as const;

/** Server-side audit: every file an agent created, changed or deleted. */
function AuditLog() {
  const app = useApp();
  const compact = useCompact();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={[t(600, 15, 1.2), { flex: 1 }]}>Registro delle modifiche</Text>
        <Btn icon="refresh" label="Aggiorna" onPress={() => app.loadAudit().catch(() => {})} />
      </View>
      <View style={{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden' }}>
        {app.audit.map((i, n) => (
          <View key={i.id} style={[rowStyle, { height: 40, borderTopWidth: n ? 1 : 0 }, compact && { paddingHorizontal: 14, gap: 10 }]}>
            <Text numberOfLines={1} style={[t(400, 12.5, 1, { color: c.ink3 }), { width: compact ? 64 : 90 }]}>{relTime(i.at)}</Text>
            <View style={{ width: compact ? 20 : 160, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AgentAvatar agent={i.agent} size={20} />
              {compact ? null : (
                <Text numberOfLines={1} style={[t(500, 13, 1), { flexShrink: 1 }]}>
                  {i.agent?.name ?? 'Agente revocato'}
                </Text>
              )}
            </View>
            {compact ? null : <Text style={[t(400, 12.5, 1, { color: i.action === 'DELETE' ? c.error : c.ink2 }), { width: 80 }]}>{ACTION_LABEL[i.action]}</Text>}
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.mono, fontSize: 12.5, color: c.ink2 }}>
              {i.path}
            </Text>
          </View>
        ))}
        {!app.audit.length ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={t(400, 13, 1.5, { color: c.ink3 })}>Nessuna modifica degli agenti finora.</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The token exists only in this dialog: the server keeps no copy. */
function TokenDialog({ created, onClose }: { created: NewAgent; onClose: () => void }) {
  const app = useApp();
  const setup =
    created.agent.kind === 'codex'
      ? {
          label: 'Codex · ~/.codex/config.toml',
          text: `[mcp_servers.lore]\nurl = "${created.mcpUrl}"\nhttp_headers = { Authorization = "Bearer ${created.token}" }`,
        }
      : { label: 'Claude Code', text: `claude mcp add --transport http lore ${created.mcpUrl} --header "Authorization: Bearer ${created.token}"` };
  const copy = async (text: string, what: string) => {
    await lore.copy(text);
    app.toast({ icon: 'content_copy', text: `${what} copiato negli appunti` });
  };
  return (
    <DialogFrame width={600} onDismiss={onClose} onSubmit={onClose}>
      <DialogTitle onClose={onClose}>{`${created.agent.name} è collegato`}</DialogTitle>
      <View style={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 22, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <AgentAvatar agent={created.agent} size={32} />
          <View>
            <Text style={t(500, 14, 1.3)}>{created.agent.name}</Text>
            <Text style={t(400, 12, 1.3, { color: c.ink3 })}>
              {AGENT_KINDS[created.agent.kind].label} · {created.agent.permission === 'write' ? 'lettura e scrittura' : 'sola lettura'}
            </Text>
          </View>
        </View>
        <Text style={t(400, 13, 1.5, { color: c.ink2 })}>
          Copia ora il token: non verrà più mostrato. Scade il {new Date(created.expiresAt).toLocaleDateString('it-IT')}.
        </Text>
        <View>
          <FieldLabel>Token</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text selectable numberOfLines={1} style={[codeBox, { flex: 1, minWidth: 0 }]}>
              {created.token}
            </Text>
            <Btn icon="content_copy" label="Copia" onPress={() => copy(created.token, 'Token')} />
          </View>
        </View>
        <View>
          <FieldLabel>{setup.label}</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Text selectable style={[codeBox, { flex: 1, minWidth: 0 }, web({ wordBreak: 'break-all', whiteSpace: 'pre-wrap' })]}>
              {setup.text}
            </Text>
            <Btn icon="content_copy" label="Copia" onPress={() => copy(setup.text, 'Configurazione')} />
          </View>
        </View>
      </View>
      <DialogFooter>
        <Btn variant="primary" label="Fatto" kbd="⏎" onPress={onClose} />
      </DialogFooter>
    </DialogFrame>
  );
}

function RevokeDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const app = useApp();
  const submit = () => {
    app.deleteAgent(agent.id);
    onClose();
  };
  return (
    <DialogFrame width={440} onDismiss={onClose} onSubmit={submit}>
      <DialogTitle onClose={onClose}>{`Revocare ${agent.name}?`}</DialogTitle>
      <View style={{ paddingTop: 8, paddingHorizontal: 24, paddingBottom: 22 }}>
        <Text style={t(400, 13, 1.5, { color: c.ink2 })}>Il suo token smette subito di funzionare. Le sue modifiche restano nel registro.</Text>
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="danger" label="Revoca" kbd="⏎" onPress={submit} />
      </DialogFooter>
    </DialogFrame>
  );
}

const codeBox = { fontFamily: font.mono, fontSize: 12, lineHeight: 17, color: c.ink, backgroundColor: c.fill06, borderWidth: 1, borderColor: c.hair, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7 } as const;

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

/** Pick the client, give it a friendly name, choose what it may do. */
function AddAgentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (res: NewAgent) => void }) {
  const app = useApp();
  const [kind, setKind] = useState<AgentKind>('claude');
  const [name, setName] = useState('');
  const [perm, setPerm] = useState<Permission>('write');
  const [busy, setBusy] = useState(false);
  // An empty name falls back to the client's name ("Claude", "Codex").
  const finalName = name.trim() || AGENT_KINDS[kind].label;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const res = await app.createAgent({ kind, name: finalName, permission: perm, scope: ['*'] });
    setBusy(false);
    if (res) onCreated(res);
  };
  return (
    <DialogFrame width={540} onDismiss={onClose} onSubmit={submit}>
      <DialogTitle onClose={onClose}>Collega un agente</DialogTitle>
      <View style={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 22, gap: 18 }}>
        <View>
          <FieldLabel>Tipo di agente</FieldLabel>
          <View role="radiogroup" style={{ flexDirection: 'row', gap: 10 }}>
            {AGENT_KIND_LIST.map((k) => (
              <KindOption key={k} kind={k} on={k === kind} onPress={() => setKind(k)} />
            ))}
          </View>
        </View>
        <View>
          <FieldLabel>Nome</FieldLabel>
          <Field autoFocus value={name} onChangeText={setName} placeholder={`${AGENT_KINDS[kind].label} (es. “${AGENT_KINDS[kind].label} lavoro”)`} />
          <Text style={t(400, 11.5, 1.4, { color: c.ink3, marginTop: 6 })}>Il nome con cui l’agente compare in Attività e nel registro.</Text>
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
        <Btn variant="primary" label={busy ? 'Collego…' : `Collega ${finalName}`} kbd="⏎" onPress={submit} disabled={busy} />
      </DialogFooter>
    </DialogFrame>
  );
}

function KindOption({ kind, on, onPress }: { kind: AgentKind; on: boolean; onPress: () => void }) {
  return (
    <Hover
      role="radio"
      aria-checked={on}
      aria-label={AGENT_KINDS[kind].label}
      onPress={onPress}
      style={({ hovered }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: radius.lg,
        borderWidth: 1.5,
        borderColor: on ? c.purple : c.hair,
        backgroundColor: on ? c.purple14 : hovered ? c.fill05 : c.fill04,
      })}
    >
      <AgentAvatar kind={kind} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={t(600, 14, 1.2)}>{AGENT_KINDS[kind].label}</Text>
        <Text numberOfLines={2} style={t(400, 11.5, 1.35, { color: c.ink3, marginTop: 2 })}>
          {AGENT_KINDS[kind].hint}
        </Text>
      </View>
      <Icon name={on ? 'radio_button_checked' : 'radio_button_unchecked'} size={18} color={on ? c.purpleTint : c.ink3} />
    </Hover>
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
