import { createHash } from "node:crypto";
import { SALES_AGENT_CONFIGURATION_SCHEMA_VERSION } from "./constants";
import { normalizeConfigurationText } from "./validation";
import type { SalesAgentPromptConfiguration } from "./types";

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
 * Canonical form hashed: schemaVersion + the six configuration fields,
 * nothing else (id/scope/version/status/timestamps/createdBy/parentId are
 * always excluded - they are record metadata, not configuration content).
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
export function computeSalesAgentConfigurationHash(configuration: SalesAgentPromptConfiguration): string {
  const canonicalConfiguration = {
    agentName: normalizeConfigurationText(configuration.agentName),
    companyName: normalizeConfigurationText(configuration.companyName),
    role: normalizeConfigurationText(configuration.role),
    companyDescription: normalizeConfigurationText(configuration.companyDescription),
    customInstructions: normalizeConfigurationText(configuration.customInstructions),
    prohibitedPhrases: [...configuration.prohibitedPhrases].map(normalizeConfigurationText).sort()
  };

  const payload = canonicalStringify({
    schemaVersion: SALES_AGENT_CONFIGURATION_SCHEMA_VERSION,
    configuration: canonicalConfiguration
  });

  return createHash("sha256").update(payload, "utf8").digest("hex");
}
