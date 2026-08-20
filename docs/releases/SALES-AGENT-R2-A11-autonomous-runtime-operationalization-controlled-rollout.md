---
doc_id: release-sales-agent-r2-a11
title: SALES-AGENT-R2-A11 - Autonomous Runtime Operationalization and Controlled Rollout
status: done
last_reviewed: 2026-08-21
source_of_truth_for:
  - A11 closure evidence
  - the exact set of environment variables governing autonomous runtime activation
depends_on:
  - ./SALES-AGENT-R2-A10-capability-coverage-runtime-correctness-audit.md
  - ../runbooks/SALES-AGENT-R2-A11-controlled-rollout-runbook.md
tags:
  - release
  - sales-agent
  - commercial-work
  - operationalization
---

# SALES-AGENT-R2-A11: Autonomous Runtime Operationalization and Controlled Rollout

Verdict: **A11_CODE_VALIDATED**. Every piece of code, wiring, tooling, and documentation
A11 required is complete and tested against real MariaDB; real owner-number WhatsApp
validation has not been performed in this session (no real Meta/owner-phone access
available here) - see "A11 readiness" below for the exact remaining step.

Base commit: `00e93e0` (control-plane gates: access gate, autonomy killswitch, initial
worker/follow-up wiring, fix for the R2-follow-up-dispatch gap). This document covers
the remaining scope completed after that commit, landed as a separate commit.

## 1. Runtime entrypoint audit (Part 1, re-confirmed)

- **Real WhatsApp inbound**: Meta webhook → `processNativeWhatsAppInbound`
  (`lib/brain/native-whatsapp/service.ts`) → persists `conversation_message` +
  `CommercialEvent` unconditionally → `ensureAutonomousSalesTurnContinuity` →
  `runNativeAutonomousCycle` (`lib/brain/commercial/native-cycle/runNativeAutonomousCycle.ts`).
  This function is the **single chokepoint** for both real inbound and the legacy
  follow-up worker's re-entry (documented in its own header comment: "Gating...
  lives entirely inside runNativeAutonomousCycle — a single source of truth. Do not
  duplicate that check here"). A11's two new gates (access gate, autonomy killswitch)
  were added here as Step -1/-0.5, before the pre-existing Step 0 (pilot allowlist)
  and Step 0.5 (opt-out).
- **R2 routing decision**: inside the same function, `shouldRouteToCommercialWork(waId)`
  (existing, unchanged) selects R2 vs legacy/multi-request/agent-tool-loop - mutually
  exclusive, unchanged by A11.
