use std::cell::Cell;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use helm_core::chat::ChatModelStreamer;
use helm_core::{
    ActionCommandInput, ActionCommandOutcome, ActionRepository, ActionService,
    PermissionPolicyUpdateInput,
};
use helm_db::{migrations, open_database_unchecked, run_migrations, ZeroDatabase};
use helm_observability::create_logger;
use helm_protocol::{ChatStreamEvent, FinishReason, ModelRequest, NormalizedToolCall};
use helm_shared::{create_correlation_id, create_id, ZeroError, ZeroErrorCode};
use helm_tools::{create_work_tool_registry, PermissionEngine};
use serde_json::{json, Value};
use time::{Duration, Month, OffsetDateTime, PrimitiveDateTime, Time};

struct FixtureModels {
    calls: Vec<(String, Value)>,
    captured: Arc<Mutex<Option<ModelRequest>>>,
}

impl ChatModelStreamer for FixtureModels {
    fn stream<'a>(
        &'a self,
        request: ModelRequest,
        _correlation_id: &'a str,
        _aborted: bool,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ChatStreamEvent>, ZeroError>> + 'a>> {
        *self.captured.lock().unwrap() = Some(request);
        let calls = self.calls.clone();
        Box::pin(async move {
            let mut events = Vec::new();
            for (index, (name, arguments)) in calls.into_iter().enumerate() {
                events.push(ChatStreamEvent::ToolProposed {
                    call: NormalizedToolCall {
                        id: format!("call-{index}"),
                        name,
                        arguments,
                    },
                });
            }
            events.push(ChatStreamEvent::Done {
                finish_reason: FinishReason::ToolCalls,
                provider_continuation: None,
            });
            Ok(events)
        })
    }
}

fn dt(year: i32, month: u8, day: u8, hour: u8, min: u8, sec: u8) -> OffsetDateTime {
    PrimitiveDateTime::new(
        time::Date::from_calendar_date(year, Month::try_from(month).unwrap(), day).unwrap(),
        Time::from_hms(hour, min, sec).unwrap(),
    )
    .assume_utc()
}

type Fixture = (
    ZeroDatabase,
    FixtureModels,
    helm_observability::Logger,
    Arc<Mutex<Vec<String>>>,
    Arc<Mutex<Option<ModelRequest>>>,
    Cell<OffsetDateTime>,
);

fn fixture(model_calls: Vec<(String, Value)>) -> Fixture {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let captured = Arc::new(Mutex::new(None));
    let models = FixtureModels {
        calls: model_calls,
        captured: captured.clone(),
    };
    let logs = Arc::new(Mutex::new(Vec::new()));
    let sink = logs.clone();
    let logger = create_logger(move |line| sink.lock().unwrap().push(line));
    let now = Cell::new(dt(2026, 8, 11, 4, 30, 0));
    (database, models, logger, logs, captured, now)
}

fn service<'a>(
    database: &'a ZeroDatabase,
    models: &'a FixtureModels,
    logger: &'a helm_observability::Logger,
    now: &'a Cell<OffsetDateTime>,
) -> ActionService<'a> {
    ActionService::new(
        ActionRepository::new(database),
        models,
        logger,
        create_work_tool_registry(),
        PermissionEngine,
        Some(Box::new(|| now.get())),
    )
}

async fn create_project(
    service: &ActionService<'_>,
    repository: &ActionRepository<'_>,
    name: &str,
) -> String {
    let proposed = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_000).to_string(),
                text: format!("Create project {name}"),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ApprovalRequired { approval, .. } = proposed else {
        panic!("expected approval");
    };
    let executed = service
        .approve(&approval.id, &create_correlation_id())
        .await
        .unwrap();
    assert!(matches!(executed, ActionCommandOutcome::Executed { .. }));
    repository
        .list_projects(None)
        .into_iter()
        .next()
        .unwrap()
        .id
}
#[tokio::test(flavor = "current_thread")]
async fn creates_one_task_after_one_explicit_approval_and_records_an_immutable_receipt() {
    let (database, models, logger, logs, _captured, now) = fixture(Vec::new());
    let repository = ActionRepository::new(&database);
    let service = service(&database, &models, &logger, &now);
    let project = create_project(&service, &repository, "Project A").await;
    let request_id = create_id(1_700_000_000_001).to_string();
    let proposed = service
        .command(
            ActionCommandInput {
                request_id: request_id.clone(),
                text: "Add a high-priority task to Project A to benchmark the sync layer tomorrow."
                    .into(),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ApprovalRequired { approval, .. } = &proposed else {
        panic!("expected approval");
    };
    assert_eq!(approval.request_id, request_id);
    assert_eq!(approval.tool_id, "task.create");
    assert_eq!(approval.exact_arguments["projectId"], project);
    assert_eq!(
        approval.exact_arguments["title"],
        "benchmark the sync layer"
    );
    assert_eq!(approval.exact_arguments["priority"], "high");
    assert_eq!(approval.risk, "reversible_write");
    assert!(approval.reversible);
    let update_err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        database.run(
            "UPDATE approval_requests SET arguments_json = '{\"taskId\":\"replacement\"}' WHERE id = ?",
            &[json!(approval.id)],
        );
    }));
    assert!(update_err.is_err());
    let executed = service
        .approve(&approval.id, &create_correlation_id())
        .await
        .unwrap();
    let ActionCommandOutcome::Executed { receipt, .. } = executed else {
        panic!("expected executed");
    };
    assert_eq!(receipt.request_id, request_id);
    assert_eq!(receipt.tool_id, "task.create");
    assert_eq!(receipt.approval_state, "granted");
    assert_eq!(receipt.result["title"], "benchmark the sync layer");
    assert_eq!(receipt.result["priority"], "high");
    assert_eq!(repository.list_tasks(None, None, None).len(), 1);
    let denied = service
        .approve(&approval.id, &create_correlation_id())
        .await
        .unwrap_err();
    assert_eq!(denied.code, ZeroErrorCode::PermissionDenied);
    assert_eq!(repository.list_tasks(None, None, None).len(), 1);
    let delete_err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        database.run(
            "DELETE FROM action_receipts WHERE request_id = ?",
            &[json!(request_id)],
        );
    }));
    assert!(
        delete_err
            .as_ref()
            .err()
            .and_then(
                |payload| payload.downcast_ref::<String>().cloned().or_else(|| {
                    payload
                        .downcast_ref::<&str>()
                        .map(|value| (*value).to_string())
                })
            )
            .unwrap_or_default()
            .contains("append-only")
            || delete_err.is_err()
    );
    assert!(logs.lock().unwrap().join("\n").contains("action.executed"));
    assert!(!logs
        .lock()
        .unwrap()
        .join("\n")
        .contains("benchmark the sync layer"));
}

