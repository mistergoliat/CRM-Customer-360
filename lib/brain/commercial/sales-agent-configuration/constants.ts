/**
 * ACS-R1-05.1-T02.3A. This release is PesasChile-only - a single hardcoded
 * scope, never a tenant/phoneNumberId/channelAccountId resolver. Adding
 * multi-tenant resolution is explicitly out of scope; see the release doc.
 */
export const SALES_AGENT_CONFIGURATION_SCOPE = "pesas_chile" as const;

export const SALES_AGENT_CONFIGURATION_SCHEMA_VERSION = "sales_agent_configuration.v1" as const;

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
