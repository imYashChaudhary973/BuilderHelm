use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::board::{BoardAgentDetection, BoardAgentId, BoardPaneStatus};
use crate::validate::{from_strict, require_datetime, require_len, require_uuid, ParseError};

pub const SWARM_ROLES: [&str; 4] = ["coordinator", "builder", "scout", "reviewer"];
pub const SWARM_PANE_COUNT: i64 = 8;
pub const SWARM_BUDGET_MS: i64 = 20 * 60 * 1000;
pub const SWARM_STUCK_MS: i64 = 90 * 1000;
pub const SWARM_SINGLE_TASK_NOTE: &str =
    "No planner CLI (claude or grok). This mission is one task — spare builders stay idle on purpose.";
pub const SWARM_OPENCODE_MODEL: &str = "openrouter/stealth/ox-alpha";
pub const SWARM_PROMPT_MAX: usize = 100_000;
pub const SWARM_NUDGE: &str =
    "You have been silent. Report status in one line, then continue or say you are blocked.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwarmRole {
    Coordinator,
    Builder,
    Scout,
    Reviewer,
}

impl SwarmRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Coordinator => "coordinator",
            Self::Builder => "builder",
            Self::Scout => "scout",
            Self::Reviewer => "reviewer",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwarmLaunchMode {
    Safe,
    Auto,
    Full,
}