#[tokio::test(flavor = "current_thread")]
async fn updates_an_existing_task_through_approval_and_records_rollback_arguments() {
    let (database, models, logger, _logs, _captured, now) = fixture(Vec::new());
    let repository = ActionRepository::new(&database);
    let service = service(&database, &models, &logger, &now);
    create_project(&service, &repository, "Project A").await;
    let create = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_002).to_string(),
                text: "Add a task to Project A to validate rollback tomorrow.".into(),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ApprovalRequired { approval, .. } = create else {
        panic!("expected approval");
    };
    service
        .approve(&approval.id, &create_correlation_id())
        .await
        .unwrap();
    let update_cid = create_correlation_id();
    let update = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_003).to_string(),
                text: "Mark \"validate rollback\" complete".into(),
                model_ref: None,
            },
            &update_cid,
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ApprovalRequired { approval, .. } = update else {
        panic!("expected approval");
    };
    assert_eq!(approval.tool_id, "task.update");
    assert_eq!(approval.exact_arguments["status"], "done");
    let executed = service
        .approve(&approval.id, &create_correlation_id())
        .await
        .unwrap();
    let ActionCommandOutcome::Executed { receipt, .. } = executed else {
        panic!("expected executed");
    };
    assert_eq!(receipt.correlation_id, update_cid.to_string());
    assert_eq!(receipt.tool_id, "task.update");
    assert_eq!(receipt.result["status"], "done");
    assert_eq!(
        receipt.rollback_information.as_ref().unwrap()["arguments"]["status"],
        "todo"
    );
    assert_eq!(repository.list_tasks(None, None, None)[0].status, "done");
}

#[tokio::test(flavor = "current_thread")]
async fn supports_project_status_task_list_and_project_decision_tools() {
    let (database, models, logger, _logs, _captured, now) = fixture(Vec::new());
    let repository = ActionRepository::new(&database);
    let service = service(&database, &models, &logger, &now);
    create_project(&service, &repository, "Project A").await;
    let status = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_004).to_string(),
                text: "Show status of Project A".into(),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ReadResult {
        tool_id, result, ..
    } = status
    else {
        panic!("expected read");
    };
    assert_eq!(tool_id, "project.get_status");
    assert_eq!(result["taskCounts"]["todo"], 0);
    assert_eq!(result["taskCounts"]["done"], 0);
    let tasks = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_005).to_string(),
                text: "List tasks for Project A".into(),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ReadResult {
        tool_id, result, ..
    } = tasks
    else {
        panic!("expected read");
    };
    assert_eq!(tool_id, "task.list");
    assert_eq!(result, json!([]));
    let decision = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_006).to_string(),
                text: "Add a decision to Project A that keep receipts local".into(),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ApprovalRequired { approval, .. } = decision else {
        panic!("expected approval");
    };
    assert_eq!(approval.tool_id, "project.add_decision");
    assert!(!approval.reversible);
    let executed = service
        .approve(&approval.id, &create_correlation_id())
        .await
        .unwrap();
    let ActionCommandOutcome::Executed { receipt, .. } = executed else {
        panic!("expected executed");
    };
    assert!(receipt.rollback_information.is_none());
    assert_eq!(
        repository
            .list_decisions(&repository.list_projects(None)[0].id)
            .len(),
        1
    );
}

