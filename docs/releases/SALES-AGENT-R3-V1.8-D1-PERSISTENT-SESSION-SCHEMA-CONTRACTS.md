# SALES-AGENT-R3-V1.8-D1 -- Persistent Session Schema + Contracts

Status: implemented. Real production code changed for the first time in
the `V1.8` sub-series (`V1.8-A` through `V1.8-D0` were audit/design/preflight
only). Scope is exactly what `V1.8-D0` unblocked: schema and type
preparation only -- no provider prompt change, no `deriveMessages()`, no
session history read into the model, no lock, no compaction, no backfill,
no flag, no WhatsApp behavior change, no Capability Gateway change. Every
non-goal in this task's own brief (Section A) was checked against the
actual diff before this document was written, not assumed.

## 1. Executive verdict

**`R3_V1_8_D1_SCHEMA_CONTRACTS_VALIDATED`**

Migration `034_agent_sessions_compaction_columns.sql` applied cleanly
against a real, reachable local MariaDB (`crm_test`) in this task's own
session -- unlike prior `V1.8` sub-tasks, a live database was available
throughout, so every claim below is verified by execution, not inferred.
359 targeted/regression tests run across three batches: 358 pass, 1 fails
-- and that one failure was independently reproduced against the exact
pre-`D1` baseline (via `git stash`) with the identical symptom, confirming
it is the same pre-existing MariaDB same-millisecond-ordering flake `V1.7`,
`V1.8-A`, and `V1.8-B` already documented, not a regression introduced
here. `npx tsc --noEmit` and `npm run build` are both clean.

## 2. Scope

Implemented, exactly as scoped:

- One additive migration (three nullable columns on `agent_sessions`).
- One new `AgentSessionEventType` (`SESSION_COMPACTED`), with a structured,
  domain-validated payload contract.
- One extended payload contract (`ASSISTANT_MESSAGE_SENT` gains an
  optional `outboundMessagePublicId`).
- `AgentSession`'s type (and both store implementations that construct it)
  extended with the three new compaction fields.
- `AgentLoopProviderResponse`/`httpAgentLoopProvider.ts` extended to parse
  and expose DeepSeek's real cache-accounting fields.
- Tests for all of the above, run for real against MariaDB and against a
  mocked HTTP provider (never a second live DeepSeek call -- `V1.8-D0`
  already proved the real fields exist).

Not implemented, exactly as scoped (Section 11):
`deriveMessages()`, session history reaching the model, any lock, any
retry/degrade behavior, backfill/bootstrap, compaction logic itself,
`close`/`reopen` lifecycle mirroring, any new flag, and propagation of
cache metrics into `AgentToolLoopLlmCallSummary`/`commercial_event` (a
real, evidence-based deferral -- Section 6/11).

## 3. Migration

