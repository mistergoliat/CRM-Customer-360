import { executeGovernedCapability } from "@/lib/brain/commercial/capability-gateway";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import { queryRows } from "@/lib/db";
import { getActiveCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import { getActiveCreatedQuoteForOpportunity } from "@/lib/domains/created-quote";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import { getActiveShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import { getActiveSelectedShippingOptionForOpportunity } from "@/lib/domains/selected-shipping-option";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import { deriveCommercialWorkMetrics } from "./evaluateCommercialWork";
import type { CommercialWorkStatus, CommercialWorkStepStatus } from "./statuses";
import type { PersistedCommercialWork, CommercialWorkDatabaseAdapter } from "./persistenceTypes";
import { CommercialWorkPersistenceError } from "./persistenceTypes";
import { getCommercialWorkByPublicId, updateCommercialWorkAggregate } from "./repository";
import { calculateCommercialWorkNextAttemptAt, getCommercialWorkRetryPolicy } from "./retryPolicy";
import { canTransitionCommercialWorkStatus } from "./transitions";
import type { CommercialEvidenceRef, CommercialObjective, CommercialWork, CommercialWorkBlocker, CommercialWorkStep } from "./types";

const EXECUTABLE_STEP_TYPES = new Set(["SELECT_PRODUCTS", "SET_SHIPPING_DESTINATION", "CALCULATE_SHIPPING", "CREATE_QUOTE"]);
const TERMINAL_WORK_STATUSES = new Set<CommercialWorkStatus>(["COMPLETED", "CANCELLED", "SUPERSEDED", "HANDOFF", "FAILED"]);

type CurrentFacts = {
  commercialLineItems: CommercialLineItemSelection | null;
  shippingDestination: ShippingDestination | null;
  selectedShippingOption: SelectedShippingOption | null;
  createdQuote: CreatedQuote | null;
};

type ConversationControl = {
  humanOwnerActive: boolean;
  aiEnabled: boolean;
};

export type CommercialWorkExecutorOutcome =
  | "executed"
  | "no_ready_steps"
  | "max_steps_reached"
  | "version_conflict"
  | "not_found"
  | "handoff"
  | "terminal"
  | "blocked";

export type CommercialWorkStepExecutionRecord = {
  stepId: string;
  stepType: CommercialWorkStep["type"];
  capabilityName: string | null;
  status: "completed" | "blocked" | "waiting_customer" | "waiting_system" | "failed" | "skipped";
  gatewayStatus?: CapabilityGatewayResult["status"];
  errorCode?: string | null;
  evidence: CommercialEvidenceRef[];
};

export type ExecuteCommercialWorkInput = {
  workPublicId: string;
  expectedVersion: number;
  context: CapabilityGatewayContext;
  maxSteps?: number;
  adapter?: CommercialWorkDatabaseAdapter | null;
  loadCurrentFacts?: (work: PersistedCommercialWork) => Promise<CurrentFacts>;
  loadConversationControl?: (work: PersistedCommercialWork) => Promise<ConversationControl>;
  executeCapability?: typeof executeGovernedCapability;
  claimedStepId?: string;
  workerId?: string;
  scheduleRetries?: boolean;
  now?: string | Date;
};

export type ExecuteCommercialWorkResult = {
  outcome: CommercialWorkExecutorOutcome;
  reason: string | null;
  work: PersistedCommercialWork | null;
  initialVersion: number | null;
  finalVersion: number | null;
  executedStepCount: number;
  records: CommercialWorkStepExecutionRecord[];
  remainingReadyStepIds: string[];
};

function evidenceForFact(factType: NonNullable<CommercialEvidenceRef["factType"]>, id: string | number | undefined | null, stale = false, reason?: string): CommercialEvidenceRef[] {
  return id ? [{ kind: "request_fact", factType, id, ...(stale ? { stale: true, reason } : {}) }] : [];
}

function evidenceForCapability(result: CapabilityGatewayResult): CommercialEvidenceRef[] {
  return result.executionPublicId
    ? [{ kind: "capability_execution", id: result.executionPublicId, capabilityName: result.capability, status: result.status }]
    : [];
}

function blocker(code: CommercialWorkBlocker["code"], source: CommercialWorkBlocker["source"], objectiveId?: string, stepId?: string, evidence: CommercialEvidenceRef[] = []): CommercialWorkBlocker {
  return { code, source, ...(objectiveId ? { objectiveId } : {}), ...(stepId ? { stepId } : {}), ...(evidence.length ? { evidence } : {}) };
}

function sameItems(a: CommercialLineItemSelection["items"] | undefined, b: CommercialLineItemSelection["items"] | undefined): boolean {
  const key = (items: CommercialLineItemSelection["items"] | undefined) =>
    JSON.stringify([...(items ?? [])].map((item) => ({ productId: item.productId, combinationId: item.combinationId ?? null, quantity: item.quantity })).sort((left, right) => `${left.productId}:${left.combinationId ?? ""}`.localeCompare(`${right.productId}:${right.combinationId ?? ""}`)));
  return key(a) === key(b);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

export async function defaultLoadFacts(work: PersistedCommercialWork): Promise<CurrentFacts> {
  if (typeof work.opportunityId !== "number") {
    return { commercialLineItems: null, shippingDestination: null, selectedShippingOption: null, createdQuote: null };
  }
  const [commercialLineItems, shippingDestination, selectedShippingOption, createdQuote] = await Promise.all([
    getActiveCommercialLineItemsForOpportunity(work.opportunityId),
    getActiveShippingDestinationForOpportunity(work.opportunityId),
    getActiveSelectedShippingOptionForOpportunity(work.opportunityId),
    getActiveCreatedQuoteForOpportunity(work.opportunityId)
  ]);
  return { commercialLineItems, shippingDestination, selectedShippingOption, createdQuote };
}

export async function defaultLoadConversationControl(work: PersistedCommercialWork): Promise<ConversationControl> {
  const rows = await queryRows<{ human_owner_active: number | boolean; ai_enabled: number | boolean }>(
    "SELECT human_owner_active, ai_enabled FROM conversation WHERE id = ? LIMIT 1",
    [work.conversationId]
  );
  const row = rows[0];
  if (!row) return { humanOwnerActive: false, aiEnabled: true };
  return { humanOwnerActive: Boolean(row.human_owner_active), aiEnabled: Boolean(row.ai_enabled) };
}

function hasDependencyCycle(steps: readonly CommercialWorkStep[]): boolean {
  const byId = new Map(steps.map((step) => [step.stepId, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): boolean => {
    if (visiting.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    const step = byId.get(stepId);
    if (!step) return false;
    visiting.add(stepId);
    for (const dependency of step.dependencies) {
      if (dependency.type === "STEP_COMPLETED" && visit(dependency.stepId)) return true;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return false;
  };
  return steps.some((step) => visit(step.stepId));
}

function dependencySatisfied(dependency: CommercialWorkStep["dependencies"][number], work: PersistedCommercialWork, facts: CurrentFacts): boolean {
  switch (dependency.type) {
    case "FACT_CONFIRMED":
      if (dependency.factType === "commercial_line_items") return Boolean(facts.commercialLineItems);
      if (dependency.factType === "shipping_destination") return Boolean(facts.shippingDestination);
      if (dependency.factType === "selected_shipping_option") return Boolean(facts.selectedShippingOption);
      return Boolean(facts.createdQuote);
    case "CUSTOMER_INPUT":
      if (dependency.requirement === "PRODUCT") return Boolean(work.steps.some((step) => step.input.items?.length || step.input.productReference));
      if (dependency.requirement === "QUANTITY") return work.steps.some((step) => typeof step.input.quantity === "number" || Boolean(step.input.items?.length));
      if (dependency.requirement === "DESTINATION") return work.steps.some((step) => Boolean(step.input.destinationText || step.input.canonicalDestinationName || typeof step.input.communeId === "number"));
      return false;
    case "STEP_COMPLETED":
      return work.steps.some((step) => step.stepId === dependency.stepId && step.status === "COMPLETED");
    case "CAPABILITY_EVIDENCE":
      return work.steps.some((step) => step.capabilityName === dependency.capabilityName && step.status === "COMPLETED");
    case "CONVERSATION_AUTONOMY_ALLOWED":
      return true;
  }
}

function dependenciesSatisfied(step: CommercialWorkStep, work: PersistedCommercialWork, facts: CurrentFacts): boolean {
  return step.dependencies.every((dependency) => dependencySatisfied(dependency, work, facts));
}

function priority(step: CommercialWorkStep): number {
  switch (step.type) {
    case "SELECT_PRODUCTS":
      return 10;
    case "SET_SHIPPING_DESTINATION":
      return 20;
    case "CALCULATE_SHIPPING":
      return 30;
    case "CREATE_QUOTE":
      return 40;
    default:
      return 1000;
  }
}

function selectNextReadyStep(work: PersistedCommercialWork, facts: CurrentFacts, options: Pick<ExecuteCommercialWorkInput, "claimedStepId" | "workerId"> = {}): CommercialWorkStep | null {
  if (options.claimedStepId) {
    const claimed = work.steps.find((step) => step.stepId === options.claimedStepId && step.status === "RUNNING");
    if (claimed && (!options.workerId || claimed.lockOwner === options.workerId) && dependenciesSatisfied(claimed, work, facts)) return claimed;
  }
  return work.steps
    .filter((step) => step.status === "READY" && dependenciesSatisfied(step, work, facts))
    .sort((left, right) => priority(left) - priority(right) || left.stepId.localeCompare(right.stepId))[0] ?? null;
}

function destinationMatches(step: CommercialWorkStep, destination: ShippingDestination | null): boolean {
  if (!destination) return false;
  if (typeof step.input.communeId === "number") return destination.communeId === step.input.communeId;
  const expected = step.input.canonicalDestinationName ?? step.input.destinationText;
  return expected ? normalizeText(destination.canonicalName) === normalizeText(expected) : true;
}

function staleBlockersForStep(step: CommercialWorkStep, work: PersistedCommercialWork, facts: CurrentFacts): CommercialWorkBlocker[] {
  const blockers: CommercialWorkBlocker[] = [];
  for (const objectiveId of step.objectiveIds) {
    const objective = work.objectives.find((item) => item.objectiveId === objectiveId);
    if (!objective) continue;
    if ((step.type === "CALCULATE_SHIPPING" || step.type === "CREATE_QUOTE") && objective.resolvedInputs.commercialLineItemsFactId && facts.commercialLineItems?.factId && objective.resolvedInputs.commercialLineItemsFactId !== facts.commercialLineItems.factId) {
      blockers.push(blocker("STALE_EVIDENCE", "step", objectiveId, step.stepId, evidenceForFact("commercial_line_items", objective.resolvedInputs.commercialLineItemsFactId, true, "selection_changed")));
    }
    if (step.type === "CALCULATE_SHIPPING" && objective.resolvedInputs.shippingDestinationFactId && facts.shippingDestination?.factId && objective.resolvedInputs.shippingDestinationFactId !== facts.shippingDestination.factId) {
      blockers.push(blocker("STALE_EVIDENCE", "step", objectiveId, step.stepId, evidenceForFact("shipping_destination", objective.resolvedInputs.shippingDestinationFactId, true, "destination_changed")));
    }
  }
  return blockers;
}

function repairEvidence(step: CommercialWorkStep, facts: CurrentFacts): CommercialWorkStepExecutionRecord | null {
  if (step.type === "SELECT_PRODUCTS" && step.input.items?.length && facts.commercialLineItems && sameItems(step.input.items, facts.commercialLineItems.items)) {
    return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "completed", evidence: evidenceForFact("commercial_line_items", facts.commercialLineItems.factId) };
  }
  if (step.type === "SET_SHIPPING_DESTINATION" && destinationMatches(step, facts.shippingDestination)) {
    return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "completed", evidence: evidenceForFact("shipping_destination", facts.shippingDestination?.factId) };
  }
  if (step.type === "CREATE_QUOTE" && facts.createdQuote && facts.commercialLineItems && facts.createdQuote.selectionFactId === facts.commercialLineItems.factId) {
    return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "completed", evidence: evidenceForFact("created_quote", facts.createdQuote.factId) };
  }
  return null;
}

function buildGatewayInput(step: CommercialWorkStep): Record<string, unknown> {
  switch (step.type) {
    case "SELECT_PRODUCTS":
      return { items: step.input.items ?? [] };
    case "SET_SHIPPING_DESTINATION":
      return { destination: step.input.destinationText ?? step.input.canonicalDestinationName ?? "" };
    default:
      return {};
  }
}

function stepRecordFromGateway(step: CommercialWorkStep, result: CapabilityGatewayResult, factsAfter: CurrentFacts): CommercialWorkStepExecutionRecord {
  const evidence = evidenceForCapability(result);
  if (result.status === "temporarily_blocked") return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "waiting_system", gatewayStatus: result.status, errorCode: result.errorCode, evidence };
  if (result.status === "missing_information") return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "waiting_customer", gatewayStatus: result.status, errorCode: result.errorCode, evidence };
  if (result.status === "failed" || result.status === "denied" || result.status === "invalid_arguments" || result.status === "requires_approval") {
    return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "failed", gatewayStatus: result.status, errorCode: result.errorCode, evidence };
  }

  const dataStatus = typeof result.data?.status === "string" ? result.data.status : null;
  if (step.type === "SET_SHIPPING_DESTINATION" && !destinationMatches(step, factsAfter.shippingDestination)) {
    return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "waiting_customer", gatewayStatus: result.status, errorCode: dataStatus, evidence };
  }
  if (step.type === "CALCULATE_SHIPPING" && (dataStatus === "shipping_destination_required" || dataStatus === "commercial_items_required")) {
    return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "waiting_customer", gatewayStatus: result.status, errorCode: dataStatus, evidence };
  }
  if (step.type === "CREATE_QUOTE" && dataStatus === "no_commercial_line_items") {
    return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "blocked", gatewayStatus: result.status, errorCode: dataStatus, evidence };
  }
  return { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "completed", gatewayStatus: result.status, errorCode: result.errorCode, evidence };
}

