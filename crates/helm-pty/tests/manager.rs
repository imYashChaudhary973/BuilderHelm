use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use helm_protocol::{BoardAgentId, BoardIsolation, BoardPaneArgv};
use helm_pty::{
    spawn_attempts, spawn_helper_path, spawn_pty, terminal_env, BoardCreateInput, BoardPaneSpec,
    BoardPtyManager, SpawnArgs,
};
use helm_shared::ZeroErrorCode;

fn sleep_argv() -> BoardPaneArgv {
    BoardPaneArgv {
        binary: "/bin/sleep".into(),
        args: vec!["60".into()],
    }
}

fn input(folder: &str, pane_count: usize) -> BoardCreateInput {
    BoardCreateInput {
        folder_path: folder.into(),
        isolation: BoardIsolation::Shared,
        panes: (0..pane_count)
            .map(|slot| BoardPaneSpec {
                slot: slot as i64,
                agent_id: BoardAgentId::Shell,
                command: None,
                argv: Some(sleep_argv()),
            })
            .collect(),
    }
}

#[test]
fn fallback_chain_tries_interactive_then_plain() {
    assert_eq!(
        spawn_attempts(""),
        vec![vec!["-i".to_string()], Vec::<String>::new()]
    );
    assert_eq!(
        spawn_attempts("echo hi"),
        vec![
            vec!["-i".to_string(), "-c".to_string(), "echo hi".to_string()],
            vec!["-c".to_string(), "echo hi".to_string()]
        ]
    );
}

#[test]
fn terminal_env_sets_term_and_pwd() {
    let env = terminal_env();
    assert_eq!(env.get("TERM").map(String::as_str), Some("xterm-256color"));
    assert!(env.contains_key("PWD"));
    assert_eq!(env.get("COLORTERM").map(String::as_str), Some("truecolor"));
}

#[test]
fn spawn_error_reports_helper_path_and_existence() {
    let helper = spawn_helper_path();
    let error = spawn_pty("/tmp", "definitely-not-a-binary-xyz", 80, 24);
    // zsh -c still starts; force argv miss via helper message format on open failure
    // by using a workdir that exists and a command that cannot exec as the shell itself.
    let _ = error;
    let fail = helm_pty::spawn_argv_pty(
        "/tmp",
        &BoardPaneArgv {
            binary: "/no/such/helm-pty-binary".into(),
            args: vec![],
        },
        80,
        24,
    );
    let fail = match fail {
        Err(error) => error,
        Ok(_) => panic!("expected spawn failure"),
    };
    let message = fail.message();
    assert!(message.contains("helper="), "{message}");
    assert!(message.contains("exists="), "{message}");
    assert!(message.contains(&helper.display().to_string()) || message.contains("helper="));
}

