use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use helm_protocol::{ChatStreamEvent, ModelRecord, ModelRequest, ModelResponse};

use crate::error_mapping::ProviderHttpError;
use crate::http::{HttpRequest, HttpResponse};

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;
pub type GatewayFetch =
    Arc<dyn Fn(HttpRequest) -> BoxFuture<Result<HttpResponse, ProviderHttpError>> + Send + Sync>;

#[derive(Debug, Clone)]
pub struct ProviderInvocationContext {
    pub provider_id: String,
    pub base_url: Option<String>,
    pub credential: String,
    pub headers: Vec<(String, String)>,
    pub aborted: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProviderConnectionResult {
    pub ok: bool,
    pub latency_ms: i64,
}

pub trait CredentialResolver: Send + Sync {
    fn resolve(&self, secret_ref: &str) -> Option<String>;
}

pub trait ProviderAdapter: Send + Sync {
    fn protocol(&self) -> &'static str;
    fn invoke(
        &self,
        request: &ModelRequest,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ModelResponse, Box<dyn std::error::Error + Send + Sync>>>;
    fn stream(
        &self,
        request: &ModelRequest,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<Vec<ChatStreamEvent>, Box<dyn std::error::Error + Send + Sync>>>;
    fn discover_models(
        &self,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<Vec<ModelRecord>, Box<dyn std::error::Error + Send + Sync>>>;
    fn test_connection(
        &self,
        context: &ProviderInvocationContext,
    ) -> BoxFuture<Result<ProviderConnectionResult, Box<dyn std::error::Error + Send + Sync>>>;
}
