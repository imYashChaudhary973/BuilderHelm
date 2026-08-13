import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  KnowledgeAnswer,
  KnowledgeCitation,
  KnowledgeSourceView,
} from '@zero/protocol/knowledge';
import { useEffect, useMemo, useRef, useState } from 'react';

function indexedLabel(value: string | null): string {
  if (value === null) return 'Not indexed';
  return `Indexed ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))}`;
}

function SourceViewer({ source }: { readonly source: KnowledgeSourceView }) {
  const citedRef = useRef<HTMLSpanElement>(null);
  const lines = source.content.split('\n');
  useEffect(() => citedRef.current?.scrollIntoView({ block: 'center' }), [source]);
  return (
    <aside className="knowledgeSource" aria-label="Cited source">
      <div className="knowledgeSourceHeader">
        <div>
          <p className="eyebrow">Source</p>
          <h2>{source.title}</h2>
          <p>{source.notePath}</p>
        </div>
        <span>
          Lines {source.lineStart}–{source.lineEnd}
        </span>
      </div>
      <pre className="sourceLines">
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const cited = lineNumber >= source.lineStart && lineNumber <= source.lineEnd;
          return (
            <span
              className={cited ? 'sourceLine sourceLineCited' : 'sourceLine'}
              data-line={lineNumber}
              key={lineNumber}
              ref={lineNumber === source.lineStart ? citedRef : undefined}
            >
              <span aria-hidden="true">{String(lineNumber).padStart(3, ' ')}</span>
              {line || ' '}
            </span>
          );
        })}
      </pre>
    </aside>
  );
}

