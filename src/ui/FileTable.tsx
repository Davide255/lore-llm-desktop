import React from 'react';
import { Text, View } from 'react-native';
import { c, font, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { editNode, openItemMenu, openRoute } from '../state/actions';
import { countFiles, fileKind, formatSize, projectLabel, projectOf, relTime } from '../kb/paths';
import type { AgentRef, Author, PendingUpload, TreeNode } from '../kb/types';
import { eventPoint, Hover, Icon, Progress, useCompact } from './primitives';
import { AuthorChip } from './identity';

export type Column = 'size' | 'project' | 'modified' | 'author';

const WIDTH: Record<Column, number> = { size: 130, project: 150, modified: 150, author: 160 };
const LABEL: Record<Column, string> = { size: 'Dimensione', project: 'Progetto', modified: 'Modificato', author: 'Autore' };

export function FileIcon({ node, size = 18 }: { node: Pick<TreeNode, 'kind' | 'path'>; size?: number }) {
  if (node.kind === 'folder') return <Icon name="folder" filled size={size} color={c.blueTint} />;
  const k = fileKind(node.path);
  if (k === 'index') return <Icon name="auto_awesome" size={size - 1} color={c.info} />;
  if (k === 'checklist') return <Icon name="checklist" size={size - 1} color={c.purpleTint} />;
  if (k === 'attachment') return <Icon name={/\.pdf$/i.test(node.path) ? 'picture_as_pdf' : 'image'} size={size - 1} color={c.blueTint} />;
  return <Icon name="description" size={size - 1} color={c.ink3} />;
}

export function AuthorCell({ author, agent }: { author: Author; agent?: AgentRef }) {
  return <AuthorChip author={author} agent={agent} />;
}

export function FileTable({ rows, columns: wanted, header = true, empty, pending = [] }: { rows: TreeNode[]; columns: Column[]; header?: boolean; empty?: string; pending?: PendingUpload[] }) {
  const app = useApp();
  // A phone keeps the name and when it changed.
  const compact = useCompact();
  const columns = compact ? wanted.filter((col) => col === 'modified') : wanted;
  const width = (col: Column) => (compact ? 84 : WIDTH[col]);
  const padX = compact ? 14 : 18;
  return (
    <View style={{ borderWidth: 1, borderColor: c.hair, borderRadius: radius.card, overflow: 'hidden' }}>
      {header ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 38, paddingHorizontal: padX, backgroundColor: 'rgba(250,249,245,.02)' }}>
          <Text style={[headStyle, { flex: 1 }]}>Nome</Text>
          {columns.map((col) => (
            <Text key={col} style={[headStyle, { width: width(col) }]}>
              {LABEL[col]}
            </Text>
          ))}
        </View>
      ) : null}
      {pending.map((u, i) => (
        <PendingRow key={u.id} upload={u} columns={columns} width={width} padX={padX} first={i === 0 && !header} />
      ))}
      {rows.map((n, i) => {
        const ctx = app.menu?.target === n.path;
        return (
          <Hover
            key={n.path}
            onPress={() => app.navigate(openRoute(n))}
            onDoubleClick={() => n.kind === 'file' && editNode(app, n)}
            onContextMenu={(e: any) => {
              e.preventDefault();
              const pt = eventPoint(e);
              openItemMenu(app, n.path, pt.x, pt.y);
            }}
            style={({ hovered }) => [
              { flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, paddingHorizontal: padX, borderTopWidth: i === 0 && !header && !pending.length ? 0 : 1, borderColor: c.hair, backgroundColor: ctx ? c.purple14 : hovered ? c.fill04 : 'transparent' },
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
              <View key={col} style={{ width: width(col) }}>
                {col === 'author' ? (
                  n.kind === 'file' ? <AuthorCell author={n.author} agent={n.agent} /> : <Text style={t(400, 13, 1, { color: c.ink3 })}>—</Text>
                ) : (
                  <Text numberOfLines={1} style={t(400, 13, 1.2, { color: col === 'project' ? c.ink2 : c.ink3 })}>
                    {col === 'size' ? (n.kind === 'folder' ? `${countFiles(n)} file` : formatSize(n.size)) : col === 'project' ? (projectOf(n.path) ? projectLabel(n.path) : 'Radice') : relTime(n.mtime)}
                  </Text>
                )}
              </View>
            ))}
          </Hover>
        );
      })}
      {!rows.length && !pending.length && empty ? (
        <View style={{ height: 64, alignItems: 'center', justifyContent: 'center', borderTopWidth: header ? 1 : 0, borderColor: c.hair }}>
          <Text style={t(400, 13, 1, { color: c.ink3 })}>{empty}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** A file on its way up: greyed out and not openable, with a bar that follows the bytes sent. */
function PendingRow({ upload: u, columns, width, padX, first }: { upload: PendingUpload; columns: Column[]; width: (col: Column) => number; padX: number; first: boolean }) {
  const pct = Math.min(100, Math.floor((u.sent / u.size) * 100));
  const status = !u.started ? 'In attesa' : pct >= 100 ? 'Salvataggio…' : 'Caricamento…';
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${u.name}: ${status} ${pct}%`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, height: 48, paddingHorizontal: padX, borderTopWidth: first ? 0 : 1, borderColor: c.hair, backgroundColor: c.fill04 }}
    >
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <View style={{ opacity: 0.45 }}>
          <FileIcon node={u.files ? { kind: 'folder', path: u.path } : { kind: 'file', path: u.path }} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Text numberOfLines={1} style={u.files ? t(400, 13, 1.2, { color: c.ink3 }) : { fontFamily: font.mono, fontSize: 13, color: c.ink3 }}>
            {u.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <Progress value={pct / 100} height={3} />
            <Text style={[t(600, 11, 1, { color: c.ink3 }), { width: 34, textAlign: 'right' }]}>{pct}%</Text>
          </View>
        </View>
      </View>
      {columns.map((col) => (
        <View key={col} style={{ width: width(col) }}>
          <Text numberOfLines={1} style={t(400, 13, 1.2, { color: c.ink3 })}>
            {col === 'size' ? (u.files ? `${u.files} file` : formatSize(u.size)) : col === 'modified' ? status : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const headStyle = t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3 });
