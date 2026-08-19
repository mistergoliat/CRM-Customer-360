---
doc_id: release-sales-agent-r2-a08-6-closure
title: SALES-AGENT-R2-A08.6 - Semantic Completeness and Integration Closure
status: partial
last_reviewed: 2026-08-19
source_of_truth_for:
  - A08.6 closure evidence
depends_on:
  - ./SALES-AGENT-R2-A08.5-controlled-production-path-integration-live-validation.md
  - ./SALES-AGENT-R2-commercial-semantic-capability-matrix.md
tags:
  - release
  - sales-agent
  - commercial-work
---

# SALES-AGENT-R2-A08.6: Semantic Completeness and Integration Closure

Verdict: **R2_PRODUCTION_PATH_PARTIAL**. Not closed as fully validated - see "Remaining debt" below for the
exact blocking item. This document is the closure evidence for the work landed in commit `820da73`
plus the fixes made during this closure pass.

## 1. Starting A08.5 gaps

A08.5 (controlled production-path integration) shipped the CommercialWork production routing but left
three semantic gaps open: the multi-intent planner had no `create_quote`/cancel objective seeds (only
the executor supported them), a product-evidence guard gap could let an unresolved catalog reference
leak into execution, and several integration-layer bugs surfaced only once a real production-entry-point
test suite was written.

## 2-4. Production bugs discovered and fixed by commit 820da73 (before this closure pass)

1. **Sequencing/settle bug**: `settleCommercialWorkProjection.ts` silently dropped `sourceSequence`/
   `lastReconciledSequence`/lineage fields after any capability execution, disabling stale-turn protection
   after settle.
2. **recentCapabilityExecutions wiring**: existed but was never loaded into `settleCommercialWorkProjection`
   or `runCommercialWorkInboundCycle` reconciliation/projection - could make retry-scheduled steps disappear
   during reprojection and trigger duplicate capability execution in the same turn.
3. **Cancellation-state-machine fix**: cancelling a COMPLETED objective attempted `COMPLETED -> CANCELLED`,
   violating the state machine (only `COMPLETED -> SUPERSEDED` is legal). Fixed with a status-aware
   cancellation transition.
4. **Pending-intent cancellation fix**: `mergeCommercialIntents` didn't understand cancellation and could
   re-emit withdrawn pending intents during later turns, including the cancel turn itself.

## 5-6. Windows/environment fixes (previous session, already on develop as commit 7f20ebf)

5. **Windows migration EOL/checksum fix**: `.gitattributes` lacked `eol=lf` for `migrations/*.sql`, so a
   fresh Windows clone (`core.autocrlf=true`) checks migration files out as CRLF while `crm_test`'s stored
   checksums were computed from LF content - `npm run db:migrate` broke on any fresh Windows clone. Fixed.
6. **Outbox SQL filtering fix**: `outboxWorker.ts`/`autonomousOutboxTick.ts` fetched only the oldest 200
   planned rows (`ORDER BY planned_at ASC LIMIT 200`) and filtered the caller's `outboxIds` in JS
   afterward - a large backlog in `main_management.brain_message_outbox` (1,589 rows) silently hid any
   requested row beyond the first 200. Filter moved into SQL.

## 7. E2E timestamp-fixture fix (previous session)

`followUpDirectRuntimeValidation.e2e.test.ts`'s `forceDue` helper backdated a row's `created_at` before
the real customer message that triggered it, guaranteeing a false `customer_replied_since_schedule`
cancellation. Fixed to nudge `created_at` forward instead of backward, matching the documented pattern in
`runFollowupTick.test.ts#scheduleFollowUpAction`.

## 8. CWSEQ/R2-01 flakiness - root cause and fix (this closure pass)

**Root cause**: `assignCommercialTriggerSequence` (`lib/brain/commercial/work/sequencing.ts`) uses a
per-conversation `GET_LOCK` advisory lock, which correctly serializes concurrent callers targeting the
*same* conversation - but it does nothing to prevent a genuine InnoDB deadlock (error 1213) against an
*unrelated* transaction's gap locks on the same shared sequence tables, which becomes likely when many
sibling test files hammer the same small `crm_test` database concurrently (Node's default `--test`
concurrency runs multiple files in parallel). The function had no retry for this transient condition.

