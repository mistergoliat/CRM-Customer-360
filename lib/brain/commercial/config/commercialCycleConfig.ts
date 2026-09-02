/**
 * commercialCycleConfig
 *
 * Single source of truth for the feature-flag / policy / timeout configuration
 * of the commercial cycle. Both entry points read from here so the two live
 * inbound paths can never diverge:
 *
 *   - processInbound            (legacy n8n / API webhook path)
 *   - runNativeAutonomousCycle  (native WhatsApp path)
 *
 * Before this module the same ~80 lines of env-flag parsing and policy-flag
 * assembly were copy-pasted in both files; adding a flag in one and forgetting
 * the other silently changed behaviour for only one channel.
 *
 * Values here are behaviour-preserving: they reproduce exactly what both paths
 * computed before unification.
 */

import { COMMERCIAL_POLICY_DEFAULT_FLAGS } from "../policy/policyConstants";
import type { CommercialPolicyFeatureFlags } from "../policy/policyTypes";
import {
  COMMERCIAL_SHADOW_CONTEXT_TIMEOUT_MS,
  COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS,
  COMMERCIAL_SHADOW_DEFAULT_TIMEOUT_MS,
  COMMERCIAL_SHADOW_POLICY_TIMEOUT_MS,
  COMMERCIAL_SHADOW_RUNTIME_TIMEOUT_MS
} from "../shadow";
import type { CommercialShadowFeatureFlags } from "../shadow";
import type { CommercialOperationalLoopFeatureFlags } from "../operational-loop";
import type { CommercialExecutionBridgeFeatureFlags } from "../execution-bridge";
import { SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN } from "../sales-agent/runtimeTypes";
import {
  loadAutonomousPilotAllowlist,
  isWaIdAuthorizedForPilot,
  loadCommercialWorkRuntimeAllowlist,
  loadSalesAgentRuntimeAllowlist,
  loadPersistentSessionCognitionAllowlist
} from "../../runtime/autonomousRuntimeConfig";

