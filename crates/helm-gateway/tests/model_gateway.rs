use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use helm_gateway::{
    BoxFuture, CredentialResolver, GatewayProviderConfig, ModelGateway, ProviderAdapter,
    ProviderConnectionResult, ProviderInvocationContext,
};
use helm_protocol::{
    ChatStreamEvent, FinishReason, MessageRole, ModelCapabilities, ModelContentPart, ModelRecord,
    ModelRequest, ModelResponse, PrivacyClass, ToolDefinition, ZeroMessage,
};
use helm_shared::{create_correlation_id, utc_now, ZeroErrorCode};
use serde_json::json;

fn id() -> String {
    create_correlation_id().to_string()
}

struct StaticCredentials {
    value: Option<String>,
    calls: AtomicUsize,
}

impl CredentialResolver for StaticCredentials {
    fn resolve(&self, _secret_ref: &str) -> Option<String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.value.clone()
    }
}

struct MockAdapter {
    protocol: &'static str,
    response: ModelResponse,
    events: Vec<ChatStreamEvent>,
    models: Vec<ModelRecord>,
}

impl ProviderAdapter for MockAdapter {
    fn protocol(&self) -> &'static str {
        self.protocol
    }

    fn invoke(
        &self,
        _request: &ModelRequest,
        _context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ModelResponse, Box<dyn std::error::Error + Send + Sync>>> {
        let response = self.response.clone();
        Box::pin(async move { Ok(response) })
    }

    fn stream(
        &self,
        _request: &ModelRequest,
        _context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<Vec<ChatStreamEvent>, Box<dyn std::error::Error + Send + Sync>>> {
        let events = self.events.clone();
        Box::pin(async move { Ok(events) })
    }

    fn discover_models(
        &self,
        _context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<Vec<ModelRecord>, Box<dyn std::error::Error + Send + Sync>>> {
        let models = self.models.clone();
        Box::pin(async move { Ok(models) })
    }

    fn test_connection(
        &self,
        _context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ProviderConnectionResult, Box<dyn std::error::Error + Send + Sync>>> {
        Box::pin(async move {
            Ok(ProviderConnectionResult {
                ok: true,
                latency_ms: 4,
            })
        })
    }
}

fn caps(text: bool, tools: bool) -> ModelCapabilities {
    ModelCapabilities {
        text,
        vision: false,
        audio_input: false,
        tool_calling: tools,
        parallel_tools: false,
        structured_output: false,
        streaming: true,
        reasoning_controls: false,
        server_web_search: false,
        server_mcp: false,
        context_window: Some(8192),
        max_output_tokens: Some(2048),
    }
}

fn fixture() -> (String, ModelRecord, ModelRequest, MockAdapter) {
    let provider_id = id();
    let model = ModelRecord {
        model_ref: format!("{provider_id}:example-model"),
        provider_id: provider_id.clone(),
        model_id: "example-model".into(),
        label: "Example model".into(),
        capabilities: caps(true, false),
        privacy_class: PrivacyClass::Remote,
        tags: vec!["test".into()],
    };
    let request = ModelRequest {
        model_ref: model.model_ref.clone(),
        messages: vec![ZeroMessage {
            id: id(),
            role: MessageRole::User,
            content: vec![ModelContentPart::Text {
                text: "Hello".into(),
            }],
            created_at: utc_now(),
        }],
        tools: None,
        response_schema: None,
        reasoning: None,
        data_classifications: vec![helm_protocol::DataClassification::Public],
        max_output_tokens: None,
        stream: false,
    };
    let adapter = MockAdapter {
        protocol: "openai",
        response: ModelResponse {
            text: "Hello".into(),
            reasoning_summary: None,
            tool_calls: vec![],
            usage: None,
            finish_reason: FinishReason::Stop,
            provider_continuation: None,
        },
        events: vec![
            ChatStreamEvent::TextDelta { text: "Hel".into() },
            ChatStreamEvent::TextDelta { text: "lo".into() },
            ChatStreamEvent::Done {
                finish_reason: FinishReason::Stop,
                provider_continuation: None,
            },
        ],
        models: vec![model.clone()],
    };
    (provider_id, model, request, adapter)
}

fn register(
    provider_id: &str,
    model: ModelRecord,
    adapter: MockAdapter,
    base_url: &str,
    creds: Arc<StaticCredentials>,
) -> ModelGateway {
    let mut gateway = ModelGateway::new(creds);
    gateway.register_provider(
        GatewayProviderConfig {
            id: provider_id.to_string(),
            protocol: "openai".into(),
            base_url: Some(base_url.into()),
            secret_ref: format!("zero.provider.{provider_id}.api-key"),
            privacy_allow_personal: true,
            privacy_allow_sensitive: false,
            privacy_allow_health: false,
            enabled: true,
        },
        Arc::new(adapter),
    );
    gateway.replace_models(provider_id, vec![model]);
    gateway
}

#[tokio::test]
async fn routes_normalized_requests_and_validates_normalized_responses() {
    let (provider_id, model, request, adapter) = fixture();
    let creds = Arc::new(StaticCredentials {
        value: Some("fake-test-credential".into()),
        calls: AtomicUsize::new(0),
    });
    let gateway = register(
        &provider_id,
        model,
        adapter,
        "https://api.example.test/v1",
        creds,
    );
    let response = gateway.invoke(request, false).await.unwrap();
    assert_eq!(response.text, "Hello");
    assert!(response.tool_calls.is_empty());
}

#[tokio::test]
async fn blocks_privacy_and_capability_mismatches_before_resolving_credentials() {
    let (provider_id, model, request, adapter) = fixture();
    let creds = Arc::new(StaticCredentials {
        value: Some("fake-test-credential".into()),
        calls: AtomicUsize::new(0),
    });
    let mut gateway = register(
        &provider_id,
        model.clone(),
        adapter,
        "https://api.example.test/v1",
        Arc::clone(&creds),
    );
    let mut health = request.clone();
    health.data_classifications = vec![helm_protocol::DataClassification::Health];
    assert_eq!(
        gateway.invoke(health, false).await.unwrap_err().code,
        ZeroErrorCode::PermissionDenied
    );
    let mut tools = request.clone();
    tools.tools = Some(vec![ToolDefinition {
        name: "lookup".into(),
        description: "Lookup".into(),
        input_schema: json!({ "type": "object" }),
    }]);
    assert_eq!(
        gateway.invoke(tools, false).await.unwrap_err().code,
        ZeroErrorCode::ModelCapabilityMismatch
    );
    let mut no_text = model.clone();
    no_text.capabilities.text = false;
    gateway.replace_models(&provider_id, vec![no_text]);
    assert_eq!(
        gateway.invoke(request, false).await.unwrap_err().code,
        ZeroErrorCode::ModelCapabilityMismatch
    );
    assert_eq!(creds.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn allows_restricted_data_only_to_local_models_and_never_sends_secrets() {
    let (provider_id, mut model, request, adapter) = fixture();
    model.privacy_class = PrivacyClass::Local;
    let creds = Arc::new(StaticCredentials {
        value: Some("fake-test-credential".into()),
        calls: AtomicUsize::new(0),
    });
    let gateway = register(
        &provider_id,
        model,
        adapter,
        "https://api.example.test/v1",
        creds,
    );
    let mut personal = request.clone();
    personal.data_classifications = vec![
        helm_protocol::DataClassification::Personal,
        helm_protocol::DataClassification::Sensitive,
        helm_protocol::DataClassification::Health,
    ];
    assert_eq!(gateway.invoke(personal, false).await.unwrap().text, "Hello");
    let mut secret = request;
    secret.data_classifications = vec![helm_protocol::DataClassification::Secret];
    assert_eq!(
        gateway.invoke(secret, false).await.unwrap_err().code,
        ZeroErrorCode::PermissionDenied
    );
}

#[tokio::test]
async fn refuses_to_send_credentials_over_non_loopback_http() {
    let (provider_id, model, request, adapter) = fixture();
    let creds = Arc::new(StaticCredentials {
        value: Some("fake-test-credential".into()),
        calls: AtomicUsize::new(0),
    });
    let gateway = register(
        &provider_id,
        model,
        adapter,
        "http://api.example.test/v1",
        Arc::clone(&creds),
    );
    assert_eq!(
        gateway.invoke(request, false).await.unwrap_err().code,
        ZeroErrorCode::PermissionDenied
    );
    assert_eq!(creds.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn supports_validated_streaming_and_cancellation() {
    let (provider_id, model, mut request, adapter) = fixture();
    let creds = Arc::new(StaticCredentials {
        value: Some("fake-test-credential".into()),
        calls: AtomicUsize::new(0),
    });
    let gateway = register(
        &provider_id,
        model,
        adapter,
        "https://api.example.test/v1",
        creds,
    );
    request.stream = true;
    let events = gateway.stream(request.clone(), false).await.unwrap();
    assert_eq!(events.len(), 3);
    request.stream = false;
    assert_eq!(
        gateway.invoke(request, true).await.unwrap_err().code,
        ZeroErrorCode::Cancelled
    );
}

#[tokio::test]
async fn discovers_models_and_tests_connections_through_the_registered_adapter() {
    let (provider_id, model, _, adapter) = fixture();
    let creds = Arc::new(StaticCredentials {
        value: Some("fake-test-credential".into()),
        calls: AtomicUsize::new(0),
    });
    let gateway = register(
        &provider_id,
        model.clone(),
        adapter,
        "https://api.example.test/v1",
        creds,
    );
    let discovered = gateway
        .discover_models(provider_id.clone(), false)
        .await
        .unwrap();
    assert_eq!(discovered[0].model_id, model.model_id);
    let ping = gateway.test_connection(provider_id, false).await.unwrap();
    assert!(ping.ok);
    assert_eq!(ping.latency_ms, 4);
}
