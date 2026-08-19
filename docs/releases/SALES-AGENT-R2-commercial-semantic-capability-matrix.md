---
doc_id: release-sales-agent-r2-semantic-capability-matrix
title: SALES-AGENT-R2 - Commercial Semantic Capability Matrix
status: active
last_reviewed: 2026-08-19
source_of_truth_for:
  - R2 CommercialWork semantic coverage per customer-intent family
depends_on:
  - ./SALES-AGENT-R2-A08.6-semantic-completeness-integration-closure.md
tags:
  - release
  - sales-agent
  - commercial-work
---

# SALES-AGENT-R2: Commercial Semantic Capability Matrix

Built during A08.6 closure (2026-08-19) from the offline semantic-completeness suite
(`tests/commercial/commercialWorkSemanticCompleteness.test.ts`, 15/15) plus a live-DeepSeek
benchmark (`scripts/live-r2-semantic-variants-benchmark.ts`) run at full scale (21 quantity
samples, 18 cancellation samples, 10 CREATE_QUOTE samples) and the live C09 regression
(`scripts/live-c09-benchmark.ts`). No unsupported feature is marked supported here - a gap
found live stays a gap until re-verified.

| Family | Customer intent | Example utterances | Planner support | Adapter support | CommercialWork support | Executor support | Status | Known limitation |
|---|---|---|---|---|---|---|---|---|
| Product search | Find/search a product | "tienen barras olimpicas?", "busco una barra de 20kg" | Supported | Supported | N/A (pre-CommercialWork, feeds RecentCatalogContext) | Supported (`search_products`) | Supported | — |
| Product selection | Select a specific product/quantity | "quiero 2 Classic" | Supported | Supported | `SELECT_PRODUCTS` objective | Supported | Supported | Requires prior product evidence (RecentCatalogContext) or blocks with clarification - by design, see product-evidence guard row |
| Quantity correction | Change quantity on an existing selection | "mejor 3", "que sean 3", "cambialo a 3", "deja 3", "solo 3", "mejor dame 4", "ponme 2" | Supported | Supported | Supersedes `SELECT_PRODUCTS` | Supported | **Supported - live-validated 21/21 (100%), wrong-product mutation 0%** | None found |
| Destination | Provide a shipping destination | "despacho a Nunoa" | Supported | Supported | `SET_DESTINATION` objective | Supported | Supported | — |
| Destination correction | Change a previously set destination | "mejor a Las Condes" | Supported | Supported | Supersedes `SET_DESTINATION` | Supported | Supported (offline-verified, real entry point, deterministic stale-turn race test) | Not live-DeepSeek-validated this session (offline only) |
| Shipping quote | Ask for shipping cost/ETA | "cuanto sale el despacho" | Supported | Supported | `GET_SHIPPING_QUOTE` / `CALCULATE_SHIPPING` step | Supported | Supported | Production depends on real Carrier MS; this session used fixture-only Carrier |
| Create quote | Request a formal quote | "hazme una cotizacion", "cotizame esto", "quiero una cotizacion", "mandame una cotizacion", "preparame la cotizacion" | **Supported - live-validated 10/10 (100%) objective reached, 0% duplicate-on-retry** | Exists (SALES-AGENT-R1-T3 wired `create_quote` to a real Quote Service HTTP adapter) | `CREATE_QUOTE` objective | Supported (offline-verified, Part 4/20) | **Partial** | Actual external Quote Service execution / durable quote evidence NOT verifiable in this environment - no `QUOTE_SERVICE_BASE_URL` configured. Semantic layer is proven; end-to-end real quote creation is not |
| Cancel shipping (scoped) | Drop shipping only, keep product | "no necesito despacho", "olvida el despacho" | **NOT reliably supported - live-validated 0/8 (0%) correct scope** | N/A | Executor CAN scope a shipping-only cancel (offline-proven, Part 3) when the planner explicitly signals it | Supported when signaled | **Partial - planner gap** | The planner never emits a scoped cancel from this phrasing; every sample collapsed to whole-work cancellation. Blocking gap for A08.6 closure per the live cancellation target (>=95% correct scope) |
| Cancel quote (scoped) | Drop the quote only, keep the rest | "no quiero cotizacion", "mejor no cotices" | **NOT reliably supported - live-validated 0/4 (0%) correct scope** | N/A | Same executor capability, same planner gap | Supported when signaled | **Partial - planner gap** | Same root cause as cancel-shipping row |
| Cancel current objective (targeted, non-shipping/quote) | Drop one specific in-flight objective by name | (not independently sampled - blurs into the shipping/quote scoped-cancel rows above) | Unverified | N/A | Unverified | Unverified | **Unverified** | Same underlying planner gap likely applies; not independently live-tested this session |
| Cancel whole work | Drop everything on this work | "olvidalo", "olvidalo todo", "dejalo", "no importa", "cancela eso" | Supported | Supported | Cancels every active objective | Supported | **Supported - live-validated 10/10 (100%)** | None found |
| Handoff | Hand off to a human operator | (existing fixture coverage: `humanHandoffFixture`) | Supported (offline test coverage) | Supported | N/A / escalation path | Supported | Supported (not live-DeepSeek-validated this session) | Out of this session's live-validation scope |
| Confirmation / yes | Bare confirmation tied to the prior agent turn | "dale", "si" | Supported (offline test coverage, Part 5) | Supported | Maps to the objective the last agent message asked about (e.g. `CREATE_QUOTE`) | Supported | Supported (not live-DeepSeek-validated this session) | Out of this session's live-validation scope |
| Unresolved / ambiguous product reference | Free text with no or ambiguous catalog evidence | (arbitrary text, no search evidence) | Supported - fails closed to clarification, never a blind mutation | Supported | `WAITING_CUSTOMER`, no objective completes | N/A (never reaches execution) | Supported | Indirectly reinforced by the 0% wrong-product-mutation rate across all 21 live quantity-correction samples |

## Reading this table

- "Live-validated" means real DeepSeek calls through `runCommercialWorkInboundCycle` (the actual R2 production entry point), fixture-only Catalog/Carrier/Quote services, real `crm_test` DB. Sample sizes and exact counts are in `SALES-AGENT-R2-A08.6-semantic-completeness-integration-closure.md`.
- "Offline-verified" means the deterministic scripted-provider suite only (`commercialWorkSemanticCompleteness.test.ts`) - real CommercialWork pipeline, but a scripted plan rather than a real model call.
- A row marked **Partial** or **Unverified** is not eligible to be called "supported" in any summary that references this matrix.
