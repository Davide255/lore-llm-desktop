import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { c, font, radius, t } from '../theme';
import { useApp } from '../state/app';
import { allFolders, basename, countFiles, dirname, fileKind, findNode, join, templateContent, validateName, withMd, type Template } from '../kb/paths';
import { Btn, Field, FieldLabel, Hint, Hover, Icon, IconWell, InfoStrip } from '../ui/primitives';
import { DialogFooter, DialogFrame, DialogTitle, anchorBelow } from '../ui/overlays';

export function DialogHost() {
  const { dialog, openDialog } = useApp();
  if (!dialog) return null;
  const close = () => openDialog(null);
  switch (dialog.kind) {
    case 'newFile':
      return <NewFileDialog dir={dialog.dir} onClose={close} />;
    case 'newFolder':
      return <NameDialog title="Nuova cartella" dir={dialog.dir} kind="folder" onClose={close} />;
    case 'newProject':
      return <NameDialog title="Nuovo progetto" dir="" kind="project" onClose={close} />;
    case 'rename':
      return <RenameDialog path={dialog.path} onClose={close} />;
    case 'move':
      return <MoveDialog path={dialog.path} onClose={close} />;
    case 'delete':
      return <DeleteDialog path={dialog.path} onClose={close} />;
    case 'unsaved':
      return <UnsavedDialog next={dialog.next} onClose={close} />;
  }
}

/** Folder picker used by "Nuovo file" and "Sposta in…". */
function FolderSelect({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: string }) {
  const app = useApp();
  const ref = useRef<View>(null);
  const folders = allFolders(app.tree).filter((f) => !exclude || (f.path !== exclude && !f.path.startsWith(exclude + '/')));
  return (
    <View ref={ref}>
      <Hover
        onPress={() => {
          const a = anchorBelow(ref.current, 4);
          app.setMenu({
            x: a.x,
            y: a.y,
            width: a.width,
            items: [
              { icon: 'home', label: 'Radice della knowledge base', checked: value === '', onPress: () => onChange('') },
              ...folders.map((f) => ({ icon: f.path.includes('/') ? 'folder' : 'folder_special', label: `${'   '.repeat(f.path.split('/').length - 1)}${f.path}/`, checked: value === f.path, onPress: () => onChange(f.path) })),
            ],
          });
        }}
        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: hovered ? c.fill07 : c.fill05, borderWidth: 1, borderColor: c.hair })}
      >
        <Icon name="folder" filled size={17} color={c.blueTint} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.mono, fontSize: 13.5, color: c.ink }}>
          {value ? `${value}/` : 'Radice/'}
        </Text>
        <Icon name="unfold_more" size={17} color={c.ink3} />
      </Hover>
    </View>
  );
}

// ---------------------------------------------------------------------------
// C1 · Nuovo file
// ---------------------------------------------------------------------------
function NewFileDialog({ dir: initialDir, onClose }: { dir: string; onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [dir, setDir] = useState(initialDir);
  const [tpl, setTpl] = useState<Template>('empty');
  const [touched, setTouched] = useState(false);
  const file = withMd(name.trim());
  const path = join(dir, file);
  const err = validateName(name, 'file') ?? (findNode(app.tree, path) ? 'Esiste già un file con questo nome' : null);
  const style = name && /[A-Z\s]/.test(name) ? 'Consigliato: minuscole e trattini, niente spazi.' : null;
  const project = dir.split('/')[0];
  const hasIndex = !!project && !!findNode(app.tree, `${project}/index.md`);

  const submit = () => {
    setTouched(true);
    if (err) return;
    onClose();
    app.ops.createFile(path, templateContent(tpl, file));
  };

  const choices: { key: Template; icon: string; title: string; sub: string }[] = [
    { key: 'empty', icon: 'draft', title: 'File vuoto', sub: '' },
    { key: 'sections', icon: 'view_agenda', title: 'Titolo + sezioni', sub: 'H1, contesto, decisioni' },
    { key: 'checklist', icon: 'checklist', title: 'Checklist', sub: 'Elenco di caselle' },
  ];

  return (
    <DialogFrame width={560} onDismiss={onClose} onSubmit={submit}>
      <DialogTitle onClose={onClose}>Nuovo file</DialogTitle>
      <View style={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 22, gap: 18 }}>
        <View>
          <FieldLabel>Nome file</FieldLabel>
          <Field autoFocus monoText value={name} onChangeText={setName} suffix={/\.md$/i.test(name) ? undefined : '.md'} placeholder="nome-del-file" invalid={touched && !!err} />
          <Hint tone={touched && err ? 'error' : 'muted'}>{(touched && err) || style || 'Minuscole e trattini. Niente spazi.'}</Hint>
        </View>
        <View>
          <FieldLabel>Posizione</FieldLabel>
          <FolderSelect value={dir} onChange={setDir} />
        </View>
        <View>
          <FieldLabel>Contenuto iniziale</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {choices.map((ch) => {
              const on = tpl === ch.key;
              return (
                <Hover
                  key={ch.key}
                  onPress={() => setTpl(ch.key)}
                  style={({ hovered }) => ({ flex: 1, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: on ? c.purple : hovered ? c.fill12 : c.hair, backgroundColor: on ? c.purple10 : 'transparent', gap: 8 })}
                >
                  <Icon name={ch.icon} size={20} color={on ? c.purpleTint : c.ink3} />
                  <Text style={t(500, 13.5, 1.2)}>{ch.title}</Text>
                  <Text style={t(400, 11.5, 1.35, { color: c.ink3, minHeight: 15 })}>{ch.sub}</Text>
                </Hover>
              );
            })}
          </View>
        </View>
        {hasIndex ? (
          <InfoStrip>
            <Text style={t(400, 12.5, 1.45, { color: c.ink2 })}>
              <Text style={{ fontFamily: font.mono }}>index.md</Text> verrà rigenerato dopo la creazione.
            </Text>
          </InfoStrip>
        ) : null}
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="primary" label="Crea" kbd="⏎" onPress={submit} disabled={!name.trim()} />
      </DialogFooter>
    </DialogFrame>
  );
}

