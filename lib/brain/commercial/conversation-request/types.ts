import type {
  ConversationRequestDomain,
  ConversationRequestPriority,
  ConversationRequestStatus,
  RequestEventSourceType,
  RequestEventType,
  RequestMessageLinkedBy,
  RequestMessageRelationType
} from "./constants";

export type ConversationRequestResolution = {
  type: string;
  entityType: string | null;
  entityId: string | null;
};

export type ConversationRequest = {
  contractName: "ConversationRequest";
  schemaVersion: "1.0.0";
  requestId: string;
  creationKey: string;
  conversationId: number;
  opportunityId: number | null;
  intentType: string;
  intentDomain: ConversationRequestDomain;
  status: ConversationRequestStatus;
  priority: ConversationRequestPriority;
  parentRequestId: string | null;
  createdFromMessageId: string;
  resolution: ConversationRequestResolution | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export type CreateConversationRequestInput = {
  creationKey: string;
  conversationId: number;
  opportunityId?: number | null;
  intentType: string;
  intentDomain: ConversationRequestDomain;
  priority?: ConversationRequestPriority;
  parentRequestId?: string | null;
  createdFromMessageId: string;
};

export type CreateConversationRequestResult =
  | { ok: true; status: "created" | "duplicate"; request: ConversationRequest }
  | { ok: false; status: "error"; request: null; warning: string };

export type TransitionConversationRequestInput = {
  requestId: string;
  fromStatus: ConversationRequestStatus;
  toStatus: ConversationRequestStatus;
  resolution?: ConversationRequestResolution | null;
};

export type TransitionConversationRequestResult =
  | { ok: true; status: "transitioned"; request: ConversationRequest }
  | { ok: false; status: "invalid_transition" | "conflict" | "not_found" | "error"; request: ConversationRequest | null; warning: string };

export type RequestEvent = {
  requestEventId: string;
  dedupeKey: string;
  requestId: string;
  eventType: RequestEventType;
  sourceType: RequestEventSourceType;
  sourceId: string | null;
  payload: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
};

export type AppendRequestEventInput = {
  dedupeKey: string;
  requestId: string;
  eventType: RequestEventType;
  sourceType: RequestEventSourceType;
  sourceId?: string | null;
  payload?: Record<string, unknown> | null;
  occurredAt: string;
};

export type AppendRequestEventResult =
  | { ok: true; status: "created" | "duplicate"; event: RequestEvent }
  | { ok: false; status: "error"; event: null; warning: string };

export type RequestMessageLink = {
  requestId: string;
  messageId: string;
  relationType: RequestMessageRelationType;
  confidence: number | null;
  linkedBy: RequestMessageLinkedBy;
  createdAt: string;
};

export type LinkMessageToRequestInput = {
  requestId: string;
  messageId: string;
  relationType: RequestMessageRelationType;
  confidence?: number | null;
  linkedBy: RequestMessageLinkedBy;
};

export type LinkMessageToRequestResult =
  | { ok: true; status: "created" | "duplicate"; link: RequestMessageLink }
  | { ok: false; status: "error"; link: null; warning: string };
