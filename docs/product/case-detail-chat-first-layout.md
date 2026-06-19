# Case Detail Chat-First Layout

## Purpose

`/cases/[id]` now uses a chat-first composition:

- the WhatsApp conversation is the main surface;
- the AI SDR Copilot is a persistent right panel;
- the context sidebar stays on the left;
- diagnostics are collapsed and secondary.

This layout is visual only. It does not change routing, actions, persistence or outbound behavior.

## Visual hierarchy

1. Context sidebar
2. WhatsApp chat main
3. AI SDR Copilot
4. Diagnostics drawer

The operator should work from the conversation first.

## Data flow

The layout consumes existing case detail DTOs:

- case context and legacy notes for the sidebar;
- timeline messages and reply composer for the chat;
- operator pilot, action queue and shadow review for the copilot.

If data is missing, each region degrades locally:

- `Sin dato`
- `No disponible`
- `Sin sugerencia disponible`
- `No hay acciones en cola`
- `Copilot no disponible`

## Safeguards

The layout does not:

- send WhatsApp;
- call Meta;
- execute tools;
- write DB;
- mutate Case;
- change n8n;
- persist approvals or queue actions.

## P1K-012C boundary

P1K-012C will define the whitelisted autonomous reply sandbox contract.
This layout only prepares the shell around that future boundary.
When the sandbox contract is active, the Action Queue may surface read-only eligibility details for each action, but the layout still does not execute anything.
