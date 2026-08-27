use std::cell::RefCell;
use std::rc::Rc;

use helm_db::{migrations, open_database_unchecked, run_migrations, ProviderRepository};
use helm_observability::create_logger;
use helm_shared::create_correlation_id;
use serde_json::json;

use helm_core::{MemorySecretStore, ProviderService, SecretStore};

fn input() -> serde_json::Value {
    json!({
        "label": "Example",
        "protocol": "openai",
        "baseUrl": "https://api.example.test/v1",
        "headers": [],
        "privacy": { "allowPersonal": true, "allowSensitive": false, "allowHealth": false },
        "enabled": true,
        "apiKey": "phase-one-secret-sentinel",
    })
}

#[test]
fn creates_lists_updates_disables_and_deletes_without_returning_the_credential() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logs = Rc::new(RefCell::new(Vec::<String>::new()));
    let logger = {
        let logs = Rc::clone(&logs);
        create_logger(move |line| logs.borrow_mut().push(line))
    };
    let service = ProviderService::new(&database, &secrets, &logger);
    let cid = create_correlation_id();
    let created = service.create(&input(), cid.as_str()).unwrap();

    assert_eq!(created.label, "Example");
    assert!(created.has_credential);
    assert!(created.enabled);
    let created_json = serde_json::to_string(&created).unwrap();
    assert!(!created_json.contains("phase-one-secret-sentinel"));
    let listed = service.list().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);

    let repository = ProviderRepository::new(&database);
    let stored = repository.find_by_id(&created.id).unwrap();
    assert_eq!(
        secrets.get(&stored.secret_ref).unwrap().as_deref(),
        Some("phase-one-secret-sentinel")
    );

    let mut update = input();
    update["id"] = json!(created.id);
    update["label"] = json!("Example 2");
    update["enabled"] = json!(false);
    update["apiKey"] = json!("replacement-sentinel");
    let updated = service
        .update(&update, create_correlation_id().as_str())
        .unwrap();
    assert_eq!(updated.label, "Example 2");
    assert!(!updated.enabled);
    assert_eq!(
        secrets.get(&stored.secret_ref).unwrap().as_deref(),
        Some("replacement-sentinel")
    );

    let deleted = service
        .delete(&created.id, create_correlation_id().as_str())
        .unwrap();
    assert_eq!(deleted, json!({ "deleted": true }));
    assert!(service.list().unwrap().is_empty());
    assert_eq!(secrets.get(&stored.secret_ref).unwrap(), None);
    let events: Vec<String> = repository
        .list_audit_events()
        .into_iter()
        .map(|event| event.event_type)
        .collect();
    assert_eq!(
        events,
        vec![
            "provider.created".to_string(),
            "provider.updated".to_string(),
            "provider.deleted".to_string()
        ]
    );
    let joined = logs.borrow().join("\n");
    assert!(!joined.contains("phase-one-secret-sentinel"));
    assert!(!joined.contains("replacement-sentinel"));
}

#[test]
fn removes_a_newly_written_secret_when_the_database_create_fails() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = create_logger(|_| {});
    let service = ProviderService::new(&database, &secrets, &logger);
    service.fail_next_create();
    let err = service
        .create(&input(), create_correlation_id().as_str())
        .unwrap_err();
    assert_eq!(err.code, helm_shared::ZeroErrorCode::DatabaseFailed);
    assert!(service.list().unwrap().is_empty());
    assert_eq!(
        secrets.get("zero.provider.unavailable.api-key").unwrap(),
        None
    );
}

#[test]
fn restores_the_previous_secret_when_a_database_update_fails() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = create_logger(|_| {});
    let service = ProviderService::new(&database, &secrets, &logger);
    let created = service
        .create(&input(), create_correlation_id().as_str())
        .unwrap();
    let stored = ProviderRepository::new(&database)
        .find_by_id(&created.id)
        .unwrap();
    service.fail_next_update();
    let mut update = input();
    update["id"] = json!(created.id);
    update["apiKey"] = json!("new-sentinel");
    let err = service
        .update(&update, create_correlation_id().as_str())
        .unwrap_err();
    assert_eq!(err.code, helm_shared::ZeroErrorCode::DatabaseFailed);
    assert_eq!(
        secrets.get(&stored.secret_ref).unwrap().as_deref(),
        Some("phase-one-secret-sentinel")
    );
}
