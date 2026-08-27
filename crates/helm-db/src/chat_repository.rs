use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::database::{DbRow, ZeroDatabase};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThreadWrite {
    pub id: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnWrite {
    pub id: String,
    pub thread_id: String,
    pub role: String,
    pub content_json: String,
    pub model_ref: Option<String>,
    pub finish_reason: Option<String>,
    pub provider_continuation_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsageWrite {
    pub id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub provider_id: String,
    pub model_ref: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChatThread {
    pub id: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChatTurn {
    pub id: String,
    pub thread_id: String,
    pub ordinal: i64,
    pub role: String,
    pub content_json: String,
    pub model_ref: Option<String>,
    pub finish_reason: Option<String>,
    pub provider_continuation_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChatUsage {
    pub id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub provider_id: String,
    pub model_ref: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cached_input_tokens: Option<i64>,
    pub reasoning_tokens: Option<i64>,
    pub created_at: String,
}

pub struct AppendedChatTurnRows {
    pub turn: StoredChatTurn,
    pub usage: Option<StoredChatUsage>,
}

const THREAD_COLUMNS: &str = "id, title, created_at AS createdAt, updated_at AS updatedAt";
const TURN_COLUMNS: &str = "id, thread_id AS threadId, ordinal, role, content_json AS contentJson, model_ref AS modelRef, finish_reason AS finishReason, provider_continuation_json AS providerContinuationJson, created_at AS createdAt";

fn map_row<T: for<'de> Deserialize<'de>>(row: DbRow) -> T {
    serde_json::from_value(Value::Object(row)).expect("row")
}

pub struct ChatRepository<'a> {
    database: &'a ZeroDatabase,
}

impl<'a> ChatRepository<'a> {
    pub fn new(database: &'a ZeroDatabase) -> Self {
        Self { database }
    }

    pub fn create_thread(&self, thread: &ChatThreadWrite) -> StoredChatThread {
        self.database.run(
            "INSERT INTO chat_threads (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            &[
                json!(thread.id),
                json!(thread.title),
                json!(thread.created_at),
                json!(thread.updated_at),
            ],
        );
        StoredChatThread {
            id: thread.id.clone(),
            title: thread.title.clone(),
            created_at: thread.created_at.clone(),
            updated_at: thread.updated_at.clone(),
        }
    }

    pub fn find_thread_by_id(&self, id: &str) -> Option<StoredChatThread> {
        self.database
            .query_one(
                &format!("SELECT {THREAD_COLUMNS} FROM chat_threads WHERE id = ?"),
                &[json!(id)],
            )
            .map(map_row)
    }

    pub fn list_turns(&self, thread_id: &str) -> Vec<StoredChatTurn> {
        self.database
            .query_all(
                &format!(
                    "SELECT {TURN_COLUMNS} FROM chat_turns WHERE thread_id = ? ORDER BY ordinal"
                ),
                &[json!(thread_id)],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn list_usage(&self, thread_id: &str) -> Vec<StoredChatUsage> {
        self.database
            .query_all(
                "SELECT chat_usage.id, chat_usage.thread_id AS threadId, chat_usage.turn_id AS turnId, chat_usage.provider_id AS providerId, chat_usage.model_ref AS modelRef, chat_usage.input_tokens AS inputTokens, chat_usage.output_tokens AS outputTokens, chat_usage.cached_input_tokens AS cachedInputTokens, chat_usage.reasoning_tokens AS reasoningTokens, chat_usage.created_at AS createdAt \
                 FROM chat_usage \
                 JOIN chat_turns ON chat_turns.id = chat_usage.turn_id \
                 WHERE chat_usage.thread_id = ? \
                 ORDER BY chat_turns.ordinal, chat_usage.created_at, chat_usage.id",
                &[json!(thread_id)],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn append_turn(
        &self,
        turn: ChatTurnWrite,
        usage: Option<ChatUsageWrite>,
    ) -> AppendedChatTurnRows {
        if let Some(usage) = &usage {
            if usage.thread_id != turn.thread_id
                || usage.turn_id != turn.id
                || usage.model_ref != turn.model_ref.clone().unwrap_or_default()
            {
                panic!("Usage must describe the appended assistant turn");
            }
        }
        self.database.transaction(|| {
            if self.find_thread_by_id(&turn.thread_id).is_none() {
                panic!("Chat thread was not found");
            }
            let next = self.database.query_one(
                "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM chat_turns WHERE thread_id = ?",
                &[json!(turn.thread_id)],
            );
            let ordinal = next
                .as_ref()
                .and_then(|row| row.get("ordinal"))
                .and_then(Value::as_i64)
                .unwrap_or(0);
            self.database.run(
                "INSERT INTO chat_turns (
                  id, thread_id, ordinal, role, content_json, model_ref,
                  finish_reason, provider_continuation_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                &[
                    json!(turn.id),
                    json!(turn.thread_id),
                    json!(ordinal),
                    json!(turn.role),
                    json!(turn.content_json),
                    json!(turn.model_ref),
                    json!(turn.finish_reason),
                    json!(turn.provider_continuation_json),
                    json!(turn.created_at),
                ],
            );
            let stored_usage = usage.as_ref().map(|usage| {
                self.database.run(
                    "INSERT INTO chat_usage (
                      id, thread_id, turn_id, provider_id, model_ref,
                      input_tokens, output_tokens, cached_input_tokens,
                      reasoning_tokens, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    &[
                        json!(usage.id),
                        json!(usage.thread_id),
                        json!(usage.turn_id),
                        json!(usage.provider_id),
                        json!(usage.model_ref),
                        json!(usage.input_tokens),
                        json!(usage.output_tokens),
                        json!(usage.cached_input_tokens),
                        json!(usage.reasoning_tokens),
                        json!(usage.created_at),
                    ],
                );
                StoredChatUsage {
                    id: usage.id.clone(),
                    thread_id: usage.thread_id.clone(),
                    turn_id: usage.turn_id.clone(),
                    provider_id: usage.provider_id.clone(),
                    model_ref: usage.model_ref.clone(),
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                    cached_input_tokens: usage.cached_input_tokens,
                    reasoning_tokens: usage.reasoning_tokens,
                    created_at: usage.created_at.clone(),
                }
            });
            self.database.run(
                "UPDATE chat_threads SET updated_at = ? WHERE id = ?",
                &[json!(turn.created_at), json!(turn.thread_id)],
            );
            AppendedChatTurnRows {
                turn: StoredChatTurn {
                    id: turn.id,
                    thread_id: turn.thread_id,
                    ordinal,
                    role: turn.role,
                    content_json: turn.content_json,
                    model_ref: turn.model_ref,
                    finish_reason: turn.finish_reason,
                    provider_continuation_json: turn.provider_continuation_json,
                    created_at: turn.created_at,
                },
                usage: stored_usage,
            }
        })
    }
}
