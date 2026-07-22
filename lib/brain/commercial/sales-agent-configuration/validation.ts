import { SALES_AGENT_CONFIGURATION_LIMITS, SALES_AGENT_CONFIGURATION_SCHEMA_VERSION } from "./constants";
import { SALES_AGENT_PROMPT_CONFIGURATION_FIELDS, type SalesAgentPromptConfiguration } from "./types";

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
  | "prohibited_phrase_too_long";

export type SalesAgentConfigurationValidationResult =
  | { valid: true; configuration: SalesAgentPromptConfiguration }
  | { valid: false; code: SalesAgentConfigurationValidationErrorCode; reason: string; field: string | null };

const REQUIRED_TEXT_FIELDS = [
  { field: "agentName" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.agentNameMaxLength, allowEmpty: false },
  { field: "companyName" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.companyNameMaxLength, allowEmpty: false },
  { field: "role" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.roleMaxLength, allowEmpty: false },
  { field: "companyDescription" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.companyDescriptionMaxLength, allowEmpty: false },
  { field: "customInstructions" as const, maxLength: SALES_AGENT_CONFIGURATION_LIMITS.customInstructionsMaxLength, allowEmpty: true }
];

function fail(code: SalesAgentConfigurationValidationErrorCode, reason: string, field: string | null = null): SalesAgentConfigurationValidationResult {
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

export function isSupportedSalesAgentConfigurationSchemaVersion(value: unknown): value is typeof SALES_AGENT_CONFIGURATION_SCHEMA_VERSION {
  return value === SALES_AGENT_CONFIGURATION_SCHEMA_VERSION;
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
): { ok: true; value: string } | { ok: false; result: SalesAgentConfigurationValidationResult } {
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
