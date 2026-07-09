import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool, sanitizeDbError } from "@/lib/db";
import type {
  CustomerOnboardingStoragePort,
  NewOnboardingStateRow,
  OnboardingFindResult,
  OnboardingInsertResult,
  OnboardingStateUpdatePatch,
  OnboardingUpdateResult
} from "./ports";
import type { CustomerOnboardingCollectedData, CustomerOnboardingPendingField, CustomerOnboardingState } from "./types";

const TABLE = "crm_customer_onboarding_state";

const DUPLICATE_ENTRY_ERRNO = 1062;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
    return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function parseJsonObject(value: unknown): CustomerOnboardingCollectedData {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as CustomerOnboardingCollectedData;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(value: unknown): CustomerOnboardingPendingField[] {
  if (Array.isArray(value)) return value as CustomerOnboardingPendingField[];
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toRow(row: RowDataPacket): CustomerOnboardingState {
  return {
    id: Number(row.id),
    conversationId: String(row.conversation_id),
    opportunityId: row.opportunity_id === null || row.opportunity_id === undefined ? null : String(row.opportunity_id),
    status: row.status as CustomerOnboardingState["status"],
    purpose: row.purpose as CustomerOnboardingState["purpose"],
    collected: parseJsonObject(row.collected_json),
    pendingFields: parseJsonArray(row.pending_fields_json),
    customerId: row.customer_id === null || row.customer_id === undefined ? null : String(row.customer_id),
    failedVerificationAttempts: Number(row.failed_verification_attempts ?? 0),
    version: Number(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: toIsoOrNull(row.completed_at)
  };
}

function isDuplicateEntryError(error: unknown) {
  return Boolean(error && typeof error === "object" && "errno" in error && (error as { errno?: number }).errno === DUPLICATE_ENTRY_ERRNO);
}

export function createSqlCustomerOnboardingRepository(): CustomerOnboardingStoragePort {
  return {
    async findByConversationId(conversationId: string): Promise<OnboardingFindResult> {
      try {
        const [rows] = await getPool().execute<RowDataPacket[]>(
          `SELECT * FROM \`${TABLE}\` WHERE conversation_id = ? LIMIT 1`,
          [conversationId]
        );
        return { ok: true, row: rows[0] ? toRow(rows[0]) : null };
      } catch (error) {
        return { ok: false, error: sanitizeDbError(error) };
      }
    },

    async insert(input: NewOnboardingStateRow): Promise<OnboardingInsertResult> {
      try {
        const [result] = await getPool().execute<ResultSetHeader>(
          `INSERT INTO \`${TABLE}\`
            (conversation_id, opportunity_id, status, purpose, collected_json, pending_fields_json, customer_id, failed_verification_attempts, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            input.conversationId,
            input.opportunityId,
            input.status,
            input.purpose,
            JSON.stringify(input.collected),
            JSON.stringify(input.pendingFields),
            input.customerId,
            input.failedVerificationAttempts
          ]
        );
        const [rows] = await getPool().execute<RowDataPacket[]>(`SELECT * FROM \`${TABLE}\` WHERE id = ? LIMIT 1`, [result.insertId]);
        if (!rows[0]) return { ok: false, reason: "error", error: "onboarding_state_insert_not_found" };
        return { ok: true, row: toRow(rows[0]) };
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          return { ok: false, reason: "duplicate", error: "onboarding_state_duplicate" };
        }
        return { ok: false, reason: "error", error: sanitizeDbError(error) };
      }
    },

    async updateWithVersion(conversationId: string, expectedVersion: number, patch: OnboardingStateUpdatePatch): Promise<OnboardingUpdateResult> {
      const assignments: string[] = [];
      const params: Array<string | number | null> = [];

      if (patch.status !== undefined) {
        assignments.push("status = ?");
        params.push(patch.status);
      }
      if (patch.collected !== undefined) {
        assignments.push("collected_json = ?");
        params.push(JSON.stringify(patch.collected));
      }
      if (patch.pendingFields !== undefined) {
        assignments.push("pending_fields_json = ?");
        params.push(JSON.stringify(patch.pendingFields));
      }
      if (patch.customerId !== undefined) {
        assignments.push("customer_id = ?");
        params.push(patch.customerId);
      }
      if (patch.failedVerificationAttempts !== undefined) {
        assignments.push("failed_verification_attempts = ?");
        params.push(patch.failedVerificationAttempts);
      }
      if (patch.completedAt !== undefined) {
        assignments.push("completed_at = ?");
        params.push(patch.completedAt === null ? null : patch.completedAt.slice(0, 23).replace("T", " "));
      }

      assignments.push("version = version + 1");
      assignments.push("updated_at = CURRENT_TIMESTAMP(3)");

      try {
        const [result] = await getPool().execute<ResultSetHeader>(
          `UPDATE \`${TABLE}\` SET ${assignments.join(", ")} WHERE conversation_id = ? AND version = ?`,
          [...params, conversationId, expectedVersion]
        );

        if (result.affectedRows === 0) {
          const [existingRows] = await getPool().execute<RowDataPacket[]>(
            `SELECT * FROM \`${TABLE}\` WHERE conversation_id = ? LIMIT 1`,
            [conversationId]
          );
          if (!existingRows[0]) return { ok: false, reason: "not_found" };
          return { ok: false, reason: "version_conflict" };
        }

        const [rows] = await getPool().execute<RowDataPacket[]>(
          `SELECT * FROM \`${TABLE}\` WHERE conversation_id = ? LIMIT 1`,
          [conversationId]
        );
        if (!rows[0]) return { ok: false, reason: "not_found" };
        return { ok: true, row: toRow(rows[0]) };
      } catch (error) {
        return { ok: false, reason: "error", error: sanitizeDbError(error) };
      }
    }
  };
}
