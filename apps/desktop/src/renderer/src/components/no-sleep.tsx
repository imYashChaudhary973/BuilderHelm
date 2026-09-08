import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoSleepMode, NoSleepState } from '@builderhelm/protocol/no-sleep';
import { useEffect, useRef, useState } from 'react';
import { CupIcon } from './rail-icons.js';

const OPTIONS: readonly {
  readonly mode: NoSleepMode;
  readonly title: string;
  readonly detail: string;
}[] = [
  { mode: 'on', title: 'On', detail: 'Keep this computer awake continuously' },
  { mode: 'agent', title: 'Agent', detail: 'Stay awake while an agent is working' },
  { mode: 'off', title: 'Off', detail: 'Allow normal system sleep behavior' },
];

const LABELS: Record<NoSleepMode, string> = { on: 'On', agent: 'Agent', off: 'Off' };

/**
 * The No Sleep control: a bar chip on the right of the status bar plus a mode
 * menu. `blockerActive` is what the OS actually holds, so Agent mode reads
 * "Agent · Idle" until a run starts rather than claiming to be awake.
 */
export function NoSleep(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const state = useQuery({
    queryKey: ['no-sleep'],
    queryFn: () => window.builderHelm.noSleep.read(),
  });
  const mutate = useMutation({
    mutationFn: (mode: NoSleepMode) => window.builderHelm.noSleep.set({ mode }),
    onSuccess: (next) => {
      queryClient.setQueryData(['no-sleep'], next);
    },
  });

  // The main process pushes state when agent work starts or ends, so the chip
  // reflects the blocker without polling.
  useEffect(() => {
    return window.builderHelm.noSleep.onChange((next: NoSleepState) => {
      queryClient.setQueryData(['no-sleep'], next);
    });
  }, [queryClient]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector('button')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
    window.removeEventListener('keydown', onKey);
  }, [open]);

  const current = state.data?.mode ?? 'off';

  return (
    <div className="noSleep" ref={rootRef}>
      {/* Icon only; the mode menu carries the words. */}
      <button
        type="button"
        className="topbarIcon noSleepTrigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`No Sleep: ${LABELS[current]}`}
        title={`No Sleep: ${LABELS[current]}`}
        onClick={() => setOpen((value) => !value)}
      >
        <CupIcon />
      </button>
      {open ? (
        <div className="noSleepMenu" role="menu" aria-label="No Sleep">
          <header className="noSleepMenuHead">
            <strong>No Sleep</strong>
            <span className="noSleepCurrent" data-mode={current}>
              <i aria-hidden="true" />
              {LABELS[current]}
            </span>
          </header>
          <ul className="noSleepList">
            {OPTIONS.map((option) => (
              <li key={option.mode}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={current === option.mode}
                  className="noSleepOption"
                  data-mode={option.mode}
                  disabled={mutate.isPending}
                  onClick={() => {
                    mutate.mutate(option.mode, { onSuccess: () => setOpen(false) });
                  }}
                >
                  <span
                    className={
                      current === option.mode
                        ? 'noSleepRadio noSleepRadioOn'
                        : 'noSleepRadio'
                    }
                    aria-hidden="true"
                  />
                  <span className="noSleepOptionBody">
                    <strong>{option.title}</strong>
                    <span>{option.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {mutate.isError && (
            <p className="noSleepError" role="alert">
              Could not change No Sleep. Try again.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
