---
title: CAPABILITY_MATRIX
doc_id: product-capability-matrix
status: active
version: "1.12.2"
owner: architecture
last_reviewed: 2026-07-14
source_of_truth_for:
  - capability inventory
  - domain implementation status
  - port status
  - adapter status
  - gateway registration
  - runtime connection
  - operational verification
depends_on:
  - ./ACTIVE_RELEASE.md
  - ./releases/ACS-R1-04-customer-identity-onboarding.md
  - ./releases/ACS-R1-03-customer-360.md
  - ./audits/acs-r1-01-capability-gateway-evidence.md
  - ./audits/autonomous-commerce-current-state-audit.md
  - ./audits/autonomous-commerce-transactional-closure-audit.md
  - ./audits/acs-r1-03-customer-360-acceptance.md
  - ./capabilities/customer-360-read-model.md
  - ./capabilities/customer-addresses.md
  - ./data/customer-360-contract.md
  - ./data/customer-address-contract.md
  - ./data/customer-lifecycle-event-contract.md
  - ./data/customer-onboarding-identity-contract.md
  - ./data/customer-creation-linking-authority-contract.md
  - ./integrations/customer-service-http-contract.md
  - ./capabilities/customer-service-capability.md
supersedes: []
tags:
  - capability
  - product
  - release
---

# CAPABILITY_MATRIX

La matriz representa estado tecnico real, no intencion de roadmap.

## Leyenda

- `Type`: `tool`, `read_model`, `service`, `command`, `policy`, `channel`, `domain_state`
- `Domain`: `implemented`, `implemented_partial`, `active_development`, `planned`
- `Port`: `implemented`, `partial`, `planned`, `not_applicable`
- `Adapter`: `implemented`, `partial`, `planned`, `not_applicable`
- `Gateway`: `registered`, `not_registered`, `not_applicable`
- `Runtime`: `connected`, `internal_context_only`, `multi_request_only`, `not_connected`
- `Operational`: `verified`, `pending_smoke_test`, `connected`, `planned`, `not_verified`
- `State`: `accepted_with_debt`, `active_development`, `implemented_partial`, `planned`

## Catalog

| Capability | Type | Domain | Port | Adapter | Gateway | Runtime | Operational | State | Debt |
| ---------- | ---- | ------ | ---- | ------- | ------- | ------- | ----------- | ----- | ---- |
| `search_products` | `tool` | `implemented` | `implemented` | `implemented` | `registered` | `connected` | `verified` | `accepted_with_debt` | ACS-R1-01.1 closed: single HTTP call per invocation (gateway owns retry), governance-derived approval (not LLM `blocking`), real smoke test (`scripts/manual-test/catalog-service-smoke.ts`) - see `audits/acs-r1-01-1-capability-gateway-hardening-evidence.md`. Remaining: multi-request's own catalog registry (`lib/brain/commercial/capabilities/registry.ts`) still reads PrestaShop SQL directly, not this port; `propose_followup` in the canonical loop is not wired to the real follow-up scheduling worker |
| `get_product_details` | `tool` | `implemented` | `implemented` | `implemented` | `registered` | `connected` | `verified` | `accepted_with_debt` | ACS-R1-01.1 closed: single HTTP call, governance-derived approval, real smoke test - see `audits/acs-r1-01-1-capability-gateway-hardening-evidence.md`. Only reachable via the deterministic ranker (`rankCatalogSearchResults.ts`) after a search - no direct LLM tool alias yet |

## Customer Identity

