use serde_json::{json, Value};
use time::{Duration, Month, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};

use super::action_repository::{ActionRepository, StoredProject, StoredTask};

pub struct ParsedActionIntent {
    pub tool_id: String,
    pub input: Value,
}

pub fn normalize_work_name(value: &str) -> String {
    collapse_ws(value).to_lowercase()
}

fn collapse_ws(value: &str) -> String {
    let mut out = String::new();
    let mut prev_ws = false;
    for ch in value.trim().chars() {
        if ch.is_whitespace() {
            if !prev_ws {
                out.push(' ');
            }
            prev_ws = true;
        } else {
            out.push(ch);
            prev_ws = false;
        }
    }
    out
}

fn starts_ci(value: &str, prefix: &str) -> bool {
    value.len() >= prefix.len() && value[..prefix.len()].eq_ignore_ascii_case(prefix)
}

fn skip_ws(value: &str) -> &str {
    value.trim_start()
}

fn strip_word<'a>(value: &'a str, word: &str) -> Option<&'a str> {
    if !starts_ci(value, word) {
        return None;
    }
    let rest = &value[word.len()..];
    if rest.is_empty() || rest.starts_with(|ch: char| ch.is_whitespace() || ch == '-') {
        Some(rest)
    } else {
        None
    }
}

fn strip_one_of<'a>(value: &'a str, words: &[&str]) -> Option<&'a str> {
    words.iter().find_map(|word| strip_word(value, word))
}

fn optional_word<'a>(value: &'a str, word: &str) -> &'a str {
    strip_word(skip_ws(value), word)
        .map(skip_ws)
        .unwrap_or(value)
}

fn match_name_prefix(value: &str, name: &str) -> Option<usize> {
    let value_chars: Vec<char> = value.chars().collect();
    let words: Vec<Vec<char>> = name
        .split_whitespace()
        .map(|word| word.chars().collect())
        .collect();
    if words.is_empty() {
        return None;
    }
    let mut i = 0usize;
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            if i >= value_chars.len() || !value_chars[i].is_whitespace() {
                return None;
            }
            while i < value_chars.len() && value_chars[i].is_whitespace() {
                i += 1;
            }
        }
        if i + word.len() > value_chars.len() {
            return None;
        }
        for (offset, expected) in word.iter().enumerate() {
            if !eq_ci_char(value_chars[i + offset], *expected) {
                return None;
            }
        }
        i += word.len();
    }
    if i == value_chars.len()
        || value_chars[i].is_whitespace()
        || matches!(value_chars[i], ':' | '—' | '-')
    {
        Some(value.chars().take(i).map(char::len_utf8).sum())
    } else {
        None
    }
}

fn eq_ci_char(left: char, right: char) -> bool {
    left.eq_ignore_ascii_case(&right)
}

fn project_from_start<'a>(
    raw_value: &str,
    projects: &'a [StoredProject],
) -> Option<(&'a StoredProject, String)> {
    let mut candidates: Vec<&StoredProject> = projects.iter().collect();
    candidates.sort_by_key(|right| std::cmp::Reverse(right.name.len()));
    let stripped = strip_word(skip_ws(raw_value), "project")
        .map(skip_ws)
        .unwrap_or(raw_value);
    for value in [raw_value, stripped] {
        for project in &candidates {
            if let Some(len) = match_name_prefix(value, &project.name) {
                return Some((*project, value[len..].trim().to_string()));
            }
        }
    }
    None
}

fn format_js_iso(dt: OffsetDateTime) -> String {
    let utc = dt.to_offset(UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        utc.year(),
        u8::from(utc.month()),
        utc.day(),
        utc.hour(),
        utc.minute(),
        utc.second(),
        utc.millisecond()
    )
}

fn local_end_of_day(now: OffsetDateTime, days: i64) -> String {
    let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    let local = now.to_offset(offset);
    let date = local.date() + Duration::days(days);
    let time = Time::from_hms_milli(23, 59, 59, 999).expect("eod");
    format_js_iso(PrimitiveDateTime::new(date, time).assume_offset(offset))
}

fn strip_trailing_punct(value: &str) -> &str {
    value.trim_end_matches(['.', '!', '?']).trim_end()
}

fn strip_due_word(title: &str, word: &str) -> Option<String> {
    if !title.to_ascii_lowercase().ends_with(word) {
        return None;
    }
    let without_word = &title[..title.len() - word.len()];
    let head = without_word.trim_end();
    if head.len() == without_word.len() {
        return None;
    }
    let mut core = head;
    for prep in ["due", "for", "by"] {
        if core.to_ascii_lowercase().ends_with(prep) {
            let before = &core[..core.len() - prep.len()];
            let trimmed = before.trim_end();
            if trimmed.len() < before.len() {
                core = trimmed;
                break;
            }
        }
    }
    Some(core.trim().to_string())
}

fn parse_ymd(value: &str) -> Option<(i32, u8, u8)> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year: i32 = value[..4].parse().ok()?;
    let month: u8 = value[5..7].parse().ok()?;
    let day: u8 = value[8..10].parse().ok()?;
    Some((year, month, day))
}

