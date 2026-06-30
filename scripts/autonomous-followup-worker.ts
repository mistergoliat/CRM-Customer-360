/**
 * autonomous-followup-worker
 *
 * Polls crm_agent_actions for schedule_followup rows whose scheduled_for has
 * passed and re-enters them into the autonomous commercial cycle as a new
 * CommercialEvent — NOT by building the message inline.
 *
 * Cancellation rules (checked before re-entry):
 *   - customer replied since the follow-up was scheduled → cancel
 *   - opportunity status changed to terminal (won/lost/cancelled) → cancel
 *   - action already in executed/cancelled/failed state → skip
 *   - scheduled_for not yet reached → skip
 *
 * Each follow-up produces exactly one new inbound-shaped cycle run.
 * Idempotency: the action status is moved to 'executing' atomically before
 * calling the cycle, and to 'executed' or 'failed' afterward.
 *
 * Usage:
 *   npm run worker:followup
 *   npm run worker:followup -- --poll-ms=30000 --limit=10 --dry-run
 */

import path from "node:path";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";

const DEFAULT_POLL_MS = 30000; // check every 30s — don't need sub-minute precision
const DEFAULT_LIMIT = 5;

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((v) => v.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : null;
}

function readIntArg(name: string, fallback: number): number {
  const raw = readArg(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolArg(name: string, fallback = false): boolean {
  const raw = readArg(name) ?? (process.argv.includes(`--${name}`) ? "true" : null);
  if (raw === null) return fallback;
  return raw.toLowerCase() !== "false" && raw !== "0";
}

async function loadRuntimeEnv() {
  await loadLocalEnv();
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env.local"), false);
  await loadEnvFile(path.resolve(PROJECT_ROOT, ".env"), false);

  // Follow-up worker enables the full autonomous cycle for each re-entry
  const overrides: Record<string, string> = {
    BRAIN_SALES_AGENT_ENABLED: "true",
    BRAIN_SALES_AGENT_DRY_RUN: "false",
    BRAIN_COMMERCIAL_SHADOW_ENABLED: "true",
    BRAIN_COMMERCIAL_RUNTIME_ENABLED: "true",
    BRAIN_COMMERCIAL_POLICY_ENABLED: "true",
    BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER: "true",
    BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED: "true",
    BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED: "true",
    BRAIN_AGENT_ACTION_QUEUE_ENABLED: "true",
    BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED: "true",
    BRAIN_EXECUTION_GATE_ENABLED: "true",
    BRAIN_OUTBOX_BRIDGE_ENABLED: "true",
    BRAIN_AUTONOMOUS_REPLY_ENABLED: "true"
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

type FollowUpCandidate = {
  id: number;
  action_id: string;
  wa_id: string | null;
  conversation_case_id: string | number | null;
  scheduled_for: string | null;
  draft_message: string | null;
};

let workerRunning = true;

async function selectDueFollowUps(limit: number): Promise<FollowUpCandidate[]> {
  const { safeQueryRows } = await import("../lib/db");
  const result = await safeQueryRows<FollowUpCandidate>(
    `SELECT id, action_id, wa_id, conversation_case_id, scheduled_for, draft_message
      FROM crm_agent_actions
      WHERE action_type = 'schedule_followup'
        AND status = 'planned'
        AND scheduled_for <= UTC_TIMESTAMP()
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
      ORDER BY scheduled_for ASC
      LIMIT ?`,
    [limit]
  );
  return result.ok ? result.rows : [];
}

async function cancelFollowUp(actionId: string, reason: string): Promise<void> {
  const { safeQueryRows } = await import("../lib/db");
  await safeQueryRows(
    `UPDATE crm_agent_actions SET status = 'cancelled', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`,
    [reason, actionId]
  );
}

async function markFollowUpExecuting(actionId: string): Promise<boolean> {
  const { safeQueryRows } = await import("../lib/db");
  // Atomic compare-and-swap: only move if still 'planned' (prevents double-run)
  const result = await safeQueryRows(
    `UPDATE crm_agent_actions SET status = 'executing', updated_at = CURRENT_TIMESTAMP(3)
      WHERE action_id = ? AND status = 'planned'`,
    [actionId]
  );
  if (!result.ok) return false;
  const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
  return affected > 0;
}

async function shouldCancelFollowUp(candidate: FollowUpCandidate): Promise<{ cancel: boolean; reason: string }> {
  const { safeQueryRows } = await import("../lib/db");

  // Check if customer replied since schedule_followup was created
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
  }

  // Check opportunity terminal state
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

async function getConversationPublicId(conversationCaseId: string | number | null): Promise<string | null> {
  if (!conversationCaseId) return null;
  const { safeQueryRows } = await import("../lib/db");
  const result = await safeQueryRows<{ public_id: string }>(
    `SELECT public_id FROM conversation WHERE id = ? LIMIT 1`,
    [conversationCaseId]
  );
  return result.ok && result.rows[0] ? result.rows[0].public_id : null;
}

async function runTick(options: { limit: number; dryRun: boolean }) {
  const { runNativeAutonomousCycle } = await import("../lib/brain/commercial/native-cycle");
  const { safeQueryRows } = await import("../lib/db");

  const candidates = await selectDueFollowUps(options.limit);
  if (candidates.length === 0) return 0;

  let processed = 0;

  for (const candidate of candidates) {
    if (!candidate.wa_id) {
      await cancelFollowUp(candidate.action_id, "missing_wa_id");
      continue;
    }

    const { cancel, reason } = await shouldCancelFollowUp(candidate);
    if (cancel) {
      console.log(`[worker:followup] cancelling action ${candidate.action_id}: ${reason}`);
      await cancelFollowUp(candidate.action_id, reason);
      continue;
    }

    if (options.dryRun) {
      console.log(`[worker:followup] DRY RUN — would re-enter follow-up for wa_id=${candidate.wa_id}`);
      processed++;
      continue;
    }

    // Atomic lock — skip if another worker already claimed this row
    const locked = await markFollowUpExecuting(candidate.action_id);
    if (!locked) continue;

    const conversationPublicId = await getConversationPublicId(candidate.conversation_case_id);
    if (!conversationPublicId) {
      await cancelFollowUp(candidate.action_id, "conversation_not_found");
      continue;
    }

    // Get the conversation's internal numeric id
    const convRows = await safeQueryRows<{ id: number }>(
      `SELECT id FROM conversation WHERE public_id = ? LIMIT 1`,
      [conversationPublicId]
    );
    const conversationId = convRows.ok && convRows.rows[0] ? convRows.rows[0].id : null;
    if (!conversationId) {
      await cancelFollowUp(candidate.action_id, "conversation_id_not_found");
      continue;
    }

    // Re-enter the autonomous cycle as a system-initiated follow-up event
    const followUpMessage = candidate.draft_message ?? "Hola, ¿en qué puedo ayudarte?";
    const currentTime = new Date().toISOString();
    const correlationId = `followup:${candidate.action_id}:${Date.now()}`;

    try {
      const result = await runNativeAutonomousCycle({
        conversationId,
        conversationPublicId,
        customerMasterId: null,
        waId: candidate.wa_id,
        phoneNumberId: process.env.META_WHATSAPP_DEFAULT_PHONE_NUMBER_ID ?? process.env.DEFAULT_PHONE_NUMBER_ID ?? "",
        messageId: null,
        messageText: followUpMessage,
        correlationId,
        currentTime
      });

      const nextAction = result.loop?.selectedNextAction?.type ?? "none";
      console.log(`[worker:followup] executed follow-up for ${candidate.wa_id} → loop decided: ${nextAction}`);

      // Mark the follow-up action as executed
      await safeQueryRows(
        `UPDATE crm_agent_actions SET status = 'executed', executed_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`,
        [candidate.action_id]
      );
      processed++;
    } catch (error) {
      console.error(`[worker:followup] error for action ${candidate.action_id}:`, error instanceof Error ? error.message : String(error));
      await safeQueryRows(
        `UPDATE crm_agent_actions SET status = 'failed', failure_reason = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE action_id = ?`,
        [error instanceof Error ? error.message : "unknown", candidate.action_id]
      );
    }
  }

  return processed;
}

let poolClosed = false;

async function closeGracefully() {
  if (poolClosed) return;
  poolClosed = true;
  workerRunning = false;
  try {
    const { getPool } = await import("../lib/db");
    await getPool().end();
  } catch {
    // ignore
  }
}

async function main() {
  await loadRuntimeEnv();

  const pollMs = readIntArg("poll-ms", DEFAULT_POLL_MS);
  const limit = readIntArg("limit", DEFAULT_LIMIT);
  const dryRun = readBoolArg("dry-run", false);

  console.log(`[worker:followup] starting — pollMs=${pollMs} limit=${limit} dryRun=${dryRun}`);

  process.on("SIGINT", () => void closeGracefully());
  process.on("SIGTERM", () => void closeGracefully());

  while (workerRunning) {
    try {
      const count = await runTick({ limit, dryRun });
      if (count > 0) console.log(`[worker:followup] processed ${count} follow-up(s)`);
    } catch (error) {
      console.error("[worker:followup] tick error:", error instanceof Error ? error.message : String(error));
    }

    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }

  await closeGracefully();
  console.log("[worker:followup] stopped");
}

main().catch((error) => {
  console.error("[worker:followup] fatal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
