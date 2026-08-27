mod knowledge_service;

pub use knowledge_service::{
    KnowledgeAnswer, KnowledgeService, KnowledgeSourceView, KnowledgeVault,
};

mod embedding_provider;
mod markdown_parser;
mod vault_filesystem;

pub use embedding_provider::{EmbeddingProvider, SemanticKnowledgeIndex, SemanticKnowledgeMatch};
pub use markdown_parser::{
    parse_markdown_document, parse_markdown_document_with, ParseMarkdownDocumentInput,
};
pub use vault_filesystem::{
    read_vault_markdown, read_vault_source, resolve_vault_root, vault_markdown_fingerprint,
    VaultMarkdownFile,
};
