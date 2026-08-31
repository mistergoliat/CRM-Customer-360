import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "@/lib/db";
import { ensureCommercialActionOpportunity } from "@/lib/brain/commercial/commercial-action-request/ensureCommercialActionOpportunity";
import type { NativeCustomerSessionExecutionContext } from "@/lib/brain/commercial/native-cycle/customer-session";

/**
 * SALES-AGENT-R3-V1.2. Unit-level tests of the one shared seam that ensures a
 * durable opportunity anchor before a CommercialActionRequest is built.
 * Mirrors tests/commercial/resolveRuntimeOpportunity.test.ts's real-MariaDB
 * pattern (crm_test) - this seam adds only identity-context extraction and an
 * "already resolved" short-circuit on top of that already-proven resolver, so
 * these tests focus on exactly that, not re-proving R3-V1.1's own invariants
 * (active reuse, terminal exclusion, idempotency, concurrency - already
 * covered there and reused unchanged here).
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

const NOW = "2026-08-31T12:00:00.000Z";

after(async () => {
  try {
    await getPool().end();
  } catch {
    // ignore teardown failures
  }
});

let conversationSeq = Date.now();
function nextConversationId() {
  conversationSeq += 1;
  return conversationSeq;
}

async function countOpportunitiesForConversation(conversationId: number) {
  const [rows] = await getPool().execute("SELECT id FROM crm_opportunities WHERE conversation_case_id = ?", [String(conversationId)]);
  return (rows as unknown[]).length;
}

function sessionWithMasterCustomer(masterCustomerId: string | null): NativeCustomerSessionExecutionContext {
  return {
    conversationId: "conv-1",
    opportunityId: null,
    trustedInbound: { channel: "whatsapp", externalId: "56999998888", normalizedPhone: "56999998888", messageId: "wamid.1", receivedAt: NOW },
    identity: { status: "identified", customerId: "cust-1", source: "customer_service", localResolutionOutcome: "resolved", externalResolutionOutcome: "matched" },
    masterCustomerIdentity:
      masterCustomerId === null
        ? { status: "identity_unresolved", reason: "identity_source_unsupported" }
        : { status: "resolved", masterCustomerId, source: "customer_service_verified" },
    runtimeIdentity: {
      status: "MASTER_RESOLVED",
      identityLevel: "LEVEL_2_MASTER_RESOLVED",
      masterCustomerId,
      prestashopCustomerId: null,
      verificationRequired: false,
      requiredEvidence: [],
      readyToLink: false,
      conflictCode: null,
      policyCode: "NO_CHANNEL_EVIDENCE",
      evidenceRefs: []
    },
    onboarding: null,
    contextAccess: "validated_entity",
    currentTurnConsent: { createCustomer: null, linkExternalIdentity: null, linkPrestashopIdentity: null },
    freshExternalResolutionEvidence: null
  };
}

test("existing opportunityId is reused as-is, no new row created", async () => {
  const conversationId = nextConversationId();
  const result = await ensureCommercialActionOpportunity({
    conversationId,
    existingOpportunityId: 555,
    trustedCustomerSession: null,
    correlationId: `corr-${conversationId}`,
    currentTime: NOW
  });
  assert.deepEqual(result, { ok: true, opportunityId: 555, source: "existing" });
  assert.equal(await countOpportunitiesForConversation(conversationId), 0, "reusing an existing id must never touch crm_opportunities for this conversation");
});

test("missing opportunityId with no session: resolves/creates via resolveRuntimeOpportunity, channel defaults to whatsapp", async () => {
  const conversationId = nextConversationId();
  const result = await ensureCommercialActionOpportunity({
    conversationId,
    existingOpportunityId: null,
    trustedCustomerSession: null,
    correlationId: `corr-${conversationId}`,
    currentTime: NOW
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "resolved");
  assert.equal(await countOpportunitiesForConversation(conversationId), 1);

  const [rows] = await getPool().execute("SELECT channel, customer_master_id, wa_id FROM crm_opportunities WHERE id = ?", [result.opportunityId]);
  const row = (rows as Array<Record<string, unknown>>)[0];
  assert.equal(row.channel, "whatsapp");
  assert.equal(row.customer_master_id, null);
  assert.equal(row.wa_id, null);
});

test("missing opportunityId with a resolved masterCustomerIdentity: customerMasterId propagates onto the created row", async () => {
  const conversationId = nextConversationId();
  const result = await ensureCommercialActionOpportunity({
    conversationId,
    existingOpportunityId: null,
    trustedCustomerSession: sessionWithMasterCustomer("4242"),
    correlationId: `corr-${conversationId}`,
    currentTime: NOW
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const [rows] = await getPool().execute("SELECT customer_master_id, wa_id, channel FROM crm_opportunities WHERE id = ?", [result.opportunityId]);
  const row = (rows as Array<Record<string, unknown>>)[0];
  assert.equal(Number(row.customer_master_id), 4242);
  assert.equal(row.wa_id, "56999998888");
  assert.equal(row.channel, "whatsapp");
});

test("missing opportunityId with an unresolved masterCustomerIdentity: customerMasterId stays null, waId still propagates", async () => {
  const conversationId = nextConversationId();
  const result = await ensureCommercialActionOpportunity({
    conversationId,
    existingOpportunityId: null,
    trustedCustomerSession: sessionWithMasterCustomer(null),
    correlationId: `corr-${conversationId}`,
    currentTime: NOW
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const [rows] = await getPool().execute("SELECT customer_master_id, wa_id FROM crm_opportunities WHERE id = ?", [result.opportunityId]);
  const row = (rows as Array<Record<string, unknown>>)[0];
  assert.equal(row.customer_master_id, null);
  assert.equal(row.wa_id, "56999998888");
});

test("null conversationId: fails safely without ever calling the resolver (no DB write, no silent null opportunityId)", async () => {
  const result = await ensureCommercialActionOpportunity({
    conversationId: null,
    existingOpportunityId: null,
    trustedCustomerSession: null,
    correlationId: "corr-null-conversation",
    currentTime: NOW
  });
  assert.deepEqual(result, { ok: false, reason: "conversation_unavailable" });
});

test("a terminal prior opportunity is not reused - a new one is resolved instead", async () => {
  const conversationId = nextConversationId();
  const first = await ensureCommercialActionOpportunity({
    conversationId,
    existingOpportunityId: null,
    trustedCustomerSession: null,
    correlationId: `corr-${conversationId}-1`,
    currentTime: NOW
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  await getPool().execute("UPDATE crm_opportunities SET status = 'lost', updated_at = NOW() WHERE id = ?", [first.opportunityId]);

  const second = await ensureCommercialActionOpportunity({
    conversationId,
    existingOpportunityId: null,
    trustedCustomerSession: null,
    correlationId: `corr-${conversationId}-2`,
    currentTime: NOW
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.notEqual(second.opportunityId, first.opportunityId);
  assert.equal(await countOpportunitiesForConversation(conversationId), 2);
});

test("concurrent calls for the same conversation converge on a single opportunity", async () => {
  const conversationId = nextConversationId();
  const input = {
    conversationId,
    existingOpportunityId: null,
    trustedCustomerSession: null,
    correlationId: `corr-${conversationId}`,
    currentTime: NOW
  };

  const results = await Promise.all([
    ensureCommercialActionOpportunity(input),
    ensureCommercialActionOpportunity(input),
    ensureCommercialActionOpportunity(input),
    ensureCommercialActionOpportunity(input)
  ]);

  for (const result of results) assert.equal(result.ok, true);
  const ids = new Set(results.map((result) => (result.ok ? result.opportunityId : null)));
  assert.equal(ids.size, 1, "all concurrent calls must agree on a single opportunityId");
  assert.equal(await countOpportunitiesForConversation(conversationId), 1);
});
