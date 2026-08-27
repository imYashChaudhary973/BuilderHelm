use std::cell::RefCell;
use std::collections::HashSet;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;

use helm_core::BoardService;
use helm_db::ZeroDatabase;
use helm_observability::{LogInput, Logger};
use helm_protocol::{
    tagged_mission_paths, SwarmLaunchMode, SwarmMessageRecord, SwarmPresetId, SwarmRole,
    SwarmRunRecord, SwarmSeatRecord, SwarmTaskRecord, SWARM_BUDGET_MS,
};
use helm_shared::{
    create_correlation_id, create_id, utc_now, CorrelationId, ZeroError, ZeroErrorCode,
    ZeroErrorOptions,
};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::seat_phase::SeatPhase;
use crate::skills::SWARM_SKILLS;
use crate::swarm_planning::{build_repo_snapshot, SwarmPlanRequest, SwarmPlanner};
use crate::swarm_prompt::{build_seat_prompt, SeatPromptInput, SeatPromptSkill, SeatPromptTask};
use crate::swarm_repository::SwarmRepository;
use crate::swarm_reviewer::SwarmReviewer;

const MAX_ATTEMPTS: i64 = 2;
const DIRECTIVES_CONSUMED: &str = "directives consumed:";

#[derive(Debug, Clone)]
pub struct SwarmRunnerOutcome {
    pub status: String,
    pub summary: String,
    pub tokens_used: i64,
    pub cost_usd: f64,
    pub output: Option<String>,
}

pub struct SwarmExecuteInput {
    pub run: SwarmRunRecord,
    pub seat: SwarmSeatRecord,
    pub task: SwarmTaskRecord,
    pub worktree_path: String,
    pub branch: String,
    pub directives: Vec<String>,
    pub prompt: String,
    pub model: Option<String>,
    pub on_pane: Option<Arc<dyn Fn(String) + Send + Sync>>,
}

pub trait SwarmSeatRunner {
    fn execute(
        &self,
        input: SwarmExecuteInput,
    ) -> Pin<Box<dyn Future<Output = SwarmRunnerOutcome> + '_>>;
}

#[derive(Debug, Clone)]
pub struct SwarmVerifyInput {
    pub run: SwarmRunRecord,
    pub task: SwarmTaskRecord,
    pub worktree_path: String,
    pub branch: String,
}

#[derive(Debug, Clone)]
pub struct SwarmVerifyResult {
    pub ok: bool,
    pub detail: String,
}

pub trait SwarmTaskVerifier {
    fn verify(
        &self,
        input: SwarmVerifyInput,
    ) -> Pin<Box<dyn Future<Output = SwarmVerifyResult> + '_>>;
}

#[derive(Debug, Clone)]
pub struct SwarmTaskSpec {
    pub title: String,
    pub detail: Option<String>,
    pub files: Vec<String>,
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmSeatAssignment {
    pub role: SwarmRole,
    pub agent_id: helm_protocol::BoardAgentId,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmCreateInput {
    pub name: String,
    pub folder_path: String,
    pub mission: String,
    pub launch_mode: SwarmLaunchMode,
    pub preset_id: SwarmPresetId,
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub skill_directives: serde_json::Map<String, serde_json::Value>,
    pub seats: Vec<SwarmSeatAssignment>,
}

#[derive(Debug, Clone)]
pub struct SwarmState {
    pub run: SwarmRunRecord,
    pub seats: Vec<SwarmSeatRecord>,
    pub tasks: Vec<SwarmTaskRecord>,
    pub messages: Vec<SwarmMessageRecord>,
}
pub struct SwarmServiceOptions {
    pub budget_ms: Option<i64>,
    pub reviewer: Option<Arc<dyn SwarmReviewer + Send + Sync>>,
    pub now_ms: Option<Arc<dyn Fn() -> i64 + Send + Sync>>,
}

#[allow(clippy::derivable_impls)]
impl Default for SwarmServiceOptions {
    fn default() -> Self {
        Self {
            budget_ms: None,
            reviewer: None,
            now_ms: None,
        }
    }
}

fn failed(message: &str) -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::ValidationFailed,
        message,
        ZeroErrorOptions::default(),
    )
}

fn fresh_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    create_id(millis).to_string()
}

fn role_name(role: SwarmRole) -> &'static str {
    match role {
        SwarmRole::Coordinator => "coordinator",
        SwarmRole::Builder => "builder",
        SwarmRole::Scout => "scout",
        SwarmRole::Reviewer => "reviewer",
    }
}

fn role_skill_ids(role: SwarmRole) -> &'static [&'static str] {
    match role {
        SwarmRole::Coordinator => &["review", "ci", "errors", "commits"],
        SwarmRole::Builder => &[
            "commits",
            "tdd",
            "monorepo",
            "types",
            "lint",
            "errors",
            "migrations",
        ],
        SwarmRole::Scout => &["monorepo", "perf", "privacy"],
        SwarmRole::Reviewer => &["review", "security", "a11y", "dry", "docs", "types"],
    }
}

fn iso_ms(iso: &str) -> i64 {
    OffsetDateTime::parse(iso, &Rfc3339)
        .map(|dt| dt.unix_timestamp() * 1000 + i64::from(dt.millisecond()))
        .unwrap_or(0)
}

fn reject_kiro(agent_id: helm_protocol::BoardAgentId) -> Result<(), ZeroError> {
    if agent_id == helm_protocol::BoardAgentId::Kiro {
        return Err(failed("kiro-cli cannot take a seat"));
    }
    Ok(())
}

