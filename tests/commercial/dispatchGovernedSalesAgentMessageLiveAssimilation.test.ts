import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import { dispatchGovernedSalesAgentMessage } from "@/lib/brain/commercial/sales-agent-runtime";
import { upsertPendingTurn, claimPendingTurn, completeTurn } from "@/lib/brain/commercial/turn-settlement/repository";
import type { TurnSettlementRow } from "@/lib/brain/commercial/turn-settlement/types";

/**
 * SALES-AGENT-R3-V1.8.1b-A (Objetivo A). Real MariaDB (crm_test, same
 * database crm_inbound_turn_settlements rows live in, so this file's
 * conversation/outbox/settlement state is all consistent within one
 * connection pool) - proves the atomicity invariant directly at the
 * transaction boundary itself (dispatchGovernedSalesAgentMessage.ts's own
 * withTransaction), the same boundary the task brief's own crash-test
 * requirement targets, without needing to drive the whole worker/cognition
 * chain end to end (that full-chain proof lives in
 * tests/native/inboundTurnSettling.e2e.test.ts instead).
 */

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "crm_test",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_URL: "",
  DB_WRITE_ENABLED: "true",
  BRAIN_AUTONOMOUS_RESPONSES_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

async function insertConversation(): Promise<{ id: number; waId: string }> {
  const publicId = `conv-dispatch-assim-${randomUUID().slice(0, 8)}`;
  const waId = `5699${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active, last_inbound_at)
     VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0, UTC_TIMESTAMP())`,
    [publicId, `phone-${randomUUID().slice(0, 8)}`, waId]
  );
  return { id: Number((result as { insertId: number }).insertId), waId };
}

async function insertInboundMessage(conversationId: number, body: string): Promise<number> {
  const [result] = await getPool().execute(
    `INSERT INTO conversation_message (public_id, conversation_id, provider, provider_message_id, direction, sender_type, message_type, body, status)
     VALUES (?, ?, 'meta', ?, 'inbound', 'customer', 'text', ?, 'received')`,
    [randomUUID(), conversationId, `wamid.${randomUUID()}`, body]
  );
  return Number((result as { insertId: number }).insertId);
}

async function claimedRowFor(conversation: { id: number; waId: string }, inboundMessageId: number): Promise<TurnSettlementRow> {
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-dispatch-assim-test",
    inboundMessageId,
    providerMessageId: `wamid.${inboundMessageId}`,
    correlationId: `corr-${inboundMessageId}`,
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const rows = await safeQueryRows<TurnSettlementRow>(
    "SELECT * FROM crm_inbound_turn_settlements WHERE conversation_id = ? AND status = 'PENDING' LIMIT 1",
    [conversation.id]
  );
  assert.ok(rows.ok && rows.rows[0]);
  const row = rows.rows[0];
  assert.ok(await claimPendingTurn(row.id));
  return loadRow(row.id);
}

async function loadRow(id: number): Promise<TurnSettlementRow> {
  const result = await safeQueryRows<TurnSettlementRow>("SELECT * FROM crm_inbound_turn_settlements WHERE id = ? LIMIT 1", [id]);
  assert.ok(result.ok && result.rows[0]);
  return result.rows[0];
}

async function loadPendingRowForConversation(conversationId: number): Promise<TurnSettlementRow | null> {
  const result = await safeQueryRows<TurnSettlementRow>(
    "SELECT * FROM crm_inbound_turn_settlements WHERE conversation_id = ? AND status = 'PENDING' LIMIT 1",
    [conversationId]
  );
  return result.ok ? (result.rows[0] ?? null) : null;
}

async function countOutboxRowsByDedupeKey(dedupeKey: string): Promise<number> {
  const [rows] = await getPool().execute("SELECT id FROM brain_message_outbox WHERE dedupe_key = ?", [dedupeKey]);
  return (rows as unknown[]).length;
}

function dedupeKeyFor(conversationId: number, inboundMessageId: string, suffix: string) {
  return `sales-agent-r3:${conversationId}:${inboundMessageId}:${suffix}`;
}

