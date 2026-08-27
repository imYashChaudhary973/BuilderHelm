use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::validate::{from_strict, require_len, require_uuid, ParseError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KanbanColumn {
    Idea,
    Doing,
    Review,
    Shipped,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KanbanCard {
    pub id: String,
    pub workspace: String,
    pub title: String,
    pub column: KanbanColumn,
    pub created_at: String,
}

pub fn parse_kanban_card(value: &Value) -> Result<KanbanCard, ParseError> {
    let mut card: KanbanCard = from_strict(value)?;
    require_uuid(&card.id)?;
    require_len(&card.workspace, 1, 4096)?;
    card.title = crate::validate::trim_len(&card.title, 1, 200)?;
    require_len(&card.created_at, 1, usize::MAX)?;
    Ok(card)
}
