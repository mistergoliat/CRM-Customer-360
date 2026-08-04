import assert from "node:assert/strict";
import test from "node:test";
import {
  computeMasterCustomerIdentityResolution,
  resolveMasterCustomerIdentity,
  validateMasterCustomerId
} from "../../../lib/brain/commercial/identity/master-customer/resolveMasterCustomerIdentity";
import type { CustomerMasterProjectionReader } from "../../../lib/domains/customer-service";
import type { NativeCustomerSessionExecutionContext } from "../../../lib/brain/commercial/native-cycle/customer-session/types";

type Identity = NativeCustomerSessionExecutionContext["identity"];

function identity(overrides: Partial<Identity> = {}): Identity {
  return {
    status: "anonymous",
    customerId: null,
    source: "none",
    localResolutionOutcome: "anonymous",
    externalResolutionOutcome: null,
    ...overrides
  };
}

function fakeReader(exists: boolean | (() => Promise<boolean>) | "throw"): CustomerMasterProjectionReader {
  return {
    async exists() {
      if (exists === "throw") throw new Error("connect ECONNREFUSED 127.0.0.1:3306");
      return typeof exists === "function" ? exists() : exists;
    }
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("validation: 1-digit id is valid", () => {
  assert.deepEqual(validateMasterCustomerId("5"), { ok: true, value: "5" });
});

test("validation: 20-digit id is valid", () => {
  const twentyDigits = "12345678901234567890";
  assert.deepEqual(validateMasterCustomerId(twentyDigits), { ok: true, value: twentyDigits });
});

test("validation: empty string is invalid", () => {
  assert.equal(validateMasterCustomerId("").ok, false);
});

test("validation: whitespace-only is invalid", () => {
  assert.equal(validateMasterCustomerId("   ").ok, false);
});

test("validation: whitespace around a valid id is trimmed and accepted", () => {
  assert.deepEqual(validateMasterCustomerId("  42  "), { ok: true, value: "42" });
});

test("validation: '0' is invalid", () => {
  assert.equal(validateMasterCustomerId("0").ok, false);
});

test("validation: all-zeros ('000') is invalid", () => {
  assert.equal(validateMasterCustomerId("000").ok, false);
});

test("validation: negative number is invalid", () => {
  assert.equal(validateMasterCustomerId("-5").ok, false);
});

test("validation: decimal is invalid", () => {
  assert.equal(validateMasterCustomerId("5.5").ok, false);
});

test("validation: letters are invalid", () => {
  assert.equal(validateMasterCustomerId("abc123").ok, false);
});

test("validation: more than 20 digits is invalid", () => {
  assert.equal(validateMasterCustomerId("123456789012345678901").ok, false);
});

test("validation: leading zeros are rejected (deliberate, stricter than T10B6 - see docs)", () => {
  assert.equal(validateMasterCustomerId("0001").ok, false);
  assert.equal(validateMasterCustomerId("01").ok, false);
});

test("validation: never converts to Number - a value that would lose precision as a Number stays an exact string", () => {
  const beyondSafeInteger = "99999999999999999999".slice(0, 20); // 20 nines, > Number.MAX_SAFE_INTEGER
  const result = validateMasterCustomerId(beyondSafeInteger);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(typeof result.value, "string");
    assert.equal(result.value, beyondSafeInteger);
  }
});

test("validation: the exact BIGINT UNSIGNED contractual maximum (18446744073709551615, 2^64-1) is valid", () => {
  const bigintMax = "18446744073709551615";
  assert.deepEqual(validateMasterCustomerId(bigintMax), { ok: true, value: bigintMax });
});

test("validation: a 21-digit value exceeding the BIGINT UNSIGNED range is invalid", () => {
  assert.equal(validateMasterCustomerId("184467440737095516150").ok, false);
});

// ---------------------------------------------------------------------------
// BIGINT UNSIGNED exact boundary (through the full resolver, not just the
// pure validator) - closure-audit minor fix: the committed suite previously
// only exercised a 20-nines stand-in, never the real contractual maximum.
// ---------------------------------------------------------------------------

test("BIGINT boundary: the exact contractual maximum resolves via a verified native session, preserved byte-for-byte as a string", async () => {
  const bigintMax = "18446744073709551615";
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: bigintMax, source: "customer_service" }) }
  });
  assert.deepEqual(result, { status: "resolved", masterCustomerId: bigintMax, source: "native_session_verified_projection" });
  assert.equal(result.status === "resolved" && typeof result.masterCustomerId, "string");
});

