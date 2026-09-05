import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { AuthState } from '@builderhelm/protocol/auth';

/**
 * BuilderHelm's own login. Provider CLIs (Claude, Codex, Grok) live on Usage.
 */
export function AccountsPage(): React.JSX.Element {
  const [auth, setAuth] = useState<AuthState | null>(null);
  useEffect(() => {
    void window.builderHelm.auth.read().then(setAuth);
    return window.builderHelm.auth.onChange(setAuth);
  }, []);
  const session = auth?.session ?? null;

  return (
    <section className="accountPage" aria-labelledby="account-title">
      <header className="usagePageHead">
        <div className="usagePageTitle">
          <h1 id="account-title">Account</h1>
          <p>
            This is the BuilderHelm login that opens the app. Session and weekly windows
            for Claude, Codex, and Grok are on <Link to="/settings/usage">Usage</Link>.
          </p>
        </div>
      </header>
      {session === null ? (
        <p className="accountEmpty">Not signed in.</p>
      ) : (
        <article className="accountCard">
          <dl>
            <div>
              <dt>Email</dt>
              <dd>{session.email ?? '—'}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{session.plan}</dd>
            </div>
          </dl>
          <div className="accountCardActions">
            <button
              type="button"
              onClick={() => void window.builderHelm.auth.openAccount()}
            >
              Manage account
            </button>
            <button type="button" onClick={() => void window.builderHelm.auth.signOut()}>
              Sign out
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
