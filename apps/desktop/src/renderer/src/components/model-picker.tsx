import { useId, useRef, useState } from 'react';
import type { ConfigChip } from '../routes/chat-cells.js';
import { ChevronDownIcon } from './rail-icons.js';

/** Search a harness's advertised catalog; keep its exact IDs on the wire. */
export function ModelPicker({
  chip,
  disabled,
  onSelect,
}: {
  readonly chip: ConfigChip;
  readonly disabled: boolean;
  readonly onSelect: (value: string) => void;
}): React.JSX.Element {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const filtered = chip.choices.filter((choice) =>
    `${choice.label} ${choice.value}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <button
        type="button"
        className="configChip modelTrigger"
        disabled={disabled}
        aria-label={`Model: ${chip.currentLabel}`}
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 348)),
            top: rect.top - 8,
          });
          setQuery('');
          menu.current?.showPopover();
          search.current?.focus();
        }}
      >
        {chip.currentLabel || 'Choose model'}
        <ChevronDownIcon />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Choose model"
        className="modelMenu"
        style={{
          left: position.left,
          top: position.top,
          maxHeight: Math.max(180, position.top - 8),
        }}
      >
        <input
          ref={search}
          type="search"
          placeholder="Search models and providers…"
          aria-label="Search models"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              menu.current?.querySelector<HTMLButtonElement>('.modelChoice')?.focus();
            }
          }}
        />
        <div
          className="modelChoices"
          role="listbox"
          aria-label="Available models"
          onKeyDown={(event) => {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
            );
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              buttons[
                (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          {filtered.map((choice) => (
            <button
              type="button"
              key={choice.value}
              role="option"
              aria-selected={choice.value === chip.value}
              className="modelChoice"
              onClick={() => {
                menu.current?.hidePopover();
                onSelect(choice.value);
              }}
            >
              <span>{choice.label}</span>
              {choice.value === chip.value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
          {filtered.length === 0 && <p role="status">No matching models.</p>}
        </div>
        <p className="modelMenuHint">
          Models advertised by this harness. Access depends on its connected provider
          accounts.
        </p>
      </div>
    </>
  );
}