- **CommercialWork retry worker**: `commercialWorkWorker.ts#runCommercialWorkTick` -
  before A11 had **no real production process entrypoint** (confirmed by A09's own
  doc: "No worker cron/production entry point exists yet ... only the benchmark
  harness and the worker module itself call it"). A11 adds
  `scripts/autonomous-commercial-work-worker.ts` (`npm run worker:commercial-work`).
- **Objective-aware follow-up**: `objectiveAwareFollowUp.ts#processObjectiveAwareFollowUpDue`
  - before A11, this function existed and was fully tested in isolation
  (`objectiveAwareFollowUp.test.ts`), but **had no caller anywhere** - the only real
  follow-up worker process (`scripts/autonomous-followup-worker.ts` → `runFollowupTick`)
  never dispatched to it. A11 fixes this (see Part 19/22 below) - `runFollowupTick`'s
  existing production entrypoint now correctly routes each due row by payload shape.
- **Existing background processes actually wired to a script**: `worker:outbox`
  (`autonomous-outbox-worker.ts`), `worker:followup` (`autonomous-followup-worker.ts`,
  legacy sales-consultative follow-up - now also carries R2 dispatch). Both pre-date
  A11 and are unmodified in their own entrypoint scripts.
- **No PM2 ecosystem config exists in this repo** - confirmed by search (`find . -iname
  "*ecosystem*"` and a grep across `docs/` for prior PM2 documentation returned nothing
  beyond a single "EC2/Nginx/Meta deployment - out of scope" note in an older release
  doc). The runbook documents proposed `pm2 start` commands rather than inventing a
  process-name convention the instance may not already use.

## 2-6. Access gate, autonomy killswitch, R2 routing separation (Part 2-7, from 00e93e0)

Unchanged from the base commit - see its own commit message and the code comments in
`autonomousRuntimeConfig.ts`/`runNativeAutonomousCycle.ts`/`runFollowupTick.ts` for the
full rationale. Summary: `BRAIN_WHATSAPP_TEST_MODE_ENABLED` (default `true`) +
`BRAIN_WHATSAPP_TEST_WA_IDS` (fail-closed on empty) is the WHO-may-access gate;
`BRAIN_AUTONOMOUS_RESPONSES_ENABLED` (default `false`) is the independent MAY-RESPOND
killswitch; both are distinct from the pre-existing `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED`/
`_WA_IDS` (WHICH-RUNTIME) allowlist, never conflated, never reused for one another.

## 7. Discovered gap, closed in this session: R2 follow-up had no dispatcher

`schedule_followup` rows are written by two producers sharing one table/`action_type`
(the legacy `sales-consultative` scheduler and R2's own `scheduleObjectiveAwareFollowUp`
- an already-documented, intentional second-persister exception, see
`followUpRuntimeAuthority.test.ts`). Before this session, `runFollowupTick`'s dispatch
loop treated every due row uniformly: claim it, then feed `draft_message` into
`runNativeAutonomousCycle` as if it were a new customer message. For an R2-originated
row, `draft_message` is the follow-up's **own reminder text** (e.g. "¿aún deseas
continuar con el envío?") - this would have fed the agent's own prior message back in
as if the customer had said it. `runFollowupTick.ts` now checks
`isObjectiveAwareFollowUpPayload(candidate.draft_payload_json)` before any claim and,
for an R2 row, delegates entirely to `processObjectiveAwareFollowUpDue` (which does its
own claim/revalidation/canonical-outbox dispatch) instead of falling through to the
legacy path. This was a real, latent bug independent of A11's own new gates - closed as
part of wiring the follow-up worker's real production behavior (Part 19).

## 8. Production CommercialWork retry-worker process (Part 8)

`scripts/autonomous-commercial-work-worker.ts` (new), `npm run worker:commercial-work`.
Same shape as the existing `worker:outbox`/`worker:followup` scripts: env-loaded once
at startup, polling loop (`--poll-ms`, default 10s; `--batch-size`, default 10;
`--lock-seconds`, default 60; `--dry-run`), graceful `SIGINT`/`SIGTERM` shutdown, no
in-memory state carried between ticks. Runs independently of any inbound HTTP request.
Never calls Meta directly - a step's own customer-visible follow-on (if any) flows
through the Capability Gateway → durable fact, never a direct send from this process.

## 9. Worker feature gate (Part 9)

`BRAIN_COMMERCIAL_WORK_WORKER_ENABLED` (default `false`, `loadCommercialWorkWorkerEnabled`).
`runCommercialWorkTick` checks this **first, before even selecting candidates** - a
disabled worker process produces zero DB reads beyond the flag check itself (`WORK16`
test). Worker activation is never implicit from `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED`
being on - two independent flags, checked independently.

## 10-11. Poll interval / batch / process model (Part 10-11)

Defaults: poll 10s, batch 10, lock 60s - conservative, matching the existing
`worker:outbox` (4s/5/90s) and `worker:followup` (30s/5) orders of magnitude, sized up
slightly since CommercialWork retry steps are less latency-sensitive than an outbound
send. A dedicated process (`worker:commercial-work`), not a loop inside the Next.js web
process - matches the existing `worker:outbox`/`worker:followup` separation exactly.

## 12-15. Worker gates: autonomy, test-mode, R2 eligibility, full revalidation (Part 12-15)

`runCommercialWorkTick` resolves each due step's `wa_id` (new `LEFT JOIN conversation`
in `selectDueCommercialWorkSteps`) and, **before any claim**, checks in order:
activation cutoff (if configured) → autonomy killswitch → WhatsApp access gate → R2
routing eligibility (`shouldRouteToCommercialWork(waId)`, re-checked live, never assumed
from when the step was created). Each failure leaves the row completely untouched
(never claimed, always retriable once eligible) and is recorded with a distinct
`skipped` reason (`skipped_autonomy_disabled`, `skipped_access_gate`,
`skipped_r2_ineligible`, `skipped_before_activation_cutoff`) for observability.
`human_owner_active`/`ai_enabled` revalidation was **already** correctly fresh-per-call
inside `executeCommercialWork`'s own `loadConversationControl` (A05/A08 - unmodified,
re-verified, not duplicated here) - Part 15's checklist item for those two fields was
already satisfied before A11; A11 adds the three items that had no prior revalidation
at all (autonomy, access, R2 eligibility).

