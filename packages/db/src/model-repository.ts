import type { ZeroDatabase } from './database.js';
import type { AuditEventWrite } from './provider-repository.js';

export interface ModelCapabilitiesWrite {
  readonly text: boolean;
  readonly vision: boolean;
  readonly audioInput: boolean;
  readonly toolCalling: boolean;
  readonly parallelTools: boolean;
  readonly structuredOutput: boolean;
  readonly streaming: boolean;
  readonly reasoningControls: boolean;
  readonly serverWebSearch: boolean;
  readonly serverMcp: boolean;
  readonly contextWindow: number | null;
  readonly maxOutputTokens: number | null;
  readonly metadataJson: string;
}

export interface ModelWrite {
  readonly id: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly label: string;
  readonly privacyClass: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly capabilities: ModelCapabilitiesWrite;
}

export interface StoredModel extends Record<string, unknown> {
  id: string;
  providerId: string;
  modelId: string;
  label: string;
  privacyClass: string;
  enabled: number;
  createdAt: string;
  updatedAt: string;
  text: number;
  vision: number;
  audioInput: number;
  toolCalling: number;
  parallelTools: number;
  structuredOutput: number;
  streaming: number;
  reasoningControls: number;
  serverWebSearch: number;
  serverMcp: number;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  metadataJson: string;
}

export interface StoredModelCapabilityOverride extends Record<string, unknown> {
  providerId: string;
  modelId: string;
  overridesJson: string;
  baseCapabilitiesJson: string;
  updatedAt: string;
}

export interface ModelCapabilityBaseline {
  readonly modelId: string;
  readonly capabilitiesJson: string;
}

const modelColumns = `
  models.id,
  models.provider_id AS providerId,
  models.model_id AS modelId,
  models.label,
  models.privacy_class AS privacyClass,
  models.enabled,
  models.created_at AS createdAt,
  models.updated_at AS updatedAt,
  model_capabilities.text,
  model_capabilities.vision,
  model_capabilities.audio_input AS audioInput,
  model_capabilities.tool_calling AS toolCalling,
  model_capabilities.parallel_tools AS parallelTools,
  model_capabilities.structured_output AS structuredOutput,
  model_capabilities.streaming,
  model_capabilities.reasoning_controls AS reasoningControls,
  model_capabilities.server_web_search AS serverWebSearch,
  model_capabilities.server_mcp AS serverMcp,
  model_capabilities.context_window AS contextWindow,
  model_capabilities.max_output_tokens AS maxOutputTokens,
  model_capabilities.metadata_json AS metadataJson
`;

export class ModelRepository {
  constructor(private readonly database: ZeroDatabase) {}

  list(providerId?: string): StoredModel[] {
    const filter = providerId === undefined ? '' : 'WHERE models.provider_id = ?';
    return this.database.queryAll<StoredModel>(
      `SELECT ${modelColumns}
       FROM models
       INNER JOIN model_capabilities ON model_capabilities.model_id = models.id
       ${filter}
       ORDER BY lower(models.label), models.id`,
      providerId === undefined ? [] : [providerId],
    );
  }

  listCapabilityOverrides(providerId?: string): StoredModelCapabilityOverride[] {
    const filter = providerId === undefined ? '' : 'WHERE provider_id = ?';
    return this.database.queryAll<StoredModelCapabilityOverride>(
      `SELECT
        provider_id AS providerId,
        model_id AS modelId,
        overrides_json AS overridesJson,
        base_capabilities_json AS baseCapabilitiesJson,
        updated_at AS updatedAt
       FROM model_capability_overrides
       ${filter}
       ORDER BY provider_id, model_id`,
      providerId === undefined ? [] : [providerId],
    );
  }

