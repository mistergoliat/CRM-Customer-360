# Follow-up Decision Policy

## Purpose

This document defines the commercial follow-up policy for Lead and Opportunity.

Follow-up is a contextual decision that recommends or schedules the next commercial action to maintain, recover, or advance a Lead or Opportunity.

Follow-up is not synonymous with a message.

It can result in:

- future WhatsApp message,
- internal task,
- human review request,
- waiting,
- contact pause,
- future call proposal,
- follow-up plan closure,
- stalled candidate recommendation,
- loss recommendation without automatic lost marking.

No execution happens in this stage.

## Policy layers

### FollowUpEligibility

Determines whether follow-up should even be considered.

### FollowUpDecision

Determines what to do next.

### FollowUpPlan

Represents the proposed operational and temporal plan.

### FollowUpExecution

Out of scope for this stage.

## Eligibility statuses

- `eligible`
- `not_yet_eligible`
- `suppressed`
- `blocked`
- `completed`
- `insufficient_context`

## Decision types

- `no_action`
- `wait`
- `propose_whatsapp_followup`
- `propose_internal_task`
- `propose_email_followup`
- `propose_operator_review`
- `propose_call`
- `pause_contact`
- `mark_stalled_candidate`
- `mark_lost_candidate`
- `close_followup_plan`

## Reasons

- `customer_replied`
- `awaiting_customer_reply`
- `customer_silent`
- `left_on_seen`
- `quote_sent_no_reply`
- `quote_pending_internal`
- `clarification_needed`
- `objection_unresolved`
- `high_intent_inactive`
- `delivery_deadline_near`
- `requested_callback`
- `requested_later_contact`
- `operator_requested`
- `stale_opportunity`
- `explicit_rejection`
- `purchase_confirmed`
- `duplicate_contact_risk`
- `contact_limit_reached`
- `manual_block`
- `insufficient_identity`
- `insufficient_context`
- `unknown`

## Channels

- `whatsapp`
- `internal_task`
- `email`
- `phone_call`
- `none`

## Urgency

- `low`
- `normal`
- `high`
- `immediate`

`immediate` is only commercial priority. It is not a safety or medical classification.

## Confidence

- `high`
- `medium`
- `low`

## Approval requirement

- `none`
- `operator_review`
- `explicit_operator_approval`
- `blocked`

## Follow-up plan statuses

- `proposed`
- `pending_approval`
- `approved`
- `scheduled`
- `due`
- `executed`
- `skipped`
- `suppressed`
- `expired`
- `cancelled`
- `completed`

Terminal plan statuses:

- `executed`
- `skipped`
- `suppressed`
- `expired`
- `cancelled`
- `completed`

## Eligibility rule

A follow-up can be proposed only when all of the following are true:

- there is a relevant Lead or Opportunity,
- the Opportunity is not terminal,
- there is a commercial reason,
- no active suppression applies,
- the channel is available,
- the last contact is not too recent,
- there is no equivalent active plan,
- there is enough context to explain the decision.

## Terminal states

Do not propose normal commercial follow-up for:

- `won`
- `lost`
- `cancelled`
- `archived`

Future post-sale or reactivation logic belongs to another policy or a new Opportunity.

## Signal guidance

### `customer_replied`

Do not propose automatic follow-up. The next action is to respond or qualify.

### `awaiting_customer_reply`

May propose follow-up after a contextual delay.

### `left_on_seen`

Relevant signal, but not proof of disinterest.

### `quote_sent_no_reply`

May justify commercial follow-up.

### `high_intent_inactive`

May increase urgency.

### `explicit_rejection`

Suppress commercial follow-up, except for logging or human review.

### `purchase_confirmed`

Close commercial sales follow-up.

### `requested_later_contact`

Respect the requested date.

### `requested_callback`

Propose a task or future call with approval.

## Timing windows

Windows are configurable by context. This policy does not enforce a single universal timer.

Recommended window fields:

- `minimumDelayMinutes`
- `preferredDelayMinutes`
- `maximumDelayMinutes`
- `quietHours`
- `timezone`
- `businessHoursOnly`
- `customerRequestedAt`
- `expiresAfterMinutes`

Examples only:

- high-intent inquiry without reply: evaluate between 4 and 24 hours,
- quote sent without reply: evaluate between 24 and 72 hours,
- customer asked for next week: respect the requested date,
- many recent messages: do not recontact immediately.

These examples are guidance, not hard runtime rules.

## Frequency limits

Configurable policy limits:

- `maxAttemptsPerOpportunity`
- `maxAttemptsPerChannel`
- `minimumIntervalBetweenAttemptsMinutes`
- `maxAttemptsInRollingWindow`
- `stopAfterExplicitRejection`
- `stopAfterPurchaseConfirmed`
- `requireHumanAfterAttemptCount`
- `preventDuplicateActivePlans`

Default contract values live in `lib/brain/commercial/followUpConstants.ts`.

## Contact attempt model

Each attempt should conceptually capture:

- attemptedAt,
- channel,
- actor,
- outcome,
- relatedPlanId,
- customerResponded,
- responseAt,
- errorCode,
- metadata.

