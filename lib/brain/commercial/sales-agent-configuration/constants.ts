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

export const SALES_AGENT_CONFIGURATION_SUPPORTED_SCHEMA_VERSIONS = [
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V2
] as const;

/** Version stamped on every new draft/update - never on a read-only load. */
export const SALES_AGENT_CONFIGURATION_SCHEMA_VERSION = SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V2;

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
