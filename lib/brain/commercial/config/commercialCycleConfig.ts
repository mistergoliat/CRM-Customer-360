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

export function buildCommercialSalesAgentDryRun(): boolean {
  const raw = process.env.BRAIN_SALES_AGENT_DRY_RUN?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return SALES_AGENT_RUNTIME_DEFAULT_DRY_RUN;
}
