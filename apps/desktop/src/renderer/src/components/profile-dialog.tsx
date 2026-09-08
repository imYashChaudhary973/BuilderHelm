import type { AgentCandidate, AgentProfile } from '@builderhelm/protocol';
import { useEffect, useRef, useState } from 'react';

import { BotMark } from './agent-roster.js';
import type { AgentProfileMark } from '@builderhelm/protocol';

const MARKS: readonly AgentProfileMark[] = [
  'circle',
  'diamond',
  'triangle',
  'square',
  'hexagon',
  'star',
  'wave',
  'bolt',
];

/**
 * Create or edit a roster profile. The CLI dropdown offers only what detection
 * found on this machine — BuilderHelm never installs an agent (ADR 0008), and
 * the command itself is stored by main, never typed here.
 */
export function ProfileDialog({
  editing,
  onClose,
  onSaved,
}: {
  readonly editing: AgentProfile | null;
  readonly onClose: () => void;
  readonly onSaved: (profile: AgentProfile | null) => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  const [name, setName] = useState(editing?.name ?? '');
  const [mark, setMark] = useState<AgentProfileMark>(editing?.mark ?? 'diamond');
  const [agentId, setAgentId] = useState(editing?.agent.id ?? '');
  const [defaultCwd, setDefaultCwd] = useState(editing?.defaultCwd ?? null);
  const [instructions, setInstructions] = useState(editing?.instructions ?? '');
  const [candidates, setCandidates] = useState<readonly AgentCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.builderHelm.agents
      .candidates()
      .then((next) => {
        if (!active) return;
        setCandidates(next);
        setAgentId((current) => {
          if (current.length > 0) return current;
          return (
            (next.find((c) => c.configured) ?? next.find((c) => c.available))?.id ?? ''
          );
        });
      })
      .catch(() => active && setError('Agents on this machine could not be listed.'));
    return () => {
      active = false;
    };
  }, []);

  const runnable = candidates.filter((c) => c.available || c.configured);
  const canSave = name.trim().length > 0 && agentId.length > 0 && !busy;

  async function chooseFolder(): Promise<void> {
    try {
      const folder = await window.builderHelm.board.selectFolder();
      if (folder !== null) setDefaultCwd(folder);
    } catch {
      setError('The folder picker could not be opened.');
    }
  }

  async function save(): Promise<void> {
    const agent = runnable.find((c) => c.id === agentId);
    if (agent === undefined) {
      setError('Pick an installed agent.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await window.builderHelm.agents.profileUpsert({
        id: editing?.id,
        name: name.trim(),
        mark,
        launch: editing?.launch ?? null,
        agent: {
          id: agent.id,
          label: agent.label,
          command: agent.command,
          args: [...agent.args],
        },
        defaultCwd,
        instructions,
      });
      onSaved(saved);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The profile could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (editing === null) return;
    setBusy(true);
    try {
      await window.builderHelm.agents.profileDelete(editing.id);
      onSaved(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The profile could not be deleted.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="profileDialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-dialog-title"
    >
      <h2 id="profile-dialog-title">{editing === null ? 'New agent' : 'Edit agent'}</h2>

      <label className="wizardLabel" htmlFor="profile-name">
        Name
      </label>
      <input
        id="profile-name"
        value={name}
        maxLength={80}
        placeholder="Social Content Manager"
        autoFocus
        onChange={(event) => setName(event.target.value)}
      />

      <p className="wizardLabel">Mark</p>
      <div className="markPicker" role="radiogroup" aria-label="Mark">
        {MARKS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === mark}
            aria-label={`Mark ${option}`}
            className={`markChoice ${option === mark ? 'markPicked' : ''}`}
            onClick={() => setMark(option)}
          >
            <BotMark mark={option} />
          </button>
        ))}
      </div>

      <label className="wizardLabel" htmlFor="profile-agent">
        Runs with
      </label>
      <select
        id="profile-agent"
        value={agentId}
        disabled={runnable.length === 0}
        onChange={(event) => setAgentId(event.target.value)}
      >
        {runnable.length === 0 && <option value="">No ACP agent on PATH</option>}
        {runnable.map((candidate) => (
          <option value={candidate.id} key={candidate.id}>
            {candidate.label}
            {candidate.configured ? '' : ' · offered'}
          </option>
        ))}
      </select>

      <p className="wizardLabel">Project folder</p>
      <div className="profileFolderRow">
        <code className="profileFolderPath">{defaultCwd ?? 'Not chosen'}</code>
        <button
          className="profileButton"
          type="button"
          disabled={busy}
          onClick={() => void chooseFolder()}
        >
          Choose…
        </button>
      </div>
      <label className="wizardLabel" htmlFor="profile-instructions">
        Instructions
      </label>
      <textarea
        id="profile-instructions"
        rows={4}
        maxLength={20_000}
        value={instructions}
        placeholder="Optional standing instructions. Skills cannot grant tools."
        onChange={(event) => setInstructions(event.target.value)}
      />

      {error !== null && (
        <p className="chatError" role="alert">
          {error}
        </p>
      )}

      <div className="profileDialogActions">
        {editing !== null && (
          <button
            type="button"
            className="stopButton"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete
          </button>
        )}
        <span className="profileDialogSpacer" />
        <button className="profileButton" type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="profileButton profileButtonPrimary"
          disabled={!canSave}
          onClick={() => void save()}
        >
          {editing === null ? 'Create' : 'Save'}
        </button>
      </div>
    </dialog>
  );
}
