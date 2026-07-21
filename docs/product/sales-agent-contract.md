---
title: Sales Agent Contract
doc_id: product-sales-agent-contract
status: active
version: "1.1.0"
owner: product
last_reviewed: 2026-07-21
source_of_truth_for:
  - Sales Agent input/output contract
  - Sales Agent decision model
  - evidence rule for sensitive claims
depends_on:
  - ../PRODUCT_NORTH_STAR.md
  - ../architecture/adr/ADR-001-commercial-vs-ai-decisions.md
  - ../architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md
supersedes: []
tags:
  - product
  - contract
---

# Sales Agent Contract

## Purpose

Este documento define el contrato documental y TypeScript del Sales Agent para el MVP.

El Sales Agent es un agente especializado en interpretar señales, intención, contexto y evidencia comercial para proponer la mejor siguiente decisión sobre una Lead u Opportunity.

No implementa runtime, prompt productivo, proveedor LLM, endpoints ni tools ejecutadas.

## Responsibility

El Sales Agent:

- analiza contexto comercial,
- clasifica señales e intención,
- recomienda la mejor siguiente acción,
- responde preguntas comerciales cuando existe evidencia,
- propone acciones al backend,
- solicita herramientas o capacidades,
- propone actualización comercial,
- explica su decisión.

## Limits

El Sales Agent no:

- ejecuta herramientas directamente,
- escribe entidades,
- envía mensajes,
- crea cotizaciones finales,
- promete stock, descuentos, despacho o entrega,
- marca `won` o `lost` sin evidencia y autorización,
- sustituye Action Governance,
- sustituye Follow-up Policy,
- sustituye Operator Copilot.

## Input contract

`SalesAgentInput` debe permitir:

- `runId`
- `currentTime`
- `timezone`
- `lead` opcional
- `opportunity` opcional
- `customerCandidate` opcional
- `conversationContext`
- `recentMessages`
- `commercialSignals`
- `unresolvedObjections`
- `knownRequirements`
- `knownProductInterests`
- `knowledgeContext` opcional
- `availableCapabilities`
- `policyContext`
- `requestedMode`
- `metadata` segura

## Output contract

`SalesAgentResult` debe devolver:

- `analysis`
- `decision`
- `responseProposal` opcional
- `toolRequests`
- `proposedActions`
- `entityProposals`
- `followUpEvaluation` opcional
- `policyAssessment`
- `rationale`
- `evidence`
- `warnings`
- `metadata`

## Decision model

### SalesAgentDecisionType

- `answer_customer`
- `ask_clarifying_question`
- `qualify_lead`
- `advance_opportunity`
- `recommend_products`
- `request_product_lookup`
- `request_price_lookup`
- `request_stock_lookup`
- `request_order_lookup`
- `request_quote_draft`
- `propose_followup_evaluation`
- `propose_internal_task`
- `propose_operator_review`
- `propose_handoff`
- `wait_for_customer`
- `pause_commercial_contact`
- `recommend_stalled`
- `recommend_lost`
- `no_commercial_action`
- `insufficient_context`
- `blocked_by_policy`

### SalesAgentOutcome

- `response_proposed`
- `action_proposed`
- `tool_required`
- `human_review_required`
- `waiting_for_customer`
- `no_action`
- `blocked`
- `failed_safe`

## Actions and tools

The Sales Agent can request, but not execute, the following actions:

- draft a customer reply,
- query knowledge,
- query products,
- query price,
- query stock,
- query order,
- create a quote draft,
- evaluate follow-up,
- create an internal task,
- request operator review,
- request handoff,
- propose lead update,
- propose opportunity update,
- record a commercial signal.

Requested tools are capabilities the backend may authorize, not a guarantee of implementation.

## Evidence rule

The Sales Agent must not assert as fact:

- price,
- stock,
- discount,
- dispatch,
- delivery,
- specific warranty,
- order status,
- service availability,

without evidence from an authorized source or tool.

Claims that are sensitive must carry evidence and approval requirements.

## Analysis model

`SalesAgentAnalysis` should express:

- detected intent,
- detected signals,
- qualification state,
- missing information,
- product fit assessment,
- opportunity assessment,
- objection assessment,
- customer readiness,
- evidence summary,
- risks,
- assumptions,
- confidence.

The analysis explains, it does not mutate.

## Response proposal

`SalesAgentResponseProposal` can propose a draft only when evidence and policy allow it.

It may be empty in analyze or recommend-next-action modes.

## Governance

Automatable conceptually in the MVP, subject to policy:

- respond with verified information,
- ask for missing data,
- qualify the need,
- record signals,
- recommend product search,
- propose the next best action.

Requires operator review or approval:

- quote draft,
- discounts,
- sensitive confirmations,
- multiple follow-up attempts,
- commercially relevant handoff,
- call recommendation,
- high-impact opportunity changes.

Blocked:

- inventing price or stock,
- promising dispatch or delivery,
- applying discount,
- marking sale won without evidence,
- making identity merge decisions,
- contacting with opt-out,
- executing a call,
- sending a final quote without approval.

## Relationship with Follow-up Policy

The Sales Agent may return `propose_followup_evaluation` and `shouldEvaluateFollowUp = true`.

It must not choose the final follow-up window or ignore suppressions.

The Follow-up Policy produces `FollowUpDecisionResult`.

## Relationship with Knowledge Agent

The Sales Agent may consume already retrieved knowledge or request `knowledge_search`.

It must not duplicate Knowledge Agent behavior internally.

## Relationship with Quote Draft

The Sales Agent may request `create_quote_draft`.

It must not issue a final quote without a Quote Agent/Builder and human review.

## Relationship with Operator Copilot

The Sales Agent produces structured decisions and rationale.

Operator Copilot explains, summarizes, compares options and allows review.

It does not replace the structured commercial decision.

## Errors and safe degradation

Conceptual error states:

- `insufficient_context`
- `tool_unavailable`
- `evidence_missing`
- `policy_blocked`
- `identity_conflict`
- `invalid_contract`
- `agent_failure`
- `timeout`
- `unknown_error`

On error:

- do not invent information,
- do not emit sensitive claims,
- return `failed_safe` or `human_review_required`,
- preserve warnings,
- propose an operator when appropriate.

## Invariants

- There must be a relevant Lead, Opportunity or commercial conversation.
- Every decision includes confidence.
- Every proposed action passes through governance.
- No tool executes inside the contract.
- No proposal equals mutation.
- `shouldRespondNow` does not mean message sent.
- `shouldRequestTool` does not mean tool executed.
- `customerCandidate` does not mean Customer Master.
- Terminal Opportunity states limit commercial decisions.
- Recent customer reply has precedence over pending follow-up.
- Sensitive claims require evidence.
- Calls require explicit approval.
- `won` and `lost` do not change automatically.
- One conversation can feed multiple opportunities.
- One opportunity can continue across multiple channels.

## Out of scope

- runtime of the agent,
- final prompt,
- model selection,
- tool execution,
- persistence,
- Commercial State Manager,
- real Quote Agent,
- Follow-up Engine runtime,
- Operator Copilot runtime,
- UI,
- scheduler,
- outbound execution,
- campaigns,
- calls,
- Customer Master,
- multi-tenancy,
- ML scoring,
- training or fine-tuning.

## TypeScript contract

The contract lives in:

- `lib/brain/commercial/salesAgentTypes.ts`
- `lib/brain/commercial/salesAgentConstants.ts`
- `lib/brain/commercial/index.ts`
