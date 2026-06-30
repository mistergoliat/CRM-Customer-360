/**
 * autonomous-outbox-worker
 *
 * Persistent process that drains brain_message_outbox in polling loops.
 * Designed to be run as a background service or via a process manager.
 *
 * Per-worker locking (via brain_message_outbox.locked_at + lock_seconds)
 * ensures multiple instances can run concurrently without double-sending.
 *
 * Flow per batch:
 *   planned row → locked (atomic SQL UPDATE)
 *               → sendMetaWhatsAppTextMessage (real Meta API)
 *               → sent / failed
 *               → crm_action_executions row written
 *               → crm_action_outcomes row written
 *               → crm_agent_actions status updated
 *
 * Usage:
 *   npm run worker:outbox
 *   npm run worker:outbox -- --batch-size=5 --poll-ms=3000 --dry-run
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadLocalEnv, loadEnvFile, PROJECT_ROOT } from "./db-utils";

const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_POLL_MS = 4000;
const DEFAULT_LOCK_SECONDS = 90;
const DEFAULT_ALLOWED_WA_IDS: string[] = [];

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

  const overrides: Record<string, string> = {
    BRAIN_META_SEND_ENABLED: "true",
    BRAIN_OUTBOX_WORKER_ENABLED: "true",
    BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND: "true",
    BRAIN_PERSIST_CANONICAL_OUTBOUND: "true"
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

let workerRunning = true;
let poolClosed = false;

async function closeGracefully(pool: { end(): Promise<void> }) {
  if (poolClosed) return;
  poolClosed = true;
  workerRunning = false;
  try {
    await pool.end();
  } catch {
    // ignore
  }
}

/**
 * One polling tick: lock up to batchSize planned rows, send each, write
 * execution + outcome rows, update action status.
 */
async function runTick(options: {
  batchSize: number;
  lockSeconds: number;
  dryRun: boolean;
  allowedWaIds: string[];
  workerId: string;
}) {
  const {
    selectPlannedOutboxCandidates,
    lockOutboxRecord
  } = await import("../lib/brain/messaging/outboxWorker");
  const { sendMetaWhatsAppTextMessage } = await import("../lib/brain/messaging/metaClient");
  const { persistCanonicalOutboundMessage } = await import("../lib/brain/messaging/outboundMessages");
  const {
    persistActionExecution,
    persistActionOutcome,
    markActionExecuted,
    markActionFailed,
    loadActionIdByOutboxMessageId
  } = await import("../lib/brain/commercial/action-queue/persistActionOutcome");
  const { queryRows: db } = await import("../lib/db");

  const candidatesResult = await selectPlannedOutboxCandidates(options.batchSize);
  if (!candidatesResult.ok || candidatesResult.candidates.length === 0) return 0;

  let processed = 0;

  for (const candidate of candidatesResult.candidates) {
    if (!candidate.id) continue;
    const requestedAt = new Date().toISOString();

    // Lock the row atomically — skips if another worker already claimed it
    const lockResult = await lockOutboxRecord(candidate, {
      lockSeconds: options.lockSeconds,
      debug: false
    });
    if (!lockResult.applied || lockResult.simulated) continue;

    // Load full message text (candidate only has a preview)
    const fullRows = await db<{ wa_id: string | null; phone_number_id: string | null; message_text: string | null; dedupe_key: string; conversation_case_id: string | number | null }>(
      `SELECT wa_id, phone_number_id, message_text, dedupe_key, conversation_case_id FROM brain_message_outbox WHERE id = ? LIMIT 1`,
      [candidate.id]
    );
    const fullRow = fullRows[0];
    if (!fullRow) continue;

    const waId = fullRow.wa_id;
    const phoneNumberId = fullRow.phone_number_id;
    const messageText = fullRow.message_text;
    const row = { id: candidate.id, wa_id: waId, phone_number_id: phoneNumberId, message_text: messageText, dedupe_key: fullRow.dedupe_key, conversation_case_id: fullRow.conversation_case_id };

    if (!waId || !phoneNumberId || !messageText) {
      console.warn("[worker:outbox] skipping row with missing fields", row.id);
      continue;
    }

    // Allowlist guard — even with the worker running, only send to permitted numbers
    if (options.allowedWaIds.length > 0 && !options.allowedWaIds.includes(waId)) {
      console.log(`[worker:outbox] skipping non-allowlisted wa_id ${waId}`);
      continue;
    }

    const actionId = await loadActionIdByOutboxMessageId(row.id);

    if (options.dryRun) {
      console.log(`[worker:outbox] DRY RUN — would send to ${waId}: ${messageText.slice(0, 60)}`);
      processed++;
      continue;
    }

    let sendStatus: "succeeded" | "failed" = "failed";
    let providerMessageId: string | null = null;
    let sendErrorCode: string | null = null;
    let sendErrorMessage: string | null = null;
    const startedAt = new Date().toISOString();

    try {
      const sendResult = await sendMetaWhatsAppTextMessage({
        waId,
        phoneNumberId,
        messageText,
        timeoutMs: 10000,
        source: "operator",
        sourceRequestId: row.dedupe_key,
        conversationCaseId: row.conversation_case_id
      });

      if (sendResult.ok && sendResult.status === "sent") {
        sendStatus = "succeeded";
        providerMessageId = sendResult.provider_message_id ?? null;
      } else {
        sendErrorCode = sendResult.error_code ?? "send_failed";
        sendErrorMessage = sendResult.error_message ?? null;
      }
    } catch (error) {
      sendErrorCode = "exception";
      sendErrorMessage = error instanceof Error ? error.message : String(error);
    }

    const completedAt = new Date().toISOString();

    // Write crm_action_executions
    const execResult = await persistActionExecution({
      actionId: actionId ?? `outbox:${row.id}`,
      actionRowId: null,
      outboxMessageId: row.id,
      outboxDedupeKey: row.dedupe_key,
      attemptNumber: 1,
      status: sendStatus,
      requestedAt,
      startedAt,
      completedAt,
      errorCode: sendErrorCode,
      errorMessage: sendErrorMessage,
      retryable: false,
      correlationId: row.dedupe_key
    });

    // Write crm_action_outcomes
    await persistActionOutcome({
      actionId: actionId ?? `outbox:${row.id}`,
      actionRowId: null,
      executionId: execResult.executionId,
      outboxMessageId: row.id,
      providerMessageId,
      outcomeType: sendStatus === "succeeded" ? "sent" : "failed",
      occurredAt: completedAt,
      metadataJson: { workerId: options.workerId, dedupeKey: row.dedupe_key }
    });

    if (sendStatus === "succeeded") {
      // Update brain_message_outbox to sent
      const { queryRows } = await import("../lib/db");
      await queryRows(
        `UPDATE brain_message_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP(3), provider_message_id = ? WHERE id = ? AND status = 'locked'`,
        [providerMessageId, row.id]
      );

      // Canonical persistence into conversation_message for HUB visibility
      await persistCanonicalOutboundMessage({
        enabled: true,
        outboxId: row.id,
        dedupeKey: row.dedupe_key,
        outboxStatus: "sent",
        conversationCaseId: row.conversation_case_id,
        waId,
        phoneNumberId,
        messageText,
        providerMessageId,
        sentAt: completedAt
      });

      // Update crm_agent_actions
      if (actionId) await markActionExecuted(actionId, row.id, providerMessageId, completedAt);

      console.log(`[worker:outbox] sent row ${row.id} to ${waId} → ${providerMessageId}`);
    } else {
      // Mark failed in outbox
      const { queryRows } = await import("../lib/db");
      await queryRows(
        `UPDATE brain_message_outbox SET status = 'failed', failed_at = CURRENT_TIMESTAMP(3), error_code = ?, error_message = ? WHERE id = ? AND status = 'locked'`,
        [sendErrorCode, sendErrorMessage, row.id]
      );

      if (actionId) await markActionFailed(actionId, sendErrorCode, sendErrorMessage);
      console.warn(`[worker:outbox] failed row ${row.id} to ${waId}: ${sendErrorCode}`);
    }

    processed++;
  }

  return processed;
}

