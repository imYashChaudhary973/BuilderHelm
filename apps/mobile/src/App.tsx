import { createElement, useState, type ReactNode } from 'react';

import type { CompanionSession } from './session.js';

interface Style {
  [key: string]: string | number | undefined;
}

function View(props: {
  children?: ReactNode;
  style?: Style;
  testID?: string;
}): React.ReactElement {
  return createElement(
    'div',
    { 'data-testid': props.testID, style: props.style },
    props.children,
  );
}

function Text(props: { children?: ReactNode }): React.ReactElement {
  return createElement('span', null, props.children);
}

function Pressable(props: {
  children?: ReactNode;
  onPress?: () => void;
  testID?: string;
}): React.ReactElement {
  return createElement(
    'button',
    { type: 'button', onClick: props.onPress, 'data-testid': props.testID },
    props.children,
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testID: string;
}): React.ReactElement {
  return createElement('label', null, [
    createElement(Text, { key: 'l' }, props.label),
    createElement('input', {
      key: 'i',
      value: props.value,
      'data-testid': props.testID,
      onChange: (event: { target: { value: string } }) =>
        props.onChange(event.target.value),
    }),
  ]);
}

export interface CompanionAppProps {
  readonly session: CompanionSession;
  readonly onPair: (code: string, label: string) => void;
  readonly onInstruct: (runId: string, text: string) => void;
  readonly onApprove: (requestId: string, decision: 'allow' | 'deny') => void;
  readonly onCancel: (runId: string) => void;
}

/**
 * React Native companion. Process execution, Git, credentials, and workspaces
 * stay on the host. Swap View/Text/Pressable for `react-native` under Metro.
 */
export function App(props: CompanionAppProps): React.ReactElement {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('phone');
  const [instruction, setInstruction] = useState('');
  const runId = props.session.status?.run?.id ?? '';
  const stale = props.session.connection !== 'connected';

  return (
    <View testID="companion" style={{ padding: 16 }}>
      {stale ? (
        <Text>
          {props.session.connection === 'disconnected'
            ? (props.session.error ?? 'Disconnected from host')
            : 'Connection is stale — waiting for the host'}
        </Text>
      ) : null}
      <Field label="Pairing code" value={code} onChange={setCode} testID="pair-code" />
      <Field label="Device name" value={label} onChange={setLabel} testID="pair-label" />
      <Pressable testID="pair" onPress={() => props.onPair(code, label)}>
        <Text>Pair with host</Text>
      </Pressable>
      <Text>{props.session.status?.run?.status ?? 'No run'}</Text>
      {(props.session.artifacts ?? []).map((artifact) => (
        <Text key={artifact.id}>{artifact.kind}</Text>
      ))}
      {(props.session.status?.pendingApprovals ?? []).map((approval) => (
        <View key={approval.requestId}>
          <Text>{approval.summary}</Text>
          <Pressable
            testID={`allow-${approval.requestId}`}
            onPress={() => props.onApprove(approval.requestId, 'allow')}
          >
            <Text>Allow</Text>
          </Pressable>
          <Pressable
            testID={`deny-${approval.requestId}`}
            onPress={() => props.onApprove(approval.requestId, 'deny')}
          >
            <Text>Deny</Text>
          </Pressable>
        </View>
      ))}
      <Field
        label="Instruction"
        value={instruction}
        onChange={setInstruction}
        testID="instruct-text"
      />
      <Pressable testID="instruct" onPress={() => props.onInstruct(runId, instruction)}>
        <Text>Send instruction</Text>
      </Pressable>
      <Pressable testID="cancel" onPress={() => props.onCancel(runId)}>
        <Text>Cancel run</Text>
      </Pressable>
    </View>
  );
}
