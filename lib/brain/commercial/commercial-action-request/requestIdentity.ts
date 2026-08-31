import { createHash } from "node:crypto";

// SALES-AGENT-R3-A03, Phase 5. Deterministic requestId, mirroring the
// canonicalJson+sha256 pattern already established across this codebase
// (agent-loop/runAgentToolLoop.ts#buildDedupeKey, agent-session/dedupe.ts,
// events/dedupe.ts). A replay of the SAME logical request - same
// conversation, same causation, same action type, same normalized input -
// always recomputes the IDENTICAL requestId; never a random UUID. This is
// what "the same logical request replayed after crash/retry must not create
// a second business side effect" actually means at this layer: a genuine
// retry recomputes the same id, AgentSessionStore's own dedupeKey-based
// appendEvent is a no-op on a repeat, and each of the four target
// capabilities is already idempotent at the domain layer (select_products/
// set_shipping_destination replace-with-same-value, select_shipping_option's
// freshness check, create_quote's own hash-keyed reuse) - so no new durable
// "seen requests" table is needed here.

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

export function buildCommercialActionRequestId(params: {
  conversationId: number;
  causationId: string | null;
  actionType: string;
  input: unknown;
}): string {
  const parts = [String(params.conversationId), params.causationId ?? "no_causation", params.actionType, JSON.stringify(canonicalJson(params.input))];
  return `car_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32)}`;
}
