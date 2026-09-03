import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, safeQueryRows, withTransaction } from "@/lib/db";
import {
  upsertPendingTurn,
  selectDuePendingTurns,
  selectStaleProcessingTurns,
  claimPendingTurn,
  reclaimStaleProcessingTurn,
  completeTurn,
  supersedeTurn,
  reconcileAssimilatedSiblings
} from "@/lib/brain/commercial/turn-settlement/repository";
import type { TurnSettlementRow } from "@/lib/brain/commercial/turn-settlement/types";

/**
 * SALES-AGENT-R3-V1.8.1. Repository-level coverage of the durable pending-
 * turn mechanics, independent of cognition/dispatch (covered separately in
 * tests/native/inboundTurnSettling.e2e.test.ts). Real MariaDB (crm_test) -
 * this repository only exists to be durable, so it is only trustworthy when
 * proven against a real database, never a mock.
 *
 * Task brief coverage: T2 (single inbound -> one settled turn row), T4
 * (fragment timer refresh), T5 (max window), T6 (simultaneous inbound race
 * -> one active pending turn), T7 (restart recovery via stale-processing
 * reclaim), G5/G6/G7.
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
  DB_WRITE_ENABLED: "true"
});

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore pool teardown failures in tests
  }
});

async function insertConversation(): Promise<{ id: number; waId: string }> {
  const publicId = `conv-turnsettle-${randomUUID().slice(0, 8)}`;
  const waId = `5699${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15);
  const [result] = await getPool().execute(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id, status, owner_type, ai_enabled, human_owner_active)
     VALUES (?, 'whatsapp', 'meta', ?, ?, 'open', 'ai_sdr', 1, 0)`,
    [publicId, `phone-${randomUUID().slice(0, 8)}`, waId]
  );
  return { id: Number((result as { insertId: number }).insertId), waId };
}

async function loadRow(id: number): Promise<TurnSettlementRow> {
  const result = await safeQueryRows<TurnSettlementRow>("SELECT * FROM crm_inbound_turn_settlements WHERE id = ? LIMIT 1", [id]);
  assert.ok(result.ok && result.rows[0], "turn settlement row must exist");
  return result.rows[0];
}

async function loadPendingRowForConversation(conversationId: number): Promise<TurnSettlementRow | null> {
  const result = await safeQueryRows<TurnSettlementRow>(
    "SELECT * FROM crm_inbound_turn_settlements WHERE conversation_id = ? AND status = 'PENDING' LIMIT 1",
    [conversationId]
  );
  return result.ok ? result.rows[0] ?? null : null;
}

test("[T2] a single fragment creates one PENDING turn, first=latest fragment", async () => {
  const conversation = await insertConversation();
  const upserted = await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 101,
    providerMessageId: "wamid.101",
    correlationId: "corr-101",
    settleDelayMs: 1800,
    maxSettleMs: 5000
  });
  assert.equal(upserted.ok, true);
  assert.equal((upserted as { created: boolean }).created, true);

  const row = await loadPendingRowForConversation(conversation.id);
  assert.ok(row);
  assert.equal(row!.first_inbound_message_id, 101);
  assert.equal(row!.latest_inbound_message_id, 101);
  assert.equal(row!.fragment_count, 1);
  assert.equal(row!.status, "PENDING");
});

test("[T4] a second fragment for the SAME conversation extends the existing PENDING row and refreshes settle_after, never creates a second row", async () => {
  const conversation = await insertConversation();
  const first = await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 201,
    providerMessageId: "wamid.201",
    correlationId: "corr-201",
    settleDelayMs: 1800,
    maxSettleMs: 5000
  });
  assert.equal((first as { created: boolean }).created, true);
  const firstRow = await loadPendingRowForConversation(conversation.id);
  assert.ok(firstRow);

  await new Promise((resolve) => setTimeout(resolve, 30));

  const second = await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 202,
    providerMessageId: "wamid.202",
    correlationId: "corr-202",
    settleDelayMs: 1800,
    maxSettleMs: 5000
  });
  assert.equal(second.ok, true);
  assert.equal((second as { created: boolean }).created, false, "extending an existing PENDING row must never create a second one");

  const rows = await safeQueryRows<TurnSettlementRow>("SELECT * FROM crm_inbound_turn_settlements WHERE conversation_id = ?", [conversation.id]);
  assert.equal(rows.ok && rows.rows.length, 1, "exactly one row must exist for this conversation");
  const row = rows.rows[0];
  assert.equal(row.first_inbound_message_id, 201, "first_inbound_message_id must never move once set");
  assert.equal(row.latest_inbound_message_id, 202, "latest_inbound_message_id must advance to the newest fragment");
  assert.equal(row.fragment_count, 2);
  assert.ok(
    new Date(row.settle_after).getTime() > new Date(firstRow!.settle_after).getTime(),
    "settle_after must be refreshed forward by the second fragment (quiet-window semantics)"
  );
});

test("[T5] settle_after is clamped to max_settle_at and never exceeds it, once the quiet delay would push past the max window", async () => {
  const conversation = await insertConversation();
  // maxSettleMs (300ms) deliberately far smaller than settleDelayMs
  // (5000ms) - LEAST(now+delay, maxSettleAt) must pick maxSettleAt on every
  // single extension, regardless of exact timing, never race-dependent.
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 301,
    providerMessageId: "wamid.301",
    correlationId: "corr-301",
    settleDelayMs: 5000,
    maxSettleMs: 300
  });

  for (let i = 0; i < 3; i += 1) {
    await upsertPendingTurn({
      conversationId: conversation.id,
      waId: conversation.waId,
      phoneNumberId: "phone-turnsettle-test",
      inboundMessageId: 302 + i,
      providerMessageId: `wamid.${302 + i}`,
      correlationId: `corr-${302 + i}`,
      settleDelayMs: 5000,
      maxSettleMs: 300
    });
  }

  const row = await loadPendingRowForConversation(conversation.id);
  assert.ok(row);
  assert.equal(new Date(row!.settle_after).getTime(), new Date(row!.max_settle_at).getTime(), "settle_after must be clamped to max_settle_at once the quiet-window budget would exceed it");
  assert.equal(row!.fragment_count, 4);
});

test("[T6] two concurrent upserts for the SAME conversation never create two PENDING rows (DB-level uniqueness, not just application logic)", async () => {
  const conversation = await insertConversation();
  const [a, b] = await Promise.all([
    upsertPendingTurn({
      conversationId: conversation.id,
      waId: conversation.waId,
      phoneNumberId: "phone-turnsettle-test",
      inboundMessageId: 401,
      providerMessageId: "wamid.401",
      correlationId: "corr-401",
      settleDelayMs: 1800,
      maxSettleMs: 5000
    }),
    upsertPendingTurn({
      conversationId: conversation.id,
      waId: conversation.waId,
      phoneNumberId: "phone-turnsettle-test",
      inboundMessageId: 402,
      providerMessageId: "wamid.402",
      correlationId: "corr-402",
      settleDelayMs: 1800,
      maxSettleMs: 5000
    })
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);

  const rows = await safeQueryRows<TurnSettlementRow>("SELECT * FROM crm_inbound_turn_settlements WHERE conversation_id = ?", [conversation.id]);
  assert.equal(rows.ok && rows.rows.length, 1, "exactly one PENDING row must survive a concurrent race for the same conversation");
  assert.equal(rows.rows[0].fragment_count, 2, "both fragments must be reflected (one insert winner + one extend), never one silently dropped");
});

test("[T2/G5] a PENDING row for one conversation does not block a PENDING row for a DIFFERENT conversation", async () => {
  const conversationA = await insertConversation();
  const conversationB = await insertConversation();
  const a = await upsertPendingTurn({
    conversationId: conversationA.id,
    waId: conversationA.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 501,
    providerMessageId: "wamid.501",
    correlationId: "corr-501",
    settleDelayMs: 1800,
    maxSettleMs: 5000
  });
  const b = await upsertPendingTurn({
    conversationId: conversationB.id,
    waId: conversationB.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 502,
    providerMessageId: "wamid.502",
    correlationId: "corr-502",
    settleDelayMs: 1800,
    maxSettleMs: 5000
  });
  assert.equal((a as { created: boolean }).created, true);
  assert.equal((b as { created: boolean }).created, true);
});

test("[claim/complete] claimPendingTurn is a one-time CAS; a second claim attempt on the same row fails", async () => {
  const conversation = await insertConversation();
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 601,
    providerMessageId: "wamid.601",
    correlationId: "corr-601",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const row = await loadPendingRowForConversation(conversation.id);
  assert.ok(row);

  const firstClaim = await claimPendingTurn(row!.id);
  const secondClaim = await claimPendingTurn(row!.id);
  assert.equal(firstClaim, true);
  assert.equal(secondClaim, false, "a row already moved to PROCESSING must never be claimable again");

  const processing = await loadRow(row!.id);
  assert.equal(processing.status, "PROCESSING");

  // A new fragment for the SAME conversation must open a brand new PENDING
  // row (G5) - it must never be blocked by the older row now sitting in
  // PROCESSING, since pending_scope_key is NULL for non-PENDING rows.
  const nextTurn = await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 602,
    providerMessageId: "wamid.602",
    correlationId: "corr-602",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  assert.equal(nextTurn.ok, true);
  assert.equal((nextTurn as { created: boolean }).created, true, "a fragment arriving while the previous turn is PROCESSING must open its own new pending turn");

  assert.equal(await completeTurn(row!.id), true);
  assert.equal(await completeTurn(row!.id), false, "completing an already-COMPLETED row must be a no-op CAS, never a double-transition");
});

test("[B6] same-conversation concurrency: a PENDING row for a conversation that already has a PROCESSING row cannot be claimed", async () => {
  const conversation = await insertConversation();
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 1001,
    providerMessageId: "wamid.1001",
    correlationId: "corr-1001",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const firstRow = await loadPendingRowForConversation(conversation.id);
  assert.ok(await claimPendingTurn(firstRow!.id), "the first row must claim normally");

  // A new fragment for the SAME conversation opens its own PENDING row
  // (unchanged upsertPendingTurn behavior - see the [claim/complete] test
  // above), but it must never be claimable while its sibling is PROCESSING.
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 1002,
    providerMessageId: "wamid.1002",
    correlationId: "corr-1002",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const secondRow = await loadPendingRowForConversation(conversation.id);
  assert.ok(secondRow, "a second PENDING row must exist for the same conversation");

  assert.equal(
    await claimPendingTurn(secondRow!.id),
    false,
    "at most one active cognitive run per conversation - the second row must stay PENDING while the first is PROCESSING"
  );

  const secondAfter = await loadRow(secondRow!.id);
  assert.equal(secondAfter.status, "PENDING", "a blocked claim must never partially transition the row");

  // Once the first turn finishes, the second must become claimable again.
  assert.ok(await completeTurn(firstRow!.id));
  assert.equal(await claimPendingTurn(secondRow!.id), true, "the second row must be claimable once the conversation is free");

  // crm_test is a shared, never-reset database - never leave a row
  // PROCESSING forever, or a later test's own runTurnSettleTick call could
  // sweep it up once it goes stale.
  await completeTurn(secondRow!.id);
});

test("[B7] different conversations run in parallel: a PROCESSING row in conversation A never blocks a claim in conversation B", async () => {
  const conversationA = await insertConversation();
  const conversationB = await insertConversation();
  await upsertPendingTurn({
    conversationId: conversationA.id,
    waId: conversationA.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 1101,
    providerMessageId: "wamid.1101",
    correlationId: "corr-1101",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  await upsertPendingTurn({
    conversationId: conversationB.id,
    waId: conversationB.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 1102,
    providerMessageId: "wamid.1102",
    correlationId: "corr-1102",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const rowA = await loadPendingRowForConversation(conversationA.id);
  const rowB = await loadPendingRowForConversation(conversationB.id);

  assert.ok(await claimPendingTurn(rowA!.id), "conversation A must claim normally");
  assert.ok(
    await claimPendingTurn(rowB!.id),
    "conversation B's claim must succeed while conversation A is PROCESSING - different conversations run in parallel, never a global lock"
  );

  await completeTurn(rowA!.id);
  await completeTurn(rowB!.id);
});

test("[B8] crash recovery: a stale-reclaimed row keeps blocking its sibling until it reaches a terminal state", async () => {
  const conversation = await insertConversation();
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 1201,
    providerMessageId: "wamid.1201",
    correlationId: "corr-1201",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const firstRow = await loadPendingRowForConversation(conversation.id);
  assert.ok(await claimPendingTurn(firstRow!.id));

  // Simulate a crashed worker: backdate updated_at past the stale threshold
  // (same technique [T7/G7] above uses).
  await getPool().execute("UPDATE crm_inbound_turn_settlements SET updated_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 999 SECOND) WHERE id = ?", [firstRow!.id]);

  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 1202,
    providerMessageId: "wamid.1202",
    correlationId: "corr-1202",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const secondRow = await loadPendingRowForConversation(conversation.id);
  assert.ok(secondRow);
  assert.equal(await claimPendingTurn(secondRow!.id), false, "a stale-but-still-PROCESSING row must still block its sibling before reclaim");

  assert.equal(await reclaimStaleProcessingTurn(firstRow!.id), true, "the stale row must be reclaimable");
  assert.equal(
    await claimPendingTurn(secondRow!.id),
    false,
    "reclaiming the stale row only refreshes it (still PROCESSING) - it must keep blocking its sibling, never silently free the conversation"
  );

  assert.ok(await completeTurn(firstRow!.id), "the reclaimed row must still be completable exactly once");
  assert.equal(await claimPendingTurn(secondRow!.id), true, "once the reclaimed row reaches a terminal state, the sibling must become claimable");
  await completeTurn(secondRow!.id);
});

test("[supersede] supersedeTurn records the newer message id and the terminal status", async () => {
  const conversation = await insertConversation();
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 701,
    providerMessageId: "wamid.701",
    correlationId: "corr-701",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const row = await loadPendingRowForConversation(conversation.id);
  assert.ok(await claimPendingTurn(row!.id));
  assert.ok(await supersedeTurn(row!.id, 999));

  const superseded = await loadRow(row!.id);
  assert.equal(superseded.status, "SUPERSEDED");
  assert.equal(superseded.superseded_by_message_id, 999);
});

test("[T7/G7] a PROCESSING row becomes reclaimable only after it has been stale long enough, not immediately", async () => {
  const conversation = await insertConversation();
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 801,
    providerMessageId: "wamid.801",
    correlationId: "corr-801",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const row = await loadPendingRowForConversation(conversation.id);
  assert.ok(await claimPendingTurn(row!.id));

  // Freshly claimed - not yet stale, must not appear as reclaimable nor be
  // reclaimable by CAS (simulates the normal in-flight-processing window,
  // never a crash).
  const dueImmediately = await selectStaleProcessingTurns(50);
  assert.ok(!dueImmediately.some((candidate) => candidate.id === row!.id), "a just-claimed row must not be immediately reclaimable");
  assert.equal(await reclaimStaleProcessingTurn(row!.id), false);

  // Simulate a crashed worker: backdate updated_at past the stale threshold.
  await getPool().execute("UPDATE crm_inbound_turn_settlements SET updated_at = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 999 SECOND) WHERE id = ?", [row!.id]);

  const dueAfterCrash = await selectStaleProcessingTurns(50);
  assert.ok(dueAfterCrash.some((candidate) => candidate.id === row!.id), "a row abandoned past the stale-lock window must become reclaimable");
  assert.equal(await reclaimStaleProcessingTurn(row!.id), true, "reclaim must succeed for a genuinely stale row");

  assert.equal(await completeTurn(row!.id), true, "the reclaimed row must still be completable exactly once");
});

test("[due detection] selectDuePendingTurns only returns rows whose settle_after has passed", async () => {
  const conversation = await insertConversation();
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 901,
    providerMessageId: "wamid.901",
    correlationId: "corr-901",
    settleDelayMs: 60000, // not due for a full minute
    maxSettleMs: 120000
  });
  const row = await loadPendingRowForConversation(conversation.id);

  const dueNow = await selectDuePendingTurns(50);
  assert.ok(!dueNow.some((candidate) => candidate.id === row!.id), "a turn whose quiet window has not elapsed must not be selected as due");

  await getPool().execute("UPDATE crm_inbound_turn_settlements SET settle_after = CURRENT_TIMESTAMP(3) WHERE id = ?", [row!.id]);
  const dueAfter = await selectDuePendingTurns(50);
  assert.ok(dueAfter.some((candidate) => candidate.id === row!.id), "a turn whose settle_after has passed must be selected as due");
});

/**
 * SALES-AGENT-R3-V1.8.1b-A (Objetivo A - settlement responsibility
 * reconciliation, Sections 14-15). reconcileAssimilatedSiblings is only ever
 * meant to run inside dispatchGovernedSalesAgentMessage.ts's own open
 * transaction (Section 23's atomicity invariant), but its own logic is
 * repository-level and independent of that call site - tested here directly
 * against a real transaction/connection, same discipline as every other
 * repository test in this file.
 */