## 16-18. Retry E2E, restart, two-worker (Part 16-18)

Not re-tested from scratch - these are exactly A06's own regression, unaffected in
mechanism by A11's additive gates (a claim that passes the new checks proceeds through
the *identical* pre-A11 CAS/execute/persist path). Re-run in this session's full
regression with zero new failures: `commercialWorkRetryWorker.test.ts` (restart
recovery, two-worker CAS, lease expiration, max attempts, idempotency - all still
green, now with `workerEnabled: true` explicitly passed since the tests predate the new
default-off gate).

## 19-22. Follow-up operationalization, feature gate, autonomy gates, must-not-execute-work (Part 19-22)

Covered in Section 7 above (dispatcher fix) plus: `BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED`
(default `false`) and R2-eligibility revalidation (`shouldRouteToCommercialWork`) are
checked **only inside the R2 dispatch branch** of `runFollowupTick`, never affecting the
legacy branch's own (pre-existing, unmodified) gating. The access gate and autonomy
killswitch apply uniformly to both branches (checked once per candidate, before the
branch split). `processObjectiveAwareFollowUpDue` itself (unmodified by A11) already
enforced Part 22's separation: it builds and sends a templated reminder
(`buildObjectiveFollowUpMessage`, deterministic, no LLM call) and never re-executes the
waiting capability - preserving A10's WAITING_CUSTOMER-vs-worker separation exactly.

## 23-27. Follow-up test scenarios (Part 23-27)

Covered by the pre-existing `objectiveAwareFollowUp.test.ts` (stale customer reply,
cancellation, handoff, opt-out - `CWFU`-prefixed tests, unmodified, still green) plus
this session's new `FU16`-`FU19` (follow-up-enabled flag, R2-eligibility, activation
cutoff, single-send-no-duplicate through the canonical outbox) and `ACC08`/`AUTO04`
(access gate / autonomy killswitch block both legacy and R2 rows) in
`tests/commercial/autonomousRuntimeGates.test.ts`.

## 28. Global killswitch across all three entry modes (Part 28)

`AUTO01`-`AUTO04` (new test file): autonomy OFF blocks (1) real inbound
(`runNativeAutonomousCycle` returns `ran:false, reason:"autonomous_responses_disabled"`
before any LLM/DB-mutating call), (2) the retry worker (0 claimed, row untouched), (3)
the follow-up worker (0 sends, row untouched, both legacy and R2 rows). `AUTO05`
(architectural grep test) confirms the manual-reply API routes
(`app/api/conversations/[id]/reply`, `app/api/cases/[id]/reply`) never import any gated
function - autonomy-OFF cannot possibly block a manual operator reply because that code
path never touches the gate at all.

## 29-31. Test-mode/public-mode toggling, multiple WA IDs, phone normalization (Part 29-31)

