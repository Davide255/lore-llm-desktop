import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, font, radius, t } from '../theme';
import { useApp } from '../state/app';
import { openItemMenu } from '../state/actions';
import { isWeb, lore } from '../kb/bridge';
import { attachmentIcon, attachmentLabel, backlinks as linksTo, isImage, officeKind } from '../kb/links';
import { basename, filePaths, findNode, formatSize, longDate, relTime } from '../kb/paths';
import { Btn, Hover, Icon, IconBtn, useCompact } from '../ui/primitives';
import { anchorBelow } from '../ui/overlays';
import { useAssetUrl } from '../ui/Markdown';
import { EmptyState, FileBar, Rail, RailHeading, useWidth } from './common';

/** An image, PDF or Office file stored in the knowledge base (usually pasted in Obsidian or uploaded). */
export function AttachmentScreen({ path }: { path: string }) {
  const app = useApp();
  const node = findNode(app.tree, path);
  const { width, onLayout } = useWidth();
  const compact = useCompact();
  const [usedBy, setUsedBy] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const src = useAssetUrl(path, () => setFailed(true));
  const moreRef = useRef<View>(null);
  const image = isImage(path);
  const office = officeKind(path);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let live = true;
    lore.links().then((index) => live && setUsedBy(linksTo(path, index, filePaths(app.tree)).slice(0, 12)));
    return () => {
      live = false;
    };
  }, [path, app.tree, app.revision]);

  if (!node || node.kind !== 'file') return <EmptyState icon="hide_image" title="Allegato non trovato" body={path} />;

  // The system's answer when it can't open the file (no app for .xlsx, …) is shown as it is.
  const open = () => {
    if (opening) return;
    setOpening(true);
    lore
      .openAttachment(path)
      .then((err) => {
        if (err) app.toast({ icon: 'error', text: `Impossibile aprire l’allegato: ${err}`, ttl: 6000 });
      })
      .catch((e) => {
        const why = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
        app.toast({ icon: 'error', text: why ? `Impossibile aprire l’allegato: ${why}` : 'Impossibile aprire l’allegato', ttl: 6000 });
      })
      .finally(() => setOpening(false));
  };
  // A browser can't hand the file to Word or Excel: it saves it instead.
  const download = !!office && isWeb;

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <FileBar title={basename(path)} subtitle={`${formatSize(node.size)} · ${office ? attachmentLabel(path) : (node.mime ?? 'allegato')} · caricato ${relTime(node.mtime)}`}>
        <IconBtn icon="ios_share" title="Copia link" onPress={() => app.ops.copyLink(path)} />
        <View ref={moreRef}>
          <IconBtn
            icon="more_horiz"
            onPress={() => {
              const a = anchorBelow(moreRef.current);
              openItemMenu(app, path, a.x + a.width - 250, a.y);
            }}
          />
        </View>
        <Btn variant="tint" icon={download ? 'download' : 'open_in_new'} label={download ? 'Scarica' : 'Apri'} onPress={open} disabled={opening} />
      </FileBar>
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: compact ? 16 : 40, alignItems: 'center' }}>
          {office ? (
            <View style={{ alignItems: 'center', gap: 12, padding: compact ? 28 : 48, borderRadius: radius.xl, backgroundColor: c.cell, maxWidth: 520, width: '100%' }}>
              <Icon name={attachmentIcon(path)} size={48} color={c.blueTint} />
              <Text style={{ fontFamily: font.mono, fontSize: 13, color: c.ink, textAlign: 'center' }}>{basename(path)}</Text>
              <Text style={t(400, 12.5, 1.4, { color: c.ink3 })}>
                {attachmentLabel(path)}
                {node.size ? ` · ${formatSize(node.size)}` : ''}
              </Text>
              <Btn
                variant="primary"
                icon={download ? 'download' : 'open_in_new'}
                label={download ? 'Scarica il file' : 'Apri con l’app predefinita'}
                onPress={open}
                disabled={opening}
                style={{ marginTop: 6 }}
              />
              <Text style={t(400, 12, 1.5, { color: c.ink3, textAlign: 'center' })}>
                {download
                  ? 'Aprilo con Word, Excel, PowerPoint o LibreOffice dopo il download.'
                  : 'Si apre con Word, Excel, PowerPoint o l’app impostata nel sistema.'}
              </Text>
            </View>
          ) : image && !failed ? (
            <img
              src={src}
              alt={basename(path)}
              onError={() => setFailed(true)}
              style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: radius.lg, background: c.cell, objectFit: 'contain' }}
            />
          ) : (
            <Hover onPress={open} style={{ alignItems: 'center', gap: 12, padding: compact ? 28 : 48, borderRadius: radius.xl, backgroundColor: c.cell }}>
              <Icon name={image ? 'broken_image' : 'picture_as_pdf'} size={48} color={c.blueTint} />
              <Text style={{ fontFamily: font.mono, fontSize: 13, color: c.ink }}>{basename(path)}</Text>
              <Text style={t(400, 12.5, 1.4, { color: c.ink3 })}>{image ? 'Anteprima non disponibile' : 'Apri con l’app predefinita'}</Text>
            </Hover>
          )}
        </ScrollView>
        {!compact && width > 980 ? (
          <Rail>
            {usedBy.length ? (
              <>
                <RailHeading>Usato in</RailHeading>
                <View style={{ gap: 8, marginBottom: 26 }}>
                  {usedBy.map((b) => (
                    <Hover key={b} onPress={() => app.navigate({ name: 'file', path: b })} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Icon name="description" size={15} color={c.ink3} />
                      <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12, color: c.purpleTint, flex: 1 }}>
                        {basename(b)}
                      </Text>
                    </Hover>
                  ))}
                </View>
              </>
            ) : null}
            <RailHeading>Dettagli</RailHeading>
            <Text style={t(400, 12.5, 1.8, { color: c.ink2 })}>
              {formatSize(node.size)}
              {'\n'}
              Caricato il {longDate(node.mtime)}
              {'\n'}
              Gli agenti lo vedono nell’elenco ma non lo leggono
            </Text>
          </Rail>
        ) : null}
      </View>
    </View>
  );
}
