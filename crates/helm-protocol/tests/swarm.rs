use helm_protocol::{
    assign_swarm_panes, available_swarm_agents, parse_swarm_add_seat_request,
    parse_swarm_create_request, parse_swarm_direct_request, parse_swarm_message, parse_swarm_run,
    parse_swarm_seat, parse_swarm_stop_request, parse_swarm_task, swarm_add_seat, swarm_brief,
    swarm_graph_hub, swarm_graph_points, swarm_member_status, swarm_preset_roles,
    swarm_remove_seat, swarm_role_tasks, swarm_run_status, swarm_seat_argv, swarm_seat_label,
    swarm_stuck_action, tagged_mission_paths, BoardAgentDetection, BoardAgentId, BoardPaneStatus,
    SwarmLaunchMode, SwarmMemberStatus, SwarmPresetId, SwarmRole, SwarmStuckAction,
    SWARM_SINGLE_TASK_NOTE,
};
use serde_json::json;

fn detection(id: BoardAgentId, available: bool) -> BoardAgentDetection {
    BoardAgentDetection {
        id,
        label: id.as_str().to_string(),
        available,
        path: available.then(|| format!("/bin/{}", id.as_str())),
    }
}

#[test]
fn uses_every_installed_cli_and_can_fill_a_skiff_preset() {
    let agents = available_swarm_agents(&[
        detection(BoardAgentId::Shell, true),
        detection(BoardAgentId::Claude, true),
        detection(BoardAgentId::Codex, false),
        detection(BoardAgentId::Grok, true),
    ]);
    assert_eq!(agents, vec![BoardAgentId::Claude, BoardAgentId::Grok]);
    let assigned = assign_swarm_panes(&agents, &swarm_preset_roles(SwarmPresetId::Skiff));
    assert_eq!(assigned[0].role, SwarmRole::Coordinator);
    assert_eq!(assigned[0].agent_id, BoardAgentId::Claude);
    assert!(!assigned[0].auto);
    assert_eq!(assigned[1].role, SwarmRole::Builder);
    assert_eq!(assigned[1].agent_id, BoardAgentId::Grok);
    assert_eq!(assigned[2].role, SwarmRole::Scout);
    assert_eq!(assigned[2].agent_id, BoardAgentId::Claude);
}

#[test]
fn returns_no_panes_when_no_agent_cli_is_installed() {
    let roles = [
        SwarmRole::Coordinator,
        SwarmRole::Builder,
        SwarmRole::Scout,
        SwarmRole::Reviewer,
    ];
    assert!(assign_swarm_panes(
        &available_swarm_agents(&[detection(BoardAgentId::Shell, true)]),
        &roles
    )
    .is_empty());
}

#[test]
fn adds_and_removes_seats_without_going_past_12() {
    let start = assign_swarm_panes(
        &[BoardAgentId::Grok],
        &swarm_preset_roles(SwarmPresetId::Flagship),
    );
    assert_eq!(start.len(), 12);
    assert_eq!(
        swarm_add_seat(&start, SwarmRole::Builder, BoardAgentId::Grok).len(),
        12
    );
    let minus = swarm_remove_seat(&start, SwarmRole::Reviewer);
    assert_eq!(
        minus
            .iter()
            .filter(|seat| seat.role == SwarmRole::Reviewer)
            .count(),
        1
    );
    let added = swarm_add_seat(&minus, SwarmRole::Builder, BoardAgentId::Claude);
    let last = added.last().unwrap();
    assert_eq!(last.role, SwarmRole::Builder);
    assert_eq!(last.agent_id, BoardAgentId::Claude);
    assert!(!last.auto);
}

#[test]
fn labels_seats_by_role_order_and_hubs_on_the_coordinator() {
    let roles = swarm_preset_roles(SwarmPresetId::Cutter);
    assert_eq!(swarm_seat_label(&roles, 0), "Coordinator 1");
    assert_eq!(swarm_seat_label(&roles, 2), "Builder 2");
    assert_eq!(swarm_graph_hub(&roles), 0);
    let points = swarm_graph_points(&roles);
    assert_eq!(points.len(), 5);
    assert_eq!(points[0].x, 50.0);
    assert_eq!(points[0].y, 58.0);
    assert!(points[0].y > points[1].y);
}

