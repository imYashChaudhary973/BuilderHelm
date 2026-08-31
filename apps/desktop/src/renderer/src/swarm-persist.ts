const KEY = 'builderhelm.swarm.lastJob';
const HANDOFF_KEY = 'builderhelm.swarm.handoff';

export interface SwarmHandoff {
  readonly cardId: string;
  readonly mission: string;
}

export function readLastJob(): string {
  try {
    const value = localStorage.getItem(KEY);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

export function writeLastJob(job: string): void {
  try {
    const next = job.trim();
    if (next === '') {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, next.slice(0, 2000));
  } catch {
    // Storage is optional.
  }
}

export function queueSwarmHandoff(handoff: SwarmHandoff): boolean {
  try {
    sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        cardId: handoff.cardId,
        mission: handoff.mission.trim().slice(0, 10_000),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function takeSwarmHandoff(): SwarmHandoff | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    sessionStorage.removeItem(HANDOFF_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    if (!('cardId' in value) || !('mission' in value)) return null;
    if (typeof value.cardId !== 'string' || typeof value.mission !== 'string')
      return null;
    const mission = value.mission.trim().slice(0, 10_000);
    if (!/^[0-9a-f-]{36}$/i.test(value.cardId) || mission.length === 0) return null;
    return { cardId: value.cardId, mission };
  } catch {
    return null;
  }
}
