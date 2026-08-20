---
doc_id: release-sales-agent-r2-capability-coverage-matrix
title: SALES-AGENT-R2 - Capability Coverage Matrix
status: active
last_reviewed: 2026-08-20
source_of_truth_for:
  - canonical Sales Agent capability inventory (Capability Gateway registrations, legacy tool
    pool membership, R2/CommercialWork reachability)
depends_on:
  - ./SALES-AGENT-R2-A10-capability-coverage-runtime-correctness-audit.md
  - ./SALES-AGENT-R2-commercial-semantic-capability-matrix.md
tags:
  - release
  - sales-agent
  - commercial-work
  - audit
---

# SALES-AGENT-R2: Capability Coverage Matrix

Built during A10 (2026-08-20) directly from
`lib/brain/commercial/capability-gateway/registry.ts` +
`lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts` (the
`CAPABILITY_GATEWAY_REGISTRY`, single source of truth for registration/governance),
`tests/agent-loop/recommendCatalogProductsToolExposure.test.ts` (canonical, currently-green
assertion on `AGENT_LOOP_TOOL_POOL`), `lib/brain/commercial/work/semanticIntentAdapter.ts`
+ `deriveCommercialObjectives.ts#objectiveSeedsFromPendingIntents` (every planner/pending-intent
seed producer), `lib/brain/commercial/work/deriveCommercialWorkSteps.ts` (objective -> step
derivation) and `lib/brain/commercial/work/commercialWorkExecutor.ts`'s `EXECUTABLE_STEP_TYPES`
(actual executor support). This is a capability-level matrix - see
`SALES-AGENT-R2-commercial-semantic-capability-matrix.md` for the intent-family-level view.

