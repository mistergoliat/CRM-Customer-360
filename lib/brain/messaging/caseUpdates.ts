import { queryRows, safeQueryRows } from "@/lib/db";
import type { BrainCanonicalOutboundPersistResult, BrainCaseUpdateResult } from "./types";

export const BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND_FLAG = "BRAIN_UPDATE_CASE_AFTER_BACKEND_SEND";

export type UpdateCaseAfterBackendOutboundInput = {
  enabled?: boolean;
  conversationCaseId: string | number | null;
  canonicalPersistResult?: BrainCanonicalOutboundPersistResult | null;
  canonicalPersistenceEnabled?: boolean;
  canonicalMessageId?: number | null;
  debug?: boolean;
};

function buildResult(
  status: BrainCaseUpdateResult["status"],
  caseId: string | number | null,
  updatedFields: string[],
  warning?: string | null
): BrainCaseUpdateResult {
  const result: BrainCaseUpdateResult = {
    status,
    case_id: caseId,
    updated_fields: updatedFields
  };
  if (warning) result.warning = warning;
  return result;
}

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function toConversationId(value: string | number | null) {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function resolveConversation(conversationCaseId: string | number | null) {
  const numeric = toConversationId(conversationCaseId);
  if (numeric !== null) {
    const rows = await safeQueryRows<{ id: number; public_id: string }>("SELECT id, public_id FROM conversation WHERE id = ? LIMIT 1", [numeric]);
    if (rows.ok && rows.rows[0]) return rows.rows[0];
  }
  const text = asText(conversationCaseId);
  if (!text) return null;
  const rows = await safeQueryRows<{ id: number; public_id: string }>("SELECT id, public_id FROM conversation WHERE public_id = ? LIMIT 1", [text]);
  if (!rows.ok) return null;
  return rows.rows[0] ?? null;
}

export async function updateCaseAfterBackendOutbound(
  input: UpdateCaseAfterBackendOutboundInput
): Promise<BrainCaseUpdateResult> {
  const caseId = input.conversationCaseId;

  if (input.enabled !== true) {
    return buildResult("skipped_by_flag", caseId, []);
  }

  if (caseId === null || caseId === undefined || caseId === "") {
    return buildResult("skipped_no_case_id", null, []);
  }

  if (input.canonicalPersistenceEnabled) {
    const canonicalStatus = input.canonicalPersistResult?.status ?? null;
    if (canonicalStatus !== "persisted" && canonicalStatus !== "existing") {
      return buildResult("skipped_no_canonical_message", caseId, [], "Canonical outbound message was not persisted.");
    }
  }

  const conversation = await resolveConversation(caseId);
  if (!conversation) {
    return buildResult("warning", caseId, [], "Conversation not found.");
  }

  const updatedFields = ["last_message_at", "last_outbound_at", "updated_at"];
  await queryRows(
    `
      UPDATE conversation
      SET
        last_message_at = CURRENT_TIMESTAMP(3),
        last_outbound_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?
    `,
    [conversation.id]
  );

  return buildResult("updated", caseId, updatedFields);
}