export function readEnvFlag(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function readEnvPositiveInt(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildCommercialShadowFeatureFlags(
  overrides?: Partial<CommercialShadowFeatureFlags>
): CommercialShadowFeatureFlags {
  const salesAgentEnabled = readEnvFlag("BRAIN_SALES_AGENT_ENABLED", false);
  const realModelEnabled = readEnvFlag("BRAIN_ENABLE_REAL_MODEL", false);
  const commercialShadowEnabled = readEnvFlag("BRAIN_COMMERCIAL_SHADOW_ENABLED", salesAgentEnabled);
  const commercialRuntimeEnabled = readEnvFlag("BRAIN_COMMERCIAL_RUNTIME_ENABLED", commercialShadowEnabled);
  const commercialPolicyEnabled = readEnvFlag("BRAIN_COMMERCIAL_POLICY_ENABLED", commercialShadowEnabled);
  const commercialShadowAllowRealProvider = readEnvFlag(
    "BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER",
    salesAgentEnabled || realModelEnabled
  );

  return {
    ...COMMERCIAL_SHADOW_DEFAULT_FEATURE_FLAGS,
    commercialShadowEnabled,
    commercialRuntimeEnabled,
    commercialPolicyEnabled,
    commercialShadowAllowRealProvider,
    ...(overrides ?? {})
  };
}

export function buildCommercialLoopFeatureFlags(
  overrides?: Partial<CommercialOperationalLoopFeatureFlags>
): CommercialOperationalLoopFeatureFlags {
  return {
    commercialOperationalLoopEnabled: readEnvFlag("BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED", false),
    commercialStatePersistenceEnabled: readEnvFlag("BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED", false),
    ...(overrides ?? {})
  };
}

export function buildCommercialBridgeFeatureFlags(
  overrides?: Partial<CommercialExecutionBridgeFeatureFlags>
): CommercialExecutionBridgeFeatureFlags {
  return {
    actionQueueEnabled: readEnvFlag("BRAIN_AGENT_ACTION_QUEUE_ENABLED", false),
    actionPersistenceEnabled: readEnvFlag("BRAIN_AGENT_ACTION_PERSISTENCE_ENABLED", false),
    executionGateEnabled: readEnvFlag("BRAIN_EXECUTION_GATE_ENABLED", false),
    outboxBridgeEnabled: readEnvFlag("BRAIN_OUTBOX_BRIDGE_ENABLED", false),
    sandboxEnabled: readEnvFlag("BRAIN_AUTONOMOUS_SANDBOX_ENABLED", true),
    autonomousReplyEnabled: readEnvFlag("BRAIN_AUTONOMOUS_REPLY_ENABLED", true),
    sandboxModeRequired: readEnvFlag("BRAIN_EXECUTION_GATE_SANDBOX_REQUIRED", false),
    ...(overrides ?? {})
  };
}

/**
 * Policy flags for a governed autonomous turn. `commercialPolicyEnabled` is the
 * one caller-specific toggle: processInbound always enables policy evaluation,
 * while the native cycle ties it to its shadow configuration.
 */
export function buildCommercialCyclePolicyFlags(commercialPolicyEnabled: boolean): CommercialPolicyFeatureFlags {
  return {
    ...COMMERCIAL_POLICY_DEFAULT_FLAGS,
    commercialPolicyEnabled,
    allowDraftReplies: true,
    allowToolRequests: true,
    allowEntityProposals: true,
    allowFollowUpEvaluation: true,
    allowInternalTasks: true,
    allowQuoteDraftRequests: true,
    allowOperatorReviewRequests: true,
    allowSensitiveClaims: false,
    allowOutboundProposals: true
  };
}

export type CommercialCycleTimeouts = {
  shadowTimeoutMs: number;
  contextTimeoutMs: number;
  runtimeTimeoutMs: number;
  policyTimeoutMs: number;
};

export function buildCommercialCycleTimeouts(): CommercialCycleTimeouts {
  return {
    shadowTimeoutMs: readEnvPositiveInt("BRAIN_COMMERCIAL_SHADOW_TIMEOUT_MS", COMMERCIAL_SHADOW_DEFAULT_TIMEOUT_MS),
    contextTimeoutMs: readEnvPositiveInt("BRAIN_COMMERCIAL_CONTEXT_TIMEOUT_MS", COMMERCIAL_SHADOW_CONTEXT_TIMEOUT_MS),
    runtimeTimeoutMs: readEnvPositiveInt("BRAIN_COMMERCIAL_RUNTIME_TIMEOUT_MS", COMMERCIAL_SHADOW_RUNTIME_TIMEOUT_MS),
    policyTimeoutMs: readEnvPositiveInt("BRAIN_COMMERCIAL_POLICY_TIMEOUT_MS", COMMERCIAL_SHADOW_POLICY_TIMEOUT_MS)
  };
}

/**
 * ACS-R1-05.1-T02.1. Fail-closed (default false) toggle for the native
 * read-only agent tool loop. When true, runNativeAutonomousCycle runs the
 * new AgentStep loop instead of runCommercialShadowEvaluation ->
 * runCommercialOperationalLoop -> runCapabilityExecutionStage for real
 * WhatsApp traffic - the two paths are mutually exclusive per turn, same
 * pattern as the existing multi-request/legacy toggle in that file.
 */
export function buildAgentToolLoopFeatureFlags(overrides?: Partial<{ agentToolLoopEnabled: boolean }>) {
  return {
    agentToolLoopEnabled: readEnvFlag("BRAIN_AGENT_TOOL_LOOP_ENABLED", false),
    ...(overrides ?? {})
  };
}

/**
 * LLM-R1-T09A. Fail-closed (default false) toggle for the backend Multi-Intent
 * Planning + Requirement Resolution runtime (lib/brain/commercial/multi-intent/
 * runCommercialMultiIntentLoop.ts) - only meaningful when the Agent Tool Loop
 * itself is already enabled (buildAgentToolLoopFeatureFlags above); it
 * selects which of the two loop implementations runNativeAgentToolLoopCycle.ts
 * runs for a turn, never a separate runtime path of its own. When true, this
 * production flag is only ever expected to be additionally scoped to
 * BRAIN_AUTONOMOUS_TEST_WA_IDS (the existing pilot allowlist) - see
 * docs/releases/LLM-R1-T09A-multi-intent-planning-and-requirement-resolution.md.
 */
export function buildMultiIntentPlannerFeatureFlags(overrides?: Partial<{ multiIntentPlannerEnabled: boolean }>) {
  return {
    multiIntentPlannerEnabled: readEnvFlag("BRAIN_MULTI_INTENT_PLANNER_ENABLED", false),
    ...(overrides ?? {})
  };
}

/**
 * LLM-R1-T09B. The actual per-turn routing decision: the multi-intent
 * planner runs for THIS turn only when the flag is on AND this exact waId is
 * one of the explicitly configured BRAIN_AUTONOMOUS_TEST_WA_IDS entries -
 * never a global switch. Deliberately does NOT reuse isWaIdAuthorizedForPilot's
 * "empty allowlist means unrestricted" semantics (correct for that function's
 * own purpose - gating the whole autonomous pilot before any allowlist is
 * configured) - here, `BRAIN_MULTI_INTENT_PLANNER_ENABLED=true` with an empty
 * allowlist is ambiguous configuration (a flag with no one to apply it to),
 * and this task's own contract requires failing closed in that case: nobody
 * is routed to the new path until BRAIN_AUTONOMOUS_TEST_WA_IDS is explicitly
 * non-empty. A null/missing waId always fails closed too (isWaIdAuthorizedForPilot
 * already returns false for a waId that fails to normalize).
 */
export function shouldRouteToMultiIntentPlanner(waId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!buildMultiIntentPlannerFeatureFlags(undefined).multiIntentPlannerEnabled) return false;
  const allowlist = loadAutonomousPilotAllowlist(env);
  if (allowlist.length === 0) return false;
  return isWaIdAuthorizedForPilot(waId, allowlist);
}

/**
 * SALES-AGENT-R2-A08.5. Fail-closed (default false) toggle for the
 * CommercialWork (R2) durable execution architecture on the native WhatsApp
 * inbound path. Meaningless on its own - see shouldRouteToCommercialWork
 * below for the actual per-turn routing decision, which additionally
 * requires a non-empty BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS allowlist.
 */
export function buildCommercialWorkRuntimeFeatureFlags(overrides?: Partial<{ commercialWorkRuntimeEnabled: boolean }>) {
  return {
    commercialWorkRuntimeEnabled: readEnvFlag("BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED", false),
    ...(overrides ?? {})
  };
}

/**
 * SALES-AGENT-R2-A08.5. Same fail-closed shape as shouldRouteToMultiIntentPlanner
 * above (LLM-R1-T09B): the CommercialWork runtime handles a turn only when
 * the flag is on AND this exact waId is one of the explicitly configured
 * BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS entries - never a global switch, and
 * never simply because the multi-intent pilot's own allowlist happens to be
 * populated. An empty allowlist with the flag on is ambiguous configuration
 * (nobody to route) and fails closed, same reasoning as T09B. Checked before
 * multiRequestEnabled/agentToolLoopEnabled in runNativeAutonomousCycle's
 * runtime-selection step, so an allowlisted turn is fully owned by R2 - it
 * never also runs the legacy or Agent Tool Loop pipelines for the same turn.
 */
export function shouldRouteToCommercialWork(waId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!buildCommercialWorkRuntimeFeatureFlags(undefined).commercialWorkRuntimeEnabled) return false;
  const allowlist = loadCommercialWorkRuntimeAllowlist(env);
  if (allowlist.length === 0) return false;
  return isWaIdAuthorizedForPilot(waId, allowlist);
}

