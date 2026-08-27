use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use helm_db::{KnowledgeChunkWrite, KnowledgeDocumentWrite};
use helm_shared::{create_id, utc_now};
use serde_json::{json, Value};

use crate::sha256::sha256;

const MAX_CHUNK_CHARACTERS: usize = 3_000;
const MAX_LABEL_CHARACTERS: usize = 500;

fn new_id() -> String {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    create_id(timestamp).to_string()
}

fn strip_wrapping_quotes(value: &str) -> &str {
    let bytes = value.as_bytes();
    let mut start = 0;
    let mut end = bytes.len();
    if end > start && (bytes[start] == b'\'' || bytes[start] == b'"') {
        start += 1;
    }
    if end > start && (bytes[end - 1] == b'\'' || bytes[end - 1] == b'"') {
        end -= 1;
    }
    &value[start..end]
}

fn is_number(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let rest = if first == '-' { chars.as_str() } else { value };
    if rest.is_empty() {
        return false;
    }
    let mut seen_dot = false;
    let mut seen_digit = false;
    for ch in rest.chars() {
        if ch == '.' {
            if seen_dot {
                return false;
            }
            seen_dot = true;
        } else if ch.is_ascii_digit() {
            seen_digit = true;
        } else {
            return false;
        }
    }
    seen_digit
}

fn scalar(value: &str) -> Value {
    let trimmed = value.trim();
    if trimmed == "true" {
        return json!(true);
    }
    if trimmed == "false" {
        return json!(false);
    }
    if trimmed == "null" || trimmed == "~" {
        return Value::Null;
    }
    if is_number(trimmed) {
        if trimmed.contains('.') {
            return json!(trimmed.parse::<f64>().unwrap_or(0.0));
        }
        return json!(trimmed.parse::<i64>().unwrap_or(0));
    }
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        let inner = &trimmed[1..trimmed.len() - 1];
        let items: Vec<Value> = inner
            .split(',')
            .map(|item| strip_wrapping_quotes(item.trim()))
            .filter(|item| !item.is_empty())
            .map(|item| json!(item))
            .collect();
        return Value::Array(items);
    }
    json!(strip_wrapping_quotes(trimmed))
}

fn frontmatter_key_value(line: &str) -> Option<(&str, &str)> {
    let mut chars = line.char_indices();
    let (first_idx, first) = chars.next()?;
    if !(first.is_ascii_alphanumeric() || first == '_' || first == '-') {
        return None;
    }
    let mut end = first_idx + first.len_utf8();
    for (idx, ch) in chars {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            end = idx + ch.len_utf8();
        } else if ch == ':' {
            let key = &line[..end];
            let value = line[idx + 1..].trim_start();
            return Some((key, value));
        } else {
            return None;
        }
    }
    None
}

fn frontmatter(lines: &[&str]) -> (serde_json::Map<String, Value>, usize) {
    if lines.first().map(|line| line.trim()) != Some("---") {
        return (serde_json::Map::new(), 0);
    }
    let end = match lines[1..].iter().position(|line| line.trim() == "---") {
        Some(index) => index,
        None => return (serde_json::Map::new(), 0),
    };
    let mut values = serde_json::Map::new();
    for line in &lines[1..end + 1] {
        if let Some((key, value)) = frontmatter_key_value(line) {
            values.insert(key.to_string(), scalar(value));
        }
    }
    (values, end + 2)
}

struct Section {
    heading: Option<String>,
    lines: Vec<(String, i64)>,
}

fn heading_match(line: &str) -> Option<&str> {
    let bytes = line.as_bytes();
    let mut hashes = 0;
    while hashes < bytes.len() && hashes < 6 && bytes[hashes] == b'#' {
        hashes += 1;
    }
    if hashes == 0 || hashes >= bytes.len() || bytes[hashes] != b' ' {
        return None;
    }
    Some(line[hashes..].trim())
}

fn strip_trailing_heading_hashes(value: &str) -> &str {
    let trimmed = value.trim_end();
    let bytes = trimmed.as_bytes();
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1] == b'#' {
        end -= 1;
    }
    if end < bytes.len() {
        trimmed[..end].trim_end()
    } else {
        trimmed
    }
}