#[test]
fn spreads_extra_coordinators_and_side_columns_so_cards_do_not_stack() {
    let roles = [
        SwarmRole::Coordinator,
        SwarmRole::Coordinator,
        SwarmRole::Coordinator,
        SwarmRole::Builder,
        SwarmRole::Builder,
        SwarmRole::Builder,
        SwarmRole::Builder,
        SwarmRole::Builder,
        SwarmRole::Scout,
        SwarmRole::Scout,
        SwarmRole::Reviewer,
        SwarmRole::Reviewer,
        SwarmRole::Reviewer,
    ];
    let points = swarm_graph_points(&roles);
    assert_eq!(swarm_graph_hub(&roles), 0);
    assert_eq!((points[0].x, points[0].y), (50.0, 58.0));
    assert_eq!(points[1].y, 78.0);
    assert_eq!(points[2].y, 78.0);
    assert!((points[1].x - points[2].x).abs() >= 18.0);
    let mut builder_rows: std::collections::BTreeMap<String, Vec<f64>> =
        std::collections::BTreeMap::new();
    for index in [3, 4, 5, 6, 7] {
        let point = points[index];
        builder_rows
            .entry(point.y.to_string())
            .or_default()
            .push(point.x);
    }
    for xs in builder_rows.values_mut() {
        xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        for i in 1..xs.len() {
            assert!(xs[i] - xs[i - 1] >= 16.0);
        }
    }
    assert_eq!(points[8].x, 14.0);
    assert_eq!(points[9].x, 14.0);
    assert!((points[8].y - points[9].y).abs() >= 16.0);
    assert_eq!(points[10].x, 86.0);
    assert_eq!(points[11].x, 86.0);
    assert_eq!(points[12].x, 86.0);
    let mut reviewer_y = [points[10].y, points[11].y, points[12].y];
    reviewer_y.sort_by(|a, b| a.partial_cmp(b).unwrap());
    assert!(reviewer_y[1] - reviewer_y[0] >= 16.0);
    assert!(reviewer_y[2] - reviewer_y[1] >= 16.0);
}

#[test]
fn marks_a_silent_running_pane_stuck_and_a_timed_out_run_as_budget() {
    assert_eq!(
        swarm_member_status(BoardPaneStatus::Running, 0, 90_000, 90_000),
        SwarmMemberStatus::Stuck
    );
    assert_eq!(
        swarm_run_status(
            &[
                SwarmMemberStatus::Running,
                SwarmMemberStatus::Stuck,
                SwarmMemberStatus::Starting,
                SwarmMemberStatus::Running,
            ],
            1_000,
            20 * 60 * 1000,
            false,
        ),
        helm_protocol::SwarmRunStatus::Stuck
    );
    assert_eq!(
        swarm_run_status(
            &[
                SwarmMemberStatus::Running,
                SwarmMemberStatus::Running,
                SwarmMemberStatus::Running,
                SwarmMemberStatus::Running,
            ],
            20 * 60 * 1000,
            20 * 60 * 1000,
            false,
        ),
        helm_protocol::SwarmRunStatus::Budget
    );
    assert_eq!(
        swarm_run_status(
            &[
                SwarmMemberStatus::Exited,
                SwarmMemberStatus::Failed,
                SwarmMemberStatus::Exited,
                SwarmMemberStatus::Exited,
            ],
            10,
            20 * 60 * 1000,
            false,
        ),
        helm_protocol::SwarmRunStatus::Done
    );
}

#[test]
fn keeps_role_briefs_inside_the_pane_write_limit() {
    let brief = swarm_brief(SwarmRole::Builder, &"x".repeat(8_000));
    assert!(brief.len() <= 10_000);
    assert!(brief.contains("You are the builder"));
}

