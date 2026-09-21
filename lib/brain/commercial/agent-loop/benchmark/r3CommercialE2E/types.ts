import type { AgentLoopTerminalReason } from "../../agentStepTypes";
import type { CapabilityEligibilityReasonCode } from "../../../capability-eligibility/types";
import type { CapabilityEvidenceType } from "../../../capability-gateway/types";
import type { BenchmarkOfflineStep, BenchmarkProviderCallRecord } from "../types";

/**
 * SALES-AGENT-R3-P7.4 (E2E Benchmark Harness Integration). This is the
 * instrument, not a measurement run - see runCommercialE2ECorpus.ts's own
 * comment. Every trace type here is a bounded, typed projection of data this
 * repo already produces (CommercialEventV1 rows, SalesAgentRuntimeCycleResult,
 * CommercialDomainReadModel) - never a second, independently-invented
 * semantic model, and never reconstructed from log text/timestamps when a
 * canonical id already resolves the same correlation.
 */

// ---------------------------------------------------------------------------
// Execution mode - Section "LIVE VS TEST MODE"
// ---------------------------------------------------------------------------

/**
 * LIVE: real external dependency exercised as-is (the real provider HTTP
 * call, or - for MariaDB/CommercialWork/Gateway/eligibility/P4/P5/P7/outbox -
 * always true for this harness, since those never have a fake seam here).
 * STUBBED: a deterministic local fake stands in (offline scripted provider,
 * the local Catalog/Carrier/commune fakes benchmark/environment.ts already
 * establishes). HYBRID: this run mixes both (the only mode this harness ever
 * actually produces - see resolveExecutionMode below).
 */
export const BENCHMARK_E2E_EXECUTION_MODES = ["LIVE", "HYBRID", "STUBBED"] as const;
export type BenchmarkE2EExecutionMode = (typeof BENCHMARK_E2E_EXECUTION_MODES)[number];

// ---------------------------------------------------------------------------
// Case corpus - Section "CASE EXPECTATIONS"
// ---------------------------------------------------------------------------

/**
 * One customer turn inside a case. `offlineScript` is consumed, across the
 * WHOLE case-run (not reset per turn), by one shared createOfflineScriptedProvider
 * instance - the same "consumed in order, last entry repeats" discipline the
 * legacy corpus already establishes. Ignored in live mode (the real provider
 * decides every step).
 */
export type BenchmarkE2ETurnScript = {
  customerMessage: string;
  offlineScript: BenchmarkOfflineStep[];
};

/**
 * Structural, outcome-plus-invariant expectations - never a required tool
 * sequence unless the case is specifically about tool selection (Section
 * "CASE EXPECTATIONS": "No exigir search_products -> select_products -> ...
 * si existen otros caminos válidos"). Every field is optional; a case
 * declares only the dimensions it actually cares about.
 */
export type BenchmarkE2ECaseExpectation = {
  /** null explicitly means "no active objective expected" - never "not checked" (use undefined for that). */
  finalObjectiveType?: string | null;
  quoteExists?: boolean;
  destinationExists?: boolean;
  selectionExists?: boolean;
  minSelectionItemCount?: number;
  /** When false, the case expects create_quote (or another identity-gated mutation) to be denied by the identity gate, never executed. */
  identitySufficientForMutation?: boolean;
  terminalReasonLastTurn?: AgentLoopTerminalReason | null;
  /** Only for cases specifically about tool selection/boundary behavior (legacy dimension, kept - Section "NO VOLVER..."). */
  requiredToolsAnyTurn?: string[];
  forbiddenToolsAnyTurn?: string[];
};

export type BenchmarkE2ECaseForbidden = {
  /** A mutating tool call this turn targets a fact the DRM already showed CURRENT at turn start - the structural, non-text proxy for "asked again". */
  repeatKnownDestination?: boolean;
  repeatKnownSelection?: boolean;
  /** Final response matches a quote-confirmation pattern with no CURRENT durable quote afterward - benchmark-only heuristic, mirrors r3StableAgentV1/scoreGoldenCase.ts's own CM-005 discipline, narrow and never production. */
  ungroundedQuoteClaim?: boolean;
  /** Reuses the real production guard's own warning (never reimplemented) - see resolveConversationalSignals.ts. */
  ungroundedMutationClaim?: boolean;
  /** The assistant's response text opens with a greeting more than once across the case's own turns - deterministic substring check, scoped to this case's own transcript only. */
  greetingRepetition?: boolean;
};

