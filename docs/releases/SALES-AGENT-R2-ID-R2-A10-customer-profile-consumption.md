# SALES-AGENT-R2-ID-R2-A10 - Customer Profile Consumption

## Veredicto

`ID_R2_A10_CUSTOMER_PROFILE_CONSUMPTION_VALIDATED`

## Baseline

- `docs/releases/SALES-AGENT-R2-ID-R2-A09-prestashop-canonical-identity-bridge.md` - veredicto `ID_R2_A09_PRESTASHOP_IDENTITY_BRIDGE_VALIDATED`. Names this task as its own "next slice": `masterCustomerId` + `prestashopCustomerId` + a genuine, live-confirmed `LEVEL_3` are now available without re-resolving identity.
- `docs/audits/SALES-AGENT-R2-CP-R2-A01-customer-profile-identity-integration-audit.md` (2026-08-24) - the dedicated prior audit of this exact topic. Its root-cause finding, identity-bridge design, capability recommendations, and test matrix (`CP01`-`CP17`) are the direct basis for this task's implementation; its proposed bridge module (`CP-R2-A02`) turned out to be superseded by A05/A09's `RuntimeIdentityContext.prestashopCustomerId`, already live-confirmed - this task reuses that instead of building a second one.
- `docs/audits/SALES-AGENT-R2-cross-service-integration-contract-audit.md` - the earlier, broader audit that first documented the identity-crossing bug across all six Customer Profile operations.
- `docs/releases/SALES-AGENT-R2-ID-R2-A06-commercial-identity-requirement-policy.md` - defines `customer_profile_history` as `MINIMUM_LEVEL LEVEL_3_PRESTASHOP_LINKED`, owner "Agent Tool Loop", zero real callers at the time. This task is the first real caller.

## 1. Old unsafe path (PARTE 1/16)

Before this task, `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts` derived Customer Profile's identity from two legacy fields on the trusted session - `identity.customerId` and `masterCustomerIdentity.masterCustomerId` - both **`master_customer.id` space**, never `ps_customer.id_customer`. These flowed into `loadCustomerCommercialHistoryContext` and from there into the live HTTP client (`lib/integrations/customer-profile/http-client.ts`), which sent them to `/v1/customers/:customerId/profile|commercial-summary|purchased-products|purchase-behavior|rfm` - every one of those routes is `ps_customer.id_customer`-keyed. This was confirmed, independently, by two prior audits and reproduced by this task's own (now-updated) tests. It was inert in production only because `CUSTOMER_PROFILE_ENABLED`/`CUSTOMER_PROFILE_CONTEXT_ENABLED` both default to `false` - flipping either flag before this task would have fired the bug for real (mass 404s, or worse, a cross-customer read on a numeric id collision).

