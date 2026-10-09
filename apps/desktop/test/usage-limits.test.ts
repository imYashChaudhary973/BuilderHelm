import type { AccountHome, AccountProvider, QuotaWindow } from '@builderhelm/protocol';
import { describe, expect, it } from 'vitest';

import {
  distinctAccounts,
  limitCards,
  poolOf,
} from '../src/renderer/src/routes/settings/usage-limits.js';

const future = (hours: number): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

function window(id: string, used: number, resetsAt: string | null): QuotaWindow {
  const kind = id.startsWith('session') ? 'session' : 'weekly';
  return {
    id,
    label: id,
    kind,
    scope: id.includes(':') ? 'Opus' : null,
    usedPercent: used,
    resetsAt,
  };
}

function home(
  id: string,
  accountKey: string | null,
  windows: QuotaWindow[] | null,
  occurredAt = new Date().toISOString(),
): AccountHome {
  return {
    id,
    label: id,
    kind: 'attached',
    configRoot: `/tmp/${id}`,
    email: `${id}@example.com`,
    active: false,
    disabled: false,
    quota:
      windows === null ? null : { windows, source: 'statusline', occurredAt, plan: null },
    limits:
      windows === null
        ? { state: 'unknown', message: 'No reading yet.' }
        : { state: 'ok', message: null },
    accountKey,
    billing: null,
  };
}

const provider = (homes: AccountHome[]): AccountProvider => ({
  id: 'claude',
  label: 'Claude',
  installed: true,
  multiAccount: true,
  homes,
});

describe('pooled limits', () => {
  it('shows one account connected through two folders once, with its newest reading', () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    const accounts = distinctAccounts(
      provider([
        home('work', 'claude:abc', [window('session', 80, future(1))], older),
        home('work-copy', 'claude:abc', [window('session', 90, future(1))]),
        home('team', 'claude:def', [window('session', 10, future(3))]),
      ]),
    );
    expect(accounts.map((entry) => entry.id)).toEqual(['work-copy', 'team']);
  });

  it('pools the mean remaining share and leaves no-data accounts out instead of counting them full', () => {
    const cards = limitCards(
      provider([
        home('a', 'k1', [
          window('session', 100, future(2)),
          window('weekly', 10, future(100)),
        ]),
        home('b', 'k2', [
          window('session', 24, future(4)),
          window('weekly', 2, future(50)),
        ]),
        home('c', 'k3', null),
      ]),
    );
    const session = cards.find((card) => card.id === 'session')!;
    expect(
      session.segments.map((segment) => segment.window?.usedPercent ?? null),
    ).toEqual([100, 24, null]);
    const pool = poolOf(session.segments)!;
    expect(pool.left).toBeCloseTo(38, 5);
    // The soonest reset returns account a's used share across the two reporting accounts.
    expect(pool.next?.gain).toBeCloseTo(50, 5);
  });

  it('keeps unlike windows apart and invents nothing when no account reported', () => {
    const cards = limitCards(
      provider([
        home('a', 'k1', [window('weekly', 10, null), window('weekly:opus', 60, null)]),
      ]),
    );
    expect(cards.map((card) => card.id)).toEqual(['weekly', 'weekly:opus']);
    expect(limitCards(provider([home('x', 'k9', null)]))).toEqual([]);
    expect(poolOf([])).toBeNull();
  });
});