async function claimedRowFor(conversation: { id: number; waId: string }, inboundMessageId: number): Promise<TurnSettlementRow> {
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId,
    providerMessageId: `wamid.${inboundMessageId}`,
    correlationId: `corr-${inboundMessageId}`,
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const row = await loadPendingRowForConversation(conversation.id);
  assert.ok(row, "expected a fresh PENDING row to claim");
  assert.ok(await claimPendingTurn(row!.id));
  return loadRow(row!.id);
}

test("[I1] reconcileAssimilatedSiblings: full coverage marks the sibling ASSIMILATED and records the covering anchor", async () => {
  const conversation = await insertConversation();
  const rowA = await claimedRowFor(conversation, 2001);

  // Sibling B accumulates two fragments (2002, 2003) while A is PROCESSING -
  // both fully consumed by A's own (simulated) live-assimilated run.
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 2002,
    providerMessageId: "wamid.2002",
    correlationId: "corr-2002",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 2003,
    providerMessageId: "wamid.2003",
    correlationId: "corr-2003",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const rowB = await loadPendingRowForConversation(conversation.id);
  assert.ok(rowB);
  assert.equal(rowB!.first_inbound_message_id, 2002);
  assert.equal(rowB!.latest_inbound_message_id, 2003);

  await withTransaction(async (connection) => {
    const result = await reconcileAssimilatedSiblings(connection, conversation.id, rowA.id, 2003);
    assert.deepEqual(result.assimilatedIds, [rowB!.id]);
    assert.deepEqual(result.advancedIds, []);
  });

  const reconciled = await loadRow(rowB!.id);
  assert.equal(reconciled.status, "ASSIMILATED");
  assert.equal(reconciled.superseded_by_message_id, 2003);

  await completeTurn(rowA.id);
});

