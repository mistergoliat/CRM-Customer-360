# SALES-AGENT-R2-A08 - Conversation Sequencing and Stale-Turn Protection

Status: done
Scope: CommercialWork runtime primitives + DB-backed integration tests
Production global WhatsApp routing changed: NO
ACTIVE_RELEASE changed: NO

## Objective

Implement durable per-conversation commercial trigger ordering and reusable multi-turn reconciliation primitives so an older customer turn, worker run, follow-up, or work projection cannot become the authoritative current commercial state after a newer relevant event.

## What Changed

- Added migration `031_crm_commercial_work_conversation_sequence.sql`.
  - `crm_commercial_conversation_sequences`: one durable counter per conversation.
  - `crm_commercial_trigger_sequences`: idempotent trigger-to-sequence records keyed by `(conversation_id, trigger_dedupe_key)`.
  - `crm_commercial_work.source_sequence` and `last_reconciled_sequence`.
  - `previous_work_public_id` and `supersedes_work_public_id` for auditable work lineage.
- Added `work/sequencing.ts`.
  - Allocates a monotonic commercial sequence using a short DB advisory lock per conversation.
  - Duplicate provider/message triggers return the existing sequence.
  - Does not rely on JS memory locks or `created_at`.
- Added `work/reconciliation.ts`.
  - `reconcileCommercialObjectives(...)` replaces the A07.5 benchmark-only `carryForwardActiveObjectives` pattern.
  - `resolveCommercialWorkTarget(...)` centralizes active vs terminal work routing.
  - `reconcileCommercialTrigger(...)` produces create/update/stale-ignore decisions before capability execution.
  - Older turns are not rejected blindly; stale rejection is scoped to superseded commercial objective families.
- Added `work/semanticIntentAdapter.ts`.
  - Moves the `ResolvedIntent[] -> CommercialObjectiveSeed[]` mapper out of `work/benchmark/`.
  - The LLM boundary remains semantic planning only; reconciliation/projection/persistence/execution remain deterministic.
- Added `work/capabilityExecutionReader.ts`.
  - Minimal `crm_capability_executions` reader for recent capability evidence by opportunity/conversation/capability.
  - No generic analytics repository.
- Extended `CommercialWork` persistence.
  - Source sequence, last reconciled sequence, and lineage survive restart from DB.
  - Existing optimistic `version` remains the aggregate mutation guard; sequence is only trigger ordering.
- Hardened `commercialWorkExecutor.ts`.
  - Revalidates fact anchors after a side effect returns and before marking the step current.
  - A completed external call can remain historical/stale evidence without completing the current objective.

## Authority Boundary

`commercial_sequence` and `work.version` are separate:

- `commercial_sequence`: order of commercial triggers for one conversation.
- `work.version`: optimistic concurrency for one CommercialWork aggregate mutation.

A08 does not add a broker and does not hold locks around HTTP calls.

## Connected

Connected to the CommercialWork module and test/runtime primitives:

- projection type and persisted aggregate;
- repository create/update/hydration;
- executor pre/post side-effect stale evidence guards;
- retry worker path through the shared executor;
- benchmark semantic adapter now imports the reusable mapper.

Not connected globally to the production WhatsApp inbound router yet. A08 leaves production routing unchanged intentionally.

## Tests Executed

- `npm run db:migrate -- --database=test`
  - Applied `031` to `crm_test`.
- `npx --yes tsx@4.20.5 --test tests\commercial\commercialWorkSequencing.test.ts`
  - 8/8 pass.
- Focused regression:
  - `npx --yes tsx@4.20.5 --test tests\commercial\commercialWorkProjection.test.ts tests\commercial\commercialWorkRepository.test.ts tests\commercial\commercialWorkExecutor.test.ts tests\commercial\commercialWorkRetryWorker.test.ts tests\commercial\objectiveAwareFollowUp.test.ts tests\commercial\objectiveAwareFollowUpEligibility.test.ts tests\commercial\commercialWorkSequencing.test.ts`
  - 77/77 pass.
- `npx tsc --noEmit`
  - pass.
- `npm run typecheck`
  - pass.
- `npm run build`
  - pass; only pre-existing lint warnings were reported.

## Coverage Map

`tests/commercial/commercialWorkSequencing.test.ts` covers the required A08 invariants in grouped deterministic scenarios:

- CWSEQ01, CWSEQ02, CWSEQ25: monotonic allocation, duplicate inbound idempotency, restart DB source of truth.
- CWSEQ03, CWSEQ04, CWSEQ05, CWSEQ26, CWSEQ30: older customer turns cannot overwrite newer quantity/destination state.
- CWSEQ06, CWSEQ07, CWSEQ20, CWSEQ21, CWSEQ27: stale shipping/quote-style evidence remains historical after fact changes; blockers refresh.
- CWSEQ08, CWSEQ22, CWSEQ23, CWSEQ24: retry worker skips stale anchors; fresh shipping survives irrelevant turns; selection/destination changes invalidate old evidence.
- CWSEQ09, CWSEQ10, CWSEQ28: handoff/customer authority blocks autonomous execution before mutation.
- CWSEQ11: recent capability execution reader feeds projector with anchor-aware evidence.
- CWSEQ12-CWSEQ16: objective carry-forward, identity preservation, addition, modification supersession, cancellation.
- CWSEQ17-CWSEQ19: completed work correction creates new linked work; terminal work is not reopened.

## Residual Debt

- Production WhatsApp inbound still needs an explicit integration task to call `assignCommercialTriggerSequence(...)` and `reconcileCommercialTrigger(...)`.
- Follow-up dispatch still relies on A07's conservative customer-reply revalidation; A08 validates the shared ordering/stale primitives and worker/executor path, but does not globally rewire the follow-up worker to allocate its own commercial trigger rows.
- A09 parallel execution remains out of scope.

## Verdict

`SALES-AGENT-R2-A08: DONE`

Conversation-scoped sequencing and stale-turn protection are now durable, DB-backed, restart-safe, and covered by deterministic local tests against `crm_test`. Production global routing remains unchanged.
