import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { c, font, radius, t } from '../theme';
import { useApp } from '../state/app';
import { lore } from '../kb/bridge';
import type { VaultPreview, VaultProject } from '../kb/types';
import { plural } from '../kb/paths';
import { Btn, FieldLabel, Icon, IconWell, InfoStrip } from '../ui/primitives';
import { DialogFooter, DialogFrame, DialogTitle } from '../ui/overlays';

// ---------------------------------------------------------------------------
// Setup of one project: choose its folder, first sync, then open it in Obsidian.
// ---------------------------------------------------------------------------
export function VaultSetupDialog({ projectKey, pickFolder, onClose }: { projectKey: string; pickFolder?: boolean; onClose: () => void }) {
  const [project, setProject] = useState<VaultProject | null>(null);
  const [step, setStep] = useState<'folder' | 'obsidian' | null>(null);
  const load = React.useCallback(() => lore.vaultProjects().then((l) => setProject(l.find((p) => p.key === projectKey) ?? null)), [projectKey]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (project && step === null) setStep(project.root && !pickFolder ? 'obsidian' : 'folder');
  }, [project, step, pickFolder]);
  if (!project || !step) return null;
  return step === 'folder' ? (
    <FolderStep project={project} onClose={onClose} onDone={() => load().then(() => setStep('obsidian'))} />
  ) : (
    <ObsidianStep project={project} reload={load} onClose={onClose} />
  );
}

function FolderStep({ project, onClose, onDone }: { project: VaultProject; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [root, setRoot] = useState(project.root ?? project.suggested ?? '');
  const [preview, setPreview] = useState<VaultPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPreview(null);
    if (!root) return;
    lore
      .vaultPreview(project.key, root)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [root, project.key]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await lore.vaultSetProject(project.key, root);
      await app.refreshVault();
      app.toast({ icon: 'cloud_done', text: `«${project.name}» sincronizza con la sua cartella` });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame width={560} onDismiss={onClose} onSubmit={preview?.ok && !busy ? enable : undefined}>
      <DialogTitle onClose={onClose}>{`Cartella Obsidian di «${project.name}»`}</DialogTitle>
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 16 }}>
        <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>
          Lore tiene questa cartella sincronizzata con il progetto: un file .md per ogni nota, direttamente dentro. Aprila in Obsidian come vault: quello che salvi lì arriva agli agenti, e le loro modifiche arrivano a te.
        </Text>
        <View style={{ gap: 6 }}>
          <FieldLabel>Cartella</FieldLabel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 40, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: c.fill05, borderWidth: 1, borderColor: c.hair }}>
              <Icon name="folder" filled size={17} color={c.blueTint} />
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.mono, fontSize: 12.5, color: root ? c.ink : c.ink3 }}>
                {root || 'Nessuna cartella scelta'}
              </Text>
            </View>
            <Btn
              label="Scegli…"
              onPress={async () => {
                const picked = await lore.vaultChooseRoot();
                if (picked) setRoot(picked);
              }}
            />
          </View>
          <PreviewLine preview={root ? preview : null} empty={!root} />
        </View>
        {error ? (
          <InfoStrip icon="error" style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
            <Text style={t(400, 13, 1.45, { color: c.danger })}>{error}</Text>
          </InfoStrip>
        ) : null}
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="primary" label={busy ? 'Sincronizzazione…' : project.root ? 'Cambia' : 'Attiva'} disabled={!preview?.ok || busy} onPress={enable} />
      </DialogFooter>
    </DialogFrame>
  );
}

function PreviewLine({ preview, empty = false }: { preview: VaultPreview | null; empty?: boolean }) {
  if (empty) return <Text style={t(400, 12, 1.45, { color: c.ink3 })}>Scegli una cartella per continuare.</Text>;
  if (!preview) return <Text style={t(400, 12, 1.45, { color: c.ink3 })}>Controllo della cartella…</Text>;
  if (!preview.ok) return <Text style={t(400, 12, 1.45, { color: c.danger })}>{preview.error}</Text>;
  let text: string;
  if (preview.resume) text = 'È già la tua copia locale: riprende da dove era rimasta.';
  else if (preview.empty) text = `${preview.exists ? 'Cartella vuota' : 'Verrà creata'}: ${plural(preview.download ?? 0, 'file da scaricare', 'file da scaricare')}.`;
  else {
    const parts = [
      preview.download ? plural(preview.download, 'file da scaricare', 'file da scaricare') : null,
      preview.upload ? plural(preview.upload, 'file da caricare', 'file da caricare') : null,
      preview.merge ? plural(preview.merge, 'file da unire', 'file da unire') : null,
      preview.same ? plural(preview.same, 'file già uguale', 'file già uguali') : null,
      preview.unsynced ? plural(preview.unsynced, 'file che resta solo in locale', 'file che restano solo in locale') : null,
    ].filter(Boolean);
    text = `La cartella contiene già dei file: ${parts.join(', ') || 'niente da sincronizzare'}.`;
  }
  return <Text style={t(400, 12, 1.45, { color: preview.empty || preview.resume ? c.ink3 : c.warning })}>{text}</Text>;
}

