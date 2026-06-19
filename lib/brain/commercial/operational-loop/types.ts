import type { BrainContextResolveResponse } from "../../context/types";
import type { BrainNormalizedProcessInboundRequest } from "../../inbound/types";
import type {
  CommercialChannelReference,
  CommercialIntent,
  CommercialPriority,
  CommercialSignal,
  CommercialTemperature,
  CommercialContextBuilderResult,
  CommercialContextSourceSummary,
  OpportunityObjection,
  OpportunityProductInterest,
  OpportunityRequirement,
  OpportunityStage,
  OpportunityStatus
} from "../types";
import type {
  CommercialPolicyApprovalRequirement,
  CommercialPolicyResult,
  CommercialPolicyRiskLevel,
  CommercialPolicyStatus
} from "../policy";
import type {
  CommercialDecisionComparisonStatus,
  CommercialEvaluationResult,
  CommercialEvaluationStatus,
  CommercialEvaluationUsefulness,
  CommercialReadinessDecision
} from "../evaluation";
import type { SalesAgentConfidenceLevel, SalesAgentResult } from "../sales-agent/validationTypes";
import type { SalesAgentPromptVersion } from "../sales-agent/runtimeTypes";
import type { CommercialShadowResult } from "../shadow";
import type {
  CommercialOperationalLoopMode,
  CommercialOperationalLoopNextActionType,
  CommercialOperationalLoopSkipReason,
  CommercialOperationalLoopStageName,
  CommercialOperationalLoopStageStatus,
  CommercialOperationalLoopStatus,
  CommercialOperationalLoopWarning
} from "./constants";

export type CommercialOperationalLoopFeatureFlags = {
  commercialOperationalLoopEnabled: boolean;
  commercialStatePersistenceEnabled: boolean;
};

export type CommercialOperationalLoopClock = {
  now(): number;
  toISOString(value: number | Date): string;
};

export type CommercialOperationalLoopStageResult = {
  stage: CommercialOperationalLoopStageName;
  status: CommercialOperationalLoopStageStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  warnings: CommercialOperationalLoopWarning[];
  errorCode?: string | null;
  version: string;
  counts?: Record<string, number>;
};

export type CommercialOperationalLoopSideEffects = {
  outboundExecuted: false;
  toolsExecuted: 0;
  followupScheduled: false;
  quoteCreated: false;
  leadCreated: false;
  caseMutated: false;
  controlsResponsePolicy: false;
  nextActionExecuted: false;
  commercialOpportunityWritten: boolean;
  commercialDecisionWritten: boolean;
};

export type CommercialOperationalLoopEvaluationSummary = {
  status: CommercialEvaluationStatus | null;
  readinessDecision: CommercialReadinessDecision | null;
  usefulness: CommercialEvaluationUsefulness | null;
  comparisonStatus: CommercialDecisionComparisonStatus | null;
};

export type CommercialOperationalOpportunityIdentityResolutionStatus =
  | "continue_existing"
  | "create_new"
  | "ambiguous"
  | "terminal"
  | "no_commercial_signal"
  | "blocked";

export type CommercialOperationalOpportunityIdentityResolution = {
  status: CommercialOperationalOpportunityIdentityResolutionStatus;
  opportunityKey: string;
  opportunityId: string | number | null;
  candidateOpportunityIds: Array<string | number>;
  selectedOpportunityId: string | number | null;
  selectedState: CommercialOperationalState | null;
  primaryIntent: CommercialIntent;
  channel: CommercialChannelReference["channel"];
  reason: string;
  isNewOpportunity: boolean;
  isAmbiguous: boolean;
  isTerminal: boolean;
  requiresHumanReview: boolean;
  warnings: CommercialOperationalLoopWarning[];
  metadata: Record<string, unknown>;
};

export type CommercialOperationalIdentityHints = {
  customerCandidateId: string | number | null;
  customerMasterId: string | number | null;
  leadId: string | number | null;
  conversationCaseId: string | number | null;
  waId: string | null;
  channel: CommercialChannelReference["channel"];
  primaryIntent: CommercialIntent;
  threadKey: string;
  hasCommercialSignal: boolean;
  hasExplicitCommercialState: boolean;
  sourceSummary: CommercialContextSourceSummary | null;
};

