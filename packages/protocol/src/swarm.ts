import type { BoardAgentDetection, BoardAgentId, BoardPaneStatus } from './board.js';

export const SWARM_ROLES = ['coordinator', 'builder', 'scout', 'reviewer'] as const;
export type SwarmRole = (typeof SWARM_ROLES)[number];

export const SWARM_PANE_COUNT = 4;
export const SWARM_BUDGET_MS = 20 * 60 * 1000;
export const SWARM_STUCK_MS = 90 * 1000;

export type SwarmMemberStatus = 'starting' | 'running' | 'stuck' | 'exited' | 'failed';
export type SwarmStuckAction = 'none' | 'nudge' | 'stop';

export type SwarmRunStatus = 'running' | 'stuck' | 'budget' | 'stopped' | 'done';

export interface SwarmAssignment {
  readonly role: SwarmRole;
  readonly agentId: BoardAgentId;
}

const DUTY: Record<SwarmRole, string> = {
  coordinator:
    'Split the job, track the other roles, and stop when the job is done. Do not implement the whole job yourself.',
  builder: 'Implement the job in this folder. Keep the diff small and ship working code.',
  scout: 'Explore the repo and report what matters. Do not implement unless asked.',
  reviewer: 'Review the Builder work. Name bugs and missing tests. Do not rewrite everything.',
};

export function availableSwarmAgents(
  detections: readonly BoardAgentDetection[],
): BoardAgentId[] {
  return detections
    .filter((item) => item.available && item.id !== 'shell' && item.id !== 'custom')
    .map((item) => item.id);
}

export function assignSwarmPanes(agentIds: readonly BoardAgentId[]): SwarmAssignment[] {
  if (agentIds.length === 0) return [];
  return SWARM_ROLES.map((role, index) => ({
    role,
    agentId: agentIds[index % agentIds.length]!,
  }));
}

export function swarmBrief(role: SwarmRole, job: string): string {
  const clipped = job.trim().slice(0, 2_000);
  return `You are the ${role} in a BuilderHelm Swarm.\nJob: ${clipped}\n\n${DUTY[role]}\n`;
}
export function swarmRoleTasks(job: string): Record<SwarmRole, string> {
  const clipped = job.trim().slice(0, 200);
  const suffix = clipped ? ` Job: ${clipped}` : '';
  return {
    coordinator: (DUTY.coordinator + suffix).trim().slice(0, 500),
    builder: (DUTY.builder + suffix).trim().slice(0, 500),
    scout: (DUTY.scout + suffix).trim().slice(0, 500),
    reviewer: (DUTY.reviewer + suffix).trim().slice(0, 500),
  };
}

export const SWARM_NUDGE =
  'You have been silent. Report status in one line, then continue or say you are blocked.';


export function swarmStuckAction(input: {
  readonly status: SwarmMemberStatus;
  readonly nudgedAt: number | null;
  readonly now: number;
  readonly stuckAfterMs: number;
}): SwarmStuckAction {
  if (input.status !== 'stuck') return 'none';
  if (input.nudgedAt === null) return 'nudge';
  if (input.now - input.nudgedAt >= input.stuckAfterMs) return 'stop';
  return 'none';
}


export function swarmMemberStatus(input: {
  readonly paneStatus: BoardPaneStatus;
  readonly lastActivityAt: number;
  readonly now: number;
  readonly stuckAfterMs: number;
}): SwarmMemberStatus {
  if (input.paneStatus === 'exited' || input.paneStatus === 'failed') {
    return input.paneStatus;
  }
  if (input.paneStatus === 'starting') return 'starting';
  if (input.now - input.lastActivityAt >= input.stuckAfterMs) return 'stuck';
  return 'running';
}

export function swarmRunStatus(input: {
  readonly members: readonly SwarmMemberStatus[];
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly stopped: boolean;
}): SwarmRunStatus {
  if (input.stopped) return 'stopped';
  if (input.elapsedMs >= input.budgetMs) return 'budget';
  if (input.members.length === 0) return 'running';
  if (input.members.every((item) => item === 'exited' || item === 'failed')) return 'done';
  if (input.members.some((item) => item === 'stuck')) return 'stuck';
  return 'running';
}
