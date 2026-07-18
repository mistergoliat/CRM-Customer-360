import { createHash } from "node:crypto";
import { evaluateCommercialShadowResult } from "../evaluation/evaluateCommercialShadowResult";
import { COMMERCIAL_POLICY_VERSION } from "../policy/policyConstants";
import { loadCommercialState } from "./loadCommercialState";
import { persistCommercialState } from "./persistCommercialState";
import { reduceCommercialState } from "./reduceCommercialState";
import { resolveOpportunityIdentity } from "./resolveOpportunityIdentity";
import { selectNextCommercialAction } from "./selectNextCommercialAction";
import { validateCommercialTransition } from "./validateCommercialTransition";
import type {
  CommercialOperationalDecisionRecord,
  CommercialOperationalLoopClock,
  CommercialOperationalLoopError,
  CommercialOperationalLoopInput,
  CommercialOperationalLoopMetrics,
  CommercialOperationalLoopResult,
  CommercialOperationalLoopSideEffects,
  CommercialOperationalLoopStageResult,
  CommercialOperationalStateDiff,
  CommercialOperationalPersistenceResult,
  CommercialOperationalState,
  CommercialOperationalTransitionValidation,
  CommercialOperationalLoadStateResult,
  CommercialOperationalOpportunityIdentityResolution,
  CommercialOperationalNextActionSelectionInput
} from "./types";
import type { CommercialOperationalLoopSkipReason, CommercialOperationalLoopStageName, CommercialOperationalLoopStatus, CommercialOperationalLoopWarning } from "./constants";
import { COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_MODE, COMMERCIAL_OPERATIONAL_LOOP_VERSION } from "./constants";
import { sanitizeCommercialObject } from "../context/adapters";
import type { CommercialShadowResult } from "../shadow";
import type { CommercialEvaluationResult } from "../evaluation";
import type { CommercialPolicyResult } from "../policy";
import type { SalesAgentResult } from "../sales-agent/validationTypes";
import type { CommercialContextBuilderResult } from "../context/types";
import type { CommercialReadinessDecision, CommercialDecisionComparisonStatus } from "../evaluation/evaluationConstants";

function toIsoString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function createClock(currentTime: string | Date, provided?: CommercialOperationalLoopClock): CommercialOperationalLoopClock {
  if (provided) return provided;
  const fixedNow = new Date(toIsoString(currentTime)).getTime();
  return {
    now: () => (Number.isFinite(fixedNow) ? fixedNow : 0),
    toISOString: (value) => {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? new Date(Number.isFinite(fixedNow) ? fixedNow : 0).toISOString() : date.toISOString();
    }
  };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const sanitized = sanitizeCommercialObject(metadata ?? {});
  return sanitized.value ?? {};
}

function createStage(
  stage: CommercialOperationalLoopStageName,
  status: CommercialOperationalLoopStageResult["status"],
  startedAt: string,
  completedAt: string,
  warnings: CommercialOperationalLoopWarning[] = [],
  errorCode?: string | null,
  counts?: Record<string, number>
): CommercialOperationalLoopStageResult {
  return {
    stage,
    status,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    warnings: uniqueStrings(warnings) as CommercialOperationalLoopWarning[],
    errorCode: errorCode ?? null,
    version: COMMERCIAL_OPERATIONAL_LOOP_VERSION,
    counts
  };
}

function emptySideEffects(): CommercialOperationalLoopSideEffects {
  return {
    outboundExecuted: false,
    toolsExecuted: 0,
    followupScheduled: false,
    quoteCreated: false,
    leadCreated: false,
    caseMutated: false,
    controlsResponsePolicy: false,
    nextActionExecuted: false,
    commercialOpportunityWritten: false,
    commercialDecisionWritten: false
  };
}

function stableDecisionId(input: CommercialOperationalLoopInput, resultingStateKey: string, nextActionType: string, version: number) {
  const hash = createHash("sha256");
  hash.update([
    input.correlationId,
    input.processInboundRunId ?? "",
    input.salesAgentRunId ?? "",
    resultingStateKey,
    nextActionType,
    String(version),
    input.currentTime instanceof Date ? input.currentTime.toISOString() : input.currentTime
  ].join("|"));
  return `commercial-decision-${hash.digest("hex").slice(0, 32)}`;
}

function buildVersions(input: CommercialOperationalLoopInput) {
  return {
    loopVersion: COMMERCIAL_OPERATIONAL_LOOP_VERSION,
    salesAgentContractVersion: input.contractVersion ?? null,
    salesAgentRuntimeVersion: input.runtimeVersion ?? null,
    policyVersion: input.policyVersion ?? COMMERCIAL_POLICY_VERSION,
    promptVersion: input.promptVersion ?? null,
    evaluationVersion: input.evaluationVersion ?? null
  };
}

