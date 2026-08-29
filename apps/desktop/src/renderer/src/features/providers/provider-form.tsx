import type {
  CreateProviderInput,
  ProviderProtocol,
  ProviderSummary,
  UpdateProviderInput,
} from '@builderhelm/protocol/providers';
import { useEffect, useRef, useState } from 'react';

const protocolOptions: ReadonlyArray<{ value: ProviderProtocol; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
  { value: 'anthropic-compatible', label: 'Anthropic-compatible' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'litellm', label: 'LiteLLM' },
  { value: 'custom', label: 'Custom' },
];

interface ProviderFormProps {
  readonly editing: ProviderSummary | null;
  readonly busy: boolean;
  readonly testing: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (input: CreateProviderInput) => void;
  readonly onTest: (providerId: string) => void;
  readonly onUpdate: (input: UpdateProviderInput) => void;
}

export function ProviderForm(props: ProviderFormProps): React.JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const [protocol, setProtocol] = useState<ProviderProtocol>(
    props.editing?.protocol ?? 'openai',
  );

  useEffect(() => {
    formRef.current?.reset();
    setProtocol(props.editing?.protocol ?? 'openai');
  }, [props.editing]);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const apiKeyInput = form.elements.namedItem('apiKey') as HTMLInputElement;
    const apiKey = apiKeyInput.value;
    apiKeyInput.value = '';

    const common = {
      label: String(data.get('label') ?? ''),
      protocol: String(data.get('protocol') ?? '') as ProviderProtocol,
      baseUrl: String(data.get('baseUrl') ?? '').trim() || null,
      headers: [],
      privacy: {
        allowPersonal: data.get('allowPersonal') === 'on',
        allowSensitive: data.get('allowSensitive') === 'on',
        allowHealth: data.get('allowHealth') === 'on',
      },
      enabled: data.get('enabled') === 'on',
    };

    if (props.editing === null) {
      props.onCreate({ ...common, apiKey });
    } else {
      props.onUpdate({
        id: props.editing.id,
        ...common,
        ...(apiKey.length === 0 ? {} : { apiKey }),
      });
    }
  }

  const existing = props.editing;
  return (
    <form className="providerForm" onSubmit={submit} ref={formRef}>
      <div className="formHeading">
        <div>
          <p className="eyebrow">
            {existing === null ? 'New connection' : 'Edit connection'}
          </p>
          <h2>{existing === null ? 'Add provider' : existing.label}</h2>
        </div>
        {existing !== null && (
          <button className="textButton" type="button" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
      <div className="formGrid">
        <label>
          <span>Name</span>
          <input
            name="label"
            defaultValue={existing?.label ?? ''}
            required
            maxLength={100}
          />
        </label>
        <label>
          <span>Protocol</span>
          <select
            name="protocol"
            value={protocol}
            onChange={(event) => setProtocol(event.target.value as ProviderProtocol)}
          >
            {protocolOptions.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wideField">
          <span>Base URL</span>
          <input
            name="baseUrl"
            type="url"
            defaultValue={existing?.baseUrl ?? ''}
            placeholder="https://api.example.com/v1"
          />
        </label>
        <label className="wideField">
          <span>{existing === null ? 'API key' : 'New API key (optional)'}</span>
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            required={existing === null && protocol !== 'ollama'}
            maxLength={16_384}
            placeholder={
              existing === null
                ? protocol === 'ollama'
                  ? 'Optional for local Ollama'
                  : 'Stored securely'
                : 'Leave blank to keep current key'
            }
          />
          <small>
            {protocol === 'ollama'
              ? 'Leave blank for local Ollama. Remote tokens are stored securely on this device.'
              : 'This value is sent directly to secure storage and is never shown again.'}
          </small>
        </label>
      </div>
      <fieldset>
        <legend>Data allowed for this provider</legend>
        <label className="checkRow">
          <input
            name="allowPersonal"
            type="checkbox"
            defaultChecked={existing?.privacy.allowPersonal ?? true}
          />
          Personal data
        </label>
        <label className="checkRow">
          <input
            name="allowSensitive"
            type="checkbox"
            defaultChecked={existing?.privacy.allowSensitive ?? false}
          />
          Sensitive data
        </label>
        <label className="checkRow">
          <input
            name="allowHealth"
            type="checkbox"
            defaultChecked={existing?.privacy.allowHealth ?? false}
          />
          Health data
        </label>
        <label className="checkRow">
          <input
            name="enabled"
            type="checkbox"
            defaultChecked={existing?.enabled ?? true}
          />
          Provider enabled
        </label>
      </fieldset>
      <div className="formActions">
        <button
          className="secondaryButton"
          type="button"
          disabled={
            existing === null ||
            !['openai', 'anthropic', 'openai-compatible', 'ollama'].includes(
              existing.protocol,
            ) ||
            props.busy ||
            props.testing
          }
          title={
            existing === null
              ? 'Save the provider before testing its connection'
              : !['openai', 'anthropic', 'openai-compatible', 'ollama'].includes(
                    existing.protocol,
                  )
                ? 'This protocol adapter arrives later in Phase 2'
                : 'Tests the last saved provider settings'
          }
          onClick={() => {
            if (existing !== null) props.onTest(existing.id);
          }}
        >
          {props.testing ? 'Testing…' : 'Test saved connection'}
        </button>
        <button className="primaryButton" type="submit" disabled={props.busy}>
          {props.busy ? 'Saving…' : existing === null ? 'Save provider' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
