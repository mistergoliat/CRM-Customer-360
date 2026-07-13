import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateCreateCustomerAuthority,
  evaluateCustomerInterestAuthority,
  evaluateLinkExternalIdentityAuthority,
  type CreateCustomerAuthorityInput,
  type CustomerInterestAuthorityInput,
  type LinkExternalIdentityAuthorityInput
} from "@/lib/domains/customer-service/authority-policy";
import { createCustomerServiceClient, type CreateCustomerServiceRequest, type LinkExternalIdentityServiceRequest } from "@/lib/domains/customer-service/service";
import type { CustomerServicePort } from "@/lib/domains/customer-service/ports";
import type { CreateCustomerInput, CreateCustomerResult, CustomerResolutionEvidence, LinkExternalIdentityInput, LinkExternalIdentityResult, ResolveCustomerResult } from "@/lib/domains/customer-service/types";

// ---------------------------------------------------------------------------
// create_customer policy (tests 1-12)
// ---------------------------------------------------------------------------

function evidenceFor(result: ResolveCustomerResult): CustomerResolutionEvidence {
  return { source: "customer_service", requestId: "req-1", checkedAt: "2026-07-09T00:00:00.000Z", result };
}

function baseCreateInput(overrides: Partial<CreateCustomerAuthorityInput> = {}): CreateCustomerAuthorityInput {
  return {
    commercialPurpose: "quote",
    firstName: "Ana",
    lastName: "Perez",
    email: "ana@example.com",
    phoneNumber: "+56912345678",
    consent: { createCustomer: true, messageId: "m1", capturedAt: "2026-07-09T00:00:00.000Z" },
    resolutionEvidence: evidenceFor({ status: "no_match" }),
    ...overrides
  };
}

test("create policy: valid purpose + real no_match + minimal data + consent is allowed", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput());
  assert.deepEqual(decision, { status: "allowed" });
});

test("create policy: rejects when no resolution evidence was provided", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ resolutionEvidence: null }));
  assert.equal(decision.status, "denied");
  assert.equal((decision as { reasonCode: string }).reasonCode, "resolution_evidence_missing");
});

test("create policy: rejects resolved evidence", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ resolutionEvidence: evidenceFor({ status: "resolved", customerMasterId: "cust-9" }) }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "resolution_status_resolved" });
});

test("create policy: rejects conflict evidence", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ resolutionEvidence: evidenceFor({ status: "conflict", conflictCode: "multiple_candidates" }) }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "resolution_status_conflict" });
});

test("create policy: rejects temporarily_unavailable evidence - never treated as no_match", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ resolutionEvidence: evidenceFor({ status: "temporarily_unavailable", retryable: true }) }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "resolution_status_temporarily_unavailable" });
});

test("create policy: rejects invalid_input evidence", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ resolutionEvidence: evidenceFor({ status: "invalid_input", fields: ["externalId"] }) }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "resolution_status_invalid_input" });
});

test("create policy: requires firstName", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ firstName: null }));
  assert.deepEqual(decision, { status: "missing_information", requiredFields: ["firstName"] });
});

test("create policy: requires email", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ email: null }));
  assert.deepEqual(decision, { status: "missing_information", requiredFields: ["email"] });
});

test("create policy: requires phoneNumber", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ phoneNumber: null }));
  assert.deepEqual(decision, { status: "missing_information", requiredFields: ["phoneNumber"] });
});

test("create policy: requires consent.createCustomer", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ consent: { createCustomer: false, messageId: "m1", capturedAt: "2026-07-09T00:00:00.000Z" } }));
  assert.deepEqual(decision, { status: "requires_consent", consentType: "create_customer" });
});

test("create policy: rejects a historical-operation purpose", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ commercialPurpose: "complaint" }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "purpose_not_authorized_for_customer_creation" });
});

test("create policy: rejects saving passive interest as a creation reason", () => {
  const decision = evaluateCreateCustomerAuthority(baseCreateInput({ commercialPurpose: "passive_interest" }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "purpose_not_authorized_for_customer_creation" });
});

// ---------------------------------------------------------------------------
// link_external_identity policy (tests 13-19)
// ---------------------------------------------------------------------------

function baseLinkInput(overrides: Partial<LinkExternalIdentityAuthorityInput> = {}): LinkExternalIdentityAuthorityInput {
  return {
    customerId: "cust-1",
    waId: "56912345678",
    inboundWaId: "56912345678",
    consent: { granted: true, messageId: "m1", capturedAt: "2026-07-09T00:00:00.000Z" },
    knownConflict: null,
    ...overrides
  };
}

test("link policy: allows a resolved customer with consent", () => {
  const decision = evaluateLinkExternalIdentityAuthority(baseLinkInput());
  assert.deepEqual(decision, { status: "allowed" });
});

test("link policy: rejects without customerId", () => {
  const decision = evaluateLinkExternalIdentityAuthority(baseLinkInput({ customerId: null }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "customer_id_required" });
});