/**
 * SALES-AGENT-R2-A09, Part 13/45. Fail-closed (default false), independent
 * of BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED - an internal executor scheduling
 * behavior, never a customer-routing decision, so it needs no allowlist of
 * its own (unlike shouldRouteToCommercialWork above). OFF reproduces the
 * exact pre-A09 sequential executor behavior everywhere it is read.
 * maxParallelSteps is bounded again inside executeCommercialWork itself
 * (clamped to [1,10]) - this resolver only supplies the configured value.
 */
export function buildCommercialWorkParallelExecutionFeatureFlags(overrides?: Partial<{ parallelExecutionEnabled: boolean; maxParallelSteps: number }>) {
  return {
    parallelExecutionEnabled: readEnvFlag("BRAIN_COMMERCIAL_WORK_PARALLEL_EXECUTION_ENABLED", false),
    maxParallelSteps: readEnvPositiveInt("BRAIN_COMMERCIAL_WORK_PARALLEL_MAX_STEPS", 3),
    ...(overrides ?? {})
  };
}

/**
 * SALES-AGENT-R3-V1.4. Fail-closed (default false) toggle for the
 * SalesAgentRuntime pilot route on the native WhatsApp inbound path.
 * Meaningless on its own - see shouldRouteToSalesAgentRuntime below for the
 * actual per-turn routing decision, which additionally requires a
 * non-empty BRAIN_SALES_AGENT_RUNTIME_WA_IDS allowlist. Same shape as
 * buildCommercialWorkRuntimeFeatureFlags above.
 */
