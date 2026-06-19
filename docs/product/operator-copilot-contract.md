# Operator Copilot Contract

## Purpose

Operator Copilot is the human-facing cognitive layer for the HUB.

It helps the operator:

- understand commercial state,
- inspect evidence and policy,
- review Sales Agent and Follow-up outputs,
- compare options,
- diagnose blocks,
- prepare governed commands,
- see pending approvals and risks.

It is not an execution engine and it is not an approval engine.

## P1K-010 shell

P1K-010 adds a compact operator shell inside case detail for the AI SDR loop.

The shell:

- shows the next governed action in read-only form,
- shows known and missing information,
- keeps operator controls blocked by design,
- does not persist approvals,
- does not execute tools or outbound,
- does not mutate Case or Opportunity.

P1K-011A defines the action lifecycle contract behind that shell.
The shell continues to consume `next_action_json` as a read-only recommendation surface until a durable action entity is justified and available.
P1K-011B adds a dry-run follow-up planner on top of that read-only recommendation surface, but it still does not persist or execute anything.
P1K-012A introduces `crm_agent_actions` as the durable action queue boundary, and P1K-012B exposes it in a read-only queue surface. The copilot still treats it as reviewable and non-executable until the execution gate exists.

## What it is

Operator Copilot is a structured assistant for supervision and control.

It can:

- explain decisions,
- summarize customers, leads, opportunities and agent runs,
- recommend next actions,
- prepare dry-run command proposals,
- present review items,
- show freshness, evidence and policy references,
- support operator review and editing.

## What it is not

Operator Copilot does not:

- execute tools directly,
- mutate Lead, Opportunity, Customer or audit state,
- approve its own proposals,
- bypass governance,
- merge identities,
- send WhatsApp, email or calls,
- promise price, stock, delivery or discounts,
- expose prompts, secrets or chain-of-thought,
- present Customer Candidate as a final Customer Master.

## Contract surface

The contract is defined in:

- `lib/brain/commercial/operatorCopilotTypes.ts`
- `lib/brain/commercial/operatorCopilotConstants.ts`

The runtime is out of scope for this stage.

## Modes

The copilot runs in one of these modes:

- `explain_decision`
- `summarize_customer`
- `summarize_lead`
- `summarize_opportunity`
- `recommend_next_action`
- `inspect_evidence`
- `inspect_policy`
- `inspect_agent_run`
- `review_pending_actions`
- `compare_options`
- `diagnose_block`
- `prepare_command`
- `answer_operator_question`

## Inputs

The input contract carries:

- operator identity and role,
- scope and requested fields,
- visible, authorized context only,
- Sales Agent result when available,
- Follow-up decision result when available,
- pending review items,
- available command types,
- policy context,
- time and timezone,
- safe metadata.

The input must never assume unrestricted access.

## Outputs

The result contract carries:

- outcome,
- explanation,
- summary,
- recommendations,
- options,
- review items,
- proposed commands,
- warnings,
- rationale,
- audit references,
- metadata.

## Explanations

Explanations must be operational and short.

They should answer:

- what happened,
- why it matters,
- what evidence supports it,
- what blocks it,
- what is missing,
- what the operator can do next.

They must not expose private reasoning traces.

## Recommendations

Recommendations should:

- propose a next action,
- state expected benefit,
- list risks and alternatives,
- show whether approval is required,
- link to the related entities.

They are recommendations, not actions.

## Review items

Review items represent pending human review over a proposed action or decision.

The status of a review item can be:

- `pending`
- `under_review`
- `approved`
- `rejected`
- `changes_requested`
- `deferred`
- `expired`
- `cancelled`

`approved` and `rejected` are future human outcomes, not autonomous Copilot decisions.

## Command proposals

Command proposals are structured drafts only.

Every command proposal must:

- start with `dryRun = true`,
- go through governance externally,
- declare the required permission,
- carry evidence and risk,
- carry policy tags,
- remain non-executing in this stage.

## Observability

The copilot may surface:

- agent run references,
- duration,
- model name when authorized,
- token counts when authorized,
- estimated cost when authorized,
- sanitized output markers,
- freshness data,
- warnings and error codes.

## Audit

The copilot can reference audit events, but it cannot edit or delete them.

Audit references must be immutable from the Copilot perspective and only expose what the operator can see.

## Data protection

The copilot must not expose:

- credentials,
- auth headers,
- raw tokens,
- raw payloads that are not needed,
- PII outside the authorized scope,
- internal prompts,
- chain-of-thought,
- unrestricted evidence.

Messages and evidence should be sanitized whenever possible.

## Hard blocks

Some capabilities are structurally blocked and cannot be lifted by the copilot.

The hard-blocked capability list is modeled separately from `OperatorCopilotCommandType` because these items are not valid commands in the MVP:

- send message directly,
- execute phone call,
- merge customer identity,
- modify customer master identity,
- apply discount,
- confirm unverified stock,
- commit delivery date,
- commit dispatch date,
- issue final quote,
- mark won without evidence,
- bypass governance,
- alter audit log,
- delete evidence.

These remain governance-level prohibitions.

## Safety and degradation

If context is insufficient, stale or unauthorized, the copilot must degrade safely:

- `insufficient_context`,
- `access_restricted`,
- `blocked`,
- `failed_safe`.

Safe degradation means:

- do not invent evidence,
- do not invent commands,
- do not filter around policy,
- do not overstate certainty,
- show what is missing.

## Relationship with Sales Agent

The copilot consumes validated Sales Agent output.

It explains the result, but does not replace it and does not create a parallel commercial decision.

## Relationship with Follow-up Policy

The copilot can inspect a follow-up evaluation and explain it.

It does not change windows, suppressions or plan status by itself.

## Relationship with Action Governance

All command proposals must pass through governance outside the copilot.

The copilot cannot override hard blocks or approval requirements.

P1K-011A clarifies the boundary between a proposed next action, a human review draft and any future executable command. The copilot may present the lifecycle, but it does not persist approvals or execute commands.
P1K-011B keeps follow-up planning in dry-run only, so the copilot can explain a plan without turning it into a durable action yet.
P1K-012A adds the durable queue that can later hold approved, blocked or scheduled actions, but the copilot still cannot execute them.
P1K-012B-UI2 places the copilot in a right-side case detail panel, with chat as the main surface and diagnostics collapsed below the operational cards.
P1K-012C adds a sandbox-only autonomy preview for whitelisted test identities. The copilot may show the eligibility result, but it still cannot execute the reply or treat the whitelist as permanent production logic.

## Relationship with Agent Runtime

The copilot may inspect run references, but it does not reveal hidden prompts or internal reasoning traces.

## Invariants

- The copilot does not execute.
- The copilot does not approve.
- The copilot does not mutate.
- Every command is a dry-run proposal in this stage.
- Every explanation must be grounded in evidence.
- Every risk must be surfaced.
- Scope must be respected.
- Customer Candidate is not Customer Master.
- Recommendations are not actions.
- Sales Agent decisions are not execution.
- Human approval remains external and auditable.

## Out of scope

- runtime,
- prompts,
- UI,
- streaming,
- persistence,
- RBAC runtime,
- endpoints,
- command execution,
- approval workflow runtime,
- persistent audit storage,
- live metrics,
- live costs,
- Customer Master,
- voice,
- campaigns,
- multi-tenancy.
