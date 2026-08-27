use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Command;
use std::sync::{Arc, Mutex};

use helm_core::BoardService;
use helm_db::{migrations, open_database_unchecked, run_migrations, ZeroDatabase};
use helm_observability::{create_logger, Logger};
use helm_protocol::{BoardAgentId, SwarmLaunchMode, SwarmPresetId, SwarmRole};
use helm_shared::create_correlation_id;
use helm_swarm::{
    workspace_targets_for_files, SwarmCreateInput, SwarmExecuteInput, SwarmRunnerOutcome,
    SwarmSeatAssignment, SwarmSeatRunner, SwarmService, SwarmServiceOptions, SwarmTaskSpec,
    SwarmTaskVerifier, SwarmVerifyInput, SwarmVerifyResult,
};

fn logger() -> Logger {
    create_logger(|_| {})
}

fn git(cwd: &str, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap_or_else(|error| panic!("git {args:?} failed to spawn: {error}"));
    assert!(
        output.status.success(),
        "git {args:?} failed: {}{}",
        String::from_utf8_lossy(&output.stderr).trim(),
        String::from_utf8_lossy(&output.stdout).trim()
    );
}

fn create_repository() -> (PathBuf, PathBuf) {
    let unique = std::env::temp_dir().join(format!(
        "zero-swarm-git-{}-{}",
        std::process::id(),
        create_correlation_id()
    ));
    std::fs::create_dir_all(&unique).unwrap();
    let worktrees = PathBuf::from(format!("{}-worktrees", unique.display()));
    git(unique.to_str().unwrap(), &["init", "-b", "main"]);
    git(
        unique.to_str().unwrap(),
        &["config", "user.name", "Fixture User"],
    );
    git(
        unique.to_str().unwrap(),
        &["config", "user.email", "fixture@example.test"],
    );
    std::fs::write(unique.join("README.md"), "# Fixture\n").unwrap();
    git(unique.to_str().unwrap(), &["add", "README.md"]);
    git(unique.to_str().unwrap(), &["commit", "-m", "start fixture"]);
    (unique, worktrees)
}

struct Committing(Arc<Mutex<Vec<String>>>);

impl SwarmSeatRunner for Committing {
    fn execute(
        &self,
        input: SwarmExecuteInput,
    ) -> Pin<Box<dyn Future<Output = SwarmRunnerOutcome> + '_>> {
        Box::pin(async move {
            let file = format!(
                "{}.md",
                input
                    .task
                    .title
                    .chars()
                    .map(|ch| if ch.is_ascii_alphanumeric() {
                        ch.to_ascii_lowercase()
                    } else {
                        '-'
                    })
                    .collect::<String>()
            );
            std::fs::write(
                PathBuf::from(&input.worktree_path).join(&file),
                format!("{} attempt {}\n", input.task.title, input.task.attempts),
            )
            .unwrap();
            git(&input.worktree_path, &["add", "-A"]);
            git(&input.worktree_path, &["commit", "-m", &input.task.title]);
            self.0.lock().unwrap().push(input.task.title);
            SwarmRunnerOutcome {
                status: "landed".into(),
                summary: "work committed".into(),
                tokens_used: 120,
                cost_usd: 0.02,
                output: None,
            }
        })
    }
}

struct Passing;

impl SwarmTaskVerifier for Passing {
    fn verify(
        &self,
        _input: SwarmVerifyInput,
    ) -> Pin<Box<dyn Future<Output = SwarmVerifyResult> + '_>> {
        Box::pin(async {
            SwarmVerifyResult {
                ok: true,
                detail: "stub gate".into(),
            }
        })
    }
}

struct FailingRunner;

impl SwarmSeatRunner for FailingRunner {
    fn execute(
        &self,
        input: SwarmExecuteInput,
    ) -> Pin<Box<dyn Future<Output = SwarmRunnerOutcome> + '_>> {
        Box::pin(async move {
            SwarmRunnerOutcome {
                status: "failed".into(),
                summary: "agent gave up".into(),
                tokens_used: 10,
                cost_usd: 0.0,
                output: Some(input.task.title),
            }
        })
    }
}