function mapReadinessDecision(value: CommercialEvaluationResult["classification"]["usefulness"] | null): CommercialReadinessDecision | null {
  if (value === "useful") return "READY_FOR_CONTROLLED_PILOT";
  if (value === "partially_useful") return "NEEDS_CONTEXT_IMPROVEMENT";
  if (value === "not_useful") return "NOT_READY";
  if (value === "cannot_determine") return "INSUFFICIENT_DATA";
  return null;
}

function mapComparisonStatus(value: string | null | undefined): CommercialDecisionComparisonStatus | null {
  if (value === "aligned" || value === "partially_aligned" || value === "divergent" || value === "not_comparable") return value;
  return null;
}

function buildMetrics(args: {
  startedAt: string;
  completedAt: string;
  loadStateDurationMs: number;
  identityResolutionDurationMs: number;
  reductionDurationMs: number;
  nextActionSelectionDurationMs: number;
  transitionValidationDurationMs: number;
  persistenceDurationMs: number;
  inputCharacters: number;
  outputCharacters: number;
  loadedOpportunityCount: number;
  warningsCount: number;
  persistenceAttempted: boolean;
  persistenceSucceeded: boolean;
  decisionRecorded: boolean;
  evaluationStatus: CommercialEvaluationResult["status"] | null;
  readinessDecision: CommercialReadinessDecision | null;
  usefulness: CommercialEvaluationResult["classification"]["usefulness"] | null;
  comparisonStatus: CommercialDecisionComparisonStatus | null;
}): CommercialOperationalLoopMetrics {
  const durationMs = Math.max(0, new Date(args.completedAt).getTime() - new Date(args.startedAt).getTime());
  return {
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    durationMs,
    loadStateDurationMs: args.loadStateDurationMs,
    identityResolutionDurationMs: args.identityResolutionDurationMs,
    reductionDurationMs: args.reductionDurationMs,
    nextActionSelectionDurationMs: args.nextActionSelectionDurationMs,
    transitionValidationDurationMs: args.transitionValidationDurationMs,
    persistenceDurationMs: args.persistenceDurationMs,
    inputCharacters: args.inputCharacters,
    outputCharacters: args.outputCharacters,
    loadedOpportunityCount: args.loadedOpportunityCount,
    warningsCount: args.warningsCount,
    persistenceAttempted: args.persistenceAttempted,
    persistenceSucceeded: args.persistenceSucceeded,
    decisionRecorded: args.decisionRecorded,
    evaluationStatus: args.evaluationStatus,
    readinessDecision: args.readinessDecision,
    usefulness: args.usefulness,
    comparisonStatus: args.comparisonStatus
  };
}

function buildEvaluationSummary(result: CommercialEvaluationResult | null) {
  if (!result) return null;
  const readinessDecision: CommercialReadinessDecision =
    result.classification.usefulness === "useful"
      ? "READY_FOR_CONTROLLED_PILOT"
      : result.classification.usefulness === "partially_useful"
        ? "NEEDS_CONTEXT_IMPROVEMENT"
        : result.classification.usefulness === "not_useful"
          ? "NOT_READY"
          : "INSUFFICIENT_DATA";
  return {
    status: result.status,
    readinessDecision,
    usefulness: result.classification.usefulness,
    comparisonStatus: (result.comparison?.status ?? null) as CommercialDecisionComparisonStatus | null
  };
}

function buildSafeError(stage: string, error: unknown): CommercialOperationalLoopError {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: error instanceof Error && error.name ? error.name : "unknown_error",
    message: message
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
      .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
      .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
      .trim() || "Commercial operational loop failed.",
    stage: stage as CommercialOperationalLoopError["stage"],
    details: {}
  };
}

