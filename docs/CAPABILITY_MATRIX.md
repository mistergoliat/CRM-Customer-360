---
title: CAPABILITY_MATRIX
doc_id: product-capability-matrix
status: active
version: "1.5.0"
owner: architecture
last_reviewed: 2026-07-09
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
| `resolve_customer` | `service` | `implemented` | `implemented` | `implemented` | `not_registered` | `not_connected` | `not_verified` | `implemented_partial` | domain-ready read-only resolver (`lib/domains/customer-identity`, ACS-R1-04-T02 + T02.1): resolves by exact `wa_id` (provider-scoped) and canonical/historical normalized phone (provider-agnostic, across `customer_external_identity`), returns `identified/identification_required/conflict/temporarily_unavailable/invalid_input`, never creates or links. `customer_addresses.recipient_phone` and `ps_customer` reviewed and intentionally not connected (delivery contact and unbridged external id-space, respectively). Not yet registered in the Gateway, not connected to the native inbound runtime, no operational smoke test |
| `get_customer` | `service` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | depends on Customer Service boundary and onboarding state |
| `create_customer` | `command` | `implemented` | `implemented` | `implemented` | `not_registered` | `not_connected` | `not_verified` | `implemented_partial` | ACS-R1-04-T04.1: `CustomerServicePort` (`lib/domains/customer-service`), pure authority policy (`evaluateCreateCustomerAuthority` - real `resolveCustomer` evidence required, no LLM-asserted booleans), fail-closed HTTP adapter (`lib/integrations/customer-service/http-adapter.ts`, contract in `docs/integrations/customer-service-http-contract.md`). ACS-generated idempotency key (`customer-service:create:<capabilityExecutionId>`), never agent-chosen. Not registered in the Gateway, not connected to the inbound runtime, no operational smoke test - see `docs/capabilities/customer-service-capability.md` |
| `update_customer` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | canonical update rules not yet approved |
| `link_external_identity` | `command` | `implemented` | `implemented` | `implemented` | `not_registered` | `not_connected` | `not_verified` | `implemented_partial` | ACS-R1-04-T04.1: same `CustomerServicePort`/adapter as `create_customer`. Policy (`evaluateLinkExternalIdentityAuthority`) requires the wa_id being linked to match the one the current inbound channel verified (never a number typed in message text), explicit consent with messageId/capturedAt, and no known conflict. Always a separate call after `create_customer`, never an automatic side effect. Not registered in the Gateway, not connected to the inbound runtime |
| `record_customer_interest` | `command` | `implemented_partial` | `not_applicable` | `not_applicable` | `not_registered` | `not_connected` | `planned` | `designed_partial` | ACS-R1-04-T04.1: contract types (`RecordCustomerInterestInput`) and pure policy (`evaluateCustomerInterestAuthority`) implemented - distinguishes `operational_context` (always allowed, no customer needed), `persistent_customer_interest` (requires `customerId` + `consent.storeInterest`) and `proactive_followup` (requires a separate `consent.allowFollowUp`). No persistence, no follow-up scheduling, no customer creation as a side effect - policy/types only |

## Customer Onboarding

| Capability | Type | Domain | Port | Adapter | Gateway | Runtime | Operational | State | Debt |
| ---------- | ---- | ------ | ---- | ------- | ------- | ------- | ----------- | ----- | ---- |
| `customer_onboarding_state` | `domain_state` | `implemented` | `implemented` | `implemented` | `not_applicable` | `not_connected` | `not_verified` | `implemented_partial` | canonical multi-turn persistence for `CustomerOnboardingState` (`lib/domains/customer-onboarding`, ACS-R1-04-T03): state machine over `crm_customer_onboarding_state` (migration 023) with optimistic locking (`version`) and normalization per the contract. Not a callable tool - it is domain state, not a capability an agent invokes. Legacy `crm_customer_onboarding` (P1M) reviewed and intentionally not reused (incompatible key, status enum and privacy columns) and left untouched. Not connected to the native inbound runtime, the LLM, the Gateway, Customer 360 or customer creation/linking (ACS-R1-04-T04 through T06); no operational smoke test yet |

## Customer 360

| Capability | Type | Domain | Port | Adapter | Gateway | Runtime | Operational | State | Debt |
| ---------- | ---- | ------ | ---- | ------- | ------- | ------- | ----------- | ----- | ---- |
| `get_customer_context` | `read_model` | `implemented` | `implemented` | `implemented` | `not_applicable` | `internal_context_only` | `connected` | `accepted_with_debt` | Customer 360 exists, full-snapshot Hub API; the autonomous cycle now consumes a separate reduced projection instead (see `autonomous_customer_context` below) |
| `get_customer_addresses` | `read_model` | `implemented` | `implemented` | `implemented` | `not_applicable` | `internal_context_only` | `connected` | `accepted_with_debt` | read model exists; operational write/confirmation flow still planned |
| `create_customer_address` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | Address Book operational capability not active yet |
| `autonomous_customer_context` | `read_model` | `implemented` | `implemented` | `not_applicable` | `not_applicable` | `connected` | `not_verified` | `implemented_partial` | ACS-R1-04-T05: `AutonomousCustomerContext` (`lib/brain/commercial/context/autonomousCustomerContext.ts`), an allowlisted (never denylisted), history-only projection of `Customer360Snapshot` - max 3 recent opportunities/need profiles/quotes, newest-first, no PII (no email/phone/wa_id/linked identities/addresses/order refs/invoice numbers/message bodies/provider ids/full snapshot). `loadAutonomousCustomerContext` (`loadAutonomousCustomerContext.ts`) is the single load point: `customerId` null makes zero calls, a thrown/failed load degrades to `unavailable` and never stops the cycle. Wired into both `runNativeAutonomousCycle` runtimes (multi-request and legacy, mutually exclusive as before) via typed fields on `MultiRequestCycleInput`/`PlanTurnInput`/`TurnPlannerProviderInput` and `CommercialContextSnapshot`/`SalesAgentInput` - never inside a generic `metadata` bag. Customer 360 never resolves identity, creates customers, links identities or confirms addresses; `customerMasterId` still comes from the pre-existing native inbound resolver, not from T02/T04.1 - that wiring is `ACS-R1-04-T06`. No operational smoke test yet |

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
- `ACS-R1-04` is the only active release increment.
- `multi_request_only` means the capability exists only in a non-canonical helper path.
- `accepted_with_debt` means usable and documented, but still carrying explicit debt.
- Planned rows are roadmap only; they are not productively wired just because docs exist.
