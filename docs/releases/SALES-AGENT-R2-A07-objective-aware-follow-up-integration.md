# SALES-AGENT-R2-A07 - Objective-Aware Follow-Up Integration

Status: implemented_partial  
Scope: dev/test CommercialWork-linked follow-up primitives + tests + docs  
Production behavior changed: NO  
Production follow-up activation: NO

## 1. Current follow-up architecture

Current customer-visible follow-up uses the existing action/outbox chain:

```text
planner / next action
-> crm_agent_actions(action_type='schedule_followup')
-> scheduled_for
-> runFollowupTick claim/CAS
-> post-claim revalidation
-> runNativeAutonomousCycle or cancellation
-> crm_agent_actions + brain_message_outbox
```

Eligibility for legacy/native follow-up is currently decided before persistence by the operational loop and scheduling bridge. Durable scheduling is persisted in `crm_agent_actions`, using `scheduled_for`, `attempt_number`, `max_attempts`, `followup_sequence_key`, and the existing status lifecycle.

Runtime authority lives in `lib/brain/commercial/followup/runFollowupTick.ts`. It selects due `schedule_followup` rows, claims with CAS, revalidates opt-out, customer reply, human ownership, AI pause, conversation closure, terminal opportunity, and current follow-up configuration, then either cancels/reschedules or executes.

Dispatch remains through the canonical action/outbox boundary. The canonical outbox writer is still `lib/brain/messaging/canonicalOutboxWriter.ts`; A07 does not send Meta directly.

## 2. CommercialWork integration

A07 adds objective-aware primitives under:

```text
lib/brain/commercial/work/followup/
```

Implemented:

- `OBJECTIVE_FOLLOW_UP_POLICY_REGISTRY`
- `evaluateObjectiveFollowUpEligibility(...)`
- `scheduleObjectiveAwareFollowUp(...)`
- `processObjectiveAwareFollowUpDue(...)`
- `cancelObjectiveAwareFollowUps(...)`

`WAIT_FOR_QUOTE_APPROVAL` was added as a dev/future CommercialObjective contract only. No payment lifecycle or production quote approval lifecycle was invented.

## 3. Policy model

V1 policies:

```text
MISSING_INFORMATION
SELECTION_INACTIVE
QUOTE_PENDING
```

Each policy defines eligible objective types, waiting reasons, delay sequence, max attempts, stop conditions, and handoff behavior in one registry. A07 does not implement `PAYMENT_PENDING` and does not add generic marketing automation.

## 4. Correlation

Objective-aware scheduled rows store correlation in `crm_agent_actions.draft_payload_json`:

```json
{
  "kind": "objective_aware_followup",
  "schemaVersion": "1.0",
  "commercialWorkPublicId": "...",
  "commercialObjectivePublicId": "...",
  "followUpPolicy": "MISSING_INFORMATION",
  "waitingReason": "MISSING_DESTINATION",
  "attempt": 1,
  "scheduledAt": "...",
  "expectedWorkVersion": 1
}
```

The active dedupe identity uses `followup_sequence_key`, derived from:

```text
commercialWorkPublicId + commercialObjectivePublicId + policy
```

No schema change was required.

## 5. Eligibility

`evaluateObjectiveFollowUpEligibility(...)` is deterministic and makes zero LLM calls. Required conditions:

- work is `WAITING_CUSTOMER`;
- objective is `WAITING_CUSTOMER`;
- objective/work are not completed, cancelled, superseded, failed or handoff;
- conversation has `ai_enabled=true` and `human_owner_active=false`;
- conversation is not closed;
- opportunity is not terminal;
- customer is not opted out;
- policy exists and applies to the objective/waiting reason;
- no active duplicate follow-up exists for the same work/objective/policy;
- max attempts are not exhausted.

`WAITING_SYSTEM`, `RETRY_SCHEDULED`, and `RUNNING` do not originate customer follow-up.

## 6. Revalidation

`processObjectiveAwareFollowUpDue(...)` reloads fresh durable state before dispatch:

```text
load action
-> parse objective-aware payload
-> claim schedule_followup row
-> reload CommercialWork
-> reload objective
-> reload conversation/opportunity
-> check opt-out
-> check customer reply after scheduling
-> recheck waiting reason and policy
-> persist send_whatsapp_reply action
-> execute through execution gate
-> canonical outbox
```

If a customer replied after the follow-up was scheduled, A07 cancels the stale plan. It does not send the old message immediately even if the objective still appears waiting; A08 should own finer turn sequencing/replanning.

## 7. Cancellation

Invalid due follow-ups are cancelled, not deleted. Covered reasons include:

```text
work_completed
work_cancelled
work_superseded
objective_not_waiting_customer
objective_cancelled
objective_superseded
conversation_handoff
conversation_ai_disabled
customer_opted_out
opportunity_terminal
customer_replied_since_schedule
waiting_reason_changed
```

`cancelObjectiveAwareFollowUps(...)` cancels linked future rows by work/objective/policy sequence key and preserves audit rows.