function buildSkippedResult(input: CommercialOperationalLoopInput, options: {
  status: CommercialOperationalLoopStatus;
  skipReason: CommercialOperationalLoopSkipReason | null;
  reason: string;
  warnings?: CommercialOperationalLoopWarning[];
  eligible: boolean;
  stage: CommercialOperationalLoopStageName;
  stages?: CommercialOperationalLoopStageResult[];
}): CommercialOperationalLoopResult {
  const clock = createClock(input.currentTime, input.clock);
  const startedAt = clock.toISOString(clock.now());
  const completedAt = clock.toISOString(clock.now());
  const stages =
    options.stages ?? [
      createStage(options.stage, options.status === "skipped" ? "skipped" : "completed", startedAt, completedAt, options.warnings ?? [], options.skipReason ?? null)
    ];
  const warnings = uniqueStrings([...(options.warnings ?? []), options.skipReason ?? undefined]) as CommercialOperationalLoopWarning[];
  return {
    status: options.status,
    mode: input.mode ?? COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_MODE,
    enabled: input.featureFlags.commercialOperationalLoopEnabled,
    dryRun: !input.featureFlags.commercialStatePersistenceEnabled,
    eligible: options.eligible,
    skipReason: options.skipReason,
    correlationId: input.correlationId,
    processInboundRunId: input.processInboundRunId ?? null,
    salesAgentRunId: input.salesAgentRunId ?? null,
    observedAt: startedAt,
    previousState: null,
    resultingState: null,
    stateDiff: null,
    identityResolution: null,
    selectedNextAction: null,
    transitionValidation: null,
    persistenceResult: {
      status: "skipped",
      opportunityWritten: false,
      decisionWritten: false,
      opportunityId: null,
      opportunityKey: "skipped",
      decisionId: "skipped",
      version: null,
      createdAt: completedAt,
      warnings,
      reason: options.reason
    },
    decisionRecord: null,
    commercialEvaluationSummary: buildEvaluationSummary(input.commercialEvaluationResult ?? null),
    stages,
    metrics: buildMetrics({
      startedAt,
      completedAt,
      loadStateDurationMs: 0,
      identityResolutionDurationMs: 0,
      reductionDurationMs: 0,
      nextActionSelectionDurationMs: 0,
      transitionValidationDurationMs: 0,
      persistenceDurationMs: 0,
      inputCharacters: input.inboundMessage.messageText.length,
      outputCharacters: 0,
      loadedOpportunityCount: 0,
      warningsCount: warnings.length,
      persistenceAttempted: false,
      persistenceSucceeded: false,
      decisionRecorded: false,
      evaluationStatus: input.commercialEvaluationResult?.status ?? null,
      readinessDecision: mapReadinessDecision(input.commercialEvaluationResult?.classification.usefulness ?? null),
      usefulness: input.commercialEvaluationResult?.classification.usefulness ?? null,
      comparisonStatus: mapComparisonStatus(input.commercialEvaluationResult?.comparison?.status ?? null)
    }),
    warnings,
    error: null,
    versions: buildVersions(input),
    metadata: sanitizeMetadata({
      ...input.metadata,
      commercialOperationalLoop: {
        status: options.status,
        skipReason: options.skipReason,
        reason: options.reason
      }
    }),
    sideEffects: emptySideEffects(),
    executionDisposition: "not_executed",
    continueLegacyFlow: true
  };
}

function buildFailedSafeResult(
  input: CommercialOperationalLoopInput,
  args: {
    status: CommercialOperationalLoopStatus;
    failureStage: CommercialOperationalLoopStageName;
    reason: string;
    warnings?: CommercialOperationalLoopWarning[];
    eligible: boolean;
    previousState?: CommercialOperationalState | null;
    resultingState?: CommercialOperationalState | null;
    identityResolution?: CommercialOperationalOpportunityIdentityResolution | null;
    nextAction?: CommercialOperationalLoopResult["selectedNextAction"];
    transitionValidation?: CommercialOperationalTransitionValidation | null;
    persistenceResult?: CommercialOperationalPersistenceResult | null;
    decisionRecord?: CommercialOperationalDecisionRecord | null;
    commercialEvaluationSummary?: CommercialOperationalLoopResult["commercialEvaluationSummary"];
    stages?: CommercialOperationalLoopStageResult[];
    error?: CommercialOperationalLoopError | null;
    executionDisposition?: CommercialOperationalLoopResult["executionDisposition"];
    sideEffects?: Partial<CommercialOperationalLoopSideEffects>;
    skipReason?: CommercialOperationalLoopSkipReason | null;
  }
): CommercialOperationalLoopResult {
  const clock = createClock(input.currentTime, input.clock);
  const startedAt = clock.toISOString(clock.now());
  const completedAt = clock.toISOString(clock.now());
  const warnings = uniqueStrings([...(args.warnings ?? []), "commercial_state_failed_safe"]) as CommercialOperationalLoopWarning[];
  const stages =
    args.stages ??
    [
      createStage(
        args.failureStage,
        args.status === "blocked"
            ? "blocked"
            : args.status === "persistence_failed"
              ? "persistence_failed"
              : "failed_safe",
        startedAt,
        completedAt,
        warnings,
        args.error?.code ?? "commercial_state_failed_safe"
      )
    ];
  return {
    status: args.status,
    mode: input.mode ?? COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_MODE,
    enabled: input.featureFlags.commercialOperationalLoopEnabled,
    dryRun: !input.featureFlags.commercialStatePersistenceEnabled,
    eligible: args.eligible,
    skipReason: args.skipReason ?? null,
    correlationId: input.correlationId,
    processInboundRunId: input.processInboundRunId ?? null,
    salesAgentRunId: input.salesAgentRunId ?? null,
    observedAt: startedAt,
    previousState: args.previousState ?? null,
    resultingState: args.resultingState ?? null,
    stateDiff: null,
    identityResolution: args.identityResolution ?? null,
    selectedNextAction: args.nextAction ?? null,
    transitionValidation: args.transitionValidation ?? null,
    persistenceResult: args.persistenceResult ?? null,
    decisionRecord: args.decisionRecord ?? null,
    commercialEvaluationSummary: args.commercialEvaluationSummary ?? buildEvaluationSummary(input.commercialEvaluationResult ?? null),
    stages,
    metrics: buildMetrics({
      startedAt,
      completedAt,
      loadStateDurationMs: 0,
      identityResolutionDurationMs: 0,
      reductionDurationMs: 0,
      nextActionSelectionDurationMs: 0,
      transitionValidationDurationMs: 0,
      persistenceDurationMs: 0,
      inputCharacters: input.inboundMessage.messageText.length,
      outputCharacters: 0,
      loadedOpportunityCount: 0,
      warningsCount: warnings.length,
      persistenceAttempted: false,
      persistenceSucceeded: false,
      decisionRecorded: false,
      evaluationStatus: input.commercialEvaluationResult?.status ?? null,
      readinessDecision: mapReadinessDecision(input.commercialEvaluationResult?.classification.usefulness ?? null),
      usefulness: input.commercialEvaluationResult?.classification.usefulness ?? null,
      comparisonStatus: mapComparisonStatus(input.commercialEvaluationResult?.comparison?.status ?? null)
    }),
    warnings,
    error: args.error ?? buildSafeError(args.failureStage, new Error(args.reason)),
    versions: buildVersions(input),
    metadata: sanitizeMetadata({
      ...input.metadata,
      commercialOperationalLoop: {
        status: args.status,
        failureStage: args.failureStage,
        reason: args.reason
      }
    }),
    sideEffects: {
      ...emptySideEffects(),
      ...(args.sideEffects ?? {})
    },
    executionDisposition: args.executionDisposition ?? "not_executed",
    continueLegacyFlow: true
  };
}

