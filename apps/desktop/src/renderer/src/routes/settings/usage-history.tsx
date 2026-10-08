import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  UsageRange,
  UsageRow,
  UsageReport,
  UsageSourceStatus,
} from '@builderhelm/protocol/usage';
import { PricingEditor } from './usage-pricing.js';

export function usd(value: number | null): string {
  if (value === null) return '—';
  if (value > 0 && value < 0.01) return '<$0.01';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}
const count = (value: number): string => new Intl.NumberFormat('en-US').format(value);
const stamp = (value: string | null): string =>
  value === null ? 'Never' : new Date(value).toLocaleString();
const PAGE_SIZE = 20;

function Breakdown({
  title,
  rows,
  view,
}: {
  readonly title: string;
  readonly rows: readonly UsageRow[];
  readonly view: 'cost' | 'tokens';
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const current = Math.min(page, lastPage);
  return (
    <section className="usageProviderCard usageBreakdown" aria-label={title}>
      <h2>{title}</h2>
      <div className="usageTableScroll">
        <table className="usageTable">
          <thead>
            <tr>
              <th scope="col">{title}</th>
              {view === 'tokens' ? (
                <>
                  <th scope="col">Uncached input</th>
                  <th scope="col">Cache read</th>
                  <th scope="col">Cache write</th>
                  <th scope="col">Output</th>
                  <th scope="col">Reasoning (of output)</th>
                  <th scope="col">Total tokens</th>
                </>
              ) : (
                <>
                  <th scope="col">Estimated API-equivalent cost</th>
                  <th scope="col">Provider-reported / Other</th>
                  <th scope="col">Pricing</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={view === 'tokens' ? 7 : 4}>
                  No measured usage in this period.
                </td>
              </tr>
            ) : (
              rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    <strong>{row.label}</strong>
                    <small>{row.detail}</small>
                    {'rateSource' in row && row.rateSource != null ? (
                      <small>
                        {(row as UsageReport['byModel'][number]).rateSource?.label} ·{' '}
                        {(row as UsageReport['byModel'][number]).rateSource?.asOf}
                      </small>
                    ) : null}
                    {'pricingNote' in row ? (
                      <small>{(row as UsageReport['byModel'][number]).pricingNote}</small>
                    ) : null}
                    {row.tokens.incompleteRecords > 0 ? (
                      <small>
                        Partial token source · {count(row.tokens.incompleteRecords)}{' '}
                        records
                      </small>
                    ) : null}
                  </th>
                  {view === 'tokens' ? (
                    <>
                      <td>{count(row.tokens.uncachedInput)}</td>
                      <td>{count(row.tokens.cacheRead)}</td>
                      <td>{count(row.tokens.cacheWrite)}</td>
                      <td>{count(row.tokens.output)}</td>
                      <td>{count(row.tokens.reasoning)}</td>
                      <td>{count(row.tokens.total)}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        {row.pricing === 'unpriced'
                          ? 'Unpriced'
                          : usd(row.cost.estimatedUsd)}
                      </td>
                      <td>{usd(row.cost.reportedUsd)}</td>
                      <td>
                        {row.pricing}
                        {row.cost.unpricedTokens > 0 ? (
                          <small>{count(row.cost.unpricedTokens)} unpriced tokens</small>
                        ) : null}
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {lastPage > 0 ? (
        <div className="usagePager">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous
          </button>
          <span>
            {current + 1} / {lastPage + 1}
          </span>
          <button
            type="button"
            disabled={current === lastPage}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Sources({
  sources,
}: {
  readonly sources: readonly UsageSourceStatus[];
}): React.JSX.Element {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(sources.length / PAGE_SIZE) - 1);
  const current = Math.min(page, last);
  return (
    <details className="usageProviderCard usageSources">
      <summary>Data sources · {sources.length}</summary>
      <p>
        Only provider-reported records are counted. Missing or failed sources can leave
        gaps in totals.
      </p>
      <ul>
        {sources.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map((source) => (
          <li key={source.id}>
            <strong>
              {source.accountLabel ?? source.provider} · {source.state}
            </strong>
            <small>
              {source.kind} · {count(source.records)} records · checked{' '}
              {stamp(source.lastScanAt)}
            </small>
            {source.location !== null ? <small>{source.location}</small> : null}
            {source.message !== null ? <small>{source.message}</small> : null}
            {source.skipped > 0 ? (
              <small>{count(source.skipped)} unreadable records skipped</small>
            ) : null}
          </li>
        ))}
      </ul>
      {last > 0 ? (
        <div className="usagePager">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous sources
          </button>
          <span>
            {current + 1} / {last + 1}
          </span>
          <button
            type="button"
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            Next sources
          </button>
        </div>
      ) : null}
    </details>
  );
}

export function UsageHistory({
  view,
}: {
  readonly view: 'cost' | 'tokens';
}): React.JSX.Element {
  const [range, setRange] = useState<UsageRange>('30d');
  const [environment, setEnvironment] = useState<string | null>(null);
  const report = useQuery({
    queryKey: ['usage-report', range, environment],
    queryFn: () => window.builderHelm.usage.report({ range, environment }),
    refetchInterval: 30_000,
  });
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  async function refresh(): Promise<void> {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await window.builderHelm.usage.report({ range, environment, rescan: true });
      await report.refetch();
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : 'Usage could not be refreshed.',
      );
    } finally {
      setRefreshing(false);
    }
  }
  const data = report.data;
  const costs = data?.totals.cost;
  return (
    <section className="usagePage" aria-label={view === 'cost' ? 'Cost' : 'Tokens'}>
      <header className="usagePageHead">
        <div className="usagePageTitle">
          <h1>{view === 'cost' ? 'Cost' : 'Tokens'}</h1>
          <p>
            {view === 'cost'
              ? 'Estimated API-equivalent cost of measured usage. Your subscription bill is separate. Provider-reported amounts are shown as Other.'
              : 'Measured input, cache, and output tokens. Reasoning is part of output and is counted once.'}
          </p>
        </div>
        <div className="usagePageActions">
          <label>
            Period
            <select
              aria-label="Usage period"
              value={range}
              onChange={(event) => setRange(event.target.value as UsageRange)}
            >
              <option value="today">Today</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
              <option value="all">All time</option>
            </select>
          </label>
          <label>
            Environment
            <select
              aria-label="Usage environment"
              value={environment ?? ''}
              onChange={(event) => setEnvironment(event.target.value || null)}
            >
              <option value="">All environments</option>
              {data?.environments.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="usageRefresh"
            disabled={refreshing || report.isFetching}
            onClick={() => void refresh()}
          >
            {refreshing || report.isFetching ? 'Refreshing…' : 'Refresh usage'}
          </button>
        </div>
      </header>
      {report.error !== null || refreshError !== null ? (
        <p className="wizardError" role="alert">
          {refreshError ?? report.error?.message}
        </p>
      ) : null}
      {data?.scan.error != null ? (
        <p className="wizardError" role="status">
          {data.scan.error}
        </p>
      ) : null}
      {data === undefined ? (
        <p role="status">
          {report.isPending ? 'Reading usage history…' : 'Usage unavailable.'}
        </p>
      ) : (
        <>
          <p className="usagePageState">
            Last scan {stamp(data.scan.lastScanAt)} · {count(data.totals.tokens.records)}{' '}
            usage records · {count(data.totals.tokens.incompleteRecords)} partial records
            {' · '}
            {data.sources.filter((source) => source.state !== 'ok').length} sources with
            gaps
          </p>
          <div className="usageMetrics">
            {view === 'cost' ? (
              <>
                <div>
                  <small>Estimated API-equivalent cost</small>
                  <strong>
                    {data.totals.pricing === 'unpriced'
                      ? 'Unpriced'
                      : usd(costs?.estimatedUsd ?? null)}
                  </strong>
                </div>
                <div>
                  <small>Provider-reported / Other</small>
                  <strong>{usd(costs?.reportedUsd ?? null)}</strong>
                </div>
                <div>
                  <small>Estimated API-equivalent cache savings</small>
                  <strong>{usd(costs?.cacheSavingsUsd ?? null)}</strong>
                </div>
                <div>
                  <small>Unpriced tokens</small>
                  <strong>{count(costs?.unpricedTokens ?? 0)}</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <small>Total tokens</small>
                  <strong>{count(data.totals.tokens.total)}</strong>
                </div>
                <div>
                  <small>Uncached input</small>
                  <strong>{count(data.totals.tokens.uncachedInput)}</strong>
                </div>
                <div>
                  <small>Cache read + write</small>
                  <strong>
                    {count(data.totals.tokens.cacheRead + data.totals.tokens.cacheWrite)}
                  </strong>
                </div>
                <div>
                  <small>Output (includes reasoning)</small>
                  <strong>{count(data.totals.tokens.output)}</strong>
                </div>
              </>
            )}
          </div>
          {view === 'cost' ? (
            <>
              <p className="usagePageState">
                Estimated API-equivalent cost by token category · priced records only
              </p>
              <div className="usageMetrics">
                {(['input', 'cacheRead', 'cacheWrite', 'output'] as const).map(
                  (category) => (
                    <div key={category}>
                      <small>
                        {
                          {
                            input: 'Uncached input',
                            cacheRead: 'Cache read',
                            cacheWrite: 'Cache write',
                            output: 'Output',
                          }[category]
                        }
                      </small>
                      <strong>{usd(costs?.categories?.[category] ?? null)}</strong>
                    </div>
                  ),
                )}
              </div>
              {(costs?.unpricedTokens ?? 0) > 0 ? (
                <p className="usagePageState">
                  The estimate excludes unpriced records. Add an override or alias to
                  price them.
                </p>
              ) : null}
            </>
          ) : null}
          <div className="usageProviderList">
            <Breakdown title="Providers" rows={data.byProvider} view={view} />
            <Breakdown title="Accounts" rows={data.byAccount} view={view} />
          </div>
          <Breakdown title="Models" rows={data.byModel} view={view} />
          <Breakdown title="Days" rows={data.byDay} view={view} />
          <Breakdown
            title="Sessions (top 50 by tokens)"
            rows={data.bySession}
            view={view}
          />
          <Sources sources={data.sources} />
        </>
      )}
      {view === 'cost' ? <PricingEditor /> : null}
    </section>
  );
}
