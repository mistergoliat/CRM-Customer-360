import type { SalesAgentInput, SalesAgentRequestedMode, SalesAgentToolName } from "../salesAgentTypes";
import type { SalesAgentOutputValidationResult } from "./validationTypes";
import { SALES_AGENT_OUTPUT_CONTRACT_VERSION } from "./validationTypes";

export const SALES_AGENT_RUNTIME_STATUSES = [
  "completed_valid",
  "completed_failed_safe",
  "provider_unavailable",
  "provider_error",
  "timeout",
  "validation_failed_safe",
  "cancelled",
  "invalid_input",
  "disabled"
] as const;
export type SalesAgentRuntimeStatus = (typeof SALES_AGENT_RUNTIME_STATUSES)[number];

export const SALES_AGENT_RUNTIME_MODES = ["dry_run", "fixture", "shadow"] as const;
export type SalesAgentRuntimeMode = (typeof SALES_AGENT_RUNTIME_MODES)[number];

export const SALES_AGENT_RUNTIME_ERROR_CODES = [
  "invalid_input",
  "disabled",
  "provider_unavailable",
  "authentication_error",
  "rate_limit",
  "timeout",
  "invalid_response",
  "network_error",
  "provider_error",
  "cancelled",
  "contract_version_mismatch",
  "prompt_build_failed",
  "validation_failed_safe",
  "input_too_large",
  "output_too_large",
  "unknown_error"
] as const;
export type SalesAgentRuntimeErrorCode = (typeof SALES_AGENT_RUNTIME_ERROR_CODES)[number];

export const SALES_AGENT_RUNTIME_WARNINGS = [
  "runtime_disabled",
  "provider_not_called",
  "provider_unavailable",
  "provider_error",
  "provider_timeout",
  "provider_cancelled",
  "provider_invalid_response",
  "validation_failed_safe",
  "invalid_input",
  "contract_version_mismatch",
  "prompt_build_failed",
  "input_too_large",
  "output_too_large",
  "raw_output_captured",
  "raw_output_sanitized",
  "prompt_preview_included",
  "metadata_sanitized",
  "unknown_error"
] as const;
export type SalesAgentRuntimeWarning = (typeof SALES_AGENT_RUNTIME_WARNINGS)[number];

export const SALES_AGENT_RUNTIME_DEFAULT_TIMEOUT_MS = 15000;
export const SALES_AGENT_RUNTIME_MAX_INPUT_CHARACTERS = 20000;
export const SALES_AGENT_RUNTIME_MAX_OUTPUT_CHARACTERS = 12000;
export const SALES_AGENT_RUNTIME_DEFAULT_MODE = "dry_run" as const;
export const SALES_AGENT_RUNTIME_DEFAULT_ENABLED = false;
export const SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN = true;

export const SALES_AGENT_PROMPT_VERSION = "sales-agent-runtime-v0.1.0" as const;
export type SalesAgentPromptVersion = typeof SALES_AGENT_PROMPT_VERSION;

export const SALES_AGENT_RUNTIME_VERSION = "sales-agent-runtime-dry-run-v0.1.0" as const;
export const SALES_AGENT_CONTRACT_VERSION = SALES_AGENT_OUTPUT_CONTRACT_VERSION;

export const BRAIN_SALES_AGENT_ENABLED = "BRAIN_SALES_AGENT_ENABLED" as const;
export const BRAIN_SALES_AGENT_DRY_RUN = "BRAIN_SALES_AGENT_DRY_RUN" as const;

export const SALES_AGENT_RUNTIME_VALIDATION_STATUSES = [
  "skipped",
  "valid",
  "invalid",
  "failed_safe"
] as const;
export type SalesAgentRuntimeValidationStatus = (typeof SALES_AGENT_RUNTIME_VALIDATION_STATUSES)[number];

export type SalesAgentRuntimeJsonValue =
  | string
  | number
  | boolean
  | null
  | SalesAgentRuntimeJsonValue[]
  | { [key: string]: SalesAgentRuntimeJsonValue };

export type SalesAgentRuntimeJsonRecord = Record<string, SalesAgentRuntimeJsonValue>;

export type SalesAgentRuntimeClock = {
  now(): number;
  toISOString(value: number | Date): string;
};

export type SalesAgentPromptMessageRole = "system" | "user";

export type SalesAgentPromptMessage = {
  role: SalesAgentPromptMessageRole;
  content: string;
};

export type SalesAgentPromptPackage = {
  promptVersion: SalesAgentPromptVersion;
  contractVersion: string;
  runtimeMode: SalesAgentRuntimeMode;
  requestedMode: SalesAgentRequestedMode;
  systemInstructions: string[];
  contractInstructions: string[];
  commercialContext: SalesAgentRuntimeJsonRecord;
  responseSchemaSummary: string[];
  safetyConstraints: string[];
  messages: SalesAgentPromptMessage[];
  promptText: string;
};