export type CommercialOperationalState = {
  opportunityId: string | number | null;
  opportunityKey: string;
  customerCandidateId: string | number | null;
  customerMasterId: string | number | null;
  leadId: string | number | null;
  conversationCaseId: string | number | null;
  waId: string | null;
  channel: CommercialChannelReference["channel"];
  primaryIntent: CommercialIntent;
  status: OpportunityStatus;
  stage: OpportunityStage | null;
  temperature: CommercialTemperature;
  priority: CommercialPriority;
  currentSummary: string | null;
  requirements: OpportunityRequirement[];
  missingRequirements: OpportunityRequirement[];
  productInterests: OpportunityProductInterest[];
  objections: OpportunityObjection[];
  signals: CommercialSignal[];
  lastCustomerMessageId: string | number | null;
  lastAgentDecisionId: string | number | null;
  waitingFor: string | null;
  nextActionType: CommercialOperationalLoopNextActionType | null;
  nextActionDueAt: string | null;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  previousDecision: CommercialOperationalDecisionRecordSummary | null;
};

export type CommercialOperationalDecisionRecordSummary = {
  decisionId: string;
  decisionStatus: CommercialOperationalLoopDecisionStatus;
  createdAt: string;
};

export const COMMERCIAL_OPERATIONAL_LOOP_DECISION_STATUSES = [
  "recorded",
  "duplicate",
  "blocked",
  "failed_safe",
  "skipped"
] as const;
export type CommercialOperationalLoopDecisionStatus = (typeof COMMERCIAL_OPERATIONAL_LOOP_DECISION_STATUSES)[number];

export type CommercialOperationalStateDiff = {
  opportunityKey: string;
  previousStatus: OpportunityStatus | null;
  nextStatus: OpportunityStatus;
  previousStage: OpportunityStage | null;
  nextStage: OpportunityStage | null;
  statusChanged: boolean;
  stageChanged: boolean;
  summaryChanged: boolean;
  waitingForChanged: boolean;
  nextActionChanged: boolean;
  changedFields: string[];
  addedSignals: CommercialSignal[];
  removedSignals: CommercialSignal[];
  addedRequirements: string[];
  removedRequirements: string[];
  addedObjections: string[];
  removedObjections: string[];
};

export type CommercialNextAction = {
  type: CommercialOperationalLoopNextActionType;
  reason: string;
  confidence: SalesAgentConfidenceLevel;
  riskLevel: CommercialPolicyRiskLevel;
  approvalRequirement: CommercialPolicyApprovalRequirement;
  recommendedChannel: CommercialChannelReference["channel"];
  draftMessage: string | null;
  requiredInformation: string[];
  blockedReasons: string[];
  executable: false;
};

export type CommercialOperationalTransitionValidationStatus = "allowed" | "blocked" | "failed_safe";

export type CommercialOperationalTransitionValidation = {
  status: CommercialOperationalTransitionValidationStatus;
  allowed: boolean;
  fromStatus: OpportunityStatus | null;
  toStatus: OpportunityStatus;
  fromStage: OpportunityStage | null;
  toStage: OpportunityStage | null;
  reason: string;
  blockedReasons: string[];
  warnings: CommercialOperationalLoopWarning[];
  requiresHumanReview: boolean;
  evidenceRequired: boolean;
};

export type CommercialOperationalLoadStateStatus = "loaded" | "not_found" | "disabled" | "error";

export type CommercialOperationalLoadStateResult = {
  status: CommercialOperationalLoadStateStatus;
  candidates: CommercialOperationalState[];
  activeState: CommercialOperationalState | null;
  latestDecision: CommercialOperationalDecisionRecord | null;
  warnings: CommercialOperationalLoopWarning[];
  metadata: Record<string, unknown>;
};

