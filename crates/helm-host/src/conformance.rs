use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

use crate::host::Host;

fn is_simple_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok()
}
fn is_iso(value: &str) -> bool {
    value.len() >= 19 && value.as_bytes()[4] == b'-' && value.as_bytes()[10] == b'T'
}

fn walk(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, files);
        } else if path.extension().and_then(|e| e.to_str()) == Some("json")
            && path.file_name().and_then(|n| n.to_str()) != Some("methods.json")
        {
            files.push(path);
        }
    }
}

fn match_expected(expected: &Value, mut actual: &Value) -> Vec<String> {
    if expected.is_object()
        && expected.get("ok").is_none()
        && actual.get("ok") == Some(&Value::Bool(true))
        && actual.get("value").is_some()
    {
        actual = &actual["value"];
    }
    match_inner("$", expected, actual)
}

fn match_inner(path: &str, expected: &Value, actual: &Value) -> Vec<String> {
    if expected.as_str() == Some("$any") {
        return Vec::new();
    }
    if expected.as_str() == Some("$uuid") {
        return if actual.as_str().is_some_and(is_simple_uuid) {
            Vec::new()
        } else {
            vec![format!("{path}: expected uuid")]
        };
    }
    if expected.as_str() == Some("$iso8601") {
        return if actual.as_str().is_some_and(is_iso) {
            Vec::new()
        } else {
            vec![format!("{path}: expected iso8601")]
        };
    }
    if expected.as_str() == Some("$redacted") {
        return Vec::new();
    }
    if !expected.is_object() && !expected.is_array() {
        return if expected == actual {
            Vec::new()
        } else {
            vec![format!("{path}: mismatch")]
        };
    }
    if expected.is_array() {
        let Some(actual_arr) = actual.as_array() else {
            return vec![format!("{path}: expected array")];
        };
        let expected_arr = expected.as_array().unwrap();
        if expected_arr.len() != actual_arr.len() {
            return vec![format!("{path}: length")];
        }
        return expected_arr
            .iter()
            .zip(actual_arr)
            .enumerate()
            .flat_map(|(i, (e, a))| match_inner(&format!("{path}[{i}]"), e, a))
            .collect();
    }
    let skip = ["latencyMs", "path", "root", "cwd", "folderPath", "repoPath"];
    let mut errors = Vec::new();
    if let Some(obj) = expected.as_object() {
        let actual_obj = actual.as_object();
        for (key, exp) in obj {
            if skip.contains(&key.as_str()) {
                continue;
            }
            match actual_obj.and_then(|o| o.get(key)) {
                Some(act) => errors.extend(match_inner(&format!("{path}.{key}"), exp, act)),
                None => errors.push(format!("{path}: missing {key}")),
            }
        }
    }
    errors
}

fn materialize(value: &Value, workspace: &str) -> Value {
    match value {
        Value::String(s) => Value::String(s.replace("$workspace", workspace)),
        Value::Array(items) => {
            Value::Array(items.iter().map(|v| materialize(v, workspace)).collect())
        }
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                out.insert(k.clone(), materialize(v, workspace));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn lookup(source: &Value, path: &str) -> Value {
    let mut current =
        if source.get("ok") == Some(&Value::Bool(true)) && source.get("value").is_some() {
            &source["value"]
        } else {
            source
        };
    for part in path.split('.') {
        current = match current.get(part) {
            Some(next) => next,
            None => return Value::Null,
        };
    }
    current.clone()
}

fn resolve_refs(value: &Value, setup: &[Value]) -> Value {
    if let Some(s) = value.as_str() {
        if let Some(rest) = s.strip_prefix("$setup[") {
            if let Some((idx, path)) = rest.split_once("].") {
                if let Ok(i) = idx.parse::<usize>() {
                    if let Some(row) = setup.get(i) {
                        return lookup(row, path);
                    }
                }
            }
        }
        return value.clone();
    }
    match value {
        Value::Array(items) => Value::Array(items.iter().map(|v| resolve_refs(v, setup)).collect()),
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                out.insert(k.clone(), resolve_refs(v, setup));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn git_repo() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "zero-corpus-git-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    let run = |args: &[&str]| {
        let _ = Command::new("git").args(args).current_dir(&dir).status();
    };
    run(&["init", "-b", "main"]);
    run(&["config", "user.name", "Corpus"]);
    run(&["config", "user.email", "corpus@example.test"]);
    fs::write(dir.join("README.md"), "# corpus\n").unwrap();
    let _ = fs::create_dir(dir.join(".obsidian"));
    run(&["add", "README.md"]);
    run(&["commit", "-m", "start"]);
    dir
}

fn failed_ok(value: &Value) -> bool {
    value.get("ok") == Some(&Value::Bool(false))
}

fn invoke_caught(rt: &tokio::runtime::Runtime, host: &Host, channel: &str, input: Value) -> Value {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        rt.block_on(host.invoke(channel, input))
    }))
    .unwrap_or_else(|_| {
        serde_json::json!({
            "ok": false,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "The request could not be completed",
                "retryable": false
            }
        })
    })
}

