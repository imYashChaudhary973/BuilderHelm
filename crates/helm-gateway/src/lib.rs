mod adapter;
mod anthropic_adapter;
mod error_mapping;
mod http;
mod model_gateway;
mod ollama_adapter;
mod openai_chat_adapter;
mod openai_responses_adapter;

pub use adapter::{
    BoxFuture, CredentialResolver, GatewayFetch, ProviderAdapter, ProviderConnectionResult,
    ProviderInvocationContext,
};
pub use anthropic_adapter::AnthropicMessagesAdapter;
pub use error_mapping::{normalize_provider_error, NamedError, ProviderHttpError};
pub use http::{header, HttpRequest, HttpResponse};
pub use model_gateway::{GatewayProviderConfig, ModelGateway};
pub use ollama_adapter::OllamaAdapter;
pub use openai_chat_adapter::OpenAIChatCompletionsAdapter;
pub use openai_responses_adapter::OpenAIResponsesAdapter;
