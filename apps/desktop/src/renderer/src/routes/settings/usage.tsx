import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountAgent } from '@builderhelm/protocol/accounts';

function authLabel(agent: AccountAgent): string {
  if (agent.auth === 'builtin') return 'Built-in';
  if (agent.auth === 'installed') return 'Installed';
  return 'Not installed';
}

function usageLabel(agent: AccountAgent): string {
  if (!agent.capabilities.usageReporting) return 'This CLI does not expose usage';
  if (agent.usage === null) return 'No Swarm report yet';
  const cost = agent.usage.costUsd.toFixed(4);
  return `${agent.usage.tokensUsed} tokens · $${cost} · Swarm · ${agent.usage.occurredAt}`;
}

export function UsagePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: ['accounts-snapshot'],
    queryFn: () => window.builderHelm.accounts.snapshot(),
  });
  const setRoot = useMutation({
    mutationFn: (input: { agentId: AccountAgent['id']; configRoot: string | null }) =>
      window.builderHelm.accounts.setRoot(input),
    onSuccess: (next) => {
      queryClient.setQueryData(['accounts-snapshot'], next);
    },
  });

  async function chooseRoot(agent: AccountAgent): Promise<void> {
    const folder = await window.builderHelm.board.selectFolder();
    if (folder === null) return;
    setRoot.mutate({ agentId: agent.id, configRoot: folder });
  }

  return (
    <section className="voicePage" aria-labelledby="usage-title">
      <header className="settingsHeader">
        <h1 id="usage-title">Accounts and usage</h1>
        <p>
          Installed CLIs, Swarm-reported tokens, and isolated config roots for Claude
          (`CLAUDE_CONFIG_DIR`) and Codex (`CODEX_HOME`). BuilderHelm does not scrape
          billing pages or browser sessions.
        </p>
      </header>
      {snapshot.error instanceof Error ? (
        <p className="wizardError" role="alert">
          {snapshot.error.message}
        </p>
      ) : null}
      {setRoot.error instanceof Error ? (
        <p className="wizardError" role="alert">
          {setRoot.error.message}
        </p>
      ) : null}
      <table className="usageTable">
        <thead>
          <tr>
            <th>CLI</th>
            <th>State</th>
            <th>Usage</th>
            <th>Config root</th>
          </tr>
        </thead>
        <tbody>
          {(snapshot.data?.agents ?? [])
            .filter((agent) => agent.id !== 'shell')
            .map((agent) => (
              <tr key={agent.id}>
                <td>{agent.label}</td>
                <td>{authLabel(agent)}</td>
                <td>{usageLabel(agent)}</td>
                <td>
                  {agent.configDirEnv === null ? (
                    'No supported switch'
                  ) : (
                    <div className="usageRoot">
                      <span>{agent.configRoot ?? 'Default home config'}</span>
                      <button type="button" onClick={() => void chooseRoot(agent)}>
                        Choose folder
                      </button>
                      {agent.configRoot !== null ? (
                        <button
                          type="button"
                          onClick={() =>
                            setRoot.mutate({ agentId: agent.id, configRoot: null })
                          }
                        >
                          Use default
                        </button>
                      ) : null}
                    </div>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </section>
  );
}