pub struct SwarmService<'a> {
    repository: SwarmRepository<'a>,
    logger: &'a Logger,
    board: &'a BoardService<'a>,
    runner: Arc<dyn SwarmSeatRunner + Send + Sync>,
    verifier: Arc<dyn SwarmTaskVerifier + Send + Sync>,
    budget_ms: i64,
    reviewer: Option<Arc<dyn SwarmReviewer + Send + Sync>>,
    now_ms: Arc<dyn Fn() -> i64 + Send + Sync>,
    pumping: RefCell<HashSet<String>>,
    land_lock: Mutex<()>,
    #[allow(clippy::type_complexity)]
    listeners: RefCell<Vec<Arc<dyn Fn(String) + Send + Sync>>>,
    seat_models: RefCell<std::collections::HashMap<String, String>>,
}

impl<'a> SwarmService<'a> {
    pub fn new(
        database: &'a ZeroDatabase,
        logger: &'a Logger,
        board: &'a BoardService<'a>,
        runner: Arc<dyn SwarmSeatRunner + Send + Sync>,
        verifier: Arc<dyn SwarmTaskVerifier + Send + Sync>,
        options: SwarmServiceOptions,
    ) -> Self {
        Self {
            repository: SwarmRepository::new(database),
            logger,
            board,
            runner,
            verifier,
            budget_ms: options.budget_ms.unwrap_or(SWARM_BUDGET_MS),
            reviewer: options.reviewer,
            now_ms: options
                .now_ms
                .unwrap_or_else(|| Arc::new(|| OffsetDateTime::now_utc().unix_timestamp() * 1000)),
            pumping: RefCell::new(HashSet::new()),
            land_lock: Mutex::new(()),
            listeners: RefCell::new(Vec::new()),
            seat_models: RefCell::new(std::collections::HashMap::new()),
        }
    }

    fn emit(&self, run_id: &str) {
        for listener in self.listeners.borrow().iter() {
            listener(run_id.to_string());
        }
    }

    fn set_seat_status(&self, mut seat: SwarmSeatRecord, next: SeatPhase) -> SwarmSeatRecord {
        let current = SeatPhase::parse(&seat.status).unwrap_or(SeatPhase::Queued);
        if let Ok(phase) = current.enter(next) {
            seat.status = phase.as_str().to_string();
        } else {
            seat.status = next.as_str().to_string();
        }
        self.repository.update_seat(&seat);
        seat
    }

