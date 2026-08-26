# SALES-AGENT-R2-ID-R2-A08 - Conversational Identity Collection + Assisted-Sale Enrichment

## Veredicto

`ID_R2_A08_CONVERSATIONAL_IDENTITY_PARTIAL`

## Baseline

- `docs/audits/SALES-AGENT-R2-ID-R2-A01-existing-identity-onboarding-engine-reuse-audit.md`
- `docs/releases/SALES-AGENT-R2-ID-R2-A02-canonical-candidate-resolver-evidence-contract.md`
- `docs/releases/SALES-AGENT-R2-ID-R2-A03-durable-identity-evidence-corrections.md`
- `docs/releases/SALES-AGENT-R2-ID-R2-A04-identity-verification-policy.md`
- `docs/releases/SALES-AGENT-R2-ID-R2-A05-runtime-identity-context-wiring.md`
- `docs/releases/SALES-AGENT-R2-ID-R2-A06-commercial-identity-requirement-policy.md`
- `docs/releases/SALES-AGENT-R2-ID-R2-A07-commercialwork-identity-gating-onboarding-resume.md` - veredicto `ID_R2_A07_COMMERCIALWORK_IDENTITY_GATING_VALIDATED`, next slice = this task.

None of A02-A07 were modified. `commercialIdentityGate.ts` (the gating mapping tables, `findIdentityOnboardingTrigger`), `evaluate.ts` (A04/A06), and every other file under `lib/domains/customer-identity-*` and `lib/brain/commercial/identity/` stay byte-for-byte as A07 left them.

## Alcance real de esta tarea

A08 is the conversational layer on top of A07's mechanical gating/resume: it decides **what to ask** (never who the customer is), fixes a real bug found while auditing that gap (Part 1), and adds the READY_TO_LINK consent wording A07 explicitly left as its "next slice." It does **not** add an LLM wording layer, a decline-tracking state machine, or a conflict sub-classifier - each of those was evaluated and deliberately scoped out; see PARTE 9/19/22 below for why.

## 1. Audit of the current capture flow (PARTE 1)

Audited `extractCustomerOnboardingFields.ts`, `runCustomerOnboardingPostPlanStage.ts`, `CustomerOnboardingService`, `buildCommercialWorkFinalizerMessage.ts`, `consentEvidence.ts`, `onboardingPurposeMapping.ts`, and A04's `evaluate.ts` (read-only - never modified).

1. **What can be captured today**: email, firstName, lastName, orderReference (deterministic regex, current-message-only), plus create_customer/link_external_identity consent (deterministic phrase parser, current-message-only).
2. **Deterministic only** - there is no LLM extraction anywhere in this pipeline, before or after A08.
3. **N/A** - no LLM step exists to route through.
4. `collected_json` updates via `CustomerOnboardingService.collectFields`, called from `runCustomerOnboardingPostPlanStage` step 2, merging whatever `extractCustomerOnboardingFields` found in the current message onto the existing `collected` object - unconditional overwrite per field (a new value always replaces the old one in the collected view).
5. A correction reaches A03 evidence via `recordOnboardingFieldEvidence` (`identityEvidenceHooks.ts`), called for `email`/`orderReference` right after `collectFields` succeeds - `recordIdentityEvidence`'s own supersession semantics (A03, unmodified) transactionally supersede the prior row for that `(conversation, field)`, never mutating history.
6. **Which A07 blockers were actually resolvable before A08**: `ONBOARDING_REQUIRED` was wired end-to-end (activation + field capture + create_customer), but see finding (a) below - its wording was frequently wrong. `READY_TO_LINK` had **zero working wording path** - see finding (b).
7. **Wording-only, no execution path**: none - every A06 status A07 maps has *some* code path underneath it (the gap was wording quality, not missing execution).

### Two real bugs found