export function buildSalesAgentRuntimeRoutingFeatureFlags(overrides?: Partial<{ salesAgentRuntimeEnabled: boolean }>) {
  return {
    salesAgentRuntimeEnabled: readEnvFlag("BRAIN_SALES_AGENT_RUNTIME_ENABLED", false),
    ...(overrides ?? {})
  };
}

/**
 * SALES-AGENT-R3-V1.4. Same fail-closed shape as shouldRouteToCommercialWork
 * above: SalesAgentRuntime handles a turn only when the flag is on AND this
 * exact waId is one of the explicitly configured
 * BRAIN_SALES_AGENT_RUNTIME_WA_IDS entries - never a global switch, never
 * simply because another pilot's allowlist happens to be populated. An
 * empty allowlist with the flag on is ambiguous configuration (nobody to
 * route) and fails closed, same reasoning as shouldRouteToCommercialWork.
 * Checked last among the runtime-selection branches in
 * runNativeAutonomousCycle.ts (after commercialWork/multiRequest/
 * agentToolLoop) so this new pilot can never silently steal a wa_id already
 * allowlisted for an existing, more mature pilot route.
 */
export function shouldRouteToSalesAgentRuntime(waId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!buildSalesAgentRuntimeRoutingFeatureFlags(undefined).salesAgentRuntimeEnabled) return false;
  const allowlist = loadSalesAgentRuntimeAllowlist(env);
  if (allowlist.length === 0) return false;
  return isWaIdAuthorizedForPilot(waId, allowlist);
}

export function buildCommercialSalesAgentDryRun(): boolean {
  const raw = process.env.BRAIN_SALES_AGENT_DRY_RUN?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN;
}

/**
 * ACS-R1-05.1-T01: the legacy sales-consultative engine
 * (lib/brain/commercial/sales-consultative) is a separate, non-canonical
 * writer of crm_opportunities/crm_sales_need_profiles/crm_agent_actions.
 * The only productive path allowed to write commercial state by default is
 * WhatsApp -> processNativeWhatsAppInbound -> runNativeAutonomousCycle ->
 * operational-loop -> persistCommercialState. This flag gates the two
 * remaining legacy call sites (processInbound.ts's process-inbound endpoint,
 * and native-whatsapp/service.ts's unused legacy inbound entry point) fail-
 * closed: disabled unless explicitly turned on.
 */
export type CommercialLegacySalesConsultativeFeatureFlags = {
  legacySalesConsultativeEnabled: boolean;
};

/**
 * Thrown by any legacy sales-consultative entry point that is gated by
 * BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED when the flag is off (the default).
 * A distinct class - never a generic Error - so a caller can `instanceof`
 * check it instead of string-matching a message. The native-whatsapp legacy
 * inbound entry point (its only throw site today) has zero production HTTP
 * callers, verified by
 * tests/commercial/legacySalesConsultativeRuntimeAuthority.test.ts, so this
 * never surfaces as a 500 today. Any future caller MUST catch this explicitly
 * and decide its own disabled-state contract (e.g. a skipped/disabled
 * result) rather than letting it bubble into a generic failure response.
 */
