use std::future::Future;
use std::pin::Pin;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwarmReviewRequest {
    pub task_title: String,
    pub files: Vec<String>,
    pub diff: String,
    pub cwd: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwarmReviewVerdict {
    pub verdict: String,
    pub issues: Option<Vec<String>>,
}

pub trait SwarmReviewer {
    fn review(
        &self,
        request: SwarmReviewRequest,
    ) -> Pin<Box<dyn Future<Output = SwarmReviewVerdict> + '_>>;
}

pub fn build_review_prompt(request: &SwarmReviewRequest) -> String {
    let mut lines = vec![
        "Review this diff for a BuilderHelm swarm task.".into(),
        "Approve when it is correct and complete. Ask for a fix only for real".into(),
        "defects: wrong behavior, missing error handling, or missing tests for new".into(),
        "logic. Style nits are not fix reasons.".into(),
        String::new(),
        format!("Task: {}", request.task_title),
    ];
    if !request.files.is_empty() {
        lines.push(format!("Files owned: {}", request.files.join(", ")));
    }
    lines.push(String::new());
    lines.push("Diff:".into());
    lines.push(request.diff.chars().take(60_000).collect());
    lines
        .into_iter()
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