function statusFromRecord(record: CommercialWorkStepExecutionRecord, step?: CommercialWorkStep, options: Pick<ExecuteCommercialWorkInput, "scheduleRetries"> = {}): CommercialWorkStepStatus {
  if (record.status === "waiting_system" && options.scheduleRetries && step) {
    const policy = getCommercialWorkRetryPolicy(step);
    const maxAttempts = step.maxAttempts ?? policy?.maxAttempts ?? null;
    if (policy && maxAttempts !== null && step.attemptCount < maxAttempts) return "RETRY_SCHEDULED";
    return "FAILED";
  }
  switch (record.status) {
    case "completed":
      return "COMPLETED";
    case "waiting_customer":
      return "WAITING_CUSTOMER";
    case "waiting_system":
      return "WAITING_SYSTEM";
    case "failed":
      return "FAILED";
    default:
      return "BLOCKED";
  }
}

function blockersFromRecord(step: CommercialWorkStep, record: CommercialWorkStepExecutionRecord): CommercialWorkBlocker[] {
  if (record.status === "completed" || record.status === "skipped") return [];
  const code: CommercialWorkBlocker["code"] =
    record.errorCode === "unsupported_step_type"
      ? "UNSUPPORTED"
      : record.errorCode === "no_commercial_line_items" || record.errorCode === "commercial_items_required"
        ? "MISSING_SELECTION"
        : record.errorCode === "shipping_destination_required"
          ? "MISSING_DESTINATION"
          : record.status === "waiting_customer"
            ? "WAITING_CUSTOMER"
            : record.status === "waiting_system"
              ? "WAITING_SYSTEM"
              : "CAPABILITY_UNAVAILABLE";
  return step.objectiveIds.map((objectiveId) => blocker(code, "step", objectiveId, step.stepId, record.evidence));
}

