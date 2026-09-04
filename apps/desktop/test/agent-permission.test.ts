/**
 * The approval loop, which is the part that fails silently if it is wrong.
 *
 * An agent blocks a tool call on an answer, and Claude Code auto-denies rather
 * than waiting, so a request that reaches nobody disables the agent instead of
 * hanging it. These cover the paths a person never sees working: a remembered
 * rule answering without a prompt, an unanswered request failing closed, and a
 * rule surviving the process that created it.
 */
import { describe, expect, it } from 'vitest';

import { PermissionRules } from '../src/main/acp/permission-rules.js';

/** Stands in for SettingsRepository, whose surface is exactly these two calls. */
function memoryStore(): { read(key: string): string | undefined; write(key: string, valueJson: string): void } {
  const rows = new Map<string, string>();
  return {
    read: (key) => rows.get(key),
    write: (key, valueJson) => {
      rows.set(key, valueJson);
    },
  };
}

describe('remembered approval rules', () => {
  it('has nothing to say until someone has been asked', () => {
    const rules = new PermissionRules(memoryStore());
    expect(rules.lookup('/w', 'edit')).toBeNull();
  });

  it('remembers an always decision and applies it to that workspace only', () => {
    const rules = new PermissionRules(memoryStore());
    rules.remember('/w', 'edit', 'allow-always');
    expect(rules.lookup('/w', 'edit')).toBe('allow-always');
    // Granting edits in one checkout must not grant them in another; the
    // directory is the unit of trust a person reasons about.
    expect(rules.lookup('/other', 'edit')).toBeNull();
  });

  it('keeps tool kinds separate, so allowing edits does not allow commands', () => {
    const rules = new PermissionRules(memoryStore());
    rules.remember('/w', 'edit', 'allow-always');
    expect(rules.lookup('/w', 'execute')).toBeNull();
  });

  it('ignores a once decision, which is not a rule', () => {
    const rules = new PermissionRules(memoryStore());
    rules.remember('/w', 'edit', 'allow-once');
    rules.remember('/w', 'execute', 'reject-once');
    expect(rules.lookup('/w', 'edit')).toBeNull();
    expect(rules.lookup('/w', 'execute')).toBeNull();
  });

  it('remembers a rejection, so a refusal also stops being asked', () => {
    const rules = new PermissionRules(memoryStore());
    rules.remember('/w', 'execute', 'reject-always');
    expect(rules.lookup('/w', 'execute')).toBe('reject-always');
  });

  it('lets a later decision replace an earlier one', () => {
    const rules = new PermissionRules(memoryStore());
    rules.remember('/w', 'edit', 'reject-always');
    rules.remember('/w', 'edit', 'allow-always');
    expect(rules.lookup('/w', 'edit')).toBe('allow-always');
    expect(rules.list('/w')).toHaveLength(1);
  });

  it('forgets on request', () => {
    const rules = new PermissionRules(memoryStore());
    rules.remember('/w', 'edit', 'allow-always');
    rules.forget('/w', 'edit');
    expect(rules.lookup('/w', 'edit')).toBeNull();
  });

  it('survives the process that stored it', () => {
    const store = memoryStore();
    new PermissionRules(store).remember('/w', 'edit', 'allow-always');
    // A fresh instance over the same storage is what a restart looks like.
    expect(new PermissionRules(store).lookup('/w', 'edit')).toBe('allow-always');
  });

  it('asks again rather than throwing when storage is corrupt', () => {
    const store = memoryStore();
    store.write('agent.permission-rules', '{not json');
    const rules = new PermissionRules(store);
    // Losing a remembered approval costs one prompt. Throwing here would block
    // every tool call in the workspace, which is far worse.
    expect(rules.lookup('/w', 'edit')).toBeNull();
    expect(() => rules.remember('/w', 'edit', 'allow-always')).not.toThrow();
    expect(rules.lookup('/w', 'edit')).toBe('allow-always');
  });

  it('discards a stored shape it no longer understands', () => {
    const store = memoryStore();
    store.write('agent.permission-rules', JSON.stringify([{ cwd: '/w', verdict: 'yes' }]));
    expect(new PermissionRules(store).lookup('/w', 'edit')).toBeNull();
  });
});
