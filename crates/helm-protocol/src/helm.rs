use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validate::{from_strict, require_len, require_uuid, ParseError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelmEngine {
    Claude,
    Codex,
    Grok,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelmAgent {
    pub id: String,
    pub name: String,
    pub brief: String,
    pub engine: HelmEngine,
    pub places: Vec<String>,
    pub skill_ids: Vec<String>,
    pub created_at: String,
}

pub fn parse_helm_agent(value: &Value) -> Result<HelmAgent, ParseError> {
    let mut agent: HelmAgent = from_strict(value)?;
    require_uuid(&agent.id)?;
    agent.name = crate::validate::trim_len(&agent.name, 1, 120)?;
    agent.brief = crate::validate::trim_len(&agent.brief, 1, 4000)?;
    if agent.places.len() > 16 {
        return Err(ParseError::new("places"));
    }
    for place in &agent.places {
        require_len(place, 0, 4096)?;
    }
    if agent.skill_ids.len() > 32 {
        return Err(ParseError::new("skillIds"));
    }
    require_len(&agent.created_at, 1, usize::MAX)?;
    Ok(agent)
}
