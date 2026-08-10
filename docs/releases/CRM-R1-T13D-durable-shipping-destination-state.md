---
title: CRM-R1-T13D — Durable Shipping Destination State
doc_id: release-crm-r1-t13d-durable-shipping-destination-state
status: implemented_pending_real_smoke
owner: architecture
last_reviewed: 2026-08-10
source_of_truth_for:
  - shipping destination durable state contract
  - set_shipping_destination capability
  - CommercialContextSnapshot.shippingDestination
depends_on:
  - ./CRM-R1-T13C-canonical-commune-resolution.md
  - ../audits/CRM-R1-T13B-shipping-destination-commune-resolution-audit.md
  - ../PRODUCT_NORTH_STAR.md
tags:
  - release
  - shipping
  - commune
  - request-facts
---

# CRM-R1-T13D — Durable Shipping Destination State

Integrates the Canonical Commune Resolver (T13C) with the Native Agent Tool Loop: a customer-stated destination commune can now be resolved and persisted as a commercial request's/opportunity's durable, authoritative shipping destination, rehydrated on every later turn. Does not calculate shipping rate, select a carrier, or check carrier coverage — that is T13E.

## Git inicial

- Base branch: `develop`, HEAD `34a6af4` (merge of PR #86, `feat/crm-r1-t13c-canonical-commune-resolver`) — T13C was already merged into `develop`, confirmed before starting; no duplicate implementation was needed.
- Working branch: `feat/crm-r1-t13d-shipping-destination-state`.

## Arquitectura encontrada

- `crm_request_facts` (migration 017): versioned facts with lifecycle `inferred/confirmed/verified/rejected/superseded`, DB-enforced single active row per `(request_id, fact_key)` (`uq_request_fact_active`). `request_id` is a plain `VARCHAR(191)` with **no FK** — verified directly in the migration and in `lib/brain/commercial/request-facts/repository.ts`, which takes `requestId` as an opaque string.
- `lib/domains/customer-addresses/requestSelection.ts` already used this table for `delivery_address_id`, but always anchored by `crm_conversation_requests.request_id` (migration 015, `convreq-<uuid>` prefix), the multi-request runtime's own id — a runtime the Native Agent Tool Loop never populates (confirmed: `runNativeAutonomousCycle`/`runNativeAgentToolLoopCycle` never create a `crm_conversation_requests` row). This is exactly the gap the T13B audit (section 14) already documented: "bien construido, inalcanzable" from the canonical runtime.
- `CommercialContextSnapshot` (`lib/brain/commercial/context/buildNativeCommercialContext.ts`) already carries `opportunity: SalesConsultativeOpportunity | null` with a real numeric `id` (`crm_opportunities.id`), and `CapabilityGatewayContext` (`lib/brain/commercial/capability-gateway/types.ts`) already carries `opportunityId` end to end from `runNativeAgentToolLoopCycle.ts` into every governed capability's `execute()`.
- Native Agent Tool Loop: a fixed pool (`AGENT_LOOP_TOOL_POOL`, `runAgentToolLoop.ts`) of Capability Gateway-registered tools, each with a canonical `inputSchema` read by `buildToolDescriptions()`/rendered verbatim in the prompt (`buildAgentStepPromptPackage.ts`). `buildToolObservation.ts` projects each capability's raw result into a small, bounded `ToolObservation` per tool. `executeGovernedCapability` (`executeCapability.ts`) is the single entry point: availability check → execute → audit row in `crm_capability_executions` — never bypassable by the agent.

## Decisiones tomadas

- **Anchor**: `opportunity:<opportunityId>` (`lib/domains/shipping-destination/constants.ts#buildShippingDestinationRequestAnchor`) — never `crm_conversation_requests.request_id`. Deliberately namespaced apart from that runtime's own `convreq-` prefix so the two id spaces can never collide, and available directly from `CapabilityGatewayContext.opportunityId` without any new plumbing. No new table, no new migration — reuses `crm_request_facts` exactly as it already exists.
- **Fact key**: `shipping_destination` (task's preferred name, section 6) — never overloads `delivery_address_id`.
- **Value shape** (`ShippingDestinationFactValue`): `{ inputText, communeId, canonicalName, matchedVia, source: "conversation" }`. No `weightKg`, no carrier code, no rate, no full address, no LLM reasoning, no fuzzy score — `communeId` is the only identity T13E needs.
- **Candidate/resolved/confirmed**: an explicit, unambiguous resolution (`CommuneResolver` status `"resolved"`) is persisted `status: "confirmed"` directly — no redundant second confirmation, since `resolveCommune` already fails closed to `needs_clarification` for anything ambiguous (Santiago, a region, a multi-catalog-match). `needs_clarification`/`not_found`/resolver or persistence failures never persist anything.
- **Stored-address policy**: this task adds **no** automatic derivation from `customer_addresses`/`delivery_address_id` into `shipping_destination` at all — `setShippingDestinationForOpportunity`'s only dependency is a `CommuneResolver`, so a stored address can never silently become an authoritative destination through this path. Left as a future, explicitly-confirmed derivation (T13D section 9/20 leave this optional, not mandatory).
- **Supersede semantics**: reuses `upsertRequestFact`'s existing transaction unmodified (supersede + insert, one statement pair, DB-enforced uniqueness) — a different destination supersedes the prior fact; a repeated identical destination is idempotent (no new version, `changed: false`).
- **Downstream invalidation**: no new quote/invalidation table. The superseded fact's `factId`/`supersededAt` is the signal a future shipping quote (T13E) can check against to know it was computed against a now-stale destination — documented here as the contract, not implemented as code (task section 13 explicitly forbids inventing a quote table just to have something to invalidate).

## Implementación

- `lib/domains/shipping-destination/` (new domain, mirrors `lib/domains/customer-addresses/`): `constants.ts`, `types.ts`, `service.ts` (`setShippingDestinationForOpportunity`, `getActiveShippingDestinationForOpportunity`), `index.ts`.
- `lib/brain/commercial/capability-gateway/shippingDestinationCapability.ts` (new): `set_shipping_destination`, `governance: {sideEffect: "mutating", authority: "autonomous", riskClass: "low"}`, `inputSchema: {destination: string}` (`additionalProperties: false` — no `communeId` property exists). Registered in `registry.ts`. Denies with `no_active_opportunity` when `context.opportunityId` is absent — never invents an anchor.
- `lib/brain/commercial/agent-loop/runAgentToolLoop.ts`: `set_shipping_destination` added to `AGENT_LOOP_TOOL_POOL` (six tools total, none removed).
- `lib/brain/commercial/agent-loop/buildToolObservation.ts`: `set_shipping_destination`'s already-small `data` (status/destination/input/reason) passed through unchanged to the model.
- `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts`: `SHIPPING_DESTINATION_RULE_LINES` — use the tool only with raw destination text, never re-confirm a `"resolved"` result, ask for clarification on `needs_clarification`, never claim a full address from a commune alone.
- `lib/brain/commercial/context/buildNativeCommercialContext.ts`: `CommercialContextSnapshot.shippingDestination` — rehydrated from `crm_request_facts` via `getActiveShippingDestinationForOpportunity` whenever `opportunity.id` is a number (injectable `loadShippingDestination` for tests); `null` whenever no opportunity exists yet.
- `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts`: `commercialContextSummary.shippingDestination` (communeId/canonicalName only) exposed to the prompt so the agent reuses an already-confirmed destination instead of re-asking.
- `docs/CAPABILITY_MATRIX.md`: new `## Shipping` section, `set_shipping_destination` row.

## Integración T13C

`setShippingDestinationForOpportunity` takes a `CommuneResolver` (T13C's own contract, `lib/domains/commune-resolution`) as its only external dependency — `communeId`/`canonicalName` always come from `resolution.communeId`/`resolution.canonicalName` after a `"resolved"` status, never fabricated or taken from the agent's raw arguments. Verified by test (`tests/commercial/shippingDestinationCapability.test.ts`, "a communeId supplied in the raw arguments is never trusted"): calling the capability with `{destination: "Ñuñoa", communeId: 999999}` still persists `communeId: 99` (the real catalog id), proving the extra field is silently ignored, not consulted.

## Preparación T13E

After this task, `CommercialContextSnapshot.shippingDestination.communeId` is durable, rehydrated state available on every turn. T13E can combine it with Catalog Service `weightKg` per line item (already available via `get_product_details`/`batch_get_products`) without T13D having read or duplicated any product weight — the domain boundary (`shippingDestination` = where, Catalog Service = what/how much) is intact by construction: `lib/domains/shipping-destination/` has zero import of anything catalog-related.

## Tests

24 new tests, all green, against real MariaDB (`main_management`, same pattern as `tests/commercial/requestFacts.test.ts`):

- `tests/domains/shippingDestination.test.ts` (13): explicit resolved (normalized text), alias resolution, ambiguous (Santiago) fails closed, region-level (Arica y Parinacota) fails closed, destination change supersedes, repeated destination is idempotent, persistence failure never returns false success, resolver technical failure fails closed, rehydration across independent reads, not_found never persists, empty input is invalid, exactly one active fact enforced by the DB after multiple changes, no stored-address derivation exists in this path.
- `tests/commercial/shippingDestinationCapability.test.ts` (9): registered with its schema in the tool pool, resolved persists and returns `completed`, a raw `communeId` argument is never trusted, `needs_clarification`/`not_found` never persist, empty destination rejected before touching the resolver, no active opportunity is denied, resolver technical failure is `temporarily_blocked`/retryable, `ToolObservation` projection passes the outcome through unchanged.
- `tests/commercial/buildNativeCommercialContext.test.ts` (+2): `loadShippingDestination` is called with the real opportunity id and its result is rehydrated into the snapshot; the loader is never called when no opportunity exists yet.
- 2 pre-existing tests updated (not regressions, expected per the same pattern T02.6/T10B8C already established when they extended the pool): `tests/agent-loop/runAgentToolLoop.test.ts` and `tests/agent-loop/recommendCatalogProductsToolExposure.test.ts` asserted an exact tool-pool count/membership list — updated to include `set_shipping_destination` (six tools now, nothing prior removed).

## Validaciones

- `npx tsc --noEmit`: limpio.
- `npm run lint`: 0 errors (34 warnings preexistentes, ninguno en archivos de esta tarea — mismo conteo que documentó T13C).
- `npm run build`: limpio.
- `npm test`: 2754 tests, 2723 pass / 31 fail. Comparado explícitamente contra el baseline limpio (`git stash` sobre `develop@34a6af4`, mismos tres archivos representativos corridos directamente): los 31 fallos son el mismo cluster preexistente ya documentado (outbox worker/pilot-isolation `T06.1`, e2e de onboarding `T08-A6`/`T08-A7`, concurrencia de `sales-agent-configuration` `A13`/`R17`/`P25`, drift de checksum de migración — ninguno toca `lib/domains/shipping-destination`, `lib/domains/commune-resolution`, `lib/integrations/logistics`, `shippingDestinationCapability.ts`, ni ninguno de los archivos de runtime modificados por esta tarea). Confirmado ejecutando `tests/commercial/createCustomerCapability.test.ts`, `tests/commercial/customerSession.test.ts` y `tests/native/outbox-pilot-isolation.test.ts` directamente contra el árbol limpio vía `git stash` — fallan idénticamente.

## Scope check

Confirmado, sin excepciones:

- Sin shipping rate/tarifa.
- Sin selección de carrier ni cobertura (`carrier_comunas`) en runtime.
- Sin sumar `weightKg` ni leer Catalog Service.
- Sin cambios en Catalog Service.
- Sin cambios en `pc_pos` (solo lectura vía el `CommuneResolver` ya existente de T13C).
- Sin fuzzy matching (reutiliza T13C tal cual).
- Sin migración de `ps_address`, sin tabla nueva, sin migración nueva.
- Sin checkout ni totales de propuesta.

## Git final

- Branch: `feat/crm-r1-t13d-shipping-destination-state`.
- No merge a `develop`, sin push (por instrucción del brief).