test("BIGINT boundary: the exact contractual maximum resolves via a verified customer-service candidate, preserved byte-for-byte as a string", async () => {
  const bigintMax = "18446744073709551615";
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: bigintMax } }, { projectionReader: fakeReader(true) });
  assert.deepEqual(result, { status: "resolved", masterCustomerId: bigintMax, source: "customer_service_verified" });
  assert.equal(result.status === "resolved" && typeof result.masterCustomerId, "string");
});

test("BIGINT boundary: a 21-digit value exceeding the BIGINT UNSIGNED range is rejected as invalid_master_customer_id via the native session (this resolver's own format re-check)", async () => {
  const overLimit = "184467440737095516150";
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: overLimit, source: "customer_service" }) }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "invalid_master_customer_id" });
});

test("BIGINT boundary: a 21-digit value is rejected as invalid_master_customer_id when the caller already asserts verifiedAgainstProjection (no port call, this resolver's own format re-check applies)", async () => {
  const overLimit = "184467440737095516150";
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: overLimit, verifiedAgainstProjection: true } });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "invalid_master_customer_id" });
});

/**
 * Deliberate, documented asymmetry (see "SQL range clarification" in both
 * docs): an *unverified* `customerServiceIdentity` candidate is never
 * locally range-checked by this resolver - it is forwarded to the reused
 * `verifyCustomerMasterProjection` port exactly as T10B8A's own design
 * requires (no second, duplicated numeric-range rule). A 21-digit value can
 * therefore reach the real projection check; since no real `master_customer`
 * row can ever have a 21-digit id, a realistic reader always reports
 * `not_found` for it - `projection_not_confirmed`, never `invalid_master_customer_id`,
 * and never `resolved` (confirming the earlier BIGINT-max test in this file
 * used a reader that unconditionally returns `true` only to prove the
 * *valid* 20-digit maximum path - never used to claim an out-of-range id
 * would resolve against a real database).
 */
test("BIGINT boundary: a 21-digit unverified customer-service candidate is never locally range-checked - it reaches the projection port as-is, and a realistic reader reports it unconfirmed", async () => {
  const overLimit = "184467440737095516150";
  let queriedWith: string | null = null;
  const realisticReader: CustomerMasterProjectionReader = {
    async exists(customerMasterId) {
      queriedWith = customerMasterId;
      return false; // no real 21-digit master_customer.id can exist
    }
  };
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: overLimit } }, { projectionReader: realisticReader });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "projection_not_confirmed" });
  assert.equal(queriedWith, overLimit);
});

// ---------------------------------------------------------------------------
// Session states (native session path, via the full resolver)
// ---------------------------------------------------------------------------

test("session state: anonymous -> identity_unresolved/identity_absent", async () => {
  const result = await resolveMasterCustomerIdentity({ nativeCustomerSession: { identity: identity({ status: "anonymous" }) } });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_absent" });
});

test("session state: identification_required -> identity_unresolved/identity_not_verified", async () => {
  const result = await resolveMasterCustomerIdentity({ nativeCustomerSession: { identity: identity({ status: "identification_required" }) } });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_not_verified" });
});

test("session state: conflict -> identity_unresolved/identity_conflict", async () => {
  const result = await resolveMasterCustomerIdentity({ nativeCustomerSession: { identity: identity({ status: "conflict" }) } });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_conflict" });
});

