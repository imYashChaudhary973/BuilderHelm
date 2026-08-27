use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use helm_protocol::{EditorEntry, EditorFile, EditorKind};
use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};

use crate::dialogs::pick_file;

const MAX_BYTES: u64 = 1_000_000;
const MAX_ENTRIES: usize = 300;

fn skip_name(name: &str) -> bool {
    matches!(
        name,
        ".git" | ".DS_Store" | "node_modules" | "dist" | "out" | ".next" | ".pnpm-store"
    )
}

fn failed(code: ZeroErrorCode, message: &str) -> ZeroError {
    ZeroError::new(code, message, ZeroErrorOptions::default())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn inside_workspace(root: &Path, target: &Path) -> bool {
    target == root || target.starts_with(root)
}

fn resolve_workspace(root: &str, path: &str) -> Result<(PathBuf, PathBuf), ZeroError> {
    let resolved_root = fs::canonicalize(root)
        .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The folder does not exist"))?;
    let resolved = fs::canonicalize(path)
        .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The folder does not exist"))?;
    if resolved_root == Path::new("/")
        || resolved_root == Path::new("/Users")
        || resolved_root == Path::new("/System")
        || home_dir().is_some_and(|home| resolved_root == home)
    {
        return Err(failed(
            ZeroErrorCode::PermissionDenied,
            "Pick a project folder, not your home directory",
        ));
    }
    if !inside_workspace(&resolved_root, &resolved) {
        return Err(failed(
            ZeroErrorCode::PermissionDenied,
            "Path is outside the workspace",
        ));
    }
    Ok((resolved_root, resolved))
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn simple_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

pub fn read_editor_file(root: &str, path: &str) -> Result<EditorFile, ZeroError> {
    let (_, resolved) = resolve_workspace(root, path)?;
    let stats = fs::metadata(&resolved)
        .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The file does not exist"))?;
    if !stats.is_file() {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "The path is not a file",
        ));
    }
    if stats.len() > MAX_BYTES {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "The file is larger than 1 MB",
        ));
    }
    let mut bytes = Vec::new();
    File::open(&resolved)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The file does not exist"))?;
    Ok(EditorFile {
        path: display(&resolved),
        name: resolved
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

pub fn write_editor_file(root: &str, path: &str, text: &str) -> Result<EditorFile, ZeroError> {
    if text.len() > MAX_BYTES as usize {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "The file is larger than 1 MB",
        ));
    }
    let (_, resolved) = resolve_workspace(root, path)?;
    let stats = fs::metadata(&resolved)
        .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The file does not exist"))?;
    if !stats.is_file() {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "The path is not a file",
        ));
    }
    fs::write(&resolved, text)
        .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The file does not exist"))?;
    Ok(EditorFile {
        path: display(&resolved),
        name: resolved
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        text: text.to_string(),
    })
}

pub fn list_editor_dir(
    root: &str,
    path: Option<&str>,
    hidden: bool,
) -> Result<Vec<EditorEntry>, ZeroError> {
    let path = path.unwrap_or(root);
    let (_, resolved) = resolve_workspace(root, path)?;
    let stats = fs::metadata(&resolved)
        .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The folder does not exist"))?;
    if !stats.is_dir() {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "The path is not a folder",
        ));
    }
    let mut entries = Vec::new();
    let read = fs::read_dir(&resolved)
        .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The folder does not exist"))?;
    for entry in read.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if skip_name(name) {
            continue;
        }
        if !hidden && name.starts_with('.') {
            continue;
        }
        let kind = if entry.path().is_dir() {
            EditorKind::Dir
        } else {
            EditorKind::File
        };
        entries.push(EditorEntry {
            path: display(&resolved.join(name)),
            name: name.to_string(),
            kind,
        });
        if entries.len() == MAX_ENTRIES {
            break;
        }
    }
    entries.sort_by(|left, right| match (left.kind, right.kind) {
        (EditorKind::Dir, EditorKind::File) => std::cmp::Ordering::Less,
        (EditorKind::File, EditorKind::Dir) => std::cmp::Ordering::Greater,
        _ => left
            .name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name)),
    });
    Ok(entries)
}

pub fn create_editor_entry(
    root: &str,
    path: &str,
    kind: EditorKind,
) -> Result<EditorEntry, ZeroError> {
    let path_buf = PathBuf::from(path);
    let name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    if !simple_name(name) {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "Use a simple file name",
        ));
    }
    let parent = path_buf.parent().unwrap_or(Path::new("."));
    let parent_s = parent.to_string_lossy();
    let (workspace, parent_resolved) = resolve_workspace(root, parent_s.as_ref())?;
    let target = parent_resolved.join(name);
    if !inside_workspace(&workspace, &target) {
        return Err(failed(
            ZeroErrorCode::PermissionDenied,
            "Path is outside the workspace",
        ));
    }
    if target.exists() {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "That name already exists",
        ));
    }
    match kind {
        EditorKind::Dir => fs::create_dir(&target)
            .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The folder does not exist"))?,
        EditorKind::File => fs::write(&target, "")
            .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "The file does not exist"))?,
    }
    Ok(EditorEntry {
        path: display(&target),
        name: name.to_string(),
        kind,
    })
}

