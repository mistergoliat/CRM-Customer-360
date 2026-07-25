import assert from "node:assert/strict";
import test from "node:test";
import { maskWaId } from "@/lib/domains/follow-up-observability/maskWaId";
import {
  computeCriticalSignals,
  isExecutingStale,
  isMissingConfiguration,
  isMissingSchedule,
  isPlannedOverdue,
  isRequiresReview
} from "@/lib/domains/follow-up-observability/criticality";
import { buildFollowUpReason, labelForFollowUpStatus, labelForReasonCode, MISSING_CONFIGURATION_BADGE_LABEL } from "@/lib/domains/follow-up-observability/reasonLabels";
import { mapFollowUpRow, shortActionId } from "@/lib/domains/follow-up-observability/rowMapper";
import { FOLLOW_UP_EXECUTING_STALE_SECONDS, FOLLOW_UP_PLANNED_OVERDUE_MINUTES } from "@/lib/domains/follow-up-observability/constants";
import {
  parseCriticality,
  parseFreeText,
  parseLimit,
  parsePage,
  parsePositiveInt,
  parseRange,
  parseStatusList
} from "@/app/api/brain/agents/sales/follow-ups/_lib/httpHelpers";

// ---------------------------------------------------------------------------
// Decision 3: wa_id masking - server-side only, fixed format, last 4 chars.
// ---------------------------------------------------------------------------

test("maskWaId masks everything except the last 4 characters", () => {
  assert.equal(maskWaId("56911112222"), "********2222");
  assert.equal(maskWaId("+56911112222"), "********2222");
});

test("maskWaId returns null for null/undefined/empty", () => {
  assert.equal(maskWaId(null), null);
  assert.equal(maskWaId(undefined), null);
  assert.equal(maskWaId("   "), null);
});

test("maskWaId never leaks more than the last 4 characters even on a short input", () => {
  const masked = maskWaId("123");
  assert.equal(masked, "********123");
  assert.ok(!masked!.startsWith("123********"));
});

// ---------------------------------------------------------------------------
// Decisions 4/5: planned overdue (15 min) / executing stale (same 300s the
// worker itself uses - never a second copy of the constant).
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-01-15T12:00:00.000Z");

test("isPlannedOverdue is true only for status=planned scheduled more than 15 minutes ago", () => {
  const overdue = new Date(NOW - (FOLLOW_UP_PLANNED_OVERDUE_MINUTES + 1) * 60_000).toISOString();
  const recent = new Date(NOW - (FOLLOW_UP_PLANNED_OVERDUE_MINUTES - 1) * 60_000).toISOString();
  assert.equal(isPlannedOverdue("planned", overdue, NOW), true);
  assert.equal(isPlannedOverdue("planned", recent, NOW), false);
  assert.equal(isPlannedOverdue("executing", overdue, NOW), false);
  assert.equal(isPlannedOverdue("planned", null, NOW), false);
});

test("isExecutingStale reuses the production 300s threshold", () => {
  assert.equal(FOLLOW_UP_EXECUTING_STALE_SECONDS, 300);
  const stale = new Date(NOW - (FOLLOW_UP_EXECUTING_STALE_SECONDS + 1) * 1000).toISOString();
  const fresh = new Date(NOW - (FOLLOW_UP_EXECUTING_STALE_SECONDS - 1) * 1000).toISOString();
  assert.equal(isExecutingStale("executing", stale, NOW), true);
  assert.equal(isExecutingStale("executing", fresh, NOW), false);
  assert.equal(isExecutingStale("planned", stale, NOW), false);
});

test("isMissingSchedule / isMissingConfiguration / isRequiresReview", () => {
  assert.equal(isMissingSchedule("planned", null), true);
  assert.equal(isMissingSchedule("planned", "2026-01-01T00:00:00.000Z"), false);
  assert.equal(isMissingSchedule("executing", null), false);
  assert.equal(isMissingConfiguration(null), true);
  assert.equal(isMissingConfiguration(undefined), true);
  assert.equal(isMissingConfiguration("published"), false);
  assert.equal(isRequiresReview("requires_review"), true);
  assert.equal(isRequiresReview("planned"), false);
});

test("computeCriticalSignals combines independent signals (missing_configuration + planned_overdue)", () => {
  const overdue = new Date(NOW - (FOLLOW_UP_PLANNED_OVERDUE_MINUTES + 5) * 60_000).toISOString();
  const signals = computeCriticalSignals(
    { status: "planned", scheduledFor: overdue, updatedAt: null, followupConfigurationSource: null },
    NOW
  );
  assert.deepEqual(signals.sort(), ["missing_configuration", "planned_overdue"].sort());
});

test("computeCriticalSignals returns empty for a healthy executed row", () => {
  const signals = computeCriticalSignals(
    { status: "executed", scheduledFor: null, updatedAt: null, followupConfigurationSource: "published" },
    NOW
  );
  assert.deepEqual(signals, []);
});

// ---------------------------------------------------------------------------
// Decisions 6/7/8: reason labels, missing-configuration badge, exact
// requires_review copy.
// ---------------------------------------------------------------------------

test("labelForFollowUpStatus requires_review uses the exact approved copy", () => {
  assert.equal(labelForFollowUpStatus("requires_review"), "Requiere revisión — sin flujo de aprobación disponible");
});

test("labelForFollowUpStatus falls back to the raw status for unmapped values", () => {
  assert.equal(labelForFollowUpStatus("some_future_status"), "some_future_status");
});

