import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAgentToolLoopCompletedCommercialEvent } from "@/lib/brain/commercial/events";

/**
 * ACS-R1-05.1-T02.3B. Pure unit tests of the normalizer (no DB) - proves the
 * commercial_event payload shape carries configuration/effective-parameter
 * metadata and never leaks prompt text or secrets, satisfying the audit
 * requirements without needing a live commercial_event table.
 */

const baseInput = {
  inboundMessageId: "msg-1",
  terminalReason: "responded" as const,
  decisionCount: 2,
  toolExecutionCount: 1,
  toolsUsed: ["search_products"],
  finalMessagePresent: true,
  handoffReasonPresent: false,
  stepsSummary: [],
  correlationId: "corr-1",
  conversationId: 42,
  opportunityId: null
};

test("[AE24] records the published configuration's metadata (source, recordId, version, hash)", () => {
  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...baseInput,
    configurationSource: "published",
    configurationRecordId: 7,
    configurationVersion: 3,
    configurationHash: "abc123hash",
    effectiveModel: "deepseek-v4-flash",
    effectiveTemperature: 0.2,
    effectiveMaxOutputSize: 900,
    effectiveTimeoutMs: 25000,
    effectiveMaxAgentStepsPerTurn: 4,
    effectiveMaxToolCallsPerTurn: 3
  });
  assert.equal(event.payload.configurationSource, "published");
  assert.equal(event.payload.configurationRecordId, 7);
  assert.equal(event.payload.configurationVersion, 3);
  assert.equal(event.payload.configurationHash, "abc123hash");
});

test("[AE25] records a default source (deployment_default/safe_default) with null record identity", () => {
  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...baseInput,
    configurationSource: "safe_default",
    configurationRecordId: null,
    configurationVersion: null,
    configurationHash: null,
    effectiveModel: "brain-agent-loop",
    effectiveTemperature: 0,
    effectiveMaxOutputSize: 1024,
    effectiveTimeoutMs: 20000,
    effectiveMaxAgentStepsPerTurn: 3,
    effectiveMaxToolCallsPerTurn: 2
  });
  assert.equal(event.payload.configurationSource, "safe_default");
  assert.equal(event.payload.configurationRecordId, null);
  assert.equal(event.payload.configurationVersion, null);
  assert.equal(event.payload.configurationHash, null);
});

test("[AE26] records the effective (already-clamped) parameters actually used, not just requested ones", () => {
  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...baseInput,
    configurationSource: "published",
    configurationRecordId: 9,
    configurationVersion: 1,
    configurationHash: "h",
    effectiveModel: "deepseek-v4-flash",
    effectiveTemperature: 0.35,
    effectiveMaxOutputSize: 2048,
    effectiveTimeoutMs: 60000,
    effectiveMaxAgentStepsPerTurn: 12,
    effectiveMaxToolCallsPerTurn: 12
  });
  assert.equal(event.payload.effectiveModel, "deepseek-v4-flash");
  assert.equal(event.payload.effectiveTemperature, 0.35);
  assert.equal(event.payload.effectiveMaxOutputSize, 2048);
  assert.equal(event.payload.effectiveTimeoutMs, 60000);
  assert.equal(event.payload.effectiveMaxAgentStepsPerTurn, 12);
  assert.equal(event.payload.effectiveMaxToolCallsPerTurn, 12);
});

test("[AE27] never records the full prompt text, customInstructions, or any secret - only structural metadata", () => {
  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...baseInput,
    configurationSource: "published",
    configurationRecordId: 1,
    configurationVersion: 1,
    configurationHash: "h",
    effectiveModel: "deepseek-v4-flash",
    effectiveTemperature: 0,
    effectiveMaxOutputSize: 512,
    effectiveTimeoutMs: 20000,
    effectiveMaxAgentStepsPerTurn: 3,
    effectiveMaxToolCallsPerTurn: 2
  });
  const serialized = JSON.stringify(event.payload);
  const allowedKeys = new Set([
    "inboundMessageId",
    "terminalReason",
    "decisionCount",
    "toolExecutionCount",
    "toolsUsed",
    "finalMessagePresent",
    "handoffReasonPresent",
    "stepsSummary",
    "configurationSource",
    "configurationRecordId",
    "configurationVersion",
    "configurationHash",
    "effectiveModel",
    "effectiveTemperature",
    "effectiveMaxOutputSize",
    "effectiveTimeoutMs",
    "effectiveMaxAgentStepsPerTurn",
    "effectiveMaxToolCallsPerTurn"
  ]);
  for (const key of Object.keys(event.payload)) {
    assert.ok(allowedKeys.has(key), `unexpected key leaked into the audit payload: ${key}`);
  }
  assert.ok(!serialized.toLowerCase().includes("apikey"));
  assert.ok(!serialized.toLowerCase().includes("api_key"));
  assert.ok(!serialized.toLowerCase().includes("authorization"));
  assert.ok(!serialized.toLowerCase().includes("bearer"));
});