fn sections(lines: &[&str], body_start: usize) -> Vec<Section> {
    let mut result = Vec::new();
    let mut heading: Option<String> = None;
    let mut current: Vec<(String, i64)> = Vec::new();

    let flush =
        |heading: &Option<String>, current: &mut Vec<(String, i64)>, result: &mut Vec<Section>| {
            if current.iter().any(|line| !line.0.trim().is_empty()) {
                result.push(Section {
                    heading: heading.clone(),
                    lines: std::mem::take(current),
                });
            } else {
                current.clear();
            }
        };

    for (index, line) in lines.iter().enumerate().skip(body_start) {
        if let Some(raw_heading) = heading_match(line) {
            flush(&heading, &mut current, &mut result);
            let cleaned = strip_trailing_heading_hashes(raw_heading.trim());
            heading = Some(cleaned.chars().take(MAX_LABEL_CHARACTERS).collect());
            current.push(((*line).to_string(), (index + 1) as i64));
        } else {
            current.push(((*line).to_string(), (index + 1) as i64));
        }
    }
    flush(&heading, &mut current, &mut result);
    result
}

fn chunks_from_sections(values: &[Section]) -> Vec<KnowledgeChunkWrite> {
    let mut result = Vec::new();
    for section in values {
        let mut batch: Vec<(String, i64)> = Vec::new();
        let mut characters = 0usize;
        let flush = |batch: &mut Vec<(String, i64)>,
                     characters: &mut usize,
                     result: &mut Vec<KnowledgeChunkWrite>| {
            let nonempty: Vec<&(String, i64)> = batch
                .iter()
                .filter(|line| !line.0.trim().is_empty())
                .collect();
            if nonempty.is_empty() {
                batch.clear();
                *characters = 0;
                return;
            }
            let text = batch
                .iter()
                .map(|line| line.0.as_str())
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();
            result.push(KnowledgeChunkWrite {
                id: new_id(),
                ordinal: result.len() as i64,
                heading: section.heading.clone(),
                line_start: nonempty[0].1,
                line_end: nonempty[nonempty.len() - 1].1,
                text: text.clone(),
                content_hash: sha256(text.as_bytes()),
            });
            batch.clear();
            *characters = 0;
        };
        for line in &section.lines {
            if characters > 0 && characters + line.0.len() + 1 > MAX_CHUNK_CHARACTERS {
                flush(&mut batch, &mut characters, &mut result);
            }
            batch.push(line.clone());
            characters += line.0.len() + 1;
        }
        flush(&mut batch, &mut characters, &mut result);
    }
    result
}

type KnowledgeLinks = Vec<(String, String, Option<String>, String, i64)>;
type KnowledgeEntities = Vec<(String, String, String)>;

fn is_tag_char(ch: char) -> bool {
    ch.is_alphabetic() || ch.is_numeric() || ch == '_' || ch == '/' || ch == '-'
}

fn links_and_tags(lines: &[&str]) -> (KnowledgeLinks, Vec<String>, KnowledgeEntities) {
    let mut links = Vec::new();
    let mut tags = BTreeSet::new();
    let mut entities: HashMap<String, (String, String, String)> = HashMap::new();

    for (index, line) in lines.iter().enumerate() {
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '[' && i + 1 < chars.len() && chars[i + 1] == '['
                || (chars[i] == '!'
                    && i + 2 < chars.len()
                    && chars[i + 1] == '['
                    && chars[i + 2] == '[')
            {
                let start = if chars[i] == '!' { i + 3 } else { i + 2 };
                let mut j = start;
                while j < chars.len() && chars[j] != ']' && chars[j] != '|' && chars[j] != '#' {
                    j += 1;
                }
                if j == start {
                    i += 1;
                    continue;
                }
                let target: String = chars[start..j]
                    .iter()
                    .collect::<String>()
                    .trim()
                    .to_string();
                if chars.get(j) == Some(&'#') {
                    j += 1;
                    while j < chars.len() && chars[j] != ']' && chars[j] != '|' {
                        j += 1;
                    }
                }
                let mut label = None;
                if chars.get(j) == Some(&'|') {
                    j += 1;
                    let label_start = j;
                    while j < chars.len() && chars[j] != ']' {
                        j += 1;
                    }
                    let raw: String = chars[label_start..j].iter().collect();
                    label = Some(raw.trim().to_string());
                }
                if chars.get(j) == Some(&']') && chars.get(j + 1) == Some(&']') {
                    if !target.is_empty() {
                        links.push((
                            new_id(),
                            target.clone(),
                            label,
                            "wikilink".to_string(),
                            (index + 1) as i64,
                        ));
                        let key = target.to_lowercase();
                        entities
                            .entry(key)
                            .or_insert_with(|| (new_id(), target.clone(), "note".to_string()));
                    }
                    i = j + 2;
                    continue;
                }
            }
            i += 1;
        }

        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '[' {
                let mut j = i + 1;
                while j < chars.len() && chars[j] != ']' {
                    j += 1;
                }
                if j < chars.len() && chars.get(j + 1) == Some(&'(') {
                    let label: String = chars[i + 1..j].iter().collect();
                    let mut k = j + 2;
                    let target_start = k;
                    while k < chars.len() && chars[k] != ')' {
                        k += 1;
                    }
                    if k < chars.len() {
                        let raw: String = chars[target_start..k].iter().collect();
                        let lower = raw.to_ascii_lowercase();
                        let md_ok = if let Some(hash) = lower.find('#') {
                            lower[..hash].ends_with(".md")
                        } else {
                            lower.ends_with(".md")
                        };
                        if md_ok && !raw.contains(')') {
                            let target = raw.trim().split('#').next().unwrap_or("").to_string();
                            links.push((
                                new_id(),
                                target,
                                Some(label.trim().to_string()),
                                "markdown".to_string(),
                                (index + 1) as i64,
                            ));
                            i = k + 1;
                            continue;
                        }
                    }
                }
            }
            i += 1;
        }

        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '#' && (i == 0 || chars[i - 1].is_whitespace()) {
                let mut j = i + 1;
                while j < chars.len() && is_tag_char(chars[j]) {
                    j += 1;
                }
                if j > i + 1 {
                    tags.insert(chars[i + 1..j].iter().collect());
                    i = j;
                    continue;
                }
            }
            i += 1;
        }
    }

    (
        links,
        tags.into_iter().collect(),
        entities.into_values().collect(),
    )
}

