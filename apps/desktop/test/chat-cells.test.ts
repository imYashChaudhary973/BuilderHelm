import { describe, expect, it } from 'vitest';

import type { AgentConfigOption } from '@builderhelm/protocol';
import {
  buildConfigChips,
  earlierWindow,
} from '../src/renderer/src/routes/chat-cells.js';

function option(overrides: Partial<AgentConfigOption>): AgentConfigOption {
  return {
    id: 'opt',
    label: 'Option',
    description: null,
    category: 'model',
    value: 'fast',
    choices: [
      { value: 'fast', label: 'Fast', description: null },
      { value: 'slow', label: 'Slow', description: null },
    ],
    ...overrides,
  };
}

describe('buildConfigChips', () => {
  it('chips model, thought-level, and mode; overflow gets the rest', () => {
    const { chips, overflow } = buildConfigChips([
      option({ id: 'model', label: 'Model', value: 'fast' }),
      option({
        id: 'effort',
        label: 'Reasoning',
        category: 'thought-level',
        value: 'high',
      }),
      option({
        id: 'accepts',
        label: 'Auto-accept edits',
        category: 'mode',
        value: 'on',
      }),
      option({ id: 'verbosity', label: 'Verbosity', category: 'other', value: 'low' }),
    ]);

    expect(chips.map((chip) => chip.id)).toEqual(['model', 'effort', 'accepts']);
    expect(overflow.map((chip) => chip.id)).toEqual(['verbosity']);
  });

  it('labels a select chip with its current choice', () => {
    const { chips } = buildConfigChips([
      option({ id: 'model', label: 'Model', value: 'slow' }),
    ]);
    expect(chips[0]?.currentLabel).toBe('Slow');
  });

  it('renders a boolean option as an On/Off toggle with no choices', () => {
    const { chips } = buildConfigChips([
      option({
        id: 'auto',
        label: 'Auto-accept edits',
        category: 'mode',
        value: true,
        choices: [],
      }),
    ]);
    expect(chips[0]?.isToggle).toBe(true);
    expect(chips[0]?.currentLabel).toBe('On');
  });

  it('does not turn an empty model list into a boolean switch', () => {
    expect(
      buildConfigChips([option({ choices: [], value: '' })]).chips[0]?.isToggle,
    ).toBe(false);
  });

  it('uses product labels without changing the harness permission values', () => {
    const { chips } = buildConfigChips([
      option({
        id: 'mode',
        category: 'mode',
        value: 'agent',
        choices: [
          {
            value: 'agent',
            label: 'Approve for me',
            description: 'Review potentially unsafe actions',
          },
          { value: 'read-only', label: 'Ask for approval', description: null },
        ],
      }),
    ]);
    expect(chips[0]?.value).toBe('agent');
    expect(chips[0]?.currentLabel).toBe('AI approval');
    expect(chips[0]?.choices[1]?.value).toBe('read-only');
    expect(chips[0]?.choices[1]?.label).toBe('Human review');
  });

  it('falls back to the raw value when the agent sends an unknown choice', () => {
    const { chips } = buildConfigChips([
      option({ id: 'model', label: 'Model', value: 'mystery' }),
    ]);
    expect(chips[0]?.currentLabel).toBe('mystery');
  });
});

describe('earlierWindow', () => {
  it('keeps a short transcript fully visible', () => {
    expect(earlierWindow(20)).toBe(0);
    expect(earlierWindow(5)).toBe(0);
  });

  it('collapses everything past the recent window', () => {
    expect(earlierWindow(34)).toBe(14);
  });
});
