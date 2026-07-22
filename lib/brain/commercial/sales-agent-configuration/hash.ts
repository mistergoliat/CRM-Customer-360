import { createHash } from "node:crypto";
import { SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1, SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V2 } from "./constants";
import { normalizeConfigurationText } from "./validation";
import type { SalesAgentConfigurationDocument, SalesAgentLoopConfiguration, SalesAgentModelConfiguration } from "./types";

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
 * schemaVersion embedded in the payload reflects this document's own shape,
 * not a global "current version" constant: a document with neither
 * modelConfiguration nor loopConfiguration hashes exactly as it would have
 * under the original T02.3A code (v1) - byte-for-byte reproducible for
 * every pre-T02.3B row, never silently changed by a later schema bump. Only
 * a document that actually carries model/loop config hashes as v2.
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
export function computeSalesAgentConfigurationHash(configuration: SalesAgentConfigurationDocument): string {
  const hasRuntimeConfiguration = configuration.modelConfiguration !== undefined || configuration.loopConfiguration !== undefined;

  const canonicalConfiguration = {
    agentName: normalizeConfigurationText(configuration.agentName),
    companyName: normalizeConfigurationText(configuration.companyName),
    role: normalizeConfigurationText(configuration.role),
    companyDescription: normalizeConfigurationText(configuration.companyDescription),
    customInstructions: normalizeConfigurationText(configuration.customInstructions),
    prohibitedPhrases: [...configuration.prohibitedPhrases].map(normalizeConfigurationText).sort(),
    ...(configuration.modelConfiguration ? { modelConfiguration: canonicalModelConfiguration(configuration.modelConfiguration) } : {}),
    ...(configuration.loopConfiguration ? { loopConfiguration: canonicalLoopConfiguration(configuration.loopConfiguration) } : {})
  };

  const payload = canonicalStringify({
    schemaVersion: hasRuntimeConfiguration ? SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V2 : SALES_AGENT_CONFIGURATION_SCHEMA_VERSION_V1,
    configuration: canonicalConfiguration
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}