## Next Best Action

The policy should produce an explainable next best action with:

- `currentOpportunityState`
- `detectedSignals`
- `recommendedAction`
- `recommendedChannel`
- `urgency`
- `confidence`
- `rationale`
- `requiresHumanApproval`
- `recommendedAt`
- `suppressionChecks`

## MVP approval governance

For the MVP:

- a follow-up message draft may require `operator_review`,
- an internal task may be proposed without sending,
- email outbound remains secondary,
- `phone_call` always requires `explicit_operator_approval`,
- repeated attempts increase review requirements,
- follow-up under identity conflict is blocked,
- marking lost is a recommendation, not an automatic execution,
- follow-up cannot promise discounts, stock, delivery, or a final quote.

## Rationale contract

Rationale must be readable by Operator Copilot and include:

- summary,
- evidence,
- counterEvidence,
- assumptions,
- riskFlags,
- policyRulesApplied.

Do not expose private chain-of-thought or unrestricted internal reasoning.

## Invariants

- No follow-up executes in this stage.
- Every decision must be explainable.
- Every proposal must be tied to Lead or Opportunity.
- Do not create duplicate equivalent plans.
- Do not contact terminal opportunities.
- Do not ignore opt-out or explicit rejection.
- `requestedContactAt` overrides generic windows.
- Recent customer reply stops pending follow-up.
- Identity conflict blocks sensitive outbound.
- Missing email does not block WhatsApp if `wa_id` is valid.
- Persistent Customer Master is not required for the MVP.
- A follow-up proposal does not modify Opportunity automatically.
- Recommended action is not executed action.

## Out of scope

- real execution,
- cron scheduler,
- queues,
- persistence,
- WhatsApp send,
- email send,
- call execution,
- campaign automation,
- machine learning,
- predictive scoring,
- automatic cadence optimization,
- A/B testing,
- Customer Master,
- SaaS multi-tenant.

## Relation to the real dispatch gate (ACS-R1-05-T02)

This document defines the policy vocabulary and invariants (opt-out, identity conflict, recent reply, quiet-hours windows). Since ACS-R1-05-T02, the "do not ignore opt-out or explicit rejection" and "identity conflict blocks sensitive outbound" invariants above are enforced for real, connected dispatch decisions - not only described here - by `sales-consultative/followUpDispatchPolicy.ts` (`follow_up_dispatch_policy`), which calls the shared `policy/evaluateCommercialPolicy.ts` boundary as a mandatory gate immediately before `sales-consultative/repository.ts` persists a `schedule_followup` row. Real signal sources: `optOut` from the opportunity's structured `signals_json` (no opt-out capture channel exists yet in this repo, so it evaluates false until one is built - a documented gap, not a silent invented default); `quietHoursActive` from an explicit current time and the `America/Santiago` timezone (a concrete 21:00-09:00 window, since this document leaves the window "configurable by context" without fixing one); `identityConflict` from the real native identity resolution state (`crm_customer_onboarding_state.status = 'conflict'`, ACS-R1-04). A quiet-hours or human-owner-active signal never lets a follow-up reach `action.status = planned`; opt-out, identity conflict, or AI-blocked deny the write outright. See `docs/releases/ACS-R1-05-autonomous-follow-up-runtime.md` ("Evidencia de cierre - ACS-R1-05-T02") for full detail.

## TypeScript contract

The associated TypeScript contracts live in:

- `lib/brain/commercial/followUpTypes.ts`
- `lib/brain/commercial/followUpConstants.ts`
- `lib/brain/commercial/index.ts`

## Runtime authority (ACS-R1-05-T05)

`docs/audits/follow-up-runtime-reconciliation.md` found five parallel follow-up decision implementations (P2-1: this document's own vocabulary, `follow-up-planner/planFollowUp.ts`, `sales-consultative/engine.ts`, `autonomous-loop/evaluateAutonomousLoop.ts`, and the dead `multi-request/requestFollowups.ts`). `ACS-R1-05-T05` reconciled that without changing this policy's invariants:

- The only productive persister of `schedule_followup` is `sales-consultative/repository.ts`, gated by `follow_up_dispatch_policy` (`sales-consultative/followUpDispatchPolicy.ts` -> `policy/evaluateCommercialPolicy.ts`, connected since `ACS-R1-05-T02`, see above).
- `multi-request/requestFollowups.ts` had its own scheduler/persister (`scheduleRequestFollowup`, `scheduleFollowupFromDefinition`, `runRequestFollowupTick`) removed - it duplicated this policy's decision surface (its own `delayMinutes`-per-intent cooldown, its own `crm_agent_actions` writer) with zero productive callers. `multi-request` keeps recommending context/intent for its own request lifecycle; it no longer has any path to plan or persist a follow-up.
- `lib/brain/commercial/autonomous-loop/**` (plus `follow-up-scheduling/**`/`follow-up-replanning/**`) is an in-memory-only dev sandbox reachable solely from `app/(hub)/dev/ai-sdr-simulator`, not re-exported from any production barrel. It cannot compete with the policy described here for a real customer.

No configuration lets an operator choose an alternate policy/planner for productive follow-up dispatch.