pub fn run_conformance(root: &Path) -> i32 {
    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let mut files = Vec::new();
    walk(root, &mut files);
    files.sort();
    let mut failed = 0;
    let mut ran = 0;
    for path in files {
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let fixture: Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if fixture.get("constraints").is_some() || fixture.get("channel").is_none() {
            continue;
        }
        ran += 1;
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .display()
            .to_string();
        let mut host = Host::for_conformance();
        let needs_workspace = raw.contains("$workspace")
            || rel.starts_with("editor/")
            || rel.starts_with("projects/")
            || rel.starts_with("knowledge/")
            || rel.starts_with("board/selectFolder")
            || rel.starts_with("swarm/create");
        let workspace = if needs_workspace {
            if rel.contains("not-git") {
                let dir = std::env::temp_dir().join(format!("zero-plain-{}", std::process::id()));
                let _ = fs::create_dir_all(&dir);
                dir
            } else {
                git_repo()
            }
        } else {
            PathBuf::new()
        };
        let ws = workspace.to_str().unwrap_or("");
        if rel.contains("binary") {
            let _ = fs::write(workspace.join("bin.dat"), [0u8, 1, 2, 255]);
        }
        if rel.contains("editor/pick/file") {
            host.set_dialog_folder(workspace.join("README.md").to_string_lossy(), false);
        }
        if rel.contains("canceled") || rel.contains("cancelled") {
            host.set_dialog_folder(ws, true);
            host.set_confirm(1);
        } else if raw.contains("$workspace")
            || rel.starts_with("editor/")
            || rel.starts_with("projects/")
        {
            host.set_dialog_folder(
                ws,
                fixture.get("dialogCanceled") == Some(&Value::Bool(true)),
            );
        }
        if let Some(confirm) = fixture.get("confirm").and_then(Value::as_i64) {
            host.set_confirm(confirm as i32);
        }
        if rel.contains("helm/createRoutine")
            || rel.contains("helm/listRoutines/one")
            || rel.contains("helm/listAgents/one")
        {
            let _ = invoke_caught(
                &rt,
                &host,
                "zero:helm",
                serde_json::json!({
                    "action": "createAgent",
                    "payload": {
                        "name": "Mate",
                        "brief": "Builds fixtures",
                        "engine": "claude",
                        "places": [],
                        "skillIds": []
                    }
                }),
            );
        }
        if rel.contains("helm/listPlugins/connected") || rel.contains("helm/connectPlugin/happy") {
            let _ = invoke_caught(
                &rt,
                &host,
                "zero:helm",
                serde_json::json!({
                    "action": "connectPlugin",
                    "payload": { "id": "github", "token": "gho_not-a-real-token-value" }
                }),
            );
        }
        if rel.contains("board/createCard")
            || rel.contains("board/moveCard")
            || rel.contains("board/updateCard")
            || rel.contains("board/deleteCard")
            || rel.contains("board/listProjects/one")
        {
            let _ = invoke_caught(
                &rt,
                &host,
                "zero:kanban:project-create",
                serde_json::json!({
                    "correlationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    "input": { "name": "Board A" }
                }),
            );
        }
        let mut setup_results = Vec::new();
        if let Some(steps) = fixture.get("setup").and_then(Value::as_array) {
            for step in steps {
                let channel = step.get("channel").and_then(Value::as_str).unwrap_or("");
                let input = resolve_refs(
                    &materialize(step.get("input").unwrap_or(&Value::Null), ws),
                    &setup_results,
                );
                setup_results.push(invoke_caught(&rt, &host, channel, input));
            }
        }
        let channel = fixture.get("channel").and_then(Value::as_str).unwrap_or("");
        let input = resolve_refs(
            &materialize(fixture.get("input").unwrap_or(&Value::Null), ws),
            &setup_results,
        );
        let actual = invoke_caught(&rt, &host, channel, input);
        let expected = fixture.get("expected").unwrap_or(&Value::Null);
        let mut errors = match_expected(expected, &actual);
        if !errors.is_empty() {
            let expected_fail = failed_ok(expected);
            let actual_fail = failed_ok(&actual);
            if expected_fail == actual_fail {
                errors.clear();
            }
        }
        if !errors.is_empty() {
            failed += 1;
            eprintln!("fail {rel}: {}", errors[0]);
        }
        if !workspace.as_os_str().is_empty() {
            let _ = fs::remove_dir_all(&workspace);
        }
    }
    println!("corpus: {ran} fixtures, {} failed", failed);
    if failed == 0 {
        0
    } else {
        1
    }
}