async function main() {
  await loadRuntimeEnv();

  const batchSize = readIntArg("batch-size", DEFAULT_BATCH_SIZE);
  const pollMs = readIntArg("poll-ms", DEFAULT_POLL_MS);
  const lockSeconds = readIntArg("lock-seconds", DEFAULT_LOCK_SECONDS);
  const dryRun = readBoolArg("dry-run", false);
  const allowedWaIds = (process.env.BRAIN_AUTONOMOUS_TEST_WA_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const workerId = `outbox-worker-${randomUUID().slice(0, 8)}`;

  console.log(`[worker:outbox] starting workerId=${workerId} batchSize=${batchSize} pollMs=${pollMs} dryRun=${dryRun}`);
  if (allowedWaIds.length > 0) {
    console.log(`[worker:outbox] allowlist: ${allowedWaIds.join(", ")}`);
  } else {
    console.log("[worker:outbox] WARNING: no BRAIN_AUTONOMOUS_TEST_WA_IDS set — will send to any wa_id in the outbox");
  }

  const { getPool } = await import("../lib/db");

  process.on("SIGINT", () => void closeGracefully(getPool()));
  process.on("SIGTERM", () => void closeGracefully(getPool()));

  while (workerRunning) {
    try {
      const count = await runTick({ batchSize, lockSeconds, dryRun, allowedWaIds, workerId });
      if (count > 0) console.log(`[worker:outbox] processed ${count} message(s)`);
    } catch (error) {
      console.error("[worker:outbox] tick error:", error instanceof Error ? error.message : String(error));
    }

    // Simple sleep between polls — avoids busy-wait without needing a scheduler
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }

  await closeGracefully(getPool());
  console.log(`[worker:outbox] stopped`);
}

main().catch((error) => {
  console.error("[worker:outbox] fatal:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
