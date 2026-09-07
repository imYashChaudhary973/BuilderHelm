import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { BoardAgentDetection } from '@builderhelm/protocol/board';

/**
 * The Agents grid: one card per coding agent BuilderHelm can drive.
 *
 * Everything shown is measured, not declared. `available` and `path` come from
 * probing PATH, capabilities come from the catalog that the launcher itself
 * reads, and the quota line is the same snapshot the status bar uses. A card
 * therefore answers the only question worth asking here: can I run this right
 * now, and what will it do.
 */

/** `shell` is a plain terminal and `custom` is a user-supplied command. */
const HIDDEN: Record<string, true> = { shell: true, custom: true };

function capabilitySummary(agent: BoardAgentDetection): readonly string[] {
  const out: string[] = [];
  if (agent.capabilities.interactive) out.push('Interactive');
  if (agent.capabilities.headless) out.push('Headless');
  if (agent.capabilities.sessionResume) out.push('Resumable');
  if (agent.capabilities.structuredOutput !== 'none') {
    out.push(agent.capabilities.structuredOutput === 'json' ? 'JSON' : 'JSON schema');
  }
  return out;
}

export function AgentsPage(): React.JSX.Element {
  const navigate = useNavigate();

  const agents = useQuery({
    queryKey: ['agents-detect'],
    queryFn: () => window.builderHelm.board.detectAgents(),
  });

  const accounts = useQuery({
    queryKey: ['agents-accounts'],
    refetchInterval: 30_000,
    queryFn: () => window.builderHelm.accounts.snapshot(),
  });

  const detected = (agents.data ?? []).filter((agent) => HIDDEN[agent.id] !== true);
  const providers = accounts.data?.providers ?? [];
  const ready = detected.filter((agent) => agent.available);

  return (
    <section className="agentsStage" aria-labelledby="agents-title">
      <header className="agentsHead">
        <div>
          <h1 id="agents-title">Agents</h1>
          <p>
            {agents.isPending
              ? 'Looking for agents on this machine…'
              : `${ready.length} of ${detected.length} installed and ready to run.`}
          </p>
        </div>
        <button
          type="button"
          className="agentsAction"
          onClick={() => void navigate({ to: '/swarm' })}
        >
          Start a Swarm run
        </button>
      </header>

      {agents.isError ? (
        <p className="agentsError" role="alert">
          Could not probe for agents. Reopen this tab to try again.
        </p>
      ) : null}

      <div className="agentBoard">
        {(agents.isPending ? Array.from({ length: 8 }) : detected).map((entry, index) => {
          if (entry === undefined) {
            return (
              <div key={`skeleton-${index}`} className="agentCard agentCardLoading" />
            );
          }
          const agent = entry as BoardAgentDetection;
          const provider = providers.find((entry) => entry.id === agent.id) ?? null;
          const caps = capabilitySummary(agent);
          const swarmable = agent.capabilities.swarmModes.length > 0;
          return (
            <article
              key={agent.id}
              className={agent.available ? 'agentCard' : 'agentCard agentCardOff'}
            >
              <header>
                <span className="agentTitle">{agent.label}</span>
                <span
                  className={agent.available ? 'agentState agentStateOn' : 'agentState'}
                  title={agent.available ? 'Installed' : 'Not on PATH'}
                  aria-label={agent.available ? 'Installed' : 'Not on PATH'}
                />
              </header>

              {agent.available ? (
                <>
                  {caps.length > 0 ? (
                    <ul className="agentCaps">
                      {caps.map((cap) => (
                        <li key={cap}>{cap}</li>
                      ))}
                    </ul>
                  ) : null}

                  {provider?.quota?.fiveHour != null ||
                  provider?.quota?.sevenDay != null ? (
                    <div className="agentQuota">
                      {(
                        [
                          ['Session', provider.quota.fiveHour],
                          ['Weekly', provider.quota.sevenDay],
                        ] as const
                      ).map(([label, window]) =>
                        window === null ? null : (
                          <div key={label} className="agentQuotaRow">
                            <div className="agentQuotaTrack">
                              <span
                                className="agentQuotaFill"
                                style={{ width: `${Math.round(window.usedPercent)}%` }}
                              />
                            </div>
                            <small>
                              {label} {Math.round(window.usedPercent)}%
                            </small>
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="agentPath" title={agent.path ?? undefined}>
                      {agent.path ?? 'Found on PATH'}
                    </p>
                  )}

                  <footer>
                    <button type="button" onClick={() => void navigate({ to: '/space' })}>
                      Open pane
                    </button>
                    {swarmable ? (
                      <button
                        type="button"
                        onClick={() => void navigate({ to: '/swarm' })}
                      >
                        Add seat
                      </button>
                    ) : null}
                  </footer>
                </>
              ) : (
                <p className="agentMissing">
                  Not on PATH. Install its CLI and reopen this tab.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
