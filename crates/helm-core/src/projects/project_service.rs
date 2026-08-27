use helm_db::ZeroDatabase;
use helm_observability::{LogInput, Logger};
use helm_protocol::GitCommit;
use helm_shared::{create_id, utc_now, CorrelationId, ZeroError, ZeroErrorCode};
use serde::{Deserialize, Serialize};

use crate::actions::ActionRepository;
use crate::error_convert::failed;
use crate::projects::{GitSnapshot, LocalGitInspector, ProjectRepositoryStore};

const MAX_PROJECTS: i64 = 500;
const MAX_TASKS: i64 = 500;
const MAX_TIMELINE_ITEMS: usize = 100;
const MAX_TIMELINE_DETAIL: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub due_at: Option<String>,
    pub source: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDecision {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub detail: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRepository {
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
    pub commits: Vec<GitCommit>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTimelineItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
    pub occurred_at: String,
    pub state: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDashboard {
    pub project: Project,
    pub tasks: Vec<Task>,
    pub decisions: Vec<ProjectDecision>,
    pub repository: Option<ProjectRepository>,
    pub timeline: Vec<ProjectTimelineItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDashboardSnapshot {
    pub generated_at: String,
    pub projects: Vec<ProjectDashboard>,
}

fn to_timeline_detail(value: Option<&str>) -> Option<String> {
    let detail = value?.trim();
    if detail.is_empty() {
        return None;
    }
    Some(if detail.len() <= MAX_TIMELINE_DETAIL {
        detail.to_string()
    } else {
        format!("{}…", &detail[..MAX_TIMELINE_DETAIL - 1])
    })
}

pub struct ProjectService<'a> {
    actions: ActionRepository<'a>,
    repositories: ProjectRepositoryStore<'a>,
    logger: &'a Logger,
    git: LocalGitInspector,
}

impl<'a> ProjectService<'a> {
    pub fn new(
        actions: ActionRepository<'a>,
        repositories: ProjectRepositoryStore<'a>,
        logger: &'a Logger,
    ) -> Self {
        Self {
            actions,
            repositories,
            logger,
            git: LocalGitInspector::new(),
        }
    }

    pub fn from_database(database: &'a ZeroDatabase, logger: &'a Logger) -> Self {
        Self::new(
            ActionRepository::new(database),
            ProjectRepositoryStore::new(database),
            logger,
        )
    }

    pub fn dashboard(&self) -> Result<ProjectDashboardSnapshot, ZeroError> {
        let projects = self
            .actions
            .list_projects(Some(MAX_PROJECTS))
            .into_iter()
            .map(|project| self.project(&project.id))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ProjectDashboardSnapshot {
            generated_at: utc_now(),
            projects,
        })
    }

    pub fn project(&self, project_id: &str) -> Result<ProjectDashboard, ZeroError> {
        let project = self
            .actions
            .find_project_by_id(project_id)
            .ok_or_else(|| failed(ZeroErrorCode::ValidationFailed, "The project was not found"))?;
        let tasks: Vec<Task> = self
            .actions
            .list_tasks(Some(project_id), None, Some(MAX_TASKS))
            .into_iter()
            .map(convert)
            .collect();
        let decisions: Vec<ProjectDecision> = self
            .actions
            .list_decisions(project_id)
            .into_iter()
            .map(convert)
            .collect();
        let stored_repository = self.repositories.find_by_project_id(project_id);
        let repository = stored_repository
            .as_ref()
            .map(|value| self.to_repository(value));
        let mut timeline: Vec<ProjectTimelineItem> = tasks
            .iter()
            .map(|task| ProjectTimelineItem {
                id: format!("task:{}", task.id),
                kind: "task".into(),
                title: task.title.clone(),
                detail: to_timeline_detail(task.description.as_deref()),
                occurred_at: task.updated_at.clone(),
                state: Some(task.status.clone()),
            })
            .chain(decisions.iter().map(|decision| ProjectTimelineItem {
                id: format!("decision:{}", decision.id),
                kind: "decision".into(),
                title: decision.title.clone(),
                detail: to_timeline_detail(decision.detail.as_deref()),
                occurred_at: decision.created_at.clone(),
                state: None,
            }))
            .chain(
                repository
                    .as_ref()
                    .map(|repo| {
                        repo.commits
                            .iter()
                            .map(|commit| ProjectTimelineItem {
                                id: format!("commit:{}", commit.sha),
                                kind: "commit".into(),
                                title: commit.subject.clone(),
                                detail: Some(format!(
                                    "{} · {}",
                                    commit.short_sha, commit.author_name
                                )),
                                occurred_at: commit.authored_at.clone(),
                                state: None,
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default(),
            )
            .collect();
        timeline.sort_by(|left, right| right.occurred_at.cmp(&left.occurred_at));
        timeline.truncate(MAX_TIMELINE_ITEMS);
        Ok(ProjectDashboard {
            project: convert(project),
            tasks,
            decisions,
            repository,
            timeline,
        })
    }

    pub fn register_repository(
        &self,
        project_id: &str,
        selected_path: &str,
        correlation_id: &CorrelationId,
    ) -> Result<ProjectDashboard, ZeroError> {
        if self.actions.find_project_by_id(project_id).is_none() {
            return Err(failed(
                ZeroErrorCode::ValidationFailed,
                "The project was not found",
            ));
        }
        let snapshot = self.git.inspect(selected_path)?;
        if let Some(owner) = self.repositories.find_by_root_path(&snapshot.root_path) {
            if owner.project_id != project_id {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "That repository is already registered to another project",
                ));
            }
        }
        let existing = self.repositories.find_by_project_id(project_id);
        let repository_id = existing
            .as_ref()
            .map(|value| value.id.clone())
            .unwrap_or_else(|| create_id(now_millis()).to_string());
        self.persist(
            project_id,
            &repository_id,
            &snapshot,
            existing.as_ref().map(|value| value.created_at.as_str()),
        );
        self.logger.info(LogInput {
            event: "project.repository_registered",
            correlation_id: correlation_id.as_str(),
            data: Some(serde_json::json!({
                "projectId": project_id,
                "repositoryId": existing.as_ref().map(|value| value.id.as_str()).unwrap_or("[NEW]"),
            })),
        });
        self.project(project_id)
    }

    pub fn refresh_repository(
        &self,
        repository_id: &str,
        correlation_id: &CorrelationId,
    ) -> Result<ProjectDashboard, ZeroError> {
        let repository = self.repositories.find_by_id(repository_id).ok_or_else(|| {
            failed(
                ZeroErrorCode::ValidationFailed,
                "The repository was not found",
            )
        })?;
        let snapshot = self.git.inspect(&repository.root_path)?;
        if snapshot.root_path != repository.root_path {
            return Err(failed(
                ZeroErrorCode::PermissionDenied,
                "The repository location changed",
            ));
        }
        self.persist(
            &repository.project_id,
            &repository.id,
            &snapshot,
            Some(&repository.created_at),
        );
        self.logger.info(LogInput {
            event: "project.repository_refreshed",
            correlation_id: correlation_id.as_str(),
            data: Some(serde_json::json!({
                "projectId": repository.project_id,
                "repositoryId": repository_id,
            })),
        });
        self.project(&repository.project_id)
    }

    fn persist(
        &self,
        project_id: &str,
        repository_id: &str,
        snapshot: &GitSnapshot,
        created_at: Option<&str>,
    ) {
        let now = utc_now();
        let created = created_at.unwrap_or(&now).to_string();
        self.repositories.replace_snapshot(
            crate::projects::project_repository::ProjectRepositoryWrite {
                id: repository_id.to_string(),
                project_id: project_id.to_string(),
                root_path: snapshot.root_path.clone(),
                directory_name: snapshot.directory_name.clone(),
                branch: snapshot.branch.clone(),
                head_sha: snapshot.head_sha.clone(),
                dirty_count: snapshot.dirty_count,
                ahead_count: snapshot.ahead_count,
                behind_count: snapshot.behind_count,
                last_synced_at: now.clone(),
                created_at: created,
                updated_at: now,
            },
            snapshot
                .commits
                .iter()
                .map(
                    |commit| crate::projects::project_repository::RepositoryCommitWrite {
                        repository_id: repository_id.to_string(),
                        sha: commit.sha.clone(),
                        short_sha: commit.short_sha.clone(),
                        subject: commit.subject.clone(),
                        author_name: commit.author_name.clone(),
                        authored_at: commit.authored_at.clone(),
                    },
                )
                .collect(),
        );
    }

    fn to_repository(
        &self,
        value: &crate::projects::project_repository::StoredProjectRepository,
    ) -> ProjectRepository {
        ProjectRepository {
            id: value.id.clone(),
            project_id: value.project_id.clone(),
            root_path: value.root_path.clone(),
            directory_name: value.directory_name.clone(),
            branch: value.branch.clone(),
            head_sha: value.head_sha.clone(),
            dirty_count: value.dirty_count,
            ahead_count: value.ahead_count,
            behind_count: value.behind_count,
            last_synced_at: value.last_synced_at.clone(),
            commits: self
                .repositories
                .list_commits(&value.id)
                .into_iter()
                .map(|commit| GitCommit {
                    sha: commit.sha,
                    short_sha: commit.short_sha,
                    subject: commit.subject,
                    author_name: commit.author_name,
                    authored_at: commit.authored_at,
                })
                .collect(),
        }
    }
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn convert<T, U>(value: T) -> U
where
    T: Serialize,
    U: for<'de> Deserialize<'de>,
{
    serde_json::from_value(serde_json::to_value(value).expect("convert")).expect("convert")
}
