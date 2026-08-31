import type { AgentSessionStore } from "../agent-session/store";
import { resolveAgentCapabilityExposure, type AgentCapabilityExposure } from "../agent-capability-exposure/types";
import { executeGovernedCapability } from "../capability-gateway/executeCapability";
import { resolveCapabilityGovernance } from "../capability-gateway/registry";
import type { CapabilityAvailabilityStatus, CapabilityGatewayContext, CapabilityGatewayExecutionStatus, CapabilityGatewayResult } from "../capability-gateway/types";
import { recordReadToolCompleted, recordReadToolRequested } from "./sessionEvents";
import type { ReadToolRequest, ReadToolResult, ReadToolResultStatus } from "./types";

// SALES-AGENT-R3-A04, Phase 4. The ReadToolGateway: the sole boundary through
// which an agent-visible READ_TOOL capability may execute.
//
//   1. resolve ReadTool -> Capability Gateway capability (same name, no alias table)
//   2. confirm explicit READ_TOOL classification
//   3. resolve registered governance
//   4. REQUIRE governance.sideEffect === "read_only"
//   5. validate input against the capability's own existing input schema
//   6. call executeGovernedCapability - the unbypassed, unchanged execution choke point
//   7. map into a typed ReadToolResult
//
// Critical invariant (step 4): a capability classified READ_TOOL never
// executes here if the LIVE Capability Gateway registration says it is
// mutating - this is re-checked from resolveCapabilityGovernance() on every
// call, never cached from the classification map, so a later drift between
// the two (someone flips a capability's own governance to "mutating" without
// touching this module) fails closed automatically, not by convention.

export type ExecuteReadToolDependencies = {
  /** Test/DI seam - defaults to the real MariaDB-backed store (sessionEvents.ts). */
  sessionStore?: AgentSessionStore;
  /** Test-only seam to prove step 4's invariant in isolation (see readToolRequest.test.ts) - defaults to the real classification. */
  resolveExposure?: (capability: string) => AgentCapabilityExposure;
};

function nowIso() {
  return new Date().toISOString();
}

/** Same synthesis pattern as commercial-action-request/executeCommercialActionRequest.ts's syntheticGatewayResult - a request rejected before the Gateway gets a CapabilityGatewayResult-shaped value so every existing consumer (buildToolObservation) keeps working unchanged. executionPublicId stays null honestly: nothing was persisted. */
function syntheticGatewayResult(
  capability: string,
  params: { availability: CapabilityAvailabilityStatus; status: CapabilityGatewayExecutionStatus; errorCode: string; retryable: boolean }
): CapabilityGatewayResult {
  const now = nowIso();
  return {
    capability,
    version: "read-tool-request.v1",
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

const GATEWAY_STATUS_TO_READ_RESULT_STATUS: Record<CapabilityGatewayExecutionStatus, ReadToolResultStatus> = {
  completed: "COMPLETED",
  missing_information: "BLOCKED",
  denied: "DENIED",
  requires_approval: "DENIED",
  temporarily_blocked: "RETRYABLE",
  invalid_arguments: "BLOCKED",
  failed: "FAILED"
};

function rejectedResult(request: ReadToolRequest, gatewayResult: CapabilityGatewayResult): ReadToolResult {
  return {
    requestId: request.requestId,
    tool: request.tool,
    status: "UNAVAILABLE",
    data: null,
    errorCode: gatewayResult.errorCode,
    retryable: gatewayResult.retryable,
    gatewayResult
  };
}

export async function executeReadTool(request: ReadToolRequest, gatewayContext: CapabilityGatewayContext, dependencies: ExecuteReadToolDependencies = {}): Promise<ReadToolResult> {
  const store = dependencies.sessionStore;
  const resolveExposure = dependencies.resolveExposure ?? resolveAgentCapabilityExposure;
  await recordReadToolRequested(request, store);

  // Step 2: confirm explicit READ_TOOL classification.
  if (resolveExposure(request.tool) !== "READ_TOOL") {
    const gatewayResult = syntheticGatewayResult(request.tool, { availability: "denied", status: "denied", errorCode: "read_tool_not_exposed", retryable: false });
    await recordReadToolCompleted(request, "UNAVAILABLE", gatewayResult.errorCode, store);
    return rejectedResult(request, gatewayResult);
  }

  // Step 3/4: resolve governance, require read_only - the critical invariant.
  // Read fresh every call, never cached from the classification map above.
  const governance = resolveCapabilityGovernance(request.tool);
  if (!governance || governance.sideEffect !== "read_only") {
    const gatewayResult = syntheticGatewayResult(request.tool, {
      availability: "denied",
      status: "denied",
      errorCode: governance ? "capability_not_read_only" : "capability_not_registered",
      retryable: false
    });
    await recordReadToolCompleted(request, "UNAVAILABLE", gatewayResult.errorCode, store);
    return rejectedResult(request, gatewayResult);
  }

  // Step 5 (task Phase 4/11: "validate input against the capability's own
  // existing schema") is deliberately NOT a blocking pre-Gateway gate here,
  // unlike CommercialActionRequest's (A03) equivalent step. Real regression
  // evidence during A04 development: CapabilityGatewayDefinition.inputSchema
  // is documented as advisory ("never enforced at this layer... this is what
  // the model is told to aim for" - capability-gateway/types.ts) and at least
  // two READ_TOOL capabilities are intentionally MORE lenient than their own
  // exported schema - get_product_details' asProductId accepts a numeric
  // productId even though the schema types it `string`
  // (tests/agent-loop/runAgentToolLoop.test.ts's pendingCatalogAction
  // regressions caught this), and explore_catalog accepts a legacy
  // {orderBy, orderDirection} shape as a deliberate bridge for a real past
  // production incident (registry.ts#asLegacySortAlias) that the schema does
  // not reflect (the exact-error-code regression this task's own build
  // caught: "sort_and_limit_required" from the real capability vs. a
  // generic schema-layer code here). Pre-Gateway blocking would duplicate
  // and actively conflict with logic the capability already, correctly owns
  // - exactly what Phase 4's own "do not duplicate capability validation"
  // principle warns against. Reads have no side effect a malformed call
  // could corrupt (unlike CommercialActionRequest's mutations, where A03's
  // blocking pre-check is real defense in depth) - every read capability's
  // own execute() already validates required fields before any external call
  // (asQueryText/asProductId/etc.), so nothing is lost by leaving this to
  // execute() alone, unchanged from pre-A04 behavior.

  // Step 6: the unbypassed execution choke point - unchanged, already writes
  // crm_capability_executions (Phase 13's observability requirement, free).
  const gatewayResult = await executeGovernedCapability(request.tool, request.input, gatewayContext);
  const status = GATEWAY_STATUS_TO_READ_RESULT_STATUS[gatewayResult.status];
  await recordReadToolCompleted(request, status, gatewayResult.errorCode, store);

  return {
    requestId: request.requestId,
    tool: request.tool,
    status,
    data: gatewayResult.data,
    errorCode: gatewayResult.errorCode,
    retryable: gatewayResult.retryable,
    gatewayResult
  };
}