**Fix**: added a bounded 3-attempt retry (25ms/50ms/75ms backoff) specifically for `ER_LOCK_DEADLOCK`/
`ER_LOCK_WAIT_TIMEOUT` error codes, in `assignCommercialTriggerSequence`.

**Verification**: reproduced the deadlock directly (2/8 reruns of the real batch containing CWSEQ, before
the fix). After the fix: 20/20 clean sequential reruns of CWSEQ's real batch, 20/20 clean sequential
reruns of R2-01's real batch, 8/10 clean under a combined higher-concurrency batch (stopped at 8/10 on a
tooling timeout, not a failure). R2-01 itself was never independently reproduced pre-fix (only seen
failing twice across earlier full-suite runs, never isolated) - classified as resolved based on strong
post-fix stability evidence, not a confirmed pre-fix repro.

**Separately discovered, not fixed**: some test files depend on `process.env` mutations made by other
files loaded earlier in the same `--test` process (observed as `Error: Missing DATABASE_NAME` in
`processInboundCommercialShadow.test.ts` when run in an unexpected file combination). This is real,
order-dependent test-infrastructure fragility, logged as debt below.

## 9. Test-runner exit-code (this closure pass)

The exit-code-0-despite-failures finding reported at the end of the prior session was a **false alarm**
caused by that session's own `npm test | tee file` pattern (in a bash pipe without `pipefail`, the
reported exit code is `tee`'s, not `npm test`'s). Verified directly with a controlled failing test and a
controlled passing test (no pipe): `run-tests.ts` correctly returns non-zero on failure, zero on success.
Regression coverage added: `tests/scripts/runTestsExitCode.test.ts` (spawns the real script against an
isolated fixture directory, both directions).

A real, separate bug was found and fixed while verifying this: `run-tests.ts`'s CLI file-path filter
compared `relative()`'s backslash-separated Windows paths against forward-slash or bare-filename
arguments without normalizing separators, so `npm test tests/foo.test.ts` silently reported "No test
files found" on Windows. Fixed by normalizing both sides to forward slashes before comparing.

## 10-11. Stale test expectation cleanup (this closure pass)

- **Tool-count assertion**: `recommendCatalogProductsToolExposure.test.ts` asserted `AGENT_LOOP_TOOL_POOL.length === 9`
  with a comment attributing that count to `SALES-AGENT-R1-T2.1`. The real count is 10 (`create_quote` was
  added by `SALES-AGENT-R1-T3`, before A08.6, and the assertion was never updated). Replaced the magic
  number with an explicit named list of all 10 expected tools (`assert.deepEqual`), so any future
  addition/removal/reorder fails with a specific diff instead of drifting stale again.
