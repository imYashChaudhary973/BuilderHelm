import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function RoutinesPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [agentId, setAgentId] = useState('');
  const [minutes, setMinutes] = useState(1440);
  const [error, setError] = useState<string | null>(null);
  const agents = useQuery({
    queryKey: ['helm-agents'],
    queryFn: () => window.zero.helm.listAgents(),
  });
  const routines = useQuery({
    queryKey: ['helm-routines'],
    queryFn: () => window.zero.helm.listRoutines(),
  });
  const create = useMutation({
    mutationFn: () =>
      window.zero.helm.createRoutine({
        agentId,
        name: name.trim(),
        instruction: instruction.trim(),
        everyMinutes: minutes,
      }),
    onSuccess: async () => {
      setName('');
      setInstruction('');
      await queryClient.invalidateQueries({ queryKey: ['helm-routines'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  return (
    <section className="spaceStage" aria-labelledby="routines-title">
      <div className="boardPage">
        <p className="eyebrow">Routines</p>
        <h1 id="routines-title">Scheduled teammates</h1>
        <p className="lede">
          Runs only while BuilderHelm is open. Each tick opens a fresh Chat draft. No
          publish, delete, or pay unattended.
        </p>
        {error !== null ? (
          <p className="errorBanner" role="alert">
            {error}
          </p>
        ) : null}
        <form
          className="wizardSection"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim().length > 0 && agentId.length > 0) create.mutate();
          }}
        >
          <label className="wizardLabel" htmlFor="routine-agent">
            Agent
          </label>
          <select
            id="routine-agent"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          >
            <option value="">Choose teammate</option>
            {(agents.data ?? []).map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <input
            value={name}
            placeholder="Morning repo summary"
            onChange={(event) => setName(event.target.value)}
          />
          <textarea
            value={instruction}
            placeholder="Inspect this week’s merges. Draft notes. Do not publish."
            rows={4}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <label className="wizardLabel" htmlFor="routine-mins">
            Every N minutes
          </label>
          <input
            id="routine-mins"
            type="number"
            min={15}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />
          <button
            className="primaryButton"
            type="submit"
            disabled={name.trim().length === 0 || agentId.length === 0}
          >
            Save routine
          </button>
        </form>
        <ul className="swarmRecap">
          {(routines.data ?? []).map((routine) => (
            <li key={routine.id}>
              <span>{routine.paused ? 'paused' : `every ${routine.everyMinutes}m`}</span>
              <strong>{routine.name}</strong>
              <p>{routine.instruction}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
