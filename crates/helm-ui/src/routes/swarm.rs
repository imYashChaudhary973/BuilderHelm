//! Swarm route. Ports `swarm-setup.tsx` (684), `swarm-live.tsx` (595) and
//! `routes/swarm.tsx` (435).
//!
//! `routes/swarm.tsx` switches on `run === null`: no run means the three-step
//! launch wizard, a run means the live view. That switch is [`Stage`] here.

use std::collections::BTreeMap;

use helm_pty::{Parser, Snapshot};
use iced::border::Radius;
use iced::widget::{
    button, column, container, pick_list, row, scrollable, text, text_editor, text_input, Space,
};
use iced::{Border, Element, Fill, Padding, Shadow, Task};

use super::common::{
    body, card, chip, dim, empty_state, error_banner, eyebrow, h1, h3, lede, page, pill,
    primary_button, secondary_button, section_heading, stop_button, text_button, BODY, SMALL, TINY,
};
use crate::terminal::{terminal_pane, PaneMessage, PaneStatus, TerminalPane};
use crate::tokens::{
    ACCENT, ACCENT_BRIGHT, ACCENT_DIM, ACCENT_LINE, BG_1, DANGER, GLASS, LINE, LINE_STRONG, PANEL,
    RADIUS_L, RADIUS_M, RADIUS_S, TEXT, TEXT_2, TEXT_3, WARNING,
};

/// `SWARM_PANE_COUNT` neighbours in `helm-protocol`: a roster tops out at 12.
const SEAT_MAX: usize = 12;
/// `SWARM_BUDGET_MS`.
const BUDGET_MS: i64 = 20 * 60 * 1000;
/// `MAX_ATTEMPTS` in `swarm_service.rs`.
const MAX_ATTEMPTS: u32 = 2;
/// `SWARM_SINGLE_TASK_NOTE`.
const SINGLE_TASK_NOTE: &str = "No planner CLI (claude or grok). This mission is one task — spare builders stay idle on purpose.";
/// Graph node width, `.swarmNode { width: 148px }`.
const NODE_W: f32 = 148.0;

// ---------------------------------------------------------------------------
// Vocabulary. `helm-ui` cannot depend on `helm-protocol`, so the swarm nouns
// the routes render are mirrored here with the same names and strings.
// ---------------------------------------------------------------------------

/// Which surface `routes/swarm.tsx` mounts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Setup,
    Live,
}

/// `type Step = 'mission' | 'roster' | 'launch'`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Mission,
    Roster,
    Launch,
}

impl Step {
    const ALL: [Step; 3] = [Step::Mission, Step::Roster, Step::Launch];

    fn label(self) -> &'static str {
        match self {
            Step::Mission => "Mission",
            Step::Roster => "Roster",
            Step::Launch => "Launch",
        }
    }
}

/// `SwarmRole`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Coordinator,
    Builder,
    Scout,
    Reviewer,
}

impl Role {
    const ALL: [Role; 4] = [
        Role::Coordinator,
        Role::Builder,
        Role::Scout,
        Role::Reviewer,
    ];

    fn as_str(self) -> &'static str {
        match self {
            Role::Coordinator => "coordinator",
            Role::Builder => "builder",
            Role::Scout => "scout",
            Role::Reviewer => "reviewer",
        }
    }

    /// The seat rows read `queen` for the coordinator everywhere in the TSX.
    fn seat_label(self) -> &'static str {
        match self {
            Role::Coordinator => "queen",
            other => other.as_str(),
        }
    }
}

/// `BoardAgentId`, narrowed to the CLIs `availableSwarmAgents` can return.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentId {
    Claude,
    Codex,
    Grok,
    Gemini,
    Opencode,
}

impl AgentId {
    /// `BOARD_AGENT_CATALOG` labels.
    fn label(self) -> &'static str {
        match self {
            AgentId::Claude => "Claude",
            AgentId::Codex => "Codex",
            AgentId::Grok => "Grok",
            AgentId::Gemini => "Gemini",
            AgentId::Opencode => "OpenCode",
        }
    }

    fn id(self) -> &'static str {
        match self {
            AgentId::Claude => "claude",
            AgentId::Codex => "codex",
            AgentId::Grok => "grok",
            AgentId::Gemini => "gemini",
            AgentId::Opencode => "opencode",
        }
    }

    /// `SEAT_MODELS`.
    fn models(self) -> &'static [&'static str] {
        match self {
            AgentId::Grok => &["grok-4", "grok-4.5", "grok-4.6"],
            AgentId::Claude => &["sonnet", "opus", "haiku"],
            AgentId::Codex => &["gpt-5.4"],
            _ => &[],
        }
    }
}

impl std::fmt::Display for AgentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

/// `SwarmPresetId`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PresetId {
    Skiff,
    Cutter,
    Frigate,
    Flagship,
}

struct Preset {
    id: PresetId,
    size: u8,
    label: &'static str,
    coordinator: u8,
    builder: u8,
    scout: u8,
    reviewer: u8,
}

/// `SWARM_PRESETS`.
const PRESETS: [Preset; 4] = [
    Preset {
        id: PresetId::Skiff,
        size: 3,
        label: "Skiff",
        coordinator: 1,
        builder: 1,
        scout: 1,
        reviewer: 0,
    },
    Preset {
        id: PresetId::Cutter,
        size: 5,
        label: "Cutter",
        coordinator: 1,
        builder: 2,
        scout: 1,
        reviewer: 1,
    },
    Preset {
        id: PresetId::Frigate,
        size: 8,
        label: "Frigate",
        coordinator: 1,
        builder: 5,
        scout: 1,
        reviewer: 1,
    },
    Preset {
        id: PresetId::Flagship,
        size: 12,
        label: "Flagship",
        coordinator: 1,
        builder: 7,
        scout: 2,
        reviewer: 2,
    },
];

/// `swarmPlanBudget`.
fn plan_budget(id: PresetId) -> u32 {
    match id {
        PresetId::Skiff => 3,
        PresetId::Cutter => 6,
        PresetId::Frigate => 10,
        PresetId::Flagship => 14,
    }
}

/// `swarmPresetRoles`.
fn preset_roles(id: PresetId) -> Vec<Role> {
    let preset = PRESETS.iter().find(|item| item.id == id).unwrap();
    let mut roles = Vec::with_capacity(usize::from(preset.size));
    for (count, role) in [
        (preset.coordinator, Role::Coordinator),
        (preset.builder, Role::Builder),
        (preset.scout, Role::Scout),
        (preset.reviewer, Role::Reviewer),
    ] {
        for _ in 0..count {
            roles.push(role);
        }
    }
    roles
}

/// `assignSwarmPanes`.
fn assign_panes(agents: &[AgentId], roles: &[Role]) -> Vec<Seat> {
    if agents.is_empty() || roles.is_empty() {
        return Vec::new();
    }
    roles
        .iter()
        .enumerate()
        .map(|(index, role)| Seat {
            role: *role,
            agent: agents[index % agents.len()],
            auto: false,
            model: None,
        })
        .collect()
}

/// `SwarmLaunchMode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchMode {
    Safe,
    Auto,
    Full,
}

impl LaunchMode {
    const ALL: [LaunchMode; 3] = [LaunchMode::Safe, LaunchMode::Auto, LaunchMode::Full];

    fn title(self) -> &'static str {
        match self {
            LaunchMode::Safe => "Safe",
            LaunchMode::Auto => "Auto-edit",
            LaunchMode::Full => "Full bypass",
        }
    }

    fn detail(self) -> &'static str {
        match self {
            LaunchMode::Safe => "Read and analyze only. Unapproved actions fail closed.",
            LaunchMode::Auto => "Agents edit files freely; shell commands still gated.",
            LaunchMode::Full => "Trusted local folders only. Skips every approval.",
        }
    }

    fn recap(self) -> &'static str {
        match self {
            LaunchMode::Safe => "Safe — read and analyze only",
            LaunchMode::Auto => "Auto-edit — files yes, commands gated",
            LaunchMode::Full => "Full bypass — every approval skipped",
        }
    }
}

struct Skill {
    id: &'static str,
    group: &'static str,
    title: &'static str,
    detail: &'static str,
    directive: &'static str,
}

/// `SKILL_GROUPS`.
const SKILL_GROUPS: [&str; 4] = ["workflow", "quality", "ops", "analysis"];

/// `SWARM_SKILLS`.
const SKILLS: [Skill; 18] = [
    Skill {
        id: "commits",
        group: "workflow",
        title: "Incremental Commits",
        detail: "Commit small, atomic changes.",
        directive: "Commit in small atomic steps after each working change.",
    },
    Skill {
        id: "refactor",
        group: "workflow",
        title: "Refactor Only",
        detail: "Restructure without changing behavior.",
        directive: "Refactor structure only. Do not change behavior.",
    },
    Skill {
        id: "monorepo",
        group: "workflow",
        title: "Monorepo Aware",
        detail: "Respect package boundaries.",
        directive: "Stay inside the touched package. Do not break workspace boundaries.",
    },
    Skill {
        id: "tdd",
        group: "quality",
        title: "Test-Driven",
        detail: "Write tests first, then implement.",
        directive: "Write a failing test first, then the smallest code that passes.",
    },
    Skill {
        id: "review",
        group: "quality",
        title: "Code Review",
        detail: "Review all changes before merge.",
        directive: "Review every change before considering the job done.",
    },
    Skill {
        id: "docs",
        group: "quality",
        title: "Documentation",
        detail: "Document public APIs.",
        directive: "Document public APIs and update existing docs you touch.",
    },
    Skill {
        id: "security",
        group: "quality",
        title: "Security Audit",
        detail: "Check for vulnerabilities.",
        directive: "Watch for injection, secret leaks, and unsafe defaults.",
    },
    Skill {
        id: "dry",
        group: "quality",
        title: "DRY Principle",
        detail: "Eliminate duplication.",
        directive: "Remove duplication instead of copying logic.",
    },
    Skill {
        id: "a11y",
        group: "quality",
        title: "Accessibility",
        detail: "Meet WCAG basics.",
        directive: "Keep UI keyboardable, labeled, and contrast-safe (WCAG 2.1 AA).",
    },
    Skill {
        id: "types",
        group: "quality",
        title: "Type Strict",
        detail: "No implicit any.",
        directive: "Keep types strict. Do not add implicit any or unsafe casts.",
    },
    Skill {
        id: "lint",
        group: "quality",
        title: "Lint Clean",
        detail: "Leave the tree lint-clean.",
        directive: "Leave lint and format clean in files you touch.",
    },
    Skill {
        id: "ci",
        group: "ops",
        title: "Keep CI Green",
        detail: "All checks pass.",
        directive: "Do not leave the tree failing typecheck or tests you can run.",
    },
    Skill {
        id: "migrations",
        group: "ops",
        title: "Migration Safe",
        detail: "Safe schema changes.",
        directive: "Schema changes must be additive and reversible.",
    },
    Skill {
        id: "changelog",
        group: "ops",
        title: "Changelog",
        detail: "Note user-facing changes.",
        directive: "Record user-facing changes in the project changelog style.",
    },
    Skill {
        id: "errors",
        group: "ops",
        title: "Error Handling",
        detail: "Fail closed, say why.",
        directive: "Fail closed on errors. Surface a clear reason. Do not swallow.",
    },
    Skill {
        id: "perf",
        group: "analysis",
        title: "Performance",
        detail: "Watch hot paths.",
        directive: "Avoid extra allocations and work on hot paths.",
    },
    Skill {
        id: "privacy",
        group: "analysis",
        title: "Privacy First",
        detail: "No secrets in logs.",
        directive: "Never log secrets, tokens, or personal data.",
    },
    Skill {
        id: "logging",
        group: "analysis",
        title: "Observability",
        detail: "Useful logs, no noise.",
        directive: "Log useful state changes. Do not add noisy debug spam.",
    },
];