**(a) `ONBOARDING_REQUIRED`'s question was grounded in the wrong source.** `buildMissingInfoQuestion`'s old `IDENTITY_EVIDENCE` branch read `identityDecision.requiredEvidence` (A06, sourced from A04's `computeRequiredEvidence`). That function only populates `requiredEvidence` once at least one weak PrestaShop-track evidence row (email or order_reference, status `OBSERVED`/`CANDIDATE`) already exists (`evaluate.ts`'s `NEEDS_VERIFICATION` branch) - **on a brand-new conversation's first identity-gated turn, it is empty**, and the old wording fell back to a generic "necesito confirmar algunos datos tuyos" instead of asking for email. Worse, once the customer *had* given an email, A04's `computeRequiredEvidence` would suggest `order_reference` as a secondary corroborating signal - but `create_quote`'s onboarding purpose (`"quote"`) never requires `orderReference` at all (`onboardingPurposeMapping.ts`: `quote -> [firstName, email]`), so the old wording could ask for an order number a "quote" flow never needed. Fixed by `identityCollectionRequest.ts`: the finalizer now asks from `onboarding.pendingFields` (this turn's real `CustomerOnboardingState`, already excluding whatever the customer gave) when an onboarding row exists, or from the purpose's own required fields (`requiredOnboardingFieldsForPurpose`) when it does not yet - never from A06's `requiredEvidence` directly. `requiredEvidence` itself is untouched (A04 stays unmodified, per the task's explicit boundary).

**(b) `READY_TO_LINK` produced no consent ask at all.** `commercialIdentityGate.ts` (A07) maps `READY_TO_LINK -> BLOCKED`, not `WAITING_CUSTOMER` (by design - see A07 doc section 4/16: not every blocked reason is answerable with a plain customer message). But `buildCommercialWorkFinalizerMessage` only ever built a question for `WAITING_CUSTOMER` objectives - a `BLOCKED` objective with no durable step fell all the way to the generic `"Necesito un momento más..."` catch-all. A07's own doc names this exact gap in "Deudas": *"READY_TO_LINK y ENTITY_VERIFICATION_REQUIRED no tienen ningún CommercialObjectiveType real que los alcance hoy... no hay todavía un escenario end-to-end real que los ejercite."* Fixed: `buildCommercialWorkFinalizerMessage` now has a dedicated branch for `BLOCKED` objectives carrying `IDENTITY_LINK_PENDING`/`IDENTITY_CONFLICT`/`IDENTITY_VERIFICATION`, producing the consent ask (`READY_TO_LINK`), a safe conflict message, or a generic verification message respectively.

## 2. Conversational Requirement Contract (PARTE 2)

`lib/brain/commercial/work/identityCollectionRequest.ts`. Semantics only, no wording:

```ts
type IdentityCollectionRequest =
  | { kind: "ASK_FIELDS"; purpose; fields: CustomerOnboardingPendingField[] }
  | { kind: "ASK_CREATE_CONSENT"; purpose }
  | { kind: "ASK_LINK_CONSENT" }
  | { kind: "ASK_DISAMBIGUATION" }
  | { kind: "CONFLICT" }
  | { kind: "VERIFICATION_PENDING" }
  | { kind: "NONE" };
```

`deriveIdentityCollectionRequest(objective, onboarding)` is the single place that combines the objective's `IDENTITY_REQUIREMENT` blocker (A06's decision, verbatim) with this turn's onboarding snapshot (optional, privacy-safe) into one of the kinds above. `buildCommercialWorkFinalizerMessage.ts` is the only consumer and owns 100% of the wording - the contract never contains a question string.

`OnboardingCollectionSnapshot` is the only onboarding data this module is allowed to see: `{ status, purpose, pendingFields }` - never `collected` (no raw email/name/order value crosses this boundary). Built once in `runCommercialWorkInboundCycle.ts` from `runCustomerOnboardingPostPlanStage`'s result (or the pre-plan session's own onboarding snapshot when the trigger did not run this turn) and threaded through `dispatchCommercialWorkResponse` -> `buildCommercialWorkFinalizerMessage`, all three signatures extended with one new optional parameter, defaulted to `null` everywhere - every existing caller/test keeps its exact current behavior unchanged.

## 3. Email-first (PARTE 3)

When `requiredEvidence`/`pendingFields` includes `email`, the customer is asked specifically for it (see finding (a) above - this is the turn-1 fix). No fuzzy auto-correction, no typo-guessing: `extractCustomerOnboardingFields`'s `isValidEmail` gate (unchanged) rejects anything that does not parse as an email before it is ever considered a candidate.

