import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS, planCommercialFollowUp } from "../../lib/brain/commercial/follow-up-planner";
import {
  buildFollowUpPlanningInput,
  isFollowUpActiveStatus,
  isFollowUpAttemptConsumingStatus,
  mapFollowUpPlanStatusToActionStatus,
  mapFollowUpPlanStatusToPolicyStatus
} from "../../lib/brain/commercial/sales-consultative/followUpPlanAdapter";
import type { SalesConsultativeOpportunity } from "../../lib/brain/commercial/sales-consultative/types";

const CURRENT_TIME = "2026-06-20T15:00:00.000Z";

function makeOpportunity(overrides: Partial<SalesConsultativeOpportunity> = {}): SalesConsultativeOpportunity {
  return {
    id: "opp-adapter-001",
    opportunityKey: "sales-consultative:opp-adapter-001",
    status: "engaged",
    stage: "recommendation",
    primaryIntent: "product_inquiry",
    currentSummary: "Cliente pregunto por la maquina de remo, sin cerrar aun.",
    nextActionType: "schedule_follow_up",
    nextActionDueAt: null,
    waitingFor: null,
    humanOwnerActive: false,
    aiBlocked: false,
    customerCandidateId: null,
    customerMasterId: null,
    leadId: null,
    conversationCaseId: 501,
    waId: "56911112222",
    requirements: [],
    missingRequirements: [],
    productInterests: ["maquina de remo"],
    objections: [],
    signals: ["product_interest_present"],
    version: 2,
    // Safely in the past relative to CURRENT_TIME so the planner's cooldown
    // fallback (opportunity.lastActivityAt) does not self-block a first plan.
    lastActivityAt: "2026-06-18T10:00:00.000Z",
    closedAt: null,
    ...overrides
  };
}

test("adapta el contexto real de sales-consultative a CommercialFollowUpPlanningInput", () => {
  const opportunity = makeOpportunity();
  const input = buildFollowUpPlanningInput({
    opportunity,
    draftMessage: "Te escribo para saber si sigues interesado.",
    dueAt: "2026-06-21T15:00:00.000Z",
    currentTime: CURRENT_TIME,
    priorAttemptNumber: 0
  });

  assert.equal(input.now, CURRENT_TIME);
  assert.equal(input.opportunity?.id, "opp-adapter-001");
  assert.equal(input.opportunity?.primaryIntent, "product_inquiry");
  assert.equal(input.opportunity?.currentSummary, opportunity.currentSummary);
  assert.deepEqual(input.opportunity?.productInterests, opportunity.productInterests);
  assert.equal(input.conversation.waId, "56911112222");
  assert.equal(input.conversation.channel, "whatsapp");
  assert.equal(input.conversation.lastOutboundText, "Te escribo para saber si sigues interesado.");
  // No redundant queries: case-level status is not loaded at this call site.
  assert.equal(input.caseContext, null);
});

test("dueAt de sales-consultative se traduce en policy.defaultDelayHours, no en scheduledFor directo", () => {
  const opportunity = makeOpportunity();
  const dueAt = "2026-06-21T15:00:00.000Z"; // 24h after CURRENT_TIME
  const input = buildFollowUpPlanningInput({
    opportunity,
    draftMessage: "seguimiento",
    dueAt,
    currentTime: CURRENT_TIME,
    priorAttemptNumber: 0
  });

  assert.equal(input.policy.defaultDelayHours, 24);

  const plan = planCommercialFollowUp(input);
  assert.equal(plan.status, "recommended");
  // scheduledFor is computed by the planner from policy.defaultDelayHours,
  // not copied verbatim from the old dueAt/nextActionDueAt field.
  assert.equal(plan.scheduledFor, "2026-06-21T15:00:00.000Z");
});

test("attemptNumber se deriva del historial durable, no de un valor fijo", () => {
  const opportunity = makeOpportunity();

  const firstAttempt = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity,
      draftMessage: "seguimiento",
      dueAt: null,
      currentTime: CURRENT_TIME,
      priorAttemptNumber: 0
    })
  );
  assert.equal(firstAttempt.attemptNumber, 1);

  const secondAttempt = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity,
      draftMessage: "seguimiento",
      dueAt: null,
      currentTime: CURRENT_TIME,
      priorAttemptNumber: 2
    })
  );
  assert.equal(secondAttempt.attemptNumber, 3);
});

test("maxAttempts y policyStatus del plan no quedan hardcodeados a 1/allowed", () => {
  const opportunity = makeOpportunity();
  const plan = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity,
      draftMessage: "seguimiento",
      dueAt: null,
      currentTime: CURRENT_TIME,
      priorAttemptNumber: 0
    })
  );

  assert.notEqual(plan.maxAttempts, 1);
  assert.equal(plan.maxAttempts, COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS);
  assert.notEqual(plan.status as string, "allowed");
  assert.equal(plan.status, "recommended");
});

test("maxAttempts viene de la fuente canonica COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS, no de un literal enterrado en el adapter", () => {
  const opportunity = makeOpportunity();

  const defaultPlan = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity,
      draftMessage: "seguimiento",
      dueAt: null,
      currentTime: CURRENT_TIME,
      priorAttemptNumber: 0
    })
  );
  assert.equal(defaultPlan.maxAttempts, COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS);

  // Test-only injection point: proves the value is a real parameter, not a
  // hardcoded literal duplicated inside the adapter.
  const overriddenPlan = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity,
      draftMessage: "seguimiento",
      dueAt: null,
      currentTime: CURRENT_TIME,
      priorAttemptNumber: 0,
      maxAttempts: 1
    })
  );
  assert.equal(overriddenPlan.maxAttempts, 1);
  assert.notEqual(overriddenPlan.maxAttempts, COMMERCIAL_FOLLOW_UP_DEFAULT_MAX_ATTEMPTS);
});

