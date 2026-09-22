import assert from "node:assert/strict";
import test from "node:test";
import { extractProviderVisibleCommercialContext } from "@/lib/brain/commercial/agent-loop/benchmark/r3ContinuityAudit/toolSurfaceHash";
import type { BenchmarkProviderCallRecord } from "@/lib/brain/commercial/agent-loop/benchmark/types";

/**
 * P7.13-A section 6. Fixtures are minimized versions of REAL shapes verified
 * against the code, never guessed:
 *  - harness-aligned: buildHarnessAlignedMessages/buildDynamicContextMessage
 *    (harnessAlignedMessageProjection.ts) - a role:"system" message prefixed
 *    with the exact literal RUNTIME_CONTEXT_LABEL, carrying
 *    {..., commercialContext, ...} as JSON after that prefix.
 *  - legacy: buildAgentStepPromptPackage.ts's persistent/legacy branches - a
 *    role:"user" message whose content is JSON.stringify(currentTurnPayload),
 *    which itself has a `commercialContext` field.
 * Finalization-phase fixtures mirror the same message shapes (harness-aligned
 * mode does not change message structure by phase - only systemInstructions
 * text does, which this extractor never reads).
 */

const RUNTIME_CONTEXT_LABEL = "RUNTIME CONTEXT (system-provided, not authored by the customer): ";

function call(requestMessages: BenchmarkProviderCallRecord["requestMessages"]): BenchmarkProviderCallRecord {
  return {
    caseId: "fixture",
    runIndex: 0,
    callIndex: 0,
    elapsedMs: 1,
    outcome: "success",
    errorCode: null,
    finishReason: "stop",
    inputTokens: 100,
    outputTokens: 10,
    reasoningTokens: null,
    providerRequestId: null,
    model: "deepseek-v4-flash",
    requestMessages
  };
}

test("P7.13-A extractor: legacy valid (commercialContext in last user message)", () => {
  const result = extractProviderVisibleCommercialContext([
    call([
      { role: "system", content: "You are a sales agent..." },
      { role: "user", content: JSON.stringify({ currentTime: "t", customerMessage: "hola", commercialContext: { opportunityStatus: "open" }, question: "?" }) }
    ])
  ]);
  assert.equal(result.source, "legacy_user");
  assert.equal(result.parseStatus, "ok");
  assert.deepEqual(result.commercialContextJson, { opportunityStatus: "open" });
});

test("P7.13-A extractor: harness-aligned valid (commercialContext in the labeled runtime-context system message)", () => {
  const result = extractProviderVisibleCommercialContext([
    call([
      { role: "system", content: "You are a sales agent..." },
      { role: "system", content: RUNTIME_CONTEXT_LABEL + JSON.stringify({ currentTime: "t", commercialContext: { opportunityStatus: "open" }, conversationContinuity: {} }) },
      { role: "user", content: "hola" }
    ])
  ]);
  assert.equal(result.source, "harness_aligned_system");
  assert.equal(result.parseStatus, "ok");
  assert.deepEqual(result.commercialContextJson, { opportunityStatus: "open" });
});

test("P7.13-A extractor: multiple system messages - picks the labeled runtime-context one, never 'first' or 'last'", () => {
  const result = extractProviderVisibleCommercialContext([
    call([
      { role: "system", content: "You are a sales agent..." },
      { role: "system", content: RUNTIME_CONTEXT_LABEL + JSON.stringify({ commercialContext: { commercialLineItems: [{ productId: "31" }] } }) },
      // A compacted-prefix system message from persistentSessionHistoricalMessages, unrelated to runtime context.
      { role: "system", content: "Summary of earlier conversation: the customer asked about barbells." },
      { role: "assistant", content: JSON.stringify({ type: "use_tool", tool: "search_products", arguments: {} }) },
      { role: "user", content: "[TOOL RESULT: search_products] {}" }
    ])
  ]);
  assert.equal(result.source, "harness_aligned_system");
  assert.deepEqual(result.commercialContextJson, { commercialLineItems: [{ productId: "31" }] });
});

test("P7.13-A extractor: malformed runtime context (invalid JSON after the label) is reported, not silently null-with-ok", () => {
  const result = extractProviderVisibleCommercialContext([
    call([
      { role: "system", content: "You are a sales agent..." },
      { role: "system", content: `${RUNTIME_CONTEXT_LABEL}{not valid json` }
    ])
  ]);
  assert.equal(result.source, "harness_aligned_system");
  assert.equal(result.parseStatus, "malformed");
  assert.equal(result.commercialContextJson, null);
});

test("P7.13-A extractor: runtime context present but missing the commercialContext field is malformed, not a false 'ok'", () => {
  const result = extractProviderVisibleCommercialContext([
    call([{ role: "system", content: RUNTIME_CONTEXT_LABEL + JSON.stringify({ currentTime: "t", conversationContinuity: {} }) }])
  ]);
  assert.equal(result.source, "harness_aligned_system");
  assert.equal(result.parseStatus, "malformed");
});

test("P7.13-A extractor: context absent (no requestMessages captured at all)", () => {
  const result = extractProviderVisibleCommercialContext([]);
  assert.equal(result.source, "not_found");
  assert.equal(result.parseStatus, "absent");
  assert.equal(result.commercialContextJson, null);
});

test("P7.13-A extractor: unrelated JSON in the last user message (no commercialContext field) never false-positives", () => {
  const result = extractProviderVisibleCommercialContext([call([{ role: "user", content: JSON.stringify({ foo: "bar" }) }])]);
  assert.equal(result.source, "legacy_user");
  assert.equal(result.parseStatus, "malformed");
  assert.equal(result.commercialContextJson, null);
});

test("P7.13-A extractor: gathering-phase request (harness-aligned) extracts the same as finalization-phase", () => {
  const gathering = extractProviderVisibleCommercialContext([
    call([
      { role: "system", content: "Layer 1: loop contract. Use a tool as soon as you have enough information..." },
      { role: "system", content: RUNTIME_CONTEXT_LABEL + JSON.stringify({ commercialContext: { opportunityStatus: "open" } }) },
      { role: "user", content: "Dale, 1 de la Classic entonces" }
    ])
  ]);
  const finalization = extractProviderVisibleCommercialContext([
    call([
      { role: "system", content: "This turn's tool budget is spent - no more tools are available." },
      { role: "system", content: RUNTIME_CONTEXT_LABEL + JSON.stringify({ commercialContext: { opportunityStatus: "open" } }) },
      { role: "assistant", content: JSON.stringify({ type: "use_tool", tool: "get_product_details", arguments: { productId: "31" } }) },
      { role: "user", content: "[TOOL RESULT: get_product_details] {}" }
    ])
  ]);
  assert.deepEqual(gathering.commercialContextJson, { opportunityStatus: "open" });
  assert.deepEqual(finalization.commercialContextJson, { opportunityStatus: "open" });
  assert.equal(gathering.source, "harness_aligned_system");
  assert.equal(finalization.source, "harness_aligned_system");
});

test("P7.13-A extractor: no provider calls captured at all returns not_found, never throws", () => {
  assert.doesNotThrow(() => extractProviderVisibleCommercialContext([call(undefined)]));
  const result = extractProviderVisibleCommercialContext([call(undefined)]);
  assert.equal(result.source, "not_found");
});
