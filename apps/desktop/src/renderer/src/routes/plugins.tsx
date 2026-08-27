import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export function PluginsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const plugins = useQuery({
    queryKey: ['helm-plugins'],
    queryFn: () => window.zero.helm.listPlugins(),
  });
  const connect = useMutation({
    mutationFn: () =>
      window.zero.helm.connectPlugin({ id: 'github', token: token.trim() }),
    onSuccess: async () => {
      setToken('');
      await queryClient.invalidateQueries({ queryKey: ['helm-plugins'] });
    },
    onError: (cause: Error) => setError(cause.message),
  });
  const github = (plugins.data ?? []).find((item) => item.id === 'github');

  return (
    <section className="spaceStage" aria-labelledby="plugins-title">
      <div className="boardPage">
        <p className="eyebrow">Plugins</p>
        <h1 id="plugins-title">Connected services</h1>
        <p className="lede">
          Keys stay in Keychain. Connecting GitHub does not enable it on every teammate.
          Writes still need an approval card.
        </p>
        {error !== null ? (
          <p className="errorBanner" role="alert">
            {error}
          </p>
        ) : null}
        <div className="wizardSection">
          <strong>GitHub</strong>
          <p>
            {github?.connected === true
              ? `Connected as ${github.account}`
              : 'Not connected'}
          </p>
          <label className="wizardLabel" htmlFor="gh-token">
            Personal access token
          </label>
          <input
            id="gh-token"
            type="password"
            value={token}
            placeholder="ghp_…"
            onChange={(event) => setToken(event.target.value)}
          />
          <button
            className="primaryButton"
            type="button"
            disabled={token.trim().length === 0}
            onClick={() => connect.mutate()}
          >
            Save in Keychain
          </button>
        </div>
      </div>
    </section>
  );
}