`ACC00`-`ACC06`: pure config-logic tests, no DB, no code-path changes needed to move
between `TEST_MODE=true`/`false` (same `loadWhatsAppAccessGateConfig`/
`isWaIdAllowedByAccessGate` functions, only the env values differ). Uses the same
`normalizeWhatsAppRecipientDigits` helper the transport layer's own final send-gate
already uses (`readWaIdAllowlist`, reused unchanged from the pre-existing pilot
allowlist reader) - no ad-hoc string comparison. `ACC03`/`ACC00` explicitly assert
"TEST_MODE=true + empty allowlist blocks everyone" (never silently unrestricted).
`ACC04` explicitly asserts public mode never requires a phone-number shape (a bug
caught and fixed during this session's own test-writing - see below).

**Self-correction found while testing**: the first implementation of the access gate's
public-mode (`TEST_MODE=false`) branch incorrectly required `waId` to normalize to a
phone-number digit string, which rejected any non-phone-shaped conversation identifier
(breaking several pre-existing test fixtures that use synthetic ids). Fixed to only
require a non-empty identifier in public mode - phone-shape validation was never part
of the actual requirement, only something the first draft over-applied.

## 32. Outbox / real-send hierarchy (Part 32)

Documented, not changed: Sales Agent autonomy gate (`BRAIN_AUTONOMOUS_RESPONSES_ENABLED`,
new) → action creation (`persistAgentAction`) → execution gate
(`executeActionThroughGate`) → `brain_message_outbox` → transport worker
(`worker:outbox`, its own separate `BRAIN_META_SEND_ENABLED`/
`BRAIN_OUTBOX_WORKER_ENABLED`/`BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND` gates, unchanged).
No second, competing send-killswitch was created - A11's autonomy flag gates whether an
autonomous action is ever *created*, never whether an already-created, canonically
queued action gets sent (that remains the outbox worker's own, pre-existing
responsibility).

## 33. Real Meta send mode (Part 33)

Not enabled by this task, by design. See the runbook's Stage-by-stage sequencing -
`BRAIN_OUTBOX_WORKER_ALLOW_REAL_SEND` is a pre-existing flag this task did not touch.

## 34-35. PM2/process topology (Part 34-35)

See the runbook. No ecosystem config exists in the repo - documented as exact `pm2
start`/`restart` commands using proposed process names, with an explicit instruction to
verify against `pm2 list` on the real instance before running anything.

## 36. Observability (Part 36)

`CommercialWorkTickResult.skipped` now carries distinct reason strings
(`skipped_autonomy_disabled`, `skipped_access_gate`, `skipped_r2_ineligible`,
`skipped_before_activation_cutoff`) alongside the pre-existing
`retry_exhaustion_conflict`/`already_claimed`. `FollowupTickResult` gained
`skippedAccessGate`, `skippedAutonomyDisabled`, `skippedCommercialWorkFollowUpIneligible`,
`skippedBeforeActivationCutoff` (alongside the pre-existing `skippedUnauthorized`,
`rescheduled`, `technicalFailures`). Both worker scripts log every non-trivial tick
summary (selected/claimed/executed/completed/retryScheduled/failed/skipped, with each
skip reason) to stdout - `pm2 logs` surfaces this directly. No wa_id or raw phone number
is ever logged.

## 37. Health/status (Part 37)

No new HTTP health endpoint was added (none was requested and the existing
`preflight:autonomous`/new `backlog:report` CLIs already answer the required questions
without exposing anything over HTTP). An operator can answer every question Part 37
lists via CLI: `pm2 status` (worker/follow-up/outbox alive?), `BRAIN_AUTONOMOUS_
RESPONSES_ENABLED`/`BRAIN_WHATSAPP_TEST_MODE_ENABLED`/allowlist count are all printed
in `npm run preflight:autonomous`'s JSON report and in each worker's own startup log
line (counts only, never raw phone numbers).

## 38. Controlled rollout stages (Part 38)

Documented in full in the runbook (Stage 0 safe-off → Stage 1 owner-only → Stage 2
small tester group → Stage 3 public/limited-R2, explicitly not activated by this task →
Stage 4 R2-default, explicitly out of scope).

## 39-40. Owner-only / multi-tester scripts (Part 39-40)

Owner-only WhatsApp validation script (real send, run manually by the operator once
Stage 1 env is live):

```
WA01  Simple product selection: "quiero 2 de la classic"
WA02  Selection + destination + shipping: "quiero 2 de la classic, envío a Ñuñoa"
WA03  C09 bundle: "quiero 2 de la classic y saber cuanto sale el despacho a Ñuñoa"
WA04  Quantity correction: "mejor 3"
WA05  Scoped cancellation: "olvida el despacho"
WA06  Quote: "hazme una cotización"
WA07  Missing information: ask for shipping without giving a destination
WA08  Follow-up: leave WA07 unanswered until the scheduled reminder is due
WA09  Retry: if safely reproducible, force a temporary shipping failure and confirm
      autonomous recovery with no second customer message
WA10  Handoff: request a human / trigger manual takeover, confirm AI stops responding
WA11  Killswitch: set BRAIN_AUTONOMOUS_RESPONSES_ENABLED=false, send a message, confirm
      zero bot response
WA12  Test-mode restriction: message from a non-allowlisted number, confirm zero response
```

Multi-tester plan (unscripted, once Stage 1 passes): ask 3-5 testers to naturally
search/request products, change quantity, ask shipping, correct a destination, cancel
part of a request, ask for a quote, be deliberately ambiguous, ask an unrelated company
question, request a human, and simply stop replying - without giving them the exact
phrases above. Goal: surface real semantic/UX gaps, not replay the unit-test corpus.

## 41. Real-user observation data (Part 41)

Not collected in this session (no real tester interactions occurred here). The runbook
documents which fields to capture manually or via log inspection when Stage 1/2 actually
run: conversation id, hashed/redacted wa_id, runtime (legacy/R2), LLM call count,
capabilities executed, CommercialWork objective state, latency, finalizer disposition,
handoff, follow-up, errors - all already present in this repo's existing
`commercial_work_inbound_cycle_completed` event and `crm_capability_executions`/
`crm_agent_actions` audit trail; no new logging pipeline was built.

## 42-45. Access/autonomy/worker/follow-up test matrices (Part 42-45)

New file: `tests/commercial/autonomousRuntimeGates.test.ts`, 22 tests, all green
(`ACC00`-`ACC10`, `AUTO01`-`AUTO08`, `WORK16`-`WORK18`, `FU16`-`FU19` - numbered to
continue from the existing `WORK01`-`WORK15`/`FU01`-`FU15` implied by
`commercialWorkRetryWorker.test.ts`/`objectiveAwareFollowUp.test.ts`, which already
cover the A06/A07 mechanics this task deliberately did not re-test). See the file's own
header comment for exactly which pre-A11 mechanics it does *not* duplicate.

## 46-47. No direct Meta calls, no unnecessary background LLM (Part 46-47)

Confirmed by code inspection: neither `commercialWorkWorker.ts` nor
`objectiveAwareFollowUp.ts`/`runFollowupTick.ts` import any Meta/WhatsApp transport
client - both terminate at `persistAgentAction`/`executeActionThroughGate`. Follow-up
reminder text is template-based (`buildObjectiveFollowUpMessage`), never a fresh LLM
call - unchanged, A11 added no LLM call to any background loop.

## 48. Existing test-infra debt (Part 48)

Not misclassified as A11 regressions - confirmed via isolated re-run:
`salesAgentConfiguration.test.ts`'s `[R17]`/`[P21]`/`[P25]` failures (order-dependent
shared-`crm_test`-scope flakiness, pre-existing, first documented in A08.6/A08.7/A10) and
the 7 "Missing DATABASE_NAME" files. See Section "Full regression results" below for the
exact list observed this session.

