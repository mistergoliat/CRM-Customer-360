import type {
  EscalationCategory,
  EscalationCreatedBy,
  EscalationMode,
  EscalationResolutionOutcome,
  EscalationStatus,
  EscalationTargetType
} from "./constants";

export type RequestEscalation = {
  contractName: "RequestEscalation";
  schemaVersion: "1.0.0";
  escalationId: string;
  requestId: string;
  conversationId: number;
  category: EscalationCategory;
  mode: EscalationMode;
  targetType: EscalationTargetType;
  targetId: string;
  status: EscalationStatus;
  reason: string;
  createdBy: EscalationCreatedBy;
  assignedOperatorId: string | null;
  resolutionOutcome: EscalationResolutionOutcome | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type EscalateRequestInput = {
  requestId: string;
  category: EscalationCategory;
  mode: EscalationMode;
  reason: string;
  createdBy: EscalationCreatedBy;
  targetType?: EscalationTargetType;
  targetId?: string;
  /** Correlates the trail (turn plan id, action id, operator id...). */
  sourceId?: string | null;
};

export type EscalateRequestResult =
  | { ok: true; status: "created" | "duplicate"; escalation: RequestEscalation }
  | { ok: false; status: "request_not_found" | "conflict" | "error"; escalation: null; warning: string };

export type TransitionEscalationResult =
  | { ok: true; escalation: RequestEscalation }
  | { ok: false; status: "invalid_transition" | "conflict" | "not_found" | "error"; escalation: RequestEscalation | null; warning: string };

export type ResolveEscalationInput = {
  escalationId: string;
  outcome: Extract<EscalationResolutionOutcome, "resolved_request" | "returned_to_ai">;
  operatorId: string;
  resolutionNote?: string | null;
  /** Required when outcome = resolved_request: what answered the request. */
  resolutionType?: string | null;
};

export type ResolveEscalationResult =
  | { ok: true; escalation: RequestEscalation; requestStatus: string }
  | { ok: false; status: "not_found" | "conflict" | "request_error" | "error"; escalation: RequestEscalation | null; warning: string };