#[test]
fn nudges_once_then_stops_a_pane_that_stays_silent() {
    assert_eq!(
        swarm_stuck_action(SwarmMemberStatus::Stuck, None, 90_000, 90_000),
        SwarmStuckAction::Nudge
    );
    assert_eq!(
        swarm_stuck_action(SwarmMemberStatus::Stuck, Some(90_000), 179_999, 90_000),
        SwarmStuckAction::None
    );
    assert_eq!(
        swarm_stuck_action(SwarmMemberStatus::Stuck, Some(90_000), 180_000, 90_000),
        SwarmStuckAction::Stop
    );
    assert_eq!(
        swarm_stuck_action(SwarmMemberStatus::Running, None, 90_000, 90_000),
        SwarmStuckAction::None
    );
}

#[test]
fn returns_four_tasks_that_mention_a_non_empty_job() {
    let job = "ship the swarm pane";
    let tasks = swarm_role_tasks(job);
    assert_eq!(
        tasks.keys().copied().collect::<Vec<_>>(),
        vec!["builder", "coordinator", "reviewer", "scout"]
    );
    // insertion-order check is JS-specific; values still prefix correctly.
    assert!(tasks.get("coordinator").unwrap().starts_with("Coordinate:"));
    assert!(tasks.get("builder").unwrap().contains(job));
}

#[test]
fn returns_four_generic_tasks_for_whitespace_jobs() {
    for job in ["", "   "] {
        let tasks = swarm_role_tasks(job);
        assert!(tasks.get("coordinator").unwrap().starts_with("Coordinate:"));
        assert!(tasks.get("builder").unwrap().starts_with("Build:"));
    }
}

#[test]
fn embeds_the_first_200_chars_of_a_trimmed_job() {
    let job = format!("  {}  ", "x".repeat(300));
    let clipped = "x".repeat(200);
    let tasks = swarm_role_tasks(&job);
    for task in tasks.values() {
        assert!(task.contains(&clipped));
        assert!(!task.contains(&"x".repeat(201)));
    }
}

#[test]
fn maps_every_mode_to_verified_claude_flags() {
    let safe = swarm_seat_argv(
        BoardAgentId::Claude,
        "fix the login form",
        SwarmLaunchMode::Safe,
        None,
    )
    .unwrap();
    assert_eq!(safe.binary, "claude");
    assert_eq!(
        safe.args,
        vec!["-p", "fix the login form", "--permission-mode", "dontAsk"]
    );
    let auto =
        swarm_seat_argv(BoardAgentId::Claude, "fix it", SwarmLaunchMode::Auto, None).unwrap();
    assert_eq!(
        auto.args,
        vec!["-p", "fix it", "--permission-mode", "acceptEdits"]
    );
    let full =
        swarm_seat_argv(BoardAgentId::Claude, "fix it", SwarmLaunchMode::Full, None).unwrap();
    assert_eq!(
        full.args,
        vec!["-p", "fix it", "--dangerously-skip-permissions"]
    );
}

#[test]
fn maps_codex_exec_sandbox_and_gemini_approval_modes() {
    let codex = swarm_seat_argv(BoardAgentId::Codex, "ship", SwarmLaunchMode::Auto, None).unwrap();
    assert_eq!(
        codex.args,
        vec![
            "exec",
            "--sandbox",
            "workspace-write",
            "--approve-for-me",
            "ship"
        ]
    );
    let gemini =
        swarm_seat_argv(BoardAgentId::Gemini, "ship", SwarmLaunchMode::Full, None).unwrap();
    assert_eq!(
        gemini.args,
        vec!["-p", "ship", "--skip-trust", "--approval-mode", "yolo"]
    );
    let auto = swarm_seat_argv(BoardAgentId::Gemini, "ship", SwarmLaunchMode::Auto, None).unwrap();
    assert_eq!(
        auto.args
            .iter()
            .filter(|arg| *arg == "--skip-trust")
            .count(),
        1
    );
}

