import { useState } from 'react';
import { BOARD_AGENT_CATALOG, type BoardAgentId } from '@zero/protocol/board';
import {
  swarmPlanBudget,
  SWARM_PRESETS,
  SWARM_SKILLS,
  type SwarmAssignment,
  type SwarmLaunchMode,
  type SwarmPresetId,
  type SwarmRole,
} from '@zero/protocol/swarm';

import { AgentMark } from './components/agent-mark.js';
import { SignalField } from './components/signal-field.js';
import { SpaceStepper } from './components/space-stepper.js';

type Step = 'mission' | 'roster' | 'launch';

const SKILL_GROUPS = ['workflow', 'quality', 'ops', 'analysis'] as const;
const SWARM_STEPS = [
  { n: 1, label: 'Mission' },
  { n: 2, label: 'Roster' },
  { n: 3, label: 'Launch' },
] as const;

const SEAT_MODELS: Partial<Record<BoardAgentId, readonly string[]>> = {
  grok: ['grok-4', 'grok-4.5', 'grok-4.6'],
  claude: ['sonnet', 'opus', 'haiku'],
  codex: ['gpt-5.4'],
};

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
  skillDirectives,
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
  onSkillDirective,
  onName,
  onSeatAgent,
  onSeatModel,
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
  readonly skillDirectives: Readonly<Record<string, string>>;
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
  readonly onSkillDirective: (id: string, value: string) => void;
  readonly onName: (value: string) => void;
  readonly onSeatAgent: (index: number, agentId: BoardAgentId) => void;
  readonly onSeatModel: (index: number, model: string) => void;
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
    <section className="spaceStage" aria-labelledby="swarm-setup-title">
      <SignalField />
      <div className="boardPage spaceWizard">
        <SpaceStepper step={stepNo} items={SWARM_STEPS} />
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
            skillDirectives={skillDirectives}
            roster={roster}
            detected={detected}
            counts={counts}
            onPreset={onPreset}
            onMode={onMode}
            onToggleSkill={onToggleSkill}
            onSkillDirective={onSkillDirective}
            onSeatAgent={onSeatAgent}
            onSeatModel={onSeatModel}
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

        <div className="spaceWizardFooter">
          <button className="secondaryButton" type="button" onClick={onCancel}>
            {step === 'mission' ? 'Cancel' : 'Back'}
          </button>
          <div className="spaceWizardActions">
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
                {step === 'mission' ? 'Next: Build roster' : 'Next: Review launch'}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
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
    <>
      <h1 id="swarm-setup-title">Define the mission</h1>
      <p className="lede">Pick a folder and write the brief every seat will share.</p>
      <div className="wizardSection">
        <label className="wizardLabel" htmlFor="swarm-folder">
          Working folder <span>Where the swarm starts</span>
        </label>
        <div className="folderRow">
          <input
            id="swarm-folder"
            value={folderPath}
            placeholder={homeDir || 'Browse to any project folder'}
            onChange={(event) => onFolder(event.target.value)}
          />
          <button className="secondaryButton" type="button" onClick={onBrowse}>
            Browse…
          </button>
        </div>
      </div>
      {recents.length > 0 ? (
        <div className="wizardSection">
          <span className="wizardLabel">
            Recent <span>Last used swarm folders</span>
          </span>
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
        </div>
      ) : null}
      <div className="wizardSection">
        <label className="wizardLabel" htmlFor="swarm-job">
          Mission brief <span>Shared with every seat</span>
        </label>
        <textarea
          id="swarm-job"
          className="swarmJob"
          rows={7}
          value={job}
          placeholder="What should this swarm accomplish? Drop files to tag them with @path."
          onChange={(event) => onJob(event.target.value)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            const paths = [...event.dataTransfer.files]
              .map(droppedPath)
              .filter((name) => name.length > 0);
            if (paths.length === 0) return;
            event.preventDefault();
            const tags = paths.map((path) => `@${path}`).join(' ');
            onJob(job.trimEnd().length === 0 ? tags : `${job.trimEnd()}\n${tags}`);
          }}
        />
        <p className="swarmShareNote">
          If the folder is not a git repo, BuilderHelm initializes one so seats can
          isolate. Drop files onto the brief to tag them.
        </p>
      </div>
    </>
  );
}