## 4. Malformed / not-found email (PARTE 4)

A syntactically invalid email is never extracted at all (`extractEmail`'s `isValidEmail` check, pre-existing, unchanged) - the field simply stays pending and the same field-question fires again next turn, never silently accepted. A syntactically valid email Customer Service does not recognize (`no_match`) is distinguished structurally from a confirmed non-customer: `no_match` is the **only** outcome that lets `create_customer` proceed (`runCustomerOnboardingPostPlanStage` step 3, unmodified), and that step never runs without this-turn's explicit create-customer consent (PARTE 11 below closes the missing piece: the conversational trigger that actually asks for that consent). `EMAIL_NOT_FOUND` is therefore never conflated with `CUSTOMER_NOT_FOUND_CONFIRMED` by construction - no code path here concludes "new customer" from a bare `no_match` without a separate, explicit authorization step.

## 5. Auxiliary candidate signals (PARTE 5)

Already structural, no new code needed: `extractCustomerOnboardingFields` extracts firstName/lastName/email/orderReference independently from whatever the customer actually typed, regardless of which specific field was asked for - a customer who volunteers their name during an ambiguity turn has it captured the same turn. `name`/`orderReference` only ever feed `collected_json` (onboarding profile / candidate enrichment) - they are never treated as an identity resolution on their own; A02/A04 remain the sole adjudicators.

## 6. Phone on WhatsApp (PARTE 6)

Verified, no change needed: `REQUIRED_ONBOARDING_FIELDS_BY_PURPOSE` (`onboardingPurposeMapping.ts`, unmodified) never lists `phone` for any purpose - the channel's own trusted inbound phone (`session.trustedInbound.normalizedPhone`) is the only phone signal `resolve_customer`/`create_customer` ever use. Onboarding structurally cannot ask for a phone number today.

## 7. Order reference (PARTE 7)

Handled by the same `ASK_FIELDS` mechanism as email - when a purpose's pending fields include `orderReference` (e.g. `order_inquiry`/`complaint`/`warranty`/`return`), the finalizer asks for it specifically (`CIC07`, tested against a synthetic purpose since no live `CommercialObjectiveType` maps to those purposes today - same limitation A07 already documented for other statuses). Extraction is deterministic (`extractOrderReference`, unchanged); A02/A04 validate ownership, never this layer.

## 8. Ambiguity resolution (PARTE 8/18)

Unchanged from A07: `AMBIGUITY_RESOLUTION_REQUIRED` asks the customer to confirm email or order reference, never revealing candidate count or identity. Verified this already satisfies "prefer an independent signal, never reveal candidates" - no change made (A07's wording was already correct here).

## 9. Identity conflict (PARTE 9)

**Structural limitation found, not fixed - and not fixable within this task's boundary.** `CommercialIdentityRequirementDecision`'s `IDENTITY_CONFLICT` variant (A06, `evaluate.ts`) is `{ status: "IDENTITY_CONFLICT"; policyCode: "IDENTITY_CONFLICT" }` - a single hardcoded literal, carrying **no `conflictCode`** at all (unlike `RuntimeIdentityContext.conflictCode`, which A06 deliberately does not forward here). By the time a conflict reaches `buildCommercialWorkFinalizerMessage`, there is no data left to classify it as `CUSTOMER_RESOLVABLE` vs. `MANUAL_REVIEW_REQUIRED` - both A06 and `commercialIdentityGate.ts` (A07) are explicitly out of scope for this task ("NO TOCAR"), so this cannot be closed without a future, explicit A06/A07 change to forward `conflictCode` onto the decision. Given that, A08 implements the single safe branch only: a generic, non-revealing message that never claims a customer-fixable path and never auto-merges. This satisfies the harder requirement ("no auto-merge, never reveal a candidate") at the cost of the softer one (differentiated wording) - documented as explicit debt below, not a silent gap.

## 10. READY_TO_LINK + consent (PARTE 10)

The main functional fix of this task (finding (b) above). `READY_TO_LINK` now produces: *"Encontré una cuenta que coincide con tus datos. ¿Confirmas que quieres que vincule este WhatsApp a ella para continuar?"* - never a field question (`CIC12`). Consent itself is unchanged: `parseConsentEvidence`/`resolveNativeCustomerSession.ts`'s `currentTurnConsent` (current-turn only, existing phrase parser, never touched) is what `runCustomerOnboardingPostPlanStage`'s step 4 (`link_external_identity`, unmodified) already gates on. The wording above deliberately echoes the parser's own vocabulary ("vincula"/"WhatsApp") so a natural affirmative reply is likely to parse - a pre-existing wording/parser coupling this task did not introduce and did not change.

## 11. Create customer (PARTE 11)

**Second real gap closed.** `runCustomerOnboardingPostPlanStage` step 3 already required this-turn explicit consent before ever calling `resolve_customer`/`create_customer` (contract-correct, per ACS-R1-04) - but nothing ever conversationally *asked* for that consent once the minimum fields were in hand, so a customer who had already given every required field simply got no further prompt. `identityCollectionRequest.ts` detects this (`onboarding.pendingFields.length === 0`, non-terminal status) and the finalizer now asks: *"Con esos datos puedo crear tu cuenta para continuar. ¿Confirmas que autorizas que creemos tu cuenta?"*. No new `READY_TO_CREATE` domain state was created - this is purely a wording trigger over the existing `CustomerOnboardingState`.

## 12/13. Assisted-sale enrichment (PARTE 12/13)

Optional, appended only **after** a `HANDOFF` objective has already completed (never a precondition). Signal reused as-is per PARTE 13's explicit instruction ("no inventar un nuevo intent classifier"): the mere presence of a completed `HANDOFF` objective in this turn's plan **is** the conversion signal - no new classifier. `shouldOfferAssistedSaleEmailEnrichment` fires when this conversation has no confirmed email in its onboarding snapshot yet (`onboarding === null` or `email` still pending); a customer already identified through a different path (e.g. phone convergence, no onboarding row at all) may occasionally see the ask redundantly - documented as an accepted, harmless simplification (`ponytail:` comment in the source) rather than plumbing `runtimeIdentity` level into a pure message-building function for a secondary feature. `HANDOFF` also gained its own `completedClause` (`"voy a conectar tu conversación con alguien del equipo..."`) - it had none before A08, so a completed assisted-sale handoff produced no acknowledgement message at all; fixing that was a prerequisite for having anywhere sensible to attach the enrichment sentence.

## 14. Template vs. message (PARTE 14)

Not touched. A08 adds zero Meta template logic - every message produced here is plain conversational text, dispatched through the exact same `dispatchCommercialWorkResponse` -> `send_whatsapp_reply` action path every other CommercialWork message already uses. No channel/window-state code was read or written.

## 15. Extraction (PARTE 15)

Audited (section 1). One deterministic improvement made: `extractEmail`/`extractOrderReference` now take the **last** matching token when a message contains more than one (`EMAIL_TOKEN_PATTERN`/`ORDER_REFERENCE_CUE_PATTERN` made global, iterated to the last valid match) - directly supports the same-message correction shape PARTE 16 names ("mi correo no era A, era B"). A single-token message is byte-for-byte unaffected (existing extractor tests 6-15 still pass unmodified). No LLM extraction was added - deterministic coverage was judged sufficient for every field this task's scope requires, consistent with A03/A06's own "prefer deterministic" precedent.

## 16. Corrections (PARTE 16)

Two mechanisms, both already correct or fixed by this task:
- **Cross-turn correction** (the common case: wrong value one turn, corrected value a later turn) - already worked via `recordIdentityEvidence`'s existing supersession semantics (A03, unmodified): "an unchanged value is a no-op, a changed value transactionally supersedes the prior row." No history is mutated.
- **Same-turn correction** ("no era A, era B" in one message) - fixed by the last-match extractor change above (section 15).

## 17. Multi-turn (PARTE 17)

The 7-turn scenario (block -> email -> no-match -> corrected email -> order reference -> READY_TO_LINK -> consent -> link -> resume) is mechanically supported end-to-end by the pieces above (each turn's specific gap now has a specific question), but was **not exercised as one new live E2E test** in this task - see "Deudas" below. `commercialWorkIdentityOnboarding.test.ts` (A07, still green, 7/7) already covers block -> onboarding activation -> cross-turn resume up through `create_customer`'s terminal state; the `READY_TO_LINK` -> consent -> `link_external_identity` -> resume segment remains covered only by pure/unit tests in this task (`CIC12`), not a live multi-turn DB scenario.

## 18. Same-turn (PARTE 18)

Verified already correct, no change needed: `extractCustomerOnboardingFields` extracts email/name/orderReference independently from the same message text, and `buildCollectedPatch` merges whichever were present in one `collectFields` call - "mi correo es x@y.cl y mi pedido fue 12345" already captures both in the same turn. `CIC23` covers the corresponding wording side (multiple pending fields asked together, not one-by-one).

## 19. Finalizer / LLM wording (PARTE 19)

**Deliberately kept deterministic - no LLM wording layer was built.** `buildCommercialWorkFinalizerMessage` (and every dispatch path that calls it) has been a pure, synchronous, zero-I/O function since A07 - `dispatchCommercialWorkResponse.ts` never calls a provider for any disposition, unlike the legacy Agent Tool Loop's prompt-based message generation. Introducing an LLM rewrite step here would be a materially larger architectural change (a new provider call site, budget/deadline handling, prompt-injection surface over `requiredEvidence`/purpose, new failure-mode tests) than this task's actual gap - which was that the *deterministic* wording was grounded in the wrong data (section 1), not that it needed to sound more natural. All required semantics (purpose, requiredEvidence/pendingFields, current status, previous-field-collected flags via `pendingFields` itself, consent-required kind) are already produced by `identityCollectionRequest.ts` in a schema that a future LLM wording layer could consume without any further contract change - but building that layer is left as a candidate for a dedicated future slice, not bundled into this one. Because there is no LLM path, `CIC29` ("LLM failure -> deterministic fallback") is trivially and permanently satisfied: the deterministic path **is** the only path.

## 20. Prompt-safe context (PARTE 20)

`IdentityCollectionRequest`/`OnboardingCollectionSnapshot` carry `purpose`/`fields`/`status` enums only - never a candidate list, `masterCustomerId`, `prestashopCustomerId`, a hash, an external identity row, raw historical evidence, or other-customer PII (`CIC27`, structural source-scan test). Moot in one sense (section 19: nothing here reaches an LLM prompt today), but the type was still designed to that discipline so a future wording layer can adopt it directly.

## 21. Duplicate question prevention (PARTE 21)

Fixed as part of section 1(a): `onboarding.pendingFields` already excludes whatever the customer supplied this or a prior turn (`computePendingOnboardingFields`, A06-era, unmodified) - `identityCollectionRequest.ts` prefers it over A06's `requiredEvidence` specifically so the finalizer never re-asks for a field already in hand (`CIC02`/`CIC08`).

## 22. Customer declines (PARTE 22)

**Not implemented as a tracked mechanism - deliberately.** There is no "customer explicitly declined" signal, counter, or escalation anywhere in this codebase, and building one (attempt counting, an auto-handoff transition on N declines) would itself be a new onboarding-adjacent state machine - explicitly forbidden by this task's own "NO TOCAR" section ("no crear otra onboarding state machine"). What already holds without new code: a decline is never interpreted as consent (the deterministic consent parser requires an explicit affirmative + action verb + target noun - a bare "no" or silence never matches), so the operation stays correctly blocked and no identity is ever invented. For **required** identity operations, the same question is asked again next turn if the customer sends another message with no new evidence (cross-turn re-derivation, A07's existing mechanism) - this is not a nagging loop (never more than one question per turn) but it also never proactively offers a handoff after N declines. For **optional** assisted-sale enrichment, decline is trivially handled: the ask is appended only after the handoff already completed, so nothing is ever blocked by it (`CIC19`). Escalating a real repeated-decline product decision (e.g. auto-handoff after 2 refusals) is left as an explicit candidate for a future, narrowly-scoped slice.

## 23. System failure (PARTE 23)

Unchanged, verified still correct: `SYSTEM_WAIT` maps to `WAITING_SYSTEM` (`commercialIdentityGate.ts`, A07, untouched), which `buildCommercialWorkFinalizerMessage` never surfaces as a customer question (`CIC22`, re-verified with a direct assertion that the objective status is `WAITING_SYSTEM`, not `WAITING_CUSTOMER`/`BLOCKED`).

## 24. Privacy (PARTE 24)

No new enumeration risk introduced. The conflict message (section 9) never says "ese correo no está registrado" - it says only that automatic confirmation was not possible and the case will be reviewed. The `READY_TO_LINK` consent message says "encontré una cuenta que coincide" without naming the email/registered name/address/order history behind it. `CIC10/11` asserts the conflict message never contains a level/policy-code/conflict-code token.

## 25. Test Matrix (PARTE 25)

`tests/commercial/commercialWorkIdentityConversation.test.ts` (16 tests, pure, no DB) + targeted additions to `extractCustomerOnboardingFields.test.ts` (+2) and one corrected pre-existing test in `commercialWorkIdentityGating.test.ts` (see "Regression" below for why).

| ID | Status |
|---|---|
| CIC01 | `commercialWorkIdentityConversation.test.ts` |
| CIC02 | idem |
| CIC03 | covered structurally (section 4) - malformed email never extracted (pre-existing `extractCustomerOnboardingFields.test.ts` test 7, re-verified) - no dedicated new wording distinguishes "malformed" from "not yet given" (documented, not built - the re-ask is the same either way, which is safe) |
| CIC04 | covered structurally (section 4) - no dedicated new test beyond the structural argument (no live Customer Service in this environment - same E2E constraint A07's own doc already carries) |
| CIC05 | `extractCustomerOnboardingFields.test.ts` test 16 (same-message) + A03's existing supersession tests (cross-turn, unmodified) |
| CIC06 | covered structurally (section 18) - pre-existing extractor test 15 already proves independent multi-field extraction from one message; no new test added (would duplicate it) |
| CIC07 | `commercialWorkIdentityConversation.test.ts` |
| CIC08 | idem |
| CIC09 | covered by A07's existing ambiguity test (`commercialWorkIdentityGating.test.ts`, unmodified, still green) - no candidate reveal, independent signal only |
| CIC10/11 | `commercialWorkIdentityConversation.test.ts` (safe/generic only - see section 9 for why no differentiated case exists) |
| CIC12 | `commercialWorkIdentityConversation.test.ts` |
| CIC13 | covered structurally - `parseConsentEvidence`/step 4 gating unchanged, unit-tested by pre-existing `customerOnboardingPostPlanStage.test.ts` (unmodified, still green) |
| CIC14 | idem (pre-existing, unmodified) |
| CIC15 | covered by A07's E2E (`commercialWorkIdentityOnboarding.test.ts`, cross-turn resume, still green) |
| CIC16 | covered by pre-existing `createCustomerCapability.test.ts`/onboarding tests (unmodified, still green) |
| CIC17 | idem |
| CIC18 | `commercialWorkIdentityConversation.test.ts` |
| CIC19 | idem |
| CIC20/21 | idem |
| CIC22 | idem |
| CIC23 | idem |
| CIC24 | covered structurally - onboarding state is durable (`CustomerOnboardingService`, unmodified); no new test (would duplicate existing onboarding persistence tests) |
| CIC25/26 | covered by A07's existing E2E (never more than one onboarding row / one live `CommercialWork`, unmodified, still green) |
| CIC27 | `commercialWorkIdentityConversation.test.ts` (structural source scan) |
| CIC28 | idem |
| CIC29 | idem (trivial by construction - section 19) |
| CIC30 | covered by A03's existing evidence-supersession tests (unmodified) + the extractor fix (CIC05) |
| CIC31 | **not exercised as a new live E2E** - see Deudas |
| CIC32 | `commercialWorkIdentityConversation.test.ts` (`CIC18/32`) |

25/32 covered by a new or re-verified direct test; 6 covered structurally by unmodified, still-green pre-existing suites without a dedicated new test (would duplicate existing coverage); 1 (`CIC31`) is explicit debt.

## 26. Regression (PARTE 26)

Run against real MariaDB (`crm_test`, Docker container already running in this environment) where applicable.

- `npx tsc --noEmit`: clean.
- `npx eslint` on every file touched (7 production files, 3 test files): clean, zero warnings.
- `npm run build`: clean.
- `commercialWorkIdentityConversation.test.ts` (new, pure): 16/16.
- `extractCustomerOnboardingFields.test.ts` (2 new tests added): 17/17.
- `commercialWorkIdentityGating.test.ts` (A07, pure): 27/27 - **one pre-existing test updated**, not just left passing: `"PARTE 20: an ONBOARDING_REQUIRED(order_reference) block asks specifically for the order number"` encoded the exact bug fixed in section 1(a) (a fabricated `requiredEvidence: ["order_reference"]` that `create_quote`'s real "quote" purpose never needs). Renamed and re-asserted to the corrected behavior (asks for name+email, never order_reference) - this is the one existing-test change this task makes, and it exists because the old expectation was itself the bug.
- `buildCommercialWorkFinalizerMessage.test.ts` (A11.2-C, unmodified): 2/2.
- `commercialWorkIdentityOnboarding.test.ts` (A07, E2E, real MariaDB): 7/7 - exercises the modified `runCommercialWorkInboundCycle.ts` wiring directly (onboarding-trigger activation, cross-turn resume), zero behavior change detected.
- `commercialWorkInboundCycle.test.ts` + `commercialWorkSemanticCompleteness.test.ts` (real MariaDB): 28/28.
- `customerOnboardingPostPlanStage.test.ts`, `customerOnboardingPostPlanPrivacy.test.ts`, `customerIdentityAuditEvents.test.ts` (real MariaDB, unmodified production code): all individual assertions pass; the file-level `after` hook on two files (`customerOnboardingPostPlanStage.test.ts`, `customerSessionPrivacy.test.ts`) throws `Missing DATABASE_NAME` when run outside the full-suite batch runner - confirmed pre-existing and unrelated to this task by re-running the identical file against `develop@18db532` (`git stash`) with the identical result. Not investigated further (out of this task's scope - an existing test-harness/env quirk, not a regression).

Cero fallas nuevas atribuibles a este cambio.

## Deudas explícitas (no bloqueantes)

- **Conflict sub-classification (`CUSTOMER_RESOLVABLE` vs. `MANUAL_REVIEW_REQUIRED`, PARTE 9) is not implemented.** `CommercialIdentityRequirementDecision`'s `IDENTITY_CONFLICT` variant carries no `conflictCode` - A06/`commercialIdentityGate.ts` are both out of this task's scope ("NO TOCAR"). Closing this requires a future, narrowly-scoped A06/A07 change (forward `conflictCode` onto the decision) before A08's conflict wording can differentiate at all. Until then, every conflict gets the same safe, generic message - correct (never auto-merges, never reveals a candidate) but not differentiated.
- **No LLM wording layer (PARTE 19), by deliberate architectural choice**, not an oversight - see section 19. `identityCollectionRequest.ts`'s output shape is designed to be LLM-consumable if a future slice decides the deterministic wording's naturalness is actually a product problem worth the added surface (provider call, budget, prompt-injection review, failure-mode tests).
- **No decline/nagging-prevention mechanism (PARTE 22)**, by deliberate choice - building one would itself be a new onboarding-adjacent state machine, explicitly forbidden by this task. What exists today (a decline is never mistaken for consent; the same-turn-only bound already prevents multi-message nagging) was judged sufficient for this slice; proactive escalation after N declines is a real, separable product decision for later.
- **`CIC31` (the full 7-turn block -> collect -> verify -> consent -> link -> resume E2E) was not exercised as a new live test.** Each individual segment is covered (A07's E2E through `create_customer`'s terminal state; this task's unit tests for the `READY_TO_LINK` -> consent wording specifically), but no single new test drives the whole chain through a real `link_external_identity` call end-to-end - the same class of debt A07 already carried for this exact segment (its own "Deudas": *"Same-turn unblock... no probado contra un Customer Service HTTP real"*, and *"READY_TO_LINK... no tiene ningún CommercialObjectiveType real que lo alcance hoy"*).
- **`docs/ACTIVE_RELEASE.md` was not touched**, consistent with how A02-A07 already operated (this entire `SALES-AGENT-R2-ID-R2` track is not listed there, and none of A02-A07 added it) - this release doc remains the sole source of truth for A08's real state, same pattern already established and explicitly acknowledged for other parallel workstreams in this repository (e.g. `ACS-R1-05.1-T02.3A`-`T02.3D`'s own "Deuda de reconciliación" note).
- **CIC03/04/06/09/13/14/15/16/17/24/25/26/30 have no *new* dedicated test** - each is covered by an unmodified, still-green pre-existing suite (A03/A06/A07-era or the extractor's own pre-existing tests); adding a duplicate test purely to claim a fresh ID would not add coverage.

## Next slice

Per PARTE 27/A07's own recommendation, the honest state after this task is: the conversational path from "blocked" through "collect" through "verify" is real and specific (turn-1 email-first now actually asks for email - the single most common real scenario), and `READY_TO_LINK`'s consent ask - the segment A07 flagged as the most visible remaining gap - is now implemented and unit-tested, but not yet proven against a live multi-turn scenario with a real Customer Service. Given that:

- the structural/wording gaps this task set out to close are closed, but
- the `READY_TO_LINK` -> consent -> `link_external_identity` -> resume chain still lacks a live E2E (same debt A07 already named, now narrowed rather than closed), and
- conflict wording cannot be differentiated without a future A06/A07 change this task is not authorized to make,

the recommendation is to close the `READY_TO_LINK` E2E gap (a scoped addition to `commercialWorkIdentityOnboarding.test.ts`, no new production code expected) **before** starting `ID-R2-A09 - PrestaShop Identity Bridge + Customer Profile Consumption`. If that gap is judged acceptable to carry forward instead (it is a coverage debt, not a design gap - the mechanism is implemented and unit-tested), A09 can proceed directly.

## Criterio de salida - checklist

1. R2 puede pedir email cuando realmente se necesita - sección 1(a)/3, `CIC01`. OK
2. no pide email en operaciones públicas - sección 20/21 (A07, re-verificado), `CIC20/21`. OK
3. email incorrecto puede corregirse - sección 4/16, extractor tests 6/7/16. OK
4. correcciones superseden evidence - sección 16 (A03, sin cambios) + extractor last-match fix. OK
5. order reference puede recolectarse - sección 7, `CIC07/08`. OK
6. ambiguity no filtra candidates - sección 8 (A07, re-verificado, sin cambios). OK
7. conflict no auto-resuelve - sección 9, `CIC10/11`. OK (clasificación fina queda como deuda explícita - ver arriba)
8. READY_TO_LINK pide consentimiento, no datos redundantes - sección 10, `CIC12`. OK
9. consent sigue current-turn - sección 10 (`parseConsentEvidence`, sin cambios). OK
10. create/link authority existente se reutiliza - secciones 10/11 (cero cambios a `authority-policy.ts`/`customerIdentityCapabilities.ts`). OK
11. optional assisted-sale enrichment no se vuelve blocker - sección 12/13, `CIC18/19/32`. OK
12. customer decline se maneja sin loops - sección 22 (documentado, mecanismo mínimo). OK con nota
13. system failures no se convierten en preguntas al cliente - sección 23, `CIC22`. OK
14. multi-field input se aprovecha - sección 18/23, `CIC23`. OK
15. progress sobrevive restart - sección 24 (A03/onboarding, sin cambios; `CIW30` de A07 sigue verde). OK
16. mismo CommercialWork continúa - sección 17 (A07 E2E, sin cambios, sigue verde). OK
17. privacidad del prompt está cubierta - sección 20/24, `CIC27`. OK
18. LLM no adjudica identidad - sección 19/20, `CIC28` (no existe adjudicación LLM en absoluto). OK
19. fallback determinista existe - sección 19, `CIC29` (es el único camino, no un fallback de uno secundario). OK
20. E2E demuestra block → collect → verify → consent/link → resume o documenta exactamente el gap estructural restante - sección "Next slice"/Deudas (`CIC31` documentado explícitamente, no fingido). OK con nota