// ---------------------------------------------------------------------------
// Nuova cartella / Nuovo progetto
// ---------------------------------------------------------------------------
function NameDialog({ title, dir, kind, onClose }: { title: string; dir: string; kind: 'folder' | 'project'; onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [where, setWhere] = useState(dir);
  const [withChecklist, setWithChecklist] = useState(true);
  const [touched, setTouched] = useState(false);
  const path = join(kind === 'project' ? '' : where, name.trim());
  const err = validateName(name, 'folder') ?? (findNode(app.tree, path) ? 'Esiste già un elemento con questo nome' : null);

  const submit = async () => {
    setTouched(true);
    if (err) return;
    onClose();
    await app.ops.createFolder(path);
    if (kind === 'project' && withChecklist) await app.ops.createFile(`${path}/checklist.md`, '## Da fare\n\n- [ ] \n');
    if (kind === 'project') app.navigate({ name: 'folder', path }, { force: true });
  };

  return (
    <DialogFrame width={480} onDismiss={onClose} onSubmit={submit}>
      <DialogTitle onClose={onClose}>{title}</DialogTitle>
      <View style={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 22, gap: 18 }}>
        <View>
          <FieldLabel>{kind === 'project' ? 'Nome del progetto' : 'Nome cartella'}</FieldLabel>
          <Field autoFocus value={name} onChangeText={setName} icon={kind === 'project' ? 'folder_special' : 'folder'} placeholder={kind === 'project' ? 'Athly Dashboard' : 'architettura'} invalid={touched && !!err} />
          {touched && err ? <Hint tone="error">{err}</Hint> : null}
        </View>
        {kind === 'folder' ? (
          <View>
            <FieldLabel>Posizione</FieldLabel>
            <FolderSelect value={where} onChange={setWhere} />
          </View>
        ) : (
          <Hover onPress={() => setWithChecklist(!withChecklist)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name={withChecklist ? 'check_box' : 'check_box_outline_blank'} filled={withChecklist} size={20} color={withChecklist ? c.purpleTint : c.ink3} />
            <Text style={t(400, 13.5, 1.3, { color: c.ink2 })}>
              Crea anche <Text style={{ fontFamily: font.mono }}>checklist.md</Text>
            </Text>
          </Hover>
        )}
        {kind === 'project' ? (
          <InfoStrip>
            <Text style={t(400, 12.5, 1.45, { color: c.ink2 })}>
              Gli agenti genereranno <Text style={{ fontFamily: font.mono }}>index.md</Text> alla prima scrittura.
            </Text>
          </InfoStrip>
        ) : null}
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="primary" label="Crea" kbd="⏎" onPress={submit} disabled={!name.trim()} />
      </DialogFooter>
    </DialogFrame>
  );
}

// ---------------------------------------------------------------------------
// Rinomina / Sposta
// ---------------------------------------------------------------------------
function RenameDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const app = useApp();
  const node = findNode(app.tree, path);
  const isFile = node?.kind === 'file';
  const [name, setName] = useState(isFile ? basename(path).replace(/\.md$/i, '') : basename(path));
  const [touched, setTouched] = useState(false);
  const next = join(dirname(path), isFile ? withMd(name.trim()) : name.trim());
  const reserved = isFile && fileKind(next) === 'checklist' && fileKind(path) !== 'checklist' && findNode(app.tree, next);
  const err = validateName(name, isFile ? 'file' : 'folder') ?? (next !== path && findNode(app.tree, next) ? 'Esiste già un elemento con questo nome' : null) ?? (reserved ? 'checklist.md esiste già' : null);

  const submit = () => {
    setTouched(true);
    if (err) return;
    onClose();
    app.ops.rename(path, next);
  };

  return (
    <DialogFrame width={460} onDismiss={onClose} onSubmit={submit}>
      <DialogTitle onClose={onClose}>{isFile ? 'Rinomina file' : 'Rinomina cartella'}</DialogTitle>
      <View style={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 22 }}>
        <Field autoFocus selectTextOnFocus monoText={isFile} value={name} onChangeText={setName} suffix={isFile && !/\.md$/i.test(name) ? '.md' : undefined} invalid={touched && !!err} />
        {touched && err ? <Hint tone="error">{err}</Hint> : null}
        {!isFile && node ? <Hint>{`${countFiles(node)} file verranno spostati. I link relativi dentro la cartella restano validi.`}</Hint> : null}
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="primary" label="Rinomina" kbd="⏎" onPress={submit} disabled={!name.trim()} />
      </DialogFooter>
    </DialogFrame>
  );
}

function MoveDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const app = useApp();
  const node = findNode(app.tree, path);
  const [dir, setDir] = useState(dirname(path));
  const target = join(dir, basename(path));
  const err = target !== path && findNode(app.tree, target) ? 'Nella destinazione esiste già un elemento con questo nome' : null;
  const submit = () => {
    if (err || target === path) return onClose();
    onClose();
    app.ops.rename(path, target);
  };
  return (
    <DialogFrame width={480} onDismiss={onClose} onSubmit={submit}>
      <DialogTitle onClose={onClose}>Sposta in…</DialogTitle>
      <View style={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 22, gap: 10 }}>
        <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>
          <Text style={{ fontFamily: font.mono, color: c.ink }}>
            {basename(path)}
            {node?.kind === 'folder' ? '/' : ''}
          </Text>{' '}
          verrà spostato in:
        </Text>
        <FolderSelect value={dir} onChange={setDir} exclude={node?.kind === 'folder' ? path : undefined} />
        {err ? <Hint tone="error">{err}</Hint> : null}
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="primary" label="Sposta" kbd="⏎" onPress={submit} disabled={!!err || target === path} />
      </DialogFooter>
    </DialogFrame>
  );
}

// ---------------------------------------------------------------------------
// E2 · Conferma eliminazione
// ---------------------------------------------------------------------------
function DeleteDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const app = useApp();
  const node = findNode(app.tree, path);
  const folder = node?.kind === 'folder';
  const n = node ? countFiles(node) : 0;
  const submit = () => {
    onClose();
    app.ops.remove(path);
  };
  return (
    <DialogFrame width={440} onDismiss={onClose} onSubmit={submit}>
      <View style={{ padding: 24, paddingBottom: 20, flexDirection: 'row', gap: 16 }}>
        <IconWell icon="delete" tint="danger" size={40} />
        <View style={{ flex: 1 }}>
          <Text style={t(600, 18, 1.3, { letterSpacing: -0.36, marginBottom: 8 })}>{folder ? (path.includes('/') ? 'Eliminare la cartella?' : 'Eliminare il progetto?') : 'Eliminare il file?'}</Text>
          <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>
            <Text style={{ fontFamily: font.mono }}>
              {basename(path)}
              {folder ? '/' : ''}
            </Text>
            {folder ? ` e ${n === 1 ? '1 file' : `${n} file`} verranno rimossi` : ' verrà rimosso'} dalla base e dal contesto degli agenti.
          </Text>
        </View>
      </View>
      <DialogFooter border={false}>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="danger" label="Elimina" onPress={submit} />
      </DialogFooter>
    </DialogFrame>
  );
}

// ---------------------------------------------------------------------------
// B2 · Chiusura con modifiche
// ---------------------------------------------------------------------------
function UnsavedDialog({ next, onClose }: { next: () => void; onClose: () => void }) {
  const app = useApp();
  const ed = app.editorRef.current;
  const lines = useMemo(() => ed?.changedLines() ?? 0, [ed]);
  if (!ed) return null;
  const discard = () => {
    onClose();
    app.editorRef.current = null;
    next();
  };
  const saveAndClose = async () => {
    onClose();
    await ed.save();
    app.editorRef.current = null;
    next();
  };
  return (
    <DialogFrame width={460} onDismiss={onClose} onSubmit={saveAndClose}>
      <View style={{ padding: 24, paddingBottom: 20 }}>
        <Text style={t(600, 18, 1.3, { letterSpacing: -0.36, marginBottom: 8 })}>Modifiche non salvate</Text>
        <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>
          Hai cambiato {lines === 1 ? '1 riga' : `${lines} righe`} in <Text style={{ fontFamily: font.mono }}>{basename(ed.path)}</Text>. Vuoi salvarle prima di chiudere?
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 20 }}>
        <Btn variant="dangerText" label="Scarta" onPress={discard} />
        <View style={{ flex: 1 }} />
        <Btn label="Continua a modificare" onPress={onClose} />
        <Btn variant="primary" label="Salva e chiudi" kbd="⏎" onPress={saveAndClose} />
      </View>
    </DialogFrame>
  );
}

