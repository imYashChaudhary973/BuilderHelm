use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use helm_shared::{ZeroError, ZeroErrorCode};

use crate::error_convert::failed;
use crate::sha256::sha256;

const MAX_NOTE_BYTES: u64 = 2_000_000;
const MAX_NOTES: usize = 10_000;

fn ignored_directory(name: &str) -> bool {
    matches!(name, ".obsidian" | ".trash" | ".git" | "node_modules")
}

fn inside(root: &Path, candidate: &Path) -> bool {
    candidate.strip_prefix(root).is_ok()
}

#[derive(Debug)]
pub struct VaultRoot {
    pub root_path: String,
    pub name: String,
}

pub fn resolve_vault_root(input: &str) -> Result<VaultRoot, ZeroError> {
    let root_path = fs::canonicalize(input).map_err(|_| {
        failed(
            ZeroErrorCode::ValidationFailed,
            "The selected vault is unavailable",
        )
    })?;
    if !root_path.is_dir() || !root_path.join(".obsidian").exists() {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "Select an Obsidian vault containing a .obsidian directory",
        ));
    }
    let name = root_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Vault")
        .to_string();
    Ok(VaultRoot {
        root_path: root_path.to_string_lossy().into_owned(),
        name,
    })
}

pub struct VaultMarkdownFile {
    pub relative_path: String,
    pub content: String,
    pub modified_at_ms: f64,
    pub size_bytes: i64,
}

struct VaultMarkdownMetadata {
    relative_path: String,
    resolved_path: PathBuf,
    modified_at_ms: f64,
    size_bytes: i64,
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn js_number(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

fn list_vault_markdown(root_path: &str) -> Result<Vec<VaultMarkdownMetadata>, ZeroError> {
    let trusted_root = fs::canonicalize(root_path).map_err(|_| {
        failed(
            ZeroErrorCode::ValidationFailed,
            "The selected vault is unavailable",
        )
    })?;
    let mut files = Vec::new();
    walk(&trusted_root, &trusted_root, &mut files)?;
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(files)
}

fn walk(
    directory: &Path,
    trusted_root: &Path,
    files: &mut Vec<VaultMarkdownMetadata>,
) -> Result<(), ZeroError> {
    let entries = fs::read_dir(directory).map_err(|_| {
        failed(
            ZeroErrorCode::ValidationFailed,
            "The selected vault is unavailable",
        )
    })?;
    for entry in entries {
        if files.len() >= MAX_NOTES {
            return Err(failed(
                ZeroErrorCode::ValidationFailed,
                "The vault exceeds the note limit",
            ));
        }
        let entry = entry.map_err(|_| {
            failed(
                ZeroErrorCode::ValidationFailed,
                "The selected vault is unavailable",
            )
        })?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if ignored_directory(&name) {
            continue;
        }
        let candidate = directory.join(entry.file_name());
        let file_type = entry.file_type().map_err(|_| {
            failed(
                ZeroErrorCode::ValidationFailed,
                "The selected vault is unavailable",
            )
        })?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            walk(&candidate, trusted_root, files)?;
            continue;
        }
        if !file_type.is_file() || !name.to_ascii_lowercase().ends_with(".md") {
            continue;
        }
        let Ok(resolved) = fs::canonicalize(&candidate) else {
            continue;
        };
        let symlink = fs::symlink_metadata(&resolved)
            .map(|meta| meta.file_type().is_symlink())
            .unwrap_or(true);
        if !inside(trusted_root, &resolved) || symlink {
            continue;
        }
        let Ok(stats) = fs::metadata(&resolved) else {
            continue;
        };
        if stats.len() > MAX_NOTE_BYTES {
            continue;
        }
        let relative = resolved
            .strip_prefix(trusted_root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        files.push(VaultMarkdownMetadata {
            relative_path: relative,
            resolved_path: resolved,
            modified_at_ms: mtime_ms(&stats),
            size_bytes: stats.len() as i64,
        });
    }
    Ok(())
}

pub fn read_vault_markdown(root_path: &str) -> Result<Vec<VaultMarkdownFile>, ZeroError> {
    let mut files = Vec::new();
    for file in list_vault_markdown(root_path)? {
        let mut buffer = Vec::new();
        let Ok(mut handle) = fs::File::open(&file.resolved_path) else {
            continue;
        };
        if handle.read_to_end(&mut buffer).is_err() || buffer.contains(&0) {
            continue;
        }
        files.push(VaultMarkdownFile {
            relative_path: file.relative_path,
            content: String::from_utf8_lossy(&buffer).into_owned(),
            modified_at_ms: file.modified_at_ms,
            size_bytes: file.size_bytes,
        });
    }
    Ok(files)
}

pub fn vault_markdown_fingerprint(root_path: &str) -> Result<String, ZeroError> {
    let mut payload = Vec::new();
    for file in list_vault_markdown(root_path)? {
        payload.extend_from_slice(file.relative_path.as_bytes());
        payload.push(0);
        payload.extend_from_slice(js_number(file.modified_at_ms).as_bytes());
        payload.push(0);
        payload.extend_from_slice(js_number(file.size_bytes as f64).as_bytes());
        payload.push(0);
    }
    Ok(sha256(payload))
}

pub fn read_vault_source(root_path: &str, relative_path: &str) -> Result<String, ZeroError> {
    let trusted_root = fs::canonicalize(root_path).map_err(|_| {
        failed(
            ZeroErrorCode::IntegrationOffline,
            "The cited note is unavailable",
        )
    })?;
    let candidate = trusted_root.join(relative_path);
    let resolved = fs::canonicalize(&candidate).map_err(|_| {
        failed(
            ZeroErrorCode::IntegrationOffline,
            "The cited note is unavailable",
        )
    })?;
    let is_markdown = resolved
        .to_string_lossy()
        .to_ascii_lowercase()
        .ends_with(".md");
    if !inside(&trusted_root, &resolved) || !is_markdown {
        return Err(failed(
            ZeroErrorCode::PermissionDenied,
            "The cited source is outside the vault",
        ));
    }
    let stats = fs::metadata(&resolved).map_err(|_| {
        failed(
            ZeroErrorCode::ValidationFailed,
            "The cited note cannot be displayed",
        )
    })?;
    if !stats.is_file() || stats.len() > MAX_NOTE_BYTES {
        return Err(failed(
            ZeroErrorCode::ValidationFailed,
            "The cited note cannot be displayed",
        ));
    }
    let content = fs::read_to_string(&resolved).map_err(|_| {
        failed(
            ZeroErrorCode::ValidationFailed,
            "The cited note cannot be displayed",
        )
    })?;
    Ok(content.replace("\r\n", "\n").replace('\r', "\n"))
}
