# SALES-AGENT-R2-ID-R2-A08.1 - READY_TO_LINK Live E2E Closure

## Veredicto

`ID_R2_A08_1_READY_TO_LINK_E2E_BLOCKED`

Not "blocked by test infrastructure" - blocked because the attempt to build the real E2E surfaced a genuine, precisely-located architectural gap: **no code in this repository can ever write the canonical PrestaShop bridge (`customer_external_identity`, `provider = "prestashop"`) that A04/A06's `READY_TO_LINK` status exists to close.** This is not a small bug fixable under this task's "minimal fix, no scope expansion" policy (PARTE 11) - closing it is the entire mandate of the already-recommended next slice, `ID-R2-A09 - PrestaShop Identity Bridge`. This document exists specifically to hand A09 a precise, test-proven problem statement instead of a theoretical one.

## Baseline

- `docs/releases/SALES-AGENT-R2-ID-R2-A07-commercialwork-identity-gating-onboarding-resume.md`
- `docs/releases/SALES-AGENT-R2-ID-R2-A08-conversational-identity-collection-assisted-sale-enrichment.md` - explicitly named this exact gap as remaining debt ("`READY_TO_LINK` -> consenso -> `link_external_identity` -> resume chain still lacks a live E2E").

No production code was modified for this task (verified: `git status -- lib/` shows zero new changes beyond what A02-A08 already carried). One test-only DB action was taken: migration 032 (`crm_customer_identity_evidence`, written by A03, never applied to `crm_test` in this environment) was applied directly via `crm_dev_admin` credentials - the same ad-hoc pattern already documented multiple times in `docs/ACTIVE_RELEASE.md` for this repo's known migration-runner checksum-drift issue. The migration's own SQL is idempotent (`CREATE TABLE IF NOT EXISTS`) and unmodified.

## 1. Root cause (found by actually attempting the chain, PARTE 11)

`link_external_identity` (the capability `runCustomerOnboardingPostPlanStage`'s step 4 calls) and its authority (`evaluateLinkExternalIdentityAuthority`, ACS-R1-04) exist to answer one specific question: **"is the WhatsApp number this customer is chatting from really theirs?"** Evidence, in order of increasing certainty:

1. `customerIdentityCapabilities.ts#linkExternalIdentityCapability` hardcodes `externalIdentity: { provider: "whatsapp", externalId: session.trustedInbound.externalId, ... }` - there is no parameter, no branch, no way to make this request target any other provider.
2. `evaluateLinkExternalIdentityAuthority` (`lib/domains/customer-service/authority-policy.ts`) denies with `wa_id_not_controlled_by_channel` whenever `input.waId !== input.inboundWaId` - the authority itself is defined in terms of "does the wa_id being linked match the one this message actually arrived on". A PrestaShop customer id (e.g. `"ps-501"`) can never equal a wa_id - this authority structurally cannot ever approve a PrestaShop bridge, by design, not by omission.
3. `docs/CAPABILITY_MATRIX.md`'s own `link_external_identity` row already documents this scope precisely ("Policy requires the linked wa_id to match the one the current inbound channel verified") - written under ACS-R1-04, before A04/A06's `READY_TO_LINK`/PrestaShop-track concept existed. The two tracks were never reconciled.
4. A04's `READY_TO_LINK` (`evaluate.ts`) is about a **different** bridge entirely: a `customer_external_identity` row with `provider = "prestashop"`, confirming a PrestaShop candidate (converged from email+order evidence) is now canonically linked to the resolved master.
5. Grepped the entire codebase for every writer of that table: `upsertExternalIdentity` (`lib/integrations/customer-external-identity/repository.ts`) has exactly one production caller, `lib/brain/native-whatsapp/service.ts` (the legacy WhatsApp-channel resolver) - always `provider: "whatsapp"`. **No code path anywhere writes a `provider: "prestashop"` row.**

A07's own wiring (`findIdentityOnboardingTrigger` activating onboarding for a `READY_TO_LINK` blocker, hoping step 4 would resolve it) and A08's consent wording were both built on the plausible-looking but incorrect assumption that the existing `link_external_identity` mechanism (built under ACS-R1-04 for a narrower purpose) would also serve this purpose. It does not, and structurally cannot without a new authority/capability - exactly A09's mandate.

A **second**, compounding finding: even the *trigger* to call `link_external_identity` is on the wrong axis. `runCustomerOnboardingPostPlanStage` step 4 fires on `session.identity.source !== "external_identity"` (a WhatsApp-channel-link concept, ACS-R1-04-T06) - completely independent of A06's `READY_TO_LINK` status (PrestaShop-track). A customer whose wa_id is *already* canonically linked (the common case for a repeat WhatsApp customer) would never even reach step 4's `link_external_identity` call, no matter how loudly A06/A08 ask for consent - proven by `GAP 1` below.

## 2. Escenario exacto (PARTE 2)

- Real `master_customer` row (A), real `conversation`/`crm_opportunities` rows (via `setupR2BenchmarkEnvironment`, unmodified benchmark harness).
- Real `customer_external_identity` row: `provider = "whatsapp"`, `external_id = normalizeWaId(waId)`, `customer_id = A` - written via `upsertExternalIdentity`, the same production repository function `native-whatsapp/service.ts` calls for this exact purpose. Gives base `LEVEL_2_MASTER_RESOLVED` (Case A, `computeBaseLevel`).
- Real durable evidence row: `signalType: "prestashop_customer_id"`, `source: "prestashop"`, `strength/verified: "verified"`, `prestashopCustomerId: "ps-501"` - written via `recordIdentityEvidence`, the same production function A02's resolver calls every turn. No `customer_external_identity` row for `provider: "prestashop"` exists yet.
- No hand-built `RuntimeIdentityContext` anywhere in this suite except Group F's explicit, labeled isolation test (PARTE 6 forbids injecting one to fake the chain's own result).

