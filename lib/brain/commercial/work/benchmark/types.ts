import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway";
import type { RecentCatalogContext } from "@/lib/brain/commercial/agent-loop/recentCatalogContext";
import type { PersistedCommercialWork } from "../persistenceTypes";
import type { CommercialObjectiveType } from "../objectiveTypes";
import type { CommercialWorkStepType } from "../stepTypes";
import type { CommercialObjectiveStatus, CommercialWorkStatus, CommercialWorkStepStatus } from "../statuses";
import type { CommercialMissingRequirement, CommercialObjectiveSeed } from "../types";

/**
 * SALES-AGENT-R2-A07.5. Failure taxonomy for scenario runs that do not pass -
 * distinct from the legacy T08 corpus's own terminal-reason vocabulary
 * (this benchmark scores CommercialWork architecture properties, not
 * Agent Tool Loop transcripts). A08_SEQUENCING_GAP is reserved for failures
 * that are a documented consequence of the absent conversation-sequencing
 * layer, never a reason to implement A08 inside this task.
 */
export const R2_FAILURE_CLASSIFICATIONS = [
  "SEMANTIC_PLANNING",
  "REQUIREMENT_RESOLUTION",
  "WORK_PROJECTION",
  "WORK_PERSISTENCE",
  "DEPENDENCY_EVALUATION",
  "EXECUTOR",
  "CAPABILITY",
  "EVIDENCE_FRESHNESS",
  "IDEMPOTENCY",
  "RETRY_WORKER",
  "FOLLOW_UP",
  "CONVERSATION_CONTROL",
  "BENCHMARK_ARTIFACT",
  "A08_SEQUENCING_GAP",
  "INFRASTRUCTURE",
  "UNKNOWN"
] as const;

export type R2FailureClassification = (typeof R2_FAILURE_CLASSIFICATIONS)[number];

export type R2ArchitectureScenarioTurn = {
  customerMessage: string;
  recentCatalogContext?: RecentCatalogContext | null;
  /**
   * Bypasses the LLM semantic planner for this turn and seeds these
   * objectives directly. Needed only for CREATE_QUOTE (R2-06/R2-09):
   * LLM-R1-T09A's real planner intent taxonomy is select_products |
   * get_shipping_quote | unsupported only (documented scope, not a gap this
   * benchmark works around) - there is no "create_quote" chat intent to
   * interpret yet in production either. What R2-06/R2-09 test (durability,
   * retry, evidence-repair idempotency) does not depend on that planner
   * coverage existing.
   */
  directObjectiveSeeds?: CommercialObjectiveSeed[];
};

/** Capability names the R2 executor actually calls - see COMMERCIAL_WORK_STEP_CAPABILITIES in ../stepTypes. */
export type R2FaultInjectableCapability = "select_products" | "set_shipping_destination" | "calculate_shipping" | "create_quote";

export type CommercialWorkFaultPlan = {
  /** Fault the first call to this capability once (temporarily_blocked), then let subsequent calls through for real - R2-05. */
  temporarilyBlockOnce?: R2FaultInjectableCapability[];
  /** Call the real capability (real side effect happens), then throw a synthetic crash error before the tick can persist COMPLETED - R2-06. */
  crashAfterSideEffect?: R2FaultInjectableCapability[];
};

