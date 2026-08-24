import { BOARD_AGENT_CATALOG, type BoardAgentId } from '@zero/protocol/board';
import {
  SWARM_PRESETS,
  SWARM_SKILLS,
  type SwarmAssignment,
  type SwarmLaunchMode,
  type SwarmPresetId,
  type SwarmRole,
} from '@zero/protocol/swarm';

type Step = 'mission' | 'roster' | 'launch';

export function SwarmSetup({
  step,
  job,
  folderPath,
  homeDir,
  recents,
  preset,
  mode,
  skillIds,
  swarmName,
  roster,
  detected,
  error,
  pending,
  onStep,
  onJob,
  onFolder,
  onBrowse,
  onPreset,
  onMode,
  onToggleSkill,
  onName,
  onSeatAgent,
  onFillAll,
  onCancel,
  onLaunch,
}: {
  readonly step: Step;
  readonly job: string;
  readonly folderPath: string;
  readonly homeDir: string;
  readonly recents: readonly string[];
  readonly preset: SwarmPresetId;
  readonly mode: SwarmLaunchMode;
  readonly skillIds: readonly string[];
  readonly swarmName: string;
  readonly roster: readonly SwarmAssignment[];
  readonly detected: readonly BoardAgentId[];
  readonly error: string | null;
  readonly pending: boolean;
  readonly onStep: (step: Step) => void;
  readonly onJob: (value: string) => void;
  readonly onFolder: (value: string) => void;
  readonly onBrowse: () => void;
  readonly onPreset: (id: SwarmPresetId) => void;
  readonly onMode: (mode: SwarmLaunchMode) => void;
  readonly onToggleSkill: (id: string) => void;
  readonly onName: (value: string) => void;
  readonly onSeatAgent: (index: number, agentId: BoardAgentId) => void;
  readonly onFillAll: (agentId: BoardAgentId) => void;
  readonly onCancel: () => void;
  readonly onLaunch: () => void;
}): React.JSX.Element {
  const missionReady = job.trim().length > 0 && folderPath.trim().length > 0;
  const canLaunch = missionReady && roster.length > 0 && !pending;
  const counts = countRoles(roster);

  return (
    <section className="swarmWizard" aria-labelledby="swarm-setup-title">
      <nav className="swarmSteps" aria-label="Swarm setup">
        <StepChip id="mission" label="Mission" current={step} done={step !== 'mission'} onClick={onStep} />
        <span className="swarmStepLine" />
        <StepChip id="roster" label="Roster" current={step} done={step === 'launch'} onClick={onStep} />
        <span className="swarmStepLine" />
        <StepChip id="launch" label="Launch" current={step} done={false} onClick={onStep} />
      </nav>

      {step === 'mission' ? (
        <Mission
          job={job}
          folderPath={folderPath}
          homeDir={homeDir}
          recents={recents}
          onJob={onJob}
          onFolder={onFolder}
          onBrowse={onBrowse}
        />
      ) : null}
      {step === 'roster' ? (
        <Roster
          preset={preset}
          mode={mode}
          skillIds={skillIds}
          roster={roster}
          detected={detected}
          counts={counts}
          onPreset={onPreset}
          onMode={onMode}
          onToggleSkill={onToggleSkill}
          onSeatAgent={onSeatAgent}
          onFillAll={onFillAll}
        />
      ) : null}
      {step === 'launch' ? (
        <Review
          swarmName={swarmName}
          job={job}
          folderPath={folderPath}
          roster={roster}
          mode={mode}
          skillIds={skillIds}
          onName={onName}
        />
      ) : null}

      {error !== null && (
        <p className="wizardError" role="alert">
          {error}
        </p>
      )}

      <footer className="swarmWizardFoot">
        <button className="secondaryButton" type="button" onClick={onCancel}>
          {step === 'mission' ? 'Cancel' : 'Back'}
        </button>
        <span className="swarmStepMeta">
          Step {step === 'mission' ? 1 : step === 'roster' ? 2 : 3} of 3
        </span>
        {step === 'launch' ? (
          <button className="primaryButton" type="button" disabled={!canLaunch} onClick={onLaunch}>
            {pending ? 'Starting…' : 'Launch swarm'}
          </button>
        ) : (
          <button
            className="primaryButton"
            type="button"
            disabled={step === 'mission' && !missionReady}
            onClick={() => onStep(step === 'mission' ? 'roster' : 'launch')}
          >
            Next
          </button>
        )}
      </footer>
    </section>
  );
}

