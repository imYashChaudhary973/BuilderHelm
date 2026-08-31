import { createCorrelationId } from '@builderhelm/shared';
import { describe, expect, it } from 'vitest';

import {
  buildPageSnapshot,
  extractPreviewOrigins,
  previewTargetNeedsApproval,
  redactPreviewUrl,
  desktopActNeedsApproval,
  escapeAppleScript,
  actionCommandRequestSchema,
  approvalResolveRequestSchema,
  BOARD_AGENT_CATALOG,
  boardPaneSpecSchema,
  gridForCount,
  createEvent,
  createProviderInputSchema,
  modelCapabilityOverrideUpdateRequestSchema,
  knowledgeQueryRequestSchema,
  knowledgeSourceRequestSchema,
  modelListIpcResponseSchema,
  parsePreviewUrl,
  providerTestConnectionRequestSchema,
  editorPickIpcResponseSchema,
  editorReadInputSchema,
  editorReadIpcResponseSchema,
  editorReadRequestSchema,
  editorListInputSchema,
  editorListIpcResponseSchema,
  editorGitIpcResponseSchema,
  systemHealthRequestSchema,
  systemHealthResponseSchema,
  zeroEventSchema,
  reviewDiffIpcResponseSchema,
  reviewLandInspectSchema,
  githubIssueImportInputSchema,
  githubIssueSchema,
  githubIssueSyncInputSchema,
  linearIssueImportInputSchema,
  linearIssueSchema,
  linearIssueSyncInputSchema,
} from '../src/index.js';

describe('event envelope', () => {
  it('creates a validated event with correlation metadata', () => {
    const event = createEvent({
      type: 'core.started',
      correlationId: createCorrelationId(),
      payload: { migrated: true },
    });

    expect(zeroEventSchema.parse(event)).toEqual(event);
  });

  it('rejects non-JSON payload values', () => {
    expect(() =>
      zeroEventSchema.parse({
        id: createCorrelationId(),
        type: 'unsafe.payload',
        occurredAt: new Date().toISOString(),
        correlationId: createCorrelationId(),
        payload: { callback: () => undefined },
      }),
    ).toThrow();
  });
});

describe('IPC contracts', () => {
  it('rejects malformed renderer arguments', () => {
    expect(
      systemHealthRequestSchema.safeParse({ correlationId: '../../etc/passwd' }).success,
    ).toBe(false);
  });

  it('rejects privileged details in a health response', () => {
    expect(
      systemHealthResponseSchema.safeParse({
        status: 'ok',
        database: 'ready',
        occurredAt: new Date().toISOString(),
        correlationId: createCorrelationId(),
        databasePath: '/Users/example/private.sqlite',
      }).success,
    ).toBe(false);
  });

  it('validates provider operations and sanitized IPC failures', () => {
    const providerId = createCorrelationId();
    expect(
      providerTestConnectionRequestSchema.parse({
        correlationId: createCorrelationId(),
        input: { providerId },
      }),
    ).toMatchObject({ input: { providerId } });
    expect(
      providerTestConnectionRequestSchema.safeParse({
        correlationId: createCorrelationId(),
        input: { providerId, apiKey: 'must-not-cross' },
      }).success,
    ).toBe(false);
    expect(
      modelListIpcResponseSchema.parse({
        ok: false,
        error: {
          code: 'AUTH_FAILED',
          message: 'Provider authentication failed',
          retryable: false,
        },
      }),
    ).toMatchObject({ ok: false, error: { code: 'AUTH_FAILED' } });
  });

  it('requires explicit remote routing while allowing credential-free local Ollama', () => {
    const common = {
      label: 'Provider',
      headers: [],
      privacy: { allowPersonal: true, allowSensitive: false, allowHealth: false },
      enabled: true,
    };
    expect(
      createProviderInputSchema.safeParse({
        ...common,
        protocol: 'openai-compatible',
        baseUrl: null,
        apiKey: 'secret',
      }).success,
    ).toBe(false);
    expect(
      createProviderInputSchema.parse({
        ...common,
        protocol: 'ollama',
        baseUrl: null,
        apiKey: '',
      }),
    ).toMatchObject({ protocol: 'ollama', apiKey: '' });
    expect(
      createProviderInputSchema.safeParse({
        ...common,
        protocol: 'openai',
        baseUrl: null,
        apiKey: '',
      }).success,
    ).toBe(false);
  });

  it('accepts only known per-model capability override fields', () => {
    const request = {
      correlationId: createCorrelationId(),
      input: {
        modelRef: `${createCorrelationId()}:model`,
        overrides: { toolCalling: true, contextWindow: 32_768 },
      },
    };
    expect(modelCapabilityOverrideUpdateRequestSchema.parse(request)).toEqual(request);
    expect(
      modelCapabilityOverrideUpdateRequestSchema.safeParse({
        ...request,
        input: { ...request.input, overrides: { apiKey: 'must-not-cross' } },
      }).success,
    ).toBe(false);
  });

  it('keeps knowledge paths out of renderer-controlled query and source inputs', () => {
    const correlationId = createCorrelationId();
    const vaultId = createCorrelationId();
    const sourceId = createCorrelationId();
    const chunkId = createCorrelationId();
    expect(
      knowledgeQueryRequestSchema.safeParse({
        correlationId,
        input: {
          vaultId,
          modelRef: `${createCorrelationId()}:model`,
          query: 'Why architecture B?',
          rootPath: '/Users/private/vault',
        },
      }).success,
    ).toBe(false);
    expect(
      knowledgeSourceRequestSchema.parse({
        correlationId,
        input: { sourceId, chunkId },
      }),
    ).toEqual({ correlationId, input: { sourceId, chunkId } });
    expect(
      knowledgeSourceRequestSchema.safeParse({
        correlationId,
        input: { sourceId, chunkId, notePath: '../../outside.md' },
      }).success,
    ).toBe(false);
  });

  it('does not let the renderer choose a tool or replace approved arguments', () => {
    const correlationId = createCorrelationId();
    expect(
      actionCommandRequestSchema.safeParse({
        correlationId,
        input: {
          requestId: createCorrelationId(),
          text: 'List tasks',
          modelRef: null,
          toolId: 'task.create',
        },
      }).success,
    ).toBe(false);
    expect(
      approvalResolveRequestSchema.safeParse({
        correlationId,
        input: {
          approvalId: createCorrelationId(),
          exactArguments: { title: 'Replacement' },
        },
      }).success,
    ).toBe(false);
  });
});

