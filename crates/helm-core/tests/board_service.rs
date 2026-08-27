use std::path::{Path, PathBuf};
use std::process::Command;

use helm_core::BoardService;
use helm_db::{migrations, open_database_unchecked, run_migrations};
use helm_observability::create_logger;
use helm_protocol::KanbanColumn;
use helm_shared::create_correlation_id;

fn exec_git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .status()
        .expect("git");
    assert!(status.success(), "git {args:?}");
}

fn create_repository() -> PathBuf {
    let root = std::env::temp_dir().join(format!("zero-board-git-{}", create_correlation_id()));
    std::fs::create_dir_all(&root).unwrap();
    exec_git(&root, &["init", "-b", "main"]);
    exec_git(&root, &["config", "user.name", "Fixture User"]);
    exec_git(&root, &["config", "user.email", "fixture@example.test"]);
    std::fs::write(root.join("README.md"), "# Fixture\n").unwrap();
    exec_git(&root, &["add", "README.md"]);
    exec_git(&root, &["commit", "-m", "start fixture"]);
    root
}

fn logger() -> helm_observability::Logger {
    create_logger(|_| {})
}

#[tokio::test(flavor = "current_thread")]
async fn creates_an_isolated_branch_and_reports_it() {
    let repo = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = BoardService::new(&database, &logger);
    let worktree = service
        .create_worktree(repo.to_str().unwrap(), "p1-test", &create_correlation_id())
        .await
        .unwrap();
    assert_eq!(worktree.branch, "exeum/p1-test");
    assert_eq!(Path::new(&worktree.path).file_name().unwrap(), "p1-test");
    assert_eq!(
        service.read_branch(&worktree.path).await.as_deref(),
        Some("exeum/p1-test")
    );
    assert_eq!(
        service.read_branch(repo.to_str().unwrap()).await.as_deref(),
        Some("main")
    );
    let _ = std::fs::remove_dir_all(repo);
}

#[tokio::test(flavor = "current_thread")]
async fn merges_a_non_overlapping_pane_branch_into_main() {
    let repo = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = BoardService::new(&database, &logger);
    let worktree = service
        .create_worktree(repo.to_str().unwrap(), "p1-test", &create_correlation_id())
        .await
        .unwrap();
    std::fs::write(Path::new(&worktree.path).join("extra.md"), "from pane\n").unwrap();
    exec_git(Path::new(&worktree.path), &["add", "extra.md"]);
    exec_git(Path::new(&worktree.path), &["commit", "-m", "pane work"]);
    let result = service
        .land_branch(
            repo.to_str().unwrap(),
            &worktree.branch,
            &create_correlation_id(),
        )
        .await
        .unwrap();
    assert!(result.landed);
    assert!(result.head.len() >= 7);
    assert_eq!(
        std::fs::read_to_string(repo.join("extra.md")).unwrap(),
        "from pane\n"
    );
    assert!(!repo.join(".git").join("MERGE_HEAD").exists());
    let _ = std::fs::remove_dir_all(repo);
}

#[tokio::test(flavor = "current_thread")]
async fn previews_a_pane_branch_without_merging() {
    let repo = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = BoardService::new(&database, &logger);
    let worktree = service
        .create_worktree(repo.to_str().unwrap(), "p1-test", &create_correlation_id())
        .await
        .unwrap();
    std::fs::write(Path::new(&worktree.path).join("extra.md"), "from pane\n").unwrap();
    exec_git(Path::new(&worktree.path), &["add", "extra.md"]);
    exec_git(Path::new(&worktree.path), &["commit", "-m", "pane work"]);
    let preview = service
        .preview_land(
            repo.to_str().unwrap(),
            &worktree.branch,
            &create_correlation_id(),
        )
        .await
        .unwrap();
    assert_eq!(preview.ahead, 1);
    assert_eq!(preview.files, vec!["extra.md".to_string()]);
    assert!(preview.stat.contains("extra.md"));
    assert!(!repo.join("extra.md").exists());
    let _ = std::fs::remove_dir_all(repo);
}

