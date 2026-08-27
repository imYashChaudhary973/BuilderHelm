use std::panic::{catch_unwind, AssertUnwindSafe};

use helm_db::{
    migrations, open_database_unchecked, run_migrations, AuditEventWrite, ProviderRepository,
    ProviderWrite, SecretMetadataWrite,
};
use helm_shared::{create_correlation_id, utc_now};
use serde_json::json;

fn id() -> String {
    create_correlation_id().to_string()
}

#[test]
fn persists_provider_metadata_and_append_only_audit_evidence_without_a_secret_value() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let repository = ProviderRepository::new(&database);
    let now = utc_now();
    let provider_id = id();
    let secret_ref = format!("zero.provider.{provider_id}.api-key");
    repository.create(
        &ProviderWrite {
            id: provider_id.clone(),
            label: "Local test".into(),
            protocol: "openai".into(),
            base_url: Some("https://api.example.test/v1".into()),
            secret_ref: secret_ref.clone(),
            headers_json: "[]".into(),
            allow_personal: true,
            allow_sensitive: false,
            allow_health: false,
            enabled: true,
            created_at: now.clone(),
            updated_at: now.clone(),
        },
        &SecretMetadataWrite {
            secret_ref: secret_ref.clone(),
            provider_id: provider_id.clone(),
            service: "test.keychain".into(),
            created_at: now.clone(),
            updated_at: now.clone(),
        },
        &AuditEventWrite {
            id: id(),
            event_type: "provider.created".into(),
            actor_type: "user".into(),
            actor_id: None,
            correlation_id: create_correlation_id().to_string(),
            risk_level: "destructive_sensitive".into(),
            resource_refs_json: json!([{ "type": "provider", "id": provider_id }]).to_string(),
            before_json: None,
            after_json: Some(json!({ "id": provider_id, "hasCredential": true }).to_string()),
            approval_id: None,
            created_at: now,
        },
    );
    let stored = repository.find_by_id(&provider_id).unwrap();
    assert_eq!(stored.label, "Local test");
    assert_eq!(stored.secret_ref, secret_ref);
    assert_eq!(repository.list_audit_events().len(), 1);
    let update = catch_unwind(AssertUnwindSafe(|| {
        database.run(
            "UPDATE audit_events SET event_type = ?",
            &[json!("tampered")],
        );
    }));
    assert!(panic_message(&update.unwrap_err()).contains("append-only"));
    let delete = catch_unwind(AssertUnwindSafe(|| {
        database.run("DELETE FROM audit_events", &[]);
    }));
    assert!(panic_message(&delete.unwrap_err()).contains("append-only"));
}

#[test]
fn enforces_provider_privacy_flags_and_valid_json_at_the_database_boundary() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let failed = catch_unwind(AssertUnwindSafe(|| {
        database.run(
            "INSERT INTO providers (
              id, label, protocol, base_url, secret_ref, headers_json,
              allow_personal, allow_sensitive, allow_health, enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                json!(id()),
                json!("Bad"),
                json!("openai"),
                json!(null),
                json!("ref"),
                json!("not-json"),
                json!(1),
                json!(0),
                json!(0),
                json!(1),
                json!(utc_now()),
                json!(utc_now()),
            ],
        );
    }));
    assert!(failed.is_err());
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_default()
}
