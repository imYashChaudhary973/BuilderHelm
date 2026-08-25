import { describe, expect, it } from 'vitest';

import { parseAgentUsage } from '../src/swarm/agent-usage.js';
import {
  buildPlanPrompt,
  normalizeSwarmPlan,
  swarmPlanBudget,
} from '../src/swarm/swarm-planning.js';
import { buildSeatPrompt, SWARM_PROMPT_TASK_MARKER } from '../src/swarm/swarm-prompt.js';

describe('normalizeSwarmPlan', () => {
  it('gives every file a single owner', () => {
    const plan = normalizeSwarmPlan(
      {
        tasks: [
          { title: 'Add parser', files: ['src/parse.ts', 'src/shared.ts'] },
          { title: 'Add printer', files: ['src/print.ts', 'src/shared.ts'] },
        ],
      },
      10,
    );

    expect(plan[0]!.files).toEqual(['src/parse.ts', 'src/shared.ts']);
    expect(plan[1]!.files).toEqual(['src/print.ts']);
  });

  it('drops a task whose files were all claimed already', () => {
    const plan = normalizeSwarmPlan(
      {
        tasks: [
          { title: 'Own it', files: ['src/a.ts'] },
          { title: 'Duplicate', files: ['src/a.ts'] },
          { title: 'Fresh', files: ['src/b.ts'] },
        ],
      },
      10,
    );

    expect(plan.map((task) => task.title)).toEqual(['Own it', 'Fresh']);
  });

  it('caps tasks at the preset budget', () => {
    const plan = normalizeSwarmPlan(
      {
        tasks: Array.from({ length: 12 }, (_, index) => ({
          title: `Task ${index}`,
          files: [`src/f${index}.ts`],
        })),
      },
      swarmPlanBudget('skiff'),
    );

    expect(plan).toHaveLength(3);
  });

  it('keeps dependencies a DAG by allowing earlier edges only', () => {
    const plan = normalizeSwarmPlan(
      {
        tasks: [
          { title: 'First', files: ['a.ts'], dependsOn: [1, 0, 99] },
          { title: 'Second', files: ['b.ts'], dependsOn: [0] },
        ],
      },
      10,
    );

    expect(plan[0]!.dependsOn).toEqual([]);
    expect(plan[1]!.dependsOn).toEqual([0]);
  });

  it('rejects output that is not a plan', () => {
    expect(() => normalizeSwarmPlan({ tasks: [] }, 5)).toThrow();
    expect(() => normalizeSwarmPlan({ nope: true }, 5)).toThrow();
  });

  it('asks for file ownership in the planning prompt', () => {
    const prompt = buildPlanPrompt({
      mission: 'add retries',
      snapshot: { files: ['src/a.ts'], truncated: true },
      maxTasks: 4,
      roster: 'coordinator/claude, builder/grok',
    });

    expect(prompt).toContain('at most 4 independent tasks');
    expect(prompt).toContain('No two tasks may share a file');
    expect(prompt).toContain('add retries');
    expect(prompt).toContain('(truncated)');
    expect(prompt).toContain('coordinator/claude, builder/grok');
    expect(prompt).toContain('Do not invent roles');
  });
});

describe('buildSeatPrompt', () => {
  const base = {
    role: 'builder' as const,
    mission: 'add retries to the uploader',
    skills: [{ title: 'Test-Driven', directive: 'Write a failing test first.' }],
    directives: [] as string[],
  };

  it('keeps the cacheable prefix identical across tasks in a run', () => {
    const first = buildSeatPrompt({
      ...base,
      task: { title: 'Task one', detail: null, files: ['src/one.ts'] },
    });
    const second = buildSeatPrompt({
      ...base,
      task: { title: 'Task two', detail: 'must retry twice', files: ['src/two.ts'] },
    });

    const prefixOf = (prompt: string) =>
      prompt.slice(0, prompt.indexOf(SWARM_PROMPT_TASK_MARKER));
    expect(prefixOf(first)).toBe(prefixOf(second));
    expect(prefixOf(first)).toContain('add retries to the uploader');
    expect(prefixOf(first)).toContain('Write a failing test first.');
  });

  it('puts task, ownership, and fresh directives after the marker', () => {
    const prompt = buildSeatPrompt({
      ...base,
      task: { title: 'Wire retries', detail: 'three attempts', files: ['src/up.ts'] },
      directives: ['skip the docs for now'],
    });
    const tail = prompt.slice(prompt.indexOf(SWARM_PROMPT_TASK_MARKER));

    expect(tail).toContain('Wire retries');
    expect(tail).toContain('three attempts');
    expect(tail).toContain('- src/up.ts');
    expect(tail).toContain('skip the docs for now');
  });

  it('puts the swarm digest in the prefix, not the task tail', () => {
    const prompt = buildSeatPrompt({
      ...base,
      swarmDigest:
        'Swarm roster: builder/grok.\nWork already landed by other seats (do not redo or contradict it):\n- Alpha: landed',
      task: { title: 'Beta', detail: null, files: ['src/b.ts'] },
    });
    const marker = prompt.indexOf(SWARM_PROMPT_TASK_MARKER);
    const prefix = prompt.slice(0, marker);
    const tail = prompt.slice(marker);

    expect(prefix).toContain('Swarm roster: builder/grok.');
    expect(prefix).toContain('Alpha');
    expect(tail).not.toContain('Swarm roster');
    expect(tail).toContain('Beta');
  });
});

describe('parseAgentUsage', () => {
  it('reads claude json output', () => {
    const usage = parseAgentUsage(
      JSON.stringify({
        type: 'result',
        total_cost_usd: 0.0342,
        usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 500 },
      }),
    );

    expect(usage.tokensUsed).toBe(2000);
    expect(usage.costUsd).toBeCloseTo(0.0342);
  });

  it('reads streamed jsonl usage events and keeps the highest totals', () => {
    const usage = parseAgentUsage(
      [
        '{"type":"token_count","usage":{"total_tokens":800}}',
        'not json at all',
        '{"type":"token_count","usage":{"total_tokens":1500},"cost_usd":0.01}',
      ].join('\n'),
    );

    expect(usage.tokensUsed).toBe(1500);
    expect(usage.costUsd).toBeCloseTo(0.01);
  });

  it('meters unparseable output as zero instead of throwing', () => {
    expect(parseAgentUsage('plain terminal noise')).toEqual({
      tokensUsed: 0,
      costUsd: 0,
    });
  });
});