#[tokio::test(flavor = "current_thread")]
async fn aborts_a_conflicting_land_and_leaves_main_clean() {
    let repo = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = BoardService::new(&database, &logger);
    let worktree = service
        .create_worktree(repo.to_str().unwrap(), "p1-test", &create_correlation_id())
        .await
        .unwrap();
    std::fs::write(Path::new(&worktree.path).join("README.md"), "pane\n").unwrap();
    exec_git(Path::new(&worktree.path), &["add", "README.md"]);
    exec_git(Path::new(&worktree.path), &["commit", "-m", "pane readme"]);
    std::fs::write(repo.join("README.md"), "mainline\n").unwrap();
    exec_git(&repo, &["add", "README.md"]);
    exec_git(&repo, &["commit", "-m", "main readme"]);
    let error = service
        .land_branch(
            repo.to_str().unwrap(),
            &worktree.branch,
            &create_correlation_id(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, helm_shared::ZeroErrorCode::ToolExecutionFailed);
    assert_eq!(
        std::fs::read_to_string(repo.join("README.md")).unwrap(),
        "mainline\n"
    );
    assert!(!repo.join(".git").join("MERGE_HEAD").exists());
    let _ = std::fs::remove_dir_all(repo);
}

#[tokio::test(flavor = "current_thread")]
async fn rejects_branches_that_are_not_exeum_pane_branches() {
    let repo = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = BoardService::new(&database, &logger);
    let error = service
        .land_branch(repo.to_str().unwrap(), "main", &create_correlation_id())
        .await
        .unwrap_err();
    assert_eq!(error.code, helm_shared::ZeroErrorCode::ValidationFailed);
    let _ = std::fs::remove_dir_all(repo);
}

#[tokio::test(flavor = "current_thread")]
async fn initializes_a_plain_folder_with_an_empty_commit() {
    let folder = std::env::temp_dir().join(format!("zero-board-plain-{}", create_correlation_id()));
    std::fs::create_dir_all(&folder).unwrap();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = BoardService::new(&database, &logger);
    let first = service
        .ensure_repository(folder.to_str().unwrap())
        .await
        .unwrap();
    let second = service
        .ensure_repository(folder.to_str().unwrap())
        .await
        .unwrap();
    assert!(first.initialized);
    assert!(!first.branch.is_empty());
    assert!(!second.initialized);
    assert_eq!(second.branch, first.branch);
    let worktree = service
        .create_worktree(
            folder.to_str().unwrap(),
            "p1-plain",
            &create_correlation_id(),
        )
        .await
        .unwrap();
    assert_eq!(worktree.branch, "exeum/p1-plain");
    let _ = std::fs::remove_dir_all(folder);
}

#[tokio::test(flavor = "current_thread")]
async fn leaves_an_existing_repository_untouched() {
    let repo = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = BoardService::new(&database, &logger);
    let result = service
        .ensure_repository(repo.to_str().unwrap())
        .await
        .unwrap();
    assert!(!result.initialized);
    assert_eq!(result.branch, "main");
    let _ = std::fs::remove_dir_all(repo);
}

#[test]
fn keeps_project_boards_and_their_tasks_isolated() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let service = BoardService::new(&database, &logger);
    let correlation_id = create_correlation_id();
    let builder_helm = service
        .create_project("BuilderHelm", &correlation_id)
        .unwrap();
    let zen_voice = service.create_project("ZenVoice", &correlation_id).unwrap();
    let builder_task = service
        .create_card(
            &builder_helm.id,
            "Ship multi-project boards",
            &correlation_id,
            None,
        )
        .unwrap();
    service
        .create_card(&zen_voice.id, "Refine voice capture", &correlation_id, None)
        .unwrap();
    assert_eq!(
        service
            .list_cards(&builder_helm.id)
            .iter()
            .map(|card| card.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Ship multi-project boards"]
    );
    assert_eq!(
        service
            .list_cards(&zen_voice.id)
            .iter()
            .map(|card| card.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Refine voice capture"]
    );
    assert_eq!(
        service
            .move_card(&builder_task.id, KanbanColumn::Review, &correlation_id)
            .unwrap()
            .column,
        KanbanColumn::Review
    );
    assert_eq!(
        service
            .move_card(&builder_task.id, KanbanColumn::Cancelled, &correlation_id)
            .unwrap()
            .column,
        KanbanColumn::Cancelled
    );
    assert_eq!(
        service.list_cards(&zen_voice.id)[0].column,
        KanbanColumn::Idea
    );
    let mut projects: Vec<_> = service
        .list_projects()
        .into_iter()
        .map(|project| (project.name, project.task_count))
        .collect();
    projects.sort_by(|left, right| left.0.cmp(&right.0));
    assert_eq!(
        projects,
        vec![("BuilderHelm".into(), 1), ("ZenVoice".into(), 1),]
    );
    let review_card = service
        .create_card(
            &builder_helm.id,
            "Review this",
            &correlation_id,
            Some(KanbanColumn::Review),
        )
        .unwrap();
    assert_eq!(review_card.column, KanbanColumn::Review);
    assert_eq!(
        service
            .update_card(&review_card.id, "Reviewed this", &correlation_id)
            .unwrap()
            .title,
        "Reviewed this"
    );
    assert!(
        service
            .delete_card(&review_card.id, &correlation_id)
            .unwrap()
            .deleted
    );
    assert_eq!(
        service
            .list_cards(&builder_helm.id)
            .iter()
            .map(|card| card.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Ship multi-project boards"]
    );
    assert!(service
        .update_card(&review_card.id, "Gone", &correlation_id)
        .unwrap_err()
        .message()
        .contains("gone"));
    assert!(service
        .create_project("zenvoice", &correlation_id)
        .unwrap_err()
        .message()
        .contains("already exists"));
}

#[tokio::test(flavor = "current_thread")]
async fn reuses_one_probe_so_launch_does_not_pay_the_timeout_twice() {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let first = board.detect_agents();
    let second = board.detect_agents();
    let first = first.await;
    let second = second.await;
    assert_eq!(first, second);
}
