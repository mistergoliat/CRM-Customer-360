import assert from "node:assert/strict";
import test from "node:test";
import { executeCommercialActionPlan } from "@/lib/brain/commercial/multi-intent/actionPlanExecutor";
import type { PlannedActionStep } from "@/lib/brain/commercial/multi-intent/types";
import type { CapabilityGatewayContext } from "@/lib/brain/commercial/capability-gateway/types";

// No opportunityId -> select_products.execute() denies with "no_active_opportunity"
// before ever touching Catalog/DB (selectProductsCapability.ts's own first
// check) - deterministic, no HTTP/DB fixtures needed for this file at all.
const gatewayContextWithoutOpportunity: CapabilityGatewayContext = { correlationId: "test-correlation", conversationId: null, opportunityId: null };

// Part 21 test 12: calculate_shipping never runs (never even reaches the Gateway) when the select_products step it depends on did not complete.
test("[MI-Exec-1] a step whose dependsOnIntentIndex names a failed intent is skipped, never sent to the Gateway", async () => {
  const steps: PlannedActionStep[] = [
    { capability: "select_products", forIntentIndex: 0, arguments: { items: [{ productId: "31", quantity: 1 }] } },
    { capability: "calculate_shipping", forIntentIndex: 1, arguments: {}, dependsOnIntentIndex: 0 }
  ];

  const { executedSteps, stepRecords } = await executeCommercialActionPlan(steps, gatewayContextWithoutOpportunity);

  assert.equal(executedSteps[0].observation.status, "blocked", "select_products denies without an opportunityId");
  assert.equal(executedSteps[0].skippedDependencyFailed, false, "the first step itself has no dependency - it genuinely failed, not skipped");

  assert.equal(executedSteps[1].skippedDependencyFailed, true);
  assert.equal(executedSteps[1].observation.status, "blocked");
  assert.equal(executedSteps[1].observation.errorCode, "multi_intent_dependency_failed");
  assert.equal(stepRecords[1].observation?.errorCode, "multi_intent_dependency_failed");
});

test("[MI-Exec-2] an independent step (no dependsOnIntentIndex) always reaches the Gateway, even after an earlier step failed", async () => {
  const steps: PlannedActionStep[] = [
    { capability: "select_products", forIntentIndex: 0, arguments: { items: [{ productId: "31", quantity: 1 }] } },
    { capability: "set_shipping_destination", forIntentIndex: 1, arguments: { destination: "Ñuñoa" } }
  ];

  const { executedSteps } = await executeCommercialActionPlan(steps, gatewayContextWithoutOpportunity);

  assert.equal(executedSteps[0].observation.status, "blocked");
  assert.equal(executedSteps[1].skippedDependencyFailed, false);
  // set_shipping_destination also denies without an opportunityId, but it reached the Gateway - it was never skipped by the dependency mechanism.
  assert.equal(executedSteps[1].observation.errorCode, "no_active_opportunity");
});

test("[MI-Exec-3] every executed step is projected as an AgentLoopStepRecord (use_tool/observation/gathering phase) - the same shape the legacy loop produces", async () => {
  const steps: PlannedActionStep[] = [{ capability: "select_products", forIntentIndex: 0, arguments: { items: [{ productId: "31", quantity: 1 }] } }];
  const { stepRecords } = await executeCommercialActionPlan(steps, gatewayContextWithoutOpportunity);
  assert.equal(stepRecords.length, 1);
  assert.equal(stepRecords[0].step.type, "use_tool");
  assert.equal(stepRecords[0].phase, "gathering");
  assert.equal(stepRecords[0].governance, "authorized");
});