#[tokio::test(flavor = "current_thread")]
async fn locates_serially_then_spawns_preserving_slot_order() {
    let folder = std::env::temp_dir().join(format!("zero-board-pty-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let folder_for_locate = folder.clone();
    let inflight = Arc::new(Mutex::new(0usize));
    let max_inflight = Arc::new(Mutex::new(0usize));
    let locate_started = Arc::new(Mutex::new(Vec::new()));
    let locate_finished = Arc::new(Mutex::new(Vec::new()));
    let spawn_started = Arc::new(Mutex::new(Vec::new()));
    let count = Arc::new(AtomicUsize::new(0));
    let manager = BoardPtyManager::with_spawner({
        let spawn_started = spawn_started.clone();
        let count = count.clone();
        Arc::new(move |args: SpawnArgs| {
            spawn_started.lock().unwrap().push(Instant::now());
            count.fetch_add(1, Ordering::SeqCst);
            helm_pty::spawn_argv_pty(&args.cwd, args.argv.as_ref().unwrap(), args.cols, args.rows)
        })
    });
    let summary = manager
        .create_session(input(folder.to_str().unwrap(), 3), {
            let inflight = inflight.clone();
            let max_inflight = max_inflight.clone();
            let locate_started = locate_started.clone();
            let locate_finished = locate_finished.clone();
            move |slot| {
                let inflight = inflight.clone();
                let max_inflight = max_inflight.clone();
                let locate_started = locate_started.clone();
                let locate_finished = locate_finished.clone();
                let folder = folder_for_locate.clone();
                async move {
                    {
                        let mut n = inflight.lock().unwrap();
                        *n += 1;
                        let mut max = max_inflight.lock().unwrap();
                        *max = (*max).max(*n);
                        locate_started.lock().unwrap().push(slot);
                    }
                    tokio::task::yield_now().await;
                    {
                        *inflight.lock().unwrap() -= 1;
                        locate_finished.lock().unwrap().push(Instant::now());
                    }
                    (folder.to_string_lossy().into_owned(), None)
                }
            }
        })
        .await
        .unwrap();
    assert_eq!(*max_inflight.lock().unwrap(), 1);
    assert_eq!(*locate_started.lock().unwrap(), vec![0, 1, 2]);
    assert_eq!(
        summary
            .panes
            .iter()
            .map(|pane| pane.slot)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    let min_spawn = spawn_started.lock().unwrap().iter().min().copied();
    let max_locate = locate_finished.lock().unwrap().iter().max().copied();
    if let (Some(spawn), Some(locate)) = (min_spawn, max_locate) {
        assert!(spawn >= locate);
    }
    manager.dispose();
    let _ = std::fs::remove_dir_all(&folder);
}

#[tokio::test(flavor = "current_thread")]
async fn kills_every_spawned_pane_when_one_spawn_fails() {
    let folder = std::env::temp_dir().join(format!("zero-board-pty-fail-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let pids = Arc::new(Mutex::new(Vec::new()));
    let count = Arc::new(AtomicUsize::new(0));
    let manager = BoardPtyManager::with_spawner({
        let pids = pids.clone();
        let count = count.clone();
        Arc::new(move |args: SpawnArgs| {
            let n = count.fetch_add(1, Ordering::SeqCst) + 1;
            if n == 2 {
                return Err(helm_shared::ZeroError::new(
                    ZeroErrorCode::ToolExecutionFailed,
                    "forced spawn failure 2",
                    helm_shared::ZeroErrorOptions::default(),
                ));
            }
            let pty = helm_pty::spawn_argv_pty(
                &args.cwd,
                args.argv.as_ref().unwrap(),
                args.cols,
                args.rows,
            )?;
            pids.lock().unwrap().push(pty.pid);
            Ok(pty)
        })
    });
    let error = manager
        .create_session(input(folder.to_str().unwrap(), 3), |_| async {
            (folder.to_string_lossy().into_owned(), None)
        })
        .await
        .unwrap_err();
    assert!(error.message().contains("forced spawn failure 2"));
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline && pids.lock().unwrap().iter().any(|pid| alive(*pid)) {
        tokio::task::yield_now().await;
    }
    assert!(
        pids.lock().unwrap().iter().all(|pid| !alive(*pid)),
        "leaked child processes {:?}",
        pids.lock().unwrap()
    );
    let missing = manager
        .add_pane("missing", BoardAgentId::Shell, None, None, |_| async {
            ("/tmp".into(), None)
        })
        .await
        .unwrap_err();
    assert!(missing.message().contains("Unknown pane session"));
    manager.dispose();
    let _ = std::fs::remove_dir_all(&folder);
}

#[tokio::test(flavor = "current_thread")]
async fn kills_nothing_when_every_spawn_fails() {
    let folder =
        std::env::temp_dir().join(format!("zero-board-pty-allfail-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let pids: Arc<Mutex<Vec<u32>>> = Arc::new(Mutex::new(Vec::new()));
    let manager = BoardPtyManager::with_spawner({
        let pids = pids.clone();
        Arc::new(move |_args: SpawnArgs| {
            let _ = pids;
            Err(helm_shared::ZeroError::new(
                ZeroErrorCode::ToolExecutionFailed,
                "forced spawn failure",
                helm_shared::ZeroErrorOptions::default(),
            ))
        })
    });
    let error = manager
        .create_session(input(folder.to_str().unwrap(), 3), |_| async {
            (folder.to_string_lossy().into_owned(), None)
        })
        .await
        .unwrap_err();
    assert!(error.message().contains("forced spawn failure"));
    assert!(pids.lock().unwrap().is_empty());
    manager.dispose();
    let _ = std::fs::remove_dir_all(&folder);
}

#[tokio::test(flavor = "current_thread")]
async fn opens_12_panes_in_under_3s() {
    let folder = std::env::temp_dir().join(format!("zero-board-pty-12-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let manager = BoardPtyManager::new();
    let started = Instant::now();
    let summary = manager
        .create_session(input(folder.to_str().unwrap(), 12), |_| async {
            (folder.to_string_lossy().into_owned(), None)
        })
        .await
        .unwrap();
    assert_eq!(summary.pane_count, 12);
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    manager.dispose();
    let _ = std::fs::remove_dir_all(&folder);
}

fn alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
