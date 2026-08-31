import assert from "node:assert/strict";
import test from "node:test";
import { runAgentRuntimeEvent } from "@/lib/brain/commercial/agent-runtime-event";
import type { AgentRuntimeEvent, CustomerMessageEvent, FollowUpWakeEvent } from "@/lib/brain/commercial/agent-runtime-event";
import { buildFollowUpWakeEvent } from "@/lib/brain/commercial/followup-wake/buildFollowUpWakeEvent";

// SALES-AGENT-R3-A05. Pure/logic tests - no real DB needed, every dependency
// is injected. Covers Phase 16 checklist items 1, 2, 21, 22: CUSTOMER_MESSAGE
// and FOLLOWUP_WAKE are distinct typed variants, a FOLLOWUP_WAKE cannot carry
// fabricated customer text, and the unified seam routes each variant to its
// own runtime without fabricating the other's input shape.

function sampleCustomerMessageEvent(): CustomerMessageEvent {
  return {
    type: "CUSTOMER_MESSAGE",
    conversationId: 101,
    conversationPublicId: "conv-public-1",
    customerMasterId: null,
    waId: "56912345678",
    phoneNumberId: "phone-1",
    messageId: "wamid-1",
    messageText: "Hola, quiero cotizar",
    correlationId: "corr-1",
    currentTime: "2026-08-31T12:00:00.000Z"
  };
}

function sampleWakeEvent(overrides: Partial<Parameters<typeof buildFollowUpWakeEvent>[0]> = {}): FollowUpWakeEvent {
  return buildFollowUpWakeEvent({
    actionPublicId: "crm-agent-action-abc123",
    statusPreClaim: "planned",
    attemptNumberPreClaim: 1,
    conversationId: 101,
    opportunityId: 55,
    correlationId: "followup:crm-agent-action-abc123:1000",
    scheduledFor: "2026-08-31T11:00:00.000Z",
    firedAt: "2026-08-31T12:00:00.000Z",
    ...overrides
  });
}

test("CUSTOMER_MESSAGE and FOLLOWUP_WAKE are structurally distinct event variants", () => {
  const customerEvent: AgentRuntimeEvent = sampleCustomerMessageEvent();
  const wakeEvent: AgentRuntimeEvent = sampleWakeEvent();

  assert.equal(customerEvent.type, "CUSTOMER_MESSAGE");
  assert.equal(wakeEvent.type, "FOLLOWUP_WAKE");
  assert.notEqual(customerEvent.type, wakeEvent.type);
});

test("a FollowUpWakeEvent never carries a messageText/draftMessage/body field - structural, not just a naming convention", () => {
  const wakeEvent = sampleWakeEvent();
  const keys = Object.keys(wakeEvent);
  assert.deepEqual(
    [...keys].sort(),
    ["actionPublicId", "attempt", "causationId", "conversationId", "correlationId", "firedAt", "opportunityId", "reason", "scheduledFor", "type", "wakeId"].sort()
  );
  for (const forbidden of ["messageText", "draftMessage", "body", "text", "prompt"]) {
    assert.equal(forbidden in wakeEvent, false, `FollowUpWakeEvent must never carry a "${forbidden}" field`);
  }
});

test("runAgentRuntimeEvent routes CUSTOMER_MESSAGE to the injected runner, mapping fields 1:1", async () => {
  const event = sampleCustomerMessageEvent();
  let received: unknown = null;
  const outcome = await runAgentRuntimeEvent(event, {
    customerMessageRunner: async (input) => {
      received = input;
      return { ran: true, shadow: null, loop: null, bridge: null, warnings: [] };
    }
  });

  assert.equal(outcome.type, "CUSTOMER_MESSAGE");
  assert.deepEqual(received, {
    conversationId: event.conversationId,
    conversationPublicId: event.conversationPublicId,
    customerMasterId: event.customerMasterId,
    waId: event.waId,
    phoneNumberId: event.phoneNumberId,
    messageId: event.messageId,
    messageText: event.messageText,
    correlationId: event.correlationId,
    currentTime: event.currentTime
  });
});

test("runAgentRuntimeEvent routes FOLLOWUP_WAKE to the injected dispatcher, never to the customer-message runner", async () => {
  const event = sampleWakeEvent();
  let customerRunnerCalled = false;
  let received: unknown = null;

  const outcome = await runAgentRuntimeEvent(event, {
    customerMessageRunner: async () => {
      customerRunnerCalled = true;
      return { ran: true, shadow: null, loop: null, bridge: null, warnings: [] };
    },
    followUpDispatcher: async (input) => {
      received = input;
      return { status: "sent", outboxId: 7 };
    },
    followUpDispatch: {
      waId: "56987654321",
      draftMessage: "Seguimos con tu cotizacion?",
      caseStatus: "open",
      humanOwnerActive: false,
      aiEnabled: true
    }
  });

  assert.equal(outcome.type, "FOLLOWUP_WAKE");
  assert.equal(customerRunnerCalled, false, "a follow-up wake must never reach the customer-message runtime");
  assert.deepEqual(received, {
    actionPublicId: event.actionPublicId,
    attemptNumber: event.attempt,
    opportunityId: event.opportunityId,
    conversationId: event.conversationId,
    waId: "56987654321",
    draftMessage: "Seguimos con tu cotizacion?",
    caseStatus: "open",
    humanOwnerActive: false,
    aiEnabled: true,
    now: event.firedAt
  });
});

test("runAgentRuntimeEvent rejects a FOLLOWUP_WAKE with no dispatch context, rather than guessing", async () => {
  await assert.rejects(() => runAgentRuntimeEvent(sampleWakeEvent(), {}), /missing_dispatch_context/);
});

test("wake identity is deterministic: same (actionPublicId, resulting attempt) -> same wakeId", () => {
  const a = sampleWakeEvent();
  const b = sampleWakeEvent();
  assert.equal(a.wakeId, b.wakeId);
});

test("a different actionPublicId or a different resulting attempt produces a different wakeId", () => {
  const base = sampleWakeEvent();
  const differentAction = sampleWakeEvent({ actionPublicId: "crm-agent-action-other" });
  const differentAttemptViaRetry = sampleWakeEvent({ statusPreClaim: "failed", attemptNumberPreClaim: 1 });

  assert.notEqual(base.wakeId, differentAction.wakeId);
  assert.notEqual(base.wakeId, differentAttemptViaRetry.wakeId);
  assert.equal(differentAttemptViaRetry.attempt, 2, "a retry claim bumps the resulting attempt by exactly 1");
});

test("a technical-failure retry of the SAME resulting attempt (attempt_number not advanced) computes the SAME wakeId on purpose", () => {
  // A planned claim's attempt_number is never bumped by the claim itself
  // (only 'executing'/'failed' origins bump it) - a technical-failure
  // backoff leaves it exactly where it was, so a later retry of a still-
  // 'planned' row at the same attempt_number is the same logical wake.
  const firstTry = sampleWakeEvent({ statusPreClaim: "planned", attemptNumberPreClaim: 1 });
  const retryAfterTechnicalFailure = sampleWakeEvent({ statusPreClaim: "planned", attemptNumberPreClaim: 1 });
  assert.equal(firstTry.wakeId, retryAfterTechnicalFailure.wakeId);
});

test("wake reason is derived from the claim origin, never invented", () => {
  assert.equal(sampleWakeEvent({ statusPreClaim: "planned" }).reason, "scheduled_due");
  assert.equal(sampleWakeEvent({ statusPreClaim: "executing" }).reason, "stale_recovery");
  assert.equal(sampleWakeEvent({ statusPreClaim: "failed" }).reason, "retry");
});