fn create_input(repo: &str, builders: usize) -> SwarmCreateInput {
    let mut seats = vec![SwarmSeatAssignment {
        role: SwarmRole::Coordinator,
        agent_id: BoardAgentId::Claude,
        model: None,
    }];
    for _ in 0..builders {
        seats.push(SwarmSeatAssignment {
            role: SwarmRole::Builder,
            agent_id: BoardAgentId::Grok,
            model: None,
        });
    }
    SwarmCreateInput {
        name: "Test Swarm".into(),
        folder_path: repo.into(),
        mission: "ship the fixtures".into(),
        launch_mode: SwarmLaunchMode::Auto,
        preset_id: SwarmPresetId::Skiff,
        skill_ids: vec!["tdd".into()],
        skill_directives: Default::default(),
        seats,
    }
}

fn add(service: &SwarmService, run_id: &str, title: &str, files: &[&str], depends: Vec<String>) {
    service
        .add_task(
            run_id,
            SwarmTaskSpec {
                title: title.into(),
                detail: None,
                files: files.iter().map(|f| f.to_string()).collect(),
                depends_on: depends,
            },
            create_correlation_id(),
        )
        .unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn lands_independent_tasks_and_finishes_the_run() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let log = Arc::new(Mutex::new(Vec::new()));
    let runner = Committing(log.clone());
    let verifier = Passing;
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(runner),
        Arc::new(verifier),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    add(
        &service,
        &run.id,
        "Alpha",
        &["packages/db/src/a.ts"],
        vec![],
    );
    add(&service, &run.id, "Beta", &["packages/db/src/b.ts"], vec![]);
    service.pump(&run.id).await;
    let state = service.state(&run.id).unwrap();
    assert_eq!(
        state
            .tasks
            .iter()
            .map(|t| t.status.as_str())
            .collect::<Vec<_>>(),
        vec!["landed", "landed"]
    );
    assert_eq!(state.run.status, "done");
    assert!(state.tasks.iter().all(|t| t.landed_commit.is_some()));
    assert_eq!(
        *log.lock().unwrap(),
        vec!["Alpha".to_string(), "Beta".to_string()]
    );
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn holds_a_dependent_task_until_its_dependency_lands() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let log = Arc::new(Mutex::new(Vec::new()));
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(log.clone())),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 2),
            create_correlation_id(),
        )
        .unwrap();
    let first = service
        .add_task(
            &run.id,
            SwarmTaskSpec {
                title: "Base".into(),
                detail: None,
                files: vec!["packages/db/src/base.ts".into()],
                depends_on: vec![],
            },
            create_correlation_id(),
        )
        .unwrap();
    add(
        &service,
        &run.id,
        "Dependent",
        &["packages/db/src/dep.ts"],
        vec![first.id],
    );
    service.pump(&run.id).await;
    assert_eq!(
        *log.lock().unwrap(),
        vec!["Base".to_string(), "Dependent".to_string()]
    );
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn retries_a_failing_task_once_then_skips_dependents() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(FailingRunner),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    let broken = service
        .add_task(
            &run.id,
            SwarmTaskSpec {
                title: "Broken".into(),
                detail: None,
                files: vec!["packages/db/src/broken.ts".into()],
                depends_on: vec![],
            },
            create_correlation_id(),
        )
        .unwrap();
    add(
        &service,
        &run.id,
        "Downstream",
        &["packages/db/src/down.ts"],
        vec![broken.id],
    );
    service.pump(&run.id).await;
    let state = service.state(&run.id).unwrap();
    assert_eq!(
        state
            .tasks
            .iter()
            .map(|t| t.status.as_str())
            .collect::<Vec<_>>(),
        vec!["failed", "skipped"]
    );
    assert_eq!(state.tasks[0].attempts, 2);
    assert_eq!(state.run.status, "failed");
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn refuses_to_land_work_that_fails_the_verify_gate() {
    struct Reject;
    impl SwarmTaskVerifier for Reject {
        fn verify(
            &self,
            _input: SwarmVerifyInput,
        ) -> Pin<Box<dyn Future<Output = SwarmVerifyResult> + '_>> {
            Box::pin(async {
                SwarmVerifyResult {
                    ok: false,
                    detail: "typecheck failed".into(),
                }
            })
        }
    }
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(Arc::new(Mutex::new(Vec::new())))),
        Arc::new(Reject),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    add(
        &service,
        &run.id,
        "Risky",
        &["packages/db/src/x.ts"],
        vec![],
    );
    service.pump(&run.id).await;
    let state = service.state(&run.id).unwrap();
    assert_eq!(state.tasks[0].status, "failed");
    assert!(state.tasks[0].landed_commit.is_none());
    assert!(state
        .messages
        .iter()
        .any(|m| m.body.contains("verify gate")));
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn wraps_up_when_the_budget_is_already_spent() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let log = Arc::new(Mutex::new(Vec::new()));
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(log.clone())),
        Arc::new(Passing),
        SwarmServiceOptions {
            budget_ms: Some(60_000),
            reviewer: None,
            now_ms: Some(Arc::new(|| i64::MAX / 4)),
        },
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    add(
        &service,
        &run.id,
        "TooLate",
        &["packages/db/src/l.ts"],
        vec![],
    );
    service.pump(&run.id).await;
    assert_eq!(service.state(&run.id).unwrap().run.status, "budget");
    assert!(log.lock().unwrap().is_empty());
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn reconciling_a_hard_kill_returns_in_flight_work_to_pending() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(Arc::new(Mutex::new(Vec::new())))),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    let task = service
        .add_task(
            &run.id,
            SwarmTaskSpec {
                title: "Interrupted".into(),
                detail: None,
                files: vec!["packages/db/src/i.ts".into()],
                depends_on: vec![],
            },
            create_correlation_id(),
        )
        .unwrap();
    database.run(
        "UPDATE swarm_tasks SET status = ? WHERE id = ?",
        &[serde_json::json!("in_progress"), serde_json::json!(task.id)],
    );
    assert_eq!(service.reconcile_interrupted_runs(), 1);
    let reconciled = service.state(&run.id).unwrap();
    assert_eq!(reconciled.run.status, "stopped");
    assert_eq!(reconciled.tasks[0].status, "pending");
    service
        .resume(&run.id, create_correlation_id())
        .await
        .unwrap();
    let finished = service.state(&run.id).unwrap();
    assert_eq!(finished.tasks[0].status, "landed");
    assert_eq!(finished.run.status, "done");
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn two_builders_do_not_start_overlapping_files() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let running = Arc::new(Mutex::new(Vec::new()));
    struct Hold(Arc<Mutex<Vec<String>>>);
    impl SwarmSeatRunner for Hold {
        fn execute(
            &self,
            input: SwarmExecuteInput,
        ) -> Pin<Box<dyn Future<Output = SwarmRunnerOutcome> + '_>> {
            let titles = self.0.clone();
            Box::pin(async move {
                titles.lock().unwrap().push(input.task.title.clone());
                SwarmRunnerOutcome {
                    status: "failed".into(),
                    summary: "hold".into(),
                    tokens_used: 0,
                    cost_usd: 0.0,
                    output: None,
                }
            })
        }
    }
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Hold(running.clone())),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 2),
            create_correlation_id(),
        )
        .unwrap();
    add(&service, &run.id, "One", &["src/shared.ts"], vec![]);
    add(&service, &run.id, "Two", &["src/shared.ts"], vec![]);
    service.pump(&run.id).await;
    // Exclusive-file dispatch: overlapping pending work is not started together.
    let started = running.lock().unwrap().clone();
    assert_eq!(started.first().unwrap(), "One");
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn kiro_cannot_take_a_seat() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(Arc::new(Mutex::new(Vec::new())))),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let mut input = create_input(repo.to_str().unwrap(), 0);
    input.seats.push(SwarmSeatAssignment {
        role: SwarmRole::Builder,
        agent_id: BoardAgentId::Kiro,
        model: None,
    });
    let err = service
        .create_run(input, create_correlation_id())
        .unwrap_err();
    assert!(err.message().contains("kiro-cli"));
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn pump_with_no_tasks_marks_the_run_failed() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(Arc::new(Mutex::new(Vec::new())))),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 2),
            create_correlation_id(),
        )
        .unwrap();
    service.pump(&run.id).await;
    let state = service.state(&run.id).unwrap();
    assert!(state.tasks.is_empty());
    assert_eq!(state.run.status, "failed");
    assert!(state
        .messages
        .iter()
        .any(|m| m.body.contains("nothing landed")));
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[test]
fn maps_owned_files_to_workspace_directories() {
    assert_eq!(
        workspace_targets_for_files(&[
            "packages/db/src/a.ts".into(),
            "packages/db/src/b.ts".into(),
            "apps/desktop/src/main/x.ts".into(),
            "README.md".into(),
            "docs/STATUS.md".into(),
        ]),
        vec!["apps/desktop".to_string(), "packages/db".to_string()]
    );
    assert!(
        workspace_targets_for_files(&["README.md".into(), "scripts/worktree-add".into()])
            .is_empty()
    );
}

