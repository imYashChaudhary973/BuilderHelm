use helm_protocol::{parse_helm_agent, HelmAgent, ParseError};
use helm_shared::{ZeroError, ZeroErrorCode};
use serde::Deserialize;
use serde_json::Value;

use super::helm_repository::{
    HelmCreateAgentInput, HelmCreateRoutineInput, HelmPluginRow, HelmRepository, HelmRoutineRow,
};
use crate::error_convert::{failed, parse_failed};
use crate::secrets::SecretStore;

const GITHUB_SECRET: &str = "plugin:github";

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmRoutine {
    pub id: String,
    pub agent_id: String,
    pub name: String,
    pub instruction: String,
    pub every_minutes: i64,
    pub paused: bool,
    pub last_run_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmPlugin {
    pub id: String,
    pub connected: bool,
    pub account: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConnectPluginInput {
    id: String,
    token: String,
}

pub struct HelmService<'a> {
    repository: HelmRepository<'a>,
    secrets: &'a dyn SecretStore,
}

impl<'a> HelmService<'a> {
    pub fn new(repository: HelmRepository<'a>, secrets: &'a dyn SecretStore) -> Self {
        Self {
            repository,
            secrets,
        }
    }

    pub fn list_agents(&self) -> Result<Vec<HelmAgent>, ZeroError> {
        self.repository
            .list_agents()
            .into_iter()
            .map(|row| {
                let value = serde_json::to_value(&row)
                    .map_err(|err| parse_failed(ParseError::new(err.to_string())))?;
                parse_helm_agent(&value).map_err(parse_failed)
            })
            .collect()
    }

    pub fn create_agent(&self, input: &Value) -> Result<HelmAgent, ZeroError> {
        let parsed: HelmCreateAgentInput = serde_json::from_value(input.clone())
            .map_err(|err| parse_failed(ParseError::new(err.to_string())))?;
        let parsed = HelmCreateAgentInput {
            name: trim_len(&parsed.name, 1, 120)?,
            brief: trim_len(&parsed.brief, 1, 4000)?,
            engine: parsed.engine,
            places: parsed.places,
            skill_ids: parsed.skill_ids,
        };
        if parsed.places.len() > 16 || parsed.skill_ids.len() > 32 {
            return Err(parse_failed(ParseError::new("invalid agent input")));
        }
        let value = serde_json::to_value(self.repository.create_agent(&parsed))
            .map_err(|err| parse_failed(ParseError::new(err.to_string())))?;
        parse_helm_agent(&value).map_err(parse_failed)
    }

    pub fn list_routines(&self) -> Result<Vec<HelmRoutine>, ZeroError> {
        self.repository
            .list_routines()
            .into_iter()
            .map(parse_routine)
            .collect()
    }

    pub fn create_routine(&self, input: &Value) -> Result<HelmRoutine, ZeroError> {
        let parsed: HelmCreateRoutineInput = serde_json::from_value(input.clone())
            .map_err(|err| parse_failed(ParseError::new(err.to_string())))?;
        let parsed = HelmCreateRoutineInput {
            agent_id: parsed.agent_id,
            name: trim_len(&parsed.name, 1, 120)?,
            instruction: trim_len(&parsed.instruction, 1, 4000)?,
            every_minutes: parsed.every_minutes,
        };
        if parsed.every_minutes < 15 || parsed.every_minutes > 10_080 {
            return Err(parse_failed(ParseError::new("everyMinutes")));
        }
        let agents = self.list_agents()?;
        if agents.iter().all(|agent| agent.id != parsed.agent_id) {
            return Err(failed(ZeroErrorCode::ValidationFailed, "Unknown teammate"));
        }
        parse_routine(self.repository.create_routine(&parsed))
    }

    pub fn due_routines(&self, now_ms: i64) -> Vec<HelmRoutine> {
        self.repository
            .due_routines(now_ms)
            .into_iter()
            .filter_map(|row| parse_routine(row).ok())
            .collect()
    }

    pub fn mark_routine_run(&self, id: &str, error: Option<&str>) {
        self.repository.mark_routine_run(id, error);
    }

    pub fn list_plugins(&self) -> Result<Vec<HelmPlugin>, ZeroError> {
        Ok(vec![parse_plugin(self.repository.get_plugin())?])
    }

    pub fn connect_plugin(&self, input: &Value) -> Result<HelmPlugin, ZeroError> {
        let parsed: ConnectPluginInput = serde_json::from_value(input.clone())
            .map_err(|err| parse_failed(ParseError::new(err.to_string())))?;
        if parsed.id != "github" {
            return Err(parse_failed(ParseError::new("id")));
        }
        let token = trim_len(&parsed.token, 8, 256)?;
        self.secrets.set(GITHUB_SECRET, &token)?;
        parse_plugin(self.repository.set_plugin(true, Some("github")))
    }
}

fn trim_len(value: &str, min: usize, max: usize) -> Result<String, ZeroError> {
    let trimmed = value.trim().to_string();
    if trimmed.len() < min || trimmed.len() > max {
        return Err(parse_failed(ParseError::new("length")));
    }
    Ok(trimmed)
}

fn parse_routine(row: HelmRoutineRow) -> Result<HelmRoutine, ZeroError> {
    let value =
        serde_json::to_value(&row).map_err(|err| parse_failed(ParseError::new(err.to_string())))?;
    serde_json::from_value(value).map_err(|err| parse_failed(ParseError::new(err.to_string())))
}

fn parse_plugin(row: HelmPluginRow) -> Result<HelmPlugin, ZeroError> {
    let value =
        serde_json::to_value(&row).map_err(|err| parse_failed(ParseError::new(err.to_string())))?;
    serde_json::from_value(value).map_err(|err| parse_failed(ParseError::new(err.to_string())))
}
