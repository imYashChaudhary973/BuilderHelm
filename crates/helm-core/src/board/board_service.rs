use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use helm_db::ZeroDatabase;
use helm_observability::{LogInput, Logger};
use helm_protocol::{
    BoardAgentDetection, BoardAgentId, BoardIsolation, BoardPaneSpec, KanbanCard, KanbanColumn,
    BOARD_AGENT_CATALOG,
};
use helm_shared::{create_id, utc_now, CorrelationId, ZeroError, ZeroErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error_convert::failed;

const PRESET_COLUMNS: &str = "
  id,
  name,
  folder_path AS folderPath,
  pane_count AS paneCount,
  isolation,
  panes_json AS panesJson,
  created_at AS createdAt
";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardPresetSpec {
    pub name: String,
    pub folder_path: String,
    pub pane_count: i64,
    pub isolation: BoardIsolation,
    pub panes: Vec<BoardPaneSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardPresetRecord {
    pub name: String,
    pub folder_path: String,
    pub pane_count: i64,
    pub isolation: BoardIsolation,
    pub panes: Vec<BoardPaneSpec>,
    pub id: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KanbanProject {
    pub id: String,
    pub name: String,
    pub task_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LandResult {
    pub landed: bool,
    pub head: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LandPreview {
    pub branch: String,
    pub base: String,
    pub ahead: i64,
    pub files: Vec<String>,
    pub stat: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EnsureRepositoryResult {
    pub initialized: bool,
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorktreeResult {
    pub path: String,
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Deleted {
    pub deleted: bool,
}

fn row_string(row: &helm_db::DbRow, key: &str) -> String {
    match row.get(key) {
        Some(Value::String(value)) => value.clone(),
        Some(other) => other.as_str().unwrap_or_default().to_string(),
        None => String::new(),
    }
}

fn row_i64(row: &helm_db::DbRow, key: &str) -> i64 {
    match row.get(key) {
        Some(Value::Number(value)) => value.as_i64().unwrap_or(0),
        Some(Value::String(value)) => value.parse().unwrap_or(0),
        _ => 0,
    }
}

fn is_unique_violation(message: &str) -> bool {
    message.contains("UNIQUE") || message.contains("CONSTRAINT") || message.contains("unique")
}

fn assert_exeum_branch(branch: &str) -> Result<(), ZeroError> {
    let valid = branch.starts_with("exeum/")
        && branch.len() > 6
        && branch[6..]
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'));
    if valid {
        Ok(())
    } else {
        Err(failed(
            ZeroErrorCode::ValidationFailed,
            "Only exeum/* pane branches can be landed",
        ))
    }
}

async fn exec_file(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout_ms: u64,
) -> Result<(String, String), std::io::Error> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let child = command.spawn()?;
    match tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait_with_output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            if output.status.success() {
                Ok((stdout, stderr))
            } else {
                Err(std::io::Error::other(if stderr.is_empty() {
                    stdout
                } else {
                    stderr
                }))
            }
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "command timed out",
        )),
    }
}

pub struct BoardService<'a> {
    database: &'a ZeroDatabase,
    logger: &'a Logger,
    agent_probe: RefCell<Option<Vec<BoardAgentDetection>>>,
    agent_probe_started: RefCell<bool>,
}

impl<'a> BoardService<'a> {
    pub fn new(database: &'a ZeroDatabase, logger: &'a Logger) -> Self {
        Self {
            database,
            logger,
            agent_probe: RefCell::new(None),
            agent_probe_started: RefCell::new(false),
        }
    }

    pub fn list_presets(&self) -> Result<Vec<BoardPresetRecord>, ZeroError> {
        self.database
            .query_all(
                &format!("SELECT {PRESET_COLUMNS} FROM board_presets ORDER BY created_at DESC"),
                &[],
            )
            .into_iter()
            .map(|row| {
                let panes: Vec<BoardPaneSpec> =
                    serde_json::from_str(&row_string(&row, "panesJson")).unwrap_or_default();
                let isolation = match row_string(&row, "isolation").as_str() {
                    "worktree" => BoardIsolation::Worktree,
                    _ => BoardIsolation::Shared,
                };
                Ok(BoardPresetRecord {
                    name: row_string(&row, "name"),
                    folder_path: row_string(&row, "folderPath"),
                    pane_count: row_i64(&row, "paneCount"),
                    isolation,
                    panes,
                    id: row_string(&row, "id"),
                    created_at: row_string(&row, "createdAt"),
                })
            })
            .collect()
    }

    pub fn save_preset(
        &self,
        preset: BoardPresetSpec,
        correlation_id: &CorrelationId,
    ) -> Result<BoardPresetRecord, ZeroError> {
        let record = BoardPresetRecord {
            name: preset.name,
            folder_path: preset.folder_path,
            pane_count: preset.pane_count,
            isolation: preset.isolation,
            panes: preset.panes,
            id: new_id(),
            created_at: utc_now(),
        };
        let isolation = match record.isolation {
            BoardIsolation::Worktree => "worktree",
            BoardIsolation::Shared => "shared",
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.database.run(
                "INSERT INTO board_presets (
                  id, name, folder_path, pane_count, isolation, panes_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)",
                &[
                    json!(record.id),
                    json!(record.name),
                    json!(record.folder_path),
                    json!(record.pane_count),
                    json!(isolation),
                    json!(serde_json::to_string(&record.panes).unwrap_or_else(|_| "[]".into())),
                    json!(record.created_at),
                ],
            );
        }));
        if let Err(payload) = result {
            let message = panic_message(&payload);
            if is_unique_violation(&message) {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "A preset with this name already exists",
                ));
            }
            return Err(failed(
                ZeroErrorCode::DatabaseFailed,
                "The preset could not be saved",
            ));
        }
        self.logger.info(LogInput {
            event: "board.preset_saved",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({ "presetId": record.id, "name": record.name })),
        });
        Ok(record)
    }

    pub fn delete_preset(&self, id: &str, correlation_id: &CorrelationId) {
        self.database
            .run("DELETE FROM board_presets WHERE id = ?", &[json!(id)]);
        self.logger.info(LogInput {
            event: "board.preset_deleted",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({ "presetId": id })),
        });
    }

    pub async fn detect_agents(&self) -> Vec<BoardAgentDetection> {
        loop {
            if let Some(value) = self.agent_probe.borrow().clone() {
                return value;
            }
            if *self.agent_probe_started.borrow() {
                tokio::task::yield_now().await;
                continue;
            }
            *self.agent_probe_started.borrow_mut() = true;
            break;
        }
        let detections = self.probe_agents().await;
        *self.agent_probe.borrow_mut() = Some(detections.clone());
        detections
    }

    async fn probe_agents(&self) -> Vec<BoardAgentDetection> {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut detections = Vec::with_capacity(BOARD_AGENT_CATALOG.len());
        for entry in BOARD_AGENT_CATALOG {
            if entry.id == BoardAgentId::Custom
                || entry.id == BoardAgentId::Shell
                || entry.command.is_empty()
            {
                detections.push(BoardAgentDetection {
                    id: entry.id,
                    label: entry.label.to_string(),
                    available: true,
                    path: None,
                });
                continue;
            }
            let probe = format!("command -v {}", entry.command);
            let detected = exec_file(&shell, &["-lc", &probe], None, 5_000)
                .await
                .ok()
                .and_then(|(stdout, _)| {
                    let path = stdout.trim().to_string();
                    if path.is_empty() {
                        None
                    } else {
                        Some(path)
                    }
                });
            detections.push(BoardAgentDetection {
                id: entry.id,
                label: entry.label.to_string(),
                available: detected.is_some(),
                path: detected,
            });
        }
        detections
    }

    pub async fn create_worktree(
        &self,
        repo_path: &str,
        label: &str,
        correlation_id: &CorrelationId,
    ) -> Result<WorktreeResult, ZeroError> {
        let branch = format!("exeum/{label}");
        let repo = PathBuf::from(repo_path);
        let worktree_dir = repo
            .parent()
            .unwrap_or(Path::new("."))
            .join(format!(
                "{}-worktrees",
                repo.file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("repo")
            ))
            .join(label);
        if let Some(parent) = worktree_dir.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                failed(
                    ZeroErrorCode::ToolExecutionFailed,
                    format!("Git could not create the worktree: {error}"),
                )
            })?;
        }
        let worktree_dir_str = worktree_dir.to_string_lossy().into_owned();
        if exec_file(
            "git",
            &["worktree", "add", "-b", &branch, &worktree_dir_str],
            Some(&repo),
            30_000,
        )
        .await
        .is_err()
        {
            return Err(ZeroError::new(
                ZeroErrorCode::ToolExecutionFailed,
                "Git could not create the worktree",
                helm_shared::ZeroErrorOptions {
                    retryable: true,
                    ..Default::default()
                },
            ));
        }
        if let Ok(entries) = std::fs::read_dir(&repo) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if entry
                    .file_type()
                    .map(|value| value.is_file())
                    .unwrap_or(false)
                    && name.starts_with(".env")
                {
                    if let Err(error) =
                        std::fs::copy(entry.path(), worktree_dir.join(name.as_ref()))
                    {
                        self.logger.warn(LogInput {
                            event: "board.worktree_env_copy_failed",
                            correlation_id: correlation_id.as_str(),
                            data: Some(json!({
                                "worktreeDir": worktree_dir_str,
                                "error": error.to_string(),
                            })),
                        });
                    }
                }
            }
        }
        self.logger.info(LogInput {
            event: "board.worktree_created",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({
                "repoPath": repo_path,
                "worktreeDir": worktree_dir_str,
                "label": label,
                "branch": branch,
            })),
        });
        Ok(WorktreeResult {
            path: worktree_dir_str,
            branch,
        })
    }

    pub async fn read_branch(&self, cwd: &str) -> Option<String> {
        let (stdout, _) = exec_file(
            "git",
            &["rev-parse", "--abbrev-ref", "HEAD"],
            Some(Path::new(cwd)),
            5_000,
        )
        .await
        .ok()?;
        let branch = stdout.trim();
        if branch.is_empty() || branch == "HEAD" {
            None
        } else {
            Some(branch.to_string())
        }
    }

    pub async fn ensure_repository(&self, cwd: &str) -> Result<EnsureRepositoryResult, ZeroError> {
        if let Some(existing) = self.read_branch(cwd).await {
            return Ok(EnsureRepositoryResult {
                initialized: false,
                branch: existing,
            });
        }
        exec_file("git", &["init"], Some(Path::new(cwd)), 15_000)
            .await
            .map_err(|error| {
                failed(
                    ZeroErrorCode::ValidationFailed,
                    format!("Could not initialize a git repository in this folder: {error}"),
                )
            })?;
        exec_file(
            "git",
            &[
                "-c",
                "user.name=BuilderHelm",
                "-c",
                "user.email=swarm@builderhelm.local",
                "commit",
                "--allow-empty",
                "-m",
                "BuilderHelm: initial commit",
            ],
            Some(Path::new(cwd)),
            15_000,
        )
        .await
        .map_err(|error| {
            failed(
                ZeroErrorCode::ValidationFailed,
                format!("Could not initialize a git repository in this folder: {error}"),
            )
        })?;
        let branch = self.read_branch(cwd).await.ok_or_else(|| {
            failed(
                ZeroErrorCode::ValidationFailed,
                "Could not initialize a git repository in this folder",
            )
        })?;
        Ok(EnsureRepositoryResult {
            initialized: true,
            branch,
        })
    }

    pub async fn preview_land(
        &self,
        repo_path: &str,
        branch: &str,
        correlation_id: &CorrelationId,
    ) -> Result<LandPreview, ZeroError> {
        assert_exeum_branch(branch)?;
        let current = self.read_branch(repo_path).await.ok_or_else(|| {
            failed(
                ZeroErrorCode::ValidationFailed,
                "The folder is not a git repository",
            )
        })?;
        if current == branch {
            return Err(failed(
                ZeroErrorCode::ValidationFailed,
                "Cannot land a branch into itself",
            ));
        }
        let range = format!("{current}...{branch}");
        let count_range = format!("{current}..{branch}");
        let cwd = Path::new(repo_path);
        let count_args = ["rev-list", "--count", count_range.as_str()];
        let names_args = ["diff", "--name-only", range.as_str()];
        let stat_args = ["diff", "--stat", range.as_str()];
        let count_out = exec_file("git", &count_args, Some(cwd), 15_000).await;
        let names_out = exec_file("git", &names_args, Some(cwd), 15_000).await;
        let stat_out = exec_file("git", &stat_args, Some(cwd), 15_000).await;
        let count_out = count_out.map_err(|_| {
            failed(
                ZeroErrorCode::ToolExecutionFailed,
                "Could not count commits to land",
            )
        })?;
        let names_out = names_out.map_err(|_| {
            failed(
                ZeroErrorCode::ToolExecutionFailed,
                "Could not count commits to land",
            )
        })?;
        let stat_out = stat_out.map_err(|_| {
            failed(
                ZeroErrorCode::ToolExecutionFailed,
                "Could not count commits to land",
            )
        })?;
        let ahead = count_out.0.trim().parse::<i64>().map_err(|_| {
            failed(
                ZeroErrorCode::ToolExecutionFailed,
                "Could not count commits to land",
            )
        })?;
        let files = if names_out.0.trim().is_empty() {
            Vec::new()
        } else {
            names_out.0.trim().split('\n').map(str::to_string).collect()
        };
        self.logger.info(LogInput {
            event: "board.branch_previewed",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({
                "repoPath": repo_path,
                "branch": branch,
                "base": current,
                "ahead": ahead,
                "files": files,
            })),
        });
        Ok(LandPreview {
            branch: branch.to_string(),
            base: current,
            ahead,
            files,
            stat: stat_out.0.trim().to_string(),
        })
    }

    pub async fn land_branch(
        &self,
        repo_path: &str,
        branch: &str,
        correlation_id: &CorrelationId,
    ) -> Result<LandResult, ZeroError> {
        assert_exeum_branch(branch)?;
        let current = self.read_branch(repo_path).await.ok_or_else(|| {
            failed(
                ZeroErrorCode::ValidationFailed,
                "The folder is not a git repository",
            )
        })?;
        if current == branch {
            return Err(failed(
                ZeroErrorCode::ValidationFailed,
                "Cannot land a branch into itself",
            ));
        }
        let message = format!("Land {branch}");
        if exec_file(
            "git",
            &["merge", "--no-ff", "--no-edit", "-m", &message, branch],
            Some(Path::new(repo_path)),
            60_000,
        )
        .await
        .is_err()
        {
            let _ = exec_file(
                "git",
                &["merge", "--abort"],
                Some(Path::new(repo_path)),
                15_000,
            )
            .await;
            return Err(failed(
                ZeroErrorCode::ToolExecutionFailed,
                "Land failed; the repository was left clean",
            ));
        }
        let (stdout, _) = exec_file(
            "git",
            &["rev-parse", "HEAD"],
            Some(Path::new(repo_path)),
            5_000,
        )
        .await
        .map_err(|_| {
            failed(
                ZeroErrorCode::ToolExecutionFailed,
                "Land failed; the repository was left clean",
            )
        })?;
        let head = stdout.trim().to_string();
        self.logger.info(LogInput {
            event: "board.branch_landed",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({ "repoPath": repo_path, "branch": branch, "head": head })),
        });
        Ok(LandResult { landed: true, head })
    }

    pub fn list_projects(&self) -> Vec<KanbanProject> {
        self.database
            .query_all(
                "SELECT
                   projects.id,
                   projects.name,
                   count(cards.id) AS taskCount,
                   projects.created_at AS createdAt,
                   projects.updated_at AS updatedAt
                 FROM kanban_projects AS projects
                 LEFT JOIN kanban_cards AS cards ON cards.workspace = projects.id
                 GROUP BY projects.id
                 ORDER BY projects.updated_at DESC, projects.created_at DESC",
                &[],
            )
            .into_iter()
            .map(|row| KanbanProject {
                id: row_string(&row, "id"),
                name: row_string(&row, "name"),
                task_count: row_i64(&row, "taskCount"),
                created_at: row_string(&row, "createdAt"),
                updated_at: row_string(&row, "updatedAt"),
            })
            .collect()
    }

    pub fn create_project(
        &self,
        name: &str,
        correlation_id: &CorrelationId,
    ) -> Result<KanbanProject, ZeroError> {
        let name = name.trim();
        if name.is_empty() || name.len() > 120 {
            return Err(failed(ZeroErrorCode::ValidationFailed, "name"));
        }
        if self
            .database
            .query_one(
                "SELECT id FROM kanban_projects WHERE name = ? COLLATE NOCASE",
                &[json!(name)],
            )
            .is_some()
        {
            return Err(failed(
                ZeroErrorCode::ValidationFailed,
                "A Board project with that name already exists",
            ));
        }
        let now = utc_now();
        let project = KanbanProject {
            id: new_id(),
            name: name.to_string(),
            task_count: 0,
            created_at: now.clone(),
            updated_at: now,
        };
        self.database.run(
            "INSERT INTO kanban_projects (id, name, created_at, updated_at)
             VALUES (?, ?, ?, ?)",
            &[
                json!(project.id),
                json!(project.name),
                json!(project.created_at),
                json!(project.updated_at),
            ],
        );
        self.logger.info(LogInput {
            event: "kanban.project_created",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({ "projectId": project.id })),
        });
        Ok(project)
    }

    pub fn list_cards(&self, workspace: &str) -> Vec<KanbanCard> {
        self.database
            .query_all(
                "SELECT id, workspace, title, column_name, created_at
                 FROM kanban_cards
                 WHERE workspace = ?
                 ORDER BY created_at ASC",
                &[json!(workspace)],
            )
            .into_iter()
            .map(|row| KanbanCard {
                id: row_string(&row, "id"),
                workspace: row_string(&row, "workspace"),
                title: row_string(&row, "title"),
                column: parse_column(&row_string(&row, "column_name")),
                created_at: row_string(&row, "created_at"),
            })
            .collect()
    }

    pub fn create_card(
        &self,
        workspace: &str,
        title: &str,
        correlation_id: &CorrelationId,
        column: Option<KanbanColumn>,
    ) -> Result<KanbanCard, ZeroError> {
        if self
            .database
            .query_one(
                "SELECT id FROM kanban_projects WHERE id = ?",
                &[json!(workspace)],
            )
            .is_none()
        {
            return Err(failed(
                ZeroErrorCode::ValidationFailed,
                "Select a Board project before adding tasks",
            ));
        }
        let title = title.trim();
        if title.is_empty() || title.len() > 200 {
            return Err(failed(ZeroErrorCode::ValidationFailed, "title"));
        }
        let column = column.unwrap_or(KanbanColumn::Idea);
        let card = KanbanCard {
            id: new_id(),
            workspace: workspace.to_string(),
            title: title.to_string(),
            column,
            created_at: utc_now(),
        };
        self.database.transaction(|| {
            self.database.run(
                "INSERT INTO kanban_cards (id, workspace, title, column_name, created_at)
                 VALUES (?, ?, ?, ?, ?)",
                &[
                    json!(card.id),
                    json!(card.workspace),
                    json!(card.title),
                    json!(column_name(card.column)),
                    json!(card.created_at),
                ],
            );
            self.database.run(
                "UPDATE kanban_projects SET updated_at = ? WHERE id = ?",
                &[json!(card.created_at), json!(workspace)],
            );
        });
        self.logger.info(LogInput {
            event: "kanban.card_created",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({
                "cardId": card.id,
                "workspace": workspace,
                "column": column_name(card.column),
            })),
        });
        Ok(card)
    }

    pub fn move_card(
        &self,
        id: &str,
        column: KanbanColumn,
        correlation_id: &CorrelationId,
    ) -> Result<KanbanCard, ZeroError> {
        let updated_at = utc_now();
        let card = self.database.transaction(|| {
            self.database.run(
                "UPDATE kanban_cards SET column_name = ? WHERE id = ?",
                &[json!(column_name(column)), json!(id)],
            );
            let found = self
                .database
                .query_one(
                    "SELECT id, workspace, title, column_name, created_at FROM kanban_cards WHERE id = ?",
                    &[json!(id)],
                )
                .ok_or_else(|| failed(ZeroErrorCode::ValidationFailed, "That card is gone"))?;
            self.database.run(
                "UPDATE kanban_projects SET updated_at = ? WHERE id = ?",
                &[json!(updated_at), json!(row_string(&found, "workspace"))],
            );
            Ok(KanbanCard {
                id: row_string(&found, "id"),
                workspace: row_string(&found, "workspace"),
                title: row_string(&found, "title"),
                column: parse_column(&row_string(&found, "column_name")),
                created_at: row_string(&found, "created_at"),
            })
        })?;
        self.logger.info(LogInput {
            event: "kanban.card_moved",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({ "cardId": id, "column": column_name(column) })),
        });
        Ok(card)
    }

    pub fn update_card(
        &self,
        id: &str,
        title: &str,
        correlation_id: &CorrelationId,
    ) -> Result<KanbanCard, ZeroError> {
        let title = title.trim();
        if title.is_empty() || title.len() > 200 {
            return Err(failed(ZeroErrorCode::ValidationFailed, "title"));
        }
        let updated_at = utc_now();
        let card = self.database.transaction(|| {
            self.database.run(
                "UPDATE kanban_cards SET title = ? WHERE id = ?",
                &[json!(title), json!(id)],
            );
            let found = self
                .database
                .query_one(
                    "SELECT id, workspace, title, column_name, created_at FROM kanban_cards WHERE id = ?",
                    &[json!(id)],
                )
                .ok_or_else(|| failed(ZeroErrorCode::ValidationFailed, "That card is gone"))?;
            self.database.run(
                "UPDATE kanban_projects SET updated_at = ? WHERE id = ?",
                &[json!(updated_at), json!(row_string(&found, "workspace"))],
            );
            Ok(KanbanCard {
                id: row_string(&found, "id"),
                workspace: row_string(&found, "workspace"),
                title: row_string(&found, "title"),
                column: parse_column(&row_string(&found, "column_name")),
                created_at: row_string(&found, "created_at"),
            })
        })?;
        self.logger.info(LogInput {
            event: "kanban.card_updated",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({ "cardId": id })),
        });
        Ok(card)
    }

    pub fn delete_card(
        &self,
        id: &str,
        correlation_id: &CorrelationId,
    ) -> Result<Deleted, ZeroError> {
        let updated_at = utc_now();
        self.database.transaction(|| {
            let found = self
                .database
                .query_one(
                    "SELECT workspace FROM kanban_cards WHERE id = ?",
                    &[json!(id)],
                )
                .ok_or_else(|| failed(ZeroErrorCode::ValidationFailed, "That card is gone"))?;
            self.database
                .run("DELETE FROM kanban_cards WHERE id = ?", &[json!(id)]);
            self.database.run(
                "UPDATE kanban_projects SET updated_at = ? WHERE id = ?",
                &[json!(updated_at), json!(row_string(&found, "workspace"))],
            );
            Ok(())
        })?;
        self.logger.info(LogInput {
            event: "kanban.card_deleted",
            correlation_id: correlation_id.as_str(),
            data: Some(json!({ "cardId": id })),
        });
        Ok(Deleted { deleted: true })
    }
}

fn column_name(column: KanbanColumn) -> &'static str {
    match column {
        KanbanColumn::Idea => "idea",
        KanbanColumn::Doing => "doing",
        KanbanColumn::Review => "review",
        KanbanColumn::Shipped => "shipped",
        KanbanColumn::Cancelled => "cancelled",
    }
}

fn parse_column(value: &str) -> KanbanColumn {
    match value {
        "doing" => KanbanColumn::Doing,
        "review" => KanbanColumn::Review,
        "shipped" => KanbanColumn::Shipped,
        "cancelled" => KanbanColumn::Cancelled,
        _ => KanbanColumn::Idea,
    }
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|value| (*value).to_string())
        })
        .unwrap_or_else(|| "panic".into())
}

fn new_id() -> String {
    create_id(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0),
    )
    .to_string()
}
