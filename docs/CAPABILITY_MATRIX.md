---
title: CAPABILITY_MATRIX
doc_id: product-capability-matrix
status: active
version: "1.2.0"
owner: architecture
last_reviewed: 2026-07-08
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
supersedes: []
tags:
  - capability
  - product
  - release
---

# CAPABILITY_MATRIX

La matriz representa estado tecnico real, no intencion de roadmap.

## Leyenda

- `Type`: `tool`, `read_model`, `service`, `command`, `policy`, `channel`
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
| `resolve_customer` | `service` | `active_development` | `partial` | `partial` | `not_registered` | `not_connected` | `not_verified` | `active_development` | canonical identity contract still evolving; no automatic merge |
| `get_customer` | `service` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | depends on Customer Service boundary and onboarding state |
| `create_customer` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | no automatic customer creation per inbound |
| `update_customer` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | canonical update rules not yet approved |
| `link_external_identity` | `command` | `implemented_partial` | `partial` | `partial` | `not_registered` | `not_connected` | `not_verified` | `implemented_partial` | external identity relations exist, canonical rules still pending |

## Customer 360

| Capability | Type | Domain | Port | Adapter | Gateway | Runtime | Operational | State | Debt |
| ---------- | ---- | ------ | ---- | ------- | ------- | ------- | ----------- | ----- | ---- |
| `get_customer_context` | `read_model` | `implemented` | `implemented` | `implemented` | `not_applicable` | `internal_context_only` | `connected` | `accepted_with_debt` | Customer 360 exists, but no autonomous runtime connection is assumed |
| `get_customer_addresses` | `read_model` | `implemented` | `implemented` | `implemented` | `not_applicable` | `internal_context_only` | `connected` | `accepted_with_debt` | read model exists; operational write/confirmation flow still planned |
| `create_customer_address` | `command` | `planned` | `planned` | `planned` | `not_registered` | `not_connected` | `planned` | `planned` | Address Book operational capability not active yet |

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
- `ACS-R1-04` is the only active release increment.
- `multi_request_only` means the capability exists only in a non-canonical helper path.
- `accepted_with_debt` means usable and documented, but still carrying explicit debt.
- Planned rows are roadmap only; they are not productively wired just because docs exist.
