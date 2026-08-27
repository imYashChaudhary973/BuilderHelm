import { describe, expect, it } from 'vitest';

import { parseAgentUsage, parseCliFailure } from '../src/swarm/agent-usage.js';
import {
  buildPlanPrompt,
  firstSuccessfulPlan,
  normalizeSwarmPlan,
  pinFoundation,
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

it('tells the planner to pin later tasks on a foundation for empty repos', () => {
  const prompt = buildPlanPrompt({
    mission: 'build a todo app',
    snapshot: { files: ['README.md'], truncated: false },
    maxTasks: 7,
    roster: 'coordinator/claude, builder/grok',
  });

  expect(prompt).toContain('Task 0 MUST be the foundation (shell, package, entry)');
  expect(prompt).toContain('Every later task MUST set dependsOn: [0]');
});

describe('pinFoundation', () => {
  const three = () =>
    normalizeSwarmPlan(
      {
        tasks: [
          { title: 'Scaffold', files: ['package.json'] },
          { title: 'App', files: ['src/app.ts'] },
          { title: 'UI', files: ['src/ui.ts'] },
        ],
      },
      10,
    );

  it('pins later tasks onto 0 for an empty snapshot', () => {
    const plan = pinFoundation(three(), { files: [], truncated: false });
    expect(plan[1]!.dependsOn).toContain(0);
    expect(plan[2]!.dependsOn).toContain(0);
  });

  it('pins later tasks onto 0 for docs-only snapshots', () => {
    const plan = pinFoundation(three(), {
      files: ['README.md', 'docs/guide.md'],
      truncated: false,
    });
    expect(plan[1]!.dependsOn).toContain(0);
    expect(plan[2]!.dependsOn).toContain(0);
  });
  it('leaves a plan alone when the snapshot already has source', () => {
    const tasks = three();
    const plan = pinFoundation(tasks, { files: ['src/main.ts'], truncated: false });
    expect(plan).toEqual(tasks);
    expect(plan[1]!.dependsOn).toEqual([]);
    expect(plan[2]!.dependsOn).toEqual([]);
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

  it('puts the swarm digest after the task marker so the prefix can cache', () => {
    const prompt = buildSeatPrompt({
      ...base,
      swarmDigest:
        'Swarm roster: builder/grok.\nWork already landed by other seats (do not redo or contradict it):\n- Alpha: landed',
      task: { title: 'Beta', detail: null, files: ['src/b.ts'] },
    });
    const marker = prompt.indexOf(SWARM_PROMPT_TASK_MARKER);
    const prefix = prompt.slice(0, marker);
    const tail = prompt.slice(marker);

    expect(prefix).not.toContain('Swarm roster');
    expect(prefix).not.toContain('Alpha');
    expect(tail).toContain('Swarm roster: builder/grok.');
    expect(tail).toContain('Alpha');
    expect(tail).toContain('Beta');
  });

  it('keeps the prefix stable when the digest changes after a land', () => {
    const first = buildSeatPrompt({
      ...base,
      swarmDigest: 'Swarm roster: builder/grok.',
      task: { title: 'Alpha', detail: null, files: ['src/a.ts'] },
    });
    const second = buildSeatPrompt({
      ...base,
      swarmDigest:
        'Swarm roster: builder/grok.\nWork already landed by other seats (do not redo or contradict it):\n- Alpha: landed',
      task: { title: 'Beta', detail: null, files: ['src/b.ts'] },
    });
    const prefixOf = (prompt: string) =>
      prompt.slice(0, prompt.indexOf(SWARM_PROMPT_TASK_MARKER));
    expect(prefixOf(first)).toBe(prefixOf(second));
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

describe('parseCliFailure', () => {
  it('names a grok 402 usage error', () => {
    expect(
      parseCliFailure(
        '{"type":"error","message":"API error (status 402 Payment Required): Grok Build usage balance exhausted"}',
      ),
    ).toBe('Grok usage balance exhausted (402)');
  });

  it('returns the last non-empty lines otherwise', () => {
    expect(parseCliFailure('hello\n\ncommand not found')).toBe('hello command not found');
  });
});

describe('firstSuccessfulPlan', () => {
  const request = {
    mission: 'Create a Minecraft Game.',
    snapshot: { files: [], truncated: false },
    maxTasks: 8,
    roster: 'coordinator/grok',
  };

  it('returns the first planner that yields tasks', async () => {
    const planned = await firstSuccessfulPlan(
      [
        {
          async plan() {
            throw new Error('agent returned no JSON object');
          },
        },
        {
          async plan() {
            return [
              { title: 'from claude', detail: null, files: ['a.ts'], dependsOn: [] },
            ];
          },
        },
      ],
      request,
    );
    expect(planned[0]!.title).toBe('from claude');
  });

  it('pins later tasks onto 0 when a planner omits dependsOn on an empty repo', async () => {
    const planned = await firstSuccessfulPlan(
      [
        {
          async plan() {
            return [
              { title: 'Scaffold', detail: null, files: ['package.json'], dependsOn: [] },
              { title: 'App', detail: null, files: ['src/app.ts'], dependsOn: [] },
              { title: 'UI', detail: null, files: ['src/ui.ts'], dependsOn: [] },
            ];
          },
        },
      ],
      request,
    );
    expect(planned[1]!.dependsOn).toContain(0);
    expect(planned[2]!.dependsOn).toContain(0);
  });

  it('falls back to one foundation task when every planner throws', async () => {
    const errors: string[] = [];
    const planned = await firstSuccessfulPlan(
      [
        {
          async plan() {
            throw new Error('agent returned no JSON object');
          },
        },
      ],
      request,
      (message) => errors.push(message),
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]!.title).toContain('Minecraft');
    expect(errors).toEqual(['agent returned no JSON object']);
  });
});
