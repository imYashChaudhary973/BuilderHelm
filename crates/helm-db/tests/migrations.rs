use std::panic::{catch_unwind, AssertUnwindSafe};

use helm_db::{migrations, open_database_unchecked, run_migrations, Migration, MigrationDatabase};
use serde_json::json;

#[test]
fn migrates_a_clean_database_and_records_the_version() {
    let database = open_database_unchecked(":memory:");
    let result = run_migrations(&database, &migrations());
    assert_eq!(
        result.applied,
        vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    );
    assert_eq!(result.current_version, 13);
    let row = database.query_one(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'zero_metadata'",
        &[],
    )
    .unwrap();
    assert_eq!(
        row.get("count").and_then(serde_json::Value::as_i64),
        Some(1)
    );
}

#[test]
fn adopts_existing_cards_into_a_builderhelm_project_board() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations()[..9]);
    database.run(
        "INSERT INTO kanban_cards (id, workspace, title, column_name, created_at)
         VALUES (?, ?, ?, ?, ?)",
        &[
            json!("00000000-0000-4000-8000-000000000001"),
            json!("global"),
            json!("Existing task"),
            json!("idea"),
            json!("2026-08-24T00:00:00.000Z"),
        ],
    );
    let result = run_migrations(&database, &migrations());
    assert_eq!(result.applied, vec![10, 11, 12, 13]);
    assert_eq!(result.current_version, 13);
    let project = database
        .query_one(
            "SELECT id, name FROM kanban_projects WHERE id = ?",
            &[json!("global")],
        )
        .unwrap();
    assert_eq!(
        project.get("id").and_then(serde_json::Value::as_str),
        Some("global")
    );
    assert_eq!(
        project.get("name").and_then(serde_json::Value::as_str),
        Some("BuilderHelm")
    );
    for column in ["review", "cancelled"] {
        let id = if column == "review" {
            "00000000-0000-4000-8000-000000000002"
        } else {
            "00000000-0000-4000-8000-000000000003"
        };
        database.run(
            "INSERT INTO kanban_cards (id, workspace, title, column_name, created_at)
             VALUES (?, ?, ?, ?, ?)",
            &[
                json!(id),
                json!("global"),
                json!(column),
                json!(column),
                json!("2026-08-24T00:00:01.000Z"),
            ],
        );
    }
    let columns: Vec<_> = database
        .query_all(
            "SELECT column_name FROM kanban_cards WHERE workspace = ? ORDER BY column_name",
            &[json!("global")],
        )
        .into_iter()
        .map(|row| {
            row.get("column_name")
                .and_then(serde_json::Value::as_str)
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(columns, vec!["cancelled", "idea", "review"]);
}

#[test]
fn is_idempotent_after_the_latest_migration() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let result = run_migrations(&database, &migrations());
    assert!(result.applied.is_empty());
    assert_eq!(result.current_version, 13);
}

#[test]
fn migrates_and_reopens_a_clean_database_file() {
    let directory = tempfile_dir();
    let path = directory.join("clean.sqlite");
    let first = open_database_unchecked(path.to_str().unwrap());
    run_migrations(&first, &migrations());
    first.close();
    let reopened = open_database_unchecked(path.to_str().unwrap());
    let result = run_migrations(&reopened, &migrations());
    assert!(result.applied.is_empty());
    assert_eq!(result.current_version, 13);
}

#[test]
fn rejects_a_migration_history_with_a_gap() {
    let database = open_database_unchecked(":memory:");
    fn noop(_: &dyn MigrationDatabase) {}
    let err = catch_unwind(AssertUnwindSafe(|| {
        run_migrations(
            &database,
            &[Migration {
                version: 2,
                name: "invalid-start",
                up: noop,
            }],
        );
    }));
    let payload = err.unwrap_err();
    let message = panic_message(&payload);
    assert!(
        message.contains("Migration sequence is invalid"),
        "{message}"
    );
}

#[test]
fn rolls_back_a_failed_migration() {
    let database = open_database_unchecked(":memory:");
    fn broken(database: &dyn MigrationDatabase) {
        database.execute("CREATE TABLE transient_record (id TEXT PRIMARY KEY)");
        panic!("stop");
    }
    let err = catch_unwind(AssertUnwindSafe(|| {
        run_migrations(
            &database,
            &[Migration {
                version: 1,
                name: "broken",
                up: broken,
            }],
        );
    }));
    let message = panic_message(&err.unwrap_err());
    assert!(message.contains("Failed to apply migration"), "{message}");
    let row = database
        .query_one(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'transient_record'",
            &[],
        )
        .unwrap();
    assert_eq!(
        row.get("count").and_then(serde_json::Value::as_i64),
        Some(0)
    );
}

fn tempfile_dir() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("zero-db-{}", std::process::id()));
    std::fs::create_dir_all(&path).unwrap();
    path
}

fn panic_message(payload: &Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_string()))
        .unwrap_or_default()
}
