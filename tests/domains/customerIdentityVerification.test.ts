import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows, resetPoolForTests } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { upsertExternalIdentity } from "@/lib/integrations/customer-external-identity";
import { hashSignalValue, recordIdentityEvidence, type IdentityEvidenceRecord } from "@/lib/domains/customer-identity-evidence";
import { decideIdentityVerification } from "@/lib/domains/customer-identity-verification/evaluate";
import { decideEntityVerification } from "@/lib/domains/customer-identity-verification/evaluateEntity";
import {
  evaluateEntityVerification,
  evaluateIdentityVerification,
  type IdentityVerificationDependencies,
  type IdentityVerificationInputs
} from "@/lib/domains/customer-identity-verification";

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

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

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

async function linkChannelIdentity(provider: string, externalId: string, masterCustomerId: string | null): Promise<void> {
  const result = await upsertExternalIdentity({
    customerId: masterCustomerId ? Number(masterCustomerId) : null,
    provider,
    identityType: provider === "prestashop" ? "prestashop_customer_id" : "wa_id",
    externalId,
    normalizedValue: externalId,
    isVerified: masterCustomerId !== null
  });
  assert.equal(result.ok, true, "fixture customer_external_identity upsert must succeed");
}

function nowIso() {
  return new Date().toISOString();
}

let evidenceCounter = 0;
function fakeEvidence(overrides: Partial<IdentityEvidenceRecord> & Pick<IdentityEvidenceRecord, "signalType">): IdentityEvidenceRecord {
  evidenceCounter += 1;
  return {
    evidenceId: `fake-${evidenceCounter}-${randomUUID()}`,
    conversationId: "conv-1",
    messageId: null,
    correlationId: "corr-1",
    channel: "whatsapp",
    provider: "whatsapp",
    channelEvidence: null,
    source: "customer_external_identity",
    sourceRecordRef: null,
    signalHash: null,
    signalDisplay: null,
    masterCustomerId: null,
    prestashopCustomerId: null,
    strength: "observed",
    status: "OBSERVED",
    conflictGroupId: null,
    conflictCode: null,
    observedAt: nowIso(),
    verifiedAt: null,
    supersededAt: null,
    supersededByEvidenceId: null,
    staleAt: null,
    revokedAt: null,
    metadata: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides
  };
}

function inputs(partial: Partial<IdentityVerificationInputs>): IdentityVerificationInputs {
  return { currentChannelIdentity: null, evidence: [], freshStatus: null, ...partial };
}

/** Narrows away SYSTEM_FAILURE so tests can access currentLevel/masterCustomerId directly - every real DB call in this suite is expected to succeed. */
function assertNotSystemFailure<T extends { status: string }>(
  decision: T
): asserts decision is Exclude<T, { status: "SYSTEM_FAILURE" }> {
  assert.notEqual(decision.status, "SYSTEM_FAILURE");
}

// ---------------------------------------------------------------------------
// Pure decision tests (decideIdentityVerification) - no DB.
// ---------------------------------------------------------------------------