| Capability | Legacy exposure | R2 exposure | Planner intent(s) | CommercialObjective | CommercialWork step | Gateway registered | Side effect | Fact reads | Fact writes | Idempotency | Retryable | Test level | Live validation | Production status | Gap/debt |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `search_products` | Yes (`AGENT_LOOP_TOOL_POOL`) | Step type derivable, not executable | None (planner never emits `DISCOVER_PRODUCTS`) | `DISCOVER_PRODUCTS` | `SEARCH_PRODUCTS` (not in `EXECUTABLE_STEP_TYPES`) | Yes | read_only | - | - | N/A (read-only) | maxRetries=1, gateway-level | T0-T2 (legacy) | Legacy-live (prior sessions) | Legacy production | LEGACY_ONLY, future feature |
| `get_product_details` | Yes | None (no objective type maps to it) | None | None | None | Yes | read_only | - | - | N/A | maxRetries=1 | T0-T2 (legacy) | Legacy-live (prior sessions) | Legacy production | LEGACY_ONLY, dead for R2 |
| `batch_get_products` | No (internal enrichment only, deliberately not exposed) | None | None | None | None | Yes | read_only | - | - | N/A | maxRetries=1 | T0-T2 | N/A | Internal, non-tool | Intentionally not a tool |
| `explore_catalog` | Yes | None | None | None | None | Yes | read_only | - | - | N/A | maxRetries=1 | T0-T2 (legacy) | Legacy-live (prior sessions) | Legacy production | LEGACY_ONLY, dead for R2 |
| `search_company_knowledge` | Yes | None | None | None | None | Yes | read_only | - | - | N/A | fixture lexical search, no external service | T0-T2 (legacy) | N/A (no external service) | Legacy production | LEGACY_ONLY, dead for R2 |
| `resolve_customer` | No (direct-invoke by customer-session pipeline) | None (separate ACS-R1-04 pipeline) | N/A | N/A | N/A | Yes | read_only | - | - | N/A | gateway-level | T0-T4 (ACS-R1-04 E2E) | operational: not_verified (ACS-R1-04) | Direct-invoke, not R2 | Out of Sales Agent R2 scope by design |
| `create_customer` | No (direct-invoke) | None | N/A | N/A | N/A | Yes | mutating | - | - | Domain-level (see ACS-R1-04 docs) | gateway-level | T0-T4 (ACS-R1-04 E2E) | operational: not_verified | Direct-invoke, not R2 | Out of Sales Agent R2 scope by design |
| `link_external_identity` | No (direct-invoke) | None | N/A | N/A | N/A | Yes | mutating | - | - | Domain-level | gateway-level | T0-T4 (ACS-R1-04 E2E) | operational: not_verified | Direct-invoke, not R2 | Out of Sales Agent R2 scope by design |
| `recommend_catalog_products` | Yes | Step type derivable, not executable | None (planner never emits `COMPARE_PRODUCTS`/`RECOMMEND_PRODUCTS`) | `COMPARE_PRODUCTS`, `RECOMMEND_PRODUCTS` | `RECOMMEND_PRODUCTS` (not in `EXECUTABLE_STEP_TYPES`) | Yes | read_only | - | - | N/A | gateway-level | T0-T2 (legacy) | Legacy-live (prior sessions) | Legacy production | LEGACY_ONLY, future feature |
| `set_shipping_destination` | Yes | **Full** | `semanticIntentAdapter.ts` (`SET_DESTINATION`) | `SET_DESTINATION` | `SET_SHIPPING_DESTINATION` | Yes | mutating | - | `shipping_destination` | SAFE_BECAUSE - executor `repairEvidence`/`destinationMatches` skip when fact already matches | maxRetries default | T2/T3/T4 (`commercialWorkExecutor.test.ts`, `r2ArchitectureScenarios.test.ts`, `commercialWorkInboundCycle.test.ts`) | Live-validated (A08.6/A09, C09 bundle) | R2 default-allowlisted path | None |
| `select_products` | Yes | **Full** | `semanticIntentAdapter.ts` (`SELECT_PRODUCTS`) | `SELECT_PRODUCTS`, `CHANGE_QUANTITY` (via re-seed/supersession) | `SELECT_PRODUCTS` | Yes | mutating | - | `commercial_line_items` | SAFE_BECAUSE - domain `changed` flag + executor `repairEvidence`/`sameItems` | maxRetries=0 | T2/T3/T4 | Live-validated (A08.6/A09/A10, quantity correction 14/14 this session) | R2 default-allowlisted path | None |
| `calculate_shipping` | Yes | **Full** | `semanticIntentAdapter.ts` (`GET_SHIPPING_QUOTE`) | `GET_SHIPPING_QUOTE` | `CALCULATE_SHIPPING` | Yes | read_only | `commercial_line_items`, `shipping_destination` | - (evidence only, no durable fact) | SAFE_BECAUSE read-only + pre/post-side-effect stale-evidence guard | maxRetries default, `WAITING_SYSTEM`/`RETRY_SCHEDULED` on `temporarily_blocked` | T2/T3/T4, plus A09's parallel-wave suite (`commercialWorkParallelExecution.test.ts`) | Live-validated (A08.6/A09, C09 bundle) | R2 default-allowlisted path | None |
| `select_shipping_option` | Yes | Step type derivable, not executable | None (planner never emits `SELECT_SHIPPING_OPTION`) | `SELECT_SHIPPING_OPTION` | `SELECT_SHIPPING_OPTION` (not in `EXECUTABLE_STEP_TYPES`) | Yes | mutating | `commercial_line_items` | `selected_shipping_option` | N/A for R2 (unreachable); legacy governs by observed-`optionIndex` only | gateway-level | T0-T2 (legacy) | Legacy-live (prior sessions) | Legacy production | LEGACY_ONLY, future feature |
| `create_quote` | Yes | **Full** (semantic layer) | `semanticIntentAdapter.ts` (`CREATE_QUOTE`) | `CREATE_QUOTE` | `CREATE_QUOTE` | Yes | mutating | `commercial_line_items`, `shipping_destination`, `selected_shipping_option` | `created_quote` | SAFE_BECAUSE - explicit `idempotencyKey` field, reuses existing quote when selection unchanged | maxRetries default | T2/T3/T4 | Live-validated (A08.6/A09/A10, semantic reachability 10/10 this session); **real Quote Service E2E NOT_AVAILABLE (no `QUOTE_SERVICE_BASE_URL`)** | R2 default-allowlisted path (semantic only) | Quote Service E2E is A11/A12 integration debt |
| `HANDOFF` (step type, no capability) | N/A (conversation-control flags, not a tool) | Step type exists, no seed producer, `capabilityName: null` | None | `HANDOFF` | `HANDOFF` (not in `EXECUTABLE_STEP_TYPES`, never has a capability to call) | N/A | N/A | - | - | N/A | N/A | T0-T2 (unit, `commercialWorkProjection.test.ts`) | Structurally exercised via `humanOwnerActive`/`aiEnabled` gates, not this step type | Real handoff mechanism is the conversation-control flags (see A10 doc Part 28), not this step | Dead step type in practice - superseded by the flag-based mechanism |

## Reading this table

- **R2 exposure "Full"** means: planner producer exists, `CommercialObjective` exists, step is in
  `EXECUTABLE_STEP_TYPES`, and the capability actually executes through `executeCommercialWork`.
  Only `select_products`, `set_shipping_destination`, `calculate_shipping`, and `create_quote`
  (semantic layer) qualify.
- **"Step type derivable, not executable"** means `deriveCommercialWorkSteps.ts` has a case that
  would produce this step type if the objective type ever existed, but (a) no seed producer ever
  creates that objective type today, and (b) even if one somehow did,
  `commercialWorkExecutor.ts`'s `EXECUTABLE_STEP_TYPES` set would immediately block it with
  `errorCode: "unsupported_step_type"` (fail-closed, not a silent execution).
- Test levels: T0 registration/schema only, T1 unit, T2 deterministic capability execution, T3
  DB-backed integration, T4 `runCommercialWorkInboundCycle`/`executeCommercialWork` entry-point,
  T5 live external integration, T6 real WhatsApp path. No capability in this table has T5/T6
  evidence from this session specifically - Catalog/Carrier integration levels were established
  in prior A-phases and not independently re-verified here (A10 doc Part 25).
- Idempotency "SAFE_BECAUSE" cites the actual mechanism (fact-match/evidence-repair or an
  explicit key) - never asserted without a named reason, per the A10 audit's own requirement.
