import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, font, radius, t } from '../theme';
import { useApp } from '../state/app';
import { openItemMenu } from '../state/actions';
import { lore } from '../kb/bridge';
import { assetUrl, backlinks as linksTo, isImage } from '../kb/links';
import { basename, filePaths, findNode, formatSize, longDate, relTime } from '../kb/paths';
import { Btn, Hover, Icon, IconBtn } from '../ui/primitives';
import { anchorBelow } from '../ui/overlays';
import { EmptyState, FileBar, Rail, RailHeading, useWidth } from './common';

/** An image or PDF stored in the knowledge base (usually pasted in Obsidian). */
export function AttachmentScreen({ path }: { path: string }) {
  const app = useApp();
  const node = findNode(app.tree, path);
  const { width, onLayout } = useWidth();
  const [usedBy, setUsedBy] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const moreRef = useRef<View>(null);
  const image = isImage(path);

  useEffect(() => {
    let live = true;
    lore.links().then((index) => live && setUsedBy(linksTo(path, index, filePaths(app.tree)).slice(0, 12)));
    return () => {
      live = false;
    };
  }, [path, app.tree, app.revision]);

  if (!node || node.kind !== 'file') return <EmptyState icon="hide_image" title="Allegato non trovato" body={path} />;

  const open = () => lore.openAttachment(path).catch(() => app.toast({ icon: 'error', text: 'Impossibile aprire l’allegato' }));

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <FileBar title={basename(path)} subtitle={`${formatSize(node.size)} · ${node.mime ?? 'allegato'} · caricato ${relTime(node.mtime)}`}>
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
        <Btn variant="tint" icon="open_in_new" label="Apri" onPress={open} />
      </FileBar>
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 40, alignItems: 'center' }}>
          {image && !failed ? (
            <img
              src={assetUrl(path)}
              alt={basename(path)}
              onError={() => setFailed(true)}
              style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: radius.lg, background: c.cell, objectFit: 'contain' }}
            />
          ) : (
            <Hover onPress={open} style={{ alignItems: 'center', gap: 12, padding: 48, borderRadius: radius.xl, backgroundColor: c.cell }}>
              <Icon name={image ? 'broken_image' : 'picture_as_pdf'} size={48} color={c.blueTint} />
              <Text style={{ fontFamily: font.mono, fontSize: 13, color: c.ink }}>{basename(path)}</Text>
              <Text style={t(400, 12.5, 1.4, { color: c.ink3 })}>{image ? 'Anteprima non disponibile' : 'Apri con l’app predefinita'}</Text>
            </Hover>
          )}
        </ScrollView>
        {width > 980 ? (
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
