---
title: AI SDR Operating Model
doc_id: product-ai-sdr-operating-model
status: historical
superseded_by: docs/PRODUCT_NORTH_STAR.md
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

# AI SDR Operating Model

## Purpose

This document defines the minimum commercial operating model for the AI SDR.

Its goal is to describe how the system:

- detects leads and opportunities,
- interprets commercial signals,
- proposes next steps,
- classifies risk,
- asks for human approval when required,
- preserves operational traceability,
- enables the Operator Copilot inside the HUB.

This is not a runtime spec, DB schema, or final UI design. It is an operating contract.

## Scope

The model covers the MVP commercial layer:

- inbound and outbound,
- WhatsApp and email as initial channels,
- governed follow-up,
- quote draft generation,
- human approval for sensitive actions,
- operational supervision from the HUB.

It does not try to solve yet:

- full marketing automation,
- voice/call automation,
- final Customer 360 UI,
- persistent Customer Master,
- multi-tenant SaaS.

## Commercial entities

### Lead

Initial commercial entry.

A Lead represents a person or contact with an interest signal, even when identity is incomplete.

### Opportunity

Commercial chance with state.

An Opportunity exists when there is enough intent, need, or context to keep a sales path active.

Opportunity/Lead domain details live in `docs/product/lead-opportunity-contract.md`.

### Customer

Central entity of the system.

Customer is the operational anchor for identity, conversations, opportunities, quotes, follow-up, and approved actions.

### Conversation

Channel interaction thread.

A Conversation groups messages, context, and detected signals.

### FollowUpPlan

Operational plan for the next contact.

It includes next step, recommended channel, urgency, reason, and owner.

### QuoteDraft

Draft commercial quote.

It is not a final quote and not a final commercial commitment.

### CommercialTask

Internal actionable task.

It can represent research, reminder, human review, or follow-up preparation.

### AgentDecision

Structured agent output.

It records what was detected, what is recommended, and what approval level is required.

### Sales Agent

Primary commercial reasoning agent for the AI SDR.

The Sales Agent analyzes context and proposes the next best commercial decision, but it does not execute tools or mutate state directly.

The detailed contract lives in `docs/product/sales-agent-contract.md`.

### OperatorReview

Human review inside the HUB.

It is used to approve, reject, edit, or force a sensitive action.

## Minimum states

### Lead / Opportunity states

- `new`
- `contacted`
- `engaged`
- `qualifying`
- `quote_pending`
- `waiting_customer`
- `followup_scheduled`
- `stalled`
- `won`
- `lost`
- `archived`

### State guidance

- `new`: first contact or just detected lead.
- `contacted`: an outbound or attempt already happened.
- `engaged`: there is a reply, exchange, or clear interest.
- `qualifying`: the system is collecting data to understand fit.
- `quote_pending`: a quote draft needs to be created or reviewed.
- `waiting_customer`: the system is waiting for a reply or missing data.
- `followup_scheduled`: there is a future follow-up plan.
- `stalled`: the lead cooled down or stopped moving.
- `won`: the commercial path resolved positively.
- `lost`: it closed without conversion or continuity.
- `archived`: outside the active operating window.

## Commercial signals

These are the minimum signals the system must detect or receive in structured form:

- `replied`
- `left_on_seen`
- `no_reply`
- `asks_price`
- `asks_stock`
- `asks_delivery`
- `asks_discount`
- `asks_quote`
- `high_intent`
- `low_intent`
- `objection_price`
- `objection_timing`
- `objection_trust`
- `human_requested`

## Agent decisions

The AI SDR can recommend or trigger the following decisions:

- `answer_now`
- `ask_clarifying_question`
- `qualify_lead`
- `recommend_products`
- `propose_followup`
- `schedule_followup`
- `create_quote_draft`
- `escalate_to_operator`
- `pause_contact`
- `mark_stalled`
- `mark_lost_candidate`

## Never automatic in MVP

These actions must not execute automatically in the MVP:

