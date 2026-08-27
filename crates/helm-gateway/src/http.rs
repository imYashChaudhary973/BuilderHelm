use serde_json::Value;

use crate::error_mapping::ProviderHttpError;

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

impl HttpResponse {
    pub fn json(&self) -> Result<Value, ProviderHttpError> {
        if !(200..300).contains(&self.status) {
            return Err(ProviderHttpError {
                status: self.status,
            });
        }
        serde_json::from_slice(&self.body).map_err(|_| ProviderHttpError {
            status: self.status,
        })
    }

    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

pub fn provider_endpoint(base_url: Option<&str>, path: &str) -> String {
    let mut base = base_url.unwrap_or("https://api.openai.com/v1").to_string();
    if !base.ends_with('/') {
        base.push('/');
    }
    format!("{base}{}", path.trim_start_matches('/'))
}

pub fn header(headers: &[(String, String)], name: &str) -> Option<String> {
    let needle = name.to_ascii_lowercase();
    headers
        .iter()
        .find(|(key, _)| key.to_ascii_lowercase() == needle)
        .map(|(_, value)| value.clone())
}

pub fn read_server_sent_events(body: &[u8]) -> Result<Vec<Value>, serde_json::Error> {
    let text = String::from_utf8_lossy(body).replace("\r\n", "\n");
    let mut events = Vec::new();
    for frame in text.split("\n\n") {
        let data: Vec<&str> = frame
            .lines()
            .filter(|line| line.starts_with("data:"))
            .map(|line| line[5..].trim_start())
            .collect();
        let data = data.join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        events.push(serde_json::from_str(&data)?);
    }
    Ok(events)
}

pub fn read_json_lines(body: &[u8]) -> Result<Vec<Value>, serde_json::Error> {
    let text = String::from_utf8_lossy(body);
    let mut events = Vec::new();
    for line in text.split('\n') {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        events.push(serde_json::from_str(line)?);
    }
    Ok(events)
}