test("session state: temporarily_unavailable -> identity_unresolved/identity_temporarily_unavailable", async () => {
  const result = await resolveMasterCustomerIdentity({ nativeCustomerSession: { identity: identity({ status: "temporarily_unavailable" }) } });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_temporarily_unavailable" });
});

test("session state: identified without provenance (source=external_identity) -> identity_unresolved/identity_source_unsupported", async () => {
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "external_identity" }) }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_source_unsupported" });
});

test("session state: identified without provenance (source=normalized_phone) -> identity_unresolved/identity_source_unsupported", async () => {
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "normalized_phone" }) }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_source_unsupported" });
});

test("session state: identified without provenance (source=onboarding_state) -> identity_unresolved/identity_source_unsupported", async () => {
  // onboarding_state can be populated from an unverified local match too - never treated as verified.
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "onboarding_state" }) }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_source_unsupported" });
});

test("session state: identified without provenance (source=customer_created) -> identity_unresolved/identity_source_unsupported", async () => {
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "customer_created" }) }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_source_unsupported" });
});

test("session state: identified with provenance (source=customer_service) -> resolved", async () => {
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "customer_service" }) }
  });
  assert.deepEqual(result, { status: "resolved", masterCustomerId: "700", source: "native_session_verified_projection" });
});

test("session state: identified with provenance but a malformed customerId -> identity_unresolved/invalid_master_customer_id", async () => {
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: "007", source: "customer_service" }) }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "invalid_master_customer_id" });
});

test("session state: identified but customerId null (defensive) -> identity_unresolved/identity_absent", async () => {
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: null, source: "customer_service" }) }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_absent" });
});

test("session state: conflict is never resolved even if a customerId happens to be present", async () => {
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "conflict", customerId: "700", source: "customer_service" }) }
  });
  assert.equal(result.status, "identity_unresolved");
  if (result.status === "identity_unresolved") assert.equal(result.reason, "identity_conflict");
});

// ---------------------------------------------------------------------------
// Customer Service candidate path
// ---------------------------------------------------------------------------

test("customer service: valid id + projection exists -> resolved", async () => {
  const result = await resolveMasterCustomerIdentity(
    { customerServiceIdentity: { customerMasterId: "42" } },
    { projectionReader: fakeReader(true) }
  );
  assert.deepEqual(result, { status: "resolved", masterCustomerId: "42", source: "customer_service_verified" });
});

test("customer service: valid id + projection not found -> identity_unresolved/projection_not_confirmed", async () => {
  const result = await resolveMasterCustomerIdentity(
    { customerServiceIdentity: { customerMasterId: "42" } },
    { projectionReader: fakeReader(false) }
  );
  assert.deepEqual(result, { status: "identity_unresolved", reason: "projection_not_confirmed" });
});

test("customer service: valid id + projection check fails (throws) -> identity_unresolved/identity_temporarily_unavailable", async () => {
  const result = await resolveMasterCustomerIdentity(
    { customerServiceIdentity: { customerMasterId: "42" } },
    { projectionReader: fakeReader("throw") }
  );
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_temporarily_unavailable" });
});

test("customer service: invalid id format -> identity_unresolved/invalid_master_customer_id (port never called)", async () => {
  let called = false;
  const reader = fakeReader(async () => {
    called = true;
    return true;
  });
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: "not-a-number" } }, { projectionReader: reader });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "invalid_master_customer_id" });
  assert.equal(called, false);
});

test("customer service: no id supplied -> identity_unresolved/identity_absent", async () => {
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: null } });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_absent" });
});

test("customer service: verifiedAgainstProjection=true trusts the caller and never calls the port", async () => {
  let called = false;
  const reader = fakeReader(async () => {
    called = true;
    return true;
  });
  const result = await resolveMasterCustomerIdentity(
    { customerServiceIdentity: { customerMasterId: "42", verifiedAgainstProjection: true } },
    { projectionReader: reader }
  );
  assert.deepEqual(result, { status: "resolved", masterCustomerId: "42", source: "customer_service_verified" });
  assert.equal(called, false);
});

