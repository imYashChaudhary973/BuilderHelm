import { NoSleepService, type NoSleepStore } from '@builderhelm/core';
import { describe, expect, it, vi } from 'vitest';

import { PowerController } from '../src/main/no-sleep.js';

type BlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

// Hoisted so the mock factory can reach it: the factory runs while the module
// graph loads, before this file's own initializers.
const blocker = vi.hoisted(() => ({
  started: [] as string[],
  stopped: [] as number[],
  live: null as number | null,
  nextId: 1,
}));

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start(type: string) {
      blocker.started.push(type);
      blocker.live = blocker.nextId;
      blocker.nextId += 1;
      return blocker.live;
    },
    stop(id: number) {
      blocker.stopped.push(id);
      if (blocker.live === id) blocker.live = null;
      return true;
    },
    isStarted(id: number) {
      return blocker.live === id;
    },
  },
}));

interface Harness {
  readonly controller: PowerController;
  readonly service: NoSleepService;
}

const logger = { info() {}, warn() {} };

function memoryStore(): NoSleepStore {
  const rows = new Map<string, string>();
  return {
    read(key) {
      return rows.get(key);
    },
    write(key, valueJson) {
      rows.set(key, valueJson);
    },
  };
}

function harness(): Harness {
  blocker.started.length = 0;
  blocker.stopped.length = 0;
  blocker.live = null;
  const service = new NoSleepService(memoryStore());
  return { controller: new PowerController(service, logger), service };
}

const started = (): BlockerType[] => blocker.started as BlockerType[];

describe('PowerController', () => {
  it('holds nothing while off', () => {
    const { controller } = harness();
    expect(controller.sync()).toEqual({
      mode: 'off',
      blockerActive: false,
      agentActive: false,
    });
    expect(started()).toEqual([]);
  });

  it('keeps the display awake for on', () => {
    const { controller, service } = harness();
    service.set('on', false);
    expect(controller.sync().blockerActive).toBe(true);
    expect(started()).toEqual(['prevent-display-sleep']);
  });

  it('takes the blocker only while an agent works, and releases it after', () => {
    const { controller, service } = harness();
    service.set('agent', false);
    expect(controller.sync().blockerActive).toBe(false);
    expect(started()).toEqual([]);

    service.setAgentActive(true);
    expect(controller.sync()).toMatchObject({ blockerActive: true, agentActive: true });
    // Agent mode blocks idle sleep but leaves the screen alone.
    expect(started()).toEqual(['prevent-app-suspension']);

    service.setAgentActive(false);
    expect(controller.sync().blockerActive).toBe(false);
    expect(blocker.stopped).toHaveLength(1);
  });

  it('swaps the blocker type when the mode changes', () => {
    const { controller, service } = harness();
    service.set('agent', false);
    service.setAgentActive(true);
    controller.sync();
    service.set('on', false);
    controller.sync();
    expect(started()).toEqual(['prevent-app-suspension', 'prevent-display-sleep']);
    // Only one blocker may exist, so the first is released first.
    expect(blocker.stopped).toHaveLength(1);
  });

  it('releases the blocker on dispose so the assertion does not outlive the app', () => {
    const { controller, service } = harness();
    service.set('on', false);
    controller.sync();
    controller.dispose();
    expect(blocker.stopped).toHaveLength(1);
    expect(blocker.live).toBeNull();
  });

  it('does not restart a blocker it already holds', () => {
    const { controller, service } = harness();
    service.set('on', false);
    controller.sync();
    controller.sync();
    controller.sync();
    expect(started()).toHaveLength(1);
    expect(blocker.stopped).toHaveLength(0);
  });
});
