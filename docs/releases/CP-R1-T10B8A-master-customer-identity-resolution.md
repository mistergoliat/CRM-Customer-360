---
title: CP-R1-T10B8A - Master Customer Identity Resolution and Runtime Contract
doc_id: cp-r1-t10b8a-master-customer-identity-resolution
status: implemented_not_wired
tags:
  - release
  - identity
  - recommendations
---

# CP-R1-T10B8A - Master Customer Identity Resolution and Runtime Contract

Branch: `feat/cp-r1-t10b8a-master-customer-identity-resolution`, base
`develop` (contains the CP-R1-T10B7 merge, PR #79 / `f87f2cd`). No commit,
push or PR was made for this task.

## Purpose

Build an internal, deterministic resolver that translates the CRM's
already-resolved per-turn identity into a contractual `masterCustomerId`
(`master_customer.id`) **only** when structural evidence proves it belongs
to that id space - never by name similarity, never by inference. Produces
`resolved` or `identity_unresolved`; never calls Customer Profile, never
calls Catalog Service, never resolves identity by PII, never registers a
tool, never touches the Agent Loop.

## Identity spaces

The prior architectural audit (CP-R1-T10B7 closure) flagged this as the
single most serious risk before any personalized-recommendation wiring:
three differently-named, non-provably-equivalent id spaces exist in this
runtime today. This task's own audit (re-reading the real source, not
trusting names) confirmed all three:

1. **`conversation.customer_id` / `customerMasterId`** (capital M) - the
   CRM's local customer PK, resolved by `resolveOrPersistNativeExternalIdentity`
   (wa_id -> customer). Threaded through `processNativeWhatsAppInbound` ->
   `ensureAutonomousSalesTurnContinuity` -> `runNativeAutonomousCycle` as
   `customerMasterId: number | null`. Never demonstrated equivalent to
   `master_customer.id`.
2. **`NativeCustomerSessionExecutionContext.identity.customerId`** -
   `string | null`, resolved once per turn by `resolveNativeCustomerSession`.
   Carries an `identity.source` tag with 6 possible values
   (`none`/`external_identity`/`normalized_phone`/`customer_service`/
   `customer_created`/`onboarding_state`) - only one of which (`customer_service`)
   is provably projection-verified, per the source-code trace below.
3. **`masterCustomerId`** (lowercase) - Customer Profile's own contractual
   id, `master_customer.id`, BIGINT UNSIGNED AUTO_INCREMENT. Confirmed by
   `onboardingTransitions.ts`'s own `CUSTOMER_MASTER_ID_PATTERN = /^[1-9]\d*$/`
   (no leading zero, no zero, canonical positive-integer form) - this is the
   real, load-bearing convention this task's own validator now mirrors.

This resolver's entire job is deciding, per turn, whether space 2 (or a
future direct Customer Service candidate) is provably space 3.

## Customer Profile contract (frozen, unchanged)

- `masterCustomerId` represents `master_customer.id`.
- Transported as a string, max 20 digits (T10B1/T10B2's own bound).
- Customer Profile does not create or resolve identity - it requires an
  already-resolved `masterCustomerId` from its caller.
- Customer Profile does not accept inferred ids - hence Case D: when
  equivalence cannot be proven, `identity_unresolved`, never a probable id.

## Auditoria previa

Read directly, no name/route assumed without confirmation:

- `resolveNativeCustomerSession.ts` (full read) - confirmed the exact
  5-branch flow that produces `identity.customerId`/`identity.source`:
  local resolution (`identityService.resolveIdentity`, phone/external_identity
  matching), onboarding-state reconciliation, external `resolve_customer`
  gated by `completeOnboardingWithVerifiedCustomer`. **Only the last path**
  assigns `source: "customer_service"`, and only after
  `gated.verifiedCustomerId` came back non-null from the projection gate.
- `onboardingTransitions.ts` (full read) - confirmed
  `verifyCustomerMasterProjection`/`CustomerMasterProjectionReader` is the
  real, already-existing, DB-backed projection port (reused here verbatim,
  not reimplemented); confirmed `CUSTOMER_MASTER_ID_PATTERN`; confirmed
  `completeOnboardingWithVerifiedCustomer`'s exact gating logic (`verified`
  -> completes with the verified id; anything else -> `temporarily_unavailable`,
  `verifiedCustomerId: null`, never a fabricated customer).
