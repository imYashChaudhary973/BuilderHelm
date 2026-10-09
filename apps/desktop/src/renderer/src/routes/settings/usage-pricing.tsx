import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PricingUpdateInput, RateSet } from '@builderhelm/protocol/usage';

const CATEGORIES = [
  'input',
  'cacheRead',
  'cacheWrite',
  'cacheWrite1h',
  'output',
] as const;
const LABELS = {
  input: 'Uncached input',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  cacheWrite1h: '1h cache write',
  output: 'Output',
};
const blank = (): Record<(typeof CATEGORIES)[number], string> => ({
  input: '',
  cacheRead: '',
  cacheWrite: '',
  cacheWrite1h: '',
  output: '',
});
function rates(values: ReturnType<typeof blank>): RateSet {
  const result = {} as RateSet;
  for (const category of CATEGORIES) {
    const raw = values[category].trim();
    if (category === 'cacheWrite1h' && raw === '') {
      result[category] = null;
      continue;
    }
    if (raw === '' || !Number.isFinite(Number(raw)) || Number(raw) < 0)
      throw new Error('Enter a nonnegative USD rate for every token category.');
    result[category] = Number(raw);
  }
  return result;
}

export function PricingEditor(): React.JSX.Element {
  const client = useQueryClient();
  const prices = useQuery({
    queryKey: ['usage-pricing'],
    queryFn: () => window.builderHelm.usage.pricing(),
  });
  const mutation = useMutation({
    mutationFn: (input: PricingUpdateInput) =>
      window.builderHelm.usage.updatePricing(input),
    onSuccess: async (next) => {
      client.setQueryData(['usage-pricing'], next);
      await client.invalidateQueries({ queryKey: ['usage-report'] });
    },
  });
  const [model, setModel] = useState('');
  const [standard, setStandard] = useState(blank);
  const [fast, setFast] = useState(blank);
  const [fastEnabled, setFastEnabled] = useState(false);
  const [alias, setAlias] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  function saveOverride(): void {
    setError(null);
    try {
      mutation.mutate({
        action: 'set-override',
        model: model.trim(),
        standard: rates(standard),
        fast: fastEnabled ? rates(fast) : null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid price.');
    }
  }
  return (
    <details className="usageProviderCard usagePricing">
      <summary>Prices and model aliases</summary>
      <p>
        USD per million tokens. Overrides recalculate historical estimates. Bundled rates:{' '}
        {prices.data?.bundledAsOf ?? '—'}. Last price refresh:{' '}
        {prices.data?.refreshedAt == null
          ? 'Never'
          : new Date(prices.data.refreshedAt).toLocaleString()}
        .
      </p>
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate({ action: 'refresh' })}
      >
        Refresh public price table
      </button>
      <p>
        Refresh downloads the LiteLLM community price list. Bundled rates come from
        provider pricing pages.
      </p>
      {error !== null || mutation.error !== null || prices.error !== null ? (
        <p className="wizardError" role="alert">
          {error ?? mutation.error?.message ?? prices.error?.message}
        </p>
      ) : null}
      <form
        className="usagePriceForm"
        onSubmit={(event) => {
          event.preventDefault();
          saveOverride();
        }}
      >
        <label>
          Model
          <input
            aria-label="Price model"
            value={model}
            maxLength={200}
            required
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Standard rates</legend>
          {CATEGORIES.map((category) => (
            <label key={category}>
              {LABELS[category]}
              <input
                aria-label={`Standard ${LABELS[category]}`}
                type="number"
                min="0"
                max="100000"
                step="any"
                required={category !== 'cacheWrite1h'}
                value={standard[category]}
                onChange={(event) =>
                  setStandard({ ...standard, [category]: event.target.value })
                }
              />
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={fastEnabled}
            onChange={(event) => setFastEnabled(event.target.checked)}
          />{' '}
          Add published fast-tier rates
        </label>
        {fastEnabled ? (
          <fieldset>
            <legend>Fast rates</legend>
            {CATEGORIES.map((category) => (
              <label key={category}>
                {LABELS[category]}
                <input
                  aria-label={`Fast ${LABELS[category]}`}
                  type="number"
                  min="0"
                  max="100000"
                  step="any"
                  required={category !== 'cacheWrite1h'}
                  value={fast[category]}
                  onChange={(event) =>
                    setFast({ ...fast, [category]: event.target.value })
                  }
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        <p>
          An override replaces this model’s bundled tier, long-context, and geography
          rates. Blank 1h cache writes use the cache-write rate.
        </p>
        <button type="submit" disabled={mutation.isPending}>
          Save price override
        </button>
      </form>
      <ul>
        {prices.data?.overrides.map((entry) => (
          <li key={entry.model}>
            <span>
              {entry.model} · {entry.asOf}
            </span>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({ action: 'remove-override', model: entry.model })
              }
            >
              Remove override
            </button>
          </li>
        ))}
      </ul>
      <form
        className="usageAliasForm"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({
            action: 'set-alias',
            alias: alias.trim(),
            model: target.trim(),
          });
        }}
      >
        <label>
          Model alias
          <input
            aria-label="Model alias"
            value={alias}
            maxLength={200}
            required
            onChange={(event) => setAlias(event.target.value)}
          />
        </label>
        <label>
          Price model
          <input
            aria-label="Alias price model"
            value={target}
            maxLength={200}
            required
            onChange={(event) => setTarget(event.target.value)}
          />
        </label>
        <button type="submit" disabled={mutation.isPending}>
          Save alias
        </button>
      </form>
      <ul>
        {prices.data?.aliases.map((entry) => (
          <li key={entry.alias}>
            <span>
              {entry.alias} → {entry.model}
            </span>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({ action: 'remove-alias', alias: entry.alias })
              }
            >
              Remove alias
            </button>
          </li>
        ))}
      </ul>
      <details>
        <summary>Effective rates · {prices.data?.entries.length ?? 0} models</summary>
        <div className="usageTableScroll">
          <table className="usageTable">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Standard input / output</th>
                <th scope="col">Fast input / output</th>
                <th scope="col">Source / date</th>
              </tr>
            </thead>
            <tbody>
              {prices.data?.entries.slice(0, 100).map((entry) => (
                <tr key={entry.model}>
                  <th scope="row">{entry.model}</th>
                  <td>
                    {entry.standard.input} / {entry.standard.output}
                  </td>
                  <td>
                    {entry.fast === null
                      ? 'Unpublished'
                      : `${entry.fast.input} / ${entry.fast.output}`}
                  </td>
                  <td>
                    {entry.sourceLabel} · {entry.asOf}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(prices.data?.entries.length ?? 0) > 100 ? (
          <p>
            Showing the first 100 rates. Model breakdowns show the rate source for each
            model used.
          </p>
        ) : null}
      </details>
    </details>
  );
}