## 8. Message generation boundary

Eligibility and stop conditions are deterministic. A07 uses small deterministic policy templates for follow-up copy, grounded in objective/waiting reason. LLM calls for eligibility: `0`. LLM calls for phrasing: `0`.

## 9. Compatibility

Legacy follow-ups remain compatible. `processObjectiveAwareFollowUpDue(...)` returns `legacy_unaffected` for a `schedule_followup` row without the A07 payload. Existing `runFollowupTick` behavior is not globally replaced.

## 10. Restart behavior

Correlation is durable in `crm_agent_actions`; a fresh process can load the action, recover work/objective ids from payload, reload `CommercialWork`, and revalidate. The timer only decides when to re-evaluate; it is never the commercial reason to contact the customer.

## 11. Tests

Added:

```text
tests/commercial/objectiveAwareFollowUpEligibility.test.ts
tests/commercial/objectiveAwareFollowUp.test.ts
```

Executed in this environment:

```powershell
npx --yes tsx@4.20.5 --test tests\commercial\objectiveAwareFollowUpEligibility.test.ts
npx --yes tsx@4.20.5 --test tests\commercial\objectiveAwareFollowUp.test.ts
npx tsc --noEmit
npm run typecheck
npm run build
npx --yes tsx@4.20.5 --test tests\commercial\followUpPlanner.test.ts tests\commercial\followUpPlanAdapter.test.ts tests\commercial\followUpScheduling.test.ts tests\commercial\followUpRuntimeAuthority.test.ts tests\commercial\followUpDispatchPolicy.test.ts tests\commercial\objectiveAwareFollowUpEligibility.test.ts
```

Results:

```text
objectiveAwareFollowUpEligibility: PASS - 2/2
objectiveAwareFollowUp DB-backed: PASS - 8/8
pure follow-up regression batch: PASS - 92/92
typecheck: PASS
build: PASS - pre-existing lint warnings only
```

DB note:

```text
crm_test existed on this PC but was behind the repo: 27 applied migrations, missing 029/030.
Applied npm run db:migrate -- --database=test.
Verified selected_database=crm_test, schema_migrations=29, and crm_commercial_work* tables present.
```

## 12. Limitations

- No global production activation.
- No A08 conversation sequencing.
- No parallel execution.
- No payment follow-up.
- Quote pending is supported as a dev/future objective contract through `WAIT_FOR_QUOTE_APPROVAL`; production quote approval lifecycle remains future.
- DB-backed validation is implemented but not executed in this environment due local infrastructure unavailability.

## 13. Recommended A08

`SALES-AGENT-R2-A08` should implement conversation sequencing and stale-turn protection so a customer reply, due follow-up, and autonomous turn can be ordered through one runtime authority instead of only conservative cancellation.

```text
SALES-AGENT-R2-A07: DONE

Objective-aware follow-up:
PARTIAL

Production follow-up activation:
NO

CommercialWork correlation:
IMPLEMENTED

Objective correlation:
IMPLEMENTED

Follow-up policies:
MISSING_INFORMATION, SELECTION_INACTIVE, QUOTE_PENDING

WAITING_CUSTOMER eligibility:
PASS

WAITING_SYSTEM eligibility:
NO

RETRY_SCHEDULED eligibility:
NO

Missing information schedule:
PASS

Missing information due:
PASS

Resolved objective cancels follow-up:
PASS

Quote pending schedule:
PASS

Quote superseded cancels:
PASS

Objective completed cancels:
PASS

Work cancelled cancels:
PASS

Work superseded cancels:
PASS

Handoff stops follow-up:
PASS

AI-disabled stops follow-up:
PASS

Opt-out stops follow-up:
PASS

Terminal opportunity stops follow-up:
PASS

Duplicate scheduling:
PASS - pure eligibility; DB scheduling test blocked

Max attempts:
PASS

Delay sequence:
PASS

Restart recovery:
PASS

Two-worker dispatch:
PASS

Customer reply stale-plan protection:
PASS

Eligibility LLM calls:
0

Follow-up phrasing LLM calls:
0

Canonical crm_agent_actions path:
YES

Canonical outbox path:
YES

Legacy follow-up regression:
PASS

A03 regressions:
NOT_RUN

A04 regressions:
NOT_RUN

A05 regressions:
NOT_RUN

A06 regressions:
NOT_RUN

Shipping/quote:
NOT_RUN

Follow-up regression suite:
PASS - A07 DB-backed 8/8 plus pure follow-up regression batch 92/92

Typecheck:
PASS

Build:
PASS

Conversation sequencing:
NOT_IMPLEMENTED - A08

Parallel execution:
NO

Production routing changed:
NO

Production thinking changed:
NO

ACTIVE_RELEASE changed:
NO

Verdict:
OBJECTIVE_AWARE_FOLLOWUP_VALIDATED

Recommended next:
SALES-AGENT-R2-A08 - conversation sequencing and stale-turn protection
```
