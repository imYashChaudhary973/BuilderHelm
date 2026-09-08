import type {
  AgentProfile,
  ConnectionKind,
  ConnectionsSnapshot,
} from '@builderhelm/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekAgo(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

export function PluginsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [apifyToken, setApifyToken] = useState('');
  const [xToken, setXToken] = useState('');
  const [topic, setTopic] = useState('');
  const [since, setSince] = useState(weekAgo());
  const [until, setUntil] = useState(today());
  const [limit, setLimit] = useState(10);
  const [cost, setCost] = useState(1);
  const [post, setPost] = useState('');
  const [account, setAccount] = useState('');
  const [profileId, setProfileId] = useState('');
  const [approved, setApproved] = useState(false);

  const snapshot = useQuery({
    queryKey: ['connections'],
    queryFn: () => window.builderHelm.connections.snapshot(),
  });
  const profiles = useQuery({
    queryKey: ['agent-profiles'],
    queryFn: () => window.builderHelm.agents.profiles(),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['connections'] });
  };

  const connect = useMutation({
    mutationFn: (kind: ConnectionKind) =>
      window.builderHelm.connections.connect({
        kind,
        token: kind === 'apify' ? apifyToken : xToken,
      }),
    onSuccess: async () => {
      setError(null);
      setApifyToken('');
      setXToken('');
      await refresh();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const data: ConnectionsSnapshot | undefined = snapshot.data;
  const roster: readonly AgentProfile[] = profiles.data ?? [];
  const selected = profileId || roster[0]?.id || '';

  return (
    <section className="pluginsPage" aria-labelledby="plugins-title">
      <header className="usagePageHead">
        <div className="usagePageTitle">
          <h1 id="plugins-title">Plugins</h1>
          <p>
            Connecting stores a token. It does not grant any agent a tool. Paid Apify runs
            and X posts need a profile grant and an explicit approval.
          </p>
        </div>
      </header>
      {error !== null && (
        <p className="chatError" role="alert">
          {error}
        </p>
      )}
      <article className="accountCard">
        <h2>Apify</h2>
        <p>
          Reviewed actor <code>apidojo/tweet-scraper</code>. Token never leaves Keychain.
        </p>
        <label className="wizardLabel" htmlFor="apify-token">
          API token
        </label>
        <input
          id="apify-token"
          type="password"
          autoComplete="off"
          value={apifyToken}
          onChange={(event) => setApifyToken(event.target.value)}
        />
        <div className="accountCardActions">
          <button
            type="button"
            disabled={apifyToken.length < 8 || connect.isPending}
            onClick={() => connect.mutate('apify')}
          >
            Connect
          </button>
          {data?.connections
            .filter((connection) => connection.kind === 'apify')
            .map((connection) => (
              <span key={connection.id}>
                {connection.enabled ? 'Connected' : 'Disconnected'}
                <button
                  type="button"
                  onClick={() =>
                    void window.builderHelm.connections
                      .test({ connectionId: connection.id })
                      .then(refresh)
                      .catch((caught: Error) => setError(caught.message))
                  }
                >
                  Test
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void window.builderHelm.connections
                      .disconnect({ connectionId: connection.id })
                      .then(refresh)
                      .catch((caught: Error) => setError(caught.message))
                  }
                >
                  Disconnect
                </button>
              </span>
            ))}
        </div>
      </article>
      <article className="accountCard">
        <h2>X (write)</h2>
        <p>Separate from Apify. Required before any post.</p>
        <label className="wizardLabel" htmlFor="x-token">
          API token
        </label>
        <input
          id="x-token"
          type="password"
          autoComplete="off"
          value={xToken}
          onChange={(event) => setXToken(event.target.value)}
        />
        <div className="accountCardActions">
          <button
            type="button"
            disabled={xToken.length < 8 || connect.isPending}
            onClick={() => connect.mutate('x-write')}
          >
            Connect
          </button>
          {data?.connections
            .filter((connection) => connection.kind === 'x-write')
            .map((connection) => (
              <button
                key={connection.id}
                type="button"
                onClick={() =>
                  void window.builderHelm.connections
                    .disconnect({ connectionId: connection.id })
                    .then(refresh)
                    .catch((caught: Error) => setError(caught.message))
                }
              >
                Disconnect
              </button>
            ))}
        </div>
      </article>
      <article className="accountCard">
        <h2>Grants</h2>
        <label className="wizardLabel" htmlFor="grant-profile">
          Profile
        </label>
        <select
          id="grant-profile"
          value={selected}
          onChange={(event) => setProfileId(event.target.value)}
        >
          {roster.length === 0 && <option value="">Create a profile first</option>}
          {roster.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        {data?.connections.map((connection) =>
          connection.tools.map((tool) => {
            const granted = data.grants.some(
              (grant) =>
                grant.connectionId === connection.id &&
                grant.profileId === selected &&
                grant.toolName === tool.name &&
                grant.schemaHash === connection.schemaHash,
            );
            return (
              <label key={`${connection.id}:${tool.name}`} className="pluginsGrant">
                <input
                  type="checkbox"
                  disabled={selected.length === 0 || !connection.enabled}
                  checked={granted}
                  onChange={(event) =>
                    void window.builderHelm.connections
                      .grant({
                        connectionId: connection.id,
                        profileId: selected,
                        toolName: tool.name,
                        enabled: event.target.checked,
                      })
                      .then(refresh)
                      .catch((caught: Error) => setError(caught.message))
                  }
                />
                {connection.name} · {tool.name}
                {granted ? '' : connection.enabled ? '' : ' (disconnected)'}
              </label>
            );
          }),
        )}
      </article>
      <article className="accountCard">
        <h2>Research</h2>
        <label className="wizardLabel" htmlFor="research-topic">
          Topic
        </label>
        <input
          id="research-topic"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        />
        <div className="pluginsRow">
          <label>
            Since
            <input
              type="date"
              value={since}
              onChange={(event) => setSince(event.target.value)}
            />
          </label>
          <label>
            Until
            <input
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
          <label>
            Limit
            <input
              type="number"
              min={1}
              max={25}
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            />
          </label>
          <label>
            Cost cap USD
            <input
              type="number"
              min={0.01}
              max={20}
              step={0.01}
              value={cost}
              onChange={(event) => setCost(Number(event.target.value))}
            />
          </label>
        </div>
        <label className="pluginsGrant">
          <input
            type="checkbox"
            checked={approved}
            onChange={(event) => setApproved(event.target.checked)}
          />
          Approve Apify actor {`apidojo/tweet-scraper`}, this query, dates, limit, and
          cost cap
        </label>
        <button
          type="button"
          disabled={!approved || topic.trim().length === 0 || selected.length === 0}
          onClick={() =>
            void window.builderHelm.connections
              .research({
                requestId: globalThis.crypto.randomUUID(),
                profileId: selected,
                topic: topic.trim(),
                since,
                until,
                limit,
                costLimitUsd: cost,
                approved: true,
              })
              .then(refresh)
              .catch((caught: Error) => setError(caught.message))
          }
        >
          Run research
        </button>
      </article>
      <article className="accountCard">
        <h2>Publish to X</h2>
        <label className="wizardLabel" htmlFor="x-account">
          Account
        </label>
        <input
          id="x-account"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
        />
        <label className="wizardLabel" htmlFor="x-post">
          Exact text
        </label>
        <textarea
          id="x-post"
          maxLength={280}
          rows={4}
          value={post}
          onChange={(event) => setPost(event.target.value)}
        />
        <button
          type="button"
          disabled={post.trim().length === 0 || account.trim().length === 0}
          onClick={() =>
            void window.builderHelm.connections
              .publish({
                requestId: globalThis.crypto.randomUUID(),
                profileId: selected,
                text: post.trim(),
                account: account.trim(),
                approved: true,
              })
              .then(refresh)
              .catch((caught: Error) => setError(caught.message))
          }
        >
          Approve and publish
        </button>
      </article>
      {(data?.jobs ?? []).length > 0 && (
        <article className="accountCard">
          <h2>Jobs</h2>
          <ul className="pluginsJobs">
            {data?.jobs.map((job) => (
              <li key={job.id}>
                {job.toolName} · {job.status} · {job.destination}
                {job.remoteJobId === null ? '' : ` · ${job.remoteJobId}`}
                {job.report === null ? null : <pre>{job.report}</pre>}
              </li>
            ))}
          </ul>
        </article>
      )}
    </section>
  );
}
