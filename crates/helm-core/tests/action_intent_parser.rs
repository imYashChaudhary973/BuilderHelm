use helm_core::{normalize_work_name, parse_deterministic_action, ActionRepository};
use helm_db::{migrations, open_database_unchecked, run_migrations};
use helm_shared::{create_id, utc_now};
use serde_json::json;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

#[test]
fn parses_the_canonical_tomorrow_task_command_without_invoking_a_model() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let repository = ActionRepository::new(&database);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let project_id = create_id(timestamp).to_string();
    let now = utc_now();
    database.run(
        "INSERT INTO projects (
        id, name, normalized_name, description, status, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, 'active', ?, ?)",
        &[
            json!(project_id),
            json!("Project A"),
            json!(normalize_work_name("Project A")),
            json!(now),
            json!(now),
        ],
    );

    let intent = parse_deterministic_action(
        "Add a high-priority task to Project A to benchmark the sync layer tomorrow.",
        &repository,
        OffsetDateTime::parse("2026-08-11T10:00:00+05:30", &Rfc3339).unwrap(),
    )
    .expect("intent");

    assert_eq!(intent.tool_id, "task.create");
    assert_eq!(intent.input["projectId"], json!(project_id));
    assert_eq!(intent.input["title"], json!("benchmark the sync layer"));
    assert_eq!(intent.input["priority"], json!("high"));
    let due_at = intent.input["dueAt"].as_str().unwrap();
    assert_eq!(&due_at[..10], "2026-08-12");
}