A second, fully dead copy of the same mistake existed in `lib/customer-profile/httpCustomerProfileAdapter.ts` ("Bloque A") - a parameter literally named `masterCustomerId` sent to the same `ps_customer.id_customer`-keyed paths. It has zero callers anywhere in the repo, and a structural test (`tests/commercial/customerProfileLegacyImportGuard.test.ts`) already asserts no production file imports it. Per PARTE 16 this satisfies "corrected or explicitly disabled/unreachable" without deleting it; it was left untouched (out of this task's scope, no contract to fix, nothing to gate).

## 2. Canonical ID semantics (PARTE 2/6)

Every identifier the Customer Profile client (`lib/integrations/customer-profile`) sends is now named and typed `customerId: CustomerProfileCustomerId` (`number`) - including RFM, which used to be the one operation with a separate `masterCustomerId: string` field and its own big-int-string validator. That field is gone from `GetCustomerRfmInput`; `getRfm` now validates with the exact same `validateCustomerId` every other operation uses. The RFM wire response's own JSON key is still literally `"masterCustomerId"` (an external contract this repo does not own), but it is parsed and re-exposed to CRM code as `customerId` - so nothing downstream can re-derive the historical "pass master_customer.id" mistake from a field name alone. `CustomerRfmContractErrorReason`'s `MASTER_CUSTOMER_ID_MISMATCH` became `PROVENANCE_MISMATCH`, matching every sibling response type's mismatch vocabulary.

`lib/brain/commercial/customer-profile-context/loader.ts` (`loadCustomerCommercialHistoryContext`) lost its separate `masterCustomerId` input field entirely - RFM is now requested with the exact same `customerId` used for `commercial-summary`/`purchased-products`/`purchase-behavior`, unconditionally (previously RFM ran only if a separately-supplied, separately-formatted `masterCustomerId` string passed its own regex). One id, one space, one field name, at every layer of this client.

## 3. LEVEL_3 gate (PARTE 3/4)

`lib/brain/commercial/commercial-customer-context/loadCommercialCustomerContext.ts` is the new gate. It calls A06's existing `evaluateCommercialIdentityRequirement("customer_profile_history", runtimeIdentity)` - never a second, hand-rolled `if (identityLevel === "LEVEL_3...")` check. Only a `SUFFICIENT` decision proceeds; every other decision (`ONBOARDING_REQUIRED`, `READY_TO_LINK`, `AMBIGUITY_RESOLUTION_REQUIRED`, `IDENTITY_CONFLICT`, `SYSTEM_WAIT`) - i.e. every `RuntimeIdentityStatus` other than a live `PRESTASHOP_LINKED`/`LEVEL_3_PRESTASHOP_LINKED` - maps to `IDENTITY_INSUFFICIENT`. No degradation to `masterCustomerId`, no re-triggered discovery, ever. `evaluateCommercialIdentityRequirement`'s own `SUFFICIENT` branch already requires `isIdentityLevelAtLeast(currentLevel, LEVEL_3)`, which A05's live check (`decideWithLiveLevel3Check`) only ever produces after confirming a real `customer_external_identity(provider='prestashop')` row - so this task never re-implements A05's own live-confirmation logic, exactly per A09's closing note ("A09 bridge becomes a real, sufficient prerequisite").

## 4. Consumer boundary (PARTE 7/20)

`lib/brain/commercial/commercial-customer-context/` is the single new boundary:

```
CommercialCustomerContextResult =
  | { status: "AVAILABLE"; prestashopCustomerId: string; commercialHistory: CustomerCommercialHistoryContext }
  | { status: "IDENTITY_INSUFFICIENT"; requiredLevel: "LEVEL_3_PRESTASHOP_LINKED" }
  | { status: "PROFILE_NOT_FOUND"; prestashopCustomerId: string }
  | { status: "SYSTEM_UNAVAILABLE"; retryable: boolean; prestashopCustomerId: string | null }
```

Deliberate deviation from the task's illustrative sketch: `AVAILABLE`'s payload is `commercialHistory: CustomerCommercialHistoryContext` (the already-typed, already prompt-safe shape T12C/T12D built and tested), not a second, parallel set of `profile?/rfm?/purchaseBehavior?` fields. Re-declaring that data would have duplicated an already-audited type for no safety benefit - the sketch is explicitly "conceptual" (task PARTE 7), and PARTE 20's real requirement (a single underlying typed boundary, never two HTTP call sites) is satisfied either way.

`loadCommercialCustomerContext` is now the **only** production caller of `loadCustomerCommercialHistoryContext`/`createProductionCustomerProfileCapabilities` (verified: `grep` across `lib/` shows exactly one call site of each, inside this new module). `runNativeAgentToolLoopCycle.ts`'s `defaultLoadCustomerProfileContext` calls this boundary exclusively - the Agent Tool Loop hidden-context loader remains the runtime owner A06 already named, but it no longer talks to `loadCustomerCommercialHistoryContext`/the HTTP client directly. Its input changed from `{customerId, masterCustomerId}` to `{runtimeIdentity: RuntimeIdentityContext | null}`, read via `session.runtimeIdentity` - `session.identity`/`session.masterCustomerIdentity` are no longer read anywhere in this file.

No Capability Gateway registration was added (PARTE 20 option A, retained deliberately) - see section 12 for why.

## 5. Endpoints used (PARTE 5/6/7)

Reused as-is, no new endpoints, no new HTTP client:

- `commercial-summary` - base context, always attempted once identity is sufficient.
- `rfm` - always attempted alongside `commercial-summary` (both cheap, both already the loader's existing behavior).
- `purchased-products` / `purchase-behavior` - attempted only when `historyNeeds` (derived by the pre-existing `deriveCustomerHistoryNeeds`, unmodified) indicates a product-relevant turn - demand-driven, never a blanket fetch every turn.
- `profile` - attempted only for `GENERAL_PROFILE`/`RECENT_ORDERS_CONTEXT` needs, same as before.
- `order-status` - **not connected** by this task, matching the prior audit's own recommendation (a separate, explicit-objective capability, out of R2's general enrichment scope) and PARTE 5's priority list, which never named it.
- Legacy `GET /v1/master-customers/:masterCustomerId/rfm` - never called by any code in this repo (confirmed by both prior audits and re-confirmed here); not touched, not adopted.

## 6. RFM (PARTE 6/12)

Uses the primary route, `GET /v1/customers/:customerId/rfm`, with `customerId = prestashopCustomerId` - the same id space as every other operation, never the legacy master-customers route. RFM is `SNAPSHOT` semantics (unchanged - `snapshotId`/`calculationVersion`/`referenceTime`/`publishedAt` all still flow through to `CustomerRfmContext`); this task did not touch freshness handling, only which id is sent.

## 7. Commercial profile (PARTE 5/7)

`commercial-summary` remains the base/primary signal (unchanged priority order from T12C); `purchased-products`/`purchase-behavior`/`profile` remain secondary, need-driven additions - this task did not expand or restrict what gets fetched, only fixed which identity space authorizes the fetch at all.

## 8. Failure semantics (PARTE 8/9/17)

`CommercialCustomerContextResult` distinguishes exactly what PARTE 8/9 require:

- `IDENTITY_INSUFFICIENT` - identity gate failed; Customer Profile is never called (verified with `neverCalledCapabilities()` fixtures that throw if invoked).
- `PROFILE_NOT_FOUND` - identity was sufficient, Customer Profile returned 404. Never conflated with `IDENTITY_INSUFFICIENT`, never re-opens onboarding (the Agent Tool Loop caller treats both as "no enrichment this turn" - neither one is a customer-facing error or a retry trigger).
- `SYSTEM_UNAVAILABLE` - Customer Profile down, disabled by flag, or a contract we don't trust; `retryable` distinguishes a transient provider failure (`true`) from disabled/malformed-contract states (`false`). Identity is never touched by any of these; `runNativeAgentToolLoopCycle.ts`'s existing `try/catch` around the loader call is unchanged, so even an unexpected throw degrades to a local fallback object rather than failing the turn.

Catalog/shipping/quote are structurally independent of this boundary (no import in either direction) - a Customer Profile outage cannot touch them, unchanged from before this task.

## 9. Prompt-safe context (PARTE 13/19)

No new serialization was written. `buildCustomerPurchaseHistorySummary`/`buildCustomerRfmSummary` (`lib/brain/commercial/customer-profile-context/summary.ts`, unmodified) already omit email/phone/addresses/raw order payloads/payment info/internal ids/evidence/policy codes - re-verified by reading both functions in full during this task; RFM's summary in particular never included `masterCustomerId` even before this task. Freshness: RFM stays `SNAPSHOT`, purchase/behavior/profile stay `DERIVED`/`NEAR_REALTIME` per Customer Profile's own contract - unchanged.

## 10. Omnichannel behavior (PARTE 18/26)

`RuntimeIdentityContext` carries no channel/provider field by construction (A05, unmodified) and `loadCommercialCustomerContext` never branches on one. `CPC18`-equivalent test (`tests/commercial/loadCommercialCustomerContext.test.ts`) proves two different `masterCustomerId` values (simulating two different channels resolving to the same person) that both carry the same `prestashopCustomerId` send the identical `customerId` to Customer Profile.

## 11. Tests (PARTE 22)

New:

- `tests/commercial/loadCommercialCustomerContext.test.ts` - the gate (all eight non-`SUFFICIENT` `RuntimeIdentityContext` states, `CPC01`-`CPC06`-equivalent, plus `AMBIGUOUS`/`NEEDS_VERIFICATION`/null-session), the numeric-collision proof (`master_customer.id=100` vs `prestashopCustomerId=7421`, asserts Customer Profile only ever sees `7421`), the omnichannel proof, `PROFILE_NOT_FOUND` vs `SYSTEM_UNAVAILABLE` vs the disabled-flag case, and a malformed-`prestashopCustomerId` defensive fail-closed case.
- `tests/customer-profile-client/customerProfileSchemas.test.ts` - added a dedicated numeric-collision test at the wire-parsing layer (`parseCustomerRfmResponse`, master=100 vs echoed=7421 → `PROVENANCE_MISMATCH`), plus updated all pre-existing RFM assertions for the `customerId`/`PROVENANCE_MISMATCH`/`INVALID_CUSTOMER_ID` renames.
- `tests/customer-profile-client/httpCustomerProfileClient.test.ts` / `customerProfileCapabilities.test.ts` - updated every `getRfm` call site to the new `{customerId: number}` input shape.
- `tests/customer-profile-context/customerProfileContextLoader.test.ts` - updated every loader call site (no more `masterCustomerId` field) and every `customerRfm` expectation (`customerId` field, echoing the loader's own `customerId`); added a test proving `getRfm` receives the identical `customerId` as `getCommercialSummary`.
- `tests/agent-loop/runNativeAgentToolLoopCycleCustomerProfile.test.ts` - replaced the two tests that asserted the old (buggy) `identity.customerId`/`masterCustomerIdentity.masterCustomerId` forwarding with tests proving the cycle forwards `trustedCustomerSession.runtimeIdentity` verbatim (numeric-collision fixture: master=123, prestashop=7421) and passes `null` through when there is no trusted session - never invents one.

Regression, this session: `tests/customer-profile-client/*`, `tests/customer-profile-context/*`, `tests/commercial/loadCommercialCustomerContext.test.ts`, and the full `tests/agent-loop/*` directory (450 tests) all green. Full `tests/commercial/*` directory (133 files, 1975 tests): 1967 pass, 8 fail - all 8 confirmed pre-existing and unrelated (7× the already-documented `Missing DATABASE_NAME` after-hook flake seen in every prior A08/A08.1/A09 release doc; 1× `followUpSequenceContinuity.test.ts`'s `[FS4]`, confirmed by isolated re-run to be the already-documented shared-`crm_test`-scope concurrency contention, 10/10 green alone). `npx tsc --noEmit`: clean. `npx eslint` on every touched production file: clean. `npm run build`: clean.

## 12. Debts / explicit gaps (PARTE 10/24)

- **No `CommercialObjectiveType`/CommercialWork step consumes `customer_profile_history` yet.** Unchanged from A06/A07/A08.1/A09 - this was explicitly out of this task's scope ("determinar el primer consumer real... si no existe objective apropiado, crear el boundary y conectar el consumer mínimo más cercano al runtime"). The Agent Tool Loop hidden-context loader is that minimum-viable consumer; it is now identity-safe and gated, but it is still not a formal `CommercialWork` objective. `ID-R2-A11` (repeat-purchase / customer-aware objectives) is the natural next slice for that gap.
- **No Capability Gateway registration.** Deliberate (PARTE 20 option A) - there is no real `CommercialObjectiveType` that would call it as a tool today, so registering a Gateway capability would add an LLM-reachable surface nothing exercises. `docs/CAPABILITY_MATRIX.md` has no row for Customer Profile and none was added, consistent with A06/A09 (which also never touched it for this concept).
- **No cache.** None existed before this task (confirmed by both prior audits); none was added (PARTE 19 - "no agregar cache prematuramente salvo necesidad").
- **Bloque A legacy adapter (`lib/customer-profile/*`) left in place, dead.** Already unreachable and guarded by a structural test; deleting it was not required by PARTE 16 ("corregirse... o quedar explícitamente disabled/unreachable" - it already is) and was out of this task's explicit scope.
- **`order-status` intentionally not wired into this boundary** - a future, explicit-objective (postventa/SAC) consumer's job, per the prior audit's own recommendation.

## 13. Next slice

Per A09's own framing and this task's PARTE-final "NEXT SLICE" section: `ID-R2-A11` should pick one of (a) Repeat Purchase / Customer-Aware Commercial Objectives - now unblocked, since the profile consumer delivers a real, identity-safe purchase history - or (b) Omnichannel Identity Adapter Integration (Instagram/Facebook onto the identity engine A02-A09 already built). Not mixed in this task.

## Criterio de salida - checklist

1. Customer Profile solo se consume desde LEVEL_3 - sección 3, `loadCommercialCustomerContext`'s gate, test suite's 8 non-SUFFICIENT-state cases. OK
2. `prestashopCustomerId` es el identificador enviado - sección 2/4. OK
3. nunca se usa masterCustomerId como ps_customer id - sección 1/2, numeric-collision tests at three layers (schema parse, boundary, agent-loop cycle). OK
4. numeric-collision test existe - sección 11. OK
5. unsafe legacy path queda cerrado - sección 1 (Agent Tool Loop rewired; Bloque A already unreachable, guarded). OK
6. RFM usa endpoint/ID correcto - sección 6. OK
7. CP failure no degrada identity - sección 8 (zero identity writes/reads-for-mutation in the new boundary). OK
8. CP failure no tumba operaciones públicas - sección 8 (catalog/shipping/quote structurally independent; existing try/catch preserved). OK
9. prompt-safe context no filtra PII - sección 9 (reused, previously-audited summary builders, unmodified). OK
10. consumer es provider-neutral - sección 10. OK
11. CP no escribe identity - sección 8/12 (module has zero write imports). OK
12. A09 bridge se convierte en prerequisite real y suficiente - sección 3. OK
13. tests demuestran master != prestashop id - sección 11. OK
14. queda un único boundary seguro para consumo R2 - sección 4 (verified: single call site of `loadCustomerCommercialHistoryContext`/`createProductionCustomerProfileCapabilities`). OK
