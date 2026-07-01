import { safeExecute, safeQueryRows } from "@/lib/db";
import { runNativeAutonomousCycle } from "@/lib/brain/commercial/native-cycle";

/**
 * One follow-up polling tick, shared by the worker script, tests and the E2E
 * harness (the cycle runner is injectable so no LLM call is needed to
 * exercise selection, cancellation and idempotency).
 *
 * Cancellation rules (checked before re-entry):
 *  - customer replied since the follow-up was scheduled → cancel
 *  - human owner active / AI paused / conversation closed → cancel
 *  - opportunity in terminal status → cancel
 * Idempotency: status moves planned → executing via compare-and-swap, so a
 * concurrent worker can never re-run the same follow-up.
 */

export type FollowUpCandidate = {
  id: number;
  action_id: string;
  wa_id: string | null;
  conversation_case_id: string | number | null;
  scheduled_for: string | null;
  draft_message: string | null;
};

export type FollowupTickResult = {
  processed: number;
  cancelled: Array<{ actionId: string; reason: string }>;
  executed: string[];
  failed: string[];
};

export type FollowupTickOptions = {
  limit: number;
  dryRun?: boolean;
  /** Restrict the tick to these action_ids (tests/harness isolation). */
  actionIds?: string[];
  cycleRunner?: typeof runNativeAutonomousCycle;
  defaultPhoneNumberId?: string;
  log?: (message: string) => void;
};

export async function selectDueFollowUps(limit: number, actionIds?: string[]): Promise<FollowUpCandidate[]> {
  // The actionIds scope must live in the SQL: older due follow-ups would
  // otherwise consume the LIMIT before an in-memory filter could apply.
  const scope = actionIds && actionIds.length > 0 ? ` AND action_id IN (${actionIds.map(() => "?").join(",")})` : "";
  const result = await safeQueryRows<FollowUpCandidate>(
    `SELECT id, action_id, wa_id, conversation_case_id, scheduled_for, draft_message
      FROM crm_agent_actions
      WHERE action_type = 'schedule_followup'
        AND status = 'planned'
        AND scheduled_for <= UTC_TIMESTAMP()
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())${scope}
      ORDER BY scheduled_for ASC
      LIMIT ?`,
    [...(actionIds && actionIds.length > 0 ? actionIds : []), limit]
  );
  return result.ok ? result.rows : [];
}

async function cancelFollowUp(actionId: string, reason: string): Promise<void> {
  await safeQueryRows(
    `UPDATE crm_agent_actions SET status = 'cancelled', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`,
    [reason, actionId]
  );
}

async function markFollowUpExecuting(actionId: string): Promise<boolean> {
  // Atomic compare-and-swap: only move if still 'planned' (prevents double-run)
  const result = await safeExecute(
    `UPDATE crm_agent_actions SET status = 'executing', updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'planned'`,
    [actionId]
  );
  return result.ok && result.affectedRows > 0;
}

