import { listActiveConversationRequests, loadConversationRequest } from "../conversation-request";
import type { ConversationRequest } from "../conversation-request";
import { applyRequestReduction } from "../request-definitions";
import type { ApplyRequestReductionResult } from "../request-definitions";
import { aggregateOpportunityProjection } from "./aggregateOpportunityProjection";
import type { OpportunityProjectionPlan } from "./aggregateOpportunityProjection";
import { isRequestTrackingEnabled } from "../conversation-request";
import { isTurnPlanPersistenceEnabled, MULTI_REQUEST_RUNTIME_VERSION } from "./constants";
import { markTurnPlanExecuted, markTurnPlanFailed } from "./persistTurnPlan";
import { persistRequestOperations } from "./persistRequestOperations";
import type { AppliedRequestOperation } from "./persistRequestOperations";
import { planTurn } from "./planTurn";
import type { TurnPlannerProvider } from "./turnPlannerProvider";
import { reduceRequests } from "./reduceRequests";
import type { ReducedRequestState } from "./reduceRequests";
import { buildGroundedResponseInput, generateGroundedResponse } from "./groundedResponse";
import type { GroundedResponseProvider, GroundedResponseResult } from "./groundedResponse";
import { persistProposedFacts } from "./persistProposedFacts";
import { listDeferredActionsForRequest } from "./deferredActions";
import { isRequestFactsEnabled } from "../request-facts";
import type { RequestFact } from "../request-facts";
import type { TurnPlanRecord } from "./turnPlanTypes";

export type MultiRequestCycleInput = {
  conversationId: number;
  /** Internal conversation_message id of the inbound turn. */
  inboundMessageId: string;
  messageText: string;
  correlationId: string;
  provider?: TurnPlannerProvider | null;
  responseProvider?: GroundedResponseProvider | null;
};

export type MultiRequestCycleResult = {
  ran: boolean;
  reason: string | null;
  version: typeof MULTI_REQUEST_RUNTIME_VERSION;
  turnPlan: TurnPlanRecord | null;
  planReused: boolean;
  appliedOperations: AppliedRequestOperation[];
  activeRequests: ConversationRequest[];
  reducedStates: ReducedRequestState[];
  opportunityProjections: OpportunityProjectionPlan[];
  persistedFacts: RequestFact[];
  definitionReductions: ApplyRequestReductionResult[];
  /** Drafted only - this cycle never sends; the outbox integration consumes it. */
  responseDraft: GroundedResponseResult | null;
  warnings: string[];
};

function emptyResult(reason: string, warnings: string[] = []): MultiRequestCycleResult {
  return {
    ran: false,
    reason,
    version: MULTI_REQUEST_RUNTIME_VERSION,
    turnPlan: null,
    planReused: false,
    appliedOperations: [],
    activeRequests: [],
    reducedStates: [],
    opportunityProjections: [],
    persistedFacts: [],
    definitionReductions: [],
    responseDraft: null,
    warnings
  };
}

/**
 * Multi-request turn cycle: one persisted plan per inbound message, request
 * operations applied idempotently, deterministic reduction, and an aggregated
 * opportunity projection. Tool execution and the grounded response arrive in
 * later blocks; this cycle never sends anything by itself.
 */
