//! Space route — `/` and `/space`.
//!
//! Source: `apps/desktop/src/renderer/src/routes/board.tsx` (`BoardPage`), with
//! `components/space-stepper.tsx`, `components/agent-mark.tsx` and the
//! `.spaceHome*` / `.spaceWizard*` / `.boardGrid*` rules of `styles.css`.
//!
//! Five surfaces, in the order the Electron flow walks them: `Home`, the three
//! wizard steps `Start` / `Layout` / `Agents` (`SPACE_STEPS`), then the live
//! `boardGrid`.

use helm_pty::{Parser, Snapshot};
use iced::border::Radius;
use iced::widget::{button, column, container, row, text, text_input, Space};
use iced::{Border, Element, Fill, Length, Padding, Shadow, Task};

use super::common::{
    dim, error_banner, h1, lede, page, primary_button, secondary_button, stage, BODY, H2, H3, SMALL,
};
use crate::shell::space_stepper;
use crate::terminal::{terminal_pane, PaneMessage, PaneStatus, TerminalPane};
use crate::tokens::{
    rgb, rgba, ACCENT, ACCENT_BRIGHT, ACCENT_DIM, ACCENT_LINE, BG_1, GLASS, GLASS_STRONG, LINE,
    LINE_STRONG, PANEL, RADIUS_M, RADIUS_S, TEXT, TEXT_2, TEXT_3,
};

/// `PANE_COUNTS` — the seven layouts the Space wizard offers. Narrower than the
/// protocol's `BOARD_PANE_COUNTS`; 3 and 5 are reachable only by splitting a
/// live grid.
pub const PANE_COUNTS: [u8; 7] = [1, 2, 4, 6, 8, 10, 12];

/// `SPACE_STEPS`.
pub const SPACE_STEPS: [(u8, &str); 3] = [(1, "Start"), (2, "Layout"), (3, "Agents")];

/// `.wizardLabel span` / `.wizardLabelRow small` ink. CSS `#8a8a8a`.
const HINT: iced::Color = rgb(0x8a8a8a);

/// Ported from `helm-protocol`'s `BoardAgentId`; `helm-ui` carries no protocol
/// dependency, so the 14 ids live here in catalog order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentId {
    Shell,
    Claude,
    Codex,
    Grok,
    Gemini,
    Antigravity,
    Opencode,
    Cursor,
    Copilot,
    Omp,
    Pi,
    Kimi,
    Kiro,
    Custom,
}

impl AgentId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shell => "shell",
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Grok => "grok",
            Self::Gemini => "gemini",
            Self::Antigravity => "antigravity",
            Self::Opencode => "opencode",
            Self::Cursor => "cursor",
            Self::Copilot => "copilot",
            Self::Omp => "omp",
            Self::Pi => "pi",
            Self::Kimi => "kimi",
            Self::Kiro => "kiro",
            Self::Custom => "custom",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentCatalogEntry {
    pub id: AgentId,
    pub label: &'static str,
    pub command: &'static str,
}

/// `BOARD_AGENT_CATALOG`.
pub const BOARD_AGENT_CATALOG: [AgentCatalogEntry; 14] = [
    AgentCatalogEntry {
        id: AgentId::Shell,
        label: "Terminal",
        command: "",
    },
    AgentCatalogEntry {
        id: AgentId::Claude,
        label: "Claude",
        command: "claude",
    },
    AgentCatalogEntry {
        id: AgentId::Codex,
        label: "Codex",
        command: "codex",
    },
    AgentCatalogEntry {
        id: AgentId::Grok,
        label: "Grok",
        command: "grok",
    },
    AgentCatalogEntry {
        id: AgentId::Gemini,
        label: "Gemini",
        command: "gemini",
    },
    AgentCatalogEntry {
        id: AgentId::Antigravity,
        label: "Antigravity",
        command: "antigravity",
    },
    AgentCatalogEntry {
        id: AgentId::Opencode,
        label: "OpenCode",
        command: "opencode",
    },
    AgentCatalogEntry {
        id: AgentId::Cursor,
        label: "Cursor",
        command: "cursor",
    },
    AgentCatalogEntry {
        id: AgentId::Copilot,
        label: "Copilot",
        command: "copilot",
    },
    AgentCatalogEntry {
        id: AgentId::Omp,
        label: "Oh My Pi",
        command: "omp",
    },
    AgentCatalogEntry {
        id: AgentId::Pi,
        label: "Pi",
        command: "pi",
    },
    AgentCatalogEntry {
        id: AgentId::Kimi,
        label: "Kimi",
        command: "kimi",
    },
    AgentCatalogEntry {
        id: AgentId::Kiro,
        label: "Kiro",
        command: "kiro-cli",
    },
    AgentCatalogEntry {
        id: AgentId::Custom,
        label: "Custom command",
        command: "",
    },
];

/// `FEATURED_AGENT_IDS`, in the declaration order of `board.tsx`.
pub const FEATURED_AGENT_IDS: [AgentId; 9] = [
    AgentId::Claude,
    AgentId::Codex,
    AgentId::Grok,
    AgentId::Kimi,
    AgentId::Kiro,
    AgentId::Antigravity,
    AgentId::Opencode,
    AgentId::Pi,
    AgentId::Omp,
];

/// `AI_AGENTS` — catalog minus `shell`. Order is catalog order, as in the TSX.
pub fn ai_agents() -> impl Iterator<Item = &'static AgentCatalogEntry> {
    BOARD_AGENT_CATALOG
        .iter()
        .filter(|entry| entry.id != AgentId::Shell)
}

fn catalog_index(id: AgentId) -> usize {
    BOARD_AGENT_CATALOG
        .iter()
        .position(|entry| entry.id == id)
        .unwrap_or(0)
}

fn is_featured(id: AgentId) -> bool {
    FEATURED_AGENT_IDS.contains(&id)
}

/// `BoardIsolation`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Isolation {
    #[default]
    Shared,
    Worktree,
}

impl Isolation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::Worktree => "worktree",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModeId {
    Space,
    Swarm,
    Board,
    Memory,
}

pub struct Mode {
    pub id: ModeId,
    pub name: &'static str,
    pub shortcut: &'static str,
    pub enabled: bool,
    pub promise: &'static str,
    /// Stand-in for `ModeGlyph`; `helm-ui` has no `svg` feature.
    pub glyph: &'static str,
}

/// `MODES`.
pub const MODES: [Mode; 4] = [
    Mode {
        id: ModeId::Space,
        name: "BuilderHelm Space",
        shortcut: "⌘T",
        enabled: true,
        promise:
            "The terminal built for vibe coding. Split panes, command blocks, and an agent in every shell.",
        glyph: "❯",
    },
    Mode {
        id: ModeId::Swarm,
        name: "BuilderHelm Swarm",
        shortcut: "⌘S",
        enabled: true,
        promise:
            "Many agents, one job. Coordinators, builders, scouts, and reviewers with budgets and guardrails.",
        glyph: "⁂",
    },
    Mode {
        id: ModeId::Board,
        name: "BuilderHelm Board",
        shortcut: "⌘B",
        enabled: true,
        promise:
            "Plan the work. Work the plan. A Kanban board built for builders — turn loose ideas into shipped tasks.",
        glyph: "▥",
    },
    Mode {
        id: ModeId::Memory,
        name: "BuilderHelm Memory",
        shortcut: "⌘M",
        enabled: true,
        promise:
            "A living knowledge graph. Persistent memory your agents read and write as they build. Context that compounds.",
        glyph: "◈",
    },
];

