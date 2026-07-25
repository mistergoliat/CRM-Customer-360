import {
  FOLLOW_UP_CRITICALITY_VALUES,
  FOLLOW_UP_LIST_DEFAULT_LIMIT,
  FOLLOW_UP_LIST_MAX_LIMIT,
  FOLLOW_UP_STATUS_VALUES,
  FOLLOW_UP_SUMMARY_RANGES,
  type FollowUpCriticalSignal,
  type FollowUpStatus,
  type FollowUpSummaryRange
} from "@/lib/domains/follow-up-observability/constants";

const MAX_FREE_TEXT_LENGTH = 191; // matches crm_agent_actions.action_id/cancel_reason column width

export function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

export function internalError(): Response {
  return Response.json({ error: "internal_error" }, { status: 500 });
}

type ParseResult<T> = { ok: true; value: T } | { ok: false };

export function parseRange(raw: string | null): ParseResult<FollowUpSummaryRange | undefined> {
  if (raw === null) return { ok: true, value: undefined };
  if ((FOLLOW_UP_SUMMARY_RANGES as readonly string[]).includes(raw)) return { ok: true, value: raw as FollowUpSummaryRange };
  return { ok: false };
}

export function parseStatusList(raw: string | null): ParseResult<FollowUpStatus[] | undefined> {
  if (raw === null || raw.trim() === "") return { ok: true, value: undefined };
  const values = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (values.length === 0) return { ok: true, value: undefined };
  const isValid = values.every((value) => (FOLLOW_UP_STATUS_VALUES as readonly string[]).includes(value));
  if (!isValid) return { ok: false };
  return { ok: true, value: values as FollowUpStatus[] };
}

export function parseCriticality(raw: string | null): ParseResult<FollowUpCriticalSignal | undefined> {
  if (raw === null || raw.trim() === "") return { ok: true, value: undefined };
  if ((FOLLOW_UP_CRITICALITY_VALUES as readonly string[]).includes(raw)) return { ok: true, value: raw as FollowUpCriticalSignal };
  return { ok: false };
}

export function parsePositiveInt(raw: string | null): ParseResult<number | undefined> {
  if (raw === null || raw.trim() === "") return { ok: true, value: undefined };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false };
  return { ok: true, value: parsed };
}

export function parseFreeText(raw: string | null, maxLength: number = MAX_FREE_TEXT_LENGTH): ParseResult<string | undefined> {
  if (raw === null) return { ok: true, value: undefined };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed };
}

export function parsePage(raw: string | null): ParseResult<number> {
  if (raw === null || raw.trim() === "") return { ok: true, value: 1 };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false };
  return { ok: true, value: parsed };
}

/** Reject malformed input outright; clamp a merely-excessive value to the fixed max - same convention as the Sales Agent Configuration API's own parseListLimit. */
export function parseLimit(raw: string | null): ParseResult<number> {
  if (raw === null || raw.trim() === "") return { ok: true, value: FOLLOW_UP_LIST_DEFAULT_LIMIT };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return { ok: false };
  return { ok: true, value: Math.min(parsed, FOLLOW_UP_LIST_MAX_LIMIT) };
}
