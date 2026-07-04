import type { ConversationRequestDomain, RequestEventType } from "../conversation-request";

export type RequestResolutionCondition = {
  /** The request resolves when an event of this type exists in its trail. */
  eventType: RequestEventType;
  resolutionType: string;
};

export type RequestEscalationCondition = {
  /** The request moves to waiting_human when an event of this type exists. */
  eventType: RequestEventType;
};

export type RequestFollowupPolicy = {
  purpose: string;
  delayMinutes: number;
};

export type RequestDefinition = {
  intentType: string;
  domain: ConversationRequestDomain;
  /** Fact keys that must be active before mutations may run for this request. */
  requiredFacts: string[];
  optionalFacts: string[];
  /** Per-request-type allowlist; composes with global hard blocks and policy, never replaces them. */
  allowedCapabilities: string[];
  resolutionConditions: RequestResolutionCondition[];
  escalationConditions: RequestEscalationCondition[];
  followupPolicy: RequestFollowupPolicy | null;
};
