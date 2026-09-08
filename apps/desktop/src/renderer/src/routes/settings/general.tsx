import { useState } from 'react';

export function GeneralPage(): React.JSX.Element {
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<string | null>(null);

  return (
    <div className="generalSettings">
      <header className="settingsHeader">
        <div>
          <h1>General</h1>
          <p>Theme, the notch, updates, and diagnostics.</p>
        </div>
      </header>
      <section aria-labelledby="appearance-title">
        <h2 id="appearance-title">Appearance</h2>
        <div className="generalRow">
          <div>
            <strong>Theme</strong>
            <p>Dark appearance. More themes coming later.</p>
          </div>
          <select aria-label="Theme" value="dark" disabled>
            <option value="dark">Dark</option>
          </select>
        </div>
      </section>
      <section aria-labelledby="notch-title">
        <h2 id="notch-title">Notch</h2>
        <div className="generalRow">
          <div>
            <strong>Agents in the notch</strong>
            <p>Not available in this build.</p>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-label="Agents in the notch"
            checked={false}
            disabled
          />
        </div>
      </section>
      <section aria-labelledby="updates-title">
        <h2 id="updates-title">Updates</h2>
        <div className="generalRow">
          <div>
            <strong>Check automatically</strong>
            <p>Automatic updates are not available until a signed release exists.</p>
          </div>
          <input
            type="checkbox"
            role="switch"
            aria-label="Check for updates automatically"
            checked={false}
            disabled
          />
        </div>
        <div className="generalRow">
          <div>
            <strong>Development build</strong>
            <p>{__BUILD_STAMP__}</p>
          </div>
          <button type="button" disabled>
            Check now
          </button>
        </div>
      </section>
      <section aria-labelledby="diagnostics-title">
        <h2 id="diagnostics-title">Diagnostics</h2>
        <div className="generalRow">
          <div>
            <strong>Export a redacted report</strong>
            <p>
              Writes platform, schema version, and recent logs. Secrets are redacted. The
              database is not included.
            </p>
            {diagnosticsStatus !== null ? <p>{diagnosticsStatus}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => {
              void window.builderHelm.system
                .exportDiagnostics()
                .then((result) => {
                  setDiagnosticsStatus(
                    result.path === null ? 'Cancelled.' : `Wrote ${result.path}`,
                  );
                })
                .catch((error: unknown) => {
                  setDiagnosticsStatus(
                    error instanceof Error ? error.message : 'Export failed.',
                  );
                });
            }}
          >
            Export diagnostics
          </button>
        </div>
      </section>
    </div>
  );
}
