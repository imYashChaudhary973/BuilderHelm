import { createId } from '@builderhelm/shared';
import { describe, expect, it } from 'vitest';

import { createWorkToolRegistry, PermissionEngine } from '../src/index.js';

describe('tool registry and permission engine', () => {
  it('validates stable tool inputs and exposes provider-safe model names', () => {
    const registry = createWorkToolRegistry();
    const projectId = createId();

    expect(
      registry.parseInput('task.create', {
        projectId,
        title: 'Benchmark sync',
        priority: 'high',
      }),
    ).toMatchObject({
      projectId,
      title: 'Benchmark sync',
      priority: 'high',
      dueAt: null,
    });
    expect(registry.modelDefinitions().map((tool) => tool.name)).toContain('task_create');
    expect(() => registry.parseInput('task.create', { projectId, title: '' })).toThrow(
      'arguments are invalid',
    );
  });

  it('requires explicit approval for writes unless a narrow policy allows them', () => {
    const engine = new PermissionEngine();
    expect(
      engine.evaluate({
        risk: 'read',
        policy: 'ask',
        explicitApproval: false,
        rollbackSupport: 'none',
      }),
    ).toBe('allow');
    expect(
      engine.evaluate({
        risk: 'reversible_write',
        policy: 'ask',
        explicitApproval: false,
        rollbackSupport: 'manual',
      }),
    ).toBe('require_approval');
    expect(
      engine.evaluate({
        risk: 'reversible_write',
        policy: 'auto_approve',
        explicitApproval: false,
        rollbackSupport: 'manual',
      }),
    ).toBe('allow');
    expect(
      engine.evaluate({
        risk: 'reversible_write',
        policy: 'deny',
        explicitApproval: true,
        rollbackSupport: 'automatic',
      }),
    ).toBe('deny');
    expect(
      engine.evaluate({
        risk: 'reversible_write',
        policy: 'auto_approve',
        explicitApproval: false,
        rollbackSupport: 'none',
      }),
    ).toBe('require_approval');
    expect(() =>
      engine.validatePolicy('external_side_effect', 'auto_approve', 'none'),
    ).toThrow('cannot be auto-approved');
    expect(() =>
      engine.validatePolicy('reversible_write', 'auto_approve', 'none'),
    ).toThrow('cannot be auto-approved');
  });
});
