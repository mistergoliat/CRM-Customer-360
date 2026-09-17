import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentLoopGatewayContext } from "@/lib/brain/commercial/agent-loop/runAgentToolLoop";

// SALES-AGENT-R3-P7.1 (Trusted Execution Context). Pure unit tests for
// buildAgentLoopGatewayContext - the exact gatewayContext construction
// runAgentToolLoop uses for every capability invocation this turn. No DB, no
// HTTP, no LLM: this function's only input is RunAgentToolLoopInput's own
// runtime-supplied fields, so every case here is deterministic and instant.

const BASE = {
  correlationId: "corr-1",
  conversationId: 1,
  opportunityId: null,
  trustedCustomerSession: null
};

test("P7.1-F: absent work/objective fields default to null - preserves the exact pre-P7.1 gatewayContext shape otherwise", () => {
  const result = buildAgentLoopGatewayContext(BASE);
  assert.deepEqual(result, {
    correlationId: "corr-1",
    conversationId: 1,
    opportunityId: null,
    trustedCustomerSession: null,
    workId: null,
    workVersion: null,
    objectiveId: null,
    objectiveType: null
  });
});

test("P7.1-C: workId/workVersion/objectiveId/objectiveType are carried through unchanged onto gatewayContext", () => {
  const result = buildAgentLoopGatewayContext({
    ...BASE,
    workId: "cw-1",
    workVersion: 4,
    objectiveId: "objective-quote-1",
    objectiveType: "QUOTE"
  });
  assert.equal(result.workId, "cw-1");
  assert.equal(result.workVersion, 4);
  assert.equal(result.objectiveId, "objective-quote-1");
  assert.equal(result.objectiveType, "QUOTE");
  // Existing fields untouched by this addition.
  assert.equal(result.correlationId, "corr-1");
  assert.equal(result.conversationId, 1);
});

test("P7.1-E: work present, objective explicitly null - never coerced to a sentinel string", () => {
  const result = buildAgentLoopGatewayContext({ ...BASE, workId: "cw-2", workVersion: 1, objectiveId: null, objectiveType: null });
  assert.equal(result.workId, "cw-2");
  assert.equal(result.workVersion, 1);
  assert.equal(result.objectiveId, null);
  assert.equal(result.objectiveType, null);
});

test("P7.1-A/B/L: the function's parameter type has no slot for model-supplied data - extra properties never leak into gatewayContext", () => {
  // Structural proof: buildAgentLoopGatewayContext's parameter type is
  // Pick<RunAgentToolLoopInput, "correlationId" | "conversationId" |
  // "opportunityId" | "trustedCustomerSession" | "workId" | "workVersion" |
  // "objectiveId" | "objectiveType"> - there is no `arguments`/AgentStepUseTool
  // field for a model-controlled workId/objectiveId to travel through. This
  // documents that even if a caller mistakenly merged raw step.arguments
  // alongside the runtime fields, only the known runtime keys are read.
  const spoofAttempt = {
    ...BASE,
    workId: "cw-real",
    objectiveId: "objective-real",
    // Not part of the function's parameter type - simulates a caller
    // accidentally spreading model-controlled arguments alongside runtime input.
    arguments: { workId: "fake-spoofed-work-id", objectiveId: "fake-spoofed-objective-id" }
  };

  const result = buildAgentLoopGatewayContext(spoofAttempt);
  assert.equal(result.workId, "cw-real");
  assert.equal(result.objectiveId, "objective-real");
  assert.deepEqual(Object.keys(result).sort(), [
    "conversationId",
    "correlationId",
    "objectiveId",
    "objectiveType",
    "opportunityId",
    "trustedCustomerSession",
    "workId",
    "workVersion"
  ]);
});