/// `Phase` in the TSX, split so each `SPACE_STEPS` entry owns a screen.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Stage {
    #[default]
    Home,
    Start,
    Layout,
    Agents,
    Live,
}

impl Stage {
    /// Stepper index, or `None` for the surfaces outside the wizard.
    pub fn step(self) -> Option<u8> {
        match self {
            Self::Start => Some(1),
            Self::Layout => Some(2),
            Self::Agents => Some(3),
            Self::Home | Self::Live => None,
        }
    }
}

/// `fillAgents` modes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FillMode {
    All,
    One,
    Split,
}

/// `boardGridLayouts` — the fixed cols×rows table the layout tiles draw.
pub fn board_grid_layout(count: u8) -> (u8, u8) {
    match count {
        1 => (1, 1),
        2 => (2, 1),
        3 => (3, 1),
        4 => (2, 2),
        5 => (3, 2),
        6 => (3, 2),
        8 => (4, 2),
        10 => (5, 2),
        12 => (4, 3),
        other => grid_for_count(other),
    }
}

/// `gridForCount` — cols×rows for a live grid of any size.
pub fn grid_for_count(count: u8) -> (u8, u8) {
    let n = u16::from(count.max(1));
    if n <= 3 {
        return (n as u8, 1);
    }
    let rows: u16 = if n <= 8 { 2 } else { 3 };
    (n.div_ceil(rows) as u8, rows as u8)
}

/// `PANE_COUNTS.includes(count)`.
pub fn is_pane_count(count: u8) -> bool {
    PANE_COUNTS.contains(&count)
}

/// `folderName`.
pub fn folder_name(path: &str) -> &str {
    path.split('/')
        .rfind(|part| !part.is_empty())
        .unwrap_or(path)
}

/// `looksLikeCd` — `/^cd\s+/i` or a leading `~`.
pub fn looks_like_cd(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.starts_with('~') {
        return true;
    }
    let mut chars = trimmed.chars();
    let (Some(c), Some(d)) = (chars.next(), chars.next()) else {
        return false;
    };
    c.eq_ignore_ascii_case(&'c')
        && d.eq_ignore_ascii_case(&'d')
        && chars.next().is_some_and(char::is_whitespace)
}

/// `cd.trim().replace(/^cd(?:\s+|$)/i, '')`.
fn strip_cd(value: &str) -> &str {
    let trimmed = value.trim();
    let mut chars = trimmed.char_indices();
    let (Some((_, c)), Some((_, d))) = (chars.next(), chars.next()) else {
        return trimmed;
    };
    if !(c.eq_ignore_ascii_case(&'c') && d.eq_ignore_ascii_case(&'d')) {
        return trimmed;
    }
    let rest = &trimmed[2..];
    if rest.is_empty() {
        return rest;
    }
    let stripped = rest.trim_start();
    if stripped.len() == rest.len() {
        // `cd` is a prefix of a longer word (`cdk`), not the command.
        trimmed
    } else {
        stripped
    }
}

