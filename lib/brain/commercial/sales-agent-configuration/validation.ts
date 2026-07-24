import {
  SALES_AGENT_CONFIGURATION_LIMITS,
  SALES_AGENT_CONFIGURATION_SUPPORTED_SCHEMA_VERSIONS,
  SALES_AGENT_FOLLOW_UP_ALLOWED_WINDOW_FIELDS,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_FIELDS,
  SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS,
  SALES_AGENT_FOLLOW_UP_TIMEZONE,
  SALES_AGENT_LOOP_CONFIGURATION_FIELDS,
  SALES_AGENT_LOOP_CONFIGURATION_LIMITS,
  SALES_AGENT_MODEL_CONFIGURATION_FIELDS,
  SALES_AGENT_MODEL_CONFIGURATION_GENERIC_FALLBACK_MODEL,
  SALES_AGENT_MODEL_CONFIGURATION_LIMITS
} from "./constants";
import {
  SALES_AGENT_PROMPT_CONFIGURATION_FIELDS,
  type SalesAgentConfigurationDocument,
  type SalesAgentConfigurationSchemaVersion,
  type SalesAgentFollowUpConfiguration,
  type SalesAgentLoopConfiguration,
  type SalesAgentModelConfiguration,
  type SalesAgentPromptConfiguration
} from "./types";

export type SalesAgentConfigurationValidationErrorCode =
  | "invalid_root"
  | "payload_too_large"
  | "unknown_field"
  | "missing_required_field"
  | "invalid_type"
  | "empty_required_field"
  | "field_too_long"
  | "prohibited_phrases_not_array"
  | "too_many_prohibited_phrases"
  | "prohibited_phrase_invalid_type"
  | "prohibited_phrase_empty"
  | "prohibited_phrase_too_long"
  | "out_of_range"
  | "model_not_allowed"
  | "attempt_delays_length_mismatch"
  | "duplicate_weekday";

export type SalesAgentConfigurationValidationFailure = {
  valid: false;
  code: SalesAgentConfigurationValidationErrorCode;
  reason: string;
  field: string | null;
};

export type SalesAgentConfigurationValidationResult =
  | { valid: true; configuration: SalesAgentPromptConfiguration }
  | SalesAgentConfigurationValidationFailure;

export type SalesAgentModelConfigurationValidationResult =
  | { valid: true; configuration: SalesAgentModelConfiguration }
  | SalesAgentConfigurationValidationFailure;

export type SalesAgentLoopConfigurationValidationResult =
  | { valid: true; configuration: SalesAgentLoopConfiguration }
  | SalesAgentConfigurationValidationFailure;

export type SalesAgentFollowUpConfigurationValidationResult =
  | { valid: true; configuration: SalesAgentFollowUpConfiguration }
  | SalesAgentConfigurationValidationFailure;

export type SalesAgentConfigurationDocumentValidationResult =
  | { valid: true; configuration: SalesAgentConfigurationDocument }
  | SalesAgentConfigurationValidationFailure;

const REQUIRED_TEXT_FIELDS = [
  { field: "agentName" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.agentNameMaxLength, allowEmpty: false },
  { field: "companyName" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.companyNameMaxLength, allowEmpty: false },
  { field: "role" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.roleMaxLength, allowEmpty: false },
  { field: "companyDescription" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.companyDescriptionMaxLength, allowEmpty: false },
  { field: "customInstructions" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.customInstructionsMaxLength, allowEmpty: true }
];

function fail(code: SalesAgentConfigurationValidationErrorCode, reason: string, field: string | null = null): SalesAgentConfigurationValidationFailure {
  return { valid: false, code, reason, field };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Trim + collapse every whitespace run (including newlines) to a single
 * space. Applied identically to all string fields and phrases, and reused
 * as-is by hash.ts so the canonical hash always operates on exactly the
 * text this validator already normalized - never a second, divergent
 * normalization pass.
 */
export function normalizeConfigurationText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isSupportedSalesAgentConfigurationSchemaVersion(value: unknown): value is SalesAgentConfigurationSchemaVersion {
  return (SALES_AGENT_CONFIGURATION_SUPPORTED_SCHEMA_VERSIONS as readonly unknown[]).includes(value);
}

function estimatePayloadBytes(raw: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(raw) ?? "", "utf8");
  } catch {
    return null;
  }
}

