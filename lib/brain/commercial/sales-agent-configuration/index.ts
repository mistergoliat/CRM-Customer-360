export {
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION,
  SALES_AGENT_CONFIGURATION_TABLE,
  SALES_AGENT_CONFIGURATION_STATUSES,
  SALES_AGENT_CONFIGURATION_LOCK_KEY,
  SALES_AGENT_CONFIGURATION_LOCK_TIMEOUT_SECONDS,
  SALES_AGENT_CONFIGURATION_LIMITS
} from "./constants";

export {
  SALES_AGENT_PROMPT_CONFIGURATION_FIELDS,
  SalesAgentConfigurationNotFoundError,
  SalesAgentConfigurationNotDraftError,
  SalesAgentConfigurationScopeMismatchError,
  SalesAgentConfigurationInvalidError,
  SalesAgentConfigurationIntegrityError,
  SalesAgentConfigurationLockTimeoutError,
  type SalesAgentConfigurationScope,
  type SalesAgentConfigurationSchemaVersion,
  type SalesAgentConfigurationStatus,
  type SalesAgentPromptConfiguration,
  type SalesAgentConfigurationRecord,
  type ResolvedSalesAgentConfigurationSource,
  type ResolvedSalesAgentConfiguration,
  type SalesAgentConfigurationConnection
} from "./types";

export {
  normalizeConfigurationText,
  isSupportedSalesAgentConfigurationSchemaVersion,
  validateSalesAgentPromptConfiguration,
  type SalesAgentConfigurationValidationErrorCode,
  type SalesAgentConfigurationValidationResult
} from "./validation";

export { computeSalesAgentConfigurationHash } from "./hash";

export {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  readDeploymentDefaultSalesAgentConfiguration,
  type DeploymentDefaultLookup
} from "./defaults";

export {
  createDraftConfiguration,
  updateDraftConfiguration,
  loadConfigurationById,
  loadConfigurationByIdOnConnection,
  loadPublishedPesasChileConfiguration,
  listPesasChileConfigurations,
  loadLatestVersionForScope,
  assertConfigurationIsDraft,
  archiveConfiguration,
  archiveConfigurationRowOnConnection,
  withSalesAgentConfigurationScopeLock,
  deserializeConfigurationRow,
  type CreateDraftConfigurationInput,
  type UpdateDraftConfigurationInput,
  type ListPesasChileConfigurationsInput
} from "./repository";

export { publishDraftConfiguration, type PublishDraftConfigurationInput } from "./publish";

export { resolveSalesAgentConfiguration } from "./resolver";
