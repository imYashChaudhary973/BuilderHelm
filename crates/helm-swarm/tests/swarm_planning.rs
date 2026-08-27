use helm_protocol::{swarm_plan_budget, SwarmPresetId, SwarmRole};
use helm_swarm::{
    build_plan_prompt, build_seat_prompt, first_successful_plan, normalize_swarm_plan,
    parse_agent_usage, parse_cli_failure, pin_foundation, structured_cli_args, PlannedTask,
    RepoSnapshot, SeatPhase, SeatPromptInput, SeatPromptSkill, SeatPromptTask, SwarmPlanRequest,
    SwarmPlanner, SWARM_PROMPT_TASK_MARKER,
};
use serde_json::json;
use std::future::Future;
use std::pin::Pin;

struct FnPlanner<F>(F);

impl<F> SwarmPlanner for FnPlanner<F>
where
    F: Fn(&SwarmPlanRequest) -> Result<Vec<PlannedTask>, String>,
{
    fn plan<'a>(
        &'a self,
        request: &'a SwarmPlanRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<PlannedTask>, String>> + 'a>> {
        let result = (self.0)(request);
        Box::pin(async move { result })
    }
}

#[test]
fn gives_every_file_a_single_owner() {
    let plan = normalize_swarm_plan(
        &json!({
            "tasks": [
                { "title": "Add parser", "files": ["src/parse.ts", "src/shared.ts"] },
                { "title": "Add printer", "files": ["src/print.ts", "src/shared.ts"] }
            ]
        }),
        10,
    )
    .unwrap();
    assert_eq!(plan[0].files, vec!["src/parse.ts", "src/shared.ts"]);
    assert_eq!(plan[1].files, vec!["src/print.ts"]);
}

