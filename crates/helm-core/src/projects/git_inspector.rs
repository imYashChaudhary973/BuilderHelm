use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use helm_protocol::{parse_git_commit, GitCommit};
use helm_shared::{to_utc_timestamp, ZeroError, ZeroErrorCode};
use serde_json::json;

use crate::error_convert::{failed, parse_failed};

pub struct GitSnapshot {
    pub root_path: String,
    pub directory_name: String,
    pub branch: String,
    pub head_sha: String,
    pub dirty_count: i64,
    pub ahead_count: i64,
    pub behind_count: i64,
    pub commits: Vec<GitCommit>,
}

pub trait GitInspector {
    fn inspect(&self, selected_path: &str) -> Result<GitSnapshot, ZeroError>;
}

pub struct LocalGitInspector;

impl LocalGitInspector {
    pub fn new() -> Self {
        Self
    }

    pub fn inspect(&self, selected_path: &str) -> Result<GitSnapshot, ZeroError> {
        let selected_root = canonicalize_str(selected_path)?;
        let root_path =
            canonicalize_str(&run_git(&selected_root, &["rev-parse", "--show-toplevel"])?)?;
        let head_sha = run_git(&root_path, &["rev-parse", "HEAD"])?;
        if !is_sha(&head_sha) {
            return Err(failed(
                ZeroErrorCode::ToolExecutionFailed,
                "Git returned an invalid HEAD revision",
            ));
        }
        let branch_value = run_git(&root_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        let branch = if branch_value == "HEAD" {
            format!("detached@{}", &head_sha[..head_sha.len().min(8)])
        } else {
            branch_value
        };
        let status = run_git(
            &root_path,
            &["status", "--porcelain=v1", "--untracked-files=normal"],
        )?;
        let mut ahead_count = 0i64;
        let mut behind_count = 0i64;
        if let Ok(output) = Command::new("git")
            .args(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
            .current_dir(&root_path)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        {
            if output.status.success() {
                let counts: Vec<i64> = String::from_utf8_lossy(&output.stdout)
                    .split_whitespace()
                    .filter_map(|value| value.parse().ok())
                    .collect();
                if counts.len() >= 2 {
                    behind_count = counts[0];
                    ahead_count = counts[1];
                }
            }
        }
        Ok(GitSnapshot {
            root_path: root_path.to_string_lossy().into_owned(),
            directory_name: bounded(
                root_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(""),
                255,
                "Repository",
            ),
            branch: bounded(&branch, 255, "unknown"),
            head_sha,
            dirty_count: if status.is_empty() {
                0
            } else {
                status.split('\n').count() as i64
            },
            ahead_count,
            behind_count,
            commits: read_commits(&root_path)?,
        })
    }
}

impl Default for LocalGitInspector {
    fn default() -> Self {
        Self::new()
    }
}

fn git_unavailable() -> ZeroError {
    failed(
        ZeroErrorCode::ValidationFailed,
        "The selected folder is not an available Git repository",
    )
}

fn run_git(root_path: &Path, args: &[&str]) -> Result<String, ZeroError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root_path)
        .output()
        .map_err(|_| git_unavailable())?;
    if !output.status.success() {
        return Err(git_unavailable());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn bounded(value: &str, maximum: usize, fallback: &str) -> String {
    let clean: String = value
        .chars()
        .map(|character| {
            let code = character as u32;
            if code < 32 || code == 127 {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .trim()
        .to_string();
    if clean.is_empty() {
        fallback.to_string()
    } else {
        clean.chars().take(maximum).collect()
    }
}

fn is_sha(value: &str) -> bool {
    let len = value.len();
    (40..=64).contains(&len) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn read_commits(root_path: &Path) -> Result<Vec<GitCommit>, ZeroError> {
    let hashes = run_git(root_path, &["log", "-n", "30", "--format=%H"])?;
    let hashes: Vec<String> = hashes
        .split('\n')
        .map(str::trim)
        .filter(|value| is_sha(value))
        .map(str::to_string)
        .collect();
    let mut commits = Vec::new();
    for hash in hashes {
        let raw = run_git(
            root_path,
            &["show", "-s", "--format=%H%n%h%n%an%n%aI%n%s", &hash],
        )?;
        let mut parts = raw.split('\n');
        let sha = parts.next().unwrap_or("");
        let short_sha = parts.next().unwrap_or("");
        let author_name = parts.next().unwrap_or("");
        let authored_at = parts.next().unwrap_or("");
        let subject = parts.collect::<Vec<_>>().join(" ");
        let authored_at = to_utc_timestamp(authored_at).map_err(|_| {
            failed(
                ZeroErrorCode::ValidationFailed,
                "Git returned an invalid commit timestamp",
            )
        })?;
        commits.push(
            parse_git_commit(&json!({
                "sha": sha,
                "shortSha": short_sha,
                "authorName": bounded(author_name, 200, "Unknown author"),
                "authoredAt": authored_at,
                "subject": bounded(&subject, 500, "Untitled commit"),
            }))
            .map_err(parse_failed)?,
        );
    }
    Ok(commits)
}

fn canonicalize_str(path: &str) -> Result<PathBuf, ZeroError> {
    Path::new(path).canonicalize().map_err(|_| {
        failed(
            ZeroErrorCode::ValidationFailed,
            "The selected folder is unavailable",
        )
    })
}

impl GitInspector for LocalGitInspector {
    fn inspect(&self, selected_path: &str) -> Result<GitSnapshot, ZeroError> {
        LocalGitInspector::inspect(self, selected_path)
    }
}
