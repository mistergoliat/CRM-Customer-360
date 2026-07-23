import { SALES_AGENT_CONFIGURATION_LIMITS, type SalesAgentConfigurationValidationFailure } from "@/lib/brain/commercial/sales-agent-configuration";

export function parseConfigurationId(raw: string | undefined): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const LIST_LIMIT_MAX = 200;

export type ListLimitParseResult = { ok: true; limit: number | undefined } | { ok: false };

/**
 * ACS-R1-05.1-T02.3C review correction. A malformed ?limit (NaN, negative,
 * non-integer) is rejected outright rather than passed through -
 * listPesasChileConfigurations() interpolates its limit directly into the
 * SQL string (`LIMIT ${limit}`), and Math.max/Math.min propagate NaN
 * instead of clamping it, so an unvalidated NaN would reach real SQL.
 * A merely excessive value is clamped (not rejected) to LIST_LIMIT_MAX,
 * matching the domain's own ceiling.
 */
export function parseListLimit(raw: string | null): ListLimitParseResult {
  if (raw === null) return { ok: true, limit: undefined };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return { ok: false };
  }
  return { ok: true, limit: Math.min(parsed, LIST_LIMIT_MAX) };
}

/**
 * ACS-R1-05.1-T02.3C, decision 6: reject an oversized body from
 * `Content-Length` alone, before `request.json()` ever runs - no
 * streaming/partial-read for this MVP, just a header check. The domain
 * validator's own byte check (validation.ts#estimatePayloadBytes) still
 * runs after parsing as the second, authoritative layer - this is
 * defense-in-depth, not a replacement.
 */
export function rejectOversizedRequest(request: Request): Response | null {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return null;
  const bytes = Number(contentLength);
  if (Number.isFinite(bytes) && bytes > SALES_AGENT_CONFIGURATION_LIMITS.maxRawPayloadBytes) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  return null;
}

/** Structured {code, field, reason} response for a failed domain validation - 413 for oversized payloads, 400 otherwise. */
export function validationFailureResponse(failure: SalesAgentConfigurationValidationFailure): Response {
  return Response.json(
    { error: failure.code, field: failure.field, reason: failure.reason },
    { status: failure.code === "payload_too_large" ? 413 : 400 }
  );
}
