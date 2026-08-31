# SALES-AGENT-R3-A02 -- Generalized Identity Gate

Status: implemented, real-database verified. No production routing changed,
no LEVEL semantics changed, no second identity policy introduced. Closes the
`IDENTITY_GATE_GAP_FOUND` finding R3-A01 confirmed
(`docs/releases/SALES-AGENT-R3-A01-agent-session-store.md`, commit `76acadb`):
`create_quote` was reachable from the native Agent Tool Loop with no
`LEVEL_2_MASTER_RESOLVED` check, unlike CommercialWork's equivalent gate.

## Goal

Make commercial identity requirements runtime-independent: any mutating
commercial capability, regardless of which runtime originates the call (R2's
`CommercialWork`, the native Agent Tool Loop, the multi-intent action plan
executor, or a future `SalesAgentHarness`), must pass the same identity
sufficiency check before it can reach its side effect.

## Phase 1 -- Audit

Read live code first (`lib/brain/commercial/identity/commercial-identity-requirement/`,
`lib/brain/commercial/capability-gateway/`, `lib/brain/commercial/work/commercialIdentityGate.ts`,
`lib/brain/commercial/native-cycle/`, `lib/brain/commercial/multi-intent/`) before
designing anything.

**The shared decision mechanism already existed and needed no changes.**
`evaluateCommercialIdentityRequirement`/`decideCommercialIdentityRequirement`
(`identity/commercial-identity-requirement/{operations,evaluate,index}.ts`,
built in `SALES-AGENT-R2-ID-R2-A06`) is already exactly the runtime-neutral
seam Phase 2 of the task brief asked for: pure, no I/O, takes an operation and
a `RuntimeIdentityContext`, returns a deterministic, typed decision. R2's
`work/commercialIdentityGate.ts#applyCommercialIdentityGate` is just one
consumer of it (`CommercialObjectiveType -> CommercialOperation`, applied at
the objective-readiness boundary). Nothing here needed generalizing -- it was
already runtime-independent by construction.

**The real gap was structural, not logical: nothing called the evaluator
before a mutating capability's `execute()` ran, except R2's own
objective-level gate.** `executeGovernedCapability`
(`capability-gateway/executeCapability.ts`) is the single choke point every
caller already goes through -- confirmed by tracing every call site in
`lib/` (excluding tests): R2's `commercialWorkExecutor.ts` (via
`runCommercialWorkInboundCycle.ts`), the native Agent Tool Loop
(`runAgentToolLoop.ts`), the multi-intent action plan executor
(`multi-intent/actionPlanExecutor.ts`, via `runCommercialMultiIntentLoop.ts`),
`native-cycle/runCapabilityExecutionStage.ts` (the legacy pipeline's
capability-execution stage), and the three identity-mutation call sites inside
`runCustomerOnboardingPostPlanStage.ts`. None of them consulted A06's
evaluator before calling a capability's own `execute()` -- `create_quote`'s
`execute()` (`createQuoteCapability.ts`) never read identity at all.

### Capability / identity matrix

Built directly from `capability-gateway/registry.ts` +
`customerIdentityCapabilities.ts` (`CAPABILITY_GATEWAY_REGISTRY`, the single
source of truth for registration/governance) and
`identity/commercial-identity-requirement/operations.ts` (the canonical
requirement table, unchanged by this task).