**File**: `migrations/034_agent_sessions_compaction_columns.sql` -- chosen
by inspecting `migrations/` directly (highest existing number was `033`,
`agent_sessions.sql`, matching `V1.8-C`'s own target table).

Idempotent via the same `information_schema` + dynamic-SQL guard
`migrations/006_master_customer_platform_origin.sql` already established
in this repo (not a newly invented pattern) -- three independent guarded
`ALTER TABLE ... ADD COLUMN` blocks, one per column, each a no-op if the
column already exists.

**Applied and verified live, this task**:

```
npm run db:migrate -- --database=test
[run ] 034_agent_sessions_compaction_columns.sql
[done] 034_agent_sessions_compaction_columns.sql (200ms)
Applied: 1
Pending: 0
```

Re-run immediately after to confirm idempotent tracking:

```
npm run db:migrate -- --database=test
[skip] 034_agent_sessions_compaction_columns.sql
Applied: 0
Pending: 0
```

No table rebuild required (nullable `ADD COLUMN`, no default, no backfill).
No existing key/constraint touched. No row deleted or renamed.

## 4. New fields

`agent_sessions` gains three nullable columns, exactly as specified:

| Column | Type | Written by | Read by |
|---|---|---|---|
| `compacted_prefix_json` | `JSON NULL` | Nothing yet (D7) | `mariaDbAgentSessionStore.ts#sessionRowToContract` (new) |
| `compacted_through_seq` | `BIGINT UNSIGNED NULL` | Nothing yet (D7) | Same |
| `compacted_prefix_updated_at` | `DATETIME(3) NULL` | Nothing yet (D7) | Same |

`AgentSession` (`agent-session/types.ts`) gained the matching camelCase
fields (`compactedPrefixJson`, `compactedThroughSeq`,
`compactedPrefixUpdatedAt`), all nullable. Both `AgentSessionStore`
implementations construct the richer type now:

- `mariaDbAgentSessionStore.ts`: `sessionRowToContract` maps all three from
  the real row, using two new small helpers
  (`asJsonRecordOrNull`/`asIsoOrNull`/`asNumberOrNull`) that preserve `null`
  explicitly -- deliberately distinct from the pre-existing `asJsonRecord`
  (used for the NOT NULL `payload_json` column, which collapses an
  unparseable value to `{}`). Collapsing `compacted_prefix_json`'s `NULL`
  to `{}` would have made "no compaction has ever run" indistinguishable
  from "compaction ran and produced an empty prefix" -- a real distinction
  this design needs later, not a hypothetical one.
- `inMemoryAgentSessionStore.ts`: the fake's `ensureSession` now also
  returns all three, always `null` (no compaction possible in the fake by
  construction).

`AgentSessionStore`'s interface itself (`store.ts`) needed **zero changes**
-- exactly as `V1.8-D0` Section G anticipated: since `AgentSession` itself
gained the fields, every existing method signature (`Promise<AgentSession>`)
already returns them once the two implementations populate them. No new
method (`compactSession()`, `deriveMessages()`, `loadContext()`, `resume()`)
was added.

## 5. Event contract

`SESSION_COMPACTED` added to `AGENT_SESSION_EVENT_TYPES`
(`agent-session/types.ts`) -- purely additive to the const array, so
`AgentSessionEventType` (derived via `(typeof ...)[number]`) picks it up
automatically. `agent_session_events.event_type` is a plain `VARCHAR(64)`
with no DB-level enum/CHECK constraint, so no schema change was needed for
the event type itself (only the TypeScript union).

**Deliberately not added**: `TURN_STARTED`, `TURN_COMPLETED`,
`SESSION_RESUMED` as durable event types -- exactly per `V1.8-D0`/`V1.8-C`'s
own prior finding, restated in code now as a comment on the const array
itself so a future reader does not have to re-derive the reasoning:
`USER_MESSAGE_RECEIVED`/`ASSISTANT_MESSAGE_SENT` already serve as
turn-start/turn-complete markers once their append point moves (a D2
concern), and "resumed" stays an observability metric only (Section 9).

**Structured payload contracts** (new types in `agent-session/types.ts`,
not yet constructed or consumed by any call site -- purely a prepared
shape for D2+):

```ts
export type AgentSessionCompactedPayload = {
  fromSeq: number;
  toSeq: number;
  summaryEstimatedSize: number;
};

export function isValidAgentSessionCompactedPayload(payload: AgentSessionCompactedPayload): boolean {
  return (
    Number.isInteger(payload.fromSeq) && payload.fromSeq >= 0 &&
    Number.isInteger(payload.toSeq) && payload.toSeq >= payload.fromSeq &&
    Number.isInteger(payload.summaryEstimatedSize) && payload.summaryEstimatedSize >= 0
  );
}

export type AgentSessionAssistantMessagePayload = {
  inboundMessageId: string;
  outcome: "message" | "handoff" | "none";
  terminalReason: string;
  outboundMessagePublicId?: string | null;
};
```

Plain structural validation (integer/range checks), no schema library --
matching this module's own existing minimalism (`agent-session/dedupe.ts`'s
pure builder functions). `AppendEventInput.payload` itself stays
`Record<string, unknown>` -- this task did not attempt a discriminated-union
refactor of the store's generic interface (out of scope, Section G of
`V1.8-D0`'s own constraint on keeping the store contract small).

