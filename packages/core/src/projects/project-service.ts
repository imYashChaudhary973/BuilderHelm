import type {
  ActionRepository,
  ProjectRepositoryStore,
  StoredProject,
  StoredProjectDecision,
  StoredProjectRepository,
  StoredTask,
} from '@builderhelm/db';
import type { Logger } from '@builderhelm/observability';
import {
  projectDashboardSchema,
  projectDashboardSnapshotSchema,
  projectDecisionSchema,
  projectRepositorySchema,
  projectSchema,
  taskSchema,
  type ProjectDashboard,
  type ProjectDashboardSnapshot,
  type ProjectTimelineItem,
} from '@builderhelm/protocol';
import {
  createId,
  utcNow,
  BuilderHelmError,
  type CorrelationId,
} from '@builderhelm/shared';

import {
  LocalGitInspector,
  type GitInspector,
  type GitSnapshot,
} from './git-inspector.js';

function toProject(value: StoredProject) {
  return projectSchema.parse({
    id: value.id,
    name: value.name,
    description: value.description,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function toTask(value: StoredTask) {
  return taskSchema.parse({
    id: value.id,
    projectId: value.projectId,
    title: value.title,
    description: value.description,
    status: value.status,
    priority: value.priority,
    dueAt: value.dueAt,
    source: value.source,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  });
}

function toDecision(value: StoredProjectDecision) {
  return projectDecisionSchema.parse(value);
}

// The dashboard schema bounds each collection it returns. Tasks, decisions and
// timeline detail all come from sources with looser limits, so they are bounded
// here rather than left to fail response validation and take out the whole
// dashboard for every project.
const MAX_PROJECTS = 500;
const MAX_TASKS = 500;
const MAX_TIMELINE_ITEMS = 100;
const MAX_TIMELINE_DETAIL = 1_000;

function toTimelineDetail(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const detail = value.trim();
  return detail.length <= MAX_TIMELINE_DETAIL
    ? detail
    : `${detail.slice(0, MAX_TIMELINE_DETAIL - 1)}…`;
}

export class ProjectService {
  constructor(
    private readonly actions: ActionRepository,
    private readonly repositories: ProjectRepositoryStore,
    private readonly logger: Logger,
    private readonly git: GitInspector = new LocalGitInspector(),
  ) {}

  /**
   * Root paths of every registered repository.
   *
   * Startup worktree recovery needs to know which repositories to inspect, and
   * the repository store is owned here.
   */
  listRepositoryRoots(): string[] {
    return [...new Set(this.repositories.list().map((entry) => entry.rootPath))];
  }

  dashboard(): ProjectDashboardSnapshot {
    return projectDashboardSnapshotSchema.parse({
      generatedAt: utcNow(),
      projects: this.actions
        .listProjects(MAX_PROJECTS)
        .map((project) => this.project(project.id)),
    });
  }

  project(projectId: string): ProjectDashboard {
    const project = this.actions.findProjectById(projectId);
    if (project === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'The project was not found');
    }
    const tasks = this.actions.listTasks(projectId, undefined, MAX_TASKS).map(toTask);
    const decisions = this.actions.listDecisions(projectId).map(toDecision);
    const storedRepository = this.repositories.findByProjectId(projectId);
    const repository =
      storedRepository === undefined ? null : this.toRepository(storedRepository);
    const timeline: ProjectTimelineItem[] = [
      ...tasks.map((task) => ({
        id: `task:${task.id}`,
        kind: 'task' as const,
        title: task.title,
        detail: toTimelineDetail(task.description),
        occurredAt: task.updatedAt,
        state: task.status,
      })),
      ...decisions.map((decision) => ({
        id: `decision:${decision.id}`,
        kind: 'decision' as const,
        title: decision.title,
        detail: toTimelineDetail(decision.detail),
        occurredAt: decision.createdAt,
        state: null,
      })),
      ...(repository?.commits.map((commit) => ({
        id: `commit:${commit.sha}`,
        kind: 'commit' as const,
        title: commit.subject,
        detail: `${commit.shortSha} · ${commit.authorName}`,
        occurredAt: commit.authoredAt,
        state: null,
      })) ?? []),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, MAX_TIMELINE_ITEMS);

    return projectDashboardSchema.parse({
      project: toProject(project),
      tasks,
      decisions,
      repository,
      timeline,
    });
  }

  registerRepository(
    projectId: string,
    selectedPath: string,
    correlationId: CorrelationId,
  ): ProjectDashboard {
    if (this.actions.findProjectById(projectId) === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'The project was not found');
    }
    const snapshot = this.git.inspect(selectedPath);
    const owner = this.repositories.findByRootPath(snapshot.rootPath);
    if (owner !== undefined && owner.projectId !== projectId) {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'That repository is already registered to another project',
      );
    }
    const existing = this.repositories.findByProjectId(projectId);
    this.persist(projectId, existing?.id ?? createId(), snapshot, existing?.createdAt);
    this.logger.info({
      event: 'project.repository_registered',
      correlationId,
      data: { projectId, repositoryId: existing?.id ?? '[NEW]' },
    });
    return this.project(projectId);
  }

  refreshRepository(
    repositoryId: string,
    correlationId: CorrelationId,
  ): ProjectDashboard {
    const repository = this.repositories.findById(repositoryId);
    if (repository === undefined) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'The repository was not found');
    }
    const snapshot = this.git.inspect(repository.rootPath);
    if (snapshot.rootPath !== repository.rootPath) {
      throw new BuilderHelmError('PERMISSION_DENIED', 'The repository location changed');
    }
    this.persist(repository.projectId, repository.id, snapshot, repository.createdAt);
    this.logger.info({
      event: 'project.repository_refreshed',
      correlationId,
      data: { projectId: repository.projectId, repositoryId },
    });
    return this.project(repository.projectId);
  }

  private persist(
    projectId: string,
    repositoryId: string,
    snapshot: GitSnapshot,
    createdAt = utcNow(),
  ): void {
    const now = utcNow();
    this.repositories.replaceSnapshot(
      {
        id: repositoryId,
        projectId,
        rootPath: snapshot.rootPath,
        directoryName: snapshot.directoryName,
        branch: snapshot.branch,
        headSha: snapshot.headSha,
        dirtyCount: snapshot.dirtyCount,
        aheadCount: snapshot.aheadCount,
        behindCount: snapshot.behindCount,
        lastSyncedAt: now,
        createdAt,
        updatedAt: now,
      },
      snapshot.commits.map((commit) => ({ ...commit, repositoryId })),
    );
  }

  private toRepository(value: StoredProjectRepository) {
    return projectRepositorySchema.parse({
      id: value.id,
      projectId: value.projectId,
      rootPath: value.rootPath,
      directoryName: value.directoryName,
      branch: value.branch,
      headSha: value.headSha,
      dirtyCount: value.dirtyCount,
      aheadCount: value.aheadCount,
      behindCount: value.behindCount,
      lastSyncedAt: value.lastSyncedAt,
      commits: this.repositories.listCommits(value.id).map((commit) => ({
        sha: commit.sha,
        shortSha: commit.shortSha,
        subject: commit.subject,
        authorName: commit.authorName,
        authoredAt: commit.authoredAt,
      })),
    });
  }
}
