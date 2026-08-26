import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows, resetPoolForTests } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import {
  computeEvidenceFreshness,
  getConflictEvidence,
  getCurrentEvidenceForConversation,
  getCurrentEvidenceForMasterCustomer,
  getHistoricalEvidence,
  getUnresolvedEvidence,
  recordIdentityEvidence,
  recordIdentityEvidenceBatch,
  revokeIdentityEvidence,
  toPromptSafeSummary,
  type IdentityEvidenceRecord
} from "@/lib/domains/customer-identity-evidence";

Object.assign(process.env, {
  NODE_ENV: "development",
  DB_HOST: "127.0.0.1",
  DB_PORT: "3306",
  DB_NAME: "main_management",
  DB_USER: "crm_app",
  DB_PASSWORD: "una_clave_local",
  DB_URL: "",
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "main_management",
  DATABASE_USER: "crm_app",
  DATABASE_PASSWORD: "una_clave_local",
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

function uniqueSuffix(label: string) {
  return `${label}-${Date.now()}-${randomInt(0, 1_000_000)}`;
}

async function makeConversationId(label: string): Promise<string> {
  const accountId = `acct-${uniqueSuffix(label)}`;
  const contactId = `contact-${uniqueSuffix(label)}`;
  await queryRows(
    `INSERT INTO conversation (public_id, channel, provider, channel_account_id, external_contact_id) VALUES (UUID(), 'whatsapp', 'meta', ?, ?)`,
    [accountId, contactId]
  );
  const rows = await queryRows<{ id: number }>(
    `SELECT id FROM conversation WHERE channel_account_id = ? AND external_contact_id = ? LIMIT 1`,
    [accountId, contactId]
  );
  return String(rows[0].id);
}

async function makeMasterCustomerId(label: string): Promise<string> {
  const result = await createMasterCustomer({
    firstname: "Test",
    lastname: label,
    email: `${uniqueSuffix(label)}@example.test`,
    platformOrigin: "hub"
  });
  assert.equal(result.ok, true, "fixture master_customer creation must succeed");
  return String((result as { ok: true; data: { id: number } }).data.id);
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// IDE01: record email evidence -> persisted.
// ---------------------------------------------------------------------------
test("IDE01: recordIdentityEvidence persists a new evidence row", async () => {
  const conversationId = await makeConversationId("ide01");
  const result = await recordIdentityEvidence({
    conversationId,
    messageId: "msg-1",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "camila.rojas@example.test",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.status, "created");
  const current = await getCurrentEvidenceForConversation(conversationId);
  assert.equal(current.length, 1);
  assert.equal(current[0].signalType, "email");
  assert.equal(current[0].status, "OBSERVED");
});

// ---------------------------------------------------------------------------
// IDE02: replay same message -> no duplicate evidence.
// ---------------------------------------------------------------------------
test("IDE02: identical replay (same conversation/message/signal/value) never duplicates", async () => {
  const conversationId = await makeConversationId("ide02");
  const input = {
    conversationId,
    messageId: "msg-replay",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email" as const,
    source: "manual" as const,
    normalizedSignalValue: "replay@example.test",
    strength: "observed" as const,
    verified: false,
    observedAt: nowIso()
  };

  const first = await recordIdentityEvidence(input);
  const second = await recordIdentityEvidence(input);

  assert.equal(first.ok && first.status, "created");
  assert.equal(second.ok && second.status, "duplicate");
  assert.equal(first.ok && second.ok && first.record.evidenceId, second.ok && second.record.evidenceId);

  const current = await getCurrentEvidenceForConversation(conversationId);
  assert.equal(current.length, 1);
});

// ---------------------------------------------------------------------------
// IDE03 / IDE08: correction supersedes the prior row, never overwrites it.
// ---------------------------------------------------------------------------
test("IDE03: email corrected across turns supersedes the old row, current reflects the new one", async () => {
  const conversationId = await makeConversationId("ide03");
  const first = await recordIdentityEvidence({
    conversationId,
    messageId: "msg-1",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "a@x.cl",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  assert.equal(first.ok && first.status, "created");
  const firstId = first.ok ? first.record.evidenceId : "";

  const second = await recordIdentityEvidence({
    conversationId,
    messageId: "msg-2",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "b@x.cl",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  assert.equal(second.ok && second.status, "created");

  const current = await getCurrentEvidenceForConversation(conversationId);
  assert.equal(current.length, 1);
  assert.equal(current[0].evidenceId, second.ok ? second.record.evidenceId : "");

  const history = await getHistoricalEvidence(conversationId, "email");
  assert.equal(history.length, 2);
  const oldRow = history.find((row) => row.evidenceId === firstId)!;
  assert.equal(oldRow.status, "SUPERSEDED");
  assert.equal(oldRow.supersededByEvidenceId, second.ok ? second.record.evidenceId : null);
  assert.equal(computeEvidenceFreshness(oldRow), "historical");
});

test("IDE08: phone correction supersedes the old row (same mechanism as email)", async () => {
  const conversationId = await makeConversationId("ide08");
  await recordIdentityEvidence({
    conversationId,
    messageId: "msg-1",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "phone",
    source: "customer_external_identity",
    normalizedSignalValue: "56911111111",
    strength: "strong",
    verified: false,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId,
    messageId: "msg-2",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "phone",
    source: "customer_external_identity",
    normalizedSignalValue: "56922222222",
    strength: "strong",
    verified: false,
    observedAt: nowIso()
  });

  const current = await getCurrentEvidenceForConversation(conversationId);
  const phoneRows = current.filter((row) => row.signalType === "phone");
  assert.equal(phoneRows.length, 1);
  const history = await getHistoricalEvidence(conversationId, "phone");
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "SUPERSEDED");
});

test("repeat observation of the SAME value never spams a new row", async () => {
  const conversationId = await makeConversationId("ide-repeat");
  await recordIdentityEvidence({
    conversationId,
    messageId: "msg-1",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "same@x.cl",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  const repeat = await recordIdentityEvidence({
    conversationId,
    messageId: "msg-2",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "same@x.cl",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  assert.equal(repeat.ok && repeat.status, "unchanged");
  const history = await getHistoricalEvidence(conversationId, "email");
  assert.equal(history.length, 1);
});

// ---------------------------------------------------------------------------
// IDE04: order evidence confirms email candidate -> both remain auditable.
// ---------------------------------------------------------------------------
test("IDE04: email and order evidence coexist as separate auditable rows", async () => {
  const conversationId = await makeConversationId("ide04");
  const masterCustomerId = await makeMasterCustomerId("ide04");

  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "email",
    source: "prestashop",
    prestashopCustomerId: "7421",
    masterCustomerId,
    strength: "candidate",
    verified: false,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "order_reference",
    source: "order",
    normalizedSignalValue: "REF-1001",
    prestashopCustomerId: "7421",
    masterCustomerId,
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });

  const current = await getCurrentEvidenceForConversation(conversationId);
  assert.equal(current.length, 2);
  assert.ok(current.some((row) => row.signalType === "email"));
  assert.ok(current.some((row) => row.signalType === "order_reference" && row.status === "VERIFIED"));
});

// ---------------------------------------------------------------------------
// IDE05: email/order conflict -> conflict references both evidences.
// ---------------------------------------------------------------------------
test("IDE05: a conflicted turn groups every evidence item under one conflict_group_id", async () => {
  const conversationId = await makeConversationId("ide05");
  const results = await recordIdentityEvidenceBatch({
    conversationId,
    messageId: "msg-conflict",
    correlationId: randomUUID(),
    channel: "whatsapp",
    evidence: [
      { signalType: "email", source: "prestashop", prestashopCustomerId: "100", verified: false, observedAt: nowIso(), strength: "candidate" },
      { signalType: "order_reference", source: "order", prestashopCustomerId: "200", verified: false, observedAt: nowIso(), strength: "candidate" }
    ],
    conflict: { conflictCode: "email_vs_order_prestashop_id" }
  });

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok && r.status === "created"));
  const groupId = results[0].ok ? results[0].record.conflictGroupId : null;
  assert.ok(groupId);
  assert.ok(results.every((r) => r.ok && r.record.conflictGroupId === groupId));
  assert.ok(results.every((r) => r.ok && r.record.status === "CONFLICTED"));

  const group = await getConflictEvidence(groupId!);
  assert.equal(group.length, 2);
  assert.ok(group.every((row) => row.conflictCode === "email_vs_order_prestashop_id"));
});

// ---------------------------------------------------------------------------
// IDE06 / IDE07: restart between signals - evidence reconstructs from DB,
// never from in-process memory.
// ---------------------------------------------------------------------------
test("IDE06/IDE07: evidence recorded before a process restart is still readable and correctable after it", async () => {
  const conversationId = await makeConversationId("ide06");
  const waResult = await recordIdentityEvidence({
    conversationId,
    messageId: "msg-1",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "wa_id",
    source: "customer_external_identity",
    normalizedSignalValue: "56933333333",
    strength: "verified",
    verified: true,
    observedAt: nowIso(),
    channelEvidence: "controlled"
  });
  assert.equal(waResult.ok && waResult.status, "created");

  // Simulate a process restart (ACS-R1-05-T07 pattern) - destroys the pool,
  // the next call must open a genuinely new connection, never rely on
  // in-process state.
  await resetPoolForTests();

  const survived = await getCurrentEvidenceForConversation(conversationId);
  assert.equal(survived.length, 1);
  assert.equal(survived[0].signalType, "wa_id");
  assert.equal(survived[0].status, "VERIFIED");

  // Turn 2, after restart: order reference confirms - a correction path
  // still works correctly against reloaded state.
  const orderResult = await recordIdentityEvidence({
    conversationId,
    messageId: "msg-2",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "order_reference",
    source: "order",
    normalizedSignalValue: "REF-9001",
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });
  assert.equal(orderResult.ok && orderResult.status, "created");

  const afterSecondTurn = await getCurrentEvidenceForConversation(conversationId);
  assert.equal(afterSecondTurn.length, 2);
});

// ---------------------------------------------------------------------------
// IDE09: multiple WhatsApp numbers, same master -> evidence stays separate
// by external identity (conversation), never merged/superseded across them.
// ---------------------------------------------------------------------------
test("IDE09: evidence from two different conversations for the same master never supersedes each other", async () => {
  const masterCustomerId = await makeMasterCustomerId("ide09");
  const conversationA = await makeConversationId("ide09a");
  const conversationB = await makeConversationId("ide09b");

  await recordIdentityEvidence({
    conversationId: conversationA,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "phone",
    source: "customer_external_identity",
    normalizedSignalValue: "56944444444",
    masterCustomerId,
    strength: "strong",
    verified: false,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId: conversationB,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "phone",
    source: "customer_external_identity",
    normalizedSignalValue: "56955555555",
    masterCustomerId,
    strength: "strong",
    verified: false,
    observedAt: nowIso()
  });

  const forMaster = await getCurrentEvidenceForMasterCustomer(masterCustomerId);
  const phoneRows = forMaster.filter((row) => row.signalType === "phone");
  assert.equal(phoneRows.length, 2, "both external identities remain separately current, never merged");
  assert.ok(phoneRows.every((row) => row.status !== "SUPERSEDED"));
});

// ---------------------------------------------------------------------------
// IDE10 / IDE20: same signal observed on two providers/conversations
// coexists - never auto-merged, stays provider-scoped.
// ---------------------------------------------------------------------------
test("IDE10/IDE20: same email observed across two conversations/providers coexists without merge", async () => {
  const conversationIg = await makeConversationId("ide10-ig");
  const conversationWa = await makeConversationId("ide10-wa");

  await recordIdentityEvidence({
    conversationId: conversationIg,
    correlationId: randomUUID(),
    channel: "instagram",
    provider: "instagram",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "cross-channel@example.test",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId: conversationWa,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "cross-channel@example.test",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });

  const igEvidence = await getCurrentEvidenceForConversation(conversationIg);
  const waEvidence = await getCurrentEvidenceForConversation(conversationWa);
  assert.equal(igEvidence.length, 1);
  assert.equal(waEvidence.length, 1);
  assert.equal(igEvidence[0].provider, "instagram");
  assert.equal(waEvidence[0].provider, "manual");
  assert.notEqual(igEvidence[0].evidenceId, waEvidence[0].evidenceId);
});

// ---------------------------------------------------------------------------
// IDE11: IG candidate + WhatsApp master without explicit bridge -> no
// auto-link. Structural: this domain never writes master_customer or
// customer_external_identity.
// ---------------------------------------------------------------------------
test("IDE11/IDE18: the evidence repository never writes master_customer or customer_external_identity", () => {
  const source = readFileSync(join(__dirname, "../../lib/domains/customer-identity-evidence/repository.ts"), "utf8");
  assert.ok(!/INSERT\s+INTO\s+`?master_customer/i.test(source));
  assert.ok(!/INSERT\s+INTO\s+`?customer_external_identity/i.test(source));
  assert.ok(!/UPDATE\s+`?master_customer/i.test(source));
  assert.ok(!/UPDATE\s+`?customer_external_identity/i.test(source));
});

// ---------------------------------------------------------------------------
// IDE12: a link created later can be correlated without rewriting history -
// this domain never mutates a row's masterCustomerId after the fact.
// ---------------------------------------------------------------------------
test("IDE12: an evidence row's original masterCustomerId is never rewritten by a later correction", async () => {
  const conversationId = await makeConversationId("ide12");
  const first = await recordIdentityEvidence({
    conversationId,
    messageId: "msg-1",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "unlinked@example.test",
    masterCustomerId: null,
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  const firstId = first.ok ? first.record.evidenceId : "";

  // A later correction with a different value supersedes it - the OLD row's
  // masterCustomerId (null, as originally recorded) must remain untouched.
  await recordIdentityEvidence({
    conversationId,
    messageId: "msg-2",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "linked-later@example.test",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });

  const history = await getHistoricalEvidence(conversationId, "email");
  const oldRow = history.find((row) => row.evidenceId === firstId)!;
  assert.equal(oldRow.masterCustomerId, null);
  assert.equal(oldRow.status, "SUPERSEDED");
});

// ---------------------------------------------------------------------------
// IDE13: revoked link -> old evidence historical/stale, no longer current.
// ---------------------------------------------------------------------------
test("IDE13: revokeIdentityEvidence removes a row from current and marks it historical", async () => {
  const conversationId = await makeConversationId("ide13");
  const recorded = await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "phone",
    source: "customer_external_identity",
    normalizedSignalValue: "56966666666",
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });
  assert.equal(recorded.ok, true);
  const evidenceId = recorded.ok ? recorded.record.evidenceId : "";

  const beforeRevoke = await getCurrentEvidenceForConversation(conversationId);
  assert.equal(beforeRevoke.length, 1);

  const revoked = await revokeIdentityEvidence(evidenceId, nowIso());
  assert.equal(revoked.ok, true);
  assert.equal(revoked.ok && revoked.record.status, "REVOKED");
  assert.equal(revoked.ok && computeEvidenceFreshness(revoked.record), "historical");

  const afterRevoke = await getCurrentEvidenceForConversation(conversationId);
  assert.equal(afterRevoke.length, 0);
});

// ---------------------------------------------------------------------------
// IDE15: concurrent correction -> exactly one current row survives,
// conflict-safe (row locking inside the transaction serializes the race).
// ---------------------------------------------------------------------------
test("IDE15: two concurrent corrections for the same signal never leave two current rows", async () => {
  const conversationId = await makeConversationId("ide15");
  await recordIdentityEvidence({
    conversationId,
    messageId: "msg-0",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "initial@example.test",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });

  await Promise.all([
    recordIdentityEvidence({
      conversationId,
      messageId: "msg-race-a",
      correlationId: randomUUID(),
      channel: "whatsapp",
      provider: "manual",
      signalType: "email",
      source: "manual",
      normalizedSignalValue: "race-a@example.test",
      strength: "observed",
      verified: false,
      observedAt: nowIso()
    }),
    recordIdentityEvidence({
      conversationId,
      messageId: "msg-race-b",
      correlationId: randomUUID(),
      channel: "whatsapp",
      provider: "manual",
      signalType: "email",
      source: "manual",
      normalizedSignalValue: "race-b@example.test",
      strength: "observed",
      verified: false,
      observedAt: nowIso()
    })
  ]);

  const current = await getCurrentEvidenceForConversation(conversationId);
  const emailRows = current.filter((row) => row.signalType === "email");
  assert.equal(emailRows.length, 1, "exactly one current row must survive the race");

  const history = await getHistoricalEvidence(conversationId, "email");
  assert.equal(history.length, 3);
  const superseded = history.filter((row) => row.status === "SUPERSEDED");
  assert.equal(superseded.length, 2);
});

// ---------------------------------------------------------------------------
// IDE16: privacy summary redacts raw values.
// ---------------------------------------------------------------------------
test("IDE16: prompt-safe summary and stored display never carry the raw signal value", async () => {
  const conversationId = await makeConversationId("ide16");
  const raw = "camila.rojas@example.test";
  const recorded = await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: raw,
    masterCustomerId: "123",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  assert.equal(recorded.ok, true);
  const record = (recorded as { ok: true; record: IdentityEvidenceRecord }).record;

  assert.ok(!JSON.stringify(record).includes(raw));
  assert.ok(record.signalDisplay && !record.signalDisplay.includes(raw));

  const summary = toPromptSafeSummary(record);
  const summaryJson = JSON.stringify(summary);
  assert.ok(!summaryJson.includes(raw));
  assert.ok(!("masterCustomerId" in summary));
  assert.ok(!("signalHash" in summary));
  assert.ok(!("signalDisplay" in summary));
});

// ---------------------------------------------------------------------------
// IDE17: no LLM-reachable path can mark evidence VERIFIED - structural.
// ---------------------------------------------------------------------------
test("IDE17: the write API is never registered as a Capability Gateway tool/capability", () => {
  const gatewaySource = readFileSync(
    join(__dirname, "../../lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts"),
    "utf8"
  );
  assert.ok(!gatewaySource.includes("customer-identity-evidence"));
  assert.ok(!gatewaySource.includes("markIdentityEvidenceVerified"));
});

// ---------------------------------------------------------------------------
// IDE19: this domain never grants any "level"/authority from evidence alone.
// ---------------------------------------------------------------------------
test("IDE19: the domain exposes no authority/level-granting function", () => {
  const serviceSource = readFileSync(join(__dirname, "../../lib/domains/customer-identity-evidence/service.ts"), "utf8");
  const repositorySource = readFileSync(join(__dirname, "../../lib/domains/customer-identity-evidence/repository.ts"), "utf8");
  const combined = `${serviceSource}\n${repositorySource}`;
  assert.ok(!/export\s+(async\s+)?function\s+\w*(grant|authorize|elevate)\w*/i.test(combined));
});

// ---------------------------------------------------------------------------
// getUnresolvedEvidence: candidate/observed evidence without a master.
// ---------------------------------------------------------------------------
test("getUnresolvedEvidence returns only OBSERVED/CANDIDATE rows without a masterCustomerId", async () => {
  const conversationId = await makeConversationId("unresolved");
  const masterCustomerId = await makeMasterCustomerId("unresolved");
  await recordIdentityEvidence({
    conversationId,
    messageId: "m1",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "pending@example.test",
    masterCustomerId: null,
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId,
    messageId: "m2",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "wa_id",
    source: "customer_external_identity",
    normalizedSignalValue: "56977777777",
    masterCustomerId,
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });

  const unresolved = await getUnresolvedEvidence(conversationId);
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].signalType, "email");
});