fn local_ymd_eod(year: i32, month: u8, day: u8) -> Option<String> {
    let month = Month::try_from(month).ok()?;
    let date = time::Date::from_calendar_date(year, month, day).ok()?;
    let offset = UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC);
    let tod = Time::from_hms_milli(23, 59, 59, 999).ok()?;
    Some(format_js_iso(
        PrimitiveDateTime::new(date, tod).assume_offset(offset),
    ))
}

fn due_date(value: &str, now: OffsetDateTime) -> (String, Option<String>) {
    let title = strip_trailing_punct(value.trim()).to_string();
    if let Some(stripped) = strip_due_word(&title, "tomorrow") {
        return (stripped, Some(local_end_of_day(now, 1)));
    }
    if let Some(stripped) = strip_due_word(&title, "today") {
        return (stripped, Some(local_end_of_day(now, 0)));
    }
    if title.len() >= 10 {
        if let Some((year, month, day)) = parse_ymd(&title[title.len() - 10..]) {
            let without_date = &title[..title.len() - 10];
            let head = without_date.trim_end();
            if head.len() < without_date.len() {
                let mut core = head;
                for prep in ["due", "for", "by"] {
                    if core.to_ascii_lowercase().ends_with(prep) {
                        let before = &core[..core.len() - prep.len()];
                        let trimmed = before.trim_end();
                        if trimmed.len() < before.len() {
                            core = trimmed;
                            break;
                        }
                    }
                }
                if let Some(due_at) = local_ymd_eod(year, month, day) {
                    return (core.trim().to_string(), Some(due_at));
                }
            }
        }
    }
    (title, None)
}

fn strip_quotes(value: &str) -> &str {
    let value = value.trim();
    let bytes = value.as_bytes();
    let mut start = 0;
    let mut end = bytes.len();
    if end > start && (bytes[start] == b'"' || bytes[start] == b'\'') {
        start += 1;
    }
    if end > start && (bytes[end - 1] == b'"' || bytes[end - 1] == b'\'') {
        end -= 1;
    }
    &value[start..end]
}

fn resolve_task(value: &str, repository: &ActionRepository<'_>) -> Option<StoredTask> {
    let unquoted = strip_quotes(value);
    if let Some(by_id) = repository.find_task_by_id(unquoted) {
        return Some(by_id);
    }
    let matches = repository.find_tasks_by_normalized_title(&normalize_work_name(unquoted));
    if matches.len() == 1 {
        Some(matches.into_iter().next().unwrap())
    } else {
        None
    }
}

fn status(value: &str) -> Option<&'static str> {
    match normalize_work_name(value).as_str() {
        "todo" | "to do" | "reopen" => Some("todo"),
        "in progress" | "started" => Some("in_progress"),
        "blocked" => Some("blocked"),
        "done" | "complete" | "completed" => Some("done"),
        "cancelled" | "canceled" => Some("cancelled"),
        _ => None,
    }
}

fn strip_title_lead(value: &str) -> &str {
    let value = skip_ws(value);
    if let Some(rest) = strip_word(value, "to") {
        return skip_ws(rest);
    }
    let mut chars = value.chars();
    if let Some(ch) = chars.next() {
        if ch == ':' || ch == '—' || ch == '-' {
            return chars.as_str().trim_start();
        }
    }
    value
}

fn strip_decision_lead(value: &str) -> &str {
    let value = skip_ws(value);
    if let Some(rest) = strip_word(value, "that") {
        return skip_ws(rest);
    }
    let mut chars = value.chars();
    if let Some(ch) = chars.next() {
        if ch == ':' || ch == '—' || ch == '-' {
            return chars.as_str().trim_start();
        }
    }
    value
}

fn strip_end_punct(value: &str) -> &str {
    value.trim_end_matches(['?', '!', '.']).trim_end()
}

