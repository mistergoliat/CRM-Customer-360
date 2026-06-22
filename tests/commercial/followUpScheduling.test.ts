import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  calculateNextSchedule,
  evaluateFollowUpSchedule,
  type FollowUpSchedulingInput,
  type FollowUpSchedulingResult
} from "../../lib/brain/commercial/follow-up-scheduling";

const FIXED_NOW = "2026-06-17T12:00:00.000Z";

type FollowUpSchedulingTestOverrides = {
  now?: string;
  action?: Partial<FollowUpSchedulingInput["action"]>;
  activity?: Partial<FollowUpSchedulingInput["activity"]>;
  context?: Partial<FollowUpSchedulingInput["context"]>;
  policy?: Partial<FollowUpSchedulingInput["policy"]>;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function shiftIso(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

function findIsoWithUtcDay(iso: string, targetDay: number): string {
  let cursor = iso;
  for (let i = 0; i < 14; i += 1) {
    if (new Date(cursor).getUTCDay() === targetDay) {
      return cursor;
    }
    cursor = shiftIso(cursor, 1);
  }
  throw new Error(`Unable to find UTC day ${targetDay}.`);
}

function makeInput(overrides: FollowUpSchedulingTestOverrides = {}): FollowUpSchedulingInput {
  const base: FollowUpSchedulingInput = {
    now: FIXED_NOW,
    action: {
      actionId: "action-001",
      idempotencyKey: "sched:test-001",
      actionType: "schedule_followup",
      status: "proposed",
      createdAt: "2026-06-17T10:00:00.000Z",
      updatedAt: null,
      scheduledFor: "2026-06-17T13:00:00.000Z",
      expiresAt: "2026-06-18T12:00:00.000Z",
      attemptCount: 0,
      maxAttempts: 3,
      riskLevel: "low",
      approvalRequirement: "none",
      opportunityId: "opp-001",
      conversationCaseId: "case-001",
      waId: "56912345678",
      blockReasons: [],
      cancelReason: null
    },
    activity: {
      lastInboundAt: null,
      lastOutboundAt: null,
      lastHumanMessageAt: null,
      lastAiMessageAt: null
    },
    context: {
      caseStatus: "open",
      lifecycleStatus: "open",
      humanOwnerActive: false,
      aiBlocked: false,
      requiresHuman: false,
      opportunityStatus: "open",
      opportunityStage: "qualifying",
      opportunityStageChangedAt: null,
      policyStatus: "allowed",
      conflictingActionExists: false,
      duplicateActionExists: false
    },
    policy: {
      followUpEnabled: true,
      allowedActionTypes: ["schedule_followup", "send_followup_message", "request_more_context"],
      maxRiskLevel: "high",
      cooldownMinutesAfterInbound: 0,
      cooldownMinutesAfterOutbound: 0,
      businessHoursEnabled: false,
      businessTimezone: "UTC",
      businessDays: [1, 2, 3, 4, 5],
      businessStartHour: 9,
      businessEndHour: 17,
      replanOutsideBusinessHours: false,
      replanAfterCooldown: false,
      requireExpiry: false,
      maxFutureDays: 30
    }
  };

  const hasOverride = (key: keyof FollowUpSchedulingInput) =>
    Object.prototype.hasOwnProperty.call(overrides, key);

  return {
    ...base,
    ...overrides,
    action: hasOverride("action") ? { ...base.action, ...(overrides.action ?? {}) } : base.action,
    activity: hasOverride("activity") ? { ...base.activity, ...(overrides.activity ?? {}) } : base.activity,
    context: hasOverride("context") ? { ...base.context, ...(overrides.context ?? {}) } : base.context,
    policy: hasOverride("policy") ? { ...base.policy, ...(overrides.policy ?? {}) } : base.policy
  } satisfies FollowUpSchedulingInput;
}

function expectDecision(
  result: FollowUpSchedulingResult,
  decision: FollowUpSchedulingResult["decision"],
  reason: string
): void {
  assert.equal(result.decision, decision);
  assert.equal(result.reasons.includes(reason as FollowUpSchedulingResult["reasons"][number]), true);
}

function readSchedulingSources(): string {
  const folder = resolve(process.cwd(), "lib/brain/commercial/follow-up-scheduling");
  const files = readdirSync(folder).filter((file) => file.endsWith(".ts"));
  const testFile = resolve(process.cwd(), "tests/commercial/followUpScheduling.test.ts");
  return [...files.map((file) => readFileSync(resolve(folder, file), "utf8")), readFileSync(testFile, "utf8")].join("\n");
}

function hasForbiddenSourceText(source: string): boolean {
  const pattern = new RegExp(
    [
      "D" + "ate\\.now",
      "set" + "Timeout",
      "set" + "Interval",
      "my" + "sql2",
      "from ['\"]" + "pg" + "['\"]",
      "supa" + "base",
      "IN" + "SERT ",
      "UP" + "DATE ",
      "DE" + "LETE ",
      "send" + "WhatsApp",
      "graph\\.facebook",
      "brain_" + "message_" + "outbox"
    ].join("|"),
    ""
  );

  return pattern.test(source);
}

test("missing action id is invalid", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { actionId: "" } }));

  expectDecision(result, "invalid", "missing_action_id");
});

