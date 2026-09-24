import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { openItemMenu } from '../state/actions';
import { allFiles, countFiles, projectIcon, projects, relTime } from '../kb/paths';
import type { FileNode, FolderNode } from '../kb/types';
import { Btn, eventPoint, Hover, Icon, IconWell, Progress, SectionLabel } from '../ui/primitives';
import { FileTable } from '../ui/FileTable';
import { EmptyState, useWidth } from './common';

export function ProjectsScreen() {
  const app = useApp();
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const { width, onLayout } = useWidth();
  const list = projects(app.tree).slice();
  if (sort === 'recent') list.sort((a, b) => b.mtime - a.mtime);
  const files = allFiles(app.tree) as FileNode[];
  const recent = files.slice().sort((a, b) => b.mtime - a.mtime).slice(0, 6);
  const cols = width > 900 ? 3 : 2;
  const gap = 16;
  const cardW = (width - gap * (cols - 1)) / cols;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 40, paddingHorizontal: 44, gap: 32 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={t(700, 30, 1.15, { letterSpacing: -1.05 })}>Progetti</Text>
          <Text style={t(400, 13.5, 1, { color: c.ink3, marginTop: 9 })}>
            {list.length} {list.length === 1 ? 'progetto' : 'progetti'} · {files.length} file
          </Text>
        </View>
        <Btn icon="sort" label={sort === 'recent' ? 'Recenti' : 'Nome'} onPress={() => setSort(sort === 'recent' ? 'name' : 'recent')} />
        <Btn variant="primary" icon="add" label="Nuovo progetto" onPress={() => app.openDialog({ kind: 'newProject' })} />
      </View>

      {!list.length ? (
        <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: c.hair, borderRadius: radius.card, minHeight: 280 }}>
          <EmptyState
            icon="create_new_folder"
            title="Nessun progetto"
            body="Ogni sottocartella della knowledge base è un progetto. Creane uno per iniziare: gli agenti troveranno lì index.md e checklist.md."
            action={{ label: 'Nuovo progetto', icon: 'add', onPress: () => app.openDialog({ kind: 'newProject' }) }}
          />
        </View>
      ) : (
        <View onLayout={onLayout} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {list.map((p) => (
            <View key={p.path} style={{ width: cardW }}>
              <ProjectCard project={p} />
            </View>
          ))}
          <View style={{ width: cardW }}>
            <Hover
              onPress={() => app.openDialog({ kind: 'newProject' })}
              style={({ hovered }) => ({
                minHeight: 136,
                height: '100%',
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: hovered ? c.purple40 : c.hair,
                borderRadius: radius.card,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              })}
            >
              <Icon name="add" size={19} color={c.ink3} />
              <Text style={t(500, 13.5, 1, { color: c.ink3 })}>Nuovo progetto</Text>
            </Hover>
          </View>
        </View>
      )}

      {recent.length ? (
        <View>
          <SectionLabel>Modificati di recente</SectionLabel>
          <FileTable rows={recent} columns={['project', 'modified', 'author']} header={false} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function ProjectCard({ project }: { project: FolderNode }) {
  const app = useApp();
  const pi = projectIcon(project.name);
  const index = project.children.find((n) => n.kind === 'file' && n.name.toLowerCase() === 'index.md') as FileNode | undefined;
  const checklist = project.children.find((n) => n.kind === 'file' && n.name.toLowerCase() === 'checklist.md') as FileNode | undefined;
  const n = countFiles(project);
  return (
    <Hover
      onPress={() => app.navigate({ name: 'folder', path: project.path })}
      onContextMenu={(e: any) => {
        e.preventDefault();
        const pt = eventPoint(e);
        openItemMenu(app, project.path, pt.x, pt.y);
      }}
      style={({ hovered }) => [
        { gap: 12, padding: 18, borderRadius: radius.card, borderWidth: 1, borderColor: hovered ? c.purple40 : c.hair, backgroundColor: hovered ? c.cell2 : c.cell, height: '100%' },
        web({ transition: 'background-color .15s, border-color .15s' }),
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <IconWell icon={pi.icon} tint={pi.tint === 'blue' ? 'blue' : 'purple'} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={t(600, 15, 1.2, { letterSpacing: -0.22 })}>
            {project.name}
          </Text>
          <Text style={t(400, 12, 1.3, { color: c.ink3, marginTop: 3 })}>
            {n} file · {relTime(project.mtime)}
          </Text>
        </View>
        <Hover
          onPress={(e: any) => {
            const pt = eventPoint(e);
            openItemMenu(app, project.path, pt.x, pt.y);
          }}
          style={({ hovered }) => ({ borderRadius: 6, padding: 2, backgroundColor: hovered ? c.fill08 : 'transparent' })}
        >
          <Icon name="more_horiz" size={18} color={c.ink3} />
        </Hover>
      </View>
      <Text numberOfLines={2} style={t(400, 13, 1.5, { color: index?.summary ? c.ink2 : c.ink3 })}>
        {index?.summary || (index ? 'index.md in attesa di un riepilogo.' : 'Nessun index.md: verrà generato dagli agenti.')}
      </Text>
      <View style={{ flex: 1 }} />
      {checklist && checklist.total ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <Progress value={checklist.done! / checklist.total} />
          <Text style={t(600, 11, 1, { color: c.ink3 })}>
            {checklist.done}/{checklist.total}
          </Text>
        </View>
      ) : (
        <Text style={t(400, 11.5, 1, { color: c.ink3 })}>Nessuna checklist</Text>
      )}
    </Hover>
  );
}
