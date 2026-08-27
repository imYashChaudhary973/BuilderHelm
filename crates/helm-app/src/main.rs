mod engine;

use std::env;
use std::path::PathBuf;

use helm_core::{bootstrap_core, CoreOptions, MemorySecretStore};
use helm_pty::BoardPtyManager;
use helm_shared::create_correlation_id;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("engine") {
        // `--test-controls` is opt-in so a production launch cannot reset the
        // host or preload dialog answers.
        let test_controls = args.iter().any(|arg| arg == "--test-controls");
        std::process::exit(engine::run(test_controls));
    }
    if args.get(1).map(String::as_str) == Some("--conformance") {
        let root = args
            .get(2)
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("conformance"));
        std::process::exit(helm_host::run_conformance(&root));
    }
    // Same corpus, same fixture setup, but every call crosses the sidecar
    // process boundary. This is the phase A transport gate.
    if args.get(1).map(String::as_str) == Some("--conformance-sidecar") {
        let root = args
            .get(2)
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("conformance"));
        let bin = match env::current_exe() {
            Ok(bin) => bin,
            Err(error) => {
                eprintln!("current_exe: {error}");
                std::process::exit(2);
            }
        };
        std::process::exit(helm_host::run_conformance_sidecar(&root, &bin));
    }
    let rt = tokio::runtime::Runtime::new().expect("runtime");
    if let Err(error) = rt.block_on(headless_smoke()) {
        eprintln!("smoke failed: {error}");
        std::process::exit(1);
    }
}

async fn headless_smoke() -> Result<(), String> {
    let _core = bootstrap_core(CoreOptions {
        database_path: ":memory:".into(),
        secret_store: Box::new(MemorySecretStore::new()),
        log_sink: None,
        model_gateway_fetch: None,
    })
    .map_err(|err| err.message().to_string())?;
    let host = helm_host::Host::for_conformance();
    let health = host
        .invoke(
            "zero:system:health",
            serde_json::json!({ "correlationId": create_correlation_id().to_string() }),
        )
        .await;
    if health.get("status") != Some(&serde_json::Value::String("ok".into())) {
        return Err("health".into());
    }
    let folder = env::temp_dir().join(format!("helm-smoke-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&folder);
    let created = host
        .invoke(
            "zero:board:create",
            serde_json::json!({
                "correlationId": create_correlation_id().to_string(),
                "folderPath": folder.to_string_lossy(),
                "isolation": "shared",
                "paneCount": 1,
                "panes": [{ "slot": 0, "agentId": "shell" }]
            }),
        )
        .await;
    if created.get("ok") != Some(&serde_json::Value::Bool(true)) {
        return Err(format!("board create {created}"));
    }
    let _ = BoardPtyManager::new();
    let _ = std::fs::remove_dir_all(&folder);
    println!("headless smoke ok");
    Ok(())
}