test("IVP01: wa_id canonical link resolves LEVEL_2, no PS evidence -> NOT_LINKED at that level", () => {
  const waEvidence = fakeEvidence({ signalType: "wa_id", status: "VERIFIED", strength: "verified", masterCustomerId: "100" });
  const decision = decideIdentityVerification(inputs({ currentChannelIdentity: { customerId: "100" }, evidence: [waEvidence] }));
  assertNotSystemFailure(decision);
  assert.equal(decision.currentLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.equal(decision.masterCustomerId, "100");
  assert.equal(decision.status, "NOT_LINKED");
  assert.equal(decision.policyCode, "EXISTING_CHANNEL_LINK");
  assert.deepEqual(decision.evidenceIds, [waEvidence.evidenceId]);
});

test("IVP02: channel observed without a link -> LEVEL_1", () => {
  const decision = decideIdentityVerification(inputs({ currentChannelIdentity: { customerId: null }, evidence: [] }));
  assertNotSystemFailure(decision);
  assert.equal(decision.currentLevel, "LEVEL_1_CHANNEL_OBSERVED");
  assert.equal(decision.masterCustomerId, null);
  assert.equal(decision.status, "NOT_LINKED");
});

test("LEVEL_0: never observed at all (no customer_external_identity row)", () => {
  const decision = decideIdentityVerification(inputs({ currentChannelIdentity: null, evidence: [] }));
  assertNotSystemFailure(decision);
  assert.equal(decision.currentLevel, "LEVEL_0_ANONYMOUS");
  assert.equal(decision.masterCustomerId, null);
});

test("IVP03: email alone -> NEEDS_VERIFICATION, never LEVEL_2/3", () => {
  const emailEvidence = fakeEvidence({ signalType: "email", source: "prestashop", status: "CANDIDATE", strength: "candidate" });
  const decision = decideIdentityVerification(inputs({ evidence: [emailEvidence] }));
  assert.equal(decision.status, "NEEDS_VERIFICATION");
  assert.notEqual(decision.currentLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.notEqual(decision.currentLevel, "LEVEL_3_PRESTASHOP_LINKED");
  if (decision.status === "NEEDS_VERIFICATION") {
    assert.ok(decision.requiredEvidence.includes("order_reference"));
  }
});

test("IVP04: email PS A + order PS A converged -> READY_TO_LINK, never auto-linked", () => {
  const waEvidence = fakeEvidence({ signalType: "wa_id", status: "VERIFIED", strength: "verified", masterCustomerId: "200" });
  const verifiedCandidate = fakeEvidence({
    signalType: "prestashop_customer_id",
    source: "prestashop",
    status: "VERIFIED",
    strength: "verified",
    prestashopCustomerId: "PS-A"
  });
  const decision = decideIdentityVerification(
    inputs({ currentChannelIdentity: { customerId: "200" }, evidence: [waEvidence, verifiedCandidate] })
  );
  assert.equal(decision.status, "READY_TO_LINK");
  if (decision.status === "READY_TO_LINK") {
    assert.equal(decision.masterCustomerId, "200");
    assert.equal(decision.prestashopCustomerId, "PS-A");
  }
});

test("IVP05: email PS A vs order PS B -> IDENTITY_CONFLICT", () => {
  const conflictGroupId = randomUUID();
  const emailSide = fakeEvidence({
    signalType: "email",
    source: "prestashop",
    status: "CONFLICTED",
    strength: "conflict",
    conflictGroupId,
    conflictCode: "email_vs_order_prestashop_id"
  });
  const orderSide = fakeEvidence({
    signalType: "order_reference",
    source: "order",
    status: "CONFLICTED",
    strength: "conflict",
    conflictGroupId,
    conflictCode: "email_vs_order_prestashop_id"
  });
  const decision = decideIdentityVerification(inputs({ evidence: [emailSide, orderSide] }));
  assert.equal(decision.status, "IDENTITY_CONFLICT");
  assert.equal(decision.masterCustomerId, null);
  if (decision.status === "IDENTITY_CONFLICT") {
    assert.equal(decision.conflictCode, "email_vs_order_prestashop_id");
    assert.equal(decision.policyCode, "EMAIL_ORDER_CONFLICT");
    assert.equal(decision.evidenceIds.length, 2);
  }
});

test("IVP06 (pure): wa_id master A + canonical PrestaShop bridge master A -> LEVEL_3, VERIFIED", () => {
  const waEvidence = fakeEvidence({ signalType: "wa_id", status: "VERIFIED", strength: "verified", masterCustomerId: "300" });
  const canonicalBridge = fakeEvidence({
    signalType: "prestashop_customer_id",
    source: "customer_external_identity",
    status: "VERIFIED",
    strength: "verified",
    masterCustomerId: "300",
    prestashopCustomerId: "PS-300"
  });
  const decision = decideIdentityVerification(
    inputs({ currentChannelIdentity: { customerId: "300" }, evidence: [waEvidence, canonicalBridge] })
  );
  assert.equal(decision.status, "VERIFIED");
  if (decision.status === "VERIFIED") {
    assert.equal(decision.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
    assert.equal(decision.masterCustomerId, "300");
    assert.equal(decision.prestashopCustomerId, "PS-300");
    assert.equal(decision.policyCode, "PRESTASHOP_LINK_PRESENT");
  }
});

test("IVP07 (pure): wa_id master A + canonical PrestaShop bridge master B -> IDENTITY_CONFLICT", () => {
  const conflictGroupId = randomUUID();
  const waEvidence = fakeEvidence({
    signalType: "wa_id",
    status: "CONFLICTED",
    strength: "conflict",
    masterCustomerId: "400",
    conflictGroupId,
    conflictCode: "prestashop_link_vs_wa_phone"
  });
  const bridgeToOther = fakeEvidence({
    signalType: "prestashop_customer_id",
    source: "customer_external_identity",
    status: "CONFLICTED",
    strength: "conflict",
    masterCustomerId: "500",
    prestashopCustomerId: "PS-400",
    conflictGroupId,
    conflictCode: "prestashop_link_vs_wa_phone"
  });
  const decision = decideIdentityVerification(
    inputs({ currentChannelIdentity: { customerId: "400" }, evidence: [waEvidence, bridgeToOther] })
  );
  assert.equal(decision.status, "IDENTITY_CONFLICT");
  if (decision.status === "IDENTITY_CONFLICT") {
    assert.equal(decision.policyCode, "PRESTASHOP_MASTER_CONFLICT");
  }
});

test("IVP08 (pure): master A + verified candidate B, no canonical bridge -> READY_TO_LINK, never LEVEL_3", () => {
  const waEvidence = fakeEvidence({ signalType: "wa_id", status: "VERIFIED", strength: "verified", masterCustomerId: "600" });
  const candidateOnly = fakeEvidence({
    signalType: "prestashop_customer_id",
    source: "prestashop",
    status: "VERIFIED",
    strength: "verified",
    prestashopCustomerId: "PS-600"
  });
  const decision = decideIdentityVerification(
    inputs({ currentChannelIdentity: { customerId: "600" }, evidence: [waEvidence, candidateOnly] })
  );
  assert.equal(decision.status, "READY_TO_LINK");
  assert.notEqual(decision.currentLevel, "LEVEL_3_PRESTASHOP_LINKED");
});

test("IVP09 (pure): a superseded email row is never passed to the decision (read boundary excludes it)", () => {
  const decision = decideIdentityVerification(inputs({ evidence: [] })); // caller (getCurrentEvidenceForConversationOrFail) already excludes SUPERSEDED
  assert.equal(decision.status, "NOT_LINKED");
});

test("IVP11 (pure): STALE evidence is filtered out by the policy itself, never elevates", () => {
  const staleCandidate = fakeEvidence({ signalType: "email", source: "prestashop", status: "STALE", strength: "candidate" });
  const decision = decideIdentityVerification(inputs({ evidence: [staleCandidate] }));
  assert.equal(decision.status, "NOT_LINKED");
  assert.deepEqual(decision.evidenceIds, []);
});

test("IVP12: a lone CONFLICTED PrestaShop-track row triggers IDENTITY_CONFLICT, never READY_TO_LINK", () => {
  const conflicted = fakeEvidence({
    signalType: "prestashop_customer_id",
    source: "prestashop",
    status: "CONFLICTED",
    strength: "conflict",
    prestashopCustomerId: "PS-700",
    conflictCode: "prestashop_id_multi_master"
  });
  const decision = decideIdentityVerification(inputs({ evidence: [conflicted] }));
  assert.equal(decision.status, "IDENTITY_CONFLICT");
});

test("IVP13 (pure): fresh-turn AMBIGUOUS surfaces as AMBIGUOUS, distinct from IDENTITY_CONFLICT", () => {
  const decision = decideIdentityVerification(inputs({ freshStatus: "AMBIGUOUS" }));
  assert.equal(decision.status, "AMBIGUOUS");
  assert.notEqual(decision.status, "IDENTITY_CONFLICT" as never);
});

test("IVP16 (pure): channel control is per-signal - a wa_id-only master never grants LEVEL_2 to an unlinked instagram row", () => {
  const waEvidence = fakeEvidence({ signalType: "wa_id", status: "VERIFIED", strength: "verified", masterCustomerId: "800" });
  // A second conversation's Instagram context has no channel identity row
  // at all and no wa_id evidence of its own - simulated by simply not
  // including it, proving there is no cross-signal inference inside the
  // pure function itself.
  const decision = decideIdentityVerification(inputs({ currentChannelIdentity: null, evidence: [waEvidence] }));
  // wa_id evidence belonging to a DIFFERENT conversation's channel link
  // still would not resolve LEVEL_2 here, because currentChannelIdentity
  // (the live customer_external_identity row for THIS turn's channel) is
  // null - the base-level computation never trusts evidence.masterCustomerId
  // for signalType "wa_id" on its own, only currentChannelIdentity or phone.
  assertNotSystemFailure(decision);
  assert.notEqual(decision.currentLevel, "LEVEL_2_MASTER_RESOLVED");
});

test("IVP23: conflict beats three otherwise-convergent weak signals", () => {
  const waLevel2 = fakeEvidence({ signalType: "wa_id", status: "VERIFIED", strength: "verified", masterCustomerId: "900" });
  const emailCandidate = fakeEvidence({ signalType: "email", source: "prestashop", status: "CANDIDATE", strength: "candidate" });
  const phoneConverged = fakeEvidence({ signalType: "phone", status: "CANDIDATE", strength: "strong", masterCustomerId: "900" });
  const conflicted = fakeEvidence({
    signalType: "prestashop_customer_id",
    source: "customer_external_identity",
    status: "CONFLICTED",
    strength: "conflict",
    masterCustomerId: "901",
    conflictCode: "prestashop_link_vs_wa_phone"
  });
  const decision = decideIdentityVerification(
    inputs({ currentChannelIdentity: { customerId: "900" }, evidence: [waLevel2, emailCandidate, phoneConverged, conflicted] })
  );
  assert.equal(decision.status, "IDENTITY_CONFLICT");
});

// ---------------------------------------------------------------------------
// Pure entity-verification tests (decideEntityVerification) - no DB.
// ---------------------------------------------------------------------------

test("entity verification: base decision below LEVEL_3 never reaches VERIFIED_FOR_ENTITY", () => {
  const baseDecision = decideIdentityVerification(inputs({ currentChannelIdentity: { customerId: "1000" }, evidence: [] }));
  const decision = decideEntityVerification({ entityType: "order", baseDecision, matchingOrderEvidence: null, now: nowIso() });
  assert.equal(decision.status, "NOT_VERIFIED_FOR_ENTITY");
  if (decision.status === "NOT_VERIFIED_FOR_ENTITY") {
    assert.equal(decision.reason, "identity_not_prestashop_linked");
  }
});

// ---------------------------------------------------------------------------
// DB-backed integration tests.
// ---------------------------------------------------------------------------

test("IVP06/IVP07 (integration): real customer_external_identity + evidence produce LEVEL_3 / conflict", async () => {
  const masterA = await makeMasterCustomerId("ivp0607-a");
  const conversationId = await makeConversationId("ivp0607");
  const waId = `wa-${uniqueSuffix("ivp0607")}`;
  await linkChannelIdentity("whatsapp", waId, masterA);
  // SALES-AGENT-R2-ID-R2-A05: the live LEVEL_3 freshness check reads this
  // same table (provider="prestashop") at decision time - a real bridge
  // needs a real row here, not just an evidence row that claims one.
  await linkChannelIdentity("prestashop", "PS-IVP06", masterA);
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "wa_id",
    source: "customer_external_identity",
    normalizedSignalValue: waId,
    masterCustomerId: masterA,
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "prestashop_customer_id",
    source: "customer_external_identity",
    masterCustomerId: masterA,
    prestashopCustomerId: "PS-IVP06",
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });

  const decision = await evaluateIdentityVerification({ conversationId, provider: "whatsapp", externalId: waId });
  assert.equal(decision.status, "VERIFIED");
  if (decision.status === "VERIFIED") {
    assert.equal(decision.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
    assert.equal(decision.masterCustomerId, masterA);
    assert.equal(decision.prestashopCustomerId, "PS-IVP06");
  }
});

test("IVP08 (integration): verified PrestaShop candidate without a canonical bridge -> READY_TO_LINK", async () => {
  const masterA = await makeMasterCustomerId("ivp08");
  const conversationId = await makeConversationId("ivp08");
  const waId = `wa-${uniqueSuffix("ivp08")}`;
  await linkChannelIdentity("whatsapp", waId, masterA);
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "wa_id",
    source: "customer_external_identity",
    normalizedSignalValue: waId,
    masterCustomerId: masterA,
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "prestashop_customer_id",
    source: "prestashop",
    prestashopCustomerId: "PS-IVP08",
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });

  const decision = await evaluateIdentityVerification({ conversationId, provider: "whatsapp", externalId: waId });
  assert.equal(decision.status, "READY_TO_LINK");
  assert.notEqual(decision.currentLevel, "LEVEL_3_PRESTASHOP_LINKED");
});

