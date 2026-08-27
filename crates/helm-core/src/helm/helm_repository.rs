use helm_db::{DbRow, ZeroDatabase};
use helm_protocol::HelmEngine;
use helm_shared::{create_id, utc_now};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn map_row(row: DbRow) -> Value {
    Value::Object(row)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn new_id() -> String {
    create_id(now_millis()).to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmAgentRow {
    pub id: String,
    pub name: String,
    pub brief: String,
    pub engine: HelmEngine,
    pub places: Vec<String>,
    pub skill_ids: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmRoutineRow {
    pub id: String,
    pub agent_id: String,
    pub name: String,
    pub instruction: String,
    pub every_minutes: i64,
    pub paused: bool,
    pub last_run_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmPluginRow {
    pub id: String,
    pub connected: bool,
    pub account: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmCreateAgentInput {
    pub name: String,
    pub brief: String,
    pub engine: HelmEngine,
    pub places: Vec<String>,
    pub skill_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelmCreateRoutineInput {
    pub agent_id: String,
    pub name: String,
    pub instruction: String,
    pub every_minutes: i64,
}

pub struct HelmRepository<'a> {
    database: &'a ZeroDatabase,
}

impl<'a> HelmRepository<'a> {
    pub fn new(database: &'a ZeroDatabase) -> Self {
        Self { database }
    }

    pub fn list_agents(&self) -> Vec<HelmAgentRow> {
        self.database
            .query_all(
                "SELECT id, name, brief, engine, places_json, skill_ids_json, created_at
         FROM helm_agents ORDER BY created_at DESC",
                &[],
            )
            .into_iter()
            .map(|row| {
                let row = map_row(row);
                HelmAgentRow {
                    id: row["id"].as_str().unwrap_or("").to_string(),
                    name: row["name"].as_str().unwrap_or("").to_string(),
                    brief: row["brief"].as_str().unwrap_or("").to_string(),
                    engine: serde_json::from_value(row["engine"].clone())
                        .unwrap_or(HelmEngine::Claude),
                    places: serde_json::from_str(row["places_json"].as_str().unwrap_or("[]"))
                        .unwrap_or_default(),
                    skill_ids: serde_json::from_str(row["skill_ids_json"].as_str().unwrap_or("[]"))
                        .unwrap_or_default(),
                    created_at: row["created_at"].as_str().unwrap_or("").to_string(),
                }
            })
            .collect()
    }

    pub fn create_agent(&self, input: &HelmCreateAgentInput) -> HelmAgentRow {
        let agent = HelmAgentRow {
            id: new_id(),
            name: input.name.clone(),
            brief: input.brief.clone(),
            engine: input.engine,
            places: input.places.clone(),
            skill_ids: input.skill_ids.clone(),
            created_at: utc_now(),
        };
        self.database.run(
            "INSERT INTO helm_agents (id, name, brief, engine, places_json, skill_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)",
            &[
                json!(agent.id),
                json!(agent.name),
                json!(agent.brief),
                json!(agent.engine),
                json!(serde_json::to_string(&agent.places).unwrap()),
                json!(serde_json::to_string(&agent.skill_ids).unwrap()),
                json!(agent.created_at),
            ],
        );
        agent
    }

    pub fn list_routines(&self) -> Vec<HelmRoutineRow> {
        self.database
            .query_all(
                "SELECT id, agent_id, name, instruction, every_minutes, paused, last_run_at, last_error
         FROM helm_routines ORDER BY name",
                &[],
            )
            .into_iter()
            .map(|row| {
                let row = map_row(row);
                HelmRoutineRow {
                    id: row["id"].as_str().unwrap_or("").to_string(),
                    agent_id: row["agent_id"].as_str().unwrap_or("").to_string(),
                    name: row["name"].as_str().unwrap_or("").to_string(),
                    instruction: row["instruction"].as_str().unwrap_or("").to_string(),
                    every_minutes: row["every_minutes"].as_i64().unwrap_or(0),
                    paused: row["paused"].as_i64().unwrap_or(0) == 1,
                    last_run_at: row["last_run_at"].as_str().map(str::to_string),
                    last_error: row["last_error"].as_str().map(str::to_string),
                }
            })
            .collect()
    }

    pub fn create_routine(&self, input: &HelmCreateRoutineInput) -> HelmRoutineRow {
        let routine = HelmRoutineRow {
            id: new_id(),
            agent_id: input.agent_id.clone(),
            name: input.name.clone(),
            instruction: input.instruction.clone(),
            every_minutes: input.every_minutes,
            paused: false,
            last_run_at: None,
            last_error: None,
        };
        self.database.run(
            "INSERT INTO helm_routines (id, agent_id, name, instruction, every_minutes, paused, last_run_at, last_error)
       VALUES (?, ?, ?, ?, ?, 0, NULL, NULL)",
            &[
                json!(routine.id),
                json!(routine.agent_id),
                json!(routine.name),
                json!(routine.instruction),
                json!(routine.every_minutes),
            ],
        );
        routine
    }

    pub fn due_routines(&self, now_ms: i64) -> Vec<HelmRoutineRow> {
        self.list_routines()
            .into_iter()
            .filter(|routine| {
                if routine.paused {
                    return false;
                }
                match &routine.last_run_at {
                    None => true,
                    Some(last) => parse_ms(last)
                        .map(|last| now_ms - last >= routine.every_minutes * 60_000)
                        .unwrap_or(false),
                }
            })
            .collect()
    }

    pub fn mark_routine_run(&self, id: &str, error: Option<&str>) {
        self.database.run(
            "UPDATE helm_routines SET last_run_at = ?, last_error = ? WHERE id = ?",
            &[json!(utc_now()), json!(error), json!(id)],
        );
    }

    pub fn get_plugin(&self) -> HelmPluginRow {
        let row = self.database.query_one(
            "SELECT connected, account FROM helm_plugins WHERE id = 'github'",
            &[],
        );
        match row {
            Some(row) => {
                let row = map_row(row);
                HelmPluginRow {
                    id: "github".into(),
                    connected: row["connected"].as_i64().unwrap_or(0) == 1,
                    account: row["account"].as_str().map(str::to_string),
                }
            }
            None => HelmPluginRow {
                id: "github".into(),
                connected: false,
                account: None,
            },
        }
    }

    pub fn set_plugin(&self, connected: bool, account: Option<&str>) -> HelmPluginRow {
        self.database.run(
            "UPDATE helm_plugins SET connected = ?, account = ? WHERE id = 'github'",
            &[json!(i64::from(connected)), json!(account)],
        );
        self.get_plugin()
    }
}

fn parse_ms(value: &str) -> Option<i64> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .ok()
        .map(|dt| {
            let utc = dt.to_offset(time::UtcOffset::UTC);
            utc.unix_timestamp() * 1000 + i64::from(utc.millisecond())
        })
}