function ObsidianStep({ project, reload, onClose }: { project: VaultProject; reload: () => Promise<unknown>; onClose: () => void }) {
  const app = useApp();
  const root = project.root ?? '';
  const registered = project.registered;
  const { installed } = app.obsidian;

  // Obsidian has no link that adds a vault: wait for the user to open the folder there.
  useEffect(() => {
    if (registered) return;
    const id = setInterval(() => reload().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, [registered, reload]);

  return (
    <DialogFrame width={560} onDismiss={onClose}>
      <DialogTitle onClose={onClose}>Apri in Obsidian</DialogTitle>
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 14 }}>
        {!installed ? (
          <>
            <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>Obsidian non risulta installato. Scaricalo, poi torna qui: la cartella del progetto è già pronta.</Text>
            <Btn icon="download" label="Scarica Obsidian" onPress={() => window.open('https://obsidian.md/download', '_blank')} style={{ alignSelf: 'flex-start' }} />
          </>
        ) : registered ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <IconWell icon="check" tint="purple" />
            <Text style={[t(400, 13.5, 1.55, { color: c.ink2 }), { flex: 1 }]}>
              La cartella è aperta come vault in Obsidian. Da ora «Apri in Obsidian» porta direttamente alla nota di questo progetto.
            </Text>
          </View>
        ) : (
          <>
            <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>Un solo passaggio, da fare una volta in Obsidian:</Text>
            <Step n={1} text="Apri Obsidian" />
            <Step n={2} text="Scegli «Apri cartella come vault» (Open folder as vault)" />
            <Step n={3} text="Seleziona questa cartella:" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 34 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.mono, fontSize: 12.5, color: c.ink, padding: 10, borderRadius: radius.md, backgroundColor: c.fill05 }}>
                {root}
              </Text>
              <Btn height={32} icon="content_copy" label="Copia" onPress={() => lore.copy(root)} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <Icon name="progress_activity" size={16} color={c.ink3} />
              <Text style={t(400, 12, 1.4, { color: c.ink3 })}>In attesa che Obsidian apra la cartella…</Text>
            </View>
          </>
        )}
      </View>
      <DialogFooter>
        {installed && !registered ? <Btn icon="open_in_new" label="Apri Obsidian" onPress={() => lore.launchObsidian()} /> : null}
        <Btn label={registered ? 'Chiudi' : 'Più tardi'} onPress={onClose} />
        {registered ? (
          <Btn
            variant="primary"
            icon="open_in_new"
            label="Apri in Obsidian"
            onPress={() => {
              onClose();
              const r = app.route;
              app.openInObsidian(r.name === 'file' && r.path.startsWith(`${project.key}/`) ? r.path : project.key);
            }}
          />
        ) : null}
      </DialogFooter>
    </DialogFrame>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.purple16, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={t(600, 12, 1, { color: c.purpleTint })}>{n}</Text>
      </View>
      <Text style={t(400, 13.5, 1.4, { color: c.ink })}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Many files vanished from the vault at once: ask before deleting in the cloud.
// ---------------------------------------------------------------------------
export function VaultConfirmDialog({ count, paths, onClose }: { count: number; paths: string[]; onClose: () => void }) {
  const app = useApp();
  const answer = async (a: 'delete' | 'restore') => {
    onClose();
    await lore.vaultConfirm(a);
    await app.refreshVault();
    app.toast({ icon: a === 'delete' ? 'delete' : 'restore_from_trash', text: a === 'delete' ? `${count} file eliminati anche dal cloud` : `${count} file ripristinati dal cloud` });
  };
  return (
    <DialogFrame width={500} onDismiss={onClose}>
      <View style={{ padding: 24, paddingBottom: 16, flexDirection: 'row', gap: 16 }}>
        <IconWell icon="warning" tint="danger" size={40} />
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={t(600, 18, 1.3, { letterSpacing: -0.36 })}>Sono spariti {count} file dalla copia locale</Text>
          <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>
            Può essere voluto o un incidente (cartella svuotata, disco scollegato). La sincronizzazione è in pausa finché non scegli.
          </Text>
          <View style={{ gap: 3, marginTop: 4 }}>
            {paths.map((p) => (
              <Text key={p} numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12, color: c.ink3 }}>
                {p}
              </Text>
            ))}
            {count > paths.length ? <Text style={t(400, 12, 1.4, { color: c.ink3 })}>…e altri {count - paths.length}</Text> : null}
          </View>
        </View>
      </View>
      <DialogFooter border={false}>
        <Btn variant="danger" label="Elimina anche dal cloud" onPress={() => answer('delete')} />
        <View style={{ flex: 1 }} />
        <Btn variant="primary" label="Ripristina dal cloud" onPress={() => answer('restore')} />
      </DialogFooter>
    </DialogFrame>
  );
}
