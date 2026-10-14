import type { AgentKind } from './types';

/** The agent clients the app knows how to present. Order = order in the picker. */
export const AGENT_KINDS: Record<AgentKind, { label: string; avatar: string; hint: string }> = {
  claude: {
    label: 'Claude',
    avatar: 'https://avatars.githubusercontent.com/u/81847?v=4',
    hint: 'Claude Code o Claude Desktop',
  },
  codex: {
    label: 'Codex',
    avatar: 'https://avatars.githubusercontent.com/u/14957082?v=4',
    hint: 'Codex CLI o app Codex',
  },
};

export const AGENT_KIND_LIST = Object.keys(AGENT_KINDS) as AgentKind[];
