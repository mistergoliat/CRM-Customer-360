import assert from "node:assert/strict";
import test from "node:test";
import { buildLlmCallsSummary, buildLlmMetrics } from "@/lib/brain/commercial/agent-loop";
import type { AgentLoopInferenceRecord, AgentLoopResult } from "@/lib/brain/commercial/agent-loop";
import { normalizeAgentToolLoopCompletedCommercialEvent } from "@/lib/brain/commercial/events";

/**
 * LLM-R1-T02. Pure unit tests (no DB, no fetch) of the turn-level LLM rollup
 * (buildLlmMetrics/buildLlmCallsSummary, runNativeAgentToolLoopCycle.ts) and
 * of normalizeAgentToolLoopCompletedCommercialEvent's llmMetrics wiring -
 * same DB-free pattern as tests/agent-loop/recommendCatalogProductsSkippedEventPersistence.test.ts.
 */

function call(overrides: Partial<AgentLoopInferenceRecord> = {}): AgentLoopInferenceRecord {
  return {
    phase: "gathering",
    attempt: 0,
    decisionIndex: 0,
    elapsedMs: 1000,
    model: "deepseek-v4-flash",
    providerRequestId: "req-1",
    finishReason: "stop",
    inputTokens: 100,
    outputTokens: 20,
    outcome: "success",
    ...overrides
  };
}

function loopWithCalls(llmCalls: AgentLoopInferenceRecord[]): AgentLoopResult {
  return {
    ran: true,
    terminalReason: "responded",
    steps: [],
    toolExecutionCount: 0,
    finalMessage: "listo",
    handoffReason: null,
    warnings: [],
    finalPendingCatalogAction: null,
    llmCalls
  };
}

const eventBaseInput = {
  inboundMessageId: "msg-llm-metrics-1",
  terminalReason: "responded" as const,
  decisionCount: 1,
  toolExecutionCount: 0,
  toolsUsed: [],
  finalMessagePresent: true,
  handoffReasonPresent: false,
  stepsSummary: [],
  configurationSource: "safe_default" as const,
  configurationRecordId: null,
  configurationVersion: null,
  configurationHash: null,
  effectiveModel: "brain-agent-loop",
  effectiveTemperature: 0,
  effectiveMaxOutputSize: null,
  effectiveTimeoutMs: 20000,
  effectiveMaxAgentStepsPerTurn: 3,
  effectiveMaxToolCallsPerTurn: 2,
  correlationId: "corr-llm-metrics-1",
  conversationId: 1,
  opportunityId: null
};

// --- Caso 7: aggregate metrics ---

test("[LLM-R1-T02 Caso 7] aggregate metrics: callCount/totalElapsedMs/inputSize/outputSize sum correctly across several known calls", () => {
  const loop = loopWithCalls([
    call({ elapsedMs: 1000, inputTokens: 100, outputTokens: 20 }),
    call({ phase: "gathering", attempt: 0, decisionIndex: 1, elapsedMs: 1500, inputTokens: 150, outputTokens: 30 }),
    call({ phase: "finalization", attempt: 0, decisionIndex: null, elapsedMs: 900, inputTokens: 200, outputTokens: 40 })
  ]);

  const metrics = buildLlmMetrics(loop);

  assert.ok(metrics);
  assert.equal(metrics!.callCount, 3);
  assert.equal(metrics!.totalElapsedMs, 1000 + 1500 + 900);
  assert.equal(metrics!.inputSize, 100 + 150 + 200);
  assert.equal(metrics!.outputSize, 20 + 30 + 40);
  assert.equal(metrics!.usageComplete, true);
  assert.equal(metrics!.calls.length, 3);
});

