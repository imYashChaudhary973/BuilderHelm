import { useEffect, useState, type CSSProperties } from 'react';
import { BOARD_AGENT_CATALOG } from '@builderhelm/protocol/board';
import type { AuthState } from '@builderhelm/protocol/auth';

import logo from '../assets/logo.png';
import { ElementsCollection } from '../shaders/elements/ElementsBackground.js';
import { AgentGlyph } from './agent-mark.js';
import { splashEnabled } from './splash-screen.js';

/** Every catalogued CLI except the plain shell and the custom-command slot. */
const AGENTS = BOARD_AGENT_CATALOG.filter(
  (entry) => entry.id !== 'shell' && entry.id !== 'custom',
);

/** How long one agent stays lit before the charge steps to the next node. */
const STEP_MS = 1100;

/**
 * Graph geometry, in the 0-100 viewBox the link SVG uses. The node box is a
 * fraction of the core (see --login-tile), so these ratios hold at every
 * window size and the maths stays static.
 */
const NODE_HALF_U = 6.5;
const RADIUS_U = 50 - NODE_HALF_U - 0.4;
/** How far back along the entry normal the curve's control point sits. */
const APPROACH_U = 15;

/** Node placement: out to the orbit radius, then back upright. */
function nodeStyle(index: number, count: number): CSSProperties {
  const angle = (360 / count) * index;
  return {
    '--i': index,
    transform: `translate(-50%, -50%) rotate(${angle}deg) translate(var(--login-orbit)) rotate(${-angle}deg)`,
  } as CSSProperties;
}

/**
 * The wire from hub to node, as an SVG path.
 *
 * A straight radial line only meets an upright square square-on when the node
 * sits at a cardinal position — everywhere else it arrives at a slant, or cuts
 * a corner if aimed at the centre. So each wire ends at the midpoint of the
 * edge facing the hub, and its quadratic control point sits back along that
 * edge's normal. The curve therefore arrives perpendicular at every node, and
 * for the four cardinal nodes the control lands on the radial line and the
 * path is dead straight.
 */
function wirePath(index: number, count: number): string {
  const radians = ((360 / count) * index * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cx = 50 + RADIUS_U * cos;
  const cy = 50 + RADIUS_U * sin;
  // The facing edge is the one on the dominant axis of the node's direction.
  const vertical = Math.abs(cos) >= Math.abs(sin);
  const stepX = vertical ? Math.sign(cos) : 0;
  const stepY = vertical ? 0 : Math.sign(sin);
  const endX = cx - stepX * NODE_HALF_U;
  const endY = cy - stepY * NODE_HALF_U;
  const controlX = endX - stepX * APPROACH_U;
  const controlY = endY - stepY * APPROACH_U;
  return `M 50 50 Q ${controlX.toFixed(2)} ${controlY.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`;
}

export function LoginScreen({
  state,
  onContinueLocal,
  localOpening = false,
  localError = null,
}: {
  readonly state: AuthState | null;
  readonly onContinueLocal?: (() => void) | undefined;
  readonly localOpening?: boolean;
  readonly localError?: string | null;
}): React.JSX.Element {
  // splashEnabled() already encodes prefers-reduced-motion for the launch
  // animation; the gate reuses it so both surfaces agree.
  const animated = splashEnabled();
  const [lit, setLit] = useState(0);
  const [copied, setCopied] = useState(false);
  const waiting = state?.status === 'waiting';

  useEffect(() => {
    if (!animated) return undefined;
    const id = window.setInterval(() => {
      setLit((current) => (current + 1) % AGENTS.length);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [animated]);

  return (
    <main className="loginScreen" data-core-status="ready">
      <div className="loginPane">
        <div className="loginLockup">
          <img className="loginLockupMark" src={logo} width={34} height={34} alt="" />
          <span className="loginLockupName">BuilderHelm</span>
        </div>

        <div className="loginCore">
          <div className="loginGraph" aria-hidden="true">
            <svg className="loginWires" viewBox="0 0 100 100">
              {AGENTS.map((entry, index) => (
                <path
                  key={`wire-${entry.id}`}
                  data-agent={entry.id}
                  className={index === lit ? 'loginWire is-lit' : 'loginWire'}
                  style={{ '--i': index } as CSSProperties}
                  d={wirePath(index, AGENTS.length)}
                />
              ))}
            </svg>
            {AGENTS.map((entry, index) => (
              <span
                key={entry.id}
                data-agent={entry.id}
                title={entry.label}
                className={index === lit ? 'loginNode is-lit' : 'loginNode'}
                style={nodeStyle(index, AGENTS.length)}
              >
                <span className="loginNodeGlyph">
                  <AgentGlyph id={entry.id} size={24} />
                </span>
              </span>
            ))}
          </div>

          {animated ? (
            <div className="loginAura" aria-hidden="true">
              <ElementsCollection
                variant="lightning"
                speed={0.5}
                size={1}
                particleAmount={0.7}
                opacity={0.7}
                hue={0}
                saturation={0.8}
                brightness={0.95}
                style={{ background: 'transparent' }}
              />
            </div>
          ) : (
            <div className="loginHub" aria-hidden="true">
              <img src={logo} width={92} height={92} alt="" />
            </div>
          )}
        </div>

        {state?.error !== null && state?.error !== undefined ? (
          <p className="loginError" role="alert">
            {state.error}
          </p>
        ) : null}

        {waiting ? (
          <div className="loginActions">
            <p className="loginWait" role="status">
              <span className="loginWaitDot" aria-hidden="true" />
              Waiting for the browser
            </p>
            <button
              type="button"
              className="loginButton loginButtonGhost"
              onClick={() => void window.builderHelm.auth.begin()}
            >
              Open the page again
            </button>
            {state?.signInUrl !== null && state?.signInUrl !== undefined ? (
              <button
                type="button"
                className="loginQuiet"
                onClick={() => {
                  void navigator.clipboard.writeText(state.signInUrl ?? '');
                  setCopied(true);
                }}
              >
                {copied ? 'Link copied' : 'Copy the sign-in link'}
              </button>
            ) : null}
            <button
              type="button"
              className="loginQuiet"
              onClick={() => void window.builderHelm.auth.cancel()}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="loginActions">
            <button
              type="button"
              className="loginButton loginButtonPrimary"
              onClick={() => void window.builderHelm.auth.begin()}
            >
              Sign in
            </button>
            <button
              type="button"
              className="loginButton loginButtonGhost"
              onClick={() => void window.builderHelm.auth.begin()}
            >
              Create account
            </button>
            <p className="loginHint">
              Opens your browser once, then hands the session back.
            </p>
          </div>
        )}
        {onContinueLocal === undefined ? null : (
          <div className="loginActions">
            {localError === null ? null : (
              <p className="loginError" role="alert">
                {localError}
              </p>
            )}
            <button
              type="button"
              className="loginButton loginButtonGhost"
              disabled={localOpening}
              onClick={onContinueLocal}
            >
              {localOpening ? 'Opening local workspace…' : 'Continue locally'}
            </button>
            <p className="loginHint">Local development · account stays signed out</p>
          </div>
        )}
      </div>

      <p className="loginFine">Local-first · macOS</p>
    </main>
  );
}
