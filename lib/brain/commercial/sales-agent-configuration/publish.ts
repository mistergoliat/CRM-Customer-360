import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { auditLog } from "../../../audit";
import { withConnection } from "../../../db";
import { SALES_AGENT_CONFIGURATION_SCOPE, SALES_AGENT_CONFIGURATION_TABLE } from "./constants";
import { computeSalesAgentConfigurationHash } from "./hash";
import {
  archiveConfigurationRowOnConnection,
  loadConfigurationByIdOnConnection,
  runInTransaction,
  withSalesAgentConfigurationScopeLock
} from "./repository";
import {
  SalesAgentConfigurationInvalidError,
  SalesAgentConfigurationNotDraftError,
  SalesAgentConfigurationNotFoundError,
  SalesAgentConfigurationScopeMismatchError,
  type SalesAgentConfigurationConnection,
  type SalesAgentConfigurationRecord
} from "./types";
import { validateSalesAgentConfigurationDocument } from "./validation";

type ExecuteValues = Parameters<SalesAgentConfigurationConnection["execute"]>[1];

function toExecuteValues(values: unknown[]): ExecuteValues {
  return values as unknown as ExecuteValues;
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

async function loadCurrentPublishedIdForUpdate(connection: SalesAgentConfigurationConnection): Promise<number | null> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT id FROM ${SALES_AGENT_CONFIGURATION_TABLE} WHERE scope_key = ? AND status = 'published' LIMIT 1 FOR UPDATE`,
    toExecuteValues([SALES_AGENT_CONFIGURATION_SCOPE])
  );
  const row = rows[0] as { id?: number } | undefined;
  return row?.id ? Number(row.id) : null;
}

export type PublishDraftConfigurationInput = {
  id: number;
};

/**
 * acquire connection -> GET_LOCK -> BEGIN -> load draft FOR UPDATE ->
 * verify scope pesas_chile -> verify status draft -> re-validate + recompute
 * hash (never trust the stored hash blindly) -> archive current published
 * (if any) -> publish this draft -> audit (same transaction) -> COMMIT.
 * Any failure anywhere in this sequence -> ROLLBACK and propagate; the
 * database's own unique key on published_scope_key is the second line of
 * defense against two published rows for the same scope, never relied on
 * as the only guard. RELEASE_LOCK always runs in finally.
 */
export async function publishDraftConfiguration(input: PublishDraftConfigurationInput): Promise<SalesAgentConfigurationRecord> {
  return withConnection((connection) =>
    withSalesAgentConfigurationScopeLock(connection, () =>
      runInTransaction(connection, async () => {
        const draft = await loadConfigurationByIdOnConnection(connection, input.id, { forUpdate: true });
        if (!draft) {
          throw new SalesAgentConfigurationNotFoundError(`sales_agent_configuration_not_found:${input.id}`);
        }
        if (draft.scopeKey !== SALES_AGENT_CONFIGURATION_SCOPE) {
          throw new SalesAgentConfigurationScopeMismatchError(`sales_agent_configuration_scope_mismatch:${input.id}:${draft.scopeKey}`);
        }
        if (draft.status !== "draft") {
          throw new SalesAgentConfigurationNotDraftError(`sales_agent_configuration_not_draft:${input.id}:${draft.status}`);
        }

        // enforceRange: false - publish re-validates shape/type, but never
        // rejects a draft solely because a platform limit tightened after
        // it was authored (same rationale as deserializeConfigurationRow);
        // the resolver clamps the effective value at read time regardless.
        const validation = validateSalesAgentConfigurationDocument(draft.configuration, { enforceRange: false });
        if (!validation.valid) {
          throw new SalesAgentConfigurationInvalidError(`sales_agent_configuration_invalid:${validation.code}`);
        }
        // The draft's own already-stored schemaVersion, never assumed to be
        // today's current constant - a draft is immutable content-wise once
        // recomputing its hash for publish, so the version tag it was
        // stamped with must be preserved exactly.
        const recomputedHash = computeSalesAgentConfigurationHash(validation.configuration, draft.schemaVersion);

        const currentPublishedId = await loadCurrentPublishedIdForUpdate(connection);
        if (currentPublishedId !== null && currentPublishedId !== input.id) {
          await archiveConfigurationRowOnConnection(connection, currentPublishedId, "published");
        }

        const [result] = await connection.execute<ResultSetHeader>(
          `UPDATE ${SALES_AGENT_CONFIGURATION_TABLE}
             SET status = 'published', configuration_hash = ?, published_at = UTC_TIMESTAMP(3)
           WHERE id = ? AND status = 'draft'`,
          toExecuteValues([recomputedHash, input.id])
        );
        if (result.affectedRows === 0) {
          // Belt-and-suspenders: the FOR UPDATE read above should make this
          // unreachable under normal concurrency (a second writer would
          // block on that row lock, never race past it), but a status
          // change must never be assumed to have happened silently.
          throw new SalesAgentConfigurationNotDraftError(`sales_agent_configuration_publish_race:${input.id}`);
        }

        const published = await loadConfigurationByIdOnConnection(connection, input.id);
        if (!published) {
          throw new SalesAgentConfigurationNotFoundError(`sales_agent_configuration_not_found:${input.id}`);
        }

        await auditLog({
          action: "sales_agent_configuration.published",
          entityType: "sales_agent_configuration",
          entityId: published.id,
          after: buildAuditPayload(published),
          connection
        });

        return published;
      })
    )
  );
}
