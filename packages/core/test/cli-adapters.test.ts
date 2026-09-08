import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BOARD_AGENT_CATALOG } from '@builderhelm/protocol';

import {
  callStructuredAgent,
  CliSwarmPlanner,
  parseAgentUsage,
  parseReviewVerdict,
  gateReviewVerdict,
  swarmSeatArgv,
} from '../src/index.js';

import { describe, expect, it } from 'vitest';

describe('CLI capability adapters', () => {
  it('builds a verified seat command for every advertised permission mode', () => {
    for (const profile of BOARD_AGENT_CATALOG) {
      for (const mode of profile.capabilities.swarmModes) {
        expect(swarmSeatArgv(profile.id, 'ship the task', mode)).toMatchObject({
          binary: profile.command,
        });
      }
    }
  });

  it('enables machine-readable usage output for Claude and Codex seats', () => {
    expect(swarmSeatArgv('claude', 'ship', 'safe')).toEqual({
      binary: 'claude',
      args: ['-p', 'ship', '--output-format', 'json', '--permission-mode', 'plan'],
    });
    expect(swarmSeatArgv('codex', 'ship', 'auto')).toEqual({
      binary: 'codex',
      args: [
        'exec',
        '--json',
        '--sandbox',
        'workspace-write',
        '--approve-for-me',
        'ship',
      ],
    });
  });

  it('keeps provider permission flags and prompts as separate argv values', () => {
    const prompt = `${'x'.repeat(8_000)} 'quoted' "double" $HOME \\n`;
    expect(swarmSeatArgv('grok', prompt, 'auto')).toEqual({
      binary: 'grok',
      args: ['-p', prompt.trim(), '--permission-mode', 'acceptEdits'],
    });
    expect(swarmSeatArgv('gemini', 'ship', 'full').args).toEqual([
      '-p',
      'ship',
      '--skip-trust',
      '--approval-mode',
      'yolo',
    ]);
  });

  it('fails closed when capability metadata does not advertise the requested mode', () => {
    expect(() => swarmSeatArgv('kiro', 'job', 'auto')).toThrow(/no verified headless/);
    expect(() => swarmSeatArgv('cursor', 'job', 'auto')).toThrow(/no verified headless/);
    expect(() => swarmSeatArgv('opencode', 'job', 'safe')).toThrow(
      /does not support safe/,
    );
    expect(() => swarmSeatArgv('kimi', 'job', 'safe')).toThrow(/does not support safe/);
    expect(() => swarmSeatArgv('pi', 'job', 'safe')).toThrow(/does not support safe/);
    expect(() => swarmSeatArgv('pi', 'job', 'full')).toThrow(/does not support full/);
    expect(() => swarmSeatArgv('claude', '   ', 'auto')).toThrow(/must not be empty/);
  });

  it('never puts a bypass flag on a safe seat', () => {
    for (const profile of BOARD_AGENT_CATALOG) {
      if (!profile.capabilities.swarmModes.includes('safe')) continue;
      const joined = swarmSeatArgv(profile.id, 'ship the task', 'safe').args.join(' ');
      expect(joined).not.toMatch(/dangerously|yolo|bypass/i);
    }
  });

  it('fails closed when the reviewer cannot be read or tries to approve secrets', () => {
    expect(() => parseReviewVerdict({ verdict: 'maybe' })).toThrow(/not readable/);
    expect(parseReviewVerdict({ verdict: 'fix', issues: ['nits'] })).toEqual({
      verdict: 'fix',
      issues: ['nits'],
    });
    expect(
      gateReviewVerdict({ verdict: 'approve' }, ['.env', 'src/app.ts']).verdict,
    ).toBe('fix');
  });

  it('parses only usage formats advertised by the selected adapter', () => {
    expect(
      parseAgentUsage(
        'claude',
        JSON.stringify({
          usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 3 },
          total_cost_usd: 0.12,
        }),
      ),
    ).toEqual({ tokensUsed: 17, costUsd: 0.12 });
    expect(
      parseAgentUsage(
        'codex',
        [
          JSON.stringify({ type: 'turn.started' }),
          JSON.stringify({
            type: 'turn.completed',
            usage: { input_tokens: 20, cached_input_tokens: 5, output_tokens: 7 },
          }),
        ].join('\n'),
      ),
    ).toEqual({ tokensUsed: 32, costUsd: 0 });
    expect(parseAgentUsage('gemini', '{"usage":{"total_tokens":99}}')).toEqual({
      tokensUsed: 0,
      costUsd: 0,
    });
  });

  it('normalizes inline and file-based schema output behind one call', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'builderhelm-cli-test-'));
    const executable = join(directory, 'fake-cli.cjs');
    await writeFile(
      executable,
      `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const schemaIndex = args.indexOf('--output-schema');
if (schemaIndex >= 0) JSON.parse(readFileSync(args[schemaIndex + 1], 'utf8'));
const outputIndex = args.indexOf('--output-last-message');
const result = JSON.stringify({ tasks: [{ title: 'one' }] });
if (outputIndex >= 0) writeFileSync(args[outputIndex + 1], result);
else process.stdout.write(JSON.stringify({ structured_output: JSON.parse(result) }));
`,
      { mode: 0o755 },
    );
    await chmod(executable, 0o755);
    try {
      const schema = { type: 'object' };
      await expect(
        callStructuredAgent(
          { agentId: 'claude', cwd: directory, executable },
          'plan',
          schema,
        ),
      ).resolves.toEqual({ tasks: [{ title: 'one' }] });
      await expect(
        callStructuredAgent(
          { agentId: 'codex', cwd: directory, executable },
          'plan',
          schema,
        ),
      ).resolves.toEqual({ tasks: [{ title: 'one' }] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects schema calls when the canonical metadata does not advertise them', async () => {
    await expect(
      callStructuredAgent({ agentId: 'gemini', cwd: process.cwd() }, 'plan', {
        type: 'object',
      }),
    ).rejects.toThrow(/cannot produce schema-constrained output/);
  });

  it('does not substitute a second runtime when the selected planner fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'builderhelm-cli-test-'));
    // Simulated quota outage: the selected CLI exits 1.
    const failer = join(directory, 'primary-fails.cjs');
    await writeFile(failer, `#!/usr/bin/env node\nprocess.exit(1);\n`, {
      mode: 0o755,
    });

    const planner = new CliSwarmPlanner({
      agentId: 'claude',
      cwd: directory,
      executable: failer,
    });
    await expect(
      planner.plan({
        mission: 'Write a one-line file named ok.txt containing the word ok.',
        snapshot: { files: [] },
        maxTasks: 3,
      }),
    ).rejects.toThrow(/Command failed/);

    await rm(directory, { recursive: true, force: true });
  });

  it('passes a selected model into seat argv and runs default when none', () => {
    // opencode is the regression case: a hardcoded model used to ride every seat.
    expect(swarmSeatArgv('opencode', 'ship', 'auto').args).toEqual(['run', 'ship']);
    expect(
      swarmSeatArgv('opencode', 'ship', 'auto', {
        model: 'openrouter/free/arbitrary',
        effort: null,
        accountRef: null,
      }).args,
    ).toEqual(['run', '-m', 'openrouter/free/arbitrary', 'ship']);
    expect(
      swarmSeatArgv('claude', 'ship', 'safe', {
        model: 'claude-sonnet-4-5',
        effort: null,
        accountRef: null,
      }).args,
    ).toContain('claude-sonnet-4-5');
  });

  it('refuses selected models on runtimes with no verified flag, loudly', () => {
    for (const agentId of ['grok', 'kimi', 'omp', 'pi'] as const) {
      expect(() =>
        swarmSeatArgv(agentId, 'ship', 'auto', {
          model: 'some-model',
          effort: null,
          accountRef: null,
        }),
      ).toThrow(/cannot set an explicit model/);
    }
  });

  it('refuses selected effort everywhere until a flag is verified', () => {
    expect(() =>
      swarmSeatArgv('claude', 'ship', 'safe', {
        model: null,
        effort: 'high',
        accountRef: null,
      }),
    ).toThrow(/cannot set an explicit effort/);
  });
});
