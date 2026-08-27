use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::database::{DbRow, ZeroDatabase};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWrite {
    pub id: String,
    pub label: String,
    pub protocol: String,
    pub base_url: Option<String>,
    pub secret_ref: String,
    pub headers_json: String,
    pub allow_personal: bool,
    pub allow_sensitive: bool,
    pub allow_health: bool,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretMetadataWrite {
    #[serde(rename = "ref")]
    pub secret_ref: String,
    pub provider_id: String,
    pub service: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEventWrite {
    pub id: String,
    pub event_type: String,
    pub actor_type: String,
    pub actor_id: Option<String>,
    pub correlation_id: String,
    pub risk_level: String,
    pub resource_refs_json: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
    pub approval_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProvider {
    pub id: String,
    pub label: String,
    pub protocol: String,
    pub base_url: Option<String>,
    pub secret_ref: String,
    pub headers_json: String,
    pub allow_personal: i64,
    pub allow_sensitive: i64,
    pub allow_health: i64,
    pub enabled: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAuditEvent {
    pub id: String,
    pub event_type: String,
    pub correlation_id: String,
    pub before_json: Option<String>,
    pub after_json: Option<String>,
}

fn map_row<T: for<'de> Deserialize<'de>>(row: DbRow) -> T {
    serde_json::from_value(Value::Object(row)).expect("row")
}

const PROVIDER_COLUMNS: &str = "id, label, protocol, base_url AS baseUrl, secret_ref AS secretRef, headers_json AS headersJson, allow_personal AS allowPersonal, allow_sensitive AS allowSensitive, allow_health AS allowHealth, enabled, created_at AS createdAt, updated_at AS updatedAt";

pub struct ProviderRepository<'a> {
    database: &'a ZeroDatabase,
}

impl<'a> ProviderRepository<'a> {
    pub fn new(database: &'a ZeroDatabase) -> Self {
        Self { database }
    }

    pub fn find_by_id(&self, id: &str) -> Option<StoredProvider> {
        self.database
            .query_one(
                &format!("SELECT {PROVIDER_COLUMNS} FROM providers WHERE id = ?"),
                &[json!(id)],
            )
            .map(map_row)
    }

    pub fn list_audit_events(&self) -> Vec<StoredAuditEvent> {
        self.database
            .query_all(
                "SELECT id, event_type AS eventType, correlation_id AS correlationId, before_json AS beforeJson, after_json AS afterJson FROM audit_events ORDER BY rowid",
                &[],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    fn insert_audit(&self, audit: &AuditEventWrite) {
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
    }

    pub fn create(
        &self,
        provider: &ProviderWrite,
        secret_metadata: &SecretMetadataWrite,
        audit: &AuditEventWrite,
    ) {
        self.database.transaction(|| {
            self.database.run(
                "INSERT INTO providers (
                  id, label, protocol, base_url, secret_ref, headers_json,
                  allow_personal, allow_sensitive, allow_health, enabled,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                &[
                    json!(provider.id),
                    json!(provider.label),
                    json!(provider.protocol),
                    json!(provider.base_url),
                    json!(provider.secret_ref),
                    json!(provider.headers_json),
                    json!(i64::from(provider.allow_personal)),
                    json!(i64::from(provider.allow_sensitive)),
                    json!(i64::from(provider.allow_health)),
                    json!(i64::from(provider.enabled)),
                    json!(provider.created_at),
                    json!(provider.updated_at),
                ],
            );
            self.database.run(
                "INSERT INTO secret_metadata (ref, provider_id, service, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)",
                &[
                    json!(secret_metadata.secret_ref),
                    json!(secret_metadata.provider_id),
                    json!(secret_metadata.service),
                    json!(secret_metadata.created_at),
                    json!(secret_metadata.updated_at),
                ],
            );
            self.insert_audit(audit);
        });
    }
}
