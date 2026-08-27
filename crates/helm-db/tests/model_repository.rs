use std::panic::{catch_unwind, AssertUnwindSafe};

use helm_db::{
    migrations, open_database_unchecked, run_migrations, AuditEventWrite, ModelCapabilitiesWrite,
    ModelCapabilityBaseline, ModelRepository, ModelWrite, SetCapabilityOverride,
};
use helm_shared::{create_correlation_id, utc_now};
use serde_json::json;

fn id() -> String {
    create_correlation_id().to_string()
}

fn setup() -> (helm_db::ZeroDatabase, String) {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let provider_id = id();
    let now = utc_now();
    database.run(
        "INSERT INTO providers (
          id, label, protocol, base_url, secret_ref, headers_json,
          allow_personal, allow_sensitive, allow_health, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        &[
            json!(provider_id),
            json!("OpenAI"),
            json!("openai"),
            json!(null),
            json!(format!("zero.provider.{provider_id}.api-key")),
            json!("[]"),
            json!(1),
            json!(0),
            json!(0),
            json!(1),
            json!(now),
            json!(now),
        ],
    );
    (database, provider_id)
}

fn caps(metadata_json: &str) -> ModelCapabilitiesWrite {
    ModelCapabilitiesWrite {
        text: true,
        vision: false,
        audio_input: false,
        tool_calling: false,
        parallel_tools: false,
        structured_output: false,
        streaming: true,
        reasoning_controls: false,
        server_web_search: false,
        server_mcp: false,
        context_window: None,
        max_output_tokens: None,
        metadata_json: metadata_json.into(),
    }
}

fn model(provider_id: &str, model_id: &str, metadata_json: &str) -> ModelWrite {
    let now = utc_now();
    ModelWrite {
        id: format!("{provider_id}:{model_id}"),
        provider_id: provider_id.into(),
        model_id: model_id.into(),
        label: model_id.into(),
        privacy_class: "remote".into(),
        enabled: true,
        created_at: now.clone(),
        updated_at: now,
        capabilities: caps(metadata_json),
    }
}

fn audit(event_type: &str) -> AuditEventWrite {
    AuditEventWrite {
        id: id(),
        event_type: event_type.into(),
        actor_type: "user".into(),
        actor_id: None,
        correlation_id: create_correlation_id().to_string(),
        risk_level: "medium".into(),
        resource_refs_json: "[]".into(),
        before_json: None,
        after_json: Some("{}".into()),
        approval_id: None,
        created_at: utc_now(),
    }
}

#[test]
fn atomically_replaces_a_provider_catalog_and_its_capabilities() {
    let (database, provider_id) = setup();
    let repository = ModelRepository::new(&database);
    repository.replace_for_provider(
        &provider_id,
        &[
            model(&provider_id, "gpt-a", "{\"tags\":[]}"),
            model(&provider_id, "gpt-b", "{\"tags\":[]}"),
        ],
        &[],
    );
    assert_eq!(
        repository
            .list(Some(&provider_id))
            .into_iter()
            .map(|m| m.model_id)
            .collect::<Vec<_>>(),
        vec!["gpt-a", "gpt-b"]
    );
    repository.replace_for_provider(
        &provider_id,
        &[model(&provider_id, "gpt-c", "{\"tags\":[]}")],
        &[],
    );
    let listed = repository.list(Some(&provider_id));
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, format!("{provider_id}:gpt-c"));
    assert_eq!(listed[0].model_id, "gpt-c");
    assert_eq!(listed[0].text, 1);
    assert_eq!(listed[0].streaming, 1);
}

