import { safeQueryRows } from "@/lib/db";
import { checkCustomerOptOutStatus } from "@/lib/brain/commercial/optOutStore";
import { FOLLOW_UP_ACTION_TYPE, FOLLOW_UP_TECHNICAL_HISTORY_UNAVAILABLE_MESSAGE } from "./constants";
import { mapFollowUpRow, type FollowUpRawRow } from "./rowMapper";
import type { FollowUpDetailReadModel, FollowUpOutboxCorrelation } from "./types";

type DetailRow = FollowUpRawRow & {
  created_at: string | null;
  approved_at: string | null;
  executed_at: string | null;
  cancelled_at: string | null;
  block_reasons_json: unknown;
  followup_configuration_id: number | null;
  followup_configuration_hash: string | null;
};

function asIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value).includes("T") ? String(value) : `${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeBlockReasons(raw: unknown): string[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Decision 9 (approved audit): best-effort only, never a stored FK. Follows
 * the exact correlation path a follow-up execution actually leaves behind
 * (runFollowupTick.ts re-enters the cycle with correlationId =
 * `followup:<actionId>:<ms>`, persisted verbatim on
 * crm_agent_decisions.correlation_id - see persistCommercialState.ts) - the
 * absence of a match is never treated as an error, only as "sin mensaje
 * correlacionado".
 */
async function resolveOutboxCorrelation(actionId: string): Promise<FollowUpOutboxCorrelation> {
  const candidates = await safeQueryRows<{ outbox_message_id: number }>(
    `
      SELECT DISTINCT a2.outbox_message_id
      FROM crm_agent_decisions d
      JOIN crm_agent_actions a2 ON a2.decision_id = d.decision_id
      WHERE d.correlation_id LIKE CONCAT('followup:', ?, ':%')
        AND a2.action_type = 'send_whatsapp_reply'
        AND a2.outbox_message_id IS NOT NULL
    `,
    [actionId]
  );

  if (!candidates.ok || candidates.rows.length === 0) return { kind: "none" };
  if (candidates.rows.length > 1) return { kind: "ambiguous", candidateCount: candidates.rows.length };

  const outboxMessageId = Number(candidates.rows[0].outbox_message_id);
  const outboxRow = await safeQueryRows<{ status: string | null; sent_at: string | null }>(
    `SELECT status, sent_at FROM brain_message_outbox WHERE id = ? LIMIT 1`,
    [outboxMessageId]
  );
  const outbox = outboxRow.ok ? outboxRow.rows[0] : null;
  return {
    kind: "correlated",
    outboxMessageId,
    status: outbox?.status ?? null,
    sentAt: asIsoOrNull(outbox?.sent_at ?? null)
  };
}

export async function getFollowUpDetail(actionId: string): Promise<FollowUpDetailReadModel> {
  const rowResult = await safeQueryRows<DetailRow>(
    `
      SELECT
        action_id, status, opportunity_id, conversation_case_id, wa_id, attempt_number, max_attempts,
        scheduled_for, cancel_reason, failure_reason, block_reasons_json,
        followup_configuration_source, followup_configuration_id, followup_configuration_version, followup_configuration_hash,
        created_at, updated_at, approved_at, executed_at, cancelled_at
      FROM crm_agent_actions
      WHERE action_id = ? AND action_type = ?
      LIMIT 1
    `,
    [actionId, FOLLOW_UP_ACTION_TYPE]
  );

  if (!rowResult.ok) {
    console.error("follow_up_observability_detail_query_failed", rowResult.error);
    return { detail: null, warnings: ["detail_unavailable"] };
  }
  const row = rowResult.rows[0];
  if (!row) return { detail: null, warnings: [] };

  const warnings: string[] = [];

  const [opportunityResult, conversationResult, outboxCorrelation] = await Promise.all([
    row.opportunity_id !== null
      ? safeQueryRows<{ id: number; opportunity_key: string | null; status: string | null; stage: string | null }>(
          `SELECT id, opportunity_key, status, stage FROM crm_opportunities WHERE id = ? LIMIT 1`,
          [row.opportunity_id]
        )
      : Promise.resolve({ ok: true as const, rows: [] }),
    row.conversation_case_id !== null
      ? safeQueryRows<{ id: number; status: string | null; human_owner_active: number; ai_enabled: number }>(
          `SELECT id, status, human_owner_active, ai_enabled FROM conversation WHERE id = ? LIMIT 1`,
          [row.conversation_case_id]
        )
      : Promise.resolve({ ok: true as const, rows: [] }),
    resolveOutboxCorrelation(actionId)
  ]);

  if (!opportunityResult.ok) warnings.push("opportunity_lookup_unavailable");
  if (!conversationResult.ok) warnings.push("conversation_lookup_unavailable");

  let optOut: { optedOut: boolean } | null = null;
  if (row.wa_id) {
    const status = await checkCustomerOptOutStatus(row.wa_id);
    if (status === "unavailable") {
      warnings.push("opt_out_status_unavailable");
    } else {
      optOut = { optedOut: status === "opted_out" };
    }
  }

  const opportunityRow = opportunityResult.ok ? opportunityResult.rows[0] ?? null : null;
  const conversationRow = conversationResult.ok ? conversationResult.rows[0] ?? null : null;

  return {
    detail: {
      item: mapFollowUpRow(row),
      timestamps: {
        createdAt: asIsoOrNull(row.created_at),
        updatedAt: asIsoOrNull(row.updated_at),
        approvedAt: asIsoOrNull(row.approved_at),
        executedAt: asIsoOrNull(row.executed_at),
        cancelledAt: asIsoOrNull(row.cancelled_at)
      },
      reasons: {
        cancelReason: row.cancel_reason,
        failureReason: row.failure_reason,
        blockReasons: sanitizeBlockReasons(row.block_reasons_json)
      },
      configurationSnapshot: {
        source: row.followup_configuration_source,
        recordId: row.followup_configuration_id,
        version: row.followup_configuration_version,
        hash: row.followup_configuration_hash
      },
      opportunity: opportunityRow
        ? { id: opportunityRow.id, key: opportunityRow.opportunity_key, status: opportunityRow.status, stage: opportunityRow.stage }
        : null,
      conversation: conversationRow
        ? {
            id: conversationRow.id,
            status: conversationRow.status,
            humanOwnerActive: Number(conversationRow.human_owner_active) === 1,
            aiEnabled: Number(conversationRow.ai_enabled) === 1
          }
        : null,
      optOut,
      outboxCorrelation,
      technicalHistoryAvailable: false,
      technicalHistoryMessage: FOLLOW_UP_TECHNICAL_HISTORY_UNAVAILABLE_MESSAGE
    },
    warnings
  };
}
