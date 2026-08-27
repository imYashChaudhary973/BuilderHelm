use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use helm_db::{
    AuditEventWrite, ModelCapabilitiesWrite, ModelCapabilityBaseline, ModelRepository, ModelWrite,
    ProviderRepository, SetCapabilityOverride, StoredModel, StoredModelCapabilityOverride,
    StoredProvider, ZeroDatabase,
};
use helm_gateway::{
    AnthropicMessagesAdapter, CredentialResolver, GatewayFetch, GatewayProviderConfig,
    ModelGateway, OllamaAdapter, OpenAIChatCompletionsAdapter, OpenAIResponsesAdapter,
    ProviderAdapter, ProviderConnectionResult,
};
use helm_observability::{LogInput, Logger};
use helm_protocol::{
    parse_model_capability_overrides, parse_model_record, parse_model_request, ChatStreamEvent,
    ModelCapabilities, ModelCapabilityOverrideRecord, ModelCapabilityOverrides, ModelRecord,
    ModelRequest, PrivacyClass,
};
use helm_shared::{create_correlation_id, utc_now, ZeroError, ZeroErrorCode};
use serde_json::{json, Value};

use crate::chat::ChatModelStreamer;
use crate::error_convert::{failed, parse_failed};
use crate::secrets::SecretStore;

struct StoreResolver {
    ptr: *const (dyn SecretStore + 'static),
}

unsafe impl Send for StoreResolver {}
unsafe impl Sync for StoreResolver {}

impl CredentialResolver for StoreResolver {
    fn resolve(&self, secret_ref: &str) -> Option<String> {
        unsafe { (*self.ptr).get(secret_ref).ok().flatten() }
    }
}

pub struct ModelService<'a> {
    database: &'a ZeroDatabase,
    logger: &'a Logger,
    fetch: GatewayFetch,
    gateway: RefCell<ModelGateway>,
}

fn stored_model_to_record(model: &StoredModel) -> Result<ModelRecord, ZeroError> {
    let metadata: Value = serde_json::from_str(&model.metadata_json).unwrap_or(json!({}));
    let tags = metadata.get("tags").cloned().unwrap_or_else(|| json!([]));
    let mut capabilities = json!({
        "text": model.text == 1,
        "vision": model.vision == 1,
        "audioInput": model.audio_input == 1,
        "toolCalling": model.tool_calling == 1,
        "parallelTools": model.parallel_tools == 1,
        "structuredOutput": model.structured_output == 1,
        "streaming": model.streaming == 1,
        "reasoningControls": model.reasoning_controls == 1,
        "serverWebSearch": model.server_web_search == 1,
        "serverMcp": model.server_mcp == 1,
    });
    if let Some(window) = model.context_window {
        capabilities["contextWindow"] = json!(window);
    }
    if let Some(tokens) = model.max_output_tokens {
        capabilities["maxOutputTokens"] = json!(tokens);
    }
    parse_model_record(&json!({
        "ref": model.id,
        "providerId": model.provider_id,
        "modelId": model.model_id,
        "label": model.label,
        "capabilities": capabilities,
        "privacyClass": model.privacy_class,
        "tags": tags,
    }))
    .map_err(parse_failed)
}

fn privacy_name(privacy: PrivacyClass) -> String {
    serde_json::to_value(privacy)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| "remote".into())
}

fn model_write(model: &ModelRecord, occurred_at: &str) -> ModelWrite {
    let caps = &model.capabilities;
    ModelWrite {
        id: model.model_ref.clone(),
        provider_id: model.provider_id.clone(),
        model_id: model.model_id.clone(),
        label: model.label.clone(),
        privacy_class: privacy_name(model.privacy_class),
        enabled: true,
        created_at: occurred_at.to_string(),
        updated_at: occurred_at.to_string(),
        capabilities: ModelCapabilitiesWrite {
            text: caps.text,
            vision: caps.vision,
            audio_input: caps.audio_input,
            tool_calling: caps.tool_calling,
            parallel_tools: caps.parallel_tools,
            structured_output: caps.structured_output,
            streaming: caps.streaming,
            reasoning_controls: caps.reasoning_controls,
            server_web_search: caps.server_web_search,
            server_mcp: caps.server_mcp,
            context_window: caps.context_window,
            max_output_tokens: caps.max_output_tokens,
            metadata_json: json!({ "tags": model.tags }).to_string(),
        },
    }
}