function validateRequiredTextField(
  raw: unknown,
  field: string,
  maxLength: number,
  allowEmpty: boolean
): { ok: true; value: string } | { ok: false; result: SalesAgentConfigurationValidationFailure } {
  if (typeof raw !== "string") {
    return { ok: false, result: fail("invalid_type", `${field} must be a string`, field) };
  }
  const normalized = normalizeConfigurationText(raw);
  if (!allowEmpty && normalized.length === 0) {
    return { ok: false, result: fail("empty_required_field", `${field} must not be empty`, field) };
  }
  if (normalized.length > maxLength) {
    return { ok: false, result: fail("field_too_long", `${field} exceeds ${maxLength} characters`, field) };
  }
  return { ok: true, value: normalized };
}

/**
 * Format-only validation: rejects extra fields, missing fields, wrong
 * types, out-of-bounds sizes and oversized payloads. Never interprets
 * business meaning or blocks specific words/phrases by semantics - that is
 * explicitly out of scope for this domain (runtime concern, not editable
 * configuration).
 */
export function validateSalesAgentPromptConfiguration(raw: unknown): SalesAgentConfigurationValidationResult {
  const payloadBytes = estimatePayloadBytes(raw);
  if (payloadBytes === null) {
    return fail("invalid_root", "configuration payload could not be serialized");
  }
  if (payloadBytes > SALES_AGENT_CONFIGURATION_LIMITS.maxRawPayloadBytes) {
    return fail("payload_too_large", `configuration payload exceeds ${SALES_AGENT_CONFIGURATION_LIMITS.maxRawPayloadBytes} bytes`);
  }

  if (!isPlainObject(raw)) {
    return fail("invalid_root", "configuration must be a plain object");
  }

  const allowedFields = new Set<string>(SALES_AGENT_PROMPT_CONFIGURATION_FIELDS);
  for (const key of Object.keys(raw)) {
    if (!allowedFields.has(key)) {
      return fail("unknown_field", `unknown field: ${key}`, key);
    }
  }
  for (const field of SALES_AGENT_PROMPT_CONFIGURATION_FIELDS) {
    if (!(field in raw)) {
      return fail("missing_required_field", `missing required field: ${field}`, field);
    }
  }

  const textValues: Record<string, string> = {};
  for (const { field, maxLength, allowEmpty } of REQUIRED_TEXT_FIELDS) {
    const validated = validateRequiredTextField(raw[field], field, maxLength, allowEmpty);
    if (!validated.ok) return validated.result;
    textValues[field] = validated.value;
  }

  const rawPhrases = raw.prohibitedPhrases;
  if (!Array.isArray(rawPhrases)) {
    return fail("prohibited_phrases_not_array", "prohibitedPhrases must be an array", "prohibitedPhrases");
  }
  if (rawPhrases.length > SALES_AGENT_CONFIGURATION_LIMITS.maxProhibitedPhrases) {
    return fail(
      "too_many_prohibited_phrases",
      `prohibitedPhrases exceeds ${SALES_AGENT_CONFIGURATION_LIMITS.maxProhibitedPhrases} items`,
      "prohibitedPhrases"
    );
  }

  const normalizedPhrases: string[] = [];
  for (const phrase of rawPhrases) {
    if (typeof phrase !== "string") {
      return fail("prohibited_phrase_invalid_type", "every prohibited phrase must be a string", "prohibitedPhrases");
    }
    const normalized = normalizeConfigurationText(phrase);
    if (normalized.length === 0) {
      return fail("prohibited_phrase_empty", "prohibited phrases must not be empty", "prohibitedPhrases");
    }
    if (normalized.length > SALES_AGENT_CONFIGURATION_LIMITS.prohibitedPhraseMaxLength) {
      return fail(
        "prohibited_phrase_too_long",
        `prohibited phrase exceeds ${SALES_AGENT_CONFIGURATION_LIMITS.prohibitedPhraseMaxLength} characters`,
        "prohibitedPhrases"
      );
    }
    if (!normalizedPhrases.includes(normalized)) {
      normalizedPhrases.push(normalized);
    }
  }

  return {
    valid: true,
    configuration: {
      agentName: textValues.agentName,
      companyName: textValues.companyName,
      role: textValues.role,
      companyDescription: textValues.companyDescription,
      customInstructions: textValues.customInstructions,
      prohibitedPhrases: normalizedPhrases
    }
  };
}

