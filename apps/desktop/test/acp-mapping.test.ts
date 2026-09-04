/**
 * The ACP mapping is where fidelity is lost, so it is tested against the shapes
 * real agents actually send rather than the shapes the spec permits.
 *
 * Every payload here was captured from `gemini --acp` or `opencode acp`, or is
 * the documented shape for a variant those two do not emit.
 */
import { describe, expect, it } from 'vitest';

import {
  choosePermissionOption,
  mapCapabilities,
  mapConfigOptions,
  mapContent,
  mapPermissionOptions,
  mapPlan,
  mapStopReason,
  mapToolCall,
  mapUsage,
} from '../src/main/acp/mapping.js';

describe('ACP capability mapping', () => {
  it('reads presence-marked capabilities rather than truthiness', () => {
    // Captured from `opencode acp`: optional capabilities are marked by an empty
    // object, so a truthiness check would report resume as unsupported.
    const initialize = {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { embeddedContext: true, image: true },
        sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
      },
    };
    expect(mapCapabilities(initialize)).toEqual({
      loadSession: true,
      resumeSession: true,
      promptImage: true,
      promptAudio: false,
      promptEmbeddedContext: true,
    });
  });

  it('treats a bare handshake as no optional capability', () => {
    // Captured from `gemini --acp`, which advertises none of these.
    expect(mapCapabilities({ protocolVersion: 1 })).toEqual({
      loadSession: false,
      resumeSession: false,
      promptImage: false,
      promptAudio: false,
      promptEmbeddedContext: false,
    });
  });
});

describe('ACP config options', () => {
  it('keeps the reserved model and reasoning categories distinct', () => {
    const options = mapConfigOptions({
      configOptions: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          currentValue: 'gemini-3-pro',
          options: [
            { value: 'gemini-3-pro', name: 'Gemini 3 Pro' },
            { value: 'gemini-3-flash', name: 'Gemini 3 Flash', description: 'Faster' },
          ],
        },
        {
          id: 'thinking',
          name: 'Thinking',
          category: 'thought_level',
          currentValue: 'high',
          options: [{ value: 'high', name: 'High' }],
        },
      ],
    });
    expect(options.map((option) => option.category)).toEqual(['model', 'thought-level']);
    expect(options[0]?.choices).toHaveLength(2);
    expect(options[0]?.value).toBe('gemini-3-pro');
  });

  it('carries a boolean option without turning it into a string', () => {
    const [option] = mapConfigOptions({
      configOptions: [
        { id: 'web', name: 'Web search', category: 'other', currentValue: false },
      ],
    });
    expect(option?.value).toBe(false);
    expect(option?.choices).toEqual([]);
  });

  it('drops an option with no id rather than inventing one', () => {
    expect(mapConfigOptions({ configOptions: [{ name: 'Nameless' }] })).toEqual([]);
  });
});

describe('ACP content', () => {
  it('flattens an embedded resource to text so the transcript can render it', () => {
    expect(
      mapContent({
        type: 'resource',
        resource: { uri: 'file:///a.ts', text: 'export {}' },
      }),
    ).toEqual({ type: 'text', text: 'export {}' });
  });

  it('keeps a resource link as a reference', () => {
    expect(
      mapContent({ type: 'resource_link', uri: 'file:///a.ts', name: 'a.ts' }),
    ).toEqual({
      type: 'resource-link',
      uri: 'file:///a.ts',
      name: 'a.ts',
    });
  });

  it('ignores a content type it does not render', () => {
    expect(mapContent({ type: 'audio', data: 'AAA', mimeType: 'audio/wav' })).toBeNull();
  });
});

