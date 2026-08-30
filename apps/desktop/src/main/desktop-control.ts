import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { desktopCapturer } from 'electron';

import {
  desktopActNeedsApproval,
  escapeAppleScript,
  type DesktopActAction,
  type DesktopActApproval,
  type DesktopActInput,
  type DesktopActReceipt,
  type DesktopActResult,
} from '@builderhelm/protocol/browser';
import { BuilderHelmError, createId, utcNow } from '@builderhelm/shared';

const execFileAsync = promisify(execFile);

interface PendingDesktop {
  readonly id: string;
  readonly action: DesktopActAction;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly summary: string;
}

export class DesktopControl {
  private pending: PendingDesktop | null = null;

  async screenshot(): Promise<{ readonly pngBase64: string }> {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 800 },
    });
    const source = sources[0];
    if (source === undefined) {
      throw new BuilderHelmError('TOOL_EXECUTION_FAILED', 'No screen to capture');
    }
    return { pngBase64: source.thumbnail.toPNG().toString('base64') };
  }

  async act(input: DesktopActInput): Promise<DesktopActResult> {
    const action = input.action;
    const x = input.x ?? 0;
    const y = input.y ?? 0;
    const text = input.text ?? '';
    if (action === 'click' && (input.x === undefined || input.y === undefined)) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Click needs x and y');
    }
    if (action === 'type' && text.length === 0) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'Type needs text');
    }
    const summary =
      action === 'click' ? `desktop click ${String(x)},${String(y)}` : 'desktop type';
    if (desktopActNeedsApproval()) {
      const approval: DesktopActApproval = { id: createId(), summary };
      this.pending = { id: approval.id, action, x, y, text, summary };
      return { kind: 'approval_required', approval };
    }
    return { kind: 'done', receipt: await this.run(action, x, y, text, summary) };
  }

  async resolve(id: string, allow: boolean): Promise<DesktopActResult> {
    const pending = this.pending;
    if (pending === null || pending.id !== id) {
      throw new BuilderHelmError('VALIDATION_FAILED', 'No matching desktop approval');
    }
    this.pending = null;
    if (!allow) {
      return {
        kind: 'done',
        receipt: this.receipt(pending.action, pending.summary, 'denied'),
      };
    }
    return {
      kind: 'done',
      receipt: await this.run(
        pending.action,
        pending.x,
        pending.y,
        pending.text,
        pending.summary,
      ),
    };
  }

  private async run(
    action: DesktopActAction,
    x: number,
    y: number,
    text: string,
    summary: string,
  ): Promise<DesktopActReceipt> {
    if (process.platform !== 'darwin') {
      throw new BuilderHelmError(
        'VALIDATION_FAILED',
        'Desktop control is macOS-only in this slice',
      );
    }
    const script =
      action === 'click'
        ? `tell application "System Events" to click at {${String(x)}, ${String(y)}}`
        : `tell application "System Events" to keystroke "${escapeAppleScript(text)}"`;
    try {
      await execFileAsync('osascript', ['-e', script], { timeout: 8_000 });
    } catch (error) {
      throw new BuilderHelmError(
        'TOOL_EXECUTION_FAILED',
        'Desktop action failed; grant Accessibility if prompted',
        { cause: error },
      );
    }
    return this.receipt(action, summary, 'done');
  }

  private receipt(
    action: DesktopActAction,
    summary: string,
    outcome: DesktopActReceipt['outcome'],
  ): DesktopActReceipt {
    return {
      id: createId(),
      action,
      summary,
      outcome,
      createdAt: utcNow(),
    };
  }
}