export function KnowledgePage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [vaultId, setVaultId] = useState('');
  const [modelRef, setModelRef] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [source, setSource] = useState<KnowledgeSourceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vaults = useQuery({
    queryKey: ['knowledge-vaults'],
    queryFn: () => window.zero.knowledge.listVaults({}),
  });
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => window.zero.models.list({}),
  });
  const usableModels = useMemo(
    () =>
      (models.data ?? []).filter(
        (model) => model.capabilities.text && model.capabilities.streaming,
      ),
    [models.data],
  );

  useEffect(() => {
    if (vaultId.length === 0 && vaults.data?.[0] !== undefined) {
      setVaultId(vaults.data[0].id);
    }
  }, [vaultId, vaults.data]);
  useEffect(() => {
    if (modelRef.length === 0 && usableModels[0] !== undefined) {
      setModelRef(usableModels[0].ref);
    }
  }, [modelRef, usableModels]);

  const selectVault = useMutation({
    mutationFn: () => window.zero.knowledge.selectVault(),
    onMutate: () => setError(null),
    onSuccess: async (vault) => {
      if (vault !== null) setVaultId(vault.id);
      await queryClient.invalidateQueries({ queryKey: ['knowledge-vaults'] });
    },
    onError: () => setError('The selected folder could not be registered as a vault.'),
  });
  const syncVault = useMutation({
    mutationFn: (selectedVaultId: string) =>
      window.zero.knowledge.syncVault({ vaultId: selectedVaultId }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setAnswer(null);
      setSource(null);
      await queryClient.invalidateQueries({ queryKey: ['knowledge-vaults'] });
    },
    onError: () => setError('The vault could not be refreshed. Its prior index remains.'),
  });
  const ask = useMutation({
    mutationFn: () =>
      window.zero.knowledge.answer({
        vaultId,
        modelRef,
        query: question,
        maxSources: 8,
      }),
    onMutate: () => {
      setError(null);
      setAnswer(null);
      setSource(null);
    },
    onSuccess: setAnswer,
    onError: () =>
      setError(
        'Zero could not produce a cited answer. Check the model, privacy policy, and vault index.',
      ),
  });
  const openCitation = useMutation({
    mutationFn: (citation: KnowledgeCitation) =>
      window.zero.knowledge.getSource({
        sourceId: citation.sourceId,
        chunkId: citation.chunkId,
      }),
    onMutate: () => setError(null),
    onSuccess: setSource,
    onError: () =>
      setError('That note changed after the answer. Refresh the vault and ask again.'),
  });

  const selectedVault = vaults.data?.find((vault) => vault.id === vaultId);
  const canAsk =
    vaultId.length > 0 &&
    modelRef.length > 0 &&
    question.trim().length > 0 &&
    !ask.isPending;

  return (
    <>
      <header className="settingsHeader knowledgeHeader">
        <div>
          <p className="eyebrow">Private retrieval</p>
          <h1>Knowledge</h1>
          <p className="lede">Ask your Obsidian vault and inspect every source.</p>
        </div>
        <button
          className="primaryButton"
          type="button"
          disabled={selectVault.isPending}
          onClick={() => selectVault.mutate()}
        >
          {selectVault.isPending ? 'Selecting…' : 'Select vault'}
        </button>
      </header>
      {error !== null && (
        <p className="errorBanner" role="alert">
          {error}
        </p>
      )}
      <div className="knowledgeLayout">
        <section className="knowledgeQuery" aria-labelledby="knowledge-query-title">
          <div className="knowledgeControls">
            <label>
              <span>Vault</span>
              <select
                value={vaultId}
                onChange={(event) => setVaultId(event.target.value)}
              >
                {vaults.data?.map((vault) => (
                  <option value={vault.id} key={vault.id}>
                    {vault.name} · {vault.noteCount} notes
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Answer model</span>
              <select
                value={modelRef}
                onChange={(event) => setModelRef(event.target.value)}
              >
                {usableModels.map((model) => (
                  <option value={model.ref} key={model.ref}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedVault === undefined ? (
            <div className="emptyState">
              Select an Obsidian vault to build a local read-only index.
            </div>
          ) : (
            <div className="vaultStatus">
              <div>
                <strong>{selectedVault.name}</strong>
                <span>
                  {selectedVault.noteCount} notes ·{' '}
                  {indexedLabel(selectedVault.lastIndexedAt)}
                </span>
              </div>
              <button
                type="button"
                disabled={syncVault.isPending}
                onClick={() => syncVault.mutate(selectedVault.id)}
              >
                {syncVault.isPending ? 'Refreshing…' : 'Refresh index'}
              </button>
            </div>
          )}
          <form
            className="knowledgeAsk"
            onSubmit={(event) => {
              event.preventDefault();
              if (canAsk) ask.mutate();
            }}
          >
            <label htmlFor="knowledge-question" id="knowledge-query-title">
              Ask a question
            </label>
            <textarea
              id="knowledge-question"
              value={question}
              maxLength={2_000}
              placeholder="Why did I choose architecture B for Project X?"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button className="primaryButton" type="submit" disabled={!canAsk}>
              {ask.isPending ? 'Reading sources…' : 'Answer with citations'}
            </button>
          </form>
          {usableModels.length === 0 && (
            <p className="catalogError" role="alert">
              Discover a text-streaming model before asking the vault.
            </p>
          )}
          {answer !== null && (
            <article className="knowledgeAnswer" aria-live="polite">
              <p className="eyebrow">Answer</p>
              <div className="answerCopy">{answer.answer}</div>
              <div className="citationList" aria-label="Answer sources">
                {answer.citations.map((citation, index) => (
                  <button
                    type="button"
                    key={citation.chunkId}
                    onClick={() => openCitation.mutate(citation)}
                  >
                    <span>[S{index + 1}]</span>
                    <strong>{citation.title}</strong>
                    <small>
                      {citation.heading ?? citation.notePath} · lines {citation.lineStart}
                      –{citation.lineEnd}
                    </small>
                    <span>{citation.excerpt}</span>
                  </button>
                ))}
              </div>
            </article>
          )}
        </section>
        {source === null ? (
          <aside className="knowledgeSource knowledgeSourceEmpty">
            <p className="eyebrow">Source viewer</p>
            <h2>Click a citation</h2>
            <p>The exact note and cited line range will appear here.</p>
          </aside>
        ) : (
          <SourceViewer source={source} />
        )}
      </div>
    </>
  );
}