A matching dedupe-key builder was added to `agent-session/dedupe.ts`
(the file every other event type already has one in), following the
identical pattern:

```ts
export function buildSessionCompactedDedupeKey(sessionId: string, toSeq: number): string {
  return `session:${sessionId}:compacted:${toSeq}`;
}
```

`ASSISTANT_MESSAGE_SENT`'s real call site (`agent-session/shadowRecorder.ts`)
was **not modified** -- it still constructs the pre-existing, unextended
literal (`{inboundMessageId, outcome, terminalReason}`), exactly as this
task's own instruction required (D2's job). A dedicated test proves that
exact unmodified shape still round-trips correctly (Section 9).

## 6. Provider cache metadata

`AgentLoopProviderResponse` (`agent-loop/agentLoopProviderTypes.ts`) gains:

```ts
cacheReadTokens?: number | null;
cacheMissTokens?: number | null;
```

`httpAgentLoopProvider.ts`'s internal `OpenAiChatCompletionResponse.usage`
type gains:

```ts
prompt_cache_hit_tokens?: number;
prompt_cache_miss_tokens?: number;
```

Parsed into the existing `availableResponseMetadata` block (the same object
already used for `inputTokens`/`outputTokens`/`reasoningTokens`, already
spread into both the success return and the `empty_response`/
`invalid_model_json` failure metadata paths -- so the cache fields
automatically flow into both without any additional code):

```ts
cacheReadTokens: data.usage?.prompt_cache_hit_tokens ?? null,
cacheMissTokens: data.usage?.prompt_cache_miss_tokens ?? null,
```

**Request body is verified byte-identical** -- the change is entirely on
the response-parsing side; nothing in the `fetchImpl(endpoint, {body: ...})`
call was touched, confirmed by reading the diff directly (the `body:
JSON.stringify({...})` block is untouched) and by every existing
request-shape test (`[HP11]`-`[HP13b]`, `[HP29]`-`[HP31]`) still passing
unchanged (Section 9).

`AgentLoopProviderFailure` (`agent-loop/agentStepTypes.ts`) also gained the
same two optional fields -- required for the existing `{...availableResponseMetadata}`
spread at the `empty_response`/`invalid_model_json` throw sites to keep
type-checking (TypeScript's excess-property check on a spread-extended
object literal would otherwise reject the two new keys against the
narrower failure-cause type). This was found only by running `tsc`, not
anticipated in advance -- exactly the kind of small, mechanical
type-propagation this task's Section H asked for.

**Deliberately not wired further** (a real, evidence-based finding, not an
oversight): `AgentToolLoopLlmCallSummary`/`AgentToolLoopLlmMetricsPayload`
(`events/types.ts`) is the "central contract" Section I's brief gestures
at, and it is **sanitizer-bound** (flows into `agent_tool_loop_completed`'s
`commercial_event` payload via `normalizeAgentToolLoopCompletedCommercialEvent`).
That module's own existing doc comment already documents exactly the
landmine this task's field names would hit: `assertPlainSerializable`
rejects any key matching `/token/i`, which is precisely why that type
already uses `inputSize`/`outputSize`, never `inputTokens`/`outputTokens`.
Propagating fields literally named `cacheReadTokens`/`cacheMissTokens` into
that contract would be **rejected by the real sanitizer** -- the same class
of mistake `V1.8-D0` already caught for `summaryTokenEstimate`. Wiring this
correctly would also require touching `runAgentToolLoop.ts`'s own
turn-completion logic (where `AgentToolLoopLlmCallSummary` records are
actually built from provider responses), which this task's Section A
explicitly forbids ("no modificar comportamiento del agente"). **Left as a
named, documented deferred item** (Section 11), with the correct future
field names (`cacheReadSize`/`cacheMissSize`, matching the established
`...Size` convention) already recorded so a later slice does not have to
rediscover this.

## 7. Sanitizer compatibility

