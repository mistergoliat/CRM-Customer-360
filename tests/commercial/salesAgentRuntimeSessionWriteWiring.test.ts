import assert from "node:assert/strict";
import test from "node:test";
import { runSalesAgentRuntime } from "@/lib/brain/commercial/sales-agent-runtime";
import type { SalesAgentRuntimeInput } from "@/lib/brain/commercial/sales-agent-runtime";
import { createFakeAgentLoopProvider } from "@/lib/brain/commercial/agent-loop/providers/fakeAgentLoopProvider";
import type { AgentLoopProvider, AgentLoopProviderInvokeOptions, AgentLoopProviderRequest, AgentLoopProviderResponse } from "@/lib/brain/commercial/agent-loop/agentLoopProviderTypes";
import { createInMemoryAgentSessionStore } from "@/lib/brain/commercial/agent-session/inMemoryAgentSessionStore";
import type { AppendEventInput, AppendEventResult } from "@/lib/brain/commercial/agent-session/types";
import type { AgentSessionStore } from "@/lib/brain/commercial/agent-session/store";
import type { CustomerMessageEvent } from "@/lib/brain/commercial/agent-runtime-event/types";

// SALES-AGENT-R3-V1.8-D2. Pure in-memory tests (no DB) proving the pre-loop
// USER_MESSAGE_RECEIVED write's ordering, idempotency, and RETRY_THEN_DEGRADE
// semantics (V1.8-D0 section 12) - the invariant D2 exists to establish:
// the event is durable BEFORE the provider is ever invoked, a transient
// store failure gets exactly one retry, and the customer turn is never
// blocked by a session-persistence problem.

let callLog: string[] = [];

function baseEvent(overrides: Partial<CustomerMessageEvent> = {}): CustomerMessageEvent {
  return {
    type: "CUSTOMER_MESSAGE",
    conversationId: 1,
    conversationPublicId: "conv-public-1",
    customerMasterId: null,
    waId: "56900001111",
    phoneNumberId: "phone-1",
    messageId: "wamid.test.1",
    messageText: "hola",
    correlationId: "corr-1",
    currentTime: "2026-08-31T15:00:00.000Z",
    ...overrides
  };
}

function runtimeInput(overrides: Partial<SalesAgentRuntimeInput> = {}): SalesAgentRuntimeInput {
  return {
    event: baseEvent(),
    opportunityId: null,
    provider: null,
    ...overrides
  };
}

function trackingProvider(script: unknown[]): AgentLoopProvider {
  const inner = createFakeAgentLoopProvider({ script });
  return {
    name: inner.name,
    version: inner.version,
    async invoke(request: AgentLoopProviderRequest, options: AgentLoopProviderInvokeOptions): Promise<AgentLoopProviderResponse> {
      callLog.push("provider.invoke");
      return inner.invoke(request, options);
    }
  };
}

type FailureInjection = {
  /** Fail exactly this many appendEvent attempts (across the whole call) before letting the real store handle it - 0 means never fail. */
  failTimes?: number;
  /** Always fail with a sanitizer-shaped error (never retried) instead of a transient one. */
  sanitizerRejection?: boolean;
};

function trackingSessionStore(injection: FailureInjection = {}): AgentSessionStore {
  const inner = createInMemoryAgentSessionStore();
  let attempts = 0;
  return {
    ensureSession: (input) => inner.ensureSession(input),
    async appendEvent(input: AppendEventInput): Promise<AppendEventResult> {
      callLog.push(`appendEvent:${input.eventType}`);
      if (injection.sanitizerRejection) {
        return { ok: false, status: "error", event: null, warning: "agent_session_forbidden_payload:test_injected_rejection" };
      }
      attempts += 1;
      if (injection.failTimes && attempts <= injection.failTimes) {
        return { ok: false, status: "error", event: null, warning: `transient_test_failure_attempt_${attempts}` };
      }
      return inner.appendEvent(input);
    },
    loadSession: (id) => inner.loadSession(id),
    loadSessionForConversation: (conversationId) => inner.loadSessionForConversation(conversationId),
    loadRecentEvents: (input) => inner.loadRecentEvents(input),
    loadSummary: (id) => inner.loadSummary(id),
    rebuildSummary: (id) => inner.rebuildSummary(id),
    persistCompactedPrefix: (input) => inner.persistCompactedPrefix(input)
  };
}

test.beforeEach(() => {
  callLog = [];
});

test("[D2-L1] USER_MESSAGE_RECEIVED is appended before the provider is ever invoked", async () => {
  const store = trackingSessionStore();
  const provider = trackingProvider([{ type: "respond", message: "hola!" }]);

  await runSalesAgentRuntime(runtimeInput({ provider, sessionStore: store }));

  const userMessageIndex = callLog.indexOf("appendEvent:USER_MESSAGE_RECEIVED");
  const providerIndex = callLog.indexOf("provider.invoke");
  assert.notEqual(userMessageIndex, -1, "USER_MESSAGE_RECEIVED must be appended");
  assert.notEqual(providerIndex, -1, "provider.invoke must be called");
  assert.ok(userMessageIndex < providerIndex, `expected append before invoke, got order: ${callLog.join(",")}`);
});

