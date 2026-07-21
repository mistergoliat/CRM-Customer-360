import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentStep } from "@/lib/brain/commercial/agent-loop/validateAgentStep";

test("accepts a valid use_tool step", () => {
  const result = validateAgentStep({ type: "use_tool", tool: "search_products", arguments: { query: "jaula" } });
  assert.equal(result.status, "valid");
  if (result.status === "valid") {
    assert.deepEqual(result.step, { type: "use_tool", tool: "search_products", arguments: { query: "jaula" } });
  }
});

test("accepts a valid respond step", () => {
  const result = validateAgentStep({ type: "respond", message: "Hola, en que te ayudo?" });
  assert.equal(result.status, "valid");
  if (result.status === "valid") {
    assert.deepEqual(result.step, { type: "respond", message: "Hola, en que te ayudo?" });
  }
});

test("accepts a valid handoff step", () => {
  const result = validateAgentStep({ type: "handoff", reason: "Requiere revision humana." });
  assert.equal(result.status, "valid");
  if (result.status === "valid") {
    assert.deepEqual(result.step, { type: "handoff", reason: "Requiere revision humana." });
  }
});

test("rejects a non-object root", () => {
  assert.equal(validateAgentStep("not an object").status, "invalid");
  assert.equal(validateAgentStep(null).status, "invalid");
  assert.equal(validateAgentStep([1, 2, 3]).status, "invalid");
});

test("rejects an unsupported type", () => {
  const result = validateAgentStep({ type: "analyze", message: "x" });
  assert.equal(result.status, "invalid");
});

test("rejects use_tool without a tool name", () => {
  assert.equal(validateAgentStep({ type: "use_tool", arguments: {} }).status, "invalid");
  assert.equal(validateAgentStep({ type: "use_tool", tool: "", arguments: {} }).status, "invalid");
});

test("does not reject an unregistered tool name at the validation layer - that is a governance decision", () => {
  const result = validateAgentStep({ type: "use_tool", tool: "delete_all_customers", arguments: {} });
  assert.equal(result.status, "valid");
});

test("rejects respond without a message", () => {
  assert.equal(validateAgentStep({ type: "respond" }).status, "invalid");
  assert.equal(validateAgentStep({ type: "respond", message: "   " }).status, "invalid");
});

test("rejects handoff without a reason", () => {
  assert.equal(validateAgentStep({ type: "handoff" }).status, "invalid");
});

test("rejects oversized arguments", () => {
  const bigArguments: Record<string, string> = {};
  for (let index = 0; index < 2000; index += 1) bigArguments[`key${index}`] = "x".repeat(20);
  const result = validateAgentStep({ type: "use_tool", tool: "search_products", arguments: bigArguments });
  assert.equal(result.status, "invalid");
});

test("trims and bounds an oversized respond message instead of rejecting it", () => {
  const longMessage = "a".repeat(5000);
  const result = validateAgentStep({ type: "respond", message: longMessage });
  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "respond") {
    assert.ok(result.step.message.length <= 2000);
  }
});
