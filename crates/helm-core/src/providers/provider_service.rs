use std::cell::Cell;
use std::panic::{catch_unwind, AssertUnwindSafe};

use helm_db::{
    AuditEventWrite, ProviderRepository, ProviderWrite, SecretMetadataWrite, StoredProvider,
    ZeroDatabase,
};
use helm_observability::{LogInput, Logger};
use helm_protocol::{
    parse_create_provider_input, ParseError, ProviderHeader, ProviderPrivacy, ProviderProtocol,
};
use helm_shared::{create_correlation_id, utc_now, ZeroError, ZeroErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error_convert::{failed, parse_failed};
use crate::secrets::{SecretStore, ZERO_KEYCHAIN_SERVICE};

const PROVIDER_COLUMNS: &str = "id, label, protocol, base_url AS baseUrl, secret_ref AS secretRef, headers_json AS headersJson, allow_personal AS allowPersonal, allow_sensitive AS allowSensitive, allow_health AS allowHealth, enabled, created_at AS createdAt, updated_at AS updatedAt";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderSummary {
    pub id: String,
    pub label: String,
    pub protocol: ProviderProtocol,
    pub base_url: Option<String>,
    pub headers: Vec<ProviderHeader>,
    pub privacy: ProviderPrivacy,
    pub enabled: bool,
    pub has_credential: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateProviderInput {
    pub id: String,
    pub label: String,
    pub protocol: ProviderProtocol,
    pub base_url: Option<String>,
    pub headers: Vec<ProviderHeader>,
    pub privacy: ProviderPrivacy,
    pub enabled: bool,
    #[serde(default)]
    pub api_key: Option<String>,
}

pub struct ProviderService<'a> {
    database: &'a ZeroDatabase,
    secrets: &'a dyn SecretStore,
    logger: &'a Logger,
    fail_create: Cell<bool>,
    fail_update: Cell<bool>,
}

fn map_row<T: for<'de> Deserialize<'de>>(row: helm_db::DbRow) -> T {
    serde_json::from_value(Value::Object(row)).expect("row")
}

fn parse_headers(value: &str) -> Result<Vec<ProviderHeader>, ZeroError> {
    let parsed: Value =
        serde_json::from_str(value).map_err(|err| parse_failed(ParseError(err.to_string())))?;
    serde_json::from_value(parsed).map_err(|err| parse_failed(ParseError(err.to_string())))
}

fn parse_protocol(value: &str) -> Result<ProviderProtocol, ZeroError> {
    serde_json::from_value(json!(value)).map_err(|err| parse_failed(ParseError(err.to_string())))
}

fn to_summary(provider: &StoredProvider) -> Result<ProviderSummary, ZeroError> {
    Ok(ProviderSummary {
        id: provider.id.clone(),
        label: provider.label.clone(),
        protocol: parse_protocol(&provider.protocol)?,
        base_url: provider.base_url.clone(),
        headers: parse_headers(&provider.headers_json)?,
        privacy: ProviderPrivacy {
            allow_personal: provider.allow_personal == 1,
            allow_sensitive: provider.allow_sensitive == 1,
            allow_health: provider.allow_health == 1,
        },
        enabled: provider.enabled == 1,
        has_credential: true,
        created_at: provider.created_at.clone(),
        updated_at: provider.updated_at.clone(),
    })
}

fn stored_from_write(write: &ProviderWrite) -> StoredProvider {
    StoredProvider {
        id: write.id.clone(),
        label: write.label.clone(),
        protocol: write.protocol.clone(),
        base_url: write.base_url.clone(),
        secret_ref: write.secret_ref.clone(),
        headers_json: write.headers_json.clone(),
        allow_personal: i64::from(write.allow_personal),
        allow_sensitive: i64::from(write.allow_sensitive),
        allow_health: i64::from(write.allow_health),
        enabled: i64::from(write.enabled),
        created_at: write.created_at.clone(),
        updated_at: write.updated_at.clone(),
    }
}

fn protocol_name(protocol: ProviderProtocol) -> String {
    serde_json::to_value(protocol)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "custom".into())
}

#[allow(clippy::too_many_arguments)]
fn provider_write(
    label: &str,
    protocol: ProviderProtocol,
    base_url: Option<String>,
    headers: &[ProviderHeader],
    privacy: &ProviderPrivacy,
    enabled: bool,
    id: String,
    secret_ref: String,
    created_at: String,
    updated_at: String,
) -> ProviderWrite {
    ProviderWrite {
        id,
        label: label.to_string(),
        protocol: protocol_name(protocol),
        base_url,
        secret_ref,
        headers_json: serde_json::to_string(headers).unwrap_or_else(|_| "[]".into()),
        allow_personal: privacy.allow_personal,
        allow_sensitive: privacy.allow_sensitive,
        allow_health: privacy.allow_health,
        enabled,
        created_at,
        updated_at,
    }
}

