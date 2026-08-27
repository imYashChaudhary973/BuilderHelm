use helm_protocol::{
    BoardAgentId, BoardIsolation, BoardPaneArgv, BoardPaneStatus, BOARD_AGENT_CATALOG,
};
use helm_shared::{create_id, ZeroError, ZeroErrorCode, ZeroErrorOptions};
use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::task::JoinSet;

use crate::spawn::{spawn_argv_pty, spawn_pty, spawn_reader, LivePty};

fn validation(message: impl Into<String>) -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::ValidationFailed,
        message,
        ZeroErrorOptions::default(),
    )
}

fn fresh_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    create_id(millis).to_string()
}

pub struct BoardCreateInput {
    pub folder_path: String,
    pub isolation: BoardIsolation,
    pub panes: Vec<BoardPaneSpec>,
}

#[derive(Clone)]
pub struct BoardPaneSpec {
    pub slot: i64,
    pub agent_id: BoardAgentId,
    pub command: Option<String>,
    pub argv: Option<BoardPaneArgv>,
}

#[derive(Clone, Debug)]
pub struct BoardPaneSummary {
    pub pane_id: String,
    pub slot: i64,
    pub agent_id: BoardAgentId,
    pub title: String,
    pub status: BoardPaneStatus,
    pub branch: Option<String>,
    pub cwd: String,
}

#[derive(Clone, Debug)]
pub struct BoardSessionSummary {
    pub session_id: String,
    pub folder_path: String,
    pub pane_count: usize,
    pub isolation: BoardIsolation,
    pub panes: Vec<BoardPaneSummary>,
}

#[allow(dead_code)]
struct PaneMeta {
    slot: i64,
    agent_id: BoardAgentId,
    title: String,
    status: BoardPaneStatus,
    branch: Option<String>,
    cwd: String,
    output: Arc<Mutex<String>>,
    last_data_at: i64,
    pty: Option<LivePty>,
}

struct SessionRecord {
    folder_path: String,
    isolation: BoardIsolation,
    #[allow(dead_code)]
    worktree_tag: String,
    panes: HashMap<String, PaneMeta>,
}

pub struct SpawnArgs {
    pub cwd: String,
    pub argv: Option<BoardPaneArgv>,
    pub command: String,
    pub cols: u16,
    pub rows: u16,
}

type Spawner = Arc<dyn Fn(SpawnArgs) -> Result<LivePty, ZeroError> + Send + Sync>;

pub struct BoardPtyManager {
    sessions: Mutex<HashMap<String, SessionRecord>>,
    spawn: Spawner,
}

fn default_spawn(args: SpawnArgs) -> Result<LivePty, ZeroError> {
    if let Some(argv) = args.argv {
        spawn_argv_pty(&args.cwd, &argv, args.cols, args.rows)
    } else {
        spawn_pty(&args.cwd, &args.command, args.cols, args.rows)
    }
}