impl SwarmLaunchMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::Auto => "auto",
            Self::Full => "full",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwarmPresetId {
    Skiff,
    Cutter,
    Frigate,
    Flagship,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SwarmAssignment {
    pub role: SwarmRole,
    pub agent_id: BoardAgentId,
    pub auto: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwarmMemberStatus {
    Starting,
    Running,
    Stuck,
    Exited,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwarmStuckAction {
    None,
    Nudge,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SwarmRunStatus {
    Running,
    Stuck,
    Budget,
    Stopped,
    Done,
}

const DUTY: [(&str, &str); 4] = [
    (
        "coordinator",
        "Split the job, track the other roles, and stop when the job is done. Do not implement the whole job yourself.",
    ),
    (
        "builder",
        "Implement the job in this folder. Keep the diff small and ship working code.",
    ),
    (
        "scout",
        "Explore the repo and report what matters. Do not implement unless asked.",
    ),
    (
        "reviewer",
        "Review the Builder work. Name bugs and missing tests. Do not rewrite everything.",
    ),
];

#[derive(Debug, Clone, Copy)]
pub struct SwarmPreset {
    pub id: SwarmPresetId,
    pub size: u8,
    pub label: &'static str,
    pub coordinator: u8,
    pub builder: u8,
    pub scout: u8,
    pub reviewer: u8,
}

pub const SWARM_PRESETS: [SwarmPreset; 4] = [
    SwarmPreset {
        id: SwarmPresetId::Skiff,
        size: 3,
        label: "Skiff",
        coordinator: 1,
        builder: 1,
        scout: 1,
        reviewer: 0,
    },
    SwarmPreset {
        id: SwarmPresetId::Cutter,
        size: 5,
        label: "Cutter",
        coordinator: 1,
        builder: 2,
        scout: 1,
        reviewer: 1,
    },
    SwarmPreset {
        id: SwarmPresetId::Frigate,
        size: 8,
        label: "Frigate",
        coordinator: 1,
        builder: 5,
        scout: 1,
        reviewer: 1,
    },
    SwarmPreset {
        id: SwarmPresetId::Flagship,
        size: 12,
        label: "Flagship",
        coordinator: 1,
        builder: 7,
        scout: 2,
        reviewer: 2,
    },
];

pub fn swarm_plan_budget(preset_id: SwarmPresetId) -> i64 {
    match preset_id {
        SwarmPresetId::Skiff => 3,
        SwarmPresetId::Cutter => 6,
        SwarmPresetId::Frigate => 10,
        SwarmPresetId::Flagship => 14,
    }
}

pub fn swarm_preset_roles(id: SwarmPresetId) -> Vec<SwarmRole> {
    let preset = SWARM_PRESETS.iter().find(|item| item.id == id).unwrap();
    let mut roles = Vec::new();
    for _ in 0..preset.coordinator {
        roles.push(SwarmRole::Coordinator);
    }
    for _ in 0..preset.builder {
        roles.push(SwarmRole::Builder);
    }
    for _ in 0..preset.scout {
        roles.push(SwarmRole::Scout);
    }
    for _ in 0..preset.reviewer {
        roles.push(SwarmRole::Reviewer);
    }
    roles
}

pub fn swarm_add_seat(
    roster: &[SwarmAssignment],
    role: SwarmRole,
    agent_id: BoardAgentId,
) -> Vec<SwarmAssignment> {
    if roster.len() >= 12 {
        return roster.to_vec();
    }
    let mut next = roster.to_vec();
    next.push(SwarmAssignment {
        role,
        agent_id,
        auto: false,
        model: None,
    });
    next
}

pub fn swarm_remove_seat(roster: &[SwarmAssignment], role: SwarmRole) -> Vec<SwarmAssignment> {
    let mut index = None;
    for (i, seat) in roster.iter().enumerate() {
        if seat.role == role {
            index = Some(i);
        }
    }
    let Some(index) = index else {
        return roster.to_vec();
    };
    roster
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != index)
        .map(|(_, seat)| seat.clone())
        .collect()
}

pub fn available_swarm_agents(detections: &[BoardAgentDetection]) -> Vec<BoardAgentId> {
    detections
        .iter()
        .filter(|item| {
            item.available && item.id != BoardAgentId::Shell && item.id != BoardAgentId::Custom
        })
        .map(|item| item.id)
        .collect()
}

pub fn assign_swarm_panes(agent_ids: &[BoardAgentId], roles: &[SwarmRole]) -> Vec<SwarmAssignment> {
    if agent_ids.is_empty() || roles.is_empty() {
        return Vec::new();
    }
    roles
        .iter()
        .enumerate()
        .map(|(index, role)| SwarmAssignment {
            role: *role,
            agent_id: agent_ids[index % agent_ids.len()],
            auto: false,
            model: None,
        })
        .collect()
}

pub fn swarm_brief(role: SwarmRole, job: &str) -> String {
    let clipped: String = job.trim().chars().take(2_000).collect();
    let duty = DUTY
        .iter()
        .find(|(name, _)| *name == role.as_str())
        .map(|(_, text)| *text)
        .unwrap();
    format!(
        "You are the {} in a BuilderHelm Swarm.\nJob: {clipped}\n\n{duty}\n",
        role.as_str()
    )
}

pub fn swarm_role_tasks(job: &str) -> BTreeMap<&'static str, String> {
    let clipped: String = job.trim().chars().take(200).collect();
    let body = if clipped.is_empty() {
        "the swarm job".to_string()
    } else {
        clipped
    };
    let mut out = BTreeMap::new();
    out.insert("coordinator", format!("Coordinate: {body}"));
    out.insert("builder", format!("Build: {body}"));
    out.insert("scout", format!("Scout: {body}"));
    out.insert("reviewer", format!("Review: {body}"));
    out
}

#[derive(Debug, Clone, PartialEq)]
pub struct SwarmSeatArgv {
    pub binary: String,
    pub args: Vec<String>,
}

fn launcher_args(
    agent_id: BoardAgentId,
    prompt: &str,
    mode: SwarmLaunchMode,
) -> Result<(&'static str, Vec<String>), String> {
    let unsupported = || {
        format!(
            "{} does not support {} launch mode",
            agent_id.as_str(),
            mode.as_str()
        )
    };
    match agent_id {
        BoardAgentId::Claude => {
            let args = if mode == SwarmLaunchMode::Full {
                vec![
                    "-p".into(),
                    prompt.into(),
                    "--dangerously-skip-permissions".into(),
                ]
            } else {
                vec![
                    "-p".into(),
                    prompt.into(),
                    "--permission-mode".into(),
                    if mode == SwarmLaunchMode::Auto {
                        "acceptEdits".into()
                    } else {
                        "dontAsk".into()
                    },
                ]
            };
            Ok(("claude", args))
        }
        BoardAgentId::Codex => {
            let args = match mode {
                SwarmLaunchMode::Full => vec![
                    "exec".into(),
                    "--dangerously-bypass-approvals-and-sandbox".into(),
                    prompt.into(),
                ],
                SwarmLaunchMode::Auto => vec![
                    "exec".into(),
                    "--sandbox".into(),
                    "workspace-write".into(),
                    "--approve-for-me".into(),
                    prompt.into(),
                ],
                SwarmLaunchMode::Safe => {
                    vec![
                        "exec".into(),
                        "--sandbox".into(),
                        "read-only".into(),
                        prompt.into(),
                    ]
                }
            };
            Ok(("codex", args))
        }
        BoardAgentId::Gemini => {
            let approval = match mode {
                SwarmLaunchMode::Full => "yolo",
                SwarmLaunchMode::Auto => "auto_edit",
                SwarmLaunchMode::Safe => "plan",
            };
            Ok((
                "gemini",
                vec![
                    "-p".into(),
                    prompt.into(),
                    "--skip-trust".into(),
                    "--approval-mode".into(),
                    approval.into(),
                ],
            ))
        }
        BoardAgentId::Grok => {
            let perm = match mode {
                SwarmLaunchMode::Full => "bypassPermissions",
                SwarmLaunchMode::Auto => "acceptEdits",
                SwarmLaunchMode::Safe => "dontAsk",
            };
            Ok((
                "grok",
                vec!["--permission-mode".into(), perm.into(), prompt.into()],
            ))
        }
        BoardAgentId::Opencode => {
            if mode == SwarmLaunchMode::Safe {
                return Err(unsupported());
            }
            let args = if mode == SwarmLaunchMode::Full {
                vec![
                    "run".into(),
                    "-m".into(),
                    SWARM_OPENCODE_MODEL.into(),
                    "--auto".into(),
                    prompt.into(),
                ]
            } else {
                vec![
                    "run".into(),
                    "-m".into(),
                    SWARM_OPENCODE_MODEL.into(),
                    prompt.into(),
                ]
            };
            Ok(("opencode", args))
        }
        BoardAgentId::Kimi => {
            let args = match mode {
                SwarmLaunchMode::Full => vec!["-p".into(), prompt.into(), "--auto".into()],
                SwarmLaunchMode::Auto => vec!["-p".into(), prompt.into(), "-y".into()],
                SwarmLaunchMode::Safe => vec!["-p".into(), prompt.into()],
            };
            Ok(("kimi", args))
        }
        BoardAgentId::Omp => {
            let approval = match mode {
                SwarmLaunchMode::Full => "yolo",
                SwarmLaunchMode::Auto => "write",
                SwarmLaunchMode::Safe => "always-ask",
            };
            Ok((
                "omp",
                vec![
                    "-p".into(),
                    prompt.into(),
                    "--approval-mode".into(),
                    approval.into(),
                ],
            ))
        }
        BoardAgentId::Pi => {
            if mode == SwarmLaunchMode::Full {
                return Err(unsupported());
            }
            let args = if mode == SwarmLaunchMode::Auto {
                vec!["-p".into(), prompt.into(), "--approve".into()]
            } else {
                vec!["-p".into(), prompt.into()]
            };
            Ok(("pi", args))
        }
        _ => Err(format!(
            "{} cannot take a swarm seat: no verified headless command",
            agent_id.as_str()
        )),
    }
}

fn with_cli_model(agent_id: BoardAgentId, args: Vec<String>, model: Option<&str>) -> Vec<String> {
    let Some(name) = model.map(str::trim).filter(|n| !n.is_empty()) else {
        return args;
    };
    if agent_id == BoardAgentId::Opencode {
        return args;
    }
    if agent_id == BoardAgentId::Claude {
        let mut out = vec!["--model".into(), name.into()];
        out.extend(args);
        return out;
    }
    if agent_id == BoardAgentId::Codex {
        let first = args.first().cloned().unwrap_or_else(|| "exec".into());
        let mut out = vec![first, "-m".into(), name.into()];
        out.extend(args.into_iter().skip(1));
        return out;
    }
    let mut out = vec!["-m".into(), name.into()];
    out.extend(args);
    out
}

pub fn swarm_seat_argv(
    agent_id: BoardAgentId,
    prompt: &str,
    mode: SwarmLaunchMode,
    model: Option<&str>,
) -> Result<SwarmSeatArgv, String> {
    let body: String = prompt.trim().chars().take(SWARM_PROMPT_MAX).collect();
    if body.is_empty() {
        return Err("swarm prompt must not be empty".into());
    }
    let (binary, args) = launcher_args(agent_id, &body, mode)?;
    Ok(SwarmSeatArgv {
        binary: binary.into(),
        args: with_cli_model(agent_id, args, model),
    })
}

pub fn tagged_mission_paths(mission: &str) -> Vec<String> {
    let mut found = Vec::new();
    let bytes = mission.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'@' {
            let start = i + 1;
            let mut end = start;
            while end < bytes.len() && !bytes[end].is_ascii_whitespace() {
                end += 1;
            }
            if end > start {
                let token = &mission[start..end];
                if !token.is_empty() && token.len() <= 4096 {
                    found.push(token.to_string());
                }
            }
            i = end;
        } else {
            i += 1;
        }
    }
    found
}

pub fn swarm_stuck_action(
    status: SwarmMemberStatus,
    nudged_at: Option<i64>,
    now: i64,
    stuck_after_ms: i64,
) -> SwarmStuckAction {
    if status != SwarmMemberStatus::Stuck {
        return SwarmStuckAction::None;
    }
    match nudged_at {
        None => SwarmStuckAction::Nudge,
        Some(nudged) if now - nudged >= stuck_after_ms => SwarmStuckAction::Stop,
        Some(_) => SwarmStuckAction::None,
    }
}

pub fn swarm_member_status(
    pane_status: BoardPaneStatus,
    last_activity_at: i64,
    now: i64,
    stuck_after_ms: i64,
) -> SwarmMemberStatus {
    match pane_status {
        BoardPaneStatus::Exited => SwarmMemberStatus::Exited,
        BoardPaneStatus::Failed => SwarmMemberStatus::Failed,
        BoardPaneStatus::Starting => SwarmMemberStatus::Starting,
        BoardPaneStatus::Running if now - last_activity_at >= stuck_after_ms => {
            SwarmMemberStatus::Stuck
        }
        BoardPaneStatus::Running => SwarmMemberStatus::Running,
    }
}

pub fn swarm_run_status(
    members: &[SwarmMemberStatus],
    elapsed_ms: i64,
    budget_ms: i64,
    stopped: bool,
) -> SwarmRunStatus {
    if stopped {
        return SwarmRunStatus::Stopped;
    }
    if elapsed_ms >= budget_ms {
        return SwarmRunStatus::Budget;
    }
    if members.is_empty() {
        return SwarmRunStatus::Running;
    }
    if members
        .iter()
        .all(|item| *item == SwarmMemberStatus::Exited || *item == SwarmMemberStatus::Failed)
    {
        return SwarmRunStatus::Done;
    }
    if members.contains(&SwarmMemberStatus::Stuck) {
        return SwarmRunStatus::Stuck;
    }
    SwarmRunStatus::Running
}

pub fn swarm_seat_label(roles: &[SwarmRole], index: usize) -> String {
    let Some(role) = roles.get(index) else {
        return format!("Seat {}", index + 1);
    };
    let n = roles
        .iter()
        .take(index + 1)
        .filter(|item| *item == role)
        .count();
    let mut chars = role.as_str().chars();
    let first = chars.next().unwrap().to_ascii_uppercase();
    format!("{first}{} {n}", chars.as_str())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GraphPoint {
    pub x: f64,
    pub y: f64,
}

pub fn swarm_graph_points(roles: &[SwarmRole]) -> Vec<GraphPoint> {
    let mut buckets: BTreeMap<SwarmRole, Vec<usize>> = BTreeMap::new();
    for (index, role) in roles.iter().enumerate() {
        buckets.entry(*role).or_default().push(index);
    }
    let mut points = vec![GraphPoint { x: 50.0, y: 50.0 }; roles.len()];
    fn row(points: &mut [GraphPoint], indices: &[usize], y: f64, gap: f64, shift: f64) {
        let n = indices.len() as f64;
        for (k, index) in indices.iter().enumerate() {
            points[*index] = GraphPoint {
                x: 50.0 + shift + (k as f64 - (n - 1.0) / 2.0) * gap,
                y,
            };
        }
    }
    let coordinators = buckets
        .get(&SwarmRole::Coordinator)
        .cloned()
        .unwrap_or_default();
    if let Some((hub, extra)) = coordinators.split_first() {
        points[*hub] = GraphPoint { x: 50.0, y: 58.0 };
        row(&mut points, extra, 78.0, 18.0, 0.0);
    }
    let builders = buckets
        .get(&SwarmRole::Builder)
        .cloned()
        .unwrap_or_default();
    if builders.len() <= 4 {
        let n = builders.len();
        let spread = if n <= 1 {
            0.0
        } else {
            (16.0 * (n as f64 - 1.0)).max(32.0)
        };
        for (k, index) in builders.iter().enumerate() {
            let t = if n == 1 {
                0.5
            } else {
                k as f64 / (n as f64 - 1.0)
            };
            points[*index] = GraphPoint {
                x: 50.0 + (t - 0.5) * spread,
                y: 24.0 + (1.0 - (std::f64::consts::PI * t).sin()) * 8.0,
            };
        }
    } else {
        let mid = builders.len().div_ceil(2);
        let top = &builders[..mid];
        let bot = &builders[mid..];
        row(&mut points, top, 18.0, 16.0, 0.0);
        row(
            &mut points,
            bot,
            34.0,
            16.0,
            if top.len() == bot.len() { 8.0 } else { 0.0 },
        );
    }
    let column = |indices: &[usize], x: f64, points: &mut [GraphPoint]| {
        let n = indices.len() as f64;
        for (k, index) in indices.iter().enumerate() {
            points[*index] = GraphPoint {
                x,
                y: 54.0 + (k as f64 - (n - 1.0) / 2.0) * 16.0,
            };
        }
    };
    column(
        buckets
            .get(&SwarmRole::Scout)
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        14.0,
        &mut points,
    );
    column(
        buckets
            .get(&SwarmRole::Reviewer)
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        86.0,
        &mut points,
    );
    points
}

pub fn swarm_graph_hub(roles: &[SwarmRole]) -> usize {
    roles
        .iter()
        .position(|role| *role == SwarmRole::Coordinator)
        .unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SwarmRunRecord {
    pub id: String,
    pub name: String,
    pub folder_path: String,
    pub mission: String,
    pub launch_mode: SwarmLaunchMode,
    pub preset_id: SwarmPresetId,
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub skill_directives: BTreeMap<String, String>,
    pub board_session_id: Option<String>,
    pub status: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub budget_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SwarmSeatRecord {
    pub id: String,
    pub run_id: String,
    pub role: SwarmRole,
    pub agent_id: BoardAgentId,
    pub mode: SwarmLaunchMode,
    pub pane_id: Option<String>,
    pub worktree_path: Option<String>,
    pub branch: Option<String>,
    pub status: String,
    pub tokens_used: i64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SwarmTaskRecord {
    pub id: String,
    pub run_id: String,
    pub seat_id: Option<String>,
    pub title: String,
    pub detail: Option<String>,
    pub files: Vec<String>,
    pub status: String,
    pub depends_on: Vec<String>,
    pub attempts: i64,
    pub landed_commit: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SwarmMessageRecord {
    pub id: String,
    pub run_id: String,
    pub seat_id: Option<String>,
    pub kind: String,
    pub body: String,
    pub created_at: String,
}

const RUN_STATUSES: &[&str] = &["running", "stuck", "budget", "stopped", "done", "failed"];
const SEAT_STATUSES: &[&str] = &["queued", "booting", "working", "idle", "exited", "failed"];
const TASK_STATUSES: &[&str] = &[
    "pending",
    "in_progress",
    "review",
    "landed",
    "failed",
    "skipped",
];
const MESSAGE_KINDS: &[&str] = &[
    "directive",
    "seat_report",
    "coordinator_note",
    "task_event",
    "system",
];

pub fn parse_swarm_run(value: &Value) -> Result<SwarmRunRecord, ParseError> {
    let mut run: SwarmRunRecord = from_strict(value)?;
    require_uuid(&run.id)?;
    run.name = crate::validate::trim_len(&run.name, 1, 120)?;
    require_len(&run.folder_path, 1, 4096)?;
    run.mission = crate::validate::trim_len(&run.mission, 1, 10_000)?;
    if run.skill_ids.len() > 32 {
        return Err(ParseError::new("skillIds"));
    }
    if !RUN_STATUSES.contains(&run.status.as_str()) {
        return Err(ParseError::new("status"));
    }
    require_datetime(&run.started_at)?;
    if let Some(ended) = &run.ended_at {
        require_datetime(ended)?;
    }
    if run.budget_ms < 60_000 || run.budget_ms > 24 * 60 * 60_000 {
        return Err(ParseError::new("budgetMs"));
    }
    Ok(run)
}

pub fn parse_swarm_seat(value: &Value) -> Result<SwarmSeatRecord, ParseError> {
    let seat: SwarmSeatRecord = from_strict(value)?;
    require_uuid(&seat.id)?;
    require_uuid(&seat.run_id)?;
    if !SEAT_STATUSES.contains(&seat.status.as_str()) {
        return Err(ParseError::new("status"));
    }
    if seat.tokens_used < 0 || seat.cost_usd < 0.0 {
        return Err(ParseError::new("usage"));
    }
    Ok(seat)
}

pub fn parse_swarm_task(value: &Value) -> Result<SwarmTaskRecord, ParseError> {
    let mut task: SwarmTaskRecord = from_strict(value)?;
    require_uuid(&task.id)?;
    require_uuid(&task.run_id)?;
    task.title = crate::validate::trim_len(&task.title, 1, 500)?;
    if !TASK_STATUSES.contains(&task.status.as_str()) {
        return Err(ParseError::new("status"));
    }
    if task.attempts < 0 || task.attempts > 3 {
        return Err(ParseError::new("attempts"));
    }
    require_datetime(&task.created_at)?;
    require_datetime(&task.updated_at)?;
    Ok(task)
}

pub fn parse_swarm_message(value: &Value) -> Result<SwarmMessageRecord, ParseError> {
    let message: SwarmMessageRecord = from_strict(value)?;
    require_uuid(&message.id)?;
    require_uuid(&message.run_id)?;
    if !MESSAGE_KINDS.contains(&message.kind.as_str()) {
        return Err(ParseError::new("kind"));
    }
    require_len(&message.body, 1, 4_000)?;
    require_datetime(&message.created_at)?;
    Ok(message)
}

pub fn parse_swarm_create_request(value: &Value) -> Result<Value, ParseError> {
    let obj = value.as_object().ok_or_else(|| ParseError::new("object"))?;
    let corr = obj
        .get("correlationId")
        .and_then(Value::as_str)
        .ok_or_else(|| ParseError::new("correlationId"))?;
    require_uuid(corr)?;
    let input = obj.get("input").ok_or_else(|| ParseError::new("input"))?;
    let input_obj = input.as_object().ok_or_else(|| ParseError::new("input"))?;
    let name = input_obj.get("name").and_then(Value::as_str).unwrap_or("");
    if name.trim().is_empty() || name.trim().len() > 120 {
        return Err(ParseError::new("name"));
    }
    let seats = input_obj
        .get("seats")
        .and_then(Value::as_array)
        .ok_or_else(|| ParseError::new("seats"))?;
    if seats.is_empty() || seats.len() > 12 {
        return Err(ParseError::new("seats"));
    }
    let _mode: SwarmLaunchMode =
        serde_json::from_value(input_obj.get("launchMode").cloned().unwrap_or(json!(null)))
            .map_err(|_| ParseError::new("launchMode"))?;
    let _preset: SwarmPresetId =
        serde_json::from_value(input_obj.get("presetId").cloned().unwrap_or(json!(null)))
            .map_err(|_| ParseError::new("presetId"))?;
    Ok(value.clone())
}

pub fn parse_swarm_direct_request(value: &Value) -> Result<Value, ParseError> {
    let obj = value.as_object().ok_or_else(|| ParseError::new("object"))?;
    require_uuid(
        obj.get("correlationId")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )?;
    let input = obj
        .get("input")
        .and_then(Value::as_object)
        .ok_or_else(|| ParseError::new("input"))?;
    require_uuid(input.get("runId").and_then(Value::as_str).unwrap_or(""))?;
    let seats = input
        .get("seatIds")
        .and_then(Value::as_array)
        .ok_or_else(|| ParseError::new("seatIds"))?;
    if seats.is_empty() || seats.len() > 12 {
        return Err(ParseError::new("seatIds"));
    }
    let body = input.get("body").and_then(Value::as_str).unwrap_or("");
    if body.trim().is_empty() || body.trim().len() > 4_000 {
        return Err(ParseError::new("body"));
    }
    Ok(value.clone())
}

pub fn parse_swarm_stop_request(value: &Value) -> Result<Value, ParseError> {
    let obj = value.as_object().ok_or_else(|| ParseError::new("object"))?;
    require_uuid(
        obj.get("correlationId")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )?;
    require_uuid(obj.get("runId").and_then(Value::as_str).unwrap_or(""))?;
    Ok(value.clone())
}

pub fn parse_swarm_add_seat_request(value: &Value) -> Result<Value, ParseError> {
    let obj = value.as_object().ok_or_else(|| ParseError::new("object"))?;
    require_uuid(
        obj.get("correlationId")
            .and_then(Value::as_str)
            .unwrap_or(""),
    )?;
    require_uuid(obj.get("runId").and_then(Value::as_str).unwrap_or(""))?;
    let _role: SwarmRole = serde_json::from_value(obj.get("role").cloned().unwrap_or(json!(null)))
        .map_err(|_| ParseError::new("role"))?;
    let _agent: BoardAgentId =
        serde_json::from_value(obj.get("agentId").cloned().unwrap_or(json!(null)))
            .map_err(|_| ParseError::new("agentId"))?;
    Ok(value.clone())
}
