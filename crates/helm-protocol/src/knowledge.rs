use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validate::{from_strict, require_model_ref, require_uuid, ParseError};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeCitation {
    pub source_id: String,
    pub chunk_id: String,
    pub vault_id: String,
    pub note_path: String,
    pub title: String,
    pub heading: Option<String>,
    pub line_start: i64,
    pub line_end: i64,
    pub excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeQueryInput {
    pub vault_id: String,
    pub query: String,
    pub model_ref: String,
    #[serde(default = "default_max_sources")]
    pub max_sources: i64,
}

fn default_max_sources() -> i64 {
    8
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeQueryRequest {
    pub correlation_id: String,
    pub input: KnowledgeQueryInput,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeSourceInput {
    pub source_id: String,
    pub chunk_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnowledgeSourceRequest {
    pub correlation_id: String,
    pub input: KnowledgeSourceInput,
}

pub fn parse_knowledge_citation(value: &Value) -> Result<KnowledgeCitation, ParseError> {
    let citation: KnowledgeCitation = from_strict(value)?;
    require_uuid(&citation.source_id)?;
    require_uuid(&citation.chunk_id)?;
    require_uuid(&citation.vault_id)?;
    if citation.line_start < 1 || citation.line_end < 1 {
        return Err(ParseError::new("line"));
    }
    if citation.line_end < citation.line_start {
        return Err(ParseError::new("Citation line range is invalid"));
    }
    Ok(citation)
}

pub fn parse_knowledge_query_request(value: &Value) -> Result<KnowledgeQueryRequest, ParseError> {
    let request: KnowledgeQueryRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    require_uuid(&request.input.vault_id)?;
    let query = request.input.query.trim();
    if query.is_empty() || query.len() > 2_000 {
        return Err(ParseError::new("query"));
    }
    require_model_ref(&request.input.model_ref)?;
    if request.input.max_sources < 1 || request.input.max_sources > 20 {
        return Err(ParseError::new("maxSources"));
    }
    Ok(request)
}

pub fn parse_knowledge_source_request(value: &Value) -> Result<KnowledgeSourceRequest, ParseError> {
    let request: KnowledgeSourceRequest = from_strict(value)?;
    require_uuid(&request.correlation_id)?;
    require_uuid(&request.input.source_id)?;
    require_uuid(&request.input.chunk_id)?;
    Ok(request)
}