test("MISSING_CONFIGURATION_BADGE_LABEL matches the approved copy", () => {
  assert.equal(MISSING_CONFIGURATION_BADGE_LABEL, "Sin configuración asociada");
});

test("labelForReasonCode maps known codes and falls back to the code itself", () => {
  assert.equal(labelForReasonCode("customer_opted_out"), "Cliente se dio de baja");
  assert.equal(labelForReasonCode("some_unmapped_code"), "some_unmapped_code");
  assert.equal(labelForReasonCode(null), "");
});

test("buildFollowUpReason prefers cancel_reason over failure_reason", () => {
  assert.deepEqual(buildFollowUpReason("customer_opted_out", "some_error"), {
    type: "cancel",
    code: "customer_opted_out",
    label: "Cliente se dio de baja"
  });
  assert.deepEqual(buildFollowUpReason(null, "follow_up_stale_execution_exhausted"), {
    type: "failure",
    code: "follow_up_stale_execution_exhausted",
    label: "Ejecución abandonada sin intentos restantes"
  });
  assert.deepEqual(buildFollowUpReason(null, null), { type: null, code: null, label: "" });
});

// ---------------------------------------------------------------------------
// rowMapper: never selects/exposes policy_notes_json; masks wa_id.
// ---------------------------------------------------------------------------

test("shortActionId truncates long ids, leaves short ones untouched", () => {
  assert.equal(shortActionId("abc"), "abc");
  const long = "schedule_followup-1234567890abcdef";
  const short = shortActionId(long);
  assert.equal(short, `…${long.slice(-8)}`);
  assert.ok(short.length < long.length);
});

test("mapFollowUpRow maps a raw DB row without ever touching policy_notes_json", () => {
  const item = mapFollowUpRow(
    {
      action_id: "followup-action-1",
      status: "cancelled",
      opportunity_id: 42,
      opportunity_key: "OPP-42",
      conversation_case_id: 7,
      wa_id: "56911112222",
      attempt_number: 2,
      max_attempts: 3,
      scheduled_for: "2026-01-15T10:00:00.000Z",
      cancel_reason: "customer_opted_out",
      failure_reason: null,
      followup_configuration_source: "published",
      followup_configuration_version: 4,
      updated_at: "2026-01-15T11:00:00.000Z"
    },
    NOW
  );

  assert.equal(item.actionId, "followup-action-1");
  assert.equal(item.waIdMasked, "********2222");
  assert.equal(item.opportunityId, 42);
  assert.equal(item.opportunityKey, "OPP-42");
  assert.equal(item.attemptNumber, 2);
  assert.equal(item.maxAttempts, 3);
  assert.equal(item.reason.code, "customer_opted_out");
  assert.equal(item.configuration.source, "published");
  assert.equal(item.configuration.version, 4);
  assert.ok(!("policy_notes_json" in (item as unknown as Record<string, unknown>)));
});

// ---------------------------------------------------------------------------
// Strict query-param validation (shared by the page and the API routes).
// ---------------------------------------------------------------------------

test("parseRange accepts the fixed enum, rejects anything else", () => {
  assert.deepEqual(parseRange("24h"), { ok: true, value: "24h" });
  assert.deepEqual(parseRange(null), { ok: true, value: undefined });
  assert.deepEqual(parseRange("90d"), { ok: false });
});

test("parseStatusList validates every comma-separated value against the fixed enum", () => {
  assert.deepEqual(parseStatusList("planned,executing"), { ok: true, value: ["planned", "executing"] });
  assert.deepEqual(parseStatusList(null), { ok: true, value: undefined });
  assert.deepEqual(parseStatusList("planned,not_a_status"), { ok: false });
});

test("parseCriticality validates against the fixed enum", () => {
  assert.deepEqual(parseCriticality("executing_stale"), { ok: true, value: "executing_stale" });
  assert.deepEqual(parseCriticality("bogus"), { ok: false });
});

test("parsePositiveInt rejects non-integers, negatives and zero", () => {
  assert.deepEqual(parsePositiveInt("42"), { ok: true, value: 42 });
  assert.deepEqual(parsePositiveInt(null), { ok: true, value: undefined });
  assert.deepEqual(parsePositiveInt("0"), { ok: false });
  assert.deepEqual(parsePositiveInt("-1"), { ok: false });
  assert.deepEqual(parsePositiveInt("abc"), { ok: false });
});

test("parseFreeText caps length and trims", () => {
  assert.deepEqual(parseFreeText("  hello  "), { ok: true, value: "hello" });
  assert.deepEqual(parseFreeText("a".repeat(500)), { ok: false });
});

test("parsePage rejects malformed page numbers", () => {
  assert.deepEqual(parsePage(null), { ok: true, value: 1 });
  assert.deepEqual(parsePage("2"), { ok: true, value: 2 });
  assert.deepEqual(parsePage("0"), { ok: false });
  assert.deepEqual(parsePage("-3"), { ok: false });
});

test("parseLimit rejects malformed values, clamps merely-excessive ones", () => {
  assert.deepEqual(parseLimit(null), { ok: true, value: 25 });
  assert.deepEqual(parseLimit("50"), { ok: true, value: 50 });
  assert.deepEqual(parseLimit("999999"), { ok: true, value: 100 });
  assert.deepEqual(parseLimit("-1"), { ok: false });
  assert.deepEqual(parseLimit("abc"), { ok: false });
});
