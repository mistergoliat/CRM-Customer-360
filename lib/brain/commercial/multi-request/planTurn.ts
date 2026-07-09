import { buildDeterministicCandidates } from "./buildDeterministicCandidates";
import { createDeterministicTurnPlannerProvider } from "./turnPlannerProvider";
import type { TurnPlannerProvider } from "./turnPlannerProvider";
import { linkRequestsToIntents } from "./linkRequestsToIntents";
import { validateTurnPlan } from "./validateTurnPlan";
import type { TurnPlanValidationIssue } from "./validateTurnPlan";
import { buildTurnPlanInputHash, loadExistingTurnPlan, persistTurnPlan } from "./persistTurnPlan";
import type { ConversationRequest } from "../conversation-request";
import type { AutonomousCustomerContext } from "../context/autonomousCustomerContext";
import type { AutonomousCustomerContextLoadState } from "../context/loadAutonomousCustomerContext";
import type { ResponseRequirement, TurnPlan, TurnPlanExecutionBudget, TurnPlanRecord } from "./turnPlanTypes";

export const DEFAULT_TURN_PLAN_EXECUTION_BUDGET: TurnPlanExecutionBudget = {
  maxReadActions: 5,
  maxMutationActions: 2,
  maxExternalCalls: 5,
  deadlineMs: 20000
};

export type PlanTurnInput = {
  conversationId: number;
  /** Internal conversation_message id of the inbound turn. */
  inboundMessageId: string;
  messageText: string;
  correlationId: string;
  activeRequests: readonly ConversationRequest[];
  provider?: TurnPlannerProvider | null;
  executionBudget?: TurnPlanExecutionBudget;
  /** ACS-R1-04-T05: reduced Customer 360 history, loaded once upstream. Included in the plan's inputHash - never in the plan's identity/reuse key. */
  customerContext?: AutonomousCustomerContext | null;
  customerContextState?: AutonomousCustomerContextLoadState;
};

export type PlanTurnResult =
  | { ok: true; status: "planned" | "reused"; record: TurnPlanRecord; warnings: string[] }
  | { ok: false; status: "invalid_plan" | "error"; record: null; warnings: string[]; issues?: TurnPlanValidationIssue[] };

/**
 * The ONLY authorized planning call site: one provider invocation per turn.
 * A retry of the same inbound message finds the persisted plan and returns it
 * without invoking the provider again, keeping detection ids (and therefore
 * request creation keys) stable across retries.
 */
export async function planTurn(input: PlanTurnInput): Promise<PlanTurnResult> {
  const existing = await loadExistingTurnPlan(input.inboundMessageId);
  if (existing) {
    return { ok: true, status: "reused", record: existing, warnings: [] };
  }

  const provider = input.provider ?? createDeterministicTurnPlannerProvider();
  const candidates = buildDeterministicCandidates(input.activeRequests);
  const customerContext = input.customerContext ?? null;
  const customerContextState = input.customerContextState ?? "not_requested";

  let detections;
  try {
    ({ detections } = await provider.plan({ messageText: input.messageText, candidates, customerContext, customerContextState }));
  } catch (error) {
    return {
      ok: false,
      status: "error",
      record: null,
      warnings: [`turn_planner_provider_failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }

  const requestOperations = linkRequestsToIntents(detections, candidates);
  const responseRequirements: ResponseRequirement[] = requestOperations.map((operation) => ({
    // Creates have no requestId until the operations are applied; the
    // detection reference resolves to the real id after persistRequestOperations.
    requestId: operation.requestId ?? `detection:${operation.detectionId}`,
    kind: "acknowledge",
    summary: `Handle ${operation.intentType} (${operation.operation}).`
  }));

  const plan: TurnPlan = {
    contractName: "TurnPlan",
    schemaVersion: "1.0.0",
    detections,
    requestOperations,
    proposedFacts: detections.flatMap((detection) => detection.extractedFacts),
    requestPlans: [],
    responseRequirements,
    executionBudget: input.executionBudget ?? DEFAULT_TURN_PLAN_EXECUTION_BUDGET
  };

  const validation = validateTurnPlan(plan);
  if (!validation.valid) {
    return { ok: false, status: "invalid_plan", record: null, warnings: ["turn_plan_validation_failed"], issues: validation.issues };
  }

  const persisted = await persistTurnPlan({
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    inputHash: buildTurnPlanInputHash({ messageText: input.messageText, candidates, customerContext, customerContextState }),
    plan
  });

  if (!persisted.ok) {
    return { ok: false, status: "error", record: null, warnings: [persisted.warning] };
  }

  // "duplicate" here means a concurrent worker persisted the same turn first -
  // its plan is the authoritative one and this provider output is discarded.
  return {
    ok: true,
    status: persisted.status === "created" ? "planned" : "reused",
    record: persisted.record,
    warnings: []
  };
}
