import type { AgentSessionStore } from "../agent-session/store";
import { evaluateCapabilityIdentityGate } from "../capability-gateway/identityGate";
import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import { resolveCapabilityGovernance } from "../capability-gateway/registry";
import type { CapabilityAvailabilityStatus, CapabilityGatewayContext, CapabilityGatewayExecutionStatus, CapabilityGatewayResult } from "../capability-gateway/types";
import { getCapabilityMappingForActionType } from "./actionCapabilityMapping";
import { recordCommercialActionAccepted, recordCommercialActionRejected, recordCommercialActionRequested, recordCommercialActionTerminal } from "./sessionEvents";
import { validateCommercialActionRequest } from "./validateCommercialActionRequest";
import type { CommercialActionRequest, CommercialActionResult, CommercialActionResultStatus } from "./types";

export type ExecuteCommercialActionRequestDependencies = {
  /** Test/DI seam - defaults to the real MariaDB-backed store (sessionEvents.ts). */
  sessionStore?: AgentSessionStore;
};

// SALES-AGENT-R3-A03, Phase 6/7. Runtime-neutral executor:
//   1. validate request (Phase 4)
//   2. resolve capability mapping (Phase 3)
//   3. apply the R3-A02 shared identity gate
//   4. invoke executeGovernedCapability - the final execution choke point;
//      this boundary never bypasses it, never calls a capability directly
//   5. return a typed CommercialActionResult (Phase 7)
//
// Steps 1-3 never reach the Gateway on failure - a rejected request has no
// crm_capability_executions row (there was nothing to execute), but is still
// fully observable via the AgentSession COMMERCIAL_ACTION_REJECTED event
// (Phase 8/12).

function nowIso() {
  return new Date().toISOString();
}

/**
 * Builds a CapabilityGatewayResult-shaped value for a request rejected
 * before reaching the Gateway - same fields executeCapability.ts's own
 * denial branches use, so every consumer of a CapabilityGatewayResult (e.g.
 * buildToolObservation) keeps working unchanged. executionPublicId stays
 * null honestly: nothing was persisted to crm_capability_executions for a
 * request that never reached the Gateway.
 */
function syntheticGatewayResult(
  capability: string,
  params: { availability: CapabilityAvailabilityStatus; status: CapabilityGatewayExecutionStatus; errorCode: string; retryable: boolean }
): CapabilityGatewayResult {
  const now = nowIso();
  return {
    capability,
    version: "commercial-action-request.v1",
    availability: params.availability,
    status: params.status,
    data: null,
    errorCode: params.errorCode,
    retryable: params.retryable,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: now,
    completedAt: now,
    executionPublicId: null
  };
}

/** Phase 7: mapped from the existing Capability Gateway vocabulary - never a second, incompatible taxonomy. */
const GATEWAY_STATUS_TO_RESULT_STATUS: Record<CapabilityGatewayExecutionStatus, CommercialActionResultStatus> = {
  completed: "COMPLETED",
  missing_information: "REQUIRES_CUSTOMER_INPUT",
  denied: "DENIED",
  requires_approval: "REQUIRES_REVIEW",
  temporarily_blocked: "RETRYABLE",
  invalid_arguments: "BLOCKED",
  failed: "FAILED"
};

function rejectedResult(request: CommercialActionRequest, capability: string, gatewayResult: CapabilityGatewayResult): CommercialActionResult {
  return {
    requestId: request.requestId,
    actionType: request.actionType,
    capability,
    status: GATEWAY_STATUS_TO_RESULT_STATUS[gatewayResult.status],
    data: null,
    errorCode: gatewayResult.errorCode,
    retryable: gatewayResult.retryable,
    gatewayResult
  };
}

export async function executeCommercialActionRequest(
  request: CommercialActionRequest,
  gatewayContext: CapabilityGatewayContext,
  dependencies: ExecuteCommercialActionRequestDependencies = {}
): Promise<CommercialActionResult> {
  const store = dependencies.sessionStore;
  await recordCommercialActionRequested(request, store);

  // Phase 1: validate request.
  const validation = validateCommercialActionRequest(request);
  if (!validation.valid) {
    const gatewayResult = syntheticGatewayResult("unknown", { availability: "denied", status: "invalid_arguments", errorCode: `commercial_action_request_${validation.reason}`, retryable: false });
    await recordCommercialActionRejected(request, null, validation.reason, store);
    return rejectedResult(request, "unknown", gatewayResult);
  }

  // Phase 2: resolve capability mapping.
  const mapping = getCapabilityMappingForActionType(request.actionType);
  const governance = resolveCapabilityGovernance(mapping.capability);
  if (!governance) {
    // Structurally unreachable given the canonical mapping only ever names a
    // capability actually registered in the Gateway - defensive fail-closed,
    // never trusted implicitly (same discipline as A02's own unmapped-
    // capability branch).
    const gatewayResult = syntheticGatewayResult(mapping.capability, { availability: "denied", status: "denied", errorCode: "capability_not_registered", retryable: false });
    await recordCommercialActionRejected(request, mapping.capability, "capability_not_registered", store);
    return rejectedResult(request, mapping.capability, gatewayResult);
  }

  // Phase 3: apply the R3-A02 shared identity gate.
  const identityGate = evaluateCapabilityIdentityGate(mapping.capability, governance, gatewayContext);
  if (!identityGate.allowed) {
    const gatewayResult = syntheticGatewayResult(mapping.capability, {
      availability: identityGate.availability,
      status: identityGate.status,
      errorCode: identityGate.errorCode,
      retryable: identityGate.retryable
    });
    await recordCommercialActionRejected(request, mapping.capability, identityGate.errorCode, store);
    return rejectedResult(request, mapping.capability, gatewayResult);
  }

  await recordCommercialActionAccepted(request, mapping.capability, store);

  // Phase 4: invoke executeGovernedCapability - the final, unbypassed
  // execution choke point. This also independently re-applies the A02 gate
  // (pure, deterministic, same inputs) - defense in depth, never relied on
  // as the only check (see Phase 3 above).
  const gatewayResult = await executeGovernedCapability(mapping.capability, request.input, gatewayContext);
  const status = GATEWAY_STATUS_TO_RESULT_STATUS[gatewayResult.status];
  await recordCommercialActionTerminal(request, mapping.capability, status, gatewayResult, store);

  return {
    requestId: request.requestId,
    actionType: request.actionType,
    capability: mapping.capability,
    status,
    data: gatewayResult.data,
    errorCode: gatewayResult.errorCode,
    retryable: gatewayResult.retryable,
    gatewayResult
  };
}
