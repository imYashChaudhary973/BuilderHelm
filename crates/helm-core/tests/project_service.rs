use std::path::{Path, PathBuf};
use std::process::Command;

use helm_core::projects::ProjectRepositoryStore;
use helm_core::{ActionRepository, LocalGitInspector, ProjectService};
use helm_db::{migrations, open_database_unchecked, run_migrations, ZeroDatabase};
use helm_observability::{create_logger, Logger};
use helm_shared::{create_correlation_id, utc_now};
use serde_json::json;

fn exec_git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .status()
        .expect("git");
    assert!(status.success(), "git {args:?}");
}

fn create_repository() -> PathBuf {
    let root = std::env::temp_dir().join(format!("zero-project-git-{}", create_correlation_id()));
    std::fs::create_dir_all(&root).unwrap();
    exec_git(&root, &["init", "-b", "main"]);
    exec_git(&root, &["config", "user.name", "Fixture User"]);
    exec_git(&root, &["config", "user.email", "fixture@example.test"]);
    std::fs::write(root.join("README.md"), "# Fixture\n").unwrap();
    exec_git(&root, &["add", "README.md"]);
    exec_git(&root, &["commit", "-m", "start fixture"]);
    root
}

fn logger() -> Logger {
    create_logger(|_| {})
}

fn insert_project(database: &ZeroDatabase, name: &str) -> String {
    let project_id = create_correlation_id().to_string();
    let now = utc_now();
    database.run(
        "INSERT INTO projects (
          id, name, normalized_name, description, status, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'active', ?, ?)",
        &[
            json!(project_id),
            json!(name),
            json!(name.to_lowercase()),
            json!(now),
            json!(now),
        ],
    );
    project_id
}

fn insert_task(database: &ZeroDatabase, project_id: &str, title: &str, description: Option<&str>) {
    let now = utc_now();
    database.run(
        "INSERT INTO tasks (
          id, project_id, title, normalized_title, description, status, priority,
          due_at, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'todo', 'high', NULL, 'manual', ?, ?)",
        &[
            json!(create_correlation_id().to_string()),
            json!(project_id),
            json!(title),
            json!(title.to_lowercase()),
            json!(description),
            json!(now),
            json!(now),
        ],
    );
}

fn insert_decision(database: &ZeroDatabase, project_id: &str, title: &str, detail: Option<&str>) {
    database.run(
        "INSERT INTO project_decisions (id, project_id, title, detail, created_at)
         VALUES (?, ?, ?, ?, ?)",
        &[
            json!(create_correlation_id().to_string()),
            json!(project_id),
            json!(title),
            json!(detail),
            json!(utc_now()),
        ],
    );
}

#[test]
fn inspects_a_repository_with_fixed_git_operations_and_notices_local_changes() {
    let root = create_repository();
    std::fs::write(root.join("README.md"), "# Fixture\nChanged.\n").unwrap();
    let snapshot = LocalGitInspector::new()
        .inspect(root.to_str().unwrap())
        .unwrap();
    assert_eq!(snapshot.branch, "main");
    assert_eq!(snapshot.dirty_count, 1);
    assert_eq!(snapshot.commits[0].subject, "start fixture");
    assert_eq!(snapshot.commits[0].author_name, "Fixture User");
    assert_eq!(
        snapshot.root_path,
        std::fs::canonicalize(&root).unwrap().to_string_lossy()
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn combines_registered_git_activity_with_project_tasks_and_decisions() {
    let root = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let project_id = create_correlation_id().to_string();
    let task_id = create_correlation_id().to_string();
    let decision_id = create_correlation_id().to_string();
    let now = utc_now();
    database.run(
        "INSERT INTO projects (
          id, name, normalized_name, description, status, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'active', ?, ?)",
        &[
            json!(project_id),
            json!("Axiom"),
            json!("axiom"),
            json!(now),
            json!(now),
        ],
    );
    database.run(
        "INSERT INTO tasks (
          id, project_id, title, normalized_title, description, status, priority,
          due_at, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 'blocked', 'high', NULL, 'manual', ?, ?)",
        &[
            json!(task_id),
            json!(project_id),
            json!("Resolve blocker"),
            json!("resolve blocker"),
            json!(now),
            json!(now),
        ],
    );
    database.run(
        "INSERT INTO project_decisions (id, project_id, title, detail, created_at)
         VALUES (?, ?, ?, NULL, ?)",
        &[
            json!(decision_id),
            json!(project_id),
            json!("Keep Git local"),
            json!(now),
        ],
    );
    let logger = logger();
    let service = ProjectService::new(
        ActionRepository::new(&database),
        ProjectRepositoryStore::new(&database),
        &logger,
    );
    let result = service
        .register_repository(
            &project_id,
            root.to_str().unwrap(),
            &create_correlation_id(),
        )
        .unwrap();
    let repository = result.repository.as_ref().unwrap();
    assert_eq!(repository.branch, "main");
    assert_eq!(repository.dirty_count, 0);
    assert_eq!(
        repository.root_path,
        std::fs::canonicalize(&root).unwrap().to_string_lossy()
    );
    assert!(Path::new(&repository.root_path).is_absolute());
    let kinds: Vec<_> = result
        .timeline
        .iter()
        .map(|item| item.kind.as_str())
        .collect();
    assert!(kinds.contains(&"commit"));
    assert!(kinds.contains(&"task"));
    assert!(kinds.contains(&"decision"));
    assert_eq!(service.dashboard().unwrap().projects.len(), 1);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn keeps_the_dashboard_readable_when_sources_exceed_the_response_bounds() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = ProjectService::new(
        ActionRepository::new(&database),
        ProjectRepositoryStore::new(&database),
        &logger,
    );
    let healthy_id = insert_project(&database, "Healthy");
    let oversized_id = insert_project(&database, "Oversized");
    insert_task(
        &database,
        &oversized_id,
        "Long task",
        Some(&"x".repeat(5_000)),
    );
    insert_decision(
        &database,
        &oversized_id,
        "Long decision",
        Some(&"y".repeat(5_000)),
    );
    for index in 0..501 {
        insert_task(&database, &healthy_id, &format!("Task {index}"), None);
    }
    let snapshot = service.dashboard().unwrap();
    assert_eq!(snapshot.projects.len(), 2);
    let oversized = snapshot
        .projects
        .iter()
        .find(|entry| entry.project.id == oversized_id)
        .unwrap();
    let detail = oversized
        .timeline
        .iter()
        .find(|item| item.kind == "task")
        .and_then(|item| item.detail.as_deref())
        .unwrap();
    assert_eq!(detail.chars().count(), 1_000);
    assert!(detail.ends_with('…'));
    let healthy = snapshot
        .projects
        .iter()
        .find(|entry| entry.project.id == healthy_id)
        .unwrap();
    assert_eq!(healthy.tasks.len(), 500);
}