| Capability | Type | Domain | Port | Adapter | Gateway | Runtime | Operational | State | Debt |
| ---------- | ---- | ------ | ---- | ------- | ------- | ------- | ----------- | ----- | ---- |
| `resolve_customer` | `service` | `implemented` | `implemented` | `implemented` | `registered` | `connected` | `not_verified` | `accepted_with_debt` | ACS-R1-04-T06/T06.1: registered in the Capability Gateway (`lib/brain/commercial/capability-gateway/customerIdentityCapabilities.ts`, `read_only/autonomous/low`, `maxRetries: 0`). Invoked only by trusted server-side orchestration - never a sales-agent tool alias, never model-selectable: pre-plan via `resolveNativeCustomerSession`, or post-plan via `runCustomerOnboardingPostPlanStage` when `create_customer` needs fresh `no_match` evidence and pre-plan didn't already attempt resolution this turn. Fires at most once per inbound (the post-plan path reuses pre-plan's result instead of calling twice), only when local resolution (T02/T02.1) found no match and an active onboarding requires identity; never for a public query, never after a local conflict, never as a fallback from a local technical failure. ACS-R1-04-T08 exercised this end to end (real inbound, real `resolveNativeCustomerSession`, real Capability Gateway, local HTTP double implementing the real contract, real `crm_test` DB) across all three canonical scenarios (`tests/e2e/customerIdentityOnboarding.e2e.test.ts`) - still `not_verified` because no real Customer Service deployment exists to smoke-test against (`CUSTOMER_SERVICE_BASE_URL`/`CUSTOMER_SERVICE_API_KEY` empty in `.env.example`). ACS-R1-04-T07 added a durable audit trail on top: `customer_identity_resolution_recorded` (local/external outcome) and `customer_identity_capability_outcome_recorded` (Gateway status vs business outcome) on `commercial_event`, plus an allowlisted, PII-free `request_summary_json`/`response_summary_json` in `crm_capability_executions` (`buildRequestSummary`/`buildResponseSummary` on the capability definition) - the raw `phoneNumber`/`email`/`externalId` this capability's own input carries is no longer persisted verbatim. ACS-R1-04-T08.1: a successful `resolved` result now returns `customerMasterId` (v2.0.0, breaking rename from the ambiguous `customerId`) and is gated by `completeOnboardingWithVerifiedCustomer`/`verifyCustomerMasterProjection` (`onboardingTransitions.ts`) before identity becomes `identified` - see `create_customer` row for the full gap this closes. **ACS-R1-04-T08.1 (second increment) added real runtime recovery**: once onboarding lands `temporarily_unavailable` because the projection was not yet available, a later inbound with identity still unresolved gets exactly one fresh `resolve_customer` attempt again - `resolveNativeCustomerSession`'s trigger condition now also covers `temporarily_unavailable`, not only `required`/`collecting`. This wires `CustomerOnboardingService.retryResolution` (`temporarily_unavailable -> resolving`), previously dead code with zero runtime callers, into the same centralized gate via a shared `ensureResolving` helper (`onboardingTransitions.ts`) - never a second `create_customer`, never a fabricated `master_customer` row. Verified with a real inbound end to end, never by calling the gate functions directly, in `tests/e2e/customerIdentityOnboarding.e2e.test.ts` ("T08-A6" success path, "T08-A7" regression when the projection is still missing) |
| `get_customer` | `service` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | depends on Customer Service boundary and onboarding state |
| `create_customer` | `command` | `implemented` | `implemented` | `implemented` | `registered` | `connected` | `not_verified` | `accepted_with_debt` | ACS-R1-04-T06: registered (`mutating/autonomous/medium` - the Gateway's binary `authority` field is about operator pre-approval, not the real policy gate inside `execute()`; `maxRetries: 0`). Input is assembled entirely server-side from the trusted session (`NativeCustomerSessionExecutionContext`) - no LLM-supplied input is ever read. Applies the onboarding outcome table (created/matched_existing -> `completeOnboarding`; missing_information -> `collectFields`; conflict -> `markConflict`, never Customer 360, never link). A consent-bypass bug (`consent.createCustomer` was hardcoded `true` regardless of actual evidence) was found and fixed while writing T06's tests. ACS-R1-04-T06.1 removed its sales-agent tool alias and made `runCustomerOnboardingPostPlanStage` (legacy runtime only) the sole, deterministic caller - never LLM-tool-proposed anymore, avoiding a possible duplicate execution in the same turn. ACS-R1-04-T08 exercised the full "created" path end to end for the first time against a real, DB-backed `CustomerOnboardingService` (every prior test faked the onboarding service for this path) and found a real architecture gap: `completeOnboarding` wrote Customer Service's returned id straight into `crm_customer_onboarding_state.customer_id`, which carries a real FK to `master_customer.id` (migration 023), with nothing reconciling Customer Service's own id space with the local `master_customer` table. **ACS-R1-04-T08.1 closed this gap**: the result field is renamed `customerMasterId` (v2.0.0, breaking; `docs/integrations/customer-service-http-contract.md`), the HTTP adapter fail-closed-rejects any success response missing it or with an invalid (non-numeric) format, and a centralized gate (`completeOnboardingWithVerifiedCustomer`, `lib/brain/commercial/native-cycle/customer-session/onboardingTransitions.ts`, backed by a new read-only `CustomerMasterProjectionReader`, `lib/domains/customer-service/customerMasterProjection.ts`) verifies the local `master_customer` projection exists before completing onboarding - never inserts/updates `master_customer` itself, never fabricates a row, never propagates a raw FK exception. When the projection is not yet available, the business outcome (`created`) is preserved unchanged, onboarding lands `temporarily_unavailable`, and the structured warning `customer_master_projection_unavailable` is persisted via the existing T07 event family. Still tested against a local HTTP double, not a real Customer Service deployment - no operational smoke test yet (`operational: not_verified` unchanged; this was an architecture/FK-safety fix, not an operational verification). See `tests/commercial/customerMasterProjectionGate.test.ts` and `tests/e2e/customerIdentityOnboarding.e2e.test.ts` for full coverage. A `temporarily_unavailable` landing is no longer a permanent dead end either: see `resolve_customer`'s row for the runtime recovery path a later inbound now takes - `create_customer` itself is never re-executed as part of that recovery (only a fresh `resolve_customer` is). ACS-R1-04-T07 added `customer_identity_capability_outcome_recorded` (`commercial_event`) distinguishing Gateway status `completed` from business outcome `conflict`/`created`/`matched_existing`/`missing_information`, plus PII-free request/response summaries in `crm_capability_executions` (never `onboarding.collected` values) |
| `update_customer` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | canonical update rules not yet approved |
| `link_external_identity` | `command` | `implemented` | `implemented` | `implemented` | `registered` | `connected` | `not_verified` | `accepted_with_debt` | ACS-R1-04-T06: registered (`mutating/autonomous/medium`, `maxRetries: 0`). Always a separate, later execution from `create_customer`, never an automatic side effect. Policy requires the linked wa_id to match the one the current inbound channel verified (never model-controlled) and explicit consent; the same consent-bypass bug found in `create_customer` was fixed here too. ACS-R1-04-T06.1 removed its sales-agent tool alias too - `runCustomerOnboardingPostPlanStage` is the sole caller now, firing only for an already-identified customer whose wa_id isn't the confirmed match yet, with explicit link consent from the current turn. ACS-R1-04-T08 exercised this end to end in a separate turn from creation (own consent, never reused) and confirmed Gateway status `completed` / business outcome `conflict` are compatible when Customer Service reports the wa_id already linked elsewhere. ACS-R1-04-T08.1: the echoed-back `customerMasterId` (renamed from `customerId`, v2.0.0) is now verified against the local `master_customer` projection and cross-checked for consistency with the customer already known locally this turn before onboarding is touched, via the same centralized gate as `create_customer` - see that row for the full detail. Tested against a local HTTP server, not a real Customer Service deployment. ACS-R1-04-T07 added the same business-outcome-vs-Gateway-status audit trail and PII-free summaries as `create_customer` |
| `record_customer_interest` | `command` | `implemented_partial` | `not_applicable` | `not_applicable` | `not_registered` | `not_connected` | `planned` | `designed_partial` | ACS-R1-04-T04.1: contract types (`RecordCustomerInterestInput`) and pure policy (`evaluateCustomerInterestAuthority`) implemented - distinguishes `operational_context` (always allowed, no customer needed), `persistent_customer_interest` (requires `customerId` + `consent.storeInterest`) and `proactive_followup` (requires a separate `consent.allowFollowUp`). No persistence, no follow-up scheduling, no customer creation as a side effect - policy/types only |

## Customer Onboarding

| Capability | Type | Domain | Port | Adapter | Gateway | Runtime | Operational | State | Debt |
| ---------- | ---- | ------ | ---- | ------- | ------- | ------- | ----------- | ----- | ---- |
| `customer_onboarding_state` | `domain_state` | `implemented` | `implemented` | `implemented` | `not_applicable` | `connected` | `not_verified` | `accepted_with_debt` | canonical multi-turn persistence for `CustomerOnboardingState` (`lib/domains/customer-onboarding`, ACS-R1-04-T03): state machine over `crm_customer_onboarding_state` (migration 023) with optimistic locking (`version`) and normalization per the contract. Not a callable tool - it is domain state, not a capability an agent invokes. Legacy `crm_customer_onboarding` (P1M) reviewed and intentionally not reused (incompatible key, status enum and privacy columns) and left untouched. ACS-R1-04-T06 connected it to the native inbound via `resolveNativeCustomerSession` and the `create_customer`/`link_external_identity` capabilities, using only its existing public transitions - no direct writes. ACS-R1-04-T06.1 added activation from the canonical planner's own structured next-action (`runCustomerOnboardingPostPlanStage`, legacy runtime only) and conservative multi-turn field extraction from the current message (name/email/order reference) - still through `collectFields` only, never a direct write. Purposes beyond `quote` (order_inquiry/complaint/warranty/return) remain unreachable from the live runtime - no structured next-action or tool signal maps to them yet. ACS-R1-04-T07 added `customer_onboarding_transition_recorded` (`commercial_event`) for every effective transition (`start`/`collect_fields`/`mark_resolving`/`complete`/`mark_conflict`/`mark_temporarily_unavailable`) - never for a no-op mutation, never persisting collected values (booleans only). ACS-R1-04-T08's end-to-end suite surfaced that `customer_id`'s FK to `master_customer.id` (migration 023) had no reconciliation with an independently-id'd external Customer Service. **ACS-R1-04-T08.1 closed this gap** with a centralized projection-verification gate before any `completeOnboarding` call sourced from Customer Service (see the `create_customer`/`resolve_customer`/`link_external_identity` rows above) - the FK itself is unchanged (never dropped, never made nullable-on-delete), no new table or migration was added, and a not-yet-projected customer now lands onboarding in `temporarily_unavailable` with a structured warning instead of throwing a raw FK violation. **ACS-R1-04-T08.1 (second increment)** wired the domain's own `retryResolution` transition (`temporarily_unavailable -> resolving`, present since ACS-R1-04-T03 but never called by any runtime path until now) into a shared `ensureResolving` helper used by both `landOnboardingInTerminalState` and `completeOnboardingWithCustomer` - a `temporarily_unavailable` row can now resume resolution on a later turn instead of being stuck forever; recorded as a new `retry_resolution` transition operation on `customer_onboarding_transition_recorded` (T07) |

## Customer 360

| Capability | Type | Domain | Port | Adapter | Gateway | Runtime | Operational | State | Debt |
| ---------- | ---- | ------ | ---- | ------- | ------- | ------- | ----------- | ----- | ---- |
| `get_customer_context` | `read_model` | `implemented` | `implemented` | `implemented` | `not_applicable` | `internal_context_only` | `connected` | `accepted_with_debt` | Customer 360 exists, full-snapshot Hub API; the autonomous cycle now consumes a separate reduced projection instead (see `autonomous_customer_context` below) |
| `get_customer_addresses` | `read_model` | `implemented` | `implemented` | `implemented` | `not_applicable` | `internal_context_only` | `connected` | `accepted_with_debt` | read model exists; operational write/confirmation flow still planned |
| `create_customer_address` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | Address Book operational capability not active yet |
| `autonomous_customer_context` | `read_model` | `implemented` | `implemented` | `not_applicable` | `not_applicable` | `connected` | `not_verified` | `accepted_with_debt` | ACS-R1-04-T05: `AutonomousCustomerContext` (`lib/brain/commercial/context/autonomousCustomerContext.ts`), an allowlisted (never denylisted), history-only projection of `Customer360Snapshot` - max 3 recent opportunities/need profiles/quotes, newest-first, no PII (no email/phone/wa_id/linked identities/addresses/order refs/invoice numbers/message bodies/provider ids/full snapshot). `loadAutonomousCustomerContext` (`loadAutonomousCustomerContext.ts`) is the single load point: `customerId` null makes zero calls, a thrown/failed load degrades to `unavailable` and never stops the cycle. Wired into both `runNativeAutonomousCycle` runtimes (multi-request and legacy, mutually exclusive as before) via typed fields on `MultiRequestCycleInput`/`PlanTurnInput`/`TurnPlannerProviderInput` and `CommercialContextSnapshot`/`SalesAgentInput` - never inside a generic `metadata` bag. Customer 360 never resolves identity, creates customers, links identities or confirms addresses. ACS-R1-04-T06 connected `customerMasterId` to the real identity resolver (`resolveNativeCustomerSession`, T02/T02.1/T04.1) and put the load itself behind an explicit access gate (`contextAccess: none/commercial_history/validated_entity`) - an identified customer alone no longer authorizes a load; it also requires an active `quote`/`purchase` onboarding with no conflict. `validated_entity` is never granted yet (no historical-entity-ownership validation). No operational smoke test yet |

## Commercial Execution

| Capability | Type | Domain | Port | Adapter | Gateway | Runtime | Operational | State | Debt |
| ---------- | ---- | ------ | ---- | ------- | ------- | ------- | ----------- | ----- | ---- |
| `prepare_quote` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | quote flow not productively wired yet; policy alignment pending |
| `business_policy` | `policy` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | policy boundary not yet productized |
| `calculate_shipping` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | carrier integration not wired |
| `create_checkout_link` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | checkout handoff not wired |
| `find_order` | `read_model` | `implemented_partial` | `partial` | `partial` | `not_registered` | `multi_request_only` | `connected` | `implemented_partial` | order projection exists, but no independent orders boundary yet |
| `get_order_status` | `read_model` | `implemented_partial` | `partial` | `partial` | `not_registered` | `multi_request_only` | `connected` | `implemented_partial` | order projection exists, but no independent orders boundary yet |
| `place_sales_call` | `channel` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | voice capability not productized |

## Notes

- `Customer 360` is represented as a read model, capability contract and evidence, not as an agent tool.
- `get_customer_context` and `get_customer_addresses` are read models, not gateway tools.
- `resolve_customer` is the active identity workstream.
- `domain_state` rows (e.g. `customer_onboarding_state`) are persisted state machines, not agent-callable tools; they have no `gateway` registration by design (`not_applicable`).
- `ACS-R1-04` is the active sequential release; `ACS-R1-05` (Autonomous Follow-up Runtime) is an authorized parallel workstream (see `ACTIVE_RELEASE.md`) that adds no new Gateway-registered capability rows here - `schedule_followup` is an internal `crm_agent_actions` action type persisted by `sales-consultative`, not an agent-callable tool. `ACS-R1-05-T02` connected `policy/evaluateCommercialPolicy.ts` as a mandatory `follow_up_dispatch_policy` gate before that internal write (opt-out/quiet-hours/identity-conflict/ai-blocked); this does not change any row above and does not mark `schedule_followup` `operational: verified`. `ACS-R1-05-T03` hardened the follow-up worker itself (`lib/brain/commercial/followup/runFollowupTick.ts`): stale-lock recovery for abandoned `executing` rows, real `max_attempts` enforcement with retry of `failed` rows, and a status-preconditioned `cancelFollowUp`; still an internal worker on `crm_agent_actions`, not a Gateway-registered capability - no row above changes and `schedule_followup` remains outside `operational: verified`.
- `multi_request_only` means the capability exists only in a non-canonical helper path.
- `accepted_with_debt` means usable and documented, but still carrying explicit debt.
- Planned rows are roadmap only; they are not productively wired just because docs exist.