describe('ACP tool calls', () => {
  it('carries a diff, which is what makes a change reviewable', () => {
    const call = mapToolCall({
      toolCallId: 'call_1',
      title: 'Edit note.txt',
      kind: 'edit',
      status: 'completed',
      content: [{ type: 'diff', path: '/w/note.txt', oldText: 'a', newText: 'b' }],
      locations: [{ path: '/w/note.txt', line: 1 }],
    });
    expect(call?.content).toEqual([
      { type: 'diff', path: '/w/note.txt', oldText: 'a', newText: 'b' },
    ]);
    expect(call?.paths).toEqual(['/w/note.txt']);
  });

  it('preserves the title and diff when an update only reports status', () => {
    // The regression this defends: every field but toolCallId is optional on an
    // update, so a completed edit would otherwise lose its diff at the moment it
    // completes.
    const first = mapToolCall({
      toolCallId: 'call_1',
      title: 'Edit note.txt',
      kind: 'edit',
      status: 'pending',
      content: [{ type: 'diff', path: '/w/note.txt', oldText: 'a', newText: 'b' }],
    });
    expect(first).not.toBeNull();
    const updated = mapToolCall(
      { toolCallId: 'call_1', status: 'completed' },
      first ?? undefined,
    );
    expect(updated?.status).toBe('completed');
    expect(updated?.title).toBe('Edit note.txt');
    expect(updated?.kind).toBe('edit');
    expect(updated?.content).toHaveLength(1);
  });

  it('falls back to other for an unknown kind instead of failing', () => {
    const call = mapToolCall({ toolCallId: 'c', kind: 'telepathy', status: 'weird' });
    expect(call?.kind).toBe('other');
    expect(call?.status).toBe('pending');
  });

  it('refuses a call with no id', () => {
    expect(mapToolCall({ title: 'anonymous' })).toBeNull();
  });
});

describe('ACP plans', () => {
  it('normalises in_progress to running', () => {
    expect(
      mapPlan({
        entries: [
          { content: 'read', status: 'completed' },
          { content: 'edit', status: 'in_progress' },
          { content: 'verify', status: 'pending' },
        ],
      }).map((entry) => entry.status),
    ).toEqual(['completed', 'running', 'pending']);
  });
});

describe('ACP permission', () => {
  const options = [
    { optionId: 'a', name: 'Allow', kind: 'allow_once' },
    { optionId: 'b', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'c', name: 'Reject', kind: 'reject_once' },
  ];

  it('maps the offered options', () => {
    expect(mapPermissionOptions({ options }).map((option) => option.decision)).toEqual([
      'allow-once',
      'allow-always',
      'reject-once',
    ]);
  });

  it('drops an option whose kind it cannot honour', () => {
    expect(mapPermissionOptions({ options: [{ optionId: 'x', kind: 'maybe' }] })).toEqual(
      [],
    );
  });

  it('picks the exact option when the agent offers it', () => {
    const mapped = mapPermissionOptions({ options });
    expect(choosePermissionOption(mapped, 'allow-always')?.optionId).toBe('b');
  });

  it('degrades always to once when the agent omits always', () => {
    // Grok routinely omits allow_always. A person who chose "always" still
    // expects the action to proceed; the rule is remembered on our side.
    const mapped = mapPermissionOptions({ options: [options[0], options[2]] });
    expect(choosePermissionOption(mapped, 'allow-always')?.optionId).toBe('a');
    expect(choosePermissionOption(mapped, 'reject-always')?.optionId).toBe('c');
  });

  it('returns nothing when not even a fallback is offered', () => {
    const mapped = mapPermissionOptions({ options: [options[2]] });
    expect(choosePermissionOption(mapped, 'allow-once')).toBeNull();
  });
});

describe('ACP turn end', () => {
  it('maps the documented stop reasons', () => {
    expect(mapStopReason({ stopReason: 'end_turn' })).toBe('end-turn');
    expect(mapStopReason({ stopReason: 'max_turn_requests' })).toBe('max-turn-requests');
    expect(mapStopReason({ stopReason: 'cancelled' })).toBe('cancelled');
  });

  it('assumes a normal end when the agent omits a reason', () => {
    expect(mapStopReason({})).toBe('end-turn');
  });

  it('reads usage and rejects a nonsense window', () => {
    expect(mapUsage({ used: 53_000, size: 200_000 })).toEqual({
      usedTokens: 53_000,
      contextWindow: 200_000,
    });
    expect(mapUsage({ used: 'lots', size: 0 })).toEqual({
      usedTokens: null,
      contextWindow: null,
    });
  });
});