test("customer service: verifiedAgainstProjection=true still re-validates format independently", async () => {
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: "007", verifiedAgainstProjection: true } });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "invalid_master_customer_id" });
});

// ---------------------------------------------------------------------------
// No evidence at all
// ---------------------------------------------------------------------------

test("no evidence at all -> identity_unresolved/identity_absent", async () => {
  const result = await resolveMasterCustomerIdentity({});
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_absent" });
});

// ---------------------------------------------------------------------------
// Multiple sources / conflicts (pure core, exhaustively)
// ---------------------------------------------------------------------------

test("multiple sources: both verified and equal -> resolved", () => {
  const result = computeMasterCustomerIdentityResolution({
    nativeSession: { verified: true, masterCustomerId: "42" },
    customerService: { verified: true, masterCustomerId: "42" }
  });
  assert.deepEqual(result, { status: "resolved", masterCustomerId: "42", source: "native_session_verified_projection" });
});

test("multiple sources: both verified and different -> identity_unresolved/identity_conflict", () => {
  const result = computeMasterCustomerIdentityResolution({
    nativeSession: { verified: true, masterCustomerId: "42" },
    customerService: { verified: true, masterCustomerId: "99" }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_conflict" });
});

test("multiple sources: native verified, customer service not contractual -> uses the verified native source", () => {
  const result = computeMasterCustomerIdentityResolution({
    nativeSession: { verified: true, masterCustomerId: "42" },
    customerService: { verified: false, reason: "invalid_master_customer_id" }
  });
  assert.deepEqual(result, { status: "resolved", masterCustomerId: "42", source: "native_session_verified_projection" });
});

test("multiple sources: customer service verified, native not contractual -> uses the verified customer-service source", () => {
  const result = computeMasterCustomerIdentityResolution({
    nativeSession: { verified: false, reason: "identity_source_unsupported" },
    customerService: { verified: true, masterCustomerId: "42" }
  });
  assert.deepEqual(result, { status: "resolved", masterCustomerId: "42", source: "customer_service_verified" });
});

test("multiple sources: neither verified -> identity_unresolved, prefers the native session's own reason", () => {
  const result = computeMasterCustomerIdentityResolution({
    nativeSession: { verified: false, reason: "identity_conflict" },
    customerService: { verified: false, reason: "invalid_master_customer_id" }
  });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_conflict" });
});

test("multiple sources: neither present -> identity_unresolved/identity_absent", () => {
  const result = computeMasterCustomerIdentityResolution({ nativeSession: null, customerService: null });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_absent" });
});

// ---------------------------------------------------------------------------
// Effects: no external calls, no mutation, verification at most once, no ID leaks
// ---------------------------------------------------------------------------

test("effects: resolver never calls Customer Profile or Catalog Service (no fetch, no such import)", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCalled = true;
    return originalFetch(...args);
  }) as typeof fetch;
  try {
    await resolveMasterCustomerIdentity(
      { nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "customer_service" }) } },
      { projectionReader: fakeReader(true) }
    );
    await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: "42" } }, { projectionReader: fakeReader(true) });
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("effects: does not mutate its input", async () => {
  const input = Object.freeze({
    nativeCustomerSession: Object.freeze({ identity: Object.freeze(identity({ status: "identified", customerId: "700", source: "customer_service" })) }),
    customerServiceIdentity: Object.freeze({ customerMasterId: "700", verifiedAgainstProjection: true })
  });
  const result = await resolveMasterCustomerIdentity(input);
  assert.equal(result.status, "resolved");
});

test("effects: projection verification happens at most once per call, even with both sources needing a check", async () => {
  let callCount = 0;
  const reader = fakeReader(async () => {
    callCount += 1;
    return true;
  });
  // Native session path never queries the port (source=customer_service is already verified upstream);
  // only the customerServiceIdentity path (unverified) queries it - exactly once.
  await resolveMasterCustomerIdentity(
    {
      nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "customer_service" }) },
      customerServiceIdentity: { customerMasterId: "700" }
    },
    { projectionReader: reader }
  );
  assert.equal(callCount, 1);
});

