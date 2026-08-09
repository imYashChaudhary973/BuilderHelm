import { useEffect, useState } from 'react';

type CoreStatus = 'checking' | 'ready' | 'unavailable';

export function TodayPage(): React.JSX.Element {
  const [status, setStatus] = useState<CoreStatus>('checking');

  useEffect(() => {
    let active = true;
    void window.zero.system
      .health()
      .then(() => active && setStatus('ready'))
      .catch(() => active && setStatus('unavailable'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Phase 1</p>
          <h1>Secure provider settings</h1>
        </div>
        <div
          className={`status status-${status}`}
          data-core-status={status}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true" />
          {status === 'checking' && 'Checking core'}
          {status === 'ready' && 'Core ready'}
          {status === 'unavailable' && 'Core unavailable'}
        </div>
      </header>
      <section className="hero" aria-labelledby="foundation-title">
        <p className="eyebrow">Private by default</p>
        <h2 id="foundation-title">Your model access stays under your control.</h2>
        <p>
          Provider metadata lives locally. Credential values are handed directly to macOS
          Keychain and are never returned to this interface.
        </p>
      </section>
      <section className="grid" aria-label="Foundation status">
        <article>
          <span className="index">01</span>
          <h3>Sandboxed interface</h3>
          <p>The renderer receives fixed, validated operations and no Node primitives.</p>
        </article>
        <article>
          <span className="index">02</span>
          <h3>Local metadata</h3>
          <p>Provider settings and append-only audit events stay in local SQLite.</p>
        </article>
        <article>
          <span className="index">03</span>
          <h3>Keychain credentials</h3>
          <p>Secrets cross the bridge once and remain outside application storage.</p>
        </article>
      </section>
    </>
  );
}