impl Default for BoardPtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl BoardPtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            spawn: Arc::new(default_spawn),
        }
    }

    pub fn with_spawner(spawn: Spawner) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            spawn,
        }
    }

    fn resolve_command(
        agent_id: BoardAgentId,
        override_cmd: Option<&str>,
    ) -> Result<String, ZeroError> {
        if agent_id == BoardAgentId::Shell {
            return Ok(String::new());
        }
        let command = override_cmd
            .map(str::to_string)
            .or_else(|| {
                BOARD_AGENT_CATALOG
                    .iter()
                    .find(|entry| entry.id == agent_id)
                    .map(|entry| entry.command.to_string())
            })
            .unwrap_or_default();
        if command.is_empty() {
            return Err(validation(format!(
                "Unknown board agent {}",
                agent_id.as_str()
            )));
        }
        if agent_id == BoardAgentId::Gemini {
            return Ok(format!("{command} --skip-trust"));
        }
        Ok(command)
    }

    fn agent_label(agent_id: BoardAgentId) -> &'static str {
        BOARD_AGENT_CATALOG
            .iter()
            .find(|entry| entry.id == agent_id)
            .map(|entry| entry.label)
            .unwrap_or(agent_id.as_str())
    }

    pub fn create_empty_session(&self, folder_path: String, isolation: BoardIsolation) -> String {
        let session_id = fresh_id();
        self.sessions.lock().unwrap().insert(
            session_id.clone(),
            SessionRecord {
                folder_path,
                isolation,
                worktree_tag: fresh_id().chars().take(8).collect(),
                panes: HashMap::new(),
            },
        );
        session_id
    }

    pub async fn create_session<F, Fut>(
        &self,
        input: BoardCreateInput,
        mut locate: F,
    ) -> Result<BoardSessionSummary, ZeroError>
    where
        F: FnMut(i64) -> Fut,
        Fut: Future<Output = (String, Option<String>)>,
    {
        let session_id = fresh_id();
        let worktree_tag: String = fresh_id().chars().take(8).collect();
        {
            let mut sessions = self.sessions.lock().unwrap();
            sessions.insert(
                session_id.clone(),
                SessionRecord {
                    folder_path: input.folder_path.clone(),
                    isolation: input.isolation,
                    worktree_tag,
                    panes: HashMap::new(),
                },
            );
        }
        let mut specs = input.panes;
        specs.sort_by_key(|spec| spec.slot);
        let mut located = Vec::new();
        for spec in specs {
            let location = locate(spec.slot).await;
            located.push((spec, location));
        }
        let spawn = self.spawn.clone();
        let mut set = JoinSet::new();
        for (index, (spec, location)) in located.into_iter().enumerate() {
            let spawn = spawn.clone();
            set.spawn(async move {
                let result =
                    tokio::task::spawn_blocking(move || attach_sync(spawn, spec, location))
                        .await
                        .map_err(|error| validation(error.to_string()))?;
                Ok::<(usize, PaneAttach), ZeroError>((index, result?))
            });
        }
        let mut attached = Vec::new();
        let mut first_error: Option<ZeroError> = None;
        while let Some(join) = set.join_next().await {
            match join {
                Ok(Ok(pair)) => attached.push(pair),
                Ok(Err(error)) => {
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
                Err(error) => {
                    if first_error.is_none() {
                        first_error = Some(validation(error.to_string()));
                    }
                }
            }
        }
        if let Some(error) = first_error {
            self.abort_session(&session_id);
            return Err(error);
        }
        attached.sort_by_key(|(index, _)| *index);
        let mut panes = Vec::new();
        {
            let mut sessions = self.sessions.lock().unwrap();
            let session = sessions
                .get_mut(&session_id)
                .ok_or_else(|| validation("Unknown pane session or pane"))?;
            for (_, attach) in attached {
                session.panes.insert(attach.pane_id.clone(), attach.meta);
                panes.push(attach.summary);
            }
        }
        Ok(BoardSessionSummary {
            session_id,
            folder_path: input.folder_path,
            pane_count: panes.len(),
            isolation: input.isolation,
            panes,
        })
    }

    fn abort_session(&self, session_id: &str) {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.remove(session_id) {
            for pane in session.panes.values() {
                if let Some(pty) = &pane.pty {
                    pty.kill();
                }
            }
        }
    }

    pub async fn add_pane<F, Fut>(
        &self,
        session_id: &str,
        agent_id: BoardAgentId,
        command: Option<String>,
        argv: Option<BoardPaneArgv>,
        locate: F,
    ) -> Result<BoardPaneSummary, ZeroError>
    where
        F: FnOnce(i64) -> Fut,
        Fut: Future<Output = (String, Option<String>)>,
    {
        let slot = {
            let sessions = self.sessions.lock().unwrap();
            let session = sessions
                .get(session_id)
                .ok_or_else(|| validation("Unknown pane session or pane"))?;
            if session.panes.len() >= 12 {
                return Err(validation("This Space is already at 12 terminals"));
            }
            session.panes.len() as i64
        };
        let location = locate(slot).await;
        let spec = BoardPaneSpec {
            slot,
            agent_id,
            command,
            argv,
        };
        let spawn = self.spawn.clone();
        let attach = tokio::task::spawn_blocking(move || attach_sync(spawn, spec, location))
            .await
            .map_err(|error| validation(error.to_string()))??;
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| validation("Unknown pane session or pane"))?;
        session.panes.insert(attach.pane_id.clone(), attach.meta);
        Ok(attach.summary)
    }

    pub fn write(&self, session_id: &str, pane_id: &str, data: &str) -> Result<(), ZeroError> {
        let sessions = self.sessions.lock().unwrap();
        let pane = sessions
            .get(session_id)
            .and_then(|session| session.panes.get(pane_id))
            .ok_or_else(|| validation("Unknown pane session or pane"))?;
        if let Some(pty) = &pane.pty {
            pty.write(data);
        }
        Ok(())
    }

    pub fn resize(
        &self,
        session_id: &str,
        pane_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), ZeroError> {
        let sessions = self.sessions.lock().unwrap();
        let pane = sessions
            .get(session_id)
            .and_then(|session| session.panes.get(pane_id))
            .ok_or_else(|| validation("Unknown pane session or pane"))?;
        if let Some(pty) = &pane.pty {
            pty.resize(cols, rows);
        }
        Ok(())
    }

    pub fn drain_pane(&self, session_id: &str, pane_id: &str) -> Result<String, ZeroError> {
        let sessions = self.sessions.lock().unwrap();
        let pane = sessions
            .get(session_id)
            .and_then(|session| session.panes.get(pane_id))
            .ok_or_else(|| validation("Unknown pane session or pane"))?;
        let text = pane.output.lock().unwrap().clone();
        Ok(text)
    }

    pub fn close_pane(&self, session_id: &str, pane_id: &str) -> Result<(), ZeroError> {
        let mut sessions = self.sessions.lock().unwrap();
        let Some(session) = sessions.get_mut(session_id) else {
            return Ok(());
        };
        let Some(pane) = session.panes.remove(pane_id) else {
            return Ok(());
        };
        if let Some(pty) = &pane.pty {
            pty.kill();
        }
        let cwd = pane.cwd.clone();
        let folder_path = session.folder_path.clone();
        let isolation = session.isolation;
        let mut remaining: Vec<_> = session.panes.values_mut().collect();
        remaining.sort_by_key(|pane| pane.slot);
        for (index, pane) in remaining.into_iter().enumerate() {
            pane.slot = index as i64;
        }
        drop(sessions);
        if isolation == BoardIsolation::Worktree && cwd != folder_path {
            let _ = std::process::Command::new("git")
                .args(["worktree", "remove", "--force", &cwd])
                .current_dir(&folder_path)
                .status();
        }
        Ok(())
    }

    pub fn dispose(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for session in sessions.values() {
            for pane in session.panes.values() {
                if let Some(pty) = &pane.pty {
                    pty.kill();
                }
            }
        }
        sessions.clear();
    }
}

