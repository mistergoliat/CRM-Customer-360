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
