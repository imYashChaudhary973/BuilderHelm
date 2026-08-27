mod error_convert;

mod sha256;

pub mod actions;
pub mod board;
pub mod bootstrap;
pub mod chat;
pub mod helm;
pub mod knowledge;
pub mod models;
pub mod projects;
pub mod providers;
pub mod secrets;

pub use actions::{
    normalize_work_name, parse_deterministic_action, ActionCommandInput, ActionCommandOutcome,
    ActionRepository, ActionService, ParsedActionIntent, PermissionPolicyUpdateInput,
};
pub use board::BoardService;
pub use bootstrap::{bootstrap_core, CoreOptions, CoreRuntime};
pub use chat::ChatService;
pub use helm::HelmService;
pub use knowledge::{
    parse_markdown_document, read_vault_markdown, read_vault_source, resolve_vault_root,
    vault_markdown_fingerprint, EmbeddingProvider, KnowledgeService, SemanticKnowledgeIndex,
    SemanticKnowledgeMatch, VaultMarkdownFile,
};
pub use models::ModelService;
pub use projects::{GitInspector, GitSnapshot, LocalGitInspector, ProjectService};
pub use providers::ProviderService;
pub use secrets::{KeychainSecretStore, MemorySecretStore, SecretStore, ZERO_KEYCHAIN_SERVICE};
pub use sha256::sha256;
