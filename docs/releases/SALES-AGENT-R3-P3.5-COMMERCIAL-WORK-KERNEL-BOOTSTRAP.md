---
title: SALES-AGENT-R3-P3.5 - CommercialWork Kernel Bootstrap
doc_id: sales-agent-r3-p3-5-commercial-work-kernel-bootstrap
status: implemented_pending_db_validation
version: "1.0.0"
owner: sales-agent-r3
last_reviewed: 2026-09-16
depends_on:
  - ../AGENTS.md
  - ../PRODUCT_NORTH_STAR.md
  - ../ACTIVE_RELEASE.md
tags:
  - sales-agent-r3
  - commercial-work
---

# SALES-AGENT-R3-P3.5 - CommercialWork Kernel Bootstrap

## Objective

Give R3 a durable case kernel (`CommercialWork`) independent of the historical
CommercialWork/R2 cognition runtime, so a real turn (Conversation 83's own
shape: existing cart + destination, no durable objective yet) stops
projecting `NO_ACTIVE_WORK` in the P2 shadow observation. Explicitly
pre-authoritative: no objective reconciliation, no provider/prompt change, no
customer-visible mutation.

## Section 26 audit (performed before any code change)

1. `crm_commercial_work` rows are created by `persistCommercialWorkProjection`
   (`lib/brain/commercial/work/repository.ts`) - a pure "persist whatever
   `CommercialWork` object you hand it" function, agnostic of who built the
   object.
2. Objectives are never created by a separate function; they are fields on
   the `CommercialWork` object itself, produced by `buildCommercialWorkProjection`
   from `objectiveSeeds` (defaults to `[]`).
3. Work creation is coupled to R2 semantic planning only at the orchestrator
   level: `reconcileCommercialTrigger` (`reconciliation.ts`) mandates
   `semanticObjectives` and is called exclusively from
   `runCommercialWorkInboundCycle.ts` (the R2/legacy runtime). The lower
   primitives (`resolveCommercialWorkTarget`, `buildCommercialWorkProjection`,
   `persistCommercialWorkProjection`) are already generic.
4. Case creation is extractable/reusable: `ensureCommercialWorkCase.ts` calls
   `resolveCommercialWorkTarget` + a hand-built empty-objective `CommercialWork`
   + `persistCommercialWorkProjection`, never touching
   `reconcileCommercialTrigger`/`planCommercialObjectiveSeeds`.
5. The concurrency invariant is the existing `UNIQUE KEY
   uq_crm_commercial_work_correlation_key` (migration 029), on a key derived
   from `opportunityId:conversationId:sha256(activeObjectives)`. For an
   empty-objectives bootstrap this digest is constant, so two concurrent
   bootstraps collide on the unique key and `persistCommercialWorkProjection`
   already folds the loser into a reload of the winner's row. No new
   migration.

## Deviation from the brief's literal Section 15 wording (documented, using its own escape clause)

`deriveCommercialWorkStatus` (`evaluateCommercialWork.ts`) maps a zero-objective
work to `COMPLETED` - correct for a turn that reconciled down to nothing,
wrong for a fresh case kernel that has no objective *yet*: `COMPLETED` is
terminal and invisible to `findActiveCommercialWorks`, which would break the
reuse/idempotency requirement this bootstrap exists for (brief Sections
6/9/17/19 - a second call must return the *same* work). `ensureCommercialWorkCase.ts`
constructs the empty-objective `CommercialWork` directly with `status: "ACTIVE"`
instead of deriving it - reusing the existing `ACTIVE` enum value (no new
enum), only for this one bootstrap-only, zero-objective shape. Every other
`CommercialWork` producer in the codebase keeps deriving status normally.

## What shipped

- `lib/brain/commercial/work/ensureCommercialWorkCase.ts` (new): the durable
  case-kernel bootstrap. `resolveCommercialWorkTarget` decides reuse vs.
  create; reuse is a pure read (zero mutation, zero version bump); create
  persists an `ACTIVE`, zero-objective `CommercialWork` with a `SYSTEM_EVENT`
  trigger (`eventType: "commercial_work_kernel_bootstrap"`) via the existing
  `persistCommercialWorkProjection`. Never calls `reconcileCommercialTrigger`
  or `planCommercialObjectiveSeeds`. Never touches cart/destination/shipping/
  quote facts. Exported from `lib/brain/commercial/work/index.ts`.
