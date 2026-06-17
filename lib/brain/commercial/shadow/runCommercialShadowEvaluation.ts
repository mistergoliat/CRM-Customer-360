import { sanitizeCommercialObject } from "../context/adapters";
import { buildCommercialContext } from "../context/buildCommercialContext";
import { COMMERCIAL_POLICY_CONTRACT_VERSION, COMMERCIAL_POLICY_VERSION, evaluateCommercialPolicy } from "../policy";
import { createFakeSalesAgentProvider } from "../sales-agent/providers/fakeSalesAgentProvider";
import { runSalesAgentDryRun } from "../sales-agent/runSalesAgentDryRun";
import {
  SALES_AGENT_CONTRACT_VERSION,
  SALES_AGENT_PROMPT_VERSION,
  SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN,
  SALES_AGENT_RUNTIME_DEFAULT_MODE,
  SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS,
  SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS,
  SALES_AGENT_RUNTIME_VERSION
} from "../sales-agent/runtimeTypes";
import type { CommercialContextBuilderResult, CommercialContextSourceSummary } from "../types";
import { COMMERCIAL_SHADOW_CONTEXT_TIMEOUT_MS, COMMERCIAL_SHADOW_DEFAULT_TIMEOUT_MS, COMMERCIAL_SHADOW_POLICY_TIMEOUT_MS, COMMERCIAL_SHADOW_RUNTIME_TIMEOUT_MS, COMMERCIAL_SHADOW_VERSION } from "./shadowConstants";
import { createCommercialShadowFailedSafe } from "./createCommercialShadowFailedSafe";
import type {
  CommercialShadowCommercialContextSummary,
  CommercialShadowError,
  CommercialShadowGovernedResultSummary,
  CommercialShadowInput,
  CommercialShadowMetrics,
  CommercialShadowPolicySummary,
  CommercialShadowResult,
  CommercialShadowRuntimeSummary,
  CommercialShadowStageResult,
  CommercialShadowTelemetryEvent
} from "./shadowTypes";
import type {
  CommercialShadowFailureStage,
  CommercialShadowStatus,
  CommercialShadowWarning
} from "./shadowConstants";

type EvaluationState = {
  warnings: CommercialShadowWarning[];
  stages: CommercialShadowStageResult[];
  telemetry: CommercialShadowTelemetryEvent[];
  safeMetadata: Record<string, unknown>;
  clock: ReturnType<typeof buildClock>;
  startedAtMs: number;
  startedAt: string;
};

function toIsoString(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.filter((value) => Boolean(value)))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildClock(currentTime: string | Date, provided?: CommercialShadowInput["clock"]) {
  if (provided) {
    return {
      now: provided.now,
      toISOString: provided.toISOString
    };
  }

  const current = new Date(toIsoString(currentTime)).getTime();
  const fixedNow = Number.isFinite(current) ? current : 0;
  return {
    now: () => fixedNow,
    toISOString: (value: number | Date) => {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? new Date(fixedNow).toISOString() : date.toISOString();
    }
  };
}