fn audit_event(
    event_type: &str,
    correlation_id: &str,
    provider_id: &str,
    before: Option<&ProviderSummary>,
    after: Option<&ProviderSummary>,
) -> AuditEventWrite {
    AuditEventWrite {
        id: create_correlation_id().to_string(),
        event_type: event_type.to_string(),
        actor_type: "user".into(),
        actor_id: None,
        correlation_id: correlation_id.to_string(),
        risk_level: "destructive_sensitive".into(),
        resource_refs_json: json!([{ "type": "provider", "id": provider_id }]).to_string(),
        before_json: before.map(|value| serde_json::to_string(value).unwrap()),
        after_json: after.map(|value| serde_json::to_string(value).unwrap()),
        approval_id: None,
        created_at: utc_now(),
    }
}

fn missing_provider() -> ZeroError {
    failed(ZeroErrorCode::ValidationFailed, "Provider was not found")
}

fn parse_update_provider_input(value: &Value) -> Result<UpdateProviderInput, ParseError> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| ParseError::new("id"))?
        .to_string();
    if uuid::Uuid::parse_str(&id).is_err() {
        return Err(ParseError::new("id"));
    }
    let api_key_present = value.get("apiKey").is_some();
    let mut copy = value.clone();
    if let Some(obj) = copy.as_object_mut() {
        obj.remove("id");
        if !api_key_present {
            obj.insert("apiKey".into(), json!("placeholder"));
        }
    }
    let created = parse_create_provider_input(&copy)?;
    Ok(UpdateProviderInput {
        id,
        label: created.label,
        protocol: created.protocol,
        base_url: created.base_url,
        headers: created.headers,
        privacy: created.privacy,
        enabled: created.enabled,
        api_key: if api_key_present {
            Some(created.api_key)
        } else {
            None
        },
    })
}

impl<'a> ProviderService<'a> {
    pub fn new(
        database: &'a ZeroDatabase,
        secrets: &'a dyn SecretStore,
        logger: &'a Logger,
    ) -> Self {
        Self {
            database,
            secrets,
            logger,
            fail_create: Cell::new(false),
            fail_update: Cell::new(false),
        }
    }

    pub fn fail_next_create(&self) {
        self.fail_create.set(true);
    }

    pub fn fail_next_update(&self) {
        self.fail_update.set(true);
    }