pub fn parse_deterministic_action(
    text: &str,
    repository: &ActionRepository<'_>,
    now: OffsetDateTime,
) -> Option<ParsedActionIntent> {
    let command = text.trim();
    let projects = repository.list_projects(None);

    if let Some(rest) = strip_one_of(command, &["create", "add"]) {
        let rest = optional_word(skip_ws(rest), "a");
        if let Some(rest) = strip_word(skip_ws(rest), "project") {
            let rest = skip_ws(rest);
            let rest = if let Some(named) = strip_one_of(rest, &["named", "called"]) {
                skip_ws(named)
            } else {
                rest
            };
            if !rest.is_empty() {
                let name = strip_quotes(strip_trailing_punct(rest));
                return Some(ParsedActionIntent {
                    tool_id: "project.create".into(),
                    input: json!({ "name": name }),
                });
            }
        }
    }

    if let Some(rest) = strip_one_of(command, &["add", "create"]) {
        let mut rest = optional_word(skip_ws(rest), "a");
        rest = skip_ws(rest);
        let mut priority = "medium".to_string();
        if let Some(after) = strip_one_of(rest, &["low", "medium", "high"]) {
            let captured = if starts_ci(rest, "low") {
                "low"
            } else if starts_ci(rest, "medium") {
                "medium"
            } else {
                "high"
            };
            priority = captured.to_string();
            rest = skip_ws(after);
            if rest.starts_with('-') && starts_ci(&rest[1..], "priority") {
                rest = skip_ws(&rest[1 + "priority".len()..]);
            } else if let Some(after_priority) = strip_word(rest, "priority") {
                rest = skip_ws(after_priority);
            }
        }
        if let Some(rest) = strip_word(rest, "task") {
            if let Some(rest) = strip_one_of(skip_ws(rest), &["to", "in", "for"]) {
                let target = skip_ws(rest);
                if let Some((project, remainder)) = project_from_start(target, &projects) {
                    let raw_title = strip_title_lead(&remainder);
                    let (title, due_at) = due_date(raw_title, now);
                    if !title.is_empty() {
                        return Some(ParsedActionIntent {
                            tool_id: "task.create".into(),
                            input: json!({
                                "projectId": project.id,
                                "title": title,
                                "priority": priority,
                                "dueAt": due_at,
                            }),
                        });
                    }
                }
            }
        }
    }

    if let Some(rest) = strip_word(command, "add") {
        let rest = optional_word(skip_ws(rest), "a");
        if let Some(rest) = strip_word(skip_ws(rest), "decision") {
            if let Some(rest) = strip_one_of(skip_ws(rest), &["to", "for", "in"]) {
                if let Some((project, remainder)) = project_from_start(skip_ws(rest), &projects) {
                    let title = strip_trailing_punct(strip_decision_lead(&remainder).trim());
                    if !title.is_empty() {
                        return Some(ParsedActionIntent {
                            tool_id: "project.add_decision".into(),
                            input: json!({ "projectId": project.id, "title": title }),
                        });
                    }
                }
            }
        }
    }

    let status_cmd = if let Some(rest) = strip_one_of(command, &["show", "get"]) {
        Some(rest)
    } else if let Some(rest) = strip_word(command, "what") {
        let rest = skip_ws(rest);
        let rest = if rest.starts_with('\'') && starts_ci(&rest[1..], "s") {
            skip_ws(&rest[2..])
        } else if let Some(after) = strip_word(rest, "is") {
            skip_ws(after)
        } else {
            rest
        };
        Some(rest)
    } else {
        None
    };
    if let Some(rest) = status_cmd {
        let rest = skip_ws(rest);
        let rest = optional_word(rest, "the");
        if let Some(rest) = strip_word(skip_ws(rest), "status") {
            if let Some(rest) = strip_one_of(skip_ws(rest), &["of", "for"]) {
                if let Some((project, remainder)) = project_from_start(skip_ws(rest), &projects) {
                    if strip_end_punct(&remainder).is_empty() {
                        return Some(ParsedActionIntent {
                            tool_id: "project.get_status".into(),
                            input: json!({ "projectId": project.id }),
                        });
                    }
                }
            }
        }
    }

    if let Some(rest) = strip_one_of(command, &["list", "show"]) {
        let rest = skip_ws(rest);
        let rest = optional_word(rest, "my");
        if let Some(rest) = strip_word(skip_ws(rest), "tasks") {
            let rest = strip_end_punct(skip_ws(rest));
            if rest.is_empty() {
                return Some(ParsedActionIntent {
                    tool_id: "task.list".into(),
                    input: json!({}),
                });
            }
            if let Some(rest) = strip_one_of(rest, &["for", "in"]) {
                if let Some((project, remainder)) = project_from_start(skip_ws(rest), &projects) {
                    if strip_end_punct(&remainder).is_empty() {
                        return Some(ParsedActionIntent {
                            tool_id: "task.list".into(),
                            input: json!({ "projectId": project.id }),
                        });
                    }
                }
            }
        }
    }

    if let Some(rest) = strip_word(command, "mark") {
        let rest = skip_ws(rest);
        let rest = if let Some(after) = strip_word(rest, "task") {
            skip_ws(after)
        } else {
            rest
        };
        let statuses = [
            "in progress",
            "to do",
            "cancelled",
            "canceled",
            "completed",
            "complete",
            "started",
            "blocked",
            "reopen",
            "done",
            "todo",
        ];
        let lower = rest.to_ascii_lowercase();
        let trimmed = strip_end_punct(rest);
        let lower_trimmed = trimmed.to_ascii_lowercase();
        for word in statuses {
            if lower_trimmed.ends_with(word) {
                let head = trimmed[..trimmed.len() - word.len()].trim_end();
                if head.len() < trimmed.len() - word.len()
                    || lower[..lower.len() - word.len()].ends_with(char::is_whitespace)
                {
                    if let Some(task) = resolve_task(head, repository) {
                        if let Some(next_status) = status(word) {
                            return Some(ParsedActionIntent {
                                tool_id: "task.update".into(),
                                input: json!({ "taskId": task.id, "status": next_status }),
                            });
                        }
                    }
                }
            }
        }
        let _ = lower;
    }

    None
}