test("[I2] reconcileAssimilatedSiblings: partial coverage advances the sibling's lower bound and leaves it PENDING", async () => {
  const conversation = await insertConversation();
  const rowA = await claimedRowFor(conversation, 2101);

  // Sibling B accumulates 2102, 2103, 2104 - only up through 2103 was
  // actually assimilated by A's run; 2104 arrived and must remain this
  // sibling's own responsibility.
  for (const id of [2102, 2103, 2104]) {
    await upsertPendingTurn({
      conversationId: conversation.id,
      waId: conversation.waId,
      phoneNumberId: "phone-turnsettle-test",
      inboundMessageId: id,
      providerMessageId: `wamid.${id}`,
      correlationId: `corr-${id}`,
      settleDelayMs: 0,
      maxSettleMs: 5000
    });
  }
  const rowB = await loadPendingRowForConversation(conversation.id);
  assert.ok(rowB);
  assert.equal(rowB!.first_inbound_message_id, 2102);
  assert.equal(rowB!.latest_inbound_message_id, 2104);

  await withTransaction(async (connection) => {
    const result = await reconcileAssimilatedSiblings(connection, conversation.id, rowA.id, 2103);
    assert.deepEqual(result.assimilatedIds, []);
    assert.deepEqual(result.advancedIds, [rowB!.id]);
  });

  const reconciled = await loadRow(rowB!.id);
  assert.equal(reconciled.status, "PENDING", "a sibling with genuinely unconsumed content must never be marked terminal");
  assert.equal(reconciled.first_inbound_message_id, 2104, "the lower bound must advance to exactly one past the assimilated anchor");
  assert.equal(reconciled.latest_inbound_message_id, 2104, "the upper bound must never move - it reflects real durable inbound, never assimilation state");

  await completeTurn(rowA.id);
  await completeTurn(rowB!.id);
});