function canAutoActivateStep(step: CommercialWorkStep): boolean {
  if (step.blockers.length === 0) return true;
  return step.blockers.every((item) => item.code === "MISSING_SELECTION" || item.code === "MISSING_DESTINATION" || item.code === "MISSING_PRODUCT" || item.code === "MISSING_QUANTITY" || item.code === "WAITING_CUSTOMER" || item.code === "WAITING_SYSTEM");
}

function isoFrom(value: string | Date | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function refreshObjectiveState(objective: CommercialObjective, steps: readonly CommercialWorkStep[], facts: CurrentFacts): CommercialObjective {
  const owned = steps.filter((step) => step.objectiveIds.includes(objective.objectiveId));
  const evidence = [...objective.evidence];
  const resolvedInputs = { ...objective.resolvedInputs };
  if (facts.commercialLineItems) resolvedInputs.commercialLineItemsFactId = facts.commercialLineItems.factId;
  if (facts.shippingDestination) resolvedInputs.shippingDestinationFactId = facts.shippingDestination.factId;
  if (facts.selectedShippingOption) resolvedInputs.selectedShippingOptionFactId = facts.selectedShippingOption.factId;
  if (facts.createdQuote) resolvedInputs.createdQuoteFactId = facts.createdQuote.factId;

  let status = objective.status;
  if (owned.length > 0 && owned.every((step) => step.status === "COMPLETED")) status = "COMPLETED";
  else if (owned.some((step) => step.status === "FAILED")) status = "FAILED";
  else if (owned.some((step) => step.status === "WAITING_SYSTEM" || step.status === "RETRY_SCHEDULED")) status = "WAITING_SYSTEM";
  else if (owned.some((step) => step.status === "WAITING_CUSTOMER")) status = "WAITING_CUSTOMER";
  else if (owned.some((step) => step.status === "READY")) status = "READY";
  else if (owned.some((step) => step.status === "BLOCKED")) status = "BLOCKED";

  return { ...objective, status, resolvedInputs, evidence };
}

function activateUnblockedSteps(
  work: PersistedCommercialWork,
  facts: CurrentFacts,
  completedRecord?: CommercialWorkStepExecutionRecord,
  options: Pick<ExecuteCommercialWorkInput, "scheduleRetries" | "now"> = {}
): CommercialWorkStep[] {
  let steps = work.steps.map((step) => {
    if (completedRecord && step.stepId === completedRecord.stepId) {
      const nextStatus = statusFromRecord(completedRecord, step, options);
      const policy = getCommercialWorkRetryPolicy(step);
      const maxAttempts = step.maxAttempts ?? policy?.maxAttempts ?? null;
      const nextAttemptAt =
        nextStatus === "RETRY_SCHEDULED" && policy
          ? calculateCommercialWorkNextAttemptAt({ policy, attemptCount: Math.max(1, step.attemptCount), now: options.now ?? new Date() })
          : null;
      const normalizedRecord =
        nextStatus === "FAILED" && completedRecord.status === "waiting_system"
          ? { ...completedRecord, status: "failed" as const, errorCode: "retry_attempts_exhausted" }
          : completedRecord;
      const blockers = blockersFromRecord(step, normalizedRecord);
      return {
        ...step,
        status: nextStatus,
        evidence: completedRecord.evidence.length ? completedRecord.evidence : step.evidence,
        blockers,
        retryable: nextStatus === "WAITING_SYSTEM" || nextStatus === "RETRY_SCHEDULED",
        retryCandidate: nextStatus === "WAITING_SYSTEM" || nextStatus === "RETRY_SCHEDULED",
        maxAttempts,
        nextAttemptAt,
        lockOwner: null,
        lockUntil: null,
        startedAt: nextStatus === "RETRY_SCHEDULED" ? step.startedAt : null,
        lastAttemptAt: step.lastAttemptAt ?? isoFrom(options.now)
      };
    }
    return step;
  });

  const view = { ...work, steps };
  steps = steps.map((step) => {
    if ((step.status === "BLOCKED" || step.status === "PENDING" || step.status === "WAITING_CUSTOMER") && canAutoActivateStep(step) && dependenciesSatisfied(step, view, facts)) {
      return { ...step, status: "READY", blockers: [], retryable: false, retryCandidate: false };
    }
    return step;
  });
  return steps;
}

function deriveNextWorkStatus(currentStatus: CommercialWorkStatus, objectives: readonly CommercialObjective[], steps: readonly CommercialWorkStep[], blockers: readonly CommercialWorkBlocker[]): CommercialWorkStatus {
  if (blockers.some((item) => item.code === "HUMAN_OWNER_ACTIVE" || item.code === "AI_DISABLED")) return "HANDOFF";
  if (objectives.length > 0 && objectives.every((objective) => objective.status === "COMPLETED" || objective.status === "CANCELLED" || objective.status === "SUPERSEDED")) return "COMPLETED";
  if (steps.some((step) => step.status === "READY")) return "ACTIVE";
  if (steps.some((step) => step.status === "WAITING_SYSTEM" || step.status === "RETRY_SCHEDULED")) return "WAITING_SYSTEM";
  if (steps.some((step) => step.status === "WAITING_CUSTOMER")) return "WAITING_CUSTOMER";
  if (steps.some((step) => step.status === "FAILED")) return "FAILED";
  if (TERMINAL_WORK_STATUSES.has(currentStatus)) return currentStatus;
  return "ACTIVE";
}

function nextAggregate(
  work: PersistedCommercialWork,
  facts: CurrentFacts,
  record?: CommercialWorkStepExecutionRecord,
  extraBlockers: CommercialWorkBlocker[] = [],
  options: Pick<ExecuteCommercialWorkInput, "scheduleRetries" | "now"> = {}
): CommercialWork {
  const steps = activateUnblockedSteps(work, facts, record, options);
  const objectives = work.objectives.map((objective) => refreshObjectiveState(objective, steps, facts));
  const blockers = [...extraBlockers, ...objectives.flatMap((objective) => objective.blockers), ...steps.flatMap((step) => step.blockers)];
  const wantedStatus = deriveNextWorkStatus(work.status, objectives, steps, blockers);
  const status = canTransitionCommercialWorkStatus(work.status, wantedStatus) ? wantedStatus : work.status;
  const next = { ...work, status, objectives, steps, blockers, derivedAt: new Date().toISOString() };
  return { ...next, metrics: deriveCommercialWorkMetrics(next) };
}

async function persistNext(publicId: string, expectedVersion: number, work: CommercialWork, adapter?: CommercialWorkDatabaseAdapter | null) {
  return updateCommercialWorkAggregate({ publicId, expectedVersion, nextWork: work }, adapter);
}

export async function executeCommercialWork(input: ExecuteCommercialWorkInput): Promise<ExecuteCommercialWorkResult> {
  const maxSteps = Math.max(1, Math.min(input.maxSteps ?? 10, 50));
  const executeCapability = input.executeCapability ?? executeGovernedCapability;
  const records: CommercialWorkStepExecutionRecord[] = [];
  let work = await getCommercialWorkByPublicId(input.workPublicId, input.adapter);
  if (!work) {
    return { outcome: "not_found", reason: "commercial_work_not_found", work: null, initialVersion: null, finalVersion: null, executedStepCount: 0, records, remainingReadyStepIds: [] };
  }
  const initialVersion = work.version;
  if (work.version !== input.expectedVersion) {
    return { outcome: "version_conflict", reason: "expected_version_mismatch", work, initialVersion, finalVersion: work.version, executedStepCount: 0, records, remainingReadyStepIds: work.steps.filter((step) => step.status === "READY").map((step) => step.stepId) };
  }
  if (hasDependencyCycle(work.steps)) {
    return { outcome: "blocked", reason: "dependency_cycle", work, initialVersion, finalVersion: work.version, executedStepCount: 0, records, remainingReadyStepIds: [] };
  }

  for (let index = 0; index < maxSteps; index += 1) {
    if (TERMINAL_WORK_STATUSES.has(work.status)) {
      return { outcome: work.status === "HANDOFF" ? "handoff" : records.length > 0 ? "executed" : "terminal", reason: work.status, work, initialVersion, finalVersion: work.version, executedStepCount: records.length, records, remainingReadyStepIds: [] };
    }

    const control = await (input.loadConversationControl ?? defaultLoadConversationControl)(work);
    if (control.humanOwnerActive || !control.aiEnabled) {
      const blockers = [
        ...(control.humanOwnerActive ? [blocker("HUMAN_OWNER_ACTIVE", "conversation", undefined, undefined, [{ kind: "conversation_state", id: work.conversationId, status: "human_owner_active" }])] : []),
        ...(!control.aiEnabled ? [blocker("AI_DISABLED", "conversation", undefined, undefined, [{ kind: "conversation_state", id: work.conversationId, status: "ai_disabled" }])] : [])
      ];
      const claimed = input.claimedStepId ? work.steps.find((step) => step.stepId === input.claimedStepId && step.status === "RUNNING") : null;
      const record: CommercialWorkStepExecutionRecord | undefined = claimed
        ? {
            stepId: claimed.stepId,
            stepType: claimed.type,
            capabilityName: claimed.capabilityName,
            status: "blocked",
            errorCode: blockers[0]?.code ?? "conversation_control_blocked",
            evidence: blockers.flatMap((item) => item.evidence ?? [])
          }
        : undefined;
      work = await persistNext(
        work.publicId,
        work.version,
        nextAggregate(work, await (input.loadCurrentFacts ?? defaultLoadFacts)(work), record, blockers, { scheduleRetries: input.scheduleRetries, now: input.now }),
        input.adapter
      );
      return { outcome: "handoff", reason: blockers[0]?.code ?? "conversation_control_blocked", work, initialVersion, finalVersion: work.version, executedStepCount: records.length, records, remainingReadyStepIds: [] };
    }

    const factsBefore = await (input.loadCurrentFacts ?? defaultLoadFacts)(work);
    const step = selectNextReadyStep(work, factsBefore, { claimedStepId: input.claimedStepId, workerId: input.workerId });
    if (!step) {
      const refreshed = nextAggregate(work, factsBefore, undefined, [], { scheduleRetries: input.scheduleRetries, now: input.now });
      if (JSON.stringify(refreshed.metrics) !== JSON.stringify(work.metrics) || refreshed.status !== work.status) {
        work = await persistNext(work.publicId, work.version, refreshed, input.adapter);
      }
      return { outcome: records.length > 0 ? "executed" : "no_ready_steps", reason: null, work, initialVersion, finalVersion: work.version, executedStepCount: records.length, records, remainingReadyStepIds: work.steps.filter((item) => item.status === "READY").map((item) => item.stepId) };
    }

    if (!EXECUTABLE_STEP_TYPES.has(step.type)) {
      const record: CommercialWorkStepExecutionRecord = { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "blocked", errorCode: "unsupported_step_type", evidence: [] };
      records.push(record);
      work = await persistNext(work.publicId, work.version, nextAggregate(work, factsBefore, record, [], { scheduleRetries: input.scheduleRetries, now: input.now }), input.adapter);
      continue;
    }

    const staleBlockers = staleBlockersForStep(step, work, factsBefore);
    if (staleBlockers.length > 0) {
      const record: CommercialWorkStepExecutionRecord = { stepId: step.stepId, stepType: step.type, capabilityName: step.capabilityName, status: "blocked", errorCode: "stale_evidence", evidence: staleBlockers.flatMap((item) => item.evidence ?? []) };
      records.push(record);
      const steps = work.steps.map((item) =>
        item.stepId === step.stepId ? { ...item, status: "BLOCKED" as const, blockers: staleBlockers, evidence: record.evidence, lockOwner: null, lockUntil: null, startedAt: null } : item
      );
      const blockedWork = { ...work, steps, blockers: staleBlockers, metrics: deriveCommercialWorkMetrics({ ...work, steps, blockers: staleBlockers }) };
      work = await persistNext(work.publicId, work.version, blockedWork, input.adapter);
      continue;
    }

    const repaired = repairEvidence(step, factsBefore);
    if (repaired) {
      records.push(repaired);
      work = await persistNext(work.publicId, work.version, nextAggregate(work, factsBefore, repaired, [], { scheduleRetries: input.scheduleRetries, now: input.now }), input.adapter);
      continue;
    }

    if (!step.capabilityName) {
      const record: CommercialWorkStepExecutionRecord = { stepId: step.stepId, stepType: step.type, capabilityName: null, status: "blocked", errorCode: "missing_capability_name", evidence: [] };
      records.push(record);
      work = await persistNext(work.publicId, work.version, nextAggregate(work, factsBefore, record, [], { scheduleRetries: input.scheduleRetries, now: input.now }), input.adapter);
      continue;
    }

    const result = await executeCapability(step.capabilityName, buildGatewayInput(step), {
      ...input.context,
      opportunityId: work.opportunityId,
      conversationId: work.conversationId,
      requestId: work.publicId,
      actionId: step.stepId
    });
    const factsAfter = await (input.loadCurrentFacts ?? defaultLoadFacts)(work);
    const postSideEffectStaleBlockers = staleBlockersForStep(step, work, factsAfter);
    if (postSideEffectStaleBlockers.length > 0) {
      const record: CommercialWorkStepExecutionRecord = {
        stepId: step.stepId,
        stepType: step.type,
        capabilityName: step.capabilityName,
        status: "blocked",
        gatewayStatus: result.status,
        errorCode: "stale_evidence",
        evidence: [...evidenceForCapability(result), ...postSideEffectStaleBlockers.flatMap((item) => item.evidence ?? [])]
      };
      records.push(record);
      const steps = work.steps.map((item) =>
        item.stepId === step.stepId ? { ...item, status: "BLOCKED" as const, blockers: postSideEffectStaleBlockers, evidence: record.evidence, lockOwner: null, lockUntil: null, startedAt: null } : item
      );
      const blockedWork = { ...work, steps, blockers: postSideEffectStaleBlockers, metrics: deriveCommercialWorkMetrics({ ...work, steps, blockers: postSideEffectStaleBlockers }) };
      work = await persistNext(work.publicId, work.version, blockedWork, input.adapter);
      continue;
    }
    const record = stepRecordFromGateway(step, result, factsAfter);
    records.push(record);
    work = await persistNext(work.publicId, work.version, nextAggregate(work, factsAfter, record, [], { scheduleRetries: input.scheduleRetries, now: input.now }), input.adapter);
  }

  const remainingReadyStepIds = work.steps.filter((step) => step.status === "READY").map((step) => step.stepId);
  return { outcome: "max_steps_reached", reason: "max_steps_reached", work, initialVersion, finalVersion: work.version, executedStepCount: records.length, records, remainingReadyStepIds };
}

export function isCommercialWorkPersistenceVersionConflict(error: unknown): boolean {
  return error instanceof CommercialWorkPersistenceError && error.code === "VERSION_CONFLICT";
}