fn assert_unique_models(models: &[ModelRecord]) -> Result<(), ZeroError> {
    let mut refs = HashSet::new();
    for model in models {
        if !refs.insert(model.model_ref.clone()) {
            return Err(failed(
                ZeroErrorCode::ValidationFailed,
                "Provider returned duplicate model identifiers",
            ));
        }
    }
    Ok(())
}

fn apply_capability_overrides(
    base: &ModelCapabilities,
    overrides: &ModelCapabilityOverrides,
) -> ModelCapabilities {
    ModelCapabilities {
        text: overrides.text.unwrap_or(base.text),
        vision: overrides.vision.unwrap_or(base.vision),
        audio_input: overrides.audio_input.unwrap_or(base.audio_input),
        tool_calling: overrides.tool_calling.unwrap_or(base.tool_calling),
        parallel_tools: overrides.parallel_tools.unwrap_or(base.parallel_tools),
        structured_output: overrides
            .structured_output
            .unwrap_or(base.structured_output),
        streaming: overrides.streaming.unwrap_or(base.streaming),
        reasoning_controls: overrides
            .reasoning_controls
            .unwrap_or(base.reasoning_controls),
        server_web_search: overrides
            .server_web_search
            .unwrap_or(base.server_web_search),
        server_mcp: overrides.server_mcp.unwrap_or(base.server_mcp),
        context_window: overrides.context_window.or(base.context_window),
        max_output_tokens: overrides.max_output_tokens.or(base.max_output_tokens),
    }
}

fn overrides_empty(overrides: &ModelCapabilityOverrides) -> bool {
    serde_json::to_value(overrides)
        .ok()
        .and_then(|value| value.as_object().map(|object| object.is_empty()))
        .unwrap_or(false)
}

fn override_record(
    provider_id: &str,
    stored: &StoredModelCapabilityOverride,
) -> Result<ModelCapabilityOverrideRecord, ZeroError> {
    let parsed: Value = serde_json::from_str(&stored.overrides_json)
        .map_err(|err| parse_failed(helm_protocol::ParseError(err.to_string())))?;
    Ok(ModelCapabilityOverrideRecord {
        model_ref: format!("{}:{}", provider_id, stored.model_id),
        overrides: parse_model_capability_overrides(&parsed).map_err(parse_failed)?,
        updated_at: stored.updated_at.clone(),
    })
}

fn missing_provider() -> ZeroError {
    failed(ZeroErrorCode::ValidationFailed, "Provider was not found")
}

impl<'a> ModelService<'a> {
    pub fn new(
        database: &'a ZeroDatabase,
        secrets: &'a dyn SecretStore,
        logger: &'a Logger,
        fetcher: GatewayFetch,
    ) -> Self {
        Self {
            database,
            logger,
            fetch: fetcher,
            gateway: RefCell::new(ModelGateway::new(Arc::new(StoreResolver {
                ptr: unsafe {
                    std::mem::transmute::<*const dyn SecretStore, *const (dyn SecretStore + 'static)>(
                        secrets as *const dyn SecretStore,
                    )
                },
            }))),
        }
    }

