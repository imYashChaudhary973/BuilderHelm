import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ProjectDashboard,
  ProjectTimelineItem,
} from '@builderhelm/protocol/projects';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

function when(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function TimelineItem({ item }: { readonly item: ProjectTimelineItem }) {
  return (
    <li className={`timelineItem timeline-${item.kind}`}>
      <span className="timelineNode" aria-hidden="true" />
      <div>
        <div className="timelineMeta">
          <span>{item.kind}</span>
          <time dateTime={item.occurredAt}>{when(item.occurredAt)}</time>
        </div>
        <strong>{item.title}</strong>
        {item.detail !== null && <p>{item.detail}</p>}
      </div>
      {item.state !== null && <span className="timelineState">{item.state}</span>}
    </li>
  );
}

function ProjectDetail({ dashboard }: { readonly dashboard: ProjectDashboard }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const register = useMutation({
    mutationFn: () =>
      window.builderHelm.projects.selectRepository({ projectId: dashboard.project.id }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project-dashboard'] });
    },
    onError: () => setError('That folder could not be registered as a Git repository.'),
  });
  const refresh = useMutation({
    mutationFn: () =>
      window.builderHelm.projects.refreshRepository({
        repositoryId: dashboard.repository!.id,
      }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project-dashboard'] });
    },
    onError: () => setError('The repository could not be refreshed. Prior data remains.'),
  });
  const blocked = dashboard.tasks.filter((task) => task.status === 'blocked');

  return (
    <section className="projectDetail" aria-labelledby="project-detail-title">
      <div className="projectDetailHeader">
        <div>
          <p className="eyebrow">{dashboard.project.status} project</p>
          <h2 id="project-detail-title">{dashboard.project.name}</h2>
          <p>{dashboard.project.description ?? 'No project description yet.'}</p>
        </div>
        <button
          className="primaryButton"
          type="button"
          disabled={register.isPending || refresh.isPending}
          onClick={() =>
            dashboard.repository === null ? register.mutate() : refresh.mutate()
          }
        >
          {register.isPending || refresh.isPending
            ? 'Reading Git…'
            : dashboard.repository === null
              ? 'Register repository'
              : 'Refresh Git'}
        </button>
      </div>
      {error !== null && (
        <p className="errorBanner" role="alert">
          {error}
        </p>
      )}
      {dashboard.repository === null ? (
        <div className="repositoryEmpty">
          <span aria-hidden="true">⌁</span>
          <div>
            <strong>No repository connected</strong>
            <p>
              Select a local Git folder. BuilderHelm reads status and recent commits only.
            </p>
          </div>
        </div>
      ) : (
        <div className="repositoryStrip" aria-label="Repository status">
          <div>
            <span>Repository</span>
            <strong>{dashboard.repository.directoryName}</strong>
          </div>
          <div>
            <span>Branch</span>
            <strong>{dashboard.repository.branch}</strong>
          </div>
          <div>
            <span>Working tree</span>
            <strong>
              {dashboard.repository.dirtyCount === 0
                ? 'Clean'
                : `${dashboard.repository.dirtyCount} changes`}
            </strong>
          </div>
          <div>
            <span>Remote</span>
            <strong>
              {dashboard.repository.aheadCount} ahead · {dashboard.repository.behindCount}{' '}
              behind
            </strong>
          </div>
        </div>
      )}
      <div className="projectContinuityGrid">
        <section className="projectTimeline" aria-labelledby="timeline-title">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">Continuity rail</p>
              <h3 id="timeline-title">What changed</h3>
            </div>
            <span>{dashboard.timeline.length} signals</span>
          </div>
          {dashboard.timeline.length === 0 ? (
            <p className="projectEmptyCopy">
              Tasks, decisions, and commits will meet here.
            </p>
          ) : (
            <ol>
              {dashboard.timeline.map((item) => (
                <TimelineItem item={item} key={item.id} />
              ))}
            </ol>
          )}
        </section>
        <aside className="projectSignals" aria-label="Project blockers and decisions">
          <section>
            <div className="sectionHeading">
              <h3>Blockers</h3>
              <span>{blocked.length}</span>
            </div>
            {blocked.length === 0 ? (
              <p className="projectEmptyCopy">No blocked tasks.</p>
            ) : (
              <ul>
                {blocked.map((task) => (
                  <li key={task.id}>
                    <strong>{task.title}</strong>
                    <span>{task.priority} priority</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <div className="sectionHeading">
              <h3>Decisions</h3>
              <span>{dashboard.decisions.length}</span>
            </div>
            {dashboard.decisions.length === 0 ? (
              <p className="projectEmptyCopy">No durable decisions recorded.</p>
            ) : (
              <ul>
                {dashboard.decisions.slice(0, 6).map((decision) => (
                  <li key={decision.id}>
                    <strong>{decision.title}</strong>
                    <span>{when(decision.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

export function ProjectsPage(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState('');
  const dashboard = useQuery({
    queryKey: ['project-dashboard'],
    queryFn: () => window.builderHelm.projects.dashboard(),
  });
  useEffect(() => {
    if (
      dashboard.data?.projects[0] !== undefined &&
      !dashboard.data.projects.some((item) => item.project.id === selectedId)
    ) {
      setSelectedId(dashboard.data.projects[0].project.id);
    }
  }, [dashboard.data, selectedId]);
  const selected = dashboard.data?.projects.find(
    (item) => item.project.id === selectedId,
  );

  return (
    <>
      <header className="settingsHeader projectPageHeader">
        <div>
          <p className="eyebrow">Phase 5 · local continuity</p>
          <h1>Projects</h1>
          <p className="lede">One timeline for the work, the decisions, and the code.</p>
        </div>
        <Link className="secondaryLink" to="/actions">
          Manage through Actions
        </Link>
      </header>
      {dashboard.isError && (
        <p className="errorBanner" role="alert">
          Project data is unavailable.
        </p>
      )}
      {(dashboard.data?.projects.length ?? 0) === 0 ? (
        <section className="projectPageEmpty">
          <p className="eyebrow">No active thread</p>
          <h2>Start with a project.</h2>
          <p>
            Create one through the permissioned Actions flow, then connect its local
            repository here.
          </p>
          <Link className="primaryButton" to="/actions">
            Open Actions
          </Link>
        </section>
      ) : (
        <div className="projectsWorkspace">
          <aside className="projectIndex" aria-label="Projects">
            <p className="eyebrow">Project index</p>
            {dashboard.data?.projects.map((item, index) => {
              const blocked = item.tasks.filter(
                (task) => task.status === 'blocked',
              ).length;
              return (
                <button
                  className={
                    item.project.id === selectedId
                      ? 'projectIndexItem projectIndexItemActive'
                      : 'projectIndexItem'
                  }
                  type="button"
                  key={item.project.id}
                  onClick={() => setSelectedId(item.project.id)}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{item.project.name}</strong>
                  <small>
                    {blocked > 0 ? `${blocked} blocked` : `${item.tasks.length} tasks`}
                  </small>
                </button>
              );
            })}
          </aside>
          {selected !== undefined && <ProjectDetail dashboard={selected} />}
        </div>
      )}
    </>
  );
}
