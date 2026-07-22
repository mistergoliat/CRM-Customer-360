import { SALES_AGENT_CONFIGURATION_SCOPE, SALES_AGENT_LOOP_CONFIGURATION_LIMITS, SALES_AGENT_MODEL_CONFIGURATION_LIMITS } from "./constants";
import {
  readDeploymentDefaultSalesAgentConfiguration,
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT
} from "./defaults";
import { loadPublishedPesasChileConfiguration } from "./repository";
import type { ResolvedSalesAgentConfiguration, SalesAgentLoopConfiguration, SalesAgentModelConfiguration } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Platform ceilings/floors always win, even over a persisted, previously-
 * valid value - a value that satisfied the limits at write time can still
 * exceed a limit tightened afterward, and this is the one place that must
 * never let that through uncapped.
 */
function resolveEffectiveModelConfiguration(candidate: SalesAgentModelConfiguration | undefined): SalesAgentModelConfiguration {
  const base = candidate ?? SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT;
  const limits = SALES_AGENT_MODEL_CONFIGURATION_LIMITS;
  return {
    model: base.model,
    temperature: clamp(base.temperature, limits.temperatureMin, limits.temperatureMax),
    maxOutputTokens: clamp(Math.round(base.maxOutputTokens), limits.maxOutputTokensMin, limits.maxOutputTokensMax),
    timeoutMs: clamp(Math.round(base.timeoutMs), limits.timeoutMsMin, limits.timeoutMsMax),
    maxModelRetries: clamp(Math.round(base.maxModelRetries), limits.maxModelRetriesMin, limits.maxModelRetriesMax)
  };
}

function resolveEffectiveLoopConfiguration(candidate: SalesAgentLoopConfiguration | undefined): SalesAgentLoopConfiguration {
  const base = candidate ?? SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT;
  const limits = SALES_AGENT_LOOP_CONFIGURATION_LIMITS;
  return {
    maxAgentStepsPerTurn: clamp(Math.round(base.maxAgentStepsPerTurn), limits.maxAgentStepsPerTurnMin, limits.maxAgentStepsPerTurnMax),
    maxToolCallsPerTurn: clamp(Math.round(base.maxToolCallsPerTurn), limits.maxToolCallsPerTurnMin, limits.maxToolCallsPerTurnMax)
  };
}

/**
 * published (scope=pesas_chile) -> deployment default -> safe default, for
 * the prompt identity. Model/loop configuration has no deployment-default
 * tier (that concept is prompt-only, from T02.3A) - it comes from the
 * published row's modelConfiguration/loopConfiguration when present, else
 * the safe default; either way it is always clamped to platform limits.
 *
 * Only "no published row exists" (loadPublishedPesasChileConfiguration
 * returning null) enables the fallback chain. Any real failure reading the
 * database - connection error, missing table, timeout, invalid SQL -
 * propagates as a thrown error; it is never reinterpreted as "no
 * configuration" and never silently resolved to a default. The caller
 * (runNativeAutonomousCycle.ts, ACS-R1-05.1-T02.3B) is responsible for
 * deciding what a resolution failure means for the turn - this function
 * itself never swallows one.
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
      configuration: published.configuration,
      effectiveModelConfiguration: resolveEffectiveModelConfiguration(published.configuration.modelConfiguration),
      effectiveLoopConfiguration: resolveEffectiveLoopConfiguration(published.configuration.loopConfiguration)
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
      configuration: deploymentDefault.configuration,
      effectiveModelConfiguration: resolveEffectiveModelConfiguration(undefined),
      effectiveLoopConfiguration: resolveEffectiveLoopConfiguration(undefined)
    };
  }

  return {
    source: "safe_default",
    scopeKey: SALES_AGENT_CONFIGURATION_SCOPE,
    recordId: null,
    version: null,
    configurationHash: null,
    configuration: SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
    effectiveModelConfiguration: resolveEffectiveModelConfiguration(undefined),
    effectiveLoopConfiguration: resolveEffectiveLoopConfiguration(undefined)
  };
}
