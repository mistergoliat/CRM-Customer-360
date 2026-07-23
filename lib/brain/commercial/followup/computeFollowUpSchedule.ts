/**
 * ACS-R1-05.1-T02.3D. Deterministic, DST-safe follow-up scheduling for the
 * native runtime. The algorithm (local-time parts via Intl.DateTimeFormat,
 * zoned-local-to-UTC search) is ported from the dev-sandbox-only
 * lib/brain/commercial/follow-up-scheduling/calculateNextSchedule.ts -
 * deliberately a port, not a shared import: tests/commercial/
 * followUpRuntimeAuthority.test.ts statically enforces that no production
 * file imports that sandbox family, and crossing that boundary for "just an
 * import" would be more fragile than porting the ~60 lines of pure logic
 * this needs. No external date library is installed in this repo
 * (confirmed: no date-fns/luxon/dayjs in package.json) - Intl.DateTimeFormat
 * is the correct native tool, never a fixed UTC offset.
 */

export type FollowUpAllowedWindow = {
  timezone: string;
  startHour: number;
  endHour: number;
  allowedWeekdays: number[];
};

export type ComputeNextFollowUpScheduleInput = {
  /** 1-based attempt about to be scheduled. */
  attemptNumber: number;
  /** ISO timestamp of the original follow-up decision (attempt 1's reference point). */
  initialDecisionAt: string;
  /** Attempt N (N>1)'s reference point is attempt (N-1)'s own scheduled_for - never "now", so a worker that recovers a job late never compounds the delay. */
  previousAttemptScheduledFor: string | null;
  attemptDelaysMinutes: number[];
  allowedWindow: FollowUpAllowedWindow;
};

export type ComputeNextFollowUpScheduleResult =
  | { ok: true; scheduledFor: string; movedToAllowedWindow: boolean }
  | { ok: false; reason: "invalid_attempt_number" | "invalid_reference_instant" | "window_unreachable" };

/** Loop safety valve only - never exposed as user configuration, distinct from the business concept of maxOpportunityAgeDays. */
const WINDOW_SEARCH_MAX_DAYS = 14;

const WEEKDAY_BY_SHORT_NAME: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parseIso(iso: string): number | null {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function addMinutes(ms: number, minutes: number): number {
  return ms + Math.max(0, minutes) * 60_000;
}

function getLocalParts(instantMs: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(new Date(instantMs));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year") ?? 1970),
    month: Number(map.get("month") ?? 1),
    day: Number(map.get("day") ?? 1),
    hour: Number(map.get("hour") ?? 0),
    minute: Number(map.get("minute") ?? 0),
    second: Number(map.get("second") ?? 0),
    weekday: WEEKDAY_BY_SHORT_NAME[map.get("weekday") ?? "Sun"] ?? 0
  };
}

/** Converts a local wall-clock time in `timeZone` to the UTC instant it represents - handles DST transitions by iterating to a fixed point (max 8 tries, always converges for real timezones). */
function zonedLocalToUtcMs(timeZone: string, local: { year: number; month: number; day: number; hour: number; minute: number; second: number }): number {
  const targetMs = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  let guessMs = targetMs;
  for (let i = 0; i < 8; i += 1) {
    const parts = getLocalParts(guessMs, timeZone);
    const formattedMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = formattedMs - targetMs;
    if (delta === 0) return guessMs;
    guessMs -= delta;
  }
  return guessMs;
}

function isWithinAllowedWindow(instantMs: number, window: FollowUpAllowedWindow): boolean {
  const local = getLocalParts(instantMs, window.timezone);
  if (!window.allowedWeekdays.includes(local.weekday)) return false;
  return local.hour >= window.startHour && local.hour < window.endHour;
}

/** Finds the next instant (at or after candidateMs) that falls inside the allowed window - never before candidateMs, so this only ever pushes forward, never earlier. */
function findNextAllowedWindowStart(candidateMs: number, window: FollowUpAllowedWindow): number | null {
  const candidateParts = getLocalParts(candidateMs, window.timezone);

  if (window.allowedWeekdays.includes(candidateParts.weekday) && candidateParts.hour >= window.startHour && candidateParts.hour < window.endHour) {
    return candidateMs;
  }

  for (let dayOffset = 0; dayOffset <= WINDOW_SEARCH_MAX_DAYS; dayOffset += 1) {
    const base = getLocalParts(candidateMs + dayOffset * 86_400_000, window.timezone);
    const localDate = new Date(Date.UTC(base.year, base.month - 1, base.day));
    const dayIndex = localDate.getUTCDay();
    if (!window.allowedWeekdays.includes(dayIndex)) continue;

    const startMs = zonedLocalToUtcMs(window.timezone, {
      year: localDate.getUTCFullYear(),
      month: localDate.getUTCMonth() + 1,
      day: localDate.getUTCDate(),
      hour: window.startHour,
      minute: 0,
      second: 0
    });
    if (startMs >= candidateMs) return startMs;
  }

  return null;
}

/**
 * Computes attempt N's scheduled_for: raw target = initialDecisionAt +
 * delays[0] for attempt 1, or previousAttemptScheduledFor + delays[N-1] for
 * attempt N>1 (never "now") - then moved forward to the next instant inside
 * the allowed window, never discarded, never moved earlier.
 */
export function computeNextFollowUpSchedule(input: ComputeNextFollowUpScheduleInput): ComputeNextFollowUpScheduleResult {
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1 || input.attemptNumber > input.attemptDelaysMinutes.length) {
    return { ok: false, reason: "invalid_attempt_number" };
  }

  const delayMinutes = input.attemptDelaysMinutes[input.attemptNumber - 1];
  const referenceIso = input.attemptNumber === 1 ? input.initialDecisionAt : input.previousAttemptScheduledFor;
  if (!referenceIso) {
    return { ok: false, reason: "invalid_reference_instant" };
  }
  const referenceMs = parseIso(referenceIso);
  if (referenceMs === null) {
    return { ok: false, reason: "invalid_reference_instant" };
  }

  const rawTargetMs = addMinutes(referenceMs, delayMinutes);
  const alreadyInWindow = isWithinAllowedWindow(rawTargetMs, input.allowedWindow);
  if (alreadyInWindow) {
    return { ok: true, scheduledFor: toIso(rawTargetMs), movedToAllowedWindow: false };
  }

  const nextWindowMs = findNextAllowedWindowStart(rawTargetMs, input.allowedWindow);
  if (nextWindowMs === null) {
    return { ok: false, reason: "window_unreachable" };
  }
  return { ok: true, scheduledFor: toIso(nextWindowMs), movedToAllowedWindow: true };
}

/** Used by the worker (revalidation) to decide whether a due job is currently inside its allowed window - a job scheduled before a configuration change can end up outside a newly-tightened window and needs reprogramming, not cancellation. */
export function isInstantWithinAllowedWindow(iso: string, window: FollowUpAllowedWindow): boolean {
  const ms = parseIso(iso);
  if (ms === null) return false;
  return isWithinAllowedWindow(ms, window);
}

/** Used by the worker to reprogram a due-but-outside-window job to the next allowed instant, never earlier than `fromIso`. */
export function findNextAllowedWindowStartIso(fromIso: string, window: FollowUpAllowedWindow): string | null {
  const ms = parseIso(fromIso);
  if (ms === null) return null;
  const nextMs = findNextAllowedWindowStart(ms, window);
  return nextMs === null ? null : toIso(nextMs);
}