test("un plan bloqueado no mapea a una accion planned", () => {
  const opportunity = makeOpportunity({ aiBlocked: true });
  const plan = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity,
      draftMessage: "seguimiento",
      dueAt: null,
      currentTime: CURRENT_TIME,
      priorAttemptNumber: 0
    })
  );

  assert.equal(plan.status, "blocked");
  assert.equal(mapFollowUpPlanStatusToActionStatus(plan.status), null);
});

test("un plan que requiere revision mapea a requires_review", () => {
  // payment_or_checkout_followup always requires manager_review in the planner,
  // which resolves to plan.status = requires_operator_review.
  const opportunity = makeOpportunity({
    primaryIntent: "checkout",
    currentSummary: "Cliente pregunto por el pago y checkout del pedido.",
    signals: ["checkout_pending"]
  });
  const plan = planCommercialFollowUp(
    buildFollowUpPlanningInput({
      opportunity,
      draftMessage: "seguimiento de pago",
      dueAt: null,
      currentTime: CURRENT_TIME,
      priorAttemptNumber: 0
    })
  );

  assert.equal(plan.status, "requires_operator_review");
  assert.equal(mapFollowUpPlanStatusToActionStatus(plan.status), "requires_review");
});

test("mapFollowUpPlanStatusToActionStatus cubre recommended y requires_operator_review unicamente", () => {
  assert.equal(mapFollowUpPlanStatusToActionStatus("recommended"), "planned");
  assert.equal(mapFollowUpPlanStatusToActionStatus("requires_operator_review"), "requires_review");
  for (const status of ["blocked", "not_needed", "cancelled", "expired", "invalid"]) {
    assert.equal(mapFollowUpPlanStatusToActionStatus(status), null);
  }
});

test("mapFollowUpPlanStatusToPolicyStatus es un mapeo separado de action.status, no plan.status crudo", () => {
  assert.equal(mapFollowUpPlanStatusToPolicyStatus("recommended"), "allowed");
  assert.equal(mapFollowUpPlanStatusToPolicyStatus("requires_operator_review"), "requires_review");
  for (const status of ["blocked", "not_needed", "cancelled", "expired", "invalid"]) {
    assert.equal(mapFollowUpPlanStatusToPolicyStatus(status), null);
  }

  // The two mappings are independently testable and diverge in value for
  // "recommended" (policy_status=allowed vs action.status=planned) - proving
  // plan.status is never persisted verbatim as policy_status.
  assert.notEqual(mapFollowUpPlanStatusToPolicyStatus("recommended"), mapFollowUpPlanStatusToActionStatus("recommended"));
});

test("recommended y requires_operator_review producen policy_status y action.status correctos y distintos entre si", () => {
  const opportunity = makeOpportunity();
  const recommendedPlan = planCommercialFollowUp(
    buildFollowUpPlanningInput({ opportunity, draftMessage: "seguimiento", dueAt: null, currentTime: CURRENT_TIME, priorAttemptNumber: 0 })
  );
  assert.equal(recommendedPlan.status, "recommended");
  assert.equal(mapFollowUpPlanStatusToActionStatus(recommendedPlan.status), "planned");
  assert.equal(mapFollowUpPlanStatusToPolicyStatus(recommendedPlan.status), "allowed");

  const reviewOpportunity = makeOpportunity({
    primaryIntent: "checkout",
    currentSummary: "Cliente pregunto por el pago y checkout del pedido.",
    signals: ["checkout_pending"]
  });
  const reviewPlan = planCommercialFollowUp(
    buildFollowUpPlanningInput({ opportunity: reviewOpportunity, draftMessage: "seguimiento de pago", dueAt: null, currentTime: CURRENT_TIME, priorAttemptNumber: 0 })
  );
  assert.equal(reviewPlan.status, "requires_operator_review");
  assert.equal(mapFollowUpPlanStatusToActionStatus(reviewPlan.status), "requires_review");
  assert.equal(mapFollowUpPlanStatusToPolicyStatus(reviewPlan.status), "requires_review");
});

test("isFollowUpActiveStatus reconoce exclusivamente planned/requires_review/executing", () => {
  assert.equal(isFollowUpActiveStatus("planned"), true);
  assert.equal(isFollowUpActiveStatus("requires_review"), true);
  assert.equal(isFollowUpActiveStatus("executing"), true);
  for (const status of ["executed", "failed", "rejected", "blocked", "cancelled", "expired", "draft", "proposed", "approved", "edited", "scheduled", "some_future_status"]) {
    assert.equal(isFollowUpActiveStatus(status), false, `${status} must not be treated as active`);
  }
});

test("isFollowUpAttemptConsumingStatus reconoce exclusivamente executing/executed/failed", () => {
  assert.equal(isFollowUpAttemptConsumingStatus("executing"), true);
  assert.equal(isFollowUpAttemptConsumingStatus("executed"), true);
  assert.equal(isFollowUpAttemptConsumingStatus("failed"), true);
  for (const status of ["rejected", "blocked", "cancelled", "expired", "planned", "requires_review", "draft", "proposed", "some_future_status"]) {
    assert.equal(isFollowUpAttemptConsumingStatus(status), false, `${status} must not consume an attempt`);
  }
});
