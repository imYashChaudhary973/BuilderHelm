const KEY = 'builderhelm.swarm.lastJob';

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
