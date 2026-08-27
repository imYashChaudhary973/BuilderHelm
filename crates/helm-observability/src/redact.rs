use serde_json::{Map, Value};

const REDACTED: &str = "[REDACTED]";

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_boundary(s: &str, idx: usize) -> bool {
    let before = s[..idx].chars().next_back();
    let after = s[idx..].chars().next();
    match (before, after) {
        (None, Some(c)) | (Some(c), None) => is_word(c),
        (Some(a), Some(b)) => is_word(a) != is_word(b),
        (None, None) => false,
    }
}

fn has_flex(hay: &str, left: &str, right: &str) -> bool {
    hay.contains(&format!("{left}{right}"))
        || hay.contains(&format!("{left}-{right}"))
        || hay.contains(&format!("{left}_{right}"))
}

fn sensitive_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    k.contains("authorization")
        || k.contains("cookie")
        || k.contains("credential")
        || k.contains("password")
        || k.contains("secret")
        || k.contains("token")
        || has_flex(&k, "private", "key")
        || has_flex(&k, "api", "key")
}

fn bearer_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '~' | '+' | '/' | '=' | '-')
}

fn replace_bearer(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut out = String::new();
    let mut i = 0;
    while i < value.len() {
        if lower[i..].starts_with("bearer") && is_boundary(value, i) {
            let after = i + "bearer".len();
            let rest = &value[after..];
            let ws = rest
                .chars()
                .take_while(char::is_ascii_whitespace)
                .map(char::len_utf8)
                .sum::<usize>();
            let tok_at = after + ws;
            if ws > 0 && tok_at < value.len() {
                let tok = value[tok_at..]
                    .chars()
                    .take_while(|c| bearer_token_char(*c))
                    .map(char::len_utf8)
                    .sum::<usize>();
                let end = tok_at + tok;
                if tok > 0 && is_boundary(value, end) {
                    out.push_str("Bearer ");
                    out.push_str(REDACTED);
                    i = end;
                    continue;
                }
            }
        }
        let ch = value[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn prefix_at(lower: &str, i: usize) -> Option<&'static str> {
    for p in ["secret", "token", "key", "sk"] {
        if lower[i..].starts_with(p) {
            return Some(p);
        }
    }
    None
}

fn replace_common_keys(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut out = String::new();
    let mut i = 0;
    while i < value.len() {
        if let Some(prefix) = prefix_at(&lower, i).filter(|_| is_boundary(value, i)) {
            let after = i + prefix.len();
            let sep = value[after..].chars().next();
            if matches!(sep, Some('-' | '_')) {
                let rest_at = after + 1;
                let rest = value[rest_at..]
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                    .map(char::len_utf8)
                    .sum::<usize>();
                let end = rest_at + rest;
                if rest >= 8 && is_boundary(value, end) {
                    out.push_str(REDACTED);
                    i = end;
                    continue;
                }
            }
        }
        let ch = value[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn redact_string(value: &str) -> String {
    replace_common_keys(&replace_bearer(value))
}

fn redact_value(value: &Value) -> Value {
    match value {
        Value::String(s) => Value::String(redact_string(s)),
        Value::Array(items) => Value::Array(items.iter().map(redact_value).collect()),
        Value::Object(map) => {
            let mut out = Map::new();
            for (key, entry) in map {
                let next = if sensitive_key(key) {
                    Value::String(REDACTED.to_owned())
                } else {
                    redact_value(entry)
                };
                out.insert(key.clone(), next);
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

pub fn redact(input: &Value) -> Value {
    redact_value(input)
}
