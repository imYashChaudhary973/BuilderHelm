import type { BoardAgentDetection } from '@builderhelm/protocol/board';
import type { BoardSessionSummary } from '@builderhelm/protocol/board';

export const LAUNCHER_GROUPS = ['create', 'agent', 'open', 'manage'] as const;
export type LauncherGroup = (typeof LAUNCHER_GROUPS)[number];

export const LAUNCHER_GROUP_LABEL: Record<LauncherGroup, string> = {
  create: 'Create',
  agent: 'Start an agent',
  open: 'Open',
  manage: 'Manage',
};

export interface LauncherAction {
  readonly id: string;
  readonly group: LauncherGroup;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly available: boolean;
  readonly detail: string;
  readonly run: () => void;
}

export interface LauncherContext {
  readonly navigate: (to: string) => void;
  readonly activateSpace: (sessionId: string) => void;
  readonly spaces: readonly BoardSessionSummary[];
  readonly agents: readonly BoardAgentDetection[];
  readonly openBrowser: () => void;
  readonly openEditor: () => void;
}

const HIDDEN_AGENTS: Record<string, true> = { shell: true, custom: true };

export function buildLauncherActions(ctx: LauncherContext): LauncherAction[] {
  const actions: LauncherAction[] = [
    {
      id: 'create.chat',
      group: 'create',
      label: 'Agent thread',
      keywords: ['chat', 'thread', 'conversation', 'new'],
      available: true,
      detail: 'Open Chats',
      run: () => ctx.navigate('/chat'),
    },
    {
      id: 'create.terminal',
      group: 'create',
      label: 'Terminal',
      keywords: ['pty', 'shell', 'space', 'pane'],
      available: true,
      detail: ctx.spaces.length > 0 ? 'Open the Code workspace' : 'Pick a folder first',
      run: () => ctx.navigate('/space'),
    },
    {
      id: 'create.browser',
      group: 'create',
      label: 'Browser tab',
      keywords: ['preview', 'web', 'url'],
      available: true,
      detail: 'Opens the workspace browser',
      run: () => ctx.openBrowser(),
    },
    {
      id: 'create.file',
      group: 'create',
      label: 'Markdown note',
      keywords: ['file', 'editor', 'md', 'note'],
      available: true,
      detail: 'Opens the editor to create a file',
      run: () => ctx.openEditor(),
    },
  ];

  for (const agent of ctx.agents) {
    if (HIDDEN_AGENTS[agent.id] === true) continue;
    actions.push({
      id: `agent.${agent.id}`,
      group: 'agent',
      label: agent.label,
      keywords: [agent.id, agent.label, 'cli', 'seat'],
      available: agent.available,
      detail: agent.available ? 'Installed' : 'Setup needed — install its CLI',
      run: () => ctx.navigate(agent.available ? '/space' : '/agents'),
    });
  }

  for (const space of ctx.spaces) {
    const name = space.folderPath.split('/').filter(Boolean).at(-1) ?? space.folderPath;
    actions.push({
      id: `open.space.${space.sessionId}`,
      group: 'open',
      label: name,
      keywords: ['workspace', 'space', 'project', space.folderPath],
      available: true,
      detail: space.folderPath,
      run: () => {
        ctx.activateSpace(space.sessionId);
        ctx.navigate('/space');
      },
    });
  }

  actions.push(
    {
      id: 'open.tasks',
      group: 'open',
      label: 'Tasks',
      keywords: ['board', 'kanban', 'issues'],
      available: true,
      detail: 'Project board',
      run: () => ctx.navigate('/board'),
    },
    {
      id: 'open.swarm',
      group: 'open',
      label: 'Agent team',
      keywords: ['swarm', 'roster', 'mission'],
      available: true,
      detail: 'Start a Swarm run',
      run: () => ctx.navigate('/swarm'),
    },
    {
      id: 'manage.agents',
      group: 'manage',
      label: 'Agent settings',
      keywords: ['cli', 'path', 'detect'],
      available: true,
      detail: 'Installed coding agents',
      run: () => ctx.navigate('/agents'),
    },
    {
      id: 'manage.plugins',
      group: 'manage',
      label: 'Connect a plugin',
      keywords: ['mcp', 'github', 'linear', 'jira', 'vidiq'],
      available: true,
      detail: 'Apify research and X publish — grants are per profile',
      run: () => ctx.navigate('/plugins'),
    },
    {
      id: 'manage.automations',
      group: 'manage',
      label: 'Automations',
      keywords: ['schedule', 'cron', 'repeat'],
      available: true,
      detail: 'Runs only while BuilderHelm is open — missed paid work is not replayed',
      run: () => ctx.navigate('/automations'),
    },
    {
      id: 'manage.remote',
      group: 'manage',
      label: 'Remote',
      keywords: ['pair', 'mobile', 'companion', 'lan'],
      available: true,
      detail: 'Local-network companion — host stays in charge, no relay',
      run: () => ctx.navigate('/remote'),
    },
  );

  return actions;
}

export function filterLauncherActions(
  actions: readonly LauncherAction[],
  query: string,
): LauncherAction[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...actions];
  return actions.filter((action) => {
    const haystack = [action.label, action.detail, ...action.keywords]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