test("[J1] happy path: outbox write, own-row completion and sibling reconciliation all commit together, in one call, nothing further needed", async () => {
  const conversation = await insertConversation();
  const rowA = await claimedRowFor(conversation, 3001);

  // Sibling B accumulates fragments 3002/3003 while A is PROCESSING - both
  // fully consumed by A's simulated live-assimilated run.
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-dispatch-assim-test",
    inboundMessageId: 3002,
    providerMessageId: "wamid.3002",
    correlationId: "corr-3002",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-dispatch-assim-test",
    inboundMessageId: 3003,
    providerMessageId: "wamid.3003",
    correlationId: "corr-3003",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const rowB = await loadPendingRowForConversation(conversation.id);
  assert.ok(rowB);

  const inboundMessageId = "3001";
  const result = await dispatchGovernedSalesAgentMessage({
    conversationId: conversation.id,
    conversationCaseId: conversation.id,
    opportunityId: null,
    waId: conversation.waId,
    message: "respuesta final tras asimilar",
    dedupeSuffix: "responded",
    sourceAgentName: "test-live-assimilation",
    sourceAgentVersion: "test.v1",
    inboundMessageId,
    currentTime: "2026-09-03T15:00:00.000Z",
    humanOwnerActive: false,
    aiBlocked: false,
    checkInboundFreshness: true,
    liveAssimilation: { finalAssimilatedInboundMessageId: 3003, selfSettlementId: rowA.id }
  });

  assert.equal(result.status, "dispatched");
  assert.equal(result.outboxWritten, true);
  assert.equal(await countOutboxRowsByDedupeKey(dedupeKeyFor(conversation.id, inboundMessageId, "responded")), 1);

  // No further call happens here on purpose - proving these effects are
  // already fully durable from dispatchGovernedSalesAgentMessage's own
  // single call/transaction alone.
  const completedRowA = await loadRow(rowA.id);
  assert.equal(completedRowA.status, "COMPLETED");
  const reconciledRowB = await loadRow(rowB!.id);
  assert.equal(reconciledRowB.status, "ASSIMILATED");
  assert.equal(reconciledRowB.superseded_by_message_id, 3003);
});

