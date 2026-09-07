import type { AgentProfile, AgentThread } from '@builderhelm/protocol';

/** The chat header's status chip. Precedence: actionable > in-flight > idle. */
export type AgentChatStatus = 'approval' | 'signin' | 'working' | 'ready';

export function deriveStatus(input: {
  readonly streaming: boolean;
  readonly permissionPending: boolean;
  readonly authRequired: boolean;
}): AgentChatStatus {
  if (input.permissionPending) return 'approval';
  if (input.authRequired) return 'signin';
  if (input.streaming) return 'working';
  return 'ready';
}

/** The profile's most recently touched thread, or null when it has none. */
export function latestThreadForProfile(
  threads: readonly AgentThread[],
  profileId: string,
): AgentThread | null {
  let best: AgentThread | null = null;
  for (const thread of threads) {
    if (thread.profileId !== profileId) continue;
    if (best === null || thread.updatedAt > best.updatedAt) best = thread;
  }
  return best;
}

/** The roster's quick-access tiles: the most recently opened profiles. */
export function recentProfiles(
  profiles: readonly AgentProfile[],
  count: number,
): AgentProfile[] {
  return [...profiles]
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .slice(0, count);
}

/** `21594` → `21.6k`, the composer/footer token format. */
export function compactTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}
