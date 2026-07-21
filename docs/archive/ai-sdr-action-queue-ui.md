---
title: AI SDR Action Queue UI
doc_id: product-ai-sdr-action-queue-ui
status: historical
superseded_by: docs/product/ai-sdr-agent-action-queue.md
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

# AI SDR Action Queue UI

## Purpose

This surface shows the durable agent action queue in `/cases/[id]` as a read-only operational preview.
In the chat-first case layout, it lives inside the right-side AI SDR Copilot instead of competing with the conversation.

It is for inspection only. It does not approve, edit, cancel, schedule, send, or execute anything.

## Data sources

The view model prefers, in order:

1. persisted rows from `crm_agent_actions` when the table exists and is readable;
2. preview from `next_action_json` when no persisted queue rows are available;
3. preview from the follow-up planner when enough case context exists;
4. empty, unavailable, or error states when no safe data source exists.

## Degradation

The panel must not break `/cases/[id]`.

If `crm_agent_actions` does not exist, the panel can fall back to preview sources.

If reading the table fails because of permissions, the panel shows a sanitized error state and stays read-only.

If no queue data exists, the panel shows an explicit empty state.

## Persisted vs preview

Persisted rows are durable queue entries already stored in `crm_agent_actions`.

Preview items are derived from the validated operational result or the follow-up planner and are never durable in this milestone.

Every item keeps `executable = false`.

## Controls

The operator controls are visible but disabled:

- Approbar
- Editar
- Cancelar
- Enviar
- Programar

They exist only to show the future shell. They do not call APIs and do not mutate state.

## Relation to future milestones

P1K-012B is the read-only surface only.
P1K-012B-UI2 reshapes the case detail into a chat-first layout and keeps the queue inside the AI SDR Copilot panel.

P1K-012C will define the whitelisted autonomous reply sandbox contract.
That future milestone will still require a separate execution gate before any outbound action can happen.
The UI may surface read-only sandbox eligibility for each action, including masked recipient and whitelist match state, but it still does not execute.

## Criteria for P1K-012C

Move to P1K-012C only after:

- the queue surface is stable;
- the durable queue can be read safely;
- approval lifecycle contracts are complete;
- the execution boundary is explicitly defined;
- no write path is accidentally exposed through the UI.
