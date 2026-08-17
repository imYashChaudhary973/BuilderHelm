import type { ZeroDatabase } from './database.js';

export interface StoredProjectRepository extends Record<string, unknown> {
  id: string;
  projectId: string;
  rootPath: string;
  directoryName: string;
  branch: string;
  headSha: string;
  dirtyCount: number;
  aheadCount: number;
  behindCount: number;
  lastSyncedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredRepositoryCommit extends Record<string, unknown> {
  repositoryId: string;
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authoredAt: string;
}

export type ProjectRepositoryWrite = StoredProjectRepository;
export type RepositoryCommitWrite = StoredRepositoryCommit;

const repositoryColumns = `
  id,
  project_id AS projectId,
  root_path AS rootPath,
  directory_name AS directoryName,
  branch,
  head_sha AS headSha,
  dirty_count AS dirtyCount,
  ahead_count AS aheadCount,
  behind_count AS behindCount,
  last_synced_at AS lastSyncedAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export class ProjectRepositoryStore {
  constructor(private readonly database: ZeroDatabase) {}

  list(): StoredProjectRepository[] {
    return this.database.queryAll<StoredProjectRepository>(
      `SELECT ${repositoryColumns} FROM project_repositories ORDER BY project_id`,
    );
  }

  findById(id: string): StoredProjectRepository | undefined {
    return this.database.queryOne<StoredProjectRepository>(
      `SELECT ${repositoryColumns} FROM project_repositories WHERE id = ?`,
      [id],
    );
  }

  findByProjectId(projectId: string): StoredProjectRepository | undefined {
    return this.database.queryOne<StoredProjectRepository>(
      `SELECT ${repositoryColumns} FROM project_repositories WHERE project_id = ?`,
      [projectId],
    );
  }

  findByRootPath(rootPath: string): StoredProjectRepository | undefined {
    return this.database.queryOne<StoredProjectRepository>(
      `SELECT ${repositoryColumns} FROM project_repositories WHERE root_path = ?`,
      [rootPath],
    );
  }

  listCommits(repositoryId: string, limit = 30): StoredRepositoryCommit[] {
    return this.database.queryAll<StoredRepositoryCommit>(
      `SELECT repository_id AS repositoryId, sha, short_sha AS shortSha,
        subject, author_name AS authorName, authored_at AS authoredAt
       FROM repository_commits WHERE repository_id = ?
       ORDER BY authored_at DESC, sha DESC LIMIT ?`,
      [repositoryId, limit],
    );
  }

  replaceSnapshot(
    repository: ProjectRepositoryWrite,
    commits: readonly RepositoryCommitWrite[],
  ): void {
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO project_repositories (
          id, project_id, root_path, directory_name, branch, head_sha,
          dirty_count, ahead_count, behind_count, last_synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          root_path = excluded.root_path,
          directory_name = excluded.directory_name,
          branch = excluded.branch,
          head_sha = excluded.head_sha,
          dirty_count = excluded.dirty_count,
          ahead_count = excluded.ahead_count,
          behind_count = excluded.behind_count,
          last_synced_at = excluded.last_synced_at,
          updated_at = excluded.updated_at`,
        [
          repository.id,
          repository.projectId,
          repository.rootPath,
          repository.directoryName,
          repository.branch,
          repository.headSha,
          repository.dirtyCount,
          repository.aheadCount,
          repository.behindCount,
          repository.lastSyncedAt,
          repository.createdAt,
          repository.updatedAt,
        ],
      );
      this.database.run('DELETE FROM repository_commits WHERE repository_id = ?', [
        repository.id,
      ]);
      for (const commit of commits) {
        this.database.run(
          `INSERT INTO repository_commits (
            repository_id, sha, short_sha, subject, author_name, authored_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            commit.repositoryId,
            commit.sha,
            commit.shortSha,
            commit.subject,
            commit.authorName,
            commit.authoredAt,
          ],
        );
      }
    });
  }
}
