export type CustomerIntelligenceCopilotResponse =
  | CustomerIntelligenceCopilotAnsweredResponse
  | CustomerIntelligenceCopilotAnsweredFromContextResponse
  | CustomerIntelligenceCopilotTerminalResponse
  | CustomerIntelligenceCopilotPlannerInvalidResponse
  | CustomerIntelligenceCopilotFailureResponse;

export type CustomerIntelligenceCopilotAnsweredResponse = {
  readonly status: "answered";
  readonly answer: string;
  readonly analysis: {
    readonly contractVersion?: string;
    readonly analysisPlanVersion?: string;
    readonly queryCount: number;
    readonly queryPlanHashes: readonly string[];
    readonly resultRowCount: number;
    readonly executionDurationMs: number;
    readonly plannerModel: string | null;
    readonly answerModel: string | null;
  };
  readonly provenance: CustomerIntelligenceCopilotProvenance;
};

export type CustomerIntelligenceCopilotAnsweredFromContextResponse = {
  readonly status: "answered_from_context";
  readonly answer: string;
  readonly analysis: {
    readonly contractVersion?: string;
    readonly analysisPlanVersion?: string;
    readonly sourceQueryIds: readonly string[];
    readonly resultRowCount: number;
    readonly plannerModel: string | null;
    readonly answerModel: string | null;
  };
  readonly provenance: CustomerIntelligenceCopilotProvenance;
};

export type CustomerIntelligenceCopilotTerminalResponse = {
  readonly status: "clarification_required" | "unsupported_data" | "unsupported_operation";
  readonly message: string;
  readonly contractVersion?: string;
};

export type CustomerIntelligenceCopilotPlannerInvalidResponse = {
  readonly status: "planner_invalid";
  readonly errors: readonly string[];
  readonly contractVersion?: string;
};

export type CustomerIntelligenceCopilotFailureResponse = {
  readonly status: "analytics_unavailable" | "analytics_timeout" | "answer_generation_failed";
  readonly message: string;
  readonly contractVersion?: string;
};

export type CustomerIntelligenceCopilotSessionTurnResponse = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly queryIds: readonly string[];
  readonly sourceQueryIds: readonly string[];
} & CustomerIntelligenceCopilotResponse;

export type CustomerIntelligenceCopilotProvenance = {
  readonly featureSnapshot: { readonly snapshotId: string; readonly referenceTime: string; readonly featureVersion: string; readonly populationPolicyVersion: string };
  readonly rfmSnapshot: { readonly snapshotId: string; readonly referenceTime: string; readonly calculationVersion: string } | null;
  readonly clusterSnapshot: { readonly snapshotId: string; readonly referenceTime: string; readonly modelId: string; readonly modelVersion: string } | null;
  readonly population: {
    readonly featurePopulation: number;
    readonly rfmMatched: number;
    readonly clusterMatched: number;
    readonly bothMatched: number;
    readonly neitherMatched: number;
    readonly rfmCoveragePct: number;
    readonly clusterCoveragePct: number;
  };
  readonly contractVersion?: string;
};

export type CustomerIntelligenceCopilotSessionSummary = {
  readonly sessionId: string;
  readonly sessionVersion: "customer-intelligence-copilot-session-v1";
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly expiresAt: string;
  readonly pinnedContext: CustomerIntelligenceCopilotProvenance;
  readonly turnCount: number;
  readonly resultCount: number;
};

export type CreateCustomerIntelligenceCopilotSessionResult =
  | { readonly status: "created"; readonly session: CustomerIntelligenceCopilotSessionSummary }
  | { readonly status: "analytics_unavailable"; readonly message: string };

export type RefreshCustomerIntelligenceCopilotSessionResult =
  | { readonly status: "refreshed"; readonly session: CustomerIntelligenceCopilotSessionSummary }
  | { readonly status: "session_not_found" | "session_expired" }
  | { readonly status: "analytics_unavailable"; readonly message: string };

export type ResetCustomerIntelligenceCopilotSessionResult =
  | { readonly status: "reset"; readonly session: CustomerIntelligenceCopilotSessionSummary }
  | { readonly status: "session_not_found" | "session_expired" };

export type DeleteCustomerIntelligenceCopilotSessionResult = {
  readonly status: "deleted" | "session_not_found" | "session_expired";
};

export type MarketingCopilotProxyError = {
  readonly code: string;
  readonly message: string;
};

export const CUSTOMER_INTELLIGENCE_COPILOT_QUESTIONS = [
  "Cuantos clientes hay?",
  "Cuantos clientes hay en cada cluster?",
  "Que cluster tiene mayor ticket promedio?",
  "Como se distribuyen los segmentos RFM por cluster?",
  "Cuantos AT_RISK_HIGH_VALUE hay en cada cluster?",
  "Compara los clusters por ticket promedio y cantidad de clientes.",
  "Analiza los clusters y dime que oportunidades comerciales observas."
] as const;

export const CUSTOMER_INTELLIGENCE_COPILOT_DEMO_QUESTIONS = CUSTOMER_INTELLIGENCE_COPILOT_QUESTIONS;