- **Migration-count guards**: `customerIdentityAuditEvents.test.ts` ("T07 did not add a new persistence
  table") and `customerMasterProjectionGate.test.ts` ("no new migration file was added by T08.1") both
  asserted `Math.max(migration versions) === 24`, which is now permanently false (migrations legitimately
  extend to 031 for unrelated work). The real invariant - no migration filename matches the *specific*
  persistence concern each task was scoped to avoid - already existed as a filename-pattern check in
  T07's test; added the equivalent pattern check to T08.1's test and removed both stale version-number
  assertions.

## 12. Transport-retry cluster (this closure pass)

**Classification: pre-existing bug, unrelated to A08.6, unrelated to the outbox SQL fix.** Root-caused to
an idempotency-key mismatch in the legacy `autonomous-loop`/scenario-simulator harness (confirmed
via `git log`: last touched by `468fe7d`, an old, unrelated task; confirmed via `grep` that this module
is consumed only by `lib/brain/commercial/scenario-simulator/*` and its own tests - never by any real
`app/api/*` route). `executeAutonomousLoop.ts`'s `buildOutboxRecord` reused the human-readable `commandId`
string for the record's `idempotencyKey` field instead of the real, separately-derived dedupe key
(`buildOutboxCommand.ts`'s own comment: "commandId... is NOT the dedupe identity"). The fake transport's
scenario lookup is keyed by the real idempotency key, so it never matched, and every simulated
transport failure silently resolved as "accepted" instead. Fixed by threading the real idempotency key
through separately. Confirmed the fix resolves both the 4-test cluster in `autonomousCommercialLoop.test.ts`
*and* the previously-failing `scenarioSimulator.test.ts` case (same root cause).

## 13. Main_management checksum drift

**Classification: pre-existing, unrelated to A08.6, predates it by over a month.** Confirmed via direct
hash comparison that the drift is *purely* a CRLF-vs-LF checksum difference (same root cause as item 5
above, applied to `crm_test` last session but never to `main_management`), not real SQL content drift -
verified for migration 001 by comparing the git-committed blob's hash, a forced-CRLF variant's hash, and
the stored `schema_migrations` checksum; all three line up exactly with the CRLF-vs-LF hypothesis. 22 of
24 applied migrations mismatch, all applied in a single batch on 2026-07-15. This **blocks**
`npm run db:migrate` (default `dev` target) from ever reaching migrations 025-031 on `main_management`.
Not fixed here - touching `main_management`'s data/checksums was out of scope per explicit instruction.
**Remediation recommendation** (not executed): add `migrations/*.sql text eol=lf` is already in
`.gitattributes` (done last session); the remaining step is to update the 22 stored checksums in
`main_management.schema_migrations` to the LF-normalized values, which are content-identical to what's
already applied - this is a checksum-bookkeeping correction, not a schema/data change, but should be a
deliberate, separate, reviewed action given it touches a database this task was told to treat carefully.

## 14. Live quantity correction results

Real DeepSeek (`deepseek-v4-flash`), through `runCommercialWorkInboundCycle` (the real R2 entry point),
fixture-only Catalog/Carrier, real `crm_test`. 21 samples (7 phrasings x 3 reps): "mejor 3", "que sean 3",
"cambialo a 3", "deja 3", "solo 3", "mejor dame 4", "ponme 2".

- Semantic success: **21/21 (100%)**
- Wrong-product mutation rate: **0%**
- Unsupported/fallback: 0/21

Target (>=95% semantic correctness, 0% wrong-product mutation) met cleanly.

## 15. Live cancellation results

Same discipline, 18 samples (9 phrasings x 2 reps): "olvidalo", "olvidalo todo", "dejalo", "no importa",
"cancela eso" (expected: cancel whole work), "no necesito despacho", "olvida el despacho" (expected:
cancel shipping only), "no quiero cotizacion", "mejor no cotices" (expected: cancel quote only).

- Correct scope: **10/18 (55.6%)**
- Wrong-scope rate: **44.4%**

Not random noise: **every one of the 10 "whole-work" samples was correct (100%)**; **every one of the 8
"specific-scope" samples was wrong (0%), always collapsing to whole-work cancellation.** The executor
already supports scoped cancellation (proven by the offline suite's own "Part 3: cancelling shipping
preserves the product selection" test) - the gap is entirely in the planner, which never emits a scoped
cancel intent from natural Chilean Spanish phrasing that references a specific sub-concern, regardless of
how unambiguous the phrasing is to a native speaker. **Target (>=95% correct scope) missed. This is the
blocking finding for the PARTIAL verdict.** Investigated and confirmed as a real planner-coverage gap
(not a test-methodology artifact); user directed it be logged as debt rather than attempting a prompt/
planner fix in this pass, given the uncertain risk profile of iterating on planner prompt behavior
without a full re-validation cycle.

## 16. Live CREATE_QUOTE results

Same discipline, 10 samples (5 phrasings x 2 reps): "hazme una cotizacion", "cotizame esto", "quiero una
cotizacion", "mandame una cotizacion", "preparame la cotizacion".

- Semantic success (objective reached): **10/10 (100%)**
- Duplicate-objective-on-retry rate: **0%**

Target met at the semantic-planning layer. **Caveat, stated plainly**: this environment has no
`QUOTE_SERVICE_BASE_URL` configured, so actual external Quote Service execution and durable quote
evidence could not be live-validated - only that the planner reliably reaches a `CREATE_QUOTE` objective.

## 17. Live C09 regression

**Two real bugs found in the benchmark script itself (`scripts/live-c09-benchmark.ts`), not in
CommercialWork/A08.6 production code**, discovered while validating this section:

1. The R2 harness (via `processNativeWhatsAppInbound`) never overrode `BRAIN_AUTONOMOUS_TEST_WA_IDS` -
   only `BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS`. `runNativeAutonomousCycle`'s Step 0 pilot-isolation gate
   reads the former independently and correctly fail-closed every synthetic benchmark waId once a real
   pilot allowlist is configured in `.env` (as it now is), producing `wa_id_not_authorized_for_pilot` and
   10/10 silent "workStatus=none" results with near-zero latency. Fixed by also setting
   `BRAIN_AUTONOMOUS_TEST_WA_IDS` per turn.
2. After fixing (1), 10/10 R2 runs still showed `destinationCompleted: false`/`shippingCompleted: false`,
   consistently landing in `WAITING_SYSTEM` - a real behavioral difference from A08.5's own documented
   baseline (`sameCycleCompletionRate: 100%`). Root-caused via direct DB inspection of
   `crm_capability_executions`: `set_shipping_destination` failed with
   `error_code: configuration_unavailable` (the *real* `pc_pos` commune resolver, not the fixture one -
   `LOGISTICS_DB_ENABLED=false` in this environment). Cause: the *legacy* harness's own
   `runBenchmarkCase` calls `setupBenchmarkEnvironment()`/`teardown()` once per run (10 times), and
   `teardown()` resets the shared module-level commune-resolver/carrier-service caches back to the real
   integrations - since the R2 harness runs sequentially *after* all 10 legacy runs, it always inherited
   a cleared cache. Fix: re-install the fakes (`setupBenchmarkEnvironment()`) immediately before the R2
   harness loop starts.

**Status: fix applied and typechecked, but the full corrected `--runs=10` result was not re-verified to
completion in this session** - time-boxed at the user's explicit direction ("salta el C09") after the
root cause was found and the fix applied. The fix is evidence-based (confirmed via direct DB query that
the failure mode was `configuration_unavailable` on the real resolver, and that the legacy harness's own
teardown is the mechanism that clears the fake) but not re-confirmed end-to-end with a fresh 10-run
report. **Do not treat C09's live numbers as validated for this closure - re-run
`scripts/live-c09-benchmark.ts --runs=10` in a follow-up session before relying on it.**

## 18. Full-suite results

Full regression was run multiple times during this session (with resets between runs). All
previously-triaged clusters (CWSEQ/R2-01 flakiness, transport-retry, stale tool-count/migration guards)
are now fixed and stable. Remaining known failures, all pre-existing and unrelated to A08.6:
`integration 11` (main_management checksum drift, item 13 above), and any test-order-dependent env
fragility noted in item 8. See the session's final regression run for the authoritative current count.

## 19. Remaining debt

See the debt table below - nothing here is left as a vague "known issue."

## 20. Production rollout status

**Unchanged.** No production routing, feature-gate defaults, or allowlists were touched. R2/CommercialWork
routing remains behind `BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED` (default off) plus an explicit
`BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` allowlist, exactly as before this closure pass. No worker,
follow-up, or real Meta-send activation. No parallel execution.

## 21. A09 recommendation

**Not started, per explicit scope instruction.** Given the cancellation-scope planner gap (item 15) is the
single blocking item for full R2_PRODUCTION_PATH_VALIDATED status, the recommended next step before A09
is a small, dedicated task to close that specific gap (likely a planner prompt/schema addition for
cancellation scope, plus re-running the live cancellation benchmark to confirm >=95%) - not A09's parallel
execution work, which depends on a fully validated semantic baseline.
