use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use helm_db::{migrations, open_database_unchecked, run_migrations};
use helm_gateway::{header, GatewayFetch, HttpResponse, ProviderHttpError};
use helm_observability::create_logger;
use helm_shared::{create_correlation_id, ZeroError, ZeroErrorCode};
use serde_json::json;

use helm_core::{MemorySecretStore, ModelService, ProviderService, SecretStore};

fn provider_input(api_key: &str, overrides: serde_json::Value) -> serde_json::Value {
    let mut value = json!({
        "label": "OpenAI",
        "protocol": "openai",
        "baseUrl": "https://api.example.test/v1",
        "headers": [],
        "privacy": { "allowPersonal": true, "allowSensitive": false, "allowHealth": false },
        "enabled": true,
        "apiKey": api_key,
    });
    if let Some(object) = overrides.as_object() {
        for (key, item) in object {
            value[key] = item.clone();
        }
    }
    value
}

fn json_response(body: serde_json::Value) -> Result<HttpResponse, ProviderHttpError> {
    Ok(HttpResponse {
        status: 200,
        body: serde_json::to_vec(&body).unwrap(),
    })
}

struct SpyStore {
    inner: MemorySecretStore,
    gets: AtomicUsize,
}

impl SecretStore for SpyStore {
    fn set(&self, r#ref: &str, secret: &str) -> Result<(), ZeroError> {
        self.inner.set(r#ref, secret)
    }
    fn get(&self, r#ref: &str) -> Result<Option<String>, ZeroError> {
        self.gets.fetch_add(1, Ordering::SeqCst);
        self.inner.get(r#ref)
    }
    fn delete(&self, r#ref: &str) -> Result<(), ZeroError> {
        self.inner.delete(r#ref)
    }
}

#[tokio::test(flavor = "current_thread")]
async fn tests_a_saved_connection_and_persists_a_discovered_catalog_without_leaking_secrets() {
    let sentinel = "model-service-secret-sentinel";
    let logs = Rc::new(RefCell::new(Vec::<String>::new()));
    let calls = Arc::new(AtomicUsize::new(0));
    let fetch: GatewayFetch = {
        let calls = Arc::clone(&calls);
        Arc::new(move |req| {
            calls.fetch_add(1, Ordering::SeqCst);
            let auth = header(&req.headers, "Authorization");
            assert_eq!(
                auth.as_deref(),
                Some("Bearer model-service-secret-sentinel")
            );
            Box::pin(async {
                json_response(json!({
                    "data": [
                        { "id": "gpt-z", "owned_by": "openai" },
                        { "id": "gpt-a", "owned_by": "openai" },
                    ]
                }))
            })
        })
    };
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = {
        let logs = Rc::clone(&logs);
        create_logger(move |line| logs.borrow_mut().push(line))
    };
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let provider = providers
        .create(
            &provider_input(sentinel, json!({})),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let tested = models
        .test_connection(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap();
    assert!(tested.ok);
    let discovered = models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap();
    assert_eq!(discovered.len(), 2);
    let ids: Vec<String> = models
        .list(Some(&provider.id))
        .unwrap()
        .into_iter()
        .map(|model| model.model_id)
        .collect();
    assert_eq!(ids, vec!["gpt-a".to_string(), "gpt-z".to_string()]);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(!serde_json::to_string(&provider).unwrap().contains(sentinel));
    assert!(!logs.borrow().join("\n").contains(sentinel));
}

#[tokio::test(flavor = "current_thread")]
async fn missing_keychain_entry_fails_closed_without_leaking_the_secret() {
    let sentinel = "missing-keychain-secret-sentinel";
    let fetch: GatewayFetch = Arc::new(|_req| {
        Box::pin(async {
            panic!("must not call the provider without a credential");
        })
    });
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = create_logger(|_| {});
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let provider = providers
        .create(
            &provider_input(sentinel, json!({})),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let secret_ref = format!("zero.provider.{}.api-key", provider.id);
    secrets.delete(&secret_ref).unwrap();
    let err = models
        .test_connection(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap_err();
    assert_eq!(err.code, ZeroErrorCode::AuthFailed);
    assert_eq!(err.message(), "Provider credential is unavailable");
    assert!(!err.message().contains(sentinel));
    assert!(!format!("{err:?}").contains(sentinel));
}

#[tokio::test(flavor = "current_thread")]
async fn routes_anthropic_providers_through_the_native_models_endpoint() {
    let sentinel = "anthropic-model-service-secret-sentinel";
    let urls = Arc::new(Mutex::new(Vec::<String>::new()));
    let fetch: GatewayFetch = {
        let urls = Arc::clone(&urls);
        Arc::new(move |req| {
            urls.lock().unwrap().push(req.url.clone());
            let key = header(&req.headers, "x-api-key");
            assert_eq!(key.as_deref(), Some(sentinel));
            let version = header(&req.headers, "anthropic-version");
            assert_eq!(version.as_deref(), Some("2023-06-01"));
            assert!(header(&req.headers, "authorization").is_none());
            Box::pin(async {
                json_response(json!({
                    "data": [{ "id": "claude-example", "display_name": "Claude Example" }],
                    "has_more": false,
                }))
            })
        })
    };
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = create_logger(|_| {});
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let provider = providers
        .create(
            &provider_input(
                sentinel,
                json!({ "label": "Anthropic", "protocol": "anthropic", "baseUrl": null }),
            ),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let tested = models
        .test_connection(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap();
    assert!(tested.ok);
    let discovered = models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap();
    assert_eq!(discovered[0].model_id, "claude-example");
    assert_eq!(discovered[0].label, "Claude Example");
    assert!(urls
        .lock()
        .unwrap()
        .iter()
        .any(|url| url == "https://api.anthropic.com/v1/models?limit=1000"));
}

#[tokio::test(flavor = "current_thread")]
async fn blocks_unavailable_unsupported_and_insecure_providers_before_reading_a_credential() {
    let gets = Arc::new(AtomicUsize::new(0));
    let secrets = SpyStore {
        inner: MemorySecretStore::new(),
        gets: AtomicUsize::new(0),
    };
    let fetch_calls = Arc::new(AtomicUsize::new(0));
    let fetch: GatewayFetch = {
        let fetch_calls = Arc::clone(&fetch_calls);
        Arc::new(move |_req| {
            fetch_calls.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { json_response(json!({ "data": [] })) })
        })
    };
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let logger = create_logger(|_| {});
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let disabled = providers
        .create(
            &provider_input("stored", json!({ "enabled": false })),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let insecure = providers
        .create(
            &provider_input(
                "stored",
                json!({ "label": "Insecure", "baseUrl": "http://api.example.test/v1" }),
            ),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let unsupported = providers
        .create(
            &provider_input("stored", json!({ "label": "Custom", "protocol": "custom" })),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let disabled_err = models
        .test_connection(&disabled.id, create_correlation_id().as_str())
        .await
        .unwrap_err();
    assert_eq!(disabled_err.code, ZeroErrorCode::ModelUnavailable);
    let insecure_err = models
        .test_connection(&insecure.id, create_correlation_id().as_str())
        .await
        .unwrap_err();
    assert_eq!(insecure_err.code, ZeroErrorCode::PermissionDenied);
    let unsupported_err = models
        .test_connection(&unsupported.id, create_correlation_id().as_str())
        .await
        .unwrap_err();
    assert_eq!(unsupported_err.code, ZeroErrorCode::ModelUnavailable);
    let _ = gets;
    assert_eq!(secrets.gets.load(Ordering::SeqCst), 0);
    assert_eq!(fetch_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "current_thread")]
async fn persists_manual_capability_overrides_across_rediscovery_and_restores_the_baseline() {
    let fetch: GatewayFetch = Arc::new(|_req| {
        Box::pin(async { json_response(json!({ "data": [{ "id": "configurable" }] })) })
    });
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = create_logger(|_| {});
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let provider = providers
        .create(
            &provider_input("fake-test-key", json!({})),
            create_correlation_id().as_str(),
        )
        .unwrap();
    models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap();
    let model_ref = format!("{}:configurable", provider.id);
    let updated = models
        .update_capability_override(
            &model_ref,
            &json!({ "toolCalling": true, "structuredOutput": true, "contextWindow": 32768 }),
            create_correlation_id().as_str(),
        )
        .unwrap();
    assert!(updated.capabilities.tool_calling);
    assert!(updated.capabilities.structured_output);
    assert_eq!(updated.capabilities.context_window, Some(32768));
    let listed = models
        .list_capability_overrides(Some(&provider.id))
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].model_ref, model_ref);
    assert_eq!(listed[0].overrides.tool_calling, Some(true));
    assert_eq!(listed[0].overrides.structured_output, Some(true));
    assert_eq!(listed[0].overrides.context_window, Some(32768));
    models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap();
    let after = &models.list(Some(&provider.id)).unwrap()[0].capabilities;
    assert!(after.tool_calling);
    assert!(after.structured_output);
    assert_eq!(after.context_window, Some(32768));
    let cleared = models
        .update_capability_override(&model_ref, &json!({}), create_correlation_id().as_str())
        .unwrap();
    assert!(!cleared.capabilities.tool_calling);
    assert!(!cleared.capabilities.structured_output);
    assert!(models
        .list_capability_overrides(Some(&provider.id))
        .unwrap()
        .is_empty());
}

#[tokio::test(flavor = "current_thread")]
async fn routes_generic_and_local_providers_without_leaking_or_inventing_credentials() {
    let requests = Arc::new(Mutex::new(Vec::<(String, Option<String>)>::new()));
    let fetch: GatewayFetch = {
        let requests = Arc::clone(&requests);
        Arc::new(move |req| {
            requests
                .lock()
                .unwrap()
                .push((req.url.clone(), header(&req.headers, "authorization")));
            let url = req.url.clone();
            Box::pin(async move {
                if url.ends_with("/api/tags") {
                    json_response(json!({ "models": [{ "name": "qwen3:8b" }] }))
                } else {
                    json_response(json!({ "data": [{ "id": "vendor-chat" }] }))
                }
            })
        })
    };
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = create_logger(|_| {});
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let compatible = providers
        .create(
            &provider_input(
                "generic-secret",
                json!({ "label": "Compatible", "protocol": "openai-compatible" }),
            ),
            create_correlation_id().as_str(),
        )
        .unwrap();
    let ollama = providers
        .create(
            &provider_input(
                "",
                json!({ "label": "Ollama", "protocol": "ollama", "baseUrl": null }),
            ),
            create_correlation_id().as_str(),
        )
        .unwrap();
    models
        .discover(&compatible.id, create_correlation_id().as_str())
        .await
        .unwrap();
    models
        .discover(&ollama.id, create_correlation_id().as_str())
        .await
        .unwrap();
    assert_eq!(
        *requests.lock().unwrap(),
        vec![
            (
                "https://api.example.test/v1/models".into(),
                Some("Bearer generic-secret".into())
            ),
            ("http://127.0.0.1:11434/api/tags".into(), None),
        ]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn preserves_the_last_catalog_when_discovery_returns_duplicate_model_ids() {
    let duplicate = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let fetch: GatewayFetch = {
        let duplicate = Arc::clone(&duplicate);
        Arc::new(move |_req| {
            let duplicate = duplicate.load(Ordering::SeqCst);
            Box::pin(async move {
                json_response(if duplicate {
                    json!({ "data": [{ "id": "stable" }, { "id": "stable" }] })
                } else {
                    json!({ "data": [{ "id": "stable" }] })
                })
            })
        })
    };
    let database = open_database_unchecked(":memory:");
    run_migrations(&database, &migrations());
    let secrets = MemorySecretStore::new();
    let logger = create_logger(|_| {});
    let providers = ProviderService::new(&database, &secrets, &logger);
    let models = ModelService::new(&database, &secrets, &logger, fetch);
    let provider = providers
        .create(
            &provider_input("fake-test-key", json!({})),
            create_correlation_id().as_str(),
        )
        .unwrap();
    models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap();
    duplicate.store(true, Ordering::SeqCst);
    let err = models
        .discover(&provider.id, create_correlation_id().as_str())
        .await
        .unwrap_err();
    assert_eq!(err.code, ZeroErrorCode::ValidationFailed);
    let ids: Vec<String> = models
        .list(Some(&provider.id))
        .unwrap()
        .into_iter()
        .map(|model| model.model_id)
        .collect();
    assert_eq!(ids, vec!["stable".to_string()]);
}
