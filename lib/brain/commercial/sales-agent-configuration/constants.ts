/**
 * ACS-R1-05.1-T02.3A. This release is PesasChile-only - a single hardcoded
 * scope, never a tenant/phoneNumberId/channelAccountId resolver. Adding
 * multi-tenant resolution is explicitly out of scope; see the release doc.
 */
export const SALES_AGENT_CONFIGURATION_SCOPE = "pesas_chile" as const;

/**
 * ACS-R1-05.1-T02.3A original schema: exactly the six prompt fields, no
 * model/loop configuration. Existing rows stay tagged with this version
 * forever - it is read-compatible input, never rewritten retroactively.
 */
export const SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1 = "sales_agent_configuration.v1" as const;

/**
 * ACS-R1-05.1-T02.3B: same flat shape as v1 (the six prompt fields are
 * unchanged and still required) plus two new, optional top-level sections -
 * `modelConfiguration`/`loopConfiguration`. A v1 document is valid input
 * wherever a v2 document is expected (structural superset), so no migration
 * of existing rows is needed - this is the version every new draft/update is
 * written as.
 */
export const SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V2 = "sales_agent_configuration.v2" as const;

/**
 * ACS-R1-05.1-T02.3D: same flat shape as v2 (all v1/v2 fields unchanged and
 * still required/optional as before) plus one new, optional top-level
 * section - `followUpConfiguration`. A v1 or v2 document is valid input
 * wherever a v3 document is expected (structural superset), so no migration
 * of existing rows is needed.
 */
export const SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V3 = "sales_agent_configuration.v3" as const;

export const SALES_AGENT_CONFIGURATION_SUPPORTED_SCHEMA_VERSIONS = [
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V2,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V3
] as const;

/** Version stamped on every new draft/update - never on a read-only load. */
export const SALES_AGENT_CONFIGURATION_SCHEMA_VERSION = SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V3;

export const SALES_AGENT_CONFIGURATION_TABLE = "sales_agent_configurations";

export const SALES_AGENT_CONFIGURATION_STATUSES = ["draft", "published", "archived"] as const;

/**
 * MySQL/MariaDB session advisory lock key (GET_LOCK/RELEASE_LOCK) guarding
 * version assignment and publish/archive for this scope - session-scoped,
 * must run on the same connection as the transaction it protects.
 */
export const SALES_AGENT_CONFIGURATION_LOCK_KEY = `sales_agent_configurations:${SALES_AGENT_CONFIGURATION_SCOPE}`;
export const SALES_AGENT_CONFIGURATION_LOCK_TIMEOUT_SECONDS = 10;

/**
 * Format-only limits (validation.ts never interprets business meaning or
 * blocks specific words/phrases - it only bounds size and shape).
 */
export const SALES_AGENT_CONFIGURATION_LIMITS = {
  agentNameMaxLength: 80,
  companyNameMaxLength: 120,
  roleMaxLength: 160,
  companyDescriptionMaxLength: 2000,
  customInstructionsMaxLength: 4000,
  prohibitedPhraseMaxLength: 200,
  maxProhibitedPhrases: 50,
  /** Guards against oversized payloads before any per-field check runs. */
  maxRawPayloadBytes: 50_000
} as const;

export const SALES_AGENT_MODEL_CONFIGURATION_FIELDS = ["model", "temperature", "maxOutputTokens", "timeoutMs", "maxModelRetries"] as const;

/**
 * The one model name this module ever assumes without asking the
 * deployment - never a real product default, just the generic literal used
 * when no deployment (BRAIN_MODEL_NAME) or published value exists. Shared by
 * defaults.ts (safe default) and validation.ts (the model allowlist) so
 * both always agree on the same single fallback string.
 */
export const SALES_AGENT_MODEL_CONFIGURATION_GENERIC_FALLBACK_MODEL = "brain-agent-loop" as const;

export const SALES_AGENT_LOOP_CONFIGURATION_FIELDS = ["maxAgentStepsPerTurn", "maxToolCallsPerTurn"] as const;

/**
 * ACS-R1-05.1-T02.3B. Platform ceilings/floors, applied by the resolver to
 * every effective value regardless of source (published, deployment
 * default, or safe default) - a persisted configuration can never exceed
 * these, even if it was written before a platform cap tightened. Validated
 * against runNativeAutonomousCycle.ts/httpAgentLoopProvider.ts/
 * runAgentToolLoop.ts before being fixed here (see report).
 */
export const SALES_AGENT_MODEL_CONFIGURATION_LIMITS = {
  modelMaxLength: 191,
  temperatureMin: 0,
  temperatureMax: 1,
  maxOutputTokensMin: 128,
  maxOutputTokensMax: 2048,
  timeoutMsMin: 5_000,
  timeoutMsMax: 60_000,
  maxModelRetriesMin: 0,
  maxModelRetriesMax: 5
} as const;

export const SALES_AGENT_LOOP_CONFIGURATION_LIMITS = {
  maxAgentStepsPerTurnMin: 1,
  maxAgentStepsPerTurnMax: 12,
  maxToolCallsPerTurnMin: 0,
  maxToolCallsPerTurnMax: 12
} as const;

/**
 * ACS-R1-05.1-T02.3C. Single fixed actor for every Hub-originated write
 * (create/update/publish/clone/archive) - requireOperator() has no
 * per-operator identity today (shared session cookie or admin bypass
 * token, never a user id). Temporary, documented limitation until the Hub
 * has real per-operator accounts; never invented per-request from client
 * input.
 */
export const SALES_AGENT_CONFIGURATION_HUB_ACTOR = "hub_operator" as const;

export const SALES_AGENT_FOLLOW_UP_CONFIGURATION_FIELDS = [
  "enabled",
  "maxAttempts",
  "attemptDelaysMinutes",
  "allowedWindow",
  "maxOpportunityAgeDays"
] as const;

export const SALES_AGENT_FOLLOW_UP_ALLOWED_WINDOW_FIELDS = ["timezone", "startHour", "endHour", "allowedWeekdays"] as const;

/** Single supported business timezone for this deployment - never a per-tenant/free-string value. */
export const SALES_AGENT_FOLLOW_UP_TIMEZONE = "America/Santiago" as const;

/**
 * ACS-R1-05.1-T02.3D. Platform ceilings/floors for the follow-up scheduling
 * section, applied by the resolver to every effective value regardless of
 * source - same convention as SALES_AGENT_MODEL_CONFIGURATION_LIMITS/
 * SALES_AGENT_LOOP_CONFIGURATION_LIMITS above.
 */
export const SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS = {
  maxAttemptsMin: 1,
  maxAttemptsMax: 5,
  attemptDelayMinutesMin: 5,
  attemptDelayMinutesMax: 43_200,
  maxOpportunityAgeDaysMin: 1,
  maxOpportunityAgeDaysMax: 180,
  windowHourMin: 0,
  windowHourMax: 23,
  weekdayMin: 0,
  weekdayMax: 6
} as const;
