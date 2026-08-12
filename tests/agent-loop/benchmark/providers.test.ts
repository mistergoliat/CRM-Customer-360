import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineScriptedProvider } from "@/lib/brain/commercial/agent-loop/benchmark/offlineProvider";
import { createInstrumentedProvider } from "@/lib/brain/commercial/agent-loop/benchmark/instrumentedProvider";
import { classifyAgentLoopProviderFailure, markAgentLoopProviderFailure } from "@/lib/brain/commercial/agent-loop/providers/providerFailureClassification";
import type { AgentLoopProvider, AgentLoopProviderRequest, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import type { BenchmarkProviderCallRecord } from "@/lib/brain/commercial/agent-loop/benchmark/types";

const invokeOptions = { timeoutMs: 5000 };
const request: AgentLoopProviderRequest = { messages: [{ role: "user", content: "hola" }] };

test("[T05] offlineProvider turns a use_tool step into a use_tool rawOutput and reports null (not 0) tokens", async () => {
  const provider = createOfflineScriptedProvider([{ kind: "use_tool", tool: "search_products", arguments: { query: "barra" } }]);
  const response = await provider.invoke(request, invokeOptions);
  assert.deepEqual(response.rawOutput, { type: "use_tool", tool: "search_products", arguments: { query: "barra" } });
  assert.equal(response.inputTokens, null);
  assert.equal(response.outputTokens, null);
  assert.equal(response.finishReason, "stop");
});

test("[T05] offlineProvider omits pendingCatalogAction from rawOutput when the script step doesn't set one", async () => {
  const provider = createOfflineScriptedProvider([{ kind: "respond", message: "hola" }]);
  const response = await provider.invoke(request, invokeOptions);
  assert.deepEqual(response.rawOutput, { type: "respond", message: "hola" });
  assert.equal((response.rawOutput as Record<string, unknown>).pendingCatalogAction, undefined);
});

test("[T05] offlineProvider carries pendingCatalogAction through when the script step sets one", async () => {
  const pendingCatalogAction = { actionType: "send_product_link" as const, candidateProductIds: ["31"] };
  const provider = createOfflineScriptedProvider([{ kind: "respond", message: "hola", pendingCatalogAction }]);
  const response = await provider.invoke(request, invokeOptions);
  assert.deepEqual(response.rawOutput, { type: "respond", message: "hola", pendingCatalogAction });
});

test("[T05] offlineProvider turns a handoff step into a handoff rawOutput", async () => {
  const provider = createOfflineScriptedProvider([{ kind: "handoff", reason: "needs_human" }]);
  const response = await provider.invoke(request, invokeOptions);
  assert.deepEqual(response.rawOutput, { type: "handoff", reason: "needs_human" });
});

test("[T05] offlineProvider passes invalid_json_shape rawOutput through verbatim for T04's guided repair to reject", async () => {
  const provider = createOfflineScriptedProvider([{ kind: "invalid_json_shape", rawOutput: { type: "not_a_real_step" } }]);
  const response = await provider.invoke(request, invokeOptions);
  assert.deepEqual(response.rawOutput, { type: "not_a_real_step" });
});

test("[T05] offlineProvider throws a correctly-classified failure for an invalid_response step", async () => {
  const provider = createOfflineScriptedProvider([{ kind: "invalid_response", errorCode: "empty_response" }]);
  await assert.rejects(
    () => provider.invoke(request, invokeOptions),
    (error: unknown) => {
      const cause = classifyAgentLoopProviderFailure(error);
      assert.equal(cause.normalizedReason, "invalid_response");
      assert.equal(cause.errorCode, "empty_response");
      return true;
    }
  );
});

test("[T05] offlineProvider repeats the last scripted step once the script is exhausted", async () => {
  const provider = createOfflineScriptedProvider([{ kind: "use_tool", tool: "search_products", arguments: { query: "barra" } }, { kind: "respond", message: "listo" }]);
  await provider.invoke(request, invokeOptions);
  await provider.invoke(request, invokeOptions);
  const third = await provider.invoke(request, invokeOptions);
  assert.deepEqual(third.rawOutput, { type: "respond", message: "listo" });
});

test("[T05] instrumentedProvider records a success call with the response's own fields", async () => {
  const inner: AgentLoopProvider = {
    name: "stub",
    async invoke(): Promise<AgentLoopProviderResponse> {
      return { rawOutput: { type: "respond", message: "hola" }, model: "stub-model", inputTokens: 12, outputTokens: 8, providerRequestId: "req-abc", finishReason: "stop" };
    }
  };
  const calls: BenchmarkProviderCallRecord[] = [];
  const instrumented = createInstrumentedProvider(inner, "C01", 0, calls);
  await instrumented.invoke(request, invokeOptions);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].caseId, "C01");
  assert.equal(calls[0].outcome, "success");
  assert.equal(calls[0].errorCode, null);
  assert.equal(calls[0].inputTokens, 12);
  assert.equal(calls[0].outputTokens, 8);
  assert.equal(calls[0].model, "stub-model");
});

test("[T05] instrumentedProvider records a classified failure and re-throws the original error unchanged", async () => {
  const originalError = markAgentLoopProviderFailure(new Error("simulated failure"), {
    model: "stub-model",
    attemptCount: 1,
    maxAttempts: 1,
    httpStatus: null,
    errorCode: "invalid_model_json",
    errorClass: "InvalidProviderResponseError",
    normalizedReason: "invalid_response",
    retryable: false
  });
  const inner: AgentLoopProvider = {
    name: "stub-failing",
    async invoke(): Promise<AgentLoopProviderResponse> {
      throw originalError;
    }
  };
  const calls: BenchmarkProviderCallRecord[] = [];
  const instrumented = createInstrumentedProvider(inner, "C12", 1, calls);

  await assert.rejects(() => instrumented.invoke(request, invokeOptions), (error: unknown) => error === originalError);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].caseId, "C12");
  assert.equal(calls[0].runIndex, 1);
  assert.equal(calls[0].outcome, "invalid_response");
  assert.equal(calls[0].errorCode, "invalid_model_json");
});