function validateNumberField(
  raw: unknown,
  field: string,
  options: { min: number; max: number; integer: boolean; enforceRange: boolean }
): { ok: true; value: number } | { ok: false; result: SalesAgentConfigurationValidationFailure } {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, result: fail("invalid_type", `${field} must be a finite number`, field) };
  }
  if (options.integer && !Number.isInteger(raw)) {
    return { ok: false, result: fail("invalid_type", `${field} must be an integer`, field) };
  }
  // Range is only enforced when authoring (create/update a draft). Reading a
  // stored row (and re-validating on publish) never fails just because a
  // platform limit tightened after the row was written - the resolver
  // clamps to the current limits instead, so a stricter limit never turns
  // an already-published/drafted row into one that cannot even load.
  if (options.enforceRange && (raw < options.min || raw > options.max)) {
    return { ok: false, result: fail("out_of_range", `${field} must be between ${options.min} and ${options.max}`, field) };
  }
  return { ok: true, value: raw };
}

export type SalesAgentConfigurationValidationOptions = {
  /**
   * Default true. Set false for read paths (deserializing a stored row,
   * re-validating on publish) - see validateNumberField above. Also gates
   * the model allowlist below, for the identical reason: a model that
   * matched BRAIN_MODEL_NAME (or the generic fallback) when a row was
   * written can stop matching if the deployment's BRAIN_MODEL_NAME changes
   * afterward - reading/publishing that row must not start failing just
   * because deployment config moved on; the resolver is what re-checks the
   * allowlist at use time (resolver.ts) and falls through if it no longer
   * matches.
   */
  enforceRange?: boolean;
  env?: NodeJS.ProcessEnv;
};

/**
 * The only two model values this deployment actually knows about: whatever
 * it configured via BRAIN_MODEL_NAME, and the generic fallback every
 * unconfigured deployment already resolves to. Never an invented catalog of
 * "supported models" - this system is provider-agnostic (any OpenAI-
 * compatible endpoint), so the one real source of truth for "is this model
 * legitimate" is the deployment's own configuration, not a guessed list.
 */
export function buildAllowedSalesAgentModelValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const candidates = [env.BRAIN_MODEL_NAME?.trim(), SALES_AGENT_MODEL_CONFIGURATION_GENERIC_FALLBACK_MODEL];
  return [...new Set(candidates.filter((value): value is string => Boolean(value)))];
}

export function isSalesAgentModelAllowed(model: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return buildAllowedSalesAgentModelValues(env).includes(model);
}

/**
 * ACS-R1-05.1-T02.3B. Format-only, same conventions as the prompt
 * validator above: exact field allowlist, explicit numeric bounds
 * (SALES_AGENT_MODEL_CONFIGURATION_LIMITS), never a business-meaning
 * judgment about which model/temperature is "good".
 */
