import { validateSalesAgentPromptConfiguration } from "./validation";
import type { SalesAgentLoopConfiguration, SalesAgentModelConfiguration, SalesAgentPromptConfiguration } from "./types";

/**
 * Never depends on the database - the last fallback the resolver reaches
 * when neither a published row nor a valid deployment default exists.
 * Generic on purpose (no PesasChile-specific copy) so it stays valid even
 * if this module is ever reused for a different scope.
 */
export const SALES_AGENT_CONFIGURATION_SAFE_DEFAULT: SalesAgentPromptConfiguration = {
  agentName: "Asistente comercial",
  companyName: "la empresa",
  role: "Asesor comercial",
  companyDescription: "Empresa dedicada a la venta de productos y servicios.",
  customInstructions: "",
  prohibitedPhrases: []
};

/**
 * ACS-R1-05.1-T02.3B. Deliberately equal to the hardcoded values
 * runAgentToolLoop.ts/httpAgentLoopProvider.ts already used before this
 * task (DEFAULT_TIMEOUT_MS=20000, model fallback "brain-agent-loop",
 * temperature 0) - resolving to the safe default (no publication yet)
 * reproduces today's exact runtime behavior, never a surprise change.
 */
export const SALES_AGENT_MODEL_CONFIGURATION_SAFE_DEFAULT: SalesAgentModelConfiguration = {
  model: "brain-agent-loop",
  temperature: 0,
  maxOutputTokens: 1024,
  timeoutMs: 20000,
  maxModelRetries: 2
};

/** Equal to runAgentToolLoop.ts's pre-existing DEFAULT_MAX_DECISIONS/DEFAULT_MAX_TOOL_EXECUTIONS - same no-surprise rationale as the model default above. */
export const SALES_AGENT_LOOP_CONFIGURATION_SAFE_DEFAULT: SalesAgentLoopConfiguration = {
  maxAgentStepsPerTurn: 3,
  maxToolCallsPerTurn: 2
};

const DEPLOYMENT_DEFAULT_ENV_VAR = "SALES_AGENT_CONFIGURATION_DEPLOYMENT_DEFAULT_JSON";

export type DeploymentDefaultLookup =
  | { found: true; configuration: SalesAgentPromptConfiguration }
  | { found: false; reason: "not_configured" | "invalid_json" | "invalid_configuration" };

/**
 * Deployment-owned default (e.g. a real PesasChile-branded configuration
 * set via env at deploy time), read before any admin has published a
 * configuration through a future Hub UI. Never touches the database -
 * "does not exist" and "exists but invalid" are both legitimate states the
 * resolver falls through from, never thrown as errors.
 */
export function readDeploymentDefaultSalesAgentConfiguration(env: NodeJS.ProcessEnv = process.env): DeploymentDefaultLookup {
  const raw = env[DEPLOYMENT_DEFAULT_ENV_VAR];
  if (!raw || !raw.trim()) {
    return { found: false, reason: "not_configured" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { found: false, reason: "invalid_json" };
  }

  const validation = validateSalesAgentPromptConfiguration(parsed);
  if (!validation.valid) {
    return { found: false, reason: "invalid_configuration" };
  }

  return { found: true, configuration: validation.configuration };
}
