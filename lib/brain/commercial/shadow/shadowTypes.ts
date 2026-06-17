import type { BrainContextResolveResponse } from "../../context/types";
import type { BrainNormalizedProcessInboundRequest } from "../../inbound/types";
import type { CommercialContextBuilderResult, CommercialContextSourceSummary } from "../types";
import type { CommercialPolicyApprovalRequirement, CommercialPolicyDecision, CommercialPolicyFeatureFlags, CommercialPolicyResult, CommercialPolicyRiskLevel, CommercialPolicyStatus } from "../policy";
import type { SalesAgentInput, SalesAgentPolicyContext, SalesAgentRequestedMode, SalesAgentToolName } from "../salesAgentTypes";
import type { SalesAgentApprovalRequirement, SalesAgentOutcome, SalesAgentResult } from "../sales-agent/validationTypes";
import type { SalesAgentPromptVersion, SalesAgentProvider, SalesAgentRuntimeClock, SalesAgentRuntimeMode, SalesAgentRuntimeOptions, SalesAgentRuntimeResult, SalesAgentRuntimeStatus, SalesAgentRuntimeValidation } from "../sales-agent/runtimeTypes";
import type { CommercialShadowExecutionDisposition, CommercialShadowFailureStage, CommercialShadowMode, CommercialShadowStatus, CommercialShadowWarning } from "./shadowConstants";

export type CommercialShadowFeatureFlags = {
  commercialShadowEnabled: boolean;
  commercialRuntimeEnabled: boolean;
  commercialPolicyEnabled: boolean;
  commercialShadowCaptureMetrics: boolean;
  commercialShadowCaptureResult: boolean;
  commercialShadowCaptureWarnings: boolean;
  commercialShadowIncludePromptPreview: boolean;
  commercialShadowIncludeRawOutputPreview: boolean;
  commercialShadowFailOpenForInbound: boolean;
  commercialShadowAllowRealProvider: boolean;
};

export type CommercialShadowOptions = {
  mode?: CommercialShadowMode;
  timeoutMs?: number;
  runtimeTimeoutMs?: number;
  policyTimeoutMs?: number;
  contextTimeoutMs?: number;
};

export type CommercialShadowStageResult = {
  stage: CommercialShadowFailureStage;
  status: "completed" | "skipped" | "failed_safe" | "timeout" | "cancelled";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  warnings: CommercialShadowWarning[];
  errorCode?: string | null;
  version: string;
  counts?: Record<string, number>;
};

export type CommercialShadowSideEffects = {
  messagesSent: 0;
  toolsExecuted: 0;
  databaseWrites: 0;
  outboxWrites: 0;
  leadsCreated: 0;
  opportunitiesCreated: 0;
  casesMutated: 0;
};

export type CommercialShadowCommercialContextSummary = {
  status: CommercialContextBuilderResult["status"];
  completeness: CommercialContextBuilderResult["completeness"];
  warnings: CommercialContextBuilderResult["warnings"];
  sourceSummary: CommercialContextSourceSummary;
  metadata: CommercialContextBuilderResult["metadata"];
};

export type CommercialShadowRuntimeSummary = {
  status: SalesAgentRuntimeStatus;
  mode: SalesAgentRuntimeMode;
  validationStatus: SalesAgentRuntimeValidation["status"];
  providerName: string;
  providerVersion: string | null;
  providerRequestId: string | null;
  model: string | null;
  finishReason: string | null;
  outcome: SalesAgentOutcome;
  confidence: SalesAgentResult["analysis"]["confidence"];
  shouldRespondNow: boolean;
  warningsCount: number;
  rawOutputCaptured: boolean;
  promptPreviewIncluded: boolean;
};

export type CommercialShadowPolicySummary = {
  status: CommercialPolicyStatus;
  overallDecision: CommercialPolicyDecision;
  riskLevel: CommercialPolicyRiskLevel;
  requiresApproval: CommercialPolicyApprovalRequirement;
  blockedClaims: number;
  blockedActions: number;
  blockedToolRequests: number;
  blockedEntityProposals: number;
  issueCount: number;
  warningCount: number;
};

export type CommercialShadowGovernedResultSummary = {
  outcome: SalesAgentOutcome;
  confidence: SalesAgentResult["analysis"]["confidence"];
  shouldRespondNow: boolean;
  policyStatus: CommercialPolicyStatus;
  overallDecision: CommercialPolicyDecision;
  riskLevel: CommercialPolicyRiskLevel;
  requiresApproval: SalesAgentApprovalRequirement;
  proposedActionCount: number;
  blockedActionCount: number;
  toolRequestCount: number;
  blockedToolRequestCount: number;
  claimCount: number;
  blockedClaimCount: number;
  entityProposalCount: number;
  warningsCount: number;
  issueCodes: string[];
  appliedRuleIds: string[];
};