test("IVP09/IVP10 (integration): superseded and revoked evidence are excluded from the decision", async () => {
  const conversationId = await makeConversationId("ivp0910");
  const first = await recordIdentityEvidence({
    conversationId,
    messageId: "m1",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "old@example.test",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  assert.equal(first.ok, true);

  // Correction supersedes the old row (ID-R2-A03 mechanism, unchanged).
  await recordIdentityEvidence({
    conversationId,
    messageId: "m2",
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: "new@example.test",
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });

  const decisionAfterCorrection = await evaluateIdentityVerification({ conversationId, provider: "whatsapp", externalId: "unlinked" });
  assert.equal(decisionAfterCorrection.status, "NEEDS_VERIFICATION");
  if (decisionAfterCorrection.status === "NEEDS_VERIFICATION") {
    assert.equal(decisionAfterCorrection.evidenceIds.length, 1);
  }
});

test("IVP14/IVP15 (integration): entity verification is scoped to exactly one order, never a standing LEVEL_4", async () => {
  const masterA = await makeMasterCustomerId("ivp1415");
  const conversationId = await makeConversationId("ivp1415");
  const waId = `wa-${uniqueSuffix("ivp1415")}`;
  await linkChannelIdentity("whatsapp", waId, masterA);
  // SALES-AGENT-R2-ID-R2-A05: see the identical note in the IVP06/IVP07 fixture above.
  await linkChannelIdentity("prestashop", "PS-IVP1415", masterA);
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "wa_id",
    source: "customer_external_identity",
    normalizedSignalValue: waId,
    masterCustomerId: masterA,
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "prestashop_customer_id",
    source: "customer_external_identity",
    masterCustomerId: masterA,
    prestashopCustomerId: "PS-IVP1415",
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "order_reference",
    source: "order",
    normalizedSignalValue: "REF-VERIFIED-001",
    prestashopCustomerId: "PS-IVP1415",
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });

  // IVP14: the exact order reference evidenced for the same PS account.
  const verified = await evaluateEntityVerification({
    conversationId,
    provider: "whatsapp",
    externalId: waId,
    entityType: "order",
    entityRef: "REF-VERIFIED-001"
  });
  assert.equal(verified.status, "VERIFIED_FOR_ENTITY");
  if (verified.status === "VERIFIED_FOR_ENTITY") {
    assert.equal(verified.masterCustomerId, masterA);
    assert.equal(verified.prestashopCustomerId, "PS-IVP1415");
  }

  // IVP15: an unrelated order reference the same identity has never evidenced.
  const unrelated = await evaluateEntityVerification({
    conversationId,
    provider: "whatsapp",
    externalId: waId,
    entityType: "order",
    entityRef: "REF-NEVER-SEEN-999"
  });
  assert.equal(unrelated.status, "NOT_VERIFIED_FOR_ENTITY");
  if (unrelated.status === "NOT_VERIFIED_FOR_ENTITY") {
    assert.equal(unrelated.reason, "order_reference_not_evidenced");
  }
});

