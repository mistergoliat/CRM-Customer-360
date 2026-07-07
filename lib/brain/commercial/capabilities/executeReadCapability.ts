import { createHash } from "node:crypto";
import { appendRequestEvent, loadConversationRequest } from "../conversation-request";
import { resolveRequestDefinition } from "../request-definitions";
import { resolveReadCapability } from "./registry";
import type { CapabilityExecutionResult } from "./types";

export type ExecuteReadCapabilityInput = {
  capability: string;
  input: Record<string, unknown>;
  requestId: string;
  /** Correlates the execution in the event trail (turn plan id, action id...). */
  sourceId?: string | null;
  /**
   * Emit the semantic request event on success (order_status_provided /
   * information_provided) so the definition reducer can act on it. The caller
   * decides: emitting means the result WILL reach the customer this turn.
   */
  emitEvent?: boolean;
};

export type ExecuteReadCapabilityResult = CapabilityExecutionResult & {
  requestId: string;
  emittedEventType: string | null;
};

function eventTypeFor(capability: string): "order_status_provided" | "information_provided" {
  return capability === "find_order" || capability === "get_order_status" ? "order_status_provided" : "information_provided";
}

/**
 * The only door for the multi-request runtime to run a read capability:
 * unknown names fail, mutations cannot pass, and the request's definition
 * allowlist gates every call. Success may emit the semantic event that lets
 * the deterministic reducer resolve the request - the capability itself never
 * touches request status.
 */
export async function executeReadCapabilityForRequest(input: ExecuteReadCapabilityInput): Promise<ExecuteReadCapabilityResult> {
  const definition = resolveReadCapability(input.capability);
  if (!definition) {
    return { capability: input.capability, status: "failed", data: null, warning: "unknown_capability", requestId: input.requestId, emittedEventType: null };
  }
  if (definition.riskLevel !== "read") {
    return { capability: input.capability, status: "failed", data: null, warning: "not_a_read_capability", requestId: input.requestId, emittedEventType: null };
  }

  const request = await loadConversationRequest(input.requestId);
  if (!request) {
    return { capability: input.capability, status: "failed", data: null, warning: "request_not_found", requestId: input.requestId, emittedEventType: null };
  }

  const allowed = resolveRequestDefinition(request.intentType).allowedCapabilities;
  if (!allowed.includes(input.capability)) {
    return {
      capability: input.capability,
      status: "failed",
      data: null,
      warning: `capability_not_allowed_for_request:${request.intentType}`,
      requestId: input.requestId,
      emittedEventType: null
    };
  }

  let result: CapabilityExecutionResult;
  try {
    result = await definition.execute(input.input);
  } catch (error) {
    result = {
      capability: input.capability,
      status: "failed",
      data: null,
      warning: error instanceof Error ? error.message : String(error)
    };
  }

  let emittedEventType: string | null = null;
  if (result.status === "succeeded" && input.emitEvent) {
    const eventType = eventTypeFor(input.capability);
    const inputHash = createHash("sha256").update(JSON.stringify(input.input ?? {})).digest("hex").slice(0, 16);
    await appendRequestEvent({
      dedupeKey: `request:${input.requestId}:capability:${input.capability}:${inputHash}`,
      requestId: input.requestId,
      eventType,
      sourceType: "tool_execution",
      sourceId: input.sourceId ?? input.capability,
      payload: { capability: input.capability, warning: result.warning },
      occurredAt: new Date().toISOString()
    });
    emittedEventType = eventType;
  }

  return { ...result, requestId: input.requestId, emittedEventType };
}