describe('board pane specs', () => {
  it('allows a login shell without a command and rejects empty custom panes', () => {
    expect(boardPaneSpecSchema.parse({ slot: 0, agentId: 'shell' }).agentId).toBe(
      'shell',
    );
    expect(boardPaneSpecSchema.parse({ slot: 0, agentId: 'kiro' }).agentId).toBe('kiro');
    expect(BOARD_AGENT_CATALOG.find((entry) => entry.id === 'kiro')?.command).toBe(
      'kiro-cli',
    );
    expect(boardPaneSpecSchema.safeParse({ slot: 0, agentId: 'custom' }).success).toBe(
      false,
    );
  });

  it('publishes one honest capability record for every catalogued CLI', () => {
    const byId = new Map(BOARD_AGENT_CATALOG.map((entry) => [entry.id, entry]));
    expect(byId.get('codex')?.capabilities).toMatchObject({
      headless: true,
      structuredOutput: 'json-schema',
      sessionResume: true,
      usageReporting: true,
      swarmModes: ['safe', 'auto', 'full'],
    });
    expect(byId.get('kiro')?.capabilities).toMatchObject({
      headless: true,
      structuredOutput: 'json',
      swarmModes: [],
    });
    expect(byId.get('custom')?.capabilities).toMatchObject({
      interactive: true,
      headless: false,
      structuredOutput: 'none',
      swarmModes: [],
    });
  });

  it('lays out extra terminals across a row instead of a leftover column', () => {
    expect(gridForCount(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridForCount(6)).toEqual({ cols: 3, rows: 2 });
    expect(gridForCount(7)).toEqual({ cols: 4, rows: 2 });
  });
});

describe('preview URLs', () => {
  it('allows http(s) and localhost, rejects file and javascript', () => {
    expect(parsePreviewUrl('localhost:3000')).toBe('http://localhost:3000/');
    expect(parsePreviewUrl('https://example.com/app')).toBe('https://example.com/app');
    expect(parsePreviewUrl('file:///etc/passwd')).toBeNull();
    expect(parsePreviewUrl('javascript:alert(1)')).toBeNull();
    expect(parsePreviewUrl('http://user:pass@host/')).toBeNull();
  });

  it('extracts loopback ports from Vite-style logs', () => {
    const text = '  ➜  Local:   http://localhost:5173/\nready';
    expect(extractPreviewOrigins(text)).toEqual(['http://127.0.0.1:5173/']);
    expect(extractPreviewOrigins('open file:///etc/passwd')).toEqual([]);
  });

  it('keeps snapshot refs and drops extra keys', () => {
    const nodes = buildPageSnapshot([
      { role: 'button', name: 'Sign up', cookie: 'secret', href: 'javascript:alert(1)' },
      { role: '', name: 'ignore' },
    ]);
    expect(nodes).toEqual([{ ref: 'e1', role: 'button', name: 'Sign up' }]);
  });

  it('requires approval for submit and off-origin links', () => {
    expect(
      previewTargetNeedsApproval({
        tag: 'button',
        type: 'submit',
        name: 'Save',
        href: '',
        pageOrigin: 'http://127.0.0.1:5173',
      }),
    ).toBe(true);
    expect(
      previewTargetNeedsApproval({
        tag: 'button',
        type: 'button',
        name: 'Search',
        href: '',
        pageOrigin: 'http://127.0.0.1:5173',
      }),
    ).toBe(false);
    expect(
      previewTargetNeedsApproval({
        tag: 'a',
        type: '',
        name: 'Docs',
        href: 'https://example.com/docs',
        pageOrigin: 'http://127.0.0.1:5173',
      }),
    ).toBe(true);
  });

  it('redacts secrets in preview URLs', () => {
    expect(redactPreviewUrl('http://127.0.0.1:5173/api?token=abc&q=1')).toContain(
      'token=redacted',
    );
    expect(redactPreviewUrl('http://127.0.0.1:5173/api?token=abc&q=1')).not.toContain(
      'abc',
    );
  });

  it('never silent-runs whole-desktop actions', () => {
    expect(desktopActNeedsApproval()).toBe(true);
    expect(escapeAppleScript('say "hi"\\')).toBe('say \\"hi\\"\\\\');
  });
});

describe('editor file read', () => {
  it('rejects an empty path', () => {
    expect(editorReadInputSchema.safeParse({ path: '' }).success).toBe(false);
    expect(
      editorReadRequestSchema.safeParse({
        correlationId: createCorrelationId(),
        input: { path: '' },
      }).success,
    ).toBe(false);
  });

  it('requires a workspace root on read', () => {
    expect(editorReadInputSchema.safeParse({ path: '/tmp/app/a.ts' }).success).toBe(
      false,
    );
    expect(
      editorReadRequestSchema.parse({
        correlationId: createCorrelationId(),
        input: { root: '/tmp/app', path: '/tmp/app/note.txt' },
      }).input.root,
    ).toBe('/tmp/app');
    expect(editorPickIpcResponseSchema.parse({ ok: true, value: null }).value).toBeNull();
  });

  it('requires path, name, and text on a successful read', () => {
    expect(
      editorReadIpcResponseSchema.safeParse({
        ok: true,
        value: { path: '/tmp/a.txt', name: 'a.txt' },
      }).success,
    ).toBe(false);
    expect(
      editorReadIpcResponseSchema.parse({
        ok: true,
        value: { path: '/tmp/a.txt', name: 'a.txt', text: 'hi' },
      }).value.text,
    ).toBe('hi');
  });
});

describe('editor workspace list', () => {
  it('requires a workspace root', () => {
    expect(editorListInputSchema.safeParse({}).success).toBe(false);
    expect(editorListInputSchema.parse({ root: '/tmp/app' }).root).toBe('/tmp/app');
  });

  it('accepts a file tree and a missing git repo', () => {
    expect(
      editorListIpcResponseSchema.parse({
        ok: true,
        value: [{ path: '/tmp/app/src', name: 'src', kind: 'dir' }],
      }).value[0]?.kind,
    ).toBe('dir');
    expect(editorGitIpcResponseSchema.parse({ ok: true, value: null }).value).toBeNull();
  });
});

describe('review contracts', () => {
  it('accepts an empty diff and a clean land inspect', () => {
    expect(reviewDiffIpcResponseSchema.parse({ ok: true, value: [] }).value).toEqual([]);
    expect(
      reviewLandInspectSchema.parse({
        branch: 'exeum/task',
        base: 'main',
        headSha: 'a'.repeat(40),
        reviewedHead: 'a'.repeat(40),
        ahead: 1,
        behind: 0,
        unmerged: [],
        kind: 'clean',
      }).kind,
    ).toBe('clean');
  });
});

describe('GitHub issue contracts', () => {
  it('accepts an assigned issue and an explicit status write', () => {
    expect(
      githubIssueSchema.parse({
        id: 'I_kwDOBuilderHelm1',
        repository: 'acme/builderhelm',
        number: 41,
        title: 'Ship GitHub issue intake',
        body: '',
        url: 'https://github.com/acme/builderhelm/issues/41',
        state: 'open',
        updatedAt: '2026-08-31T12:00:00Z',
        importedCardId: null,
        importedWorkspaceId: null,
      }).number,
    ).toBe(41);
    expect(
      githubIssueImportInputSchema.parse({
        workspace: '00000000-0000-4000-8000-000000000001',
        url: 'https://github.com/acme/builderhelm/issues/41',
      }).url,
    ).toContain('/issues/41');
    expect(
      githubIssueSyncInputSchema.parse({
        cardId: '00000000-0000-4000-8000-000000000002',
        state: 'closed',
        requestId: '00000000-0000-4000-8000-000000000003',
      }).state,
    ).toBe('closed');
  });
});

describe('Linear issue contracts', () => {
  it('accepts an assigned issue and an explicit status write', () => {
    expect(
      linearIssueSchema.parse({
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        identifier: 'ENG-41',
        title: 'Ship Linear issue intake',
        body: '',
        url: 'https://linear.app/acme/issue/ENG-41',
        state: 'open',
        updatedAt: '2026-08-31T12:00:00.000Z',
        importedCardId: null,
        importedWorkspaceId: null,
      }).identifier,
    ).toBe('ENG-41');
    expect(
      linearIssueImportInputSchema.parse({
        workspace: '00000000-0000-4000-8000-000000000001',
        url: 'https://linear.app/acme/issue/ENG-41',
      }).url,
    ).toContain('/issue/ENG-41');
    expect(
      linearIssueSyncInputSchema.parse({
        cardId: '00000000-0000-4000-8000-000000000002',
        state: 'closed',
        requestId: '00000000-0000-4000-8000-000000000003',
      }).state,
    ).toBe('closed');
  });
});
