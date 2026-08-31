import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type {
  KnowledgeAnswer,
  KnowledgeCitation,
  KnowledgeSourceView,
} from '@builderhelm/protocol/knowledge';
import { useEffect, useMemo, useRef, useState } from 'react';

const RECENTS_KEY = 'builderhelm.memory.recents';

function indexedLabel(value: string | null): string {
  if (value === null) return 'Not indexed';
  return `Indexed ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))}`;
}

function readRecentQueries(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string').slice(0, 6);
  } catch {
    return [];
  }
}

function rememberQuery(query: string): string[] {
  const next = [query, ...readRecentQueries().filter((item) => item !== query)].slice(
    0,
    6,
  );
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Recent prompts are optional; retrieval still works when storage is unavailable.
  }
  return next;
}

function MemoryGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <circle cx="7" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle
        cx="17"
        cy="7.5"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle
        cx="17"
        cy="16.5"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M9 12h6M15.2 8.8 9 11.3M15.2 15.2 9 12.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function SourceViewer({ source }: { readonly source: KnowledgeSourceView }) {
  const citedRef = useRef<HTMLSpanElement>(null);
  const lines = source.content.split('\n');
  useEffect(() => citedRef.current?.scrollIntoView({ block: 'center' }), [source]);
  return (
    <aside className="knowledgeSource" aria-label="Cited source">
      <div className="knowledgeSourceHeader">
        <div>
          <span className="memorySectionLabel">Source preview</span>
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

export function MemoryPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [vaultId, setVaultId] = useState('');
  const [modelRef, setModelRef] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [source, setSource] = useState<KnowledgeSourceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>(readRecentQueries);
  const vaults = useQuery({
    queryKey: ['knowledge-vaults'],
    queryFn: () => window.builderHelm.knowledge.listVaults({}),
  });
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => window.builderHelm.models.list({}),
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
    mutationFn: () => window.builderHelm.knowledge.selectVault(),
    onMutate: () => setError(null),
    onSuccess: async (vault) => {
      if (vault !== null) {
        setVaultId(vault.id);
        setAnswer(null);
        setSource(null);
      }
      await queryClient.invalidateQueries({ queryKey: ['knowledge-vaults'] });
    },
    onError: () => setError('The selected folder could not be registered as a vault.'),
  });
  const syncVault = useMutation({
    mutationFn: (selectedVaultId: string) =>
      window.builderHelm.knowledge.syncVault({ vaultId: selectedVaultId }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setAnswer(null);
      setSource(null);
      await queryClient.invalidateQueries({ queryKey: ['knowledge-vaults'] });
    },
    onError: () => setError('The vault could not be refreshed. Its prior index remains.'),
  });
  const ask = useMutation({
    mutationFn: (askedQuestion: string) =>
      window.builderHelm.knowledge.answer({
        vaultId,
        modelRef,
        query: askedQuestion,
        maxSources: 8,
      }),
    onMutate: () => {
      setError(null);
      setAnswer(null);
      setSource(null);
    },
    onSuccess: (next, askedQuestion) => {
      setAnswer(next);
      setRecentQueries(rememberQuery(askedQuestion));
    },
    onError: () =>
      setError(
        'BuilderHelm Memory could not produce a cited answer. Check the model, privacy policy, and vault index.',
      ),
  });
  const openCitation = useMutation({
    mutationFn: (citation: KnowledgeCitation) =>
      window.builderHelm.knowledge.getSource({
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
    <section
      className="memoryPage"
      aria-labelledby="memory-title"
      data-core-status="ready"
    >
      <header className="memoryHeader">
        <div className="memoryIdentity">
          <span className="memoryMark">
            <MemoryGlyph />
          </span>
          <div>
            <h1 id="memory-title">BuilderHelm Memory</h1>
            <p>Private, cited recall from your local Obsidian vault.</p>
          </div>
        </div>
        <button
          className="primaryButton"
          type="button"
          disabled={selectVault.isPending}
          onClick={() => selectVault.mutate()}
        >
          {selectVault.isPending ? 'Selecting…' : 'Add vault'}
        </button>
      </header>

      {error !== null && (
        <p className="errorBanner" role="alert">
          {error}
        </p>
      )}

      <div className="memoryWorkspace">
        <aside className="memoryNav" aria-label="Memory controls">
          <section className="memoryNavSection">
            <span className="memorySectionLabel">Vault</span>
            {vaults.isLoading ? (
              <p className="memoryStateCopy">Reading vault settings…</p>
            ) : vaults.data?.length === 0 ? (
              <div className="memoryStateCopy">
                <strong>No vault connected</strong>
                <p>Add an Obsidian folder to build a local, read-only index.</p>
              </div>
            ) : (
              <>
                <label className="memorySelect">
                  <span className="srOnly">Vault</span>
                  <select
                    value={vaultId}
                    onChange={(event) => {
                      setVaultId(event.target.value);
                      setAnswer(null);
                      setSource(null);
                    }}
                  >
                    {vaults.data?.map((vault) => (
                      <option value={vault.id} key={vault.id}>
                        {vault.name}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedVault !== undefined ? (
                  <div className="memoryVaultMeta">
                    <strong>{selectedVault.noteCount} notes</strong>
                    <span>{indexedLabel(selectedVault.lastIndexedAt)}</span>
                    <button
                      type="button"
                      disabled={syncVault.isPending}
                      onClick={() => syncVault.mutate(selectedVault.id)}
                    >
                      {syncVault.isPending ? 'Refreshing…' : 'Refresh index'}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="memoryNavSection">
            <span className="memorySectionLabel">Answer model</span>
            {usableModels.length === 0 ? (
              <div className="memoryStateCopy">
                <strong>No compatible model</strong>
                <p>
                  Connect a text-streaming model to answer from your vault. Add a provider
                  in Voice settings first.
                </p>
                <Link to="/settings/voice">Open Voice settings</Link>
              </div>
            ) : (
              <label className="memorySelect">
                <span className="srOnly">Answer model</span>
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
            )}
          </section>

          <section className="memoryNavSection memoryRecents">
            <span className="memorySectionLabel">Recent questions</span>
            {recentQueries.length === 0 ? (
              <p className="memoryStateCopy">
                Your cited questions will stay here on this Mac.
              </p>
            ) : (
              <ul>
                {recentQueries.map((query) => (
                  <li key={query}>
                    <button
                      type="button"
                      title={query}
                      onClick={() => setQuestion(query)}
                    >
                      {query}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <main className="memoryQuery" aria-labelledby="memory-query-title">
          <form
            className="memoryAsk"
            onSubmit={(event) => {
              event.preventDefault();
              if (canAsk) ask.mutate(question.trim());
            }}
          >
            <div className="memoryAskHeader">
              <div>
                <h2 id="memory-query-title">Ask Memory</h2>
                <p>Every answer must point back to exact vault lines.</p>
              </div>
              <span>Read-only</span>
            </div>
            <textarea
              id="memory-question"
              aria-label="Ask BuilderHelm Memory"
              value={question}
              maxLength={2_000}
              placeholder="Why did I choose architecture B for Project X?"
              disabled={ask.isPending}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <div className="memoryAskFooter">
              <span>{question.length}/2000</span>
              <button className="primaryButton" type="submit" disabled={!canAsk}>
                {ask.isPending ? 'Reading sources…' : 'Answer with citations'}
              </button>
            </div>
          </form>

          {answer === null ? (
            <div className="memoryWelcome">
              <MemoryGlyph />
              <h2>Recall with evidence</h2>
              <p>
                Ask about decisions, projects, research, or notes. BuilderHelm searches
                only the selected local vault and keeps every source inspectable.
              </p>
            </div>
          ) : (
            <article className="knowledgeAnswer" aria-live="polite">
              <span className="memorySectionLabel">Cited answer</span>
              <div className="answerCopy">{answer.answer}</div>
              <div className="citationList" aria-label="Answer sources">
                {answer.citations.map((citation, index) => (
                  <button
                    type="button"
                    className={
                      source?.chunkId === citation.chunkId ? 'citationActive' : undefined
                    }
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
        </main>

        {source === null ? (
          <aside className="knowledgeSource knowledgeSourceEmpty">
            <MemoryGlyph />
            <h2>Source preview</h2>
            <p>Select a citation to inspect its note and highlighted line range.</p>
          </aside>
        ) : (
          <SourceViewer source={source} />
        )}
      </div>
    </section>
  );
}
