use std::panic::{catch_unwind, AssertUnwindSafe};

use helm_db::{migrations, open_database_unchecked, run_migrations};
use serde_json::json;

fn setup() -> helm_db::ZeroDatabase {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    database
}

fn seed_run(database: &helm_db::ZeroDatabase) -> String {
    let id = "00000000-0000-4000-8000-000000000001";
    database.run(
        "INSERT INTO swarm_runs (id, name, folder_path, mission, launch_mode, preset_id,
           skills_json, board_session_id, status, started_at, ended_at, budget_ms)
         VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, 'running', ?, NULL, ?)",
        &[
            json!(id),
            json!("Swarm One"),
            json!("/tmp/repo"),
            json!("ship the feature"),
            json!("auto"),
            json!("skiff"),
            json!("2026-08-25T10:00:00.000Z"),
            json!(20 * 60 * 1000),
        ],
    );
    id.into()
}

fn seed_seat(database: &helm_db::ZeroDatabase, run_id: &str) -> String {
    let id = "00000000-0000-4000-8000-000000000002";
    database.run(
        "INSERT INTO swarm_seats (id, run_id, role, agent_id, mode, pane_id,
           worktree_path, branch, status, tokens_used, cost_usd)
         VALUES (?, ?, 'builder', 'grok', 'auto', NULL, NULL, NULL, 'queued', 0, 0)",
        &[json!(id), json!(run_id)],
    );
    id.into()
}

#[test]
fn creates_the_four_swarm_tables() {
    let database = setup();
    for table in ["swarm_runs", "swarm_seats", "swarm_tasks", "swarm_messages"] {
        let row = database
            .query_one(
                "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name = ?",
                &[json!("table"), json!(table)],
            )
            .unwrap();
        assert_eq!(
            row.get("count").and_then(serde_json::Value::as_i64),
            Some(1)
        );
    }
}

#[test]
fn rejects_invalid_run_status_and_launch_mode() {
    let database = setup();
    let status = catch_unwind(AssertUnwindSafe(|| {
        database.run(
            "INSERT INTO swarm_runs (id, name, folder_path, mission, launch_mode, preset_id,
               skills_json, board_session_id, status, started_at, ended_at, budget_ms)
             VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, 'bogus', ?, NULL, ?)",
            &[
                json!("00000000-0000-4000-8000-000000000009"),
                json!("X"),
                json!("/tmp/r"),
                json!("m"),
                json!("auto"),
                json!("skiff"),
                json!("2026-08-25T10:00:00.000Z"),
                json!(20 * 60 * 1000),
            ],
        );
    }));
    let message = panic_message(&status.unwrap_err());
    assert!(
        message.to_lowercase().contains("check") || message.contains("status"),
        "{message}"
    );
    let mode = catch_unwind(AssertUnwindSafe(|| {
        database.run(
            "INSERT INTO swarm_runs (id, name, folder_path, mission, launch_mode, preset_id,
               skills_json, board_session_id, status, started_at, ended_at, budget_ms)
             VALUES (?, ?, ?, ?, 'yolo', ?, '[]', NULL, 'running', ?, NULL, ?)",
            &[
                json!("00000000-0000-4000-8000-000000000009"),
                json!("X"),
                json!("/tmp/r"),
                json!("m"),
                json!("skiff"),
                json!("2026-08-25T10:00:00.000Z"),
                json!(20 * 60 * 1000),
            ],
        );
    }));
    let message = panic_message(&mode.unwrap_err());
    assert!(
        message.to_lowercase().contains("check") || message.contains("launch_mode"),
        "{message}"
    );
}

#[test]
fn stores_tasks_with_file_ownership_and_dependency_json() {
    let database = setup();
    let run_id = seed_run(&database);
    let seat_id = seed_seat(&database, &run_id);
    let task_id = "00000000-0000-4000-8000-000000000003";
    database.run(
        "INSERT INTO swarm_tasks (id, run_id, seat_id, title, detail, files_json,
           status, depends_on_json, attempts, landed_commit, created_at, updated_at)
         VALUES (?, ?, ?, 'Implement X', NULL, ?, 'pending', ?, 0, NULL, ?, ?)",
        &[
            json!(task_id),
            json!(run_id),
            json!(seat_id),
            json!(json!(["src/x.ts"]).to_string()),
            json!("[]"),
            json!("2026-08-25T10:00:00.000Z"),
            json!("2026-08-25T10:00:00.000Z"),
        ],
    );
    let row = database
        .query_one(
            "SELECT files_json, depends_on_json FROM swarm_tasks WHERE id = ?",
            &[json!(task_id)],
        )
        .unwrap();
    let files: serde_json::Value = serde_json::from_str(
        row.get("files_json")
            .and_then(serde_json::Value::as_str)
            .unwrap(),
    )
    .unwrap();
    let deps: serde_json::Value = serde_json::from_str(
        row.get("depends_on_json")
            .and_then(serde_json::Value::as_str)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(files, json!(["src/x.ts"]));
    assert_eq!(deps, json!([]));
}

#[test]
fn keeps_messages_append_only_and_protects_run_history() {
    let database = setup();
    let run_id = seed_run(&database);
    let seat_id = seed_seat(&database, &run_id);
    let message_id = "00000000-0000-4000-8000-000000000004";
    database.run(
        "INSERT INTO swarm_messages (id, run_id, seat_id, kind, body, created_at)
         VALUES (?, ?, ?, 'directive', 'wrap up', ?)",
        &[
            json!(message_id),
            json!(run_id),
            json!(seat_id),
            json!("2026-08-25T10:01:00.000Z"),
        ],
    );
    let update = catch_unwind(AssertUnwindSafe(|| {
        database.run(
            "UPDATE swarm_messages SET body = ? WHERE id = ?",
            &[json!("rewritten"), json!(message_id)],
        );
    }));
    assert!(panic_message(&update.unwrap_err()).contains("append-only"));
    let delete = catch_unwind(AssertUnwindSafe(|| {
        database.run(
            "DELETE FROM swarm_messages WHERE id = ?",
            &[json!(message_id)],
        );
    }));
    assert!(panic_message(&delete.unwrap_err()).contains("append-only"));
    assert!(catch_unwind(AssertUnwindSafe(|| {
        database.run("DELETE FROM swarm_runs WHERE id = ?", &[json!(run_id)]);
    }))
    .is_err());
    assert_eq!(
        database
            .query_one("SELECT COUNT(*) AS count FROM swarm_messages", &[])
            .unwrap()
            .get("count")
            .and_then(serde_json::Value::as_i64),
        Some(1)
    );
    assert_eq!(
        database
            .query_one("SELECT COUNT(*) AS count FROM swarm_seats", &[])
            .unwrap()
            .get("count")
            .and_then(serde_json::Value::as_i64),
        Some(1)
    );
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_default()
}
