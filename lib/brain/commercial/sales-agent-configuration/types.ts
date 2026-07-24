import type { PoolConnection } from "mysql2/promise";
import type {
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_CONFIGURATION_STATUSES,
  SALES_AGENT_CONFIGURATION_SUPPORTED_SCHEMA_VERSIONS
} from "./constants";

export type SalesAgentConfigurationScope = typeof SALES_AGENT_CONFIGURATION_SCOPE;
/** A loaded record can be either supported version - only new writes are pinned to the current one. */
export type SalesAgentConfigurationSchemaVersion = (typeof SALES_AGENT_CONFIGURATION_SUPPORTED_SCHEMA_VERSIONS)[number];
export type SalesAgentConfigurationStatus = (typeof SALES_AGENT_CONFIGURATION_STATUSES)[number];

/**
 * The six MVP-editable fields. Deliberately flat and small - no tone,
 * salesStyle, responseStyle, greetingPolicy, recommendationPolicy,
 * evidencePolicy, handoffPolicy, examples, or model/follow-up config. Those
 * (and evidence/safety rules) belong to the runtime, not this domain.
 */
export type SalesAgentPromptConfiguration = {
  agentName: string;
  companyName: string;
  role: string;
  companyDescription: string;
  customInstructions: string;
  prohibitedPhrases: string[];
};

export const SALES_AGENT_PROMPT_CONFIGURATION_FIELDS = [
  "agentName",
  "companyName",
  "role",
  "companyDescription",
  "customInstructions",
  "prohibitedPhrases"
] as const satisfies readonly (keyof SalesAgentPromptConfiguration)[];

/**
 * ACS-R1-05.1-T02.3B. No `provider` field: the runtime only calls one
 * OpenAI-compatible chat-completions endpoint (httpAgentLoopProvider.ts) and
 * there is no real multi-provider abstraction to select between - adding an
 * editable provider field here would be speculative, not a real need.
 */
export type SalesAgentModelConfiguration = {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  maxModelRetries: number;
};

export type SalesAgentLoopConfiguration = {
  maxAgentStepsPerTurn: number;
  maxToolCallsPerTurn: number;
};

/**
 * ACS-R1-05.1-T02.3D. Governs the platform's follow-up SCHEDULING limits -
 * never the commercial decision itself (the Sales Agent still decides
 * whether/why a follow-up is warranted; this only authorizes, paces and
 * bounds it). `timezone` is fixed to "America/Santiago" (single business
 * timezone for this deployment, not a per-tenant setting) - typed as a
 * literal so a future multi-timezone need is a real type change, not a
 * silently-accepted free string. The non-configurable invariants
 * (cancelOnOptOut, ai-blocked, human-owner-active, opportunity-closed,
 * no-duplicate-per-sequence) are deliberately NOT fields here - they are
 * hardcoded in the worker/execution-bridge and never exposed as something
 * the Hub could turn off.
 */
export type SalesAgentFollowUpConfiguration = {
  enabled: boolean;
  maxAttempts: number;
  /** Length must equal maxAttempts - attemptDelaysMinutes[0] is measured from the initial decision, attemptDelaysMinutes[n] (n>0) from attempt n's own scheduled_for, never from "now" at worker-recovery time. */
  attemptDelaysMinutes: number[];
  allowedWindow: {
    timezone: "America/Santiago";
    startHour: number;
    endHour: number;
    /** 0=Sunday .. 6=Saturday, matching Date#getUTCDay()/Intl.DateTimeFormat weekday parts used by computeFollowUpSchedule.ts. */
    allowedWeekdays: number[];
  };
  /** Based on the opportunity's created_at (age), never lastActivityAt (inactivity) - a deliberately distinct concept. */
  maxOpportunityAgeDays: number;
};

/**
 * The resolved, effective model configuration actually handed to the
 * provider (resolver.ts). `model` is always resolved - published (if it
 * still passes today's allowlist) -> BRAIN_MODEL_NAME -> the generic
 * fallback - never absent. `maxOutputTokens` is deliberately NOT defaulted:
 * it stays absent unless a real published document set it, so
 * httpAgentLoopProvider.ts can omit `max_tokens` entirely for an
 * unconfigured deployment instead of silently capping it at an invented
 * number.
 */
export type EffectiveSalesAgentModelConfiguration = {
  model: string;
  temperature: number;
  maxOutputTokens?: number;
  timeoutMs: number;
  maxModelRetries: number;
};

/**
 * The stored document shape: the six required v1 prompt fields, plus two
 * optional v2 sections. A plain `SalesAgentPromptConfiguration` (no
 * model/loop keys at all) is structurally a valid `SalesAgentConfigurationDocument`
 * - this is what keeps every v1 row valid, unmigrated, forever.
 */
