---
title: LLM-R1-T09B — WhatsApp Allowlisted Multi-Intent Smoke
doc_id: release-llm-r1-t09b-whatsapp-allowlisted-multi-intent-smoke
status: implemented
owner: architecture
last_reviewed: 2026-08-14
source_of_truth_for:
  - shouldRouteToMultiIntentPlanner allowlist-gated routing contract
  - BRAIN_MULTI_INTENT_PLANNER_ENABLED + BRAIN_AUTONOMOUS_TEST_WA_IDS interaction
  - WA01-WA07 live WhatsApp-code-path smoke results
depends_on:
  - ./LLM-R1-T09A-multi-intent-planning-and-requirement-resolution.md
  - ../architecture/commercial-multi-intent-planning.md
  - ../audits/SALES-AGENT-LLM-MODEL-BENCHMARK-DECISION.md
tags:
  - release
  - agent-loop
  - multi-intent
  - whatsapp
  - llm-provider
---

# LLM-R1-T09B — WhatsApp Allowlisted Multi-Intent Smoke

`LLM-R1-T09A` built and live-benchmarked the Multi-Intent Planner in isolation (`BRAIN_MULTI_INTENT_PLANNER_ENABLED`, a global on/off switch, never enabled by default, never scoped to specific customers). This task makes the flag safe to turn on for a real deployment by scoping it to `BRAIN_AUTONOMOUS_TEST_WA_IDS`, and validates the whole thing through the real inbound code path (not synthetic benchmark inputs) for the first time.

## Scope note on "real WhatsApp"

This dev environment's Meta webhook is not wired to it (confirmed in a prior session: a real message from the user's own phone never reached this app's database) - a literal phone-to-phone round trip is not achievable here regardless of what this task does. Per explicit instruction, the smoke instead uses `processNativeWhatsAppInbound` directly - the exact function the real webhook route calls immediately after persisting an inbound event - with a fake Meta transport substituted only at the final send step (`BRAIN_META_SEND_ENABLED=false`; the outgoing message is read directly from the planned `brain_message_outbox` row). This is the same discipline `scripts/e2e-autonomous-harness.ts` already established for this repo's other WhatsApp-shaped smoke scenarios. Everything else is real: DB, live LLM, dispatch, capability persistence.

## 1. Routing (Part 1)

New `shouldRouteToMultiIntentPlanner(waId)` in `commercialCycleConfig.ts`, composing the existing flag with the existing `BRAIN_AUTONOMOUS_TEST_WA_IDS` allowlist reader (`autonomousRuntimeConfig.ts`) - but with **different, stricter semantics** than that allowlist's other consumer (the overall pilot gate): an empty allowlist there means "unrestricted" (correct for gating the whole autonomous pilot before any allowlist exists); here, `BRAIN_MULTI_INTENT_PLANNER_ENABLED=true` with an empty allowlist is treated as ambiguous configuration and fails closed for everyone - the flag is meaningless without an explicit allowlist to scope it to, and this task's contract explicitly forbids ever routing "everyone" to the new path.

Wired into `runNativeAgentToolLoopCycle.ts` (replaces the T09A global check) and into `runNativeAutonomousCycle.ts`'s provider construction (Part 2 - see below). Both call sites read `input.waId`, never a routing decision made anywhere else.

Verified with 9 automated tests: 6 pure-function cases (`shouldRouteToMultiIntentPlanner.test.ts` - allowlisted+flag-on, non-allowlisted, empty/missing allowlist, missing waId, flag-off, malformed flag value) and 3 integration cases through the real `runNativeAgentToolLoopCycle` wiring itself (`routingIntegration.test.ts` - proves `input.waId` genuinely reaches the routing decision, not just the pure function in isolation, via a structural differentiator: the multi-intent path's `llmCalls` phase sequence is `["gathering","finalization"]`, the legacy path's is `["gathering","gathering"]`, for the identical raw provider script).