export type BenchmarkE2ECase = {
  caseId: string;
  description: string;
  /** Free-text rationale for what this case is checking - never used for scoring, report readability only. */
  notes: string;
  turns: BenchmarkE2ETurnScript[];
  /** Runs once, against this run's fresh isolated opportunityId/conversationId, before the first turn - same discipline as the legacy corpus's own BenchmarkCase.setup. */
  setup?: (input: { opportunityId: number; conversationId: number }) => Promise<void>;
  /** LEVEL_2_MASTER_RESOLVED unless the case is specifically about identity insufficiency. */
  identityLevel: "LEVEL_0_ANONYMOUS" | "LEVEL_2_MASTER_RESOLVED";
  expected: BenchmarkE2ECaseExpectation;
  forbidden: BenchmarkE2ECaseForbidden;
};

// ---------------------------------------------------------------------------
// Per-tool trace - Section "BENCHMARK TRACE" / "DATA SOURCE PRIORITY"
// ---------------------------------------------------------------------------

/**
 * A bounded projection of one commercial_capability_invocation_observed row
 * (P7.2/P7.3) - the primary source for tool coherence per the task's own
 * "DATA SOURCE PRIORITY". Field names mirror CommercialCapabilityInvocationObservedPayload
 * verbatim - never a renamed/reshaped copy.
 */
export type BenchmarkE2EToolInvocationTrace = {
  stepIndex: number;
  capability: string;
  workId: string | null;
  workVersion: number | null;
  objectiveId: string | null;
  objectiveType: string | null;
  eligibilityAtTurnStart: { status: string; reasonCodes: readonly CapabilityEligibilityReasonCode[]; metadataVersion: string } | null;
  gateway: { status: string; errorCode: string | null; retryable: boolean } | null;
  toolObservation: { status: string; errorCode: string | null; retryable: boolean | null };
  inTurnEvidence: {
    relevantEvidenceProduced: readonly CapabilityEvidenceType[];
    blockerPotentiallyChanged: boolean;
    potentiallyAffectedReasonCodes: readonly CapabilityEligibilityReasonCode[];
  };
};

export type BenchmarkE2EKernelTrace = {
  workId: string | null;
  workVersion: number | null;
  result: "EXISTING" | "CREATED" | "UNAVAILABLE" | "FAILED";
} | null;

export type BenchmarkE2EProposalTrace = {
  present: boolean;
  objectiveKind: string | null;
  operation: string | null;
  confidence: string | null;
  requestedOutcome: string | null;
  evidenceCodes: readonly string[];
} | null;

export type BenchmarkE2EObjectiveReconciliationTrace = {
  decided: { decisionAction: string; reasonCode: string; workVersionBefore: number; proposalObjectiveKind: string | null; previousObjectiveKind: string | null } | null;
  reconciled: { workVersionAfter: number; resultingObjectiveKind: string | null; resultingObjectiveId: string | null } | null;
};

export type BenchmarkE2EEligibilityShadowTrace = {
  workId: string | null;
  workVersion: number | null;
  objectiveType: string | null;
  eligibleCapabilityNames: readonly string[];
  blockedCapabilities: readonly { capability: string; reasonCodes: readonly string[] }[];
} | null;

export type BenchmarkE2EOutboxTrace = {
  attempted: boolean;
  outboxWritten: boolean;
  outboxId: number | null;
  status: string | null;
  messageTextPresent: boolean;
};

/**
 * Section "INITIAL / FINAL STATE". A bounded reduction of one
 * CommercialDomainReadModel snapshot - "no copiar toda la DB", "usar
 * projections/readers canónicos" (buildR3AgentTurnInputShadowDomainReadModel,
 * the exact same builder P2 already uses).
 */
export type BenchmarkE2EDurableStateSnapshot = {
  capturedAt: string;
  workId: string | null;
  workVersion: number | null;
  workStatus: string | null;
  objectiveType: string | null;
  objectiveStatus: string | null;
  selection: { present: boolean; freshness: string | null; itemCount: number | null };
  destination: { present: boolean; freshness: string | null; communeId: number | null };
  shipping: { present: boolean; freshness: string | null };
  quote: { present: boolean; freshness: string | null; quoteId: string | null; quoteStatus: string | null };
  identityLevel: string | null;
};

export type BenchmarkE2ETurnTrace = {
  turnOrdinal: number;
  inboundMessageId: string;
  correlationId: string;
  customerMessage: string;
  durableStateBeforeTurn: BenchmarkE2EDurableStateSnapshot | null;
  kernel: BenchmarkE2EKernelTrace;
  toolInvocations: readonly BenchmarkE2EToolInvocationTrace[];
  proposal: BenchmarkE2EProposalTrace;
  objectiveReconciliation: BenchmarkE2EObjectiveReconciliationTrace;
  eligibilityShadow: BenchmarkE2EEligibilityShadowTrace;
  response: {
    status: string;
    terminalReason: AgentLoopTerminalReason;
    finalMessage: string | null;
    handoffReason: string | null;
    toolExecutionCount: number;
  };
  runtimeWarnings: readonly string[];
  outbox: BenchmarkE2EOutboxTrace;
  durableStateAfterTurn: BenchmarkE2EDurableStateSnapshot | null;
  /** Turn-level provider calls for this turn only (a slice of the case-run's own providerCalls array). */
  providerCalls: readonly BenchmarkProviderCallRecord[];
};

