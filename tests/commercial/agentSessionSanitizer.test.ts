import assert from "node:assert/strict";
import test from "node:test";
import { AgentSessionForbiddenPayloadError, sanitizeAgentSessionPayload } from "@/lib/brain/commercial/agent-session/sanitizer";

// SALES-AGENT-R3-A01. Pure tests, no DB - proves the sanitizer fails closed
// on chain-of-thought/raw-output/secret-shaped keys (test scenarios 16-20 of
// the task brief), and that ordinary numeric/enum metrics still pass through.

test("rejects a raw prompt field", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ prompt: "You are a helpful assistant..." }), AgentSessionForbiddenPayloadError);
});

test("rejects reasoning_content", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ reasoning_content: "Let me think step by step..." }), AgentSessionForbiddenPayloadError);
});

test("rejects reasoningContent (camelCase)", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ reasoningContent: "..." }), AgentSessionForbiddenPayloadError);
});

test("rejects rawOutput", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ rawOutput: { choices: [{ message: { content: "..." } }] } }), AgentSessionForbiddenPayloadError);
});

test("rejects chain_of_thought and chainOfThought", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ chain_of_thought: "..." }), AgentSessionForbiddenPayloadError);
  assert.throws(() => sanitizeAgentSessionPayload({ chainOfThought: "..." }), AgentSessionForbiddenPayloadError);
});

test("rejects thinking", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ thinking: "..." }), AgentSessionForbiddenPayloadError);
});

test("rejects authorization header", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ authorization: "Bearer sk-abc123" }), AgentSessionForbiddenPayloadError);
});

test("rejects apiKey", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ apiKey: "sk-abc123" }), AgentSessionForbiddenPayloadError);
});

test("rejects a nested secret/token at any depth", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ nested: { deeper: { token: "secret" } } }), AgentSessionForbiddenPayloadError);
});

test("rejects a secret nested inside an array", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ items: [{ ok: true }, { password: "hunter2" }] }), AgentSessionForbiddenPayloadError);
});

test("rejects cookie and webhook-shaped keys", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ cookie: "session=abc" }), AgentSessionForbiddenPayloadError);
  assert.throws(() => sanitizeAgentSessionPayload({ webhookSecret: "abc" }), AgentSessionForbiddenPayloadError);
});

test("allows ordinary numeric/enum metrics through unchanged", () => {
  const sanitized = sanitizeAgentSessionPayload({
    tool: "search_products",
    phase: "gathering",
    governance: "authorized",
    observationStatus: "completed",
    latencyMs: 842,
    stepIndex: 0
  });
  assert.deepEqual(sanitized, {
    tool: "search_products",
    phase: "gathering",
    governance: "authorized",
    observationStatus: "completed",
    latencyMs: 842,
    stepIndex: 0
  });
});

test("allows a bounded, PII-free payload shape typical of a session event", () => {
  const sanitized = sanitizeAgentSessionPayload({ inboundMessageId: "msg_123", outcome: "message", terminalReason: "responded" });
  assert.equal(sanitized.inboundMessageId, "msg_123");
  assert.equal(sanitized.outcome, "message");
});
