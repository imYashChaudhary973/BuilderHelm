import type { CorrelationId } from '@builderhelm/shared';

export interface TerminalFocus {
  readonly sessionId: string;
  readonly paneId: string;
}

export type InsertKind = 'field' | 'pane' | 'none';

export interface InsertTarget {
  readonly kind: InsertKind;
  readonly field?: HTMLElement;
  readonly pane?: TerminalFocus;
}

let lastPane: TerminalFocus | null = null;

export function setTerminalFocus(sessionId: string, paneId: string): void {
  lastPane = { sessionId, paneId };
}

export function lastTerminalFocus(): TerminalFocus | null {
  return lastPane;
}

export function resolveInsertTarget(
  active: Element | null,
  pane = lastTerminalFocus(),
): InsertTarget {
  if (isXtermField(active)) {
    return pane === null ? { kind: 'none' } : { kind: 'pane', pane };
  }
  if (isEditableField(active)) {
    return { kind: 'field', field: active };
  }
  if (pane !== null) return { kind: 'pane', pane };
  return { kind: 'none' };
}

export function insertTranscript(
  text: string,
  target: InsertTarget = resolveInsertTarget(
    typeof document === 'undefined' ? null : document.activeElement,
  ),
): InsertKind {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'none';
  if (target.kind === 'field' && target.field !== undefined) {
    insertIntoField(target.field, trimmed);
    return 'field';
  }
  if (target.kind === 'pane' && target.pane !== undefined) {
    void window.builderHelm.board.write({
      correlationId: crypto.randomUUID() as CorrelationId,
      sessionId: target.pane.sessionId,
      paneId: target.pane.paneId,
      data: trimmed.slice(0, 10_000),
    });
    return 'pane';
  }
  return 'none';
}

function isXtermField(el: Element | null): el is HTMLElement {
  return (
    typeof HTMLElement !== 'undefined' &&
    el instanceof HTMLElement &&
    el.classList.contains('xterm-helper-textarea')
  );
}

function isEditableField(el: Element | null): el is HTMLElement {
  if (typeof HTMLElement === 'undefined' || el === null) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = el.type;
    return (
      type === 'text' ||
      type === 'search' ||
      type === 'url' ||
      type === 'email' ||
      type === 'tel' ||
      type === ''
    );
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

function insertIntoField(el: HTMLElement, text: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc?.set?.call(el, next);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  el.focus();
  document.execCommand('insertText', false, text);
}