// ---------------------------------------------------------------------------
// Failure taxonomy - Section "FAILURE CLASSIFICATION"
// ---------------------------------------------------------------------------

export const BENCHMARK_E2E_FAILURE_CATEGORIES = [
  "MODEL_REASONING",
  "TOOL_SELECTION",
  "ARGUMENT_BUILDING",
  "ELIGIBILITY_IGNORED",
  "STATE_CONTINUITY",
  "IDENTITY_FIXTURE",
  "GATEWAY_REJECTION",
  "DEPENDENCY_FAILURE",
  "TIMEOUT",
  "DURABLE_STATE_FAILURE",
  "OUTBOX_FAILURE",
  "HARNESS_FAILURE",
  "UNKNOWN"
] as const;
export type BenchmarkE2EFailureCategory = (typeof BENCHMARK_E2E_FAILURE_CATEGORIES)[number];

export type BenchmarkE2ECausalTraceLine = string;

export type BenchmarkE2EFailure = {
  caseId: string;
  runOrdinal: number;
  category: BenchmarkE2EFailureCategory;
  reason: string;
  /** Section "CAUSAL TRACE" - derived from structured data only, never CoT. */
  causalTrace: readonly BenchmarkE2ECausalTraceLine[];
};

// ---------------------------------------------------------------------------
// Run trace / outcome - Section "BENCHMARK TRACE"
// ---------------------------------------------------------------------------

export type BenchmarkE2ECaseOutcomeStatus = "PASS" | "FAIL" | "ENVIRONMENT_BLOCKED";

export type BenchmarkE2ECaseOutcome = {
  status: BenchmarkE2ECaseOutcomeStatus;
  expectationResults: Record<string, boolean | null>;
  forbiddenViolations: string[];
  failure: BenchmarkE2EFailure | null;
};

export type BenchmarkE2ERunTrace = {
  benchmarkRunId: string;
  caseId: string;
  runOrdinal: number;
  executionMode: BenchmarkE2EExecutionMode;
  startedAt: string;
  finishedAt: string;
  initialState: BenchmarkE2EDurableStateSnapshot | null;
  turns: readonly BenchmarkE2ETurnTrace[];
  finalState: BenchmarkE2EDurableStateSnapshot | null;
  outcome: BenchmarkE2ECaseOutcome;
};

// ---------------------------------------------------------------------------
// Environment health precheck - Section "ENVIRONMENT HEALTH PRECHECK"
// ---------------------------------------------------------------------------

export const BENCHMARK_E2E_DEPENDENCY_NAMES = [
  "mariadb",
  "catalogService",
  "quoteService",
  "customerService",
  "carrierService",
  "providerEndpoint"
] as const;
export type BenchmarkE2EDependencyName = (typeof BENCHMARK_E2E_DEPENDENCY_NAMES)[number];

export const BENCHMARK_E2E_DEPENDENCY_STATUSES = ["READY", "DEGRADED", "BLOCKED", "NOT_REQUIRED"] as const;
export type BenchmarkE2EDependencyStatus = (typeof BENCHMARK_E2E_DEPENDENCY_STATUSES)[number];

export type BenchmarkE2EDependencyCheck = {
  name: BenchmarkE2EDependencyName;
  status: BenchmarkE2EDependencyStatus;
  detail: string;
};

export const BENCHMARK_E2E_ENVIRONMENT_STATUSES = ["READY", "DEGRADED", "BLOCKED"] as const;
export type BenchmarkE2EEnvironmentStatus = (typeof BENCHMARK_E2E_ENVIRONMENT_STATUSES)[number];

export type BenchmarkE2EEnvironmentHealth = {
  status: BenchmarkE2EEnvironmentStatus;
  checkedAt: string;
  dependencies: readonly BenchmarkE2EDependencyCheck[];
};

// ---------------------------------------------------------------------------
// Model / flags configuration recorded per run - Section "MODEL CONFIG" / "FEATURE FLAGS"
// ---------------------------------------------------------------------------

export type BenchmarkE2EModelConfig = {
  mode: "offline" | "live";
  provider: string | null;
  model: string | null;
  temperature: number | null;
  maxOutputTokens: number | null;
  /** P7.6-B. null in offline mode. */
  maxModelRetries: number | null;
  /** P7.6-B. null = field omitted from the request (provider default). */
  thinking: "enabled" | "disabled" | null;
  maxDecisions: number;
  maxToolExecutions: number;
  timeoutMs: number;
};

