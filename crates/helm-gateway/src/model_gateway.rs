use std::collections::HashMap;
use std::sync::Arc;

use helm_protocol::{
    parse_chat_stream_event, parse_model_record, parse_model_request, parse_model_response,
    ChatStreamEvent, ModelRecord, ModelRequest, ModelResponse,
};
use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};

use crate::adapter::{
    BoxFuture, CredentialResolver, ProviderAdapter, ProviderConnectionResult,
    ProviderInvocationContext,
};
use crate::error_mapping::normalize_provider_error;

#[derive(Debug, Clone)]
pub struct GatewayProviderConfig {
    pub id: String,
    pub protocol: String,
    pub base_url: Option<String>,
    pub secret_ref: String,
    pub privacy_allow_personal: bool,
    pub privacy_allow_sensitive: bool,
    pub privacy_allow_health: bool,
    pub enabled: bool,
}

struct RegisteredProvider {
    config: GatewayProviderConfig,
    adapter: Arc<dyn ProviderAdapter>,
}

pub struct ModelGateway {
    credentials: Arc<dyn CredentialResolver>,
    providers: HashMap<String, RegisteredProvider>,
    models: HashMap<String, ModelRecord>,
}

fn failed(code: ZeroErrorCode, message: &str) -> ZeroError {
    ZeroError::new(code, message, ZeroErrorOptions::default())
}

fn classification_allowed(
    classification: &str,
    config: &GatewayProviderConfig,
    privacy_class: &str,
) -> bool {
    if classification == "secret" {
        return false;
    }
    if privacy_class == "local" {
        return true;
    }
    match classification {
        "public" => true,
        "personal" => config.privacy_allow_personal,
        "sensitive" => config.privacy_allow_sensitive,
        "health" => config.privacy_allow_health,
        _ => false,
    }
}

fn assert_secure_base_url(base_url: Option<&str>) -> Result<(), ZeroError> {
    let Some(base_url) = base_url else {
        return Ok(());
    };
    let https = base_url.starts_with("https://");
    let http = base_url.starts_with("http://");
    let loopback = [
        "http://localhost",
        "http://127.0.0.1",
        "http://[::1]",
        "http://::1",
    ]
    .iter()
    .any(|prefix| base_url.starts_with(prefix));
    if https || (http && loopback) {
        Ok(())
    } else {
        Err(failed(
            ZeroErrorCode::PermissionDenied,
            "Provider credentials require HTTPS or a loopback URL",
        ))
    }
}

fn assert_capabilities(request: &ModelRequest, model: &ModelRecord) -> Result<(), ZeroError> {
    let mut missing = Vec::new();
    let has_text = request.messages.iter().any(|message| {
        matches!(
            message.content.first(),
            Some(helm_protocol::ModelContentPart::Text { .. })
        )
    });
    if has_text && !model.capabilities.text {
        missing.push("text");
    }
    if request
        .tools
        .as_ref()
        .is_some_and(|tools| !tools.is_empty())
        && !model.capabilities.tool_calling
    {
        missing.push("toolCalling");
    }
    if request.response_schema.is_some() && !model.capabilities.structured_output {
        missing.push("structuredOutput");
    }
    if request
        .reasoning
        .is_some_and(|reason| !matches!(reason, helm_protocol::ReasoningLevel::None))
        && !model.capabilities.reasoning_controls
    {
        missing.push("reasoningControls");
    }
    if request.stream && !model.capabilities.streaming {
        missing.push("streaming");
    }
    if missing.is_empty() {
        Ok(())
    } else {
        Err(failed(
            ZeroErrorCode::ModelCapabilityMismatch,
            "The selected model does not support this request",
        ))
    }
}

impl ModelGateway {
    pub fn new(credentials: Arc<dyn CredentialResolver>) -> Self {
        Self {
            credentials,
            providers: HashMap::new(),
            models: HashMap::new(),
        }
    }

    pub fn register_provider(
        &mut self,
        config: GatewayProviderConfig,
        adapter: Arc<dyn ProviderAdapter>,
    ) {
        if config.protocol != adapter.protocol() {
            panic!(
                "{}",
                failed(
                    ZeroErrorCode::ValidationFailed,
                    "Provider protocol does not match adapter"
                )
            );
        }
        self.providers
            .insert(config.id.clone(), RegisteredProvider { config, adapter });
    }

    pub fn replace_models(
        &mut self,
        provider_id: &str,
        raw_models: Vec<ModelRecord>,
    ) -> Vec<ModelRecord> {
        if !self.providers.contains_key(provider_id) {
            panic!(
                "{}",
                failed(
                    ZeroErrorCode::ValidationFailed,
                    "Provider is not registered"
                )
            );
        }
        self.models
            .retain(|_, model| model.provider_id != provider_id);
        for model in &raw_models {
            self.models.insert(model.model_ref.clone(), model.clone());
        }
        raw_models
    }

    pub fn invoke(
        &self,
        request: ModelRequest,
        aborted: bool,
    ) -> BoxFuture<Result<ModelResponse, ZeroError>> {
        let prepared = self.prepare(request, aborted);
        Box::pin(async move {
            let (adapter, context, request) = prepared?;
            match adapter.invoke(&request, &context).await {
                Ok(response) => {
                    let value = serde_json::to_value(&response).unwrap();
                    parse_model_response(&value).map_err(|_| {
                        failed(
                            ZeroErrorCode::ModelUnavailable,
                            "The provider request failed",
                        )
                    })
                }
                Err(error) => Err(normalize_provider_error(error.as_ref())),
            }
        })
    }

