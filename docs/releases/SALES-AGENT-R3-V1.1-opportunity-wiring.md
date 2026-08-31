# SALES-AGENT-R3-V1.1 -- Opportunity Wiring Audit & Minimal Extraction

Status: audit complete, minimal extraction implemented and tested against
real MariaDB. No production routing changed, no flag added or flipped, no
`SalesAgentRuntime`/Harness work started (out of scope per the task brief).
This is the concrete implementation of the gap `docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`
already named and sequenced as **`R3-A06` -- `crm_opportunities` creation on
the Harness path** ("today ATL only mutates a pre-existing opportunity...
must land before ATL's conversational footprint widens"). This document
supersedes nothing in `A00`; it closes the one open item that document left
for a later task.

## Method

Read live code only, per the task brief and `AGENTS.md`'s "no asumas tablas,
vistas o workflows no observados": `runNativeAutonomousCycle.ts` end to end
(which runtime actually reaches which opportunity code, not which name a
prior doc used), `operational-loop/{loadCommercialState,persistCommercialState,
resolveOpportunityIdentity,types}.ts`, `work/{reconciliation,repository}.ts`,
`lib/brain/native-whatsapp/service.ts`, `lib/brain/commercial/sales-consultative/repository.ts`,
`lib/domains/opportunities/service.ts`, `migrations/004_ai_sdr_operational_loop.sql`,
and the R3-A01/A03/A04/A05 release docs for the parts of the contract already
locked in (`opportunityId: number | null` already threaded through
`CommercialActionRequest`, `AgentSession` events, and `FOLLOWUP_WAKE`).

One correction to `A00` surfaced by reading the live routing directly:
`A00` Phase 1 lumps `sales-consultative` / shadow / `operational-loop`
together as one disabled shape. Tracing `runNativeAutonomousCycle.ts` shows
this is imprecise -- `operational-loop` (`runCommercialOperationalLoop`,
`persistCommercialState`) is the **default fallback runtime**, reached
whenever `commercialWorkEnabled`/`agentToolLoopEnabled`/`multiRequestEnabled`
are all false for a `wa_id` but `BRAIN_COMMERCIAL_SHADOW_ENABLED`/
`BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED` are on -- distinct from the truly
disabled `sales-consultative` engine (`runSalesConsultativeService`, gated
off by `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED=false` per
`ACS-R1-05.1-T01`). This matters because it means `operational-loop` is live,
tested, real code today, not dead weight -- its patterns are worth auditing
seriously, which Phase 2/3 below does.

---

## Phase 1 -- Current opportunity map

| Component | Responsibility | Reads? | Creates? | Updates? | Uses `opportunity_key`? | Uses `version`? | Assumes intent/stage/objective? | Runtime-specific? | Reusable in R3? |
|---|---|---|---|---|---|---|---|---|---|
| `operational-loop/loadCommercialState.ts` | Loads opportunity candidates + resolves `activeState` for the shadow/operational-loop fallback runtime | Yes (by identity-anchor `OR` clause, not by key) | No | No | No (computes it separately, never queries by it) | No | Yes -- requires `BrainContextResolveResponse`/`CommercialContextBuilderResult`, tie-breaks on `primaryIntent` | Yes | **C** -- too coupled to the legacy input shape to call from a lightweight runtime event |
| `operational-loop/resolveOpportunityIdentity.ts` (`buildOpportunityKey`, `selectActiveCandidatesForIdentity`) | Derives `opportunity_key`, resolves `continue_existing`/`create_new`/`ambiguous`/`possible_reopen`/`terminal` | Reads candidates passed in | No | No | **Constructs it -- intent-derived** (`anchor:primaryIntent:channel:threadKey`) | No | Yes, heavily (primary_intent is baked into the key itself, plus a sales/service family compatibility model) | Yes | **C** for the key algorithm itself (see Phase 4); the *governance ideas* (terminal exclusion, ambiguity-is-a-real-state, no arbitrary fallback) are sound and were reused conceptually, not literally |
| `operational-loop/persistCommercialState.ts` | Transactional find-by-key/insert/update of `crm_opportunities` **and** insert of `crm_agent_decisions`, in one call | Yes (`SELECT ... WHERE opportunity_key = ?`) | Yes | Yes | Yes | Yes (optimistic CAS: `existingOpportunity.version` vs `previousState.version`, `incomingVersion` vs `expectedVersion`) | Yes -- `buildOpportunityValues` writes `primary_intent`/`stage`/`temperature`/`priority`/`requirements_json`/etc., and the decision insert is unconditional | Yes | **B** -- see Phase 2, the generic pieces were extracted into a new, smaller function rather than modifying this one |
| `work/reconciliation.ts` + `work/repository.ts` (R2 CommercialWork) | Durable aggregate persistence for the **`commercial_work` table** (a different table), optimistic concurrency | Reads `opportunityId` only as an **input** (`input.opportunity?.id ?? null`) | No | No | No | Yes, but for `commercial_work.version`, not `crm_opportunities.version` | Yes, for its own objective/step model -- irrelevant to `crm_opportunities` | Yes | Not applicable -- CommercialWork never touches `crm_opportunities` directly; confirms `A00`'s "ATL/CommercialWork only mutates a pre-existing opportunity" |
| `lib/brain/native-whatsapp/service.ts#loadActiveOpportunity` | **The actual live read source** for `context.opportunityId` on both the CommercialWork and ATL paths (via `buildNativeCommercialContext` -> `loadNativeConversationDetailByPublicId`) | Yes (`WHERE conversation_case_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1`) | **No** | No | No | No | No | Somewhat (single load function, two live consumers) | **B** -- same conversation-scoping reused in the new resolver; its real gap (no terminal-status filter, see Phase 7) is closed there, not patched in place |
| `lib/brain/commercial/sales-consultative/repository.ts` (`createOrUpdateOpportunityRecord`, `opportunityKeyFor`, `loadOpportunityByKey`) | Full opportunity CRUD for the **disabled** `sales-consultative` engine | Yes | Yes | Yes | Yes (own, third, independent key algorithm) | Not verified (out of scope -- dead by default) | Yes | Yes | **DO_NOT_REUSE** -- a third, independent implementation behind a killswitch (`BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED=false`); confirms there is no fourth hidden opportunity writer worth reusing either |
| `lib/domains/opportunities/service.ts` | Hub CRM read model (list/detail pages for operators) | Yes | No | No | No | No | No | UI-specific | Not the runtime repository -- confirmed read/UI-oriented as the task brief already suspected; never used as a base |
| `crm_agent_decisions`, `crm_agent_actions`, `crm_sales_need_profiles` | Attach decisions/actions/need-profiles to an opportunity | All FK/query by `opportunity_id` (numeric FK on `crm_agent_decisions`; plain column, no FK, on the other two) | N/A | N/A | No | No | N/A | Shared across runtimes already | Unchanged -- any numeric `opportunityId` this task's resolver returns is a valid FK target for all three, no adapter needed |
| `AgentSession` events (`R3-A03`/`A04`/`A05`) | `COMMERCIAL_ACTION_*`/`FOLLOWUP_WAKE` event payloads carry `opportunityId: number \| null` per event, never as a session-level column | Reads it as a plain field | No | No | No | No | No | Runtime-neutral already | Unchanged -- confirmed no `opportunityId` column exists on `AgentSession`'s own `types.ts`; it is conversational memory, never business truth (Phase 9) |

---

## Phase 2 -- `persistCommercialState.ts` audit

**Genuinely generic** (confirmed by reading the function line by line):
transaction (`beginTransaction`/`commit`/`rollback`), find-existing-by-key
(`SELECT id, version, status, stage, closed_at FROM crm_opportunities WHERE
opportunity_key = ?`), insert-if-absent/update-if-present branching,
optimistic-version comparison, `opportunityId` propagation via `insertId` or
the existing row's `id`, and a duplicate-decision short-circuit
(`crm_agent_decisions.decision_id` lookup) that makes retried writes
duplicate-safe.

**Operational-loop-specific** (also confirmed by reading, not assumed): the
function is **not separable at the call-site level**. A single call always
writes both `crm_opportunities` *and* `crm_agent_decisions` in one
transaction, and `buildOpportunityValues` requires the full
`CommercialOperationalState` shape -- `primary_intent`, `stage`,
`temperature`, `priority`, `current_summary`, five JSON array/object columns,
`waiting_for`, `next_action_type`, `next_action_due_at`,
`human_owner_active`, `ai_blocked`. There is no natural seam inside this
function that returns "just the opportunity part" without also requiring a
full decision record. Extracting a subset by deleting code from this
function would risk breaking the live shadow/operational-loop runtime for no
reason (`AGENTS.md` rule 6: don't touch working runtimes without an explicit
task to do so).

**Decision**: leave `persistCommercialState.ts` untouched. Build a new,
smaller function (Phase 6) that reuses the *pattern* -- transaction,
find-by-key, insert-if-absent, `crm_opportunities` column shape -- without
inheriting the decision-record coupling or the planner-shaped state.

## Phase 3 -- `loadCommercialState.ts` audit

Classified **C -- too coupled to the legacy runtime to reuse directly or
after light extraction**. Confirmed from the actual signature
(`CommercialOperationalLoadInput`): it requires
`inboundMessage: BrainNormalizedProcessInboundRequest`,
`brainContext: BrainContextResolveResponse`,
`commercialContext: CommercialContextBuilderResult | null` -- none of which a
lightweight `AgentRuntimeEvent` (conversationId/waId/customerMasterId/
channel/correlationId/currentTime) can supply without rebuilding the entire
legacy context pipeline first. Its terminal-exclusion and ambiguity-governance
*behavior* (Phase 7) is correct and worth preserving as a design principle,
but the function itself cannot be called as-is from R3.

Separately, and more relevant in practice: **this is not even the function R2
CommercialWork or ATL call today.** Both call
`loadActiveOpportunity` (`lib/brain/native-whatsapp/service.ts`, Phase 1
table), a much simpler, already-conversation-scoped query. That function is
class **B** -- reusable after extraction -- and is what the new resolver
(Phase 6) actually builds on.

## Phase 4 -- `opportunity_key` audit (critical)

`buildOpportunityKey` (`operational-loop/resolveOpportunityIdentity.ts:129`):

```ts
const anchor = hints.customerCandidateId ?? hints.waId ?? hints.customerMasterId ?? hints.leadId ?? hints.conversationCaseId ?? "unknown";
return ["opportunity", String(anchor), hints.primaryIntent, hints.channel, hints.threadKey].join(":");
```

**Finding: this key is intent-derived.** `hints.primaryIntent` comes from
`normalizeCommercialIntent`, a fixed 14-value enum
(`COMMERCIAL_INTENTS`/`CommercialIntent`), and it is embedded directly in the
key string (also folded into `hints.threadKey`, which is embedded again).
Carrying this key into R3 as-is would recreate exactly the state-machine/
fixed-intent coupling the task brief's design rule forbids ("do not
reintroduce... fixed objective enums... predefined conversational
workflows").

**Verified invariant check** for R3-V1: "same active commercial thread ->
resolves to same opportunity" and "terminal opportunity must not silently
absorb a genuinely new commercial thread." The intent-derived key does *not*
straightforwardly satisfy the first half -- `resolveOpportunityIdentity`'s own
code comments confirm `primaryIntent` legitimately drifts turn to turn within
one purchase (`selectActiveCandidatesForIdentity`'s doc comment: "a normal
within-purchase conversation naturally drifts across
product_inquiry/price_request/stock_request/etc"), which is exactly why that
module needs a *second*, separate in-memory resolution layer
(`selectActiveCandidatesForIdentity`, family-compatibility, ambiguity
governance) on top of the raw key lookup to correctly re-find the same
opportunity despite the key having changed conceptually. That two-layer
design is real engineering, not a mistake -- but it is a direct consequence
of choosing an intent-derived key in the first place, and R3 does not need to
inherit the problem it exists to solve.

**Conclusion**: the current key is unsuitable for direct reuse in R3.
**Do not redesign it in place** (it is correct and load-bearing for the live
operational-loop runtime); **define a new, non-intent key for the new
resolver instead** (Phase 5/6).

---

## Phase 5 -- Minimal runtime contract (implemented)

`lib/brain/commercial/runtime-opportunity/resolveRuntimeOpportunity.ts`:

```ts
export type RuntimeOpportunityContext = {
  opportunityId: number;
  opportunityKey: string;
  status: string;
  version: number;
};

export type RuntimeOpportunityResolution =
  | { status: "existing"; opportunity: RuntimeOpportunityContext }
  | { status: "created"; opportunity: RuntimeOpportunityContext }
  | { status: "unavailable"; reason: string };

export async function resolveRuntimeOpportunity(input: {
  conversationId: number;
  customerMasterId: number | null;
  waId: string | null;
  channel: string;
  correlationId: string;
  currentTime: string;
}): Promise<RuntimeOpportunityResolution>
```

**Deliberate deviation from the brief's illustrative shape**: the `"blocked"`
variant was dropped. No business rule blocks opportunity *resolution* itself
today -- identity sufficiency is already checked by a separate, existing
mechanism (`work/commercialIdentityGate.ts`) *after* an opportunity exists,
never by the resolver. Keeping an unreachable variant "for later" would be
exactly the speculative surface the task brief's anti-pattern list warns
against (no planner state, no fields nothing produces). If a real blocking
rule for opportunity anchoring itself is ever needed, adding the variant back
is a one-line, backward-compatible change (a new union member on an
already-narrow return type).

No `intent`/`objective`/`step`/`stage` field anywhere in this contract --
verified by the type definition itself, not by convention.

## Phase 6 -- Reuse decision: **Option B (EXTRACT)**

Per the task's own preference order (`A > B >>> C`):

- **Option A (pure reuse, thin adapter)** was not possible: no existing
  function returns just an opportunity id from lightweight input without
  either (a) requiring the full legacy planner context
  (`loadCommercialState`) or (b) writing a decision record it has no
  decision for (`persistCommercialState`).
- **Option C (rebuild)** was not justified: the schema
  (`crm_opportunities`, `UNIQUE KEY uq_crm_opportunities_opportunity_key`),
  the terminal-status vocabulary (`TERMINAL_OPPORTUNITY_STATUSES`, already a
  shared constant in `lib/brain/commercial/constants.ts`), the
  conversation-scoped read query (`loadActiveOpportunity`'s shape), and the
  advisory-lock-then-transact concurrency pattern (`sales-agent-configuration/repository.ts`'s
  `GET_LOCK`/`BEGIN`/.../`COMMIT`/`RELEASE_LOCK`, already audited and merged
  in this repository) are all sound and directly reusable.
- **Option B** was chosen: a new, small, standalone module that reuses every
  piece above, adds no new table, no new flag, and touches zero existing
  files.

```text
                    resolveRuntimeOpportunity (new, this task)
                            |
                reads crm_opportunities the same way
                loadActiveOpportunity already does
                (conversation_case_id, most-recent-updated)
                            |
                ┌───────────┴───────────┐
                │                       │
   Operational Loop (unchanged,   Future SalesAgentRuntime /
   its own persistCommercialState  CommercialActionRequest wiring
   keeps writing crm_opportunities (next task -- not started here,
   for the shadow/fallback runtime) see "Recommended next step")
```

Nothing about `persistCommercialState.ts`, `loadCommercialState.ts`,
`resolveOpportunityIdentity.ts`, `work/reconciliation.ts`, or
`loadActiveOpportunity` changed. The operational-loop runtime and R2
CommercialWork's own opportunity-context reads are byte-for-byte the code
they were before this task.

## Phase 7 -- Terminal opportunity semantics

Real, current terminal vocabulary (`lib/brain/commercial/constants.ts:178`,
`TERMINAL_OPPORTUNITY_STATUSES`): `won`, `lost`, `cancelled`, `archived`.
Reused directly -- not re-derived. (Minor pre-existing inconsistency noted,
not touched: `operational-loop/resolveOpportunityIdentity.ts` has its own
private `isTerminalOpportunityStatus` function with the identical four
values instead of importing this shared constant -- harmless duplication,
out of this task's scope to fix since it does not touch the new seam.)

**Verified real gap**: `loadActiveOpportunity`, the function R2 CommercialWork
and ATL actually call today, has **no terminal-status filter at all** -- it
returns the single most-recently-updated row for a `conversation_case_id`
regardless of status. A conversation whose most recent opportunity was
`won`/`lost`/`cancelled`/`archived` would today have that terminal row
treated as "the" opportunity by any code reading `context.opportunityId`.
This is a real, pre-existing, previously-undocumented correctness gap on the
live path -- distinct from, and simpler than, `operational-loop`'s already-
solved version of the same problem.

**Applied rule for R3-V1** (simple, per the brief, verified against the two
real domain semantics above rather than assumed): active (non-terminal) ->
reuse; missing -> create; terminal -> create a new one. No reopen mechanism
in this seam (the operational-loop's `possible_reopen`/human-review path is
a planner-level decision this resolver deliberately does not make -- it
would require the exact kind of judgement call Phase 12 forbids delegating
to this layer).

## Phase 8 -- Concurrency / idempotency (proven, not assumed)

Reused, not reinvented: the `GET_LOCK`/`RELEASE_LOCK` session-advisory-lock
pattern already in production use by
`sales-agent-configuration/repository.ts` (`acquireScopeLock`/
`runInTransaction`), scoped per-conversation
(`runtime_opportunity:<conversationId>`) instead of per-scope. This fully
serializes concurrent resolutions for the *same* conversation -- the second
caller's read (inside the lock) already observes the first caller's commit,
so it returns `"existing"` instead of racing to create a sibling row. The
table's own `UNIQUE KEY uq_crm_opportunities_opportunity_key` remains a
second, independent backstop (unused in practice under this locking
discipline, but present because the schema already has it).

**Required V1 invariant, proven via test, not asserted**:
`tests/commercial/resolveRuntimeOpportunity.test.ts`, test "concurrent
resolution for the same conversation never creates two active opportunities"
-- 5 truly parallel (`Promise.all`) resolutions for one conversation against
real MariaDB converge on exactly one `opportunityId` and exactly one
`crm_opportunities` row. Passed on every run, not flaky-tolerant.

## Phase 9 -- Relation to AgentSession

Confirmed by reading `agent-session/types.ts` directly: **no
`opportunityId` field exists anywhere in `AgentSession`'s own type
definitions.** Every `opportunityId` reference in the R3-A03/A04/A05 slices
lives inside individual event *payloads* (`COMMERCIAL_ACTION_*`,
`FOLLOWUP_WAKE`), never as a session-level column -- `AgentSession` stays
non-authoritative by construction, not by convention alone. Nothing in this
task changes that. The new resolver returns a plain `RuntimeOpportunityContext`
that a caller can drop into an event payload exactly like today's `opportunityId:
number | null` fields already expect -- no adapter needed, confirmed by the
type shapes matching directly (`RuntimeOpportunityContext.opportunityId:
number` narrows cleanly into every existing `opportunityId: number | null`
field this audit found).

## Phase 10 -- Relation to CommercialActionRequest

`SELECT_PRODUCTS`/`SET_SHIPPING_DESTINATION`/`SELECT_SHIPPING_OPTION`/
`CREATE_QUOTE` (confirmed via `commercialActionRequest.test.ts` test #12,
already passing today) are denied by the real capability's own
`no_active_opportunity` check when `context.opportunityId` is `null` -- this
task does not change that gate. What this task provides is the missing piece
upstream of it: a way to make `context.opportunityId` non-null for a
conversation that has never had one. **Not wired into
`runAgentToolLoop.ts`/`runNativeAgentToolLoopCycle.ts` in this task** --
per the task brief, starting that wiring is the beginning of widening ATL's
mutation surface / `SalesAgentRuntime` work, explicitly out of scope here.
The resolver is built, tested, and contract-compatible; connecting it at the
`AgentRuntimeEvent` boundary is the next task (see "Recommended next step").

## Phase 11 -- Relation to read tools

Not eagerly wired anywhere in this task, so this is a design decision for
the *next* task to make correctly rather than something this task forces:
`resolveRuntimeOpportunity` was built to be called lazily, at the point a
mutating `CommercialActionRequest` is about to be built -- **never** for a
read-only tool call. Evidence this is the right default, not a guess: today,
`search_products`/`explore_catalog`/`get_product_details`/
`recommend_catalog_products`/`calculate_shipping` never read or require
`opportunityId` at all (confirmed via `A00`'s own `ReadToolGateway`
classification and by this audit's reading of `runAgentToolLoop.ts`'s tool
pool) -- "que barras tienen?" must keep working with zero opportunity
mutation, exactly as the task brief requires.

## Phase 12 -- No state machine reintroduced

Verified directly against the implementation, not asserted: the new module's
only exported types are `RuntimeOpportunityContext` (id/key/status/version)
and `RuntimeOpportunityResolution` (existing/created/unavailable). No
`semanticIntent`, `objectiveType`, `plannedSteps`, `nextIntent`,
`workflowState`, or `conversationPhase` field exists anywhere in it -- grep
confirms zero occurrences of any of those terms in the new file.

---

## Phase 13 -- Implementation

**Option B (EXTRACT)**, per Phase 6.

New files only, nothing existing modified:

- `lib/brain/commercial/runtime-opportunity/resolveRuntimeOpportunity.ts`
- `tests/commercial/resolveRuntimeOpportunity.test.ts`
- this document

## Phase 14 -- Tests

`tests/commercial/resolveRuntimeOpportunity.test.ts`, 6 tests, real MariaDB
(`crm_test`), all green:

1. no prior opportunity -> creates one, `status: "new"`
2. active opportunity -> reused, not duplicated (same `opportunityId`/`opportunityKey`, row count stays 1)
3. idempotent -- three sequential resolutions for the same conversation never grow the row count
4. terminal opportunity (`status` forced to `won`) -> **not** reused, a new one is created (different id and key), and that new one is what a *following* resolution reuses -- the terminal row never resurfaces
5. **concurrent** resolution (5-way `Promise.all`, same conversation) -> exactly one `opportunityId`, exactly one row (Phase 8's required invariant, proven)
6. `customerMasterId`/`waId`/`channel`/`conversationId` propagate correctly onto the created row

Deliberately not tested here (would require dropping `crm_opportunities` from
a shared `crm_test` database other test files depend on concurrently -- not a
safe action in this environment): the `"unavailable"` path. It reuses the
same `hasTable`/try-catch discipline already exercised by
`persistCommercialState.ts`'s own tests elsewhere in this repo.

Full regression check: `tests/commercial/opportunityContinuity.test.ts` (14
tests, operational-loop's own identity resolution), `commercialWorkRepository.test.ts`
(14 tests, R2's own `commercial_work` persistence), `crmTableNames.test.ts`
(9 tests) -- **37/37 green**, run after this task's change, confirming zero
regression to either existing runtime. `npx tsc --noEmit`: clean.

## Phase 15 -- Documentation

This document.

---

## Limitations (explicit)

- **No wiring into any runtime call site.** `resolveRuntimeOpportunity` is
  built and tested standalone. Nothing calls it yet -- not
  `runAgentToolLoop.ts`, not `runCommercialWorkInboundCycle.ts`, not
  `runNativeAutonomousCycle.ts`. This is intentional per the task brief
  ("Do not start SalesAgentRuntime implementation in this task").
- **No in-place update of business fields.** The resolver only creates or
  reuses; it never transitions `crm_opportunities.status`/`stage` for an R2/
  ATL-created row. That remains a real, separate gap (status transitions for
  R2/ATL-originated opportunities have no writer at all today, confirmed
  during this audit) -- out of scope, not silently worked around.
- **`loadActiveOpportunity`'s terminal-filter gap is not patched in place.**
  It still returns the most-recent row regardless of status for its existing
  callers (`buildNativeCommercialContext`, the delivery-status webhook
  projection, the Hub conversation detail API). Patching it was out of scope
  (`AGENTS.md` rule 6: don't touch auth/cases/chats/dashboard/APIs without an
  explicit task) and was not needed for this task's own invariant, since the
  new resolver does its own terminal check independently.
- **No reopen path.** A terminal opportunity always yields a new one; there
  is no `possible_reopen`/human-review equivalent in this seam.

## Rollback

Purely additive, two new files, one new doc:

1. Delete `lib/brain/commercial/runtime-opportunity/`.
2. Delete `tests/commercial/resolveRuntimeOpportunity.test.ts`.
3. Delete this document.

No migration to revert (no schema change). No flag to flip (none added).
Every other runtime's behavior is provably unchanged (Phase 14's 37/37
regression run).

## Recommended next step

Wire `resolveRuntimeOpportunity` into the `AgentRuntimeEvent` -> Identity ->
Opportunity binding step the task's own architecture diagram describes,
immediately before a mutating tool call becomes a `CommercialActionRequest`
(`runAgentToolLoop.ts`'s `use_tool` handling for
`select_products`/`set_shipping_destination`/`select_shipping_option`/
`create_quote`) -- lazily, only when one of those four is about to be built,
never eagerly for a read-only turn (Phase 11). This is exactly the work
`docs/architecture/SALES-AGENT-R3-A00-target-architecture.md` already named
`R3-A06` and sequenced before `A07`/`A08`; this task's extraction is what
makes it a small, low-risk wiring change instead of a new-repository task.

---

## Exit criteria

**`R3_V1_1_OPPORTUNITY_WIRING_VALIDATED`**

- No parallel Opportunity Engine introduced -- confirmed: one new function,
  one table (`crm_opportunities`, unchanged schema), zero new persistence
  concepts.
- Existing correct persistence semantics reused, not rebuilt -- confirmed:
  schema, terminal-status constant, conversation-scoped read shape, and the
  `GET_LOCK` concurrency pattern are all pre-existing and reused verbatim or
  near-verbatim.
- Runtime gets a durable `opportunityId` when required -- confirmed via
  tests 1/2/4.
- Active opportunities are reused correctly -- confirmed via test 2.
- Terminal opportunities do not corrupt new commercial work -- confirmed via
  test 4 (new opportunity created, terminal one never resurfaces).
- Concurrent resolution is safe -- confirmed via test 5 (5-way real
  concurrency, one winner).
- Opportunity lifecycle does not depend on semantic intent/objective/steps
  -- confirmed by the type contract itself (Phase 12).
- `AgentSession` remains non-authoritative -- confirmed, untouched, no
  `opportunityId` column exists on it (Phase 9).
- `CommercialActionRequest` can consume the resolved opportunity -- confirmed
  by type compatibility (`RuntimeOpportunityContext.opportunityId: number`
  narrows directly into the existing `opportunityId: number | null` fields
  across `CommercialActionRequest`/`AgentSession` events/`FOLLOWUP_WAKE`);
  **not yet wired** (Limitations, above) -- that is the next task, not a
  blocker found here.
- Read tools remain as unconstrained as current business semantics allow --
  confirmed, nothing in the read-tool pool was touched or made to depend on
  this resolver.
- Existing Operational Loop remains compatible -- confirmed, zero files
  touched, 14/14 `opportunityContinuity.test.ts` green.
- `CommercialWork` remains compatible -- confirmed, zero files touched,
  14/14 `commercialWorkRepository.test.ts` green.
- No WhatsApp routing changed -- confirmed, `runNativeAutonomousCycle.ts`
  untouched.
- Regressions are clean -- confirmed, 37/37 targeted regression tests green,
  `npx tsc --noEmit` clean.
