import type { AgentProfile, SchedulesSnapshot } from '@builderhelm/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function AutomationsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('Daily research');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [topic, setTopic] = useState('');
  const [budget, setBudget] = useState(1);
  const [profileId, setProfileId] = useState('');
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const snapshot = useQuery({
    queryKey: ['schedules'],
    queryFn: () => window.builderHelm.schedules.snapshot(),
    refetchInterval: 5_000,
  });
  const profiles = useQuery({
    queryKey: ['agent-profiles'],
    queryFn: () => window.builderHelm.agents.profiles(),
  });

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['schedules'] });
  };

  const create = useMutation({
    mutationFn: () =>
      window.builderHelm.schedules.create({
        name,
        timezone,
        trigger: {
          kind: 'daily',
          hour,
          minute,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        },
        task: {
          tool: 'apify.research',
          profileId: profileId || roster[0]?.id || '',
          topic,
          limit: 10,
          costLimitUsd: budget,
          windowDays: 7,
        },
        budgetUsd: budget,
      }),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not create the schedule');
    },
  });

  const data: SchedulesSnapshot | undefined = snapshot.data;
  const roster: readonly AgentProfile[] = profiles.data ?? [];
  const selected = profileId || roster[0]?.id || '';

  return (
    <section className="pluginsPage" aria-labelledby="automations-title">
      <header className="usagePageHead">
        <div className="usagePageTitle">
          <h1 id="automations-title">Automations</h1>
          <p>
            Schedules run only while BuilderHelm is open. Closing the app pauses them.
            Missed paid work is not replayed.
          </p>
        </div>
      </header>
      {error !== null && (
        <p className="chatError" role="alert">
          {error}
        </p>
      )}
      <article className="accountCard">
        <h2>Host must stay running</h2>
        <p>
          Lifetime is desktop-open. There is no background daemon. Sleep, a clock jump, or
          a restart will skip overdue paid runs and wait for the next slot.
        </p>
      </article>
      <article className="accountCard">
        <h2>New schedule</h2>
        <div className="pluginsRow">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Time ({timezone})
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(event) => setHour(Number(event.target.value))}
            />
            :
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(event) => setMinute(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="pluginsRow">
          <label>
            Profile
            <select
              value={selected}
              onChange={(event) => setProfileId(event.target.value)}
            >
              {roster.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Topic
            <input value={topic} onChange={(event) => setTopic(event.target.value)} />
          </label>
          <label>
            Budget USD
            <input
              type="number"
              min={0}
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={create.isPending || topic.length === 0 || selected.length === 0}
          onClick={() => create.mutate()}
        >
          Create
        </button>
      </article>
      {(data?.schedules ?? []).map((schedule) => (
        <article className="accountCard" key={schedule.id}>
          <h2>{schedule.name}</h2>
          <p>
            {schedule.state} · next {schedule.nextRunAt ?? '—'} · remaining $
            {schedule.remainingBudgetUsd}
          </p>
          <div className="pluginsRow">
            <button
              type="button"
              onClick={() => {
                const action =
                  schedule.state === 'paused'
                    ? window.builderHelm.schedules.resume
                    : window.builderHelm.schedules.pause;
                void action({ scheduleId: schedule.id })
                  .then(() => refresh())
                  .catch((err: unknown) => {
                    setError(
                      err instanceof Error ? err.message : 'Schedule update failed',
                    );
                  });
              }}
            >
              {schedule.state === 'paused' ? 'Resume' : 'Pause'}
            </button>
          </div>
        </article>
      ))}
      <article className="accountCard">
        <h2>Last runs</h2>
        <ul className="pluginsJobs">
          {(data?.runs ?? []).map((run) => (
            <li key={run.id}>
              {run.outcome}
              {run.skipReason !== null ? ` (${run.skipReason})` : ''}
              {run.notice !== null ? ` — ${run.notice}` : ''}
              {run.outcome === 'running' ? (
                <>
                  {' '}
                  <button
                    type="button"
                    onClick={() => {
                      void window.builderHelm.schedules
                        .cancelRun({ runId: run.id })
                        .then(() => refresh())
                        .catch((err: unknown) => {
                          setError(err instanceof Error ? err.message : 'Cancel failed');
                        });
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
