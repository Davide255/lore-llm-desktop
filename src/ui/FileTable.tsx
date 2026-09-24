import React from 'react';
import { Text, View } from 'react-native';
import { c, font, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { openItemMenu, openRoute } from '../state/actions';
import { countFiles, fileKind, formatSize, projectOf, relTime } from '../kb/paths';
import type { TreeNode } from '../kb/types';
import { Avatar, eventPoint, Hover, Icon } from './primitives';

export type Column = 'size' | 'project' | 'modified' | 'author';

const WIDTH: Record<Column, number> = { size: 130, project: 150, modified: 150, author: 160 };
const LABEL: Record<Column, string> = { size: 'Dimensione', project: 'Progetto', modified: 'Modificato', author: 'Autore' };

export function FileIcon({ node, size = 18 }: { node: TreeNode; size?: number }) {
  if (node.kind === 'folder') return <Icon name="folder" filled size={size} color={c.blueTint} />;
  const k = fileKind(node.path);
  if (k === 'index') return <Icon name="auto_awesome" size={size - 1} color={c.info} />;
  if (k === 'checklist') return <Icon name="checklist" size={size - 1} color={c.purpleTint} />;
  return <Icon name="description" size={size - 1} color={c.ink3} />;
}

export function AuthorCell({ author }: { author: 'you' | 'agent' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {author === 'you' ? <Avatar initials="TU" size={22} /> : <Avatar initials="AG" size={22} color={c.purple} />}
      <Text style={t(400, 13, 1, { color: c.ink2 })}>{author === 'you' ? 'Tu' : 'Agente'}</Text>
    </View>
  );
}

export function FileTable({ rows, columns, header = true, empty }: { rows: TreeNode[]; columns: Column[]; header?: boolean; empty?: string }) {
  const app = useApp();
  return (
    <View style={{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden' }}>
      {header ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 38, paddingHorizontal: 18, backgroundColor: 'rgba(250,249,245,.02)' }}>
          <Text style={[headStyle, { flex: 1 }]}>Nome</Text>
          {columns.map((col) => (
            <Text key={col} style={[headStyle, { width: WIDTH[col] }]}>
              {LABEL[col]}
            </Text>
          ))}
        </View>
      ) : null}
      {rows.map((n, i) => {
        const ctx = app.menu?.target === n.path;
        return (
          <Hover
            key={n.path}
            onPress={() => app.navigate(openRoute(n))}
            onDoubleClick={() => n.kind === 'file' && fileKind(n.path) !== 'index' && app.navigate(openRoute(n, true))}
            onContextMenu={(e: any) => {
              e.preventDefault();
              const pt = eventPoint(e);
              openItemMenu(app, n.path, pt.x, pt.y);
            }}
            style={({ hovered }) => [
              { flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, paddingHorizontal: 18, borderTopWidth: i === 0 && !header ? 0 : 1, borderColor: c.hair, backgroundColor: ctx ? c.purple14 : hovered ? c.fill04 : 'transparent' },
              ctx && web({ boxShadow: 'inset 0 0 0 1px rgba(143,92,255,.5)' }),
            ]}
          >
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <FileIcon node={n} />
              <Text numberOfLines={1} style={n.kind === 'file' ? { fontFamily: font.mono, fontSize: 13, color: c.ink, flexShrink: 1 } : t(400, 13, 1.2, { flexShrink: 1 })}>
                {n.name}
                {n.kind === 'folder' ? '/' : ''}
              </Text>
            </View>
            {columns.map((col) => (
              <View key={col} style={{ width: WIDTH[col] }}>
                {col === 'author' ? (
                  n.kind === 'file' ? <AuthorCell author={n.author} /> : <Text style={t(400, 13, 1, { color: c.ink3 })}>—</Text>
                ) : (
                  <Text numberOfLines={1} style={t(400, 13, 1.2, { color: col === 'project' ? c.ink2 : c.ink3 })}>
                    {col === 'size' ? (n.kind === 'folder' ? `${countFiles(n)} file` : formatSize(n.size)) : col === 'project' ? projectOf(n.path) ?? 'Radice' : relTime(n.mtime)}
                  </Text>
                )}
              </View>
            ))}
          </Hover>
        );
      })}
      {!rows.length && empty ? (
        <View style={{ height: 64, alignItems: 'center', justifyContent: 'center', borderTopWidth: header ? 1 : 0, borderColor: c.hair }}>
          <Text style={t(400, 13, 1, { color: c.ink3 })}>{empty}</Text>
        </View>
      ) : null}
    </View>
  );
}

const headStyle = t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3 });