function stageDuration(startedAt: string, completedAt: string) {
  return Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

function createStage(
  stage: CommercialShadowFailureStage,
  status: CommercialShadowStageResult["status"],
  startedAt: string,
  completedAt: string,
  warnings: readonly string[] = [],
  errorCode?: string | null,
  counts?: Record<string, number>
): CommercialShadowStageResult {
  return {
    stage,
    status,
    startedAt,
    completedAt,
    durationMs: stageDuration(startedAt, completedAt),
    warnings: uniqueStrings(warnings) as CommercialShadowWarning[],
    errorCode: errorCode ?? null,
    version: COMMERCIAL_SHADOW_VERSION,
    counts
  };
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined | null) {
  const result = sanitizeCommercialObject(metadata ?? {});
  return {
    value: result.value ?? {},
    applied: result.applied,
    fields: result.sanitizedFields
  };
}

function detectTechnicalEvent(input: CommercialShadowInput) {
  const metadata = input.inboundMessage.metadata;
  const metadataCandidate = isRecord(metadata)
    ? [
        metadata.eventType,
        metadata.event_type,
        metadata.messageType,
        metadata.message_type,
        metadata.type,
        metadata.status
      ]
    : [];

  const text = [
    input.inboundMessage.source,
    input.inboundMessage.sourceNode ?? "",
    input.inboundMessage.sourceWorkflow ?? "",
    input.inboundMessage.messageText ?? "",
    ...metadataCandidate.map((value) => (typeof value === "string" ? value : ""))
  ]
    .join(" ")
    .toLowerCase();

  return /status|callback|technical|internal|system|duplicate|echo|outbound/.test(text);
}

function evaluateEligibility(input: CommercialShadowInput): { eligible: boolean; skipReason: string | null; warnings: CommercialShadowWarning[] } {
  if (!input.shadowFlags.commercialShadowEnabled) {
    return { eligible: false, skipReason: "commercialShadowEnabled=false", warnings: ["shadow_disabled"] };
  }

  if (!input.inboundMessage.messageText.trim()) {
    return { eligible: false, skipReason: "empty_message", warnings: ["shadow_skipped"] };
  }

  if (input.inboundMessage.channel !== "whatsapp") {
    return { eligible: false, skipReason: "unsupported_channel", warnings: ["shadow_skipped"] };
  }

  if (input.inboundMessage.source === "system_job" || detectTechnicalEvent(input)) {
    return { eligible: false, skipReason: "technical_event", warnings: ["shadow_skipped"] };
  }

  return { eligible: true, skipReason: null, warnings: [] };
}

function buildCommercialInboundMessage(input: CommercialShadowInput, currentTime: string) {
  return {
    ...input.inboundMessage,
    id: input.inboundMessage.messageId,
    message_id: input.inboundMessage.messageId,
    message_text: input.inboundMessage.messageText,
    wa_id: input.inboundMessage.waId,
    phone_number_id: input.inboundMessage.phoneNumberId,
    conversation_case_id: input.inboundMessage.conversationCaseId,
    occurred_at: input.inboundMessage.receivedAt ?? currentTime,
    created_at: input.inboundMessage.receivedAt ?? currentTime,
    updated_at: input.inboundMessage.receivedAt ?? currentTime,
    source_workflow: input.inboundMessage.sourceWorkflow,
    source_node: input.inboundMessage.sourceNode,
    metadata: input.inboundMessage.metadata
  };
}

function buildChannelContext(commercialContext: CommercialContextBuilderResult, input: CommercialShadowInput) {
  const sourceSummary = commercialContext.sourceSummary;

  return {
    channel: input.inboundMessage.channel,
    available: input.inboundMessage.channel === "whatsapp",
    outboundAllowed: input.inboundMessage.channel === "whatsapp",
    manualApprovalRequired: Boolean(sourceSummary.humanOwnershipActive),
    optOut: Boolean(commercialContext.metadata.safeMetadata?.opt_out_active ?? false),
    quietHoursActive: false,
    humanOwnerActive: Boolean(sourceSummary.humanOwnershipActive),
    aiBlocked: Boolean(sourceSummary.aiBlocked),
    identityConflict: Boolean(input.brainContext.resolver_identity.identity_type === "mixed"),
    recentCustomerReply: Boolean(sourceSummary.hasLatestCustomerMessage),
    recentHumanContact: Boolean(sourceSummary.manualReplyActive)
  };
}

function buildCommercialContextSummary(result: CommercialContextBuilderResult): CommercialShadowCommercialContextSummary {
  return {
    status: result.status,
    completeness: result.completeness,
    warnings: [...result.warnings],
    sourceSummary: result.sourceSummary,
    metadata: result.metadata
  };
}

function buildRuntimeSummary(runtimeResult: Awaited<ReturnType<typeof runSalesAgentDryRun>>): CommercialShadowRuntimeSummary {
  return {
    status: runtimeResult.status,
    mode: runtimeResult.mode,
    validationStatus: runtimeResult.validation.status,
    providerName: runtimeResult.provider.name,
    providerVersion: runtimeResult.provider.version ?? null,
    providerRequestId: runtimeResult.provider.requestId ?? null,
    model: runtimeResult.metrics.model ?? null,
    finishReason: runtimeResult.provider.finishReason ?? null,
    outcome: runtimeResult.result.outcome,
    confidence: runtimeResult.result.analysis.confidence,
    shouldRespondNow: runtimeResult.result.shouldRespondNow,
    warningsCount: runtimeResult.warnings.length,
    rawOutputCaptured: runtimeResult.metadata.rawOutputCaptured,
    promptPreviewIncluded: runtimeResult.metadata.promptPreviewIncluded
  };
}

function buildPolicySummary(policyResult: ReturnType<typeof evaluateCommercialPolicy>): CommercialShadowPolicySummary {
  return {
    status: policyResult.status,
    overallDecision: policyResult.overallDecision,
    riskLevel: policyResult.riskLevel,
    requiresApproval: policyResult.requiresApproval,
    blockedClaims: policyResult.blockedClaims.length,
    blockedActions: policyResult.blockedActions.length,
    blockedToolRequests: policyResult.blockedToolRequests.length,
    blockedEntityProposals: policyResult.blockedEntityProposals.length,
    issueCount: policyResult.issues.length,
    warningCount: policyResult.warnings.length
  };
}

function buildGovernedResultSummary(policyResult: ReturnType<typeof evaluateCommercialPolicy>): CommercialShadowGovernedResultSummary {
  const governed = policyResult.governedResult;
  return {
    outcome: governed.outcome,
    confidence: governed.analysis.confidence,
    shouldRespondNow: governed.shouldRespondNow,
    policyStatus: policyResult.status,
    overallDecision: policyResult.overallDecision,
    riskLevel: policyResult.riskLevel,
    requiresApproval: governed.decision.requiresApproval,
    proposedActionCount: governed.proposedActions.length,
    blockedActionCount: policyResult.blockedActions.length,
    toolRequestCount: governed.toolRequests.length,
    blockedToolRequestCount: policyResult.blockedToolRequests.length,
    claimCount: governed.responseProposal?.claims.length ?? 0,
    blockedClaimCount: policyResult.blockedClaims.length,
    entityProposalCount: governed.entityProposals.length,
    warningsCount: governed.warnings.length,
    issueCodes: uniqueStrings(policyResult.issues.map((issue) => issue.code)),
    appliedRuleIds: [...policyResult.appliedRules]
  };
}

function buildMetrics(args: {
  startedAt: string;
  completedAt: string;
  eligibilityDurationMs: number;
  contextBuilderDurationMs: number;
  runtimeDurationMs: number;
  validationDurationMs: number;
  policyDurationMs: number;
  providerDurationMs: number;
  providerName: string | null;
  providerVersion: string | null;
  providerRequestId: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: number | null;
  inputCharacters: number;
  outputCharacters: number;
  timedOut: boolean;
  warningsCount: number;
}): CommercialShadowMetrics {
  const durationMs = stageDuration(args.startedAt, args.completedAt);
  return {
    startedAt: args.startedAt,
    completedAt: args.completedAt,
    durationMs,
    eligibilityDurationMs: args.eligibilityDurationMs,
    contextBuilderDurationMs: args.contextBuilderDurationMs,
    runtimeDurationMs: args.runtimeDurationMs,
    validationDurationMs: args.validationDurationMs,
    policyDurationMs: args.policyDurationMs,
    overheadMs: Math.max(0, durationMs - args.contextBuilderDurationMs - args.runtimeDurationMs - args.validationDurationMs - args.policyDurationMs),
    inputCharacters: args.inputCharacters,
    outputCharacters: args.outputCharacters,
    providerDurationMs: args.providerDurationMs,
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    estimatedCost: args.estimatedCost,
    providerRequestId: args.providerRequestId,
    timedOut: args.timedOut,
    warningsCount: args.warningsCount
  };
}

function buildTelemetryEvent(args: {
  event: string;
  stage: CommercialShadowTelemetryEvent["stage"];
  status: CommercialShadowStatus;
  mode: CommercialShadowTelemetryEvent["mode"];
  enabled: boolean;
  eligible: boolean;
  correlationId: string;
  executionId: string | null;
  durationMs: number;
  providerName: string | null;
  providerVersion: string | null;
  providerRequestId: string | null;
  model: string | null;
  policyStatus: CommercialShadowTelemetryEvent["policyStatus"];
  overallDecision: CommercialShadowTelemetryEvent["overallDecision"];
  riskLevel: CommercialShadowTelemetryEvent["riskLevel"];
  requiresApproval: CommercialShadowTelemetryEvent["requiresApproval"];
  warningsCount: number;
  errorCode: string | null;
  versions: CommercialShadowTelemetryEvent["versions"];
  metadata: Record<string, unknown>;
}): CommercialShadowTelemetryEvent {
  return {
    event: args.event,
    stage: args.stage,
    status: args.status,
    mode: args.mode,
    enabled: args.enabled,
    eligible: args.eligible,
    correlationId: args.correlationId,
    executionId: args.executionId,
    durationMs: args.durationMs,
    providerName: args.providerName,
    providerVersion: args.providerVersion,
    providerRequestId: args.providerRequestId,
    model: args.model,
    policyStatus: args.policyStatus,
    overallDecision: args.overallDecision,
    riskLevel: args.riskLevel,
    requiresApproval: args.requiresApproval,
    warningsCount: args.warningsCount,
    errorCode: args.errorCode,
    versions: args.versions,
    sideEffects: {
      messagesSent: 0,
      toolsExecuted: 0,
      databaseWrites: 0,
      outboxWrites: 0,
      leadsCreated: 0,
      opportunitiesCreated: 0,
      casesMutated: 0
    },
    metadata: args.metadata
  };
}

function createSafeError(stage: CommercialShadowFailureStage, error: unknown, providerName?: string | null, providerVersion?: string | null): CommercialShadowError {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Commercial shadow failed.";
  const sanitizedMessage = message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]+)\b/gi, "[redacted]")
    .replace(/\b(authorization|api[-_]?key|token|secret|password|cookie)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
    .trim();

  return {
    code: error instanceof Error && error.name ? error.name : "unknown_error",
    message: sanitizedMessage || "Commercial shadow failed.",
    stage,
    providerName: providerName ?? null,
    providerVersion: providerVersion ?? null,
    details: {}
  };
}