    pub fn create_run(
        &self,
        input: SwarmCreateInput,
        correlation_id: CorrelationId,
    ) -> Result<SwarmRunRecord, ZeroError> {
        for seat in &input.seats {
            reject_kiro(seat.agent_id)?;
        }
        let run_id = fresh_id();
        let mut directives = std::collections::BTreeMap::new();
        for (key, value) in &input.skill_directives {
            if let Some(text) = value.as_str() {
                directives.insert(key.clone(), text.to_string());
            }
        }
        let run = SwarmRunRecord {
            id: run_id.clone(),
            name: input.name,
            folder_path: input.folder_path,
            mission: input.mission,
            launch_mode: input.launch_mode,
            preset_id: input.preset_id,
            skill_ids: input.skill_ids,
            skill_directives: directives,
            board_session_id: None,
            status: "running".into(),
            started_at: utc_now(),
            ended_at: None,
            budget_ms: self.budget_ms,
        };
        let seats: Vec<SwarmSeatRecord> = input
            .seats
            .iter()
            .map(|assignment| SwarmSeatRecord {
                id: fresh_id(),
                run_id: run_id.clone(),
                role: assignment.role,
                agent_id: assignment.agent_id,
                mode: input.launch_mode,
                pane_id: None,
                worktree_path: None,
                branch: None,
                status: SeatPhase::Queued.as_str().into(),
                tokens_used: 0,
                cost_usd: 0.0,
            })
            .collect();
        for (assignment, seat) in input.seats.iter().zip(seats.iter()) {
            if let Some(model) = assignment
                .model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                self.seat_models
                    .borrow_mut()
                    .insert(seat.id.clone(), model.to_string());
            }
        }
        self.repository.create_run(&run, &seats);
        self.logger.info(LogInput {
            event: "swarm.run_created",
            correlation_id: correlation_id.as_str(),
            data: Some(serde_json::json!({ "runId": run.id, "seats": seats.len(), "presetId": run.preset_id })),
        });
        Ok(run)
    }

    pub fn on_run_event(&self, listener: Arc<dyn Fn(String) + Send + Sync>) -> impl Fn() + '_ {
        self.listeners.borrow_mut().push(listener.clone());
        let listeners = &self.listeners;
        move || {
            listeners
                .borrow_mut()
                .retain(|item| !Arc::ptr_eq(item, &listener));
        }
    }

    pub async fn warm_seats(&self, run_id: &str) -> Result<(), ZeroError> {
        let run = self.require_run(run_id)?;
        let seats: Vec<_> = self
            .repository
            .list_seats(run_id)
            .into_iter()
            .filter(|seat| seat.role == SwarmRole::Builder && seat.worktree_path.is_none())
            .collect();
        for seat in seats {
            if let Ok(updated) = self.ensure_worktree(&run, seat).await {
                self.repository.update_seat(&updated);
                self.emit(run_id);
            }
        }
        Ok(())
    }

    pub fn fail_run(&self, run_id: &str, reason: &str) -> Result<(), ZeroError> {
        let run = self.require_run(run_id)?;
        if run.status != "running" {
            return Ok(());
        }
        self.repository
            .update_run(run_id, "failed", Some(&utc_now()));
        self.append_message(run_id, None, "system", &format!("Swarm failed: {reason}"));
        self.emit(run_id);
        Ok(())
    }

    pub fn note(&self, run_id: &str, body: &str) -> Result<(), ZeroError> {
        self.require_run(run_id)?;
        self.append_message(run_id, None, "system", body);
        Ok(())
    }

    pub fn reconcile_interrupted_runs(&self) -> i64 {
        let mut reconciled = 0;
        for run in self.repository.list_runs(200) {
            if run.status != "running" {
                continue;
            }
            self.repository
                .update_run(&run.id, "stopped", Some(&utc_now()));
            for mut task in self.repository.list_tasks(&run.id) {
                if task.status == "in_progress" {
                    task.status = "pending".into();
                    task.updated_at = utc_now();
                    self.repository.update_task(&task);
                }
            }
            for seat in self.repository.list_seats(&run.id) {
                if seat.status == "working" {
                    self.set_seat_status(seat, SeatPhase::Idle);
                }
            }
            self.append_message(
                &run.id,
                None,
                "system",
                "App restarted while this swarm was running; it is stopped and resumable",
            );
            reconciled += 1;
        }
        reconciled
    }

    pub fn latest_run(&self) -> Option<SwarmRunRecord> {
        self.repository.list_runs(1).into_iter().next()
    }

    pub fn add_task(
        &self,
        run_id: &str,
        spec: SwarmTaskSpec,
        correlation_id: CorrelationId,
    ) -> Result<SwarmTaskRecord, ZeroError> {
        self.require_run(run_id)?;
        let now = utc_now();
        let task = SwarmTaskRecord {
            id: fresh_id(),
            run_id: run_id.to_string(),
            seat_id: None,
            title: spec.title,
            detail: spec.detail,
            files: spec.files,
            status: "pending".into(),
            depends_on: spec.depends_on,
            attempts: 0,
            landed_commit: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.repository.insert_task(&task);
        self.emit(run_id);
        self.logger.info(LogInput {
            event: "swarm.task_added",
            correlation_id: correlation_id.as_str(),
            data: Some(serde_json::json!({ "runId": run_id, "taskId": task.id })),
        });
        Ok(task)
    }

    pub fn direct(
        &self,
        run_id: &str,
        seat_ids: &[String],
        body: &str,
        correlation_id: CorrelationId,
    ) -> Result<(), ZeroError> {
        self.require_run(run_id)?;
        let known: HashSet<_> = self
            .repository
            .list_seats(run_id)
            .into_iter()
            .map(|seat| seat.id)
            .collect();
        for seat_id in seat_ids {
            if !known.contains(seat_id) {
                return Err(failed("Unknown swarm seat"));
            }
        }
        for seat_id in seat_ids {
            self.append_message(run_id, Some(seat_id), "directive", body);
        }
        self.logger.info(LogInput {
            event: "swarm.directive_queued",
            correlation_id: correlation_id.as_str(),
            data: Some(serde_json::json!({ "runId": run_id, "seats": seat_ids.len() })),
        });
        Ok(())
    }

    pub fn stop_seat(
        &self,
        run_id: &str,
        seat_id: &str,
        correlation_id: CorrelationId,
    ) -> Result<(), ZeroError> {
        self.require_run(run_id)?;
        let seat = self.repository.get_seat(seat_id);
        let Some(seat) = seat else {
            return Err(failed("Unknown swarm seat"));
        };
        if seat.run_id != run_id {
            return Err(failed("Unknown swarm seat"));
        }
        self.set_seat_status(seat, SeatPhase::Exited);
        self.append_message(
            run_id,
            Some(seat_id),
            "system",
            "Seat retired by the operator",
        );
        self.logger.info(LogInput {
            event: "swarm.seat_stopped",
            correlation_id: correlation_id.as_str(),
            data: Some(serde_json::json!({ "runId": run_id, "seatId": seat_id })),
        });
        self.emit(run_id);
        Ok(())
    }

    pub async fn add_seat(
        &self,
        run_id: &str,
        role: SwarmRole,
        agent_id: helm_protocol::BoardAgentId,
        correlation_id: CorrelationId,
    ) -> Result<SwarmSeatRecord, ZeroError> {
        reject_kiro(agent_id)?;
        let run = self.require_run(run_id)?;
        if run.status != "running" {
            return Err(failed("Swarm is not running"));
        }
        if self.repository.list_seats(run_id).len() >= 12 {
            return Err(failed("Swarm already has 12 seats"));
        }
        let mut seat = SwarmSeatRecord {
            id: fresh_id(),
            run_id: run_id.to_string(),
            role,
            agent_id,
            mode: run.launch_mode,
            pane_id: None,
            worktree_path: None,
            branch: None,
            status: SeatPhase::Queued.as_str().into(),
            tokens_used: 0,
            cost_usd: 0.0,
        };
        self.repository.add_seat(&seat);
        if seat.role == SwarmRole::Builder {
            if let Ok(updated) = self.ensure_worktree(&run, seat.clone()).await {
                self.repository.update_seat(&updated);
                seat = updated;
            }
        }
        self.append_message(
            run_id,
            Some(&seat.id),
            "system",
            &format!("Added {} seat", role_name(seat.role)),
        );
        self.logger.info(LogInput {
            event: "swarm.seat_added",
            correlation_id: correlation_id.as_str(),
            data: Some(serde_json::json!({ "runId": run_id, "seatId": seat.id, "role": role_name(seat.role) })),
        });
        self.emit(run_id);
        Ok(seat)
    }

    pub fn stop(&self, run_id: &str) -> Result<(), ZeroError> {
        let run = self.require_run(run_id)?;
        if run.status != "running" {
            return Ok(());
        }
        self.repository
            .update_run(run_id, "stopped", Some(&utc_now()));
        self.append_message(run_id, None, "system", "Swarm stopped by user");
        self.emit(run_id);
        Ok(())
    }

    pub async fn resume(
        &self,
        run_id: &str,
        correlation_id: CorrelationId,
    ) -> Result<(), ZeroError> {
        let run = self.require_run(run_id)?;
        if run.status != "stopped" && run.status != "budget" {
            return Err(failed("Only a stopped or budget-cut swarm can resume"));
        }
        self.repository.update_run(run_id, "running", None);
        for mut task in self.repository.list_tasks(run_id) {
            if task.status == "in_progress" {
                task.status = "pending".into();
                task.updated_at = utc_now();
                self.repository.update_task(&task);
            }
        }
        self.append_message(run_id, None, "system", "Swarm resumed");
        self.logger.info(LogInput {
            event: "swarm.resumed",
            correlation_id: correlation_id.as_str(),
            data: Some(serde_json::json!({ "runId": run_id })),
        });
        self.pump(run_id).await;
        Ok(())
    }

    pub fn state(&self, run_id: &str) -> Result<SwarmState, ZeroError> {
        let run = self.require_run(run_id)?;
        Ok(SwarmState {
            run,
            seats: self.repository.list_seats(run_id),
            tasks: self.repository.list_tasks(run_id),
            messages: self.repository.list_messages(run_id, 500),
        })
    }

    #[allow(clippy::while_let_loop)]
    pub async fn pump(&self, run_id: &str) {
        if !self.pumping.borrow_mut().insert(run_id.to_string()) {
            return;
        }
        let mut idle_rounds = 0;
        self.run_scout(run_id).await;
        loop {
            let Some(typed_run) = self.repository.get_run(run_id) else {
                break;
            };
            if typed_run.status != "running" {
                break;
            }
            if (self.now_ms)() - iso_ms(&typed_run.started_at) > typed_run.budget_ms {
                self.repository
                    .update_run(run_id, "budget", Some(&utc_now()));
                self.append_message(run_id, None, "system", "Budget spent; swarm wrapped up");
                break;
            }
            self.skip_tasks_behind_dead_deps(run_id);
            let tasks = self.repository.list_tasks(run_id);
            let pending: Vec<_> = tasks
                .iter()
                .filter(|task| task.status == "pending")
                .cloned()
                .collect();
            if pending.is_empty() {
                if tasks.iter().any(|task| task.status == "in_progress") {
                    break;
                }
                let landed = tasks.iter().any(|task| task.status == "landed");
                let failed = tasks.iter().any(|task| task.status == "failed");
                self.repository.update_run(
                    run_id,
                    if landed { "done" } else { "failed" },
                    Some(&utc_now()),
                );
                self.retire_worktrees(&typed_run).await;
                let message = if landed && !failed {
                    "Swarm finished; every task landed"
                } else if landed {
                    "Swarm finished with failed tasks"
                } else {
                    "Swarm finished; nothing landed"
                };
                self.append_message(run_id, None, "system", message);
                break;
            }
            let landed_ids: HashSet<_> = tasks
                .iter()
                .filter(|task| task.status == "landed")
                .map(|task| task.id.clone())
                .collect();
            let busy_files: HashSet<_> = tasks
                .iter()
                .filter(|task| task.status == "in_progress")
                .flat_map(|task| task.files.iter().cloned())
                .collect();
            let ready: Vec<_> = pending
                .into_iter()
                .filter(|task| task.depends_on.iter().all(|dep| landed_ids.contains(dep)))
                .filter(|task| task.files.iter().all(|file| !busy_files.contains(file)))
                .collect();
            if ready.is_empty() {
                break;
            }
            let free: Vec<_> = self
                .repository
                .list_seats(run_id)
                .into_iter()
                .filter(|seat| {
                    seat.role == SwarmRole::Builder
                        && (seat.status == "idle" || seat.status == "queued")
                })
                .collect();
            if free.is_empty() {
                break;
            }
            let batch_len = ready.len().min(free.len());
            let before = self
                .repository
                .list_tasks(run_id)
                .into_iter()
                .map(|row| format!("{}:{}:{}", row.id, row.status, row.attempts))
                .collect::<Vec<_>>()
                .join("|");
            let mut joins = Vec::new();
            for (task, seat) in ready.into_iter().zip(free).take(batch_len) {
                joins.push(self.execute_on_seat(typed_run.clone(), seat, task));
            }
            for join in joins {
                join.await;
            }
            let after = self
                .repository
                .list_tasks(run_id)
                .into_iter()
                .map(|row| format!("{}:{}:{}", row.id, row.status, row.attempts))
                .collect::<Vec<_>>()
                .join("|");
            idle_rounds = if before == after { idle_rounds + 1 } else { 0 };
            if idle_rounds >= 2 {
                self.repository
                    .update_run(run_id, "failed", Some(&utc_now()));
                self.append_message(
                    run_id,
                    None,
                    "system",
                    "Swarm stopped: the queue stopped making progress",
                );
                break;
            }
        }
        self.pumping.borrow_mut().remove(run_id);
    }

    async fn execute_on_seat(
        &self,
        run: SwarmRunRecord,
        seat: SwarmSeatRecord,
        task: SwarmTaskRecord,
    ) {
        let mut active = task;
        active.seat_id = Some(seat.id.clone());
        active.status = "in_progress".into();
        active.attempts += 1;
        active.updated_at = utc_now();
        self.repository.update_task(&active);
        let mut current = seat;
        let outcome = async {
            current = self.ensure_worktree(&run, current.clone()).await?;
            let worktree_path = current
                .worktree_path
                .clone()
                .ok_or_else(|| failed("Seat has no worktree"))?;
            let branch = current
                .branch
                .clone()
                .ok_or_else(|| failed("Seat has no worktree"))?;
            current = self.set_seat_status(current.clone(), SeatPhase::Working);
            self.emit(&run.id);
            let directives = self.pending_directives(&run.id, &current.id);
            let pack = self.context_pack(&run.id);
            let model = self.seat_models.borrow().get(&current.id).cloned();
            let _seat_for_pane = current.id.clone();
            let outcome = self
                .runner
                .execute(SwarmExecuteInput {
                    run: run.clone(),
                    seat: current.clone(),
                    task: active.clone(),
                    worktree_path: worktree_path.clone(),
                    branch: branch.clone(),
                    directives: directives.clone(),
                    prompt: build_seat_prompt(&SeatPromptInput {
                        role: current.role,
                        mission: run.mission.clone(),
                        skills: self.role_skills(&run, current.role),
                        swarm_digest: Some(self.swarm_digest(&run.id)),
                        context_pack: pack,
                        task: SeatPromptTask {
                            title: active.title.clone(),
                            detail: active.detail.clone(),
                            files: active.files.clone(),
                        },
                        directives: directives.clone(),
                    }),
                    model,
                    on_pane: Some(Arc::new({
                        let seat_id = current.id.clone();
                        move |_pane| {
                            let _ = seat_id;
                        }
                    })),
                })
                .await;
            if !directives.is_empty() {
                self.append_message(
                    &run.id,
                    Some(&current.id),
                    "system",
                    &format!("{DIRECTIVES_CONSUMED} {}", directives.len()),
                );
            }
            if let Some(credited) = self.repository.get_seat(&current.id) {
                let mut latest = credited;
                if latest.status != "exited" {
                    latest = self.set_seat_status(latest, SeatPhase::Idle);
                }
                latest.tokens_used += outcome.tokens_used;
                latest.cost_usd += outcome.cost_usd;
                self.repository.update_seat(&latest);
                self.emit(&run.id);
            }
            if self.should_abort(&run.id, &current.id) {
                self.abandon_in_flight(&active);
                return Ok(());
            }
            let ahead = if outcome.status == "failed" {
                self.branch_has_commits(&run.folder_path, &worktree_path)
                    .await
            } else {
                false
            };
            if outcome.status == "failed" && !ahead {
                self.record_failure(&active, &outcome.summary);
                return Ok(());
            }
            if ahead {
                self.append_message(
                    &run.id,
                    Some(&current.id),
                    "system",
                    &format!(
                        "{} exited non-zero but left commits; continuing to verify",
                        current.agent_id.as_str()
                    ),
                );
            }
            let verification = self
                .verifier
                .verify(SwarmVerifyInput {
                    run: run.clone(),
                    task: active.clone(),
                    worktree_path: worktree_path.clone(),
                    branch: branch.clone(),
                })
                .await;
            if !verification.ok {
                self.record_failure(&active, &format!("verify gate: {}", verification.detail));
                return Ok(());
            }
            if let Some(reviewer) = &self.reviewer {
                let reviewer_seat = self
                    .repository
                    .list_seats(&run.id)
                    .into_iter()
                    .find(|seat| seat.role == SwarmRole::Reviewer && seat.status != "exited");
                if let Some(seat) = reviewer_seat.clone() {
                    self.set_seat_status(seat, SeatPhase::Working);
                    self.emit(&run.id);
                }
                let diff = self.diff_against_base(&run.folder_path, &branch).await;
                let verdict = reviewer
                    .review(crate::swarm_reviewer::SwarmReviewRequest {
                        task_title: active.title.clone(),
                        files: active.files.clone(),
                        diff,
                        cwd: run.folder_path.clone(),
                    })
                    .await;
                self.append_message(
                    &run.id,
                    reviewer_seat.as_ref().map(|seat| seat.id.as_str()),
                    "task_event",
                    if verdict.verdict == "approve" {
                        format!("review approved \"{}\"", active.title)
                    } else {
                        format!(
                            "review: {}",
                            verdict
                                .issues
                                .clone()
                                .unwrap_or_else(|| vec!["changes requested".into()])
                                .join("; ")
                        )
                    }
                    .as_str(),
                );
                if let Some(seat) = reviewer_seat {
                    if let Some(latest) = self.repository.get_seat(&seat.id) {
                        if latest.status != "exited" {
                            self.set_seat_status(latest, SeatPhase::Idle);
                            self.emit(&run.id);
                        }
                    }
                }
                if verdict.verdict == "fix" {
                    self.record_failure(
                        &active,
                        &format!(
                            "review: {}",
                            verdict
                                .issues
                                .unwrap_or_else(|| vec!["changes requested".into()])
                                .join("; ")
                        ),
                    );
                    return Ok(());
                }
            }
            if self.should_abort(&run.id, &current.id) {
                self.abandon_in_flight(&active);
                return Ok(());
            }
            let head = self.land_exclusive(&run.folder_path, &branch).await?;
            active.status = "landed".into();
            active.landed_commit = Some(head.clone());
            active.updated_at = utc_now();
            self.repository.update_task(&active);
            self.emit(&run.id);
            self.append_message(
                &run.id,
                Some(&current.id),
                "task_event",
                &format!(
                    "landed \"{}\" at {}",
                    active.title,
                    head.chars().take(7).collect::<String>()
                ),
            );
            Ok::<(), ZeroError>(())
        }
        .await;
        if let Err(error) = outcome {
            self.record_failure(&active, error.message());
        }
        if let Some(latest) = self.repository.get_seat(&current.id) {
            if latest.status == "working" {
                self.set_seat_status(latest, SeatPhase::Idle);
            }
        }
    }

    fn record_failure(&self, task: &SwarmTaskRecord, reason: &str) {
        let retry = task.attempts < MAX_ATTEMPTS;
        let mut next = task.clone();
        next.status = if retry { "pending" } else { "failed" }.into();
        next.updated_at = utc_now();
        self.repository.update_task(&next);
        self.append_message(
            &task.run_id,
            task.seat_id.as_deref(),
            "task_event",
            &format!(
                "{} \"{}\": {reason}",
                if retry { "retrying" } else { "failed" },
                task.title
            ),
        );
    }

    fn should_abort(&self, run_id: &str, seat_id: &str) -> bool {
        let Some(run) = self.repository.get_run(run_id) else {
            return true;
        };
        if run.status != "running" {
            return true;
        }
        if (self.now_ms)() - iso_ms(&run.started_at) > run.budget_ms {
            self.repository
                .update_run(run_id, "budget", Some(&utc_now()));
            self.append_message(run_id, None, "system", "Budget spent; swarm wrapped up");
            return true;
        }
        let Some(seat) = self.repository.get_seat(seat_id) else {
            return true;
        };
        seat.status == "exited"
    }

    fn abandon_in_flight(&self, task: &SwarmTaskRecord) {
        let mut next = task.clone();
        next.status = "pending".into();
        next.updated_at = utc_now();
        self.repository.update_task(&next);
        self.append_message(
            &task.run_id,
            task.seat_id.as_deref(),
            "task_event",
            &format!("stopped \"{}\" before land", task.title),
        );
    }

    fn skip_tasks_behind_dead_deps(&self, run_id: &str) {
        loop {
            let tasks = self.repository.list_tasks(run_id);
            let dead: HashSet<_> = tasks
                .iter()
                .filter(|task| task.status == "failed" || task.status == "skipped")
                .map(|task| task.id.clone())
                .collect();
            let doomed: Vec<_> = tasks
                .into_iter()
                .filter(|task| {
                    task.status == "pending" && task.depends_on.iter().any(|dep| dead.contains(dep))
                })
                .collect();
            if doomed.is_empty() {
                return;
            }
            for mut task in doomed {
                task.status = "skipped".into();
                task.updated_at = utc_now();
                self.repository.update_task(&task);
                self.append_message(
                    run_id,
                    None,
                    "task_event",
                    &format!("skipped \"{}\": a dependency never landed", task.title),
                );
            }
        }
    }

    async fn ensure_worktree(
        &self,
        run: &SwarmRunRecord,
        seat: SwarmSeatRecord,
    ) -> Result<SwarmSeatRecord, ZeroError> {
        if let (Some(path), Some(_)) = (&seat.worktree_path, &seat.branch) {
            if let Some(base) = self.board.read_branch(&run.folder_path).await {
                if Command::new("git")
                    .args(["merge", "--no-edit", &base])
                    .current_dir(path)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .await
                    .map(|status| status.success())
                    .unwrap_or(false)
                {
                    return Ok(seat);
                }
                let _ = Command::new("git")
                    .args(["merge", "--abort"])
                    .current_dir(path)
                    .status()
                    .await;
                let _ = Command::new("git")
                    .args(["worktree", "remove", "--force", path])
                    .current_dir(&run.folder_path)
                    .status()
                    .await;
            } else {
                return Ok(seat);
            }
        }
        let worktree = self
            .board
            .create_worktree(
                &run.folder_path,
                &format!("swarm-{}-{}", &run.id[..8], &seat.id[..4]),
                &create_correlation_id(),
            )
            .await?;
        let mut next = seat;
        next.worktree_path = Some(worktree.path);
        next.branch = Some(worktree.branch);
        Ok(next)
    }

    async fn branch_has_commits(&self, folder_path: &str, worktree_path: &str) -> bool {
        let Some(base) = self.board.read_branch(folder_path).await else {
            return false;
        };
        let output = Command::new("git")
            .args(["rev-list", "--count", &format!("{base}..HEAD")])
            .current_dir(worktree_path)
            .output()
            .await;
        output
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .and_then(|text| text.trim().parse::<i64>().ok())
            .map(|count| count > 0)
            .unwrap_or(false)
    }

    fn pending_directives(&self, run_id: &str, seat_id: &str) -> Vec<String> {
        let messages = self.repository.list_messages(run_id, 500);
        let mut cutoff = String::new();
        for message in &messages {
            if message.seat_id.as_deref() == Some(seat_id)
                && message.kind == "system"
                && message.body.starts_with(DIRECTIVES_CONSUMED)
                && message.created_at > cutoff
            {
                cutoff = message.created_at.clone();
            }
        }
        messages
            .into_iter()
            .filter(|message| {
                message.kind == "directive"
                    && (message.seat_id.as_deref() == Some(seat_id) || message.seat_id.is_none())
                    && message.created_at > cutoff
            })
            .map(|message| message.body)
            .collect()
    }

    async fn diff_against_base(&self, repo_path: &str, branch: &str) -> String {
        let Some(base) = self.board.read_branch(repo_path).await else {
            return String::new();
        };
        Command::new("git")
            .args(["diff", &format!("{base}...{branch}")])
            .current_dir(repo_path)
            .output()
            .await
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .unwrap_or_default()
    }

    pub async fn plan_tasks(
        &self,
        run_id: &str,
        planner: &dyn SwarmPlanner,
        correlation_id: CorrelationId,
    ) -> Result<Vec<SwarmTaskRecord>, ZeroError> {
        let run = self.require_run(run_id)?;
        if run.status != "running" {
            return Ok(Vec::new());
        }
        let queen = self
            .repository
            .list_seats(run_id)
            .into_iter()
            .find(|seat| seat.role == SwarmRole::Coordinator && seat.status != "exited");
        if let Some(seat) = queen.clone() {
            self.set_seat_status(seat, SeatPhase::Working);
            self.emit(run_id);
        }
        let result = async {
            let snapshot = build_repo_snapshot(&run.folder_path, 400).await;
            let planned = planner
                .plan(&SwarmPlanRequest {
                    mission: run.mission.clone(),
                    snapshot,
                    max_tasks: helm_protocol::swarm_plan_budget(run.preset_id) as usize,
                    roster: self
                        .repository
                        .list_seats(run_id)
                        .into_iter()
                        .map(|seat| format!("{}/{}", role_name(seat.role), seat.agent_id.as_str()))
                        .collect::<Vec<_>>()
                        .join(", "),
                })
                .await
                .map_err(|error| failed(&error))?;
            if self.require_run(run_id)?.status != "running" {
                return Ok(Vec::new());
            }
            let mut created = Vec::new();
            for task in planned {
                let depends_on = task
                    .depends_on
                    .into_iter()
                    .filter_map(|index| {
                        created
                            .get(index)
                            .map(|item: &SwarmTaskRecord| item.id.clone())
                    })
                    .collect();
                created.push(self.add_task(
                    run_id,
                    SwarmTaskSpec {
                        title: task.title,
                        detail: task.detail,
                        files: task.files,
                        depends_on,
                    },
                    correlation_id.clone(),
                )?);
            }
            self.append_message(
                run_id,
                queen.as_ref().map(|seat| seat.id.as_str()),
                "coordinator_note",
                &format!("planned {} task(s) from the mission", created.len()),
            );
            Ok(created)
        }
        .await;
        if let Some(seat) = queen {
            if let Some(latest) = self.repository.get_seat(&seat.id) {
                if latest.status != "exited" {
                    self.set_seat_status(latest, SeatPhase::Idle);
                    self.emit(run_id);
                }
            }
        }
        result
    }

    fn swarm_digest(&self, run_id: &str) -> String {
        let seats = self.repository.list_seats(run_id);
        let roster = seats
            .iter()
            .map(|seat| format!("{}/{}", role_name(seat.role), seat.agent_id.as_str()))
            .collect::<Vec<_>>()
            .join(", ");
        let landed: Vec<_> = self
            .repository
            .list_tasks(run_id)
            .into_iter()
            .filter(|task| task.status == "landed")
            .map(|task| {
                format!(
                    "- {}{}: {}",
                    task.title,
                    task.landed_commit
                        .as_deref()
                        .map(|commit| format!(" ({})", commit.chars().take(7).collect::<String>()))
                        .unwrap_or_default(),
                    task.detail
                        .as_deref()
                        .map(|detail| detail.chars().take(160).collect::<String>())
                        .unwrap_or_else(|| "landed".into())
                )
            })
            .collect();
        if landed.is_empty() {
            return format!("Swarm roster: {roster}.");
        }
        let tail = landed
            .iter()
            .rev()
            .take(12)
            .rev()
            .cloned()
            .collect::<Vec<_>>();
        format!(
            "Swarm roster: {roster}.\nWork already landed by other seats (do not redo or contradict it):\n{}",
            tail.join("\n")
        )
    }

    fn context_pack(&self, run_id: &str) -> Option<String> {
        let run = self.repository.get_run(run_id)?;
        let files = self.file_context(&run);
        let scout = self
            .repository
            .list_messages(run_id, 500)
            .into_iter()
            .rfind(|message| message.kind == "seat_report")
            .map(|message| message.body)
            .filter(|body| !body.is_empty());
        let parts: Vec<_> = [files, scout].into_iter().flatten().collect();
        if parts.is_empty() {
            None
        } else {
            Some(parts.join("\n\n"))
        }
    }

    fn file_context(&self, run: &SwarmRunRecord) -> Option<String> {
        let mut chunks = Vec::new();
        for tagged in tagged_mission_paths(&run.mission).into_iter().take(8) {
            let abs = resolve_under(&run.folder_path, &tagged)?;
            if let Ok(text) = std::fs::read_to_string(&abs) {
                chunks.push(format!(
                    "@{tagged}\n{}",
                    text.chars().take(8_000).collect::<String>()
                ));
            }
        }
        if chunks.is_empty() {
            None
        } else {
            Some(chunks.join("\n\n"))
        }
    }

    async fn land_exclusive(&self, folder_path: &str, branch: &str) -> Result<String, ZeroError> {
        let _guard = self.land_lock.lock().await;
        let landed = self
            .board
            .land_branch(folder_path, branch, &create_correlation_id())
            .await?;
        Ok(landed.head)
    }

    async fn run_scout(&self, run_id: &str) {
        let Some(run) = self.repository.get_run(run_id) else {
            return;
        };
        if run.status != "running" {
            return;
        }
        let Some(scout) = self.repository.list_seats(run_id).into_iter().find(|seat| {
            seat.role == SwarmRole::Scout && (seat.status == "queued" || seat.status == "idle")
        }) else {
            return;
        };
        let current = self.set_seat_status(scout.clone(), SeatPhase::Working);
        self.emit(run_id);
        let branch = self
            .board
            .read_branch(&run.folder_path)
            .await
            .unwrap_or_else(|| "HEAD".into());
        let outcome = self
            .runner
            .execute(SwarmExecuteInput {
                run: run.clone(),
                seat: current.clone(),
                task: SwarmTaskRecord {
                    id: fresh_id(),
                    run_id: run_id.to_string(),
                    seat_id: Some(current.id.clone()),
                    title: "Scout the repository".into(),
                    detail: Some("Read-only map for the builders. Do not edit files.".into()),
                    files: Vec::new(),
                    status: "in_progress".into(),
                    attempts: 1,
                    depends_on: Vec::new(),
                    landed_commit: None,
                    created_at: utc_now(),
                    updated_at: utc_now(),
                },
                worktree_path: run.folder_path.clone(),
                branch,
                directives: Vec::new(),
                prompt: build_seat_prompt(&SeatPromptInput {
                    role: SwarmRole::Scout,
                    mission: run.mission.clone(),
                    skills: self.role_skills(&run, SwarmRole::Scout),
                    swarm_digest: None,
                    context_pack: None,
                    task: SeatPromptTask {
                        title: "Scout the repository".into(),
                        detail: Some("Read-only map for the builders. Do not edit files.".into()),
                        files: Vec::new(),
                    },
                    directives: Vec::new(),
                }),
                model: {
                    let models = self.seat_models.borrow();
                    models.get(&current.id).cloned()
                },
                on_pane: None,
            })
            .await;
        if let Some(mut credited) = self.repository.get_seat(&current.id) {
            if credited.status != "exited" {
                credited = self.set_seat_status(credited, SeatPhase::Idle);
            }
            credited.tokens_used += outcome.tokens_used;
            credited.cost_usd += outcome.cost_usd;
            self.repository.update_seat(&credited);
        }
        let body = outcome
            .output
            .clone()
            .unwrap_or(outcome.summary)
            .trim()
            .to_string();
        let report = if body.is_empty() {
            "Scout finished with an empty report".to_string()
        } else {
            body.chars().take(4_000).collect()
        };
        self.append_message(run_id, Some(&current.id), "seat_report", &report);
        if let Some(latest) = self.repository.get_seat(&current.id) {
            if latest.status == "working" {
                self.set_seat_status(latest, SeatPhase::Idle);
            }
        }
        self.emit(run_id);
    }

    async fn retire_worktrees(&self, run: &SwarmRunRecord) {
        let base = self.board.read_branch(&run.folder_path).await;
        for seat in self.repository.list_seats(&run.id) {
            let (Some(path), Some(branch)) = (&seat.worktree_path, &seat.branch) else {
                continue;
            };
            if let Some(base) = &base {
                if let Ok(output) = Command::new("git")
                    .args(["rev-list", "--count", &format!("{base}..{branch}")])
                    .current_dir(&run.folder_path)
                    .output()
                    .await
                {
                    if String::from_utf8_lossy(&output.stdout)
                        .trim()
                        .parse::<i64>()
                        .unwrap_or(0)
                        > 0
                    {
                        self.append_message(
                            &run.id,
                            Some(&seat.id),
                            "system",
                            &format!("kept {branch}: it still holds unlanded commits"),
                        );
                        continue;
                    }
                }
            }
            let _ = Command::new("git")
                .args(["worktree", "remove", "--force", path])
                .current_dir(&run.folder_path)
                .status()
                .await;
            let _ = Command::new("git")
                .args(["branch", "-D", branch])
                .current_dir(&run.folder_path)
                .status()
                .await;
            let mut cleared = seat;
            cleared.worktree_path = None;
            cleared.branch = None;
            self.repository.update_seat(&cleared);
        }
    }

    fn append_message(&self, run_id: &str, seat_id: Option<&str>, kind: &str, body: &str) {
        let clipped: String = body.chars().take(4_000).collect();
        self.repository.append_message(&SwarmMessageRecord {
            id: fresh_id(),
            run_id: run_id.to_string(),
            seat_id: seat_id.map(str::to_string),
            kind: kind.into(),
            body: clipped,
            created_at: utc_now(),
        });
        self.emit(run_id);
    }

    fn require_run(&self, run_id: &str) -> Result<SwarmRunRecord, ZeroError> {
        self.repository
            .get_run(run_id)
            .ok_or_else(|| failed("Unknown swarm run"))
    }

    fn role_skills(&self, run: &SwarmRunRecord, role: SwarmRole) -> Vec<SeatPromptSkill> {
        let allowed: HashSet<_> = role_skill_ids(role).iter().copied().collect();
        SWARM_SKILLS
            .iter()
            .filter(|skill| {
                run.skill_ids.iter().any(|id| id == skill.id) && allowed.contains(skill.id)
            })
            .map(|skill| SeatPromptSkill {
                title: skill.title.into(),
                directive: run
                    .skill_directives
                    .get(skill.id)
                    .cloned()
                    .unwrap_or_else(|| skill.directive.to_string()),
            })
            .collect()
    }
}

fn resolve_under(folder_path: &str, tagged: &str) -> Option<PathBuf> {
    let abs = Path::new(folder_path).join(tagged);
    let rel = pathdiff_rel(folder_path, &abs)?;
    if rel.starts_with("..") || Path::new(&rel).is_absolute() {
        return None;
    }
    Some(abs)
}

fn pathdiff_rel(root: &str, candidate: &Path) -> Option<String> {
    let root = Path::new(root).canonicalize().ok()?;
    let candidate = candidate
        .canonicalize()
        .ok()
        .unwrap_or_else(|| candidate.to_path_buf());
    candidate
        .strip_prefix(&root)
        .ok()
        .map(|rel| rel.to_string_lossy().into_owned())
        .or_else(|| {
            let rel = candidate.to_string_lossy();
            if rel.starts_with("..") {
                None
            } else {
                Some(rel.into_owned())
            }
        })
}
