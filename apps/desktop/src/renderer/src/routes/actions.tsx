import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActionCommandOutcome,
  ActionReceipt,
  ApprovalRequest,
  PermissionPolicyMode,
  ToolDescriptor,
} from '@builderhelm/protocol/actions';
import { useEffect, useMemo, useState } from 'react';

function localTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function toolLabel(value: string): string {
  return value.replace('.', ' · ').replaceAll('_', ' ');
}

function ApprovalCard({
  approval,
  pending,
  onApprove,
  onReject,
}: {
  readonly approval: ApprovalRequest;
  readonly pending: boolean;
  onApprove(): void;
  onReject(): void;
}) {
  return (
    <article className="approvalCard">
      <div className="actionCardHeader">
        <div>
          <p className="eyebrow">Approval required · {approval.risk}</p>
          <h3>{approval.summary}</h3>
        </div>
        <span className="approvalExpiry">Expires {localTime(approval.expiresAt)}</span>
      </div>
      <div className="approvalResources">
        {approval.affectedResources.map((resource) => (
          <span key={`${resource.type}:${resource.id}`}>
            {resource.type}: {resource.label}
          </span>
        ))}
      </div>
      <details>
        <summary>Inspect exact arguments</summary>
        <pre>{JSON.stringify(approval.exactArguments, null, 2)}</pre>
      </details>
      <p className="approvalSource">
        Proposed by {approval.actorType === 'model' ? 'selected model' : 'local parser'}
        {approval.reversible ? ' · reversible write' : ' · no rollback'}
      </p>
      <div className="approvalActions">
        <button type="button" disabled={pending} onClick={onReject}>
          Reject
        </button>
        <button
          className="primaryButton"
          type="button"
          disabled={pending}
          onClick={onApprove}
        >
          Approve exact action
        </button>
      </div>
    </article>
  );
}

function ReceiptCard({ receipt }: { readonly receipt: ActionReceipt }) {
  return (
    <details className="receiptCard">
      <summary>
        <span>
          <strong>{receipt.requestedAction}</strong>
          <small>
            {toolLabel(receipt.toolId)} · {receipt.approvalState.replace('_', ' ')}
          </small>
        </span>
        <time dateTime={receipt.createdAt}>{localTime(receipt.createdAt)}</time>
      </summary>
      <div className="receiptBody">
        <p>
          Receipt <code>{receipt.id}</code>
        </p>
        <h4>Arguments</h4>
        <pre>{JSON.stringify(receipt.exactArguments, null, 2)}</pre>
        <h4>Result</h4>
        <pre>{JSON.stringify(receipt.result, null, 2)}</pre>
        {receipt.rollbackInformation !== null && (
          <>
            <h4>Rollback information</h4>
            <pre>{JSON.stringify(receipt.rollbackInformation, null, 2)}</pre>
          </>
        )}
      </div>
    </details>
  );
}

function PolicyControl({
  tool,
  mode,
  disabled,
  onChange,
}: {
  readonly tool: ToolDescriptor;
  readonly mode: PermissionPolicyMode;
  readonly disabled: boolean;
  onChange(mode: PermissionPolicyMode): void;
}) {
  return (
    <label className="policyRow">
      <span>
        <strong>{toolLabel(tool.id)}</strong>
        <small>{tool.description}</small>
      </span>
      <select
        value={mode}
        disabled={disabled}
        aria-label={`Permission policy for ${tool.id}`}
        onChange={(event) => onChange(event.target.value as PermissionPolicyMode)}
      >
        <option value="ask">Ask every time</option>
        <option value="auto_approve" disabled={tool.rollbackSupport === 'none'}>
          Auto-approve
        </option>
        <option value="deny">Deny</option>
      </select>
    </label>
  );
}

