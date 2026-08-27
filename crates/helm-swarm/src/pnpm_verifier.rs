use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::process::Stdio;

use tokio::process::Command;

use crate::swarm_service::{SwarmTaskVerifier, SwarmVerifyInput, SwarmVerifyResult};

pub fn workspace_targets_for_files(files: &[String]) -> Vec<String> {
    let mut targets = BTreeSet::new();
    for file in files {
        let trimmed = file.trim_start_matches("./");
        let parts: Vec<_> = trimmed.split('/').collect();
        if parts.len() < 3 {
            continue;
        }
        let root = parts[0];
        let name = parts[1];
        if root != "packages" && root != "apps" {
            continue;
        }
        if name.is_empty() {
            continue;
        }
        targets.insert(format!("{root}/{name}"));
    }
    targets.into_iter().collect()
}

pub struct PnpmVerifierOptions {
    pub install: bool,
    pub typecheck_timeout_ms: u64,
    pub test_timeout_ms: u64,
    pub install_timeout_ms: u64,
}

impl Default for PnpmVerifierOptions {
    fn default() -> Self {
        Self {
            install: true,
            typecheck_timeout_ms: 300_000,
            test_timeout_ms: 600_000,
            install_timeout_ms: 600_000,
        }
    }
}

fn read_manifest_scripts(manifest_path: &Path) -> BTreeSet<String> {
    let Ok(text) = fs::read_to_string(manifest_path) else {
        return BTreeSet::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
        return BTreeSet::new();
    };
    parsed
        .get("scripts")
        .and_then(|scripts| scripts.as_object())
        .map(|scripts| scripts.keys().cloned().collect())
        .unwrap_or_default()
}

pub struct PnpmTaskVerifier {
    options: PnpmVerifierOptions,
}

impl PnpmTaskVerifier {
    pub fn new(options: PnpmVerifierOptions) -> Self {
        Self { options }
    }

    async fn run(&self, args: &[&str], cwd: &str, timeout: u64) -> SwarmVerifyResult {
        let mut command = Command::new("pnpm");
        command
            .args(args)
            .current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        match tokio::time::timeout(std::time::Duration::from_millis(timeout), command.output())
            .await
        {
            Ok(Ok(output)) if output.status.success() => SwarmVerifyResult {
                ok: true,
                detail: String::new(),
            },
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let tail = stdout
                    .trim()
                    .lines()
                    .rev()
                    .take(8)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n");
                SwarmVerifyResult {
                    ok: false,
                    detail: if tail.is_empty() {
                        "no output".into()
                    } else {
                        tail
                    },
                }
            }
            _ => SwarmVerifyResult {
                ok: false,
                detail: "no output".into(),
            },
        }
    }
}

impl SwarmTaskVerifier for PnpmTaskVerifier {
    fn verify(
        &self,
        input: SwarmVerifyInput,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = SwarmVerifyResult> + '_>> {
        Box::pin(async move {
            let cwd = input.worktree_path;
            let manifest = Path::new(&cwd).join("package.json");
            if !manifest.exists() {
                return SwarmVerifyResult {
                    ok: true,
                    detail: "no package manifest; nothing to verify".into(),
                };
            }
            let scripts = read_manifest_scripts(&manifest);
            if self.options.install && !Path::new(&cwd).join("node_modules").exists() {
                let installed = self
                    .run(
                        &["install", "--prefer-offline"],
                        &cwd,
                        self.options.install_timeout_ms,
                    )
                    .await;
                if !installed.ok {
                    return SwarmVerifyResult {
                        ok: false,
                        detail: format!("pnpm install failed: {}", installed.detail),
                    };
                }
            }
            if scripts.contains("typecheck") {
                let typecheck = self
                    .run(&["typecheck"], &cwd, self.options.typecheck_timeout_ms)
                    .await;
                if !typecheck.ok {
                    return SwarmVerifyResult {
                        ok: false,
                        detail: format!("typecheck failed: {}", typecheck.detail),
                    };
                }
            }
            let targets = workspace_targets_for_files(&input.task.files);
            if targets.is_empty() || !scripts.contains("test") {
                return SwarmVerifyResult {
                    ok: true,
                    detail: "available checks passed".into(),
                };
            }
            let mut args = vec!["exec".into(), "vitest".into(), "run".into()];
            args.extend(targets.iter().cloned());
            let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
            let tests = self
                .run(&arg_refs, &cwd, self.options.test_timeout_ms)
                .await;
            if !tests.ok {
                return SwarmVerifyResult {
                    ok: false,
                    detail: format!("tests failed: {}", tests.detail),
                };
            }
            SwarmVerifyResult {
                ok: true,
                detail: format!("typecheck and tests passed for {}", targets.join(", ")),
            }
        })
    }
}