#[test]
fn preserves_the_previous_catalog_when_a_replacement_fails() {
    let (database, provider_id) = setup();
    let repository = ModelRepository::new(&database);
    repository.replace_for_provider(
        &provider_id,
        &[model(&provider_id, "stable", "{\"tags\":[]}")],
        &[],
    );
    let failed = catch_unwind(AssertUnwindSafe(|| {
        repository.replace_for_provider(
            &provider_id,
            &[
                model(&provider_id, "candidate", "{\"tags\":[]}"),
                model(&provider_id, "invalid", "not-json"),
            ],
            &[],
        );
    }));
    assert!(failed.is_err());
    assert_eq!(
        repository
            .list(Some(&provider_id))
            .into_iter()
            .map(|m| m.model_id)
            .collect::<Vec<_>>(),
        vec!["stable"]
    );
}

#[test]
fn rejects_models_assigned_to_a_different_provider_before_deleting_data() {
    let (database, provider_id) = setup();
    let repository = ModelRepository::new(&database);
    repository.replace_for_provider(
        &provider_id,
        &[model(&provider_id, "stable", "{\"tags\":[]}")],
        &[],
    );
    let failed = catch_unwind(AssertUnwindSafe(|| {
        repository.replace_for_provider(
            &provider_id,
            &[model(&id(), "wrong", "{\"tags\":[]}")],
            &[],
        );
    }));
    let message = panic_message(&failed.unwrap_err());
    assert!(message.contains("different provider"), "{message}");
    assert_eq!(
        repository
            .list(Some(&provider_id))
            .into_iter()
            .map(|m| m.model_id)
            .collect::<Vec<_>>(),
        vec!["stable"]
    );
}

#[test]
fn persists_capability_overrides_across_catalog_replacement_and_clears_atomically() {
    let (database, provider_id) = setup();
    let repository = ModelRepository::new(&database);
    let initial = model(&provider_id, "configurable", "{\"tags\":[]}");
    repository.replace_for_provider(&provider_id, std::slice::from_ref(&initial), &[]);
    let mut vision = initial.capabilities.clone();
    vision.vision = true;
    let base = json!({ "vision": false }).to_string();
    let updated = utc_now();
    let audit_row = audit("model.capability_override_updated");
    repository.set_capability_override(SetCapabilityOverride {
        provider_id: &provider_id,
        model_id: "configurable",
        overrides_json: Some("{\"vision\":true}"),
        base_capabilities_json: &base,
        effective: &vision,
        updated_at: &updated,
        audit: &audit_row,
    });
    assert_eq!(repository.list(Some(&provider_id))[0].vision, 1);
    let overrides = repository.list_capability_overrides(Some(&provider_id));
    assert_eq!(overrides[0].model_id, "configurable");
    assert_eq!(overrides[0].overrides_json, "{\"vision\":true}");
    let mut replaced = initial.clone();
    replaced.capabilities.vision = true;
    repository.replace_for_provider(
        &provider_id,
        &[replaced],
        &[ModelCapabilityBaseline {
            model_id: "configurable".into(),
            capabilities_json: json!({ "vision": false, "toolCalling": true }).to_string(),
        }],
    );
    let after = &repository.list_capability_overrides(Some(&provider_id))[0];
    assert_eq!(after.overrides_json, "{\"vision\":true}");
    assert_eq!(
        after.base_capabilities_json,
        json!({ "vision": false, "toolCalling": true }).to_string()
    );
    let base = json!({ "vision": false }).to_string();
    let updated = utc_now();
    let audit_row = audit("model.capability_override_cleared");
    repository.set_capability_override(SetCapabilityOverride {
        provider_id: &provider_id,
        model_id: "configurable",
        overrides_json: None,
        base_capabilities_json: &base,
        effective: &initial.capabilities,
        updated_at: &updated,
        audit: &audit_row,
    });
    assert!(repository
        .list_capability_overrides(Some(&provider_id))
        .is_empty());
    assert_eq!(repository.list(Some(&provider_id))[0].vision, 0);
    assert_eq!(
        database
            .query_all(
                "SELECT event_type AS eventType FROM audit_events ORDER BY created_at, id",
                &[],
            )
            .len(),
        2
    );
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_default()
}