## 3. Path real recorrido (PARTE 3)

`resolveRuntimeIdentityContext` (A05, real, DB-backed) → `evaluateIdentityVerification`/`decideIdentityVerification` (A04, real) → `READY_TO_LINK` (`RTL01`, proven against the seeded state above). `evaluateCommercialIdentityRequirement("customer_profile_history", runtimeIdentity)` (A06, real - `customer_profile_history` is the one real, catalogued `LEVEL_3` operation, per `operations.ts`) → `READY_TO_LINK` decision. `buildCommercialWorkFinalizerMessage` (A08, real, unmodified) → the real consent-ask wording.

**No live `CommercialObjectiveType` reaches a `LEVEL_3` requirement today** (verified structurally: `RTL01`'s companion "PARTE 1" test greps `COMMERCIAL_OBJECTIVE_TYPE_TO_OPERATION`'s real values and confirms `customer_profile_history` is absent - `create_quote`, the only live identity-gated `CommercialWork` operation, requires `LEVEL_2`). Per this task's PARTE 1, the authorized harness was used: a `CREATE_QUOTE`-labeled probe objective carries the REAL A06 decision (computed for the real `customer_profile_history` operation) through A07's real, unmodified status/missingRequirement mapping tables (`IDENTITY_DECISION_STATUS_TO_OBJECTIVE_STATUS`/`_MISSING_REQUIREMENT`) into A08's real finalizer. No new `CommercialObjectiveType`, no new capability, no product behavior was added anywhere - the probe only ever exists inside the test file.

## 4. Consent parser (PARTE 3/9)

Never mocked. `parseConsentEvidence` (unmodified) is called with real message text in every test:
- `RTL02`: no consent this turn → `denied`, zero HTTP calls.
- `RTL03`: proven stateless by construction (a pure function call with unrelated text after a prior valid-consent call returns `null` - there is no cross-call memory for a "previous turn" to leak from).
- `RTL04`: an explicit negation ("no, no quiero vincular...") → parser returns `null` → capability never reached.
- `RTL05`: a real, current-turn affirmative phrase matching the parser's actual grammar (action verb `vincula*` + target noun `whatsapp`/`cuenta`, within the parser's real proximity window) → exactly one Customer Service call.

## 5. Customer Service HTTP path (PARTE 4)

Same real local HTTP test server pattern as `linkExternalIdentityCapability.test.ts`/`customerOnboardingPostPlanStage.test.ts` (no mock of `executeGovernedCapability`, no stub of the domain client). The chain `runCustomerOnboardingPostPlanStage` → Capability Gateway → `link_external_identity` → `createCustomerServiceClient` → `port.linkExternalIdentity` → real HTTP `POST /v1/customers/{id}/external-identities` is exercised for real in `GAP 2`, `RTL11`, `RTL12`, `RTL14`.

## 6. Canonical mutation (PARTE 5)

