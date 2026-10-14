import type { RuntimeCapability } from '@builderhelm/protocol/runtime';

/** The same detected transport record informs both chat and profile setup. */
export function AgentAvailability({
  runtimes,
}: {
  readonly runtimes: readonly RuntimeCapability[];
}): React.JSX.Element | null {
  const terminalAgents = runtimes.filter(
    (runtime) =>
      runtime.transports.includes('pty') && !runtime.transports.includes('acp'),
  );
  if (terminalAgents.length === 0) return null;
  return (
    <div className="agentAvailability" role="status">
      <p>Available in Code terminals</p>
      <ul>
        {terminalAgents.map((runtime) => (
          <li key={runtime.id}>
            <strong>{runtime.label}</strong>:{' '}
            {runtime.detail ?? 'This CLI does not offer structured chat. Use it in Code.'}
          </li>
        ))}
      </ul>
    </div>
  );
}