- `BRAIN_R3_COMMERCIAL_WORK_KERNEL_ENABLED` (default `false`) -
  `buildCommercialWorkKernelFeatureFlags()` in `commercialCycleConfig.ts`,
  same pattern as `buildAgentTurnInputShadowFeatureFlags`. Deliberately its
  own flag, independent of `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` (untouched,
  still gates only the historical CommercialWork/R2 runtime) and independent
  of `BRAIN_R3_AGENT_TURN_INPUT_SHADOW_ENABLED` (the kernel can run without
  P2 observing it).
- Wired into `runSalesAgentRuntimeCycle.ts`, right after `opportunityId` is
  resolved and before the P2 shadow `buildDomainReadModel` closure is built
  (brief Section 12 - same turn, before P0/P1 construction). Only runs when
  `commercialWorkKernelEnabled && opportunityId !== null` - no opportunity
  means no case, reusing the existing lazy-opportunity-wiring rule rather
  than inventing a new "is this a real business context" check (brief
  Section 8). A bootstrap failure is caught and never blocks the turn (brief
  Section 20) - the existing R3 provider call proceeds exactly as if the
  flag were off.
- `commercial_work_kernel_resolved` PII-safe telemetry event
  (`conversationId`/`opportunityId`/`workId`/`workVersion`/`result`/
  `correlationId`, dedupe key = inbound message id) - `events/types.ts`,
  `events/normalize.ts`, `events/service.ts`, `events/dedupe.ts`. Write
  failures are swallowed (`.catch`), never affect the turn.
- Flag threaded through `runNativeAutonomousCycle.ts` and added to
  `.env.example`.

## Tests

`tests/commercial/ensureCommercialWorkCase.test.ts` (new, DB-backed against
real MariaDB `crm_test`, same fixture-seeding convention as
`commercialWorkRepository.test.ts`):

- Missing work + valid opportunity creates exactly one `ACTIVE`,
  objective-less case (P3.5-A/24-B).
- The bootstrapped case is immediately visible to `findActiveCommercialWorks`
  - the concrete mechanism behind `NO_ACTIVE_WORK` disappearing in P2
    (P3.5-B/H, 24-H).
- Existing work is reused with zero mutation (same version, no duplicate row)
  (P3.5-A/24-A, 24-G).
- Three repeated invocations stay idempotent (24-D).
- Five concurrent invocations converge on exactly one durable work, exactly
  one `CREATED` (24-E).
- Existing durable facts (`crm_request_facts`, `commercial_line_items`
  anchor) are untouched by the bootstrap (24-F).
- A terminal previous work (status `FAILED`, the one terminal status also
  visible to `findActiveCommercialWorks`) does not block a fresh bootstrap,
  and lineage (`previousWorkPublicId`) correctly points at it (24-G, brief
  Section 7/9). Documented as a known, narrow limitation: a *bootstrap-created
  empty-objective* work later transitioned to a terminal status would collide
  on the same (constant) correlation key on a subsequent bootstrap attempt
  and incorrectly reload the stale terminal row - not reachable today,
  nothing in this codebase transitions such a work to terminal yet; embedding
  status into the shared `buildCommercialWorkCorrelationKey` helper (used by
  R2 too) was judged out of scope for a P3.5 diff.

24-C (missing work + no commercial opportunity: do not invent one) is
enforced structurally, not by a unit test: `ensureCommercialWorkCase`
requires a non-null `opportunityId` in its input type, and the only
production caller (`runSalesAgentRuntimeCycle.ts`) gates the call itself on
`opportunityId !== null` before ever invoking it.

**Not executed in this session**: no local MariaDB (`127.0.0.1:3306`
connection refused) and no Docker daemon running (`docker version` reports
the daemon unreachable) - same limitation documented by every recent
SALES-AGENT-R3 task in this repo. `npx tsc --noEmit`, `npx eslint` (changed
files) and `npm run build` (30/30 pages) are clean; the pre-existing
`agentTurnInputShadow.test.ts` suite (pure, no DB) still passes 6/6
unchanged, confirming the new wiring did not regress the P2 shadow path it
sits next to.

## Explicit non-goals (unchanged from the brief)

`AgentTurnInput` -> DeepSeek wiring, typed R3 proposal, objective
reconciliation, cart-patch semantics, shipping-retry semantics, quote
creation, handoff changes, provider prompt changes, R2 planner, legacy
dispatcher removal. None of these were touched.

## Risk / debt

- DB-backed tests written but not run against a real database this session
  (see above) - must run before this is declared truly validated.
- The narrow terminal-work correlation-key collision described above is
  real but unreachable today; flagged for whichever future phase first
  transitions a bootstrap-created empty-objective work to a terminal status.
- No CAPABILITY_MATRIX.md update: this task adds internal case-kernel
  infrastructure, not an LLM-facing capability/tool, so no row's technical
  state changed.