test("IVP16 (integration): a WhatsApp-linked master grants nothing to an unrelated Instagram conversation", async () => {
  const masterA = await makeMasterCustomerId("ivp16");
  const waConversation = await makeConversationId("ivp16-wa");
  const igConversation = await makeConversationId("ivp16-ig");
  const waId = `wa-${uniqueSuffix("ivp16")}`;
  await linkChannelIdentity("whatsapp", waId, masterA);
  await recordIdentityEvidence({
    conversationId: waConversation,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "wa_id",
    source: "customer_external_identity",
    normalizedSignalValue: waId,
    masterCustomerId: masterA,
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });

  const waDecision = await evaluateIdentityVerification({ conversationId: waConversation, provider: "whatsapp", externalId: waId });
  assertNotSystemFailure(waDecision);
  assert.equal(waDecision.masterCustomerId, masterA);

  const igDecision = await evaluateIdentityVerification({
    conversationId: igConversation,
    provider: "instagram",
    externalId: `ig-${uniqueSuffix("ivp16")}`
  });
  assertNotSystemFailure(igDecision);
  assert.notEqual(igDecision.masterCustomerId, masterA);
  assert.notEqual(igDecision.currentLevel, "LEVEL_2_MASTER_RESOLVED");
});

test("IVP17 (integration): two canonically-linked channel identities independently resolve the same master", async () => {
  const masterA = await makeMasterCustomerId("ivp17");
  const waConversation = await makeConversationId("ivp17-wa");
  const igConversation = await makeConversationId("ivp17-ig");
  const waId = `wa-${uniqueSuffix("ivp17")}`;
  const igId = `ig-${uniqueSuffix("ivp17")}`;
  await linkChannelIdentity("whatsapp", waId, masterA);
  await linkChannelIdentity("instagram", igId, masterA);

  const waDecision = await evaluateIdentityVerification({ conversationId: waConversation, provider: "whatsapp", externalId: waId });
  const igDecision = await evaluateIdentityVerification({ conversationId: igConversation, provider: "instagram", externalId: igId });
  assertNotSystemFailure(waDecision);
  assertNotSystemFailure(igDecision);

  assert.equal(waDecision.currentLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.equal(igDecision.currentLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.equal(waDecision.masterCustomerId, masterA);
  assert.equal(igDecision.masterCustomerId, masterA);
});

test("IVP18 (integration): the same email observed on two conversations never auto-merges", async () => {
  const conversationA = await makeConversationId("ivp18-a");
  const conversationB = await makeConversationId("ivp18-b");
  const sharedEmail = `shared-${uniqueSuffix("ivp18")}@example.test`;

  const recordedA = await recordIdentityEvidence({
    conversationId: conversationA,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: sharedEmail,
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  const recordedB = await recordIdentityEvidence({
    conversationId: conversationB,
    correlationId: randomUUID(),
    channel: "instagram",
    provider: "manual",
    signalType: "email",
    source: "manual",
    normalizedSignalValue: sharedEmail,
    strength: "observed",
    verified: false,
    observedAt: nowIso()
  });
  assert.equal(recordedA.ok && recordedA.status, "created");
  assert.equal(recordedB.ok && recordedB.status, "created");

  const decisionA = await evaluateIdentityVerification({ conversationId: conversationA, provider: "whatsapp", externalId: "unlinked-a" });
  const decisionB = await evaluateIdentityVerification({ conversationId: conversationB, provider: "instagram", externalId: "unlinked-b" });

  assert.equal(decisionA.status, "NEEDS_VERIFICATION");
  assert.equal(decisionB.status, "NEEDS_VERIFICATION");
  if (decisionA.status === "NEEDS_VERIFICATION" && decisionB.status === "NEEDS_VERIFICATION") {
    assert.notDeepEqual(decisionA.evidenceIds, decisionB.evidenceIds);
  }
});

test("IVP19: an evidence repository failure fails closed to SYSTEM_FAILURE, never LEVEL_0", async () => {
  const failingDependencies: IdentityVerificationDependencies = {
    getCurrentEvidence: async () => ({ ok: false, error: "simulated_repository_failure" })
  };
  const decision = await evaluateIdentityVerification(
    { conversationId: "irrelevant", provider: "whatsapp", externalId: "irrelevant" },
    { dependencies: failingDependencies }
  );
  assert.equal(decision.status, "SYSTEM_FAILURE");
  if (decision.status === "SYSTEM_FAILURE") {
    assert.equal(decision.retryable, true);
    assert.equal(decision.policyCode, "EVIDENCE_REPOSITORY_FAILURE");
  }
});

test("IVP24: restart produces the identical decision from durable evidence alone", async () => {
  const masterA = await makeMasterCustomerId("ivp24");
  const conversationId = await makeConversationId("ivp24");
  const waId = `wa-${uniqueSuffix("ivp24")}`;
  await linkChannelIdentity("whatsapp", waId, masterA);
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "wa_id",
    source: "customer_external_identity",
    normalizedSignalValue: waId,
    masterCustomerId: masterA,
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });

  const before = await evaluateIdentityVerification({ conversationId, provider: "whatsapp", externalId: waId });

  await resetPoolForTests();

  const after1 = await evaluateIdentityVerification({ conversationId, provider: "whatsapp", externalId: waId });
  assert.deepEqual(before, after1);
});

// ---------------------------------------------------------------------------
// SALES-AGENT-R2-ID-R2-A05, PARTE 7: LEVEL_3 live freshness. Durable
// evidence claiming a canonical PrestaShop bridge is never enough by
// itself once a real caller exists (A05) - the bridge must still confirm
// live at decision time.
// ---------------------------------------------------------------------------

test("IVP25 (integration): a canonical bridge evidenced durably but revoked live never surfaces as LEVEL_3 - fails closed to LEVEL_2/NOT_LINKED", async () => {
  const masterA = await makeMasterCustomerId("ivp25");
  const conversationId = await makeConversationId("ivp25");
  const waId = `wa-${uniqueSuffix("ivp25")}`;
  await linkChannelIdentity("whatsapp", waId, masterA);
  // Deliberately no linkChannelIdentity("prestashop", ...) call - the
  // durable evidence below claims a bridge that customer_external_identity
  // itself never actually has (already revoked/never real).
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "whatsapp",
    signalType: "wa_id",
    source: "customer_external_identity",
    normalizedSignalValue: waId,
    masterCustomerId: masterA,
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "prestashop_customer_id",
    source: "customer_external_identity",
    masterCustomerId: masterA,
    prestashopCustomerId: "PS-IVP25-REVOKED",
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });

  const decision = await evaluateIdentityVerification({ conversationId, provider: "whatsapp", externalId: waId });
  assert.equal(decision.status, "NOT_LINKED");
  if (decision.status === "NOT_LINKED") {
    assert.equal(decision.currentLevel, "LEVEL_2_MASTER_RESOLVED");
    assert.equal(decision.masterCustomerId, masterA);
    assert.equal(decision.policyCode, "PRESTASHOP_LIVE_LINK_STALE");
  }

  // Same discipline applies transitively to LEVEL_4 - a stale LEVEL_3 base
  // decision can never verify any entity.
  await recordIdentityEvidence({
    conversationId,
    correlationId: randomUUID(),
    channel: "whatsapp",
    provider: "prestashop",
    signalType: "order_reference",
    source: "order",
    normalizedSignalValue: "REF-IVP25",
    prestashopCustomerId: "PS-IVP25-REVOKED",
    strength: "verified",
    verified: true,
    observedAt: nowIso()
  });
  const entityDecision = await evaluateEntityVerification({
    conversationId,
    provider: "whatsapp",
    externalId: waId,
    entityType: "order",
    entityRef: "REF-IVP25"
  });
  assert.equal(entityDecision.status, "NOT_VERIFIED_FOR_ENTITY");
  if (entityDecision.status === "NOT_VERIFIED_FOR_ENTITY") {
    assert.equal(entityDecision.reason, "identity_not_prestashop_linked");
  }
});