- `customer-session/types.ts` (full read) - confirmed
  `NativeCustomerSessionExecutionContext`'s exact shape, `CustomerIdentityStatus`
  (5 values), `CustomerIdentitySource` (6 values), and the explicit
  server-side-only/never-serialized-to-LLM boundary that already exists
  between `NativeCustomerSessionExecutionContext` and
  `CustomerSessionDecisionContext`.
- `customerIdentityCapabilities.ts` - confirmed `resolve_customer`/
  `create_customer`/`link_external_identity` are Capability Gateway
  definitions consumed exclusively by `resolveNativeCustomerSession`/
  `runCustomerOnboardingPostPlanStage` - never proposed by the sales agent
  as an LLM tool request (`toolAliases.ts` deliberately excludes them, per
  its own comment) - confirms this task does not touch anything
  LLM-observable.
- `runNativeAutonomousCycle.ts` / `runNativeAgentToolLoopCycle.ts` -
  confirmed `session.execution` (the `NativeCustomerSessionExecutionContext`)
  is threaded into `CapabilityGatewayContext.trustedCustomerSession` and
  `runAgentToolLoop`'s `trustedCustomerSession` - the composition point this
  task's new field rides on, without requiring any change to either file.
- Grepped for `masterCustomerId`, `customerMasterId`, `customer_master_id`,
  `identity.customerId`, `master_customer`, `CustomerMasterProjectionReader`,
  `verified`, `provenance`, `resolve_customer`, `create_customer`,
  `link_external_identity`, `temporarily_unavailable`, `conflict`,
  `anonymous` across `lib/` - confirmed no other module already performs
  this translation; confirmed `identity.source === "onboarding_state"` is
  genuinely ambiguous (can be populated via the verified gate **or** via
  the unverified `completeOnboardingWithCustomer` direct path in a prior
  turn) - not a name-similarity assumption, a traced code-path fact.

## Input contract

`ResolveMasterCustomerIdentityInput`
(`lib/brain/commercial/identity/master-customer/types.ts`):

```ts
type ResolveMasterCustomerIdentityInput = {
  nativeCustomerSession?: Pick<NativeCustomerSessionExecutionContext, "identity"> | null;
  customerServiceIdentity?: {
    customerMasterId?: string | null;
    verifiedAgainstProjection?: boolean;
  } | null;
};
```

`nativeCustomerSession` is typed as a structural `Pick<..., "identity">`,
not the full execution context - this avoids a circular dependency (the
context being extended is the same one this resolver's own runtime call
site is still constructing) and keeps the resolver's real data need honest
(it never reads `trustedInbound`, `onboarding`, or consent). No database
read happens inside the pure core; the one possible I/O (the
`customerServiceIdentity` candidate path) is isolated to the async
orchestrator, at most once per call.

## Result contract

```ts
type MasterCustomerIdentitySource = "customer_service_verified" | "native_session_verified_projection";

type MasterCustomerIdentityUnresolvedReason =
  | "identity_absent"
  | "identity_not_verified"
  | "identity_source_unsupported"
  | "projection_not_confirmed"
  | "identity_conflict"
  | "identity_temporarily_unavailable"
  | "invalid_master_customer_id";

type MasterCustomerIdentityResolution =
  | { status: "resolved"; masterCustomerId: string; source: MasterCustomerIdentitySource }
  | { status: "identity_unresolved"; reason: MasterCustomerIdentityUnresolvedReason };
```

No email/phone/DNI/wa_id/conversationId/candidate-id/conflict-detail/PII
field exists anywhere in this contract - the `identity_unresolved` variant
is structurally incapable of carrying an id.

## Verified sources

- **`native_session_verified_projection`**: `identity.status === "identified"`
  **and** `identity.source === "customer_service"`. This is the only
  `source` value in the current codebase with a traced, provable path
  through the local `master_customer` projection before
  `resolveNativeCustomerSession` ever assigns it - see "Auditoria previa".
  Never re-queried against the projection reader (already verified once,
  this same turn, upstream).
