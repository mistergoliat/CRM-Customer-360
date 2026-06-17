import { sanitizeCommercialObject } from "../context/adapters";
import { COMMERCIAL_POLICY_VERSION } from "../policy";
import { SALES_AGENT_RUNTIME_VERSION, SALES_AGENT_PROMPT_VERSION } from "../sales-agent/runtimeTypes";
import { COMMERCIAL_SHADOW_VERSION, COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS } from "./shadowConstants";
import type {
  CommercialShadowCommercialContextSummary,
  CommercialShadowContext,
  CommercialShadowError,
  CommercialShadowGovernedResultSummary,
  CommercialShadowInput,
  CommercialShadowMetrics,
  CommercialShadowPolicySummary,
  CommercialShadowResult,
  CommercialShadowRuntimeSummary,
  CommercialShadowStageResult
} from "./shadowTypes";
import type {
  CommercialShadowExecutionDisposition,
  CommercialShadowFailureStage,
  CommercialShadowStatus,
  CommercialShadowWarning
} from "./shadowConstants";

const ZERO_SIDE_EFFECTS: CommercialShadowResult["sideEffects"] = {
  messagesSent: 0,
  toolsExecuted: 0,
  databaseWrites: 0,
  outboxWrites: 0,
  leadsCreated: 0,
  opportunitiesCreated: 0,
  casesMutated: 0
};

function toIsoString(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function uniqueWarnings(values: readonly string[]): CommercialShadowWarning[] {
  return [...new Set(values)].filter((value): value is CommercialShadowWarning => Boolean(value));
}

function buildStage(
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
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    warnings: uniqueWarnings(warnings),
    errorCode: errorCode ?? null,
    version: COMMERCIAL_SHADOW_VERSION,
    counts
  };
}

export type CommercialShadowFailedSafeInput = {
  input: CommercialShadowInput;
  status: CommercialShadowStatus;
  failureStage: CommercialShadowFailureStage;
  reason: string;
  warnings?: readonly string[];
  error?: CommercialShadowError | null;
  eligible?: boolean;
  skipReason?: string | null;
  commercialContextSummary?: CommercialShadowCommercialContextSummary | null;
  runtimeSummary?: CommercialShadowRuntimeSummary | null;
  policySummary?: CommercialShadowPolicySummary | null;
  governedResultSummary?: CommercialShadowGovernedResultSummary | null;
  stages?: CommercialShadowStageResult[];
  executionDisposition?: CommercialShadowExecutionDisposition;
  context?: CommercialShadowContext | null;
  metrics?: Partial<CommercialShadowMetrics>;
  telemetry?: CommercialShadowResult["telemetry"];
};

export function createCommercialShadowFailedSafe(input: CommercialShadowFailedSafeInput): CommercialShadowResult {
  const currentTime = toIsoString(input.input.currentTime);
  const safeMetadataResult = sanitizeCommercialObject(input.input.metadata ?? {});
  const safeMetadata = safeMetadataResult.value ?? {};
  const warnings = uniqueWarnings([
    ...(input.warnings ?? []),
    input.error?.code ?? "",
    input.error?.message ?? "",
    input.skipReason ?? ""
  ]);
  const stages =
    input.stages && input.stages.length > 0
      ? input.stages
      : [buildStage(input.failureStage, "failed_safe", currentTime, currentTime, warnings, input.error?.code ?? "failed_safe")];

  return {
    status: input.status,
    mode: input.input.options?.mode ?? "shadow",
    enabled: Boolean(input.input.shadowFlags.commercialShadowEnabled),
    eligible: input.eligible ?? true,
    skipReason: input.skipReason ?? null,
    correlationId: input.input.correlationId,
    executionId: input.input.executionId ?? null,
    commercialContextSummary: input.commercialContextSummary ?? null,
    runtimeSummary: input.runtimeSummary ?? null,
    policySummary: input.policySummary ?? null,
    governedResultSummary: input.governedResultSummary ?? null,
    stages,
    metrics: {
      startedAt: currentTime,
      completedAt: currentTime,
      durationMs: 0,
      eligibilityDurationMs: 0,
      contextBuilderDurationMs: 0,
      runtimeDurationMs: 0,
      validationDurationMs: 0,
      policyDurationMs: 0,
      overheadMs: 0,
      inputCharacters: JSON.stringify(input.input.inboundMessage).length,
      outputCharacters: 0,
      providerDurationMs: 0,
      model: null,
      inputTokens: null,
      outputTokens: null,
      estimatedCost: null,
      providerRequestId: null,
      timedOut: input.status === "timeout",
      warningsCount: warnings.length,
      ...input.metrics
    },
    warnings,
    error: input.error ?? null,
    versions: {
      shadowVersion: COMMERCIAL_SHADOW_VERSION,
      contractVersion: input.input.contractVersion,
      promptVersion: input.input.promptVersion,
      policyVersion: input.input.policyVersion,
      runtimeVersion: SALES_AGENT_RUNTIME_VERSION
    },
    metadata: {
      ...safeMetadata,
      commercialShadow: {
        reason: input.reason,
        status: input.status,
        failureStage: input.failureStage,
        policyVersion: COMMERCIAL_POLICY_VERSION,
        promptVersion: SALES_AGENT_PROMPT_VERSION,
        featureFlags: COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS
      }
    },
    observedAt: currentTime,
    sideEffects: ZERO_SIDE_EFFECTS,
    executionDisposition: input.executionDisposition ?? "not_executed",
    telemetry: input.telemetry ?? [],
    context: input.context ?? null
  };
}
