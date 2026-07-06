import type { ConversationRequestDomain, RequestEventType } from "../conversation-request";
// Import from the constants module only (not the escalations index/repository)
// to avoid a cycle: request-escalations/repository.ts calls back into
// request-definitions for applyRequestReduction.
import type { EscalationCategory, EscalationMode } from "../request-escalations/constants";

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

/** Declarative auto-escalation: this request type has no autonomous resolution path at all. */
export type AutoEscalateStrategy = {
  category: EscalationCategory;
  mode: EscalationMode;
  reason: string;
};

/**
 * Declarative single-capability auto-execution: the one read capability that
 * answers this request type. Input comes from an active fact when `factKey`
 * is set and present; otherwise, when `fallbackToMessageText` is true, the
 * raw customer message stands in (safe only for free-text search inputs,
 * never for identifiers).
 */
export type PrimaryCapabilityStrategy = {
  capability: string;
  factKey: string | null;
  inputField: "query" | "orderIdentifier";
  fallbackToMessageText: boolean;
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
  autoEscalate: AutoEscalateStrategy | null;
  primaryCapability: PrimaryCapabilityStrategy | null;
};
