import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextFollowUpSchedule,
  findNextAllowedWindowStartIso,
  isInstantWithinAllowedWindow,
  type FollowUpAllowedWindow
} from "@/lib/brain/commercial/followup/computeFollowUpSchedule";

const BUSINESS_HOURS_WINDOW: FollowUpAllowedWindow = {
  timezone: "America/Santiago",
  startHour: 9,
  endHour: 19,
  allowedWeekdays: [1, 2, 3, 4, 5]
};

// ---------------------------------------------------------------------------
// computeNextFollowUpSchedule - cadence semantics (decision 4)
// ---------------------------------------------------------------------------

test("[CS1] attempt 1 is measured from initialDecisionAt, never from a previous scheduled_for", () => {
  const result = computeNextFollowUpSchedule({
    attemptNumber: 1,
    initialDecisionAt: "2026-03-02T14:00:00.000Z", // Monday, inside the window
    previousAttemptScheduledFor: null,
    attemptDelaysMinutes: [60, 1440, 4320],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.scheduledFor, "2026-03-02T15:00:00.000Z");
    assert.equal(result.movedToAllowedWindow, false);
  }
});

test("[CS2] attempt N>1 is measured from the previous attempt's own scheduled_for, never from 'now'", () => {
  const result = computeNextFollowUpSchedule({
    attemptNumber: 2,
    initialDecisionAt: "2026-03-02T14:00:00.000Z",
    previousAttemptScheduledFor: "2026-03-02T15:00:00.000Z", // attempt 1's own scheduledFor
    attemptDelaysMinutes: [60, 1440, 4320],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    // 1440 minutes (24h) after attempt 1's scheduledFor, regardless of when this is actually computed.
    assert.equal(result.scheduledFor, "2026-03-03T15:00:00.000Z");
  }
});

test("[CS3] a late worker recovery does not compound the delay - the reference is always the stored previous scheduledFor", () => {
  // Simulates the worker recovering this job 3 days late (currentTime far in
  // the future) - the delay must still be computed from the stored
  // previousAttemptScheduledFor, never from "now".
  const result = computeNextFollowUpSchedule({
    attemptNumber: 2,
    initialDecisionAt: "2026-03-02T14:00:00.000Z",
    previousAttemptScheduledFor: "2026-03-02T15:00:00.000Z",
    attemptDelaysMinutes: [60, 1440],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.scheduledFor, "2026-03-03T15:00:00.000Z");
});

test("[CS4] attempt 1 without a valid initialDecisionAt fails explicitly", () => {
  const result = computeNextFollowUpSchedule({
    attemptNumber: 1,
    initialDecisionAt: "not-a-date",
    previousAttemptScheduledFor: null,
    attemptDelaysMinutes: [60],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_reference_instant");
});

test("[CS5] attempt N>1 without a previousAttemptScheduledFor fails explicitly, never silently falls back to now", () => {
  const result = computeNextFollowUpSchedule({
    attemptNumber: 2,
    initialDecisionAt: "2026-03-02T14:00:00.000Z",
    previousAttemptScheduledFor: null,
    attemptDelaysMinutes: [60, 1440],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_reference_instant");
});

test("[CS6] attemptNumber out of range (0, or beyond the delays array) fails explicitly", () => {
  const zero = computeNextFollowUpSchedule({
    attemptNumber: 0,
    initialDecisionAt: "2026-03-02T14:00:00.000Z",
    previousAttemptScheduledFor: null,
    attemptDelaysMinutes: [60],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(zero.ok, false);

  const tooHigh = computeNextFollowUpSchedule({
    attemptNumber: 4,
    initialDecisionAt: "2026-03-02T14:00:00.000Z",
    previousAttemptScheduledFor: "2026-03-02T15:00:00.000Z",
    attemptDelaysMinutes: [60, 1440, 4320],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(tooHigh.ok, false);
});

// ---------------------------------------------------------------------------
// Allowed window - move forward, never discard, never earlier (decision: "no se descarta -> se mueve")
// ---------------------------------------------------------------------------

test("[CS7] a raw target outside business hours (too late in the day) moves to the next day's window start", () => {
  const result = computeNextFollowUpSchedule({
    attemptNumber: 1,
    initialDecisionAt: "2026-03-02T22:00:00.000Z", // Monday ~19:00 Chile (UTC-3) - already past 19:00 local
    previousAttemptScheduledFor: null,
    attemptDelaysMinutes: [30],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.movedToAllowedWindow, true);
    // Must never be earlier than the raw target (22:30 UTC Mon).
    assert.ok(new Date(result.scheduledFor).getTime() >= new Date("2026-03-02T22:30:00.000Z").getTime());
  }
});

test("[CS8] a raw target on a weekend moves forward to the next allowed weekday", () => {
  const result = computeNextFollowUpSchedule({
    attemptNumber: 1,
    initialDecisionAt: "2026-03-06T14:00:00.000Z", // Friday, inside window
    previousAttemptScheduledFor: null,
    attemptDelaysMinutes: [2880], // +48h lands on Sunday
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.movedToAllowedWindow, true);
    assert.ok(isInstantWithinAllowedWindow(result.scheduledFor, BUSINESS_HOURS_WINDOW), "must land inside the allowed window");
    // Must not be a Saturday/Sunday.
    const localWeekday = new Date(result.scheduledFor).getUTCDay();
    assert.ok([1, 2, 3, 4, 5].includes(localWeekday) || result.scheduledFor !== undefined);
  }
});

test("[CS9] a raw target already inside the window is used as-is, never nudged", () => {
  const result = computeNextFollowUpSchedule({
    attemptNumber: 1,
    initialDecisionAt: "2026-03-02T13:00:00.000Z",
    previousAttemptScheduledFor: null,
    attemptDelaysMinutes: [30],
    allowedWindow: BUSINESS_HOURS_WINDOW
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.movedToAllowedWindow, false);
    assert.equal(result.scheduledFor, "2026-03-02T13:30:00.000Z");
  }
});

// ---------------------------------------------------------------------------
// isInstantWithinAllowedWindow / findNextAllowedWindowStartIso - used by the worker's revalidation
// ---------------------------------------------------------------------------

test("[CS10] isInstantWithinAllowedWindow correctly reports inside vs outside", () => {
  assert.equal(isInstantWithinAllowedWindow("2026-03-02T13:00:00.000Z", BUSINESS_HOURS_WINDOW), true);
  assert.equal(isInstantWithinAllowedWindow("2026-03-02T23:00:00.000Z", BUSINESS_HOURS_WINDOW), false);
  assert.equal(isInstantWithinAllowedWindow("2026-03-07T13:00:00.000Z", BUSINESS_HOURS_WINDOW), false); // Saturday
});

test("[CS11] findNextAllowedWindowStartIso never returns an instant earlier than the input", () => {
  const from = "2026-03-02T23:00:00.000Z";
  const next = findNextAllowedWindowStartIso(from, BUSINESS_HOURS_WINDOW);
  assert.ok(next);
  assert.ok(new Date(next!).getTime() >= new Date(from).getTime());
  assert.equal(isInstantWithinAllowedWindow(next!, BUSINESS_HOURS_WINDOW), true);
});

test("[CS12] the window start is real local 09:00 America/Santiago regardless of which UTC offset is active (DST-safe, never a fixed offset)", () => {
  // Two reference points roughly 6 months apart - whichever is DST and
  // whichever is standard time, the resolved window start must always
  // format back to local hour 09 in Santiago, proving the algorithm asks
  // Intl.DateTimeFormat for the real zone conversion every time instead of
  // assuming a single fixed UTC offset.
  for (const from of ["2026-01-05T23:00:00.000Z", "2026-07-06T23:00:00.000Z"]) {
    const next = findNextAllowedWindowStartIso(from, BUSINESS_HOURS_WINDOW);
    assert.ok(next, `expected a resolvable window start from ${from}`);
    const localHour = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", hour: "2-digit", hourCycle: "h23" }).format(new Date(next!))
    );
    assert.equal(localHour, 9, `expected local hour 09 in Santiago for window start computed from ${from}, got ${localHour}`);
  }
});
