import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test, { after } from "node:test";
import { getPool, queryRows, resetPoolForTests } from "@/lib/db";
import { createMasterCustomer } from "@/lib/integrations/customer-master/customer-repository";
import { upsertExternalIdentity } from "@/lib/integrations/customer-external-identity";
import { recordIdentityEvidence } from "@/lib/domains/customer-identity-evidence";
import type { IdentityVerificationDecision } from "@/lib/domains/customer-identity-verification";
import {
  mapIdentityVerificationDecisionToRuntimeIdentityContext,
  resolveRuntimeIdentityContext
} from "@/lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext";
import { recordIdentityVerificationDecision } from "@/lib/brain/commercial/native-cycle/customer-session/identityAuditEvents";
import { resolveNativeCustomerSession } from "@/lib/brain/commercial/native-cycle/customer-session";
import type { CustomerIdentityResolutionService, ResolveCustomerIdentityResult } from "@/lib/domains/customer-identity";
import type { CustomerOnboardingService } from "@/lib/domains/customer-onboarding";

// SALES-AGENT-R2-ID-R2-A05. Test matrix RIC01-RIC24 from the task spec.
// RuntimeIdentityContext is a pure mapping over A04's IdentityVerificationDecision
// (RIC01-09, no DB), wired once per turn into resolveNativeCustomerSession
// (RIC10-14/21-24, real MariaDB - same discipline as
// tests/domains/customerIdentityVerification.test.ts), and passed passively
// to every runtime that shares the session boundary (RIC15-20, structural).

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
// Fixture helpers - same minimal, no-shared-module pattern as
// tests/domains/customerIdentityVerification.test.ts.
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

