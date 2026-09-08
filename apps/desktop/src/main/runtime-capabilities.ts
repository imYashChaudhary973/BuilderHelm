/**
 * Where the runtime capability matrix comes from.
 *
 * Verification is engineering knowledge with citations, so it lives in code:
 * a declaration may only carry a verified tier when a checked path in this
 * repository has actually exercised that transport — a test, the real-CLI
 * smoke (BUILDERHELM_CLI_SMOKE=1), or a locally verified invocation noted in
 * the ACP registry. Everything found on PATH without such evidence stays
 * `untested`, and unsupported never masquerades as functional.
 */
import {
  BOARD_AGENT_CATALOG,
  type RuntimeTransportDeclaration,
} from '@builderhelm/protocol';
import { RuntimeCapabilityService } from '@builderhelm/core';

import { knownAcpAgents, type AgentRegistry } from './acp/registry.js';

/**
 * ACP invocations verified locally, matching the registry's own notes:
 * `gemini --acp`, `opencode acp`, and `kimi acp` run structured sessions.
 * The wrapper commands for Claude, Codex, and Grok are documented by their
 * projects, not verified here, so they stay untested.
 */
const VERIFIED_ACP: ReadonlySet<string> = new Set(['gemini', 'opencode', 'kimi']);

/**
 * Headless structured output with resume and usage reporting, proven by the
 * gated real-CLI smoke (`packages/core/test/cli-real-smoke.test.ts`).
 */
const ORCHESTRATION_READY: ReadonlySet<string> = new Set(['claude', 'codex']);

/**
 * Every runtime BuilderHelm knows: the board catalog's PTY path plus each ACP
 * declaration the registry offers or the person configured. Configured-but-
 * missing commands stay in the list so the matrix shows `unavailable` instead
 * of quietly dropping them.
 */
export function runtimeDeclarations(
  registry: Pick<AgentRegistry, 'configured'>,
): RuntimeTransportDeclaration[] {
  const declarations: RuntimeTransportDeclaration[] = [];

  for (const entry of BOARD_AGENT_CATALOG) {
    if (entry.command.length === 0) continue;
    // Terminal for everyone; the real-CLI smoke additionally proves Claude and
    // Codex end to end, which is the orchestration-ready bar.
    const orchestration = ORCHESTRATION_READY.has(entry.id);
    declarations.push({
      id: entry.id,
      label: entry.label,
      transport: 'pty',
      command: entry.command,
      args: [],
      verified: orchestration ? 'orchestration-ready' : null,
      evidence: orchestration
        ? 'Verified headless with schema output by cli-real-smoke.test.ts.'
        : null,
      configured: false,
    });
  }

  // A configured agent replaces its known entry: the person's command wins,
  // and a missing configured command still shows as `unavailable`.
  const configured = new Map(registry.configured().map((agent) => [agent.id, agent]));
  for (const known of knownAcpAgents()) {
    if (configured.has(known.id)) continue;
    const verified = VERIFIED_ACP.has(known.id);
    declarations.push({
      id: known.id,
      label: known.label,
      transport: 'acp',
      command: known.command,
      args: [...known.args],
      verified: verified ? 'structured-chat' : null,
      evidence: verified
        ? 'ACP invocation verified locally against the installed CLI.'
        : null,
      configured: false,
    });
  }
  for (const agent of configured.values()) {
    declarations.push({
      id: agent.id,
      label: agent.label,
      transport: 'acp',
      command: agent.command,
      args: [...agent.args],
      verified: VERIFIED_ACP.has(agent.id) ? 'structured-chat' : null,
      evidence: null,
      configured: true,
    });
  }

  return declarations;
}

export function createRuntimeCapabilityService(
  registry: Pick<AgentRegistry, 'configured'>,
): RuntimeCapabilityService {
  return new RuntimeCapabilityService(runtimeDeclarations(registry));
}