export type SalesAgentPromptBuilderInput = {
  salesAgentInput: SalesAgentInput;
  contractVersion: string;
  promptVersion: SalesAgentPromptVersion;
  runtimeMode: SalesAgentRuntimeMode;
  currentTime: string | Date;
  allowedCapabilities: readonly SalesAgentToolName[];
};

export type SalesAgentProviderRequest = {
  promptPackage: SalesAgentPromptPackage;
  salesAgentInput: SalesAgentInput;
  contractVersion: string;
  promptVersion: SalesAgentPromptVersion;
  runtimeMode: SalesAgentRuntimeMode;
  requestedMode: SalesAgentRequestedMode;
  allowedCapabilities: readonly SalesAgentToolName[];
  correlationId?: string | null;
  metadata: Record<string, unknown>;
};

export type SalesAgentProviderInvokeOptions = {
  signal?: AbortSignal | null;
  timeoutMs: number;
  currentTime: string;
  dryRun: boolean;
  strictValidation: boolean;
  metadata: Record<string, unknown>;
};

export type SalesAgentProviderResponse = {
  rawOutput: unknown;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCost?: number | null;
  providerRequestId?: string | null;
  finishReason?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SalesAgentProvider = {
  name: string;
  version?: string | null;
  invoke(request: SalesAgentProviderRequest, options: SalesAgentProviderInvokeOptions): Promise<SalesAgentProviderResponse>;
};

export type SalesAgentRuntimeMetrics = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  providerDurationMs?: number;
  validationDurationMs: number;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  estimatedCost?: number | null;
  inputCharacters: number;
  outputCharacters?: number;
  timedOut: boolean;
  retryCount: number;
  providerRequestId?: string | null;
};

export type SalesAgentRuntimeValidationSkipped = {
  status: "skipped";
  result: null;
  warnings: string[];
  issues: [];
  metadata: null;
};

export type SalesAgentRuntimeValidation = SalesAgentOutputValidationResult | SalesAgentRuntimeValidationSkipped;

export type SalesAgentRuntimeProviderSummary = {
  name: string;
  version: string | null;
  model: string | null;
  requestId: string | null;
  finishReason: string | null;
};

export type SalesAgentRuntimeVersions = {
  runtimeVersion: typeof SALES_AGENT_RUNTIME_VERSION;
  contractVersion: string;
  promptVersion: SalesAgentPromptVersion;
};

export type SalesAgentRuntimeMetadata = {
  runtimeVersion: typeof SALES_AGENT_RUNTIME_VERSION;
  contractVersion: string;
  promptVersion: SalesAgentPromptVersion;
  runtimeMode: SalesAgentRuntimeMode;
  dryRun: boolean;
  enabled: boolean;
  strictValidation: boolean;
  promptPreviewIncluded: boolean;
  rawOutputCaptured: boolean;
  rawOutputTrusted: false;
  providerName: string;
  providerVersion: string | null;
  providerRequestId: string | null;
  validationStatus: SalesAgentRuntimeValidationStatus;
  safeMetadata: SalesAgentRuntimeJsonRecord;
  promptPreview?: string | null;
};

export type SalesAgentRuntimeError = {
  code: SalesAgentRuntimeErrorCode;
  message: string;
  providerName?: string | null;
  providerVersion?: string | null;
  details?: Record<string, SalesAgentRuntimeJsonValue>;
};

export type SalesAgentRuntimeInput = {
  salesAgentInput: SalesAgentInput;
  provider: SalesAgentProvider | null;
  options: SalesAgentRuntimeOptions;
  expectedRunId?: string;
  contractVersion?: string;
  promptVersion?: SalesAgentPromptVersion;
  currentTime: string | Date;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
  clock?: SalesAgentRuntimeClock;
};

export type SalesAgentRuntimeOptions = {
  enabled?: boolean;
  mode?: SalesAgentRuntimeMode;
  timeoutMs?: number;
  maxInputCharacters?: number;
  maxOutputCharacters?: number;
  strictValidation?: boolean;
  allowedCapabilities?: readonly SalesAgentToolName[];
  captureRawOutput?: boolean;
  includePromptPreview?: boolean;
  dryRun?: boolean;
  abortSignal?: AbortSignal | null;
};

export type SalesAgentRuntimeResult = {
  status: SalesAgentRuntimeStatus;
  mode: SalesAgentRuntimeMode;
  dryRun: boolean;
  result: import("./validationTypes").SalesAgentResult;
  validation: SalesAgentRuntimeValidation;
  metrics: SalesAgentRuntimeMetrics;
  warnings: string[];
  error?: SalesAgentRuntimeError | null;
  provider: SalesAgentRuntimeProviderSummary;
  versions: SalesAgentRuntimeVersions;
  correlationId?: string | null;
  metadata: SalesAgentRuntimeMetadata;
  rawOutputPreview?: SalesAgentRuntimeJsonValue | null;
};
