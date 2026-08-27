use helm_shared::ZeroError;

pub trait EmbeddingProvider {
    fn id(&self) -> &str;
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f64>>, ZeroError>;
}

pub struct SemanticKnowledgeMatch {
    pub chunk_id: String,
    pub score: f64,
}

pub trait SemanticKnowledgeIndex {
    fn index(
        &self,
        chunks: &[(String, String)],
        provider: &dyn EmbeddingProvider,
    ) -> Result<(), ZeroError>;
    fn search(
        &self,
        query: &str,
        provider: &dyn EmbeddingProvider,
        limit: usize,
    ) -> Result<Vec<SemanticKnowledgeMatch>, ZeroError>;
}
