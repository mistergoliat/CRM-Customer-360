export {
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1,
  SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V2,
  SALES_AGENT_CONFIGURATION_SUPPORTED_SCHEMA_VERSIONS,
  SALES_AGENT_CONFIGURATION_TABLE,
  SALES_AGENT_CONFIGURATION_STATUSES,
  SALES_AGENT_CONFIGURATION_LOCK_KEY,
  SALES_AGENT_CONFIGURATION_LOCK_TIMEOUT_SECONDS,
  SALES_AGENT_CONFIGURATION_LIMITS,
  SALES_AGENT_CONFIGURATION_HUB_ACTOR,
  SALES_AGENT_MODEL_CONFIGURATION_FIELDS,
  SALES_AGENT_LOOP_CONFIGURATION_FIELDS,
  SALES_AGENT_MODEL_CONFIGURATION_LIMITS,
  SALES_AGENT_LOOP_CONFIGURATION_LIMITS,
  SALES_AGENT_MODEL_CONFIGURATION_GENERIC_FALLBACK_MODEL
} from "./constants";

export {
  SALES_AGENT_PROMPT_CONFIGURATION_FIELDS,
  SalesAgentConfigurationNotFoundError,
  SalesAgentConfigurationNotDraftError,
  SalesAgentConfigurationScopeMismatchError,
  SalesAgentConfigurationInvalidError,
  SalesAgentConfigurationIntegrityError,
  SalesAgentConfigurationLockTimeoutError,
  SalesAgentConfigurationConflictError,
  type SalesAgentConfigurationScope,
  type SalesAgentConfigurationSchemaVersion,
  type SalesAgentConfigurationStatus,
  type SalesAgentPromptConfiguration,
  type SalesAgentModelConfiguration,
  type SalesAgentLoopConfiguration,
  type SalesAgentConfigurationDocument,
  type SalesAgentConfigurationRecord,
  type EffectiveSalesAgentModelConfiguration,
  type ResolvedSalesAgentConfigurationSource,
  type ResolvedSalesAgentConfiguration,
  type SalesAgentConfigurationConnection
} from "./types";

export {
  normalizeConfigurationText,
  isSupportedSalesAgentConfigurationSchemaVersion,
  validateSalesAgentPromptConfiguration,
  validateSalesAgentModelConfiguration,
  validateSalesAgentLoopConfiguration,
  validateSalesAgentConfigurationDocument,
  buildAllowedSalesAgentModelValues,
  isSalesAgentModelAllowed,
  type SalesAgentConfigurationValidationErrorCode,
  type SalesAgentConfigurationValidationFailure,
  type SalesAgentConfigurationValidationResult,
  type SalesAgentConfigurationValidationOptions,
  type SalesAgentModelConfigurationValidationResult,
  type SalesAgentLoopConfigurationValidationResult,
  type SalesAgentConfigurationDocumentValidationResult
} from "./validation";

export { computeSalesAgentConfigurationHash } from "./hash";

export {
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
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
  archiveDraftConfiguration,
  archiveConfigurationRowOnConnection,
  withSalesAgentConfigurationScopeLock,
  runInTransaction,
  deserializeConfigurationRow,
  type CreateDraftConfigurationInput,
  type UpdateDraftConfigurationInput,
  type ListPesasChileConfigurationsInput
} from "./repository";

export { publishDraftConfiguration, type PublishDraftConfigurationInput } from "./publish";

export { resolveSalesAgentConfiguration } from "./resolver";