    fn repo(&self) -> ProviderRepository<'a> {
        ProviderRepository::new(self.database)
    }

    fn list_stored(&self) -> Vec<StoredProvider> {
        self.database
            .query_all(
                &format!("SELECT {PROVIDER_COLUMNS} FROM providers ORDER BY lower(label), id"),
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

    fn update_row(
        &self,
        provider: &ProviderWrite,
        audit: &AuditEventWrite,
        credential_changed: bool,
    ) {
        self.database.transaction(|| {
            self.database.run(
                "UPDATE providers SET
                  label = ?, protocol = ?, base_url = ?, headers_json = ?,
                  allow_personal = ?, allow_sensitive = ?, allow_health = ?,
                  enabled = ?, updated_at = ?
                WHERE id = ?",
                &[
                    json!(provider.label),
                    json!(provider.protocol),
                    json!(provider.base_url),
                    json!(provider.headers_json),
                    json!(i64::from(provider.allow_personal)),
                    json!(i64::from(provider.allow_sensitive)),
                    json!(i64::from(provider.allow_health)),
                    json!(i64::from(provider.enabled)),
                    json!(provider.updated_at),
                    json!(provider.id),
                ],
            );
            if credential_changed {
                self.database.run(
                    "UPDATE secret_metadata SET updated_at = ? WHERE provider_id = ?",
                    &[json!(provider.updated_at), json!(provider.id)],
                );
            }
            self.insert_audit(audit);
        });
    }

    fn delete_row(&self, provider_id: &str, audit: &AuditEventWrite) {
        self.database.transaction(|| {
            self.database
                .run("DELETE FROM providers WHERE id = ?", &[json!(provider_id)]);
            self.insert_audit(audit);
        });
    }

    pub fn list(&self) -> Result<Vec<ProviderSummary>, ZeroError> {
        self.list_stored().iter().map(to_summary).collect()
    }

    pub fn create(&self, raw: &Value, correlation_id: &str) -> Result<ProviderSummary, ZeroError> {
        let input = parse_create_provider_input(raw).map_err(parse_failed)?;
        let id = create_correlation_id().to_string();
        let secret_ref = format!("zero.provider.{id}.api-key");
        let now = utc_now();
        let write = provider_write(
            &input.label,
            input.protocol,
            input.base_url.clone(),
            &input.headers,
            &input.privacy,
            input.enabled,
            id.clone(),
            secret_ref.clone(),
            now.clone(),
            now.clone(),
        );
        let summary = to_summary(&stored_from_write(&write))?;
        self.secrets.set(&secret_ref, &input.api_key)?;
        let created = catch_unwind(AssertUnwindSafe(|| {
            if self.fail_create.replace(false) {
                panic!("simulated database failure");
            }
            self.repo().create(
                &write,
                &SecretMetadataWrite {
                    secret_ref: secret_ref.clone(),
                    provider_id: id.clone(),
                    service: ZERO_KEYCHAIN_SERVICE.to_string(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                },
                &audit_event(
                    "provider.created",
                    correlation_id,
                    &id,
                    None,
                    Some(&summary),
                ),
            );
        }));
        if created.is_err() {
            self.secrets.delete(&secret_ref)?;
            return Err(failed(
                ZeroErrorCode::DatabaseFailed,
                "Failed to save provider settings",
            ));
        }
        self.logger.info(LogInput {
            event: "provider.created",
            correlation_id,
            data: Some(json!({ "providerId": id, "protocol": input.protocol })),
        });
        Ok(summary)
    }

    pub fn update(&self, raw: &Value, correlation_id: &str) -> Result<ProviderSummary, ZeroError> {
        let input = parse_update_provider_input(raw).map_err(parse_failed)?;
        let current = self
            .repo()
            .find_by_id(&input.id)
            .ok_or_else(missing_provider)?;
        let before = to_summary(&current)?;
        let now = utc_now();
        let write = provider_write(
            &input.label,
            input.protocol,
            input.base_url.clone(),
            &input.headers,
            &input.privacy,
            input.enabled,
            current.id.clone(),
            current.secret_ref.clone(),
            current.created_at.clone(),
            now,
        );
        let after = to_summary(&stored_from_write(&write))?;
        let previous_secret = if input.api_key.is_some() {
            self.secrets.get(&current.secret_ref)?
        } else {
            None
        };
        if let Some(api_key) = &input.api_key {
            self.secrets.set(&current.secret_ref, api_key)?;
        }
        let updated = catch_unwind(AssertUnwindSafe(|| {
            if self.fail_update.replace(false) {
                panic!("simulated database failure");
            }
            self.update_row(
                &write,
                &audit_event(
                    "provider.updated",
                    correlation_id,
                    &current.id,
                    Some(&before),
                    Some(&after),
                ),
                input.api_key.is_some(),
            );
        }));
        if updated.is_err() {
            if input.api_key.is_some() {
                match previous_secret {
                    None => self.secrets.delete(&current.secret_ref)?,
                    Some(secret) => self.secrets.set(&current.secret_ref, &secret)?,
                }
            }
            return Err(failed(
                ZeroErrorCode::DatabaseFailed,
                "Failed to update provider settings",
            ));
        }
        self.logger.info(LogInput {
            event: "provider.updated",
            correlation_id,
            data: Some(json!({
                "providerId": current.id,
                "credentialChanged": input.api_key.is_some(),
            })),
        });
        Ok(after)
    }

    pub fn delete(&self, id: &str, correlation_id: &str) -> Result<Value, ZeroError> {
        let current = self.repo().find_by_id(id).ok_or_else(missing_provider)?;
        let previous_secret = self.secrets.get(&current.secret_ref)?.ok_or_else(|| {
            failed(
                ZeroErrorCode::IntegrationOffline,
                "Provider credential is unavailable",
            )
        })?;
        self.secrets.delete(&current.secret_ref)?;
        let before = to_summary(&current)?;
        let deleted = catch_unwind(AssertUnwindSafe(|| {
            self.delete_row(
                &current.id,
                &audit_event(
                    "provider.deleted",
                    correlation_id,
                    &current.id,
                    Some(&before),
                    None,
                ),
            );
        }));
        if deleted.is_err() {
            self.secrets.set(&current.secret_ref, &previous_secret)?;
            return Err(failed(
                ZeroErrorCode::DatabaseFailed,
                "Failed to delete provider settings",
            ));
        }
        self.logger.info(LogInput {
            event: "provider.deleted",
            correlation_id,
            data: Some(json!({ "providerId": current.id })),
        });
        Ok(json!({ "deleted": true }))
    }
}