test("missing idempotency key is invalid", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { idempotencyKey: null } }));

  expectDecision(result, "invalid", "missing_idempotency_key");
});

test("unsupported action type is invalid", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { actionType: "send_whatsapp_reply" } }));

  expectDecision(result, "invalid", "unsupported_action_type");
});

test("status not allowed is invalid", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { status: "draft" } }));

  expectDecision(result, "invalid", "invalid_action_status");
});

test("terminal action never becomes ready", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { status: "executed" } }));

  expectDecision(result, "invalid", "invalid_action_status");
});

test("follow-up disabled cancels the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ policy: { followUpEnabled: false } }));

  expectDecision(result, "cancel", "follow_up_not_allowed");
});

test("risk too high blocks the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { riskLevel: "critical" } }));

  expectDecision(result, "block", "risk_too_high");
});

test("approval required blocks the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { status: "proposed", approvalRequirement: "operator_review" } }));

  expectDecision(result, "block", "approval_required");
});

test("human owner active cancels the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ context: { humanOwnerActive: true } }));

  expectDecision(result, "cancel", "human_owner_active");
});

test("ai blocked blocks the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ context: { aiBlocked: true } }));

  expectDecision(result, "block", "ai_blocked");
});

test("requires human blocks the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ context: { requiresHuman: true } }));

  expectDecision(result, "block", "case_requires_human");
});

test("closed case cancels the action", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      context: {
        caseStatus: "closed",
        lifecycleStatus: "closed"
      }
    })
  );

  expectDecision(result, "cancel", "case_closed");
});

test("opportunity won cancels the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ context: { opportunityStatus: "won" } }));

  expectDecision(result, "cancel", "opportunity_closed_won");
});

test("opportunity lost cancels the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ context: { opportunityStatus: "lost" } }));

  expectDecision(result, "cancel", "opportunity_closed_lost");
});

test("opportunity paused blocks the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ context: { opportunityStatus: "paused" } }));

  expectDecision(result, "block", "opportunity_paused");
});

test("customer reply after action creation cancels the action", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      activity: {
        lastInboundAt: "2026-06-17T10:30:00.000Z"
      }
    })
  );

  expectDecision(result, "cancel", "customer_replied_after_action_created");
});

test("duplicate action cancels the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ context: { duplicateActionExists: true } }));

  expectDecision(result, "cancel", "duplicate_action");
});

test("conflicting action blocks the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ context: { conflictingActionExists: true } }));

  expectDecision(result, "block", "conflicting_action");
});

test("max attempts reached expires the action", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { attemptCount: 3, maxAttempts: 3 } }));

  expectDecision(result, "expire", "max_attempts_reached");
});

test("expired action expires before ready", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        scheduledFor: "2026-06-17T11:30:00.000Z",
        expiresAt: "2026-06-17T11:45:00.000Z"
      }
    })
  );

  expectDecision(result, "expire", "action_expired");
});

test("missing schedule is invalid", () => {
  const result = evaluateFollowUpSchedule(makeInput({ action: { scheduledFor: null } }));

  expectDecision(result, "invalid", "missing_schedule");
});

