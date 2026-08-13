import assert from "node:assert/strict";
import test from "node:test";
import { classifyMultiIntentOutcomes, buildMultiIntentResponseContract } from "@/lib/brain/commercial/multi-intent/buildMultiIntentResponseContract";
import type { ExecutedActionStep } from "@/lib/brain/commercial/multi-intent/actionPlanExecutor";
import type { ResolvedIntent } from "@/lib/brain/commercial/multi-intent/types";

// Part 21 test 13: a successful, independent intent is conserved (still "completed") even while a sibling intent stays waiting_for_information - the two are classified independently.
test("[MI-Contract-1] select_products completed + get_shipping_quote waiting_for_information classify independently", () => {
  const resolvedIntents: ResolvedIntent[] = [
    {
      intentIndex: 0,
      intent: { type: "select_products", productReference: "Classic", quantity: 2 },
      requirements: [
        { type: "PRODUCT", status: "resolved", source: "recent_catalog_context", value: { productId: "31", name: "Classic" } },
        { type: "QUANTITY", status: "resolved", source: "explicit", value: 2 }
      ],
      status: "ready"
    },
    {
      intentIndex: 1,
      intent: { type: "get_shipping_quote" },
      requirements: [{ type: "PRODUCT_SELECTION", status: "resolved", source: "same_turn_intent", value: true }, { type: "DESTINATION", status: "missing" }],
      status: "waiting_for_information"
    }
  ];
  const executedSteps: ExecutedActionStep[] = [
    { step: { capability: "select_products", forIntentIndex: 0, arguments: {} }, observation: { tool: "select_products", status: "completed", data: { status: "selected" } }, skippedDependencyFailed: false }
  ];

  const outcomes = classifyMultiIntentOutcomes(resolvedIntents, executedSteps);
  assert.equal(outcomes[0].status, "completed");
  assert.equal(outcomes[1].status, "waiting_for_information");
  assert.deepEqual(outcomes[1].missingRequirements, ["DESTINATION"]);

  const contract = buildMultiIntentResponseContract(outcomes);
  assert.equal(contract.completedIntents.length, 1);
  assert.equal(contract.pendingIntents.length, 1);
  assert.deepEqual(contract.missingRequirements, ["DESTINATION"]);
});

// Part 10: calculate_shipping's own real "shipping_destination_required" status (destination genuinely
// unresolved at execution time, e.g. an ambiguous "Santiago") is classified as needs_clarification, not a hard failure.
test("[MI-Contract-2] a set_shipping_destination that comes back needs_clarification classifies the intent as needs_clarification with DESTINATION flagged", () => {
  const resolvedIntents: ResolvedIntent[] = [
    {
      intentIndex: 0,
      intent: { type: "get_shipping_quote", destination: "Santiago" },
      requirements: [{ type: "PRODUCT_SELECTION", status: "resolved", source: "durable_state", value: true }, { type: "DESTINATION", status: "resolved", source: "explicit", value: "Santiago" }],
      status: "ready"
    }
  ];
  const executedSteps: ExecutedActionStep[] = [
    {
      step: { capability: "set_shipping_destination", forIntentIndex: 0, arguments: { destination: "Santiago" } },
      observation: { tool: "set_shipping_destination", status: "completed", data: { status: "needs_clarification", input: "Santiago" } },
      skippedDependencyFailed: false
    },
    {
      step: { capability: "calculate_shipping", forIntentIndex: 0, arguments: {} },
      observation: { tool: "calculate_shipping", status: "completed", data: { status: "shipping_destination_required" } },
      skippedDependencyFailed: false
    }
  ];

  const outcomes = classifyMultiIntentOutcomes(resolvedIntents, executedSteps);
  assert.equal(outcomes[0].status, "needs_clarification");
  assert.ok(outcomes[0].ambiguousRequirements.includes("DESTINATION"));
});

// Part 12/28: a dependency-skipped step (select_products failed) is classified as a real, honest failure - never silently reinterpreted as "missing information".
test("[MI-Contract-3] a dependency-skipped calculate_shipping classifies get_shipping_quote as failed", () => {
  const resolvedIntents: ResolvedIntent[] = [
    {
      intentIndex: 0,
      intent: { type: "select_products", productReference: "Classic", quantity: 2 },
      requirements: [
        { type: "PRODUCT", status: "resolved", source: "recent_catalog_context", value: { productId: "31", name: "Classic" } },
        { type: "QUANTITY", status: "resolved", source: "explicit", value: 2 }
      ],
      status: "ready"
    },
    {
      intentIndex: 1,
      intent: { type: "get_shipping_quote", destination: "Ñuñoa" },
      requirements: [{ type: "PRODUCT_SELECTION", status: "resolved", source: "same_turn_intent", value: true }, { type: "DESTINATION", status: "resolved", source: "explicit", value: "Ñuñoa" }],
      status: "ready"
    }
  ];
  const executedSteps: ExecutedActionStep[] = [
    { step: { capability: "select_products", forIntentIndex: 0, arguments: {} }, observation: { tool: "select_products", status: "blocked", errorCode: "no_active_opportunity" }, skippedDependencyFailed: false },
    { step: { capability: "set_shipping_destination", forIntentIndex: 1, arguments: {} }, observation: { tool: "set_shipping_destination", status: "blocked", errorCode: "no_active_opportunity" }, skippedDependencyFailed: false },
    { step: { capability: "calculate_shipping", forIntentIndex: 1, arguments: {}, dependsOnIntentIndex: 0 }, observation: { tool: "calculate_shipping", status: "blocked", errorCode: "multi_intent_dependency_failed" }, skippedDependencyFailed: true }
  ];

  const outcomes = classifyMultiIntentOutcomes(resolvedIntents, executedSteps);
  assert.equal(outcomes[0].status, "failed");
  assert.equal(outcomes[1].status, "failed");
});

test("[MI-Contract-4] unsupported and needs_clarification intents land in their own response-contract buckets", () => {
  const resolvedIntents: ResolvedIntent[] = [
    { intentIndex: 0, intent: { type: "unsupported", description: "arriendo" }, requirements: [], status: "needs_clarification" }
  ];
  const outcomes = classifyMultiIntentOutcomes(resolvedIntents, []);
  const contract = buildMultiIntentResponseContract(outcomes);
  assert.equal(contract.unsupportedIntents.length, 1);
  assert.equal(contract.needsClarificationIntents.length, 0);
});
