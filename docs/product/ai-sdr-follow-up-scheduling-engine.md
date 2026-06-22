# AI SDR Follow-up Scheduling Decision Engine

## 1. Goal

This module decides what should happen to a proposed follow-up action once time, policy, customer activity, opportunity state, and business constraints are known.

It answers one question only:

`should this action wait, become ready, cancel, expire, replan, block, or be rejected as invalid?`

It is pure and deterministic.

## 2. Planner vs scheduler

The follow-up planner proposes the action and its initial schedule.

The follow-up scheduling decision engine evaluates an already proposed or scheduled action and decides whether that action is:

- ready to be acted on,
- still waiting,
- cancelled,
- expired,
- replanned,
- blocked,
- invalid.

That separation keeps proposal logic and runtime gating apart.

## 3. Decisions

Supported decisions:

- `ready`
- `wait`
- `cancel`
- `expire`
- `replan`
- `block`
- `invalid`

## 4. Evaluation order

The engine evaluates in a fixed sequence:

1. validate timestamps;
2. validate action id;
3. validate idempotency key;
4. validate action type;
5. validate status;
6. validate policy enablement and allowed action types;
7. validate risk;
8. validate approval;
9. validate human owner activity;
10. validate AI blocked;
11. validate `requiresHuman`;
12. validate case closed;
13. validate opportunity closed;
14. validate opportunity paused;
15. validate customer reply after action creation;
16. validate duplicate action;
17. validate conflicting action;
18. validate maximum attempts;
19. validate expiry;
20. validate schedule presence;
21. apply inbound cooldown;
22. apply outbound cooldown;
23. apply business hours;
24. evaluate due time;
25. decide final state.

## 5. Customer reply cancellation

If `lastInboundAt > action.createdAt`, the action is cancelled.

Reason:

- `customer_replied_after_action_created`

This engine does not replan automatically after a new customer reply. That belongs to `P1K-012E-B`.

## 6. Human takeover

If `humanOwnerActive = true`, the action is cancelled.

Reason:

- `human_owner_active`

## 7. AI block

If `aiBlocked = true`, the action is blocked.

Reason:

- `ai_blocked`

## 8. Case and opportunity terminals

Closed case statuses include at least:

- `closed`
- `resolved`
- `cancelled`
- `archived`

Result:

- `case_closed` -> `cancel`

Opportunity terminal states:

- `won` -> `cancel`
- `lost` -> `cancel`
- `paused` -> `block`

## 9. Cooldown

The engine applies both cooldown sources:

- inbound cooldown from `lastInboundAt + cooldownMinutesAfterInbound`
- outbound cooldown from `lastOutboundAt + cooldownMinutesAfterOutbound`

The effective schedule is never earlier than the most restrictive cooldown.

If cooldown pushes the action into the future:

- with replanning enabled, the decision becomes `replan`;
- otherwise the decision becomes `wait`.

## 10. Business hours

Business hours are explicit and timezone-aware.

Rules:

- days use `0..6` for Sunday..Saturday;
- `businessStartHour` is inclusive;
- `businessEndHour` is exclusive;
- the server timezone is never assumed.

If the action lands outside hours:

- with replanning enabled, the decision becomes `replan`;
- otherwise the decision becomes `wait`.

## 11. Expiry

Expiry wins over readiness.

If `now >= expiresAt`, the action expires.

If policy requires expiry but `expiresAt` is missing, the input is invalid.

If any possible replanned time would exceed expiry, the action expires.

## 12. Attempts

If `attemptCount >= maxAttempts`, the action expires.

This prevents infinite rescheduling loops.

## 13. Stale context

If `opportunityStageChangedAt > action.createdAt`, the action is stale.

That does not execute the old action directly.

If the opportunity is still open and follow-up is allowed, the engine returns `replan`.

If the current stage makes follow-up invalid, the action is cancelled.

## 14. Replanning

Replanning is a pure decision.

It does not mutate the stored action.
It does not insert a new action.
It does not write outbox.

`nextScheduledFor` is a suggestion for the next valid time, not a persisted runtime event.

## 15. Pure function contract

The module does not use:

- `Date.now()`
- implicit `new Date()`
- timers
- process env
- DB clients
- SQL
- network calls

The same input must always produce the same output.

## 16. Relation to `P1K-012E-B`

`P1K-012E-B` owns the pure mutation contract that consumes `FollowUpSchedulingResult` and turns it into cancellation, expiration, blocking, replanning, superseding, or replacement plans.

This milestone only decides what happens to a candidate action.

It does not mutate the durable action row and it does not create the next one.

## 17. Relation to a future real scheduler

The future scheduler should only scan candidate actions.

Then it should pass each candidate into this engine.

The scheduler itself should not embed business logic.

The actual decision lives here.
Any later execution path still remains separate and is handled after the mutation and outbox layers, not inside this decision engine.

## 18. Current limits

Current limits are explicit:

- no scheduler runtime;
- no cron;
- no DB;
- no outbox;
- no WhatsApp;
- no Meta;
- no worker;
- no persistence mutation.
## P1K-012G

The autonomous commercial loop consumes follow-up scheduling results as-is. It does not recalculate cooldown, expiry or business-hour rules.

## P1K-012H

The scenario simulator reuses the scheduling result verbatim as part of synthetic runs. It does not recalculate time rules or alter the scheduling contract.
