import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProviderInput,
  ProviderSummary,
  UpdateProviderInput,
} from '@zero/protocol/providers';
import { useState } from 'react';

import { ProviderForm } from '../../features/providers/provider-form.js';

export function ProvidersPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ProviderSummary | null>(null);
  const [deleting, setDeleting] = useState<ProviderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => window.zero.providers.list(),
  });
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => window.zero.models.list({}),
  });

  async function refresh(): Promise<void> {
    setEditing(null);
    setError(null);
    setNotice(null);
    await queryClient.invalidateQueries({ queryKey: ['providers'] });
  }

  const createProvider = useMutation({
    mutationFn: (input: CreateProviderInput) => window.zero.providers.create(input),
    onSuccess: refresh,
    onError: () =>
      setError('Provider could not be saved. Check the fields and Keychain access.'),
  });
  const updateProvider = useMutation({
    mutationFn: (input: UpdateProviderInput) => window.zero.providers.update(input),
    onSuccess: refresh,
    onError: () =>
      setError('Provider could not be updated. Your previous settings were preserved.'),
  });
  const deleteProvider = useMutation({
    mutationFn: (id: string) => window.zero.providers.delete({ id }),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['models'] });
    },
    onError: () =>
      setError(
        'Provider could not be deleted. Its metadata and credential were preserved.',
      ),
  });
  const testProvider = useMutation({
    mutationFn: (provider: ProviderSummary) =>
      window.zero.providers.testConnection({ providerId: provider.id }),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (result, provider) =>
      setNotice(`${provider.label} connected in ${result.latencyMs} ms.`),
    onError: (_failure, provider) =>
      setError(
        `${provider.label} could not connect. Check its saved URL, credential, and provider status.`,
      ),
  });
  const discoverModels = useMutation({
    mutationFn: (provider: ProviderSummary) =>
      window.zero.models.discover({ providerId: provider.id }),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: async (discovered, provider) => {
      setNotice(
        `${provider.label} returned ${discovered.length} model${discovered.length === 1 ? '' : 's'}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['models'] });
    },
    onError: (_failure, provider) =>
      setError(
        `${provider.label} models could not be discovered. Its previous catalog was preserved.`,
      ),
  });
  const busy = createProvider.isPending || updateProvider.isPending;

  return (
    <>
      <header className="settingsHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Models &amp; Providers</h1>
          <p className="lede">Connect providers and manage discovered models.</p>
        </div>
        <div className="securePill">macOS Keychain</div>
      </header>
      {error !== null && (
        <p className="errorBanner" role="alert">
          {error}
        </p>
      )}
      {notice !== null && (
        <p className="successBanner" role="status">
          {notice}
        </p>
      )}
      <div className="settingsLayout">
        <section className="providerList" aria-labelledby="provider-list-title">
          <div className="sectionTitle">
            <h2 id="provider-list-title">Providers</h2>
            <span>{providers.data?.length ?? 0}</span>
          </div>
          {providers.isLoading && <p className="emptyState">Loading local settings…</p>}
          {providers.isError && (
            <p className="emptyState">Provider settings are unavailable.</p>
          )}
          {models.isError && (
            <p className="catalogError" role="alert">
              Stored model catalogs are unavailable.
            </p>
          )}
          {providers.data?.length === 0 && (
            <p className="emptyState">
              No providers yet. Add the first secure connection.
            </p>
          )}
          {providers.data?.map((provider) => {
            const providerModels =
              models.data?.filter((model) => model.providerId === provider.id) ?? [];
            const testing =
              testProvider.isPending && testProvider.variables?.id === provider.id;
            const discovering =
              discoverModels.isPending && discoverModels.variables?.id === provider.id;
            const protocolAvailable = ['openai', 'anthropic'].includes(provider.protocol);

            return (
              <article className="providerCard" key={provider.id}>
                <div className="providerIdentity">
                  <span
                    className={`providerState ${provider.enabled ? 'providerStateOn' : ''}`}
                  />
                  <div>
                    <h3>{provider.label}</h3>
                    <p>{provider.protocol} · Credential stored</p>
                  </div>
                </div>
                <div className="providerActions">
                  <button type="button" onClick={() => setEditing(provider)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={!provider.enabled || !protocolAvailable || testing}
                    title={
                      protocolAvailable
                        ? 'Test the saved connection'
                        : 'This protocol adapter arrives later in Phase 2'
                    }
                    onClick={() => testProvider.mutate(provider)}
                  >
                    {testing ? 'Testing…' : 'Test'}
                  </button>
                  <button
                    type="button"
                    disabled={!provider.enabled || !protocolAvailable || discovering}
                    title={
                      protocolAvailable
                        ? 'Replace the stored catalog with models reported by the provider'
                        : 'This protocol adapter arrives later in Phase 2'
                    }
                    onClick={() => discoverModels.mutate(provider)}
                  >
                    {discovering ? 'Discovering…' : 'Discover models'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateProvider.mutate({
                        id: provider.id,
                        label: provider.label,
                        protocol: provider.protocol,
                        baseUrl: provider.baseUrl,
                        headers: provider.headers,
                        privacy: provider.privacy,
                        enabled: !provider.enabled,
                      })
                    }
                  >
                    {provider.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="dangerText"
                    type="button"
                    onClick={() => setDeleting(provider)}
                  >
                    Delete
                  </button>
                </div>
                {providerModels.length > 0 && (
                  <div className="modelCatalog">
                    <p>
                      Last discovered · {providerModels.length} model
                      {providerModels.length === 1 ? '' : 's'}
                    </p>
                    <ul>
                      {providerModels.slice(0, 5).map((model) => (
                        <li key={model.ref}>{model.label}</li>
                      ))}
                    </ul>
                    {providerModels.length > 5 && (
                      <p>+{providerModels.length - 5} more</p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
        <ProviderForm
          key={editing?.id ?? `new-${providers.data?.length ?? 0}`}
          editing={editing}
          busy={busy}
          testing={
            editing !== null &&
            testProvider.isPending &&
            testProvider.variables?.id === editing.id
          }
          onCancel={() => setEditing(null)}
          onCreate={(input) => createProvider.mutate(input)}
          onTest={(providerId) => {
            const provider = providers.data?.find((item) => item.id === providerId);
            if (provider !== undefined) testProvider.mutate(provider);
          }}
          onUpdate={(input) => updateProvider.mutate(input)}
        />
      </div>
      {deleting !== null && (
        <div className="dialogBackdrop" role="presentation">
          <section
            className="confirmDialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <p className="eyebrow">Permanent action</p>
            <h2 id="delete-title">Delete {deleting.label}?</h2>
            <p>
              This removes its local configuration and credential from macOS Keychain.
            </p>
            <div className="formActions">
              <button
                className="secondaryButton"
                type="button"
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>
              <button
                className="dangerButton"
                type="button"
                disabled={deleteProvider.isPending}
                onClick={() => deleteProvider.mutate(deleting.id)}
              >
                {deleteProvider.isPending ? 'Deleting…' : 'Delete provider'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