- **`customer_service_verified`**: a raw `customerServiceIdentity.customerMasterId`
  candidate, format-valid and confirmed by `verifyCustomerMasterProjection`
  (reused, not reimplemented) - or trusted directly when the caller already
  asserts `verifiedAgainstProjection: true` (format is still independently
  re-checked either way).

## Unsupported sources

`identity.source` values `"none"`, `"external_identity"`, `"normalized_phone"`,
`"customer_created"`, `"onboarding_state"` never produce `resolved`, even
when `identity.status === "identified"` and a `customerId` is present -
`reason: "identity_source_unsupported"`. `"onboarding_state"` deserves
particular note: it is genuinely ambiguous provenance (see "Auditoria
previa") - not merely "unverified by convention" but demonstrably
sometimes-verified-sometimes-not depending on which prior-turn code path
set `onboarding.customerId` - so it is conservatively never trusted here
(Case D).

## Validation

`master_customer.id` convention, confirmed real (not assumed):
`/^[1-9]\d{0,19}$/` - positive integer, 1-20 digits, **no leading zero**,
**not all-zero** (`"0"` itself is rejected - a BIGINT UNSIGNED
AUTO_INCREMENT starting at 1 never needs an alternate zero representation).
Trimmed before matching. Never coerced through `Number` - verified by a
dedicated test using the exact BIGINT UNSIGNED contractual maximum
(`"18446744073709551615"`, 2^64-1), confirming the exact string is
preserved byte-for-byte, and by a dedicated test rejecting a 21-digit value
(`"184467440737095516150"`) as `invalid_master_customer_id`.

This resolver's own `/^[1-9]\d{0,19}$/` (with its 20-digit cap) is applied
on exactly two of the three evidence paths: the native-session path (its
own defense-in-depth re-check of an already-verified id) and the
`customerServiceIdentity` path when the caller already asserts
`verifiedAgainstProjection: true` (no port call happens there, so this is
the only guard). A **third path** - `customerServiceIdentity` *without*
`verifiedAgainstProjection` - is deliberately **not** locally range-checked
by this resolver at all: it forwards the raw candidate string straight to
the reused `verifyCustomerMasterProjection` port, which applies its own,
uncapped `/^[1-9]\d*$/` before ever querying `master_customer` (see "SQL
range clarification" implication below - never a second, diverging length
rule). A syntactically-valid-but-21-digit candidate on that specific path
therefore reaches the real projection check; since no genuine
`master_customer` row can ever have a 21-digit id, a correct reader always
reports it `not_found` -> `projection_not_confirmed`, never
`invalid_master_customer_id` and never `resolved`. Verified by a dedicated
test using a reader that mimics this real-world guarantee.

**This is a syntactic (digit-count) check, not a semantic one - it never
proves existence or real BIGINT-range validity on its own.** `/^[1-9]\d{0,19}$/`
accepts any 1-20 digit positive integer, including values above the true
BIGINT UNSIGNED maximum (e.g. twenty 9s, `"99999999999999999999"`, is
syntactically valid but numerically impossible as a real `master_customer.id`).
This is deliberate and safe: this validator's only job is rejecting
obviously-malformed input cheaply, before any I/O; the real semantic
guarantee - does this id correspond to an actual row - is exclusively
`verifyCustomerMasterProjection`'s job (a real `master_customer` read), and
every `resolved` output either passed that check directly (the
`customer_service_verified` path) or already came from a row that passed it
upstream, this same turn (the `native_session_verified_projection` path -
see "Verified sources"). No path can reach `status: "resolved"` on syntactic
validity alone. No local numeric range/overflow comparison was added on top
of this regex - doing so would require parsing the string as a number
(reintroducing the exact precision-loss/coercion risk this validator exists
to avoid) and would duplicate a rule MariaDB's own `BIGINT UNSIGNED` column
type already enforces at the point of truth (the `master_customer` table
itself, read via the projection reader) - a second, local copy of that rule
would only be able to drift from it, never improve on it.

**Deliberately stricter than T10B6's own `normalizeMasterCustomerId`**
(`/^[0-9]{1,20}$/`, leading zeros preserved verbatim) - that decision was
made under "no evidence in this repo that real masterCustomerId values are
leading-zero-free" at the time. This task found that evidence
(`onboardingTransitions.ts`'s own `CUSTOMER_MASTER_ID_PATTERN`, already
load-bearing in production onboarding code) and applies it to its own,
independent validator. T10B6 itself is untouched - this is a documented
divergence, not a silent inconsistency.

## Projection verification

Reused verbatim: `verifyCustomerMasterProjection` +
`CustomerMasterProjectionReader.exists(id): Promise<boolean>`
(`lib/domains/customer-service/customerMasterProjection.ts`). No second SQL
query implementation exists anywhere in this task. Mapping:

| projection check | resolver outcome |
|---|---|
| `verified` | verified evidence |
| `invalid` | `invalid_master_customer_id` |
| `not_found` / `inconsistent` | `projection_not_confirmed` |
| `check_failed` | `identity_temporarily_unavailable` (fail-closed) |

At most one projection check per resolver call - verified by a dedicated
test where both the native-session path (already verified, no query) and a
`customerServiceIdentity` candidate are supplied together: the fake reader
is called exactly once.

## Conflict handling

Both sources present and **independently verified**: equal `masterCustomerId`
-> `resolved`; different -> `identity_unresolved`/`identity_conflict` -
never a silent precedence pick. Only one source verified: that source wins,
its value is never compared against an unverified candidate from the other
source (an unverified value carries no claim about which id space it
belongs to, so a "match" would be meaningless). Neither verified: the
native session's own reason is preferred (richer session state) over the
customer-service candidate's own reason, documented explicitly in
`computeMasterCustomerIdentityResolution`.

## Runtime placement

Computed **once per turn**, inside `resolveNativeCustomerSession.ts`, right
before the final `execution` object is built - reusing the same `identity`
just resolved and the same `projectionReader` test-injection dependency
already used for the onboarding gate (never a second instance).
Exposed as a **new, explicit field**:

```ts
NativeCustomerSessionExecutionContext.masterCustomerIdentity: MasterCustomerIdentityResolution
```

`identity.customerId` is untouched - same field, same semantics, same
callers. This is purely additive: `CapabilityGatewayContext.trustedCustomerSession`
and `runAgentToolLoop`'s `trustedCustomerSession` parameter both already
type as `NativeCustomerSessionExecutionContext`, so they structurally gain
the new field with zero code changes on their part. Not connected to
SearchProducts V2, `CustomerRecommendationContext`, or any tool - that is
explicitly deferred.

`masterCustomerIdentity` is an **enhancement field, never a gate**: nothing
in `resolveNativeCustomerSession.ts` branches on its value, and no existing
return path, warning, onboarding transition, or `contextAccess` computation
reads it - see "Non-blocking identity resolution" below for the frozen
invariant this implies for every future consumer.

## Non-blocking identity resolution

**masterCustomerId resolution is a personalization/context enhancement, not
a global gate on the bot.** This is a frozen operational invariant, not an
implementation detail:

- `status: "resolved"` -> a verified `masterCustomerId` is available ->
  identified personalization is permitted (for whichever future capability
  chooses to use it - T10B8A itself does not consume it anywhere yet).
- `status: "identity_unresolved"` (any of its 7 reasons) -> `masterCustomerId`
  is simply omitted -> the turn continues normally -> generic mode -> the
  bot stays fully operational.

`identity_unresolved` never produces, today or by design: an exception, an
automatic handoff, a global block, cancellation of the Agent Loop,
interruption of the conversation, unavailability of catalog/search/generic
recommendations, automatic customer creation, a fabricated
`masterCustomerId`, or an automatic classification as "customer does not
exist". `resolveNativeCustomerSession.ts` returns exactly the same
`execution`/`decision`/`warnings` shape it always did - `masterCustomerIdentity`
is additive metadata, never a condition any existing branch checks.

**`identity_unresolved` and `customer_not_found` are distinct semantics,
never collapsed:** `identity_unresolved` means "not yet contractually
identified" (this resolver simply has no proof of a `master_customer.id` -
the customer may well exist); an actual "customer does not exist"
determination is a business decision for the canonical resolver/onboarding
flow (`resolve_customer`'s own `no_match`/`identification_required` states),
subject to its own policy and confirmation - this resolver neither makes nor
implies that determination. For public/catalog-facing capabilities,
`identity_unresolved` maps to `customerMode: "generic"` (the same generic
mode T10B6/T10B7 already define when no `masterCustomerId` is supplied) -
for capabilities that require binding to a specific customer, the existing
onboarding/identification flow (unmodified by this task) is what may need to
run, on its own terms, only when that specific action requires it - it is
never triggered globally by an unresolved `masterCustomerIdentity`.

Verified by `tests/commercial/customerSession.test.ts` (new non-blocking
integration cases, see "Tests" below): for every reachable unresolved state,
`resolveNativeCustomerSession` returns normally (no throw), `identity`/
`contextAccess`/onboarding transitions are byte-identical to the pre-T10B8A
behavior, and `masterCustomerIdentity` is the only new information present.

## Security

Grepped the new module's source for `JSON.stringify|console\.|logger|\.cause|\.stack|customerId|masterCustomerId|x-api-key|Authorization|process\.env`:
one match, inside a comment explaining why no logger was added (matching
T10B7's precedent - no capability in this repo logs directly). No error
path or `identity_unresolved` variant can carry an id (structurally
impossible, not just a convention) - verified by a dedicated test
(`JSON.stringify(result)` never contains the candidate id on an unresolved
path).

## Tests

`tests/identity/master-customer/resolveMasterCustomerIdentity.test.ts` - 43
tests: validation (13: 1-digit, 20-digit, empty, whitespace, trimmed valid,
`"0"`, all-zeros, negative, decimal, letters, >20 digits, no-Number-coercion,
leading zeros rejected); session states (12: anonymous, identification_required,
conflict, temporarily_unavailable, all 4 unsupported-source cases, verified
source, malformed id with verified source, null id despite `identified`,
conflict never resolved even with a customerId present); Customer Service
candidate path (7: verified, not-found, check-failed, invalid format with
port never called, absent id, `verifiedAgainstProjection: true` skips the
port, `verifiedAgainstProjection: true` still re-validates format); no
evidence at all; multiple-source combinations (6: both verified+equal, both
verified+different, native-only verified, customer-service-only verified,
neither verified prefers native's reason, neither present); effects (4: no
`fetch` call observed, input not mutated, projection checked at most once
even when both paths could trigger it, no id ever appears in an unresolved
result's JSON).

## Regression suites

Ran together, twice: `tests/identity/master-customer/*.test.ts` +
`tests/commercial/customerSession*.test.ts` +
`tests/commercial/createCustomerCapability.test.ts` +
`tests/commercial/linkExternalIdentityCapability.test.ts` +
`tests/commercial/customerIdentityAuditEvents.test.ts` +
`tests/commercial/customerOnboardingPostPlan*.test.ts` +
`tests/commercial/identityCapabilityGatewaySummaries.test.ts` +
`tests/commercial/customerMasterProjectionGate.test.ts` +
`tests/commercial/customerIdentityCapabilityGateway.test.ts` +
`tests/commercial/runNativeAutonomousCycle*.test.ts` +
`tests/catalog-recommendation/*.test.ts` (T10B7) +
`tests/recommendation-context/*.test.ts` (T10B2+T10B6): 490 tests, 406
pass, 84 fail (all pre-existing `ECONNREFUSED 127.0.0.1:3306`/DB-dependent,
no local MariaDB in this environment) both times, 0 `only`/`skip`/`todo`.

Rigorous baseline diff (not just count): the same suite minus the 43 new
T10B8A tests (447 tests) was run both on this branch and on a clean
`develop` worktree (`git worktree add`, `node_modules` junctioned). Both:
447 tests, 363 pass, 84 fail. Every `test at ...` identifier was extracted
and diffed: **byte-for-byte identical except two files**
(`customerOnboardingPostPlanPrivacy.test.ts`, `identityCapabilityGatewaySummaries.test.ts`)
where every failing identifier is shifted by the exact character offset of
the one line this task added to that file's `session()` fixture builder -
confirmed by inspecting the actual failing test name and error message at
both offsets: identical in both (`customer_create_failed` and
`connect ECONNREFUSED 127.0.0.1:3306` respectively, same test names). Zero
new failures, zero regressions.

## Full-suite baseline

`npm test`: 2320 tests, 1847 pass, 473 fail. `2277 + 43 = 2320` and
`1804 + 43 = 1847` exact against the clean baseline this repo's own
CP-R1-T10B7 closure audit established (473 fail, confirmed stable across
multiple repeated runs there). Extracted `test at ...` identifiers: 469
unique locations across 68 distinct files - consistent with the T10B7
audit's own count (469-470) for the same class of pre-existing DB-dependent
failures. Confirmed zero identifiers under `tests/identity/master-customer/`
in the failure list - all 43 new tests pass in the full-suite run too, not
just in isolation.

## Typecheck

`npx tsc --noEmit` - clean.

## Lint

`npm run lint` - 0 errors, 34 pre-existing warnings in unrelated files
(identical set to the develop baseline documented in prior CP-R1-T10Bx
release docs).

## Build

`npm run build` - clean.

## Documentation

- `docs/integrations/master-customer-identity-resolution.md` - identity
  spaces, Customer Profile contract, verified/unsupported sources,
  resolution states, projection verification, conflict handling, runtime
  placement, security, generic fallback, explicitly out of scope.
- This document.

## Risks

- `identity.source === "onboarding_state"` being conservatively treated as
  unsupported means a real, previously-verified customer whose identity was
  reconciled through onboarding state (rather than freshly resolved via
  `resolve_customer` this exact turn) will resolve as `identity_unresolved`
  today - correct per Case D (the type cannot currently distinguish the two
  provenance paths that produce it), but a future task could close this gap
  by having `onboardingTransitions.ts` itself carry a verified-provenance
  flag through to `onboarding.customerId`, letting this resolver trust it
  directly. Out of scope here - flagged, not fixed silently.
- Seven existing test files needed a one-line fixture addition
  (`masterCustomerIdentity: {...}`) to keep compiling against the now-larger
  `NativeCustomerSessionExecutionContext` type: `createCustomerCapability.test.ts`,
  `customerIdentityAuditEvents.test.ts`, `customerOnboardingPostPlanPrivacy.test.ts`,
  `customerOnboardingPostPlanStage.test.ts`, `customerSessionPrivacy.test.ts`,
  `identityCapabilityGatewaySummaries.test.ts`, `linkExternalIdentityCapability.test.ts`.
  Each change is mechanical - the same fixed literal added to that file's own
  `session()`/inline builder, never a functional change to what that file
  tests - verified behaviorally unchanged (see "Regression suites"), but
  worth noting as the real blast radius of adding a required field to a
  widely-constructed type.
- No risk of `masterCustomerIdentity` accidentally becoming a blocking gate
  in a future task: the frozen invariant ("Non-blocking identity resolution"
  above) and its dedicated tests exist precisely to keep that from
  happening silently - `T10B8B` and later must actively choose to branch on
  `status`, never inherit a block by omission. Documented as a design
  contract, not left implicit.
- `customerServiceIdentity` (the raw-candidate input path) has no real
  caller yet in this runtime - `resolveNativeCustomerSession.ts` only ever
  supplies `nativeCustomerSession`. It exists as a forward-looking,
  spec-required contract for a future direct Customer Service integration
  point, not dead code removal candidate.

## Next task

`CP-R1-T10B8B` - Catalog Recommendation Gateway Adapter.

## Confirmaciones

- No commit fue hecho.
- No push fue hecho.
- No PR fue creado.
- No se llamo Customer Profile.
- No se llamo Catalog Service.
- No se registro ninguna tool.
- No se modifico el Agent Loop.
- No se resolvio identidad por PII (email/telefono/DNI/wa_id).
- No se asumio equivalencia de IDs por similitud de nombres - cada
  equivalencia afirmada esta trazada al codigo fuente real.
- No se modificaron T10B1/T10B2/T10B5/T10B6/T10B7.
