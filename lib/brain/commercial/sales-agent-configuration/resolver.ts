import {
  SALES_AGENT_CONFIGURATION_SCOPE,
  SALES_AGENT_LOOP_CONFIGURATION_LIMITS,
  SALES_AGENT_MODEL_CONFIGURATION_GENERIC_FALLBACK_MODEL,
  SALES_AGENT_MODEL_CONFIGURATION_LIMITS
} from "./constants";
import {
  readDeploymentDefaultSalesAgentConfiguration,
  SALES_AGENT_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT,
  SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT
} from "./defaults";
import { loadPublishedPesasChileConfiguration } from "./repository";
import type { EffectiveSalesAgentModelConfiguration, ResolvedSalesAgentConfiguration, SalesAgentLoopConfiguration, SalesAgentModelConfiguration } from "./types";
import { isSalesAgentModelAllowed } from "./validation";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Platform ceilings/floors always win, even over a persisted, previously-
 * valid value - a value that satisfied the limits at write time can still
 * exceed a limit tightened afterward, and this is the one place that must
 * never let that through uncapped.
 *
 * model precedence: a published model (only if it still passes today's
 * allowlist - isSalesAgentModelAllowed, ACS-R1-05.1-T02.3B correction) ->
 * BRAIN_MODEL_NAME -> the generic fallback. A published model that no
 * longer matches the allowlist (e.g. the deployment's BRAIN_MODEL_NAME
 * changed after that row was published) is never blindly trusted - it
 * falls through exactly like an absent one, the same "never let a stale
 * value through uncapped" principle as the numeric clamps below.
 *
 * maxOutputTokens is deliberately NOT defaulted when absent: only a real
 * published value is ever surfaced, so httpAgentLoopProvider.ts can omit
 * `max_tokens` entirely instead of silently capping an unconfigured
 * deployment at an invented number.
 */
function resolveEffectiveModelConfiguration(
  candidate: SalesAgentModelConfiguration | undefined,
  env: NodeJS.ProcessEnv
): EffectiveSalesAgentModelConfiguration {
  const base = candidate ?? SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT;
  const limits = SALES_AGENT_MODEL_CONFIGURATION_LIMITS;
  const publishedModel = candidate && isSalesAgentModelAllowed(candidate.model, env) ? candidate.model : undefined;
  const model = publishedModel ?? (env.BRAIN_MODEL_NAME?.trim() || SALES_AGENT_MODEL_CONFIGURATION_GENERIC_FALLBACK_MODEL);
  return {
    model,
    temperature: clamp(base.temperature, limits.temperatureMin, limits.temperatureMax),
    maxOutputTokens: candidate ? clamp(Math.round(candidate.maxOutputTokens), limits.maxOutputTokensMin, limits.maxOutputTokensMax) : undefined,
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
      effectiveModelConfiguration: resolveEffectiveModelConfiguration(published.configuration.modelConfiguration, env),
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
      effectiveModelConfiguration: resolveEffectiveModelConfiguration(undefined, env),
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
    effectiveModelConfiguration: resolveEffectiveModelConfiguration(undefined, env),
    effectiveLoopConfiguration: resolveEffectiveLoopConfiguration(undefined)
  };
}
