// SALES-AGENT-R3-V1.8.1. The turn-settlement worker's one polling tick -
// shared by scripts/autonomous-turn-settle-worker.ts and tests, mirroring
// runFollowupTick.ts's own shape (select due -> claim CAS -> revalidate ->
// act -> terminal write). Never re-implements cognition/dispatch itself:
// every settled turn re-enters through the exact same
// ensureAutonomousSalesTurnContinuity boundary the webhook uses for
// delay=0, just with the aggregated fragment set and the freshness-recheck
// flag turned on (Section T).

import { safeQueryRows } from "@/lib/db";
import { ensureAutonomousSalesTurnContinuity } from "../continuity/ensureAutonomousSalesTurnContinuity";
import type { EnsureAutonomousSalesTurnContinuityInput, EnsureAutonomousSalesTurnContinuityResult } from "../continuity/ensureAutonomousSalesTurnContinuity";
import { postMetaWhatsAppTypingIndicator } from "@/lib/brain/messaging/metaClient";
import type { MetaTypingIndicatorRequest, MetaTypingIndicatorResponse } from "@/lib/brain/messaging/metaClient";
import { assembleTurnFragments } from "./assembleTurnFragments";
import { isTypingIndicatorEnabled } from "./config";
import {
  selectDuePendingTurns,
  selectStaleProcessingTurns,
  claimPendingTurn,
  reclaimStaleProcessingTurn,
  completeTurn,
  supersedeTurn
} from "./repository";
import type { TurnSettlementRow } from "./types";

export type TurnSettleTickResult = {
  processed: number;
  settled: number;
  superseded: number;
  reclaimed: number;
  failed: number;
};

type ConversationAnchor = { publicId: string; customerMasterId: number | null };

async function loadConversationAnchor(conversationId: number): Promise<ConversationAnchor | null> {
  const result = await safeQueryRows<{ public_id: string; customer_id: number | null }>(
    "SELECT public_id, customer_id FROM conversation WHERE id = ? LIMIT 1",
    [conversationId]
  );
  const row = result.ok ? result.rows[0] : null;
  return row ? { publicId: row.public_id, customerMasterId: row.customer_id } : null;
}

async function loadLatestInboundMessageId(conversationId: number): Promise<number | null> {
  const result = await safeQueryRows<{ maxId: number | null }>(
    "SELECT MAX(id) AS maxId FROM conversation_message WHERE conversation_id = ? AND direction = 'inbound'",
    [conversationId]
  );
  const value = result.ok ? result.rows[0]?.maxId ?? null : null;
  return value === null ? null : Number(value);
}

/**
 * SALES-AGENT-R3-V1.8.1 (Section M/N). Typing/read is UX only - any failure
 * here (disabled, missing credentials, network/HTTP error) is swallowed into
 * a console warning and never affects cognition or dispatch below it.
 */
async function requestTypingIndicator(
  row: TurnSettlementRow,
  latestInboundProviderMessageId: string | null,
  postTyping: (input: MetaTypingIndicatorRequest) => Promise<MetaTypingIndicatorResponse>
): Promise<void> {
  if (!isTypingIndicatorEnabled()) return;
  if (!latestInboundProviderMessageId) {
    console.warn(`[turn-settle] typing_indicator_skipped turnId=${row.id} reason=missing_provider_message_id`);
    return;
  }
  try {
    const result = await postTyping({
      phoneNumberId: row.phone_number_id,
      messageId: latestInboundProviderMessageId
    });
    if (!result.ok) {
      console.warn(`[turn-settle] typing_indicator_failed turnId=${row.id} status=${result.status} reason=${result.error_code ?? "unknown"}`);
    }
  } catch (error) {
    console.warn(`[turn-settle] typing_indicator_threw turnId=${row.id} error=${error instanceof Error ? error.message : "unknown"}`);
  }
}

export type RunTurnSettleTickOptions = {
  limit?: number;
  /** Test/DI seam - defaults to the real, MariaDB+DeepSeek-backed ensureAutonomousSalesTurnContinuity. */
  ensureContinuity?: (input: EnsureAutonomousSalesTurnContinuityInput) => Promise<EnsureAutonomousSalesTurnContinuityResult>;
  /** Test/DI seam - defaults to the real Meta Cloud API call. */
  postTyping?: (input: MetaTypingIndicatorRequest) => Promise<MetaTypingIndicatorResponse>;
  /**
   * Test/DI seam only - threaded straight through to ensureContinuity (which
   * now forwards it to runNativeAutonomousCycle, see that file's own
   * comment). Lets a test fake the LLM call while still exercising the real
   * continuity/dispatch/freshness-recheck chain, instead of bypassing it
   * with a fully-replaced ensureContinuity. Production never sets this - the
   * real HTTP provider is resolved deeper in the chain when this is
   * undefined.
   */
  agentLoopProvider?: EnsureAutonomousSalesTurnContinuityInput["agentLoopProvider"];
};