test("[AE28] effectiveMaxOutputSize is recorded as null when no real maxOutputTokens was configured, never an invented number", () => {
  // ACS-R1-05.1-T02.3B (correction). Mirrors EffectiveSalesAgentModelConfiguration:
  // maxOutputTokens stays absent (undefined at the resolver, null once it
  // reaches this JSON-serializable audit payload) rather than defaulting to
  // 1024 for an unconfigured deployment.
  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...baseInput,
    configurationSource: "safe_default",
    configurationRecordId: null,
    configurationVersion: null,
    configurationHash: null,
    effectiveModel: "brain-agent-loop",
    effectiveTemperature: 0,
    effectiveMaxOutputSize: null,
    effectiveTimeoutMs: 20000,
    effectiveMaxAgentStepsPerTurn: 3,
    effectiveMaxToolCallsPerTurn: 2
  });
  assert.equal(event.payload.effectiveMaxOutputSize, null);
});

// LLM provider error observability. Pure normalizer tests mirroring the
// AE24-AE28 pattern above - proves providerFailure reaches payload_json
// verbatim when present, stays fully absent when not, and never carries a
// forbidden key.

const baseEffective = {
  configurationSource: "safe_default" as const,
  configurationRecordId: null,
  configurationVersion: null,
  configurationHash: null,
  effectiveModel: "brain-agent-loop",
  effectiveTemperature: 0,
  effectiveMaxOutputSize: null,
  effectiveTimeoutMs: 20000,
  effectiveMaxAgentStepsPerTurn: 3,
  effectiveMaxToolCallsPerTurn: 2
};

const sampleProviderFailure = {
  provider: "http-agent-loop-provider",
  model: "deepseek-v4-flash",
  attemptCount: 3,
  maxAttempts: 3,
  httpStatus: 429,
  errorCode: "http_429",
  errorClass: "HttpStatusError",
  normalizedReason: "rate_limited" as const,
  retryable: true,
  elapsedMs: 842
};

test("[AE29] providerFailure reaches payload_json verbatim when the loop captured one", () => {
  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...baseInput,
    ...baseEffective,
    terminalReason: "provider_unavailable",
    decisionCount: 0,
    toolExecutionCount: 0,
    finalMessagePresent: false,
    providerFailure: sampleProviderFailure
  });
  assert.deepEqual(event.payload.providerFailure, sampleProviderFailure);
});

test("[AE30] providerFailure is entirely absent from payload_json for a normal (non-failure) terminal outcome - never a stray null key", () => {
  const event = normalizeAgentToolLoopCompletedCommercialEvent({ ...baseInput, ...baseEffective });
  assert.equal("providerFailure" in event.payload, false);
});

test("[AE31] providerFailure never carries a forbidden key (API key, Authorization, secret, ...) - the shared sanitizer still enforces this on the nested object", () => {
  assert.throws(
    () =>
      normalizeAgentToolLoopCompletedCommercialEvent({
        ...baseInput,
        ...baseEffective,
        terminalReason: "provider_unavailable",
        // @ts-expect-error - deliberately injecting a forbidden key to prove the sanitizer still walks into providerFailure
        providerFailure: { ...sampleProviderFailure, apiKey: "sk-should-never-persist" }
      }),
    /commercial_event_forbidden_key/
  );
});

test("[AE32] providerFailure's own keys are exactly the documented contract - no accidental extra field leaks through", () => {
  const event = normalizeAgentToolLoopCompletedCommercialEvent({
    ...baseInput,
    ...baseEffective,
    terminalReason: "provider_unavailable",
    providerFailure: sampleProviderFailure
  });
  const allowedKeys = new Set(["provider", "model", "attemptCount", "maxAttempts", "httpStatus", "errorCode", "errorClass", "normalizedReason", "retryable", "elapsedMs"]);
  const providerFailure = event.payload.providerFailure as Record<string, unknown>;
  for (const key of Object.keys(providerFailure)) {
    assert.ok(allowedKeys.has(key), `unexpected key leaked into providerFailure: ${key}`);
  }
});