test("[J2] mid-transaction crash: nothing commits - no outbox row, own row stays PROCESSING, sibling stays untouched", async () => {
  const conversation = await insertConversation();
  const rowA = await claimedRowFor(conversation, 3101);
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-dispatch-assim-test",
    inboundMessageId: 3102,
    providerMessageId: "wamid.3102",
    correlationId: "corr-3102",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const rowB = await loadPendingRowForConversation(conversation.id);
  assert.ok(rowB);

  const inboundMessageId = "3101";
  const result = await dispatchGovernedSalesAgentMessage({
    conversationId: conversation.id,
    conversationCaseId: conversation.id,
    opportunityId: null,
    waId: conversation.waId,
    message: "esta respuesta nunca debe persistir",
    dedupeSuffix: "responded",
    sourceAgentName: "test-live-assimilation",
    sourceAgentVersion: "test.v1",
    inboundMessageId,
    currentTime: "2026-09-03T15:00:00.000Z",
    humanOwnerActive: false,
    aiBlocked: false,
    checkInboundFreshness: true,
    liveAssimilation: { finalAssimilatedInboundMessageId: 3102, selfSettlementId: rowA.id },
    simulateCrashAfterOutboxWriteFn: () => {
      throw new Error("simulated_mid_transaction_crash");
    }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.outboxWritten, false, "the outbox write itself must roll back too, even though it happens earlier in program order than the crash point");
  assert.equal(await countOutboxRowsByDedupeKey(dedupeKeyFor(conversation.id, inboundMessageId, "responded")), 0);

  const stillProcessingRowA = await loadRow(rowA.id);
  assert.equal(stillProcessingRowA.status, "PROCESSING", "own-row completion must roll back with everything else - never a partial commit");
  const untouchedRowB = await loadRow(rowB!.id);
  assert.equal(untouchedRowB.status, "PENDING", "sibling reconciliation must roll back too - never left ASSIMILATED for a response that never actually persisted");
  assert.equal(untouchedRowB.first_inbound_message_id, 3102);

  // A later successful dispatch attempt (mirrors reclaim-and-reprocess) must
  // still be able to complete cleanly - the crashed attempt must not have
  // left the row in a half-committed state that blocks recovery.
  const retried = await dispatchGovernedSalesAgentMessage({
    conversationId: conversation.id,
    conversationCaseId: conversation.id,
    opportunityId: null,
    waId: conversation.waId,
    message: "respuesta real tras recuperacion",
    dedupeSuffix: "responded",
    sourceAgentName: "test-live-assimilation",
    sourceAgentVersion: "test.v1",
    inboundMessageId,
    currentTime: "2026-09-03T15:00:05.000Z",
    humanOwnerActive: false,
    aiBlocked: false,
    checkInboundFreshness: true,
    liveAssimilation: { finalAssimilatedInboundMessageId: 3102, selfSettlementId: rowA.id }
  });
  assert.equal(retried.status, "dispatched");
  const recoveredRowA = await loadRow(rowA.id);
  assert.equal(recoveredRowA.status, "COMPLETED");
  const recoveredRowB = await loadRow(rowB!.id);
  assert.equal(recoveredRowB.status, "ASSIMILATED");
});

test("[J3] race window: newer inbound after the last assimilation check suppresses dispatch entirely - no outbox write, no reconciliation, sibling keeps sole ownership", async () => {
  const conversation = await insertConversation();
  // recheckInboundFreshness compares against REAL conversation_message.id
  // for this conversation - anchor/settlement ids must be real rows too, not
  // synthetic numbers, for a "something newer exists" race to be genuine.
  const firstMessageId = await insertInboundMessage(conversation.id, "cotizame la barra de 20kg");
  const assimilatedMessageId = await insertInboundMessage(conversation.id, "y de paso una jaula");
  const rowA = await claimedRowFor(conversation, firstMessageId);
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-dispatch-assim-test",
    inboundMessageId: assimilatedMessageId,
    providerMessageId: `wamid.${assimilatedMessageId}`,
    correlationId: `corr-${assimilatedMessageId}`,
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const rowB = await loadPendingRowForConversation(conversation.id);
  assert.ok(rowB);

  // A message arrives AFTER the run's last cognitive freshness check (it
  // exists in conversation_message but was never part of
  // finalAssimilatedInboundMessageId) - the transactional recheck must still
  // catch it.
  const newerMessageId = await insertInboundMessage(conversation.id, "espera, una cosa mas");
  assert.ok(newerMessageId > assimilatedMessageId);

  const inboundMessageId = String(firstMessageId);
  const result = await dispatchGovernedSalesAgentMessage({
    conversationId: conversation.id,
    conversationCaseId: conversation.id,
    opportunityId: null,
    waId: conversation.waId,
    message: "respuesta ya obsoleta",
    dedupeSuffix: "responded",
    sourceAgentName: "test-live-assimilation",
    sourceAgentVersion: "test.v1",
    inboundMessageId,
    currentTime: "2026-09-03T15:00:00.000Z",
    humanOwnerActive: false,
    aiBlocked: false,
    checkInboundFreshness: true,
    liveAssimilation: { finalAssimilatedInboundMessageId: assimilatedMessageId, selfSettlementId: rowA.id }
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "superseded_by_newer_inbound");
  assert.equal(result.outboxWritten, false);
  assert.equal(await countOutboxRowsByDedupeKey(dedupeKeyFor(conversation.id, inboundMessageId, "responded")), 0);

  const untouchedRowA = await loadRow(rowA.id);
  assert.equal(untouchedRowA.status, "PROCESSING", "reconciliation must never run for a suppressed/stale candidate - row A stays PROCESSING for its own supersede handling");
  const untouchedRowB = await loadRow(rowB!.id);
  assert.equal(untouchedRowB.status, "PENDING", "the sibling remains the sole durable owner of the newer input - never marked ASSIMILATED for a response that was never dispatched");
  assert.equal(untouchedRowB.first_inbound_message_id, assimilatedMessageId);

  // crm_test is a shared, never-reset database - never leave a PROCESSING/
  // PENDING row behind, or a later test's own runTurnSettleTick call could
  // sweep it up unexpectedly (same discipline every other file touching this
  // table already follows).
  await completeTurn(rowA.id);
  await getPool().execute("UPDATE crm_inbound_turn_settlements SET status = 'COMPLETED' WHERE id = ?", [rowB!.id]);
});