export function validateSalesAgentModelConfiguration(
  raw: unknown,
  options: SalesAgentConfigurationValidationOptions = {}
): SalesAgentModelConfigurationValidationResult {
  const enforceRange = options.enforceRange ?? true;
  const env = options.env ?? process.env;
  if (!isPlainObject(raw)) {
    return fail("invalid_root", "modelConfiguration must be a plain object");
  }

  const allowedFields = new Set<string>(SALES_AGENT_MODEL_CONFIGURATION_FIELDS);
  for (const key of Object.keys(raw)) {
    if (!allowedFields.has(key)) return fail("unknown_field", `unknown field: ${key}`, key);
  }
  for (const field of SALES_AGENT_MODEL_CONFIGURATION_FIELDS) {
    if (!(field in raw)) return fail("missing_required_field", `missing required field: ${field}`, field);
  }

  const model = validateRequiredTextField(raw.model, "model", SALES_AGENT_MODEL_CONFIGURATION_LIMITS.modelMaxLength, false);
  if (!model.ok) return model.result;
  if (enforceRange && !isSalesAgentModelAllowed(model.value, env)) {
    return fail("model_not_allowed", `model must be one of: ${buildAllowedSalesAgentModelValues(env).join(", ")}`, "model");
  }

  const temperature = validateNumberField(raw.temperature, "temperature", {
    min: SALES_AGENT_MODEL_CONFIGURATION_LIMITS.temperatureMin,
    max: SALES_AGENT_MODEL_CONFIGURATION_LIMITS.temperatureMax,
    integer: false,
    enforceRange
  });
  if (!temperature.ok) return temperature.result;

  const maxOutputTokens = validateNumberField(raw.maxOutputTokens, "maxOutputTokens", {
    min: SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxOutputTokensMin,
    max: SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxOutputTokensMax,
    integer: true,
    enforceRange
  });
  if (!maxOutputTokens.ok) return maxOutputTokens.result;

  const timeoutMs = validateNumberField(raw.timeoutMs, "timeoutMs", {
    min: SALES_AGENT_MODEL_CONFIGURATION_LIMITS.timeoutMsMin,
    max: SALES_AGENT_MODEL_CONFIGURATION_LIMITS.timeoutMsMax,
    integer: true,
    enforceRange
  });
  if (!timeoutMs.ok) return timeoutMs.result;

  const maxModelRetries = validateNumberField(raw.maxModelRetries, "maxModelRetries", {
    min: SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxModelRetriesMin,
    max: SALES_AGENT_MODEL_CONFIGURATION_LIMITS.maxModelRetriesMax,
    integer: true,
    enforceRange
  });
  if (!maxModelRetries.ok) return maxModelRetries.result;

  return {
    valid: true,
    configuration: {
      model: model.value,
      temperature: temperature.value,
      maxOutputTokens: maxOutputTokens.value,
      timeoutMs: timeoutMs.value,
      maxModelRetries: maxModelRetries.value
    }
  };
}

export function validateSalesAgentLoopConfiguration(
  raw: unknown,
  options: SalesAgentConfigurationValidationOptions = {}
): SalesAgentLoopConfigurationValidationResult {
  const enforceRange = options.enforceRange ?? true;
  if (!isPlainObject(raw)) {
    return fail("invalid_root", "loopConfiguration must be a plain object");
  }

  const allowedFields = new Set<string>(SALES_AGENT_LOOP_CONFIGURATION_FIELDS);
  for (const key of Object.keys(raw)) {
    if (!allowedFields.has(key)) return fail("unknown_field", `unknown field: ${key}`, key);
  }
  for (const field of SALES_AGENT_LOOP_CONFIGURATION_FIELDS) {
    if (!(field in raw)) return fail("missing_required_field", `missing required field: ${field}`, field);
  }

  const maxAgentStepsPerTurn = validateNumberField(raw.maxAgentStepsPerTurn, "maxAgentStepsPerTurn", {
    min: SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxAgentStepsPerTurnMin,
    max: SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxAgentStepsPerTurnMax,
    integer: true,
    enforceRange
  });
  if (!maxAgentStepsPerTurn.ok) return maxAgentStepsPerTurn.result;

  const maxToolCallsPerTurn = validateNumberField(raw.maxToolCallsPerTurn, "maxToolCallsPerTurn", {
    min: SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxToolCallsPerTurnMin,
    max: SALES_AGENT_LOOP_CONFIGURATION_LIMITS.maxToolCallsPerTurnMax,
    integer: true,
    enforceRange
  });
  if (!maxToolCallsPerTurn.ok) return maxToolCallsPerTurn.result;

  return {
    valid: true,
    configuration: {
      maxAgentStepsPerTurn: maxAgentStepsPerTurn.value,
      maxToolCallsPerTurn: maxToolCallsPerTurn.value
    }
  };
}

/**
 * ACS-R1-05.1-T02.3D. Format-only, same conventions as model/loop above.
 * Structural invariants (attemptDelaysMinutes.length === maxAttempts,
 * allowedWeekdays non-empty/no duplicates, endHour > startHour, timezone
 * fixed) are always enforced regardless of `enforceRange` - unlike numeric
 * ceilings, these are never "a platform policy that might tighten later",
 * they are shape/consistency requirements the document can never be valid
 * without.
 */
