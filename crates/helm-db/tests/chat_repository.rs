use std::panic::{catch_unwind, AssertUnwindSafe};

use helm_db::{
    migrations, open_database_unchecked, run_migrations, ChatRepository, ChatThreadWrite,
    ChatTurnWrite, ChatUsageWrite,
};
use helm_shared::{create_correlation_id, utc_now};
use serde_json::json;

fn id() -> String {
    create_correlation_id().to_string()
}

fn setup() -> (helm_db::ZeroDatabase, String, String) {
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let thread_id = id();
    let created_at = "2026-08-10T10:00:00.000Z".to_string();
    ChatRepository::new(&database).create_thread(&ChatThreadWrite {
        id: thread_id.clone(),
        title: Some("Persistent chat".into()),
        created_at: created_at.clone(),
        updated_at: created_at.clone(),
    });
    (database, thread_id, created_at)
}

fn turn(thread_id: &str) -> ChatTurnWrite {
    ChatTurnWrite {
        id: id(),
        thread_id: thread_id.to_string(),
        role: "user".into(),
        content_json: json!([{ "type": "text", "text": "Hello" }]).to_string(),
        model_ref: None,
        finish_reason: None,
        provider_continuation_json: None,
        created_at: utc_now(),
    }
}

fn usage(thread_id: &str, turn_id: &str, provider_id: &str, model_ref: &str) -> ChatUsageWrite {
    ChatUsageWrite {
        id: id(),
        thread_id: thread_id.to_string(),
        turn_id: turn_id.to_string(),
        provider_id: provider_id.to_string(),
        model_ref: model_ref.to_string(),
        input_tokens: 10,
        output_tokens: 5,
        cached_input_tokens: None,
        reasoning_tokens: None,
        created_at: utc_now(),
    }
}

#[test]
fn persists_ordered_turns_and_normalized_usage_atomically() {
    let (database, thread_id, _) = setup();
    let repository = ChatRepository::new(&database);
    let mut user_turn = turn(&thread_id);
    user_turn.created_at = "2026-08-10T10:01:00.000Z".into();
    let provider_id = id();
    let model_ref = format!("{provider_id}:gpt-example");
    let mut assistant_turn = turn(&thread_id);
    assistant_turn.role = "assistant".into();
    assistant_turn.model_ref = Some(model_ref.clone());
    assistant_turn.finish_reason = Some("stop".into());
    assistant_turn.provider_continuation_json =
        Some(json!({ "providerId": provider_id, "responseId": "response-123" }).to_string());
    assistant_turn.created_at = "2026-08-10T10:02:00.000Z".into();
    let mut assistant_usage = usage(&thread_id, &assistant_turn.id, &provider_id, &model_ref);
    assistant_usage.cached_input_tokens = Some(2);
    assistant_usage.reasoning_tokens = Some(1);
    assistant_usage.created_at = assistant_turn.created_at.clone();
    assert_eq!(repository.append_turn(user_turn, None).turn.ordinal, 0);
    let appended = repository.append_turn(assistant_turn.clone(), Some(assistant_usage));
    assert_eq!(appended.turn.ordinal, 1);
    assert_eq!(appended.turn.model_ref.as_deref(), Some(model_ref.as_str()));
    assert_eq!(
        repository
            .list_turns(&thread_id)
            .into_iter()
            .map(|t| t.ordinal)
            .collect::<Vec<_>>(),
        vec![0, 1]
    );
    let listed = repository.list_usage(&thread_id);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].turn_id, assistant_turn.id);
    assert_eq!(listed[0].cached_input_tokens, Some(2));
    assert_eq!(listed[0].reasoning_tokens, Some(1));
    assert_eq!(
        repository.find_thread_by_id(&thread_id).unwrap().updated_at,
        assistant_turn.created_at
    );
}

#[test]
fn rolls_back_an_appended_turn_when_usage_violates_a_constraint() {
    let (database, thread_id, created_at) = setup();
    let repository = ChatRepository::new(&database);
    let provider_id = id();
    let model_ref = format!("{provider_id}:gpt-example");
    let mut assistant_turn = turn(&thread_id);
    assistant_turn.role = "assistant".into();
    assistant_turn.model_ref = Some(model_ref.clone());
    assistant_turn.finish_reason = Some("stop".into());
    let mut bad = usage(&thread_id, &assistant_turn.id, &provider_id, &model_ref);
    bad.input_tokens = -1;
    let failed = catch_unwind(AssertUnwindSafe(|| {
        repository.append_turn(assistant_turn, Some(bad));
    }));
    assert!(failed.is_err());
    assert!(repository.list_turns(&thread_id).is_empty());
    assert!(repository.list_usage(&thread_id).is_empty());
    assert_eq!(
        repository.find_thread_by_id(&thread_id).unwrap().updated_at,
        created_at
    );
}

#[test]
fn retains_canonical_history_after_its_provider_is_deleted() {
    let (database, thread_id, _) = setup();
    let repository = ChatRepository::new(&database);
    let provider_id = id();
    let now = utc_now();
    database.run(
        "INSERT INTO providers (
          id, label, protocol, base_url, secret_ref, headers_json,
          allow_personal, allow_sensitive, allow_health, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        &[
            json!(provider_id),
            json!("Disposable provider"),
            json!("openai"),
            json!(null),
            json!(format!("zero.provider.{provider_id}.api-key")),
            json!("[]"),
            json!(1),
            json!(0),
            json!(0),
            json!(1),
            json!(now),
            json!(now),
        ],
    );
    let model_ref = format!("{provider_id}:retained-model");
    let mut assistant_turn = turn(&thread_id);
    assistant_turn.role = "assistant".into();
    assistant_turn.model_ref = Some(model_ref.clone());
    assistant_turn.finish_reason = Some("stop".into());
    let usage_row = usage(&thread_id, &assistant_turn.id, &provider_id, &model_ref);
    repository.append_turn(assistant_turn, Some(usage_row));
    database.run("DELETE FROM providers WHERE id = ?", &[json!(provider_id)]);
    assert_eq!(repository.list_turns(&thread_id).len(), 1);
    let listed = repository.list_usage(&thread_id);
    assert_eq!(listed[0].provider_id, provider_id);
    assert_eq!(listed[0].model_ref, model_ref);
}
