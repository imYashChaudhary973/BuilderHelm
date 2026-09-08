import type { AgentProfile, ConnectionsSnapshot } from '@builderhelm/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function SkillsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1');
  const [body, setBody] = useState('');
  const [profileId, setProfileId] = useState('');

  const snapshot = useQuery({
    queryKey: ['connections'],
    queryFn: () => window.builderHelm.connections.snapshot(),
  });
  const profiles = useQuery({
    queryKey: ['agent-profiles'],
    queryFn: () => window.builderHelm.agents.profiles(),
  });

  const data: ConnectionsSnapshot | undefined = snapshot.data;
  const roster: readonly AgentProfile[] = profiles.data ?? [];
  const selected = profileId || roster[0]?.id || '';
  const scm = data?.socialContentManager;

  return (
    <section className="pluginsPage" aria-labelledby="skills-title">
      <header className="usagePageHead">
        <div className="usagePageTitle">
          <h1 id="skills-title">Skills</h1>
          <p>
            Local or reviewed instructions. Binding a skill never grants tools — grants
            live on Plugins.
          </p>
        </div>
      </header>
      {error !== null && (
        <p className="chatError" role="alert">
          {error}
        </p>
      )}
      {scm !== undefined && (
        <article className="accountCard">
          <h2>{scm.name}</h2>
          <p>
            Reviewed specialized bot. Same run history, approvals, and recovery as any
            profile.
          </p>
          <pre className="pluginsSkill">{scm.instructions}</pre>
          <p>
            Create a profile with this name in Agents and paste the instructions. Then
            grant
            <code> apify.research </code>
            on Plugins.
          </p>
        </article>
      )}
      <article className="accountCard">
        <h2>New local skill</h2>
        <label className="wizardLabel" htmlFor="skill-name">
          Name
        </label>
        <input
          id="skill-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <label className="wizardLabel" htmlFor="skill-version">
          Version
        </label>
        <input
          id="skill-version"
          value={version}
          onChange={(event) => setVersion(event.target.value)}
        />
        <label className="wizardLabel" htmlFor="skill-body">
          Instructions
        </label>
        <textarea
          id="skill-body"
          rows={6}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <button
          type="button"
          disabled={name.trim().length === 0 || body.trim().length === 0}
          onClick={() =>
            void window.builderHelm.connections
              .createSkill({
                name: name.trim(),
                version: version.trim() || '1',
                body: body.trim(),
                provenance: 'local',
                capabilities: [],
              })
              .then(async () => {
                setName('');
                setBody('');
                await queryClient.invalidateQueries({ queryKey: ['connections'] });
              })
              .catch((caught: Error) => setError(caught.message))
          }
        >
          Save skill
        </button>
      </article>
      <article className="accountCard">
        <h2>Bind to a profile</h2>
        <select value={selected} onChange={(event) => setProfileId(event.target.value)}>
          {roster.length === 0 && <option value="">Create a profile first</option>}
          {roster.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <ul className="pluginsJobs">
          {(data?.skills ?? []).map((skill) => {
            const bound = data?.bindings.some(
              (binding) => binding.skillId === skill.id && binding.profileId === selected,
            );
            return (
              <li key={skill.id}>
                {skill.name} · {skill.version} · {skill.provenance}
                {skill.capabilities.length > 0
                  ? ` · needs ${skill.capabilities.join(', ')}`
                  : ''}
                {bound ? (
                  ' · bound'
                ) : (
                  <button
                    type="button"
                    disabled={selected.length === 0}
                    onClick={() =>
                      void window.builderHelm.connections
                        .bindSkill({ skillId: skill.id, profileId: selected })
                        .then(() =>
                          queryClient.invalidateQueries({ queryKey: ['connections'] }),
                        )
                        .catch((caught: Error) => setError(caught.message))
                    }
                  >
                    Bind
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </article>
    </section>
  );
}
