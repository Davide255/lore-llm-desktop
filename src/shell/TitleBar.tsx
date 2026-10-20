import React from 'react';
import { Text, View } from 'react-native';
import { c, font, t, web } from '../theme';
import { useApp, type Route } from '../state/app';
import { Hover, Icon, isMac } from '../ui/primitives';

const SETTINGS_LABEL = { account: 'Account', general: 'Generale', editor: 'Editor', obsidian: 'Obsidian', agents: 'Agenti', shortcuts: 'Scorciatoie' } as const;

function crumbs(route: Route): { label: string; mono?: boolean; to?: Route }[] {
  switch (route.name) {
    case 'projects':
      return [{ label: 'Progetti' }];
    case 'activity':
      return [{ label: 'Attività' }];
    case 'settings':
      return [{ label: 'Impostazioni', to: { name: 'settings' } }, { label: SETTINGS_LABEL[route.section ?? 'general'] }];
    case 'folder':
    case 'file': {
      const parts = route.path.split('/');
      const out: { label: string; mono?: boolean; to?: Route }[] = [{ label: 'Progetti', to: { name: 'projects' } }];
      parts.forEach((p, i) => {
        const path = parts.slice(0, i + 1).join('/');
        const last = i === parts.length - 1;
        out.push({ label: p, mono: route.name === 'file' && last, to: last ? undefined : { name: 'folder', path } });
      });
      return out;
    }
  }
}

export function TitleBar() {
  const app = useApp();
  // Before login there is no knowledge base: no sidebar toggle, breadcrumbs or sync state.
  const inside = !!app.user && app.loaded;
  const list = inside ? crumbs(app.route) : [{ label: 'Lore LLM Desktop' }];
  const source = app.changedSource === 'obsidian' ? 'da Obsidian' : app.changedSource === 'device' ? 'da un altro dispositivo' : 'da un agente';
  let sync: { icon: string; label: string; color: string } = {
    synced: { icon: 'cloud_done', label: 'Sincronizzato', color: c.ink3 },
    saving: { icon: 'sync', label: 'Salvataggio…', color: c.ink3 },
    external: { icon: 'bolt', label: `Aggiornato ${source}`, color: c.info },
    error: { icon: 'cloud_off', label: 'Errore di scrittura', color: c.error },
  }[app.sync];
  // The local vault's own trouble shows when nothing more urgent is going on.
  const v = app.vault;
  if (app.sync === 'synced' && v?.enabled) {
    if (v.state === 'syncing' && v.pending > 0) sync = { icon: 'sync', label: 'Sincronizzo la copia locale…', color: c.ink3 };
    else if (v.state === 'offline') sync = { icon: 'cloud_off', label: 'Offline: le modifiche locali sono in attesa', color: c.warning };
    else if (v.state === 'paused:confirm' || v.state === 'paused:auth' || v.state === 'error') sync = { icon: 'sync_problem', label: 'Copia locale in pausa', color: c.warning };
  }
  const vaultTrouble = !!v?.enabled && v.state !== 'idle' && v.state !== 'syncing';

  return (
    <View
      style={[
        { height: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: isMac ? 84 : 14, paddingRight: isMac ? 18 : 150, borderBottomWidth: 1, borderColor: c.hair, backgroundColor: c.titlebar },
        web({ WebkitAppRegion: 'drag', userSelect: 'none' }),
      ]}
    >
      {inside ? (
        <>
          <Hover
            onPress={() => app.setPrefs({ sidebarCollapsed: !app.prefs.sidebarCollapsed })}
            style={({ hovered }) => [{ padding: 4, borderRadius: 6, backgroundColor: hovered ? c.fill07 : 'transparent' }, web({ WebkitAppRegion: 'no-drag' })]}
            accessibilityLabel="Mostra/nascondi sidebar"
          >
            <Icon name="side_navigation" size={18} color={c.ink3} />
          </Hover>
          <View style={{ width: 4 }} />
        </>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, minWidth: 0 }}>
        {list.map((cr, i) => {
          const last = i === list.length - 1;
          const style = cr.mono ? { fontFamily: font.mono, fontSize: 12.5, lineHeight: 13 } : null;
          return (
            <React.Fragment key={i}>
              {i > 0 ? <Icon name="chevron_right" size={15} color={c.ink3} /> : null}
              {cr.to && !last ? (
                <Hover onPress={() => app.navigate(cr.to!)} style={web({ WebkitAppRegion: 'no-drag' })}>
                  {({ hovered }) => <Text style={[t(500, 13, 1, { color: hovered ? c.ink2 : c.ink3 }), style]}>{cr.label}</Text>}
                </Hover>
              ) : (
                <Text numberOfLines={1} style={[t(500, 13, 1, { color: last ? c.ink : c.ink3 }), style]}>
                  {cr.label}
                </Text>
              )}
            </React.Fragment>
          );
        })}
      </View>
      <View style={{ flex: 1 }} />
      {inside ? (
        <Hover
          onPress={vaultTrouble ? () => app.navigate({ name: 'settings', section: 'obsidian' }) : undefined}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 8 }, web({ WebkitAppRegion: 'no-drag', cursor: vaultTrouble ? 'pointer' : 'default' })]}
        >
          <Icon name={sync.icon} size={17} color={sync.color} />
          <Text style={t(400, 12, 1, { color: sync.color })}>{sync.label}</Text>
        </Hover>
      ) : null}
    </View>
  );
}