    pub fn stream(
        &self,
        request: ModelRequest,
        aborted: bool,
    ) -> BoxFuture<Result<Vec<ChatStreamEvent>, ZeroError>> {
        let prepared = self.prepare(request, aborted);
        Box::pin(async move {
            let (adapter, context, request) = prepared?;
            match adapter.stream(&request, &context).await {
                Ok(events) => events
                    .into_iter()
                    .map(|event| {
                        let value = serde_json::to_value(&event).unwrap();
                        parse_chat_stream_event(&value).map_err(|_| {
                            failed(
                                ZeroErrorCode::ModelUnavailable,
                                "The provider request failed",
                            )
                        })
                    })
                    .collect(),
                Err(error) => Err(normalize_provider_error(error.as_ref())),
            }
        })
    }

    pub fn discover_models(
        &self,
        provider_id: String,
        aborted: bool,
    ) -> BoxFuture<Result<Vec<ModelRecord>, ZeroError>> {
        let context = self.context(&provider_id, aborted);
        Box::pin(async move {
            let (adapter, context) = context?;
            match adapter.discover_models(&context).await {
                Ok(models) => models
                    .into_iter()
                    .map(|model| {
                        let value = serde_json::to_value(&model).unwrap();
                        parse_model_record(&value).map_err(|_| {
                            failed(
                                ZeroErrorCode::ValidationFailed,
                                "Provider is not registered",
                            )
                        })
                    })
                    .collect(),
                Err(error) => Err(normalize_provider_error(error.as_ref())),
            }
        })
    }

    pub fn test_connection(
        &self,
        provider_id: String,
        aborted: bool,
    ) -> BoxFuture<Result<ProviderConnectionResult, ZeroError>> {
        let context = self.context(&provider_id, aborted);
        Box::pin(async move {
            let (adapter, context) = context?;
            match adapter.test_connection(&context).await {
                Ok(result) => Ok(result),
                Err(error) => Err(normalize_provider_error(error.as_ref())),
            }
        })
    }

    fn prepare(
        &self,
        raw: ModelRequest,
        aborted: bool,
    ) -> Result<
        (
            Arc<dyn ProviderAdapter>,
            ProviderInvocationContext,
            ModelRequest,
        ),
        ZeroError,
    > {
        let value = serde_json::to_value(&raw).unwrap();
        let request = parse_model_request(&value)
            .map_err(|_| failed(ZeroErrorCode::ValidationFailed, "invalid request"))?;
        let provider_id = request
            .model_ref
            .split_once(':')
            .map(|(left, _)| left)
            .unwrap_or("");
        let registered = self.providers.get(provider_id).ok_or_else(|| {
            failed(
                ZeroErrorCode::ModelUnavailable,
                "The selected model is not registered",
            )
        })?;
        let model = self.models.get(&request.model_ref).ok_or_else(|| {
            failed(
                ZeroErrorCode::ModelUnavailable,
                "The selected model is not registered",
            )
        })?;
        if !registered.config.enabled {
            return Err(failed(
                ZeroErrorCode::ModelUnavailable,
                "The selected provider is disabled",
            ));
        }
        let denied = request.data_classifications.iter().any(|classification| {
            !classification_allowed(
                match classification {
                    helm_protocol::DataClassification::Public => "public",
                    helm_protocol::DataClassification::Personal => "personal",
                    helm_protocol::DataClassification::Sensitive => "sensitive",
                    helm_protocol::DataClassification::Health => "health",
                    helm_protocol::DataClassification::Secret => "secret",
                },
                &registered.config,
                match model.privacy_class {
                    helm_protocol::PrivacyClass::Local => "local",
                    helm_protocol::PrivacyClass::Remote => "remote",
                },
            )
        });
        if denied {
            return Err(failed(
                ZeroErrorCode::PermissionDenied,
                "Provider privacy policy blocks this request",
            ));
        }
        assert_capabilities(&request, model)?;
        let (adapter, context) = self.context(provider_id, aborted)?;
        Ok((adapter, context, request))
    }

    fn context(
        &self,
        provider_id: &str,
        aborted: bool,
    ) -> Result<(Arc<dyn ProviderAdapter>, ProviderInvocationContext), ZeroError> {
        if aborted {
            return Err(failed(
                ZeroErrorCode::Cancelled,
                "Model request was cancelled",
            ));
        }
        let registered = self
            .providers
            .get(provider_id)
            .ok_or_else(|| failed(ZeroErrorCode::ModelUnavailable, "Provider is unavailable"))?;
        if !registered.config.enabled {
            return Err(failed(
                ZeroErrorCode::ModelUnavailable,
                "Provider is unavailable",
            ));
        }
        assert_secure_base_url(registered.config.base_url.as_deref())?;
        let credential = self
            .credentials
            .resolve(&registered.config.secret_ref)
            .ok_or_else(|| {
                failed(
                    ZeroErrorCode::AuthFailed,
                    "Provider credential is unavailable",
                )
            })?;
        Ok((
            Arc::clone(&registered.adapter),
            ProviderInvocationContext {
                provider_id: provider_id.to_string(),
                base_url: registered.config.base_url.clone(),
                credential,
                headers: Vec::new(),
                aborted,
            },
        ))
    }
}
