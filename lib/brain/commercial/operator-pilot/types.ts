import type { CommercialShadowReviewViewModel } from "../review";

export const AI_SDR_OPERATOR_PILOT_STATUSES = [
  "available",
  "not_found",
  "disabled",
  "waiting_for_operational_loop",
  "error"
] as const;
export type AiSdrOperatorPilotStatus = (typeof AI_SDR_OPERATOR_PILOT_STATUSES)[number];

export const AI_SDR_OPERATOR_PILOT_COMMAND_TYPES = [
  "approve_ai_draft",
  "reject_ai_draft",
  "edit_ai_draft",
  "take_over_case",
  "request_more_context",
  "mark_not_useful"
] as const;
export type AiSdrOperatorPilotCommandType = (typeof AI_SDR_OPERATOR_PILOT_COMMAND_TYPES)[number];

export const AI_SDR_OPERATOR_PILOT_COMMAND_OUTCOMES = ["blocked_by_flag", "not_persisted", "not_executed"] as const;
export type AiSdrOperatorPilotCommandOutcome = (typeof AI_SDR_OPERATOR_PILOT_COMMAND_OUTCOMES)[number];

export type AiSdrOperatorPilotKnownInformationItem = {
  label: string;
  value: string;
  confidence: number | null;
  source: string | null;
};

export type AiSdrOperatorPilotMissingInformationItem = {
  key: string;
  label: string;
  reason: string | null;
  requiredFor: string | null;
};

export type AiSdrOperatorPilotNextAction = {
  type: string;
  label: string;
  reason: string;
  confidence: number | null;
  riskLevel: string | null;
  approvalRequirement: string | null;
  recommendedChannel: string | null;
  draftMessage: string | null;
  executable: false;
  blockedReasons: string[];
};

export type AiSdrOperatorPilotControls = {
  canApprove: false;
  canReject: false;
  canEditDraft: false;
  canTakeOver: false;
  disabledReason: string;
};

export type AiSdrOperatorPilotDiagnosticsLink = {
  available: boolean;
  label: string;
};

export type AiSdrOperatorPilotInvariants = {
  outboundExecuted: false;
  toolsExecuted: 0;
  followupScheduled: false;
  quoteCreated: false;
  leadCreated: false;
  opportunityCreatedFromUi: false;
  caseMutated: false;
  approvalPersisted: false;
  nextActionExecuted: false;
};

export type AiSdrOperatorPilotCommercialState = {
  status: string | null;
  stage: string | null;
  temperature: string | null;
  priority: string | null;
  summary: string | null;
  waitingFor: string | null;
};

export type AiSdrOperatorPilotCommandPreview = {
  commandType: AiSdrOperatorPilotCommandType;
  outcome: AiSdrOperatorPilotCommandOutcome;
  reason: string;
  executable: false;
};

export type AiSdrOperatorPilotViewModel = {
  status: AiSdrOperatorPilotStatus;
  caseId: string;
  observedAt: string | null;
  commercialState: AiSdrOperatorPilotCommercialState | null;
  knownInformation: AiSdrOperatorPilotKnownInformationItem[];
  missingInformation: AiSdrOperatorPilotMissingInformationItem[];
  nextAction: AiSdrOperatorPilotNextAction | null;
  operatorControls: AiSdrOperatorPilotControls;
  diagnosticsLink: AiSdrOperatorPilotDiagnosticsLink;
  invariants: AiSdrOperatorPilotInvariants;
  warnings: string[];
  error: string | null;
};

export type AiSdrOperatorPilotBuildInput = {
  caseId: string | number;
  caseRow?: Record<string, unknown> | null;
  sourceQueue?: Record<string, unknown> | null;
  commercialShadowReview: CommercialShadowReviewViewModel;
  commercialOperationalResult?: unknown;
  observedAt?: string | Date | null;
  currentTime?: string | Date | null;
  metadata?: Record<string, unknown> | null;
};