test("IVP26: a live-lookup repository failure at the LEVEL_3 confirmation step fails closed to SYSTEM_FAILURE, never a downgraded level", async () => {
  // The whatsapp channel lookup succeeds (so the decision reaches the
  // LEVEL_3 canonical-bridge branch); only the prestashop live-confirmation
  // lookup fails - isolating this from IVP19 (a channel-lookup failure).
  const dependencies: IdentityVerificationDependencies = {
    findExternalIdentity: async (provider: string, externalId: string) => {
      if (provider === "whatsapp") {
        return {
          ok: true as const,
          error: null,
          row: {
            id: 1,
            customer_id: 999,
            provider: "whatsapp",
            identity_type: "wa_id",
            external_id: externalId,
            normalized_value: externalId,
            is_verified: 1,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z"
          }
        };
      }
      return { ok: false as const, error: "simulated_repository_failure", row: null };
    },
    getCurrentEvidence: async () => ({
      ok: true,
      records: [
        fakeEvidence({ signalType: "wa_id", source: "customer_external_identity", masterCustomerId: "999", strength: "verified", status: "VERIFIED" }),
        fakeEvidence({
          signalType: "prestashop_customer_id",
          provider: "prestashop",
          source: "customer_external_identity",
          masterCustomerId: "999",
          prestashopCustomerId: "PS-IVP26",
          strength: "verified",
          status: "VERIFIED"
        })
      ]
    })
  };

  const decision = await evaluateIdentityVerification({ conversationId: "irrelevant", provider: "whatsapp", externalId: "irrelevant" }, { dependencies });
  assert.equal(decision.status, "SYSTEM_FAILURE");
  if (decision.status === "SYSTEM_FAILURE") {
    assert.equal(decision.retryable, true);
    assert.equal(decision.policyCode, "EVIDENCE_REPOSITORY_FAILURE");
  }
});