/// `resolveFolder`.
pub fn resolve_folder(base: &str, cd: &str, home: &str) -> String {
    let spec = strip_cd(cd);
    if spec.is_empty() {
        return if base.trim().is_empty() {
            home.to_string()
        } else {
            base.trim().to_string()
        };
    }
    if spec == "~" {
        return home.to_string();
    }
    let expanded = if let Some(rest) = spec.strip_prefix("~/") {
        format!("{home}/{rest}")
    } else {
        spec.to_string()
    };
    let origin = if base.trim().is_empty() {
        home
    } else {
        base.trim()
    };
    let absolute = expanded.starts_with('/');
    let mut parts: Vec<&str> = if absolute {
        Vec::new()
    } else {
        origin.split('/').filter(|p| !p.is_empty()).collect()
    };
    let source = if absolute {
        &expanded[1..]
    } else {
        &expanded[..]
    };
    for part in source.split('/') {
        match part {
            "" | "." => continue,
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    format!("/{}", parts.join("/"))
}

/// `writeRecents` — most recent first, deduped, capped at 8.
fn push_recent(recents: &mut Vec<String>, folder_path: &str) {
    recents.retain(|item| item != folder_path);
    recents.insert(0, folder_path.to_string());
    recents.truncate(8);
}

/// One live pane: the `TerminalPane` chrome, its `helm_pty` parser, and the
/// snapshot the view borrows. `feed` keeps the two in step.
pub struct LivePane {
    pub pane: TerminalPane,
    pub parser: Parser,
    pub snap: Snapshot,
}

impl LivePane {
    pub fn new(title: impl Into<String>, branch: Option<String>, status: PaneStatus) -> Self {
        let parser = Parser::new(80, 24, 1000);
        let snap = parser.snapshot();
        Self {
            pane: TerminalPane {
                title: title.into(),
                branch: branch.clone(),
                status,
                focused: false,
                maximized: false,
                landing: false,
                confirm_land: false,
                show_land: branch.is_some(),
                show_split: true,
            },
            parser,
            snap,
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.feed(bytes);
        self.snap = self.parser.snapshot();
    }
}

pub struct State {
    pub stage: Stage,
    /// Set when Home routes to a mode this module does not own; the shell reads
    /// it to change `Route`.
    pub requested_mode: Option<ModeId>,
    pub folder_path: String,
    pub home_dir: String,
    pub cd_input: String,
    pub isolation: Isolation,
    pub pane_count: u8,
    /// `agentCounts`, indexed by `BOARD_AGENT_CATALOG` position.
    pub agent_counts: [u8; BOARD_AGENT_CATALOG.len()],
    pub custom_command: String,
    pub show_more_agents: bool,
    pub recents: Vec<String>,
    pub error: Option<String>,
    pub panes: Vec<LivePane>,
    pub maximized: Option<usize>,
}

impl Default for State {
    fn default() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
        let mut panes = vec![
            LivePane::new(
                "Claude",
                Some("space/claude".to_string()),
                PaneStatus::Running,
            ),
            LivePane::new("Codex", None, PaneStatus::Running),
            LivePane::new("Terminal", None, PaneStatus::Starting),
            LivePane::new("Grok", None, PaneStatus::Exited),
        ];
        panes[0].feed(b"\x1b[32m*\x1b[0m claude ready\r\n> plan the migration\r\n");
        panes[1].feed(b"\x1b[32m*\x1b[0m codex ready\r\n");
        panes[2].feed(b"$ \r\n");
        panes[3].feed(b"grok: session closed\r\n");
        panes[0].pane.focused = true;
        Self {
            stage: Stage::Home,
            requested_mode: None,
            folder_path: home.clone(),
            home_dir: home.clone(),
            cd_input: String::new(),
            isolation: Isolation::Shared,
            pane_count: 4,
            agent_counts: [0; BOARD_AGENT_CATALOG.len()],
            custom_command: String::new(),
            show_more_agents: false,
            recents: vec![format!("{home}/Developer"), home],
            error: None,
            panes,
            maximized: None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Message {
    /// A `.spaceMode` card.
    OpenMode(ModeId),
    /// Stage navigation — the wizard's Back and Next buttons.
    Goto(Stage),
    FolderInput(String),
    /// Enter in the working-folder field.
    FolderSubmit,
    CdInput(String),
    CdSubmit,
    /// `browse()` — asks the host for a folder dialog.
    Browse,
    /// The host's answer to `Browse`; `None` when the dialog was cancelled.
    FolderPicked(Option<String>),
    PickRecent(String),
    SetIsolation(Isolation),
    SetPaneCount(u8),
    /// `setAgentCount(id, next)` — absolute, clamped against the pane budget.
    SetAgentCount(AgentId, i32),
    /// `AgentMark` click — 0 <-> 1.
    ToggleAgent(AgentId),
    /// The `.agentAll` button — this agent in every pane, nothing else.
    SetAgentAll(AgentId),
    QuickFill(FillMode),
    ShowMoreAgents,
    CustomCommand(String),
    /// `launchSpace`. `with_agents: false` is "Open without AI" / "Skip — no
    /// agents", which launches `shellSlots`.
    Launch {
        with_agents: bool,
    },
    Pane(usize, PaneMessage),
    DismissError,
}

/// One resolved pane spec — `SlotConfig` plus its slot.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Slot {
    pub slot: usize,
    pub agent_id: AgentId,
    pub command: Option<String>,
}

impl State {
    // ---- derived state ------------------------------------------------------

    /// `folderReady`.
    pub fn folder_ready(&self) -> bool {
        !self.folder_path.trim().is_empty() || !self.cd_input.trim().is_empty()
    }

    fn count_of(&self, id: AgentId) -> u8 {
        self.agent_counts[catalog_index(id)]
    }

    /// `assignedCount(agentCounts)`.
    pub fn taken(&self) -> i32 {
        self.agent_counts.iter().map(|n| i32::from(*n)).sum()
    }

    /// `remaining`.
    pub fn remaining(&self) -> i32 {
        i32::from(self.pane_count) - self.taken()
    }

    /// `canOpen`.
    pub fn can_open(&self) -> bool {
        let custom = self.count_of(AgentId::Custom);
        self.taken() > 0 && (custom == 0 || !self.custom_command.trim().is_empty())
    }

    /// The primary action of the Agents step.
    pub fn can_launch(&self) -> bool {
        self.folder_ready() && self.can_open()
    }

    /// `.wizardError` copy for the current step, or `None` when it is satisfied.
    pub fn step_error(&self) -> Option<&'static str> {
        match self.stage {
            Stage::Start if !self.folder_ready() => {
                Some("Pick a working folder before choosing a layout.")
            }
            Stage::Layout if !is_pane_count(self.pane_count) => {
                Some("Choose 1, 2, 4, 6, 8, 10 or 12 terminals.")
            }
            Stage::Agents if self.taken() == 0 => Some("Pick at least one agent"),
            Stage::Agents if !self.can_open() => {
                Some("Add a command for the custom agent, or set it back to 0.")
            }
            _ => None,
        }
    }

    /// Guards every `Goto`. Back always resolves to an allowed stage.
    pub fn can_enter(&self, stage: Stage) -> bool {
        match stage {
            Stage::Home | Stage::Start => true,
            Stage::Layout | Stage::Agents => self.folder_ready(),
            Stage::Live => !self.panes.is_empty(),
        }
    }

    /// `slotsFromCounts`.
    pub fn slots_from_counts(&self) -> Vec<Slot> {
        let mut list: Vec<(AgentId, Option<String>)> = Vec::new();
        for entry in ai_agents() {
            for _ in 0..self.count_of(entry.id) {
                let command =
                    if entry.id == AgentId::Custom && !self.custom_command.trim().is_empty() {
                        Some(self.custom_command.trim().to_string())
                    } else {
                        None
                    };
                list.push((entry.id, command));
            }
        }
        (0..usize::from(self.pane_count))
            .map(|slot| match list.get(slot) {
                Some((agent_id, command)) => Slot {
                    slot,
                    agent_id: *agent_id,
                    command: command.clone(),
                },
                None => Slot {
                    slot,
                    agent_id: AgentId::Shell,
                    command: None,
                },
            })
            .collect()
    }

    /// `shellSlots`.
    pub fn shell_slots(&self) -> Vec<Slot> {
        (0..usize::from(self.pane_count))
            .map(|slot| Slot {
                slot,
                agent_id: AgentId::Shell,
                command: None,
            })
            .collect()
    }

    // ---- update -------------------------------------------------------------

    pub fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::OpenMode(mode) => {
                if mode == ModeId::Space {
                    self.requested_mode = None;
                    self.stage = Stage::Start;
                } else {
                    self.requested_mode = Some(mode);
                }
            }
            Message::Goto(stage) => {
                if self.can_enter(stage) {
                    self.stage = stage;
                    self.error = None;
                }
            }
            Message::FolderInput(value) => self.folder_path = value,
            Message::FolderSubmit => {
                if looks_like_cd(&self.folder_path) {
                    self.folder_path =
                        resolve_folder(&self.home_dir, &self.folder_path, &self.home_dir);
                }
            }
            Message::CdInput(value) => self.cd_input = value,
            Message::CdSubmit => {
                if !self.cd_input.trim().is_empty() {
                    self.folder_path =
                        resolve_folder(&self.folder_path, &self.cd_input, &self.home_dir);
                    self.cd_input.clear();
                }
            }
            Message::Browse => self.error = None,
            Message::FolderPicked(picked) => {
                if let Some(path) = picked {
                    self.folder_path = path;
                }
            }
            Message::PickRecent(path) => self.folder_path = path,
            Message::SetIsolation(isolation) => self.isolation = isolation,
            Message::SetPaneCount(count) => {
                if is_pane_count(count) {
                    self.pane_count = count;
                }
            }
            Message::SetAgentCount(id, next) => self.set_agent_count(id, next),
            Message::ToggleAgent(id) => {
                let next = if self.count_of(id) > 0 { 0 } else { 1 };
                self.set_agent_count(id, next);
            }
            Message::SetAgentAll(id) => {
                self.agent_counts = [0; BOARD_AGENT_CATALOG.len()];
                self.agent_counts[catalog_index(id)] = self.pane_count;
            }
            Message::QuickFill(mode) => self.fill_agents(mode),
            Message::ShowMoreAgents => self.show_more_agents = true,
            Message::CustomCommand(value) => self.custom_command = value,
            Message::Launch { with_agents } => {
                let slots = if with_agents {
                    self.slots_from_counts()
                } else {
                    self.shell_slots()
                };
                self.launch(&slots);
            }
            Message::Pane(slot, msg) => return self.pane_message(slot, msg),
            Message::DismissError => self.error = None,
        }
        Task::none()
    }

    /// `setAgentCount` — clamp `next` into what the pane budget still allows.
    fn set_agent_count(&mut self, id: AgentId, next: i32) {
        let index = catalog_index(id);
        let others = self.taken() - i32::from(self.agent_counts[index]);
        let ceiling = i32::from(self.pane_count) - others;
        self.agent_counts[index] = next.clamp(0, ceiling.max(0)) as u8;
    }

    /// `fillAgents`.
    fn fill_agents(&mut self, mode: FillMode) {
        let pool: Vec<AgentId> = ai_agents()
            .filter(|entry| entry.id != AgentId::Custom)
            .map(|entry| entry.id)
            .collect();
        let mut next = [0u8; BOARD_AGENT_CATALOG.len()];
        match mode {
            // `one` slices the pool to paneCount first; `all` walks the whole
            // pool and stops at paneCount. Same result, both kept verbatim.
            FillMode::One | FillMode::All => {
                for id in pool.iter().take(usize::from(self.pane_count)) {
                    next[catalog_index(*id)] = 1;
                }
            }
            FillMode::Split => {
                let chosen: Vec<AgentId> = FEATURED_AGENT_IDS
                    .iter()
                    .copied()
                    .filter(|id| *id != AgentId::Custom)
                    .collect();
                let len = chosen.len() as u8;
                let base = self.pane_count / len;
                let mut extra = self.pane_count % len;
                for id in chosen {
                    next[catalog_index(id)] = base + u8::from(extra > 0);
                    extra = extra.saturating_sub(1);
                }
            }
        }
        self.agent_counts = next;
    }

    /// `launchSpace` — resolve the folder, record the recent, build the grid.
    fn launch(&mut self, slots: &[Slot]) {
        let working = if looks_like_cd(&self.folder_path) {
            resolve_folder(&self.home_dir, &self.folder_path, &self.home_dir)
        } else {
            self.folder_path.trim().to_string()
        };
        let folder = resolve_folder(&working, &self.cd_input, &self.home_dir);
        self.folder_path = folder.clone();
        self.cd_input.clear();
        push_recent(&mut self.recents, &folder);
        self.panes = slots
            .iter()
            .map(|slot| {
                let entry = BOARD_AGENT_CATALOG[catalog_index(slot.agent_id)];
                let title = match &slot.command {
                    Some(command) if slot.agent_id == AgentId::Custom => command.clone(),
                    _ => entry.label.to_string(),
                };
                let branch = match self.isolation {
                    Isolation::Worktree => Some(format!("space/{}", slot.slot)),
                    Isolation::Shared => None,
                };
                LivePane::new(title, branch, PaneStatus::Starting)
            })
            .collect();
        if let Some(first) = self.panes.first_mut() {
            first.pane.focused = true;
        }
        self.maximized = None;
        self.error = None;
        self.reslot();
        self.stage = Stage::Live;
    }

    /// Re-derive per-pane chrome after the grid grows or shrinks. `addPane`
    /// stops at 12, so the split affordance disappears there.
    fn reslot(&mut self) {
        let can_split = self.panes.len() < 12;
        for pane in &mut self.panes {
            pane.pane.show_split = can_split;
        }
        if self.maximized.is_some_and(|slot| slot >= self.panes.len()) {
            self.maximized = None;
        }
        let maximized = self.maximized;
        for (index, pane) in self.panes.iter_mut().enumerate() {
            pane.pane.maximized = maximized == Some(index);
        }
    }

    fn pane_message(&mut self, slot: usize, message: PaneMessage) -> Task<Message> {
        if slot >= self.panes.len() {
            return Task::none();
        }
        match message {
            PaneMessage::Focus => {
                for (index, pane) in self.panes.iter_mut().enumerate() {
                    pane.pane.focused = index == slot;
                }
            }
            PaneMessage::Maximize => {
                self.maximized = if self.maximized == Some(slot) {
                    None
                } else {
                    Some(slot)
                };
                self.reslot();
            }
            PaneMessage::Land => {
                let pane = &mut self.panes[slot].pane;
                pane.confirm_land = !pane.confirm_land;
            }
            PaneMessage::Split => {
                if self.panes.len() >= 12 {
                    return Task::none();
                }
                let mut pane = LivePane::new("Terminal", None, PaneStatus::Starting);
                pane.feed(b"$ \r\n");
                self.panes.insert(slot + 1, pane);
                self.maximized = None;
                self.reslot();
            }
            PaneMessage::Close => {
                self.panes.remove(slot);
                if self.panes.is_empty() {
                    self.stage = Stage::Home;
                    self.maximized = None;
                    return Task::none();
                }
                self.maximized = None;
                self.reslot();
                if !self.panes.iter().any(|pane| pane.pane.focused) {
                    let next = slot.min(self.panes.len() - 1);
                    self.panes[next].pane.focused = true;
                }
            }
            PaneMessage::Copy => {
                if let Some(selection) = self.panes[slot].parser.selection_text() {
                    return iced::clipboard::write(selection);
                }
            }
        }
        Task::none()
    }

    // ---- view ---------------------------------------------------------------

    pub fn view(&self) -> Element<'_, Message> {
        match self.stage {
            Stage::Home => stage(self.home()),
            Stage::Start => page(self.start()),
            Stage::Layout => page(self.layout()),
            Stage::Agents => page(self.agents()),
            Stage::Live => self.live(),
        }
    }

    /// `.spaceHome`.
    fn home(&self) -> Element<'_, Message> {
        let brand = row![
            container(text("H").size(30.0).color(ACCENT))
                .width(56)
                .height(56)
                .center_x(56)
                .center_y(56)
                .style(|_| container::Style {
                    background: Some(ACCENT_DIM.into()),
                    border: Border {
                        color: ACCENT_LINE,
                        width: 1.0,
                        radius: Radius::new(crate::tokens::RADIUS_L),
                    },
                    ..container::Style::default()
                }),
            text("BuilderHelm").size(H2).color(TEXT),
        ]
        .spacing(14)
        .align_y(iced::Alignment::Center);

        let modes = column(MODES.iter().map(mode_card)).spacing(10).width(Fill);

        let mut items: Vec<Element<'_, Message>> = vec![
            brand.into(),
            h1("Your agents."),
            h1("You at the helm."),
            wizard_label("Workspaces", "Choose how you want to work"),
            modes.into(),
        ];
        if !self.recents.is_empty() {
            items.push(wizard_label("Recent", "Last opened workspaces"));
            items.push(self.recent_cards());
        }
        items.push(
            row![
                key_hint("⌘T", "BuilderHelm Space"),
                key_hint("⌘S", "BuilderHelm Swarm"),
                key_hint("⌘,", "Settings"),
            ]
            .spacing(18)
            .into(),
        );

        container(column(items).spacing(16).width(Fill))
            .max_width(760)
            .into()
    }

    /// `.recentCards`, two per row.
    fn recent_cards(&self) -> Element<'_, Message> {
        let rows = self.recents.chunks(2).map(|pair| {
            let cards = pair.iter().map(|path| {
                recent_card(
                    path,
                    self.folder_path == *path,
                    Message::PickRecent(path.clone()),
                )
            });
            let mut cells: Vec<Element<'_, Message>> = cards.collect();
            if cells.len() == 1 {
                cells.push(Space::new().width(Fill).into());
            }
            row(cells).spacing(10).width(Fill).into()
        });
        column(rows).spacing(10).width(Fill).into()
    }

    /// Wizard step 1 — `Start`. Working folder plus isolation.
    fn start(&self) -> Element<'_, Message> {
        let folder_row = row![
            field("Browse to a project folder", &self.folder_path)
                .on_input(Message::FolderInput)
                .on_submit(Message::FolderSubmit),
            secondary_button("Browse…", Some(Message::Browse)),
        ]
        .spacing(10)
        .align_y(iced::Alignment::Center);

        let cd_row = row![field("cd Developer", &self.cd_input)
            .on_input(Message::CdInput)
            .on_submit(Message::CdSubmit)]
        .spacing(10);

        let isolation = row![
            segment(
                "Shared folder",
                self.isolation == Isolation::Shared,
                Message::SetIsolation(Isolation::Shared),
            ),
            segment(
                "Git worktree",
                self.isolation == Isolation::Worktree,
                Message::SetIsolation(Isolation::Worktree),
            ),
        ]
        .spacing(8);

        let mut items: Vec<Element<'_, Message>> = vec![
            space_stepper(1, &SPACE_STEPS),
            h1("Set up your workspace"),
            lede("Pick a folder to work in and choose how many terminals you want."),
            wizard_section(vec![
                wizard_label("Working folder", "Where your terminals will start"),
                folder_row.into(),
                cd_row.into(),
            ]),
            wizard_section(vec![
                wizard_label("Isolation", "How each terminal sees your repo"),
                isolation.into(),
                dim(match self.isolation {
                    Isolation::Shared => "Every terminal opens the folder itself.",
                    Isolation::Worktree => "Every terminal gets its own git worktree and branch.",
                }),
            ]),
        ];
        self.push_notices(&mut items);
        items.push(footer(
            Message::Goto(Stage::Home),
            vec![primary_button(
                "Next: Choose layout",
                self.folder_ready().then_some(Message::Goto(Stage::Layout)),
            )],
        ));
        wizard(items)
    }

    /// Wizard step 2 — `Layout`. `PANE_COUNTS` tiles plus the live preview.
    fn layout(&self) -> Element<'_, Message> {
        let (cols, rows) = board_grid_layout(self.pane_count);
        let summary = format!(
            "{} terminal{} · {cols}×{rows} grid",
            self.pane_count,
            if self.pane_count == 1 { "" } else { "s" },
        );
        let label_row = row![
            wizard_label("How many terminals?", "Tap a tile to choose a layout"),
            Space::new().width(Fill),
            text(summary).size(H3).color(HINT),
        ]
        .align_y(iced::Alignment::Center);

        let tiles = row(PANE_COUNTS
            .iter()
            .map(|count| layout_tile(*count, *count == self.pane_count)))
        .spacing(10)
        .width(Fill);

        let (live_cols, live_rows) = grid_for_count(self.pane_count);
        let preview = column![
            dim("Live grid"),
            preview_grid(self.pane_count, live_cols, live_rows, 26.0, 4.0, true),
        ]
        .spacing(8);

        let mut items: Vec<Element<'_, Message>> = vec![
            space_stepper(2, &SPACE_STEPS),
            h1("How many terminals?"),
            lede("Tap a tile to choose a layout."),
            wizard_section(vec![label_row.into(), tiles.into(), preview.into()]),
        ];
        self.push_notices(&mut items);
        items.push(footer(
            Message::Goto(Stage::Start),
            vec![
                secondary_button(
                    "Open without AI",
                    self.folder_ready()
                        .then_some(Message::Launch { with_agents: false }),
                ),
                primary_button(
                    "Next: Add AI agents",
                    self.folder_ready().then_some(Message::Goto(Stage::Agents)),
                ),
            ],
        ));
        wizard(items)
    }

    /// Wizard step 3 — `Agents`. `.spaceAgents`.
    fn agents(&self) -> Element<'_, Message> {
        let taken = self.taken();
        let remaining = self.remaining();
        let plural = if self.pane_count == 1 { "" } else { "s" };

        let progress = row![
            text(format!("{taken} / {}", self.pane_count))
                .size(BODY)
                .color(TEXT),
            progress_track(taken, i32::from(self.pane_count)),
            text(if taken == 0 {
                "No agents yet".to_string()
            } else {
                format!("{remaining} left")
            })
            .size(SMALL)
            .color(TEXT_3),
        ]
        .spacing(12)
        .align_y(iced::Alignment::Center);

        let quick = row![
            text("Quick fill").size(SMALL).color(TEXT_3),
            segment("Enable all", false, Message::QuickFill(FillMode::All)),
            segment("One of each", false, Message::QuickFill(FillMode::One)),
            segment("Split evenly", false, Message::QuickFill(FillMode::Split)),
        ]
        .spacing(8)
        .align_y(iced::Alignment::Center);

        let visible: Vec<&AgentCatalogEntry> = ai_agents()
            .filter(|entry| {
                entry.id != AgentId::Custom && (self.show_more_agents || is_featured(entry.id))
            })
            .collect();
        let hidden_count = ai_agents()
            .filter(|entry| entry.id != AgentId::Custom && !is_featured(entry.id))
            .count();

        let grid = column(visible.chunks(2).map(|pair| {
            let mut cells: Vec<Element<'_, Message>> = pair
                .iter()
                .map(|entry| self.agent_row(entry, remaining))
                .collect();
            if cells.len() == 1 {
                cells.push(Space::new().width(Fill).into());
            }
            row(cells).spacing(8).width(Fill).into()
        }))
        .spacing(8)
        .width(Fill);

        let mut section: Vec<Element<'_, Message>> = vec![
            wizard_label(
                "Agents",
                &format!("Pick who launches in your {} terminals", self.pane_count),
            ),
            progress.into(),
            quick.into(),
            grid.into(),
        ];
        if !self.show_more_agents && hidden_count > 0 {
            section.push(wide_button(
                format!("Show {hidden_count} more agents"),
                Message::ShowMoreAgents,
            ));
        }
        section.push(self.agent_custom(remaining));

        let mut items: Vec<Element<'_, Message>> = vec![
            space_stepper(3, &SPACE_STEPS),
            h1("Add AI coding agents"),
            lede(format!(
                "Pick which agents launch in your {} terminal{plural} — or skip this step entirely.",
                self.pane_count
            )),
            wizard_section(section),
        ];
        self.push_notices(&mut items);
        items.push(footer(
            Message::Goto(Stage::Layout),
            vec![
                secondary_button(
                    "Skip — no agents",
                    self.folder_ready()
                        .then_some(Message::Launch { with_agents: false }),
                ),
                primary_button(
                    if self.can_open() {
                        "Open Space"
                    } else {
                        "Pick at least one agent"
                    },
                    self.can_launch()
                        .then_some(Message::Launch { with_agents: true }),
                ),
            ],
        ));
        wizard(items)
    }

    /// `.agentRow`.
    fn agent_row<'a>(&self, entry: &'a AgentCatalogEntry, remaining: i32) -> Element<'a, Message> {
        let count = self.count_of(entry.id);
        agent_row_shell(
            row![
                agent_mark(entry.label, count > 0, Message::ToggleAgent(entry.id)),
                text(entry.label).size(14.0).color(TEXT).width(Fill),
                small_button("All", Some(Message::SetAgentAll(entry.id))),
                agent_stepper(entry.id, count, remaining),
            ]
            .spacing(10)
            .align_y(iced::Alignment::Center)
            .into(),
            count > 0,
            false,
        )
    }

    /// `.agentCustom`.
    fn agent_custom(&self, remaining: i32) -> Element<'_, Message> {
        let count = self.count_of(AgentId::Custom);
        let head = row![
            agent_mark("Custom", count > 0, Message::ToggleAgent(AgentId::Custom)),
            column![
                text("Custom command").size(14.0).color(TEXT),
                text("Any CLI agent or shell command")
                    .size(SMALL)
                    .color(TEXT_3),
            ]
            .width(Fill),
            small_button("All", Some(Message::SetAgentAll(AgentId::Custom))),
            agent_stepper(AgentId::Custom, count, remaining),
        ]
        .spacing(10)
        .align_y(iced::Alignment::Center);

        agent_row_shell(
            column![
                head,
                field("e.g. aider --yes-always", &self.custom_command)
                    .on_input(Message::CustomCommand),
            ]
            .spacing(10)
            .into(),
            count > 0,
            true,
        )
    }

    /// `.wizardError` for the launch error and the step gate.
    fn push_notices<'a>(&'a self, items: &mut Vec<Element<'a, Message>>) {
        if let Some(error) = &self.error {
            items.push(error_banner(error.clone()));
        }
        if let Some(gate) = self.step_error() {
            items.push(error_banner(gate));
        }
    }

    /// `.boardGrid` — `gridForCount` columns, or one cell when maximised.
    fn live(&self) -> Element<'_, Message> {
        if self.panes.is_empty() {
            return page(super::common::empty_state(
                "No live terminals. Start a Space to open one.",
            ));
        }
        let visible: Vec<usize> = match self.maximized {
            Some(slot) if slot < self.panes.len() => vec![slot],
            _ => (0..self.panes.len()).collect(),
        };
        let (cols, _) = if self.maximized.is_some() {
            (1u8, 1u8)
        } else {
            grid_for_count(self.panes.len().min(255) as u8)
        };
        let per_row = usize::from(cols.max(1));
        let grid = column(visible.chunks(per_row).map(|chunk| {
            row(chunk.iter().map(|index| {
                let slot = *index;
                let live = &self.panes[slot];
                terminal_pane(&live.pane, &live.snap).map(move |msg| Message::Pane(slot, msg))
            }))
            .spacing(10)
            .width(Fill)
            .height(Fill)
            .into()
        }))
        .spacing(10)
        .width(Fill)
        .height(Fill);

        let mut items: Vec<Element<'_, Message>> = Vec::new();
        if let Some(error) = &self.error {
            items.push(error_banner(error.clone()));
        }
        items.push(grid.into());
        container(column(items).spacing(10).width(Fill).height(Fill))
            .padding(10)
            .width(Fill)
            .height(Fill)
            .style(|_| container::Style {
                background: Some(crate::tokens::BG.into()),
                ..container::Style::default()
            })
            .into()
    }
}

