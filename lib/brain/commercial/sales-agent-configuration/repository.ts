import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { auditLog } from "../../../audit";
import { queryRows, withConnection } from "../../../db";
import {
  SALES_AGENT_CONFIGURATION_LOCK_KEY,
  SALES_AGENT_CONFIGURATION_LOCK_TIMEOUT_SECONDS,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION,
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_CONFIGURATION_TABLE
} from "./constants";
import { computeSalesAgentConfigurationHash } from "./hash";
import {
  SalesAgentConfigurationIntegrityError,
  SalesAgentConfigurationInvalidError,
  SalesAgentConfigurationLockTimeoutError,
  SalesAgentConfigurationNotDraftError,
  SalesAgentConfigurationNotFoundError,
  type SalesAgentConfigurationConnection,
  type SalesAgentConfigurationRecord,
  type SalesAgentConfigurationScope,
  type SalesAgentConfigurationStatus
} from "./types";
import { isSupportedSalesAgentConfigurationSchemaVersion, validateSalesAgentConfigurationDocument } from "./validation";

type ExecuteValues = Parameters<SalesAgentConfigurationConnection["execute"]>[1];

function toExecuteValues(values: unknown[]): ExecuteValues {
  return values as unknown as ExecuteValues;
}

function parseConfigurationJsonColumn(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toIsoStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Maps a raw DB row to the typed record, re-running the same six-field
 * validator used on write. A row this module itself wrote can never fail
 * this - a failure here means real data corruption or an unsupported
 * schema_version, and must throw (propagate), never silently substitute a
 * default. Falling back on read is the resolver's job, not the
 * repository's.
 */
export function deserializeConfigurationRow(row: Record<string, unknown>): SalesAgentConfigurationRecord {
  const id = Number(row.id);
  const schemaVersionRaw = row.schema_version;
  if (!isSupportedSalesAgentConfigurationSchemaVersion(schemaVersionRaw)) {
    throw new SalesAgentConfigurationIntegrityError(`sales_agent_configuration_unsupported_schema_version:${id}:${String(schemaVersionRaw)}`);
  }

  // enforceRange: false - a value that was in range when written can end up
  // outside a platform limit tightened later. Reading it must still succeed
  // (shape/type errors still reject) - the resolver is the one place that
  // clamps to the current limits, never a hard read failure.
  const rawConfiguration = parseConfigurationJsonColumn(row.configuration_json);
  const validation = validateSalesAgentConfigurationDocument(rawConfiguration, { enforceRange: false });
  if (!validation.valid) {
    throw new SalesAgentConfigurationIntegrityError(`sales_agent_configuration_stored_invalid:${id}:${validation.code}`);
  }

  return {
    id,
    scopeKey: row.scope_key as SalesAgentConfigurationScope,
    name: String(row.name ?? ""),
    version: Number(row.version),
    status: row.status as SalesAgentConfigurationStatus,
    schemaVersion: schemaVersionRaw,
    configuration: validation.configuration,
    configurationHash: String(row.configuration_hash ?? ""),
    parentConfigurationId:
      row.parent_configuration_id === null || row.parent_configuration_id === undefined ? null : Number(row.parent_configuration_id),
    createdBy: String(row.created_by ?? ""),
    createdAt: toIsoStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: toIsoStringOrNull(row.updated_at) ?? new Date(0).toISOString(),
    publishedAt: toIsoStringOrNull(row.published_at),
    archivedAt: toIsoStringOrNull(row.archived_at)
  };
}

/**
 * Loads a row using an already-open connection (participates in the
 * caller's transaction/lock) instead of the shared pool - used by
 * update/archive here and reused by publish.ts for its "load draft FOR
 * UPDATE" step.
 */
export async function loadConfigurationByIdOnConnection(
  connection: SalesAgentConfigurationConnection,
  id: number,
  options: { forUpdate?: boolean } = {}
): Promise<SalesAgentConfigurationRecord | null> {
  const sql = `SELECT * FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE id = ? LIMIT 1${options.forUpdate ? " FOR UPDATE" : ""}`;
  const [rows] = await connection.execute<RowDataPacket[]>(sql, toExecuteValues([id]));
  const row = rows[0];
  return row ? deserializeConfigurationRow(row) : null;
}

async function acquireScopeLock(connection: SalesAgentConfigurationConnection): Promise<void> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT GET_LOCK(?, ?) AS acquired",
    toExecuteValues([SALES_AGENT_CONFIGURATION_LOCK_KEY, SALES_AGENT_CONFIGURATION_LOCK_TIMEOUT_SECONDS])
  );
  const acquired = Number((rows[0] as { acquired?: unknown } | undefined)?.acquired) === 1;
  if (!acquired) {
    throw new SalesAgentConfigurationLockTimeoutError(`sales_agent_configuration_lock_timeout:${SALES_AGENT_CONFIGURATION_LOCK_KEY}`);
  }
}

