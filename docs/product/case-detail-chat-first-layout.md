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

## Sandbox eligibility boundary

The whitelisted autonomous reply sandbox contract (see `docs/audits/` and `docs/ACTIVE_RELEASE.md` for its current, superseded status) governs autonomous eligibility. This layout only prepares the shell around that boundary: the Action Queue may surface read-only eligibility details for each action, but the layout itself does not execute anything.
