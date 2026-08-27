use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validate::{from_strict, require_uuid, ParseError};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewBounds {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum BrowserCommandInput {
    Open { url: String, bounds: PreviewBounds },
    Bounds { bounds: PreviewBounds },
    Hide,
    Back,
    Forward,
    Reload,
}

fn has_scheme(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() || !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    let mut i = 1;
    while i < bytes.len()
        && (bytes[i].is_ascii_alphanumeric() || matches!(bytes[i], b'+' | b'-' | b'.'))
    {
        i += 1;
    }
    s[i..].starts_with("://")
}

pub fn parse_preview_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 4096 {
        return None;
    }
    let with_protocol = if has_scheme(trimmed) {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let (scheme, rest) = with_protocol.split_once("://")?;
    let protocol = scheme.to_ascii_lowercase();
    if protocol != "http" && protocol != "https" {
        return None;
    }
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.contains('@') {
        return None;
    }
    if authority.is_empty() {
        return None;
    }
    let hostport = authority;
    let (host, port) = if let Some(stripped) = hostport.strip_prefix('[') {
        let end = stripped.find(']')?;
        (&stripped[..end], stripped.get(end + 1..))
    } else if let Some((h, p)) = hostport.rsplit_once(':') {
        if h.contains(':') {
            return None;
        }
        (h, Some(p))
    } else {
        (hostport, None)
    };
    if host.is_empty() {
        return None;
    }
    if let Some(port) = port {
        let port = port.strip_prefix(':').unwrap_or(port);
        if !port.is_empty() && port.parse::<u16>().is_err() {
            return None;
        }
    }
    let remainder = &rest[authority_end..];
    let mut out = format!("{protocol}://{authority}");
    if remainder.is_empty() {
        out.push('/');
    } else {
        out.push_str(remainder);
    }
    Some(out)
}

fn validate_bounds(bounds: &PreviewBounds) -> Result<(), ParseError> {
    for (n, min) in [
        (bounds.x, 0),
        (bounds.y, 0),
        (bounds.width, 1),
        (bounds.height, 1),
    ] {
        if n < min || n > 10_000 {
            return Err(ParseError::new("bounds"));
        }
    }
    Ok(())
}

pub fn parse_browser_command_input(value: &Value) -> Result<BrowserCommandInput, ParseError> {
    let input: BrowserCommandInput = from_strict(value)?;
    match &input {
        BrowserCommandInput::Open { url, bounds } => {
            require_len_url(url)?;
            validate_bounds(bounds)?;
        }
        BrowserCommandInput::Bounds { bounds } => validate_bounds(bounds)?,
        _ => {}
    }
    Ok(input)
}

fn require_len_url(url: &str) -> Result<(), ParseError> {
    if url.is_empty() || url.len() > 4096 {
        Err(ParseError::new("url"))
    } else {
        Ok(())
    }
}

pub fn parse_browser_command_request(value: &Value) -> Result<(), ParseError> {
    let obj = value.as_object().ok_or_else(|| ParseError::new("object"))?;
    let corr = obj
        .get("correlationId")
        .and_then(Value::as_str)
        .ok_or_else(|| ParseError::new("correlationId"))?;
    require_uuid(corr)?;
    let input = obj.get("input").ok_or_else(|| ParseError::new("input"))?;
    parse_browser_command_input(input)?;
    Ok(())
}
