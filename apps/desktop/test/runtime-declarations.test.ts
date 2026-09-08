import { describe, expect, it } from 'vitest';

import type { AgentDescriptor } from '@builderhelm/protocol';

import { knownAcpAgents } from '../src/main/acp/registry.js';
import { runtimeDeclarations } from '../src/main/runtime-capabilities.js';

function registryWith(configured: readonly AgentDescriptor[]): {
  configured: () => AgentDescriptor[];
} {
  return { configured: () => [...configured] };
}

describe('runtime declarations', () => {
  it('declares every catalog command as a pty transport, except the shell', () => {
    const declarations = runtimeDeclarations(registryWith([]));
    const pty = declarations.filter((entry) => entry.transport === 'pty');

    expect(pty.map((entry) => entry.id)).not.toContain('shell');
    expect(pty.every((entry) => entry.command.length > 0)).toBe(true);
  });

  it('verifies orchestration readiness only where the smoke proves it', () => {
    const pty = runtimeDeclarations(registryWith([])).filter(
      (entry) => entry.transport === 'pty',
    );

    for (const entry of pty) {
      if (entry.id === 'claude' || entry.id === 'codex') {
        expect(entry.verified).toBe('orchestration-ready');
        expect(entry.evidence).toContain('cli-real-smoke');
      } else {
        expect(entry.verified).toBeNull();
        expect(entry.evidence).toBeNull();
      }
    }
  });

  it('marks only locally verified ACP invocations as structured chat', () => {
    const acp = runtimeDeclarations(registryWith([])).filter(
      (entry) => entry.transport === 'acp',
    );
    const byId = new Map(acp.map((entry) => [entry.id, entry]));

    expect(byId.get('gemini')?.verified).toBe('structured-chat');
    expect(byId.get('opencode')?.verified).toBe('structured-chat');
    expect(byId.get('kimi')?.verified).toBe('structured-chat');
    // Wrapper commands documented by their projects, never run here.
    expect(byId.get('claude')?.verified).toBeNull();
    expect(byId.get('codex')?.verified).toBeNull();
    expect(byId.get('claude')?.command).toBe('claude-agent-acp');
    expect(byId.get('codex')?.command).toBe('codex-acp');
  });

  it('lets a configured agent replace its known declaration', () => {
    const configured: AgentDescriptor = {
      id: 'gemini',
      label: 'Gemini (mine)',
      command: '/opt/gemini',
      args: ['--acp'],
    };
    const acp = runtimeDeclarations(registryWith([configured])).filter(
      (entry) => entry.transport === 'acp',
    );
    const gemini = acp.filter((entry) => entry.id === 'gemini');

    expect(gemini).toHaveLength(1);
    expect(gemini[0]).toMatchObject({
      command: '/opt/gemini',
      configured: true,
      verified: 'structured-chat',
    });
  });

  it('covers every known ACP agent exactly once', () => {
    const acp = runtimeDeclarations(registryWith([])).filter(
      (entry) => entry.transport === 'acp',
    );
    expect(acp.map((entry) => entry.id).sort()).toEqual(
      knownAcpAgents()
        .map((entry) => entry.id)
        .sort(),
    );
  });
});
