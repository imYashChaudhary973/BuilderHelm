use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validate::{from_strict, require_datetime, require_len, sha, ParseError};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GitCommit {
    pub sha: String,
    pub short_sha: String,
    pub subject: String,
    pub author_name: String,
    pub authored_at: String,
}

pub fn parse_git_commit(value: &Value) -> Result<GitCommit, ParseError> {
    let mut commit: GitCommit = from_strict(value)?;
    sha(&commit.sha, 40, 64)?;
    sha(&commit.short_sha, 7, 16)?;
    commit.subject = crate::validate::trim_len(&commit.subject, 1, 500)?;
    commit.author_name = crate::validate::trim_len(&commit.author_name, 1, 200)?;
    require_datetime(&commit.authored_at)?;
    require_len(&commit.short_sha, 7, 16)?;
    Ok(commit)
}
