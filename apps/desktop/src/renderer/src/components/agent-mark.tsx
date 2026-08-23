import type { BoardAgentId } from '@zero/protocol/board';

export function AgentMark({
  id,
  on,
  onClick,
}: {
  readonly id: BoardAgentId;
  readonly on: boolean;
  readonly onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={on ? 'agentMark agentMarkOn' : 'agentMark'}
      aria-pressed={on}
      aria-label={id}
      onClick={onClick}
    >
      <Mark id={id} />
    </button>
  );
}

function Mark({ id }: { readonly id: BoardAgentId }): React.JSX.Element {
  const common = {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    'aria-hidden': true as const,
  };
  if (id === 'cursor') {
    return (
      <svg {...common}>
        <path
          d="M8.2 5.4c3.8-2.4 8.7-1.1 10.7 2.8 2 4-0.2 8.8-4.3 10.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <path
          d="M6.4 16.8 16.2 8.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (id === 'antigravity') {
    return (
      <svg {...common}>
        <path d="M12 3.6 20.2 8.2 12 12.8 3.8 8.2Z" fill="currentColor" />
        <path d="M3.8 8.2v7.1L12 20.4V12.8Z" fill="currentColor" opacity="0.62" />
        <path d="M20.2 8.2v7.1L12 20.4V12.8Z" fill="currentColor" opacity="0.38" />
      </svg>
    );
  }
  if (id === 'codex') {
    return (
      <svg {...common}>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.55"
          transform="translate(0 1)"
        >
          <ellipse cx="12" cy="7.2" rx="3.1" ry="5.1" />
          <ellipse cx="12" cy="7.2" rx="3.1" ry="5.1" transform="rotate(60 12 12)" />
          <ellipse cx="12" cy="7.2" rx="3.1" ry="5.1" transform="rotate(120 12 12)" />
        </g>
      </svg>
    );
  }
  if (id === 'claude') {
    return (
      <svg {...common}>
        <path
          d="M12 3.4 13.6 9.2 19.6 10 13.6 12.2 12 18.6 10.4 12.2 4.4 10 10.4 9.2Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (id === 'grok') {
    return (
      <svg {...common}>
        <path
          d="M6 6.5 12 12l6-5.5M6 17.5 12 12l6 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (id === 'gemini') {
    return (
      <svg {...common}>
        <path d="M12 3.2 14.2 9.8 20.8 12 14.2 14.2 12 20.8 9.8 14.2 3.2 12 9.8 9.8Z" fill="currentColor" />
      </svg>
    );
  }
  if (id === 'opencode') {
    return (
      <svg {...common}>
        <path
          d="M8 8.2 4.8 12 8 15.8M13.2 16.6h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (id === 'copilot') {
    return (
      <svg {...common}>
        <path
          d="M7.5 10.2c0-2.4 1.8-4.4 4.5-4.4s4.5 2 4.5 4.4v5.1c0 1.3-1 2.3-2.3 2.3h-4.4c-1.3 0-2.3-1-2.3-2.3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <circle cx="10.1" cy="12.1" r="0.9" fill="currentColor" />
        <circle cx="13.9" cy="12.1" r="0.9" fill="currentColor" />
      </svg>
    );
  }
  if (id === 'kimi') {
    return (
      <svg {...common}>
        <path
          d="M15.6 6.2a6.4 6.4 0 1 0 2.2 9.8 7.2 7.2 0 0 1-2.2-9.8Z"
          fill="currentColor"
        />
      </svg>
    );
  }
  if (id === 'omp') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M12 7.4v9.2M8.4 12h7.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path
        d="M7.2 8.2 10.8 12 7.2 15.8M13.2 16.4h4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
