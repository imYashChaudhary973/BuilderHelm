use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use helm_protocol::BoardPaneArgv;
use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

fn failed(message: impl Into<String>) -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::ToolExecutionFailed,
        message,
        ZeroErrorOptions::default(),
    )
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn terminal_env() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    let home = home_dir().to_string_lossy().into_owned();
    env.insert(
        "HOME".into(),
        std::env::var("HOME").unwrap_or_else(|_| home.clone()),
    );
    env.insert("USER".into(), std::env::var("USER").unwrap_or_default());
    env.insert(
        "LOGNAME".into(),
        std::env::var("LOGNAME").unwrap_or_else(|_| std::env::var("USER").unwrap_or_default()),
    );
    env.insert("SHELL".into(), "/bin/zsh".into());
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("COLORTERM".into(), "truecolor".into());
    env.insert(
        "LANG".into(),
        std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into()),
    );
    env.insert(
        "PATH".into(),
        std::env::var("PATH").unwrap_or_else(|_| {
            "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin".into()
        }),
    );
    env.insert(
        "TMPDIR".into(),
        std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".into()),
    );
    env.insert("PWD".into(), std::env::var("PWD").unwrap_or(home));
    env
}

pub fn resolve_workdir(cwd: &str) -> PathBuf {
    Path::new(cwd)
        .canonicalize()
        .ok()
        .filter(|path| path.is_dir())
        .unwrap_or_else(home_dir)
}

pub fn spawn_helper_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("spawn-helper")))
        .unwrap_or_else(|| PathBuf::from("spawn-helper"))
}

pub fn ensure_helper() -> PathBuf {
    let helper = spawn_helper_path();
    if helper.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(&helper) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&helper, perms);
            }
        }
    }
    helper
}

pub fn spawn_attempts(command: &str) -> Vec<Vec<String>> {
    let extra: Vec<String> = if command.trim().is_empty() {
        Vec::new()
    } else {
        vec!["-c".into(), command.to_string()]
    };
    let mut interactive = vec!["-i".into()];
    interactive.extend(extra.clone());
    vec![interactive, extra]
}

fn apply_env(cmd: &mut CommandBuilder, workdir: &Path) {
    for (key, value) in terminal_env() {
        cmd.env(key, value);
    }
    cmd.env("PWD", workdir);
    cmd.env("TERM", "xterm-256color");
    cmd.cwd(workdir);
}

pub struct LivePty {
    pub pid: u32,
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Box<dyn portable_pty::ChildKiller + Send + Sync>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
}

impl LivePty {
    pub fn write(&self, data: &str) {
        if let Ok(mut writer) = self.writer.lock() {
            let _ = writer.write_all(data.as_bytes());
            let _ = writer.flush();
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }

    pub fn kill(&self) {
        let mut killer = self.killer.clone_killer();
        let _ = killer.kill();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        if self.pid != 0 {
            let _ = std::process::Command::new("kill")
                .args(["-9", &self.pid.to_string()])
                .status();
        }
    }
}

impl Drop for LivePty {
    fn drop(&mut self) {
        self.kill();
    }
}

fn spawn_command(
    binary: &str,
    args: &[String],
    workdir: &Path,
    cols: u16,
    rows: u16,
) -> Result<LivePty, ZeroError> {
    let helper = ensure_helper();
    let pty_system = native_pty_system();
    // macOS returns transient ENXIO (os error -6) when a PTY master is
    // allocated while a previous burst of ptys is still being reaped — a
    // 12-pane board immediately after another session tears down hits it
    // reliably (P5-1). Retrying the open is enough; a dead terminal is not.
    let mut pair: Option<portable_pty::PtyPair> = None;
    for attempt in 0..3u8 {
        match pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(opened) => {
                pair = Some(opened);
                break;
            }
            Err(error) if attempt < 2 => {
                std::thread::sleep(std::time::Duration::from_millis(25));
                let _ = error;
            }
            Err(error) => {
                return Err(failed(format!(
                    "Could not start a terminal in {} ({}; helper={} exists={})",
                    workdir.display(),
                    error,
                    helper.display(),
                    helper.exists()
                )));
            }
        }
    }
    let pair = match pair {
        Some(pair) => pair,
        None => {
            return Err(failed(format!(
                "Could not start a terminal in {} (no pty pair; helper={} exists={})",
                workdir.display(),
                helper.display(),
                helper.exists()
            )))
        }
    };
    let mut cmd = CommandBuilder::new(binary);
    cmd.args(args);
    apply_env(&mut cmd, workdir);
    let child = pair.slave.spawn_command(cmd).map_err(|error| {
        failed(format!(
            "Could not start a terminal in {} ({}; helper={} exists={})",
            workdir.display(),
            error,
            helper.display(),
            helper.exists()
        ))
    })?;
    let pid = child.process_id().unwrap_or(0);
    let killer = child.clone_killer();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| failed(error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| failed(error.to_string()))?;
    let live = LivePty {
        pid,
        master: pair.master,
        writer: Mutex::new(writer),
        killer,
        child: Mutex::new(child),
    };
    let _ = reader;
    Ok(live)
}

pub fn spawn_reader(pty: &LivePty, sink: Arc<Mutex<String>>) {
    if let Ok(mut reader) = pty.master.try_clone_reader() {
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut out) = sink.lock() {
                            out.push_str(&String::from_utf8_lossy(&buf[..n]));
                            if out.len() > 80_000 {
                                let overflow = out.len() - 80_000;
                                out.drain(..overflow);
                            }
                        }
                    }
                }
            }
        });
    }
}

pub fn spawn_argv_pty(
    cwd: &str,
    argv: &BoardPaneArgv,
    cols: u16,
    rows: u16,
) -> Result<LivePty, ZeroError> {
    let _helper = ensure_helper();
    let workdir = resolve_workdir(cwd);
    spawn_command(&argv.binary, &argv.args, &workdir, cols, rows)
}

pub fn spawn_pty(cwd: &str, command: &str, cols: u16, rows: u16) -> Result<LivePty, ZeroError> {
    let helper = ensure_helper();
    let shell = if Path::new("/bin/zsh").exists() {
        "/bin/zsh"
    } else {
        "/bin/bash"
    };
    let workdir = resolve_workdir(cwd);
    let mut last: Option<ZeroError> = None;
    for args in spawn_attempts(command) {
        match spawn_command(shell, &args, &workdir, cols, rows) {
            Ok(pty) => return Ok(pty),
            Err(error) => last = Some(error),
        }
    }
    let detail = last
        .as_ref()
        .map(|error| error.message().to_string())
        .unwrap_or_else(|| "unknown spawn error".into());
    Err(failed(format!(
        "Could not start a terminal in {} ({}; helper={} exists={})",
        workdir.display(),
        detail,
        helper.display(),
        helper.exists()
    )))
}

pub fn probe_pty(cwd: &str) -> String {
    let helper = spawn_helper_path();
    match spawn_pty(cwd, "", 80, 24) {
        Ok(pty) => {
            let pid = pty.pid;
            pty.kill();
            format!("ok pid={pid} helper={}", helper.display())
        }
        Err(error) => format!(
            "fail helper={} exists={} err={}",
            helper.display(),
            helper.exists(),
            error.message()
        ),
    }
}