export async function runMultiRequestAutonomousCycle(input: MultiRequestCycleInput): Promise<MultiRequestCycleResult> {
  if (!isRequestTrackingEnabled() || !isTurnPlanPersistenceEnabled()) {
    // Dependency guard from the flag matrix: the runtime never half-activates.
    return emptyResult("multi_request_dependencies_disabled", ["BRAIN_REQUEST_TRACKING_ENABLED and BRAIN_TURN_PLAN_PERSISTENCE_ENABLED are required"]);
  }
  if (!input.inboundMessageId?.trim()) {
    return emptyResult("missing_inbound_message_id");
  }

  const warnings: string[] = [];
  const activeBefore = await listActiveConversationRequests(input.conversationId);

  const planned = await planTurn({
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    messageText: input.messageText,
    correlationId: input.correlationId,
    activeRequests: activeBefore,
    provider: input.provider ?? null
  });

  if (!planned.ok) {
    return emptyResult(`turn_plan_${planned.status}`, [...planned.warnings, ...(planned.issues ?? []).map((issue) => `${issue.code}:${issue.message}`)]);
  }

  const record = planned.record;
  const operations = await persistRequestOperations(record);
  warnings.push(...operations.warnings);

  let persistedFacts: RequestFact[] = [];
  if (isRequestFactsEnabled()) {
    const factsResult = await persistProposedFacts(record, operations.requestIdsByDetection);
    persistedFacts = factsResult.facts;
    warnings.push(...factsResult.warnings);
  }

  const reduction = await reduceRequests(operations.applied);
  warnings.push(...reduction.warnings);

  // Deterministic definition reduction over the requests touched this turn:
  // only observed events resolve/escalate; missing required facts wait.
  const definitionReductions: ApplyRequestReductionResult[] = [];
  const reducedIds = new Set<string>();
  for (const applied of operations.applied) {
    if (!applied.requestId || reducedIds.has(applied.requestId)) continue;
    reducedIds.add(applied.requestId);
    const current = await loadConversationRequest(applied.requestId);
    if (!current) continue;
    const result = await applyRequestReduction(current);
    definitionReductions.push(result);
    if (result.warning) warnings.push(`definition_reduction_failed:${applied.requestId}:${result.warning}`);
  }

  const activeAfter = await listActiveConversationRequests(input.conversationId);
  const projections = aggregateOpportunityProjection(activeAfter, record.turnPlanId);

  const missingFacts = definitionReductions.flatMap((result) =>
    result.decision.reasons
      .filter((reason) => reason.startsWith("missing_required_fact:"))
      .map((reason) => ({
        requestId: result.decision.requestId,
        factKey: reason.slice("missing_required_fact:".length),
        question: null
      }))
  );

  // Pending work already deferred for these requests is told to the customer
  // honestly ("quede pendiente de..."), never claimed as done.
  const deferredActions: { requestId: string; actionType: string; reason: string }[] = [];
  for (const requestId of reducedIds) {
    const deferred = await listDeferredActionsForRequest(requestId);
    deferredActions.push(...deferred.map((action) => ({ requestId, actionType: action.actionType, reason: action.reason })));
  }

  const responseDraft = await generateGroundedResponse(
    buildGroundedResponseInput({
      customerMessage: input.messageText,
      activeRequests: activeAfter,
      appliedOperations: operations.applied,
      missingFacts,
      deferredActions
    }),
    input.responseProvider ?? null
  );
  warnings.push(...responseDraft.warnings);

  let finalRecord = record;
  const failedOperations = operations.applied.filter((operation) => operation.status === "failed");
  if (failedOperations.length > 0 && failedOperations.length === operations.applied.length) {
    const marked = await markTurnPlanFailed(record.turnPlanId, "all_operations_failed");
    if (marked.record) finalRecord = marked.record;
  } else {
    const marked = await markTurnPlanExecuted(record.turnPlanId);
    // A reused plan is usually executed already; that conflict is expected.
    if (!marked.ok && marked.status !== "conflict") warnings.push(`turn_plan_mark_failed:${marked.warning}`);
    if (marked.record) finalRecord = marked.record;
  }

  return {
    ran: true,
    reason: null,
    version: MULTI_REQUEST_RUNTIME_VERSION,
    turnPlan: finalRecord,
    planReused: planned.status === "reused",
    appliedOperations: operations.applied,
    activeRequests: activeAfter,
    reducedStates: reduction.reduced,
    opportunityProjections: projections,
    persistedFacts,
    definitionReductions,
    responseDraft,
    warnings
  };
}