test("link policy: rejects without consent", () => {
  const decision = evaluateLinkExternalIdentityAuthority(baseLinkInput({ consent: { granted: false, messageId: "m1", capturedAt: "2026-07-09T00:00:00.000Z" } }));
  assert.deepEqual(decision, { status: "requires_consent", consentType: "link_external_identity" });
});

test("link policy: rejects without messageId", () => {
  const decision = evaluateLinkExternalIdentityAuthority(baseLinkInput({ consent: { granted: true, messageId: null, capturedAt: "2026-07-09T00:00:00.000Z" } }));
  assert.deepEqual(decision, { status: "missing_information", requiredFields: ["messageId"] });
});

test("link policy: rejects without capturedAt", () => {
  const decision = evaluateLinkExternalIdentityAuthority(baseLinkInput({ consent: { granted: true, messageId: "m1", capturedAt: null } }));
  assert.deepEqual(decision, { status: "missing_information", requiredFields: ["capturedAt"] });
});

test("link policy: rejects a wa_id different from the inbound channel", () => {
  const decision = evaluateLinkExternalIdentityAuthority(baseLinkInput({ waId: "56999999999" }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "wa_id_not_controlled_by_channel" });
});

test("link policy: rejects a known conflict", () => {
  const decision = evaluateLinkExternalIdentityAuthority(baseLinkInput({ knownConflict: { conflictCode: "already_linked_to_other_customer" } }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "link_conflict" });
});

// ---------------------------------------------------------------------------
// record_customer_interest policy (tests 20-25)
// ---------------------------------------------------------------------------

function baseInterestInput(overrides: Partial<CustomerInterestAuthorityInput> = {}): CustomerInterestAuthorityInput {
  return {
    requestedTier: "operational_context",
    customerId: null,
    provisionalIdentityId: "prov-1",
    consent: { storeInterest: false, allowFollowUp: false },
    hasKnownConflict: false,
    ...overrides
  };
}

test("interest policy: allows provisional operational context without a customer or consent", () => {
  const decision = evaluateCustomerInterestAuthority(baseInterestInput());
  assert.deepEqual(decision, { status: "allowed" });
});

test("interest policy: never associates to a customer when customerId is absent", () => {
  const decision = evaluateCustomerInterestAuthority(baseInterestInput({ requestedTier: "persistent_customer_interest", customerId: null, consent: { storeInterest: true, allowFollowUp: false } }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "customer_id_required_for_persistent_interest" });
});

test("interest policy: requires separate authorization to persist interest tied to a customer", () => {
  const decision = evaluateCustomerInterestAuthority(baseInterestInput({ requestedTier: "persistent_customer_interest", customerId: "cust-1", consent: { storeInterest: false, allowFollowUp: false } }));
  assert.deepEqual(decision, { status: "requires_consent", consentType: "store_interest" });
});

test("interest policy: requires separate authorization for follow-up even when storage is authorized", () => {
  const decision = evaluateCustomerInterestAuthority(baseInterestInput({ requestedTier: "proactive_followup", customerId: "cust-1", consent: { storeInterest: true, allowFollowUp: false } }));
  assert.deepEqual(decision, { status: "requires_consent", consentType: "allow_follow_up" });
});

test("interest policy: a known conflict keeps the interest provisional only", () => {
  const decision = evaluateCustomerInterestAuthority(baseInterestInput({ requestedTier: "persistent_customer_interest", customerId: "cust-1", consent: { storeInterest: true, allowFollowUp: false }, hasKnownConflict: true }));
  assert.deepEqual(decision, { status: "denied", reasonCode: "resolution_conflict" });
});

test("interest policy: never produces a create_customer instruction, regardless of input shape", () => {
  const inputs: CustomerInterestAuthorityInput[] = [
    baseInterestInput(),
    baseInterestInput({ requestedTier: "persistent_customer_interest", customerId: null, consent: { storeInterest: true, allowFollowUp: true } }),
    baseInterestInput({ requestedTier: "proactive_followup", customerId: "cust-1", consent: { storeInterest: true, allowFollowUp: true } }),
    baseInterestInput({ requestedTier: "persistent_customer_interest", customerId: "cust-1", consent: { storeInterest: true, allowFollowUp: false }, hasKnownConflict: true })
  ];
  for (const input of inputs) {
    const decision = evaluateCustomerInterestAuthority(input);
    assert.ok(["allowed", "missing_information", "denied", "requires_consent", "requires_human"].includes(decision.status));
    assert.doesNotMatch(JSON.stringify(decision), /create_customer/);
  }
});

// ---------------------------------------------------------------------------
// Service layer (tests 26-31)
// ---------------------------------------------------------------------------

type FakePortConfig = {
  resolveCustomer?: CustomerServicePort["resolveCustomer"];
  createCustomer?: CustomerServicePort["createCustomer"];
  linkExternalIdentity?: CustomerServicePort["linkExternalIdentity"];
};