test("scheduled time not reached waits", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        scheduledFor: "2026-06-17T13:30:00.000Z"
      }
    })
  );

  expectDecision(result, "wait", "scheduled_time_not_reached");
  assert.equal(result.nextScheduledFor, null);
});

test("scheduled time reached becomes ready", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        scheduledFor: "2026-06-17T11:30:00.000Z",
        status: "scheduled"
      }
    })
  );

  expectDecision(result, "ready", "scheduled_time_reached");
  assert.equal(result.actionable, true);
});

test("inbound cooldown waits when replanning is off", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        createdAt: "2026-06-17T11:55:00.000Z",
        scheduledFor: "2026-06-17T12:30:00.000Z"
      },
      activity: {
        lastInboundAt: "2026-06-17T11:50:00.000Z"
      },
      policy: {
        cooldownMinutesAfterInbound: 60,
        replanAfterCooldown: false
      }
    })
  );

  expectDecision(result, "wait", "cooldown_active");
  assert.equal(result.effectiveScheduledFor, "2026-06-17T12:50:00.000Z");
});

test("inbound cooldown replans when enabled", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        createdAt: "2026-06-17T11:55:00.000Z",
        scheduledFor: "2026-06-17T12:30:00.000Z"
      },
      activity: {
        lastInboundAt: "2026-06-17T11:50:00.000Z"
      },
      policy: {
        cooldownMinutesAfterInbound: 60,
        replanAfterCooldown: true
      }
    })
  );

  expectDecision(result, "replan", "replanned_after_cooldown");
  assert.equal(result.nextScheduledFor, "2026-06-17T12:50:00.000Z");
});

test("outbound cooldown waits when replanning is off", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        scheduledFor: "2026-06-17T12:30:00.000Z"
      },
      activity: {
        lastOutboundAt: "2026-06-17T11:50:00.000Z"
      },
      policy: {
        cooldownMinutesAfterOutbound: 60,
        replanAfterCooldown: false
      }
    })
  );

  expectDecision(result, "wait", "cooldown_active");
  assert.equal(result.effectiveScheduledFor, "2026-06-17T12:50:00.000Z");
});

test("outbound cooldown replans when enabled", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        scheduledFor: "2026-06-17T12:30:00.000Z"
      },
      activity: {
        lastOutboundAt: "2026-06-17T11:50:00.000Z"
      },
      policy: {
        cooldownMinutesAfterOutbound: 60,
        replanAfterCooldown: true
      }
    })
  );

  expectDecision(result, "replan", "replanned_after_recent_outbound");
  assert.equal(result.nextScheduledFor, "2026-06-17T12:50:00.000Z");
});

test("outside business hours waits when replanning is off", () => {
  const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
  const result = evaluateFollowUpSchedule(
    makeInput({
      now: saturday,
      action: {
        scheduledFor: "2026-06-20T20:00:00.000Z",
        expiresAt: "2026-06-25T12:00:00.000Z"
      },
      policy: {
        businessHoursEnabled: true,
        businessTimezone: "UTC",
        businessDays: [1, 2, 3, 4, 5],
        businessStartHour: 9,
        businessEndHour: 17,
        replanOutsideBusinessHours: false
      }
    })
  );

  expectDecision(result, "wait", "outside_business_hours");
});

test("outside business hours replans when enabled", () => {
  const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
  const result = evaluateFollowUpSchedule(
    makeInput({
      now: saturday,
      action: {
        scheduledFor: "2026-06-20T20:00:00.000Z",
        expiresAt: "2026-06-25T12:00:00.000Z"
      },
      policy: {
        businessHoursEnabled: true,
        businessTimezone: "UTC",
        businessDays: [1, 2, 3, 4, 5],
        businessStartHour: 9,
        businessEndHour: 17,
        replanOutsideBusinessHours: true
      }
    })
  );

  expectDecision(result, "replan", "replanned_for_business_hours");
  assert.equal(result.nextScheduledFor?.endsWith("09:00:00.000Z"), true);
});

