import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { c, t, web } from '../theme';
import { useApp } from '../state/app';
import { AGENT_KINDS } from '../kb/agents';
import type { AgentKind, AgentRef, Author } from '../kb/types';
import { Avatar, Icon, initialsOf } from './primitives';

/** An agent's face: its client's picture, or initials when unknown/offline. */
export function AgentAvatar({ agent, kind, size = 22, ring }: { agent?: AgentRef | null; kind?: AgentKind | null; size?: number; ring?: string }) {
  const k = kind ?? agent?.kind ?? null;
  const [broken, setBroken] = useState(false);
  if (!k || broken) return <Avatar initials={agent ? initialsOf(agent.name) : 'AG'} size={size} color={c.purple} ring={ring} />;
  return (
    <View
      accessibilityLabel={agent?.name ?? AGENT_KINDS[k].label}
      style={[{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: c.surface4, flexShrink: 0 }, ring ? web({ boxShadow: `0 0 0 2px ${ring}` }) : null]}
    >
      <Image source={{ uri: AGENT_KINDS[k].avatar }} onError={() => setBroken(true)} style={{ width: size, height: size }} />
    </View>
  );
}

/** Who wrote something: you (your initials), a teammate, or the agent that did. */
export function AuthorAvatar({ author, agent, size = 22 }: { author: Author; agent?: AgentRef; size?: number }) {
  const app = useApp();
  if (author === 'you') return <Avatar name={app.user?.name ?? 'Tu'} size={size} />;
  if (author === 'teammate') return <TeammateAvatar size={size} />;
  return <AgentAvatar agent={agent} size={size} />;
}

/** The server doesn't record which teammate wrote a file yet: a generic face. */
function TeammateAvatar({ size }: { size: number }) {
  return (
    <View accessibilityLabel="Un collaboratore" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.blue18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name="group" size={Math.round(size * 0.62)} color={c.blueTint} />
    </View>
  );
}

export const authorName = (author: Author, agent?: AgentRef) => (author === 'you' ? 'Tu' : author === 'teammate' ? 'Un collaboratore' : agent?.name ?? 'Agente');

/** The team a project belongs to, next to its name. */
export function TeamPill({ name, compact }: { name: string; compact?: boolean }) {
  return (
    <View
      accessibilityLabel={`Team ${name}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: compact ? 5 : 8, paddingVertical: compact ? 1 : 3, borderRadius: 999, backgroundColor: c.blue18, flexShrink: 1, minWidth: 0 }}
    >
      <Icon name="group" size={compact ? 11 : 13} color={c.blueTint} />
      {compact ? null : (
        <Text numberOfLines={1} style={t(500, 11.5, 1.2, { color: c.blueTint })}>
          {name}
        </Text>
      )}
    </View>
  );
}

/** Avatar + name, for table cells and rails. */
export function AuthorChip({ author, agent, size = 22 }: { author: Author; agent?: AgentRef; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <AuthorAvatar author={author} agent={agent} size={size} />
      <Text numberOfLines={1} style={[t(400, 13, 1, { color: c.ink2 }), { flexShrink: 1 }]}>
        {authorName(author, agent)}
      </Text>
    </View>
  );
}
