import { SALES_AGENT_CONFIGURATION_SCOPE } from "./constants";
import { readDeploymentDefaultSalesAgentConfiguration, SALES_AGENT_CONFIGURATION_SAFE_DEFAULT } from "./defaults";
import { loadPublishedPesasChileConfiguration } from "./repository";
import type { ResolvedSalesAgentConfiguration } from "./types";

/**
 * published (scope=pesas_chile) -> deployment default -> safe default.
 *
 * Only "no published row exists" (loadPublishedPesasChileConfiguration
 * returning null) enables the fallback chain. Any real failure reading the
 * database - connection error, missing table, timeout, invalid SQL -
 * propagates as a thrown error; it is never reinterpreted as "no
 * configuration" and never silently resolved to a default. Not wired into
 * runNativeAutonomousCycle by this task.
 */
export async function resolveSalesAgentConfiguration(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedSalesAgentConfiguration> {
  const published = await loadPublishedPesasChileConfiguration();
  if (published) {
    return {
      source: "published",
      scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
      recordId: published.id,
      version: published.version,
      configurationHash: published.configurationHash,
      configuration: published.configuration
    };
  }

  const deploymentDefault = readDeploymentDefaultSalesAgentConfiguration(env);
  if (deploymentDefault.found) {
    return {
      source: "deployment_default",
      scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
      recordId: null,
      version: null,
      configurationHash: null,
      configuration: deploymentDefault.configuration
    };
  }

  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT
  };
}
