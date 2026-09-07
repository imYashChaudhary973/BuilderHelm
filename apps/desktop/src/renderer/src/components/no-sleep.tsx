import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NoSleepMode, NoSleepState } from '@builderhelm/protocol/no-sleep';
import { useEffect, useRef, useState } from 'react';

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

function CupGlyph(): React.JSX.Element {
  // Drawn at the box's centre rather than cropped to it: cropping the viewBox
  // would also magnify the glyph and thicken its stroke. The coordinates are
  // the original cup shifted +1.6 x and -2.5 y so the ink centre lands on
  // (12, 12).
  return (
    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden="true">
      <path
        d="M5.6 5.5h11v5a5 5 0 0 1-5 5H10.6a5 5 0 0 1-5-5V5.5Zm11 1.5h1.6a2.4 2.4 0 0 1 0 4.8H16.6M6.1 18.5h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const current = state.data?.mode ?? 'off';
  const held = state.data?.blockerActive ?? false;
  const status = current === 'off' ? 'Off' : held ? 'Active' : 'Idle';

  return (
    <div className="noSleep" ref={rootRef}>
      {/* Icon only; the mode menu carries the words. */}
      <button
        type="button"
        className={current === 'off' ? 'noSleepChip' : 'noSleepChip noSleepChipOn'}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`No Sleep: ${LABELS[current]} · ${status}`}
        title={`No Sleep: ${LABELS[current]} · ${status}`}
        onClick={() => setOpen((value) => !value)}
      >
        <CupGlyph />
      </button>
      {open ? (
        <div className="noSleepMenu" role="menu" aria-label="No Sleep">
          <header className="noSleepMenuHead">
            <strong>No Sleep</strong>
            <span className="usageMeta">
              {LABELS[current]} · {status}
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
                  disabled={mutate.isPending}
                  onClick={() => {
                    mutate.mutate(option.mode);
                    setOpen(false);
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
        </div>
      ) : null}
    </div>
  );
}
