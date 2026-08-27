use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;

use helm_protocol::BoardAgentId;
use serde_json::{json, Value};
use tokio::process::Command;

use crate::swarm_planning::{
    build_plan_prompt, normalize_swarm_plan, pin_foundation, PlannedTask, SwarmPlanRequest,
    SwarmPlanner,
};
use crate::swarm_reviewer::{
    build_review_prompt, SwarmReviewRequest, SwarmReviewVerdict, SwarmReviewer,
};

pub struct StructuredCallOptions {
    pub agent_id: BoardAgentId,
    pub cwd: String,
    pub timeout_ms: Option<u64>,
    pub binary: Option<String>,
}

fn claude_args(prompt: &str, schema: &str) -> Vec<String> {
    vec![
        "-p".into(),
        prompt.into(),
        "--output-format".into(),
        "json".into(),
        "--json-schema".into(),
        schema.into(),
        "--permission-mode".into(),
        "dontAsk".into(),
    ]
}

pub fn structured_cli_args(
    agent_id: BoardAgentId,
    prompt: &str,
    schema: &str,
) -> Result<Vec<String>, String> {
    match agent_id {
        BoardAgentId::Claude => Ok(claude_args(prompt, schema)),
        BoardAgentId::Grok => Err(
            "seats use interactive grok, not grok -p; planning needs Claude --json-schema".into(),
        ),
        BoardAgentId::Kiro => Err("kiro-cli cannot take a seat".into()),
        other => Err(format!(
            "{} cannot produce schema-constrained output",
            other.as_str()
        )),
    }
}

pub async fn call_structured_agent(
    options: &StructuredCallOptions,
    prompt: &str,
    schema: &Value,
) -> Result<Value, String> {
    let args = structured_cli_args(options.agent_id, prompt, &schema.to_string())?;
    let binary = options
        .binary
        .clone()
        .unwrap_or_else(|| options.agent_id.as_str().to_string());
    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(&options.cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let output = tokio::time::timeout(
        std::time::Duration::from_millis(options.timeout_ms.unwrap_or(180_000)),
        command.output(),
    )
    .await
    .map_err(|_| "structured agent timed out".to_string())?
    .map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let trimmed = stdout.trim();
    let start = trimmed.find('{').ok_or("agent returned no JSON object")?;
    let parsed: Value =
        serde_json::from_str(&trimmed[start..]).map_err(|error| error.to_string())?;
    if !parsed.is_object() {
        return Ok(parsed);
    }
    if parsed.get("type").and_then(|v| v.as_str()) == Some("error") {
        let message = parsed
            .get("message")
            .and_then(|v| v.as_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("structured agent error");
        return Err(message.into());
    }
    if let Some(structured) = parsed
        .get("structured_output")
        .or_else(|| parsed.get("structuredOutput"))
        .filter(|value| !value.is_null())
    {
        if let Some(text) = structured.as_str() {
            return serde_json::from_str(text).map_err(|error| error.to_string());
        }
        return Ok(structured.clone());
    }
    if let Some(result) = parsed.get("result") {
        if let Some(text) = result.as_str() {
            return serde_json::from_str(text).map_err(|error| error.to_string());
        }
        return Ok(result.clone());
    }
    Ok(parsed)
}

pub fn swarm_plan_json_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["tasks"],
        "properties": {
            "tasks": {
                "type": "array",
                "minItems": 1,
                "maxItems": 32
            }
        }
    })
}

pub fn swarm_review_json_schema() -> Value {
    json!({
        "type": "object",
        "required": ["verdict"],
        "properties": {
            "verdict": { "enum": ["approve", "fix"] }
        }
    })
}

pub struct CliSwarmPlanner {
    options: StructuredCallOptions,
}

impl CliSwarmPlanner {
    pub fn new(options: StructuredCallOptions) -> Self {
        Self { options }
    }
}

impl SwarmPlanner for CliSwarmPlanner {
    fn plan<'a>(
        &'a self,
        request: &'a SwarmPlanRequest,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<PlannedTask>, String>> + 'a>> {
        Box::pin(async move {
            let raw = call_structured_agent(
                &self.options,
                &build_plan_prompt(request),
                &swarm_plan_json_schema(),
            )
            .await?;
            let planned = normalize_swarm_plan(&raw, request.max_tasks)?;
            Ok(pin_foundation(planned, &request.snapshot))
        })
    }
}

pub struct CliSwarmReviewer {
    options: StructuredCallOptions,
}

impl CliSwarmReviewer {
    pub fn new(options: StructuredCallOptions) -> Self {
        Self { options }
    }
}

impl SwarmReviewer for CliSwarmReviewer {
    fn review(
        &self,
        request: SwarmReviewRequest,
    ) -> Pin<Box<dyn Future<Output = SwarmReviewVerdict> + '_>> {
        Box::pin(async move {
            let raw = call_structured_agent(
                &self.options,
                &build_review_prompt(&request),
                &swarm_review_json_schema(),
            )
            .await;
            let Ok(raw) = raw else {
                return SwarmReviewVerdict {
                    verdict: "approve".into(),
                    issues: Some(vec!["reviewer output was not readable".into()]),
                };
            };
            let verdict = raw.get("verdict").and_then(|v| v.as_str()).unwrap_or("");
            if verdict == "approve" || verdict == "fix" {
                let issues = raw.get("issues").and_then(|v| v.as_array()).map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                });
                SwarmReviewVerdict {
                    verdict: verdict.into(),
                    issues,
                }
            } else {
                SwarmReviewVerdict {
                    verdict: "approve".into(),
                    issues: Some(vec!["reviewer output was not readable".into()]),
                }
            }
        })
    }
}