// ---- widgets ---------------------------------------------------------------

/// `.spaceWizard` — stretch column, capped like `.spaceAgents`.
fn wizard<'a>(items: Vec<Element<'a, Message>>) -> Element<'a, Message> {
    container(column(items).spacing(16).width(Fill))
        .max_width(880)
        .center_x(Fill)
        .into()
}

/// `.wizardSection`.
fn wizard_section<'a>(items: Vec<Element<'a, Message>>) -> Element<'a, Message> {
    container(column(items).spacing(10).width(Fill))
        .padding(16)
        .width(Fill)
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

/// `.wizardLabel` — title with a dimmer trailing hint.
fn wizard_label<'a>(title: &'a str, hint: &str) -> Element<'a, Message> {
    row![
        text(title).size(H2).color(TEXT),
        text(hint.to_string()).size(H3).color(HINT),
    ]
    .spacing(10)
    .align_y(iced::Alignment::Center)
    .into()
}

/// `.spaceWizardFooter` + `.spaceWizardActions`.
fn footer<'a>(back: Message, actions: Vec<Element<'a, Message>>) -> Element<'a, Message> {
    let mut items: Vec<Element<'a, Message>> = vec![
        secondary_button("Back", Some(back)),
        Space::new().width(Fill).into(),
    ];
    items.extend(actions);
    row(items)
        .spacing(10)
        .width(Fill)
        .align_y(iced::Alignment::Center)
        .into()
}

