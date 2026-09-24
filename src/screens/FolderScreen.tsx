import React, { useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, font, radius, t } from '../theme';
import { useApp } from '../state/app';
import { openItemMenu } from '../state/actions';
import { countFiles, fileKind, findNode, relTime } from '../kb/paths';
import type { FileNode, FolderNode } from '../kb/types';
import { Btn, eventPoint, Hover, Icon, IconBtn, IconWell, Progress } from '../ui/primitives';
import { FileTable } from '../ui/FileTable';
import { anchorBelow } from '../ui/overlays';
import { EmptyState } from './common';

export function FolderScreen({ path }: { path: string }) {
  const app = useApp();
  const node = findNode(app.tree, path);
  const newRef = useRef<View>(null);
  const moreRef = useRef<View>(null);

  if (!node || node.kind !== 'folder') {
    return <EmptyState icon="folder_off" title="Cartella non trovata" body={`${path} non esiste più.`} action={{ label: 'Torna ai progetti', onPress: () => app.navigate({ name: 'projects' }) }} />;
  }

  const isProject = !path.includes('/');
  const index = node.children.find((n) => n.kind === 'file' && fileKind(n.path) === 'index') as FileNode | undefined;
  const checklist = node.children.find((n) => n.kind === 'file' && fileKind(n.path) === 'checklist') as FileNode | undefined;
  const rows = isProject ? node.children.filter((n) => n !== index && n !== checklist) : node.children;
  const n = countFiles(node);
  // Your edits after the last compile mean the agents still have to regenerate index.md.
  const stale = !!index && app.activity.some((a) => a.by === 'you' && a.at > index.mtime + 1000 && a.path.startsWith(path + '/') && fileKind(a.path) !== 'index');

  const openNewMenu = () => {
    const a = anchorBelow(newRef.current);
    app.setMenu({
      x: a.x + a.width - 220,
      y: a.y,
      width: 220,
      items: [
        { icon: 'note_add', label: 'Nuovo file', kbd: '⌘N', onPress: () => app.openDialog({ kind: 'newFile', dir: path }) },
        { icon: 'create_new_folder', label: 'Nuova cartella', kbd: '⇧⌘N', onPress: () => app.openDialog({ kind: 'newFolder', dir: path }) },
        ...(isProject && !checklist ? [{ icon: 'checklist', label: 'Crea checklist.md', onPress: () => app.ops.createFile(`${path}/checklist.md`, '## Da fare\n\n- [ ] \n') }] : []),
      ],
    });
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 34, paddingHorizontal: 44, gap: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={t(700, 28, 1.15, { letterSpacing: -0.98 })}>
            {node.name}
          </Text>
          <Text numberOfLines={1} style={t(400, 13.5, 1.2, { color: c.ink3, marginTop: 9 })}>
            {[index?.summary, `${n} file`, `modificato ${relTime(node.mtime)}`].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <View ref={moreRef}>
          <IconBtn
            icon="more_horiz"
            onPress={() => {
              const a = anchorBelow(moreRef.current);
              openItemMenu(app, path, a.x + a.width - 250, a.y);
            }}
          />
        </View>
        <View ref={newRef}>
          <Btn variant="primary" icon="add" label="Nuovo" iconRight="expand_more" onPress={openNewMenu} />
        </View>
      </View>

      {isProject ? (
        <View style={{ flexDirection: 'row', gap: 14 }}>
          {index ? (
            <SpecialCard
              node={index}
              icon="auto_awesome"
              tint="info"
              subtitle={stale ? 'In attesa di rigenerazione…' : `Generato · sola lettura · ${relTime(index.mtime)}`}
              subtitleColor={stale ? c.info : undefined}
              trailing={<Icon name={stale ? 'sync' : 'lock'} size={16} color={stale ? c.info : c.ink3} />}
            />
          ) : (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: c.hair }}>
              <IconWell icon="auto_awesome" tint="info" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.mono, fontSize: 13.5, fontWeight: '500', color: c.ink2 }}>index.md</Text>
                <Text style={t(400, 12, 1.3, { color: c.ink3, marginTop: 3 })}>Non ancora generato dagli agenti</Text>
              </View>
            </View>
          )}
          {checklist ? (
            <SpecialCard
              node={checklist}
              icon="checklist"
              tint="purple"
              body={
                checklist.total ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 }}>
                    <Progress value={checklist.done! / checklist.total} />
                    <Text style={t(600, 11, 1, { color: c.ink3 })}>
                      {checklist.done}/{checklist.total}
                    </Text>
                  </View>
                ) : (
                  <Text style={t(400, 12, 1.3, { color: c.ink3, marginTop: 3 })}>Nessuna voce</Text>
                )
              }
            />
          ) : (
            <Hover
              onPress={() => app.ops.createFile(`${path}/checklist.md`, '## Da fare\n\n- [ ] \n')}
              style={({ hovered }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.card, borderWidth: 1, borderStyle: 'dashed', borderColor: hovered ? c.purple40 : c.hair })}
            >
              <IconWell icon="add_task" tint="purple" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.mono, fontSize: 13.5, fontWeight: '500', color: c.ink2 }}>checklist.md</Text>
                <Text style={t(400, 12, 1.3, { color: c.ink3, marginTop: 3 })}>Crea la checklist del progetto</Text>
              </View>
            </Hover>
          )}
        </View>
      ) : null}

      <FileTable
        rows={rows}
        columns={['size', 'modified', 'author']}
        empty={isProject ? 'Nessun altro file. Usa “Nuovo” per aggiungerne uno.' : 'Cartella vuota'}
      />
    </ScrollView>
  );
}

function SpecialCard({
  node,
  icon,
  tint,
  subtitle,
  subtitleColor,
  body,
  trailing,
}: {
  node: FileNode | FolderNode;
  icon: string;
  tint: 'info' | 'purple';
  subtitle?: string;
  subtitleColor?: string;
  body?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const app = useApp();
  return (
    <Hover
      onPress={() => app.navigate({ name: 'file', path: node.path })}
      onContextMenu={(e: any) => {
        e.preventDefault();
        const pt = eventPoint(e);
        openItemMenu(app, node.path, pt.x, pt.y);
      }}
      style={({ hovered }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.card, borderWidth: 1, borderColor: hovered ? c.purple40 : c.hair, backgroundColor: hovered ? c.cell2 : c.cell })}
    >
      <IconWell icon={icon} tint={tint} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: font.mono, fontSize: 13.5, fontWeight: '500', color: c.ink }}>{node.name}</Text>
        {subtitle ? <Text style={t(400, 12, 1.3, { color: subtitleColor ?? c.ink3, marginTop: 3 })}>{subtitle}</Text> : null}
        {body}
      </View>
      {trailing}
    </Hover>
  );
}