test("[I3] reconcileAssimilatedSiblings: no overlap leaves an unrelated-range sibling completely untouched", async () => {
  const conversation = await insertConversation();
  const rowA = await claimedRowFor(conversation, 2201);

  // Sibling B's range starts AFTER the assimilated anchor - none of it was
  // ever seen by A's run (the classic Section 16 race-window shape).
  await upsertPendingTurn({
    conversationId: conversation.id,
    waId: conversation.waId,
    phoneNumberId: "phone-turnsettle-test",
    inboundMessageId: 2210,
    providerMessageId: "wamid.2210",
    correlationId: "corr-2210",
    settleDelayMs: 0,
    maxSettleMs: 5000
  });
  const rowB = await loadPendingRowForConversation(conversation.id);
  assert.ok(rowB);

  await withTransaction(async (connection) => {
    const result = await reconcileAssimilatedSiblings(connection, conversation.id, rowA.id, 2203);
    assert.deepEqual(result.assimilatedIds, []);
    assert.deepEqual(result.advancedIds, []);
  });

  const untouched = await loadRow(rowB!.id);
  assert.equal(untouched.status, "PENDING");
  assert.equal(untouched.first_inbound_message_id, 2210);
  assert.equal(untouched.latest_inbound_message_id, 2210);

  await completeTurn(rowA.id);
  await completeTurn(rowB!.id);
});

test("[I4] completeTurn accepts an in-transaction connection and stays idempotent whether called on the pool or the same connection again", async () => {
  const conversation = await insertConversation();
  const row = await claimedRowFor(conversation, 2301);

  await withTransaction(async (connection) => {
    const completed = await completeTurn(row.id, connection);
    assert.equal(completed, true);
  });

  const reloaded = await loadRow(row.id);
  assert.equal(reloaded.status, "COMPLETED");

  // A later, separate call (mirroring runTurnSettleTick.ts's own unconditional
  // post-dispatch call) on the pool must be a safe no-op, never an error and
  // never a double-transition.
  assert.equal(await completeTurn(row.id), false);
});
