import crypto from "node:crypto";
import type { BrainNormalizedProcessInboundRequest, BrainResolvedContext } from "./inbound/types";

export const BRAIN_RUNTIME_VERSION = "p1d-foundation-0.1.0";
export const BRAIN_INSTRUCTIONS_VERSION = "brain.instructions.v1";

export function makeBrainRequestId(request: Pick<BrainNormalizedProcessInboundRequest, "source" | "channel" | "waId" | "phoneNumberId" | "messageId" | "messageText">) {
  const hash = crypto
    .createHash("sha256")
    .update(`${request.source}:${request.channel}:${request.waId}:${request.phoneNumberId}:${request.messageId}:${request.messageText}`)
    .digest("hex")
    .slice(0, 16);

  return `brain-${hash}`;
}

export function makeBrainTraceId(request: Pick<BrainNormalizedProcessInboundRequest, "source" | "messageId" | "waId">) {
  const hash = crypto.createHash("sha256").update(`${request.source}:${request.waId}:${request.messageId}`).digest("hex").slice(0, 12);
  return `trace-${hash}`;
}

export function summarizeBrainContext(context: BrainResolvedContext) {
  return {
    traceId: context.traceId,
    status: context.status,
    confidence: context.confidence,
    notes: context.notes.slice(0, 3),
    warnings: context.warnings.slice(0, 3)
  };
}
