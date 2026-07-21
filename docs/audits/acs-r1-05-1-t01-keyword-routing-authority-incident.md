---
title: ACS-R1-05.1-T01 - Keyword-routing dual-authority incident
doc_id: audit-acs-r1-05-1-t01-keyword-routing-authority-incident
status: historical
version: "1.0.0"
owner: architecture
last_reviewed: 2026-07-21
audited_at: 2026-07-21
immutable_snapshot: true
source_of_truth_for:
  - historical record of the keyword-routing dual-write incident closed by ACS-R1-05.1-T01
depends_on:
  - ../ACTIVE_RELEASE.md
  - ../releases/ACS-R1-05.1-persistent-commercial-memory-controlled-whatsapp-pilot.md
supersedes: []
tags:
  - audit
  - historical
  - incident
---

# ACS-R1-05.1-T01 - Keyword-routing dual-authority incident

Extracted from `docs/n8n-brain-integration.md` (2026-07-21) so the incident has a single, durable home instead of living inline in an active operational document. This is the one place this incident's narrative is documented; `docs/ACTIVE_RELEASE.md`'s "Evidencia de cierre - ACS-R1-05.1-T01" section documents the fix and its verification evidence and is not duplicated here.

## What happened

Until `ACS-R1-05.1-T01`, `docs/n8n-brain-integration.md` described the `/api/brain/process-inbound` route as "shadow mode" and framed it as observational: n8n keeps running the legacy path, the Brain API response is only compared, nothing real happens from it.

That description was inaccurate. The code behind the endpoint (`processInbound`) executed the legacy `sales-consultative` engine (`runSalesConsultativeService`) with no feature flag guarding it, triggered whenever the inbound message contained commercial keywords (e.g. "precio", "stock", "cotizar") or the resolved context set `primary_service = "sales"`. That engine persists real state to `crm_opportunities`, `crm_sales_need_profiles` and `crm_agent_actions`, and can dispatch a real outbound message through the outbox. It was not a passive comparison - it was a second, undeclared commercial write authority running in parallel to the canonical path (`processNativeWhatsAppInbound -> runNativeAutonomousCycle -> operational-loop -> persistCommercialState`).

## Why it matters

This is the concrete, already-occurred instance of the anti-pattern `docs/PRODUCT_NORTH_STAR.md` names as "routing comercial por palabra clave": a keyword match silently activating a second decision/write path, undeclared and unaudited as such. It is cited from `PRODUCT_NORTH_STAR.md`'s anti-pattern list as the real precedent for why that pattern is excluded, not a hypothetical risk.

## Fix

`ACS-R1-05.1-T01` gated the legacy engine behind `BRAIN_LEGACY_SALES_CONSULTATIVE_ENABLED` (default `false`, fail-closed; sole reader `commercialCycleConfig.ts`), disabling it by default on both of its remaining productive paths (`process-inbound` and `native-whatsapp/service.ts#processSalesInbound`). Full verification evidence (architectural caller test, MariaDB E2E, replay, concurrency) lives in `docs/ACTIVE_RELEASE.md`'s "Evidencia de cierre - ACS-R1-05.1-T01" section - not repeated here.

## Standing rule

No document should describe this route, or any route with the same shape, as read-only or inert on the basis of a name like "shadow" alone. `docs/n8n-brain-integration.md` carries a short pointer to this record instead of the full narrative.