#[tokio::test(flavor = "current_thread")]
async fn stops_on_user_stop_and_resumes_from_the_ledger() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let log = Arc::new(Mutex::new(Vec::new()));
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(log.clone())),
        Arc::new(Passing),
        SwarmServiceOptions {
            budget_ms: Some(60_000),
            reviewer: None,
            now_ms: None,
        },
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    add(
        &service,
        &run.id,
        "Slow",
        &["packages/db/src/slow.ts"],
        vec![],
    );
    service.stop(&run.id).unwrap();
    service.pump(&run.id).await;
    assert_eq!(service.state(&run.id).unwrap().run.status, "stopped");
    assert!(log.lock().unwrap().is_empty());
    service
        .resume(&run.id, create_correlation_id())
        .await
        .unwrap();
    let state = service.state(&run.id).unwrap();
    assert_eq!(*log.lock().unwrap(), vec!["Slow".to_string()]);
    assert_eq!(state.tasks[0].status, "landed");
    assert_eq!(state.run.status, "done");
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn credits_seat_token_and_cost_usage_and_queues_directives() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(Arc::new(Mutex::new(Vec::new())))),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    add(
        &service,
        &run.id,
        "Metered",
        &["packages/db/src/m.ts"],
        vec![],
    );
    service.pump(&run.id).await;
    let state = service.state(&run.id).unwrap();
    let builder = state
        .seats
        .iter()
        .find(|s| s.role == SwarmRole::Builder)
        .unwrap();
    assert_eq!(builder.tokens_used, 120);
    assert!((builder.cost_usd - 0.02).abs() < 0.0001);
    service
        .direct(
            &run.id,
            std::slice::from_ref(&builder.id),
            "wrap up now",
            create_correlation_id(),
        )
        .unwrap();
    assert!(service
        .state(&run.id)
        .unwrap()
        .messages
        .iter()
        .any(|m| m.kind == "directive" && m.body == "wrap up now"));
    assert!(service
        .direct(
            &run.id,
            &["not-a-seat".into()],
            "hello",
            create_correlation_id()
        )
        .is_err());
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn retires_a_seat_so_the_dispatcher_stops_assigning() {
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let log = Arc::new(Mutex::new(Vec::new()));
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(log.clone())),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    let seat = service
        .state(&run.id)
        .unwrap()
        .seats
        .into_iter()
        .find(|s| s.role == SwarmRole::Builder)
        .unwrap();
    service
        .stop_seat(&run.id, &seat.id, create_correlation_id())
        .unwrap();
    add(&service, &run.id, "Unassigned", &["src/x.ts"], vec![]);
    service.pump(&run.id).await;
    let state = service.state(&run.id).unwrap();
    assert_eq!(
        state.seats.iter().find(|s| s.id == seat.id).unwrap().status,
        "exited"
    );
    assert!(log.lock().unwrap().is_empty());
    assert_eq!(state.tasks[0].status, "pending");
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn creates_tasks_from_a_plan_with_dependencies_resolved_to_ids() {
    use helm_swarm::{PlannedTask, SwarmPlanRequest, SwarmPlanner};
    struct Plan;
    impl SwarmPlanner for Plan {
        fn plan<'a>(
            &'a self,
            request: &'a SwarmPlanRequest,
        ) -> Pin<Box<dyn Future<Output = Result<Vec<PlannedTask>, String>> + 'a>> {
            Box::pin(async move {
                assert_eq!(request.mission, "ship the fixtures");
                assert_eq!(request.max_tasks, 3);
                Ok(vec![
                    PlannedTask {
                        title: "Base".into(),
                        detail: None,
                        files: vec!["packages/db/src/base.ts".into()],
                        depends_on: vec![],
                    },
                    PlannedTask {
                        title: "Follow up".into(),
                        detail: Some("after base".into()),
                        files: vec!["packages/db/src/follow.ts".into()],
                        depends_on: vec![0],
                    },
                ])
            })
        }
    }
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Committing(Arc::new(Mutex::new(Vec::new())))),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service
        .create_run(
            create_input(repo.to_str().unwrap(), 1),
            create_correlation_id(),
        )
        .unwrap();
    let created = service
        .plan_tasks(&run.id, &Plan, create_correlation_id())
        .await
        .unwrap();
    assert_eq!(created.len(), 2);
    assert_eq!(created[1].depends_on, vec![created[0].id.clone()]);
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[tokio::test(flavor = "current_thread")]
async fn builder_prompt_contains_role_skills_not_reviewer_skills() {
    struct Capture(Arc<Mutex<Vec<String>>>);
    impl SwarmSeatRunner for Capture {
        fn execute(
            &self,
            input: SwarmExecuteInput,
        ) -> Pin<Box<dyn Future<Output = SwarmRunnerOutcome> + '_>> {
            let prompts = self.0.clone();
            Box::pin(async move {
                prompts.lock().unwrap().push(input.prompt);
                SwarmRunnerOutcome {
                    status: "failed".into(),
                    summary: "skip land".into(),
                    tokens_used: 0,
                    cost_usd: 0.0,
                    output: None,
                }
            })
        }
    }
    let (repo, worktrees) = create_repository();
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = logger();
    let board = BoardService::new(&database, &logger);
    let prompts = Arc::new(Mutex::new(Vec::new()));
    let mut input = create_input(repo.to_str().unwrap(), 1);
    input.skill_ids = vec!["tdd".into(), "review".into(), "security".into()];
    let service = SwarmService::new(
        &database,
        &logger,
        &board,
        Arc::new(Capture(prompts.clone())),
        Arc::new(Passing),
        SwarmServiceOptions::default(),
    );
    let run = service.create_run(input, create_correlation_id()).unwrap();
    add(&service, &run.id, "Wire", &["src/w.ts"], vec![]);
    service.pump(&run.id).await;
    let prompt = prompts.lock().unwrap()[0].clone();
    assert!(prompt.contains("Test-Driven"));
    assert!(!prompt.contains("Code Review"));
    assert!(!prompt.contains("Security"));
    let _ = std::fs::remove_dir_all(&repo);
    let _ = std::fs::remove_dir_all(&worktrees);
}

#[allow(dead_code)]
fn _db(_: &ZeroDatabase) {}
