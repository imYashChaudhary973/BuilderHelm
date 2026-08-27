use std::sync::{Arc, Mutex};

use helm_core::{bootstrap_core, CoreOptions, MemorySecretStore};
use helm_shared::create_correlation_id;

#[test]
fn migrates_an_in_memory_database_and_reports_ready_health() {
    let logs = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink_logs = logs.clone();
    let mut runtime = bootstrap_core(CoreOptions {
        database_path: ":memory:".into(),
        secret_store: Box::new(MemorySecretStore::new()),
        log_sink: Some(Box::new(move |line| {
            sink_logs.lock().unwrap().push(line);
        })),
        model_gateway_fetch: None,
    })
    .expect("bootstrap");
    let correlation_id = create_correlation_id();
    let health = runtime.health(&correlation_id);
    assert_eq!(health.status, "ok");
    assert_eq!(health.database, "ready");
    assert_eq!(health.correlation_id, correlation_id.to_string());
    let joined = logs.lock().unwrap().join("\n");
    assert!(!joined.contains(":memory:"));
    runtime.close();
    let events: Vec<String> = logs
        .lock()
        .unwrap()
        .iter()
        .map(|line| {
            serde_json::from_str::<serde_json::Value>(line)
                .ok()
                .and_then(|value| value.get("event")?.as_str().map(str::to_string))
                .unwrap_or_default()
        })
        .collect();
    assert_eq!(
        events,
        vec!["core.started".to_string(), "core.stopped".to_string()]
    );
}