Sanitizer itself (`agent-session/sanitizer.ts`, `events/normalize.ts`) was
**not modified** -- confirmed by `git diff` showing zero changes to either
file. Four new regression tests added to
`tests/commercial/agentSessionSanitizer.test.ts`, executed for real (not
just reasoned about):

```
[D1] allows outboundMessagePublicId (ASSISTANT_MESSAGE_SENT extension) -- PASS
[D1] allows outboundMessagePublicId = null -- PASS
[D1] allows the full SESSION_COMPACTED payload: fromSeq, toSeq, summaryEstimatedSize -- PASS
[D1] rejects summaryTokenEstimate - the name V1.8-C proposed before V1.8-D0 found it fails the real sanitizer -- PASS (throws AgentSessionForbiddenPayloadError, as expected)
```

The fourth test is the one this task's own brief called out as important:
a standing regression test that fails loudly if a future refactor ever
reintroduces `summaryTokenEstimate` instead of the approved
`summaryEstimatedSize`.

## 8. Backward compatibility

Every claim in this task's own Section N, checked against the real diff
and real test runs, not assumed:

| Claim | Verified how |
|---|---|
| Existing `agent_sessions` rows still load | `[D1] a session row created before this migration reads back with all three compaction columns null` -- real MariaDB test, PASS |
| Existing session events still append | Full pre-existing `agentSessionStoreMariaDb.test.ts`/`agentSessionStore.test.ts` suites re-run, all pre-existing tests still PASS |
| Existing R3 turns behave identically | `agentToolLoopSessionShadow.test.ts` (116 tests) and `runAgentToolLoop.test.ts` re-run in full, all PASS -- including the explicit `"never persists message text"` test |
| Provider request body byte/semantically unchanged | `[HP11]`-`[HP13b]`/`[HP29]`-`[HP31]` (request-shape assertions) re-run, all PASS; `body: JSON.stringify(...)` construction untouched in the diff |
| No new DB field required at runtime | All three new columns are nullable with no default read anywhere in production code yet |
| No new event emitted in production yet | `SESSION_COMPACTED` has zero emitters (`grep` confirms `buildSessionCompactedDedupeKey`/the payload type have no call site outside the new tests) |
| No current caller depends on compaction metadata | Same -- zero readers of the three new `AgentSession` fields outside the new tests |
| No feature flag needed | Confirmed -- no flag was added, none was needed (every change is additive at the type/schema level only) |

**Deployable with zero customer-visible behavior change**: yes, on this
evidence -- the only two runtime files with logic changes
(`httpAgentLoopProvider.ts`'s response parsing, `mariaDbAgentSessionStore.ts`'s
row mapping) both only add optional/nullable data to what is already
returned; nothing reads either addition into a decision path anywhere in
this diff.

## 9. Tests

All three batches run for real this task (no test was skipped or assumed):

**Batch 1 -- sanitizer, store (unit + real MariaDB), summary, provider**:
`agentSessionSanitizer.test.ts`, `agentSessionStore.test.ts`,
`agentSessionStoreMariaDb.test.ts`, `agentSessionSummary.test.ts`,
`httpAgentLoopProvider.test.ts` -- **93 tests, 92 pass, 1 fail**.

The one failure (`loadRecentEvents ORDER BY occurred_at, seq returns true
insertion order for same-millisecond events`) was independently verified
as pre-existing, not introduced by this task:

```
git stash push -- lib/brain/commercial/agent-session tests/commercial/agentSessionStoreMariaDb.test.ts
npm test tests/commercial/agentSessionStoreMariaDb.test.ts
# -> 4 pass, 1 fail -- IDENTICAL failure, same test, against the exact pre-D1 baseline
git stash pop
```

Matches the exact flake `V1.7`'s "Remaining technical debt" and `V1.8-A`
section 13 already documented (MariaDB same-millisecond clock resolution)
-- not fixed here, per this task's own "do not fix unrelated pre-existing
failures" instruction.

