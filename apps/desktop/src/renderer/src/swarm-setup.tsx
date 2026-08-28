import { useState } from 'react';
import { BOARD_AGENT_CATALOG, type BoardAgentId } from '@builderhelm/protocol/board';
import {
  swarmPlanBudget,
  SWARM_PRESETS,
  SWARM_SKILLS,
  type SwarmAssignment,
  type SwarmLaunchMode,
  type SwarmPresetId,
  type SwarmRole,
} from '@builderhelm/protocol/swarm';

type Step = 'mission' | 'roster' | 'launch';

const SKILL_GROUPS = ['workflow', 'quality', 'ops', 'analysis'] as const;

/** Rough per-run band from seat count; the live meter is the real number. */
function costBand(seats: number): string {
  return `$${(seats * 0.15).toFixed(2)}–$${(seats * 0.6).toFixed(2)}`;
}

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
  onAddSeat,
  onRemoveSeat,
  onToggleAuto,
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
  readonly onAddSeat: (role: SwarmRole) => void;
  readonly onRemoveSeat: (index: number) => void;
  readonly onToggleAuto: (index: number) => void;
  readonly onCancel: () => void;
  readonly onLaunch: () => void;
}): React.JSX.Element {
  const missionReady = job.trim().length > 0 && folderPath.trim().length > 0;
  const canLaunch = missionReady && roster.length > 0 && !pending;
  const counts = countRoles(roster);
  const stepNo = step === 'mission' ? 1 : step === 'roster' ? 2 : 3;

  return (
    <section className="swarmWizard" aria-labelledby="swarm-setup-title">
      <nav className="swarmSteps" aria-label="Swarm setup">
        <StepChip
          id="mission"
          label="Mission"
          current={step}
          done={step !== 'mission'}
          onClick={onStep}
        />
        <span className="swarmStepLine" />
        <StepChip
          id="roster"
          label="Roster"
          current={step}
          done={step === 'launch'}
          onClick={onStep}
        />
        <span className="swarmStepLine" />
        <StepChip
          id="launch"
          label="Launch"
          current={step}
          done={false}
          onClick={onStep}
        />
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
          onAddSeat={onAddSeat}
          onRemoveSeat={onRemoveSeat}
          onToggleAuto={onToggleAuto}
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
          Step {stepNo} of 3{swarmName.trim() ? ` · ${swarmName.trim()}` : ''}
        </span>
        {step === 'launch' ? (
          <button
            className="primaryButton"
            type="button"
            disabled={!canLaunch}
            onClick={onLaunch}
          >
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
        <p>
          Any folder works. If it is not a git repo, BuilderHelm initializes one so seats
          can isolate.
        </p>
      </header>
      <label className="swarmField">
        <span>Working folder</span>
        <div className="folderRow">
          <input
            value={folderPath}
            placeholder={homeDir || 'Browse to any project folder'}
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
          placeholder="What should this swarm accomplish? Drop files to tag them with @path."
          onChange={(event) => onJob(event.target.value)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            // Dropped paths become @tags the planner can read as context.
            const paths = [...event.dataTransfer.files]
              .map((file) => file.name)
              .filter((name) => name.length > 0);
            if (paths.length === 0) return;
            event.preventDefault();
            const tags = paths.map((path) => `@${path}`).join(' ');
            onJob(job.trimEnd().length === 0 ? tags : `${job.trimEnd()}\n${tags}`);
          }}
        />
      </label>
      <p className="swarmShareNote">
        Shared with every seat as the cache-stable part of their prompt. Drop files onto
        the brief to tag them.
      </p>
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
  onAddSeat,
  onRemoveSeat,
  onToggleAuto,
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
  readonly onAddSeat: (role: SwarmRole) => void;
  readonly onRemoveSeat: (index: number) => void;
  readonly onToggleAuto: (index: number) => void;
}): React.JSX.Element {
  const first = detected[0];
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const full = roster.length >= 12;
  return (
    <div className="swarmWizardBody">
      <header className="swarmWizardHero">
        <h1 id="swarm-setup-title">
          Build your <em>roster</em>
        </h1>
        <p>
          Pick a preset, then add or remove agents. This is the team that will ship your
          code.
        </p>
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
        {counts.coordinator} coord · {counts.builder} builder
        {counts.builder === 1 ? '' : 's'} · {counts.scout} scout
        {counts.scout === 1 ? '' : 's'} · {counts.reviewer} reviewer
        {counts.reviewer === 1 ? '' : 's'}
      </p>
      <p className="swarmCostBand">
        Up to {swarmPlanBudget(preset)} tasks · rough spend {costBand(roster.length)} per
        run, metered live per seat
      </p>
      <span className="swarmFieldLabel">Launch mode</span>
      <div className="swarmModes">
        <button
          type="button"
          className={mode === 'safe' ? 'swarmModeCard swarmModeOn' : 'swarmModeCard'}
          onClick={() => onMode('safe')}
        >
          <strong>Safe</strong>
          <span>Read and analyze only. Unapproved actions fail closed.</span>
        </button>
        <button
          type="button"
          className={mode === 'auto' ? 'swarmModeCard swarmModeOn' : 'swarmModeCard'}
          onClick={() => onMode('auto')}
        >
          <strong>Auto-edit</strong>
          <span>Agents edit files freely; shell commands still gated.</span>
        </button>
        <button
          type="button"
          className={mode === 'full' ? 'swarmModeCard swarmModeOn' : 'swarmModeCard'}
          onClick={() => onMode('full')}
        >
          <strong>Full bypass</strong>
          <span>
            Trusted local workspaces only. Skips every approval; worktree isolation
            strongly advised.
          </span>
        </button>
      </div>
      <div className="swarmRoleChips">
        {(['coordinator', 'builder', 'scout', 'reviewer'] as const).map((role) => (
          <button
            key={role}
            type="button"
            disabled={full}
            onClick={() => onAddSeat(role)}
          >
            + {counts[role]} {role}
            {counts[role] === 1 ? '' : 's'}
          </button>
        ))}
        <em>{roster.length} total</em>
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
            <button
              type="button"
              className={seat.auto ? 'swarmAuto swarmAutoOn' : 'swarmAuto'}
              onClick={() => onToggleAuto(index)}
            >
              Auto
            </button>
            <button
              type="button"
              className="swarmSeatDrop"
              onClick={() => onRemoveSeat(index)}
            >
              ×
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="swarmAddSeat"
        disabled={full || first === undefined}
        onClick={() => onAddSeat('builder')}
      >
        + Add agent
      </button>
      <span className="swarmFieldLabel">Swarm skills</span>
      {SKILL_GROUPS.map((group) => (
        <div key={group} className="swarmSkillGroup">
          <span>{group}</span>
          <div className="swarmSkillGrid">
            {SWARM_SKILLS.filter((skill) => skill.group === group).map((skill) => {
              const on = skillIds.includes(skill.id);
              const open = openSkill === skill.id;
              return (
                <div
                  key={skill.id}
                  className={on ? 'swarmSkill swarmSkillOn' : 'swarmSkill'}
                >
                  <button
                    type="button"
                    className="swarmSkillHead"
                    onClick={() => onToggleSkill(skill.id)}
                  >
                    <strong>{skill.title}</strong>
                    <span>{skill.detail}</span>
                    <i className={on ? 'swarmSwitch swarmSwitchOn' : 'swarmSwitch'} />
                  </button>
                  {on ? (
                    <button
                      type="button"
                      className="swarmSkillMore"
                      onClick={() => setOpenSkill(open ? null : skill.id)}
                    >
                      {open ? 'Hide directive' : 'Show directive'}
                    </button>
                  ) : null}
                  {on && open ? (
                    <p className="swarmSkillDirective">
                      <span>Agent directive</span>
                      {skill.directive}
                    </p>
                  ) : null}
                  {on ? (
                    <button
                      type="button"
                      className="swarmSkillDrop"
                      onClick={() => onToggleSkill(skill.id)}
                    >
                      Remove skill
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
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
  const skills = SWARM_SKILLS.filter((skill) => skillIds.includes(skill.id)).map(
    (skill) => skill.title,
  );
  const autos = roster.filter((seat) => seat.auto).length;
  return (
    <div className="swarmWizardBody">
      <header className="swarmWizardHero">
        <h1 id="swarm-setup-title">
          Review &amp; <em>launch</em>
        </h1>
        <p>
          Name the swarm and check the brief. Seats can still change after launch in a
          later slice.
        </p>
      </header>
      <label className="swarmField">
        <span>Swarm name — auto-named if left blank</span>
        <input
          value={swarmName}
          placeholder="Swarm 1"
          onChange={(event) => onName(event.target.value)}
        />
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
            {roster.length} agents — {counts.coordinator} coordinator · {counts.builder}{' '}
            builders · {counts.scout} scout · {counts.reviewer} reviewer
            {autos > 0 ? ` · ${autos} auto` : ''}
          </strong>
        </li>
        <li>
          <span>Mode</span>
          <strong>
            {mode === 'safe'
              ? 'Safe — read and analyze only'
              : mode === 'auto'
                ? 'Auto-edit — files yes, commands gated'
                : 'Full bypass — every approval skipped'}
          </strong>
        </li>
        <li>
          <span>Skills</span>
          <strong>{skills.length === 0 ? 'None' : skills.join(', ')}</strong>
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
