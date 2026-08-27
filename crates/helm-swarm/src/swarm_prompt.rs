use helm_protocol::SwarmRole;

pub const SWARM_PROMPT_TASK_MARKER: &str = "--- task ---";
pub const SWARM_TASK_DONE: &str = "SWARM_TASK_DONE";

fn duty(role: SwarmRole) -> &'static str {
    match role {
        SwarmRole::Coordinator => {
            "You coordinate. Split work, track progress, and stop when the mission is done."
        }
        SwarmRole::Builder => {
            "You implement. Touch only the files this task owns, keep the diff small, and commit working code."
        }
        SwarmRole::Scout => "You investigate and report. Do not change files unless the task says so.",
        SwarmRole::Reviewer => {
            "You review. Name real bugs and missing tests. Do not rewrite the whole change."
        }
    }
}

pub struct SeatPromptSkill {
    pub title: String,
    pub directive: String,
}

pub struct SeatPromptTask {
    pub title: String,
    pub detail: Option<String>,
    pub files: Vec<String>,
}

pub struct SeatPromptInput {
    pub role: SwarmRole,
    pub mission: String,
    pub skills: Vec<SeatPromptSkill>,
    pub task: SeatPromptTask,
    pub directives: Vec<String>,
    pub context_pack: Option<String>,
    pub swarm_digest: Option<String>,
}

pub fn build_seat_prompt(input: &SeatPromptInput) -> String {
    let skills = if input.skills.is_empty() {
        "Standing directives: none".into()
    } else {
        format!(
            "Standing directives:\n{}",
            input
                .skills
                .iter()
                .map(|skill| format!("- {}: {}", skill.title, skill.directive))
                .collect::<Vec<_>>()
                .join("\n")
        )
    };
    let context = input
        .context_pack
        .as_deref()
        .filter(|pack| !pack.is_empty())
        .map(|pack| format!("\nContext:\n{pack}"))
        .unwrap_or_default();
    let prefix = format!(
        "Role: {}\n{}\n\n{skills}\n\nMission: {}{context}",
        match input.role {
            SwarmRole::Coordinator => "coordinator",
            SwarmRole::Builder => "builder",
            SwarmRole::Scout => "scout",
            SwarmRole::Reviewer => "reviewer",
        },
        duty(input.role),
        input.mission.trim()
    )
    .trim_end()
    .to_string();

    let mut tail = vec![
        SWARM_PROMPT_TASK_MARKER.to_string(),
        format!("Task: {}", input.task.title),
    ];
    if let Some(detail) = input
        .task
        .detail
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        tail.push(format!("Acceptance: {detail}"));
    }
    if input.task.files.is_empty() {
        tail.push("Files: decide from the mission, and stay narrow.".into());
    } else {
        tail.push(format!(
            "Files you own (touch nothing else):\n{}",
            input
                .task
                .files
                .iter()
                .map(|file| format!("- {file}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    if let Some(digest) = input
        .swarm_digest
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        tail.push(digest.to_string());
    }
    if !input.directives.is_empty() {
        tail.push(format!(
            "New directives from the operator:\n{}",
            input
                .directives
                .iter()
                .map(|directive| format!("- {directive}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    tail.push(if input.role == SwarmRole::Scout {
        "Do not edit files. Report what builders need.".into()
    } else {
        "Commit your work in this worktree when the task is done.".into()
    });
    tail.push(format!(
        "When finished, print exactly {SWARM_TASK_DONE} on its own line."
    ));
    format!("{prefix}\n\n{}", tail.join("\n"))
}