## 2. Thinking mode (Part 2)

`runNativeAutonomousCycle.ts`'s single `createHttpAgentLoopProvider(...)` call site now conditionally adds `thinking: "disabled"` - only when `shouldRouteToMultiIntentPlanner(input.waId)` is true for that exact turn. Every other turn (the entire legacy path, and any multi-intent-flag-on-but-not-allowlisted turn) is byte-identical to before: `thinking` stays omitted, the provider's default (`KEEP_THINKING_ENABLED`, audit doc section 15) applies. Production's global model configuration was never touched.

## 3. No architecture changes (Part 3)

`CommercialIntentPlan`, the Requirement Resolver, the Execution Planner, `ActionPlanExecutor`, and the Commercial Mutation Execution Guard were not redesigned. Two small, local, live-discovered bugs were fixed inside the Requirement Resolver (see section 5) - explicitly authorized by the task ("corregir solo si es local y claramente dentro de T09B"), each with its own regression test.

## 4. WA01-WA07 results

Two runs of the full corpus (via `scripts/manual-test/whatsapp-multi-intent-smoke.ts`), `deepseek-v4-flash`, `thinking=disabled`, real DB, real dispatch, fake Meta transport only:

- **Primary** (default flags): real commune resolver (`pc_pos.comuna`), real Carrier MS (`http://ms.pesaschile.cl`, reachable). Catalog Service: local HTTP fixture (the real instance at `CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010` is not running in this environment - confirmed unreachable before starting, a pre-existing, out-of-scope environment fact, not a code defect - reuses the exact fixture T09A's own already-live-validated benchmark uses).
- **Supplementary** (`--fake-commune`): same as primary, except commune resolver + Carrier MS also use T09A's fixture data - built only to isolate whether a real-infra gap (see section 6) or the multi-intent code itself was responsible for an initial shipping-related result.

| Case | Customer message(s) | Result |
|---|---|---|
| WA01 | "quiero 2 de la classic" (after a real seed search turn) | **PASS**. `select_products` completed for productId 31, qty 2. Single response, claims backed. |
| WA02 | "cuánto sale el despacho a Ñuñoa" (durable selection pre-seeded) | **PASS** on every T09B-owned criterion (intent, requirement resolution, execution plan, single honest response, zero unbacked claims). The final shipping cost itself is blocked by the pre-existing infra gap in the primary run (see section 6); supplementary run: full PASS including the real quote. |
| WA03 | "quiero 2 de la classic y cuánto sale el despacho a Ñuñoa" | **PASS**, same infra caveat as WA02. Supplementary run: `select_products` + `set_shipping_destination` + `calculate_shipping` all completed, one consolidated response naming both the selection and the real quote. |
| WA04 | "quiero 2 de la classic y cuánto sale el despacho" | **PASS**. `select_products` completed; `get_shipping_quote` stayed `waiting_for_information`, missing exactly `DESTINATION`; the response asks only for the comuna, never re-asks about the product. Pending intent persisted durably. |
| WA05 | "Ñuñoa" (continuation of WA04) | **PASS**. The durable pending intent was rehydrated (verified via a direct `crm_request_facts` read, never LLM memory), `DESTINATION` satisfied, `set_shipping_destination`/`calculate_shipping` executed, pending intent cleared afterward. Primary run: same infra caveat as WA02/WA03 for the final cost; supplementary run: full PASS with the real quote. |
| WA06 | "muéstrame las barras olímpicas..." (seed) then "dame la barra" | **PASS**. Two real candidates (Classic, Pro) from a real `search_products` call; PRODUCT resolved as `ambiguous`; response asks the customer to choose between the two real product names; zero tool execution, zero silent pick. |
| WA07 | "quiero que me lo dejen reservado para mi hermano" | **PASS**. Classified `unsupported`; response asks a natural clarifying question; zero tool execution, zero invented capability. |

Unbacked commercial mutation claims across both full runs (14 test turns, 28 LLM calls): **0**. Provider timeouts: **0**. Every turn's `terminalReason` was `"responded"`.

## 5. Real bugs found and fixed (both classified `REQUIREMENT_RESOLUTION`)

Both were only reachable through this task's real Catalog Service fixture response shape and real Spanish phrasing from the live planner - neither T09A's unit tests nor its own live benchmark corpus happened to exercise either condition (T09A's fixtures never included a `combinationId` field, and its MI01 case's `productReference` was scripted verbatim as the exact product name, never a live planner's own phrasing).

**5.1 - Leading Spanish article defeated the fuzzy product match.** For "quiero 2 de la classic", the live planner correctly (and reasonably, per its own prompt instruction to name the product "as specifically as the customer did") returned `productReference: "la classic"`. Neither `"la classic"` nor `"barra olimpica classic 20kg"` is a substring of the other, so the pure-substring match in `requirementResolver.ts` found zero candidates - `PRODUCT` came back `missing` for an unambiguous, real product. Fixed by stripping a small, fixed set of leading Spanish filler words (`la/el/los/las/un/una/unos/unas/de/del`) from the reference before matching - as **whole leading words only**, so a real product literally named starting with one of them (regression test: a hypothetical "La Roca") is never mangled. Regression tests `[MI-Resolve-1b]`/`[MI-Resolve-1c]`.

**5.2 - The Catalog Service's "no variant" sentinel (`combinationId: 0`) was treated as a real, specific variant id.** A `search_products` result for a product with no attribute combinations carries `combinationId: 0` (a PrestaShop convention, confirmed in the fixture's own `searchItemPayload`) - `RecentCatalogContext` converts it to the non-empty string `"0"`, which the resolver's `product.combinationId ? {...} : {}` check treated as present and meaningful. It was carried into the `select_products` arguments, persisted to `commercial_line_items`, then sent back to the Catalog Service's batch endpoint on `calculate_shipping`, where `calculateShippingCapability.ts`'s own defensive "this should be unreachable" key-mismatch guard fired for real (`catalog_response_mismatch`-class failure) - exactly the failure mode the task's own instructions anticipated by name. Fixed with a single `normalizeCombinationId()` helper (`"0"` -> `undefined`), applied at both places a combinationId is read from evidence (`RecentCatalogContext` candidates and durable `commercialLineItems`). Regression tests `[MI-Resolve-1d]`/`[MI-Resolve-1e]`.

## 6. Non-blocking finding: two pre-existing, out-of-scope infrastructure gaps

Neither is a T09A/T09B defect; neither was fixed (per the task's own instruction to separate and document, never silently work around in production code).

**6.1 - `LOGISTICS_DB_ENABLED` is not configured in this dev environment.** `createPcPosCommuneResolver()` needs a second, separate database connection (`pc_pos`) this environment does not have enabled - confirmed directly: `resolver.resolve("Ñuñoa")` returns `{status:"error", reason:"configuration_unavailable", detail:"LOGISTICS_DB_ENABLED is not true"}`. This blocks the real `set_shipping_destination` capability for any commune, for any caller (legacy loop or multi-intent, both unaffected by T09A/T09B) - never specific to this task. The system's own behavior in response is correct and honest: `temporarily_blocked`, retryable, the customer is asked to reconfirm, never a fabricated commune or shipping cost. Confirmed unrelated to the multi-intent code via the `--fake-commune` supplementary run (section 4), which produces a real quote once a working commune resolver is available.

**6.2 - The real Catalog Service instance (`CATALOG_SERVICE_BASE_URL=http://127.0.0.1:4010`) is not running in this environment.** Confirmed via a direct connectivity check before the smoke started (connection refused). Carrier MS (`http://ms.pesaschile.cl`) IS reachable and was used for real throughout every run in this task (never faked). Same fixture Catalog Service T09A's own already-live-validated benchmark uses was substituted, per the task's explicit instruction for this exact situation.

## 7. Observability (Part 9)

`runCommercialMultiIntentLoop.ts` gained one additional bounded log line, `multi_intent_mutation_guard_evaluated` (`claimed`/`backed`/`blocked` booleans only, never message text or reasoning) - the one piece of Part 9's required observability T09A's own logging did not yet cover. Combined with T09A's existing `multi_intent_turn_completed`/`multi_intent_finalizer_completed` events, every field Part 9 lists (planner path selected, intent types, requirement statuses, action types/outcomes, pending intent lifecycle, planner/executor/finalizer/total elapsedMs) is directly observable without reading `reasoning_content` anywhere.

## Definition of Done

- [x] Routing scoped to flag AND allowlist, fails closed on ambiguous config (Part 1)
- [x] `thinking=disabled` only for the allowlisted multi-intent path, production global config untouched (Part 2)
- [x] No architecture changes beyond two small, local, regression-tested Requirement Resolver fixes (Part 3)
- [x] WA01-WA07 all PASS on every T09B-owned criterion (Part 4)
- [x] Backend evidence recorded per case: correlation id, detected intents, resolved/missing/ambiguous requirements, execution plan, capability executions, durable facts, pending intent state, outgoing response, latency, LLM calls, mutation guard activation (Part 5)
- [x] Durable continuation demonstrated with a real DB read, never LLM memory (Part 6)
- [x] Shipping uses the real capability chain; the one real capability gap found is documented independently, not bypassed in production code (Part 7)
- [x] Routing isolation verified with dedicated tests; no non-allowlisted traffic reached the new path (Part 8)
- [x] Observability added, no PII, no reasoning_content (Part 9)
- [x] Bugs classified (both `REQUIREMENT_RESOLUTION`) and fixed locally; the one architectural-shaped finding (opportunity creation - see below) was documented, not fixed
- [x] Docs created/updated
- [x] Verdict emitted

**One additional non-blocking finding, distinct from section 6** (documented, not fixed, out of scope - "si implica rediseno arquitectonico, detener y documentar"): the whole Agent Tool Loop family (legacy and multi-intent alike, neither modified by this finding) has no mechanism of its own to create a `crm_opportunities` row - only the legacy `persistCommercialState`/operational-loop pipeline does, which this family bypasses entirely by design. Every prior benchmark/test in this repo (including T09A's own) side-stepped this by injecting a synthetic `opportunityId` directly into the loop; this is the first harness to go through the real `processNativeWhatsAppInbound` entry point for a brand-new conversation, so it is the first to surface it. The smoke harness works around it locally by seeding one minimal, real, DB-linked `crm_opportunities` row per scenario (never a disconnected synthetic id) - a test-harness accommodation, not a production code change.

## Cierre

```text
LLM-R1-T09B: DONE

Branch:
feat/llm-r1-t09b-whatsapp-allowlisted-smoke

Allowlist routing:
PASS

WA01 selection:
PASS

WA02 shipping:
PASS

WA03 multi-intent:
PASS

WA04 partial + missing destination:
PASS

WA05 pending continuation:
PASS

WA06 ambiguity:
PASS

WA07 unsupported intent:
PASS

Unbacked mutation claims:
0

Provider timeouts:
0

Multi-intent path non-allowlisted leakage:
NO

Pending intent durable:
YES

Average LLM calls/turn:
2.00

Turn latency:
p50=3011ms
p95=3314ms
(n=7 final test turns, primary real-infra run; supplementary --fake-commune run showed the same latency profile)

Production global thinking changed:
NO

Production global routing changed:
NO

Verdict:
WHATSAPP_SMOKE_VALIDATED

Next:
LLM-R1-T09C - resolve the LOGISTICS_DB_ENABLED environment gap (section 6.1) so a real commune/shipping quote can be demonstrated without the --fake-commune fallback; separately, investigate Agent Tool Loop opportunity creation (Definition of Done note) as its own task
```
