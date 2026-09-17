import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCommercialCapabilityInvocationObservedEvent } from "@/lib/brain/commercial/events/normalize";
import { buildCommercialCapabilityInvocationObservedDedupeKey } from "@/lib/brain/commercial/events/dedupe";
import type { CommercialCapabilityInvocationObservedPayload } from "@/lib/brain/commercial/events/types";

// SALES-AGENT-R3-P7.2. Pure normalizer/dedupe tests - no DB. Mirrors
// tests/commercial/capabilityEligibility.test.ts's own normalizer test
// pattern for the P6.2-A shadow event.

function payload(overrides: Partial<CommercialCapabilityInvocationObservedPayload> = {}): CommercialCapabilityInvocationObservedPayload {
  return {
    schemaVersion: "1",
    capability: "create_quote",
    stepIndex: 0,
    workId: "cw-1",
    workVersion: 3,
    objectiveId: "obj-1",
    objectiveType: "QUOTE",
    eligibilityAtTurnStart: { status: "ELIGIBLE", reasonCodes: [], metadataVersion: "p6.2-a.1" },
    gateway: { status: "completed", errorCode: null, retryable: false },
    toolObservation: { status: "completed", errorCode: null, retryable: null },
    ...overrides
  };
}

test("P7.2: dedupe key is (inboundMessageId, stepIndex, capability) - never just the inbound message id", () => {
  assert.equal(
    buildCommercialCapabilityInvocationObservedDedupeKey("inbound-1", 0, "create_quote"),
    "commercial-capability-invocation-observed:inbound-1:0:create_quote"
  );
});

test("P7.2-H/I: two distinct tool calls in the same turn (different stepIndex) never collide", () => {
  const first = buildCommercialCapabilityInvocationObservedDedupeKey("inbound-1", 0, "search_products");
  const second = buildCommercialCapabilityInvocationObservedDedupeKey("inbound-1", 1, "search_products");
  assert.notEqual(first, second);
});

test("P7.2-J: a retry of the exact same recording collapses onto the same dedupe key", () => {
  const first = buildCommercialCapabilityInvocationObservedDedupeKey("inbound-1", 2, "create_quote");
  const second = buildCommercialCapabilityInvocationObservedDedupeKey("inbound-1", 2, "create_quote");
  assert.equal(first, second);
});

test("P7.2: normalizer produces the real event type and dedupe key from its inputs", () => {
  const event = normalizeCommercialCapabilityInvocationObservedEvent({
    inboundMessageId: "inbound-1",
    stepIndex: 0,
    correlationId: "corr-1",
    conversationId: 1,
    opportunityId: 1,
    payload: payload()
  });
  assert.equal(event.eventType, "commercial_capability_invocation_observed");
  assert.equal(event.dedupeKey, "commercial-capability-invocation-observed:inbound-1:0:create_quote");
  assert.equal(event.sourceEventId, "inbound-1");
});

test("P7.2-F/G: gateway=null is preserved verbatim (never a fabricated Gateway outcome)", () => {
  const event = normalizeCommercialCapabilityInvocationObservedEvent({
    inboundMessageId: "inbound-2",
    stepIndex: 0,
    payload: payload({ gateway: null, eligibilityAtTurnStart: null })
  });
  assert.equal(event.payload.gateway, null);
  assert.equal(event.payload.eligibilityAtTurnStart, null);
});

test("P7.2-K: payload never carries raw arguments/PII - only the allowlisted, bounded keys", () => {
  const event = normalizeCommercialCapabilityInvocationObservedEvent({
    inboundMessageId: "inbound-3",
    stepIndex: 0,
    payload: payload()
  });
  assert.deepEqual(Object.keys(event.payload).sort(), [
    "capability",
    "eligibilityAtTurnStart",
    "gateway",
    "objectiveId",
    "objectiveType",
    "schemaVersion",
    "stepIndex",
    "toolObservation",
    "workId",
    "workVersion"
  ]);
  const eligibility = event.payload.eligibilityAtTurnStart as Record<string, unknown>;
  assert.deepEqual(Object.keys(eligibility).sort(), ["metadataVersion", "reasonCodes", "status"]);
  const gateway = event.payload.gateway as Record<string, unknown>;
  assert.deepEqual(Object.keys(gateway).sort(), ["errorCode", "retryable", "status"]);
  const toolObservation = event.payload.toolObservation as Record<string, unknown>;
  assert.deepEqual(Object.keys(toolObservation).sort(), ["errorCode", "retryable", "status"]);
});

test("P7.2: a missing inboundMessageId throws - fail-open recording relies on the caller catching this", () => {
  assert.throws(() =>
    normalizeCommercialCapabilityInvocationObservedEvent({
      inboundMessageId: "",
      stepIndex: 0,
      payload: payload()
    })
  );
});