export function ActionsPage(): React.JSX.Element {
  const client = useQueryClient();
  const [commandText, setCommandText] = useState('');
  const [modelRef, setModelRef] = useState('');
  const [lastOutcome, setLastOutcome] = useState<ActionCommandOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const snapshot = useQuery({
    queryKey: ['action-snapshot'],
    queryFn: () => window.builderHelm.actions.snapshot({}),
  });
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => window.builderHelm.models.list({}),
  });
  const actionModels = useMemo(
    () =>
      (models.data ?? []).filter(
        (model) => model.capabilities.streaming && model.capabilities.toolCalling,
      ),
    [models.data],
  );
  useEffect(() => {
    if (modelRef.length > 0 && !actionModels.some((model) => model.ref === modelRef)) {
      setModelRef('');
    }
  }, [actionModels, modelRef]);

  async function refresh(): Promise<void> {
    await client.invalidateQueries({ queryKey: ['action-snapshot'] });
  }

  const runCommand = useMutation({
    mutationFn: (text: string) =>
      window.builderHelm.actions.command({
        requestId: globalThis.crypto.randomUUID(),
        text,
        modelRef: modelRef || null,
      }),
    onMutate: () => {
      setError(null);
      setLastOutcome(null);
    },
    onSuccess: async (outcome) => {
      setLastOutcome(outcome);
      setCommandText('');
      await refresh();
    },
    onError: () =>
      setError(
        'BuilderHelm could not safely resolve this command. Use one action at a time and verify project or task names.',
      ),
  });
  const approve = useMutation({
    mutationFn: (approvalId: string) =>
      window.builderHelm.actions.approve({ approvalId }),
    onMutate: () => setError(null),
    onSuccess: async (outcome) => {
      setLastOutcome(outcome);
      await refresh();
    },
    onError: () =>
      setError('The action was not executed. It may have expired or changed policy.'),
  });
  const reject = useMutation({
    mutationFn: (approvalId: string) => window.builderHelm.actions.reject({ approvalId }),
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: () => setError('The approval could not be rejected.'),
  });
  const updatePolicy = useMutation({
    mutationFn: (input: { toolId: ToolDescriptor['id']; mode: PermissionPolicyMode }) =>
      window.builderHelm.actions.updatePolicy(input),
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: () => setError('The permission policy was not changed.'),
  });

  const busy = runCommand.isPending || approve.isPending || reject.isPending;
  const writeTools = (snapshot.data?.tools ?? []).filter(
    (tool) => tool.risk === 'reversible_write',
  );
  const policies = new Map(
    snapshot.data?.policies.map((policy) => [policy.toolId, policy.mode]) ?? [],
  );

  return (
    <div className="actionsPage">
      <header className="settingsHeader actionsHeader">
        <div>
          <p className="eyebrow">Permission-controlled local tools</p>
          <h1>Actions</h1>
          <p className="lede">
            Describe one task or project action. BuilderHelm validates it before any
            write.
          </p>
        </div>
        <div className="actionSafetyBadge">
          <span aria-hidden="true" />
          Exact approval · immutable receipt
        </div>
      </header>

      {error !== null && (
        <p className="errorBanner" role="alert">
          {error}
        </p>
      )}

      <div className="actionsGrid">
        <section className="actionCommandPanel" aria-labelledby="action-command-title">
          <div className="actionCommandIntro">
            <div>
              <p className="eyebrow">Action chat</p>
              <h2 id="action-command-title">What should change?</h2>
            </div>
            <label>
              <span>Fallback parser</span>
              <select
                value={modelRef}
                onChange={(event) => setModelRef(event.target.value)}
              >
                <option value="">Deterministic only</option>
                {actionModels.map((model) => (
                  <option value={model.ref} key={model.ref}>
                    {model.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <form
            className="actionComposer"
            onSubmit={(event) => {
              event.preventDefault();
              const text = commandText.trim();
              if (text.length > 0 && !busy) runCommand.mutate(text);
            }}
          >
            <textarea
              value={commandText}
              maxLength={2_000}
              rows={4}
              placeholder="Add a high-priority task to Project A to benchmark the sync layer tomorrow."
              onChange={(event) => setCommandText(event.target.value)}
            />
            <div className="actionComposerFooter">
              <span>
                Local parser runs first. A selected model can only propose registered
                tools.
              </span>
              <button
                className="primaryButton"
                type="submit"
                disabled={busy || commandText.trim().length === 0}
              >
                {runCommand.isPending ? 'Validating…' : 'Propose action'}
              </button>
            </div>
          </form>
          <div className="commandExamples" aria-label="Command examples">
            {[
              'Create project Project A',
              'Add a high-priority task to Project A to benchmark sync tomorrow',
              'Show status of Project A',
              'Mark task-name complete',
            ].map((example) => (
              <button type="button" onClick={() => setCommandText(example)} key={example}>
                {example}
              </button>
            ))}
          </div>
          {lastOutcome !== null && (
            <div className="actionOutcome" aria-live="polite">
              <p className="eyebrow">BuilderHelm</p>
              <strong>{lastOutcome.message}</strong>
              {lastOutcome.kind === 'read_result' && (
                <pre>{JSON.stringify(lastOutcome.result, null, 2)}</pre>
              )}
            </div>
          )}
        </section>

        <aside className="workSnapshot" aria-label="Local work state">
          <p className="eyebrow">Local work state</p>
          <h2>{snapshot.data?.projects.length ?? 0} projects</h2>
          {snapshot.data?.projects.map((project) => {
            const tasks = snapshot.data.tasks.filter(
              (task) => task.projectId === project.id,
            );
            return (
              <div className="projectMiniCard" key={project.id}>
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.status}</span>
                </div>
                <small>
                  {tasks.length} task{tasks.length === 1 ? '' : 's'} ·{' '}
                  {tasks.filter((task) => task.status === 'done').length} done
                </small>
              </div>
            );
          })}
          {(snapshot.data?.projects.length ?? 0) === 0 && (
            <p className="actionEmpty">Start with “Create project Project A”.</p>
          )}
        </aside>
      </div>

      <section className="approvalSection" aria-labelledby="pending-approvals-title">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">Human control</p>
            <h2 id="pending-approvals-title">Pending approvals</h2>
          </div>
          <span>{snapshot.data?.pendingApprovals.length ?? 0} waiting</span>
        </div>
        <div className="approvalList">
          {snapshot.data?.pendingApprovals.map((approvalRequest) => (
            <ApprovalCard
              approval={approvalRequest}
              pending={busy}
              onApprove={() => approve.mutate(approvalRequest.id)}
              onReject={() => reject.mutate(approvalRequest.id)}
              key={approvalRequest.id}
            />
          ))}
          {(snapshot.data?.pendingApprovals.length ?? 0) === 0 && (
            <p className="actionEmpty">No action is waiting for approval.</p>
          )}
        </div>
      </section>

      <div className="actionLowerGrid">
        <section className="policyPanel" aria-labelledby="policy-title">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">Per-tool defaults</p>
              <h2 id="policy-title">Permissions</h2>
            </div>
          </div>
          <p className="policyWarning">
            Auto-approve means future matching writes execute immediately. Destructive and
            external actions can never use this setting.
          </p>
          {writeTools.map((tool) => (
            <PolicyControl
              tool={tool}
              mode={policies.get(tool.id) ?? 'ask'}
              disabled={updatePolicy.isPending}
              onChange={(mode) => updatePolicy.mutate({ toolId: tool.id, mode })}
              key={tool.id}
            />
          ))}
        </section>

        <section className="receiptPanel" aria-labelledby="receipts-title">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">Append-only history</p>
              <h2 id="receipts-title">Action receipts</h2>
            </div>
            <span>{snapshot.data?.receipts.length ?? 0} recorded</span>
          </div>
          <div className="receiptList">
            {snapshot.data?.receipts.map((receipt) => (
              <ReceiptCard receipt={receipt} key={receipt.id} />
            ))}
            {(snapshot.data?.receipts.length ?? 0) === 0 && (
              <p className="actionEmpty">Approved actions will leave receipts here.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