/// `SwarmAssignment`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seat {
    pub role: Role,
    pub agent: AgentId,
    pub auto: bool,
    pub model: Option<String>,
}

/// `SeatPhase` in `helm-swarm`, the seat status strings the ledger stores.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SeatPhase {
    Queued,
    Booting,
    Working,
    Idle,
    Exited,
    Failed,
}

impl SeatPhase {
    fn as_str(self) -> &'static str {
        match self {
            SeatPhase::Queued => "queued",
            SeatPhase::Booting => "booting",
            SeatPhase::Working => "working",
            SeatPhase::Idle => "idle",
            SeatPhase::Exited => "exited",
            SeatPhase::Failed => "failed",
        }
    }

    /// `.swarmNode[data-status=…]` dims the seats that are not doing work.
    fn opacity(self) -> f32 {
        match self {
            SeatPhase::Queued => 0.55,
            SeatPhase::Idle => 0.82,
            SeatPhase::Exited => 0.5,
            _ => 1.0,
        }
    }

    fn pane_status(self) -> PaneStatus {
        match self {
            SeatPhase::Queued | SeatPhase::Booting => PaneStatus::Starting,
            SeatPhase::Working | SeatPhase::Idle => PaneStatus::Running,
            SeatPhase::Exited => PaneStatus::Exited,
            SeatPhase::Failed => PaneStatus::Failed,
        }
    }
}

/// `TASK_STATUSES`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    Pending,
    InProgress,
    Review,
    Landed,
    Failed,
    Skipped,
}

impl TaskStatus {
    fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Review => "review",
            TaskStatus::Landed => "landed",
            TaskStatus::Failed => "failed",
            TaskStatus::Skipped => "skipped",
        }
    }
}

/// `MESSAGE_KINDS`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageKind {
    Directive,
    SeatReport,
    CoordinatorNote,
    TaskEvent,
    System,
}

impl MessageKind {
    fn as_str(self) -> &'static str {
        match self {
            MessageKind::Directive => "directive",
            MessageKind::SeatReport => "seat_report",
            MessageKind::CoordinatorNote => "coordinator_note",
            MessageKind::TaskEvent => "task_event",
            MessageKind::System => "system",
        }
    }

    /// The Chat tab drops ledger bookkeeping and shows the conversation only.
    fn is_chat(self) -> bool {
        matches!(
            self,
            MessageKind::Directive | MessageKind::CoordinatorNote | MessageKind::SeatReport
        )
    }
}

/// `SwarmRunRecordStatus`, plus the derived `coordinating` the TSX passes down.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunStatus {
    Coordinating,
    Running,
    Stuck,
    Budget,
    Stopped,
    Done,
    Failed,
}

impl RunStatus {
    fn as_str(self) -> &'static str {
        match self {
            RunStatus::Coordinating => "coordinating",
            RunStatus::Running => "running",
            RunStatus::Stuck => "stuck",
            RunStatus::Budget => "budget",
            RunStatus::Stopped => "stopped",
            RunStatus::Done => "done",
            RunStatus::Failed => "failed",
        }
    }

    /// `stopped` in `swarm-live.tsx`: anything but a live run locks the actions.
    fn stopped(self) -> bool {
        !matches!(self, RunStatus::Running | RunStatus::Coordinating)
    }

    fn summary_title(self) -> &'static str {
        match self {
            RunStatus::Done => "Swarm finished",
            RunStatus::Failed => "Swarm stopped with failures",
            RunStatus::Budget => "Budget spent; swarm stopped",
            _ => "Swarm stopped",
        }
    }
}

/// Verify gate → reviewer verdict → `land_exclusive`, the pipeline every task
/// walks in `swarm_service.rs` between `in_progress` and `landed`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LandStage {
    Verify,
    Review,
    Land,
    Landed,
    Blocked,
}

impl LandStage {
    fn as_str(self) -> &'static str {
        match self {
            LandStage::Verify => "verify",
            LandStage::Review => "review",
            LandStage::Land => "land",
            LandStage::Landed => "landed",
            LandStage::Blocked => "blocked",
        }
    }

    fn advance_label(self) -> &'static str {
        match self {
            LandStage::Verify => "Pass verify",
            LandStage::Review => "Approve review",
            LandStage::Land => "Land branch",
            LandStage::Landed => "Landed",
            LandStage::Blocked => "Blocked",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LandAction {
    Advance,
    Retry,
    Skip,
}

/// Live-view stage toggle: the graph or the seat terminals.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiveView {
    Graph,
    Terminals,
}

/// `InspectorTab`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tab {
    Agent,
    Plan,
    Chat,
    Activity,
    Roster,
}

impl Tab {
    const ALL: [Tab; 5] = [Tab::Agent, Tab::Plan, Tab::Chat, Tab::Activity, Tab::Roster];

    fn label(self) -> &'static str {
        match self {
            Tab::Agent => "Agent",
            Tab::Plan => "Plan",
            Tab::Chat => "Chat",
            Tab::Activity => "Activity",
            Tab::Roster => "Roster",
        }
    }
}

/// The Agent tab's own Full / Seat switch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentView {
    Full,
    Seat,
}

/// `<select>` option for the seat model. `None` is the CLI default.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelChoice(pub Option<String>);

impl std::fmt::Display for ModelChoice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.0 {
            Some(model) => f.write_str(model),
            None => f.write_str("Default model"),
        }
    }
}

/// `<select>` option in the direct-the-swarm footer. `None` is `@all`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TargetChoice {
    pub seat: Option<String>,
    pub label: String,
}

impl std::fmt::Display for TargetChoice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.label)
    }
}

// ---------------------------------------------------------------------------
// Live ledger rows
// ---------------------------------------------------------------------------

/// A terminal pane belonging to a seat. `terminal_pane` borrows both halves,
/// so the chrome and the snapshot live in state instead of being rebuilt.
struct SeatPane {
    chrome: TerminalPane,
    snap: Snapshot,
}

/// `SwarmLiveSeat`.
pub struct LiveSeat {
    id: String,
    role: Role,
    agent: AgentId,
    phase: SeatPhase,
    tokens_used: u64,
    cost_usd: f64,
    branch: Option<String>,
    /// Tail of the pane output, `previews[paneId]` in the TSX.
    preview: String,
    pane: Option<SeatPane>,
}

impl LiveSeat {
    fn new(id: String, role: Role, agent: AgentId, phase: SeatPhase) -> Self {
        Self {
            id,
            role,
            agent,
            phase,
            tokens_used: 0,
            cost_usd: 0.0,
            branch: None,
            preview: String::new(),
            pane: None,
        }
    }

    fn with_pane(mut self, output: &str) -> Self {
        let mut parser = Parser::new(80, 14, 0);
        parser.feed(output.as_bytes());
        self.preview = output.replace('\r', "");
        self.pane = Some(SeatPane {
            chrome: TerminalPane {
                title: format!("{} · {}", self.agent.id(), self.role.as_str()),
                branch: self.branch.clone(),
                status: self.phase.pane_status(),
                focused: false,
                maximized: false,
                landing: false,
                confirm_land: false,
                // `onLand`/`onAdd` are undefined for swarm panes in the TSX.
                show_land: false,
                show_split: false,
            },
            snap: parser.snapshot(),
        });
        self
    }

    fn tokens(mut self, tokens_used: u64, cost_usd: f64) -> Self {
        self.tokens_used = tokens_used;
        self.cost_usd = cost_usd;
        self
    }

    fn branch(mut self, branch: &str) -> Self {
        self.branch = Some(branch.to_owned());
        self
    }

    fn set_phase(&mut self, phase: SeatPhase) {
        self.phase = phase;
        if let Some(pane) = &mut self.pane {
            pane.chrome.status = phase.pane_status();
        }
    }
}

/// `SwarmTaskRecord`.
pub struct TaskRow {
    id: String,
    seat_id: Option<String>,
    title: String,
    files: Vec<String>,
    status: TaskStatus,
    depends_on: Vec<String>,
    attempts: u32,
    updated_ms: i64,
}

/// `SwarmMessageRecord`.
pub struct LedgerMessage {
    kind: MessageKind,
    body: String,
    created_ms: i64,
}

/// One task waiting on the verify → review → land pipeline.
pub struct LandItem {
    task_id: String,
    title: String,
    branch: String,
    stage: LandStage,
    commit: Option<String>,
    note: Option<String>,
}

/// `SwarmRunRecord`, plus the isolation the live header prints.
pub struct Run {
    name: String,
    mission: String,
    folder: String,
    worktrees: bool,
    status: RunStatus,
    started_ms: i64,
    budget_ms: i64,
}

// ---------------------------------------------------------------------------
// Formatting helpers, ported one for one
// ---------------------------------------------------------------------------

/// `money`.
fn money(value: f64) -> String {
    if value >= 0.01 {
        format!("${value:.2}")
    } else {
        format!("${value:.4}")
    }
}

/// `clockOf` — `createdAt.slice(11, 19)`, the UTC wall clock.
fn clock_of(ms: i64) -> String {
    let day = ms.rem_euclid(86_400_000) / 1000;
    format!("{:02}:{:02}:{:02}", day / 3600, (day % 3600) / 60, day % 60)
}

/// `elapsedLabel`.
fn elapsed_label(updated_ms: i64, now_ms: i64) -> String {
    let seconds = ((now_ms - updated_ms) / 1000).max(0);
    let minutes = seconds / 60;
    if minutes > 0 {
        format!("{minutes}m {}s", seconds % 60)
    } else {
        format!("{seconds}s")
    }
}

/// `formatRemain`.
fn format_remain(ms: i64) -> String {
    let safe = ms.max(0);
    format!("{}:{:02}", safe / 60_000, (safe % 60_000) / 1000)
}

/// `costBand` — rough per-run band from seat count.
fn cost_band(seats: usize) -> String {
    let seats = seats as f64;
    format!("${:.2}–${:.2}", seats * 0.15, seats * 0.6)
}

/// `folderName`.
fn folder_name(path: &str) -> &str {
    path.split('/')
        .rfind(|part| !part.is_empty())
        .unwrap_or(path)
}

/// `s` suffix used all over the roster copy.
fn plural(count: usize) -> &'static str {
    if count == 1 {
        ""
    } else {
        "s"
    }
}