pub fn search_editor_files(
    root: &str,
    query: &str,
    hidden: bool,
) -> Result<Vec<EditorEntry>, ZeroError> {
    let needle = query.trim().to_lowercase();
    let mut matches = Vec::new();
    let start = resolve_workspace(root, root)?.1;
    let mut queue = vec![display(&start)];
    while !queue.is_empty() && matches.len() < 80 {
        let current = queue.remove(0);
        let entries = list_editor_dir(root, Some(&current), hidden)?;
        for entry in entries {
            if entry.kind == EditorKind::Dir {
                queue.push(entry.path.clone());
            }
            if entry.name.to_lowercase().contains(&needle) {
                matches.push(entry);
            }
        }
    }
    Ok(matches)
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub code: String,
    pub staged: bool,
}

pub fn list_git_changes(root: &str) -> Result<Vec<GitChange>, ZeroError> {
    let (workspace, _) = resolve_workspace(root, root)?;
    match git_output(
        &workspace,
        &["status", "--porcelain=v1"],
        Duration::from_secs(8),
    ) {
        Ok(status) => {
            let status = status.trim();
            if status.is_empty() {
                return Ok(Vec::new());
            }
            let mut rows = Vec::new();
            for line in status.lines().take(80) {
                let path = line
                    .get(3..)
                    .unwrap_or("")
                    .split(" -> ")
                    .last()
                    .unwrap_or("")
                    .to_string();
                let index = line.chars().next().unwrap_or(' ');
                let work = line.chars().nth(1).unwrap_or(' ');
                if index != ' ' && index != '?' {
                    rows.push(GitChange {
                        path: path.clone(),
                        code: index.to_string(),
                        staged: true,
                    });
                }
                if work != ' ' && work != '?' {
                    rows.push(GitChange {
                        path: path.clone(),
                        code: work.to_string(),
                        staged: false,
                    });
                }
                if index == '?' && work == '?' {
                    rows.push(GitChange {
                        path,
                        code: "U".into(),
                        staged: false,
                    });
                }
            }
            Ok(rows)
        }
        Err(_) => Ok(Vec::new()),
    }
}

fn git_output(cwd: &Path, args: &[&str], timeout: Duration) -> Result<String, ZeroError> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|cause| git_failed(&cause.to_string()))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                if let Some(mut out) = child.stdout.take() {
                    let mut bytes = Vec::new();
                    let _ = out.read_to_end(&mut bytes);
                    stdout = String::from_utf8_lossy(&bytes).into_owned();
                }
                let mut stderr = String::new();
                if let Some(mut err) = child.stderr.take() {
                    let mut bytes = Vec::new();
                    let _ = err.read_to_end(&mut bytes);
                    stderr = String::from_utf8_lossy(&bytes).into_owned();
                }
                if status.success() {
                    return Ok(stdout);
                }
                let detail = if stderr.trim().is_empty() {
                    "Git failed".to_string()
                } else {
                    stderr.trim().to_string()
                };
                return Err(git_failed(&detail));
            }
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                return Err(git_failed("Git failed"));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(cause) => return Err(git_failed(&cause.to_string())),
        }
    }
}

fn git_failed(detail: &str) -> ZeroError {
    let mut message = detail.to_string();
    message.truncate(300);
    failed(ZeroErrorCode::ToolExecutionFailed, &message)
}

fn run_git(root: &Path, args: &[&str]) -> Result<(), ZeroError> {
    git_output(root, args, Duration::from_secs(15)).map(|_| ())
}

pub fn stage_git_path(root: &str, path: Option<&str>, staged: bool) -> Result<(), ZeroError> {
    let (workspace, _) = resolve_workspace(root, root)?;
    let Some(path) = path else {
        return if staged {
            run_git(&workspace, &["add", "-A"])
        } else {
            run_git(&workspace, &["restore", "--staged", "."])
        };
    };
    let (_, target) = resolve_workspace(root, path)?;
    let rel = target.strip_prefix(&workspace).map_err(|_| {
        failed(
            ZeroErrorCode::PermissionDenied,
            "Path is outside the workspace",
        )
    })?;
    let rel = rel.to_string_lossy();
    if rel.is_empty() || rel.starts_with("..") {
        return Err(failed(
            ZeroErrorCode::PermissionDenied,
            "Path is outside the workspace",
        ));
    }
    if staged {
        run_git(&workspace, &["add", "--", rel.as_ref()])
    } else {
        run_git(&workspace, &["restore", "--staged", "--", rel.as_ref()])
    }
}

pub fn commit_git(root: &str, message: &str) -> Result<(), ZeroError> {
    let (workspace, _) = resolve_workspace(root, root)?;
    run_git(&workspace, &["commit", "-m", message])
}

pub fn pick_editor_file() -> Result<Option<EditorFile>, ZeroError> {
    let Some(path) = pick_file("Open file") else {
        return Ok(None);
    };
    let path = display(&path);
    read_editor_file(&path, &path).map(Some)
}