    fn models(&self) -> ModelRepository<'a> {
        ModelRepository::new(self.database)
    }

    fn providers(&self) -> ProviderRepository<'a> {
        ProviderRepository::new(self.database)
    }

    pub fn list(&self, provider_id: Option<&str>) -> Result<Vec<ModelRecord>, ZeroError> {
        self.models()
            .list(provider_id)
            .iter()
            .map(stored_model_to_record)
            .collect()
    }

    pub fn list_capability_overrides(
        &self,
        provider_id: Option<&str>,
    ) -> Result<Vec<ModelCapabilityOverrideRecord>, ZeroError> {
        self.models()
            .list_capability_overrides(provider_id)
            .iter()
            .map(|stored| override_record(&stored.provider_id, stored))
            .collect()
    }

    pub fn update_capability_override(
        &self,
        model_ref: &str,
        raw_overrides: &Value,
        correlation_id: &str,
    ) -> Result<ModelRecord, ZeroError> {
        let overrides = parse_model_capability_overrides(raw_overrides).map_err(parse_failed)?;
        let model = self
            .list(None)?
            .into_iter()
            .find(|candidate| candidate.model_ref == model_ref)
            .ok_or_else(|| {
                failed(
                    ZeroErrorCode::ModelUnavailable,
                    "The selected model is not stored",
                )
            })?;
        let stored_override = self
            .models()
            .list_capability_overrides(Some(&model.provider_id))
            .into_iter()
            .find(|candidate| candidate.model_id == model.model_id);
        let base = match &stored_override {
            None => model.capabilities.clone(),
            Some(stored) => serde_json::from_str(&stored.base_capabilities_json)
                .map_err(|err| parse_failed(helm_protocol::ParseError(err.to_string())))?,
        };
        let clearing = overrides_empty(&overrides);
        let empty = ModelCapabilityOverrides::default();
        let effective =
            apply_capability_overrides(&base, if clearing { &empty } else { &overrides });
        let updated_at = utc_now();
        let updated_model = parse_model_record(&json!({
            "ref": model.model_ref,
            "providerId": model.provider_id,
            "modelId": model.model_id,
            "label": model.label,
            "capabilities": effective,
            "privacyClass": model.privacy_class,
            "tags": model.tags,
        }))
        .map_err(parse_failed)?;
        let before = stored_override
            .as_ref()
            .map(|stored| stored.overrides_json.clone());
        let write = model_write(&updated_model, &updated_at);
        let overrides_json = if clearing {
            None
        } else {
            Some(serde_json::to_string(&overrides).unwrap())
        };
        let base_json = serde_json::to_string(&base).unwrap();
        let after_json = if clearing {
            None
        } else {
            Some(serde_json::to_string(&overrides).unwrap())
        };
        let audit = AuditEventWrite {
            id: create_correlation_id().to_string(),
            event_type: if clearing {
                "model.capability_override_cleared".into()
            } else {
                "model.capability_override_updated".into()
            },
            actor_type: "user".into(),
            actor_id: None,
            correlation_id: correlation_id.to_string(),
            risk_level: "medium".into(),
            resource_refs_json: json!([model.model_ref]).to_string(),
            before_json: before,
            after_json,
            approval_id: None,
            created_at: updated_at.clone(),
        };
        self.models()
            .set_capability_override(SetCapabilityOverride {
                provider_id: &model.provider_id,
                model_id: &model.model_id,
                overrides_json: overrides_json.as_deref(),
                base_capabilities_json: &base_json,
                effective: &write.capabilities,
                updated_at: &updated_at,
                audit: &audit,
            });
        self.logger.info(LogInput {
            event: if clearing {
                "model.capability_override_cleared"
            } else {
                "model.capability_override_updated"
            },
            correlation_id,
            data: Some(json!({ "modelRef": model_ref })),
        });
        Ok(updated_model)
    }

    pub async fn test_connection(
        &self,
        provider_id: &str,
        correlation_id: &str,
    ) -> Result<ProviderConnectionResult, ZeroError> {
        self.register(provider_id)?;
        let fut = self
            .gateway
            .borrow()
            .test_connection(provider_id.to_string(), false);
        match fut.await {
            Ok(result) => {
                self.logger.info(LogInput {
                    event: "provider.connection_tested",
                    correlation_id,
                    data: Some(
                        json!({ "providerId": provider_id, "latencyMs": result.latency_ms }),
                    ),
                });
                Ok(result)
            }
            Err(error) => {
                self.logger.warn(LogInput {
                    event: "provider.connection_failed",
                    correlation_id,
                    data: Some(json!({ "providerId": provider_id, "code": error.code.as_str() })),
                });
                Err(error)
            }
        }
    }

    pub async fn discover(
        &self,
        provider_id: &str,
        correlation_id: &str,
    ) -> Result<Vec<ModelRecord>, ZeroError> {
        self.register(provider_id)?;
        let fut = self
            .gateway
            .borrow()
            .discover_models(provider_id.to_string(), false);
        let discovered = match fut.await {
            Ok(models) => models,
            Err(error) => {
                self.logger.warn(LogInput {
                    event: "provider.discovery_failed",
                    correlation_id,
                    data: Some(json!({ "providerId": provider_id, "code": error.code.as_str() })),
                });
                return Err(error);
            }
        };
        if let Err(error) = assert_unique_models(&discovered) {
            self.logger.warn(LogInput {
                event: "provider.discovery_failed",
                correlation_id,
                data: Some(json!({ "providerId": provider_id, "code": error.code.as_str() })),
            });
            return Err(error);
        }
        let stored_overrides = self.models().list_capability_overrides(Some(provider_id));
        let mut overrides_by_model = HashMap::new();
        for stored in &stored_overrides {
            let parsed: Value = serde_json::from_str(&stored.overrides_json)
                .map_err(|err| parse_failed(helm_protocol::ParseError(err.to_string())))?;
            overrides_by_model.insert(
                stored.model_id.clone(),
                parse_model_capability_overrides(&parsed).map_err(parse_failed)?,
            );
        }
        let effective_models: Vec<ModelRecord> = discovered
            .iter()
            .map(|model| match overrides_by_model.get(&model.model_id) {
                None => Ok(model.clone()),
                Some(overrides) => {
                    let mut value = serde_json::to_value(model).unwrap();
                    value["capabilities"] = serde_json::to_value(apply_capability_overrides(
                        &model.capabilities,
                        overrides,
                    ))
                    .unwrap();
                    parse_model_record(&value).map_err(parse_failed)
                }
            })
            .collect::<Result<_, _>>()?;
        let occurred_at = utc_now();
        let writes: Vec<ModelWrite> = effective_models
            .iter()
            .map(|model| model_write(model, &occurred_at))
            .collect();
        let baselines: Vec<ModelCapabilityBaseline> = discovered
            .iter()
            .filter(|model| overrides_by_model.contains_key(&model.model_id))
            .map(|model| ModelCapabilityBaseline {
                model_id: model.model_id.clone(),
                capabilities_json: serde_json::to_string(&model.capabilities).unwrap(),
            })
            .collect();
        self.models()
            .replace_for_provider(provider_id, &writes, &baselines);
        self.logger.info(LogInput {
            event: "provider.models_discovered",
            correlation_id,
            data: Some(json!({ "providerId": provider_id, "modelCount": discovered.len() })),
        });
        Ok(effective_models)
    }

    fn register(&self, provider_id: &str) -> Result<(), ZeroError> {
        let provider = self
            .providers()
            .find_by_id(provider_id)
            .ok_or_else(missing_provider)?;
        let adapter = self.adapter(&provider)?;
        let config = self.gateway_config(&provider)?;
        self.gateway.borrow_mut().register_provider(config, adapter);
        Ok(())
    }

    fn gateway_config(
        &self,
        provider: &StoredProvider,
    ) -> Result<GatewayProviderConfig, ZeroError> {
        Ok(GatewayProviderConfig {
            id: provider.id.clone(),
            protocol: provider.protocol.clone(),
            base_url: provider.base_url.clone(),
            secret_ref: provider.secret_ref.clone(),
            privacy_allow_personal: provider.allow_personal == 1,
            privacy_allow_sensitive: provider.allow_sensitive == 1,
            privacy_allow_health: provider.allow_health == 1,
            enabled: provider.enabled == 1,
        })
    }

    fn adapter(&self, provider: &StoredProvider) -> Result<Arc<dyn ProviderAdapter>, ZeroError> {
        let fetch = Arc::clone(&self.fetch);
        match provider.protocol.as_str() {
            "openai" => Ok(Arc::new(OpenAIResponsesAdapter::new(fetch))),
            "anthropic" => Ok(Arc::new(AnthropicMessagesAdapter::new(fetch))),
            "openai-compatible" => {
                if provider.base_url.is_none() {
                    return Err(failed(
                        ZeroErrorCode::ValidationFailed,
                        "OpenAI-compatible providers require an explicit base URL",
                    ));
                }
                Ok(Arc::new(OpenAIChatCompletionsAdapter::new(fetch)))
            }
            "ollama" => Ok(Arc::new(OllamaAdapter::new(fetch))),
            _ => Err(failed(
                ZeroErrorCode::ModelUnavailable,
                "This provider protocol is not available in the current phase",
            )),
        }
    }
}