async function releaseScopeLock(connection: SalesAgentConfigurationConnection): Promise<void> {
  try {
    await connection.execute("SELECT RELEASE_LOCK(?)", toExecuteValues([SALES_AGENT_CONFIGURATION_LOCK_KEY]));
  } catch {
    // ignore release failures - MariaDB releases session advisory locks
    // automatically once the connection that took them closes/returns.
  }
}

/**
 * GET_LOCK before BEGIN, same connection throughout, RELEASE_LOCK always in
 * finally - shared by createDraftConfiguration below and by publish.ts
 * (same scope key, same timeout), so version assignment and publish/archive
 * for this scope are always mutually exclusive.
 */
export async function withSalesAgentConfigurationScopeLock<T>(
  connection: SalesAgentConfigurationConnection,
  fn: () => Promise<T>
): Promise<T> {
  await acquireScopeLock(connection);
  try {
    return await fn();
  } finally {
    await releaseScopeLock(connection);
  }
}

/**
 * Manual BEGIN/COMMIT/ROLLBACK on a connection the caller already holds
 * (and may already have an advisory lock on) - lib/db.ts's withTransaction
 * cannot be reused here because it acquires its own connection, which would
 * break the "GET_LOCK and BEGIN on the same connection" requirement. Same
 * manual-transaction-inside-a-lock pattern already used by
 * action-queue/persistAgentAction.ts.
 */
export async function runInTransaction<T>(connection: SalesAgentConfigurationConnection, fn: () => Promise<T>): Promise<T> {
  await connection.beginTransaction();
  try {
    const result = await fn();
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback failures so the original error surfaces
    }
    throw error;
  }
}

export async function loadLatestVersionForScope(
  scopeKey: string = SALES_AGENT_CONFIGURATION_SCOPE,
  connection?: SalesAgentConfigurationConnection
): Promise<number> {
  const sql = `SELECT COALESCE(MAX(version), 0) AS maxVersion FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE scope_key = ?`;
  const rows = connection
    ? (await connection.execute<RowDataPacket[]>(sql, toExecuteValues([scopeKey])))[0]
    : await queryRows<{ maxVersion: number }>(sql, [scopeKey]);
  const first = rows[0] as { maxVersion?: number } | undefined;
  return Number(first?.maxVersion ?? 0);
}

function buildAuditPayload(record: SalesAgentConfigurationRecord) {
  return {
    scopeKey: record.scopeKey,
    configurationId: record.id,
    version: record.version,
    status: record.status,
    configurationHash: record.configurationHash
  };
}

export type CreateDraftConfigurationInput = {
  name: string;
  configuration: unknown;
  createdBy: string;
  parentConfigurationId?: number | null;
};

/**
 * acquire connection -> GET_LOCK -> BEGIN -> MAX(version)+1 -> insert draft
 * -> COMMIT/ROLLBACK -> RELEASE_LOCK (finally) -> release connection.
 */