export class LegacySalesConsultativeDisabledError extends Error {
  constructor(message = "legacy_sales_consultative_disabled") {
    super(message);
    this.name = "LegacySalesConsultativeDisabledError";
  }
}

/**
 * SALES-AGENT-R3-V1.8-D4. Fail-closed (default false) toggle for the
 * persistent-session shadow read on the R3 SalesAgentRuntime boundary
 * (salesAgentRuntime.ts). Shadow-only: loads/derives/compares/discards -
 * never influences the real provider request. No separate allowlist needed -
 * runNativeAutonomousCycle.ts already scopes every SalesAgentRuntime turn to
 * shouldRouteToSalesAgentRuntime's own BRAIN_SALES_AGENT_RUNTIME_WA_IDS
 * allowlist before this flag is ever read for that turn.
 */
export function buildPersistentSessionShadowFeatureFlags(overrides?: Partial<{ persistentSessionShadowEnabled: boolean }>) {
  return {
    persistentSessionShadowEnabled: readEnvFlag("BRAIN_R3_PERSISTENT_SESSION_SHADOW_ENABLED", false),
    ...(overrides ?? {})
  };
}

/**
 * SALES-AGENT-R3-V1.8-D5. Fail-closed (default false) toggle for LIVE
 * persistent-session cognition - unlike buildPersistentSessionShadowFeatureFlags
 * above (D4, load/derive/compare/discard only), enabling this actually
 * changes what the model sees. Meaningless on its own - see
 * shouldEnablePersistentSessionCognition below for the actual per-turn
 * decision, which additionally requires a non-empty
 * BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS allowlist. Deliberately a
 * second, independent flag from D4's - a wa_id allowlisted for the shadow is
 * NOT automatically eligible for live cognition, and vice versa (task brief
 * Section I: "Do not make D5 depend on D4").
 */
export function buildPersistentSessionCognitionFeatureFlags(overrides?: Partial<{ persistentSessionCognitionEnabled: boolean }>) {
  return {
    persistentSessionCognitionEnabled: readEnvFlag("BRAIN_R3_PERSISTENT_SESSION_COGNITION_ENABLED", false),
    ...(overrides ?? {})
  };
}

/**
 * SALES-AGENT-R3-V1.8-D5. Same fail-closed shape as shouldRouteToSalesAgentRuntime
 * above: live persistent-session cognition applies to a turn only when the
 * flag is on AND this exact waId is one of the explicitly configured
 * BRAIN_R3_PERSISTENT_SESSION_COGNITION_WA_IDS entries - never inherited
 * from shouldRouteToSalesAgentRuntime's own (broader, more mature) allowlist.
 * An empty allowlist with the flag on is ambiguous configuration (nobody to
 * apply it to) and fails closed, same reasoning as every other allowlisted
 * gate in this file. Callers are expected to only ever consult this after
 * shouldRouteToSalesAgentRuntime(waId) is already true for the same turn -
 * this function does not re-check that itself (see runNativeAutonomousCycle.ts's
 * own call site, inside the salesAgentRuntimeEnabled branch).
 */
export function shouldEnablePersistentSessionCognition(waId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!buildPersistentSessionCognitionFeatureFlags(undefined).persistentSessionCognitionEnabled) return false;
  const allowlist = loadPersistentSessionCognitionAllowlist(env);
  if (allowlist.length === 0) return false;
  return isWaIdAuthorizedForPilot(waId, allowlist);
}

export function buildLegacySalesConsultativeFeatureFlags(
  overrides?: Partial<CommercialLegacySalesConsultativeFeatureFlags>
): CommercialLegacySalesConsultativeFeatureFlags {
  return {
    legacySalesConsultativeEnabled: readEnvFlag("BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED", false),
    ...(overrides ?? {})
  };
}