export function validateSalesAgentFollowUpConfiguration(
  raw: unknown,
  options: SalesAgentConfigurationValidationOptions = {}
): SalesAgentFollowUpConfigurationValidationResult {
  const enforceRange = options.enforceRange ?? true;
  if (!isPlainObject(raw)) {
    return fail("invalid_root", "followUpConfiguration must be a plain object");
  }

  const allowedFields = new Set<string>(SALES_AGENT_FOLLOW_UP_CONFIGURATION_FIELDS);
  for (const key of Object.keys(raw)) {
    if (!allowedFields.has(key)) return fail("unknown_field", `unknown field: ${key}`, key);
  }
  for (const field of SALES_AGENT_FOLLOW_UP_CONFIGURATION_FIELDS) {
    if (!(field in raw)) return fail("missing_required_field", `missing required field: ${field}`, field);
  }

  if (typeof raw.enabled !== "boolean") {
    return fail("invalid_type", "enabled must be a boolean", "enabled");
  }

  const maxAttempts = validateNumberField(raw.maxAttempts, "maxAttempts", {
    min: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxAttemptsMin,
    max: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxAttemptsMax,
    integer: true,
    enforceRange
  });
  if (!maxAttempts.ok) return maxAttempts.result;

  if (!Array.isArray(raw.attemptDelaysMinutes)) {
    return fail("invalid_type", "attemptDelaysMinutes must be an array", "attemptDelaysMinutes");
  }
  if (raw.attemptDelaysMinutes.length !== maxAttempts.value) {
    return fail(
      "attempt_delays_length_mismatch",
      `attemptDelaysMinutes must have exactly ${maxAttempts.value} entries (one per attempt)`,
      "attemptDelaysMinutes"
    );
  }

  const attemptDelaysMinutes: number[] = [];
  for (let index = 0; index < raw.attemptDelaysMinutes.length; index += 1) {
    const delay = validateNumberField(raw.attemptDelaysMinutes[index], `attemptDelaysMinutes[${index}]`, {
      min: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.attemptDelayMinutesMin,
      max: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.attemptDelayMinutesMax,
      integer: true,
      enforceRange
    });
    if (!delay.ok) return delay.result;
    attemptDelaysMinutes.push(delay.value);
  }

  if (!isPlainObject(raw.allowedWindow)) {
    return fail("invalid_root", "allowedWindow must be a plain object", "allowedWindow");
  }
  const windowAllowedFields = new Set<string>(SALES_AGENT_FOLLOW_UP_ALLOWED_WINDOW_FIELDS);
  for (const key of Object.keys(raw.allowedWindow)) {
    if (!windowAllowedFields.has(key)) return fail("unknown_field", `unknown field: ${key}`, `allowedWindow.${key}`);
  }
  for (const field of SALES_AGENT_FOLLOW_UP_ALLOWED_WINDOW_FIELDS) {
    if (!(field in raw.allowedWindow)) return fail("missing_required_field", `missing required field: ${field}`, `allowedWindow.${field}`);
  }

  if (raw.allowedWindow.timezone !== SALES_AGENT_FOLLOW_UP_TIMEZONE) {
    return fail("invalid_type", `allowedWindow.timezone must be ${SALES_AGENT_FOLLOW_UP_TIMEZONE}`, "allowedWindow.timezone");
  }

  // Hour bounds are a real structural constraint (an hour cannot be outside
  // 0-23), never a "platform ceiling that might loosen/tighten later" -
  // always enforced regardless of the enforceRange option.
  const startHour = validateNumberField(raw.allowedWindow.startHour, "allowedWindow.startHour", {
    min: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMin,
    max: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMax,
    integer: true,
    enforceRange: true
  });
  if (!startHour.ok) return startHour.result;

  const endHour = validateNumberField(raw.allowedWindow.endHour, "allowedWindow.endHour", {
    min: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMin,
    max: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.windowHourMax,
    integer: true,
    enforceRange: true
  });
  if (!endHour.ok) return endHour.result;

  if (endHour.value <= startHour.value) {
    return fail("out_of_range", "allowedWindow.endHour must be greater than allowedWindow.startHour", "allowedWindow.endHour");
  }

  if (!Array.isArray(raw.allowedWindow.allowedWeekdays)) {
    return fail("invalid_type", "allowedWindow.allowedWeekdays must be an array", "allowedWindow.allowedWeekdays");
  }
  if (raw.allowedWindow.allowedWeekdays.length === 0) {
    return fail("empty_required_field", "allowedWindow.allowedWeekdays must not be empty", "allowedWindow.allowedWeekdays");
  }

  const allowedWeekdays: number[] = [];
  const seenWeekdays = new Set<number>();
  for (const value of raw.allowedWindow.allowedWeekdays) {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.weekdayMin ||
      value > SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.weekdayMax
    ) {
      return fail("out_of_range", "allowedWindow.allowedWeekdays entries must be integers between 0 and 6", "allowedWindow.allowedWeekdays");
    }
    if (seenWeekdays.has(value)) {
      return fail("duplicate_weekday", "allowedWindow.allowedWeekdays must not contain duplicates", "allowedWindow.allowedWeekdays");
    }
    seenWeekdays.add(value);
    allowedWeekdays.push(value);
  }

  const maxOpportunityAgeDays = validateNumberField(raw.maxOpportunityAgeDays, "maxOpportunityAgeDays", {
    min: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxOpportunityAgeDaysMin,
    max: SALES_AGENT_FOLLOW_UP_CONFIGURATION_LIMITS.maxOpportunityAgeDaysMax,
    integer: true,
    enforceRange
  });
  if (!maxOpportunityAgeDays.ok) return maxOpportunityAgeDays.result;

  return {
    valid: true,
    configuration: {
      enabled: raw.enabled,
      maxAttempts: maxAttempts.value,
      attemptDelaysMinutes,
      allowedWindow: {
        timezone: SALES_AGENT_FOLLOW_UP_TIMEZONE,
        startHour: startHour.value,
        endHour: endHour.value,
        allowedWeekdays
      },
      maxOpportunityAgeDays: maxOpportunityAgeDays.value
    }
  };
}