export type CommercialOperationalStateReductionInput = {
  previousState: CommercialOperationalState | null;
  identityResolution: CommercialOperationalOpportunityIdentityResolution;
  loadResult: CommercialOperationalLoadStateResult;
  brainContext: BrainContextResolveResponse;
  inboundMessage: BrainNormalizedProcessInboundRequest;
  commercialContext: CommercialContextBuilderResult | null;
  salesAgentResult: SalesAgentResult | null;
  commercialPolicyResult: CommercialPolicyResult | null;
  commercialEvaluationResult: CommercialEvaluationResult | null;
  currentTime: string | Date;
  correlationId: string;
  processInboundRunId?: string | null;
  salesAgentRunId?: string | null;
  featureFlags: CommercialOperationalLoopFeatureFlags;
  metadata?: Record<string, unknown>;
};

export type CommercialOperationalStateReductionResult = {
  resultingState: CommercialOperationalState;
  stateDiff: CommercialOperationalStateDiff;
  warnings: CommercialOperationalLoopWarning[];
  reason: string;
};

export type CommercialOperationalNextActionSelectionInput = {
  previousState: CommercialOperationalState | null;
  resultingState: CommercialOperationalState;
  identityResolution: CommercialOperationalOpportunityIdentityResolution;
  commercialPolicyResult: CommercialPolicyResult | null;
  commercialEvaluationResult: CommercialEvaluationResult | null;
  salesAgentResult: SalesAgentResult | null;
  currentTime: string | Date;
  featureFlags: CommercialOperationalLoopFeatureFlags;
  metadata?: Record<string, unknown>;
};

export type CommercialOperationalTransitionValidationInput = {
  previousState: CommercialOperationalState | null;
  resultingState: CommercialOperationalState;
  nextAction: CommercialNextAction;
  identityResolution: CommercialOperationalOpportunityIdentityResolution;
  commercialPolicyResult: CommercialPolicyResult | null;
  commercialEvaluationResult: CommercialEvaluationResult | null;
  featureFlags: CommercialOperationalLoopFeatureFlags;
  metadata?: Record<string, unknown>;
};

export type CommercialOperationalDecisionRecord = {
  decisionId: string;
  opportunityId: string | number;
  opportunityKey: string;
  correlationId: string;
  processInboundRunId: string | null;
  salesAgentRunId: string | null;
  messageId: string | null;
  previousStatus: OpportunityStatus | null;
  nextStatus: OpportunityStatus;
  previousStage: OpportunityStage | null;
  nextStage: OpportunityStage | null;
  detectedSignals: CommercialSignal[];
  stateChanges: CommercialOperationalStateDiff;
  missingInformation: string[];
  nextAction: CommercialNextAction;
  policyStatus: CommercialPolicyStatus;
  riskLevel: CommercialPolicyRiskLevel;
  approvalRequirement: CommercialPolicyApprovalRequirement;
  decisionStatus: CommercialOperationalLoopDecisionStatus;
  rationale: string;
  warnings: CommercialOperationalLoopWarning[];
  contractVersion: string | null;
  policyVersion: string | null;
  runtimeVersion: string | null;
  createdAt: string;
};

export type CommercialOperationalPersistenceStatus = "persisted" | "skipped" | "duplicate" | "conflict" | "failed_safe";

export type CommercialOperationalPersistenceResult = {
  status: CommercialOperationalPersistenceStatus;
  opportunityWritten: boolean;
  decisionWritten: boolean;
  opportunityId: string | number | null;
  opportunityKey: string;
  decisionId: string;
  version: number | null;
  createdAt: string;
  warnings: CommercialOperationalLoopWarning[];
  reason: string | null;
};

export type CommercialOperationalLoadInput = {
  inboundMessage: BrainNormalizedProcessInboundRequest;
  brainContext: BrainContextResolveResponse;
  commercialContext: CommercialContextBuilderResult | null;
  currentTime: string | Date;
  correlationId: string;
  metadata?: Record<string, unknown>;
};

