import type { ZeroDatabase } from './database.js';

export interface StoredProvider extends Record<string, unknown> {
  id: string;
  label: string;
  protocol: string;
  baseUrl: string | null;
  secretRef: string;
  headersJson: string;
  allowPersonal: number;
  allowSensitive: number;
  allowHealth: number;
  enabled: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWrite {
  readonly id: string;
  readonly label: string;
  readonly protocol: string;
  readonly baseUrl: string | null;
  readonly secretRef: string;
  readonly headersJson: string;
  readonly allowPersonal: boolean;
  readonly allowSensitive: boolean;
  readonly allowHealth: boolean;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SecretMetadataWrite {
  readonly ref: string;
  readonly providerId: string;
  readonly service: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuditEventWrite {
  readonly id: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly correlationId: string;
  readonly riskLevel: string;
  readonly resourceRefsJson: string;
  readonly beforeJson: string | null;
  readonly afterJson: string | null;
  readonly approvalId: string | null;
  readonly createdAt: string;
}

export interface StoredAuditEvent extends Record<string, unknown> {
  id: string;
  eventType: string;
  correlationId: string;
  beforeJson: string | null;
  afterJson: string | null;
}

const providerColumns = `
  id,
  label,
  protocol,
  base_url AS baseUrl,
  secret_ref AS secretRef,
  headers_json AS headersJson,
  allow_personal AS allowPersonal,
  allow_sensitive AS allowSensitive,
  allow_health AS allowHealth,
  enabled,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

export class ProviderRepository {
  constructor(private readonly database: ZeroDatabase) {}

  list(): StoredProvider[] {
    return this.database.queryAll<StoredProvider>(
      `SELECT ${providerColumns} FROM providers ORDER BY lower(label), id`,
    );
  }

  findById(id: string): StoredProvider | undefined {
    return this.database.queryOne<StoredProvider>(
      `SELECT ${providerColumns} FROM providers WHERE id = ?`,
      [id],
    );
  }

  create(
    provider: ProviderWrite,
    secretMetadata: SecretMetadataWrite,
    audit: AuditEventWrite,
  ): void {
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO providers (
          id, label, protocol, base_url, secret_ref, headers_json,
          allow_personal, allow_sensitive, allow_health, enabled,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          provider.id,
          provider.label,
          provider.protocol,
          provider.baseUrl,
          provider.secretRef,
          provider.headersJson,
          Number(provider.allowPersonal),
          Number(provider.allowSensitive),
          Number(provider.allowHealth),
          Number(provider.enabled),
          provider.createdAt,
          provider.updatedAt,
        ],
      );
      this.database.run(
        `INSERT INTO secret_metadata (
          ref, provider_id, service, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          secretMetadata.ref,
          secretMetadata.providerId,
          secretMetadata.service,
          secretMetadata.createdAt,
          secretMetadata.updatedAt,
        ],
      );
      this.insertAudit(audit);
    });
  }

  update(
    provider: ProviderWrite,
    audit: AuditEventWrite,
    credentialChanged: boolean,
  ): void {
    this.database.transaction(() => {
      this.database.run(
        `UPDATE providers SET
          label = ?, protocol = ?, base_url = ?, headers_json = ?,
          allow_personal = ?, allow_sensitive = ?, allow_health = ?,
          enabled = ?, updated_at = ?
        WHERE id = ?`,
        [
          provider.label,
          provider.protocol,
          provider.baseUrl,
          provider.headersJson,
          Number(provider.allowPersonal),
          Number(provider.allowSensitive),
          Number(provider.allowHealth),
          Number(provider.enabled),
          provider.updatedAt,
          provider.id,
        ],
      );
      if (credentialChanged) {
        this.database.run(
          'UPDATE secret_metadata SET updated_at = ? WHERE provider_id = ?',
          [provider.updatedAt, provider.id],
        );
      }
      this.insertAudit(audit);
    });
  }

  delete(providerId: string, audit: AuditEventWrite): void {
    this.database.transaction(() => {
      this.database.run('DELETE FROM providers WHERE id = ?', [providerId]);
      this.insertAudit(audit);
    });
  }

  listAuditEvents(): StoredAuditEvent[] {
    return this.database.queryAll<StoredAuditEvent>(`
      SELECT
        id,
        event_type AS eventType,
        correlation_id AS correlationId,
        before_json AS beforeJson,
        after_json AS afterJson
      FROM audit_events
      ORDER BY rowid
    `);
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