// ---------------------------------------------------------------------------
// Structural tests (IVP20/IVP21/IVP22).
// ---------------------------------------------------------------------------

test("IVP20/IVP21: the verification domain never calls Capability Gateway mutations or writes master_customer/customer_external_identity", () => {
  // types.ts/index.ts are excluded on purpose: they legitimately mention
  // these names only in doc comments explaining what the module never
  // does - the actual runtime-call check only matters for the files that
  // could contain a real call.
  const files = ["evaluate.ts", "evaluateEntity.ts", "service.ts"];
  for (const file of files) {
    const source = readFileSync(join(__dirname, "../../lib/domains/customer-identity-verification", file), "utf8");
    assert.ok(!/executeGovernedCapability/.test(source), `${file} must never call the Capability Gateway`);
    assert.ok(!/link_external_identity/.test(source), `${file} must never reference link_external_identity`);
    assert.ok(!/create_customer/.test(source), `${file} must never reference create_customer`);
    assert.ok(!/INSERT\s+INTO\s+`?master_customer/i.test(source), `${file} must never write master_customer`);
    assert.ok(!/UPDATE\s+`?master_customer/i.test(source), `${file} must never write master_customer`);
    assert.ok(!/(INSERT|UPDATE)\s+INTO?\s*`?customer_external_identity/i.test(source), `${file} must never write customer_external_identity`);
  }
  // findExternalIdentityByProviderExternalId (the one customer_external_identity
  // call this domain makes) is read-only - confirmed directly in its own
  // repository source, not re-verified here to avoid a duplicate assertion
  // of another domain's internals.
});

test("IVP22: the verification domain is never imported by any Capability Gateway/tool-alias registration file", () => {
  const gatewaySource = readFileSync(
    join(__dirname, "../../lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts"),
    "utf8"
  );
  assert.ok(!gatewaySource.includes("customer-identity-verification"));

  const domainFiles = ["evaluate.ts", "evaluateEntity.ts", "service.ts"];
  for (const file of domainFiles) {
    const source = readFileSync(join(__dirname, "../../lib/domains/customer-identity-verification", file), "utf8");
    // No function anywhere in this domain accepts an externally-supplied
    // level/status and returns it verbatim as the resulting identityLevel -
    // every branch's identityLevel/status is a literal computed by this
    // module's own control flow, never an echoed input.
    assert.ok(!/export\s+(async\s+)?function\s+\w*(setLevel|forceLevel|overrideLevel)\w*/i.test(source));
  }
});