export type R2ArchitectureScenario = {
  scenarioId: string;
  description: string;
  /** True only for R2-10/R2-11 - the harness marks these BLOCKED_BY_A07_DB_VALIDATION instead of running them if a preflight DB check fails. */
  requiresA07Db?: boolean;
  /** Applied once, before turn 1, via the real domain functions (same fixture helpers the legacy T08 benchmark already uses) - for scenarios that assume a prior selection/destination already exists (R2-05/R2-06/R2-09). */
  preSeededDurableState?: { selectionItems?: Array<{ productId: string; quantity: number }>; destinationText?: string };
  customerTurns: R2ArchitectureScenarioTurn[];
  faultPlan?: CommercialWorkFaultPlan;
  /** Applied before the executor/worker pass, for R2-12 (human handoff / AI disabled). */
  conversationControlBeforeExecution?: { humanOwnerActive?: boolean; aiEnabled?: boolean };
  /** R2-10/R2-11 only. */
  followUp?: { schedule: boolean; simulateInboundBeforeDue?: boolean };
  expected: {
    objectives: Array<{ type: CommercialObjectiveType; status: CommercialObjectiveStatus | CommercialObjectiveStatus[]; missingRequirements?: CommercialMissingRequirement[] }>;
    /** Array = an explicit "acceptable A or B" duality (R2-02). */
    workStatus: CommercialWorkStatus | CommercialWorkStatus[];
    stepStatuses: Array<{ type: CommercialWorkStepType; status: CommercialWorkStepStatus | CommercialWorkStepStatus[] }>;
    durableFacts: {
      commercialLineItems?: Array<{ productId: string; quantity: number }> | null;
      shippingDestinationCommuneId?: number | null;
      createdQuoteExists?: boolean;
    };
    customerVisibleOutcome: "correct" | "acceptable_degradation" | "unacceptable";
    retryExpected: boolean;
    followUpExpected: boolean;
    handoffExpected: boolean;
  };
};

/** Always-on record of every executeCapability call the scenario run made - never reasoning_content/API keys/PII, see capabilityCallLog.ts. */
export type CapabilityCallLogEntry = {
  capabilityName: string;
  status: CapabilityGatewayResult["status"];
  stepId: string | null;
  objectiveIds: string[];
  injectedFault: "temporarily_blocked" | "simulated_crash" | null;
  atIso: string;
};

/**
 * What runR2Scenario.ts (checkpoint 4) produces for one scenario run - the
 * only input scoring.ts/metrics.ts need. Deliberately structural: no chat
 * text, no reasoning_content, no secrets (Part 12 observability rule).
 */
export type R2ScenarioRunOutcome = {
  scenarioId: string;
  runIndex: number;
  blocked: "BLOCKED_BY_A07_DB_VALIDATION" | null;
  finalWork: PersistedCommercialWork | null;
  capabilityCalls: CapabilityCallLogEntry[];
  llmCallCount: number;
  turnLatencyMs: number;
  /** From turn-1 start to the final terminal/COMPLETED PersistedCommercialWork timestamp - may exceed turnLatencyMs when work finishes via a later worker tick. Null when work never reaches a terminal-for-this-run state. */
  commercialCompletionLatencyMs: number | null;
  followUpScheduled: boolean;
  followUpSent: boolean;
  followUpCancelled: boolean;
  handoffOccurred: boolean;
  retryOccurred: boolean;
  restartRecoveryOccurred: boolean;
  /** Set by the harness when a step in the pipeline throws/fails outside of what the scenario's own faultPlan intended. */
  runFailureClassification: R2FailureClassification | null;
};

export type R2ScenarioRunResult = {
  scenario: R2ArchitectureScenario;
  outcome: R2ScenarioRunOutcome;
  score: R2ScenarioScore;
};

export type R2ScenarioScore = {
  scenarioId: string;
  runIndex: number;
  blocked: boolean;
  objectiveDetectionCorrect: boolean;
  requirementResolutionCorrect: boolean;
  requiredObjectivesCompleted: boolean;
  workGraphCorrect: boolean;
  durableRemainingWorkCorrect: boolean;
  lostObjectiveCount: number;
  totalObjectiveCount: number;
  duplicateSideEffect: boolean;
  unbackedMutationClaim: boolean;
  staleEvidenceExecuted: boolean;
  retryRecovered: boolean | null;
  restartRecovered: boolean | null;
  customerReasked: boolean;
  customerVisibleOutcome: "correct" | "acceptable_degradation" | "unacceptable";
  safetyFailure: boolean;
  handoffOccurred: boolean;
  followUpCorrect: boolean | null;
  overallPass: boolean;
  failureClassification: R2FailureClassification | null;
};