#[test]
fn passes_long_prompts_through_argv_without_shell_quoting() {
    let prompt = format!("{} 'quoted' \"double\" $HOME \\n", "x".repeat(8_000));
    let argv = swarm_seat_argv(BoardAgentId::Grok, &prompt, SwarmLaunchMode::Auto, None).unwrap();
    assert_eq!(argv.binary, "grok");
    assert_eq!(
        argv.args,
        vec!["--permission-mode", "acceptEdits", prompt.trim()]
    );
    assert!(!argv.args.iter().any(|arg| arg == "-p"));
}

#[test]
fn pins_an_optional_model_onto_grok_claude_and_codex() {
    assert_eq!(
        &swarm_seat_argv(
            BoardAgentId::Grok,
            "ship",
            SwarmLaunchMode::Auto,
            Some("grok-4.6")
        )
        .unwrap()
        .args[..2],
        ["-m", "grok-4.6"]
    );
    assert_eq!(
        &swarm_seat_argv(
            BoardAgentId::Claude,
            "ship",
            SwarmLaunchMode::Auto,
            Some("sonnet")
        )
        .unwrap()
        .args[..2],
        ["--model", "sonnet"]
    );
    assert_eq!(
        &swarm_seat_argv(
            BoardAgentId::Codex,
            "ship",
            SwarmLaunchMode::Auto,
            Some("gpt-5.4")
        )
        .unwrap()
        .args[..3],
        ["exec", "-m", "gpt-5.4"]
    );
}

#[test]
fn fails_closed_for_clis_without_a_verified_headless_command_or_mode() {
    assert!(
        swarm_seat_argv(BoardAgentId::Kiro, "job", SwarmLaunchMode::Auto, None)
            .unwrap_err()
            .contains("no verified headless")
    );
    assert!(
        swarm_seat_argv(BoardAgentId::Cursor, "job", SwarmLaunchMode::Auto, None)
            .unwrap_err()
            .contains("no verified headless")
    );
    assert!(
        swarm_seat_argv(BoardAgentId::Custom, "job", SwarmLaunchMode::Auto, None)
            .unwrap_err()
            .contains("no verified headless")
    );
    assert!(
        swarm_seat_argv(BoardAgentId::Opencode, "job", SwarmLaunchMode::Safe, None)
            .unwrap_err()
            .contains("does not support safe")
    );
    assert!(
        swarm_seat_argv(BoardAgentId::Pi, "job", SwarmLaunchMode::Full, None)
            .unwrap_err()
            .contains("does not support full")
    );
    assert!(
        swarm_seat_argv(BoardAgentId::Claude, "   ", SwarmLaunchMode::Auto, None)
            .unwrap_err()
            .contains("must not be empty")
    );
}

#[test]
fn round_trips_a_run_seat_task_and_message() {
    let base_run = json!({
        "id": "00000000-0000-4000-8000-000000000001",
        "name": "Swarm One",
        "folderPath": "/tmp/repo",
        "mission": "ship the feature",
        "launchMode": "auto",
        "presetId": "skiff",
        "skillIds": ["tdd"],
        "skillDirectives": {},
        "boardSessionId": null,
        "status": "running",
        "startedAt": "2026-08-25T10:00:00.000Z",
        "endedAt": null,
        "budgetMs": 1_200_000,
    });
    assert!(parse_swarm_run(&base_run).is_ok());
    assert!(parse_swarm_seat(&json!({
        "id": "00000000-0000-4000-8000-000000000002",
        "runId": "00000000-0000-4000-8000-000000000001",
        "role": "builder",
        "agentId": "grok",
        "mode": "auto",
        "paneId": null,
        "worktreePath": null,
        "branch": null,
        "status": "queued",
        "tokensUsed": 0,
        "costUsd": 0,
    }))
    .is_ok());
    assert!(parse_swarm_task(&json!({
        "id": "00000000-0000-4000-8000-000000000003",
        "runId": "00000000-0000-4000-8000-000000000001",
        "seatId": null,
        "title": "Implement X",
        "detail": null,
        "files": ["src/x.ts"],
        "status": "pending",
        "dependsOn": [],
        "attempts": 0,
        "landedCommit": null,
        "createdAt": "2026-08-25T10:00:00.000Z",
        "updatedAt": "2026-08-25T10:00:00.000Z",
    }))
    .is_ok());
    assert!(parse_swarm_message(&json!({
        "id": "00000000-0000-4000-8000-000000000004",
        "runId": "00000000-0000-4000-8000-000000000001",
        "seatId": null,
        "kind": "directive",
        "body": "wrap up",
        "createdAt": "2026-08-25T10:01:00.000Z",
    }))
    .is_ok());
}

