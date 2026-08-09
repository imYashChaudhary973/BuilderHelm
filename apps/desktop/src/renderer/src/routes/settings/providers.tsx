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
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => window.zero.providers.list(),
  });

  async function refresh(): Promise<void> {
    setEditing(null);
    setError(null);
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
    },
    onError: () =>
      setError(
        'Provider could not be deleted. Its metadata and credential were preserved.',
      ),
  });
  const busy = createProvider.isPending || updateProvider.isPending;

  return (
    <>
      <header className="settingsHeader">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Models &amp; Providers</h1>
          <p className="lede">Configure access without making a model request.</p>
        </div>
        <div className="securePill">macOS Keychain</div>
      </header>
      {error !== null && (
        <p className="errorBanner" role="alert">
          {error}
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
          {providers.data?.length === 0 && (
            <p className="emptyState">
              No providers yet. Add the first secure connection.
            </p>
          )}
          {providers.data?.map((provider) => (
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
            </article>
          ))}
        </section>
        <ProviderForm
          key={editing?.id ?? `new-${providers.data?.length ?? 0}`}
          editing={editing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onCreate={(input) => createProvider.mutate(input)}
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
