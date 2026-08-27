import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

import { bootstrapCore, MemorySecretStore, type CoreRuntime } from '@zero/core';
import type { GatewayFetch } from '@zero/model-gateway';
import { vi } from 'vitest';

import { electronSession } from './electron-mock.js';

export type FakeSender = {
  id: number;
  isDestroyed: () => boolean;
  send: (channel: string, payload: unknown) => void;
  events: Array<{ channel: string; payload: unknown }>;
};

const dialogState = vi.hoisted(() => ({
  folder: '/tmp',
  canceled: false,
  confirm: 0,
}));

const ipcHandlers = vi.hoisted(
  () =>
    new Map<string, (event: { sender: FakeSender }, input: unknown) => unknown>(),
);

vi.mock('electron', () => {
  const webContents = {
    loadURL: async () => undefined,
    goBack() {},
    goForward() {},
    reload() {},
    getURL: () => 'http://127.0.0.1/',
    canGoBack: () => false,
    canGoForward: () => false,
    isDestroyed: () => false,
    executeJavaScript: async () => undefined,
  };
  class BrowserView {
    webContents = webContents;
    setBounds() {}
    setAutoResize() {}
  }
  const window = {
    isDestroyed: () => false,
    addBrowserView() {},
    removeBrowserView() {},
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setBrowserView() {},
    getBrowserViews: () => [],
  };
  return {
    dialog: {
      showOpenDialog: async () => ({
        canceled: dialogState.canceled,
        filePaths: dialogState.canceled ? [] : [dialogState.folder],
      }),
      showMessageBox: async () => ({ response: dialogState.confirm }),
    },
    ipcMain: {
      handle(
        channel: string,
        fn: (event: { sender: FakeSender }, input: unknown) => unknown,
      ) {
        ipcHandlers.set(channel, fn);
      },
      removeHandler(channel: string) {
        ipcHandlers.delete(channel);
      },
    },
    session: electronSession,
    Notification: class {
      static isSupported() {
        return false;
      }
      show() {}
    },
    BrowserView,
    BrowserWindow: {
      fromWebContents: () => window,
      getAllWindows: () => [window],
      getFocusedWindow: () => window,
    },
  };
});

import { registerIpcHandlers } from '../src/main/ipc.js';

function fakeSender(): FakeSender {
  const events: FakeSender['events'] = [];
  return {
    id: 1,
    isDestroyed: () => false,
    send(channel, payload) {
      events.push({ channel, payload });
    },
    events,
  };
}

function fakeBoard() {
  const panes = new Map<
    string,
    { paneId: string; slot: number; sessionId: string; output: string }
  >();
  let sessionId: string | null = null;
  return {
    createSession: async (input: {
      folderPath: string;
      paneCount: number;
      isolation: string;
      panes: Array<{ slot: number; agentId: string }>;
    }) => {
      sessionId = randomUUID();
      const summaries = input.panes.map((pane) => {
        const paneId = randomUUID();
        panes.set(paneId, {
          paneId,
          slot: pane.slot,
          sessionId: sessionId!,
          output: '',
        });
        return {
          paneId,
          slot: pane.slot,
          agentId: pane.agentId,
          title: `Terminal · pane ${String(pane.slot + 1)}`,
          status: 'running' as const,
          branch: null,
          cwd: input.folderPath,
        };
      });
      return {
        sessionId,
        folderPath: input.folderPath,
        paneCount: summaries.length,
        isolation: input.isolation,
        panes: summaries,
      };
    },
    write: async (input: { paneId: string; data: string }) => {
      const pane = panes.get(input.paneId);
      if (pane === undefined) throw new Error('Unknown pane session or pane');
      pane.output += input.data;
    },
    resize: async () => undefined,
    closePane: async (input: { paneId: string }) => {
      panes.delete(input.paneId);
    },
    addPane: async () => {
      const paneId = randomUUID();
      const slot = panes.size;
      panes.set(paneId, {
        paneId,
        slot,
        sessionId: sessionId ?? randomUUID(),
        output: '',
      });
      return {
        paneId,
        slot,
        agentId: 'shell',
        title: `Terminal · pane ${String(slot + 1)}`,
        status: 'running' as const,
        branch: null,
        cwd: homedir(),
      };
    },
    drainPane: (input: { paneId: string }) => {
      const pane = panes.get(input.paneId);
      if (pane === undefined) throw new Error('Unknown pane session or pane');
      return { data: pane.output };
    },
    sessionContext: () => ({
      folderPath: homedir(),
      isolation: 'shared' as const,
      worktreeTag: 'testtag1',
    }),
  };
}

export type TsHost = {
  invoke: (channel: string, input?: unknown) => Promise<unknown>;
  sender: FakeSender;
  core: CoreRuntime;
  secrets: MemorySecretStore;
  close: () => void;
  setDialogFolder: (folder: string, canceled?: boolean) => void;
  setConfirm: (response: number) => void;
};

const defaultFetch: GatewayFetch = async (input, init) => {
  const url = String(input);
  const auth = new Headers(init?.headers).get('authorization') ?? '';
  if (auth.includes('invalid') || auth.length === 0) {
    return new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.includes('fail.example')) {
    return new Response('provider down', { status: 500 });
  }
  if (init?.method === 'GET' || url.includes('/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'gpt-test', object: 'model' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  const body =
    'data: {"id":"c1","choices":[{"delta":{"content":"Hi"}}]}\n\n' +
    'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
};

const defaultSwarmRunner = {
  execute: async () => ({ status: 'landed' as const, summary: 'ok', tokensUsed: 0 }),
};

export function createTsHost(options?: {
  fetch?: GatewayFetch;
  swarmRunner?: Parameters<typeof bootstrapCore>[0]['swarmRunner'];
}): TsHost {
  ipcHandlers.clear();
  const secrets = new MemorySecretStore();
  const core = bootstrapCore({
    databasePath: ':memory:',
    secretStore: secrets,
    modelGatewayFetch: options?.fetch ?? defaultFetch,
    swarmRunner: options?.swarmRunner ?? defaultSwarmRunner,
  });
  const unregister = registerIpcHandlers(core, fakeBoard() as never, undefined);
  const sender = fakeSender();
  return {
    sender,
    core,
    secrets,
    async invoke(channel, input) {
      const handler = ipcHandlers.get(channel);
      if (handler === undefined) {
        return {
          ok: false,
          error: {
            code: 'UNSUPPORTED',
            message: `no request handler for ${channel}`,
            retryable: false,
          },
        };
      }
      try {
        return await handler({ sender }, input);
      } catch (error) {
        const err = error as { code?: string; message?: string };
        return {
          ok: false,
          error: {
            code: err.code ?? 'UNCAUGHT',
            message: err.message ?? 'failed',
            retryable: false,
          },
        };
      }
    },
    close() {
      unregister();
      core.close();
    },
    setDialogFolder(folder, canceled = false) {
      dialogState.folder = folder;
      dialogState.canceled = canceled;
    },
    setConfirm(response) {
      dialogState.confirm = response;
    },
  };
}
