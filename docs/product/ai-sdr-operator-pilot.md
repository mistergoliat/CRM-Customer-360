# AI SDR Operator Pilot

P1K-010 adds the first operational shell for the AI SDR inside `/cases/[id]`.
P1K-012B-UI2 moves that shell into the right-side AI SDR Copilot so the chat becomes the primary working surface.

## Purpose

The operator pilot is a read-only surface for daily sales review.

It helps an operator see:

- current commercial state,
- stage,
- summary,
- known and missing information,
- next recommended action,
- draft response,
- risk and approval requirement,
- why the recommendation exists,
- that the action is not executable.

It is not an execution surface.

P1K-011A defines the lifecycle contract behind the recommendation shown here.
Until a durable action entity exists, this surface keeps reading `next_action_json` as the canonical read-only proposal.
P1K-011B adds a dry-run follow-up planner that can suggest the next commercial follow-up without creating a durable action yet.

## View model

The UI consumes `AiSdrOperatorPilotViewModel`.

The DTO is sanitized, JSON serializable and does not expose raw runtime payloads.

## Data source

The read adapter prefers, in order:

1. `commercial_operational_result` if present on the case read model.
2. Persisted operational loop fields if the P1K-009 schema exists.
3. The P1K-008A shadow review surface as a partial fallback.
4. `not_found`, `disabled`, `waiting_for_operational_loop`, or `error`.

If no operational result exists, the case page still renders normally.

## Supported states

- `available`
- `not_found`
- `disabled`
- `waiting_for_operational_loop`
- `error`

## Controls

The pilot exposes blocked controls only:

- approve draft,
- reject,
- edit draft,
- take over case,
- request more context.

These controls are shell-only and never execute actions.

## Side effects

The shell is read-only.

It does not:

- send outbound messages,
- execute tools,
- persist approvals,
- mutate Case,
- create Lead,
- create Opportunity.

## Follow-up

P1K-011A introduces the action lifecycle contract on top of this shell.
P1K-011B introduces the dry-run follow-up planner on top of that contract.
P1K-012A introduces the durable agent action queue on top of that contract.
P1K-012B exposes that queue in a read-only operator surface inside case detail.
P1K-012B-UI2 nests the pilot, suggested reply and action queue into a lateral copilot panel while diagnostics stay collapsed.
