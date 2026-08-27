use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use helm_db::{
    ChatRepository, ChatThreadWrite, ChatTurnWrite, ChatUsageWrite, StoredChatThread,
    StoredChatTurn, StoredChatUsage, ZeroDatabase,
};
use helm_observability::{LogInput, Logger};
use helm_protocol::{
    parse_append_chat_turn_input, parse_chat_stream_start_request, parse_chat_thread,
    parse_create_chat_thread_input, ChatClientStreamEvent, ChatStreamEvent, ChatStreamInput,
    ChatThread, ChatTranscript, ChatTurn, ChatUsageRecord, FinishReason, ModelContentPart,
    ModelRequest, NormalizedToolCall, ProviderContinuation, TokenUsage, ZeroMessage,
};
use helm_shared::{create_correlation_id, utc_now, ZeroError, ZeroErrorCode};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error_convert::{failed, parse_failed};

#[derive(Debug, Clone, PartialEq, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendedChatTurn {
    pub turn: ChatTurn,
    pub usage: Option<ChatUsageRecord>,
}

pub trait ChatModelStreamer {
    fn stream<'a>(
        &'a self,
        request: ModelRequest,
        correlation_id: &'a str,
        aborted: bool,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ChatStreamEvent>, ZeroError>> + 'a>>;
}

pub struct ChatService<'a> {
    database: &'a ZeroDatabase,
    logger: &'a Logger,
    models: &'a dyn ChatModelStreamer,
}

enum StreamState {
    Idle {
        raw: Value,
    },
    Active {
        thread_id: String,
        model_ref: String,
        events: Vec<ChatStreamEvent>,
        index: usize,
        text: String,
        tool_calls: Vec<NormalizedToolCall>,
        usage: Option<TokenUsage>,
    },
    Done,
}

pub struct ChatClientStream<'a> {
    service: &'a ChatService<'a>,
    correlation_id: String,
    aborted: Arc<AtomicBool>,
    state: StreamState,
}

fn map_row<T: for<'de> Deserialize<'de>>(row: helm_db::DbRow) -> T {
    serde_json::from_value(Value::Object(row)).expect("row")
}

fn to_thread(thread: &StoredChatThread) -> Result<ChatThread, ZeroError> {
    parse_chat_thread(&json!({
        "id": thread.id,
        "title": thread.title,
        "createdAt": thread.created_at,
        "updatedAt": thread.updated_at,
    }))
    .map_err(parse_failed)
}

fn to_turn(turn: &StoredChatTurn) -> Result<ChatTurn, ZeroError> {
    let content: Value = serde_json::from_str(&turn.content_json)
        .map_err(|err| parse_failed(helm_protocol::ParseError(err.to_string())))?;
    let continuation: Value = match &turn.provider_continuation_json {
        None => Value::Null,
        Some(raw) => serde_json::from_str(raw)
            .map_err(|err| parse_failed(helm_protocol::ParseError(err.to_string())))?,
    };
    serde_json::from_value(json!({
        "id": turn.id,
        "threadId": turn.thread_id,
        "ordinal": turn.ordinal,
        "role": turn.role,
        "content": content,
        "modelRef": turn.model_ref,
        "finishReason": turn.finish_reason,
        "providerContinuation": continuation,
        "createdAt": turn.created_at,
    }))
    .map_err(|err| parse_failed(helm_protocol::ParseError(err.to_string())))
}

fn to_usage(usage: &StoredChatUsage) -> Result<ChatUsageRecord, ZeroError> {
    let mut tokens = json!({
        "inputTokens": usage.input_tokens,
        "outputTokens": usage.output_tokens,
    });
    if let Some(cached) = usage.cached_input_tokens {
        tokens["cachedInputTokens"] = json!(cached);
    }
    if let Some(reasoning) = usage.reasoning_tokens {
        tokens["reasoningTokens"] = json!(reasoning);
    }
    serde_json::from_value(json!({
        "id": usage.id,
        "threadId": usage.thread_id,
        "turnId": usage.turn_id,
        "providerId": usage.provider_id,
        "modelRef": usage.model_ref,
        "usage": tokens,
        "createdAt": usage.created_at,
    }))
    .map_err(|err| parse_failed(helm_protocol::ParseError(err.to_string())))
}

fn parse_stream_input(raw: &Value, correlation_id: &str) -> Result<ChatStreamInput, ZeroError> {
    let wrapped = json!({
        "correlationId": correlation_id,
        "runId": correlation_id,
        "input": raw,
    });
    Ok(parse_chat_stream_start_request(&wrapped)
        .map_err(parse_failed)?
        .input)
}

fn finish_name(reason: FinishReason) -> String {
    serde_json::to_value(reason)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".into())
}

fn error_code(code: &str) -> ZeroErrorCode {
    code.parse().unwrap_or(ZeroErrorCode::InternalError)
}

