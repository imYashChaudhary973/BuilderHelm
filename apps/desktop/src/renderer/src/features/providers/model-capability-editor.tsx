import type {
  ModelCapabilities,
  ModelCapabilityOverrides,
  ModelRecord,
} from '@builderhelm/protocol/model';

const booleanCapabilities: ReadonlyArray<{
  key: Exclude<keyof ModelCapabilities, 'contextWindow' | 'maxOutputTokens'>;
  label: string;
}> = [
  { key: 'text', label: 'Text' },
  { key: 'vision', label: 'Vision' },
  { key: 'audioInput', label: 'Audio input' },
  { key: 'toolCalling', label: 'Tool calling' },
  { key: 'parallelTools', label: 'Parallel tools' },
  { key: 'structuredOutput', label: 'Structured output' },
  { key: 'streaming', label: 'Streaming' },
  { key: 'reasoningControls', label: 'Reasoning controls' },
  { key: 'serverWebSearch', label: 'Server web search' },
  { key: 'serverMcp', label: 'Server MCP' },
];

interface ModelCapabilityEditorProps {
  readonly model: ModelRecord;
  readonly overrides: ModelCapabilityOverrides | undefined;
  readonly busy: boolean;
  readonly onSave: (overrides: ModelCapabilityOverrides) => void;
}

export function ModelCapabilityEditor(
  props: ModelCapabilityEditorProps,
): React.JSX.Element {
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const overrides: Record<string, boolean | number> = {};
    for (const capability of booleanCapabilities) {
      const value = String(data.get(capability.key) ?? '');
      if (value === 'true') overrides[capability.key] = true;
      if (value === 'false') overrides[capability.key] = false;
    }
    for (const key of ['contextWindow', 'maxOutputTokens'] as const) {
      const value = String(data.get(key) ?? '').trim();
      if (value.length > 0) overrides[key] = Number(value);
    }
    props.onSave(overrides as ModelCapabilityOverrides);
  }

  const hasOverrides =
    props.overrides !== undefined && Object.keys(props.overrides).length > 0;
  return (
    <details className="capabilityEditor">
      <summary>
        <span>{props.model.label}</span>
        <span>{hasOverrides ? 'Manual override' : 'Discovered'}</span>
      </summary>
      <form onSubmit={submit}>
        <p>Auto follows provider discovery. Manual values persist across rediscovery.</p>
        <div className="capabilityGrid">
          {booleanCapabilities.map((capability) => (
            <label key={capability.key}>
              <span>{capability.label}</span>
              <select
                name={capability.key}
                defaultValue={String(props.overrides?.[capability.key] ?? '')}
              >
                <option value="">Auto</option>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>
          ))}
          <label>
            <span>Context window</span>
            <input
              name="contextWindow"
              type="number"
              min="1"
              step="1"
              defaultValue={props.overrides?.contextWindow ?? ''}
              placeholder="Auto"
            />
          </label>
          <label>
            <span>Max output tokens</span>
            <input
              name="maxOutputTokens"
              type="number"
              min="1"
              step="1"
              defaultValue={props.overrides?.maxOutputTokens ?? ''}
              placeholder="Auto"
            />
          </label>
        </div>
        <div className="capabilityActions">
          <button type="submit" disabled={props.busy}>
            Save capabilities
          </button>
          <button
            type="button"
            disabled={props.busy || !hasOverrides}
            onClick={() => props.onSave({})}
          >
            Reset to discovered
          </button>
        </div>
      </form>
    </details>
  );
}