test("[LLM-R1-T02 Caso 7] callCount/totalElapsedMs still sum correctly even when the turn's calls include failures", () => {
  const loop = loopWithCalls([
    call({ outcome: "invalid_response", elapsedMs: 500, inputTokens: null, outputTokens: null, finishReason: "length" }),
    call({ attempt: 1, elapsedMs: 1200, inputTokens: 60, outputTokens: 15 })
  ]);

  const metrics = buildLlmMetrics(loop);

  assert.ok(metrics);
  assert.equal(metrics!.callCount, 2);
  assert.equal(metrics!.totalElapsedMs, 500 + 1200);
  assert.equal(metrics!.inputSize, 60, "only the known value is summed, the missing one is skipped, never treated as 0");
  assert.equal(metrics!.outputSize, 15);
  assert.equal(metrics!.usageComplete, false, "at least one call is missing usage - the sum above is partial, not complete");
});

// --- Caso 8: partial/missing metadata semantics ---

test("[LLM-R1-T02 Caso 8] a single call with no usage data yields null aggregates, never an invented 0", () => {
  const loop = loopWithCalls([call({ inputTokens: null, outputTokens: null })]);

  const metrics = buildLlmMetrics(loop);

  assert.ok(metrics);
  assert.equal(metrics!.inputSize, null, "no call reported a usable inputSize - null, not 0");
  assert.equal(metrics!.outputSize, null);
  assert.equal(metrics!.usageComplete, false);
  assert.equal(metrics!.callCount, 1);
  assert.equal(metrics!.totalElapsedMs, 1000, "elapsedMs is always known, regardless of usage availability");
});

test("[LLM-R1-T02] a turn that never reached the provider yields llmMetrics=null, never a degenerate zeroed-out object", () => {
  const loop = loopWithCalls([]);
  assert.equal(buildLlmMetrics(loop), null);
});

test("[LLM-R1-T02] one call missing only inputTokens (never outputTokens) still marks usageComplete false and sums only the known dimension", () => {
  const loop = loopWithCalls([call({ inputTokens: null, outputTokens: 20 })]);

  const metrics = buildLlmMetrics(loop);

  assert.ok(metrics);
  assert.equal(metrics!.inputSize, null);
  assert.equal(metrics!.outputSize, 20, "outputTokens was known on this call and must still be summed independently");
  assert.equal(metrics!.usageComplete, false);
});

// --- buildLlmCallsSummary: the persisted per-call projection ---

test("[LLM-R1-T02] buildLlmCallsSummary renames inputTokens/outputTokens to inputSize/outputSize (persisted-payload boundary) and preserves every other field", () => {
  const loop = loopWithCalls([call({ phase: "finalization", attempt: 1, decisionIndex: null, inputTokens: 77, outputTokens: 33 })]);
  const [summary] = buildLlmCallsSummary(loop);

  assert.equal(summary.phase, "finalization");
  assert.equal(summary.attempt, 1);
  assert.equal(summary.decisionIndex, null);
  assert.equal(summary.inputSize, 77);
  assert.equal(summary.outputSize, 33);
  assert.equal("inputTokens" in summary, false, "the persisted projection must never carry the internal inputTokens name");
  assert.equal("outputTokens" in summary, false);
});

// --- normalizeAgentToolLoopCompletedCommercialEvent: llmMetrics wiring + security ---

test("[LLM-R1-T02] llmMetrics reaches payload_json verbatim when the loop captured LLM calls", () => {
  const loop = loopWithCalls([call()]);
  const llmMetrics = buildLlmMetrics(loop);

  const event = normalizeAgentToolLoopCompletedCommercialEvent({ ...eventBaseInput, llmMetrics });

  assert.deepEqual(event.payload.llmMetrics, llmMetrics);
});

test("[LLM-R1-T02] llmMetrics is entirely absent from payload_json when the loop made no LLM calls - never a stray null key", () => {
  const event = normalizeAgentToolLoopCompletedCommercialEvent({ ...eventBaseInput, llmMetrics: buildLlmMetrics(loopWithCalls([])) ?? undefined });
  assert.equal("llmMetrics" in event.payload, false);
});