/// `swarmSeatLabel` — `Builder 2`, counted within the role.
fn seat_label(roles: &[Role], index: usize) -> String {
    let Some(role) = roles.get(index) else {
        return format!("Seat {}", index + 1);
    };
    let n = roles
        .iter()
        .take(index + 1)
        .filter(|item| *item == role)
        .count();
    let name = role.as_str();
    let mut chars = name.chars();
    let first = chars.next().unwrap().to_ascii_uppercase();
    format!("{first}{} {n}", chars.as_str())
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct State {
    // routes/swarm.tsx
    stage: Stage,
    error: Option<String>,
    pending: bool,
    // swarm-setup.tsx
    step: Step,
    job: text_editor::Content,
    folder_path: String,
    home_dir: String,
    recents: Vec<String>,
    preset: PresetId,
    mode: LaunchMode,
    worktrees: bool,
    skill_ids: Vec<&'static str>,
    skill_directives: BTreeMap<&'static str, String>,
    open_skill: Option<&'static str>,
    swarm_name: String,
    roster: Vec<Seat>,
    detected: Vec<AgentId>,
    // swarm-live.tsx
    run: Option<Run>,
    seats: Vec<LiveSeat>,
    tasks: Vec<TaskRow>,
    messages: Vec<LedgerMessage>,
    land: Vec<LandItem>,
    view: LiveView,
    tab: Tab,
    agent_view: AgentView,
    target: Option<String>,
    maximized: Option<String>,
    draft: String,
    now_ms: i64,
}

/// Seeded ledger clock: `startedAt` of the run `Default` adopts.
const SEED_START_MS: i64 = 1_772_419_200_000;
/// The seeded run is eight minutes and change into its 20 minute budget.
const SEED_NOW_MS: i64 = SEED_START_MS + 8 * 60_000 + 42_000;

impl Default for State {
    fn default() -> Self {
        let detected = vec![AgentId::Claude, AgentId::Codex, AgentId::Grok];
        let mission = "Port the Electron renderer routes to iced and keep the token vocabulary.";
        let roster = vec![
            Seat {
                role: Role::Coordinator,
                agent: AgentId::Claude,
                auto: true,
                model: Some("opus".into()),
            },
            Seat {
                role: Role::Builder,
                agent: AgentId::Codex,
                auto: false,
                model: None,
            },
            Seat {
                role: Role::Builder,
                agent: AgentId::Grok,
                auto: false,
                model: Some("grok-4.6".into()),
            },
            Seat {
                role: Role::Reviewer,
                agent: AgentId::Claude,
                auto: false,
                model: None,
            },
        ];
        let seats = vec![
            LiveSeat::new(
                "seat-1".into(),
                Role::Coordinator,
                AgentId::Claude,
                SeatPhase::Working,
            )
            .tokens(18_432, 0.42)
            .with_pane("coordinator: 5 tasks planned, 1 landed\r\nwaiting on builder-1 verify\r\n"),
            LiveSeat::new(
                "seat-2".into(),
                Role::Builder,
                AgentId::Codex,
                SeatPhase::Working,
            )
            .tokens(26_910, 0.63)
            .branch("swarm/port-routes")
            .with_pane("edit crates/helm-ui/src/routes/swarm.rs\r\ncargo check -p helm-ui\r\n"),
            LiveSeat::new(
                "seat-3".into(),
                Role::Builder,
                AgentId::Grok,
                SeatPhase::Idle,
            )
            .tokens(12_004, 0.21)
            .branch("swarm/port-rail")
            .with_pane("landed swarm/port-rail at 9f2c1ab\r\n"),
            LiveSeat::new(
                "seat-4".into(),
                Role::Reviewer,
                AgentId::Claude,
                SeatPhase::Idle,
            )
            .tokens(5_120, 0.09),
        ];
        let tasks = vec![
            TaskRow {
                id: "task-1".into(),
                seat_id: Some("seat-3".into()),
                title: "Port the workspace rail".into(),
                files: vec!["crates/helm-ui/src/rail.rs".into()],
                status: TaskStatus::Landed,
                depends_on: Vec::new(),
                attempts: 1,
                updated_ms: SEED_START_MS + 4 * 60_000,
            },
            TaskRow {
                id: "task-2".into(),
                seat_id: Some("seat-2".into()),
                title: "Port the swarm route".into(),
                files: vec!["crates/helm-ui/src/routes/swarm.rs".into()],
                status: TaskStatus::InProgress,
                depends_on: Vec::new(),
                attempts: 1,
                updated_ms: SEED_NOW_MS - 3 * 60_000 - 12_000,
            },
            TaskRow {
                id: "task-3".into(),
                seat_id: Some("seat-1".into()),
                title: "Wire the terminal pane".into(),
                files: vec!["crates/helm-ui/src/terminal.rs".into()],
                status: TaskStatus::Review,
                depends_on: vec!["task-1".into()],
                attempts: 1,
                updated_ms: SEED_NOW_MS - 47_000,
            },
            TaskRow {
                id: "task-4".into(),
                seat_id: None,
                title: "Port the board grid".into(),
                files: vec!["crates/helm-ui/src/routes/board.rs".into()],
                status: TaskStatus::Pending,
                depends_on: vec!["task-2".into()],
                attempts: 1,
                updated_ms: SEED_START_MS + 60_000,
            },
            TaskRow {
                id: "task-5".into(),
                seat_id: Some("seat-2".into()),
                title: "Land the kanban columns".into(),
                files: vec!["crates/helm-ui/src/routes/kanban.rs".into()],
                status: TaskStatus::Failed,
                depends_on: Vec::new(),
                attempts: 2,
                updated_ms: SEED_NOW_MS - 2 * 60_000,
            },
        ];
        let messages = vec![
            LedgerMessage {
                kind: MessageKind::System,
                body: "Swarm roster: queen claude, builder codex, builder grok, reviewer claude."
                    .into(),
                created_ms: SEED_START_MS + 2_000,
            },
            LedgerMessage {
                kind: MessageKind::CoordinatorNote,
                body: "Split the mission into 5 tasks; the rail lands first.".into(),
                created_ms: SEED_START_MS + 51_000,
            },
            LedgerMessage {
                kind: MessageKind::TaskEvent,
                body: "landed \"Port the workspace rail\" at 9f2c1ab".into(),
                created_ms: SEED_START_MS + 4 * 60_000,
            },
            LedgerMessage {
                kind: MessageKind::SeatReport,
                body: "builder codex: swarm route ported, running cargo check.".into(),
                created_ms: SEED_NOW_MS - 3 * 60_000,
            },
            LedgerMessage {
                kind: MessageKind::TaskEvent,
                body: "failed \"Land the kanban columns\": verify gate: pnpm -w typecheck failed"
                    .into(),
                created_ms: SEED_NOW_MS - 2 * 60_000,
            },
            LedgerMessage {
                kind: MessageKind::Directive,
                body: "Keep the diff inside crates/helm-ui.".into(),
                created_ms: SEED_NOW_MS - 30_000,
            },
        ];
        let land = vec![
            LandItem {
                task_id: "task-1".into(),
                title: "Port the workspace rail".into(),
                branch: "swarm/port-rail".into(),
                stage: LandStage::Landed,
                commit: Some("9f2c1ab".into()),
                note: None,
            },
            LandItem {
                task_id: "task-3".into(),
                title: "Wire the terminal pane".into(),
                branch: "swarm/wire-pane".into(),
                stage: LandStage::Review,
                commit: None,
                note: None,
            },
            LandItem {
                task_id: "task-2".into(),
                title: "Port the swarm route".into(),
                branch: "swarm/port-routes".into(),
                stage: LandStage::Verify,
                commit: None,
                note: None,
            },
            LandItem {
                task_id: "task-5".into(),
                title: "Land the kanban columns".into(),
                branch: "swarm/kanban".into(),
                stage: LandStage::Blocked,
                commit: None,
                note: Some("verify gate: pnpm -w typecheck failed".into()),
            },
        ];
        let mut state = Self {
            stage: Stage::Live,
            error: None,
            pending: false,
            step: Step::Mission,
            job: text_editor::Content::with_text(mission),
            folder_path: "/Users/helm/code/builderhelm".into(),
            home_dir: "/Users/helm".into(),
            recents: vec![
                "/Users/helm/code/builderhelm".into(),
                "/Users/helm/code/zero".into(),
            ],
            preset: PresetId::Frigate,
            mode: LaunchMode::Auto,
            worktrees: true,
            skill_ids: vec!["commits", "tdd"],
            skill_directives: BTreeMap::new(),
            open_skill: None,
            swarm_name: String::new(),
            roster,
            detected,
            run: Some(Run {
                name: "Swarm · builderhelm".into(),
                mission: mission.into(),
                folder: "builderhelm".into(),
                worktrees: true,
                status: RunStatus::Running,
                started_ms: SEED_START_MS,
                budget_ms: BUDGET_MS,
            }),
            seats,
            tasks,
            messages,
            land,
            view: LiveView::Graph,
            tab: Tab::Roster,
            agent_view: AgentView::Full,
            target: None,
            maximized: None,
            draft: String::new(),
            now_ms: SEED_NOW_MS,
        };
        state.sync_panes();
        state
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    // routes/swarm.tsx — setup ↔ live
    Stage(Stage),
    // swarm-setup.tsx
    Step(Step),
    Cancel,
    Job(text_editor::Action),
    Folder(String),
    Browse,
    Preset(PresetId),
    Mode(LaunchMode),
    ToggleWorktrees,
    ToggleSkill(&'static str),
    SkillDirective(&'static str, String),
    OpenSkill(Option<&'static str>),
    Name(String),
    SeatAgent(usize, AgentId),
    SeatModel(usize, ModelChoice),
    CycleSeatAgent(usize),
    FillAll(AgentId),
    AddSeat(Role),
    RemoveSeat(usize),
    ToggleAuto(usize),
    Launch,
    Launched,
    // swarm-live.tsx
    View(LiveView),
    Tab(Tab),
    AgentSubView(AgentView),
    Target(TargetChoice),
    Draft(String),
    Send,
    BudgetTick,
    StopAll,
    StopSeat(String),
    AddLiveSeat(Role),
    Land(String, LandAction),
    Pane(String, PaneMessage),
}

impl State {
    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Stage(stage) => self.stage = stage,
            Message::Step(step) => self.step = step,
            Message::Cancel => match self.step {
                Step::Roster => self.step = Step::Mission,
                Step::Launch => self.step = Step::Roster,
                // The TSX navigates home; this route can only hand the surface
                // back to the run it is covering.
                Step::Mission => {
                    if self.run.is_some() {
                        self.stage = Stage::Live;
                    }
                }
            },
            Message::Job(action) => self.job.perform(action),
            Message::Folder(value) => self.folder_path = value,
            Message::Browse => {
                self.error = None;
                if self.folder_path.trim().is_empty() {
                    self.folder_path = self.home_dir.clone();
                }
            }
            Message::Preset(id) => {
                self.preset = id;
                self.roster = assign_panes(&self.detected, &preset_roles(id));
            }
            Message::Mode(mode) => self.mode = mode,
            Message::ToggleWorktrees => self.worktrees = !self.worktrees,
            Message::ToggleSkill(id) => match self.skill_ids.iter().position(|item| *item == id) {
                Some(index) => {
                    self.skill_ids.remove(index);
                }
                None => self.skill_ids.push(id),
            },
            Message::SkillDirective(id, value) => {
                self.skill_directives.insert(id, value);
            }
            Message::OpenSkill(id) => self.open_skill = id,
            Message::Name(value) => self.swarm_name = value,
            Message::SeatAgent(index, agent) => {
                if let Some(seat) = self.roster.get_mut(index) {
                    seat.agent = agent;
                    // Changing the CLI drops the model it was pinned to.
                    seat.model = None;
                }
            }
            Message::SeatModel(index, ModelChoice(model)) => {
                if let Some(seat) = self.roster.get_mut(index) {
                    seat.model = model.filter(|value| !value.is_empty());
                }
            }
            Message::CycleSeatAgent(index) => {
                if self.detected.is_empty() {
                    return Task::none();
                }
                if let Some(seat) = self.roster.get_mut(index) {
                    let at = self
                        .detected
                        .iter()
                        .position(|item| *item == seat.agent)
                        .map_or(0, |at| (at + 1) % self.detected.len());
                    seat.agent = self.detected[at];
                    seat.model = None;
                }
            }
            Message::FillAll(agent) => {
                for seat in &mut self.roster {
                    seat.agent = agent;
                }
            }
            Message::AddSeat(role) => {
                let fill = self
                    .roster
                    .first()
                    .map(|seat| seat.agent)
                    .or_else(|| self.detected.first().copied());
                if let (Some(agent), true) = (fill, self.roster.len() < SEAT_MAX) {
                    self.roster.push(Seat {
                        role,
                        agent,
                        auto: false,
                        model: None,
                    });
                }
            }
            Message::RemoveSeat(index) => {
                if index < self.roster.len() {
                    self.roster.remove(index);
                }
            }
            Message::ToggleAuto(index) => {
                if let Some(seat) = self.roster.get_mut(index) {
                    seat.auto = !seat.auto;
                }
            }
            Message::Launch => {
                self.error = None;
                if self.roster.is_empty() {
                    self.error = Some(
                        "Install an agent CLI (Claude, Codex, Grok…) or open a Space instead."
                            .into(),
                    );
                    return Task::none();
                }
                if self.folder_path.trim().is_empty() {
                    self.error = Some("Pick a folder first.".into());
                    return Task::none();
                }
                if self.job.text().trim().is_empty() {
                    self.error = Some("Write a mission first.".into());
                    return Task::none();
                }
                self.pending = true;
                return Task::done(Message::Launched);
            }
            Message::Launched => {
                self.pending = false;
                self.launch();
            }
            Message::View(view) => self.view = view,
            Message::Tab(tab) => self.tab = tab,
            Message::AgentSubView(view) => self.agent_view = view,
            Message::Target(choice) => {
                self.target = choice.seat;
                self.sync_panes();
            }
            Message::Draft(value) => self.draft = value,
            Message::Send => {
                let text = self.draft.trim().to_owned();
                if text.is_empty() || self.stopped() {
                    return Task::none();
                }
                self.push_message(MessageKind::Directive, text);
                self.draft.clear();
            }
            Message::BudgetTick => {
                self.now_ms += 1000;
                if let Some(run) = &mut self.run {
                    if run.status == RunStatus::Running
                        && self.now_ms - run.started_ms >= run.budget_ms
                    {
                        run.status = RunStatus::Budget;
                    }
                }
            }
            Message::StopAll => {
                if let Some(run) = &mut self.run {
                    run.status = RunStatus::Stopped;
                }
            }
            Message::StopSeat(id) => {
                if let Some(seat) = self.seats.iter_mut().find(|seat| seat.id == id) {
                    seat.set_phase(SeatPhase::Exited);
                }
            }
            Message::AddLiveSeat(role) => {
                if self.stopped() || self.seats.len() >= SEAT_MAX {
                    return Task::none();
                }
                let Some(agent) = self
                    .seats
                    .first()
                    .map(|seat| seat.agent)
                    .or_else(|| self.detected.first().copied())
                else {
                    self.error = Some("Install an agent CLI first.".into());
                    return Task::none();
                };
                let id = format!("seat-{}", self.seats.len() + 1);
                self.seats
                    .push(LiveSeat::new(id, role, agent, SeatPhase::Queued));
            }
            Message::Land(task_id, action) => self.land_action(&task_id, action),
            Message::Pane(id, message) => return self.pane_message(&id, message),
        }
        Task::none()
    }

    /// `launch.mutate()` success path: the wizard hands over to the live view
    /// with a run whose plan is still empty, which is what `coordinating` means.
    fn launch(&mut self) {
        let folder = self.folder_path.trim().to_owned();
        let mission = self.job.text().trim().to_owned();
        let name = if self.swarm_name.trim().is_empty() {
            format!("Swarm · {}", folder_name(&folder))
        } else {
            self.swarm_name.trim().to_owned()
        };
        self.seats = self
            .roster
            .iter()
            .enumerate()
            .map(|(index, seat)| {
                LiveSeat::new(
                    format!("seat-{}", index + 1),
                    seat.role,
                    seat.agent,
                    SeatPhase::Booting,
                )
            })
            .collect();
        self.tasks.clear();
        self.messages.clear();
        self.land.clear();
        self.target = None;
        self.maximized = None;
        self.draft.clear();
        self.view = LiveView::Graph;
        self.tab = Tab::Roster;
        // `writeRecents(created.folderPath)` — most recent first, capped at 8.
        self.recents.retain(|item| *item != folder);
        self.recents.insert(0, folder.clone());
        self.recents.truncate(8);
        self.run = Some(Run {
            name,
            mission,
            folder: folder_name(&folder).to_owned(),
            worktrees: self.worktrees,
            status: RunStatus::Running,
            started_ms: self.now_ms,
            budget_ms: BUDGET_MS,
        });
        self.stage = Stage::Live;
    }

    /// Verify gate → reviewer → `land_exclusive`, one operator step at a time.
    fn land_action(&mut self, task_id: &str, action: LandAction) {
        let Some(index) = self.land.iter().position(|item| item.task_id == task_id) else {
            return;
        };
        match action {
            LandAction::Advance => match self.land[index].stage {
                LandStage::Verify => {
                    self.land[index].stage = LandStage::Review;
                    self.set_task_status(task_id, TaskStatus::Review);
                }
                LandStage::Review => {
                    self.land[index].stage = LandStage::Land;
                    let body = format!("review approved \"{}\"", self.land[index].title);
                    self.push_message(MessageKind::TaskEvent, body);
                }
                LandStage::Land => {
                    self.land[index].stage = LandStage::Landed;
                    self.set_task_status(task_id, TaskStatus::Landed);
                    let item = &self.land[index];
                    let body = match &item.commit {
                        Some(commit) => format!("landed \"{}\" at {commit}", item.title),
                        None => format!("landed \"{}\"", item.title),
                    };
                    self.push_message(MessageKind::TaskEvent, body);
                }
                LandStage::Landed | LandStage::Blocked => {}
            },
            LandAction::Retry => {
                let attempts = self.attempts_of(task_id);
                if self.land[index].stage != LandStage::Blocked || attempts >= MAX_ATTEMPTS {
                    return;
                }
                self.land[index].stage = LandStage::Verify;
                self.land[index].note = None;
                if let Some(task) = self.tasks.iter_mut().find(|task| task.id == task_id) {
                    task.attempts += 1;
                    task.status = TaskStatus::InProgress;
                    task.updated_ms = self.now_ms;
                }
                let body = format!("retrying \"{}\"", self.land[index].title);
                self.push_message(MessageKind::TaskEvent, body);
            }
            LandAction::Skip => {
                let item = self.land.remove(index);
                self.set_task_status(&item.task_id, TaskStatus::Skipped);
                let body = format!("stopped \"{}\" before land", item.title);
                self.push_message(MessageKind::TaskEvent, body);
            }
        }
    }

    fn pane_message(&mut self, id: &str, message: PaneMessage) -> Task<Message> {
        match message {
            PaneMessage::Focus => {
                self.target = Some(id.to_owned());
                self.sync_panes();
            }
            PaneMessage::Maximize => {
                self.maximized = if self.maximized.as_deref() == Some(id) {
                    None
                } else {
                    Some(id.to_owned())
                };
                self.sync_panes();
            }
            PaneMessage::Close => {
                if let Some(seat) = self.seats.iter_mut().find(|seat| seat.id == id) {
                    seat.set_phase(SeatPhase::Exited);
                }
            }
            PaneMessage::Copy => {
                if let Some(seat) = self.seats.iter().find(|seat| seat.id == id) {
                    if let Some(pane) = &seat.pane {
                        return iced::clipboard::write(pane.snap.lines.join("\n"));
                    }
                }
            }
            // `onLand` and `onAdd` are undefined for swarm panes, so the
            // chrome never renders these buttons.
            PaneMessage::Land | PaneMessage::Split => {}
        }
        Task::none()
    }

    fn sync_panes(&mut self) {
        let target = self.target.clone();
        let maximized = self.maximized.clone();
        for seat in &mut self.seats {
            let focused = target.as_deref() == Some(seat.id.as_str());
            let maximized = maximized.as_deref() == Some(seat.id.as_str());
            if let Some(pane) = &mut seat.pane {
                pane.chrome.focused = focused;
                pane.chrome.maximized = maximized;
            }
        }
    }

    fn push_message(&mut self, kind: MessageKind, body: String) {
        self.messages.push(LedgerMessage {
            kind,
            body,
            created_ms: self.now_ms,
        });
    }

    fn set_task_status(&mut self, task_id: &str, status: TaskStatus) {
        if let Some(task) = self.tasks.iter_mut().find(|task| task.id == task_id) {
            task.status = status;
            task.updated_ms = self.now_ms;
        }
    }

    fn attempts_of(&self, task_id: &str) -> u32 {
        self.tasks
            .iter()
            .find(|task| task.id == task_id)
            .map_or(0, |task| task.attempts)
    }

    fn stopped(&self) -> bool {
        self.run.as_ref().is_none_or(|run| run.status.stopped())
    }

    /// `status === 'running' && tasks.length === 0` reads as `coordinating`.
    fn status(&self) -> RunStatus {
        match &self.run {
            Some(run) if run.status == RunStatus::Running && self.tasks.is_empty() => {
                RunStatus::Coordinating
            }
            Some(run) => run.status,
            None => RunStatus::Stopped,
        }
    }

    fn counts(&self) -> [usize; 4] {
        let mut counts = [0usize; 4];
        for seat in &self.roster {
            let at = Role::ALL
                .iter()
                .position(|role| *role == seat.role)
                .unwrap();
            counts[at] += 1;
        }
        counts
    }

    fn mission_ready(&self) -> bool {
        !self.job.text().trim().is_empty() && !self.folder_path.trim().is_empty()
    }

    fn can_launch(&self) -> bool {
        self.mission_ready() && !self.roster.is_empty() && !self.pending
    }

    /// `activeTaskFor`.
    fn active_task(&self, seat_id: &str) -> Option<&TaskRow> {
        self.tasks.iter().find(|task| {
            task.seat_id.as_deref() == Some(seat_id)
                && matches!(task.status, TaskStatus::InProgress | TaskStatus::Review)
        })
    }

    /// `planWhy` — the last ledger line explaining a failure or a retry.
    fn plan_why(&self, task: &TaskRow) -> Option<String> {
        if task.status != TaskStatus::Failed
            && !(task.status == TaskStatus::Pending && task.attempts > 1)
        {
            return None;
        }
        let failed = format!("failed \"{}\"", task.title);
        let retrying = format!("retrying \"{}\"", task.title);
        let mark = format!("\"{}\": ", task.title);
        let mut found = None;
        for message in &self.messages {
            let hit = message.body.contains(&failed)
                || message.body.contains(&retrying)
                || (message.body.contains(&task.title)
                    && (message.body.contains("verify gate") || message.body.contains("review:")));
            if !hit {
                continue;
            }
            found = Some(match message.body.rfind(&mark) {
                Some(at) => message.body[at + mark.len()..].to_owned(),
                None => message.body.clone(),
            });
        }
        found
    }

    fn spend(&self) -> f64 {
        self.seats.iter().map(|seat| seat.cost_usd).sum()
    }

    fn tokens(&self) -> u64 {
        self.seats.iter().map(|seat| seat.tokens_used).sum()
    }

    fn landed(&self) -> usize {
        self.tasks
            .iter()
            .filter(|task| task.status == TaskStatus::Landed)
            .count()
    }

    fn failed_tasks(&self) -> usize {
        self.tasks
            .iter()
            .filter(|task| task.status == TaskStatus::Failed)
            .count()
    }

    fn builder_count(&self) -> usize {
        self.seats
            .iter()
            .filter(|seat| seat.role == Role::Builder)
            .count()
    }

    fn remain_label(&self) -> String {
        if self.status() == RunStatus::Coordinating {
            return "splitting the mission…".into();
        }
        let Some(run) = &self.run else {
            return "0:00 left".into();
        };
        format!(
            "{} left",
            format_remain(run.budget_ms - (self.now_ms - run.started_ms))
        )
    }

    pub fn view(&self) -> Element<'_, Message> {
        match self.stage {
            Stage::Setup => self.setup_view(),
            Stage::Live => self.live_view(),
        }
    }

    // -----------------------------------------------------------------------
    // swarm-setup.tsx
    // -----------------------------------------------------------------------

    fn setup_view(&self) -> Element<'_, Message> {
        let mut items: Vec<Element<'_, Message>> = vec![stepper(self.step)];
        items.push(match self.step {
            Step::Mission => self.mission_step(),
            Step::Roster => self.roster_step(),
            Step::Launch => self.review_step(),
        });
        if let Some(error) = &self.error {
            items.push(error_banner(error.as_str()));
        }
        items.push(self.wizard_footer());
        page(column(items).spacing(20).max_width(960))
    }

    fn wizard_footer(&self) -> Element<'_, Message> {
        let back = match self.step {
            // Leaving the wizard is only meaningful when a run is waiting.
            Step::Mission => secondary_button("Cancel", self.run.as_ref().map(|_| Message::Cancel)),
            _ => secondary_button("Back", Some(Message::Cancel)),
        };
        let action = match self.step {
            Step::Launch => primary_button(
                if self.pending {
                    "Starting…"
                } else {
                    "Launch swarm"
                },
                self.can_launch().then_some(Message::Launch),
            ),
            Step::Mission => primary_button(
                "Next: Build roster",
                self.mission_ready().then_some(Message::Step(Step::Roster)),
            ),
            Step::Roster => {
                primary_button("Next: Review launch", Some(Message::Step(Step::Launch)))
            }
        };
        row![back, Space::new().width(Fill), action]
            .spacing(12)
            .align_y(iced::Alignment::Center)
            .into()
    }

    fn mission_step(&self) -> Element<'_, Message> {
        let mut items: Vec<Element<'_, Message>> = vec![
            h1("Define the mission"),
            lede("Pick a folder and write the brief every seat will share."),
            wizard_label("Working folder", "Where the swarm starts"),
            row![
                text_input(
                    if self.home_dir.is_empty() {
                        "Browse to any project folder"
                    } else {
                        self.home_dir.as_str()
                    },
                    &self.folder_path,
                )
                .on_input(Message::Folder)
                .padding(10)
                .size(BODY)
                .width(Fill),
                secondary_button("Browse…", Some(Message::Browse)),
            ]
            .spacing(10)
            .align_y(iced::Alignment::Center)
            .into(),
        ];
        if !self.recents.is_empty() {
            items.push(wizard_label("Recent", "Last used swarm folders"));
            items.push(
                column(
                    self.recents
                        .iter()
                        .map(|path| {
                            panel_button(
                                column![
                                    text(folder_name(path).to_owned()).size(BODY).color(TEXT),
                                    text(path.clone()).size(TINY).color(TEXT_3),
                                ]
                                .spacing(2)
                                .into(),
                                *path == self.folder_path,
                                Some(Message::Folder(path.clone())),
                            )
                        })
                        .collect::<Vec<_>>(),
                )
                .spacing(8)
                .into(),
            );
        }
        items.push(wizard_label("Mission brief", "Shared with every seat"));
        items.push(
            text_editor(&self.job)
                .placeholder("What should this swarm accomplish?")
                .on_action(Message::Job)
                .height(150.0)
                .padding(12)
                .size(BODY)
                .into(),
        );
        items.push(dim(
            "If the folder is not a git repo, BuilderHelm initializes one so seats can isolate.",
        ));
        column(items).spacing(12).into()
    }

    fn roster_step(&self) -> Element<'_, Message> {
        let [coordinators, builders, scouts, reviewers] = self.counts();
        let full = self.roster.len() >= SEAT_MAX;
        let first = self.detected.first().copied();

        let tiles = row(PRESETS
            .iter()
            .map(|preset| {
                panel_button(
                    column![
                        court_preview(usize::from(preset.size) - 1),
                        text(preset.size.to_string()).size(BODY).color(TEXT),
                        text(preset.label).size(TINY).color(TEXT_3),
                    ]
                    .spacing(6)
                    .align_x(iced::Alignment::Center)
                    .into(),
                    preset.id == self.preset,
                    Some(Message::Preset(preset.id)),
                )
            })
            .collect::<Vec<_>>())
        .spacing(10);

        let modes = row(LaunchMode::ALL
            .iter()
            .map(|mode| {
                panel_button(
                    column![
                        text(mode.title()).size(BODY).color(TEXT),
                        text(mode.detail()).size(TINY).color(TEXT_3),
                    ]
                    .spacing(4)
                    .into(),
                    *mode == self.mode,
                    Some(Message::Mode(*mode)),
                )
            })
            .collect::<Vec<_>>())
        .spacing(10);

        let mut role_chips: Vec<Element<'_, Message>> = Role::ALL
            .iter()
            .enumerate()
            .map(|(at, role)| {
                let count = self.counts()[at];
                tag(
                    format!("+ {count} {}{}", role.as_str(), plural(count)),
                    false,
                    (!full).then_some(Message::AddSeat(*role)),
                )
            })
            .collect();
        if first.is_some() {
            role_chips.push(dim("Fill all"));
            role_chips.push(
                pick_list(self.detected.clone(), None::<AgentId>, Message::FillAll)
                    .placeholder("Choose CLI")
                    .text_size(BODY)
                    .into(),
            );
        }

        let seats = column(
            self.roster
                .iter()
                .enumerate()
                .map(|(index, seat)| self.seat_row(index, seat))
                .collect::<Vec<_>>(),
        )
        .spacing(8);

        let skills = column(
            SKILL_GROUPS
                .iter()
                .map(|group| self.skill_group(group))
                .collect::<Vec<_>>(),
        )
        .spacing(14);

        column![
            h1("Build your roster"),
            lede("Pick a helm size, then assign a CLI to each seat."),
            wizard_label("Helm size", "One queen, the rest workers"),
            tiles,
            dim(format!(
                "{coordinators} queen · {builders} builder{} · {scouts} scout{} · {reviewers} reviewer{} · up to {} tasks · {}",
                plural(builders),
                plural(scouts),
                plural(reviewers),
                plan_budget(self.preset),
                cost_band(self.roster.len()),
            )),
            wizard_label("Launch mode", "How much the seats may do"),
            modes,
            wizard_label("Isolation", "Where builders write"),
            row![
                chip(
                    "Worktree per builder",
                    self.worktrees,
                    (!self.worktrees).then_some(Message::ToggleWorktrees)
                ),
                chip(
                    "Shared folder",
                    !self.worktrees,
                    self.worktrees.then_some(Message::ToggleWorktrees)
                ),
            ]
            .spacing(8),
            wizard_label_owned(
                "Seats".into(),
                format!("{} of {SEAT_MAX}", self.roster.len())
            ),
            row(role_chips).spacing(8).align_y(iced::Alignment::Center),
            seats,
            secondary_button(
                "+ Add agent",
                (!full && first.is_some()).then_some(Message::AddSeat(Role::Builder))
            ),
            wizard_label("Skills", "Switch on, eye to preview, remove to drop"),
            skills,
        ]
        .spacing(12)
        .into()
    }

    fn seat_row<'a>(&'a self, index: usize, seat: &'a Seat) -> Element<'a, Message> {
        let models = seat.agent.models();
        let mut items: Vec<Element<'a, Message>> = vec![
            agent_mark(seat.agent, true, Some(Message::CycleSeatAgent(index))),
            container(text(seat.role.seat_label()).size(SMALL).color(TEXT))
                .width(90)
                .into(),
            pick_list(self.detected.clone(), Some(seat.agent), move |agent| {
                Message::SeatAgent(index, agent)
            })
            .text_size(BODY)
            .width(150)
            .into(),
        ];
        if !models.is_empty() {
            let choices: Vec<ModelChoice> = std::iter::once(ModelChoice(None))
                .chain(
                    models
                        .iter()
                        .map(|model| ModelChoice(Some((*model).into()))),
                )
                .collect();
            items.push(
                pick_list(
                    choices,
                    Some(ModelChoice(seat.model.clone())),
                    move |choice| Message::SeatModel(index, choice),
                )
                .text_size(BODY)
                .width(150)
                .into(),
            );
        }
        items.push(Space::new().width(Fill).into());
        items.push(chip("Auto", seat.auto, Some(Message::ToggleAuto(index))));
        items.push(text_button("×", Some(Message::RemoveSeat(index))));
        card(row(items).spacing(10).align_y(iced::Alignment::Center))
    }

    fn skill_group<'a>(&'a self, group: &'a str) -> Element<'a, Message> {
        let cards = column(
            SKILLS
                .iter()
                .filter(|skill| skill.group == group)
                .map(|skill| self.skill_card(skill))
                .collect::<Vec<_>>(),
        )
        .spacing(8);
        column![dim(group), cards].spacing(6).into()
    }

    fn skill_card<'a>(&'a self, skill: &'a Skill) -> Element<'a, Message> {
        let on = self.skill_ids.contains(&skill.id);
        let open = self.open_skill == Some(skill.id);
        let mut items: Vec<Element<'a, Message>> = vec![row![
            panel_button(
                column![
                    text(skill.title).size(BODY).color(TEXT),
                    text(skill.detail).size(TINY).color(TEXT_3),
                ]
                .spacing(2)
                .into(),
                on,
                Some(Message::ToggleSkill(skill.id)),
            ),
            text_button(
                if open { "Hide" } else { "Eye" },
                Some(Message::OpenSkill(if open { None } else { Some(skill.id) })),
            ),
        ]
        .spacing(8)
        .align_y(iced::Alignment::Center)
        .into()];
        if open {
            let value = self
                .skill_directives
                .get(skill.id)
                .map_or(skill.directive, String::as_str);
            items.push(dim("Agent directive"));
            items.push(
                text_input("Agent directive", value)
                    .on_input(move |value| Message::SkillDirective(skill.id, value))
                    .padding(10)
                    .size(BODY)
                    .into(),
            );
        }
        if on {
            items.push(text_button(
                "Remove skill",
                Some(Message::ToggleSkill(skill.id)),
            ));
        }
        column(items).spacing(8).into()
    }

    fn review_step(&self) -> Element<'_, Message> {
        let [coordinators, builders, scouts, reviewers] = self.counts();
        let autos = self.roster.iter().filter(|seat| seat.auto).count();
        let skills: Vec<&str> = SKILLS
            .iter()
            .filter(|skill| self.skill_ids.contains(&skill.id))
            .map(|skill| skill.title)
            .collect();
        let job = self.job.text();
        let mission = job.trim();
        column![
            h1("Review and launch"),
            lede("Name the run, then start the swarm."),
            wizard_label("Swarm name", "Auto-named if left blank"),
            text_input("Swarm 1", &self.swarm_name)
                .on_input(Message::Name)
                .padding(10)
                .size(BODY),
            wizard_label("Recap", ""),
            column![
                recap_row(
                    "Mission",
                    if mission.is_empty() {
                        "—".to_owned()
                    } else {
                        mission.to_owned()
                    }
                ),
                recap_row(
                    "Folder",
                    if self.folder_path.is_empty() {
                        "—".to_owned()
                    } else {
                        self.folder_path.clone()
                    }
                ),
                recap_row(
                    "Roster",
                    format!(
                        "{} agents — {coordinators} queen · {builders} builders · {scouts} scout · {reviewers} reviewer{}",
                        self.roster.len(),
                        if autos > 0 {
                            format!(" · {autos} auto")
                        } else {
                            String::new()
                        }
                    )
                ),
                recap_row("Mode", self.mode.recap().to_owned()),
                recap_row(
                    "Isolation",
                    if self.worktrees {
                        "Worktree per builder".to_owned()
                    } else {
                        "Shared folder".to_owned()
                    }
                ),
                recap_row(
                    "Skills",
                    if skills.is_empty() {
                        "None".to_owned()
                    } else {
                        skills.join(", ")
                    }
                ),
                recap_row(
                    "Billing",
                    "Seats use the logged-in Claude / Grok / Codex subscription. Chat API keys (Anthropic, xAI, OpenRouter) stay in Settings → Providers.".to_owned()
                ),
            ]
            .spacing(10),
        ]
        .spacing(12)
        .into()
    }

    // -----------------------------------------------------------------------
    // swarm-live.tsx
    // -----------------------------------------------------------------------

    fn live_view(&self) -> Element<'_, Message> {
        let Some(run) = &self.run else {
            return page(empty_state(
                "No swarm is running. Start one from the wizard.",
            ));
        };
        let status = self.status();
        let stopped = self.stopped();
        let tasks = self.tasks.len();
        let landed = self.landed();
        let failed = self.failed_tasks();

        let mut head_line = format!(
            "{} · {} · {} · {}",
            run.folder,
            if run.worktrees {
                "worktrees"
            } else {
                "shared folder"
            },
            status.as_str(),
            self.remain_label(),
        );
        if tasks > 0 {
            head_line.push_str(&format!(" · {landed}/{tasks} landed"));
        }
        if failed > 0 {
            head_line.push_str(&format!(" · {failed} failed"));
        }
        head_line.push_str(&format!(
            " · {} tok · {}",
            self.tokens(),
            money(self.spend())
        ));

        let header = row![
            column![
                eyebrow("BuilderHelm Swarm"),
                h1(run.name.clone()),
                dim(head_line),
            ]
            .spacing(6),
            Space::new().width(Fill),
            row![
                secondary_button("Graph", Some(Message::View(LiveView::Graph))),
                secondary_button("Terminals", Some(Message::View(LiveView::Terminals))),
                text_button("New swarm", Some(Message::Stage(Stage::Setup))),
                stop_button("Stop swarm", (!stopped).then_some(Message::StopAll)),
            ]
            .spacing(8)
            .align_y(iced::Alignment::Center),
        ]
        .spacing(16)
        .align_y(iced::Alignment::Center);

        let mut items: Vec<Element<'_, Message>> = vec![
            header.into(),
            body(run.mission.trim().to_owned()),
            pill(match self.view {
                LiveView::Graph => "graph view",
                LiveView::Terminals => "terminal view",
            }),
        ];

        if self
            .messages
            .iter()
            .any(|message| message.body == SINGLE_TASK_NOTE)
        {
            items.push(error_banner(SINGLE_TASK_NOTE));
        }
        if let Some(note) = self.planner_note() {
            items.push(error_banner(note));
        }
        if status == RunStatus::Coordinating {
            items.push(card(column![
                coordinating_bar(),
                body(
                    "The coordinator is reading the repository and splitting the mission into tasks. Seats warm up in parallel — the swarm starts the moment the plan lands."
                ),
            ]
            .spacing(10)));
        }
        if matches!(
            status,
            RunStatus::Done | RunStatus::Failed | RunStatus::Stopped | RunStatus::Budget
        ) {
            let mut line = format!("{landed} landed");
            if failed > 0 {
                line.push_str(&format!(" · {failed} failed"));
            }
            if tasks > 0 {
                line.push_str(&format!(" of {tasks}"));
            }
            if self.tokens() > 0 {
                line.push_str(&format!(
                    " · {} tok · {}",
                    self.tokens(),
                    money(self.spend())
                ));
            }
            let mut summary: Vec<Element<'_, Message>> =
                vec![h3(status.summary_title()), body(line)];
            if let Some(note) = self.planner_note() {
                summary.push(body(note));
            }
            items.push(card(column(summary).spacing(6)));
        }
        if !stopped && self.seats.len() < SEAT_MAX {
            items.push(
                row(Role::ALL
                    .iter()
                    .map(|role| {
                        tag(
                            format!("+ {}", role.as_str()),
                            false,
                            Some(Message::AddLiveSeat(*role)),
                        )
                    })
                    .collect::<Vec<_>>())
                .spacing(8)
                .into(),
            );
        }

        items.push(
            row![
                container(match self.view {
                    LiveView::Graph => self.graph(),
                    LiveView::Terminals => self.terminals(),
                })
                .width(Fill),
                self.inspector(),
            ]
            .spacing(16)
            .into(),
        );
        items.push(self.direct_footer());
        page(column(items).spacing(16))
    }

    /// The last `Planner failed:` / `Swarm failed:` line in the ledger.
    fn planner_note(&self) -> Option<&str> {
        self.messages
            .iter()
            .rev()
            .find(|message| {
                message.body.starts_with("Planner failed:")
                    || message.body.starts_with("Swarm failed:")
            })
            .map(|message| message.body.as_str())
    }

    /// `.swarmGraph` — the hub and its seats laid out as widgets, with the
    /// elbow edges of `elbowToBox` drawn as rules between the bands.
    fn graph(&self) -> Element<'_, Message> {
        if self.seats.is_empty() {
            return empty_state("No seats yet.");
        }
        let coordinating = self.status() == RunStatus::Coordinating;
        let hub = self
            .seats
            .iter()
            .position(|seat| seat.role == Role::Coordinator)
            .unwrap_or(0);
        let live = |seat: &LiveSeat| {
            coordinating || matches!(seat.phase, SeatPhase::Working | SeatPhase::Booting)
        };

        let builders: Vec<usize> = self
            .seats
            .iter()
            .enumerate()
            .filter(|(index, seat)| seat.role == Role::Builder && *index != hub)
            .map(|(index, _)| index)
            .collect();
        let scouts: Vec<usize> = self
            .seats
            .iter()
            .enumerate()
            .filter(|(index, seat)| seat.role == Role::Scout && *index != hub)
            .map(|(index, _)| index)
            .collect();
        let reviewers: Vec<usize> = self
            .seats
            .iter()
            .enumerate()
            .filter(|(index, seat)| seat.role == Role::Reviewer && *index != hub)
            .map(|(index, _)| index)
            .collect();
        let extra_queens: Vec<usize> = self
            .seats
            .iter()
            .enumerate()
            .filter(|(index, seat)| seat.role == Role::Coordinator && *index != hub)
            .map(|(index, _)| index)
            .collect();

        let mut bands: Vec<Element<'_, Message>> = Vec::new();
        if !builders.is_empty() {
            bands.push(
                row(builders
                    .iter()
                    .map(|index| {
                        let seat = &self.seats[*index];
                        column![self.node(seat, false), edge_v(live(seat))]
                            .spacing(0)
                            .align_x(iced::Alignment::Center)
                            .into()
                    })
                    .collect::<Vec<_>>())
                .spacing(12)
                .into(),
            );
            bands.push(edge_h(
                builders.iter().any(|index| live(&self.seats[*index])),
            ));
            bands.push(edge_v(coordinating));
        }

        let mut middle: Vec<Element<'_, Message>> = Vec::new();
        if !scouts.is_empty() {
            middle.push(
                column(
                    scouts
                        .iter()
                        .map(|index| {
                            let seat = &self.seats[*index];
                            row![self.node(seat, false), edge_h(live(seat))]
                                .align_y(iced::Alignment::Center)
                                .into()
                        })
                        .collect::<Vec<_>>(),
                )
                .spacing(10)
                .into(),
            );
        }
        middle.push(self.node(&self.seats[hub], true));
        if !reviewers.is_empty() {
            middle.push(
                column(
                    reviewers
                        .iter()
                        .map(|index| {
                            let seat = &self.seats[*index];
                            row![edge_h(live(seat)), self.node(seat, false)]
                                .align_y(iced::Alignment::Center)
                                .into()
                        })
                        .collect::<Vec<_>>(),
                )
                .spacing(10)
                .into(),
            );
        }
        bands.push(
            row(middle)
                .spacing(12)
                .align_y(iced::Alignment::Center)
                .into(),
        );

        if !extra_queens.is_empty() {
            bands.push(edge_v(coordinating));
            bands.push(
                row(extra_queens
                    .iter()
                    .map(|index| self.node(&self.seats[*index], false))
                    .collect::<Vec<_>>())
                .spacing(12)
                .into(),
            );
        }

        container(
            column(bands)
                .spacing(0)
                .align_x(iced::Alignment::Center)
                .width(Fill),
        )
        .padding(20)
        .width(Fill)
        .style(|_| container::Style {
            background: Some(BG_1.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(RADIUS_L),
            },
            ..container::Style::default()
        })
        .into()
    }

    /// `.swarmNode` — 148px card, dimmed by phase, accent-lined when selected.
    fn node<'a>(&'a self, seat: &'a LiveSeat, queen: bool) -> Element<'a, Message> {
        let selected = self.target.as_deref() == Some(seat.id.as_str());
        let alpha = seat.phase.opacity();
        let mut items: Vec<Element<'a, Message>> = vec![
            agent_mark(
                seat.agent,
                selected || seat.phase == SeatPhase::Working,
                None,
            ),
            text(seat.role.seat_label())
                .size(SMALL)
                .color(TEXT.scale_alpha(alpha))
                .into(),
            text(seat.agent.id())
                .size(TINY)
                .color(TEXT_3.scale_alpha(alpha))
                .into(),
            text(seat.phase.as_str())
                .size(TINY)
                .color(TEXT_3.scale_alpha(alpha))
                .into(),
        ];
        if let Some(task) = self.active_task(&seat.id) {
            let elapsed = elapsed_label(task.updated_ms, self.now_ms);
            items.push(
                text(format!("{} · {elapsed}", task.title))
                    .size(TINY)
                    .color(ACCENT)
                    .into(),
            );
        }
        if !seat.preview.is_empty() {
            let tail: String = seat
                .preview
                .chars()
                .rev()
                .take(160)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            items.push(text(tail.trim().to_owned()).size(TINY).color(TEXT_3).into());
        }
        button(column(items).spacing(4).align_x(iced::Alignment::Center))
            .width(NODE_W)
            .padding(12)
            .on_press(Message::Target(TargetChoice {
                seat: Some(seat.id.clone()),
                label: seat.id.clone(),
            }))
            .style(move |_, status| {
                let hover = matches!(status, button::Status::Hovered);
                button::Style {
                    background: Some(if queen { PANEL } else { GLASS }.into()),
                    text_color: TEXT,
                    border: Border {
                        color: if selected || hover { ACCENT_LINE } else { LINE },
                        width: 1.0,
                        radius: Radius::new(if queen { 16.0 } else { RADIUS_M }),
                    },
                    shadow: Shadow::default(),
                    snap: true,
                }
            })
            .into()
    }

    /// The `children` the route hands `SwarmLive`: the seat pane grid.
    fn terminals(&self) -> Element<'_, Message> {
        if self.seats.is_empty() {
            return empty_state("No seats yet.");
        }
        let visible: Vec<&LiveSeat> = match &self.maximized {
            Some(id) => self.seats.iter().filter(|seat| seat.id == *id).collect(),
            None => self.seats.iter().collect(),
        };
        let cols = grid_cols(visible.len());
        let mut rows: Vec<Element<'_, Message>> = Vec::new();
        for chunk in visible.chunks(cols) {
            rows.push(
                row(chunk
                    .iter()
                    .map(|seat| {
                        container(self.seat_pane(seat))
                            .width(Fill)
                            .height(260)
                            .into()
                    })
                    .collect::<Vec<_>>())
                .spacing(12)
                .into(),
            );
        }
        column(rows).spacing(12).width(Fill).into()
    }

    fn seat_pane<'a>(&'a self, seat: &'a LiveSeat) -> Element<'a, Message> {
        match &seat.pane {
            Some(pane) => {
                let id = seat.id.clone();
                terminal_pane(&pane.chrome, &pane.snap)
                    .map(move |message| Message::Pane(id.clone(), message))
            }
            // `.swarmIdlePane` — a seat with no pane yet.
            None => container(
                column![
                    text(seat.role.seat_label()).size(BODY).color(TEXT),
                    text(seat.agent.id()).size(SMALL).color(TEXT_2),
                    text(if seat.phase == SeatPhase::Exited {
                        "Stopped"
                    } else {
                        "Idle"
                    })
                    .size(TINY)
                    .color(TEXT_3),
                ]
                .spacing(4)
                .align_x(iced::Alignment::Center),
            )
            .width(Fill)
            .height(Fill)
            .center_x(Fill)
            .center_y(Fill)
            .style(|_| container::Style {
                background: Some(GLASS.into()),
                border: Border {
                    color: LINE,
                    width: 1.0,
                    radius: Radius::new(RADIUS_M),
                },
                ..container::Style::default()
            })
            .into(),
        }
    }

    /// `.swarmRosterRail` — the inspector and its five tabs.
    fn inspector(&self) -> Element<'_, Message> {
        let tabs = row(Tab::ALL
            .iter()
            .map(|tab| chip(tab.label(), *tab == self.tab, Some(Message::Tab(*tab))))
            .collect::<Vec<_>>())
        .spacing(4);
        let panel = match self.tab {
            Tab::Roster => self.roster_tab(),
            Tab::Agent => self.agent_tab(),
            Tab::Plan => self.plan_tab(),
            Tab::Chat => self.chat_tab(),
            Tab::Activity => self.activity_tab(),
        };
        container(
            column![tabs, scrollable(panel).height(520)]
                .spacing(12)
                .width(Fill),
        )
        .width(360)
        .padding(14)
        .style(|_| container::Style {
            background: Some(PANEL.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(RADIUS_M),
            },
            ..container::Style::default()
        })
        .into()
    }

    fn roster_tab(&self) -> Element<'_, Message> {
        let stopped = self.stopped();
        column(
            self.seats
                .iter()
                .map(|seat| {
                    let selected = self.target.as_deref() == Some(seat.id.as_str());
                    row![
                        agent_mark(
                            seat.agent,
                            selected || seat.phase == SeatPhase::Working,
                            Some(Message::Target(TargetChoice {
                                seat: Some(seat.id.clone()),
                                label: seat.id.clone(),
                            })),
                        ),
                        column![
                            text(seat.role.seat_label()).size(SMALL).color(TEXT),
                            text(seat.agent.id()).size(TINY).color(TEXT_3),
                        ]
                        .spacing(2),
                        Space::new().width(Fill),
                        text(seat.phase.as_str()).size(TINY).color(
                            if seat.phase == SeatPhase::Failed {
                                DANGER
                            } else {
                                TEXT_3
                            }
                        ),
                        stop_button(
                            "Stop",
                            (!stopped && seat.phase != SeatPhase::Exited)
                                .then_some(Message::StopSeat(seat.id.clone()))
                        ),
                    ]
                    .spacing(10)
                    .align_y(iced::Alignment::Center)
                    .into()
                })
                .collect::<Vec<_>>(),
        )
        .spacing(10)
        .into()
    }

    fn agent_tab(&self) -> Element<'_, Message> {
        let modes = row![
            chip(
                "Full",
                self.agent_view == AgentView::Full,
                Some(Message::AgentSubView(AgentView::Full))
            ),
            chip(
                "Seat",
                self.agent_view == AgentView::Seat,
                Some(Message::AgentSubView(AgentView::Seat))
            ),
        ]
        .spacing(6);
        let detail: Element<'_, Message> = match self.agent_view {
            AgentView::Full => {
                let mut tasks_line = format!("{} landed", self.landed());
                if self.failed_tasks() > 0 {
                    tasks_line.push_str(&format!(" · {} failed", self.failed_tasks()));
                }
                if !self.tasks.is_empty() {
                    tasks_line.push_str(&format!(" of {}", self.tasks.len()));
                }
                column![
                    kv("Status", self.status().as_str().to_owned()),
                    kv("Budget", self.remain_label()),
                    kv("Tasks", tasks_line),
                    kv("Tokens", self.tokens().to_string()),
                    kv("Cost", money(self.spend())),
                    kv(
                        "Seats",
                        format!("{} · {} builders", self.seats.len(), self.builder_count())
                    ),
                ]
                .spacing(8)
                .into()
            }
            AgentView::Seat => match self
                .target
                .as_ref()
                .and_then(|id| self.seats.iter().find(|seat| seat.id == *id))
            {
                None => body("Select a seat in the graph to inspect it."),
                Some(seat) => column![
                    kv("Role", seat.role.seat_label().to_owned()),
                    kv("CLI", seat.agent.id().to_owned()),
                    kv("Status", seat.phase.as_str().to_owned()),
                    kv(
                        "Branch",
                        seat.branch
                            .clone()
                            .unwrap_or_else(|| "not created yet".to_owned())
                    ),
                    kv("Tokens", seat.tokens_used.to_string()),
                    kv("Cost", money(seat.cost_usd)),
                    kv(
                        "Task",
                        self.active_task(&seat.id).map_or_else(
                            || {
                                if seat.phase == SeatPhase::Idle {
                                    "Idle".to_owned()
                                } else {
                                    seat.phase.as_str().to_owned()
                                }
                            },
                            |task| task.title.clone()
                        )
                    ),
                ]
                .spacing(8)
                .into(),
            },
        };
        column![modes, detail].spacing(12).into()
    }

    fn plan_tab(&self) -> Element<'_, Message> {
        let mut items: Vec<Element<'_, Message>> = Vec::new();
        if self.tasks.is_empty() {
            items.push(body("No tasks planned yet."));
        }
        let builders = self.builder_count();
        if !self.tasks.is_empty() && self.tasks.len() < builders {
            items.push(card(
                column![
                    text(format!(
                        "{} task{} for {builders} builders",
                        self.tasks.len(),
                        plural(self.tasks.len())
                    ))
                    .size(SMALL)
                    .color(TEXT),
                    body(
                        "This mission does not split further, so the spare seats stay idle instead of duplicating work."
                    ),
                ]
                .spacing(4),
            ));
        }
        for task in &self.tasks {
            let mut line = task.status.as_str().to_owned();
            if !task.depends_on.is_empty() {
                line.push_str(&format!(" · waits on {}", task.depends_on.len()));
            }
            if task.attempts > 1 {
                line.push_str(&format!(" · attempt {}", task.attempts));
            }
            let mut rows: Vec<Element<'_, Message>> = vec![
                text(task.title.clone()).size(SMALL).color(TEXT).into(),
                text(line)
                    .size(TINY)
                    .color(if task.status == TaskStatus::Failed {
                        DANGER
                    } else {
                        TEXT_3
                    })
                    .into(),
            ];
            if !task.files.is_empty() {
                rows.push(dim(task.files.join(", ")));
            }
            if let Some(why) = self.plan_why(task) {
                rows.push(text(why).size(TINY).color(WARNING).into());
            }
            items.push(card(column(rows).spacing(4)));
        }
        items.push(section_heading(
            "Land queue",
            Some(format!("{} queued", self.land.len())),
        ));
        if self.land.is_empty() {
            items.push(empty_state("Nothing is waiting to land."));
        }
        for item in &self.land {
            items.push(self.land_card(item));
        }
        column(items).spacing(10).into()
    }

    fn land_card<'a>(&'a self, item: &'a LandItem) -> Element<'a, Message> {
        let attempts = self.attempts_of(&item.task_id);
        let mut rows: Vec<Element<'a, Message>> = vec![
            text(item.title.clone()).size(SMALL).color(TEXT).into(),
            dim(item.branch.clone()),
            stage_track(item.stage),
        ];
        if let Some(note) = &item.note {
            rows.push(text(note.clone()).size(TINY).color(DANGER).into());
        }
        if let Some(commit) = &item.commit {
            rows.push(dim(format!("landed at {commit}")));
        }
        let advance = matches!(
            item.stage,
            LandStage::Verify | LandStage::Review | LandStage::Land
        )
        .then(|| Message::Land(item.task_id.clone(), LandAction::Advance));
        let retry = (item.stage == LandStage::Blocked && attempts < MAX_ATTEMPTS)
            .then(|| Message::Land(item.task_id.clone(), LandAction::Retry));
        let skip = (item.stage != LandStage::Landed)
            .then(|| Message::Land(item.task_id.clone(), LandAction::Skip));
        rows.push(
            row![
                primary_button(item.stage.advance_label(), advance),
                secondary_button("Retry", retry),
                text_button("Skip", skip),
            ]
            .spacing(8)
            .align_y(iced::Alignment::Center)
            .into(),
        );
        card(column(rows).spacing(6))
    }

    fn chat_tab(&self) -> Element<'_, Message> {
        let rows: Vec<Element<'_, Message>> = self
            .messages
            .iter()
            .filter(|message| message.kind.is_chat())
            .map(|message| {
                card(
                    column![
                        text(message.kind.as_str()).size(TINY).color(ACCENT),
                        body(message.body.clone()),
                    ]
                    .spacing(4),
                )
            })
            .collect();
        if rows.is_empty() {
            return empty_state("No directives or reports yet.");
        }
        column(rows).spacing(8).into()
    }

    fn activity_tab(&self) -> Element<'_, Message> {
        let rows: Vec<Element<'_, Message>> = self
            .messages
            .iter()
            .rev()
            .map(|message| {
                card(
                    column![
                        dim(clock_of(message.created_ms)),
                        body(message.body.clone()),
                    ]
                    .spacing(4),
                )
            })
            .collect();
        if rows.is_empty() {
            return empty_state("The ledger is empty.");
        }
        column(rows).spacing(8).into()
    }

    /// `.swarmDirect` — pick a target, type, send.
    fn direct_footer(&self) -> Element<'_, Message> {
        let roles: Vec<Role> = self.seats.iter().map(|seat| seat.role).collect();
        let mut options = vec![TargetChoice {
            seat: None,
            label: "@all".into(),
        }];
        for (index, seat) in self.seats.iter().enumerate() {
            options.push(TargetChoice {
                seat: Some(seat.id.clone()),
                label: format!("@{}", seat_label(&roles, index)),
            });
        }
        let selected = options
            .iter()
            .find(|choice| choice.seat == self.target)
            .cloned();
        row![
            pick_list(options, selected, Message::Target)
                .text_size(BODY)
                .width(180),
            text_input("Direct the swarm…", &self.draft)
                .on_input(Message::Draft)
                .on_submit(Message::Send)
                .padding(10)
                .size(BODY)
                .width(Fill),
            primary_button(
                "Send",
                (!self.draft.trim().is_empty() && !self.stopped()).then_some(Message::Send)
            ),
        ]
        .spacing(10)
        .align_y(iced::Alignment::Center)
        .into()
    }
}

