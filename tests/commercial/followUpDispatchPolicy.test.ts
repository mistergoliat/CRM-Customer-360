import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  computeQuietHoursActive,
  evaluateFollowUpDispatchPolicy,
  mapCommercialPolicyStatusToDispatchDecision,
  type FollowUpDispatchChannelSignals
} from "@/lib/brain/commercial/sales-consultative/followUpDispatchPolicy";

// ACS-R1-05-T02. Pure tests only - no DB. Real MariaDB coverage for the
// channel-signal sources (conversation, crm_customer_onboarding_state) lives
// in tests/commercial/salesConsultativeFollowUpRepository.test.ts.

const DAYTIME = "2026-01-15T18:00:00.000Z"; // 15:00 America/Santiago (summer/DST) - clearly outside quiet hours.

function cleanSignals(overrides: Partial<FollowUpDispatchChannelSignals> = {}): FollowUpDispatchChannelSignals {
  return {
    channel: "whatsapp",
    available: true,
    outboundAllowed: true,
    manualApprovalRequired: false,
    optOut: false,
    quietHoursActive: false,
    humanOwnerActive: false,
    aiBlocked: false,
    identityConflict: false,
    recentCustomerReply: false,
    recentHumanContact: false,
    ...overrides
  };
}

test("[1] allowed -> decision allow", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: cleanSignals()
  });
  assert.equal(result.decision, "allow");
  assert.equal(result.policyStatus, "allowed");
});

test("[2] allowed_with_restrictions mapea a allow igual que allowed", () => {
  assert.equal(mapCommercialPolicyStatusToDispatchDecision("allowed"), "allow");
  assert.equal(mapCommercialPolicyStatusToDispatchDecision("allowed_with_restrictions"), "allow");
});

test("[3] requires_review -> decision require_review, nunca allow", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: cleanSignals({ humanOwnerActive: true })
  });
  assert.equal(result.decision, "require_review");
  assert.equal(result.policyStatus, "requires_review");
  assert.notEqual(result.decision, "allow");
});

test("[4] opt-out -> decision deny", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: cleanSignals({ optOut: true })
  });
  assert.equal(result.decision, "deny");
  assert.ok(result.reasonCodes.includes("opt_out_active"));
});

test("[5] identity conflict -> decision deny", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: cleanSignals({ identityConflict: true })
  });
  assert.equal(result.decision, "deny");
  assert.ok(result.reasonCodes.includes("identity_conflict"));
});

test("[6] AI blocked -> decision deny", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: cleanSignals({ aiBlocked: true })
  });
  assert.equal(result.decision, "deny");
  assert.ok(result.reasonCodes.includes("ai_blocked"));
});

test("[7] quiet hours -> decision require_review, nunca allow (nunca planned)", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: cleanSignals({ quietHoursActive: true })
  });
  assert.equal(result.decision, "require_review");
  assert.notEqual(result.decision, "allow");
  assert.ok(result.reasonCodes.includes("quiet_hours_active"));
});

test("[7b] computeQuietHoursActive usa hora y timezone explicitos, no la del servidor", () => {
  // 22:00 UTC on 2026-01-15 is 19:00 America/Santiago (still daytime) -
  // proves the check is timezone-aware, not a raw UTC-hour comparison.
  assert.equal(computeQuietHoursActive("2026-01-15T22:00:00.000Z", "America/Santiago"), false);
  // 00:30 UTC on 2026-01-16 is 21:30 America/Santiago the previous day - inside quiet hours.
  assert.equal(computeQuietHoursActive("2026-01-16T00:30:00.000Z", "America/Santiago"), true);
  // 12:15 UTC on 2026-01-15 is 09:15 America/Santiago - just past the 09:00 end boundary.
  assert.equal(computeQuietHoursActive("2026-01-15T12:15:00.000Z", "America/Santiago"), false);
  // An unparseable time fails closed (treated as quiet hours) rather than allowing dispatch.
  assert.equal(computeQuietHoursActive("not-a-real-timestamp", "America/Santiago"), true);
});

test("[8] policy disabled -> failed_safe", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: false,
    channelSignals: cleanSignals()
  });
  assert.equal(result.decision, "failed_safe");
  assert.equal(result.policyStatus, "failed_safe");
  assert.ok(result.reasonCodes.includes("policy_disabled"));
});

test("[9] input invalido (currentTime no parseable) -> failed_safe", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: "not-a-real-timestamp",
    policyEnabled: true,
    channelSignals: cleanSignals()
  });
  assert.equal(result.decision, "failed_safe");
  assert.equal(result.policyStatus, "failed_safe");
});

test("[10] version mismatch -> failed_safe", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: cleanSignals(),
    policyVersionOverride: "brain.commercial.policy.v0-does-not-exist"
  });
  assert.equal(result.decision, "failed_safe");
  assert.equal(result.policyStatus, "failed_safe");
});

test("[10b] fuente de senal de canal fallida (query tecnica) -> failed_safe, nunca allowed=false invertido a permitido", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: null,
    channelSignalsWarning: "conversation_channel_query_failed"
  });
  assert.equal(result.decision, "failed_safe");
  assert.ok(result.reasonCodes.includes("conversation_channel_query_failed"));
});

test("[11] resultado sanitizado: solo codigos cortos conocidos, nunca PII cruda", () => {
  const result = evaluateFollowUpDispatchPolicy({
    currentTime: DAYTIME,
    policyEnabled: true,
    channelSignals: cleanSignals({ optOut: true, identityConflict: true, humanOwnerActive: true })
  });
  const allowedReasonCodes = new Set([
    "opt_out_active",
    "quiet_hours_active",
    "identity_conflict",
    "ai_blocked",
    "human_owner_active",
    "conversation_unavailable",
    "policy_disabled",
    "policy_evaluation_failed_safe",
    "channel_signal_source_unavailable"
  ]);
  for (const code of result.reasonCodes) {
    assert.ok(allowedReasonCodes.has(code), `unexpected reason code leaked: ${code}`);
    assert.ok(code.length < 40);
    assert.doesNotMatch(code, /\d{6,}/, "reason code must not embed a phone/id-like number");
    assert.doesNotMatch(code, /@/, "reason code must not embed an email");
  }
  for (const note of result.policyNotes) {
    assert.doesNotMatch(note, /\d{6,}/);
    assert.doesNotMatch(note, /@/);
  }
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /\+?56\d{8,9}/, "must not embed a wa_id/phone number");
});

test("[12] el adapter no depende de flags ni modulos llamados shadow", () => {
  const source = readFileSync(
    path.resolve(__dirname, "../../lib/brain/commercial/sales-consultative/followUpDispatchPolicy.ts"),
    "utf8"
  );
  // Comments are allowed to explain *why* shadow is not used; the adapter
  // must not import from a shadow module or read a shadow-named flag.
  assert.doesNotMatch(source, /from\s+["'][^"']*shadow[^"']*["']/i, "must not import from a shadow module");
  assert.doesNotMatch(source, /BRAIN_COMMERCIAL_SHADOW_ENABLED/);
  assert.doesNotMatch(source, /BRAIN_COMMERCIAL_SHADOW_ALLOW_REAL_PROVIDER/);
  assert.doesNotMatch(source, /runCommercialShadowEvaluation\s*\(/);
});