/// `.spaceMode`.
fn mode_card(mode: &'static Mode) -> Element<'static, Message> {
    let icon = container(text(mode.glyph).size(18.0).color(ACCENT))
        .width(42)
        .height(42)
        .center_x(42)
        .center_y(42)
        .style(|_| container::Style {
            background: Some(GLASS.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(RADIUS_S),
            },
            ..container::Style::default()
        });
    let content = row![
        icon,
        column![
            text(mode.name).size(H3).color(TEXT),
            text(mode.promise).size(SMALL).color(TEXT_3),
        ]
        .spacing(6)
        .width(Fill),
        kbd(mode.shortcut),
    ]
    .spacing(14)
    .align_y(iced::Alignment::Center);

    button(content)
        .padding(Padding {
            top: 14.0,
            right: 16.0,
            bottom: 14.0,
            left: 16.0,
        })
        .width(Fill)
        .on_press_maybe(mode.enabled.then_some(Message::OpenMode(mode.id)))
        .style(|_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if hover { GLASS_STRONG } else { PANEL }.into()),
                text_color: TEXT,
                border: Border {
                    color: if hover { LINE_STRONG } else { LINE },
                    width: 1.0,
                    radius: Radius::new(crate::tokens::RADIUS_L),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.spaceMode kbd` / `.spaceHomeKeys kbd`.
fn kbd(label: &str) -> Element<'_, Message> {
    container(text(label).size(SMALL).color(TEXT_2))
        .padding(Padding {
            top: 5.0,
            right: 10.0,
            bottom: 5.0,
            left: 10.0,
        })
        .style(|_| container::Style {
            background: Some(GLASS.into()),
            border: Border {
                color: LINE,
                width: 1.0,
                radius: Radius::new(8.0),
            },
            ..container::Style::default()
        })
        .into()
}

/// One `.spaceHomeKeys` entry.
fn key_hint<'a>(key: &'a str, label: &'a str) -> Element<'a, Message> {
    row![kbd(key), text(label).size(SMALL).color(TEXT_3)]
        .spacing(8)
        .align_y(iced::Alignment::Center)
        .into()
}

/// `.recentCard` / `.recentCardActive`.
fn recent_card<'a>(path: &'a str, active: bool, msg: Message) -> Element<'a, Message> {
    let content = column![
        text(folder_name(path)).size(BODY).color(TEXT),
        text(path).size(SMALL).color(TEXT_3),
    ]
    .spacing(2)
    .width(Fill);
    button(content)
        .padding(Padding {
            top: 10.0,
            right: 12.0,
            bottom: 10.0,
            left: 12.0,
        })
        .width(Fill)
        .on_press(msg)
        .style(move |_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if active { ACCENT_DIM } else { BG_1 }.into()),
                text_color: TEXT,
                border: Border {
                    color: if active || hover { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: Radius::new(RADIUS_M),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.folderRow input` / `.agentCustom input`.
fn field<'a>(
    placeholder: &'a str,
    value: &'a str,
) -> iced::widget::TextInput<'a, Message, iced::Theme, iced::Renderer> {
    text_input(placeholder, value)
        .padding(Padding {
            top: 9.0,
            right: 12.0,
            bottom: 9.0,
            left: 12.0,
        })
        .size(BODY)
        .width(Fill)
        .style(|_, status| {
            let focused = matches!(status, text_input::Status::Focused { .. });
            text_input::Style {
                background: BG_1.into(),
                border: Border {
                    color: if focused { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: Radius::new(RADIUS_S),
                },
                icon: TEXT_3,
                placeholder: TEXT_3,
                value: TEXT,
                selection: ACCENT_DIM,
            }
        })
}

/// `.segmentBtn` — always enabled, unlike `common::chip`'s optional message.
fn segment(label: &str, active: bool, msg: Message) -> Element<'_, Message> {
    super::common::chip(label, active, Some(msg))
}

/// `.layoutTile` / `.layoutTileActive`.
fn layout_tile(count: u8, active: bool) -> Element<'static, Message> {
    let (cols, rows) = board_grid_layout(count);
    let content = column![
        preview_grid(count, cols, rows, 7.0, 3.0, active),
        text(count.to_string()).size(BODY),
    ]
    .spacing(8)
    .align_x(iced::Alignment::Center);

    button(content)
        .padding(Padding {
            top: 10.0,
            right: 8.0,
            bottom: 10.0,
            left: 8.0,
        })
        .width(Fill)
        .on_press(Message::SetPaneCount(count))
        .style(move |_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if active { ACCENT_DIM } else { BG_1 }.into()),
                text_color: if active { TEXT } else { TEXT_2 },
                border: Border {
                    color: if active {
                        ACCENT
                    } else if hover {
                        LINE_STRONG
                    } else {
                        LINE
                    },
                    width: 1.0,
                    radius: Radius::new(RADIUS_M),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.layoutPreview` — `count` lit cells laid row-major into `cols`×`rows`.
/// Trailing cells of the last row are absent, as in the DOM.
fn preview_grid(
    count: u8,
    cols: u8,
    rows: u8,
    cell: f32,
    gap: f32,
    active: bool,
) -> Element<'static, Message> {
    let mut left = u32::from(count);
    let lines = (0..rows).map(|_| {
        let cells = (0..cols).map(|_| {
            let lit = left > 0;
            left = left.saturating_sub(1);
            let fill = if !lit {
                None
            } else if active {
                Some(ACCENT)
            } else {
                Some(rgba(255, 255, 255, 0.35))
            };
            container(Space::new().width(cell).height(cell))
                .style(move |_| container::Style {
                    background: fill.map(Into::into),
                    border: Border {
                        radius: Radius::new(2.0),
                        ..Border::default()
                    },
                    ..container::Style::default()
                })
                .into()
        });
        row(cells.collect::<Vec<_>>()).spacing(gap).into()
    });
    column(lines.collect::<Vec<_>>()).spacing(gap).into()
}

/// `.agentRow` / `.agentCustom` shell, with the `.agentRowOn` accent border.
fn agent_row_shell<'a>(
    content: Element<'a, Message>,
    on: bool,
    dashed: bool,
) -> Element<'a, Message> {
    container(content)
        .padding(Padding {
            top: 10.0,
            right: 12.0,
            bottom: 10.0,
            left: 12.0,
        })
        .width(Fill)
        .style(move |_| container::Style {
            background: Some(if dashed { GLASS } else { BG_1 }.into()),
            border: Border {
                color: if on { ACCENT_LINE } else { LINE },
                width: 1.0,
                radius: Radius::new(RADIUS_M),
            },
            ..container::Style::default()
        })
        .into()
}

/// `AgentMark` — the SVG marks need an `svg` renderer, so the mark is the
/// agent's initial on the same glass square.
fn agent_mark(label: &str, on: bool, msg: Message) -> Element<'_, Message> {
    let initial = label
        .chars()
        .next()
        .unwrap_or('?')
        .to_uppercase()
        .to_string();
    button(text(initial).size(BODY))
        .width(28)
        .height(28)
        .on_press(msg)
        .style(move |_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if on { ACCENT_DIM } else { GLASS }.into()),
                text_color: if on { ACCENT_BRIGHT } else { TEXT_2 },
                border: Border {
                    color: if on || hover { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: Radius::new(9.0),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.agentStepper` — `−`, count, `+`, with the TSX disabled conditions.
fn agent_stepper(id: AgentId, count: u8, remaining: i32) -> Element<'static, Message> {
    row![
        small_button(
            "−",
            (count > 0).then(|| Message::SetAgentCount(id, i32::from(count) - 1)),
        ),
        text(count.to_string()).size(BODY).color(TEXT),
        small_button(
            "+",
            (remaining != 0).then(|| Message::SetAgentCount(id, i32::from(count) + 1)),
        ),
    ]
    .spacing(6)
    .align_y(iced::Alignment::Center)
    .into()
}

/// `.agentStepper button` / `.agentAll`.
fn small_button(label: &str, msg: Option<Message>) -> Element<'_, Message> {
    let enabled = msg.is_some();
    button(text(label).size(SMALL))
        .padding(Padding {
            top: 4.0,
            right: 8.0,
            bottom: 4.0,
            left: 8.0,
        })
        .on_press_maybe(msg)
        .style(move |_, status| {
            let hover = enabled && matches!(status, button::Status::Hovered);
            button::Style {
                background: Some(GLASS.into()),
                text_color: if hover { ACCENT_BRIGHT } else { TEXT_2 }.scale_alpha(if enabled {
                    1.0
                } else {
                    0.4
                }),
                border: Border {
                    color: if hover { ACCENT_LINE } else { LINE },
                    width: 1.0,
                    radius: Radius::new(6.0),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.agentMore`.
fn wide_button(label: String, msg: Message) -> Element<'static, Message> {
    button(text(label).size(BODY))
        .padding(10)
        .width(Fill)
        .on_press(msg)
        .style(|_, status| {
            let hover = matches!(status, button::Status::Hovered | button::Status::Pressed);
            button::Style {
                background: Some(if hover { GLASS_STRONG } else { GLASS }.into()),
                text_color: TEXT_2,
                border: Border {
                    color: if hover { LINE_STRONG } else { LINE },
                    width: 1.0,
                    radius: Radius::new(RADIUS_M),
                },
                shadow: Shadow::default(),
                snap: true,
            }
        })
        .into()
}

/// `.agentProgressTrack` + `.agentProgressFill`.
fn progress_track(taken: i32, total: i32) -> Element<'static, Message> {
    let done = taken.clamp(0, total.max(0));
    let left = (total - done).max(0);
    let mut cells: Vec<Element<'static, Message>> = Vec::new();
    if done > 0 {
        cells.push(bar(Some(ACCENT), done as u16));
    }
    if left > 0 {
        cells.push(bar(None, left as u16));
    }
    if cells.is_empty() {
        cells.push(bar(None, 1));
    }
    container(row(cells).height(4))
        .width(Fill)
        .height(4)
        .style(|_| container::Style {
            background: Some(rgba(255, 255, 255, 0.08).into()),
            border: Border {
                radius: Radius::new(99.0),
                ..Border::default()
            },
            ..container::Style::default()
        })
        .into()
}

fn bar(fill: Option<iced::Color>, portion: u16) -> Element<'static, Message> {
    container(Space::new().width(Fill).height(4))
        .width(Length::FillPortion(portion.max(1)))
        .height(4)
        .style(move |_| container::Style {
            background: fill.map(Into::into),
            border: Border {
                radius: Radius::new(99.0),
                ..Border::default()
            },
            ..container::Style::default()
        })
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `update` hands back a `Task`; the tests only care about the state it left.
    fn dispatch(state: &mut State, message: Message) {
        let _ = state.update(message);
    }

    fn ready() -> State {
        State {
            folder_path: "/tmp/project".to_string(),
            home_dir: "/home/builder".to_string(),
            agent_counts: [0; BOARD_AGENT_CATALOG.len()],
            panes: Vec::new(),
            ..State::default()
        }
    }

    #[test]
    fn pane_count_accepts_only_the_seven_offered_layouts() {
        let mut state = ready();
        for count in PANE_COUNTS {
            dispatch(&mut state, Message::SetPaneCount(count));
            assert_eq!(state.pane_count, count, "{count} is offered");
        }
        dispatch(&mut state, Message::SetPaneCount(12));
        for rejected in [0u8, 3, 5, 7, 9, 11, 13, 255] {
            assert!(!is_pane_count(rejected));
            dispatch(&mut state, Message::SetPaneCount(rejected));
            assert_eq!(state.pane_count, 12, "{rejected} must not stick");
        }
    }

    #[test]
    fn every_grid_holds_its_panes() {
        for count in PANE_COUNTS {
            let (cols, rows) = grid_for_count(count);
            assert!(
                u16::from(cols) * u16::from(rows) >= u16::from(count),
                "gridForCount({count}) = {cols}x{rows}"
            );
            let (cols, rows) = board_grid_layout(count);
            assert!(
                u16::from(cols) * u16::from(rows) >= u16::from(count),
                "boardGridLayouts[{count}] = {cols}x{rows}"
            );
        }
        // The three cases the TS contract test pins.
        assert_eq!(grid_for_count(2), (2, 1));
        assert_eq!(grid_for_count(6), (3, 2));
        assert_eq!(grid_for_count(7), (4, 2));
    }

    #[test]
    fn launch_waits_for_a_folder_and_an_agent() {
        let mut state = State {
            folder_path: String::new(),
            cd_input: String::new(),
            ..ready()
        };
        assert!(!state.folder_ready());
        assert!(!state.can_launch());
        assert!(state.can_enter(Stage::Home) && state.can_enter(Stage::Start));
        assert!(!state.can_enter(Stage::Layout) && !state.can_enter(Stage::Agents));

        // Home -> Start is the only move an empty folder allows.
        let _ = state.view();
        dispatch(&mut state, Message::Goto(Stage::Layout));
        assert_eq!(state.stage, Stage::Home);
        dispatch(&mut state, Message::OpenMode(ModeId::Space));
        assert_eq!(state.stage, Stage::Start);
        assert_eq!(
            state.step_error(),
            Some("Pick a working folder before choosing a layout.")
        );
        let _ = state.view();

        dispatch(
            &mut state,
            Message::FolderPicked(Some("/tmp/project".to_string())),
        );
        assert!(state.folder_ready());
        assert_eq!(state.step_error(), None);
        dispatch(&mut state, Message::Goto(Stage::Layout));
        assert_eq!(state.stage, Stage::Layout);
        let _ = state.view();

        dispatch(&mut state, Message::Goto(Stage::Agents));
        assert_eq!(state.stage, Stage::Agents);
        // Folder alone is not enough: the Agents step still gates on an agent.
        assert!(!state.can_launch());
        assert_eq!(state.step_error(), Some("Pick at least one agent"));
        let _ = state.view();

        dispatch(&mut state, Message::ToggleAgent(AgentId::Claude));
        assert!(state.can_launch());
        assert_eq!(state.step_error(), None);

        // A custom agent with no command re-closes the gate.
        dispatch(&mut state, Message::ToggleAgent(AgentId::Custom));
        assert!(!state.can_launch());
        dispatch(
            &mut state,
            Message::CustomCommand("aider --yes-always".to_string()),
        );
        assert!(state.can_launch());

        dispatch(&mut state, Message::Launch { with_agents: true });
        assert_eq!(state.stage, Stage::Live);
        assert_eq!(state.panes.len(), usize::from(state.pane_count));
        assert_eq!(
            state.recents.first().map(String::as_str),
            Some("/tmp/project")
        );
        let _ = state.view();

        // Closing every pane drops back to Home, as `closeOnePane` does.
        for _ in 0..state.pane_count {
            dispatch(&mut state, Message::Pane(0, PaneMessage::Close));
        }
        assert!(state.panes.is_empty());
        assert_eq!(state.stage, Stage::Home);
        let _ = state.view();
    }

    #[test]
    fn agent_counts_never_outrun_the_pane_budget() {
        let mut state = ready();
        dispatch(&mut state, Message::SetPaneCount(4));
        dispatch(&mut state, Message::SetAgentAll(AgentId::Claude));
        assert_eq!(state.taken(), 4);
        assert_eq!(state.remaining(), 0);
        // `+` is disabled at zero remaining, and the clamp holds even if fired.
        dispatch(&mut state, Message::SetAgentCount(AgentId::Codex, 3));
        assert_eq!(state.count_of(AgentId::Codex), 0);
        dispatch(&mut state, Message::SetAgentCount(AgentId::Claude, -5));
        assert_eq!(state.count_of(AgentId::Claude), 0);

        dispatch(&mut state, Message::QuickFill(FillMode::Split));
        assert_eq!(state.taken(), 4, "split evenly fills exactly the budget");
        dispatch(&mut state, Message::QuickFill(FillMode::One));
        assert_eq!(state.taken(), 4, "one of each stops at the budget");

        let slots = state.slots_from_counts();
        assert_eq!(slots.len(), 4);
        assert!(slots.iter().all(|slot| slot.agent_id != AgentId::Shell));
        assert_eq!(state.shell_slots().len(), 4);

        // `resolveFolder` drives the folder the launch records.
        assert_eq!(resolve_folder("/a/b", "cd ../c", "/home"), "/a/c");
        assert_eq!(resolve_folder("/a/b", "~/src", "/home"), "/home/src");
        assert_eq!(resolve_folder("", "", "/home"), "/home");
        assert!(looks_like_cd("cd Developer") && looks_like_cd("~/src"));
        assert!(!looks_like_cd("/abs/path") && !looks_like_cd("cdk deploy"));
        assert_eq!(folder_name("/a/b/c/"), "c");
    }
}