test("effects: no error path or result ever carries an id when unresolved", async () => {
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: "42" } }, { projectionReader: fakeReader(false) });
  assert.equal(result.status, "identity_unresolved");
  assert.equal(JSON.stringify(result).includes("42"), false);
});

// ---------------------------------------------------------------------------
// Non-blocking behavior (closure-audit follow-up). masterCustomerId
// resolution is a personalization/context enhancement, never a gate: every
// `identity_unresolved` reason must resolve the returned promise normally
// (never reject/throw) and must produce a minimal, structurally ID-free
// result - a caller can safely treat it as "omit personalization, continue
// in generic mode" without any special-casing. See "Non-blocking identity
// resolution" in docs/integrations/master-customer-identity-resolution.md.
// ---------------------------------------------------------------------------

const ALL_UNRESOLVED_REASON_SCENARIOS: Array<{ name: string; input: Parameters<typeof resolveMasterCustomerIdentity>[0]; reason: string }> = [
  { name: "anonymous session", input: { nativeCustomerSession: { identity: identity({ status: "anonymous" }) } }, reason: "identity_absent" },
  { name: "identification_required session", input: { nativeCustomerSession: { identity: identity({ status: "identification_required" }) } }, reason: "identity_not_verified" },
  {
    name: "unsupported source (external_identity)",
    input: { nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "external_identity" }) } },
    reason: "identity_source_unsupported"
  },
  { name: "conflict session", input: { nativeCustomerSession: { identity: identity({ status: "conflict" }) } }, reason: "identity_conflict" },
  { name: "temporarily_unavailable session", input: { nativeCustomerSession: { identity: identity({ status: "temporarily_unavailable" }) } }, reason: "identity_temporarily_unavailable" },
  { name: "malformed candidate id", input: { customerServiceIdentity: { customerMasterId: "not-an-id" } }, reason: "invalid_master_customer_id" },
  { name: "no evidence at all", input: {}, reason: "identity_absent" }
];

for (const scenario of ALL_UNRESOLVED_REASON_SCENARIOS) {
  test(`non-blocking: ${scenario.name} resolves the promise normally (never rejects) and yields a minimal, ID-free result`, async () => {
    const result = await resolveMasterCustomerIdentity(scenario.input, { projectionReader: fakeReader(false) });
    assert.equal(result.status, "identity_unresolved");
    if (result.status !== "identity_unresolved") return;
    assert.equal(result.reason, scenario.reason);
    // Exactly {status, reason} - no extra field could carry a candidate id,
    // a conflict detail, or any other leaked evidence.
    assert.deepEqual(Object.keys(result).sort(), ["reason", "status"]);
  });
}

test("non-blocking: projection_not_confirmed (a well-formed but nonexistent candidate) resolves normally, never as a fatal/technical error", async () => {
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: "42" } }, { projectionReader: fakeReader(false) });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "projection_not_confirmed" });
});

test("non-blocking: a projection check failure (technical unavailability) resolves normally, distinct from a confirmed not-found", async () => {
  const result = await resolveMasterCustomerIdentity({ customerServiceIdentity: { customerMasterId: "42" } }, { projectionReader: fakeReader("throw") });
  assert.deepEqual(result, { status: "identity_unresolved", reason: "identity_temporarily_unavailable" });
});

test("non-blocking: a resolved outcome carries exactly {status, masterCustomerId, source} - never more, never less", async () => {
  const result = await resolveMasterCustomerIdentity({
    nativeCustomerSession: { identity: identity({ status: "identified", customerId: "700", source: "customer_service" }) }
  });
  assert.equal(result.status, "resolved");
  assert.deepEqual(Object.keys(result).sort(), ["masterCustomerId", "source", "status"]);
});
