import type { CapabilityGatewayResult } from "../capability-gateway/types";

// SALES-AGENT-R3-A04, Phase 3. The read-side counterpart of R3-A03's
// CommercialActionRequest: a provider-neutral domain contract for a direct
// agent read, never raw model tool-call JSON. `tool` names a Capability
// Gateway capability classified READ_TOOL (agent-capability-exposure/types.ts)
// - reuses that capability's own existing input schema (never a second,
// duplicated one).
//
// Deliberately no mutation-grade idempotency: a read has no business side
// effect, so there is nothing a duplicate execution could corrupt. requestId
// is still deterministic (same shape as CommercialActionRequest's) purely for
// observability/dedupe of the AgentSession events this boundary emits - see
// requestIdentity.ts.

export type ReadToolRequest = {
  requestId: string;
  conversationId: number;
  opportunityId: number | null;
  correlationId: string;
  causationId: string | null;
  tool: string;
  input: Record<string, unknown>;
  createdAt: string;
};

/**
 * Mapped from CapabilityGatewayExecutionStatus, same discipline as
 * CommercialActionResultStatus (commercial-action-request/types.ts) - never a
 * second, incompatible taxonomy. UNAVAILABLE covers a request rejected before
 * the Gateway (wrong exposure classification, non-read-only governance,
 * schema-invalid input) - no crm_capability_executions row exists for those,
 * same honesty discipline as CommercialActionResult's synthesized result.
 */
export const READ_TOOL_RESULT_STATUSES = ["COMPLETED", "DENIED", "BLOCKED", "FAILED", "RETRYABLE", "UNAVAILABLE"] as const;
export type ReadToolResultStatus = (typeof READ_TOOL_RESULT_STATUSES)[number];

export type ReadToolResult = {
  requestId: string;
  tool: string;
  status: ReadToolResultStatus;
  data: Record<string, unknown> | null;
  errorCode: string | null;
  retryable: boolean;
  /** Always populated - the real CapabilityGatewayResult, or a synthesized one in the same shape for a request rejected before the Gateway. Existing consumers (buildToolObservation) need no second shape. */
  gatewayResult: CapabilityGatewayResult;
};