function buildContextPayload(input: CommercialShadowInput, currentTimeIso: string) {
  const inboundMessage = buildCommercialInboundMessage(input, currentTimeIso);
  return {
    brainContext: input.brainContext,
    inboundMessage,
    requestedMode: input.requestedMode ?? input.inboundMessage.contextMode,
    currentTime: currentTimeIso,
    timezone: input.timezone ?? "UTC",
    availableCapabilities: input.allowedCapabilities,
    policyContext: input.policyContext ?? undefined,
    metadata: input.metadata ?? {}
  };
}

function buildEarlyResult(
  input: CommercialShadowInput,
  state: EvaluationState,
  status: CommercialShadowStatus,
  skipReason: string | null,
  failureStage: CommercialShadowFailureStage,
  eligible: boolean,
  warnings: readonly string[]
): CommercialShadowResult {
  const completedAt = state.clock.toISOString(state.clock.now());
  const stages = [
    createStage(
      failureStage,
      status === "disabled" || status === "skipped" ? "skipped" : "completed",
      state.startedAt,
      completedAt,
      warnings,
      status === "disabled" ? "shadow_disabled" : status === "skipped" ? "shadow_skipped" : null
    )
  ];

  const result = createCommercialShadowFailedSafe({
    input,
    status,
    failureStage,
    reason: skipReason ?? (status === "disabled" ? "Commercial shadow disabled." : "Commercial shadow skipped."),
    warnings,
    eligible,
    skipReason,
    stages,
    executionDisposition: "not_executed",
    metrics: {
      startedAt: state.startedAt,
      completedAt,
      durationMs: stageDuration(state.startedAt, completedAt),
      eligibilityDurationMs: stageDuration(state.startedAt, completedAt),
      contextBuilderDurationMs: 0,
      runtimeDurationMs: 0,
      validationDurationMs: 0,
      policyDurationMs: 0,
      overheadMs: 0,
      inputCharacters: input.inboundMessage.messageText.length,
      outputCharacters: 0,
      providerDurationMs: 0,
      model: null,
      inputTokens: null,
      outputTokens: null,
      estimatedCost: null,
      providerRequestId: null,
      timedOut: false,
      warningsCount: warnings.length
    },
    telemetry: [
      buildTelemetryEvent({
        event: "commercial_shadow_skipped",
        stage: "eligibility",
        status,
        mode: input.options?.mode ?? "shadow",
        enabled: input.shadowFlags.commercialShadowEnabled,
        eligible: false,
        correlationId: input.correlationId,
        executionId: input.executionId ?? null,
        durationMs: stageDuration(state.startedAt, completedAt),
        providerName: null,
        providerVersion: null,
        providerRequestId: null,
        model: null,
        policyStatus: null,
        overallDecision: null,
        riskLevel: null,
        requiresApproval: null,
        warningsCount: warnings.length,
        errorCode: null,
        versions: {
          shadowVersion: COMMERCIAL_SHADOW_VERSION,
          contractVersion: input.contractVersion,
          promptVersion: input.promptVersion,
          policyVersion: input.policyVersion,
          runtimeVersion: SALES_AGENT_RUNTIME_VERSION
        },
        metadata: state.safeMetadata
      })
    ],
    context: null
  });

  return result;
}