function buildDecisionRecord(
  input: CommercialOperationalLoopInput,
  resultingState: CommercialOperationalState,
  nextAction: ReturnType<typeof selectNextCommercialAction>,
  transitionValidation: CommercialOperationalTransitionValidation,
  identityResolution: CommercialOperationalOpportunityIdentityResolution,
  stateDiff: CommercialOperationalStateDiff,
  warnings: CommercialOperationalLoopWarning[]
): CommercialOperationalDecisionRecord {
  const opportunityId = resultingState.opportunityId ?? identityResolution.selectedOpportunityId ?? identityResolution.opportunityId;
  const decisionId = stableDecisionId(input, resultingState.opportunityKey, nextAction.type, resultingState.version);
  return {
    decisionId,
    opportunityId: opportunityId ?? resultingState.opportunityKey,
    opportunityKey: resultingState.opportunityKey,
    correlationId: input.correlationId,
    processInboundRunId: input.processInboundRunId ?? null,
    salesAgentRunId: input.salesAgentRunId ?? null,
    messageId: input.inboundMessage.messageId ?? null,
    previousStatus: transitionValidation.fromStatus,
    nextStatus: transitionValidation.toStatus,
    previousStage: transitionValidation.fromStage,
    nextStage: transitionValidation.toStage,
    detectedSignals: [...new Set(resultingState.signals)] as CommercialOperationalDecisionRecord["detectedSignals"],
    stateChanges: stateDiff,
    missingInformation: [...nextAction.requiredInformation],
    nextAction,
    policyStatus: input.commercialPolicyResult?.status ?? "blocked",
    riskLevel: input.commercialPolicyResult?.riskLevel ?? "blocked",
    approvalRequirement: input.commercialPolicyResult?.requiresApproval ?? "blocked",
    decisionStatus: "recorded",
    rationale: nextAction.reason,
    warnings,
    contractVersion: input.contractVersion ?? null,
    policyVersion: input.policyVersion ?? COMMERCIAL_POLICY_VERSION,
    runtimeVersion: input.runtimeVersion ?? null,
    createdAt: input.currentTime instanceof Date ? input.currentTime.toISOString() : input.currentTime
  };
}

function buildDefaultInputContext(
  input: CommercialOperationalLoopInput,
  shadowResult: CommercialShadowResult | null
): {
  commercialContext: CommercialContextBuilderResult | null;
  salesAgentResult: SalesAgentResult | null;
  commercialPolicyResult: CommercialPolicyResult | null;
  commercialEvaluationResult: CommercialEvaluationResult | null;
} {
  const commercialContext = input.commercialContext ?? shadowResult?.context?.commercialContext ?? null;
  const commercialPolicyResult = input.commercialPolicyResult ?? shadowResult?.context?.policyResult ?? null;
  const rawSalesAgentResult = input.salesAgentResult ?? shadowResult?.context?.runtimeResult?.result ?? null;
  /**
   * ACS-R1-05-T06.2: once a commercial policy result exists, its
   * `governedResult` is the SOLE authority for what the rest of the loop
   * (state reduction, next-action selection, decision content) treats as the
   * Sales Agent's proposal. The raw/ungoverned result must never be
   * reintroduced downstream - it stays available only via
   * `commercialPolicyResult.originalResultReference`/the raw shadow result
   * for audit, telemetry and debug comparison.
   */
  const salesAgentResult = commercialPolicyResult?.governedResult ?? rawSalesAgentResult;
  const commercialEvaluationResult =
    input.commercialEvaluationResult ??
    (shadowResult
      ? evaluateCommercialShadowResult({
          sampleId: input.processInboundRunId ?? input.correlationId,
          timestamp: input.currentTime,
          scenario: "commercial_operational_loop",
          expectedTags: [],
          shadowResult,
          metadata: sanitizeMetadata(input.metadata),
          currentTime: input.currentTime
        })
      : null);

  return {
    commercialContext,
    salesAgentResult,
    commercialPolicyResult,
    commercialEvaluationResult
  };
}