| Capability | Side effect | Authority | Risk | Identity requirement | Enforcement before A02 | Enforcement after A02 | Gap? |
|---|---|---|---|---|---|---|---|
| `search_products` / `get_product_details` / `batch_get_products` / `explore_catalog` / `search_company_knowledge` / `recommend_catalog_products` | read_only | autonomous | low | NONE | n/a (read-only) | n/a (gate skips read-only) | no |
| `select_products` | mutating | autonomous | medium | NONE | n/a | shared gate: allowed (NONE) | no |
| `set_shipping_destination` | mutating | autonomous | medium | NONE | n/a | shared gate: allowed (NONE) | no |
| `calculate_shipping` | mutating | autonomous | medium | NONE | n/a | shared gate: allowed (NONE) | no |
| `select_shipping_option` | mutating | autonomous | medium | NONE | n/a | shared gate: allowed (NONE) | no |
| **`create_quote`** | mutating | autonomous | medium | `MINIMUM_LEVEL LEVEL_2_MASTER_RESOLVED` | **none** -- reachable from ATL/multi-intent with no identity check | shared gate, every caller | **yes -- closed** |
| `resolve_customer` | read_only | autonomous | low | NONE | n/a (bootstrapping, called precisely because identity is not resolved yet) | n/a | no |
| `create_customer` | mutating | autonomous (policy-gated internally) | medium | *excluded by design* -- own authority (`evaluateCreateCustomerAuthority`) | capability-local, correct | unchanged -- self-governed, gate skips it | no |
| `link_external_identity` | mutating | autonomous (consent-gated internally) | medium | `MINIMUM_LEVEL LEVEL_2_MASTER_RESOLVED` | capability-local consent check only, no generic level check | shared gate, every caller | **yes -- closed** (never reachable from ATL: no tool alias exists, but now also enforced at its one real call site, `runCustomerOnboardingPostPlanStage.ts`) |
| `link_prestashop_identity` | mutating | autonomous (consent-gated internally) | medium | *not in the canonical table* -- own, narrower precondition (`RuntimeIdentityContext.status === "READY_TO_LINK"`) inline in `execute()` | capability-local, correct | unchanged -- self-governed, gate skips it | no |
| `get_customer_purchase_history` | mutating (durable read persisted as fact) | autonomous | medium | `customer_profile_history` -> `MINIMUM_LEVEL LEVEL_3_PRESTASHOP_LINKED` | R2 objective gate only (`REPEAT_PURCHASE` mapping in `commercialIdentityGate.ts`); never LLM/ATL-reachable (no tool alias) | shared gate too (parity) | no (already correct, now also independently guaranteed) |
| `get_customer_recommendation_signal` | mutating (durable read persisted as fact) | autonomous | medium | `customer_profile_history` -> `MINIMUM_LEVEL LEVEL_3_PRESTASHOP_LINKED` | same as above | shared gate too (parity) | no |
| `assisted_sale_handoff` | dispatch only, no Capability Gateway capability | -- | -- | `MINIMUM_LEVEL LEVEL_1_CHANNEL_OBSERVED` | R2 objective gate only | unchanged (never reaches `executeGovernedCapability`) | out of scope (no capability exists) |
| `order_status_entity_verification` | no capability registered yet | -- | -- | `ENTITY_VERIFICATION(order)` | none (mechanism exists, no caller yet) | unchanged | out of scope (nothing to gate) |

`create_quote` was the only capability reachable from a real, LLM-facing
runtime (the native Agent Tool Loop, aliased in `toolAliases.ts`... actually
not aliased either, it is added directly to `AGENT_LOOP_TOOL_POOL` -- see
`runAgentToolLoop.ts`) with an identity requirement and zero enforcement.
`link_external_identity` had a real, if narrower, gap at its one call site
(never LLM-reachable, but never level-checked either).

## Phase 2/3 -- Shared contract and operation mapping

No new decision engine. Two small additions:

