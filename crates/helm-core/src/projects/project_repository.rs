use helm_db::{DbRow, ZeroDatabase};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn map_row<T: for<'de> Deserialize<'de>>(row: DbRow) -> T {
    serde_json::from_value(Value::Object(row)).expect("row")
}

const REPOSITORY_COLUMNS: &str = "
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
";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProjectRepository {
    pub id: String,
    pub project_id: String,
    pub root_path: String,
    pub directory_name: String,
    pub branch: String,
    pub head_sha: String,
    pub dirty_count: i64,
    pub ahead_count: i64,
    pub behind_count: i64,
    pub last_synced_at: String,
    pub created_at: String,
    pub updated_at: String,
}

pub type ProjectRepositoryWrite = StoredProjectRepository;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRepositoryCommit {
    pub repository_id: String,
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author_name: String,
    pub authored_at: String,
}

pub type RepositoryCommitWrite = StoredRepositoryCommit;

pub struct ProjectRepositoryStore<'a> {
    database: &'a ZeroDatabase,
}

impl<'a> ProjectRepositoryStore<'a> {
    pub fn new(database: &'a ZeroDatabase) -> Self {
        Self { database }
    }

    pub fn list(&self) -> Vec<StoredProjectRepository> {
        self.database
            .query_all(
                &format!(
                    "SELECT {REPOSITORY_COLUMNS} FROM project_repositories ORDER BY project_id"
                ),
                &[],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn find_by_id(&self, id: &str) -> Option<StoredProjectRepository> {
        self.database
            .query_one(
                &format!("SELECT {REPOSITORY_COLUMNS} FROM project_repositories WHERE id = ?"),
                &[json!(id)],
            )
            .map(map_row)
    }

    pub fn find_by_project_id(&self, project_id: &str) -> Option<StoredProjectRepository> {
        self.database
            .query_one(
                &format!(
                    "SELECT {REPOSITORY_COLUMNS} FROM project_repositories WHERE project_id = ?"
                ),
                &[json!(project_id)],
            )
            .map(map_row)
    }

    pub fn find_by_root_path(&self, root_path: &str) -> Option<StoredProjectRepository> {
        self.database
            .query_one(
                &format!(
                    "SELECT {REPOSITORY_COLUMNS} FROM project_repositories WHERE root_path = ?"
                ),
                &[json!(root_path)],
            )
            .map(map_row)
    }

    pub fn list_commits(&self, repository_id: &str) -> Vec<StoredRepositoryCommit> {
        self.list_commits_limit(repository_id, 30)
    }

    pub fn list_commits_limit(
        &self,
        repository_id: &str,
        limit: i64,
    ) -> Vec<StoredRepositoryCommit> {
        self.database
            .query_all(
                "SELECT repository_id AS repositoryId, sha, short_sha AS shortSha,
        subject, author_name AS authorName, authored_at AS authoredAt
       FROM repository_commits WHERE repository_id = ?
       ORDER BY authored_at DESC, sha DESC LIMIT ?",
                &[json!(repository_id), json!(limit)],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn replace_snapshot(
        &self,
        repository: ProjectRepositoryWrite,
        commits: Vec<RepositoryCommitWrite>,
    ) {
        self.database.transaction(|| {
            self.database.run(
                "INSERT INTO project_repositories (
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
          updated_at = excluded.updated_at",
                &[
                    json!(repository.id),
                    json!(repository.project_id),
                    json!(repository.root_path),
                    json!(repository.directory_name),
                    json!(repository.branch),
                    json!(repository.head_sha),
                    json!(repository.dirty_count),
                    json!(repository.ahead_count),
                    json!(repository.behind_count),
                    json!(repository.last_synced_at),
                    json!(repository.created_at),
                    json!(repository.updated_at),
                ],
            );
            self.database.run(
                "DELETE FROM repository_commits WHERE repository_id = ?",
                &[json!(repository.id)],
            );
            for commit in &commits {
                self.database.run(
                    "INSERT INTO repository_commits (
            repository_id, sha, short_sha, subject, author_name, authored_at
          ) VALUES (?, ?, ?, ?, ?, ?)",
                    &[
                        json!(commit.repository_id),
                        json!(commit.sha),
                        json!(commit.short_sha),
                        json!(commit.subject),
                        json!(commit.author_name),
                        json!(commit.authored_at),
                    ],
                );
            }
        });
    }
}