- apply a real discount,
- confirm final stock,
- confirm dispatch,
- commit a delivery date,
- issue a final quote without review,
- close a sale administratively,
- change customer master data without a human.

## Allowed with human supervision

These actions may exist, but must pass through human supervision:

- generate a quote draft,
- propose a follow-up message,
- recommend the next contact,
- summarize objections,
- propose a call,
- classify an opportunity,
- suggest upsell/cross-sell.

## Follow-up model

Follow-up should not be a hard deterministic clock.

It must be a governed model driven by signals and context:

- observe silence,
- observe seen/read,
- observe reply,
- observe objections,
- observe urgency and intent,
- propose the next best action,
- suggest WhatsApp persistence when appropriate,
- keep email as a secondary and lower-priority channel in the MVP,
- keep calls as a future, more sensitive tool.

The follow-up policy contract lives in `docs/product/follow-up-decision-policy.md`.

Operational rule:

1. The agent detects the signal.
2. The system proposes the next step.
3. Policy decides whether it can execute, needs approval, or must be blocked.
4. The operator approves or edits when risk requires it.

## Next Best Action framework

Each opportunity should be able to return a minimum object with:

- `current_state`
- `detected_signal`
- `recommended_action`
- `recommended_channel`
- `urgency`
- `confidence`
- `rationale`
- `requires_human_approval`

## Operator Copilot role

Operator Copilot is the human interface for understanding and controlling commercial operations.

It must be able to:

- explain why the agent made a decision,
- show a summarized commercial history,
- ask for recommendations,
- force or edit follow-up,
- approve or reject quote drafts,
- see risks and opportunities,
- review signals and escalation reasons.

The detailed contract lives in `docs/product/operator-copilot-contract.md`.

In the MVP, Operator Copilot consumes validated Sales Agent and Follow-up outputs, presents review items and dry-run command proposals, and never executes or approves actions by itself.

## Operational loop

P1K-009 adds a durable commercial loop that reduces previous state plus current evidence into a governed next action.

The loop:

- keeps `Customer` as the anchor;
- keeps `Case` and `Conversation` outside the commercial state model;
- stores an append-only decision log;
- persists opportunity state only when the dedicated loop is enabled;
- never executes outbound, tools, or automatic follow-up;
- fails closed internally and fails open for the legacy inbound flow.

The detailed runtime contract lives in `docs/product/ai-sdr-operational-loop.md`.

The runtime sequencing blueprint for the AI SDR MVP lives in `docs/product/ai-sdr-implementation-blueprint.md`.

## Relationship with Customer Identity

Customer Candidate can enrich the commercial context.

It must not block the AI SDR MVP.

The MVP can operate with provisional identity while persistent Customer Master is still pending.

## Relationship with n8n

n8n remains a transitional integrator.

Brain API must govern commercial decisions, and n8n can continue to host small jobs, fan-out, connectors, or simple deterministic tasks.

Critical commercial decision logic should not live inside n8n.

## MVP metrics

Minimum metrics for this stage:

- useful conversation rate,
- opportunity created rate,
- follow-up executed rate,
- quote draft approved rate,
- customer recovery rate,
- bot-supported sales,
- commercial error rate,
- handoff rate,
- conversion influence.

## P1K roadmap

Minimum sequence for the P1K block:

1. `P1K-001` AI SDR Operating Model.
2. `P1K-002` Opportunity/Lead model contract.
3. `P1K-003` Follow-up decision policy.
4. `P1K-004` Sales Agent contract.
5. `P1K-005` Operator Copilot contract.

## Design constraints

- Customer remains the center.
- Identity can remain provisional in the MVP.
- Actions sensitive to money, stock, dispatch, or customer master require approval.
- WhatsApp remains the primary sales follow-up channel.
- Email remains secondary for follow-up in the MVP.
- Voice/call stays out of MVP runtime and remains a future tool.
- The runtime path starts in shadow mode and advances only after contract validation, policy enforcement and human review gates are proven.
