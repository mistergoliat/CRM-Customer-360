import type { PoolConnection } from "mysql2/promise";
import type { SALES_AGENT_CONFIGURATION_SCHEMA_VERSION, SALES_AGENT_CONFIGURATION_SCOPE, SALES_AGENT_CONFIGURATION_STATUSES } from "./constants";

export type SalesAgentConfigurationScope = typeof SALES_AGENT_CONFIGURATION_SCOPE;
export type SalesAgentConfigurationSchemaVersion = typeof SALES_AGENT_CONFIGURATION_SCHEMA_VERSION;
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

export type SalesAgentConfigurationRecord = {
  id: number;
  scopeKey: SalesAgentConfigurationScope;
  name: string;
  version: number;
  status: SalesAgentConfigurationStatus;
  schemaVersion: SalesAgentConfigurationSchemaVersion;
  configuration: SalesAgentPromptConfiguration;
  configurationHash: string;
  parentConfigurationId: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
};

export type ResolvedSalesAgentConfigurationSource = "published" | "deployment_default" | "safe_default";

export type ResolvedSalesAgentConfiguration = {
  source: ResolvedSalesAgentConfigurationSource;
  scopeKey: SalesAgentConfigurationScope;
  recordId: number | null;
  version: number | null;
  configurationHash: string | null;
  configuration: SalesAgentPromptConfiguration;
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