function makeFakePort(config: FakePortConfig = {}) {
  const calls = {
    resolve: [] as unknown[],
    create: [] as CreateCustomerInput[],
    link: [] as LinkExternalIdentityInput[]
  };
  const port: CustomerServicePort = {
    async resolveCustomer(input) {
      calls.resolve.push(input);
      return config.resolveCustomer ? config.resolveCustomer(input) : ({ status: "no_match" } as ResolveCustomerResult);
    },
    async createCustomer(input) {
      calls.create.push(input);
      return config.createCustomer ? config.createCustomer(input) : ({ status: "created", customerMasterId: "new-1" } as CreateCustomerResult);
    },
    async linkExternalIdentity(input) {
      calls.link.push(input);
      return config.linkExternalIdentity ? config.linkExternalIdentity(input) : ({ status: "completed", customerMasterId: "cust-1", externalIdentityId: "ext-1" } as LinkExternalIdentityResult);
    }
  };
  return { port, calls };
}

function baseCreateRequest(overrides: Partial<CreateCustomerServiceRequest> = {}): CreateCustomerServiceRequest {
  return {
    capabilityExecutionId: "exec-1",
    firstName: "Ana",
    lastName: "Perez",
    email: "ana@example.com",
    phoneNumber: "+56912345678",
    origin: { channel: "whatsapp", externalId: "56912345678" },
    commercialPurpose: "quote",
    consent: { createCustomer: true, messageId: "m1", capturedAt: "2026-07-09T00:00:00.000Z" },
    resolutionEvidence: evidenceFor({ status: "no_match" }),
    ...overrides
  };
}

function baseLinkRequest(overrides: Partial<LinkExternalIdentityServiceRequest> = {}): LinkExternalIdentityServiceRequest {
  return {
    capabilityExecutionId: "exec-2",
    customerId: "cust-1",
    externalIdentity: { provider: "whatsapp", externalId: "56912345678", normalizedPhone: "56912345678" },
    inboundWaId: "56912345678",
    consent: { granted: true, messageId: "m1", capturedAt: "2026-07-09T00:00:00.000Z" },
    ...overrides
  };
}

test("service: a policy denial never calls the port", async () => {
  const { port, calls } = makeFakePort();
  const client = createCustomerServiceClient(port);
  const outcome = await client.createCustomer(baseCreateRequest({ commercialPurpose: "complaint" }));
  assert.equal(outcome.stage, "denied_by_policy");
  assert.equal(calls.create.length, 0);
});

test("service: missing_information never calls the port", async () => {
  const { port, calls } = makeFakePort();
  const client = createCustomerServiceClient(port);
  const outcome = await client.createCustomer(baseCreateRequest({ firstName: "" }));
  assert.equal(outcome.stage, "denied_by_policy");
  if (outcome.stage === "denied_by_policy") assert.equal(outcome.decision.status, "missing_information");
  assert.equal(calls.create.length, 0);
});

test("service: create never executes link", async () => {
  const { port, calls } = makeFakePort();
  const client = createCustomerServiceClient(port);
  const outcome = await client.createCustomer(baseCreateRequest());
  assert.equal(outcome.stage, "executed");
  assert.equal(calls.create.length, 1);
  assert.equal(calls.link.length, 0);
});

test("service: link never executes create", async () => {
  const { port, calls } = makeFakePort();
  const client = createCustomerServiceClient(port);
  const outcome = await client.linkExternalIdentity(baseLinkRequest());
  assert.equal(outcome.stage, "executed");
  assert.equal(calls.link.length, 1);
  assert.equal(calls.create.length, 0);
});

test("service: temporarily_unavailable is never converted into no_match", async () => {
  const { port } = makeFakePort({ resolveCustomer: async () => ({ status: "temporarily_unavailable", retryable: true }) });
  const client = createCustomerServiceClient(port);
  const evidence = await client.resolveCustomer({ channel: "whatsapp", externalId: "56912345678" });
  assert.equal(evidence.result.status, "temporarily_unavailable");
});

test("service: the idempotency key is generated by ACS, never taken from agent input", async () => {
  const { port, calls } = makeFakePort();
  const client = createCustomerServiceClient(port);

  const createRequest = { ...baseCreateRequest(), idempotencyKey: "attacker-chosen-key" } as unknown as CreateCustomerServiceRequest;
  await client.createCustomer(createRequest);
  assert.equal(calls.create[0]?.idempotencyKey, "customer-service:create:exec-1");
  assert.notEqual(calls.create[0]?.idempotencyKey, "attacker-chosen-key");

  const linkRequest = { ...baseLinkRequest(), idempotencyKey: "attacker-chosen-key" } as unknown as LinkExternalIdentityServiceRequest;
  await client.linkExternalIdentity(linkRequest);
  assert.equal(calls.link[0]?.idempotencyKey, "customer-service:link:exec-2");
  assert.notEqual(calls.link[0]?.idempotencyKey, "attacker-chosen-key");
});