test("weekend replans to the next business day", () => {
  const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
  const result = evaluateFollowUpSchedule(
    makeInput({
      now: saturday,
      action: {
        scheduledFor: "2026-06-20T20:00:00.000Z",
        expiresAt: "2026-06-25T12:00:00.000Z"
      },
      policy: {
        businessHoursEnabled: true,
        businessTimezone: "UTC",
        businessDays: [1, 2, 3, 4, 5],
        businessStartHour: 9,
        businessEndHour: 17,
        replanOutsideBusinessHours: true
      }
    })
  );

  expectDecision(result, "replan", "replanned_for_business_hours");
  assert.equal(new Date(result.nextScheduledFor ?? "").getUTCDay(), 1);
});

test("next business day is computed deterministically", () => {
  const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
  const input = makeInput({
    now: saturday,
    action: {
      scheduledFor: "2026-06-20T20:00:00.000Z",
      expiresAt: "2026-06-25T12:00:00.000Z"
    },
    policy: {
      businessHoursEnabled: true,
      businessTimezone: "UTC",
      businessDays: [1, 2, 3, 4, 5],
      businessStartHour: 9,
      businessEndHour: 17,
      replanOutsideBusinessHours: true
    }
  });

  assert.equal(calculateNextSchedule(input), "2026-06-22T09:00:00.000Z");
});

test("next schedule does not exceed expiry", () => {
  const saturday = findIsoWithUtcDay(FIXED_NOW, 6);
  const result = evaluateFollowUpSchedule(
    makeInput({
      now: saturday,
      action: {
        scheduledFor: "2026-06-20T20:00:00.000Z",
        expiresAt: "2026-06-22T10:00:00.000Z"
      },
      policy: {
        businessHoursEnabled: true,
        businessTimezone: "UTC",
        businessDays: [1, 2, 3, 4, 5],
        businessStartHour: 9,
        businessEndHour: 17,
        replanOutsideBusinessHours: true
      }
    })
  );

  assert.equal(result.decision, "replan");
  assert.equal(result.nextScheduledFor, "2026-06-22T09:00:00.000Z");
  assert.equal(new Date(result.nextScheduledFor ?? "").getTime() <= new Date("2026-06-22T10:00:00.000Z").getTime(), true);
});

test("expiry wins over ready", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        scheduledFor: "2026-06-17T11:00:00.000Z",
        expiresAt: "2026-06-17T12:00:00.000Z"
      }
    })
  );

  expectDecision(result, "expire", "action_expired");
});

test("stale opportunity stage replans the action", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        scheduledFor: "2026-06-17T13:00:00.000Z"
      },
      context: {
        opportunityStageChangedAt: "2026-06-17T11:30:00.000Z"
      }
    })
  );

  expectDecision(result, "replan", "stale_action_context");
});

test("proposed eligible action becomes ready", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        status: "proposed",
        scheduledFor: "2026-06-17T11:30:00.000Z"
      }
    })
  );

  expectDecision(result, "ready", "scheduled_time_reached");
});

test("scheduled eligible action becomes ready", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        status: "scheduled",
        scheduledFor: "2026-06-17T11:30:00.000Z"
      }
    })
  );

  expectDecision(result, "ready", "scheduled_time_reached");
});

test("deterministic result", () => {
  const input = makeInput({
    action: {
      scheduledFor: "2026-06-17T11:30:00.000Z"
    }
  });
  const first = evaluateFollowUpSchedule(input);
  const second = evaluateFollowUpSchedule(cloneJson(input));

  assert.deepEqual(first, second);
});

test("input is not mutated", () => {
  const input = makeInput({
    action: {
      scheduledFor: "2026-06-17T11:30:00.000Z"
    }
  });
  const before = JSON.stringify(input);

  evaluateFollowUpSchedule(input);

  assert.equal(JSON.stringify(input), before);
});

test("side effects are always false", () => {
  const result = evaluateFollowUpSchedule(
    makeInput({
      action: {
        scheduledFor: "2026-06-17T11:30:00.000Z"
      }
    })
  );

  assert.deepEqual(result.sideEffects, {
    actionUpdated: false,
    actionInserted: false,
    outboxWritten: false,
    messageSent: false,
    workerTriggered: false
  });
});

test("source stays free of forbidden integration and runtime strings", () => {
  const source = readSchedulingSources();

  assert.equal(hasForbiddenSourceText(source), false);
});