export type CommercialOperationalPersistInput = {
  currentTime: string | Date;
  previousState: CommercialOperationalState | null;
  resultingState: CommercialOperationalState;
  identityResolution: CommercialOperationalOpportunityIdentityResolution;
  transitionValidation: CommercialOperationalTransitionValidation;
  nextAction: CommercialNextAction;
  decisionRecord: CommercialOperationalDecisionRecord;
  featureFlags: CommercialOperationalLoopFeatureFlags;
  metadata?: Record<string, unknown>;
};

export type CommercialOperationalLoopStorage = {
  loadCommercialState?: (input: CommercialOperationalLoadInput) => Promise<CommercialOperationalLoadStateResult>;
  persistCommercialState?: (input: CommercialOperationalPersistInput) => Promise<CommercialOperationalPersistenceResult>;
};

export type CommercialOperationalLoopInput = {
  inboundMessage: BrainNormalizedProcessInboundRequest;
  brainContext: BrainContextResolveResponse;
  commercialContext?: CommercialContextBuilderResult | null;
  salesAgentResult?: SalesAgentResult | null;
  commercialPolicyResult?: CommercialPolicyResult | null;
  commercialEvaluationResult?: CommercialEvaluationResult | null;
  commercialShadowResult?: CommercialShadowResult | null;
  currentTime: string | Date;
  correlationId: string;
  processInboundRunId?: string | null;
  salesAgentRunId?: string | null;
  featureFlags: CommercialOperationalLoopFeatureFlags;
  mode?: CommercialOperationalLoopMode;
  contractVersion?: string | null;
  policyVersion?: string | null;
  runtimeVersion?: string | null;
  promptVersion?: SalesAgentPromptVersion | null;
  evaluationVersion?: string | null;
  metadata?: Record<string, unknown>;
  abortSignal?: AbortSignal | null;
  clock?: CommercialOperationalLoopClock;
  storage?: CommercialOperationalLoopStorage | null;
};

export type CommercialOperationalLoopMetrics = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
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
  evaluationStatus: CommercialEvaluationStatus | null;
  readinessDecision: CommercialReadinessDecision | null;
  usefulness: CommercialEvaluationUsefulness | null;
  comparisonStatus: CommercialDecisionComparisonStatus | null;
};

export type CommercialOperationalLoopError = {
  code: string;
  message: string;
  stage: CommercialOperationalLoopStageName;
  details?: Record<string, unknown> | null;
};

export type CommercialOperationalLoopVersions = {
  loopVersion: typeof import("./constants").COMMERCIAL_OPERATIONAL_LOOP_VERSION;
  salesAgentContractVersion: string | null;
  salesAgentRuntimeVersion: string | null;
  policyVersion: string | null;
  promptVersion: SalesAgentPromptVersion | null;
  evaluationVersion: string | null;
};

export type CommercialOperationalLoopResult = {
  status: CommercialOperationalLoopStatus;
  mode: CommercialOperationalLoopMode;
  enabled: boolean;
  dryRun: boolean;
  eligible: boolean;
  skipReason?: CommercialOperationalLoopSkipReason | null;
  correlationId: string;
  processInboundRunId?: string | null;
  salesAgentRunId?: string | null;
  observedAt: string;
  previousState: CommercialOperationalState | null;
  resultingState: CommercialOperationalState | null;
  stateDiff: CommercialOperationalStateDiff | null;
  identityResolution: CommercialOperationalOpportunityIdentityResolution | null;
  selectedNextAction: CommercialNextAction | null;
  transitionValidation: CommercialOperationalTransitionValidation | null;
  persistenceResult: CommercialOperationalPersistenceResult | null;
  decisionRecord: CommercialOperationalDecisionRecord | null;
  commercialEvaluationSummary: CommercialOperationalLoopEvaluationSummary | null;
  stages: CommercialOperationalLoopStageResult[];
  metrics: CommercialOperationalLoopMetrics;
  warnings: CommercialOperationalLoopWarning[];
  error?: CommercialOperationalLoopError | null;
  versions: CommercialOperationalLoopVersions;
  metadata: Record<string, unknown>;
  sideEffects: CommercialOperationalLoopSideEffects;
  executionDisposition: "observe_only" | "discard_after_observation" | "not_executed" | "persisted";
  continueLegacyFlow: true;
};
