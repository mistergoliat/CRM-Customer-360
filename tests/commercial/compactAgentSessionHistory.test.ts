import assert from "node:assert/strict";
import test from "node:test";
import { compactAgentSessionHistory } from "@/lib/brain/commercial/agent-session/compactAgentSessionHistory";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider, AgentLoopProviderRequest } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";

// SALES-AGENT-R3-V1.8-D7. Pure-ish tests (the only I/O is the injected fake
// provider) for the one model-calling boundary the task brief names
// directly (Section H). Never throws - every failure mode is a typed
// { ok: false } result (Section I "fail open").

function capturingProvider(inner: AgentLoopProvider, sink: AgentLoopProviderRequest[]): AgentLoopProvider {
  return {
    name: inner.name,
    version: inner.version,
    async invoke(request, options) {
      sink.push(request);
      return inner.invoke(request, options);
    }
  };
}

test("[D7-H1] returns the model's summaryText on a valid JSON response", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ summaryText: "el cliente pidio una barra de 20kg" }] });
  const result = await compactAgentSessionHistory({
    previousSummaryText: null,
    messagesToCompact: [{ role: "user", content: "quiero una barra de 20kg" }],
    provider,
    timeoutMs: 5000
  });
  assert.deepEqual(result, { ok: true, summaryText: "el cliente pidio una barra de 20kg" });
});

test("[D7-H2] nothing to compact is rejected before any provider call", async () => {
  const calls: AgentLoopProviderRequest[] = [];
  const provider = capturingProvider(createFakeAgentLoopProvider({ script: [{ summaryText: "x" }] }), calls);
  const result = await compactAgentSessionHistory({ previousSummaryText: null, messagesToCompact: [], provider, timeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});

test("[D7-H3] empty or missing summaryText is rejected", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ summaryText: "" }] });
  const result = await compactAgentSessionHistory({
    previousSummaryText: null,
    messagesToCompact: [{ role: "user", content: "hola" }],
    provider,
    timeoutMs: 5000
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason.includes("empty_or_invalid_summary"));
});

test("[D7-H4] a structurally different JSON shape (no summaryText field) is rejected, never crashes", async () => {
  const provider = createFakeAgentLoopProvider({ script: [{ unrelatedField: "oops" }] });
  const result = await compactAgentSessionHistory({
    previousSummaryText: null,
    messagesToCompact: [{ role: "user", content: "hola" }],
    provider,
    timeoutMs: 5000
  });
  assert.equal(result.ok, false);
});

test("[D7-H5] a provider throw is caught and returned as a typed failure, never propagated", async () => {
  const provider: AgentLoopProvider = {
    name: "throwing",
    async invoke() {
      throw new Error("simulated_provider_failure");
    }
  };
  const result = await compactAgentSessionHistory({
    previousSummaryText: null,
    messagesToCompact: [{ role: "user", content: "hola" }],
    provider,
    timeoutMs: 5000
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason.includes("simulated_provider_failure"));
});

test("[D7-H6] the previous summary and the raw turns are both included in the request, real turns appended verbatim", async () => {
  const calls: AgentLoopProviderRequest[] = [];
  const provider = capturingProvider(createFakeAgentLoopProvider({ script: [{ summaryText: "merged" }] }), calls);
  await compactAgentSessionHistory({
    previousSummaryText: "resumen anterior: barra 20kg",
    messagesToCompact: [
      { role: "user", content: "quiero colchonetas" },
      { role: "assistant", content: "tenemos varias opciones" }
    ],
    provider,
    timeoutMs: 5000
  });
  assert.equal(calls.length, 1);
  const messages = calls[0].messages;
  assert.ok(messages.some((m) => m.role === "system" && m.content.includes("resumen anterior: barra 20kg")));
  assert.ok(messages.some((m) => m.role === "user" && m.content === "quiero colchonetas"));
  assert.ok(messages.some((m) => m.role === "assistant" && m.content === "tenemos varias opciones"));
  // Real turns appear verbatim, never re-serialized as a JSON blob.
  assert.ok(!messages.some((m) => m.content.includes('"role"') || m.content.includes('"content"')));
});

test("[D7-H7] no previous summary omits the previous-summary system message", async () => {
  const calls: AgentLoopProviderRequest[] = [];
  const provider = capturingProvider(createFakeAgentLoopProvider({ script: [{ summaryText: "x" }] }), calls);
  await compactAgentSessionHistory({
    previousSummaryText: null,
    messagesToCompact: [{ role: "user", content: "hola" }],
    provider,
    timeoutMs: 5000
  });
  const systemMessages = calls[0].messages.filter((m) => m.role === "system");
  assert.equal(systemMessages.length, 1);
});
