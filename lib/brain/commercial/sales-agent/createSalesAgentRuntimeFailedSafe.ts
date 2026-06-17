import type { SalesAgentDecisionType, SalesAgentOutputValidationContext, SalesAgentOutputValidationIssue } from "./validationTypes";
import { createFailedSafeResult } from "./createFailedSafeResult";
import type {
  SalesAgentRuntimeError,
  SalesAgentRuntimeJsonValue,
  SalesAgentRuntimeMetrics,
  SalesAgentRuntimeMode,
  SalesAgentRuntimeProviderSummary,
  SalesAgentRuntimeResult,
  SalesAgentRuntimeValidation,
  SalesAgentRuntimeVersions
} from "./runtimeTypes";

export type CreateSalesAgentRuntimeFailedSafeInput = {
  status: Exclude<SalesAgentRuntimeResult["status"], "completed_valid">;
  mode: SalesAgentRuntimeMode;
  dryRun: boolean;
  validationContext: SalesAgentOutputValidationContext;
  validation: SalesAgentRuntimeValidation;
  metrics: SalesAgentRuntimeMetrics;
  provider: SalesAgentRuntimeProviderSummary;
  versions: SalesAgentRuntimeVersions;
  metadata: SalesAgentRuntimeResult["metadata"];
  error: SalesAgentRuntimeError;
  warnings: readonly string[];
  issues: readonly SalesAgentOutputValidationIssue[];
  decisionType?: SalesAgentDecisionType;
  correlationId?: string | null;
  rawOutputPreview?: SalesAgentRuntimeJsonValue | null;
};

export function createSalesAgentRuntimeFailedSafe(input: CreateSalesAgentRuntimeFailedSafeInput): SalesAgentRuntimeResult {
  const result = createFailedSafeResult(input.validationContext, {
    issues: [...input.issues],
    reason: input.error.message,
    decisionType: input.decisionType
  });

  return {
    status: input.status,
    mode: input.mode,
    dryRun: input.dryRun,
    result,
    validation: input.validation,
    metrics: input.metrics,
    warnings: [...new Set([...input.warnings, ...result.warnings])],
    error: input.error,
    provider: input.provider,
    versions: input.versions,
    correlationId: input.correlationId ?? null,
    metadata: input.metadata,
    rawOutputPreview: input.rawOutputPreview
  };
}
