use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::database::{DbRow, ZeroDatabase};
use crate::provider_repository::AuditEventWrite;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilitiesWrite {
    pub text: bool,
    pub vision: bool,
    pub audio_input: bool,
    pub tool_calling: bool,
    pub parallel_tools: bool,
    pub structured_output: bool,
    pub streaming: bool,
    pub reasoning_controls: bool,
    pub server_web_search: bool,
    pub server_mcp: bool,
    pub context_window: Option<i64>,
    pub max_output_tokens: Option<i64>,
    pub metadata_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelWrite {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub label: String,
    pub privacy_class: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub capabilities: ModelCapabilitiesWrite,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredModel {
    pub id: String,
    pub provider_id: String,
    pub model_id: String,
    pub label: String,
    pub privacy_class: String,
    pub enabled: i64,
    pub created_at: String,
    pub updated_at: String,
    pub text: i64,
    pub vision: i64,
    pub audio_input: i64,
    pub tool_calling: i64,
    pub parallel_tools: i64,
    pub structured_output: i64,
    pub streaming: i64,
    pub reasoning_controls: i64,
    pub server_web_search: i64,
    pub server_mcp: i64,
    pub context_window: Option<i64>,
    pub max_output_tokens: Option<i64>,
    pub metadata_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredModelCapabilityOverride {
    pub provider_id: String,
    pub model_id: String,
    pub overrides_json: String,
    pub base_capabilities_json: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct SetCapabilityOverride<'a> {
    pub provider_id: &'a str,
    pub model_id: &'a str,
    pub overrides_json: Option<&'a str>,
    pub base_capabilities_json: &'a str,
    pub effective: &'a ModelCapabilitiesWrite,
    pub updated_at: &'a str,
    pub audit: &'a AuditEventWrite,
}

#[derive(Debug, Clone)]
pub struct ModelCapabilityBaseline {
    pub model_id: String,
    pub capabilities_json: String,
}

const MODEL_COLUMNS: &str = "models.id, models.provider_id AS providerId, models.model_id AS modelId, models.label, models.privacy_class AS privacyClass, models.enabled, models.created_at AS createdAt, models.updated_at AS updatedAt, model_capabilities.text, model_capabilities.vision, model_capabilities.audio_input AS audioInput, model_capabilities.tool_calling AS toolCalling, model_capabilities.parallel_tools AS parallelTools, model_capabilities.structured_output AS structuredOutput, model_capabilities.streaming, model_capabilities.reasoning_controls AS reasoningControls, model_capabilities.server_web_search AS serverWebSearch, model_capabilities.server_mcp AS serverMcp, model_capabilities.context_window AS contextWindow, model_capabilities.max_output_tokens AS maxOutputTokens, model_capabilities.metadata_json AS metadataJson";
fn map_row<T: for<'de> Deserialize<'de>>(row: DbRow) -> T {
    serde_json::from_value(Value::Object(row)).expect("row")
}

fn flag(value: bool) -> Value {
    json!(i64::from(value))
}

pub struct ModelRepository<'a> {
    database: &'a ZeroDatabase,
}

impl<'a> ModelRepository<'a> {
    pub fn new(database: &'a ZeroDatabase) -> Self {
        Self { database }
    }

    pub fn list(&self, provider_id: Option<&str>) -> Vec<StoredModel> {
        let sql = if provider_id.is_some() {
            format!("SELECT {MODEL_COLUMNS} FROM models INNER JOIN model_capabilities ON model_capabilities.model_id = models.id WHERE models.provider_id = ? ORDER BY lower(models.label), models.id")
        } else {
            format!("SELECT {MODEL_COLUMNS} FROM models INNER JOIN model_capabilities ON model_capabilities.model_id = models.id ORDER BY lower(models.label), models.id")
        };
        let params = provider_id.map(|id| vec![json!(id)]).unwrap_or_default();
        self.database
            .query_all(&sql, &params)
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn list_capability_overrides(
        &self,
        provider_id: Option<&str>,
    ) -> Vec<StoredModelCapabilityOverride> {
        let sql = if provider_id.is_some() {
            "SELECT provider_id AS providerId, model_id AS modelId, overrides_json AS overridesJson, base_capabilities_json AS baseCapabilitiesJson, updated_at AS updatedAt FROM model_capability_overrides WHERE provider_id = ? ORDER BY provider_id, model_id"
        } else {
            "SELECT provider_id AS providerId, model_id AS modelId, overrides_json AS overridesJson, base_capabilities_json AS baseCapabilitiesJson, updated_at AS updatedAt FROM model_capability_overrides ORDER BY provider_id, model_id"
        };
        let params = provider_id.map(|id| vec![json!(id)]).unwrap_or_default();
        self.database
            .query_all(sql, &params)
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn replace_for_provider(
        &self,
        provider_id: &str,
        models: &[ModelWrite],
        baselines: &[ModelCapabilityBaseline],
    ) {
        if models.iter().any(|model| model.provider_id != provider_id) {
            panic!("Cannot persist a model under a different provider");
        }
        self.database.transaction(|| {
            for baseline in baselines {
                self.database.run(
                    "UPDATE model_capability_overrides SET base_capabilities_json = ? WHERE provider_id = ? AND model_id = ?",
                    &[
                        json!(baseline.capabilities_json),
                        json!(provider_id),
                        json!(baseline.model_id),
                    ],
                );
            }
            self.database
                .run("DELETE FROM models WHERE provider_id = ?", &[json!(provider_id)]);
            for model in models {
                self.database.run(
                    "INSERT INTO models (id, provider_id, model_id, label, privacy_class, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    &[
                        json!(model.id),
                        json!(model.provider_id),
                        json!(model.model_id),
                        json!(model.label),
                        json!(model.privacy_class),
                        flag(model.enabled),
                        json!(model.created_at),
                        json!(model.updated_at),
                    ],
                );
                let caps = &model.capabilities;
                self.database.run(
                    "INSERT INTO model_capabilities (
                      model_id, text, vision, audio_input, tool_calling, parallel_tools,
                      structured_output, streaming, reasoning_controls, server_web_search,
                      server_mcp, context_window, max_output_tokens, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    &[
                        json!(model.id),
                        flag(caps.text),
                        flag(caps.vision),
                        flag(caps.audio_input),
                        flag(caps.tool_calling),
                        flag(caps.parallel_tools),
                        flag(caps.structured_output),
                        flag(caps.streaming),
                        flag(caps.reasoning_controls),
                        flag(caps.server_web_search),
                        flag(caps.server_mcp),
                        json!(caps.context_window),
                        json!(caps.max_output_tokens),
                        json!(caps.metadata_json),
                    ],
                );
            }
        });
    }

    pub fn set_capability_override(&self, input: SetCapabilityOverride<'_>) {
        self.database.transaction(|| {
            if let Some(overrides_json) = input.overrides_json {
                self.database.run(
                    "INSERT INTO model_capability_overrides (
                      provider_id, model_id, overrides_json, base_capabilities_json, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(provider_id, model_id) DO UPDATE SET
                      overrides_json = excluded.overrides_json,
                      base_capabilities_json = excluded.base_capabilities_json,
                      updated_at = excluded.updated_at",
                    &[
                        json!(input.provider_id),
                        json!(input.model_id),
                        json!(overrides_json),
                        json!(input.base_capabilities_json),
                        json!(input.updated_at),
                    ],
                );
            } else {
                self.database.run(
                    "DELETE FROM model_capability_overrides WHERE provider_id = ? AND model_id = ?",
                    &[json!(input.provider_id), json!(input.model_id)],
                );
            }
            let effective = input.effective;
            self.database.run(
                "UPDATE model_capabilities SET
                  text = ?, vision = ?, audio_input = ?, tool_calling = ?, parallel_tools = ?,
                  structured_output = ?, streaming = ?, reasoning_controls = ?,
                  server_web_search = ?, server_mcp = ?, context_window = ?, max_output_tokens = ?,
                  metadata_json = ?
                WHERE model_id = (SELECT id FROM models WHERE provider_id = ? AND model_id = ?)",
                &[
                    flag(effective.text),
                    flag(effective.vision),
                    flag(effective.audio_input),
                    flag(effective.tool_calling),
                    flag(effective.parallel_tools),
                    flag(effective.structured_output),
                    flag(effective.streaming),
                    flag(effective.reasoning_controls),
                    flag(effective.server_web_search),
                    flag(effective.server_mcp),
                    json!(effective.context_window),
                    json!(effective.max_output_tokens),
                    json!(effective.metadata_json),
                    json!(input.provider_id),
                    json!(input.model_id),
                ],
            );
            let audit = input.audit;
            self.database.run(
                "INSERT INTO audit_events (
                  id, event_type, actor_type, actor_id, correlation_id, risk_level,
                  resource_refs_json, before_json, after_json, approval_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                &[
                    json!(audit.id),
                    json!(audit.event_type),
                    json!(audit.actor_type),
                    json!(audit.actor_id),
                    json!(audit.correlation_id),
                    json!(audit.risk_level),
                    json!(audit.resource_refs_json),
                    json!(audit.before_json),
                    json!(audit.after_json),
                    json!(audit.approval_id),
                    json!(audit.created_at),
                ],
            );
        });
    }
}
