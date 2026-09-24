import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { c, font, radius, t, web } from '../theme';
import { useApp } from '../state/app';
import { openItemMenu, openRoute } from '../state/actions';
import { countFiles, fileKind, projectIcon, projects, relTime, rootFiles } from '../kb/paths';
import type { TreeNode } from '../kb/types';
import { Avatar, eventPoint, Hover, Icon, Kbd, Pill } from '../ui/primitives';

export function Sidebar() {
  const app = useApp();
  const { route } = app;
  const projs = projects(app.tree);
  const loose = rootFiles(app.tree);
  const onProjects = route.name === 'projects' || route.name === 'folder' || route.name === 'file';

  return (
    <View style={{ width: 252, backgroundColor: c.sidebar, borderRightWidth: 1, borderColor: c.hair, paddingVertical: 12, paddingHorizontal: 10 }}>
      <Hover
        onPress={() => app.setSearchOpen(true)}
        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingLeft: 10, paddingRight: 8, borderRadius: radius.md, backgroundColor: hovered ? c.fill08 : c.fill06 })}
      >
        <Icon name="search" size={17} color={c.ink3} />
        <Text style={[t(400, 13, 1, { color: c.ink3 }), { flex: 1 }]}>Cerca</Text>
        <Kbd>⌘K</Kbd>
      </Hover>

      <View style={{ gap: 2, marginTop: 10 }}>
        <NavItem icon="folder" label="Progetti" active={onProjects} onPress={() => app.navigate({ name: 'projects' })} />
        <NavItem
          icon="bolt"
          label="Attività"
          active={route.name === 'activity'}
          badge={app.unseen || undefined}
          onPress={() => app.navigate({ name: 'activity' })}
        />
        <NavItem icon="settings" label="Impostazioni" active={route.name === 'settings'} onPress={() => app.navigate({ name: 'settings' })} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 8, marginLeft: 10, marginRight: 8 }}>
        <Text style={[t(600, 10.5, 1, { letterSpacing: 0.84, textTransform: 'uppercase', color: c.ink3 }), { flex: 1 }]}>Progetti</Text>
        <Hover onPress={() => app.openDialog({ kind: 'newProject' })} style={({ hovered }) => ({ borderRadius: 5, backgroundColor: hovered ? c.fill08 : 'transparent' })} accessibilityLabel="Nuovo progetto">
          <Icon name="add" size={17} color={c.ink3} />
        </Hover>
      </View>

      <ScrollView style={{ flex: 1, marginHorizontal: -4 }} contentContainerStyle={{ gap: 1, paddingHorizontal: 4, paddingBottom: 12 }}>
        {projs.map((p) => (
          <TreeRow key={p.path} node={p} depth={0} />
        ))}
        {loose.length ? <View style={{ height: 1, backgroundColor: c.hair, marginVertical: 8, marginHorizontal: 8 }} /> : null}
        {loose.map((f) => (
          <TreeRow key={f.path} node={f} depth={0} />
        ))}
        {!projs.length && !loose.length ? <Text style={t(400, 12.5, 1.5, { color: c.ink3, paddingHorizontal: 10, paddingTop: 4 })}>Nessun progetto. Premi + per crearne uno.</Text> : null}
      </ScrollView>

      <AgentsFooter />
    </View>
  );
}

