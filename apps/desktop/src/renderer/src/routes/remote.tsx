import type { RemoteSnapshot } from '@builderhelm/protocol/remote';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function RemotePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [bind, setBind] = useState<'loopback' | 'private'>('loopback');

  const snapshot = useQuery({
    queryKey: ['remote'],
    queryFn: () => window.builderHelm.remote.snapshot(),
    refetchInterval: 3_000,
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['remote'] });
  };

  const listen = useMutation({
    mutationFn: () => window.builderHelm.remote.listen({ bind }),
    onSuccess: () => void refresh(),
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not start the listener');
    },
  });
  const stop = useMutation({
    mutationFn: () => window.builderHelm.remote.stop(),
    onSuccess: () => void refresh(),
  });
  const pair = useMutation({
    mutationFn: () => window.builderHelm.remote.createPairing(),
    onSuccess: () => void refresh(),
  });
  const revoke = useMutation({
    mutationFn: (sessionId: string) => window.builderHelm.remote.revoke({ sessionId }),
    onSuccess: () => void refresh(),
  });

  const data: RemoteSnapshot | undefined = snapshot.data;

  return (
    <section className="pluginsPage" aria-labelledby="remote-title">
      <header className="usagePageHead">
        <div>
          <h1 id="remote-title">Remote</h1>
          <p>
            Pair a companion on the local or private network. The host stays in charge.
          </p>
        </div>
      </header>
      <article className="accountCard">
        <p>
          BuilderHelm must stay open. There is no relay in this build. Provider
          credentials, a shell, and the filesystem are not on the wire.
        </p>
      </article>
      {error !== null && (
        <p className="chatError" role="alert">
          {error}
        </p>
      )}
      <article className="accountCard">
        <p>Fingerprint {data?.fingerprint ?? '—'}</p>
        <p>
          {data?.listening
            ? `Listening on ${(data.addresses ?? []).join(', ')}`
            : 'Not listening'}
        </p>
        <label>
          Bind
          <select
            value={bind}
            onChange={(event) => setBind(event.target.value as 'loopback' | 'private')}
          >
            <option value="loopback">Loopback</option>
            <option value="private">Private network</option>
          </select>
        </label>
        {data?.listening ? (
          <button type="button" onClick={() => stop.mutate()}>
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => listen.mutate()}>
            Listen
          </button>
        )}
        <button type="button" onClick={() => pair.mutate()} disabled={!data?.listening}>
          New pairing code
        </button>
        {data?.pairing !== null && data?.pairing !== undefined && (
          <p>
            Code {data.pairing.code} · expires {data.pairing.expiresAt}
          </p>
        )}
      </article>
      {(data?.sessions ?? []).map((session) => (
        <article className="accountCard" key={session.id}>
          <p>
            {session.clientLabel}
            {session.revokedAt !== null ? ' · revoked' : ''}
          </p>
          <p>Last seen {session.lastSeenAt}</p>
          {session.revokedAt === null && (
            <button type="button" onClick={() => revoke.mutate(session.id)}>
              Revoke
            </button>
          )}
        </article>
      ))}
      <article className="accountCard">
        <h2>Audit</h2>
        {(data?.audit ?? []).slice(0, 12).map((row) => (
          <p key={row.id}>
            {row.createdAt} · {row.action} · {row.outcome}
          </p>
        ))}
      </article>
    </section>
  );
}