#[test]
fn drops_a_task_whose_files_were_all_claimed_already() {
    let plan = normalize_swarm_plan(
        &json!({
            "tasks": [
                { "title": "Own it", "files": ["src/a.ts"] },
                { "title": "Duplicate", "files": ["src/a.ts"] },
                { "title": "Fresh", "files": ["src/b.ts"] }
            ]
        }),
        10,
    )
    .unwrap();
    assert_eq!(
        plan.iter()
            .map(|task| task.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Own it", "Fresh"]
    );
}

#[test]
fn caps_tasks_at_the_preset_budget() {
    let tasks: Vec<_> = (0..12)
        .map(|index| json!({ "title": format!("Task {index}"), "files": [format!("src/f{index}.ts")] }))
        .collect();
    let plan = normalize_swarm_plan(
        &json!({ "tasks": tasks }),
        swarm_plan_budget(SwarmPresetId::Skiff) as usize,
    )
    .unwrap();
    assert_eq!(plan.len(), 3);
}

#[test]
fn keeps_dependencies_a_dag_by_allowing_earlier_edges_only() {
    let plan = normalize_swarm_plan(
        &json!({
            "tasks": [
                { "title": "First", "files": ["a.ts"], "dependsOn": [1, 0, 99] },
                { "title": "Second", "files": ["b.ts"], "dependsOn": [0] }
            ]
        }),
        10,
    )
    .unwrap();
    assert!(plan[0].depends_on.is_empty());
    assert_eq!(plan[1].depends_on, vec![0]);
}

#[test]
fn rejects_output_that_is_not_a_plan() {
    assert!(normalize_swarm_plan(&json!({ "tasks": [] }), 5).is_err());
    assert!(normalize_swarm_plan(&json!({ "nope": true }), 5).is_err());
}

#[test]
fn asks_for_file_ownership_in_the_planning_prompt() {
    let prompt = build_plan_prompt(&SwarmPlanRequest {
        mission: "add retries".into(),
        snapshot: RepoSnapshot {
            files: vec!["src/a.ts".into()],
            truncated: true,
        },
        max_tasks: 4,
        roster: "coordinator/claude, builder/grok".into(),
    });
    assert!(prompt.contains("at most 4 independent tasks"));
    assert!(prompt.contains("No two tasks may share a file"));
    assert!(prompt.contains("add retries"));
    assert!(prompt.contains("(truncated)"));
    assert!(prompt.contains("coordinator/claude, builder/grok"));
    assert!(prompt.contains("Do not invent roles"));
}

#[test]
fn tells_the_planner_to_pin_later_tasks_on_a_foundation_for_empty_repos() {
    let prompt = build_plan_prompt(&SwarmPlanRequest {
        mission: "build a todo app".into(),
        snapshot: RepoSnapshot {
            files: vec!["README.md".into()],
            truncated: false,
        },
        max_tasks: 7,
        roster: "coordinator/claude, builder/grok".into(),
    });
    assert!(prompt.contains("Task 0 MUST be the foundation (shell, package, entry)"));
    assert!(prompt.contains("Every later task MUST set dependsOn: [0]"));
}

fn three() -> Vec<PlannedTask> {
    normalize_swarm_plan(
        &json!({
            "tasks": [
                { "title": "Scaffold", "files": ["package.json"] },
                { "title": "App", "files": ["src/app.ts"] },
                { "title": "UI", "files": ["src/ui.ts"] }
            ]
        }),
        10,
    )
    .unwrap()
}

#[test]
fn pins_later_tasks_onto_0_for_an_empty_snapshot() {
    let plan = pin_foundation(
        three(),
        &RepoSnapshot {
            files: vec![],
            truncated: false,
        },
    );
    assert!(plan[1].depends_on.contains(&0));
    assert!(plan[2].depends_on.contains(&0));
}

#[test]
fn pins_later_tasks_onto_0_for_docs_only_snapshots() {
    let plan = pin_foundation(
        three(),
        &RepoSnapshot {
            files: vec!["README.md".into(), "docs/guide.md".into()],
            truncated: false,
        },
    );
    assert!(plan[1].depends_on.contains(&0));
    assert!(plan[2].depends_on.contains(&0));
}

#[test]
fn leaves_a_plan_alone_when_the_snapshot_already_has_source() {
    let tasks = three();
    let plan = pin_foundation(
        tasks.clone(),
        &RepoSnapshot {
            files: vec!["src/main.ts".into()],
            truncated: false,
        },
    );
    assert_eq!(plan, tasks);
    assert!(plan[1].depends_on.is_empty());
    assert!(plan[2].depends_on.is_empty());
}

fn base_prompt(task: SeatPromptTask, directives: Vec<String>, digest: Option<String>) -> String {
    build_seat_prompt(&SeatPromptInput {
        role: SwarmRole::Builder,
        mission: "add retries to the uploader".into(),
        skills: vec![SeatPromptSkill {
            title: "Test-Driven".into(),
            directive: "Write a failing test first.".into(),
        }],
        task,
        directives,
        context_pack: None,
        swarm_digest: digest,
    })
}

#[test]
fn keeps_the_cacheable_prefix_identical_across_tasks_in_a_run() {
    let first = base_prompt(
        SeatPromptTask {
            title: "Task one".into(),
            detail: None,
            files: vec!["src/one.ts".into()],
        },
        vec![],
        None,
    );
    let second = base_prompt(
        SeatPromptTask {
            title: "Task two".into(),
            detail: Some("must retry twice".into()),
            files: vec!["src/two.ts".into()],
        },
        vec![],
        None,
    );
    let prefix_of =
        |prompt: &str| prompt[..prompt.find(SWARM_PROMPT_TASK_MARKER).unwrap()].to_string();
    assert_eq!(prefix_of(&first), prefix_of(&second));
    assert!(prefix_of(&first).contains("add retries to the uploader"));
    assert!(prefix_of(&first).contains("Write a failing test first."));
}

#[test]
fn puts_task_ownership_and_fresh_directives_after_the_marker() {
    let prompt = base_prompt(
        SeatPromptTask {
            title: "Wire retries".into(),
            detail: Some("three attempts".into()),
            files: vec!["src/up.ts".into()],
        },
        vec!["skip the docs for now".into()],
        None,
    );
    let tail = &prompt[prompt.find(SWARM_PROMPT_TASK_MARKER).unwrap()..];
    assert!(tail.contains("Wire retries"));
    assert!(tail.contains("three attempts"));
    assert!(tail.contains("- src/up.ts"));
    assert!(tail.contains("skip the docs for now"));
}

#[test]
fn puts_the_swarm_digest_after_the_task_marker_so_the_prefix_can_cache() {
    let prompt = base_prompt(
        SeatPromptTask {
            title: "Beta".into(),
            detail: None,
            files: vec!["src/b.ts".into()],
        },
        vec![],
        Some("Swarm roster: builder/grok.\nWork already landed by other seats (do not redo or contradict it):\n- Alpha: landed".into()),
    );
    let marker = prompt.find(SWARM_PROMPT_TASK_MARKER).unwrap();
    let prefix = &prompt[..marker];
    let tail = &prompt[marker..];
    assert!(!prefix.contains("Swarm roster"));
    assert!(!prefix.contains("Alpha"));
    assert!(tail.contains("Swarm roster: builder/grok."));
    assert!(tail.contains("Alpha"));
    assert!(tail.contains("Beta"));
}

#[test]
fn keeps_the_prefix_stable_when_the_digest_changes_after_a_land() {
    let first = base_prompt(
        SeatPromptTask {
            title: "Alpha".into(),
            detail: None,
            files: vec!["src/a.ts".into()],
        },
        vec![],
        Some("Swarm roster: builder/grok.".into()),
    );
    let second = base_prompt(
        SeatPromptTask {
            title: "Beta".into(),
            detail: None,
            files: vec!["src/b.ts".into()],
        },
        vec![],
        Some("Swarm roster: builder/grok.\nWork already landed by other seats (do not redo or contradict it):\n- Alpha: landed".into()),
    );
    let prefix_of =
        |prompt: &str| prompt[..prompt.find(SWARM_PROMPT_TASK_MARKER).unwrap()].to_string();
    assert_eq!(prefix_of(&first), prefix_of(&second));
}

#[test]
fn reads_claude_json_output() {
    let usage = parse_agent_usage(
        &json!({
            "type": "result",
            "total_cost_usd": 0.0342,
            "usage": { "input_tokens": 1200, "output_tokens": 300, "cache_read_input_tokens": 500 }
        })
        .to_string(),
    );
    assert_eq!(usage.tokens_used, 2000);
    assert!((usage.cost_usd - 0.0342).abs() < 0.0001);
}

#[test]
fn reads_streamed_jsonl_usage_events_and_keeps_the_highest_totals() {
    let usage = parse_agent_usage(
        "{\"type\":\"token_count\",\"usage\":{\"total_tokens\":800}}\nnot json at all\n{\"type\":\"token_count\",\"usage\":{\"total_tokens\":1500},\"cost_usd\":0.01}",
    );
    assert_eq!(usage.tokens_used, 1500);
    assert!((usage.cost_usd - 0.01).abs() < 0.0001);
}

#[test]
fn meters_unparseable_output_as_zero_instead_of_throwing() {
    let usage = parse_agent_usage("plain terminal noise");
    assert_eq!(usage.tokens_used, 0);
    assert_eq!(usage.cost_usd, 0.0);
}

#[test]
fn names_a_grok_402_usage_error() {
    assert_eq!(
        parse_cli_failure(
            "{\"type\":\"error\",\"message\":\"API error (status 402 Payment Required): Grok Build usage balance exhausted\"}"
        ),
        "Grok usage balance exhausted (402)"
    );
}

#[test]
fn returns_the_last_non_empty_lines_otherwise() {
    assert_eq!(
        parse_cli_failure("hello\n\ncommand not found"),
        "hello command not found"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn returns_the_first_planner_that_yields_tasks() {
    let request = SwarmPlanRequest {
        mission: "Create a Minecraft Game.".into(),
        snapshot: RepoSnapshot {
            files: vec![],
            truncated: false,
        },
        max_tasks: 8,
        roster: "coordinator/grok".into(),
    };
    let fail = FnPlanner(|_: &SwarmPlanRequest| Err("agent returned no JSON object".into()));
    let ok = FnPlanner(|_: &SwarmPlanRequest| {
        Ok(vec![PlannedTask {
            title: "from claude".into(),
            detail: None,
            files: vec!["a.ts".into()],
            depends_on: vec![],
        }])
    });
    let planned = first_successful_plan(&[&fail, &ok], &request, None).await;
    assert_eq!(planned[0].title, "from claude");
}

#[tokio::test(flavor = "current_thread")]
async fn pins_later_tasks_onto_0_when_a_planner_omits_dependson_on_an_empty_repo() {
    let request = SwarmPlanRequest {
        mission: "Create a Minecraft Game.".into(),
        snapshot: RepoSnapshot {
            files: vec![],
            truncated: false,
        },
        max_tasks: 8,
        roster: "coordinator/grok".into(),
    };
    let planner = FnPlanner(|_: &SwarmPlanRequest| {
        Ok(vec![
            PlannedTask {
                title: "Scaffold".into(),
                detail: None,
                files: vec!["package.json".into()],
                depends_on: vec![],
            },
            PlannedTask {
                title: "App".into(),
                detail: None,
                files: vec!["src/app.ts".into()],
                depends_on: vec![],
            },
            PlannedTask {
                title: "UI".into(),
                detail: None,
                files: vec!["src/ui.ts".into()],
                depends_on: vec![],
            },
        ])
    });
    let planned = first_successful_plan(&[&planner], &request, None).await;
    assert!(planned[1].depends_on.contains(&0));
    assert!(planned[2].depends_on.contains(&0));
}

#[tokio::test(flavor = "current_thread")]
async fn falls_back_to_one_foundation_task_when_every_planner_throws() {
    let request = SwarmPlanRequest {
        mission: "Create a Minecraft Game.".into(),
        snapshot: RepoSnapshot {
            files: vec![],
            truncated: false,
        },
        max_tasks: 8,
        roster: "coordinator/grok".into(),
    };
    let mut errors = Vec::new();
    let planner = FnPlanner(|_: &SwarmPlanRequest| Err("agent returned no JSON object".into()));
    let planned = first_successful_plan(
        &[&planner],
        &request,
        Some(&mut |message| errors.push(message)),
    )
    .await;
    assert_eq!(planned.len(), 1);
    assert!(planned[0].title.contains("Minecraft"));
    assert_eq!(errors, vec!["agent returned no JSON object"]);
}

#[test]
fn seat_phase_rejects_illegal_transitions() {
    assert!(SeatPhase::Exited.enter(SeatPhase::Working).is_err());
    assert_eq!(
        SeatPhase::Queued.enter(SeatPhase::Working).unwrap(),
        SeatPhase::Working
    );
    assert_eq!(
        SeatPhase::Working.enter(SeatPhase::Idle).unwrap(),
        SeatPhase::Idle
    );
}

#[test]
fn planning_is_claude_json_schema_not_grok_p() {
    assert!(structured_cli_args(helm_protocol::BoardAgentId::Claude, "p", "{}").is_ok());
    let grok = structured_cli_args(helm_protocol::BoardAgentId::Grok, "p", "{}").unwrap_err();
    assert!(grok.contains("grok -p") || grok.contains("Claude"));
    assert!(
        structured_cli_args(helm_protocol::BoardAgentId::Kiro, "p", "{}")
            .unwrap_err()
            .contains("kiro-cli")
    );
}