export async function shouldCancelFollowUp(candidate: FollowUpCandidate): Promise<{ cancel: boolean; reason: string }> {
  // Customer replied since schedule_followup was created → the follow-up is stale.
  if (candidate.conversation_case_id) {
    const recentInbound = await safeQueryRows<{ id: number }>(
      `SELECT cm.id FROM conversation_message cm
        INNER JOIN conversation c ON c.id = cm.conversation_id
        WHERE c.id = ? AND cm.direction = 'inbound'
          AND cm.created_at > (
            SELECT created_at FROM crm_agent_actions WHERE action_id = ? LIMIT 1
          )
        LIMIT 1`,
      [candidate.conversation_case_id, candidate.action_id]
    );
    if (recentInbound.ok && recentInbound.rows.length > 0) {
      return { cancel: true, reason: "customer_replied_since_schedule" };
    }

    // A human owner, paused AI or closed conversation makes it incompatible.
    const conv = await safeQueryRows<{ human_owner_active: number; ai_enabled: number; status: string }>(
      `SELECT human_owner_active, ai_enabled, status FROM conversation WHERE id = ? LIMIT 1`,
      [candidate.conversation_case_id]
    );
    if (conv.ok && conv.rows[0]) {
      const row = conv.rows[0];
      if (Number(row.human_owner_active) === 1) return { cancel: true, reason: "human_owner_active" };
      if (Number(row.ai_enabled) === 0) return { cancel: true, reason: "ai_paused" };
      if (["closed", "resolved", "done", "archived"].includes(String(row.status).toLowerCase())) {
        return { cancel: true, reason: "conversation_closed" };
      }
    }
  }

  // Terminal opportunity → nothing to follow up on.
  if (candidate.wa_id) {
    const opp = await safeQueryRows<{ status: string }>(
      `SELECT status FROM crm_opportunities WHERE wa_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [candidate.wa_id]
    );
    if (opp.ok && opp.rows[0]) {
      const terminal = ["won", "lost", "cancelled", "archived"];
      if (terminal.includes(opp.rows[0].status)) {
        return { cancel: true, reason: `opportunity_terminal_status:${opp.rows[0].status}` };
      }
    }
  }

  return { cancel: false, reason: "" };
}

export async function runFollowupTick(options: FollowupTickOptions): Promise<FollowupTickResult> {
  const log = options.log ?? (() => void 0);
  const cycleRunner = options.cycleRunner ?? runNativeAutonomousCycle;
  const result: FollowupTickResult = { processed: 0, cancelled: [], executed: [], failed: [] };

  const candidates = await selectDueFollowUps(options.limit, options.actionIds);
  if (candidates.length === 0) return result;

  for (const candidate of candidates) {
    if (!candidate.wa_id) {
      await cancelFollowUp(candidate.action_id, "missing_wa_id");
      result.cancelled.push({ actionId: candidate.action_id, reason: "missing_wa_id" });
      continue;
    }

    const { cancel, reason } = await shouldCancelFollowUp(candidate);
    if (cancel) {
      log(`[worker:followup] cancelling action ${candidate.action_id}: ${reason}`);
      await cancelFollowUp(candidate.action_id, reason);
      result.cancelled.push({ actionId: candidate.action_id, reason });
      continue;
    }

    if (options.dryRun) {
      log(`[worker:followup] DRY RUN — would re-enter follow-up for wa_id=${candidate.wa_id}`);
      result.processed++;
      continue;
    }

    // Atomic claim — skip if another worker already took this row.
    const locked = await markFollowUpExecuting(candidate.action_id);
    if (!locked) continue;

    const convRows = await safeQueryRows<{ id: number; public_id: string }>(
      `SELECT id, public_id FROM conversation WHERE id = ? LIMIT 1`,
      [candidate.conversation_case_id]
    );
    const conversation = convRows.ok ? convRows.rows[0] ?? null : null;
    if (!conversation) {
      await cancelFollowUp(candidate.action_id, "conversation_not_found");
      result.cancelled.push({ actionId: candidate.action_id, reason: "conversation_not_found" });
      continue;
    }

    const followUpMessage = candidate.draft_message ?? "Hola, ¿en qué puedo ayudarte?";
    const correlationId = `followup:${candidate.action_id}:${Date.now()}`;

    try {
      const cycleResult = await cycleRunner({
        conversationId: conversation.id,
        conversationPublicId: conversation.public_id,
        customerMasterId: null,
        waId: candidate.wa_id,
        phoneNumberId: options.defaultPhoneNumberId ?? process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID ?? "",
        messageId: null,
        messageText: followUpMessage,
        correlationId,
        currentTime: new Date().toISOString()
      });

      const nextAction = cycleResult.loop?.selectedNextAction?.type ?? "none";
      log(`[worker:followup] executed follow-up for ${candidate.wa_id} → loop decided: ${nextAction}`);

      await safeQueryRows(
        `UPDATE crm_agent_actions SET status = 'executed', executed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`,
        [candidate.action_id]
      );
      result.executed.push(candidate.action_id);
      result.processed++;
    } catch (error) {
      log(`[worker:followup] error for action ${candidate.action_id}: ${error instanceof Error ? error.message : String(error)}`);
      await safeQueryRows(
        `UPDATE crm_agent_actions SET status = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`,
        [error instanceof Error ? error.message : "unknown", candidate.action_id]
      );
      result.failed.push(candidate.action_id);
    }
  }

  return result;
}