// ---------------------------------------------------------------------------
// Local primitives the shared vocabulary does not cover
// ---------------------------------------------------------------------------

/// `SpaceStepper` — the wizard's 1/2/3 progress rail, display only.
fn stepper<'a>(step: Step) -> Element<'a, Message> {
    row(Step::ALL
        .iter()
        .enumerate()
        .map(|(index, item)| {
            let active = *item == step;
            container(
                text(format!("{} {}", index + 1, item.label()))
                    .size(SMALL)
                    .color(if active { ACCENT_BRIGHT } else { TEXT_3 }),
            )
            .padding(Padding {
                top: 6.0,
                right: 14.0,
                bottom: 6.0,
                left: 14.0,
            })
            .style(move |_| container::Style {
                background: Some(if active { ACCENT_DIM } else { GLASS }.into()),
                border: Border {
                    color: if active { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: Radius::new(999.0),
                },
                ..container::Style::default()
            })
            .into()
        })
        .collect::<Vec<_>>())
    .spacing(8)
    .into()
}

/// `.wizardLabel` — title with a quiet hint beside it.
fn wizard_label<'a>(title: &'a str, hint: &'a str) -> Element<'a, Message> {
    let mut items: Vec<Element<'a, Message>> = vec![text(title).size(SMALL).color(TEXT).into()];
    if !hint.is_empty() {
        items.push(dim(hint));
    }
    row(items)
        .spacing(8)
        .align_y(iced::Alignment::Center)
        .into()
}

fn wizard_label_owned<'a>(title: String, hint: String) -> Element<'a, Message> {
    row![
        text(title).size(SMALL).color(TEXT),
        text(hint).size(SMALL).color(TEXT_3),
    ]
    .spacing(8)
    .align_y(iced::Alignment::Center)
    .into()
}

/// `.swarmRecap li` — label above value.
fn recap_row<'a>(label: &'a str, value: String) -> Element<'a, Message> {
    card(
        column![
            text(label.to_uppercase()).size(TINY).color(TEXT_3),
            text(value).size(BODY).color(TEXT),
        ]
        .spacing(4),
    )
}