export async function runCommercialOperationalLoop(input: CommercialOperationalLoopInput): Promise<CommercialOperationalLoopResult> {
  const clock = createClock(input.currentTime, input.clock);
  const startedAtMs = clock.now();
  const startedAt = clock.toISOString(startedAtMs);
  const featureFlags = input.featureFlags;
  const mode = input.mode ?? COMMERCIAL_OPERATIONAL_LOOP_DEFAULT_MODE;
  const safeMetadata = sanitizeMetadata(input.metadata);

  if (!featureFlags.commercialOperationalLoopEnabled) {
    return buildSkippedResult(input, {
      status: "skipped",
      skipReason: "skipped_by_flag",
      reason: "Commercial operational loop is disabled.",
      warnings: ["commercial_loop_disabled"],
      eligible: false,
      stage: "eligibility"
    });
  }

  if (input.abortSignal?.aborted) {
    return buildFailedSafeResult(input, {
      status: "failed_safe",
      failureStage: "eligibility",
      reason: "Commercial operational loop was cancelled.",
      warnings: ["commercial_loop_cancelled"],
      eligible: true,
      error: buildSafeError("eligibility", new Error("Commercial operational loop cancelled.")),
      executionDisposition: "not_executed"
    });
  }

  const shadowResult = input.commercialShadowResult ?? null;
  if (!shadowResult) {
    return buildSkippedResult(input, {
      status: "skipped",
      skipReason: "no_shadow_result",
      reason: "No commercial shadow result was provided.",
      warnings: ["commercial_loop_skipped"],
      eligible: false,
      stage: "eligibility"
    });
  }

  if (shadowResult.status === "disabled" || shadowResult.status === "skipped") {
    return buildSkippedResult(input, {
      status: "skipped",
      skipReason: "no_shadow_result",
      reason: "Commercial shadow did not produce an eligible result.",
      warnings: ["commercial_loop_skipped"],
      eligible: false,
      stage: "eligibility"
    });
  }

  if (shadowResult.status === "failed_safe" || shadowResult.status === "timeout" || shadowResult.status === "cancelled") {
    return buildFailedSafeResult(input, {
      status: "failed_safe",
      failureStage: "eligibility",
      reason: "Commercial shadow result is not trustworthy enough for the operational loop.",
      warnings: ["commercial_state_failed_safe"],
      eligible: true,
      skipReason: null,
      error: buildSafeError("eligibility", new Error("Commercial shadow unavailable.")),
      executionDisposition: "not_executed"
    });
  }

  const context = buildDefaultInputContext(input, shadowResult);
  if (!context.salesAgentResult || !context.commercialPolicyResult) {
    return buildFailedSafeResult(input, {
      status: "failed_safe",
      failureStage: "eligibility",
      reason: "Sales Agent result or Commercial Policy result is missing.",
      warnings: ["commercial_state_missing"],
      eligible: true,
      error: buildSafeError("eligibility", new Error("Commercial context unavailable.")),
      executionDisposition: "not_executed"
    });
  }

  const loadStartedAt = clock.toISOString(clock.now());
  const loadResult: CommercialOperationalLoadStateResult = await (input.storage?.loadCommercialState ?? loadCommercialState)({
    inboundMessage: input.inboundMessage,
    brainContext: input.brainContext,
    commercialContext: context.commercialContext,
    currentTime: input.currentTime,
    correlationId: input.correlationId,
    metadata: safeMetadata
  });
  const loadCompletedAt = clock.toISOString(clock.now());

  const identityResolutionStartedAt = clock.toISOString(clock.now());
  const identityResolution = resolveOpportunityIdentity({
    inboundMessage: input.inboundMessage,
    brainContext: input.brainContext,
    commercialContext: context.commercialContext,
    loadResult,
    currentTime: input.currentTime,
    correlationId: input.correlationId,
    metadata: safeMetadata
  });
  const identityResolutionCompletedAt = clock.toISOString(clock.now());

  if (identityResolution.status === "no_commercial_signal") {
    return buildSkippedResult(input, {
      status: "skipped",
      skipReason: "no_commercial_signal",
      reason: identityResolution.reason,
      warnings: uniqueStrings([...identityResolution.warnings, "commercial_loop_skipped"]) as CommercialOperationalLoopWarning[],
      eligible: false,
      stage: "identity_resolution",
      stages: [
        createStage("eligibility", "completed", startedAt, loadStartedAt, [], null),
        createStage("load_state", "completed", loadStartedAt, loadCompletedAt, loadResult.warnings, null),
        createStage("identity_resolution", "skipped", identityResolutionStartedAt, identityResolutionCompletedAt, identityResolution.warnings, "no_commercial_signal")
      ]
    });
  }

  const reductionStartedAt = clock.toISOString(clock.now());
  const reductionResult = reduceCommercialState({
    previousState: identityResolution.selectedState ?? loadResult.activeState ?? null,
    identityResolution,
    loadResult,
    brainContext: input.brainContext,
    inboundMessage: input.inboundMessage,
    commercialContext: context.commercialContext,
    salesAgentResult: context.salesAgentResult,
    commercialPolicyResult: context.commercialPolicyResult,
    commercialEvaluationResult: context.commercialEvaluationResult,
    currentTime: input.currentTime,
    correlationId: input.correlationId,
    processInboundRunId: input.processInboundRunId ?? null,
    salesAgentRunId: input.salesAgentRunId ?? null,
    featureFlags: input.featureFlags,
    metadata: safeMetadata
  });
  const reductionCompletedAt = clock.toISOString(clock.now());

  const nextActionSelectionStartedAt = clock.toISOString(clock.now());
  const nextAction = selectNextCommercialAction({
    previousState: identityResolution.selectedState ?? loadResult.activeState ?? null,
    resultingState: reductionResult.resultingState,
    identityResolution,
    commercialPolicyResult: context.commercialPolicyResult,
    commercialEvaluationResult: context.commercialEvaluationResult,
    salesAgentResult: context.salesAgentResult,
    currentTime: input.currentTime,
    featureFlags: input.featureFlags,
    metadata: safeMetadata
  } satisfies CommercialOperationalNextActionSelectionInput);
  const nextActionSelectionCompletedAt = clock.toISOString(clock.now());

  const transitionValidationStartedAt = clock.toISOString(clock.now());
  const transitionValidation = validateCommercialTransition({
    previousState: identityResolution.selectedState ?? loadResult.activeState ?? null,
    resultingState: reductionResult.resultingState,
    nextAction,
    identityResolution,
    commercialPolicyResult: context.commercialPolicyResult,
    commercialEvaluationResult: context.commercialEvaluationResult,
    featureFlags: input.featureFlags,
    metadata: safeMetadata
  });
  const transitionValidationCompletedAt = clock.toISOString(clock.now());

  const stageWarnings = uniqueStrings([
    ...loadResult.warnings,
    ...identityResolution.warnings,
    ...reductionResult.warnings,
    ...(transitionValidation.status === "blocked" ? transitionValidation.blockedReasons : []),
    ...(context.commercialEvaluationResult?.warnings ?? []),
    ...(shadowResult.warnings ?? [])
  ]) as CommercialOperationalLoopWarning[];

  if (identityResolution.status === "blocked" || transitionValidation.status === "blocked") {
    return buildFailedSafeResult(input, {
      status: "blocked",
      failureStage: identityResolution.status === "blocked" ? "identity_resolution" : "transition_validation",
      reason: identityResolution.status === "blocked" ? identityResolution.reason : transitionValidation.reason,
      warnings: stageWarnings,
      eligible: true,
      previousState: identityResolution.selectedState ?? loadResult.activeState ?? null,
      resultingState: reductionResult.resultingState,
      identityResolution,
      nextAction,
      transitionValidation,
      commercialEvaluationSummary: buildEvaluationSummary(context.commercialEvaluationResult),
      stages: [
        createStage("eligibility", "completed", startedAt, loadStartedAt, [], null),
        createStage("load_state", loadResult.status === "error" ? "failed_safe" : "completed", loadStartedAt, loadCompletedAt, loadResult.warnings, loadResult.status === "error" ? "commercial_state_missing" : null),
        createStage("identity_resolution", identityResolution.status === "blocked" ? "blocked" : "completed", identityResolutionStartedAt, identityResolutionCompletedAt, identityResolution.warnings, identityResolution.status === "blocked" ? "commercial_state_conflict" : null),
        createStage("state_reduction", "completed", reductionStartedAt, reductionCompletedAt, reductionResult.warnings, null),
        createStage("next_action_selection", "completed", nextActionSelectionStartedAt, nextActionSelectionCompletedAt, [], null),
        createStage(
          "transition_validation",
          "blocked",
          transitionValidationStartedAt,
          transitionValidationCompletedAt,
          transitionValidation.blockedReasons as CommercialOperationalLoopWarning[],
          "transition_blocked"
        )
      ],
      error: buildSafeError("transition_validation", new Error(transitionValidation.reason)),
      executionDisposition: "not_executed"
    });
  }

  const persistenceStartedAt = clock.toISOString(clock.now());
  const decisionRecord = buildDecisionRecord(
    input,
    reductionResult.resultingState,
    nextAction,
    transitionValidation,
    identityResolution,
    reductionResult.stateDiff,
    stageWarnings
  );
  let persistenceResult: CommercialOperationalPersistenceResult = {
    status: "skipped",
    opportunityWritten: false,
    decisionWritten: false,
    opportunityId: reductionResult.resultingState.opportunityId,
    opportunityKey: reductionResult.resultingState.opportunityKey,
    decisionId: decisionRecord.decisionId,
    version: reductionResult.resultingState.version,
    createdAt: decisionRecord.createdAt,
    warnings: [],
    reason: input.featureFlags.commercialStatePersistenceEnabled ? null : "Commercial state persistence is disabled."
  };
  let sideEffects = emptySideEffects();
  let persistenceDurationMs = 0;
  let persistenceAttempted = false;
  let persistenceSucceeded = false;

  if (input.featureFlags.commercialStatePersistenceEnabled) {
    persistenceAttempted = true;
    persistenceResult = await (input.storage?.persistCommercialState ?? persistCommercialState)({
      currentTime: input.currentTime,
      previousState: identityResolution.selectedState ?? loadResult.activeState ?? null,
      resultingState: reductionResult.resultingState,
      identityResolution,
      transitionValidation,
      nextAction,
      decisionRecord,
      featureFlags: input.featureFlags,
      metadata: safeMetadata
    });
    persistenceDurationMs = Math.max(0, clock.now() - new Date(persistenceStartedAt).getTime());
    persistenceSucceeded = persistenceResult.status === "persisted" || persistenceResult.status === "duplicate";
    sideEffects = {
      ...sideEffects,
      commercialOpportunityWritten: persistenceResult.status === "persisted",
      commercialDecisionWritten: persistenceResult.status === "persisted"
    };
    if (persistenceResult.status === "conflict" || persistenceResult.status === "failed_safe") {
      return buildFailedSafeResult(input, {
        status: "persistence_failed",
        failureStage: "persistence",
        reason: persistenceResult.reason ?? "Commercial state persistence failed.",
        warnings: uniqueStrings([...(stageWarnings as string[]), ...((persistenceResult.warnings ?? []) as string[])]) as CommercialOperationalLoopWarning[],
        eligible: true,
        previousState: identityResolution.selectedState ?? loadResult.activeState ?? null,
        resultingState: reductionResult.resultingState,
        identityResolution,
        nextAction,
        transitionValidation,
        persistenceResult,
        decisionRecord,
        commercialEvaluationSummary: buildEvaluationSummary(context.commercialEvaluationResult),
        stages: [
          createStage("eligibility", "completed", startedAt, loadStartedAt, [], null),
          createStage("load_state", loadResult.status === "error" ? "failed_safe" : "completed", loadStartedAt, loadCompletedAt, loadResult.warnings, loadResult.status === "error" ? "commercial_state_missing" : null),
          createStage("identity_resolution", "completed", identityResolutionStartedAt, identityResolutionCompletedAt, identityResolution.warnings, null),
          createStage("state_reduction", "completed", reductionStartedAt, reductionCompletedAt, reductionResult.warnings, null),
          createStage("next_action_selection", "completed", nextActionSelectionStartedAt, nextActionSelectionCompletedAt, [], null),
          createStage("transition_validation", "completed", transitionValidationStartedAt, transitionValidationCompletedAt, [], null),
          createStage("persistence", "failed_safe", persistenceStartedAt, clock.toISOString(clock.now()), persistenceResult.warnings, persistenceResult.status)
        ],
        error: buildSafeError("persistence", new Error(persistenceResult.reason ?? "Commercial state persistence failed.")),
        sideEffects,
        executionDisposition: "not_executed"
      });
    }
  }

  const persistenceCompletedAt = clock.toISOString(clock.now());
  const completedAt = persistenceCompletedAt;
  const stages = [
    createStage("eligibility", "completed", startedAt, loadStartedAt, [], null),
    createStage("load_state", loadResult.status === "error" ? "failed_safe" : "completed", loadStartedAt, loadCompletedAt, loadResult.warnings, loadResult.status === "error" ? "commercial_state_missing" : null, { rowCount: loadResult.candidates.length }),
    createStage("identity_resolution", "completed", identityResolutionStartedAt, identityResolutionCompletedAt, identityResolution.warnings, null, { candidateCount: identityResolution.candidateOpportunityIds.length }),
    createStage("state_reduction", "completed", reductionStartedAt, reductionCompletedAt, reductionResult.warnings, null, {
      signalCount: reductionResult.resultingState.signals.length,
      requirementCount: reductionResult.resultingState.requirements.length,
      objectionCount: reductionResult.resultingState.objections.length
    }),
    createStage("next_action_selection", "completed", nextActionSelectionStartedAt, nextActionSelectionCompletedAt, [], null),
    createStage("transition_validation", "completed", transitionValidationStartedAt, transitionValidationCompletedAt, transitionValidation.warnings, null),
    createStage(
      "persistence",
      input.featureFlags.commercialStatePersistenceEnabled ? (persistenceResult.status === "persisted" || persistenceResult.status === "duplicate" ? "completed" : "skipped") : "skipped",
      persistenceStartedAt,
      persistenceCompletedAt,
      persistenceResult.warnings,
      persistenceResult.status
    ),
    createStage("decision_record", "completed", persistenceCompletedAt, completedAt, [], null),
    createStage("loop_complete", "completed", completedAt, completedAt, [], null)
  ];

  const warnings = uniqueStrings([
    ...stageWarnings,
    ...(persistenceResult.warnings ?? []),
    ...(nextAction.blockedReasons.length > 0 ? nextAction.blockedReasons : []),
    ...(transitionValidation.blockedReasons ?? []),
    ...(loadResult.status === "error" ? ["commercial_state_missing"] : []),
    ...(persistenceResult.status === "duplicate" ? ["commercial_state_retry_reused"] : [])
  ]) as CommercialOperationalLoopWarning[];

  const commercialEvaluationSummary = buildEvaluationSummary(context.commercialEvaluationResult);
  const metrics = buildMetrics({
    startedAt,
    completedAt,
    loadStateDurationMs: Math.max(0, new Date(loadCompletedAt).getTime() - new Date(loadStartedAt).getTime()),
    identityResolutionDurationMs: Math.max(0, new Date(identityResolutionCompletedAt).getTime() - new Date(identityResolutionStartedAt).getTime()),
    reductionDurationMs: Math.max(0, new Date(reductionCompletedAt).getTime() - new Date(reductionStartedAt).getTime()),
    nextActionSelectionDurationMs: Math.max(0, new Date(nextActionSelectionCompletedAt).getTime() - new Date(nextActionSelectionStartedAt).getTime()),
    transitionValidationDurationMs: Math.max(0, new Date(transitionValidationCompletedAt).getTime() - new Date(transitionValidationStartedAt).getTime()),
    persistenceDurationMs,
    inputCharacters: JSON.stringify({
      inboundMessage: input.inboundMessage,
      brainContext: input.brainContext,
      commercialContext: context.commercialContext ? { status: context.commercialContext.status, completeness: context.commercialContext.completeness } : null
    }).length,
    outputCharacters: JSON.stringify({
      resultingState: reductionResult.resultingState,
      nextAction,
      decisionRecord
    }).length,
    loadedOpportunityCount: loadResult.candidates.length,
    warningsCount: warnings.length,
    persistenceAttempted,
    persistenceSucceeded,
    decisionRecorded: persistenceResult.status === "persisted" || persistenceResult.status === "duplicate",
    evaluationStatus: context.commercialEvaluationResult?.status ?? null,
      readinessDecision: commercialEvaluationSummary?.readinessDecision ?? null,
      usefulness: commercialEvaluationSummary?.usefulness ?? null,
      comparisonStatus: commercialEvaluationSummary?.comparisonStatus ?? null
  });

  const result: CommercialOperationalLoopResult = {
    status: persistenceResult.status === "failed_safe" || persistenceResult.status === "conflict" ? "persistence_failed" : "completed",
    mode,
    enabled: featureFlags.commercialOperationalLoopEnabled,
    dryRun: !featureFlags.commercialStatePersistenceEnabled,
    eligible: true,
    skipReason: null,
    correlationId: input.correlationId,
    processInboundRunId: input.processInboundRunId ?? null,
    salesAgentRunId: input.salesAgentRunId ?? null,
    observedAt: startedAt,
    previousState: identityResolution.selectedState ?? loadResult.activeState ?? null,
    resultingState: reductionResult.resultingState,
    stateDiff: reductionResult.stateDiff,
    identityResolution,
    selectedNextAction: nextAction,
    transitionValidation,
    persistenceResult,
    decisionRecord,
    commercialEvaluationSummary,
    stages,
    metrics,
    warnings,
    error: null,
    versions: buildVersions(input),
    metadata: sanitizeMetadata({
      ...safeMetadata,
      commercialOperationalLoop: {
        status: persistenceResult.status === "failed_safe" || persistenceResult.status === "conflict" ? "persistence_failed" : "completed",
        loopVersion: COMMERCIAL_OPERATIONAL_LOOP_VERSION,
        decisionId: decisionRecord.decisionId
      }
    }),
    sideEffects,
    executionDisposition: persistenceResult.status === "persisted" ? "persisted" : "observe_only",
    continueLegacyFlow: true
  };

  return result;
}
