use helm_protocol::swarm_plan_budget;

use std::collections::{HashMap, HashSet};
use std::process::Stdio;

use serde::Deserialize;
use tokio::process::Command;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoSnapshot {
    pub files: Vec<String>,
    pub truncated: bool,
}

pub async fn build_repo_snapshot(folder_path: &str, limit: usize) -> RepoSnapshot {
    let output = Command::new("git")
        .args(["ls-files"])
        .current_dir(folder_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await;
    let Ok(output) = output else {
        return RepoSnapshot {
            files: Vec::new(),
            truncated: false,
        };
    };
    if !output.status.success() {
        return RepoSnapshot {
            files: Vec::new(),
            truncated: false,
        };
    }
    let all: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    let truncated = all.len() > limit;
    RepoSnapshot {
        files: all.into_iter().take(limit).collect(),
        truncated,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedTask {
    pub title: String,
    pub detail: Option<String>,
    pub files: Vec<String>,
    pub depends_on: Vec<usize>,
}

#[derive(Debug, Deserialize)]
struct PlanTaskIn {
    title: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    files: Vec<String>,
    #[serde(default, rename = "dependsOn")]
    depends_on: Vec<i64>,
}

#[derive(Debug, Deserialize)]
struct PlanIn {
    tasks: Vec<PlanTaskIn>,
}

fn is_real_source(file: &str) -> bool {
    let lower = file.to_ascii_lowercase();
    lower.ends_with(".ts")
        || lower.ends_with(".js")
        || lower.ends_with(".tsx")
        || lower.ends_with(".jsx")
        || lower.ends_with(".json")
}

pub fn normalize_swarm_plan(
    plan: &serde_json::Value,
    max_tasks: usize,
) -> Result<Vec<PlannedTask>, String> {
    let parsed: PlanIn = serde_json::from_value(plan.clone())
        .map_err(|_| "plan contained no runnable tasks after normalization".to_string())?;
    if parsed.tasks.is_empty() || parsed.tasks.len() > 32 {
        return Err("plan contained no runnable tasks after normalization".into());
    }
    let mut claimed = HashSet::new();
    let mut kept: Vec<PlannedTask> = Vec::new();
    let mut index_map: HashMap<usize, usize> = HashMap::new();
    for (original_index, task) in parsed.tasks.into_iter().enumerate() {
        if kept.len() >= max_tasks {
            break;
        }
        let title = task.title.trim();
        if title.is_empty() || title.len() > 500 {
            return Err("invalid plan task title".into());
        }
        let files: Vec<String> = task
            .files
            .into_iter()
            .map(|file| file.trim().to_string())
            .filter(|file| !file.is_empty())
            .collect();
        if files.len() > 200 {
            return Err("too many files".into());
        }
        let owned: Vec<String> = files
            .iter()
            .filter(|file| !claimed.contains(*file))
            .cloned()
            .collect();
        if !files.is_empty() && owned.is_empty() {
            continue;
        }
        for file in &owned {
            claimed.insert(file.clone());
        }
        index_map.insert(original_index, kept.len());
        let depends_on: Vec<usize> = {
            let mut seen = HashSet::new();
            task.depends_on
                .into_iter()
                .filter_map(|dep| {
                    if dep < 0 {
                        return None;
                    }
                    index_map.get(&(dep as usize)).copied()
                })
                .filter(|dep| *dep < kept.len() && seen.insert(*dep))
                .collect()
        };
        kept.push(PlannedTask {
            title: title.to_string(),
            detail: task.detail.filter(|value| !value.is_empty()),
            files: owned,
            depends_on,
        });
    }
    if kept.is_empty() {
        return Err("plan contained no runnable tasks after normalization".into());
    }
    Ok(kept)
}

pub fn pin_foundation(tasks: Vec<PlannedTask>, snapshot: &RepoSnapshot) -> Vec<PlannedTask> {
    if tasks.len() < 2 || snapshot.files.iter().any(|file| is_real_source(file)) {
        return tasks;
    }
    tasks
        .into_iter()
        .enumerate()
        .map(|(index, mut task)| {
            if index == 0 || task.depends_on.contains(&0) {
                task
            } else {
                task.depends_on.insert(0, 0);
                task
            }
        })
        .collect()
}

pub struct SwarmPlanRequest {
    pub mission: String,
    pub snapshot: RepoSnapshot,
    pub max_tasks: usize,
    pub roster: String,
}

pub trait SwarmPlanner {
    fn plan<'a>(
        &'a self,
        request: &'a SwarmPlanRequest,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<PlannedTask>, String>> + 'a>>;
}

pub fn build_plan_prompt(request: &SwarmPlanRequest) -> String {
    let files = request.snapshot.files.join("\n");
    let mut foundation = Vec::new();
    if !request
        .snapshot
        .files
        .iter()
        .any(|file| is_real_source(file))
    {
        foundation.push("- The repository is empty or docs-only. Task 0 MUST be the foundation (shell, package, entry).");
        foundation.push("- Every later task MUST set dependsOn: [0].");
    }
    let truncated = if request.snapshot.truncated {
        " (truncated)"
    } else {
        ""
    };
    let file_block = if files.is_empty() {
        "(no tracked files)"
    } else {
        files.as_str()
    };
    format!(
        "You are the coordinator of a BuilderHelm swarm. Split the mission into\nat most {} independent tasks for parallel builders.\n\nRoster: {}\nBuilders implement. Scouts investigate. Reviewers review. Do not invent roles this roster does not have.\n\nRules:\n- Every task names the exact files it owns. No two tasks may share a file.\n- Use dependsOn only when a task truly needs an earlier task landed first.\n{}- Prefer fewer, larger tasks over many trivial ones.\n- Each title is an imperative one-liner; detail carries acceptance criteria.\n\nMission: {}\n\nRepository files{truncated}:\n{file_block}",
        request.max_tasks,
        request.roster,
        if foundation.is_empty() {
            String::new()
        } else {
            format!("{}\n", foundation.join("\n"))
        },
        request.mission,
    )
}

pub fn single_task_plan(request: &SwarmPlanRequest) -> Vec<PlannedTask> {
    let title = request
        .mission
        .lines()
        .next()
        .unwrap_or("Swarm mission")
        .chars()
        .take(200)
        .collect();
    vec![PlannedTask {
        title,
        detail: Some(request.mission.clone()),
        files: Vec::new(),
        depends_on: Vec::new(),
    }]
}

pub async fn first_successful_plan(
    planners: &[&dyn SwarmPlanner],
    request: &SwarmPlanRequest,
    mut on_error: Option<&mut dyn FnMut(String)>,
) -> Vec<PlannedTask> {
    for planner in planners {
        match planner.plan(request).await {
            Ok(planned) if !planned.is_empty() => {
                return pin_foundation(planned, &request.snapshot);
            }
            Ok(_) => {
                if let Some(hook) = on_error.as_mut() {
                    hook("planner returned no tasks".into());
                }
            }
            Err(error) => {
                if let Some(hook) = on_error.as_mut() {
                    hook(error);
                }
            }
        }
    }
    single_task_plan(request)
}

pub fn plan_budget(preset: helm_protocol::SwarmPresetId) -> usize {
    swarm_plan_budget(preset) as usize
}
