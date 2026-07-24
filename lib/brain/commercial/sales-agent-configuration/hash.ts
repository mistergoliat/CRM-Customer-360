import { createHash } from "node:crypto";
import { normalizeConfigurationText } from "./validation";
import type {
  SalesAgentConfigurationDocument,
  SalesAgentConfigurationSchemaVersion,
  SalesAgentFollowUpConfiguration,
  SalesAgentLoopConfiguration,
  SalesAgentModelConfiguration
} from "./types";

function canonicalModelConfiguration(configuration: SalesAgentModelConfiguration) {
  return {
    model: normalizeConfigurationText(configuration.model),
    temperature: configuration.temperature,
    maxOutputTokens: configuration.maxOutputTokens,
    timeoutMs: configuration.timeoutMs,
    maxModelRetries: configuration.maxModelRetries
  };
}

function canonicalLoopConfiguration(configuration: SalesAgentLoopConfiguration) {
  return {
    maxAgentStepsPerTurn: configuration.maxAgentStepsPerTurn,
    maxToolCallsPerTurn: configuration.maxToolCallsPerTurn
  };
}

/**
 * attemptDelaysMinutes order is meaningful (index N is attempt N+1's delay)
 * - never sorted, unlike prohibitedPhrases. allowedWeekdays is a SET of
 * allowed days with no meaningful order, so it is sorted for the same
 * reason prohibitedPhrases is: two configurations differing only in the
 * insertion order of the same weekdays must hash identically.
 */
function canonicalFollowUpConfiguration(configuration: SalesAgentFollowUpConfiguration) {
  return {
    enabled: configuration.enabled,
    maxAttempts: configuration.maxAttempts,
    attemptDelaysMinutes: [...configuration.attemptDelaysMinutes],
    allowedWindow: {
      timezone: configuration.allowedWindow.timezone,
      startHour: configuration.allowedWindow.startHour,
      endHour: configuration.allowedWindow.endHour,
      allowedWeekdays: [...configuration.allowedWindow.allowedWeekdays].sort((a, b) => a - b)
    },
    maxOpportunityAgeDays: configuration.maxOpportunityAgeDays
  };
}

/**
 * Deterministic JSON stringify with recursively sorted object keys. Arrays
 * keep their given order (prohibitedPhrases is pre-sorted by the caller
 * below before this ever sees it).
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(",")}}`;
}

/**
 * Canonical form hashed: schemaVersion + the configuration fields actually
 * present, nothing else (id/scope/version/status/timestamps/createdBy/
 * parentId are always excluded - they are record metadata, not
 * configuration content).
 *
 * schemaVersion is always the caller's explicit, real value - the actual
 * schema_version already stamped (or about to be stamped) on the record -
 * never inferred from whether modelConfiguration/loopConfiguration happen
 * to be present. Shape and schema_version can legitimately diverge (a v2
 * document with neither runtime section is still a real v2 row, since
 * every new write is stamped the current version regardless of content),
 * so inferring one from the other silently mismatches the hash against
 * what is actually stored. Callers: createDraftConfiguration/
 * updateDraftConfiguration pass the current SALES_AGENT_CONFIGURATION_SCHEMA_VERSION
 * (what they are about to stamp); publishDraftConfiguration passes the
 * draft's own already-stored schemaVersion (never assumed to be current).
 *
 * Decision on prohibitedPhrases order: sorted alphabetically before
 * hashing. A prohibited-phrase set has no meaningful order - two drafts
 * that differ only in the insertion order of the same phrases must hash
 * identically, never be treated as "different content".
 *
 * Strings are re-normalized here (not just trusted from the caller) so this
 * function stays correct even if ever called with a not-yet-normalized
 * object - defense in depth, not a second divergent normalization rule.
 */
export function computeSalesAgentConfigurationHash(
  configuration: SalesAgentConfigurationDocument,
  schemaVersion: SalesAgentConfigurationSchemaVersion
): string {
  const canonicalConfiguration = {
    agentName: normalizeConfigurationText(configuration.agentName),
    companyName: normalizeConfigurationText(configuration.companyName),
    role: normalizeConfigurationText(configuration.role),
    companyDescription: normalizeConfigurationText(configuration.companyDescription),
    customInstructions: normalizeConfigurationText(configuration.customInstructions),
    prohibitedPhrases: [...configuration.prohibitedPhrases].map(normalizeConfigurationText).sort(),
    ...(configuration.modelConfiguration ? { modelConfiguration: canonicalModelConfiguration(configuration.modelConfiguration) } : {}),
    ...(configuration.loopConfiguration ? { loopConfiguration: canonicalLoopConfiguration(configuration.loopConfiguration) } : {}),
    ...(configuration.followUpConfiguration ? { followUpConfiguration: canonicalFollowUpConfiguration(configuration.followUpConfiguration) } : {})
  };

  const payload = canonicalStringify({
    schemaVersion,
    configuration: canonicalConfiguration
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}
