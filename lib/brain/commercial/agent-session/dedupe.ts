// SALES-AGENT-R3-A01. Deterministic id/dedupe-key builders, mirroring
// lib/brain/commercial/events/dedupe.ts's exact pattern (stable sha256-based
// ids, plain string dedupe keys with no PII).

import { createHash } from "node:crypto";

function stableId(parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/**
 * Deterministic by design: calling this twice for the same conversationId
 * always yields the same session id, so ensureSession() can be idempotent
 * without a read-before-write race (a duplicate insert just hits the
 * UNIQUE KEY on conversation_id and is treated as "already exists").
 */
export function buildAgentSessionId(conversationId: number): string {
  return `agsess_${stableId([String(conversationId)])}`;
}

export function buildAgentSessionEventId(dedupeKey: string): string {
  return `agev_${stableId([dedupeKey])}`;
}

/**
 * One user-message event per (session, inboundMessageId) - see Phase 11 of
 * the release doc for exactly what this dedupe guarantee does and does not
 * cover (it prevents a duplicate session row for the SAME already-assigned
 * inboundMessageId; it does not solve two different inboundMessageIds being
 * minted for one physical customer message upstream).
 */
export function buildUserMessageDedupeKey(sessionId: string, inboundMessageId: string): string {
  return `session:${sessionId}:user_message:${inboundMessageId.trim()}`;
}

export function buildAssistantMessageDedupeKey(sessionId: string, inboundMessageId: string): string {
  return `session:${sessionId}:assistant_message:${inboundMessageId.trim()}`;
}

/**
 * One event per (session, turn, step, tool, eventType) - a turn can call
 * several tools, so stepIndex+tool distinguishes them; eventType
 * distinguishes REQUESTED from its terminal COMPLETED/FAILED/REJECTED for
 * the same step.
 */
export function buildToolEventDedupeKey(
  sessionId: string,
  inboundMessageId: string,
  stepIndex: number,
  tool: string,
  eventType: string
): string {
  return `session:${sessionId}:tool:${inboundMessageId.trim()}:${stepIndex}:${tool.trim()}:${eventType}`;
}

/**
 * SALES-AGENT-R3-A03. One event per (session, CommercialActionRequest,
 * eventType) - requestId is already a deterministic, replay-stable id
 * (commercial-action-request/requestIdentity.ts), so a genuine crash/retry
 * that recomputes the same requestId also recomputes the same dedupe key,
 * making a repeated REQUESTED/ACCEPTED/REJECTED/COMPLETED/FAILED emission a
 * no-op rather than a duplicate row.
 */
export function buildCommercialActionRequestDedupeKey(sessionId: string, requestId: string, eventType: string): string {
  return `session:${sessionId}:commercial_action_request:${requestId.trim()}:${eventType}`;
}

/**
 * SALES-AGENT-R3-A04. One event per (session, ReadToolRequest, eventType) -
 * same replay-stability property as buildCommercialActionRequestDedupeKey
 * above, mirrored for the read-side boundary's own deterministic requestId
 * (read-tool-request/requestIdentity.ts).
 */
export function buildReadToolRequestDedupeKey(sessionId: string, requestId: string, eventType: string): string {
  return `session:${sessionId}:read_tool_request:${requestId.trim()}:${eventType}`;
}