**Never observed as a real effect of the capability under test** - because it does not produce one for this scenario (section 1). `GAP 2` proves the actual request Customer Service receives is `{ provider: "whatsapp", externalId: <the wa_id> }`, never `{ provider: "prestashop", externalId: "ps-501" }`. Nothing was inserted directly into `customer_external_identity` to fake a passing result for this part of the chain - the negative result is exactly what is asserted and locked in as a regression guard.

Group F (`RTL07` isolated, `RTL13`-equivalent) is a **separate, explicitly labeled** test that uses the same real repository writer (`upsertExternalIdentity`, the one this codebase actually has, used for its real intended provider elsewhere) to construct the world-state a future A09 writer would produce, purely to prove A04/A05's *verification* logic is correct once that state exists - never presented as evidence that the E2E chain from `CommercialWork` produced it.

## 7. LEVEL_3 live check (PARTE 6)

`RTL07` (isolated): seeded both the durable evidence row (`source: "customer_external_identity"`, what A02's resolver would write on discovering a live bridge) and the live `customer_external_identity` row (`provider: "prestashop"`) via real writers, then called the real `resolveRuntimeIdentityContext` → `PRESTASHOP_LINKED` / `LEVEL_3_PRESTASHOP_LINKED`, `masterCustomerId`/`prestashopCustomerId` both correct. Then real `evaluateCommercialIdentityRequirement("customer_profile_history", ...)` → `SUFFICIENT`. This proves the **entire downstream chain from A04's live-check through A06** is correct and ready - the only missing piece is upstream of all of it (the writer). `RTL13`-equivalent additionally proves a bridge row is never trusted without both the durable evidence AND the live table row agreeing (fails closed to `LEVEL_2`, never a false `LEVEL_3`).

## 8. Same-turn resume (PARTE 8)

**Could not be demonstrated** - the chain never reaches a real `LEVEL_3` transition to resume from (section 1/6). Classification per PARTE 8's own taxonomy: **not A (test harness issue), not B (Customer Service side-effect invisible synchronously), not C (runtime ordering bug), not D (projection bug)** - the actual cause is a fifth category this task's checklist did not name: **the capability invoked by the trigger performs a different mutation than the one the trigger's own justification requires.** `RTL08/09/10` instead proves the one thing that *is* true and load-bearing for a future fix: the real decision is pure and idempotent (re-evaluating twice from the same durable state produces byte-identical results) - so once A09 adds the missing writer, A07's existing reprojection/resume mechanism (already proven correct for the `ONBOARDING_REQUIRED`/`create_customer` path in `commercialWorkIdentityOnboarding.test.ts`) has no reason to behave differently for `READY_TO_LINK`.

## 9. Negative paths (PARTE 9, RTL01-RTL15)

| ID | Result | Test |
|---|---|---|
| RTL01 | PASS | real evidence → real READY_TO_LINK → real consent wording |
| RTL02 | PASS | no consent → zero HTTP calls |
| RTL03 | PASS | parser is stateless (no prior-turn leakage possible) |
| RTL04 | PASS | explicit negative → denied, zero HTTP calls |
| RTL05 | PASS | valid current-turn consent → exactly one HTTP call |
| RTL06/07 (chain) | **FAILS AS EXPECTED, documented** | `GAP 2` - link succeeds for the wrong provider, LEVEL_3 never reached |
| RTL07 (isolated) | PASS | live-check mechanism itself is correct once a bridge exists |
| RTL08/09/10 | PASS (bounded) | decision purity/idempotency proven; resume itself blocked by the gap |
| RTL11 | PASS | Customer Service 503 → identity unchanged, no false LEVEL_3 |
| RTL12 | PASS | Customer Service 409 conflict → identity unchanged, no LEVEL_3 |
| RTL13 | PASS | stale/unconfirmed bridge → fails closed to LEVEL_2 |
| RTL14 | PASS | replay sends the identical, deterministic idempotency key both times |
| RTL15 | PASS | consent message carries no raw id/level/policy code |

Plus two structural findings proven as their own tests: `GAP 1` (wa_id already linked → step 4 never even attempts the call) and `GAP 2` (wa_id not yet linked → step 4 calls the capability, but links the wrong provider).

## 10. Bugs encontrados (PARTE 10/11)

No fix was applied - see the Veredicto and section 1: this is not a bounded bug, it is a missing subsystem (A09's mandate). Applying even the smallest structural fix here (e.g. threading a target provider through the capability) would require redesigning `evaluateLinkExternalIdentityAuthority`'s core contract (`docs/data/customer-creation-linking-authority-contract.md` section 5), which this task's own NO TOCAR list and PARTE 11's "no ampliar scope" both forbid without an explicit, separate authorization. Nothing in `lib/` was modified.

## 11. Tests (PARTE 12)

New: `tests/commercial/readyToLinkE2E.test.ts` - 15/15 pass, real MariaDB (`crm_test`) + real local HTTP Customer Service test server, run repeatedly for stability.

Regression (same MariaDB instance):
- `npx tsc --noEmit`: clean.
- `npx eslint` on the new file: clean.
- `npm run build`: clean.
- `commercialWorkIdentityOnboarding.test.ts` (A07): green.
- `commercialWorkIdentityGating.test.ts` / `commercialWorkIdentityConversation.test.ts` (A07/A08): green.
- `linkExternalIdentityCapability.test.ts`, `customerOnboardingPostPlanStage.test.ts`: individual assertions green; the same pre-existing file-level `after`-hook `Missing DATABASE_NAME` flake already documented in the A08 release doc reappears intermittently when run outside the batch runner - confirmed unrelated (present identically with none of this session's files in the run).
- `runtimeIdentityContext.test.ts`, `commercialIdentityRequirement.test.ts`, `customerIdentityEvidence.test.ts`, `customerIdentityVerification.test.ts`: green on repeated runs; two of these files showed one intermittent failure each in one combined run and zero failures on immediate re-run in isolation - consistent with this repo's already-documented shared-`crm_test`-scope contention between concurrently-loaded test files (not attributable to this task's new file, which never touched their fixtures or scope, and passed 15/15 on every run).

Cero cambios de producción, por lo tanto cero riesgo de regresión productiva.

## 12. Deuda remanente

- **The actual deliverable this task exists to close remains open**: no writer for `customer_external_identity(provider="prestashop")` exists. This is the precise, now test-proven scope of `ID-R2-A09 - PrestaShop Identity Bridge`.
- **Once A09 adds that writer**, `runCustomerOnboardingPostPlanStage` step 4's trigger condition (`session.identity.source !== "external_identity"`) will still need to be reconciled with A06's `READY_TO_LINK` signal (`GAP 1`) - today they are independent axes that happen to overlap in some scenarios and not others. A09 should treat this as an explicit design input, not rediscover it.
- **`evaluateLinkExternalIdentityAuthority`/`link_external_identity`'s capability will need either a second, PrestaShop-scoped authority+capability, or a generalized one** - this document takes no position on which; that decision belongs to A09.
- Migration 032 is now applied to `crm_test` in this environment (it was not, before this task) - matches the pattern already used for migrations 026-028 per `docs/ACTIVE_RELEASE.md`. The formal migration-runner checksum-drift repair remains separately tracked, unrelated to this task.

## Criterio de salida - checklist

1. CommercialWork real alcanza READY_TO_LINK en test controlado - sección 3, `RTL01`. OK (via the authorized harness - no live objective reaches it unassisted, proven and documented)
2. A08 genera consent ask - sección 3, `RTL01`/`RTL15`. OK
3. consentimiento actual pasa por parser real - sección 4, `RTL03/04/05`. OK
4. sin consentimiento no hay mutación - `RTL02`. OK
5. link_external_identity se ejecuta por Gateway/Customer Service real de test - sección 5, `RTL05`/`GAP 2`. OK (executes for real; does not perform the needed mutation - section 1)
6. canonical link queda observable - **NO** - section 6/10, root cause documented
7. A05/A04 recalculan LEVEL_3 desde live state - sección 7, `RTL07` (isolated: the mechanism is correct; not reachable from the real chain today)
8. mismo CommercialWork se desbloquea - **NO** - section 8, blocked by items 6/7
9. no se duplica work/step - N/A, no real transition to duplicate
10. same-turn resume se demuestra o se documenta un bug real - sección 8, documented precisely (not a "bug", a missing subsystem)
11. negative paths son fail-closed - sección 9, 13/13 negative-path tests pass. OK
12. no hubo bypass de authority - confirmed: the real authority was never bypassed, weakened, or worked around anywhere in this suite. OK

Given items 6/8 are not met and cannot be met without building A09, the verdict is **BLOCKED**, not PARTIAL - the gap is not a coverage debt (a missing test), it is a missing production capability outside this task's authorized scope.