test("[LLM-R1-T02] no key anywhere in a persisted llmMetrics payload matches the shared forbidden-key pattern (/token/i) - the inputTokens/outputTokens -> inputSize/outputSize rename actually holds", () => {
  // This is a regression guard for a real landmine found during this task:
  // lib/brain/commercial/events/normalize.ts's assertPlainSerializable
  // rejects ANY payload key matching /token/i (SENSITIVE_KEY_PATTERN, meant
  // for auth tokens) as commercial_event_forbidden_key - "inputTokens" and
  // "outputTokens" both match that pattern as substrings ("...Tokens...").
  // If a future edit ever renames inputSize/outputSize back to
  // inputTokens/outputTokens, this test fails loudly instead of the failure
  // only surfacing as a runtime throw the first time a real turn tries to
  // persist its LLM metrics.
  const loop = loopWithCalls([call(), call({ phase: "finalization", attempt: 1, decisionIndex: null })]);
  const llmMetrics = buildLlmMetrics(loop);

  // Must not throw - proves the real normalizer (not a hand-rolled regex
  // copy) accepts these exact field names.
  const event = normalizeAgentToolLoopCompletedCommercialEvent({ ...eventBaseInput, llmMetrics });
  assert.ok(event.payload.llmMetrics);
});

test("[LLM-R1-T02] llmMetrics never carries a forbidden key (API key, Authorization, secret, ...) - the shared sanitizer still enforces this on the nested object and array", () => {
  const loop = loopWithCalls([call()]);
  const llmMetrics = buildLlmMetrics(loop);
  assert.throws(
    () =>
      normalizeAgentToolLoopCompletedCommercialEvent({
        ...eventBaseInput,
        // @ts-expect-error - deliberately injecting a forbidden key to prove the sanitizer still walks into llmMetrics.calls[]
        llmMetrics: { ...llmMetrics, calls: [{ ...llmMetrics!.calls[0], apiKey: "sk-should-never-persist" }] }
      }),
    /commercial_event_forbidden_key/
  );
});

test("[LLM-R1-T02] llmMetrics and its calls[] entries carry only the documented keys - no accidental extra field (e.g. rawOutput) leaks through", () => {
  const loop = loopWithCalls([call()]);
  const llmMetrics = buildLlmMetrics(loop);
  const event = normalizeAgentToolLoopCompletedCommercialEvent({ ...eventBaseInput, llmMetrics });

  const persisted = event.payload.llmMetrics as Record<string, unknown>;
  const allowedTopKeys = new Set(["callCount", "totalElapsedMs", "inputSize", "outputSize", "usageComplete", "calls"]);
  for (const key of Object.keys(persisted)) {
    assert.ok(allowedTopKeys.has(key), `unexpected key leaked into llmMetrics: ${key}`);
  }

  const allowedCallKeys = new Set(["phase", "attempt", "decisionIndex", "elapsedMs", "model", "providerRequestId", "finishReason", "inputSize", "outputSize", "outcome"]);
  for (const call of persisted.calls as Array<Record<string, unknown>>) {
    for (const key of Object.keys(call)) {
      assert.ok(allowedCallKeys.has(key), `unexpected key leaked into an llmMetrics.calls[] entry: ${key}`);
    }
  }
});

test("[LLM-R1-T02] the full event payload never carries rawOutput, prompt text, or any secret-shaped value once llmMetrics is included", () => {
  const loop = loopWithCalls([
    call({ model: "deepseek-v4-flash", providerRequestId: "req-abc" }),
    call({ outcome: "invalid_response", finishReason: "length", inputTokens: null, outputTokens: null })
  ]);
  const event = normalizeAgentToolLoopCompletedCommercialEvent({ ...eventBaseInput, llmMetrics: buildLlmMetrics(loop) });

  const serialized = JSON.stringify(event.payload);
  assert.ok(!serialized.toLowerCase().includes("apikey"));
  assert.ok(!serialized.toLowerCase().includes("api_key"));
  assert.ok(!serialized.toLowerCase().includes("authorization"));
  assert.ok(!serialized.toLowerCase().includes("bearer"));
  assert.ok(!serialized.toLowerCase().includes("system prompt"));
  assert.ok(!serialized.toLowerCase().includes("rawoutput"));
});