1. `identity/commercial-identity-requirement/capabilityOperations.ts` (new):
   `getCommercialOperationForCapability(capability) -> CommercialOperation | null`
   -- the single, explicit `capability name -> CommercialOperation` mapping,
   mirroring `commercialIdentityGate.ts`'s own
   `COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION` pattern one layer down. Capability
   names equal their operation name in every case except
   `get_customer_purchase_history`/`get_customer_recommendation_signal`, which
   both share A06's single `customer_profile_history` LEVEL_3 boundary
   (already documented that way in `operations.ts`).
   `isIdentitySelfGovernedCapability(capability)` marks the two capabilities
   whose real identity/consent authority is fully owned by their own
   `execute()` and must never be re-decided generically: `create_customer`
   (excluded from the canonical table by the table's own pre-existing design)
   and `link_prestashop_identity` (gated on the narrower `READY_TO_LINK`
   precondition, which a `MINIMUM_LEVEL` requirement cannot express without
   duplicating it).
2. `capability-gateway/identityGate.ts` (new):
   `evaluateCapabilityIdentityGate(capability, governance, context)` -- a
   pure function (no I/O) that: skips read-only capabilities; skips
   self-governed capabilities; fails closed (`identity_requirement_unresolved`)
   for a mutating capability with no operation mapping; allows a NONE
   requirement through without ever touching `RuntimeIdentityContext`; fails
   closed (`identity_context_unavailable`) if the requirement is not NONE but
   no `RuntimeIdentityContext` is available; otherwise calls A06's own
   `decideCommercialIdentityRequirement` and maps its decision onto the
   Capability Gateway's own `CapabilityAvailabilityStatus`/
   `CapabilityGatewayExecutionStatus` vocabulary (`denied` for a real block,
   `temporarily_blocked` for `SYSTEM_WAIT`) using the decision's own
   `policyCode` (lowercased) as the `errorCode` -- never a second, parallel
   error taxonomy.

## Phase 4 -- Enforcement boundary

`executeGovernedCapability` (`capability-gateway/executeCapability.ts`) now
calls `evaluateCapabilityIdentityGate` immediately after resolving the
registered definition and before `checkAvailability`/`execute` ever run. This
is the single choke point identified in Phase 1 -- every current caller
inherits it automatically, with **zero changes needed at any call site**,
because every one of them already threads `context.trustedCustomerSession`
(assembled once per turn by `resolveNativeCustomerSession`, unconditionally,
before any runtime branch is chosen -- confirmed live in
`runNativeAutonomousCycle.ts`) through to `executeGovernedCapability`. The
gate reads `context.trustedCustomerSession?.runtimeIdentity` -- the same
`RuntimeIdentityContext` R2's own objective gate reads, never a second copy.

**Relationship to `docs/architecture/SALES-AGENT-R3-A00-target-architecture.md`.**
A00 (section D) describes a future state where a `CommercialActionRequest`
passes the generalized gate *before* reaching `executeGovernedCapability`,
and (section F) says the Capability Gateway itself should stay `KEEP,
unchanged`. `CommercialActionRequest` does not exist yet (Phase 7 of this
task explicitly forbids building it now), so there is no pre-gateway boundary
for a Harness-originated call to hook into today. Placing the check as the
first thing `executeGovernedCapability` does achieves A00's actual invariant
("no mutating capability requiring identity reaches its side effect without
the gate") for every *current* caller with no per-caller wiring, and composes
cleanly with A00's future design: `evaluateCapabilityIdentityGate` is a
standalone, pure function a future Kernel/Harness can also call earlier (for
a nicer pre-flight UX, exactly mirroring how R2's objective gate and this
execution gate already coexist -- see Phase 6) without this execution-level
guarantee ever being weakened or removed.

## Phase 5 -- create_quote fix

Verified directly (`tests/commercial/capabilityGatewayIdentityGate.test.ts`):

- LEVEL_0 (`ANONYMOUS`) -- denied, `errorCode: "master_identity_required"`.
- LEVEL_1 (`CHANNEL_OBSERVED`) -- denied, same code.
- LEVEL_2 (`MASTER_RESOLVED`) -- allowed, reaches the real capability
  (proven by letting it fall through to the capability's own
  `quote_service_not_configured` failure mode, never the identity code).
- LEVEL_3 (`PRESTASHOP_LINKED`) -- allowed.

The denial is a typed, observable `CapabilityGatewayResult`
(`status: "denied"`, a stable `errorCode`, audited like every other Gateway
outcome) -- never a thrown exception, never a fabricated quote, never a
silent anonymous-quote degradation. Quote Service is never called on a
denied request (proven by the errorCode never matching the capability's own
`quote_service_not_configured`/`no_active_opportunity` codes).

## Phase 6 -- R2 parity

R2's objective-level gate and this execution-level gate both call the
identical `decideCommercialIdentityRequirement` -- they agree by
construction, not by convention. Verified with a parity test that computes
the raw A06 decision and the shared-gate outcome independently, across every
`IdentityLevel`, for `create_quote`, `link_external_identity`, and
`get_customer_purchase_history` (12 assertions, all green). This is
deliberate double-gating, not contradictory gating, exactly as Phase 6 of the
task brief anticipates: R2 still projects an identity blocker into its
objective model (a `WAITING_CUSTOMER`/`BLOCKED` status, a customer-facing
message) *and* the execution boundary independently guarantees the same
rule, so a future bug in the objective-derivation path can never let a
`READY` step reach its side effect without a resolved identity.

## Phase 7 -- Future R3 compatibility

Not implemented here, on purpose: `CommercialActionRequest`,
`SalesAgentHarness`, `AgentSessionStore` coupling, DeepSeek, ATL prompt
format, `CommercialWork` `publicId`. `evaluateCapabilityIdentityGate` takes
only a capability name, its governance metadata, and a
`CapabilityGatewayContext` -- the same three things every existing caller
already has, and the same three things a future
`CommercialActionRequest -> executeGovernedCapability` call will have. R3-A03
can call it directly, either as an early pre-flight check (via the exported
pure function) or simply by relying on the fact that
`executeGovernedCapability` already enforces it for any 8th caller with no
further wiring.

## Phase 8 -- Observability

A denied/blocked identity-gate outcome is persisted through the exact same
`insertCapabilityExecution` path (`crm_capability_executions`) every other
Gateway outcome uses -- same table, same writer, no second audit path. The
persisted `response_summary_json` carries only: `capability`, `operation`,
`requiredLevel`, `observedLevel`, `observedStatus`, `decisionStatus`,
`policyCode`. `correlationId`/`conversationId`/`opportunityId` are the
Gateway's own existing columns. Verified (`capabilityGatewayIdentityGate.test.ts`,
"[15] No PII"): the exact persisted object for a denied `create_quote` call
is asserted with `assert.deepEqual` against that seven-key shape -- no
phone/email/wa_id/address/secrets/model reasoning, matching
`RuntimeIdentityContext`'s own pre-existing guarantee (it never carries those
fields either -- `runtimeIdentityContext.ts`'s own module comment).

## Phase 9 -- Retry / worker safety

Decision: **revalidate on every call**, not once at proposal time -- and this
falls out of the architecture with no extra code. The gate runs synchronously
inside `executeGovernedCapability` itself, so:

- **Within one call's internal retry loop** (`executeGovernedCapability`'s
  own bounded `while (outcome.retryable && retryCount < maxRetries)`), the
  gate runs once before the loop -- correct, since these retries happen
  milliseconds apart with the same already-resolved `context` and identity
  cannot meaningfully change in that window.