export type CommercialShadowMetrics = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  eligibilityDurationMs: number;
  contextBuilderDurationMs: number;
  runtimeDurationMs: number;
  validationDurationMs: number;
  policyDurationMs: number;
  overheadMs: number;
  inputCharacters: number;
  outputCharacters: number;
  providerDurationMs?: number;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCost?: number | null;
  providerRequestId?: string | null;
  timedOut: boolean;
  warningsCount: number;
};

export type CommercialShadowError = {
  code: string;
  message: string;
  stage: CommercialShadowFailureStage;
  providerName?: string | null;
  providerVersion?: string | null;
  details?: Record<string, unknown> | null;
};

export type CommercialShadowVersions = {
  shadowVersion: string;
  contractVersion: string;
  promptVersion: SalesAgentPromptVersion;
  policyVersion: string;
  runtimeVersion: string;
};

export type CommercialShadowContext = {
  inboundMessage: BrainNormalizedProcessInboundRequest;
  brainContext: BrainContextResolveResponse;
  commercialContext: CommercialContextBuilderResult | null;
  salesAgentInput: SalesAgentInput | null;
  runtimeResult: SalesAgentRuntimeResult | null;
  validationResult: SalesAgentRuntimeValidation | null;
  policyResult: CommercialPolicyResult | null;
};

export type CommercialShadowTelemetryEvent = {
  event: string;
  stage: CommercialShadowFailureStage | "shadow_complete" | "eligibility";
  status: CommercialShadowStatus;
  mode: CommercialShadowMode;
  enabled: boolean;
  eligible: boolean;
  correlationId: string;
  executionId: string | null;
  durationMs: number;
  providerName: string | null;
  providerVersion: string | null;
  providerRequestId: string | null;
  model: string | null;
  policyStatus: CommercialPolicyStatus | null;
  overallDecision: CommercialPolicyDecision | null;
  riskLevel: CommercialPolicyRiskLevel | null;
  requiresApproval: CommercialPolicyApprovalRequirement | null;
  warningsCount: number;
  errorCode: string | null;
  versions: CommercialShadowVersions;
  sideEffects: CommercialShadowSideEffects;
  metadata: Record<string, unknown>;
};

export type CommercialShadowResult = {
  status: CommercialShadowStatus;
  mode: CommercialShadowMode;
  enabled: boolean;
  eligible: boolean;
  skipReason?: string | null;
  correlationId: string;
  executionId?: string | null;
  commercialContextSummary: CommercialShadowCommercialContextSummary | null;
  runtimeSummary: CommercialShadowRuntimeSummary | null;
  policySummary: CommercialShadowPolicySummary | null;
  governedResultSummary: CommercialShadowGovernedResultSummary | null;
  stages: CommercialShadowStageResult[];
  metrics: CommercialShadowMetrics;
  warnings: CommercialShadowWarning[];
  error?: CommercialShadowError | null;
  versions: CommercialShadowVersions;
  metadata: Record<string, unknown>;
  observedAt: string;
  sideEffects: CommercialShadowSideEffects;
  executionDisposition: CommercialShadowExecutionDisposition;
  telemetry: CommercialShadowTelemetryEvent[];
  context: CommercialShadowContext | null;
};

export type CommercialShadowInput = {
  options?: CommercialShadowOptions;
  inboundMessage: BrainNormalizedProcessInboundRequest;
  brainContext: BrainContextResolveResponse;
  correlationId: string;
  executionId?: string | null;
  currentTime: string | Date;
  timezone?: string;
  requestedMode?: SalesAgentRequestedMode;
  policyContext?: SalesAgentPolicyContext | null;
  provider?: SalesAgentProvider | null;
  runtimeOptions: Partial<SalesAgentRuntimeOptions>;
  policyFlags: CommercialPolicyFeatureFlags;
  shadowFlags: CommercialShadowFeatureFlags;
  contractVersion: string;
  promptVersion: SalesAgentPromptVersion;
  policyVersion: string;
  allowedCapabilities: readonly SalesAgentToolName[];
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal | null;
  clock?: CommercialShadowRuntimeClock;
};

export type CommercialShadowRuntimeClock = SalesAgentRuntimeClock;
