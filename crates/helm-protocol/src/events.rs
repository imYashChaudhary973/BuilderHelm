use helm_shared::{create_id, utc_now, CorrelationId, ZeroId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::json::parse_json_value;
use crate::validate::{from_strict, require_datetime, require_len, require_uuid, ParseError};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActorRef {
    #[serde(rename = "type")]
    pub kind: ActorType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActorType {
    User,
    System,
    Agent,
    Automation,
    Integration,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ZeroEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub occurred_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<ActorRef>,
    pub correlation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    pub payload: Value,
}

pub struct CreateEventInput<'a> {
    pub kind: &'a str,
    pub correlation_id: &'a CorrelationId,
    pub payload: Value,
    pub actor: Option<ActorRef>,
    pub causation_id: Option<&'a ZeroId>,
}

pub fn parse_zero_event(value: &Value) -> Result<ZeroEvent, ParseError> {
    let event: ZeroEvent = from_strict(value)?;
    require_uuid(&event.id)?;
    require_len(&event.kind, 1, usize::MAX)?;
    require_datetime(&event.occurred_at)?;
    require_uuid(&event.correlation_id)?;
    if let Some(id) = &event.causation_id {
        require_uuid(id)?;
    }
    if let Some(actor) = &event.actor {
        if let Some(id) = &actor.id {
            require_len(id, 1, usize::MAX)?;
        }
    }
    parse_json_value(&event.payload)?;
    Ok(event)
}

pub fn create_event(input: CreateEventInput<'_>) -> Result<ZeroEvent, ParseError> {
    let mut map = serde_json::Map::new();
    map.insert(
        "id".into(),
        Value::String(
            create_id(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
            )
            .to_string(),
        ),
    );
    map.insert("type".into(), Value::String(input.kind.to_string()));
    map.insert("occurredAt".into(), Value::String(utc_now()));
    map.insert(
        "correlationId".into(),
        Value::String(input.correlation_id.as_str().to_string()),
    );
    map.insert("payload".into(), input.payload);
    if let Some(actor) = input.actor {
        map.insert("actor".into(), serde_json::to_value(actor).unwrap());
    }
    if let Some(id) = input.causation_id {
        map.insert("causationId".into(), Value::String(id.as_str().to_string()));
    }
    parse_zero_event(&Value::Object(map))
}