function StepChip({
  id,
  label,
  current,
  done,
  onClick,
}: {
  readonly id: Step;
  readonly label: string;
  readonly current: Step;
  readonly done: boolean;
  readonly onClick: (step: Step) => void;
}): React.JSX.Element {
  const on = current === id;
  return (
    <button
      type="button"
      className={on ? 'swarmStep swarmStepOn' : 'swarmStep'}
      onClick={() => onClick(id)}
    >
      {done ? '✓ ' : ''}
      {label}
    </button>
  );
}

function Mission({
  job,
  folderPath,
  homeDir,
  recents,
  onJob,
  onFolder,
  onBrowse,
}: {
  readonly job: string;
  readonly folderPath: string;
  readonly homeDir: string;
  readonly recents: readonly string[];
  readonly onJob: (value: string) => void;
  readonly onFolder: (value: string) => void;
  readonly onBrowse: () => void;
}): React.JSX.Element {
  return (
    <div className="swarmWizardBody">
      <header className="swarmWizardHero">
        <h1 id="swarm-setup-title">
          Define the <em>mission</em>
        </h1>
        <p>Where your swarm works, what it should accomplish, and any context it should read first.</p>
      </header>
      <label className="swarmField">
        <span>Working folder</span>
        <div className="folderRow">
          <input
            value={folderPath}
            placeholder={homeDir || 'Browse to a project folder'}
            onChange={(event) => onFolder(event.target.value)}
          />
          <button className="secondaryButton" type="button" onClick={onBrowse}>
            Browse…
          </button>
        </div>
      </label>
      {recents.length > 0 ? (
        <div className="recentCards">
          {recents.map((path) => (
            <button
              key={path}
              type="button"
              className={`recentCard${folderPath === path ? ' recentCardActive' : ''}`}
              onClick={() => onFolder(path)}
            >
              <span>
                <strong>{path.split('/').filter(Boolean).at(-1) ?? path}</strong>
                <small>{path}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <label className="swarmField">
        <span>Mission brief</span>
        <textarea
          className="swarmJob"
          rows={7}
          value={job}
          placeholder="What should this swarm accomplish? Agents will read this as their mission brief."
          onChange={(event) => onJob(event.target.value)}
        />
      </label>
      <p className="swarmShareNote">Shared with all agents so they can coordinate and stay aligned.</p>
    </div>
  );
}

function Roster({
  preset,
  mode,
  skillIds,
  roster,
  detected,
  counts,
  onPreset,
  onMode,
  onToggleSkill,
  onSeatAgent,
  onFillAll,
}: {
  readonly preset: SwarmPresetId;
  readonly mode: SwarmLaunchMode;
  readonly skillIds: readonly string[];
  readonly roster: readonly SwarmAssignment[];
  readonly detected: readonly BoardAgentId[];
  readonly counts: Record<SwarmRole, number>;
  readonly onPreset: (id: SwarmPresetId) => void;
  readonly onMode: (mode: SwarmLaunchMode) => void;
  readonly onToggleSkill: (id: string) => void;
  readonly onSeatAgent: (index: number, agentId: BoardAgentId) => void;
  readonly onFillAll: (agentId: BoardAgentId) => void;
}): React.JSX.Element {
  const first = detected[0];
  return (
    <div className="swarmWizardBody">
      <header className="swarmWizardHero">
        <h1 id="swarm-setup-title">
          Build your <em>roster</em>
        </h1>
        <p>Pick a preset, then add or remove agents. This is the team that will ship your code.</p>
      </header>
      <span className="swarmFieldLabel">Quick presets</span>
      <div className="swarmPresets">
        {SWARM_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === preset ? 'swarmPreset swarmPresetOn' : 'swarmPreset'}
            onClick={() => onPreset(item.id)}
          >
            <strong>{item.size}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <p className="swarmHint">
        {counts.coordinator} coord · {counts.builder} builder{counts.builder === 1 ? '' : 's'} ·{' '}
        {counts.scout} scout · {counts.reviewer} reviewer
      </p>
      <span className="swarmFieldLabel">Launch mode</span>
      <div className="swarmModes">
        <button
          type="button"
          className={mode === 'safe' ? 'swarmModeCard swarmModeOn' : 'swarmModeCard'}
          onClick={() => onMode('safe')}
        >
          <strong>Safe</strong>
          <span>Agents ask before privileged file or command actions.</span>
        </button>
        <button
          type="button"
          className={mode === 'skip' ? 'swarmModeCard swarmModeOn' : 'swarmModeCard'}
          onClick={() => onMode('skip')}
        >
          <strong>Skip permissions</strong>
          <span>Trusted local workspaces only. Applies each CLI approval-bypass preset.</span>
        </button>
      </div>
      <div className="swarmFillRow">
        <span>{roster.length} total</span>
        {first !== undefined ? (
          <label>
            Fill all
            <select
              value=""
              onChange={(event) => {
                const id = event.target.value as BoardAgentId;
                if (id) onFillAll(id);
              }}
            >
              <option value="">Choose CLI</option>
              {detected.map((id) => (
                <option key={id} value={id}>
                  {labelFor(id)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <ol className="swarmSeatList">
        {roster.map((seat, index) => (
          <li key={`${seat.role}-${index}`}>
            <span>{index + 1}</span>
            <strong>{seat.role}</strong>
            <select
              value={seat.agentId}
              onChange={(event) => onSeatAgent(index, event.target.value as BoardAgentId)}
            >
              {detected.map((id) => (
                <option key={id} value={id}>
                  {labelFor(id)}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ol>
      <span className="swarmFieldLabel">Swarm skills</span>
      <div className="swarmSkillGrid">
        {SWARM_SKILLS.map((skill) => (
          <button
            key={skill.id}
            type="button"
            className={skillIds.includes(skill.id) ? 'swarmSkill swarmSkillOn' : 'swarmSkill'}
            onClick={() => onToggleSkill(skill.id)}
          >
            <strong>{skill.title}</strong>
            <span>{skill.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Review({
  swarmName,
  job,
  folderPath,
  roster,
  mode,
  skillIds,
  onName,
}: {
  readonly swarmName: string;
  readonly job: string;
  readonly folderPath: string;
  readonly roster: readonly SwarmAssignment[];
  readonly mode: SwarmLaunchMode;
  readonly skillIds: readonly string[];
  readonly onName: (value: string) => void;
}): React.JSX.Element {
  const counts = countRoles(roster);
  return (
    <div className="swarmWizardBody">
      <header className="swarmWizardHero">
        <h1 id="swarm-setup-title">
          Review &amp; <em>launch</em>
        </h1>
        <p>Name your swarm and double-check the briefing. Everything can still be changed mid-flight.</p>
      </header>
      <label className="swarmField">
        <span>Swarm name — auto-named if left blank</span>
        <input value={swarmName} placeholder="Swarm 1" onChange={(event) => onName(event.target.value)} />
      </label>
      <ul className="swarmRecap">
        <li>
          <span>Mission</span>
          <strong>{job.trim() || '—'}</strong>
        </li>
        <li>
          <span>Folder</span>
          <strong>{folderPath || '—'}</strong>
        </li>
        <li>
          <span>Roster</span>
          <strong>
            {roster.length} agents — {counts.coordinator} coordinator · {counts.builder} builders ·{' '}
            {counts.scout} scout · {counts.reviewer} reviewer
          </strong>
        </li>
        <li>
          <span>Mode</span>
          <strong>{mode === 'safe' ? 'Safe — agents ask before privileged actions' : 'Skip permissions'}</strong>
        </li>
        <li>
          <span>Skills</span>
          <strong>{skillIds.length === 0 ? 'None' : skillIds.join(', ')}</strong>
        </li>
      </ul>
    </div>
  );
}

function countRoles(roster: readonly SwarmAssignment[]): Record<SwarmRole, number> {
  return {
    coordinator: roster.filter((item) => item.role === 'coordinator').length,
    builder: roster.filter((item) => item.role === 'builder').length,
    scout: roster.filter((item) => item.role === 'scout').length,
    reviewer: roster.filter((item) => item.role === 'reviewer').length,
  };
}

function labelFor(id: BoardAgentId): string {
  return BOARD_AGENT_CATALOG.find((entry) => entry.id === id)?.label ?? id;
}
