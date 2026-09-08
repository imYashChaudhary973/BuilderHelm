import { BOARD_AGENT_CATALOG } from '../src/board.js';
import {
  accessFromConfig,
  hostAllowsFsWrite,
  hostPermissionForKind,
  launchModeAxes,
  resolveAgentPermission,
  runtimeModeEnforcement,
} from '../src/security-modes.js';
import { describe, expect, it } from 'vitest';

describe('security mode matrix', () => {
  it('splits safe/auto/full into execution, access, and approval', () => {
    expect(launchModeAxes('safe')).toEqual({
      execution: 'plan',
      access: 'read',
      approval: 'ask',
    });
    expect(launchModeAxes('auto')).toEqual({
      execution: 'build',
      access: 'workspace',
      approval: 'accept-edits',
    });
    expect(launchModeAxes('full')).toEqual({
      execution: 'build',
      access: 'full',
      approval: 'bypass',
    });
  });

  it('does not advertise a swarm mode the host cannot identify', () => {
    for (const entry of BOARD_AGENT_CATALOG) {
      for (const mode of entry.capabilities.swarmModes) {
        expect(runtimeModeEnforcement(entry.id, mode)).not.toBe('unsupported');
      }
    }
  });

  it('never treats an unknown ACP chip as full access', () => {
    expect(accessFromConfig([])).toBe('ask');
    expect(accessFromConfig([{ category: 'mode', value: 'mystery' }])).toBe('ask');
    expect(accessFromConfig([{ category: 'mode', value: 'plan' }])).toBe('read');
    expect(accessFromConfig([{ category: 'mode', value: 'acceptEdits' }])).toBe(
      'workspace',
    );
    expect(accessFromConfig([{ category: 'mode', value: 'bypassPermissions' }])).toBe(
      'full',
    );
  });

  it('enforces Plan as no edits and Accept-edits as files only', () => {
    expect(hostAllowsFsWrite('read')).toBe(false);
    expect(hostAllowsFsWrite('ask')).toBe(true);
    expect(hostPermissionForKind('read', 'edit')).toBe('deny');
    expect(hostPermissionForKind('read', 'execute')).toBe('deny');
    expect(hostPermissionForKind('workspace', 'edit')).toBe('allow');
    expect(hostPermissionForKind('workspace', 'execute')).toBe('ask');
    expect(hostPermissionForKind('workspace', 'fetch')).toBe('ask');
    expect(hostPermissionForKind('ask', 'edit')).toBe('ask');
    expect(hostPermissionForKind('ask', 'read')).toBe('ask');
  });

  it('lets Plan beat a remembered always-allow, and never auto-allows execute', () => {
    expect(
      resolveAgentPermission({
        access: 'read',
        kind: 'edit',
        remembered: 'allow-always',
      }),
    ).toBe('reject-once');
    expect(
      resolveAgentPermission({
        access: 'workspace',
        kind: 'execute',
        remembered: null,
      }),
    ).toBe('ask');
    expect(
      resolveAgentPermission({
        access: 'workspace',
        kind: 'edit',
        remembered: null,
      }),
    ).toBe('allow-once');
  });
});