export type SalesAgentConfigurationDocument = SalesAgentPromptConfiguration & {
  modelConfiguration?: SalesAgentModelConfiguration;
  loopConfiguration?: SalesAgentLoopConfiguration;
  followUpConfiguration?: SalesAgentFollowUpConfiguration;
};

export type SalesAgentConfigurationRecord = {
  id: number;
  scopeKey: SalesAgentConfigurationScope;
  name: string;
  version: number;
  status: SalesAgentConfigurationStatus;
  schemaVersion: SalesAgentConfigurationSchemaVersion;
  configuration: SalesAgentConfigurationDocument;
  configurationHash: string;
  parentConfigurationId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
};

/** Same shape as SalesAgentFollowUpConfiguration - every field is always fully resolved and clamped to platform limits, never partial (unlike EffectiveSalesAgentModelConfiguration's maxOutputTokens, nothing here is meant to stay absent). */
export type EffectiveSalesAgentFollowUpConfiguration = SalesAgentFollowUpConfiguration;

export type ResolvedSalesAgentConfigurationSource = "published" | "deployment_default" | "safe_default";

export type ResolvedSalesAgentConfiguration = {
  source: ResolvedSalesAgentConfigurationSource;
  scopeKey: SalesAgentConfigurationScope;
  recordId: number | null;
  version: number | null;
  configurationHash: string | null;
  configuration: SalesAgentPromptConfiguration;
  /**
   * Fully resolved and clamped to platform limits, regardless of source -
   * consumers (runNativeAgentToolLoopCycle, httpAgentLoopProvider) never
   * apply their own clamp again. The one exception is maxOutputTokens,
   * which stays absent rather than defaulted - see
   * EffectiveSalesAgentModelConfiguration.
   */
  effectiveModelConfiguration: EffectiveSalesAgentModelConfiguration;
  effectiveLoopConfiguration: SalesAgentLoopConfiguration;
  effectiveFollowUpConfiguration: EffectiveSalesAgentFollowUpConfiguration;
};

/**
 * Minimal connection surface the repository/publish flow need: raw
 * execute() (for GET_LOCK/RELEASE_LOCK and row queries) plus transaction
 * control. Matches the AgentActionQueueConnection convention in
 * action-queue/types.ts.
 */
export type SalesAgentConfigurationConnection = Pick<PoolConnection, "execute" | "beginTransaction" | "commit" | "rollback">;

/**
 * Named, instanceof-checkable domain errors (same convention as
 * LegacySalesConsultativeDisabledError) - never a generic Error, so callers
 * can distinguish "not found" from "wrong lifecycle state" from "lock
 * timeout" instead of string-matching a message.
 */
export class SalesAgentConfigurationNotFoundError extends Error {
  constructor(message = "sales_agent_configuration_not_found") {
    super(message);
    this.name = "SalesAgentConfigurationNotFoundError";
  }
}

export class SalesAgentConfigurationNotDraftError extends Error {
  constructor(message = "sales_agent_configuration_not_draft") {
    super(message);
    this.name = "SalesAgentConfigurationNotDraftError";
  }
}

export class SalesAgentConfigurationScopeMismatchError extends Error {
  constructor(message = "sales_agent_configuration_scope_mismatch") {
    super(message);
    this.name = "SalesAgentConfigurationScopeMismatchError";
  }
}

export class SalesAgentConfigurationInvalidError extends Error {
  constructor(message = "sales_agent_configuration_invalid") {
    super(message);
    this.name = "SalesAgentConfigurationInvalidError";
  }
}

export class SalesAgentConfigurationIntegrityError extends Error {
  constructor(message = "sales_agent_configuration_integrity_error") {
    super(message);
    this.name = "SalesAgentConfigurationIntegrityError";
  }
}

export class SalesAgentConfigurationLockTimeoutError extends Error {
  constructor(message = "sales_agent_configuration_lock_timeout") {
    super(message);
    this.name = "SalesAgentConfigurationLockTimeoutError";
  }
}

/**
 * ACS-R1-05.1-T02.3C. Thrown by updateDraftConfiguration when the row
 * still exists and is still a draft, but `expectedUpdatedAt` no longer
 * matches the stored `updated_at` - a concurrent editor saved first.
 * Distinct from SalesAgentConfigurationNotDraftError (which means the
 * lifecycle state itself changed, not just the content).
 */
export class SalesAgentConfigurationConflictError extends Error {
  constructor(message = "sales_agent_configuration_conflict") {
    super(message);
    this.name = "SalesAgentConfigurationConflictError";
  }
}