// resolveRuntimeIdentityContext normalizes externalId via normalizeWaId
// before looking it up (matching what the real resolver already wrote at
// insert time) - a fixture must use a realistic, numeric-shaped wa_id (like
// a real production trustedInbound.externalId) so the literal external_id
// linkChannelIdentity stores matches what the normalized lookup computes.
// evaluateIdentityVerification called directly (bypassing the wrapper, as
// A04's own tests do) has no such constraint.
function numericWaId(label: string) {
  return `56${uniqueSuffix(label).replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
}

// ---------------------------------------------------------------------------
// RIC01-RIC09: pure mapping from IdentityVerificationDecision. No DB - same
// discipline as customerIdentityVerification.test.ts's "(pure)" tests.
// ---------------------------------------------------------------------------

test("RIC01: no evidence / no channel row -> LEVEL_0 ANONYMOUS context", () => {
  const decision: IdentityVerificationDecision = {
    status: "NOT_LINKED",
    currentLevel: "LEVEL_0_ANONYMOUS",
    masterCustomerId: null,
    evidenceIds: [],
    policyCode: "NO_CHANNEL_EVIDENCE"
  };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "ANONYMOUS");
  assert.equal(ctx.identityLevel, "LEVEL_0_ANONYMOUS");
  assert.equal(ctx.masterCustomerId, null);
  assert.equal(ctx.verificationRequired, false);
  assert.equal(ctx.readyToLink, false);
});

test("RIC02: unresolved channel identity -> LEVEL_1 CHANNEL_OBSERVED", () => {
  const decision: IdentityVerificationDecision = {
    status: "NOT_LINKED",
    currentLevel: "LEVEL_1_CHANNEL_OBSERVED",
    masterCustomerId: null,
    evidenceIds: [],
    policyCode: "CHANNEL_OBSERVED_UNLINKED"
  };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "CHANNEL_OBSERVED");
  assert.equal(ctx.identityLevel, "LEVEL_1_CHANNEL_OBSERVED");
});

test("RIC03: canonical channel link, no PrestaShop progress -> LEVEL_2 MASTER_RESOLVED", () => {
  const decision: IdentityVerificationDecision = {
    status: "NOT_LINKED",
    currentLevel: "LEVEL_2_MASTER_RESOLVED",
    masterCustomerId: "555",
    evidenceIds: ["ev-1"],
    policyCode: "EXISTING_CHANNEL_LINK"
  };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "MASTER_RESOLVED");
  assert.equal(ctx.identityLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.equal(ctx.masterCustomerId, "555");
});

test("RIC04: canonical channel + confirmed PrestaShop bridge -> LEVEL_3 PRESTASHOP_LINKED", () => {
  const decision: IdentityVerificationDecision = {
    status: "VERIFIED",
    identityLevel: "LEVEL_3_PRESTASHOP_LINKED",
    currentLevel: "LEVEL_3_PRESTASHOP_LINKED",
    masterCustomerId: "555",
    prestashopCustomerId: "PS-1",
    evidenceIds: ["ev-1", "ev-2"],
    policyCode: "PRESTASHOP_LINK_PRESENT"
  };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "PRESTASHOP_LINKED");
  assert.equal(ctx.identityLevel, "LEVEL_3_PRESTASHOP_LINKED");
  assert.equal(ctx.prestashopCustomerId, "PS-1");
  assert.deepEqual(ctx.evidenceRefs, ["ev-1", "ev-2"]);
});

test("RIC05: verified PrestaShop candidate without a canonical bridge -> READY_TO_LINK, level stays LEVEL_2", () => {
  const decision: IdentityVerificationDecision = {
    status: "READY_TO_LINK",
    currentLevel: "LEVEL_2_MASTER_RESOLVED",
    masterCustomerId: "555",
    prestashopCustomerId: "PS-1",
    evidenceIds: ["ev-1"],
    policyCode: "READY_TO_LINK_PRESTASHOP_CANDIDATE"
  };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "READY_TO_LINK");
  assert.equal(ctx.identityLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.equal(ctx.readyToLink, true);
});

test("RIC06: email-only evidence -> NEEDS_VERIFICATION with requiredEvidence populated", () => {
  const decision: IdentityVerificationDecision = {
    status: "NEEDS_VERIFICATION",
    currentLevel: "LEVEL_0_ANONYMOUS",
    masterCustomerId: null,
    requiredEvidence: ["order_reference"],
    evidenceIds: ["ev-1"],
    policyCode: "EMAIL_ONLY_REQUIRES_VERIFICATION"
  };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "NEEDS_VERIFICATION");
  assert.equal(ctx.verificationRequired, true);
  assert.deepEqual(ctx.requiredEvidence, ["order_reference"]);
});

test("RIC07: conflict -> CONFLICT, masterCustomerId cleared even if the base level had one", () => {
  const decision: IdentityVerificationDecision = {
    status: "IDENTITY_CONFLICT",
    currentLevel: "LEVEL_2_MASTER_RESOLVED",
    masterCustomerId: null,
    conflictCode: "prestashop_link_vs_wa_phone",
    evidenceIds: ["ev-1", "ev-2"],
    policyCode: "PRESTASHOP_MASTER_CONFLICT"
  };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "CONFLICT");
  assert.equal(ctx.masterCustomerId, null);
  assert.equal(ctx.conflictCode, "prestashop_link_vs_wa_phone");
});

test("RIC08: ambiguous fresh A02 result -> AMBIGUOUS", () => {
  const decision: IdentityVerificationDecision = {
    status: "AMBIGUOUS",
    currentLevel: "LEVEL_1_CHANNEL_OBSERVED",
    masterCustomerId: null,
    evidenceIds: [],
    policyCode: "AMBIGUOUS_PRESTASHOP_ACCOUNT"
  };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "AMBIGUOUS");
});

test("RIC09: A04 repository failure -> SYSTEM_UNAVAILABLE, never a fabricated ANONYMOUS", () => {
  const decision: IdentityVerificationDecision = { status: "SYSTEM_FAILURE", retryable: true, policyCode: "EVIDENCE_REPOSITORY_FAILURE" };
  const ctx = mapIdentityVerificationDecisionToRuntimeIdentityContext(decision);
  assert.equal(ctx.status, "SYSTEM_UNAVAILABLE");
  assert.notEqual(ctx.status, "ANONYMOUS");
  assert.equal(ctx.masterCustomerId, null);
  assert.equal(ctx.policyCode, "EVIDENCE_REPOSITORY_FAILURE");
});

// ---------------------------------------------------------------------------
// RIC10/RIC11: wiring - same-turn evidence visibility and restart stability.
// ---------------------------------------------------------------------------

test("RIC10: same-turn evidence is visible to verification - a wa_id resolved THIS turn is already LEVEL_2, no second turn needed", async () => {
  const masterA = await makeMasterCustomerId("ric10");
  const conversationId = await makeConversationId("ric10");
  const waId = numericWaId("ric10");
  await linkChannelIdentity("whatsapp", waId, masterA);

  const identityService: CustomerIdentityResolutionService = {
    async resolveIdentity(): Promise<ResolveCustomerIdentityResult> {
      return {
        status: "identified",
        customerId: masterA,
        matchedBy: "external_identity",
        confidence: "verified",
        conflicts: [],
        warnings: [],
        detail: {
          status: "RESOLVED",
          masterCustomerId: masterA,
          prestashopCustomerId: null,
          conflictCode: null,
          evidence: [{ signalType: "wa_id", source: "customer_external_identity", strength: "verified", masterCustomerId: masterA, verified: true, observedAt: nowIso() }]
        }
      };
    }
  };
  const onboardingService: CustomerOnboardingService = {
    async getState() { return null; },
    startOnboarding: async () => { throw new Error("unused"); },
    collectFields: async () => { throw new Error("unused"); },
    markResolving: async () => { throw new Error("unused"); },
    completeOnboarding: async () => { throw new Error("unused"); },
    markConflict: async () => { throw new Error("unused"); },
    markTemporarilyUnavailable: async () => { throw new Error("unused"); },
    retryResolution: async () => { throw new Error("unused"); },
    recordVerificationFailure: async () => { throw new Error("unused"); }
  };

  const result = await resolveNativeCustomerSession({
    conversationId,
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: waId, normalizedPhone: waId, messageId: `wamid-${uniqueSuffix("ric10")}`, receivedAt: nowIso() },
    messageText: "hola",
    correlationId: randomUUID(),
    priorConversationCustomerId: null,
    dependencies: { identityService, onboardingService }
  });

  assert.equal(result.execution.runtimeIdentity.status, "MASTER_RESOLVED");
  assert.equal(result.execution.runtimeIdentity.identityLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.equal(result.execution.runtimeIdentity.masterCustomerId, masterA);
  assert.deepEqual(result.decision.runtimeIdentity, result.execution.runtimeIdentity);
});

test("RIC11: restart produces the identical RuntimeIdentityContext", async () => {
  const masterA = await makeMasterCustomerId("ric11");
  const conversationId = await makeConversationId("ric11");
  const waId = numericWaId("ric11");
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

  const before = await resolveRuntimeIdentityContext({ conversationId, externalId: waId, detail: undefined });
  assert.equal(before.status, "MASTER_RESOLVED");
  await resetPoolForTests();
  const after1 = await resolveRuntimeIdentityContext({ conversationId, externalId: waId, detail: undefined });
  assert.deepEqual(before, after1);
});

// ---------------------------------------------------------------------------
// RIC12/RIC13/RIC14: privacy - no raw email/phone/wa_id anywhere in the
// produced context, even when the turn's real inputs carry them.
// ---------------------------------------------------------------------------

test("RIC12/RIC13/RIC14: RuntimeIdentityContext never carries raw email/phone/wa_id", async () => {
  const conversationId = await makeConversationId("ric121314");
  const rawWaId = "56988887777";
  const rawEmail = "privacy-check@example.test";

  const identityService: CustomerIdentityResolutionService = {
    async resolveIdentity(): Promise<ResolveCustomerIdentityResult> {
      return { status: "identification_required", customerId: null, matchedBy: null, confidence: "insufficient", conflicts: [], warnings: [] };
    }
  };
  const onboardingService: CustomerOnboardingService = {
    async getState() { return null; },
    startOnboarding: async () => { throw new Error("unused"); },
    collectFields: async () => { throw new Error("unused"); },
    markResolving: async () => { throw new Error("unused"); },
    completeOnboarding: async () => { throw new Error("unused"); },
    markConflict: async () => { throw new Error("unused"); },
    markTemporarilyUnavailable: async () => { throw new Error("unused"); },
    retryResolution: async () => { throw new Error("unused"); },
    recordVerificationFailure: async () => { throw new Error("unused"); }
  };

  const result = await resolveNativeCustomerSession({
    conversationId,
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: rawWaId, normalizedPhone: rawWaId, messageId: `wamid-${uniqueSuffix("ric121314")}`, receivedAt: nowIso() },
    messageText: `mi correo es ${rawEmail}`,
    correlationId: randomUUID(),
    priorConversationCustomerId: null,
    dependencies: { identityService, onboardingService }
  });

  const serialized = JSON.stringify(result.decision.runtimeIdentity);
  assert.doesNotMatch(serialized, /56988887777/);
  assert.doesNotMatch(serialized, /privacy-check@example\.test/);
  assert.doesNotMatch(serialized, /@/);
});

// ---------------------------------------------------------------------------
// RIC15-RIC18: structural - every runtime that shares the session boundary
// receives RuntimeIdentityContext passively (transported, never branched on).
// ---------------------------------------------------------------------------

function assertNoRuntimeIdentityUsage(directory: string, label: string) {
  const dir = join(__dirname, "../../lib/brain/commercial", directory);
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".ts"));
  for (const file of files) {
    const source = readFileSync(join(dir, file.name), "utf8");
    assert.ok(!/runtimeIdentity\s*[.[]/.test(source), `${label}/${file.name} must never read a field off runtimeIdentity - passive transport only`);
  }
}

test("RIC15/RIC16: CommercialWork receives RuntimeIdentityContext passively - no file under lib/brain/commercial/work reads a field off it", () => {
  assertNoRuntimeIdentityUsage("work", "work");
});

test("RIC17: multi-request runtime never reads a field off RuntimeIdentityContext", () => {
  assertNoRuntimeIdentityUsage("multi-request", "multi-request");
});

test("RIC18: Agent Tool Loop never reads a field off RuntimeIdentityContext", () => {
  assertNoRuntimeIdentityUsage("agent-loop", "agent-loop");
});

// ---------------------------------------------------------------------------
// RIC19/RIC20: checkout neutrality + catalog/shipping/quote/handoff absence.
// Scoped to import specifiers only (not whole-file substring matching) -
// this file's own doc comments legitimately mention "checkout"/"quote" in
// prose explaining what is NEVER read, which a blind substring scan would
// misflag.
// ---------------------------------------------------------------------------

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRegex = /(?:import|export)\s+[^;]*?from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) specifiers.push(match[1]);
  const requireRegex = /require\(["']([^"']+)["']\)/g;
  while ((match = requireRegex.exec(source)) !== null) specifiers.push(match[1]);
  return specifiers;
}

test("RIC19/RIC20: identity wiring never imports checkout/quote/shipping/catalog/handoff modules", () => {
  const files = [
    join(__dirname, "../../lib/brain/commercial/native-cycle/customer-session/runtimeIdentityContext.ts"),
    join(__dirname, "../../lib/domains/customer-identity-verification/types.ts"),
    join(__dirname, "../../lib/domains/customer-identity-verification/evaluate.ts"),
    join(__dirname, "../../lib/domains/customer-identity-verification/evaluateEntity.ts"),
    join(__dirname, "../../lib/domains/customer-identity-verification/service.ts")
  ];
  const forbidden = /checkout|quote|shipping|catalog|handoff/i;
  for (const file of files) {
    const specifiers = importSpecifiers(readFileSync(file, "utf8"));
    for (const specifier of specifiers) {
      assert.ok(!forbidden.test(specifier), `${file} must never import a checkout/quote/shipping/catalog/handoff module (found "${specifier}")`);
    }
  }
});

// ---------------------------------------------------------------------------
// RIC21/RIC22: auditability - safe payload, fail-safe writer.
// ---------------------------------------------------------------------------

test("RIC21: the identity_verification_decision_recorded audit event carries policy/level/ids but no PII", async () => {
  const masterA = await makeMasterCustomerId("ric21");
  const conversationId = await makeConversationId("ric21");
  const waId = numericWaId("ric21");
  await linkChannelIdentity("whatsapp", waId, masterA);
  const correlationId = randomUUID();
  const messageId = `wamid-${uniqueSuffix("ric21")}`;

  await recordIdentityEvidence({
    conversationId,
    messageId,
    correlationId,
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

  const runtimeIdentity = await resolveRuntimeIdentityContext({ conversationId, externalId: waId, detail: undefined });
  await recordIdentityVerificationDecision({ messageId, correlationId, conversationId, runtimeIdentity });

  const rows = await queryRows<{ payload_json: string; customer_id: string | null; conversation_id: string | null; correlation_id: string }>(
    `SELECT payload_json, customer_id, conversation_id, correlation_id FROM commercial_event WHERE event_type = 'identity_verification_decision_recorded' AND conversation_id = ? ORDER BY id DESC LIMIT 1`,
    [conversationId]
  );
  assert.equal(rows.length, 1);
  const payload = JSON.parse(rows[0].payload_json) as Record<string, unknown>;
  assert.equal(payload.status, "MASTER_RESOLVED");
  assert.equal(payload.identityLevel, "LEVEL_2_MASTER_RESOLVED");
  assert.equal(payload.policyCode, "EXISTING_CHANNEL_LINK");
  assert.equal(payload.masterCustomerId, masterA);
  assert.equal(rows[0].conversation_id, conversationId);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, new RegExp(waId));
});

test("RIC22: an audit-writer failure never propagates or blocks the caller", async () => {
  // Empty messageId trips buildBaseEvent's own "commercial_event_missing_dedupe_key"
  // guard inside the normalizer - recordIdentityVerificationDecision must
  // still resolve (fail-safe), never reject.
  await assert.doesNotReject(
    recordIdentityVerificationDecision({
      messageId: "",
      correlationId: randomUUID(),
      conversationId: "irrelevant",
      runtimeIdentity: {
        status: "ANONYMOUS",
        identityLevel: "LEVEL_0_ANONYMOUS",
        masterCustomerId: null,
        prestashopCustomerId: null,
        verificationRequired: false,
        requiredEvidence: [],
        readyToLink: false,
        conflictCode: null,
        policyCode: "NO_CHANNEL_EVIDENCE",
        evidenceRefs: []
      }
    })
  );
});

// ---------------------------------------------------------------------------
// RIC23/RIC24: omnichannel independence.
// ---------------------------------------------------------------------------

test("RIC23/RIC24: two providers with separate canonical links resolve independently - an unlinked second provider never inherits the first provider's LEVEL_2", async () => {
  const masterA = await makeMasterCustomerId("ric2324");
  const waConversation = await makeConversationId("ric2324-wa");
  const igConversation = await makeConversationId("ric2324-ig");
  const waId = numericWaId("ric2324");
  const igId = `ig-${uniqueSuffix("ric2324")}`;
  await linkChannelIdentity("whatsapp", waId, masterA);
  // Deliberately no linkChannelIdentity("instagram", igId, ...) call.

  const waContext = await resolveRuntimeIdentityContext({ conversationId: waConversation, externalId: waId, detail: undefined });
  assert.equal(waContext.status, "MASTER_RESOLVED");
  assert.equal(waContext.masterCustomerId, masterA);

  // resolveRuntimeIdentityContext hardcodes provider "whatsapp" (the only
  // adapter that exists today, PARTE 16) - to prove the underlying A04
  // policy is genuinely provider-neutral, call the lower-level service for
  // the second, unlinked provider directly.
  const { evaluateIdentityVerification } = await import("@/lib/domains/customer-identity-verification");
  const igDecision = await evaluateIdentityVerification({ conversationId: igConversation, provider: "instagram", externalId: igId });
  const igContext = mapIdentityVerificationDecisionToRuntimeIdentityContext(igDecision);
  assert.notEqual(igContext.masterCustomerId, masterA);
  assert.notEqual(igContext.identityLevel, "LEVEL_2_MASTER_RESOLVED");

  // Now link Instagram to the SAME master explicitly - both channels
  // independently resolve LEVEL_2 for master A, never a merge/inference.
  await linkChannelIdentity("instagram", igId, masterA);
  const igDecisionAfterLink = await evaluateIdentityVerification({ conversationId: igConversation, provider: "instagram", externalId: igId });
  const igContextAfterLink = mapIdentityVerificationDecisionToRuntimeIdentityContext(igDecisionAfterLink);
  assert.equal(igContextAfterLink.status, "MASTER_RESOLVED");
  assert.equal(igContextAfterLink.masterCustomerId, masterA);
});