/// A `<dl>` pair in the inspector.
fn kv<'a>(term: &'a str, value: String) -> Element<'a, Message> {
    column![
        text(term).size(TINY).color(TEXT_3),
        text(value).size(BODY).color(TEXT),
    ]
    .spacing(2)
    .into()
}

/// `.chip` with an owned label.
fn tag<'a>(label: String, active: bool, msg: Option<Message>) -> Element<'a, Message> {
    let enabled = msg.is_some();
    button(text(label).size(BODY))
        .padding(Padding {
            top: 6.0,
            right: 12.0,
            bottom: 6.0,
            left: 12.0,
        })
        .on_press_maybe(msg)
        .style(move |_, status| {
            let hover = enabled && matches!(status, button::Status::Hovered);
            button::Style {
                background: Some(if active { ACCENT_DIM } else { BG_1 }.into()),
                text_color: if active || hover {
                    ACCENT_BRIGHT
                } else {
                    TEXT_2
                }
                .scale_alpha(if enabled { 1.0 } else { 0.4 }),
                border: Border {
                    color: if active || hover { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: Radius::new(999.0),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// Glass card that behaves as a button: recent cards, helm tiles, mode cards.
fn panel_button<'a>(
    content: Element<'a, Message>,
    active: bool,
    msg: Option<Message>,
) -> Element<'a, Message> {
    button(content)
        .padding(12)
        .on_press_maybe(msg)
        .style(move |_, status| {
            let hover = matches!(status, button::Status::Hovered);
            button::Style {
                background: Some(if active { ACCENT_DIM } else { GLASS }.into()),
                text_color: TEXT,
                border: Border {
                    color: if active || hover {
                        ACCENT_LINE
                    } else {
                        LINE_STRONG
                    },
                    width: 1.0,
                    radius: Radius::new(RADIUS_S),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.agentMark` / `.agentDot` — the CLI initial, lit when the seat is live.
fn agent_mark<'a>(agent: AgentId, on: bool, msg: Option<Message>) -> Element<'a, Message> {
    let initial = agent
        .label()
        .chars()
        .next()
        .unwrap_or('?')
        .to_ascii_uppercase()
        .to_string();
    let mark = button(
        text(initial)
            .size(SMALL)
            .color(if on { ACCENT_BRIGHT } else { TEXT_3 }),
    )
    .width(28)
    .height(28)
    .padding(0)
    .on_press_maybe(msg)
    .style(move |_, _| button::Style {
        background: Some(if on { ACCENT_DIM } else { GLASS }.into()),
        text_color: if on { ACCENT_BRIGHT } else { TEXT_3 },
        border: Border {
            color: if on { ACCENT_LINE } else { LINE },
            width: 1.0,
            radius: Radius::new(99.0),
        },
        shadow: Shadow::default(),
        snap: true,
    });
    container(mark).center_x(28).center_y(28).into()
}

/// `.courtPreview` — one queen dot, the rest workers.
fn court_preview<'a>(workers: usize) -> Element<'a, Message> {
    let mut dots: Vec<Element<'a, Message>> = vec![dot(true)];
    for _ in 0..workers.min(11) {
        dots.push(dot(false));
    }
    row(dots).spacing(3).into()
}

fn dot<'a>(queen: bool) -> Element<'a, Message> {
    container(Space::new().width(6).height(6))
        .style(move |_| container::Style {
            background: Some(if queen { ACCENT } else { TEXT_3 }.into()),
            border: Border {
                radius: Radius::new(99.0),
                ..Border::default()
            },
            ..container::Style::default()
        })
        .into()
}

/// A graph edge running down the page. `.swarmEdgeLive` when the seat is busy.
fn edge_v<'a>(live: bool) -> Element<'a, Message> {
    container(Space::new().width(2).height(18))
        .style(move |_| container::Style {
            background: Some(if live { ACCENT } else { ACCENT_LINE }.into()),
            ..container::Style::default()
        })
        .into()
}

/// A graph edge running across the page.
fn edge_h<'a>(live: bool) -> Element<'a, Message> {
    container(Space::new().width(28).height(2))
        .style(move |_| container::Style {
            background: Some(if live { ACCENT } else { ACCENT_LINE }.into()),
            ..container::Style::default()
        })
        .into()
}

/// `.swarmCoordinatingBar`.
fn coordinating_bar<'a>() -> Element<'a, Message> {
    container(Space::new().width(Fill).height(3))
        .width(Fill)
        .style(|_| container::Style {
            background: Some(ACCENT.into()),
            border: Border {
                radius: Radius::new(99.0),
                ..Border::default()
            },
            ..container::Style::default()
        })
        .into()
}

/// verify → review → land, with the reached steps lit.
fn stage_track<'a>(stage: LandStage) -> Element<'a, Message> {
    let reached = |step: LandStage| match stage {
        LandStage::Verify => step == LandStage::Verify,
        LandStage::Review => matches!(step, LandStage::Verify | LandStage::Review),
        LandStage::Land | LandStage::Landed => true,
        LandStage::Blocked => false,
    };
    let mut items: Vec<Element<'a, Message>> = Vec::new();
    for (index, step) in [LandStage::Verify, LandStage::Review, LandStage::Land]
        .into_iter()
        .enumerate()
    {
        if index > 0 {
            items.push(text("→").size(TINY).color(TEXT_3).into());
        }
        items.push(
            text(step.as_str())
                .size(TINY)
                .color(if reached(step) { ACCENT } else { TEXT_3 })
                .into(),
        );
    }
    items.push(Space::new().width(Fill).into());
    items.push(
        text(stage.as_str())
            .size(TINY)
            .color(match stage {
                LandStage::Blocked => DANGER,
                LandStage::Landed => ACCENT_BRIGHT,
                _ => TEXT_2,
            })
            .into(),
    );
    row(items)
        .spacing(6)
        .align_y(iced::Alignment::Center)
        .into()
}

/// `gridForCount`, columns only: the pane grid the live view lays out.
fn grid_cols(count: usize) -> usize {
    let n = count.max(1);
    if n <= 3 {
        return n;
    }
    let rows = if n <= 8 { 2 } else { 3 };
    n.div_ceil(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> State {
        let mut state = State::default();
        let _ = state.update(Message::Stage(Stage::Setup));
        state
    }

    #[test]
    fn launch_needs_a_mission_a_folder_and_a_roster() {
        let mut state = setup();
        let _ = state.update(Message::Job(text_editor::Action::SelectAll));
        let _ = state.update(Message::Job(text_editor::Action::Edit(
            text_editor::Edit::Delete,
        )));
        assert!(!state.mission_ready(), "empty mission must not be ready");
        assert!(!state.can_launch());

        let _ = state.update(Message::Launch);
        assert_eq!(state.error.as_deref(), Some("Write a mission first."));
        assert_eq!(state.stage, Stage::Setup, "a blocked launch stays put");

        let _ = state.update(Message::Job(text_editor::Action::Edit(
            text_editor::Edit::Paste(std::sync::Arc::new("Port the routes".to_owned())),
        )));
        assert!(state.can_launch());
        let _ = state.update(Message::Launch);
        assert!(state.pending, "the button reads Starting… until Launched");
        let _ = state.update(Message::Launched);
        assert_eq!(state.stage, Stage::Live);
        assert_eq!(state.status(), RunStatus::Coordinating, "no plan yet");
        assert_eq!(state.seats.len(), 4);
    }

    #[test]
    fn seats_stop_at_twelve_and_removal_shrinks_the_roster() {
        let mut state = setup();
        for _ in 0..20 {
            let _ = state.update(Message::AddSeat(Role::Builder));
        }
        assert_eq!(state.roster.len(), SEAT_MAX);
        let _ = state.update(Message::RemoveSeat(0));
        assert_eq!(state.roster.len(), SEAT_MAX - 1);
        let _ = state.update(Message::RemoveSeat(999));
        assert_eq!(state.roster.len(), SEAT_MAX - 1, "out of range is ignored");

        let _ = state.update(Message::Preset(PresetId::Skiff));
        assert_eq!(state.roster.len(), 3, "a preset rebuilds the roster");
        assert_eq!(state.roster[0].role, Role::Coordinator);
    }

    #[test]
    fn every_inspector_tab_renders() {
        let mut state = State::default();
        assert_eq!(state.tab, Tab::Roster);
        for tab in Tab::ALL {
            let _ = state.update(Message::Tab(tab));
            assert_eq!(state.tab, tab);
            let _ = state.view();
        }
        let _ = state.update(Message::View(LiveView::Terminals));
        let _ = state.view();
        let _ = state.update(Message::AgentSubView(AgentView::Seat));
        let _ = state.update(Message::Tab(Tab::Agent));
        let _ = state.view();
    }

    #[test]
    fn land_queue_walks_verify_review_land() {
        let mut state = State::default();
        let id = "task-2".to_owned();
        for stage in [LandStage::Review, LandStage::Land, LandStage::Landed] {
            let _ = state.update(Message::Land(id.clone(), LandAction::Advance));
            let item = state
                .land
                .iter()
                .find(|item| item.task_id == id)
                .expect("queued");
            assert_eq!(item.stage, stage);
        }
        assert_eq!(
            state
                .tasks
                .iter()
                .find(|task| task.id == id)
                .unwrap()
                .status,
            TaskStatus::Landed
        );
        assert!(state
            .messages
            .iter()
            .any(|message| message.body == "landed \"Port the swarm route\""));

        // A blocked entry retries only while attempts are left.
        let blocked = "task-5".to_owned();
        assert_eq!(state.attempts_of(&blocked), MAX_ATTEMPTS);
        let _ = state.update(Message::Land(blocked.clone(), LandAction::Retry));
        let item = state
            .land
            .iter()
            .find(|item| item.task_id == blocked)
            .expect("still queued");
        assert_eq!(item.stage, LandStage::Blocked, "attempts are spent");

        let _ = state.update(Message::Land(blocked.clone(), LandAction::Skip));
        assert!(!state.land.iter().any(|item| item.task_id == blocked));
        assert_eq!(
            state
                .tasks
                .iter()
                .find(|task| task.id == blocked)
                .unwrap()
                .status,
            TaskStatus::Skipped
        );
    }
}
