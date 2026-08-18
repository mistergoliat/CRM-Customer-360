import type { CommercialLineItem } from "@/lib/domains/commercial-line-items";
import type { CommercialObjective, CommercialWork, CommercialWorkBlocker, CommercialWorkProjectionInput, CommercialCapabilityExecutionProjection, CommercialEvidenceRef } from "./types";
import { deriveCommercialObjectives } from "./deriveCommercialObjectives";
import { deriveCommercialWorkSteps } from "./deriveCommercialWorkSteps";
import { collectCommercialWorkBlockers, deriveCommercialWorkMetrics, deriveCommercialWorkStatus } from "./evaluateCommercialWork";

function toIso(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return new Date().toISOString();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

function normalizeItems(items: readonly CommercialLineItem[] | undefined): CommercialLineItem[] {
  return [...(items ?? [])]
    .map((item) => ({ productId: item.productId, combinationId: item.combinationId ?? null, quantity: item.quantity }))
    .sort((a, b) => `${a.productId}:${a.combinationId ?? ""}`.localeCompare(`${b.productId}:${b.combinationId ?? ""}`));
}

function sameItems(a: readonly CommercialLineItem[] | undefined, b: readonly CommercialLineItem[] | undefined): boolean {
  const left = normalizeItems(a);
  const right = normalizeItems(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

function requestFactEvidence(factType: NonNullable<CommercialEvidenceRef["factType"]>, id: string | number | undefined): CommercialEvidenceRef[] {
  return id ? [{ kind: "request_fact", factType, id }] : [];
}

function capabilityEvidence(execution: CommercialCapabilityExecutionProjection, stale = false, reason?: string): CommercialEvidenceRef {
  return {
    kind: "capability_execution",
    id: execution.publicId || execution.id,
    capabilityName: execution.capabilityName,
    status: execution.executionStatus,
    stale,
    reason
  };
}

function blocker(code: CommercialWorkBlocker["code"], source: CommercialWorkBlocker["source"], objectiveId?: string): CommercialWorkBlocker {
  return { code, source, ...(objectiveId ? { objectiveId } : {}) };
}

function latestCalculateShippingExecution(executions: readonly CommercialCapabilityExecutionProjection[] | undefined): CommercialCapabilityExecutionProjection | null {
  const candidates = (executions ?? []).filter((execution) => execution.capabilityName === "calculate_shipping");
  return candidates.sort((a, b) => {
    const left = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const right = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return right - left;
  })[0] ?? null;
}

function executionAnchorStatus(input: {
  execution: CommercialCapabilityExecutionProjection | null;
  selectionFactId: string | null;
  destinationFactId: string | null;
}): { status: "fresh" | "stale" | "retryable_failure" | "failed" | "absent"; evidence: CommercialEvidenceRef[]; staleReason?: string } {
  if (!input.execution) return { status: "absent", evidence: [] };
  const payload = input.execution.responseSummaryJson ?? {};
  const selectionFactId = typeof payload.selectionFactId === "string" ? payload.selectionFactId : null;
  const destinationFactId = typeof payload.destinationFactId === "string" ? payload.destinationFactId : null;

  if (input.execution.executionStatus === "completed" && payload.status === "available" && selectionFactId && destinationFactId) {
    if (selectionFactId !== input.selectionFactId) {
      return { status: "stale", evidence: [capabilityEvidence(input.execution, true, "selection_changed")], staleReason: "selection_changed" };
    }
    if (destinationFactId !== input.destinationFactId) {
      return { status: "stale", evidence: [capabilityEvidence(input.execution, true, "destination_changed")], staleReason: "destination_changed" };
    }
    return { status: "fresh", evidence: [capabilityEvidence(input.execution)] };
  }

  if (input.execution.retryable || input.execution.executionStatus === "temporarily_blocked") {
    return { status: "retryable_failure", evidence: [capabilityEvidence(input.execution, false, input.execution.errorCode ?? undefined)] };
  }
  if (input.execution.executionStatus === "failed") return { status: "failed", evidence: [capabilityEvidence(input.execution, false, input.execution.errorCode ?? undefined)] };
  return { status: "absent", evidence: [capabilityEvidence(input.execution)] };
}

function destinationMatches(input: CommercialWorkProjectionInput, objective: CommercialObjective): boolean {
  const destination = input.shippingDestination;
  if (!destination) return false;
  const expectedCommuneId = objective.inputs.communeId;
  if (typeof expectedCommuneId === "number") return destination.communeId === expectedCommuneId;
  const expectedName = objective.inputs.canonicalDestinationName ?? objective.inputs.destinationText;
  if (expectedName) return normalizeText(destination.canonicalName) === normalizeText(expectedName);
  return true;
}

function applyObjectiveState(objective: CommercialObjective, input: CommercialWorkProjectionInput) {
  if (objective.status === "CANCELLED" || objective.status === "SUPERSEDED") return;

  switch (objective.type) {
    case "DISCOVER_PRODUCTS":
    case "COMPARE_PRODUCTS":
    case "RECOMMEND_PRODUCTS":
      objective.status = "READY";
      break;
    case "SELECT_PRODUCTS":
    case "CHANGE_QUANTITY": {
      const requestedItems = objective.inputs.items;
      if (requestedItems && input.commercialLineItems && sameItems(requestedItems, input.commercialLineItems.items)) {
        objective.status = "COMPLETED";
        objective.resolvedInputs.commercialLineItemsFactId = input.commercialLineItems.factId;
        objective.evidence.push(...requestFactEvidence("commercial_line_items", input.commercialLineItems.factId));
        return;
      }
      if (!requestedItems || requestedItems.length === 0) {
        if (!objective.inputs.productReference) {
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("PRODUCT");
          objective.blockers.push(blocker("MISSING_PRODUCT", "objective", objective.objectiveId));
          return;
        }
        if (typeof objective.inputs.quantity !== "number") {
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("QUANTITY");
          objective.blockers.push(blocker("MISSING_QUANTITY", "objective", objective.objectiveId));
          return;
        }
        if (objective.inputs.productEvidenceAvailable === false) {
          // An ambiguous/unresolved product reference needs the customer to
          // pick one, exactly like a missing product name two branches above -
          // WAITING_CUSTOMER, never BLOCKED (BLOCKED means a prior objective
          // must complete first, which does not apply here). Matches
          // objectiveFollowUpPolicies.ts's MISSING_INFORMATION policy, which
          // already lists MISSING_PRODUCT_EVIDENCE as a followup-eligible
          // waiting reason for SELECT_PRODUCTS - that policy only ever
          // applies to a WAITING_CUSTOMER objective.
          objective.status = "WAITING_CUSTOMER";
          objective.missingRequirements.push("PRODUCT_EVIDENCE");
          objective.blockers.push(blocker("MISSING_PRODUCT_EVIDENCE", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
          return;
        }
      }
      objective.status = "READY";
      break;
    }
    case "SET_DESTINATION":
      if (destinationMatches(input, objective)) {
        objective.status = "COMPLETED";
        objective.resolvedInputs.shippingDestinationFactId = input.shippingDestination?.factId;
        objective.evidence.push(...requestFactEvidence("shipping_destination", input.shippingDestination?.factId));
      } else if (objective.inputs.destinationText || objective.inputs.canonicalDestinationName || typeof objective.inputs.communeId === "number") {
        objective.status = "READY";
      } else {
        objective.status = "WAITING_CUSTOMER";
        objective.missingRequirements.push("DESTINATION");
        objective.blockers.push(blocker("MISSING_DESTINATION", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
      }
      break;
    case "GET_SHIPPING_QUOTE": {
      const selectionFactId = input.commercialLineItems?.factId ?? null;
      const destinationFactId = input.shippingDestination?.factId ?? null;
      if (!selectionFactId) {
        objective.status = "BLOCKED";
        objective.missingRequirements.push("SELECTION");
        objective.blockers.push(blocker("MISSING_SELECTION", "objective", objective.objectiveId));
        return;
      }
      objective.resolvedInputs.commercialLineItemsFactId = selectionFactId;
      if (!destinationFactId) {
        objective.missingRequirements.push("DESTINATION");
        if (objective.inputs.destinationText || objective.inputs.canonicalDestinationName || typeof objective.inputs.communeId === "number") {
          objective.status = "BLOCKED";
          objective.blockers.push(blocker("MISSING_DESTINATION", "objective", objective.objectiveId));
        } else {
          objective.status = "WAITING_CUSTOMER";
          objective.blockers.push(blocker("MISSING_DESTINATION", "objective", objective.objectiveId), blocker("WAITING_CUSTOMER", "objective", objective.objectiveId));
        }
        return;
      }
      objective.resolvedInputs.shippingDestinationFactId = destinationFactId;
      const shipping = executionAnchorStatus({
        execution: latestCalculateShippingExecution(input.recentCapabilityExecutions),
        selectionFactId,
        destinationFactId
      });
      objective.evidence.push(...shipping.evidence);
      if (shipping.status === "fresh") {
        objective.status = "COMPLETED";
        objective.resolvedInputs.shippingCalculationExecutionId = String(shipping.evidence[0]?.id ?? "");
      } else if (shipping.status === "retryable_failure") {
        objective.status = "WAITING_SYSTEM";
        objective.blockers.push(blocker("WAITING_SYSTEM", "objective", objective.objectiveId));
      } else if (shipping.status === "failed") {
        objective.status = "FAILED";
      } else {
        if (shipping.status === "stale") objective.blockers.push(blocker("STALE_EVIDENCE", "objective", objective.objectiveId));
        objective.status = "READY";
      }
      break;
    }
    case "SELECT_SHIPPING_OPTION":
      if (input.selectedShippingOption && input.commercialLineItems && input.shippingDestination && input.selectedShippingOption.selectionFactId === input.commercialLineItems.factId && input.selectedShippingOption.destinationFactId === input.shippingDestination.factId) {
        objective.status = "COMPLETED";
        objective.resolvedInputs.selectedShippingOptionFactId = input.selectedShippingOption.factId;
        objective.evidence.push(...requestFactEvidence("selected_shipping_option", input.selectedShippingOption.factId));
      } else {
        const shipping = executionAnchorStatus({
          execution: latestCalculateShippingExecution(input.recentCapabilityExecutions),
          selectionFactId: input.commercialLineItems?.factId ?? null,
          destinationFactId: input.shippingDestination?.factId ?? null
        });
        if (shipping.status === "fresh" && typeof objective.inputs.optionIndex === "number") {
          objective.status = "READY";
          objective.evidence.push(...shipping.evidence);
        } else {
          objective.status = "BLOCKED";
          objective.missingRequirements.push("SHIPPING");
          objective.blockers.push(blocker("MISSING_SHIPPING", "objective", objective.objectiveId));
        }
      }
      break;
    case "CREATE_QUOTE": {
      const selectionFactId = input.commercialLineItems?.factId ?? null;
      if (!selectionFactId) {
        objective.status = "BLOCKED";
        objective.missingRequirements.push("SELECTION");
        objective.blockers.push(blocker("MISSING_SELECTION", "objective", objective.objectiveId));
        return;
      }
      objective.resolvedInputs.commercialLineItemsFactId = selectionFactId;
      if (input.createdQuote && input.createdQuote.selectionFactId === selectionFactId) {
        objective.status = "COMPLETED";
        objective.resolvedInputs.createdQuoteFactId = input.createdQuote.factId;
        objective.evidence.push(...requestFactEvidence("created_quote", input.createdQuote.factId));
      } else {
        if (input.createdQuote && input.createdQuote.selectionFactId !== selectionFactId) {
          objective.evidence.push({ kind: "request_fact", factType: "created_quote", id: input.createdQuote.factId, stale: true, reason: "selection_changed" });
          objective.blockers.push(blocker("STALE_EVIDENCE", "objective", objective.objectiveId));
        }
        objective.status = "READY";
      }
      break;
    }
    case "HANDOFF":
      objective.status = "COMPLETED";
      objective.evidence.push({ kind: "conversation_state", status: "handoff" });
      break;
  }
}

function applyConversationAutonomy(input: CommercialWorkProjectionInput, objectives: CommercialObjective[]): CommercialWorkBlocker[] {
  const blockers: CommercialWorkBlocker[] = [];
  if (input.conversation.humanOwnerActive) blockers.push({ code: "HUMAN_OWNER_ACTIVE", source: "conversation", evidence: [{ kind: "conversation_state", id: input.conversation.id, status: "human_owner_active" }] });
  if (!input.conversation.aiEnabled) blockers.push({ code: "AI_DISABLED", source: "conversation", evidence: [{ kind: "conversation_state", id: input.conversation.id, status: "ai_disabled" }] });
  if (blockers.length === 0) return blockers;

  for (const objective of objectives) {
    if (objective.status !== "COMPLETED" && objective.status !== "CANCELLED" && objective.status !== "SUPERSEDED") {
      objective.status = "BLOCKED";
      objective.blockers.push(...blockers.map((item) => ({ ...item, source: "objective" as const, objectiveId: objective.objectiveId })));
    }
  }
  return blockers;
}

function applyPendingMutationInvalidations(objectives: CommercialObjective[]) {
  const pendingSelectionMutation = objectives.some(
    (objective) =>
      (objective.type === "SELECT_PRODUCTS" || objective.type === "CHANGE_QUANTITY") &&
      (objective.status === "READY" || objective.status === "WAITING_CUSTOMER" || objective.status === "BLOCKED")
  );
  const pendingDestinationMutation = objectives.some(
    (objective) =>
      objective.type === "SET_DESTINATION" &&
      (objective.status === "READY" || objective.status === "WAITING_CUSTOMER" || objective.status === "BLOCKED")
  );

  if (!pendingSelectionMutation && !pendingDestinationMutation) return;

  for (const objective of objectives) {
    if (objective.type !== "GET_SHIPPING_QUOTE" || objective.status === "CANCELLED" || objective.status === "SUPERSEDED") continue;
    if (pendingSelectionMutation) {
      objective.status = "BLOCKED";
      if (!objective.missingRequirements.includes("SELECTION")) objective.missingRequirements.push("SELECTION");
      objective.blockers.push({ code: "STALE_EVIDENCE", source: "objective", objectiveId: objective.objectiveId });
      objective.blockers.push({ code: "MISSING_SELECTION", source: "objective", objectiveId: objective.objectiveId });
    } else if (pendingDestinationMutation) {
      objective.status = "BLOCKED";
      if (!objective.missingRequirements.includes("DESTINATION")) objective.missingRequirements.push("DESTINATION");
      objective.blockers.push({ code: "STALE_EVIDENCE", source: "objective", objectiveId: objective.objectiveId });
      objective.blockers.push({ code: "MISSING_DESTINATION", source: "objective", objectiveId: objective.objectiveId });
    }
  }
}

function sequenceFromTrigger(trigger: CommercialWorkProjectionInput["trigger"]): number | null {
  const commercialSequence = "commercialSequence" in trigger ? trigger.commercialSequence : null;
  if (typeof commercialSequence === "number" && Number.isSafeInteger(commercialSequence) && commercialSequence > 0) return commercialSequence;
  if (trigger.type === "CUSTOMER_MESSAGE" && typeof trigger.sourceMessageSequence === "number" && Number.isSafeInteger(trigger.sourceMessageSequence) && trigger.sourceMessageSequence > 0) {
    return trigger.sourceMessageSequence;
  }
  return null;
}

export function buildCommercialWorkProjection(input: CommercialWorkProjectionInput): CommercialWork {
  const derivedAt = toIso(input.now);
  const sourceMessageId = input.trigger.type === "CUSTOMER_MESSAGE" ? input.trigger.sourceMessageId : null;
  const sourceSequence = sequenceFromTrigger(input.trigger);
  const opportunityId = input.opportunity?.id ?? (input.trigger.type === "CUSTOMER_MESSAGE" ? input.trigger.opportunityId : null);
  const id = `projection:${input.conversation.id}:${sourceMessageId ?? "no-message"}`;
  const objectives = deriveCommercialObjectives({
    seeds: input.objectiveSeeds ?? [],
    pendingCommercialIntents: input.pendingCommercialIntents,
    seedIdPrefix: id
  });

  for (const objective of objectives) applyObjectiveState(objective, input);
  applyPendingMutationInvalidations(objectives);
  const conversationBlockers = applyConversationAutonomy(input, objectives);
  const steps = deriveCommercialWorkSteps(objectives);
  if (conversationBlockers.length > 0) {
    for (const step of steps) {
      if (step.status !== "COMPLETED" && step.status !== "CANCELLED" && step.status !== "SUPERSEDED") {
        step.status = "BLOCKED";
        step.blockers.push(...conversationBlockers.map((item) => ({ ...item, source: "step" as const, stepId: step.stepId })));
      }
    }
  }

  const partial = { objectives, steps };
  const blockers = collectCommercialWorkBlockers(partial, conversationBlockers);
  const status = deriveCommercialWorkStatus({ objectives, steps, blockers });
  const workWithoutMetrics = {
    id,
    projectionVersion: 1 as const,
    opportunityId,
    conversationId: input.conversation.id,
    sourceMessageId,
    sourceSequence,
    lastReconciledSequence: sourceSequence,
    previousWorkPublicId: null,
    supersedesWorkPublicId: null,
    trigger: input.trigger,
    status,
    objectives,
    steps,
    blockers,
    derivedAt,
    metrics: { objectiveCount: 0, readyStepCount: 0, waitingCustomerObjectiveCount: 0, waitingSystemStepCount: 0, blockerCount: 0 }
  };
  return { ...workWithoutMetrics, metrics: deriveCommercialWorkMetrics(workWithoutMetrics) };
}
