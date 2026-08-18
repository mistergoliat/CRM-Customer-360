import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateObjectiveFollowUpEligibility,
  mapObjectiveToFollowUpPolicy,
  type CommercialObjective,
  type CommercialWork
} from "@/lib/brain/commercial/work";

const objective: CommercialObjective = {
  objectiveId: "objective-missing-destination",
  type: "GET_SHIPPING_QUOTE",
  status: "WAITING_CUSTOMER",
  origin: "customer_requested",
  inputs: {},
  resolvedInputs: { commercialLineItemsFactId: "selection-fact" },
  missingRequirements: ["DESTINATION"],
  supersedesObjectiveIds: [],
  evidence: [{ kind: "request_fact", factType: "commercial_line_items", id: "selection-fact" }],
  blockers: [{ code: "MISSING_DESTINATION", source: "objective", objectiveId: "objective-missing-destination" }]
};

const work: CommercialWork = {
  id: "cw-public-1",
  projectionVersion: 1,
  opportunityId: 10,
  conversationId: 20,
  sourceMessageId: null,
  sourceSequence: null,
  lastReconciledSequence: null,
  previousWorkPublicId: null,
  supersedesWorkPublicId: null,
  trigger: { type: "CUSTOMER_MESSAGE", conversationId: 20, opportunityId: 10, sourceMessageId: null },
  status: "WAITING_CUSTOMER",
  objectives: [objective],
  steps: [],
  blockers: objective.blockers,
  derivedAt: "2026-08-17T12:00:00.000Z",
  metrics: { objectiveCount: 1, readyStepCount: 0, waitingCustomerObjectiveCount: 1, waitingSystemStepCount: 0, blockerCount: 1 }
};

test("CWFU eligibility is deterministic and maps missing destination to MISSING_INFORMATION", () => {
  assert.equal(mapObjectiveToFollowUpPolicy(objective), "MISSING_INFORMATION");
  const result = evaluateObjectiveFollowUpEligibility({
    work,
    objective,
    conversation: { id: 20, aiEnabled: true, humanOwnerActive: false, status: "open" },
    opportunity: { id: 10, status: "open" },
    currentTime: "2026-08-17T12:00:00.000Z",
    commercialWorkPublicId: work.id
  });
  assert.equal(result.status, "ELIGIBLE");
  assert.equal(result.policy, "MISSING_INFORMATION");
  assert.equal(result.waitingReason, "MISSING_DESTINATION");
  assert.equal(result.nextAttempt, 1);
});

test("CWFU WAITING_SYSTEM, handoff, AI-disabled, opt-out, terminal opportunity and duplicates are blocked without LLM", () => {
  assert.equal(evaluateObjectiveFollowUpEligibility({ work: { ...work, status: "WAITING_SYSTEM" }, objective, conversation: { id: 20, aiEnabled: true, humanOwnerActive: false }, opportunity: { id: 10, status: "open" }, currentTime: "2026-08-17T12:00:00.000Z" }).reason, "work_not_waiting_customer");
  assert.equal(evaluateObjectiveFollowUpEligibility({ work, objective, conversation: { id: 20, aiEnabled: true, humanOwnerActive: true }, opportunity: { id: 10, status: "open" }, currentTime: "2026-08-17T12:00:00.000Z" }).reason, "conversation_handoff");
  assert.equal(evaluateObjectiveFollowUpEligibility({ work, objective, conversation: { id: 20, aiEnabled: false, humanOwnerActive: false }, opportunity: { id: 10, status: "open" }, currentTime: "2026-08-17T12:00:00.000Z" }).reason, "conversation_ai_disabled");
  assert.equal(evaluateObjectiveFollowUpEligibility({ work, objective, conversation: { id: 20, aiEnabled: true, humanOwnerActive: false }, opportunity: { id: 10, status: "open" }, currentTime: "2026-08-17T12:00:00.000Z", customerOptedOut: true }).reason, "customer_opted_out");
  assert.equal(evaluateObjectiveFollowUpEligibility({ work, objective, conversation: { id: 20, aiEnabled: true, humanOwnerActive: false }, opportunity: { id: 10, status: "lost" }, currentTime: "2026-08-17T12:00:00.000Z" }).reason, "opportunity_terminal");
  const duplicate = evaluateObjectiveFollowUpEligibility({
    work,
    objective,
    conversation: { id: 20, aiEnabled: true, humanOwnerActive: false },
    opportunity: { id: 10, status: "open" },
    existingFollowUpActions: [{ policy: "MISSING_INFORMATION", commercialWorkPublicId: work.id, commercialObjectivePublicId: objective.objectiveId, attempt: 1, status: "planned" }],
    currentTime: "2026-08-17T12:00:00.000Z",
    commercialWorkPublicId: work.id
  });
  assert.equal(duplicate.status, "ALREADY_SCHEDULED");
});
