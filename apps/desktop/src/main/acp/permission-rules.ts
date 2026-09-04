/**
 * Remembered approval decisions, scoped to a workspace.
 *
 * "Always allow" has to outlive the agent process, and it cannot be delegated to
 * the agent: several agents do not offer `allow_always` at all, and none of them
 * agree on how long "always" lasts. So the rule is ours, and the agent only ever
 * receives a once-decision it does understand.
 *
 * Scoped to a directory because that is the unit of trust a person reasons
 * about. Granting edits in a scratch repository must not grant them everywhere.
 *
 * ponytail: keyed on workspace plus tool kind, so "always allow execute" covers
 * every command in that workspace rather than a specific one. Narrowing to a
 * command pattern needs a real matcher and a UI to inspect it; revisit when
 * someone wants to allow `git status` without allowing `rm`.
 */
import type { AgentPermissionDecision, AgentToolKind } from '@builderhelm/protocol';
import { z } from 'zod';

const SETTINGS_KEY = 'agent.permission-rules';

/** Only the sticky decisions are storable; a once-decision is not a rule. */
const STORABLE = ['allow-always', 'reject-always'] as const;
type StorableDecision = (typeof STORABLE)[number];

const ruleSchema = z
  .object({
    cwd: z.string().min(1),
    kind: z.string().min(1),
    decision: z.enum(STORABLE),
  })
  .strict();

const rulesSchema = z.array(ruleSchema);

export interface PermissionRuleStore {
  read(key: string): string | undefined;
  write(key: string, valueJson: string, updatedAt: string): void;
}

export class PermissionRules {
  constructor(private readonly settings: PermissionRuleStore) {}

  /**
   * The remembered decision for this workspace and tool kind, or null when the
   * person has not been asked yet.
   */
  lookup(cwd: string, kind: AgentToolKind): StorableDecision | null {
    const rules = this.load();
    const match = rules.find((rule) => rule.cwd === cwd && rule.kind === kind);
    return match === undefined ? null : match.decision;
  }

  /** Ignores once-decisions, so callers can pass any decision unconditionally. */
  remember(cwd: string, kind: AgentToolKind, decision: AgentPermissionDecision): void {
    if (decision !== 'allow-always' && decision !== 'reject-always') return;
    const rules = this.load().filter((rule) => !(rule.cwd === cwd && rule.kind === kind));
    rules.push({ cwd, kind, decision });
    this.settings.write(SETTINGS_KEY, JSON.stringify(rules), new Date().toISOString());
  }

  forget(cwd: string, kind: AgentToolKind): void {
    const rules = this.load().filter((rule) => !(rule.cwd === cwd && rule.kind === kind));
    this.settings.write(SETTINGS_KEY, JSON.stringify(rules), new Date().toISOString());
  }

  list(cwd: string): { kind: string; decision: StorableDecision }[] {
    return this.load()
      .filter((rule) => rule.cwd === cwd)
      .map((rule) => ({ kind: rule.kind, decision: rule.decision }));
  }

  private load(): z.infer<typeof ruleSchema>[] {
    const raw = this.settings.read(SETTINGS_KEY);
    if (raw === undefined) return [];
    try {
      const parsed = rulesSchema.safeParse(JSON.parse(raw));
      // A corrupt or outdated blob is discarded rather than throwing: losing a
      // remembered approval means asking again, which is safe. Failing here
      // would block every tool call in the workspace.
      return parsed.success ? [...parsed.data] : [];
    } catch {
      return [];
    }
  }
}
