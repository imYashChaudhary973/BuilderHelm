import { describe, expect, it } from 'vitest';

import { CompanionSession } from '../src/session.js';

describe('CompanionSession', () => {
  it('marks stale then disconnected without inventing host work', () => {
    const session = new CompanionSession();
    session.applyStatus({
      hostAuthoritative: true,
      lifetime: 'desktop-open',
      run: { id: '11111111-1111-4111-8111-111111111111', status: 'running' },
      pendingApprovals: [],
    });
    session.applyEvents([
      {
        seq: 3,
        type: 'command',
        payload: {},
        createdAt: '2026-09-09T12:00:00.000Z',
      },
    ]);
    expect(session.connection).toBe('connected');
    expect(session.lastSeq).toBe(3);
    session.markStale();
    expect(session.connection).toBe('stale');
    session.markDisconnected();
    expect(session.connection).toBe('disconnected');
    expect(session.status?.hostAuthoritative).toBe(true);
  });
});
