# SALES-AGENT-R2-ID-R2-A09 - PrestaShop Canonical Identity Bridge

## Veredicto

`ID_R2_A09_PRESTASHOP_IDENTITY_BRIDGE_VALIDATED`

## Baseline

- `docs/releases/SALES-AGENT-R2-ID-R2-A08.1-ready-to-link-live-e2e-closure.md` - veredicto `ID_R2_A08_1_READY_TO_LINK_E2E_BLOCKED`. Its root-cause finding is this task's entire mandate: no writer for `customer_external_identity(provider="prestashop")` existed anywhere in this codebase; `link_external_identity`/`evaluateLinkExternalIdentityAuthority` are hard-scoped to the WhatsApp channel (`waId === inboundWaId`) and structurally cannot authorize a PrestaShop bridge.
- A02-A08 unmodified except two small, explicitly-scoped wiring extensions (section 8) and one wording correction (section 4) - no policy/decision logic in any of them changed.

## 1. Root cause heredado de A08.1, y qué capa es la owner de la mutación (PARTE 1)

Confirmed again before writing any code: `customerIdentityCapabilities.ts#linkExternalIdentityCapability` hardcodes `provider: "whatsapp"`; `evaluateLinkExternalIdentityAuthority` (`lib/domains/customer-service/authority-policy.ts`) denies unless the wa_id being linked equals the current inbound's wa_id - a PrestaShop customer id can never satisfy that check, by design. `docs/CAPABILITY_MATRIX.md`'s own `link_external_identity` row already documented this scope, written under ACS-R1-04 before A04/A06's PrestaShop-track `READY_TO_LINK` concept existed - the two tracks were never reconciled until now.