/**
 * Validates the full stored document: the six v1 prompt fields (always,
 * reusing validateSalesAgentPromptConfiguration unchanged - never
 * duplicated) plus the two optional v2 runtime sections, if present. A v1
 * document (no modelConfiguration/loopConfiguration keys at all) validates
 * identically to before this task - this is what keeps every existing row
 * resolving without a migration.
 */
export function validateSalesAgentConfigurationDocument(
  raw: unknown,
  options: SalesAgentConfigurationValidationOptions = {}
): SalesAgentConfigurationDocumentValidationResult {
  if (!isPlainObject(raw)) {
    return fail("invalid_root", "configuration must be a plain object");
  }

  const { modelConfiguration, loopConfiguration, followUpConfiguration, ...promptFields } = raw;

  const promptValidation = validateSalesAgentPromptConfiguration(promptFields);
  if (!promptValidation.valid) return promptValidation;

  let resolvedModelConfiguration: SalesAgentModelConfiguration | undefined;
  if (modelConfiguration !== undefined) {
    const modelValidation = validateSalesAgentModelConfiguration(modelConfiguration, options);
    if (!modelValidation.valid) return modelValidation;
    resolvedModelConfiguration = modelValidation.configuration;
  }

  let resolvedLoopConfiguration: SalesAgentLoopConfiguration | undefined;
  if (loopConfiguration !== undefined) {
    const loopValidation = validateSalesAgentLoopConfiguration(loopConfiguration, options);
    if (!loopValidation.valid) return loopValidation;
    resolvedLoopConfiguration = loopValidation.configuration;
  }

  let resolvedFollowUpConfiguration: SalesAgentFollowUpConfiguration | undefined;
  if (followUpConfiguration !== undefined) {
    const followUpValidation = validateSalesAgentFollowUpConfiguration(followUpConfiguration, options);
    if (!followUpValidation.valid) return followUpValidation;
    resolvedFollowUpConfiguration = followUpValidation.configuration;
  }

  return {
    valid: true,
    configuration: {
      ...promptValidation.configuration,
      ...(resolvedModelConfiguration ? { modelConfiguration: resolvedModelConfiguration } : {}),
      ...(resolvedLoopConfiguration ? { loopConfiguration: resolvedLoopConfiguration } : {}),
      ...(resolvedFollowUpConfiguration ? { followUpConfiguration: resolvedFollowUpConfiguration } : {})
    }
  };
}