/**
 * Runs one already-claimed turn to completion. Deliberately never marks the
 * row COMPLETED/SUPERSEDED on a thrown error - it stays PROCESSING and the
 * stale-processing reclaim path (Section S) retries it on a later tick,
 * mirroring runFollowupTick.ts's own crash-recovery discipline.
 */
async function processClaimedTurn(
  row: TurnSettlementRow,
  ensureContinuity: (input: EnsureAutonomousSalesTurnContinuityInput) => Promise<EnsureAutonomousSalesTurnContinuityResult>,
  postTyping: (input: MetaTypingIndicatorRequest) => Promise<MetaTypingIndicatorResponse>,
  agentLoopProvider: EnsureAutonomousSalesTurnContinuityInput["agentLoopProvider"]
): Promise<"settled" | "superseded" | "failed"> {
  const anchor = await loadConversationAnchor(row.conversation_id);
  if (!anchor) {
    console.error(`[turn-settle] conversation_not_found turnId=${row.id} conversationId=${row.conversation_id}`);
    return "failed";
  }

  const assembled = await assembleTurnFragments({
    conversationId: row.conversation_id,
    firstInboundMessageId: row.first_inbound_message_id,
    latestInboundMessageId: row.latest_inbound_message_id
  });

  await requestTypingIndicator(row, assembled.latestInboundProviderMessageId ?? row.latest_inbound_provider_message_id, postTyping);

  const additionalInboundMessageIds = assembled.inboundMessageIds.filter((id) => id !== row.latest_inbound_message_id).map(String);
  const correlationId = `native-whatsapp-turn-settle:${row.id}:${row.latest_inbound_message_id}`;

  const result = await ensureContinuity({
    conversationId: row.conversation_id,
    conversationPublicId: anchor.publicId,
    customerMasterId: anchor.customerMasterId,
    waId: row.wa_id,
    phoneNumberId: row.phone_number_id,
    messageId: row.latest_inbound_message_id,
    messageText: assembled.content,
    correlationId,
    currentTime: new Date().toISOString(),
    additionalInboundMessageIds,
    checkInboundFreshnessBeforeDispatch: true,
    agentLoopProvider
  });

  const wasSuperseded = Boolean(result.cycle.salesAgentRuntime?.dispatch.warnings.includes("superseded_by_newer_inbound"));
  if (wasSuperseded) {
    const newerMessageId = (await loadLatestInboundMessageId(row.conversation_id)) ?? row.latest_inbound_message_id;
    await supersedeTurn(row.id, newerMessageId);
    return "superseded";
  }

  await completeTurn(row.id);
  return "settled";
}

export async function runTurnSettleTick(options: RunTurnSettleTickOptions = {}): Promise<TurnSettleTickResult> {
  const limit = options.limit ?? 20;
  const ensureContinuity = options.ensureContinuity ?? ensureAutonomousSalesTurnContinuity;
  const postTyping = options.postTyping ?? postMetaWhatsAppTypingIndicator;
  const agentLoopProvider = options.agentLoopProvider;
  const outcome: TurnSettleTickResult = { processed: 0, settled: 0, superseded: 0, reclaimed: 0, failed: 0 };

  const [duePending, staleProcessing] = await Promise.all([selectDuePendingTurns(limit), selectStaleProcessingTurns(limit)]);

  for (const row of duePending) {
    const claimed = await claimPendingTurn(row.id);
    if (!claimed) continue; // lost the race to another poller/tick - not an error
    outcome.processed += 1;
    try {
      const status = await processClaimedTurn(row, ensureContinuity, postTyping, agentLoopProvider);
      if (status === "settled") outcome.settled += 1;
      else if (status === "superseded") outcome.superseded += 1;
      else outcome.failed += 1;
    } catch (error) {
      outcome.failed += 1;
      console.error(`[turn-settle] tick_error turnId=${row.id} error=${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  for (const row of staleProcessing) {
    const reclaimed = await reclaimStaleProcessingTurn(row.id);
    if (!reclaimed) continue;
    outcome.processed += 1;
    outcome.reclaimed += 1;
    try {
      const status = await processClaimedTurn(row, ensureContinuity, postTyping, agentLoopProvider);
      if (status === "settled") outcome.settled += 1;
      else if (status === "superseded") outcome.superseded += 1;
      else outcome.failed += 1;
    } catch (error) {
      outcome.failed += 1;
      console.error(`[turn-settle] stale_reclaim_error turnId=${row.id} error=${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  return outcome;
}
