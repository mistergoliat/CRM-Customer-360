export type CopilotFinalResponseState = "success" | "degraded_success" | "failure";

export type CustomerIntelligenceCopilotResponse =
  | CustomerIntelligenceCopilotAnsweredResponse
  | CustomerIntelligenceCopilotAnsweredFromContextResponse
  | CustomerIntelligenceCopilotRespondedDirectlyResponse
  | CustomerIntelligenceCopilotTerminalResponse
  | CustomerIntelligenceCopilotPlannerInvalidResponse
  | CustomerIntelligenceCopilotFailureResponse;

export type CustomerIntelligenceCopilotAnsweredResponse = {
  readonly status: "answered";
  readonly finalResponseState?: "success" | "degraded_success";
  readonly answer: string;
  readonly analysis: {
    readonly contractVersion?: string;
    readonly analysisPlanVersion?: string;
    readonly finalResponseState?: "success" | "degraded_success";
    readonly queryCount: number;
    readonly queryPlanHashes: readonly string[];
    readonly resultRowCount: number;
    readonly executionDurationMs: number;
    readonly plannerModel: string | null;
    readonly answerModel: string | null;
    readonly synthesisFallbackUsed?: boolean;
  };
  readonly provenance: CustomerIntelligenceCopilotProvenance;
};

export type CustomerIntelligenceCopilotAnsweredFromContextResponse = {
  readonly status: "answered_from_context";
  readonly finalResponseState?: "success";
  readonly answer: string;
  readonly analysis: {
    readonly contractVersion?: string;
    readonly analysisPlanVersion?: string;
    readonly finalResponseState?: "success";
    readonly sourceQueryIds: readonly string[];
    readonly resultRowCount: number;
    readonly plannerModel: string | null;
    readonly answerModel: string | null;
  };
  readonly provenance: CustomerIntelligenceCopilotProvenance;
};

// The deterministic direct-response path (e.g. the currency/unit fast path): no analytics run
// (queryCount is not even part of this shape), prose lives in `answer` exactly like `answered`.
export type CustomerIntelligenceCopilotRespondedDirectlyResponse = {
  readonly status: "responded_directly";
  readonly finalResponseState?: "success";
  readonly answer: string;
  readonly analysis: {
    readonly contractVersion?: string;
    readonly decisionVersion?: string;
    readonly decisionAction?: "respond_directly";
    readonly orchestratorModel?: string | null;
    readonly finalResponseState?: "success";
  };
  readonly provenance: CustomerIntelligenceCopilotProvenance;
};

export type CustomerIntelligenceCopilotTerminalResponse = {
  readonly status: "clarification_required" | "unsupported_data" | "unsupported_operation";
  readonly finalResponseState?: "success";
  readonly message: string;
  readonly contractVersion?: string;
};

export type CustomerIntelligenceCopilotPlannerInvalidResponse = {
  readonly status: "planner_invalid" | "orchestrator_invalid";
  readonly finalResponseState?: "failure";
  readonly errors: readonly string[];
  readonly contractVersion?: string;
};

export type CustomerIntelligenceCopilotFailureResponse = {
  readonly status:
    | "analytics_unavailable"
    | "analytics_timeout"
    | "answer_generation_failed"
    | "provider_authentication_error"
    | "provider_billing_error"
    | "provider_rate_limited"
    | "provider_timeout"
    | "provider_network_error"
    | "provider_invalid_response";
  readonly finalResponseState?: "failure";
  readonly message: string;
  readonly contractVersion?: string;
};

export type CopilotInteractionType = "answer" | "clarification" | "unsupported" | "error";

export type NormalizedCopilotTurn = {
  readonly text: string;
  readonly finalResponseState: CopilotFinalResponseState;
  readonly interactionType: CopilotInteractionType;
  // true when the backend reported a non-fatal status but sent no displayable prose - an
  // integration-contract error, never rendered as a silent empty "success" card.
  readonly contractError: boolean;
};

const COPILOT_CONTRACT_ERROR_TEXT = "El Copilot respondio pero el backend no envio contenido visible para mostrar. Intenta de nuevo.";

// Single place that knows which backend field carries user-visible prose for each status. The
// rendering component reads only `text`/`finalResponseState`/`interactionType` and never needs to
// learn a new backend field name when a status is added, as long as the backend keeps the
// existing "success/non-fatal statuses carry prose in `answer` or `message`" convention.
export function normalizeCopilotTurn(response: CustomerIntelligenceCopilotResponse): NormalizedCopilotTurn {
  const { text, interactionType } = extractCopilotText(response);
  const finalResponseState = resolveFinalResponseState(response);
  const contractError = finalResponseState !== "failure" && text.trim().length === 0;
  return contractError
    ? { text: COPILOT_CONTRACT_ERROR_TEXT, finalResponseState: "failure", interactionType: "error", contractError: true }
    : { text, finalResponseState, interactionType, contractError: false };
}

function extractCopilotText(response: CustomerIntelligenceCopilotResponse): { text: string; interactionType: CopilotInteractionType } {
  switch (response.status) {
    case "answered":
    case "answered_from_context":
    case "responded_directly":
      return { text: response.answer, interactionType: "answer" };
    case "clarification_required":
      return { text: response.message, interactionType: "clarification" };
    case "unsupported_data":
    case "unsupported_operation":
      return { text: response.message, interactionType: "unsupported" };
    case "planner_invalid":
    case "orchestrator_invalid":
      return { text: response.errors.join(" - "), interactionType: "error" };
    default:
      return { text: response.message, interactionType: "error" };
  }
}

function resolveFinalResponseState(response: CustomerIntelligenceCopilotResponse): CopilotFinalResponseState {
  if (response.finalResponseState) return response.finalResponseState;
  switch (response.status) {
    case "planner_invalid":
    case "orchestrator_invalid":
      return "failure";
    case "answered":
    case "answered_from_context":
    case "responded_directly":
    case "clarification_required":
    case "unsupported_data":
    case "unsupported_operation":
      return "success";
    default:
      return "failure";
  }
}

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