test("[D2-L2] a replayed turn for the same inbound message never duplicates USER_MESSAGE_RECEIVED", async () => {
  const store = trackingSessionStore();
  const event = baseEvent();

  await runSalesAgentRuntime(runtimeInput({ event, provider: trackingProvider([{ type: "respond", message: "hola!" }]), sessionStore: store }));
  await runSalesAgentRuntime(runtimeInput({ event, provider: trackingProvider([{ type: "respond", message: "hola de nuevo!" }]), sessionStore: store }));

  const session = await store.loadSessionForConversation(event.conversationId);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  assert.equal(events.filter((e) => e.eventType === "USER_MESSAGE_RECEIVED").length, 1);
});

test("[D2-L3] one transient write failure retries once, then succeeds - no warning, event created", async () => {
  const store = trackingSessionStore({ failTimes: 1 });
  const provider = trackingProvider([{ type: "respond", message: "hola!" }]);

  const result = await runSalesAgentRuntime(runtimeInput({ provider, sessionStore: store }));

  const appendAttempts = callLog.filter((c) => c === "appendEvent:USER_MESSAGE_RECEIVED").length;
  assert.equal(appendAttempts, 2, "exactly one retry - two total attempts");
  assert.ok(!result.warnings.some((w) => w.startsWith("agent_session_user_message_event_write_failed")), "no failure warning once the retry succeeds");

  const session = await store.loadSessionForConversation(1);
  const events = await store.loadRecentEvents({ sessionId: session!.id });
  assert.equal(events.filter((e) => e.eventType === "USER_MESSAGE_RECEIVED").length, 1);
});

test("[D2-L4] a second failure degrades - warns, does not block the turn, provider is still called", async () => {
  const store = trackingSessionStore({ failTimes: 2 });
  const provider = trackingProvider([{ type: "respond", message: "hola!" }]);

  const result = await runSalesAgentRuntime(runtimeInput({ provider, sessionStore: store }));

  const appendAttempts = callLog.filter((c) => c === "appendEvent:USER_MESSAGE_RECEIVED").length;
  assert.equal(appendAttempts, 2, "no unbounded retry - exactly two attempts, both failing");
  assert.ok(callLog.includes("provider.invoke"), "the customer turn must still reach the model");
  assert.equal(result.status, "responded");
  assert.ok(result.warnings.some((w) => w.startsWith("agent_session_user_message_event_write_failed")));
});

test("[D2-L5] a sanitizer/invalid-payload failure is never retried", async () => {
  const store = trackingSessionStore({ sanitizerRejection: true });
  const provider = trackingProvider([{ type: "respond", message: "hola!" }]);

  const result = await runSalesAgentRuntime(runtimeInput({ provider, sessionStore: store }));

  const appendAttempts = callLog.filter((c) => c === "appendEvent:USER_MESSAGE_RECEIVED").length;
  assert.equal(appendAttempts, 1, "an invalid payload must not be retried - retrying an inherently invalid payload changes nothing");
  assert.ok(callLog.includes("provider.invoke"));
  assert.ok(result.warnings.some((w) => w.startsWith("agent_session_user_message_event_write_failed")));
});

// SALES-AGENT-R3-V1.8-D2, Section O scenario A. USER_MESSAGE_RECEIVED
// successfully written -> simulated crash before the provider ever runs ->
// replay the same inbound -> no duplicate user session event. No real Meta
// call anywhere in this file.
test("[D2-O-A] crash before the provider runs, then replay: no duplicate USER_MESSAGE_RECEIVED", async () => {
  const store = trackingSessionStore();
  const event = baseEvent();

  // Simulated crash: the provider throws before producing any AgentStep -
  // the turn fails, but the pre-loop event write already committed.
  const crashingProvider: AgentLoopProvider = {
    name: "crashing-test-provider",
    async invoke(): Promise<AgentLoopProviderResponse> {
      throw new Error("simulated crash before any model output");
    }
  };
  const firstAttempt = await runSalesAgentRuntime(runtimeInput({ event, provider: crashingProvider, sessionStore: store }));
  assert.equal(firstAttempt.status, "failed");

  const session = await store.loadSessionForConversation(event.conversationId);
  const eventsAfterCrash = await store.loadRecentEvents({ sessionId: session!.id });
  assert.equal(eventsAfterCrash.filter((e) => e.eventType === "USER_MESSAGE_RECEIVED").length, 1);

  // Replay: same inboundMessageId, this time the provider succeeds.
  const replay = await runSalesAgentRuntime(runtimeInput({ event, provider: trackingProvider([{ type: "respond", message: "hola tras el replay" }]), sessionStore: store }));
  assert.equal(replay.status, "responded");

  const eventsAfterReplay = await store.loadRecentEvents({ sessionId: session!.id });
  assert.equal(eventsAfterReplay.filter((e) => e.eventType === "USER_MESSAGE_RECEIVED").length, 1, "the replay must not create a second USER_MESSAGE_RECEIVED");
});
