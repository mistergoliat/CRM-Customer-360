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

// ACS-R1-05.1-T02.7 - pendingCatalogAction on respond.

test("accepts a respond step with a well-formed pendingCatalogAction", () => {
  const result = validateAgentStep({
    type: "respond",
    message: "Quieres que te envie el link de alguno de estos productos?",
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: ["80", "2164"] }
  });
  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "respond") {
    assert.deepEqual(result.step.pendingCatalogAction, { actionType: "send_product_link", candidateProductIds: ["80", "2164"] });
  }
});

test("does not include pendingCatalogAction when the step omits it", () => {
  const result = validateAgentStep({ type: "respond", message: "Aqui tienes el enlace." });
  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "respond") {
    assert.equal("pendingCatalogAction" in result.step, false);
  }
});

test("drops a malformed pendingCatalogAction instead of rejecting the whole respond step", () => {
  const wrongActionType = validateAgentStep({
    type: "respond",
    message: "Hola",
    pendingCatalogAction: { actionType: "add_to_cart", candidateProductIds: ["80"] }
  });
  assert.equal(wrongActionType.status, "valid");
  if (wrongActionType.status === "valid" && wrongActionType.step.type === "respond") {
    assert.equal("pendingCatalogAction" in wrongActionType.step, false);
  }

  const emptyCandidates = validateAgentStep({
    type: "respond",
    message: "Hola",
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: [] }
  });
  assert.equal(emptyCandidates.status, "valid");
  if (emptyCandidates.status === "valid" && emptyCandidates.step.type === "respond") {
    assert.equal("pendingCatalogAction" in emptyCandidates.step, false);
  }

  const notAnArray = validateAgentStep({
    type: "respond",
    message: "Hola",
    pendingCatalogAction: { actionType: "send_product_link", candidateProductIds: "80" }
  });
  assert.equal(notAnArray.status, "valid");
  if (notAnArray.status === "valid" && notAnArray.step.type === "respond") {
    assert.equal("pendingCatalogAction" in notAnArray.step, false);
  }
});

test("filters blank/non-string candidateProductIds and caps the list", () => {
  const result = validateAgentStep({
    type: "respond",
    message: "Hola",
    pendingCatalogAction: {
      actionType: "send_product_link",
      candidateProductIds: ["80", "  ", "", 2164, " 8 ", ...Array.from({ length: 25 }, (_, i) => `extra-${i}`)]
    }
  });
  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "respond") {
    assert.ok(result.step.pendingCatalogAction);
    assert.deepEqual(result.step.pendingCatalogAction?.candidateProductIds.slice(0, 2), ["80", "8"]);
    assert.ok((result.step.pendingCatalogAction?.candidateProductIds.length ?? 0) <= 20);
  }
});

// SALES-AGENT-R3-P4 - CommercialProposal shadow-safe validation.

const P4_VALID_QUOTE_PROPOSAL = {
  schemaVersion: "1",
  objective: {
    kind: "QUOTE",
    operation: "CONTINUE",
    confidence: "HIGH"
  },
  requestedOutcome: "QUOTE_CREATION",
  requirementSignals: [
    { requirement: "DESTINATION", signal: "PROVIDED" }
  ],
  evidenceCodes: ["EXPLICIT_QUOTE_CONTINUATION"],
  ambiguity: {
    present: false,
    reasonCode: null
  }
};

test("[P4-V1] respond preserves a valid commercialProposal", () => {
  const result = validateAgentStep({
    type: "respond",
    message: "Continuo con la cotizacion.",
    commercialProposal: P4_VALID_QUOTE_PROPOSAL
  });

  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "respond") {
    assert.deepEqual(result.step.commercialProposal, P4_VALID_QUOTE_PROPOSAL);
  }
});

test("[P4-V2] malformed commercialProposal is dropped without invalidating respond", () => {
  const result = validateAgentStep({
    type: "respond",
    message: "Continuo.",
    commercialProposal: {
      ...P4_VALID_QUOTE_PROPOSAL,
      objective: {
        kind: "INVENTED_OBJECTIVE",
        operation: "CONTINUE",
        confidence: "HIGH"
      }
    }
  });

  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "respond") {
    assert.equal("commercialProposal" in result.step, false);
  }
});

test("[P4-V3] handoff preserves a valid commercialProposal", () => {
  const result = validateAgentStep({
    type: "handoff",
    reason: "customer_requested_human",
    commercialProposal: {
      ...P4_VALID_QUOTE_PROPOSAL,
      objective: {
        kind: "AFTER_SALES",
        operation: "CONTINUE",
        confidence: "HIGH"
      },
      requestedOutcome: "AFTER_SALES_RESOLUTION"
    }
  });

  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "handoff") {
    assert.equal(result.step.commercialProposal?.objective?.kind, "AFTER_SALES");
  }
});

test("[P4-V4] use_tool never carries commercialProposal through validation", () => {
  const result = validateAgentStep({
    type: "use_tool",
    tool: "get_quote",
    arguments: {},
    commercialProposal: P4_VALID_QUOTE_PROPOSAL
  });

  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "use_tool") {
    assert.equal("commercialProposal" in result.step, false);
  }
});

test("[P4-V5] objective=null is valid for a terminal acknowledgement proposal", () => {
  const result = validateAgentStep({
    type: "respond",
    message: "Perfecto.",
    commercialProposal: {
      schemaVersion: "1",
      objective: null,
      requestedOutcome: null,
      requirementSignals: [],
      evidenceCodes: ["COURTESY_ACKNOWLEDGEMENT"],
      ambiguity: {
        present: false,
        reasonCode: null
      }
    }
  });

  assert.equal(result.status, "valid");
  if (result.status === "valid" && result.step.type === "respond") {
    assert.equal(result.step.commercialProposal?.objective, null);
    assert.equal(result.step.commercialProposal?.requestedOutcome, null);
  }
});