#[tokio::test(flavor = "current_thread")]
async fn supports_narrow_per_tool_auto_approval_and_deny_policies() {
    let (database, models, logger, _logs, _captured, now) = fixture(Vec::new());
    let repository = ActionRepository::new(&database);
    let service = service(&database, &models, &logger, &now);
    create_project(&service, &repository, "Project A").await;
    service
        .update_policy(
            PermissionPolicyUpdateInput {
                tool_id: "task.create".into(),
                mode: "auto_approve".into(),
            },
            &create_correlation_id(),
        )
        .unwrap();
    let executed = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_007).to_string(),
                text: "Add a low-priority task to Project A to write tests today.".into(),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::Executed { receipt, .. } = executed else {
        panic!("expected executed");
    };
    assert_eq!(receipt.approval_state, "auto_approved");
    assert_eq!(receipt.tool_id, "task.create");
    service
        .update_policy(
            PermissionPolicyUpdateInput {
                tool_id: "task.create".into(),
                mode: "deny".into(),
            },
            &create_correlation_id(),
        )
        .unwrap();
    let denied = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_008).to_string(),
                text: "Add a task to Project A to ship unsafe change tomorrow.".into(),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap_err();
    assert_eq!(denied.code, ZeroErrorCode::PermissionDenied);
    assert_eq!(repository.list_tasks(None, None, None).len(), 1);
}

#[tokio::test(flavor = "current_thread")]
async fn uses_an_optional_tool_capable_model_only_when_deterministic_parsing_cannot_resolve() {
    let (database, models, logger, _logs, captured, now) = fixture(vec![(
        "project_create".into(),
        json!({ "name": "Model Project", "description": null }),
    )]);
    let repository = ActionRepository::new(&database);
    let service = service(&database, &models, &logger, &now);
    let model_ref = format!("{}:tool-model", create_id(1_700_000_000_009));
    let proposed = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_010).to_string(),
                text: "Please establish a workspace called Model Project".into(),
                model_ref: Some(model_ref.clone()),
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ApprovalRequired { approval, .. } = proposed else {
        panic!("expected approval");
    };
    assert_eq!(approval.actor_type, "model");
    assert_eq!(approval.model_ref.as_deref(), Some(model_ref.as_str()));
    assert_eq!(approval.tool_id, "project.create");
    let request = captured.lock().unwrap().clone().unwrap();
    assert_eq!(
        request.data_classifications,
        vec![
            helm_protocol::DataClassification::Personal,
            helm_protocol::DataClassification::Sensitive,
            helm_protocol::DataClassification::Health,
        ]
    );
    assert!(request
        .tools
        .unwrap()
        .iter()
        .any(|tool| tool.name == "project_create"));
    let events: Vec<String> = database
        .query_all(
            "SELECT event_type AS eventType FROM audit_events ORDER BY created_at, id",
            &[],
        )
        .into_iter()
        .map(|row| {
            row.get("eventType")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    assert!(events.iter().any(|event| event == "agent.model_invoked"));
    assert!(events.iter().any(|event| event == "agent.model_completed"));
    let _ = repository;
}

#[tokio::test(flavor = "current_thread")]
async fn expires_pending_approvals_and_never_executes_their_saved_arguments() {
    let (database, models, logger, _logs, _captured, now) = fixture(Vec::new());
    let repository = ActionRepository::new(&database);
    let service = service(&database, &models, &logger, &now);
    let proposed = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_011).to_string(),
                text: "Create project Expiring".into(),
                model_ref: None,
            },
            &create_correlation_id(),
        )
        .await
        .unwrap();
    let ActionCommandOutcome::ApprovalRequired { approval, .. } = proposed else {
        panic!("expected approval");
    };
    now.set(dt(2026, 8, 11, 5, 0, 1));
    let denied = service
        .approve(&approval.id, &create_correlation_id())
        .await
        .unwrap_err();
    assert_eq!(denied.code, ZeroErrorCode::PermissionDenied);
    assert!(repository.list_projects(None).is_empty());
    assert_eq!(
        repository.find_approval_by_id(&approval.id).unwrap().status,
        "expired"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn rejects_multiple_model_tool_proposals_without_creating_approvals() {
    let (database, models, logger, _logs, _captured, now) = fixture(vec![
        ("project_create".into(), json!({ "name": "One" })),
        ("project_create".into(), json!({ "name": "Two" })),
    ]);
    let repository = ActionRepository::new(&database);
    let service = service(&database, &models, &logger, &now);
    let error = service
        .command(
            ActionCommandInput {
                request_id: create_id(1_700_000_000_012).to_string(),
                text: "Create two projects".into(),
                model_ref: Some(format!("{}:tool-model", create_id(1_700_000_000_013))),
            },
            &create_correlation_id(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, ZeroErrorCode::ToolSchemaInvalid);
    assert!(repository.list_approvals(None).is_empty());
    let events: Vec<String> = database
        .query_all(
            "SELECT event_type AS eventType FROM audit_events ORDER BY created_at, id",
            &[],
        )
        .into_iter()
        .map(|row| {
            row.get("eventType")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    assert!(events.iter().any(|event| event == "agent.model_invoked"));
    assert!(events.iter().any(|event| event == "agent.model_failed"));
}

#[allow(dead_code)]
fn _keep_duration() {
    let _ = Duration::seconds(1);
}
