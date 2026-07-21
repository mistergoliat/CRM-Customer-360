---
title: AI SDR Operational Loop
doc_id: ai-sdr-operational-loop
status: historical
superseded_by: docs/releases/ACS-R1-05.1-persistent-commercial-memory-controlled-whatsapp-pilot.md
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

# AI SDR Operational Loop

> **HISTORICAL (2026-07-21).** Describe el milestone P1K-009, en el que toda accion del loop quedaba forzada a `executable: false` (dry-run puro). El loop nativo real hoy ejecuta y persiste estado comercial gobernado (`runNativeAutonomousCycle -> operational-loop -> persistCommercialState`, unica autoridad desde `ACS-R1-05.1-T01`). Ver `docs/releases/ACS-R1-05.1-persistent-commercial-memory-controlled-whatsapp-pilot.md` y `docs/ACTIVE_RELEASE.md` para el comportamiento real vigente. Conservar solo como snapshot del milestone original.

## Purpose

This document describes the durable operational loop introduced in P1K-009.

The loop does not replace the legacy inbound flow. It adds commercial memory and a governed next-action decision layer that remains read-only with respect to outbound execution.

## Flow

```text
processInbound
  -> resolveContext
  -> buildCommercialContext
  -> runSalesAgentDryRun
  -> validateSalesAgentOutput
  -> evaluateCommercialPolicy
  -> runCommercialOperationalLoop
  -> persist crm_opportunities + crm_agent_decisions when enabled
  -> legacy flow continues unchanged
```

## Durable model

Two new durable tables back the loop:

- `crm_opportunities`
- `crm_agent_decisions`

The first table stores the current governed commercial state. The second table stores immutable decision history.

### Opportunity identity

Identity is derived from explicit commercial signals, not from `Case` alone.

Primary anchors:

- `customerCandidateId`
- `wa_id`
- commercial intent
- thread / conversation context
- temporal continuity

The loop can continue an existing opportunity, create a new one, or stop on ambiguity.

### Decision log

Each decision is append-only and must remain traceable to:

- opportunity
- correlation id
- inbound run id
- sales agent run id when available
- message id when available

The decision log never stores prompts, headers, secrets, or raw model payloads.

## State reduction

The loop reduces the previous state plus current evidence into a new commercial state.

The reducer is deterministic and may update:

- status
- stage
- temperature
- priority
- known requirements
- missing requirements
- product interests
- objections
- waiting state
- summary
- timestamps

It must not infer `won`, `lost`, or automatic execution.

## Next action

The loop selects one governed next action only.

Allowed canonical actions:

- `respond`
- `ask_clarifying_question`
- `qualify`
- `recommend_products`
- `prepare_quote`
- `wait_for_customer`
- `propose_followup`
- `escalate_to_operator`
- `pause`
- `close_as_lost_candidate`
- `no_action`

All actions remain `executable: false` in P1K-009.

## Flags

Defaults are off.

- `BRAIN_COMMERCIAL_OPERATIONAL_LOOP_ENABLED=false`
- `BRAIN_COMMERCIAL_STATE_PERSISTENCE_ENABLED=false`

Behavior:

- disabled loop: no load, no write, `skipped`
- enabled, no persistence: read-only reduction, `dryRun=true`
- enabled, persistence on: transactional writes to the new tables, still no outbound

## Side effects

Allowed writes in this milestone:

- crm opportunity write
- crm decision write

Not allowed:

- outbound send
- tool execution
- follow-up scheduling
- case mutation
- lead/opportunity execution outside the new durable loop

## Fail-open / fail-closed

The operational loop fails closed internally and fails open for the legacy inbound path.

If the loop fails, `processInbound` continues unchanged.

## Limits

P1K-009 does not implement:

- WhatsApp send
- tools
- follow-up automation
- Response Policy control
- Case mutation
- Customer Master
- marketing automation

P1K-010 is the operator shell built on top of this loop foundation.
P1K-011A defines the approval/action lifecycle contract that still stays read-only.
P1K-011B adds the dry-run follow-up planning engine on top of that contract.
P1K-012A is the durable agent action queue milestone after that contract.
