use std::sync::Arc;

use helm_db::{migrations, open_database, run_migrations, ZeroDatabase};
use helm_gateway::{GatewayFetch, ProviderHttpError};
use helm_observability::{create_logger, LogInput, Logger};
use helm_protocol::SystemHealthResponse;
use helm_shared::{create_correlation_id, utc_now, CorrelationId};
use helm_tools::{create_work_tool_registry, PermissionEngine};
use serde_json::json;

use crate::actions::{ActionRepository, ActionService};
use crate::board::BoardService;
use crate::chat::{ChatModelStreamer, ChatService};
use crate::helm::{HelmRepository, HelmService};
use crate::knowledge::KnowledgeService;
use crate::models::ModelService;
use crate::projects::ProjectService;
use crate::providers::ProviderService;
use crate::secrets::SecretStore;

pub struct CoreOptions {
    pub database_path: String,
    pub secret_store: Box<dyn SecretStore>,
    pub log_sink: Option<Box<dyn Fn(String) + 'static>>,
    pub model_gateway_fetch: Option<GatewayFetch>,
}

pub struct CoreRuntime {
    database: ZeroDatabase,
    logger: Logger,
    secret_store: Box<dyn SecretStore>,
    fetch: GatewayFetch,
    closed: bool,
}

fn default_fetch() -> GatewayFetch {
    Arc::new(|_req| Box::pin(async { Err(ProviderHttpError { status: 503 }) }))
}

pub fn bootstrap_core(options: CoreOptions) -> Result<CoreRuntime, helm_shared::ZeroError> {
    let logger = match options.log_sink {
        Some(sink) => create_logger(sink),
        None => create_logger(|_| {}),
    };
    let startup = create_correlation_id();
    let database = open_database(&options.database_path)?;
    let migration_result = run_migrations(&database, &migrations());
    logger.info(LogInput {
        event: "core.started",
        correlation_id: startup.as_str(),
        data: Some(json!({
            "schemaVersion": migration_result.current_version,
            "migrationsApplied": migration_result.applied,
        })),
    });
    Ok(CoreRuntime {
        database,
        logger,
        secret_store: options.secret_store,
        fetch: options.model_gateway_fetch.unwrap_or_else(default_fetch),
        closed: false,
    })
}

impl CoreRuntime {
    pub fn logger(&self) -> &Logger {
        &self.logger
    }

    pub fn health(&self, correlation_id: &CorrelationId) -> SystemHealthResponse {
        SystemHealthResponse {
            status: "ok".into(),
            database: "ready".into(),
            occurred_at: utc_now(),
            correlation_id: correlation_id.to_string(),
        }
    }

    pub fn database(&self) -> &ZeroDatabase {
        &self.database
    }

    pub fn providers(&self) -> ProviderService<'_> {
        ProviderService::new(&self.database, self.secret_store.as_ref(), &self.logger)
    }

    pub fn models(&self) -> ModelService<'_> {
        ModelService::new(
            &self.database,
            self.secret_store.as_ref(),
            &self.logger,
            self.fetch.clone(),
        )
    }

    pub fn chats<'a>(&'a self, models: &'a dyn ChatModelStreamer) -> ChatService<'a> {
        ChatService::new(&self.database, &self.logger, models)
    }

    pub fn knowledge<'a>(&'a self, models: &'a dyn ChatModelStreamer) -> KnowledgeService<'a> {
        KnowledgeService::from_database(&self.database, models, &self.logger, 1_000)
    }

    pub fn actions<'a>(&'a self, models: &'a dyn ChatModelStreamer) -> ActionService<'a> {
        ActionService::new(
            ActionRepository::new(&self.database),
            models,
            &self.logger,
            create_work_tool_registry(),
            PermissionEngine,
            None,
        )
    }

    pub fn projects(&self) -> ProjectService<'_> {
        ProjectService::from_database(&self.database, &self.logger)
    }

    pub fn board(&self) -> BoardService<'_> {
        BoardService::new(&self.database, &self.logger)
    }

    pub fn helm(&self) -> HelmService<'_> {
        HelmService::new(
            HelmRepository::new(&self.database),
            self.secret_store.as_ref(),
        )
    }

    pub fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.logger.info(LogInput {
            event: "core.stopped",
            correlation_id: create_correlation_id().as_str(),
            data: None,
        });
    }
}

impl Drop for CoreRuntime {
    fn drop(&mut self) {
        self.close();
    }
}
