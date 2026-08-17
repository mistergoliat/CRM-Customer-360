import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionCommercialWorkStatus,
  canTransitionObjectiveStatus,
  canTransitionStepStatus,
  describeAllowedCommercialWorkTransitions,
  describeAllowedObjectiveTransitions,
  describeAllowedStepTransitions
} from "@/lib/brain/commercial/work";

test("A04-T01 work transitions allow active/wait states and reject terminal reopening", () => {
  assert.equal(canTransitionCommercialWorkStatus("ACTIVE", "WAITING_CUSTOMER"), true);
  assert.equal(canTransitionCommercialWorkStatus("ACTIVE", "WAITING_SYSTEM"), true);
  assert.equal(canTransitionCommercialWorkStatus("WAITING_CUSTOMER", "ACTIVE"), true);
  assert.equal(canTransitionCommercialWorkStatus("WAITING_SYSTEM", "ACTIVE"), true);
  assert.equal(canTransitionCommercialWorkStatus("ACTIVE", "COMPLETED"), true);
  assert.equal(canTransitionCommercialWorkStatus("ACTIVE", "CANCELLED"), true);
  assert.equal(canTransitionCommercialWorkStatus("ACTIVE", "SUPERSEDED"), true);
  assert.equal(canTransitionCommercialWorkStatus("ACTIVE", "HANDOFF"), true);
  assert.equal(canTransitionCommercialWorkStatus("ACTIVE", "FAILED"), true);
  assert.equal(canTransitionCommercialWorkStatus("COMPLETED", "SUPERSEDED"), true);
  assert.equal(canTransitionCommercialWorkStatus("COMPLETED", "ACTIVE"), false);
  assert.equal(canTransitionCommercialWorkStatus("CANCELLED", "ACTIVE"), false);
  assert.equal(canTransitionCommercialWorkStatus("SUPERSEDED", "COMPLETED"), false);
  assert.deepEqual(describeAllowedCommercialWorkTransitions("COMPLETED"), ["SUPERSEDED"]);
});

test("A04-T02 objective transitions allow recovery/supersession and reject completed reopening", () => {
  assert.equal(canTransitionObjectiveStatus("PENDING", "READY"), true);
  assert.equal(canTransitionObjectiveStatus("READY", "COMPLETED"), true);
  assert.equal(canTransitionObjectiveStatus("WAITING_CUSTOMER", "READY"), true);
  assert.equal(canTransitionObjectiveStatus("WAITING_SYSTEM", "READY"), true);
  assert.equal(canTransitionObjectiveStatus("BLOCKED", "READY"), true);
  assert.equal(canTransitionObjectiveStatus("COMPLETED", "SUPERSEDED"), true);
  assert.equal(canTransitionObjectiveStatus("COMPLETED", "READY"), false);
  assert.equal(canTransitionObjectiveStatus("CANCELLED", "READY"), false);
  assert.equal(canTransitionObjectiveStatus("SUPERSEDED", "COMPLETED"), false);
  assert.ok(describeAllowedObjectiveTransitions("WAITING_CUSTOMER").includes("READY"));
});

test("A04-T03 step transitions match V1 execution states and block completed reopening", () => {
  assert.equal(canTransitionStepStatus("PENDING", "READY"), true);
  assert.equal(canTransitionStepStatus("READY", "COMPLETED"), true);
  assert.equal(canTransitionStepStatus("WAITING_SYSTEM", "READY"), true);
  assert.equal(canTransitionStepStatus("WAITING_SYSTEM", "RETRY_SCHEDULED"), true);
  assert.equal(canTransitionStepStatus("RETRY_SCHEDULED", "READY"), true);
  assert.equal(canTransitionStepStatus("BLOCKED", "READY"), true);
  assert.equal(canTransitionStepStatus("COMPLETED", "SUPERSEDED"), true);
  assert.equal(canTransitionStepStatus("COMPLETED", "READY"), false);
  assert.equal(canTransitionStepStatus("CANCELLED", "READY"), false);
  assert.equal(canTransitionStepStatus("SUPERSEDED", "COMPLETED"), false);
  assert.ok(describeAllowedStepTransitions("READY").includes("COMPLETED"));
});
