export interface EmbeddingProvider {
  readonly id: string;
  embed(texts: readonly string[], signal: AbortSignal): Promise<readonly number[][]>;
}

export interface SemanticKnowledgeMatch {
  readonly chunkId: string;
  readonly score: number;
}

export interface SemanticKnowledgeIndex {
  index(
    chunks: readonly { readonly id: string; readonly text: string }[],
    provider: EmbeddingProvider,
    signal: AbortSignal,
  ): Promise<void>;
  search(
    query: string,
    provider: EmbeddingProvider,
    limit: number,
    signal: AbortSignal,
  ): Promise<readonly SemanticKnowledgeMatch[]>;
}
