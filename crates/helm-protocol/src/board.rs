use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validate::{from_strict, require_datetime, require_len, require_uuid, ParseError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BoardAgentId {
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

impl BoardAgentId {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BoardAgentCatalogEntry {
    pub id: BoardAgentId,
    pub label: &'static str,
    pub command: &'static str,
}

pub const BOARD_AGENT_CATALOG: [BoardAgentCatalogEntry; 14] = [
    BoardAgentCatalogEntry {
        id: BoardAgentId::Shell,
        label: "Terminal",
        command: "",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Claude,
        label: "Claude",
        command: "claude",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Codex,
        label: "Codex",
        command: "codex",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Grok,
        label: "Grok",
        command: "grok",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Gemini,
        label: "Gemini",
        command: "gemini",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Antigravity,
        label: "Antigravity",
        command: "antigravity",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Opencode,
        label: "OpenCode",
        command: "opencode",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Cursor,
        label: "Cursor",
        command: "cursor",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Copilot,
        label: "Copilot",
        command: "copilot",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Omp,
        label: "Oh My Pi",
        command: "omp",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Pi,
        label: "Pi",
        command: "pi",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Kimi,
        label: "Kimi",
        command: "kimi",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Kiro,
        label: "Kiro",
        command: "kiro-cli",
    },
    BoardAgentCatalogEntry {
        id: BoardAgentId::Custom,
        label: "Custom command",
        command: "",
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BoardIsolation {
    Shared,
    Worktree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BoardPaneStatus {
    Starting,
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardPaneArgv {
    pub binary: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardPaneSpec {
    pub slot: i64,
    pub agent_id: BoardAgentId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub argv: Option<BoardPaneArgv>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardAgentDetection {
    pub id: BoardAgentId,
    pub label: String,
    pub available: bool,
    pub path: Option<String>,
}

pub const BOARD_PANE_COUNTS: [u8; 9] = [1, 2, 3, 4, 5, 6, 8, 10, 12];

pub fn grid_for_count(count: i64) -> (i64, i64) {
    let n = count.max(1);
    if n <= 3 {
        return (n, 1);
    }
    let rows = if n <= 8 { 2 } else { 3 };
    let cols = (n + rows - 1) / rows;
    (cols, rows)
}

fn is_pane_count(n: i64) -> bool {
    BOARD_PANE_COUNTS.iter().any(|c| i64::from(*c) == n)
}

fn validate_argv(argv: &BoardPaneArgv) -> Result<(), ParseError> {
    require_len(&argv.binary, 1, 4096)?;
    if argv.args.len() > 64 {
        return Err(ParseError::new("argv args"));
    }
    for arg in &argv.args {
        if arg.len() > 100_000 {
            return Err(ParseError::new("argv arg"));
        }
    }
    Ok(())
}

pub fn parse_board_pane_spec(value: &Value) -> Result<BoardPaneSpec, ParseError> {
    let spec: BoardPaneSpec = from_strict(value)?;
    if spec.slot < 0 || spec.slot > 11 {
        return Err(ParseError::new("slot"));
    }
    if let Some(command) = &spec.command {
        let trimmed = command.trim();
        if trimmed.is_empty() || trimmed.len() > 4_000 {
            return Err(ParseError::new("command"));
        }
    }
    if let Some(argv) = &spec.argv {
        validate_argv(argv)?;
    }
    if spec.agent_id == BoardAgentId::Custom {
        match &spec.command {
            Some(command) if !command.is_empty() => {}
            _ => return Err(ParseError::new("Custom panes require a command")),
        }
    }
    Ok(spec)
}

pub fn parse_board_create_input(value: &Value) -> Result<(), ParseError> {
    let obj = value.as_object().ok_or_else(|| ParseError::new("object"))?;
    let corr = obj
        .get("correlationId")
        .and_then(Value::as_str)
        .ok_or_else(|| ParseError::new("correlationId"))?;
    require_uuid(corr)?;
    let pane_count = obj
        .get("paneCount")
        .and_then(Value::as_i64)
        .ok_or_else(|| ParseError::new("paneCount"))?;
    if !is_pane_count(pane_count) {
        return Err(ParseError::new("paneCount"));
    }
    let panes = obj
        .get("panes")
        .and_then(Value::as_array)
        .ok_or_else(|| ParseError::new("panes"))?;
    if panes.len() as i64 != pane_count {
        return Err(ParseError::new("panes length must equal paneCount"));
    }
    let mut slots = std::collections::BTreeSet::new();
    for pane in panes {
        let spec = parse_board_pane_spec(pane)?;
        if !slots.insert(spec.slot) {
            return Err(ParseError::new("pane slots must be unique"));
        }
        if spec.slot < 0 || spec.slot >= pane_count {
            return Err(ParseError::new("pane slot out of range"));
        }
    }
    Ok(())
}

pub fn parse_board_preset_spec(value: &Value) -> Result<(), ParseError> {
    let obj = value.as_object().ok_or_else(|| ParseError::new("object"))?;
    let pane_count = obj
        .get("paneCount")
        .and_then(Value::as_i64)
        .ok_or_else(|| ParseError::new("paneCount"))?;
    let panes = obj
        .get("panes")
        .and_then(Value::as_array)
        .ok_or_else(|| ParseError::new("panes"))?;
    if panes.len() as i64 != pane_count {
        return Err(ParseError::new("panes length must equal paneCount"));
    }
    Ok(())
}

pub fn require_board_datetime(value: &str) -> Result<(), ParseError> {
    require_datetime(value)
}
