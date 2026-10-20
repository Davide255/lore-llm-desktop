import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { c, font, radius, t } from '../theme';
import { useApp } from '../state/app';
import { lore } from '../kb/bridge';
import type { LinkFormat, VaultPreview } from '../kb/types';
import { plural } from '../kb/paths';
import { Btn, FieldLabel, Hover, Icon, IconWell, InfoStrip, Segmented, Toggle } from '../ui/primitives';
import { DialogFooter, DialogFrame, DialogTitle } from '../ui/overlays';

// ---------------------------------------------------------------------------
// Setup: choose the folder, first sync, then open it in Obsidian.
// ---------------------------------------------------------------------------
export function VaultSetupDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const enabled = !!app.vault?.enabled;
  const [step, setStep] = useState<'folder' | 'obsidian'>(enabled ? 'obsidian' : 'folder');
  return step === 'folder' ? <FolderStep onClose={onClose} onDone={() => setStep('obsidian')} /> : <ObsidianStep onClose={onClose} />;
}

function FolderStep({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const [root, setRoot] = useState(app.vault?.root ?? app.vault?.defaultRoot ?? '');
  const [linkFormat, setLinkFormat] = useState<LinkFormat>(app.vault?.linkFormat ?? 'markdown');
  const [preview, setPreview] = useState<VaultPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPreview(null);
    lore
      .vaultPreview(root || undefined)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [root]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await lore.vaultEnable({ root: root || undefined, linkFormat });
      await app.refreshVault();
      app.toast({ icon: 'cloud_done', text: 'Copia locale attiva' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogFrame width={560} onDismiss={onClose} onSubmit={preview?.ok && !busy ? enable : undefined}>
      <DialogTitle onClose={onClose}>Copia locale per Obsidian</DialogTitle>
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 16 }}>
        <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>
          Lore crea una cartella con un file .md per ogni nota e la tiene sincronizzata con il cloud. Aprila in Obsidian come vault: quello che salvi lì arriva agli agenti, e le loro modifiche arrivano a te.
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
          <PreviewLine preview={preview} />
        </View>
        <View style={{ gap: 6 }}>
          <FieldLabel>Link nelle nuove note</FieldLabel>
          <Segmented
            width={300}
            value={linkFormat}
            onChange={setLinkFormat}
            options={[
              { value: 'markdown', label: 'Markdown [x](x.md)' },
              { value: 'wikilink', label: '[[Wikilink]]' },
            ]}
          />
          <Text style={t(400, 12, 1.45, { color: c.ink3 })}>
            I link Markdown funzionano ovunque (agenti, app mobile). Lore mostra comunque anche i [[wikilink]]. Vale solo per una cartella mai aperta in Obsidian.
          </Text>
        </View>
        {error ? (
          <InfoStrip icon="error" style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
            <Text style={t(400, 13, 1.45, { color: c.danger })}>{error}</Text>
          </InfoStrip>
        ) : null}
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="primary" label={busy ? 'Sincronizzazione…' : 'Attiva'} disabled={!preview?.ok || busy} onPress={enable} />
      </DialogFooter>
    </DialogFrame>
  );
}

function PreviewLine({ preview }: { preview: VaultPreview | null }) {
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

function ObsidianStep({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const root = app.vault?.root ?? '';
  const { installed, registered } = app.obsidian;
  const { refreshVault } = app;

  // Obsidian has no link that adds a vault: wait for the user to open the folder there.
  useEffect(() => {
    if (registered) return;
    const id = setInterval(() => refreshVault().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, [registered, refreshVault]);

  return (
    <DialogFrame width={560} onDismiss={onClose}>
      <DialogTitle onClose={onClose}>Apri in Obsidian</DialogTitle>
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 14 }}>
        {!installed ? (
          <>
            <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>Obsidian non risulta installato. Scaricalo, poi torna qui: la copia locale è già pronta.</Text>
            <Btn icon="download" label="Scarica Obsidian" onPress={() => window.open('https://obsidian.md/download', '_blank')} style={{ alignSelf: 'flex-start' }} />
          </>
        ) : registered ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <IconWell icon="check" tint="purple" />
            <Text style={[t(400, 13.5, 1.55, { color: c.ink2 }), { flex: 1 }]}>
              La cartella è aperta come vault in Obsidian. Da ora «Apri in Obsidian» porta direttamente alla nota.
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
              app.openInObsidian(r.name === 'file' ? r.path : undefined);
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

// ---------------------------------------------------------------------------
export function VaultDisableDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [deleteLocal, setDeleteLocal] = useState(false);
  const submit = async () => {
    onClose();
    await lore.vaultDisable({ deleteLocal });
    await app.refreshVault();
    if (app.prefs.defaultEditor === 'obsidian') app.setPrefs({ defaultEditor: 'lore' });
    app.toast({ icon: 'cloud_off', text: deleteLocal ? 'Copia locale disattivata e spostata nel cestino' : 'Copia locale disattivata' });
  };
  return (
    <DialogFrame width={480} onDismiss={onClose} onSubmit={submit}>
      <DialogTitle onClose={onClose}>Disattivare la copia locale?</DialogTitle>
      <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 20, gap: 14 }}>
        <Text style={t(400, 13.5, 1.55, { color: c.ink2 })}>
          Le modifiche in sospeso vengono caricate prima di fermarsi. Da quel momento quello che cambi nella cartella non arriva più al cloud.
        </Text>
        <Hover onPress={() => setDeleteLocal(!deleteLocal)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Toggle value={deleteLocal} onChange={setDeleteLocal} />
          <Text style={t(400, 13.5, 1.4, { color: c.ink })}>Sposta anche la cartella nel cestino</Text>
        </Hover>
      </View>
      <DialogFooter>
        <Btn label="Annulla" onPress={onClose} />
        <Btn variant="danger" label="Disattiva" onPress={submit} />
      </DialogFooter>
    </DialogFrame>
  );
}
