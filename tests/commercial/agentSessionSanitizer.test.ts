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

// SALES-AGENT-R3-V1.8-D1. Approved/rejected field names for the persistent
// session design (V1.8-C section 6) - verified in V1.8-D0 by executing the
// real regex, re-verified here as a standing regression test so a future
// refactor can never silently reintroduce the rejected name.

test("[D1] allows outboundMessagePublicId (ASSISTANT_MESSAGE_SENT extension)", () => {
  const sanitized = sanitizeAgentSessionPayload({
    inboundMessageId: "msg_123",
    outcome: "message",
    terminalReason: "responded",
    outboundMessagePublicId: "b2f2b6b0-1c1e-4b3a-9c2e-0f7a1a2b3c4d"
  });
  assert.equal(sanitized.outboundMessagePublicId, "b2f2b6b0-1c1e-4b3a-9c2e-0f7a1a2b3c4d");
});

test("[D1] allows outboundMessagePublicId = null", () => {
  const sanitized = sanitizeAgentSessionPayload({ inboundMessageId: "msg_123", outcome: "handoff", terminalReason: "handoff", outboundMessagePublicId: null });
  assert.equal(sanitized.outboundMessagePublicId, null);
});

test("[D1] allows the full SESSION_COMPACTED payload: fromSeq, toSeq, summaryEstimatedSize", () => {
  const sanitized = sanitizeAgentSessionPayload({ fromSeq: 1, toSeq: 42, summaryEstimatedSize: 900 });
  assert.deepEqual(sanitized, { fromSeq: 1, toSeq: 42, summaryEstimatedSize: 900 });
});

test("[D1] rejects summaryTokenEstimate - the name V1.8-C proposed before V1.8-D0 found it fails the real sanitizer", () => {
  assert.throws(() => sanitizeAgentSessionPayload({ fromSeq: 1, toSeq: 42, summaryTokenEstimate: 900 }), AgentSessionForbiddenPayloadError);
});
