export const MULTI_REQUEST_RUNTIME_VERSION = "brain.commercial.multi-request.v1" as const;

/**
 * Version of the planner OUTPUT contract stored in crm_turn_plans.plan_json.
 * Bumping it lets a re-processed inbound get a fresh plan (the reuse UNIQUE
 * key is inbound_message_id + planner_schema_version), without ever mutating
 * plans already persisted under the previous version.
 */
export const TURN_PLANNER_SCHEMA_VERSION = "1.0.0" as const;

export const TURN_PLAN_STATUSES = [
  "planned",
  "partially_executed",
  "executed",
  "failed",
  "superseded"
] as const;
export type TurnPlanStatus = (typeof TURN_PLAN_STATUSES)[number];

export const TURN_INTENT_OPERATIONS = [
  "create_request",
  "continue_request",
  "modify_request",
  "reopen_request",
  "cancel_request",
  "mention_request"
] as const;
export type TurnIntentOperation = (typeof TURN_INTENT_OPERATIONS)[number];

export const REQUEST_LINK_STRATEGIES = [
  "explicit_reference",
  "artifact_reference",
  "message_link",
  "active_recent_request",
  "intent_and_fact_match",
  "llm_disambiguation",
  "new_request"
] as const;
export type RequestLinkStrategy = (typeof REQUEST_LINK_STRATEGIES)[number];

export const RESPONSE_REQUIREMENT_KINDS = [
  "answer",
  "ask_missing_fact",
  "acknowledge",
  "defer_notice",
  "escalation_notice"
] as const;
export type ResponseRequirementKind = (typeof RESPONSE_REQUIREMENT_KINDS)[number];

export function isMultiRequestRuntimeEnabled(): boolean {
  return process.env.BRAIN_MULTI_REQUEST_RUNTIME_ENABLED?.trim().toLowerCase() === "true";
}

export function isTurnPlanPersistenceEnabled(): boolean {
  return process.env.BRAIN_TURN_PLAN_PERSISTENCE_ENABLED?.trim().toLowerCase() === "true";
}