## 49. Typecheck / build

`npx tsc --noEmit`: clean. `npm run build`: clean (see Section below).

## 50-51. Focused / full regression

See "Focused test results" and "Full regression results" below.

## Discovered blast radius, and how it was resolved

Placing the two new gates at `runNativeAutonomousCycle`'s single chokepoint (correct,
matching the existing Step 0/0.5 pattern) meant **every** pre-existing test that
exercises the real inbound pipeline - directly or through
`processNativeWhatsAppInbound`/`ensureAutonomousSalesTurnContinuity` - now defaults to
being blocked, since the new gates default to restrictive (`TEST_MODE=true` + empty
allowlist, `AUTONOMOUS_RESPONSES_ENABLED=false`). This is the correct, intended
consequence of a new fail-closed safety gate, not a design defect - the pre-existing
`BRAIN_AUTONOMOUS_TEST_WA_IDS` gate at the same chokepoint never had this effect only
because its own default (empty = unrestricted) is permissive.

**20 test files in the base commit `00e93e0`, plus 15 more discovered via this
session's own full regression run** (16 candidates found by broadening the search from
direct `runNativeAutonomousCycle(`/`runCommercialWorkTick(` callers to indirect callers
through `processNativeWhatsAppInbound`/`ensureAutonomousSalesTurnContinuity`; one of the
16, `legacySalesConsultativeAuthority.test.ts`, needed no change since it exercises a
different, DB-free code path) were updated to add
`BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true`/`BRAIN_WHATSAPP_TEST_MODE_ENABLED=false` to
their existing env setup block - opening the new gates so each file keeps testing
exactly what it tested before, the same pattern already established for the four
`runCommercialWorkTick`-calling files fixed in `00e93e0`. Additionally,
`lib/brain/commercial/work/benchmark/runR2Scenario.ts` (the shared R2 scenario
benchmark harness used by `r2ArchitectureScenarios.test.ts`/`r2ScenarioScoring.test.ts`,
including R2-05/R2-06's retry/crash-recovery scenarios) needed the same three
worker-level gates opened via explicit `runCommercialWorkTick` options, since it drives
the retry worker directly to simulate a real worker process.

## Focused test results

- `tests/commercial/autonomousRuntimeGates.test.ts` (new): **22/22 pass.**
- Directly-touched files re-run together: **206/206 pass**
  (`commercialWorkRetryWorker`, `commercialWorkSequencing`,
  `commercialWorkWaitingCustomerReactivation`, `commercialWorkSemanticCompleteness`,
  `commercialWorkParallelExecution`, `runFollowupTick`, `followUpRevalidationAndOptOut`,
  `objectiveAwareFollowUp`, `followUpRuntimeAuthority`, `autonomousRuntimeGates`,
  `customer360AutonomousBoundary`, `customerOnboardingPostPlanPrivacy`,
  `customerOnboardingPostPlanRuntime`, `customerSessionCustomer360Gate`,
  `multiRequestRuntime`, `runNativeAutonomousCycleCustomer360`,
  `runNativeAutonomousCycleOptOut`, `runNativeAutonomousCyclePilotIsolation`).
- `r2ArchitectureScenarios.test.ts` + `r2ScenarioScoring.test.ts` +
  `r2ArchitectureFollowUpScenarios.test.ts` (after the benchmark-harness fix):
  **30/30 pass**, including R2-05 (technical retry recovery) and R2-06 (crash
  recovery) - the two scenarios that specifically exercise the retry worker.

## Full regression results

`tests/commercial/**` + `tests/agent-loop/**` + `tests/native/**` + `tests/domains/**`
(run in command-length-safe chunks, full output and exit codes preserved in
`.test-logs/`). First pass surfaced 3 additional worker-gate-blast-radius files plus the
benchmark-harness gap (all fixed and re-verified above, see prior section).

**Second full pass (post-fix): 2681 tests, 2670 pass, 11 fail - all 11 are exact,
previously-documented pre-existing debt, zero new failures**:
- 7 "Missing DATABASE_NAME" order-dependent files (`createCustomerCapability`,
  `customerOnboardingPostPlanStage`, `customerSession`, `customerSessionPrivacy`,
  `linkExternalIdentityCapability`, `processInboundCommercialShadow`,
  `runCommercialOperationalLoop`) - documented since A08.6, re-confirmed unrelated in
  A09/A10.
- `[A13] GET /configuration?limit=999999 is clamped...` - documented since A08.6 as
  "seen in the very first run", pre-existing.
- `[P25]`/`[R17]` (`salesAgentConfiguration.test.ts`) - order-dependent shared-`crm_test`-
  scope flakiness; confirmed passing in isolation during this session (different tests
  in that file fail on different runs, a known pattern first documented in A08.6).
- `integration 11: el esquema instalado corresponde a la cadena canonica 001-023...` -
  documented `main_management` migration-checksum drift, pre-existing since before A08.6.

Exact per-batch pass/fail counts are in `.test-logs/a11-full-*.log`.

## Build

`npm run build`: PASS, clean, all routes compiled.

## What remains disabled by default (unchanged production activation state)

| Setting | State after this task |
|---|---|
| `BRAIN_WHATSAPP_TEST_MODE_ENABLED` | `true` (default, safe) |
| `BRAIN_WHATSAPP_TEST_WA_IDS` | empty (nobody autonomous until an operator sets it) |
| `BRAIN_AUTONOMOUS_RESPONSES_ENABLED` | `false` (default, safe) |
| `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED` | `false` (default, safe) |
| `BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED` | `false` (default, safe) |
| `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED`/`_WA_IDS` | unchanged (pre-existing R2 gate) |
| Parallel execution (A09) | unchanged, `false` |
| Public WhatsApp access | **not activated** |
| Production worker process | **not started** on any real instance by this task |
| Production follow-up process | **not started** on any real instance by this task |

## Exact environment variable table (Part 54)

| Variable | Default | Meaning | Production recommendation |
|---|---|---|---|
| `BRAIN_WHATSAPP_TEST_MODE_ENABLED` | `true` | WHO may enter autonomous processing at all | Keep `true` until Stage 3; set `false` only for a deliberate public rollout |
| `BRAIN_WHATSAPP_TEST_WA_IDS` | empty | Comma-separated allowlist (digits, any format) when `TEST_MODE=true` | Start with the owner's number only (Stage 1), expand deliberately (Stage 2) |
| `BRAIN_AUTONOMOUS_RESPONSES_ENABLED` | `false` | Global autonomy killswitch - independent of everything else | `true` only once Stage 1 owner-only validation is ready to run; the fastest rollback is flipping this back to `false` |
| `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` | `false` (pre-existing) | R2 routing master switch | Unchanged by A11 |
| `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` | empty (pre-existing) | Which wa_ids route to R2 vs legacy | Unchanged by A11 - decide independently of the access gate |
| `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED` | `false` | CommercialWork retry worker master switch | Enable only after `npm run backlog:report` review |
| `BRAIN_COMMERCIAL_WORK_WORKER_ACTIVATION_CUTOFF` | unset (no filtering) | ISO timestamp; steps created before this are never autonomously continued | Set to "now" the first time you enable the worker against a DB with historical backlog |
| `BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED` | `false` | R2 objective-aware follow-up master switch (legacy follow-up is ungated by this flag) | Enable only after `npm run backlog:report` review |
| `BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ACTIVATION_CUTOFF` | unset (no filtering) | Same idea, for R2 follow-up rows | Same guidance |

## Safe defaults (Part 55)

Confirmed by code inspection and by every new test's own default-config assertions
(`ACC00`): a fresh deployment with none of the A11-specific env vars set behaves exactly
as Part 55 requires - test mode on, empty allowlist (nobody), autonomy off, both workers
off, R2/parallel unchanged. No accidental public autonomous bot is possible from a
missing-env-var deploy.

## Rollback (Part 56)

See the runbook's Section 7/11 - `BRAIN_AUTONOMOUS_RESPONSES_ENABLED=false` +
`pm2 restart --update-env` is the fastest path, no code/git changes required.

## A11 readiness

**CODE_READY**: all code, tests, tooling, and documentation this task's scope
requires are complete, typechecked, and pass the full regression against real
MariaDB. **Real owner-number WhatsApp validation (WA01-WA12) has not been performed**
in this session - no live Meta credentials/owner phone were available to this agent.
Per the task's own Part 58 instruction ("if the environment is not available: produce
exact runbook for user"), the runbook and owner-only test script above are the
deliverable for that step; the operator must run it manually to move from
`A11_CODE_VALIDATED` to `A11_OWNER_ONLY_OPERATIONAL`.

======================================================================
REQUIRED FINAL BLOCK
======================================================================

SALES-AGENT-R2-A11: DONE

WhatsApp access gate:
IMPLEMENTED

Test mode flag:
BRAIN_WHATSAPP_TEST_MODE_ENABLED

Default:
true

Test WA allowlist:
IMPLEMENTED

Test mode ON + unlisted WA:
BLOCKED

Test mode ON + empty allowlist:
BLOCKED_ALL

Public mode:
SUPPORTED

Public mode activated:
NO

Autonomous response killswitch:
IMPLEMENTED

Killswitch default:
OFF

Killswitch blocks inbound autonomy:
PASS

Killswitch blocks worker autonomy:
PASS

Killswitch blocks follow-up:
PASS

Manual operator actions with killswitch OFF:
PASS

R2 routing gate:
UNCHANGED

Legacy/R2 double execution:
0

CommercialWork worker:
IMPLEMENTED

Worker production entrypoint:
scripts/autonomous-commercial-work-worker.ts (npm run worker:commercial-work)

Worker feature flag:
BRAIN_COMMERCIAL_WORK_WORKER_ENABLED

Worker default:
OFF

Worker restart recovery:
PASS

Two-worker duplicate execution:
0

Historical retry backlog reviewed:
YES (tooling created and run against crm_test this session; NO for any real
production instance - the operator must run npm run backlog:report there before
first activation)

Historical retry surprise risk:
0 (activation cutoff mechanism implemented and tested; zero risk once the operator
follows the runbook's backlog-review step before enabling)

Objective-aware follow-up worker:
IMPLEMENTED

Follow-up feature flag:
BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED

Follow-up default:
OFF

Follow-up stale customer reply sends:
0

Follow-up cancelled-objective sends:
0

Follow-up handoff sends:
0

Historical follow-up backlog reviewed:
YES (tooling created and tested; same caveat as above for a real production instance)

Historical follow-up surprise risk:
0

WAITING_CUSTOMER capability re-execution:
0 (A10 fix re-verified unaffected by A11's changes - same regression suite green)

WAITING_SYSTEM retry continuation:
PASS

Canonical outbox path:
PASS

Direct Meta calls from CommercialWork/follow-up:
0

PM2/process topology:
DOCUMENTED

Runbook:
CREATED

Backlog dry-run:
PASS

Stage 0 safe-off:
PASS

Stage 1 owner-only config:
READY

Stage 1 real WhatsApp validation:
NOT_RUN

Stage 2 multi-tester:
NOT_READY (blocked on Stage 1 real validation)

Public rollout:
OUT_OF_SCOPE

A06 retry regression:
PASS

A07 follow-up regression:
PASS

A08 sequencing:
PASS

A08.5 inbound:
PASS

A08.7 cancellation:
PASS

A09 parallel:
PASS

A10 WAITING_CUSTOMER:
PASS

lostCommercialWorkRate:
0%

unbackedCommercialMutationClaimRate:
0%

duplicateSideEffectRate:
0%

staleEvidenceExecutionRate:
0%

staleTurnAuthoritativeWriteRate:
0%

Typecheck:
PASS

Build:
PASS

Focused regression:
228/228 PASS (22 new autonomousRuntimeGates.test.ts + 206 directly-touched-file rerun)

Full regression:
PASS (2670/2681 across tests/commercial + tests/agent-loop + tests/native +
tests/domains; the 11 failures are exact pre-existing documented debt, zero new
failures - see .test-logs/a11-full-*.log)

Production worker activation performed:
NO

Production follow-up activation performed:
NO

Public WhatsApp activation performed:
NO

Production parallel execution:
OFF

Verdict:
A11_CODE_VALIDATED

Recommended next:
REAL WHATSAPP OWNER-ONLY VALIDATION (run the WA01-WA12 script from this doc / the
runbook, against a real instance with real Meta credentials and the Stage 1 env
from the runbook). Do not proceed to multi-tester rollout until that passes.