- **Across genuinely separate invocations** (a worker tick, a follow-up
  firing, a new turn), each is a fresh call to `executeGovernedCapability`
  with a freshly built `context`, because `resolveNativeCustomerSession`
  recomputes `RuntimeIdentityContext` live from durable evidence every time
  it runs (`runCommercialWorkInboundCycle.ts`'s "Step 3", unconditional, every
  turn). A `create_quote` objective that was `READY` (and therefore
  identity-sufficient) when first derived is re-evaluated against a live
  `RuntimeIdentityContext` at the moment `commercialWorkExecutor.ts` actually
  calls `executeGovernedCapability` for it -- confirmed by reading
  `runCommercialWorkInboundCycle.ts` lines 307-366: the same `runtimeIdentity`
  value that gated objectives to `READY` is the one threaded into the
  executor's `context.trustedCustomerSession`, so there is no window where a
  stale, more-permissive identity fact could let an insufficient turn's
  `create_quote` through.

No code change was needed for this property -- it is a consequence of the
gate living at the execution boundary rather than being cached at proposal
time.

## Phase 10 -- Tests

`tests/commercial/capabilityGatewayIdentityGate.test.ts` (new, 25 tests, all
green against real MariaDB):

1. Canonical `capability -> operation` mapping, including the unmapped case.
2. A read-only capability is never gated.
3-5. `select_products`/`set_shipping_destination`/`select_shipping_option`
   remain `NONE` (allowed even with a completely missing runtime identity).
6-9. `create_quote` denied at LEVEL_0/LEVEL_1, allowed at LEVEL_2/LEVEL_3.
10. Through the real `executeGovernedCapability` entry point (not just the
   pure gate): a denied `create_quote` call never reaches Quote Service
   (proven by errorCode), is audited, and its audit row is PII-free; an
   allowed LEVEL_2 call reaches the real capability logic.
11. An unmapped mutating capability fails closed regardless of identity
   level; a mutating capability with no runtime identity context at all also
   fails closed.
12. R2/shared-gate parity across every `IdentityLevel` for three mapped
   operations (12 assertions).

Existing coverage that already proves 13/14 (ATL-origin and any future
generic caller receive the same gate) by construction, not by a redundant
test: item 10 above calls the *exact same* `executeGovernedCapability` that
`runAgentToolLoop.ts`, `actionPlanExecutor.ts`, and `commercialWorkExecutor.ts`
all call with no wrapper in between -- there is only one entry point to test.
Item 16 (retry/worker revalidation) is an architectural property, verified by
code reading (Phase 9), not a new async worker test -- no new worker
timing/mocking machinery was introduced for a property that requires none.

**Regressions.** Full targeted suite run (identity/onboarding/capability-
gateway/agent-loop/multi-intent -- ~400 tests across 21 files, real MariaDB):
one pre-existing test fixture needed an update (`identityCapabilityGatewaySummaries.test.ts`,
"link_external_identity's persisted request/response summaries..." --  its
fixture session had `runtimeIdentity` hardcoded to `LEVEL_0_ANONYMOUS` even
though the same fixture's `identity.customerId` was already resolved; updated
to a realistic `LEVEL_2_MASTER_RESOLVED` override, matching what a real turn
reaching `link_external_identity` looks like). Three unrelated, pre-existing
failures were confirmed present on the unmodified `develop` baseline too (not
caused by this change, not fixed by this change, out of scope):
`createCustomerCapability.test.ts`/`customerSessionPrivacy.test.ts`/
`linkExternalIdentityCapability.test.ts` each fail their own `after()` hook
with `Missing DATABASE_NAME` when run standalone -- an existing test-harness
env-loading issue unrelated to identity gating. `readyToLinkE2E.test.ts`'s
"RTL12" showed a MariaDB deadlock only when batched with many other DB tests
in one process; 15/15 green when run alone -- a pre-existing test-concurrency
flake, not a regression.