impl<'a> ChatService<'a> {
    pub fn new(
        database: &'a ZeroDatabase,
        logger: &'a Logger,
        models: &'a dyn ChatModelStreamer,
    ) -> Self {
        Self {
            database,
            logger,
            models,
        }
    }

    fn repo(&self) -> ChatRepository<'a> {
        ChatRepository::new(self.database)
    }

    fn list_threads(&self) -> Vec<StoredChatThread> {
        self.database
            .query_all(
                "SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM chat_threads ORDER BY updated_at DESC, id DESC",
                &[],
            )
            .into_iter()
            .map(map_row)
            .collect()
    }

    pub fn list(&self) -> Result<Vec<ChatThread>, ZeroError> {
        self.list_threads().iter().map(to_thread).collect()
    }

    pub fn create(&self, raw: &Value, correlation_id: &str) -> Result<ChatThread, ZeroError> {
        let input = parse_create_chat_thread_input(raw).map_err(parse_failed)?;
        let now = utc_now();
        let thread = parse_chat_thread(&json!({
            "id": create_correlation_id().to_string(),
            "title": input.title,
            "createdAt": now,
            "updatedAt": now,
        }))
        .map_err(parse_failed)?;
        let stored = self.repo().create_thread(&ChatThreadWrite {
            id: thread.id.clone(),
            title: thread.title.clone(),
            created_at: thread.created_at.clone(),
            updated_at: thread.updated_at.clone(),
        });
        let stored = to_thread(&stored)?;
        self.logger.info(LogInput {
            event: "chat.thread_created",
            correlation_id,
            data: Some(json!({ "threadId": stored.id })),
        });
        Ok(stored)
    }

    pub fn get(&self, thread_id: &str) -> Result<ChatTranscript, ZeroError> {
        if uuid::Uuid::parse_str(thread_id).is_err() {
            return Err(parse_failed(helm_protocol::ParseError::new("id")));
        }
        let thread = match self.repo().find_thread_by_id(thread_id) {
            Some(thread) => thread,
            None => {
                return Err(failed(
                    ZeroErrorCode::ValidationFailed,
                    "Chat thread was not found",
                ))
            }
        };
        Ok(ChatTranscript {
            thread: to_thread(&thread)?,
            turns: self
                .repo()
                .list_turns(thread_id)
                .iter()
                .map(to_turn)
                .collect::<Result<_, _>>()?,
            usage: self
                .repo()
                .list_usage(thread_id)
                .iter()
                .map(to_usage)
                .collect::<Result<_, _>>()?,
        })
    }

    pub fn append(&self, raw: &Value, correlation_id: &str) -> Result<AppendedChatTurn, ZeroError> {
        let input = parse_append_chat_turn_input(raw).map_err(parse_failed)?;
        if self.repo().find_thread_by_id(&input.thread_id).is_none() {
            return Err(failed(
                ZeroErrorCode::ValidationFailed,
                "Chat thread was not found",
            ));
        }
        let now = utc_now();
        let turn_id = create_correlation_id().to_string();
        let turn = ChatTurnWrite {
            id: turn_id.clone(),
            thread_id: input.thread_id.clone(),
            role: serde_json::to_value(input.role)
                .ok()
                .and_then(|value| value.as_str().map(str::to_string))
                .unwrap_or_else(|| "user".into()),
            content_json: serde_json::to_string(&input.content).unwrap(),
            model_ref: input.model_ref.clone(),
            finish_reason: input.finish_reason.map(finish_name),
            provider_continuation_json: input
                .provider_continuation
                .as_ref()
                .map(|value| serde_json::to_string(value).unwrap()),
            created_at: now.clone(),
        };
        let usage = match (&input.usage, &input.model_ref) {
            (Some(usage), Some(model_ref)) => Some(ChatUsageWrite {
                id: create_correlation_id().to_string(),
                thread_id: input.thread_id.clone(),
                turn_id: turn_id.clone(),
                provider_id: model_ref
                    .split_once(':')
                    .map(|(left, _)| left.to_string())
                    .unwrap_or_default(),
                model_ref: model_ref.clone(),
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cached_input_tokens: usage.cached_input_tokens,
                reasoning_tokens: usage.reasoning_tokens,
                created_at: now,
            }),
            _ => None,
        };
        let stored = self.repo().append_turn(turn, usage);
        let result = AppendedChatTurn {
            turn: to_turn(&stored.turn)?,
            usage: match stored.usage {
                Some(usage) => Some(to_usage(&usage)?),
                None => None,
            },
        };
        self.logger.info(LogInput {
            event: "chat.turn_appended",
            correlation_id,
            data: Some(json!({
                "threadId": result.turn.thread_id,
                "turnId": result.turn.id,
                "role": result.turn.role,
                "modelRef": result.turn.model_ref,
                "usageRecorded": result.usage.is_some(),
            })),
        });
        Ok(result)
    }

    pub fn stream(
        &'a self,
        raw: Value,
        correlation_id: &str,
        aborted: Arc<AtomicBool>,
    ) -> ChatClientStream<'a> {
        ChatClientStream {
            service: self,
            correlation_id: correlation_id.to_string(),
            aborted,
            state: StreamState::Idle { raw },
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn persist_assistant(
        &self,
        thread_id: &str,
        model_ref: &str,
        text: &str,
        tool_calls: &[NormalizedToolCall],
        finish_reason: FinishReason,
        provider_continuation: Option<&ProviderContinuation>,
        usage: Option<&TokenUsage>,
        correlation_id: &str,
    ) -> Result<(), ZeroError> {
        let mut content: Vec<ModelContentPart> = Vec::new();
        if !text.is_empty() {
            content.push(ModelContentPart::Text {
                text: text.to_string(),
            });
        }
        for call in tool_calls {
            content.push(ModelContentPart::ToolCall { call: call.clone() });
        }
        if content.is_empty() {
            return Ok(());
        }
        let mut raw = json!({
            "threadId": thread_id,
            "role": "assistant",
            "content": content,
            "modelRef": model_ref,
            "finishReason": finish_reason,
        });
        if let Some(continuation) = provider_continuation {
            raw["providerContinuation"] = serde_json::to_value(continuation).unwrap();
        }
        if let Some(usage) = usage {
            raw["usage"] = serde_json::to_value(usage).unwrap();
        }
        self.append(&raw, correlation_id)?;
        Ok(())
    }
}