**Batch 2 -- shadow recorder + full agent tool loop regression**:
`agentToolLoopSessionShadow.test.ts`, `runAgentToolLoop.test.ts` -- **116
tests, 116 pass.**

**Batch 3 -- broader R3-adjacent commercial regression** (Capability
Gateway, identity gate, `CommercialActionRequest`, `ReadToolRequest`,
`SalesAgentRuntime`, dispatch, routing -- the same category of subset
`V1.7`'s own regression run used): `capabilityGateway.test.ts`,
`capabilityGatewayHardening.test.ts`, `capabilityGatewayIdentityGate.test.ts`,
`commercialActionRequest.test.ts`, `customerIdentityCapabilityGateway.test.ts`,
`dispatchSalesAgentResponse.test.ts`, `identityCapabilityGatewaySummaries.test.ts`,
`readToolRequest.test.ts`, `runSalesAgentRuntimeCycle.test.ts`,
`salesAgentRuntime.test.ts`, `salesAgentRuntimeR3NativeDispatchAuthority.test.ts`,
`shouldRouteToSalesAgentRuntime.test.ts` -- **150 tests, 150 pass.**

**Total: 359 tests run, 358 pass, 1 pre-existing failure confirmed
unrelated by direct baseline comparison.**

Not run: the full, undirected `tests/commercial/` directory (161 files,
including domains this change cannot plausibly touch -- quotes, shipping,
onboarding, follow-up scheduling, etc.). Judged not affordable-for-value
given every file this change actually touches, and every file directly
adjacent to it, already ran clean -- consistent with this task's own
"if affordable" hedge on the full suite, not a shortcut taken silently.

**Also run**: `npx tsc --noEmit` (clean, zero errors) and `npm run build`
(clean, full Next.js production build completed with no errors).

## 10. Files changed

New:
- `migrations/034_agent_sessions_compaction_columns.sql`
- `docs/releases/SALES-AGENT-R3-V1.8-D1-PERSISTENT-SESSION-SCHEMA-CONTRACTS.md` (this file)

Modified (production code):
- `lib/brain/commercial/agent-session/types.ts` -- `AgentSession` gains
  three fields; `SESSION_COMPACTED` added to the event-type taxonomy;
  `AgentSessionCompactedPayload`/`isValidAgentSessionCompactedPayload`/`AgentSessionAssistantMessagePayload`
  added.
- `lib/brain/commercial/agent-session/dedupe.ts` -- `buildSessionCompactedDedupeKey` added.
- `lib/brain/commercial/agent-session/mariaDbAgentSessionStore.ts` -- three
  new row-mapping helpers; `sessionRowToContract` extended.
- `lib/brain/commercial/agent-session/inMemoryAgentSessionStore.ts` --
  `ensureSession`'s constructed session extended to match the richer type.
- `lib/brain/commercial/agent-loop/agentLoopProviderTypes.ts` --
  `AgentLoopProviderResponse` gains `cacheReadTokens`/`cacheMissTokens`.
- `lib/brain/commercial/agent-loop/agentStepTypes.ts` --
  `AgentLoopProviderFailure` gains the same two fields (required for
  `tsc` to pass on the existing spread pattern).
- `lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts` --
  `OpenAiChatCompletionResponse.usage` extended; parsing and both return
  paths extended.

Modified (tests):
- `tests/commercial/agentSessionSanitizer.test.ts`
- `tests/commercial/agentSessionStore.test.ts`
- `tests/commercial/agentSessionStoreMariaDb.test.ts` (also: outdated
  header comment claiming MariaDB was unreachable corrected, since it was
  reachable and used for real in this task)
- `tests/agent-loop/httpAgentLoopProvider.test.ts`

Modified (docs):
- `docs/ACTIVE_RELEASE.md` (this task's entry under the `SALES-AGENT-R3`
  workstream)

Not modified: `Capability Gateway` (any file), any routing file, any
prompt-building file (`buildAgentStepPromptPackage.ts`), any flag
definition, `AgentSessionStore`'s interface (`store.ts`), `summary.ts`,
`shadowRecorder.ts`'s call site.

## 11. Known deferred items

Explicitly out of scope for this task, per its own Section Q, restated
here as the concrete backlog for the slices named:

- **D2**: move `USER_MESSAGE_RECEIVED`'s append point before the loop;
  populate `outboundMessagePublicId` at the real `dispatchAgentLoopResponse`/
  `dispatchSalesAgentResponse` call sites; `close`/`reopen` lifecycle
  mirroring in `lib/domains/conversations/control.ts` (`V1.8-D0` section
  6); session-write retry (`RETRY_THEN_DEGRADE`, `V1.8-D0` section 12).
- **D3**: `deriveMessages()`; the bounded bootstrap reader; the session
  prefix reader; the short per-conversation concurrency lock (`V1.8-D0`
  section 4).
- **D7**: compaction itself -- the first real writer of
  `compacted_prefix_json`/`compacted_through_seq`/`compacted_prefix_updated_at`
  and the first emitter of `SESSION_COMPACTED`.
- **New, found this task**: propagating `cacheReadTokens`/`cacheMissTokens`
  into `AgentToolLoopLlmCallSummary`/`llmMetrics`/`agent_tool_loop_completed`
  requires touching `runAgentToolLoop.ts`'s turn-completion logic (out of
  this task's scope) and must use `cacheReadSize`/`cacheMissSize` there,
  never the provider-level names, or the real sanitizer will reject it
  (Section 6).

## 12. D2 prerequisites

Everything D2 needs from this task is now in place and verified:

- `AgentSession.compactedPrefixJson`/`compactedThroughSeq`/`compactedPrefixUpdatedAt`
  exist, are nullable, and round-trip correctly through both store
  implementations (Section 9).
- `AgentSessionAssistantMessagePayload` exists with `outboundMessagePublicId`
  as optional -- D2 can start populating it at the real dispatch call
  sites without any further type work, and can make it mandatory once
  every writer is migrated (per this task's own compatibility instruction).
- `AgentSessionCompactedPayload`/`isValidAgentSessionCompactedPayload`/
  `buildSessionCompactedDedupeKey` exist and are proven to pass the real
  sanitizer -- D7 can emit `SESSION_COMPACTED` events using this contract
  directly, no further type or sanitizer work needed.
- `AgentLoopProviderResponse.cacheReadTokens`/`cacheMissTokens` are real,
  parsed, and tested -- any future observability work (`V1.8-C` section 19)
  can read them directly off the provider response without touching
  `httpAgentLoopProvider.ts` again.
- The migration is applied and verified against `crm_test` -- D2/D3 do not
  need to touch schema at all for the work scoped to them.

## Verdict

**`R3_V1_8_D1_SCHEMA_CONTRACTS_VALIDATED`**

- Migration: `migrations/034_agent_sessions_compaction_columns.sql`,
  applied and re-verified idempotent against real `crm_test`.
- Schema changes: three nullable columns on `agent_sessions`.
- Contract changes: `SESSION_COMPACTED` event type + payload contract;
  `ASSISTANT_MESSAGE_SENT` payload contract extended (optional field);
  `AgentSession` type extended; provider response extended with cache
  metrics.
- Sanitizer: unmodified; four new regression tests, all passing, including
  the standing rejection test for `summaryTokenEstimate`.
- Cache metrics: `usage.prompt_cache_hit_tokens`/`usage.prompt_cache_miss_tokens`
  -> `cacheReadTokens`/`cacheMissTokens`, parsed and tested against a
  mocked response (no new live API call).
- Backward compatibility: verified by direct test execution across all
  eight of this task's own checklist items (Section 8) -- zero
  customer-visible behavior change.
- Tests: 359 run, 358 pass, 1 pre-existing failure independently confirmed
  unrelated via baseline comparison. `npx tsc --noEmit` and `npm run build`
  both clean.
- Does not advance to D2. Next actionable items are D2 (call-site wiring)
  and, independently, the `cacheReadSize`/`cacheMissSize` propagation this
  task deliberately deferred (Section 11).