function NavItem({ icon, label, active, badge, onPress }: { icon: string; label: string; active: boolean; badge?: number; onPress: () => void }) {
  return (
    <Hover
      onPress={onPress}
      style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, height: 34, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: active ? c.purple16 : hovered ? c.fill05 : 'transparent' })}
    >
      <Icon name={icon} size={19} filled={active} color={active ? c.purpleTint : c.ink2} />
      <Text style={[t(500, 13.5, 1, { color: active ? c.ink : c.ink2 }), { flex: 1 }]}>{label}</Text>
      {badge ? <Pill label={String(badge)} bg={c.purple18} fg={c.purpleTint} style={{ paddingHorizontal: 7, paddingVertical: 2 }} /> : null}
    </Hover>
  );
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const app = useApp();
  const isFolder = node.kind === 'folder';
  const open = isFolder && app.expanded.has(node.path);
  const current = (app.route.name === 'file' || app.route.name === 'folder') && app.route.path === node.path;
  const ctx = app.menu?.target === node.path;
  const kind = node.kind === 'file' ? fileKind(node.path) : null;
  const isProject = depth === 0 && isFolder;
  const pad = depth === 0 ? 8 : 30 + (depth - 1) * 16;

  let icon: React.ReactNode;
  if (isProject) {
    const pi = projectIcon(node.name);
    icon = <Icon name={pi.icon} size={17} color={pi.tint === 'blue' ? c.blueTint : c.purpleTint} />;
  } else if (isFolder) icon = <Icon name="folder" filled size={16} color={c.blueTint} />;
  else if (kind === 'index') icon = <Icon name="auto_awesome" size={16} color={c.info} />;
  else if (kind === 'checklist') icon = <Icon name="checklist" size={16} color={c.purpleTint} />;
  else icon = <Icon name="description" size={16} color={c.ink3} />;

  const onPress = () => {
    if (isFolder) {
      if (current) app.toggleExpanded(node.path);
      else app.toggleExpanded(node.path, true);
    }
    app.navigate(openRoute(node));
  };

  return (
    <>
      <Hover
        onPress={onPress}
        onContextMenu={(e: any) => {
          e.preventDefault();
          const pt = eventPoint(e);
          openItemMenu(app, node.path, pt.x, pt.y);
        }}
        onDoubleClick={() => node.kind === 'file' && kind !== 'index' && app.navigate(openRoute(node, true))}
        style={({ hovered }) => [
          { flexDirection: 'row', alignItems: 'center', gap: 7, height: 30, paddingLeft: pad, paddingRight: 8, borderRadius: radius.sm, backgroundColor: current ? c.fill09 : hovered ? c.fill05 : 'transparent' },
          ctx && web({ boxShadow: `inset 0 0 0 1.5px ${c.purple}` }),
        ]}
      >
        {isProject ? (
          <Hover
            onPress={(e) => {
              (e as any).stopPropagation?.();
              app.toggleExpanded(node.path);
            }}
            style={{ marginLeft: -2 }}
          >
            <Icon name={open ? 'expand_more' : 'chevron_right'} size={16} color={c.ink3} />
          </Hover>
        ) : null}
        {icon}
        <Text
          numberOfLines={1}
          style={[
            node.kind === 'file' ? { fontFamily: font.mono, fontSize: 12.5, lineHeight: 15, color: current ? c.ink : c.ink2 } : t(isProject && open ? 500 : 400, 13, 1.15, { color: current || (isProject && open) ? c.ink : c.ink2 }),
            { flex: 1 },
          ]}
        >
          {node.name}
          {isFolder && !isProject ? '/' : ''}
        </Text>
        {isProject ? <Text style={t(400, 11, 1, { color: c.ink3 })}>{countFiles(node)}</Text> : null}
        {kind === 'index' ? <Icon name="lock" size={13} color={c.ink3} /> : null}
        {kind === 'checklist' && node.kind === 'file' && node.total ? (
          <Text style={t(500, 10.5, 1, { color: c.ink3 })}>
            {node.done}/{node.total}
          </Text>
        ) : null}
        {isFolder && !isProject ? (
          <Hover
            onPress={(e) => {
              (e as any).stopPropagation?.();
              app.toggleExpanded(node.path);
            }}
          >
            <Icon name={open ? 'expand_more' : 'chevron_right'} size={15} color={c.ink3} />
          </Hover>
        ) : null}
      </Hover>
      {open ? node.children.map((ch) => <TreeRow key={ch.path} node={ch} depth={depth + 1} />) : null}
    </>
  );
}

function AgentsFooter() {
  const app = useApp();
  const active = app.agents.filter((a) => a.active);
  const lastAgentWrite = app.activity.find((a) => a.by === 'agent');
  const shown = active.slice(0, 2);
  return (
    <Hover
      onPress={() => app.navigate({ name: 'settings', section: 'agents' })}
      style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.lg, backgroundColor: hovered ? c.fill06 : c.fill04 })}
    >
      {shown.length ? (
        <View style={{ flexDirection: 'row' }}>
          {shown.map((a, i) => (
            <View key={a.id} style={{ marginLeft: i ? -8 : 0 }}>
              <Avatar name={a.name} size={24} ring={i ? c.sidebar : undefined} />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.surface4, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="smart_toy" size={15} color={c.ink2} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={t(500, 12.5, 1.3)}>{active.length ? `${active.length} ${active.length === 1 ? 'agente collegato' : 'agenti collegati'}` : 'Nessun agente'}</Text>
        <Text style={t(400, 11, 1.3, { color: c.ink3 })}>{lastAgentWrite ? `ultima scrittura ${relTime(lastAgentWrite.at)}` : 'nessuna scrittura rilevata'}</Text>
      </View>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: active.length ? c.success : c.ink3 }} />
    </Hover>
  );
}