#[test]
fn rejects_unknown_statuses_modes_and_non_uuid_ids() {
    let mut run = json!({
        "id": "00000000-0000-4000-8000-000000000001",
        "name": "Swarm One",
        "folderPath": "/tmp/repo",
        "mission": "ship the feature",
        "launchMode": "auto",
        "presetId": "skiff",
        "skillIds": ["tdd"],
        "skillDirectives": {},
        "boardSessionId": null,
        "status": "bogus",
        "startedAt": "2026-08-25T10:00:00.000Z",
        "endedAt": null,
        "budgetMs": 1_200_000,
    });
    assert!(parse_swarm_run(&run).is_err());
    run["status"] = json!("running");
    run["launchMode"] = json!("yolo");
    assert!(parse_swarm_run(&run).is_err());
    run["launchMode"] = json!("auto");
    run["id"] = json!("not-a-uuid");
    assert!(parse_swarm_run(&run).is_err());
    assert!(parse_swarm_task(&json!({
        "id": "00000000-0000-4000-8000-000000000003",
        "runId": "00000000-0000-4000-8000-000000000001",
        "seatId": null,
        "title": "X",
        "detail": null,
        "files": [],
        "status": "bogus",
        "dependsOn": [],
        "attempts": 0,
        "landedCommit": null,
        "createdAt": "2026-08-25T10:00:00.000Z",
        "updatedAt": "2026-08-25T10:00:00.000Z",
    }))
    .is_err());
}

#[test]
fn validates_create_direct_task_update_stop_and_add_seat_requests() {
    let correlation_id = "00000000-0000-4000-8000-000000000005";
    let run_id = "00000000-0000-4000-8000-000000000001";
    assert!(parse_swarm_create_request(&json!({
        "correlationId": correlation_id,
        "input": {
            "name": "Swarm One",
            "folderPath": "/tmp/repo",
            "mission": "ship it",
            "launchMode": "auto",
            "presetId": "skiff",
            "skillIds": [],
            "seats": [{ "role": "coordinator", "agentId": "claude" }],
        },
    }))
    .is_ok());
    assert!(parse_swarm_create_request(&json!({
        "correlationId": correlation_id,
        "input": {
            "name": "",
            "folderPath": "/tmp/repo",
            "mission": "ship it",
            "launchMode": "auto",
            "presetId": "skiff",
            "skillIds": [],
            "seats": [],
        },
    }))
    .is_err());
    assert!(parse_swarm_direct_request(&json!({
        "correlationId": correlation_id,
        "input": { "runId": run_id, "seatIds": [], "body": "go" },
    }))
    .is_err());
    assert!(
        parse_swarm_stop_request(&json!({ "correlationId": correlation_id, "runId": "nope" }))
            .is_err()
    );
    assert!(parse_swarm_add_seat_request(&json!({
        "correlationId": correlation_id,
        "runId": run_id,
        "role": "builder",
        "agentId": "claude",
    }))
    .is_ok());
    assert!(parse_swarm_add_seat_request(&json!({
        "correlationId": correlation_id,
        "runId": run_id,
        "role": "wizard",
        "agentId": "claude",
    }))
    .is_err());
}

#[test]
fn names_the_single_task_fallback_so_spare_builders_stay_idle_on_purpose() {
    assert!(SWARM_SINGLE_TASK_NOTE.to_lowercase().contains("one task"));
    assert!(SWARM_SINGLE_TASK_NOTE.contains("idle on purpose"));
}

#[test]
fn pulls_at_path_tokens_from_a_brief() {
    assert_eq!(
        tagged_mission_paths("use @src/a.ts and @/tmp/b.md please"),
        vec!["src/a.ts", "/tmp/b.md"]
    );
}
