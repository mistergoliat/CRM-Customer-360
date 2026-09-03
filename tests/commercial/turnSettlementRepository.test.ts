import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { getPool, safeQueryRows } from "@/lib/db";
import {
  upsertPendingTurn,
  selectDuePendingTurns,
  selectStaleProcessingTurns,
  claimPendingTurn,
  reclaimStaleProcessingTurn,
  completeTurn,
  supersedeTurn
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
