// SALES-AGENT-R3-A01. Two layered checks, both fail-closed:
//
// 1. Secret/chain-of-thought layer: reuses (never reimplements) the
//    commercial_event sanitizer (lib/brain/commercial/events/normalize.ts#
//    normalizeCommercialEventPayload) - the same recursive, forbidden-key-
//    rejecting walk every other commercial_event payload in this repo
//    already goes through. That sanitizer was strengthened (R3-A01,
//    additive only) to also reject reasoning/chain-of-thought/raw-prompt/
//    raw-output-shaped keys.
//
// 2. PII layer, local to this module only: phone/email/address/wa_id are
//    legitimate field names elsewhere in this codebase's OTHER
//    commercial_event payloads (identity/onboarding audit trail types), so
//    they are deliberately NOT added to the shared SENSITIVE_KEY_PATTERN in
//    events/normalize.ts - doing so would reject payloads that module's
//    existing, already-reviewed callers are entitled to send. AgentSessionStore
//    is a stricter context (Phase 6 of the task brief: "the model/session-
//    facing representation must remain the safe projection"), so it applies
//    its own, additional PII-shaped-key blocklist on top of layer 1.
//
// Naming discipline inherited from agent-loop/agentStepTypes.ts /
// events/types.ts#AgentToolLoopLlmCallSummary: layer 1's pattern rejects ANY
// key containing "token" (substring, not whole-word) - so a numeric metric
// must be named e.g. `outputSize`, never `outputTokenCount`/`outputTokens`.

import { normalizeCommercialEventPayload } from "../events/normalize";

export class AgentSessionForbiddenPayloadError extends Error {
  constructor(reason: string) {
    super(`agent_session_forbidden_payload:${reason}`);
    this.name = "AgentSessionForbiddenPayloadError";
  }
}

// Task brief Phase 6's explicit list: phone, email, address, raw WhatsApp
// identifier, PrestaShop credentials, auth tokens (auth tokens already
// covered by layer 1). `customerId`/`masterCustomerId`/`opportunityId`/
// `conversationId` are deliberately NOT here - the task brief explicitly
// allows those as "safe internal identifiers" already treated as such by
// the rest of this architecture (RuntimeIdentityContext.masterCustomerId,
// CapabilityGatewayContext.opportunityId/conversationId).
const AGENT_SESSION_PII_KEY_PATTERN = /\bphone\b|\bemail\b|\baddress\b|wa[-_]?id|external(id|_id)|normalizedphone|prestashop.?(password|credential)/i;

function assertNoPiiShapedKeys(value: unknown, path: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPiiShapedKeys(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (AGENT_SESSION_PII_KEY_PATTERN.test(key)) {
      throw new AgentSessionForbiddenPayloadError(`pii_shaped_key:${path}.${key}`);
    }
    assertNoPiiShapedKeys(nested, `${path}.${key}`);
  }
}

/**
 * Fail-closed: throws AgentSessionForbiddenPayloadError (never silently
 * drops the field) when the payload contains a forbidden key at any nesting
 * depth, including inside arrays. Callers must not catch-and-persist-anyway;
 * a rejected payload means the caller built the wrong shape, not that the
 * event should be silently degraded.
 */
export function sanitizeAgentSessionPayload(payload: Record<string, unknown>): Record<string, unknown> {
  let normalized: Record<string, unknown>;
  try {
    normalized = normalizeCommercialEventPayload(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AgentSessionForbiddenPayloadError(reason);
  }
  assertNoPiiShapedKeys(normalized, "root");
  return normalized;
}