`npx tsc --noEmit`: clean for every file this task touched (pre-existing,
unrelated errors remain in `experiments/deepseek-harness/`, confirmed
untouched by this task, present with an identical error set before this
change). `npm run build` fails at the type-check step for the same
pre-existing `experiments/deepseek-harness/bakeoffRunnerPlugin.ts` reason
(`bakeoffCrmTools.bundle.mjs` has no declaration file) -- Next.js's own build
type-checks the whole repo, including `experiments/`, and this failure
predates and is unrelated to this task; registered here as pre-existing debt,
not fixed (out of scope).

## Phase 11 -- Limitations

- `docs/CAPABILITY_MATRIX.md` does not list `create_quote` at all (its
  `## Commercial Execution` section still shows the superseded
  `prepare_quote`/`CRM-R1` vocabulary) -- a pre-existing staleness this task
  did not create and did not reconcile (out of scope; the living, accurate
  per-capability source is `docs/releases/SALES-AGENT-R2-capability-coverage-matrix.md`,
  which has no identity column to update either). `docs/ACTIVE_RELEASE.md`
  was not touched, matching the precedent set by R3-A00/A01 (a parallel
  workstream documented in its own `docs/architecture`/`docs/releases` files).
- `lib/brain/commercial/work/benchmark/capabilityGateway.ts` (the R2
  fault-injection benchmark harness, test-only) calls
  `createQuoteCapability().checkAvailability()`/`.execute()` directly for
  `create_quote`, bypassing `executeGovernedCapability` entirely by design
  (to avoid a real Quote Service HTTP dependency) -- so R2 benchmark
  scenarios do not exercise this gate for `create_quote` specifically. Every
  other capability in that harness goes through the real, gated
  `executeGovernedCapability`. Not fixed here: it is test tooling, not a
  production path, and none of its currently-gated capabilities have a
  non-`NONE` requirement.

## Rollback

Revert the four changed/added files
(`identity/commercial-identity-requirement/{index,capabilityOperations}.ts`,
`capability-gateway/{executeCapability,identityGate,types}.ts`) and the two
new/updated test files. No migration, no schema change, no flag. R2's own
objective-level gate (`commercialIdentityGate.ts`) is completely untouched
and would continue enforcing its existing rule unchanged.

## Recommended R3-A03 boundary

When `CommercialActionRequest`/`SalesAgentHarness` are built, they should
call `executeGovernedCapability` exactly like every other caller today --
this gate requires no new wiring for that 8th caller. If the Harness wants a
pre-flight identity check (to avoid constructing a full request for an
action it already knows will be denied), it should call
`evaluateCapabilityIdentityGate` directly -- the same pure function, not a
reimplementation.

## Exit criteria

`R3_A02_GENERALIZED_IDENTITY_GATE_VALIDATED`:

- Identity requirements are runtime-independent -- confirmed (Phase 2: no
  change to the pre-existing runtime-neutral evaluator was needed).
- `create_quote` cannot execute below LEVEL_2 -- confirmed (Phase 5, 4 tests).
- No duplicate identity rule implementation introduced -- confirmed: the
  gate calls A06's own `decideCommercialIdentityRequirement`; errorCodes
  reuse A06's own `policyCode` vocabulary.
- All mutating callers inherit the gate -- confirmed (Phase 4: single choke
  point, zero call-site changes needed).
- Read-only tools remain unaffected -- confirmed (test [2]).
- R2 and shared gate agree -- confirmed (Phase 6, parity test).
- Denied actions are observable -- confirmed (Phase 8, audit row).
- No PII is persisted -- confirmed (Phase 8, exact-shape assertion).
- Regressions are clean -- confirmed (Phase 10; one fixture updated, three
  pre-existing unrelated failures reproduced on baseline).
- No production routing changed -- confirmed: no flag, no route, no runtime
  branch touched; the only behavior change is `create_quote`/
  `link_external_identity` now correctly denying a request that was already
  supposed to require LEVEL_2 per the pre-existing canonical table.