fn h1_title(line: &str) -> Option<String> {
    let trimmed = line.trim_end();
    if let Some(rest) = trimmed.strip_prefix("# ") {
        let title = rest.trim();
        if title.is_empty() {
            None
        } else {
            Some(title.to_string())
        }
    } else {
        None
    }
}

pub fn parse_markdown_document(
    relative_path: impl AsRef<str>,
    content: impl AsRef<str>,
    modified_at_ms: f64,
    size_bytes: i64,
) -> KnowledgeDocumentWrite {
    parse_markdown_document_with(ParseMarkdownDocumentInput {
        id: None,
        relative_path: relative_path.as_ref(),
        content: content.as_ref(),
        modified_at_ms,
        size_bytes,
        created_at: None,
    })
}

pub struct ParseMarkdownDocumentInput<'a> {
    pub id: Option<String>,
    pub relative_path: &'a str,
    pub content: &'a str,
    pub modified_at_ms: f64,
    pub size_bytes: i64,
    pub created_at: Option<String>,
}

pub fn parse_markdown_document_with(
    input: ParseMarkdownDocumentInput<'_>,
) -> KnowledgeDocumentWrite {
    let normalized = input.content.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();
    let (frontmatter_values, body_start) = frontmatter(&lines);
    let heading_title = lines[body_start..].iter().find_map(|line| h1_title(line));
    let fallback_title = Path::new(input.relative_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(input.relative_path)
        .to_string();
    let title = match frontmatter_values.get("title") {
        Some(Value::String(value)) if !value.trim().is_empty() => value.trim().to_string(),
        _ => heading_title.unwrap_or(fallback_title),
    };
    let (links, extracted_tags, entities) = links_and_tags(&lines);
    let mut tags: BTreeSet<String> = extracted_tags.into_iter().collect();
    let frontmatter_tags = frontmatter_values
        .get("tags")
        .or_else(|| frontmatter_values.get("tag"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    let tag_items = match frontmatter_tags {
        Value::Array(items) => items,
        other => vec![other],
    };
    for tag in tag_items {
        if let Value::String(value) = tag {
            let normalized_tag = value.trim().trim_start_matches('#').to_string();
            if !normalized_tag.is_empty() {
                tags.insert(normalized_tag);
            }
        }
    }
    let now = utc_now();
    KnowledgeDocumentWrite {
        id: input.id.unwrap_or_else(new_id),
        relative_path: input.relative_path.to_string(),
        title: title.chars().take(MAX_LABEL_CHARACTERS).collect(),
        content_hash: sha256(normalized.as_bytes()),
        modified_at_ms: input.modified_at_ms,
        size_bytes: input.size_bytes,
        frontmatter_json: Value::Object(frontmatter_values).to_string(),
        tags_json: json!(tags.iter().cloned().collect::<Vec<_>>()).to_string(),
        created_at: input.created_at.unwrap_or_else(|| now.clone()),
        updated_at: now,
        chunks: chunks_from_sections(&sections(&lines, body_start)),
        links,
        entities,
    }
}
