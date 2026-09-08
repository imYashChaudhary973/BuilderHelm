import type { AgentConfigChoice, AgentConfigOption } from '@builderhelm/protocol';

import { compactTokens } from './chat-status.js';

export { compactTokens };

/** Composer chips for the categories an agent actually advertises. */
export interface ConfigChip {
  readonly id: string;
  readonly label: string;
  /** The advertised choice currently in effect, or On/Off for a toggle. */
  readonly currentLabel: string;
  readonly value: string | boolean;
  readonly choices: readonly AgentConfigChoice[];
  readonly isToggle: boolean;
}

export interface ConfigChipGroups {
  /** Shown as composer chips: model, thought-level, mode. */
  readonly chips: readonly ConfigChip[];
  /** The remaining advertised options, gathered under one overflow chip. */
  readonly overflow: readonly ConfigChip[];
}

const CHIP_CATEGORIES: ReadonlySet<AgentConfigOption['category']> = new Set([
  'model',
  'thought-level',
  'mode',
]);

function toChip(option: AgentConfigOption): ConfigChip {
  const isToggle = typeof option.value === 'boolean';
  const choices = option.choices.map((choice) => ({
    ...choice,
    label:
      option.id === 'collaboration_mode' && choice.value === 'default'
        ? 'Build'
        : choice.label === 'Approve for me'
          ? 'AI approval'
          : choice.label === 'Ask for approval'
            ? 'Human review'
            : choice.label === 'build'
              ? 'Build'
              : choice.label === 'plan'
                ? 'Plan'
                : choice.label,
  }));
  let currentLabel: string;
  if (isToggle) {
    currentLabel = option.value === true ? 'On' : 'Off';
  } else {
    const current = choices.find((choice) => choice.value === String(option.value));
    currentLabel = current?.label ?? String(option.value);
  }
  return {
    id: option.id,
    label: option.label,
    currentLabel,
    value: option.value,
    choices,
    isToggle,
  };
}

export function buildConfigChips(
  options: readonly AgentConfigOption[],
): ConfigChipGroups {
  const chips: ConfigChip[] = [];
  const overflow: ConfigChip[] = [];
  for (const option of options) {
    const chip = toChip(option);
    if (CHIP_CATEGORIES.has(option.category)) chips.push(chip);
    else overflow.push(chip);
  }
  const rank = (id: string): number => {
    const category = options.find((option) => option.id === id)?.category;
    return category === 'model' ? 0 : category === 'thought-level' ? 1 : 2;
  };
  chips.sort((left, right) => rank(left.id) - rank(right.id));
  return { chips, overflow };
}

/**
 * How many leading turns the transcript collapses behind "Show N earlier
 * messages". The recent window stays visible; nothing is ever dropped.
 */
export function earlierWindow(total: number, keep = 20): number {
  return total <= keep ? 0 : total - keep;
}