impl<'a> ChatClientStream<'a> {
    pub async fn next(&mut self) -> Option<Result<ChatClientStreamEvent, ZeroError>> {
        if matches!(self.state, StreamState::Idle { .. }) {
            if let Err(error) = self.start().await {
                self.state = StreamState::Done;
                return Some(Err(error));
            }
        }
        self.step()
    }

    async fn start(&mut self) -> Result<(), ZeroError> {
        let StreamState::Idle { raw } = &self.state else {
            return Ok(());
        };
        let input = parse_stream_input(raw, &self.correlation_id)?;
        self.service.append(
            &json!({
                "threadId": input.thread_id,
                "role": "user",
                "content": [{ "type": "text", "text": input.text }],
            }),
            &self.correlation_id,
        )?;
        let transcript = self.service.get(&input.thread_id)?;
        let request = ModelRequest {
            model_ref: input.model_ref.clone(),
            messages: transcript
                .turns
                .iter()
                .map(|turn| ZeroMessage {
                    id: turn.id.clone(),
                    role: turn.role,
                    content: turn.content.clone(),
                    created_at: turn.created_at.clone(),
                })
                .collect(),
            tools: None,
            response_schema: None,
            reasoning: None,
            data_classifications: vec![helm_protocol::DataClassification::Personal],
            max_output_tokens: None,
            stream: true,
        };
        let events = match self
            .service
            .models
            .stream(
                request,
                &self.correlation_id,
                self.aborted.load(Ordering::SeqCst),
            )
            .await
        {
            Ok(events) => events,
            Err(error) => {
                let cancelled =
                    self.aborted.load(Ordering::SeqCst) || error.code == ZeroErrorCode::Cancelled;
                self.service.persist_assistant(
                    &input.thread_id,
                    &input.model_ref,
                    "",
                    &[],
                    if cancelled {
                        FinishReason::Cancelled
                    } else {
                        FinishReason::Error
                    },
                    None,
                    None,
                    &self.correlation_id,
                )?;
                self.service.logger.warn(LogInput {
                    event: if cancelled {
                        "chat.stream_cancelled"
                    } else {
                        "chat.stream_failed"
                    },
                    correlation_id: &self.correlation_id,
                    data: Some(json!({
                        "threadId": input.thread_id,
                        "modelRef": input.model_ref,
                        "code": error.code.as_str(),
                    })),
                });
                if cancelled {
                    self.state = StreamState::Active {
                        thread_id: input.thread_id,
                        model_ref: input.model_ref,
                        events: vec![ChatStreamEvent::Done {
                            finish_reason: FinishReason::Cancelled,
                            provider_continuation: None,
                        }],
                        index: 0,
                        text: String::new(),
                        tool_calls: Vec::new(),
                        usage: None,
                    };
                    return Ok(());
                }
                return Err(error);
            }
        };
        self.state = StreamState::Active {
            thread_id: input.thread_id,
            model_ref: input.model_ref,
            events,
            index: 0,
            text: String::new(),
            tool_calls: Vec::new(),
            usage: None,
        };
        Ok(())
    }