export type BenchmarkE2EFlagsConfig = {
  agentTurnInputShadowEnabled: boolean;
  commercialWorkKernelEnabled: boolean;
  commercialProposalShadowEnabled: boolean;
  commercialObjectiveReconciliationEnabled: boolean;
  capabilityEligibilityShadowEnabled: boolean;
  capabilityEligibilityInputEnabled: boolean;
  openTurnExecutionEnabled: boolean;
  harnessAlignedMessageModelEnabled: boolean;
  persistentSessionCognitionEnabled: boolean;
  sessionCompactionEnabled: boolean;
  liveTurnAssimilationEnabled: boolean;
  /** Always false by construction: this harness enters at runSalesAgentRuntimeCycle, never runNativeAutonomousCycle - the legacy CommercialWork routing branch is unreachable, not merely toggled off. */
  legacyCommercialWorkRuntimeReachable: false;
};

// ---------------------------------------------------------------------------
// Metrics - Sections "METRICS - CORE" / "METRICS - CONVERSATIONAL" / "BACKWARD COMPARISON"
// ---------------------------------------------------------------------------

export type BenchmarkE2ECommercialProgressionMetrics = {
  objectiveStarted: number;
  objectivePreserved: number;
  objectiveReplacedCorrectly: number;
  selectionCreated: number;
  destinationCreated: number;
  shippingCalculated: number;
  quoteCreated: number;
  quoteRetrieved: number;
  finalCommercialOutcomeQuoteExists: number;
};

export type BenchmarkE2EToolBehaviorMetrics = {
  requestedCapabilities: number;
  gatewayCompleted: number;
  gatewayRejected: number;
  invalidArguments: number;
  duplicateCalls: number;
  blockedAtTurnStartRequests: number;
  blockedThenRelevantEvidence: number;
  blockedWithoutRelevantEvidence: number;
};

export type BenchmarkE2EEligibilityCoherenceMetrics = {
  eligibleThenCompleted: number;
  eligibleThenRejected: number;
  blockedThenCompleted: number;
  blockedThenRejected: number;
};

export type BenchmarkE2EConversationalMetrics = {
  unnecessaryRequestionCount: number;
  greetingRepetitionCount: number;
  ungroundedQuoteClaimCount: number;
  ungroundedMutationClaimCount: number;
  responseAfterSuccessfulToolCount: number;
};

export type BenchmarkE2ELegacyMetrics = {
  /** LEGACY METRIC (Section "BACKWARD COMPARISON") - carried over unrelabeled from the ATL-level harness, never compared numerically against E2E metrics above without this label. */
  simpleToolSelectionPassRate: number | null;
  argumentValidityPassRate: number | null;
  mutationGroundingPassRate: number | null;
};

export type BenchmarkE2ESummaryMetrics = {
  runCompletionRate: number;
  commercialOutcomeCompletionRate: number | null;
  correctObjectiveBehaviorRate: number | null;
  correctToolSelectionRate: number | null;
  validArgumentsRate: number | null;
  gatewayCompletionRate: number | null;
  gatewayRejectionRate: number | null;
  unnecessaryRequestionRate: number | null;
  duplicateToolCallRate: number | null;
  ungroundedMutationClaimRate: number | null;
  quoteConversionRate: number | null;
  outboxCompletionRate: number | null;
  blockedRequestCoherenceRate: number | null;
  averageToolCallsPerRun: number | null;
  p50DecisionsPerRun: number | null;
  p95DecisionsPerRun: number | null;
  terminalReasonDistribution: Record<string, number>;
  commercialProgression: BenchmarkE2ECommercialProgressionMetrics;
  toolBehavior: BenchmarkE2EToolBehaviorMetrics;
  eligibilityCoherence: BenchmarkE2EEligibilityCoherenceMetrics;
  conversational: BenchmarkE2EConversationalMetrics;
  legacy: BenchmarkE2ELegacyMetrics;
};

// ---------------------------------------------------------------------------
// Artifacts - Section "OUTPUT ARTIFACTS"
// ---------------------------------------------------------------------------

export type BenchmarkE2EManifest = {
  gitSha: string | null;
  corpusVersion: string;
  startedAt: string;
  environmentHealth: BenchmarkE2EEnvironmentHealth;
  modelConfig: BenchmarkE2EModelConfig;
  flags: BenchmarkE2EFlagsConfig;
  /** P7.6-B. Every BENCHMARK_E2E_* variable in effect for this batch (empty = harness defaults). */
  benchmarkOverrides: Record<string, string>;
  /** P7.6-B. Runtime behavior the harness cannot exercise, stated instead of simulated. */
  notReproducibleInHarness: string[];
  runsPerCase: number;
  caseCount: number;
};

export type BenchmarkE2EArtifactBundle = {
  manifest: BenchmarkE2EManifest;
  runs: readonly BenchmarkE2ERunTrace[];
  summary: BenchmarkE2ESummaryMetrics;
  failures: readonly BenchmarkE2EFailure[];
};