  replaceForProvider(
    providerId: string,
    models: readonly ModelWrite[],
    baselines: readonly ModelCapabilityBaseline[] = [],
  ): void {
    if (models.some((model) => model.providerId !== providerId)) {
      throw new TypeError('Cannot persist a model under a different provider');
    }

    this.database.transaction(() => {
      for (const baseline of baselines) {
        this.database.run(
          `UPDATE model_capability_overrides
           SET base_capabilities_json = ?
           WHERE provider_id = ? AND model_id = ?`,
          [baseline.capabilitiesJson, providerId, baseline.modelId],
        );
      }
      this.database.run('DELETE FROM models WHERE provider_id = ?', [providerId]);

      for (const model of models) {
        this.database.run(
          `INSERT INTO models (
            id, provider_id, model_id, label, privacy_class, enabled,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            model.id,
            model.providerId,
            model.modelId,
            model.label,
            model.privacyClass,
            Number(model.enabled),
            model.createdAt,
            model.updatedAt,
          ],
        );
        this.database.run(
          `INSERT INTO model_capabilities (
            model_id, text, vision, audio_input, tool_calling, parallel_tools,
            structured_output, streaming, reasoning_controls, server_web_search,
            server_mcp, context_window, max_output_tokens, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            model.id,
            Number(model.capabilities.text),
            Number(model.capabilities.vision),
            Number(model.capabilities.audioInput),
            Number(model.capabilities.toolCalling),
            Number(model.capabilities.parallelTools),
            Number(model.capabilities.structuredOutput),
            Number(model.capabilities.streaming),
            Number(model.capabilities.reasoningControls),
            Number(model.capabilities.serverWebSearch),
            Number(model.capabilities.serverMcp),
            model.capabilities.contextWindow,
            model.capabilities.maxOutputTokens,
            model.capabilities.metadataJson,
          ],
        );
      }
    });
  }

  setCapabilityOverride(input: {
    readonly providerId: string;
    readonly modelId: string;
    readonly overridesJson: string | null;
    readonly baseCapabilitiesJson: string;
    readonly effectiveCapabilities: ModelCapabilitiesWrite;
    readonly updatedAt: string;
    readonly audit: AuditEventWrite;
  }): void {
    this.database.transaction(() => {
      if (input.overridesJson === null) {
        this.database.run(
          'DELETE FROM model_capability_overrides WHERE provider_id = ? AND model_id = ?',
          [input.providerId, input.modelId],
        );
      } else {
        this.database.run(
          `INSERT INTO model_capability_overrides (
            provider_id, model_id, overrides_json, base_capabilities_json, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(provider_id, model_id) DO UPDATE SET
            overrides_json = excluded.overrides_json,
            base_capabilities_json = excluded.base_capabilities_json,
            updated_at = excluded.updated_at`,
          [
            input.providerId,
            input.modelId,
            input.overridesJson,
            input.baseCapabilitiesJson,
            input.updatedAt,
          ],
        );
      }

      this.database.run(
        `UPDATE model_capabilities SET
          text = ?, vision = ?, audio_input = ?, tool_calling = ?, parallel_tools = ?,
          structured_output = ?, streaming = ?, reasoning_controls = ?,
          server_web_search = ?, server_mcp = ?, context_window = ?, max_output_tokens = ?,
          metadata_json = ?
        WHERE model_id = (
          SELECT id FROM models WHERE provider_id = ? AND model_id = ?
        )`,
        [
          Number(input.effectiveCapabilities.text),
          Number(input.effectiveCapabilities.vision),
          Number(input.effectiveCapabilities.audioInput),
          Number(input.effectiveCapabilities.toolCalling),
          Number(input.effectiveCapabilities.parallelTools),
          Number(input.effectiveCapabilities.structuredOutput),
          Number(input.effectiveCapabilities.streaming),
          Number(input.effectiveCapabilities.reasoningControls),
          Number(input.effectiveCapabilities.serverWebSearch),
          Number(input.effectiveCapabilities.serverMcp),
          input.effectiveCapabilities.contextWindow,
          input.effectiveCapabilities.maxOutputTokens,
          input.effectiveCapabilities.metadataJson,
          input.providerId,
          input.modelId,
        ],
      );
      this.insertAudit(input.audit);
    });
  }

  private insertAudit(audit: AuditEventWrite): void {
    this.database.run(
      `INSERT INTO audit_events (
        id, event_type, actor_type, actor_id, correlation_id, risk_level,
        resource_refs_json, before_json, after_json, approval_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        audit.id,
        audit.eventType,
        audit.actorType,
        audit.actorId,
        audit.correlationId,
        audit.riskLevel,
        audit.resourceRefsJson,
        audit.beforeJson,
        audit.afterJson,
        audit.approvalId,
        audit.createdAt,
      ],
    );
  }
}
