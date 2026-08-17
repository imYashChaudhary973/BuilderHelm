import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

function dayLabel(): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

export function TodayPage(): React.JSX.Element {
  const dashboard = useQuery({
    queryKey: ['project-dashboard'],
    queryFn: () => window.zero.projects.dashboard(),
  });
  const projects = dashboard.data?.projects ?? [];
  const blocked = projects.flatMap((item) =>
    item.tasks.filter((task) => task.status === 'blocked'),
  );
  const inProgress = projects.flatMap((item) =>
    item.tasks.filter((task) => task.status === 'in_progress'),
  );
  const coreStatus = dashboard.isLoading
    ? 'checking'
    : dashboard.isError
      ? 'unavailable'
      : 'ready';

  return (
    <>
      <header className="todayHeader">
        <div>
          <p className="eyebrow">{dayLabel()}</p>
          <h1>Continue what matters.</h1>
        </div>
        <div
          className="todayLocalState"
          data-core-status={coreStatus}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {dashboard.isLoading
            ? 'Reading local work'
            : dashboard.isError
              ? 'Data unavailable'
              : 'Local data current'}
        </div>
      </header>
      <section className="todaySummary" aria-label="Today summary">
        <div>
          <span>Active projects</span>
          <strong>
            {projects.filter((item) => item.project.status === 'active').length}
          </strong>
        </div>
        <div>
          <span>In progress</span>
          <strong>{inProgress.length}</strong>
        </div>
        <div>
          <span>Blocked</span>
          <strong>{blocked.length}</strong>
        </div>
        <div>
          <span>Repositories</span>
          <strong>{projects.filter((item) => item.repository !== null).length}</strong>
        </div>
      </section>
      {projects.length === 0 && !dashboard.isLoading ? (
        <section className="todayEmpty">
          <p className="eyebrow">Clear desk</p>
          <h2>Your active work will gather here.</h2>
          <p>
            Create a project through Actions. Today will then surface its tasks, blockers,
            decisions, and Git activity.
          </p>
          <Link className="primaryButton" to="/actions">
            Create through Actions
          </Link>
        </section>
      ) : (
        <section className="todayProjects" aria-labelledby="today-projects-title">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">Active threads</p>
              <h2 id="today-projects-title">Where to resume</h2>
            </div>
            <Link to="/projects">Open project view</Link>
          </div>
          <div className="todayProjectRows">
            {projects.slice(0, 6).map((item) => {
              const nextTask =
                item.tasks.find((task) => task.status === 'in_progress') ??
                item.tasks.find((task) => task.status === 'todo');
              const projectBlocked = item.tasks.filter(
                (task) => task.status === 'blocked',
              ).length;
              return (
                <article key={item.project.id}>
                  <div className="todayProjectIdentity">
                    <span aria-hidden="true" />
                    <div>
                      <h3>{item.project.name}</h3>
                      <p>
                        {item.repository === null
                          ? 'Repository not connected'
                          : `${item.repository.branch} · ${item.repository.dirtyCount === 0 ? 'clean' : `${item.repository.dirtyCount} changes`}`}
                      </p>
                    </div>
                  </div>
                  <div>
                    <span>Next</span>
                    <strong>{nextTask?.title ?? 'Choose the next task'}</strong>
                  </div>
                  <div>
                    <span>Signal</span>
                    <strong>
                      {projectBlocked > 0
                        ? `${projectBlocked} blocked`
                        : `${item.timeline.length} recent events`}
                    </strong>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