    fn step(&mut self) -> Option<Result<ChatClientStreamEvent, ZeroError>> {
        if self.aborted.load(Ordering::SeqCst) {
            if let StreamState::Active {
                thread_id,
                model_ref,
                text,
                tool_calls,
                usage,
                ..
            } = std::mem::replace(&mut self.state, StreamState::Done)
            {
                let persist = self.service.persist_assistant(
                    &thread_id,
                    &model_ref,
                    &text,
                    &tool_calls,
                    FinishReason::Cancelled,
                    None,
                    usage.as_ref(),
                    &self.correlation_id,
                );
                self.service.logger.warn(LogInput {
                    event: "chat.stream_cancelled",
                    correlation_id: &self.correlation_id,
                    data: Some(json!({
                        "threadId": thread_id,
                        "modelRef": model_ref,
                        "code": ZeroErrorCode::Cancelled.as_str(),
                    })),
                });
                if let Err(error) = persist {
                    return Some(Err(error));
                }
                return Some(Ok(ChatClientStreamEvent::Done {
                    finish_reason: FinishReason::Cancelled,
                }));
            }
        }
        let event = {
            let StreamState::Active { events, index, .. } = &mut self.state else {
                self.state = StreamState::Done;
                return None;
            };
            if *index >= events.len() {
                None
            } else {
                let event = events[*index].clone();
                *index += 1;
                Some(event)
            }
        };
        let Some(event) = event else {
            return Some(self.finish_active(
                FinishReason::Error,
                None,
                Err(failed(
                    ZeroErrorCode::ModelUnavailable,
                    "Provider stream ended without completion",
                )),
            ));
        };
        match event {
            ChatStreamEvent::TextDelta { text: delta } => {
                if let StreamState::Active { text, .. } = &mut self.state {
                    text.push_str(&delta);
                }
                Some(Ok(ChatClientStreamEvent::TextDelta { text: delta }))
            }
            ChatStreamEvent::ReasoningSummary { text } => {
                Some(Ok(ChatClientStreamEvent::ReasoningSummary { text }))
            }
            ChatStreamEvent::ToolProposed { call } => {
                if let StreamState::Active { tool_calls, .. } = &mut self.state {
                    tool_calls.push(call.clone());
                }
                Some(Ok(ChatClientStreamEvent::ToolProposed { call }))
            }
            ChatStreamEvent::Usage { usage: next } => {
                if let StreamState::Active { usage, .. } = &mut self.state {
                    *usage = Some(next.clone());
                }
                Some(Ok(ChatClientStreamEvent::Usage { usage: next }))
            }
            ChatStreamEvent::Error { error } => {
                let failure = ZeroError::new(
                    error_code(&error.code),
                    error.message.clone(),
                    helm_shared::ZeroErrorOptions {
                        retryable: error.retryable,
                        metadata: Default::default(),
                    },
                );
                Some(self.finish_active(FinishReason::Error, None, Err(failure)))
            }
            ChatStreamEvent::Done {
                finish_reason,
                provider_continuation,
            } => Some(self.finish_active(
                finish_reason,
                provider_continuation,
                Ok(ChatClientStreamEvent::Done { finish_reason }),
            )),
        }
    }

    fn finish_active(
        &mut self,
        finish_reason: FinishReason,
        continuation: Option<ProviderContinuation>,
        result: Result<ChatClientStreamEvent, ZeroError>,
    ) -> Result<ChatClientStreamEvent, ZeroError> {
        let StreamState::Active {
            thread_id,
            model_ref,
            text,
            tool_calls,
            usage,
            ..
        } = std::mem::replace(&mut self.state, StreamState::Done)
        else {
            return result;
        };
        let persist = self.service.persist_assistant(
            &thread_id,
            &model_ref,
            &text,
            &tool_calls,
            finish_reason,
            continuation.as_ref(),
            usage.as_ref(),
            &self.correlation_id,
        );
        match &result {
            Ok(ChatClientStreamEvent::Done { .. })
                if finish_reason != FinishReason::Error
                    && finish_reason != FinishReason::Cancelled =>
            {
                self.service.logger.info(LogInput {
                    event: "chat.stream_completed",
                    correlation_id: &self.correlation_id,
                    data: Some(json!({
                        "threadId": thread_id,
                        "modelRef": model_ref,
                        "finishReason": finish_reason,
                    })),
                });
            }
            _ => {
                self.service.logger.warn(LogInput {
                    event: "chat.stream_failed",
                    correlation_id: &self.correlation_id,
                    data: Some(json!({
                        "threadId": thread_id,
                        "modelRef": model_ref,
                        "code": result.as_ref().err().map(|err| err.code.as_str()).unwrap_or("MODEL_UNAVAILABLE"),
                    })),
                });
            }
        }
        persist?;
        result
    }
}