Layer ownership (as audited): **Sales Agent / CommercialWork never does SQL directly** - it only reaches the Capability Gateway. **Customer Service is the external authority** over the canonical link's uniqueness (an external system, no access to `main_management`) - it authorizes the mutation and records it on its own side. **CRM's Capability Gateway layer is the sole writer of the LOCAL projection** (`customer_external_identity`, the table A05's live LEVEL_3 check actually reads) - exactly the same layer that already writes the WhatsApp-provider case today (`lib/brain/native-whatsapp/service.ts`). This is the one architectural fact A08.1 did not have and this task had to establish before implementing anything (see section 5/6).

## 2. Decisión: capability separada, nunca `link_external_identity` generalizado (PARTE PRINCIPIO CENTRAL/2)

`link_prestashop_identity` is a new, standalone capability (`customerIdentityCapabilities.ts#linkPrestashopIdentityCapability`), registered separately in `CUSTOMER_IDENTITY_CAPABILITY_DEFINITIONS` - never a parameter added to `link_external_identity`. `link_external_identity`'s own code, authority, and tests are untouched (verified: its full pre-existing suite, `linkExternalIdentityCapability.test.ts`, still 100% green; `PSB22/23` re-confirms provider=whatsapp and the wa_id-match authority are byte-for-byte unchanged). The predicates really are different: WhatsApp link authority proves *channel control* (is this really your phone); PrestaShop link authority proves *e-commerce account adjudication* (does this PrestaShop account really belong to you) - conflating them would have meant one authority function silently gaining a second, unrelated meaning.

## 3. Authority (PARTE 3)

`lib/domains/customer-service/authority-policy.ts#evaluateLinkPrestaShopIdentityAuthority` - deliberately scoped identically to its WhatsApp sibling's own layer (input-shape validation only: master id present, PrestaShop id present, consent granted + current-turn fields present, no known conflict). It does **not** re-check LEVEL_2/READY_TO_LINK/no-CONFLICT/no-AMBIGUOUS/evidence-current itself, and this is a deliberate, documented decision (see the function's header comment): those seven checks are already fully encoded in a single fact - `RuntimeIdentityContext.status === "READY_TO_LINK"` (A04's `evaluate.ts`, unmodified: that status is only ever reached *past* the CONFLICT/AMBIGUOUS branches, with a current, non-stale/superseded/revoked verified candidate). Re-deriving them in `authority-policy.ts` - a layer with no `RuntimeIdentityContext` concept by design - would have duplicated A04's policy in a lower, less-informed layer. The capability (`linkPrestashopIdentityCapability.execute()`, which does have `session.runtimeIdentity`) owns that single precondition check instead, exactly where PARTE 1's layering discussion put it.

No LLM-controlled id is ever trusted: `masterCustomerId`/`prestashopCustomerId` are read exclusively from `session.runtimeIdentity` - the tool-request `input` argument is never read at all (`PSB07/08/09/24` sends an attacker-shaped input and confirms it never reaches the HTTP request).

## 4. Consent semantics (PARTE 8/9)

A new, separate `ConsentScope` literal (`link_prestashop_identity`) with its own regex (`consentEvidence.ts#LINK_PRESTASHOP_IDENTITY_PATTERN`, target nouns `perfil|cuenta|prestashop`). This required a real, security-relevant fix to the *existing* WhatsApp pattern: `LINK_EXTERNAL_IDENTITY_PATTERN`'s target-noun list used to include `perfil|cuenta` - words that would have overlapped with the new PrestaShop pattern, letting "vincula mi cuenta" ambiguously authorize either bridge. Narrowed to `whatsapp|numero|telefono` (the channel itself) - a phrase that also names the channel explicitly (e.g. "vincula mi cuenta de WhatsApp") still matches correctly. `PSB05` proves the two scopes are never conflated: a real, valid `link_external_identity` consent alone never authorizes the PrestaShop bridge.

A08's `NativeCustomerSessionExecutionContext.currentTurnConsent` gained the `linkPrestashopIdentity` field (same current-turn-only guarantee as the other two - `parseAllConsentEvidence` remains the single, stateless parse point, re-verified via `PSB` and the pre-existing `RTL03`-style statelessness test). Section 5's revised wording ("¿Confirmas que la vinculemos a tu perfil...?") deliberately echoes this pattern's own vocabulary.

## 5. Wording correction (PARTE 8)

`buildCommercialWorkFinalizerMessage.ts`'s `IDENTITY_LINK_PENDING` message used to say *"...vincule este WhatsApp a ella..."* - directly misleading now that `READY_TO_LINK` routes to the PrestaShop capability, never the WhatsApp one. Corrected to *"Encontré una cuenta que coincide con los datos que verificamos. ¿Confirmas que la vinculemos a tu perfil para continuar?"* - never reveals a PrestaShop id, registered email, or candidate count (`PSB25`/`RTL15`, re-verified).

## 6. Customer Service contract (PARTE 6/10)

Reused the existing generic transport (`POST /v1/customers/:id/external-identities`, already provider-agnostic at the wire level per `docs/integrations/customer-service-http-contract.md`) - **never a new HTTP endpoint**. A new domain-level request/result pair (`LinkPrestashopIdentityInput`/`LinkPrestashopIdentityResult`, `lib/domains/customer-service/types.ts`) was still introduced deliberately, rather than widening `LinkExternalIdentityInput` (whose `externalIdentity.provider` type is the single literal `CustomerServiceChannel = "whatsapp"`) - widening that type would have let a future caller of the *existing* WhatsApp capability accidentally pass `"prestashop"` too, silently reintroducing the exact conflation section 2 rules out. `LinkPrestashopIdentityResult` mirrors `LinkExternalIdentityResult`'s status vocabulary exactly (`completed`/`already_linked`/`conflict`/`denied`/`invalid_input`/`temporarily_unavailable`/`failed`) so the existing HTTP-error mapping (`http-adapter.ts#mapMutationHttpError`) and audit business-outcome classifier (`identityCapabilityOutcome.ts`) are reused, never duplicated.

`pesas_productiva.ps_customer`/`ps_orders` (PrestaShop's own PARTE 6 source of truth for candidate discovery/order ownership) are never queried by this capability - that discovery already belongs to A02's resolver (unmodified); this capability only ever consumes an *already-verified* `prestashopCustomerId` from `RuntimeIdentityContext`, never re-validates it against PrestaShop tables itself. `master_customer` is never used as a PrestaShop discovery source either (PARTE 6's explicit prohibition) - only ever read as the already-resolved master id.

## 7. Persistence, idempotency, conflicts (PARTE 4/5/13/17)

**Local projection write - the piece A08.1 found missing entirely.** Customer Service has no access to `main_management`, so after it confirms `completed`/`already_linked`, the capability itself writes the local `customer_external_identity` row (`upsertExternalIdentity`, the same repository function `native-whatsapp/service.ts` already uses for the WhatsApp case) with `provider="prestashop"`, `identity_type="prestashop_customer_id"`, `external_id=String(ps_customer.id_customer)`, `customer_id=master_customer.id` - trusting Customer Service's own echoed-back `customerMasterId` (already numeric-validated by the HTTP adapter), never this turn's unvalidated local value directly. `master_customer.id === ps_customer.id_customer` is never assumed (PARTE 5) - they are read from two independent fields (`result.customerMasterId` vs. `prestashopCustomerId`) and written as two independent columns.

**Idempotency/conflict is entirely Customer Service's job (PARTE 6)** - no local pre-check duplicates its authority. `completed`/`already_linked` both succeed and upsert (idempotent by construction: a second identical call updates the same row, never inserts a duplicate - `PSB10`). A `conflict` response (PrestaShop id already linked to a different master, or master already linked to a different PrestaShop id) is reported as-is, Gateway status `completed` (the HTTP call itself succeeded) with business outcome `errorCode: "prestashop_link_conflict"` - **no local write is attempted at all on conflict**, so an existing, correct bridge is never silently overwritten (`PSB11/12`, PARTE 17: no auto-relink, no correction workflow built - an incorrect bridge still requires a future, explicit correction mechanism this task does not build).

## 8. GAP 1 resolution (PARTE 7/15)

`runCustomerOnboardingPostPlanStage.ts` gained a fifth, independent step, gated **exclusively** on `session.runtimeIdentity.status === "READY_TO_LINK"` - never on `session.identity.source` (step 4's own gate, the WhatsApp-channel axis, left completely untouched). This is the literal fix for A08.1's GAP 1: a customer whose wa_id is *already* canonically linked, with a verified PrestaShop candidate ready to bridge, now reaches the new capability (`PSB01`) - before this task, that exact scenario silently reached neither step 4 (wrong axis) nor any PrestaShop-aware path (none existed). Both steps still return immediately once executed, so at most one identity-mutating capability ever runs per turn (unchanged discipline).

`CUSTOMER_ONBOARDING_POST_PLAN_ATTEMPTED_OPERATIONS` gained the `"link_prestashop_identity"` literal; `runCommercialWorkInboundCycle.ts`'s existing bounded same-turn re-settle condition (A07, "PARTE 15") gained this as a third recognized value - a one-line, mechanical extension of an already-tested pattern, never a new loop, never a second resume mechanism.

## 9. Projection gate (PARTE 13)

Deliberately **not re-implemented** as a second check inside the capability. A05's `resolveRuntimeIdentityContext#decideWithLiveLevel3Check` (unmodified) already performs exactly this gate - it queries the live `customer_external_identity` table before ever returning `LEVEL_3_PRESTASHOP_LINKED`, and fails closed to `NOT_LINKED`/`LEVEL_2` if it does not confirm (already proven correct in A08.1's `RTL07`/`RTL13`, re-verified here as `PSB15` in this new, real-write context). Building a duplicate check inside the capability would have re-implemented existing, already-audited A05 logic. A local-write failure (`upsertExternalIdentity` returning `ok:false`) is surfaced as a `prestashop_bridge_local_write_failed` warning on the capability's own outcome (never changes its `status`, since the *external* operation genuinely succeeded) - and A05's live check independently guarantees no false `LEVEL_3` regardless (`PSB15`).

A second write - durable evidence (`crm_customer_identity_evidence`, `source: "customer_external_identity"`) - was also required, discovered only by testing: A04's `canonicalPsLink`/`VERIFIED` branch (`evaluate.ts`) reads *durable evidence* first, not the live table directly; A02's resolver already writes this exact row every turn once it independently discovers a live bridge, but only on its own next pre-plan pass. Without also writing it here, same-turn resume (section 10) would not have worked - only cross-turn. This write lives in `identityEvidenceHooks.ts#recordPrestashopBridgeEvidence` (see section 11 for why it is not inline in the capability), reusing the exact real `recordIdentityEvidence` function A02/A03 already use - never a second evidence engine. A real bug was found and fixed while wiring this: `recordIdentityEvidence`'s own "same value already current" dedup check hashes on `sourceRecordRef ?? prestashopCustomerId` - writing with no `sourceRecordRef` produced the *identical* hash as the pre-existing weak candidate row (same `prestashopCustomerId`), so the confirmation write was silently treated as "unchanged" and never actually inserted. Fixed by passing Customer Service's own echoed `externalIdentityId` as `sourceRecordRef` - a real, distinct value (never invented) that correctly makes this a new/changed row, superseding the candidate as intended.

## 10. LEVEL_3 transition + same-turn resume (PARTE 12/14)

`PSB16`: a real HTTP success + both writes above → `resolveRuntimeIdentityContext` (real, unmodified) genuinely returns `PRESTASHOP_LINKED`/`LEVEL_3_PRESTASHOP_LINKED` with the correct master/PrestaShop ids. `PSB17`: re-evaluating `evaluateCommercialIdentityRequirement("customer_profile_history", ...)` (A06, the one real, catalogued `LEVEL_3` operation - see A08.1 PARTE 1) immediately after, in the same turn, flips from `READY_TO_LINK` to `SUFFICIENT` - no next-turn wait required, exactly PARTE 14's ask, achieved via A07's existing bounded re-settle mechanism (section 8) plus the durable-evidence write (section 9) - no new mechanism.

## 11. Boundary discipline: `customerIdentityCapabilities.ts` never imports the evidence domain directly

Found via a pre-existing structural test (`customerIdentityEvidence.test.ts`'s `IDE17`: *"the write API is never registered as a Capability Gateway tool/capability"* - asserts the Capability Gateway file never imports `customer-identity-evidence` at all, specifically so no LLM-reachable path can ever mark evidence `VERIFIED`). The first implementation violated this by calling `recordIdentityEvidence` directly. Fixed by moving the write into `identityEvidenceHooks.ts#recordPrestashopBridgeEvidence` (section 9) - the same, already-existing, designated "trusted-runtime-only" boundary `recordOnboardingFieldEvidence`/`recordTurnIdentityEvidence` already are, never a second evidence engine, and now correctly *not* directly reachable from the Capability Gateway layer either. A second, coincidental false-positive was found and fixed the same way: a code comment in `runCustomerOnboardingPostPlanStage.ts` mentioning "customer_external_identity" in prose tripped a separate structural test (`customerOnboardingPostPlanPrivacy.test.ts`'s test 59, checking the file's source text never mentions that table) - reworded without changing the file's actual behavior at all.

## 12. Omnichannel implications (PARTE 16)

The bridge belongs to the master (`customer_id` on the row), never to a channel - `PSB26` proves a second, entirely unrelated conversation (different wa_id, no evidence, no prior link) gains nothing from another conversation's completed PrestaShop bridge; `ANONYMOUS` stays `ANONYMOUS`. No auto-merge, no cross-channel inheritance from a mere signal match was built or is possible through this capability - consistent with PARTE 16/17's explicit prohibition.

## 13. Tests (PARTE 19/20)

New: `tests/commercial/prestashopIdentityBridge.test.ts` - **19/19 PSB01-26 pass** (PSB18-20 combined into one test; several IDs share one test where the task's own list groups them, e.g. PSB07/08/09/24). Real MariaDB (`crm_test`) + a real local HTTP Customer Service test server throughout - no mock of the domain/capability boundary. Run repeatedly for stability (2 consecutive full runs, 34/34 combined with `readyToLinkE2E.test.ts`).

PSB18-20 ("same CommercialWork resumes") reuses the same PARTE-1-authorized harness objective A08.1 already established (no live `CommercialObjectiveType` reaches a `LEVEL_3` requirement today - unchanged by this task, confirmed by A08.1's own structural test) - but this time persisted through the **real** repository (`persistCommercialWorkProjection`/`updateCommercialWorkAggregate`/`getCommercialWorkByPublicId`, unmodified), so "same `publicId`, no duplicate row, the blocker disappears" is a real database fact after a real mutation, not a re-assertion of an in-memory object.

A08.1's own `readyToLinkE2E.test.ts` is unchanged in behavior and still 15/15 green - it now documents history (the gap as it was found) rather than current state; its wording assertions were updated to match section 5's corrected message (comment added noting the supersession).

Regression (same MariaDB instance, `--test-concurrency=1` where the DB is shared):
- `npx tsc --noEmit`: clean.
- `npx eslint` on every touched production and test file: clean.
- `npm run build`: clean.
- `linkExternalIdentityCapability.test.ts` (WhatsApp, unmodified code): 100% green - confirms byte-for-byte unchanged behavior.
- `createCustomerCapability.test.ts`, `customerOnboardingPostPlanStage.test.ts`, `customerOnboardingPostPlanPrivacy.test.ts`, `customerSessionPrivacy.test.ts`, `customerIdentityAuditEvents.test.ts`: all individual assertions green (the same pre-existing file-level `after`-hook `Missing DATABASE_NAME` flake already documented in the A08/A08.1 release docs reappears intermittently outside the batch runner - confirmed unrelated, present before this task).
- `runtimeIdentityContext.test.ts`, `commercialIdentityRequirement.test.ts`, `commercialWorkIdentityGating.test.ts`, `commercialWorkIdentityOnboarding.test.ts`, `commercialWorkIdentityConversation.test.ts`, `customerIdentityEvidence.test.ts`, `customerIdentityVerification.test.ts`, `customerService.test.ts`, `identityCapabilityGatewaySummaries.test.ts`: green (one intermittent, isolation-confirmed-flaky failure each across two combined-suite runs, both reproduced as pre-existing shared-`crm_test`-scope contention already documented in prior release docs, both green on immediate isolated re-run).
- `commercialWorkInboundCycle.test.ts`, `commercialWorkExecutor.test.ts`, `commercialWorkSemanticCompleteness.test.ts`, `buildCommercialWorkFinalizerMessage.test.ts`, `extractCustomerOnboardingFields.test.ts`: 57/57.
- `nativeInboundIdentityBoundary.test.ts`, `runNativeAgentToolLoopCycleCustomerProfile.test.ts`: green.

Two real, non-flaky test failures were found and fixed during this task (not hidden behind reruns) - both documented in section 11.

## 14. Deudas explícitas

- **PSB18-20's "same CommercialWork resumes" proof is harness-bounded**, same limitation A08.1 already carried: no live `CommercialObjectiveType` maps to a `LEVEL_3` operation, so this could not be demonstrated through the fully organic `runCommercialWorkInboundCycle` → real semantic planner → real gate path. The mechanism itself (real repository persistence, real `updateCommercialWorkAggregate`) is real; only the objective's own type label is a test-only probe, exactly as PARTE 1 of both A08.1 and A09 explicitly authorize.
- **No correction/revocation workflow** for an incorrect bridge (PARTE 17) - explicitly out of this task's scope; a `conflict` is reported and left alone, never auto-resolved.
- **`ENTITY_VERIFICATION_REQUIRED`/`customer_profile_history` still has no real CommercialWork consumer** - unchanged from A06/A07/A08.1; this task did not add one (explicitly out of scope, "NO conectar todavía Customer Profile").
- **The formal migration-runner checksum-drift issue** (already documented in `docs/ACTIVE_RELEASE.md` for migrations 026-028) is unrelated to this task and was not touched.

## 15. Next slice

Per this task's own framing, A08.1's gap is now closed and proven: `READY_TO_LINK -> consent -> canonical PrestaShop bridge -> LEVEL_3` is a real, tested, VALIDATED chain. `ID-R2-A10 - Customer Profile Consumption` can now rely on `masterCustomerId` + `prestashopCustomerId` + a genuine, live-confirmed `LEVEL_3` without re-resolving identity itself - exactly the precondition this task's own "Next slice" section names.

## Criterio de salida - checklist

1. existe writer real de canonical Prestashop link - sección 7, `PSB16`. OK
2. no reutiliza incorrectamente WhatsApp authority - sección 2/3, `PSB22/23`. OK
3. GAP 1 está cerrado - sección 8, `PSB01`. OK
4. READY_TO_LINK activa el writer correcto - sección 8, `PSB01/17/18`. OK
5. consent es explícito y semánticamente correcto - sección 4, `PSB04/05/06`. OK
6. Customer Service gobierna la mutación - sección 1/6/7 (authority + HTTP call; CRM only writes the local projection after CS confirms). OK
7. provider prestashop se persiste correctamente - sección 7, `PSB07/08/09/16`. OK
8. no existe auto-relink conflictivo - sección 7, `PSB11/12`. OK
9. operación es idempotente - sección 7, `PSB10/21`. OK
10. success se confirma con live projection - sección 9, `PSB15/16`. OK
11. A04/A05 producen LEVEL_3 - sección 10, `PSB16`. OK
12. same-turn/cross-turn resume funciona - sección 10, `PSB17`. OK
13. mismo CommercialWork continúa - sección 13, `PSB18/19/20`. OK (harness-bounded, see Deudas)
14. WhatsApp linking no cambia - sección 2/13, full `linkExternalIdentityCapability.test.ts` green + `PSB22/23`. OK
15. no se filtra PII - sección 5, `PSB25`. OK
16. A08.1 E2E deja de estar estructuralmente bloqueado - sección 10/13, demonstrated end-to-end. OK