function Roster({
  preset,
  mode,
  skillIds,
  skillDirectives,
  roster,
  detected,
  counts,
  onPreset,
  onMode,
  onToggleSkill,
  onSkillDirective,
  onSeatAgent,
  onSeatModel,
  onFillAll,
  onAddSeat,
  onRemoveSeat,
  onToggleAuto,
}: {
  readonly preset: SwarmPresetId;
  readonly mode: SwarmLaunchMode;
  readonly skillIds: readonly string[];
  readonly skillDirectives: Readonly<Record<string, string>>;
  readonly roster: readonly SwarmAssignment[];
  readonly detected: readonly BoardAgentId[];
  readonly counts: Record<SwarmRole, number>;
  readonly onPreset: (id: SwarmPresetId) => void;
  readonly onMode: (mode: SwarmLaunchMode) => void;
  readonly onToggleSkill: (id: string) => void;
  readonly onSkillDirective: (id: string, value: string) => void;
  readonly onSeatAgent: (index: number, agentId: BoardAgentId) => void;
  readonly onSeatModel: (index: number, model: string) => void;
  readonly onFillAll: (agentId: BoardAgentId) => void;
  readonly onAddSeat: (role: SwarmRole) => void;
  readonly onRemoveSeat: (index: number) => void;
  readonly onToggleAuto: (index: number) => void;
}): React.JSX.Element {
  const first = detected[0];
  const [openSkill, setOpenSkill] = useState<string | null>(null);
  const full = roster.length >= 12;
  return (
    <>
      <h1 id="swarm-setup-title">Build your roster</h1>
      <p className="lede">Pick a helm size, then assign a CLI to each seat.</p>
      <div className="wizardSection">
        <span className="wizardLabel">
          Helm size <span>One queen, the rest workers</span>
        </span>
        <div className="layoutTiles courtTiles">
          {SWARM_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`layoutTile${item.id === preset ? ' layoutTileActive' : ''}`}
              onClick={() => onPreset(item.id)}
            >
              <CourtPreview workers={item.size - 1} />
              {item.size}
              <small>{item.label}</small>
            </button>
          ))}
        </div>
        <p className="swarmHint">
          {counts.coordinator} queen · {counts.builder} builder
          {counts.builder === 1 ? '' : 's'} · {counts.scout} scout
          {counts.scout === 1 ? '' : 's'} · {counts.reviewer} reviewer
          {counts.reviewer === 1 ? '' : 's'} · up to {swarmPlanBudget(preset)} tasks ·{' '}
          {costBand(roster.length)}
        </p>
      </div>
      <div className="wizardSection">
        <span className="wizardLabel">
          Launch mode <span>How much the seats may do</span>
        </span>
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
            <span>Trusted local folders only. Skips every approval.</span>
          </button>
        </div>
      </div>
      <div className="wizardSection">
        <span className="wizardLabel">
          Seats <span>{roster.length} of 12</span>
        </span>
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
              <AgentMark
                id={seat.agentId}
                on
                onClick={() => {
                  const next =
                    detected[(detected.indexOf(seat.agentId) + 1) % detected.length];
                  if (next !== undefined) onSeatAgent(index, next);
                }}
              />
              <strong>{seat.role === 'coordinator' ? 'queen' : seat.role}</strong>
              <select
                value={seat.agentId}
                onChange={(event) =>
                  onSeatAgent(index, event.target.value as BoardAgentId)
                }
              >
                {detected.map((id) => (
                  <option key={id} value={id}>
                    {labelFor(id)}
                  </option>
                ))}
              </select>
              {(SEAT_MODELS[seat.agentId] ?? []).length > 0 ? (
                <select
                  value={seat.model ?? ''}
                  onChange={(event) => onSeatModel(index, event.target.value)}
                >
                  <option value="">Default model</option>
                  {(SEAT_MODELS[seat.agentId] ?? []).map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              ) : null}
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
      </div>
      <div className="wizardSection">
        <span className="wizardLabel">
          Skills <span>Switch on, eye to preview, remove to drop</span>
        </span>
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
                    <div className="swarmSkillHead">
                      <button
                        type="button"
                        className="swarmSkillToggle"
                        onClick={() => onToggleSkill(skill.id)}
                      >
                        <strong>{skill.title}</strong>
                        <span>{skill.detail}</span>
                        <i className={on ? 'swarmSwitch swarmSwitchOn' : 'swarmSwitch'} />
                      </button>
                      <button
                        type="button"
                        className="swarmSkillEye"
                        aria-label={
                          open
                            ? `Hide ${skill.title} directive`
                            : `Show ${skill.title} directive`
                        }
                        aria-expanded={open}
                        onClick={() => setOpenSkill(open ? null : skill.id)}
                      >
                        <EyeIcon />
                      </button>
                    </div>
                    {open ? (
                      <label className="swarmSkillDirective">
                        <span>Agent directive</span>
                        <textarea
                          rows={3}
                          value={skillDirectives[skill.id] ?? skill.directive}
                          onChange={(event) =>
                            onSkillDirective(skill.id, event.target.value)
                          }
                        />
                      </label>
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
    </>
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
    <>
      <h1 id="swarm-setup-title">Review and launch</h1>
      <p className="lede">Name the run, then start the swarm.</p>
      <div className="wizardSection">
        <label className="wizardLabel" htmlFor="swarm-name">
          Swarm name <span>Auto-named if left blank</span>
        </label>
        <input
          id="swarm-name"
          value={swarmName}
          placeholder="Swarm 1"
          onChange={(event) => onName(event.target.value)}
        />
      </div>
      <div className="wizardSection">
        <span className="wizardLabel">Recap</span>
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
              {roster.length} agents — {counts.coordinator} queen · {counts.builder}{' '}
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
          <li>
            <span>Billing</span>
            <strong>
              Seats use the logged-in Claude / Grok / Codex subscription. Chat API keys
              (Anthropic, xAI, OpenRouter) stay in Settings → Providers.
            </strong>
          </li>
        </ul>
      </div>
    </>
  );
}

function CourtPreview({ workers }: { readonly workers: number }): React.JSX.Element {
  return (
    <span className="courtPreview" aria-hidden="true">
      <i className="courtQueen" />
      <span className="courtWorkers">
        {Array.from({ length: workers }, (_, index) => (
          <i key={index} />
        ))}
      </span>
    </span>
  );
}

function EyeIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
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

function droppedPath(file: File): string {
  return 'path' in file && typeof file.path === 'string' && file.path.length > 0
    ? file.path
    : file.name;
}
