pub struct AgentUsage {
    pub tokens_used: i64,
    pub cost_usd: f64,
}

struct UsageCandidate {
    tokens: f64,
    cost: f64,
}

fn read_candidate(value: &serde_json::Value) -> UsageCandidate {
    let Some(row) = value.as_object() else {
        return UsageCandidate {
            tokens: 0.0,
            cost: 0.0,
        };
    };
    let usage = row
        .get("usage")
        .and_then(|item| item.as_object())
        .unwrap_or(row);
    let pick = |keys: &[&str]| {
        for key in keys {
            if let Some(value) = usage
                .get(*key)
                .and_then(|item| item.as_f64().or_else(|| item.as_i64().map(|n| n as f64)))
            {
                return value;
            }
        }
        0.0
    };
    let input = pick(&["input_tokens", "prompt_tokens"]);
    let output = pick(&["output_tokens", "completion_tokens"]);
    let total = pick(&["total_tokens"]);
    let cached = pick(&["cache_read_input_tokens"]);
    let tokens = if total > 0.0 {
        total
    } else {
        input + output + cached
    };
    let cost = row
        .get("total_cost_usd")
        .or_else(|| row.get("cost_usd"))
        .or_else(|| usage.get("total_cost_usd"))
        .and_then(|item| item.as_f64().or_else(|| item.as_i64().map(|n| n as f64)))
        .unwrap_or(0.0);
    UsageCandidate {
        tokens: if tokens.is_finite() { tokens } else { 0.0 },
        cost: if cost.is_finite() { cost } else { 0.0 },
    }
}

pub fn parse_agent_usage(stdout: &str) -> AgentUsage {
    let mut tokens: f64 = 0.0;
    let mut cost: f64 = 0.0;
    for line in stdout.lines() {
        let text = line.trim();
        if !text.starts_with('{') || !text.ends_with('}') {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) else {
            continue;
        };
        let candidate = read_candidate(&parsed);
        tokens = tokens.max(candidate.tokens);
        cost = cost.max(candidate.cost);
    }
    AgentUsage {
        tokens_used: tokens.round() as i64,
        cost_usd: cost,
    }
}

pub fn parse_cli_failure(output: &str) -> String {
    let mut text = String::new();
    let bytes = output.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 27 && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() {
                let ch = bytes[i];
                i += 1;
                if (b'@'..=b'~').contains(&ch) {
                    break;
                }
            }
            continue;
        }
        text.push(bytes[i] as char);
        i += 1;
    }
    if text.to_ascii_lowercase().contains("402")
        || text.to_ascii_lowercase().contains("payment required")
        || text
            .to_ascii_lowercase()
            .contains("usage balance exhausted")
    {
        return "Grok usage balance exhausted (402)".into();
    }
    if let Some(start) = text.rfind('{') {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text[start..]) {
            if parsed.get("type").and_then(|v| v.as_str()) == Some("error")
                || parsed.get("http_status").and_then(|v| v.as_i64()) == Some(402)
            {
                if let Some(message) = parsed.get("message").and_then(|v| v.as_str()) {
                    if !message.is_empty() {
                        return message.chars().take(240).collect();
                    }
                }
            }
        }
    }
    let tail: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .take(3)
        .collect();
    tail.into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}
