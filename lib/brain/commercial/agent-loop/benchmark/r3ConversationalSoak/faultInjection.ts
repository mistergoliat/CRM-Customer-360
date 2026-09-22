import { executeGovernedCapability } from "../../../capability-gateway/executeCapability";
import type { CapabilityGatewayContext, CapabilityGatewayResult } from "../../../capability-gateway/types";
import type { SoakExecuteCapability } from "./soakSession";

/**
 * SALES-AGENT-R3-P7.12 (section 23). Benchmark-only, one-shot controlled fault injection. Wraps
 * the REAL Capability Gateway (`executeGovernedCapability`, never reimplemented or bypassed for
 * any other call) so that exactly ONE call to a declared target capability, within one declared
 * turn, is answered with a synthetic dependency-style rejection instead of reaching the real
 * capability. No DB write happens for the faulted call (nothing to roll back - it never started).
 * Every other call in the same turn, and every other turn, goes through the real Gateway.
 * Production is never touched: `executeGovernedCapability` itself is not modified.
 */

export const FAULT_KINDS = ["CATALOG_TIMEOUT", "GATEWAY_DEPENDENCY_REJECTION", "INVALID_CATALOG_RESPONSE", "REGISTRY_MISMATCH"] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];

/** Mirrors the real dependency-rejection shape the registry itself returns (`status: "temporarily_blocked"`, e.g. `catalog_service_not_configured` / `registry_mismatch` in registry.ts / searchProductsBySemanticsCapability.ts). */
const FAULT_SPEC: Record<FaultKind, { errorCode: string; retryable: boolean; availability: CapabilityGatewayResult["availability"]; status: CapabilityGatewayResult["status"] }> = {
  CATALOG_TIMEOUT: { errorCode: "catalog_service_unavailable", retryable: true, availability: "unavailable", status: "temporarily_blocked" },
  GATEWAY_DEPENDENCY_REJECTION: { errorCode: "shipping_service_unavailable", retryable: true, availability: "unavailable", status: "temporarily_blocked" },
  INVALID_CATALOG_RESPONSE: { errorCode: "invalid_response", retryable: true, availability: "available", status: "temporarily_blocked" },
  REGISTRY_MISMATCH: { errorCode: "registry_mismatch", retryable: true, availability: "available", status: "temporarily_blocked" }
};

function syntheticRejection(capability: string, kind: FaultKind): CapabilityGatewayResult {
  const spec = FAULT_SPEC[kind];
  const now = new Date().toISOString();
  return { capability, version: "p7.12-injected", availability: spec.availability, status: spec.status, data: null, errorCode: spec.errorCode, retryable: spec.retryable, evidence: [], warnings: [`p7.12_injected_fault:${kind}`], retryCount: 0, startedAt: now, completedAt: now, executionPublicId: null };
}

export type PlannedFault = { targetCapability: string; kind: FaultKind };

/** Builds a fresh one-shot executor for a single turn: the FIRST call to `targetCapability` is faulted, everything else (including later calls to the same capability in the same turn) reaches the real Gateway. */
export function buildOneShotFaultExecutor(fault: PlannedFault): SoakExecuteCapability {
  let consumed = false;
  return async (capability: string, input: Record<string, unknown>, context: CapabilityGatewayContext): Promise<CapabilityGatewayResult> => {
    if (!consumed && capability === fault.targetCapability) {
      consumed = true;
      return syntheticRejection(capability, fault.kind);
    }
    return executeGovernedCapability(capability, input, context);
  };
}