export async function runCommercialShadowEvaluation(input: CommercialShadowInput): Promise<CommercialShadowResult> {
  const clock = buildClock(input.currentTime, input.clock);
  const startedAtMs = clock.now();
  const startedAt = clock.toISOString(startedAtMs);
  const sanitizedMetadata = sanitizeMetadata(input.metadata);
  const state: EvaluationState = {
    warnings: [],
    stages: [],
    telemetry: [],
    safeMetadata: {
      ...sanitizedMetadata.value,
      commercialShadow: {
        correlationId: input.correlationId,
        executionId: input.executionId ?? null
      }
    },
    clock,
    startedAtMs,
    startedAt
  };

  const overallTimeoutMs = input.options?.timeoutMs ?? COMMERCIAL_SHADOW_DEFAULT_TIMEOUT_MS;
  const contextTimeoutMs = input.options?.contextTimeoutMs ?? COMMERCIAL_SHADOW_CONTEXT_TIMEOUT_MS;
  const runtimeTimeoutMs = input.options?.runtimeTimeoutMs ?? COMMERCIAL_SHADOW_RUNTIME_TIMEOUT_MS;
  const policyTimeoutMs = input.options?.policyTimeoutMs ?? COMMERCIAL_SHADOW_POLICY_TIMEOUT_MS;
  void contextTimeoutMs;
  void runtimeTimeoutMs;
  void policyTimeoutMs;

  if (input.abortSignal?.aborted) {
    return createCommercialShadowFailedSafe({
      input,
      status: "cancelled",
      failureStage: "eligibility",
      reason: "Commercial shadow was cancelled before starting.",
      warnings: ["shadow_cancelled"],
      eligible: true,
      executionDisposition: "not_executed",
      error: createSafeError("eligibility", new Error("Commercial shadow cancelled.")),
      telemetry: [
        buildTelemetryEvent({
          event: "commercial_shadow_failed_safe",
          stage: "eligibility",
          status: "cancelled",
          mode: input.options?.mode ?? "shadow",
          enabled: input.shadowFlags.commercialShadowEnabled,
          eligible: true,
          correlationId: input.correlationId,
          executionId: input.executionId ?? null,
          durationMs: 0,
          providerName: null,
          providerVersion: null,
          providerRequestId: null,
          model: null,
          policyStatus: null,
          overallDecision: null,
          riskLevel: null,
          requiresApproval: null,
          warningsCount: 1,
          errorCode: "shadow_cancelled",
          versions: {
            shadowVersion: COMMERCIAL_SHADOW_VERSION,
            contractVersion: input.contractVersion,
            promptVersion: input.promptVersion,
            policyVersion: input.policyVersion,
            runtimeVersion: SALES_AGENT_RUNTIME_VERSION
          },
          metadata: state.safeMetadata
        })
      ]
    });
  }

  const earlyEligibility = evaluateEligibility(input);
  state.warnings.push(...earlyEligibility.warnings);
  const eligibilityCompletedAt = clock.toISOString(clock.now());
  state.stages.push(
    createStage(
      "eligibility",
      earlyEligibility.eligible ? "completed" : "skipped",
      state.startedAt,
      eligibilityCompletedAt,
      earlyEligibility.warnings,
      earlyEligibility.eligible ? null : "shadow_skipped"
    )
  );

  if (!earlyEligibility.eligible) {
    return buildEarlyResult(input, state, input.shadowFlags.commercialShadowEnabled ? "skipped" : "disabled", earlyEligibility.skipReason, "eligibility", false, earlyEligibility.warnings);
  }

  if (!input.shadowFlags.commercialRuntimeEnabled) {
    state.warnings.push("shadow_runtime_disabled");
    return buildEarlyResult(input, state, "skipped", "commercialRuntimeEnabled=false", "eligibility", true, state.warnings);
  }

  if (!input.shadowFlags.commercialPolicyEnabled) {
    state.warnings.push("shadow_policy_disabled");
    return buildEarlyResult(input, state, "skipped", "commercialPolicyEnabled=false", "eligibility", true, state.warnings);
  }

  try {
    const contextStartedAt = clock.toISOString(clock.now());
    const commercialContext = buildCommercialContext(buildContextPayload(input, startedAt));
    const contextCompletedAt = clock.toISOString(clock.now());
    state.stages.push(
      createStage(
        "context_builder",
        commercialContext.status === "success" ? "completed" : commercialContext.status === "insufficient_context" ? "skipped" : "failed_safe",
        contextStartedAt,
        contextCompletedAt,
        commercialContext.warnings,
        commercialContext.status === "invalid_input" ? "shadow_context_failed" : null,
        {
          completeness: commercialContext.completeness === "insufficient" ? 0 : 1
        }
      )
    );

    const commercialContextSummary = buildCommercialContextSummary(commercialContext);
    if (commercialContext.status !== "success") {
      state.warnings.push("shadow_context_failed");
    }

    if (commercialContext.status === "invalid_input") {
      return createCommercialShadowFailedSafe({
        input,
        status: "context_failed",
        failureStage: "context_builder",
        reason: commercialContext.errors[0] ?? "Commercial context builder failed.",
        warnings: state.warnings,
        eligible: true,
        commercialContextSummary,
        stages: state.stages,
        executionDisposition: "not_executed",
        error: createSafeError("context_builder", commercialContext.errors[0] ?? "Commercial context builder failed.")
      });
    }

    if (commercialContext.status === "insufficient_context") {
      return createCommercialShadowFailedSafe({
        input,
        status: "skipped",
        failureStage: "context_builder",
        reason: "Insufficient commercial context.",
        warnings: state.warnings,
        eligible: true,
        skipReason: "insufficient_context",
        commercialContextSummary,
        stages: state.stages,
        executionDisposition: "not_executed"
      });
    }

    const runtimeClock = buildClock(input.currentTime, input.clock);
    const runtimeProvider =
      input.shadowFlags.commercialShadowAllowRealProvider && input.provider
        ? input.provider
        : createFakeSalesAgentProvider({ behavior: "valid" });
    if (input.provider && !input.shadowFlags.commercialShadowAllowRealProvider) {
      state.warnings.push("shadow_real_provider_blocked");
    }

    if (input.shadowFlags.commercialShadowAllowRealProvider && !input.provider) {
      return createCommercialShadowFailedSafe({
        input,
        status: "runtime_failed",
        failureStage: "sales_agent_runtime",
        reason: "Real provider was allowed but not provided.",
        warnings: [...state.warnings, "shadow_provider_unavailable"],
        eligible: true,
        commercialContextSummary,
        stages: state.stages,
        executionDisposition: "discard_after_observation",
        error: createSafeError("sales_agent_runtime", "Provider unavailable.")
      });
    }

    const runtimeStartedAt = clock.toISOString(clock.now());
    const runtimeResult = await runSalesAgentDryRun({
      salesAgentInput: commercialContext.salesAgentInput,
      provider: runtimeProvider,
      options: {
        enabled: true,
        mode: input.runtimeOptions.mode ?? SALES_AGENT_RUNTIME_DEFAULT_MODE,
        timeoutMs: runtimeTimeoutMs,
        maxInputCharacters: input.runtimeOptions.maxInputCharacters ?? SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS,
        maxOutputCharacters: input.runtimeOptions.maxOutputCharacters ?? SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS,
        strictValidation: input.runtimeOptions.strictValidation ?? true,
        allowedCapabilities: input.allowedCapabilities,
        captureRawOutput: input.shadowFlags.commercialShadowIncludeRawOutputPreview,
        includePromptPreview: input.shadowFlags.commercialShadowIncludePromptPreview,
        dryRun: input.runtimeOptions.dryRun ?? SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN,
        abortSignal: input.abortSignal ?? null
      },
      expectedRunId: input.correlationId,
      contractVersion: input.contractVersion ?? SALES_AGENT_CONTRACT_VERSION,
      promptVersion: input.promptVersion ?? SALES_AGENT_PROMPT_VERSION,
      currentTime: startedAt,
      correlationId: input.correlationId,
      metadata: state.safeMetadata,
      clock: runtimeClock
    });
    const runtimeCompletedAt = clock.toISOString(clock.now());
    state.stages.push(
      createStage(
        "sales_agent_runtime",
        runtimeResult.status === "completed_valid" ? "completed" : runtimeResult.status === "timeout" ? "timeout" : runtimeResult.status === "cancelled" ? "cancelled" : "failed_safe",
        runtimeStartedAt,
        runtimeCompletedAt,
        runtimeResult.warnings,
        runtimeResult.status === "timeout"
          ? "shadow_timeout"
          : runtimeResult.status === "cancelled"
            ? "shadow_cancelled"
            : runtimeResult.status === "provider_unavailable"
              ? "shadow_provider_unavailable"
              : runtimeResult.status === "provider_error"
                ? "shadow_provider_error"
                : runtimeResult.status === "validation_failed_safe"
                  ? "shadow_runtime_failed"
                  : runtimeResult.status === "invalid_input"
                    ? "shadow_invalid_input"
                    : null,
        {
          validationIssues: runtimeResult.validation.issues.length
        }
      )
    );

    if (runtimeResult.status !== "completed_valid" || runtimeResult.validation.status !== "valid") {
      const runtimeFailedStatus = runtimeResult.status === "timeout" ? "timeout" : runtimeResult.status === "cancelled" ? "cancelled" : "runtime_failed";
      return createCommercialShadowFailedSafe({
        input,
        status: runtimeFailedStatus,
        failureStage: runtimeResult.validation.status === "failed_safe" ? "output_validation" : "sales_agent_runtime",
        reason: `Sales Agent runtime finished with status ${runtimeResult.status}.`,
        warnings: uniqueStrings([...state.warnings, ...runtimeResult.warnings]),
        eligible: true,
        commercialContextSummary,
        runtimeSummary: buildRuntimeSummary(runtimeResult),
        stages: state.stages,
        executionDisposition: runtimeFailedStatus === "timeout" ? "discard_after_observation" : "discard_after_observation",
        metrics: {
          providerDurationMs: runtimeResult.metrics.providerDurationMs ?? 0,
          model: runtimeResult.metrics.model ?? null,
          inputTokens: runtimeResult.metrics.inputTokens ?? null,
          outputTokens: runtimeResult.metrics.outputTokens ?? null,
          estimatedCost: runtimeResult.metrics.estimatedCost ?? null,
          providerRequestId: runtimeResult.metrics.providerRequestId ?? null,
          timedOut: runtimeResult.metrics.timedOut,
          outputCharacters: runtimeResult.metrics.outputCharacters ?? 0,
          warningsCount: runtimeResult.warnings.length
        },
        context: {
          inboundMessage: input.inboundMessage,
          brainContext: input.brainContext,
          commercialContext,
          salesAgentInput: commercialContext.salesAgentInput,
          runtimeResult,
          validationResult: runtimeResult.validation,
          policyResult: null
        },
        error: createSafeError(
          runtimeResult.validation.status === "failed_safe" ? "output_validation" : "sales_agent_runtime",
          runtimeResult.error?.message ?? `Sales Agent runtime finished with status ${runtimeResult.status}.`,
          runtimeResult.provider.name,
          runtimeResult.provider.version ?? null
        )
      });
    }

    const runtimeSummary = buildRuntimeSummary(runtimeResult);
    const policyStartedAt = clock.toISOString(clock.now());
    const policyResult = evaluateCommercialPolicy({
      salesAgentResult: runtimeResult.result,
      currentTime: startedAt,
      contractVersion: COMMERCIAL_POLICY_CONTRACT_VERSION,
      policyVersion: input.policyVersion ?? COMMERCIAL_POLICY_VERSION,
      allowedCapabilities: input.allowedCapabilities,
      featureFlags: input.policyFlags,
      commercialContext: commercialContext.sourceSummary as CommercialContextSourceSummary,
      customerContext: input.brainContext.customer_context,
      opportunityContext: input.brainContext.business_context,
      followUpContext: input.brainContext.conversation_context,
      channelContext: buildChannelContext(commercialContext, input),
      operatorContext: input.brainContext.metadata ?? null,
      metadata: state.safeMetadata
    });
    const policyCompletedAt = clock.toISOString(clock.now());
    state.stages.push(
      createStage(
        "commercial_policy",
        policyResult.status === "failed_safe" ? "failed_safe" : "completed",
        policyStartedAt,
        policyCompletedAt,
        policyResult.warnings,
        policyResult.status === "failed_safe" ? "shadow_policy_failed" : null,
        {
          blockedClaims: policyResult.blockedClaims.length,
          blockedActions: policyResult.blockedActions.length,
          blockedToolRequests: policyResult.blockedToolRequests.length,
          blockedEntityProposals: policyResult.blockedEntityProposals.length
        }
      )
    );

    const policySummary = buildPolicySummary(policyResult);
    const governedResultSummary = buildGovernedResultSummary(policyResult);
    const status: CommercialShadowStatus =
      policyResult.status === "failed_safe"
        ? "policy_failed"
        : policyResult.status === "blocked" || policyResult.status === "requires_review" || policyResult.status === "allowed_with_restrictions"
          ? "completed_with_restrictions"
          : "completed";
    const completedAt = clock.toISOString(clock.now());
    const warnings = input.shadowFlags.commercialShadowCaptureWarnings
      ? uniqueStrings([
          ...state.warnings,
          ...runtimeResult.warnings,
          ...policyResult.warnings,
          ...(policyResult.status === "blocked" ? ["shadow_policy_failed"] : []),
          ...(policyResult.status === "requires_review" ? ["shadow_policy_failed"] : [])
        ]) as CommercialShadowWarning[]
      : [];
    const metrics = buildMetrics({
      startedAt,
      completedAt,
      eligibilityDurationMs: stageDuration(state.startedAt, eligibilityCompletedAt),
      contextBuilderDurationMs: stageDuration(state.stages[1]?.startedAt ?? state.stages[0]?.startedAt ?? state.startedAt, contextCompletedAt),
      runtimeDurationMs: stageDuration(runtimeStartedAt, runtimeCompletedAt),
      validationDurationMs: runtimeResult.metrics.validationDurationMs,
      policyDurationMs: stageDuration(policyStartedAt, policyCompletedAt),
      providerDurationMs: runtimeResult.metrics.providerDurationMs ?? 0,
      providerName: runtimeResult.provider.name,
      providerVersion: runtimeResult.provider.version ?? null,
      providerRequestId: runtimeResult.metrics.providerRequestId ?? null,
      model: runtimeResult.metrics.model ?? null,
      inputTokens: runtimeResult.metrics.inputTokens ?? null,
      outputTokens: runtimeResult.metrics.outputTokens ?? null,
      estimatedCost: runtimeResult.metrics.estimatedCost ?? null,
      inputCharacters: runtimeResult.metrics.inputCharacters,
      outputCharacters: runtimeResult.metrics.outputCharacters ?? 0,
      timedOut: runtimeResult.metrics.timedOut,
      warningsCount: warnings.length
    });

    const telemetry = [
      buildTelemetryEvent({
        event: "commercial_shadow_started",
        stage: "eligibility",
        status: "completed",
        mode: input.options?.mode ?? "shadow",
        enabled: input.shadowFlags.commercialShadowEnabled,
        eligible: true,
        correlationId: input.correlationId,
        executionId: input.executionId ?? null,
        durationMs: 0,
        providerName: runtimeResult.provider.name,
        providerVersion: runtimeResult.provider.version ?? null,
        providerRequestId: runtimeResult.metrics.providerRequestId ?? null,
        model: runtimeResult.metrics.model ?? null,
        policyStatus: policySummary.status,
        overallDecision: policySummary.overallDecision,
        riskLevel: policySummary.riskLevel,
        requiresApproval: policySummary.requiresApproval,
        warningsCount: warnings.length,
        errorCode: null,
        versions: {
          shadowVersion: COMMERCIAL_SHADOW_VERSION,
          contractVersion: input.contractVersion,
          promptVersion: input.promptVersion,
          policyVersion: input.policyVersion,
          runtimeVersion: SALES_AGENT_RUNTIME_VERSION
        },
        metadata: state.safeMetadata
      }),
      buildTelemetryEvent({
        event: "commercial_context_built",
        stage: "context_builder",
        status: "completed",
        mode: input.options?.mode ?? "shadow",
        enabled: input.shadowFlags.commercialShadowEnabled,
        eligible: true,
        correlationId: input.correlationId,
        executionId: input.executionId ?? null,
        durationMs: stageDuration(state.stages[0]?.startedAt ?? state.startedAt, contextCompletedAt),
        providerName: runtimeResult.provider.name,
        providerVersion: runtimeResult.provider.version ?? null,
        providerRequestId: runtimeResult.metrics.providerRequestId ?? null,
        model: runtimeResult.metrics.model ?? null,
        policyStatus: policySummary.status,
        overallDecision: policySummary.overallDecision,
        riskLevel: policySummary.riskLevel,
        requiresApproval: policySummary.requiresApproval,
        warningsCount: warnings.length,
        errorCode: null,
        versions: {
          shadowVersion: COMMERCIAL_SHADOW_VERSION,
          contractVersion: input.contractVersion,
          promptVersion: input.promptVersion,
          policyVersion: input.policyVersion,
          runtimeVersion: SALES_AGENT_RUNTIME_VERSION
        },
        metadata: state.safeMetadata
      }),
      buildTelemetryEvent({
        event: "commercial_runtime_completed",
        stage: "sales_agent_runtime",
        status,
        mode: input.options?.mode ?? "shadow",
        enabled: input.shadowFlags.commercialShadowEnabled,
        eligible: true,
        correlationId: input.correlationId,
        executionId: input.executionId ?? null,
        durationMs: stageDuration(runtimeStartedAt, runtimeCompletedAt),
        providerName: runtimeResult.provider.name,
        providerVersion: runtimeResult.provider.version ?? null,
        providerRequestId: runtimeResult.metrics.providerRequestId ?? null,
        model: runtimeResult.metrics.model ?? null,
        policyStatus: policySummary.status,
        overallDecision: policySummary.overallDecision,
        riskLevel: policySummary.riskLevel,
        requiresApproval: policySummary.requiresApproval,
        warningsCount: warnings.length,
        errorCode: null,
        versions: {
          shadowVersion: COMMERCIAL_SHADOW_VERSION,
          contractVersion: input.contractVersion,
          promptVersion: input.promptVersion,
          policyVersion: input.policyVersion,
          runtimeVersion: SALES_AGENT_RUNTIME_VERSION
        },
        metadata: state.safeMetadata
      }),
      buildTelemetryEvent({
        event: "commercial_policy_completed",
        stage: "commercial_policy",
        status,
        mode: input.options?.mode ?? "shadow",
        enabled: input.shadowFlags.commercialShadowEnabled,
        eligible: true,
        correlationId: input.correlationId,
        executionId: input.executionId ?? null,
        durationMs: stageDuration(policyStartedAt, policyCompletedAt),
        providerName: runtimeResult.provider.name,
        providerVersion: runtimeResult.provider.version ?? null,
        providerRequestId: runtimeResult.metrics.providerRequestId ?? null,
        model: runtimeResult.metrics.model ?? null,
        policyStatus: policySummary.status,
        overallDecision: policySummary.overallDecision,
        riskLevel: policySummary.riskLevel,
        requiresApproval: policySummary.requiresApproval,
        warningsCount: warnings.length,
        errorCode: null,
        versions: {
          shadowVersion: COMMERCIAL_SHADOW_VERSION,
          contractVersion: input.contractVersion,
          promptVersion: input.promptVersion,
          policyVersion: input.policyVersion,
          runtimeVersion: SALES_AGENT_RUNTIME_VERSION
        },
        metadata: state.safeMetadata
      }),
      buildTelemetryEvent({
        event: "commercial_shadow_completed",
        stage: "shadow_complete",
        status,
        mode: input.options?.mode ?? "shadow",
        enabled: input.shadowFlags.commercialShadowEnabled,
        eligible: true,
        correlationId: input.correlationId,
        executionId: input.executionId ?? null,
        durationMs: metrics.durationMs,
        providerName: runtimeResult.provider.name,
        providerVersion: runtimeResult.provider.version ?? null,
        providerRequestId: runtimeResult.metrics.providerRequestId ?? null,
        model: runtimeResult.metrics.model ?? null,
        policyStatus: policySummary.status,
        overallDecision: policySummary.overallDecision,
        riskLevel: policySummary.riskLevel,
        requiresApproval: policySummary.requiresApproval,
        warningsCount: warnings.length,
        errorCode: null,
        versions: {
          shadowVersion: COMMERCIAL_SHADOW_VERSION,
          contractVersion: input.contractVersion,
          promptVersion: input.promptVersion,
          policyVersion: input.policyVersion,
          runtimeVersion: SALES_AGENT_RUNTIME_VERSION
        },
        metadata: state.safeMetadata
      })
    ];

    const shadowResult: CommercialShadowResult = {
      status,
      mode: input.options?.mode ?? "shadow",
      enabled: input.shadowFlags.commercialShadowEnabled,
      eligible: true,
      skipReason: null,
      correlationId: input.correlationId,
      executionId: input.executionId ?? null,
      commercialContextSummary: input.shadowFlags.commercialShadowCaptureResult ? commercialContextSummary : null,
      runtimeSummary: input.shadowFlags.commercialShadowCaptureResult ? runtimeSummary : null,
      policySummary: input.shadowFlags.commercialShadowCaptureResult ? policySummary : null,
      governedResultSummary: input.shadowFlags.commercialShadowCaptureResult ? governedResultSummary : null,
      stages: state.stages,
      metrics,
      warnings,
      error: null,
      versions: {
        shadowVersion: COMMERCIAL_SHADOW_VERSION,
        contractVersion: input.contractVersion,
        promptVersion: input.promptVersion,
        policyVersion: input.policyVersion,
        runtimeVersion: SALES_AGENT_RUNTIME_VERSION
      },
      metadata: {
        ...state.safeMetadata,
        commercialShadow: {
          enabled: input.shadowFlags.commercialShadowEnabled,
          runtimeEnabled: input.shadowFlags.commercialRuntimeEnabled,
          policyEnabled: input.shadowFlags.commercialPolicyEnabled,
          allowRealProvider: input.shadowFlags.commercialShadowAllowRealProvider,
          captureMetrics: input.shadowFlags.commercialShadowCaptureMetrics,
          captureResult: input.shadowFlags.commercialShadowCaptureResult,
          captureWarnings: input.shadowFlags.commercialShadowCaptureWarnings
        }
      },
      observedAt: startedAt,
      sideEffects: {
        messagesSent: 0,
        toolsExecuted: 0,
        databaseWrites: 0,
        outboxWrites: 0,
        leadsCreated: 0,
        opportunitiesCreated: 0,
        casesMutated: 0
      },
      executionDisposition: status === "completed" ? "observe_only" : "discard_after_observation",
      telemetry,
      context: input.shadowFlags.commercialShadowCaptureResult
        ? {
            inboundMessage: input.inboundMessage,
            brainContext: input.brainContext,
            commercialContext,
            salesAgentInput: commercialContext.salesAgentInput,
            runtimeResult,
            validationResult: runtimeResult.validation,
            policyResult
          }
        : null
    };

    if (metrics.durationMs > overallTimeoutMs) {
      return createCommercialShadowFailedSafe({
        input,
        status: "timeout",
        failureStage: "shadow_complete",
        reason: "Commercial shadow exceeded its total timeout budget.",
        warnings: [...warnings, "shadow_timeout", "shadow_latency_budget_exceeded"],
        eligible: true,
        commercialContextSummary: shadowResult.commercialContextSummary,
        runtimeSummary: shadowResult.runtimeSummary,
        policySummary: shadowResult.policySummary,
        governedResultSummary: shadowResult.governedResultSummary,
        stages: shadowResult.stages,
        metrics: {
          ...shadowResult.metrics,
          timedOut: true
        },
        executionDisposition: "discard_after_observation",
        telemetry: shadowResult.telemetry
      });
    }

    return shadowResult;
  } catch (error) {
    return createCommercialShadowFailedSafe({
      input,
      status: "failed_safe",
      failureStage: "shadow_complete",
      reason: "Commercial shadow evaluation failed unexpectedly.",
      warnings: [...state.warnings, "shadow_result_sanitized"],
      eligible: true,
      executionDisposition: "discard_after_observation",
      error: createSafeError("shadow_complete", error),
      context: {
        inboundMessage: input.inboundMessage,
        brainContext: input.brainContext,
        commercialContext: null,
        salesAgentInput: null,
        runtimeResult: null,
        validationResult: null,
        policyResult: null
      }
    });
  }
}