impl ChatModelStreamer for ModelService<'_> {
    fn stream<'a>(
        &'a self,
        raw_request: ModelRequest,
        correlation_id: &'a str,
        aborted: bool,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<ChatStreamEvent>, ZeroError>> + 'a>> {
        Box::pin(async move {
            let value = serde_json::to_value(&raw_request).unwrap();
            let request = parse_model_request(&value).map_err(parse_failed)?;
            let provider_id = request
                .model_ref
                .split_once(':')
                .map(|(left, _)| left)
                .unwrap_or("")
                .to_string();
            self.register(&provider_id)?;
            let models = self.list(Some(&provider_id))?;
            self.gateway
                .borrow_mut()
                .replace_models(&provider_id, models);
            self.logger.info(LogInput {
                event: "model.stream_started",
                correlation_id,
                data: Some(json!({ "providerId": provider_id, "modelRef": request.model_ref })),
            });
            let fut = self.gateway.borrow().stream(request.clone(), aborted);
            match fut.await {
                Ok(events) => Ok(events),
                Err(error) => {
                    self.logger.warn(LogInput {
                        event: "model.stream_failed",
                        correlation_id,
                        data: Some(json!({
                            "providerId": provider_id,
                            "modelRef": request.model_ref,
                            "code": error.code.as_str(),
                        })),
                    });
                    Err(error)
                }
            }
        })
    }
}