export async function createDraftConfiguration(input: CreateDraftConfigurationInput): Promise<SalesAgentConfigurationRecord> {
  const validation = validateSalesAgentConfigurationDocument(input.configuration);
  if (!validation.valid) {
    throw new SalesAgentConfigurationInvalidError(`sales_agent_configuration_invalid:${validation.code}`);
  }
  const name = input.name?.trim();
  if (!name) {
    throw new SalesAgentConfigurationInvalidError("sales_agent_configuration_invalid:missing_name");
  }
  const createdBy = input.createdBy?.trim();
  if (!createdBy) {
    throw new SalesAgentConfigurationInvalidError("sales_agent_configuration_invalid:missing_created_by");
  }
  const configurationHash = computeSalesAgentConfigurationHash(validation.configuration, SALES_AGENT_CONFIGURATION_SCHEMA_VERSION);
  const parentConfigurationId = input.parentConfigurationId ?? null;

  return withConnection((connection) =>
    withSalesAgentConfigurationScopeLock(connection, () =>
      runInTransaction(connection, async () => {
        const nextVersion = (await loadLatestVersionForScope(SALES_AGENT_CONFIGURATION_SCOPE, connection)) + 1;

        const [result] = await connection.execute<ResultSetHeader>(
          `INSERT INTO ${SALES_AGENT_CONFIGURATION_TABLE}
            (scope_key, name, version, status, schema_version, configuration_json, configuration_hash, parent_configuration_id, created_by)
           VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
          toExecuteValues([
            SALES_AGENT_CONFIGURATION_SCOPE,
            name,
            nextVersion,
            SALES_AGENT_CONFIGURATION_SCHEMA_VERSION,
            JSON.stringify(validation.configuration),
            configurationHash,
            parentConfigurationId,
            createdBy
          ])
        );

        const record = await loadConfigurationByIdOnConnection(connection, result.insertId);
        if (!record) {
          throw new SalesAgentConfigurationIntegrityError(`sales_agent_configuration_insert_not_found:${result.insertId}`);
        }

        await auditLog({
          action: "sales_agent_configuration.created",
          entityType: "sales_agent_configuration",
          entityId: record.id,
          after: buildAuditPayload(record),
          connection
        });

        return record;
      })
    )
  );
}

export type UpdateDraftConfigurationInput = {
  id: number;
  configuration: unknown;
  name?: string;
};

/**
 * WHERE status = 'draft' only. Zero affectedRows always resolves to a
 * named domain error (not-found vs not-draft), never a silent no-op.
 */
export async function updateDraftConfiguration(input: UpdateDraftConfigurationInput): Promise<SalesAgentConfigurationRecord> {
  const validation = validateSalesAgentConfigurationDocument(input.configuration);
  if (!validation.valid) {
    throw new SalesAgentConfigurationInvalidError(`sales_agent_configuration_invalid:${validation.code}`);
  }
  const configurationHash = computeSalesAgentConfigurationHash(validation.configuration, SALES_AGENT_CONFIGURATION_SCHEMA_VERSION);
  const trimmedName = input.name?.trim();

  return withConnection((connection) =>
    runInTransaction(connection, async () => {
      // Every rewrite of a draft's content is stamped with the current
      // schema version, regardless of what it was tagged before - a draft
      // is mutable, so there is no historical value in preserving a stale
      // schema_version once its content has actually been re-validated and
      // re-written under the current code (unlike published/archived rows,
      // which are immutable history and never touched here).
      const assignments = ["configuration_json = ?", "configuration_hash = ?", "schema_version = ?"];
      const params: unknown[] = [JSON.stringify(validation.configuration), configurationHash, SALES_AGENT_CONFIGURATION_SCHEMA_VERSION];
      if (trimmedName) {
        assignments.push("name = ?");
        params.push(trimmedName);
      }
      params.push(input.id);

      const [result] = await connection.execute<ResultSetHeader>(
        `UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET ${assignments.join(", ")} WHERE id = ? AND status = 'draft'`,
        toExecuteValues(params)
      );

      if (result.affectedRows === 0) {
        const existing = await loadConfigurationByIdOnConnection(connection, input.id);
        if (!existing) {
          throw new SalesAgentConfigurationNotFoundError(`sales_agent_configuration_not_found:${input.id}`);
        }
        throw new SalesAgentConfigurationNotDraftError(`sales_agent_configuration_not_draft:${input.id}:${existing.status}`);
      }

      const record = await loadConfigurationByIdOnConnection(connection, input.id);
      if (!record) {
        throw new SalesAgentConfigurationNotFoundError(`sales_agent_configuration_not_found:${input.id}`);
      }

      await auditLog({
        action: "sales_agent_configuration.updated",
        entityType: "sales_agent_configuration",
        entityId: record.id,
        after: buildAuditPayload(record),
        connection
      });

      return record;
    })
  );
}

export async function loadConfigurationById(id: number): Promise<SalesAgentConfigurationRecord | null> {
  const rows = await queryRows<Record<string, unknown>>(`SELECT * FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE id = ? LIMIT 1`, [id]);
  const row = rows[0];
  return row ? deserializeConfigurationRow(row) : null;
}

export async function loadPublishedPesasChileConfiguration(): Promise<SalesAgentConfigurationRecord | null> {
  const rows = await queryRows<Record<string, unknown>>(
    `SELECT * FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE scope_key = ? AND status = 'published' LIMIT 1`,
    [SALES_AGENT_CONFIGURATION_SCOPE]
  );
  const row = rows[0];
  return row ? deserializeConfigurationRow(row) : null;
}

export type ListPesasChileConfigurationsInput = {
  status?: SalesAgentConfigurationStatus | SalesAgentConfigurationStatus[];
  limit?: number;
};

export async function listPesasChileConfigurations(input: ListPesasChileConfigurationsInput = {}): Promise<SalesAgentConfigurationRecord[]> {
  const statuses = input.status === undefined ? [] : Array.isArray(input.status) ? input.status : [input.status];
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);

  const conditions = ["scope_key = ?"];
  const params: unknown[] = [SALES_AGENT_CONFIGURATION_SCOPE];
  if (statuses.length > 0) {
    conditions.push(`status IN (${statuses.map(() => "?").join(", ")})`);
    params.push(...statuses);
  }

  const rows = await queryRows<Record<string, unknown>>(
    `SELECT * FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE ${conditions.join(" AND ")} ORDER BY version DESC LIMIT ${limit}`,
    params
  );
  return rows.map(deserializeConfigurationRow);
}

export function assertConfigurationIsDraft(record: SalesAgentConfigurationRecord): void {
  if (record.status !== "draft") {
    throw new SalesAgentConfigurationNotDraftError(`sales_agent_configuration_not_draft:${record.id}:${record.status}`);
  }
}

/** Direct DB update, no repository-level fallback on missing rows/status. */
export async function archiveConfigurationRowOnConnection(
  connection: SalesAgentConfigurationConnection,
  id: number,
  previousStatus: Extract<SalesAgentConfigurationStatus, "draft" | "published">
): Promise<void> {
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE ${SALES_AGENT_CONFIGURATION_TABLE} SET status = 'archived', archived_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = ?`,
    toExecuteValues([id, previousStatus])
  );
  if (result.affectedRows === 0) {
    throw new SalesAgentConfigurationNotFoundError(`sales_agent_configuration_archive_failed:${id}:${previousStatus}`);
  }
}

/**
 * Standalone archive (own connection/transaction, no scope lock needed -
 * keyed by id, not by scope-version assignment). publish.ts archives the
 * previously published row inline within its own locked transaction instead
 * of calling this - this is for archiving a draft/published row outside a
 * publish flow (e.g. abandoning a draft).
 */
export async function archiveConfiguration(id: number): Promise<SalesAgentConfigurationRecord> {
  return withConnection((connection) =>
    runInTransaction(connection, async () => {
      const existing = await loadConfigurationByIdOnConnection(connection, id, { forUpdate: true });
      if (!existing) {
        throw new SalesAgentConfigurationNotFoundError(`sales_agent_configuration_not_found:${id}`);
      }
      if (existing.status !== "draft" && existing.status !== "published") {
        throw new SalesAgentConfigurationNotDraftError(`sales_agent_configuration_already_archived:${id}`);
      }

      await archiveConfigurationRowOnConnection(connection, id, existing.status);

      const record = await loadConfigurationByIdOnConnection(connection, id);
      if (!record) {
        throw new SalesAgentConfigurationNotFoundError(`sales_agent_configuration_not_found:${id}`);
      }

      await auditLog({
        action: "sales_agent_configuration.archived",
        entityType: "sales_agent_configuration",
        entityId: record.id,
        after: buildAuditPayload(record),
        connection
      });

      return record;
    })
  );
}