struct PaneAttach {
    pane_id: String,
    summary: BoardPaneSummary,
    meta: PaneMeta,
}

fn attach_sync(
    spawn: Spawner,
    spec: BoardPaneSpec,
    location: (String, Option<String>),
) -> Result<PaneAttach, ZeroError> {
    let command = BoardPtyManager::resolve_command(spec.agent_id, spec.command.as_deref())?;
    let pane_id = fresh_id();
    let label = BoardPtyManager::agent_label(spec.agent_id);
    let cwd_name = Path::new(&location.0)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&location.0);
    let title = match &location.1 {
        None => format!("{label} · {cwd_name} #{}", spec.slot + 1),
        Some(branch) => format!("{label} · {branch}"),
    };
    let pty = spawn(SpawnArgs {
        cwd: location.0.clone(),
        argv: spec.argv,
        command,
        cols: 120,
        rows: 30,
    })?;
    let output = Arc::new(Mutex::new(String::new()));
    spawn_reader(&pty, output.clone());
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let summary = BoardPaneSummary {
        pane_id: pane_id.clone(),
        slot: spec.slot,
        agent_id: spec.agent_id,
        title: title.clone(),
        status: BoardPaneStatus::Running,
        branch: location.1.clone(),
        cwd: location.0.clone(),
    };
    Ok(PaneAttach {
        pane_id: pane_id.clone(),
        summary,
        meta: PaneMeta {
            slot: spec.slot,
            agent_id: spec.agent_id,
            title,
            status: BoardPaneStatus::Running,
            branch: location.1,
            cwd: location.0,
            output: output.clone(),
            last_data_at: now,
            pty: Some(pty),
        },
    })
}

impl Drop for BoardPtyManager {
    fn drop(&mut self) {
        self.dispose();
    }
}
