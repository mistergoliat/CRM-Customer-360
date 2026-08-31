import { createHash } from "node:crypto";

// SALES-AGENT-R3-A04, Phase 3. Deterministic requestId, mirroring
// commercial-action-request/requestIdentity.ts's exact canonicalJson+sha256
// pattern (never a random UUID) - same replay-stability property, used here
// purely for AgentSession event dedupe (Phase 13), not for any
// mutation-grade idempotency (reads have no business side effect to
// duplicate-protect).

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

export function buildReadToolRequestId(params: { conversationId: number; causationId: string | null; tool: string; input: unknown }): string {
  const parts = [String(params.conversationId), params.causationId ?? "no_causation", params.tool, JSON.stringify(canonicalJson(params.input))];
  return `rtr_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32)}`;
}
