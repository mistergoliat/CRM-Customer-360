# Agentic CRM Data Model Audit

## Scope

This document is the working audit of the data model observed in the repository. The final persistence decision is documented in `docs/data/persistence-architecture-decision.md`.

## Current state

The repo currently mixes:

- legacy `n8n_*` tables and views for cases and messages;
- `crm_opportunities` and `crm_agent_decisions` as the durable commercial loop;
- `crm_agent_actions` as the governed queue boundary;
- `brain_message_outbox` as the controlled execution-intent queue;
- `ai_orchestrator_shadow_log` as shadow observability.

The codebase still uses MariaDB runtime access through `mysql2/promise`.

## Observed tables

| Table | Role today | Notes |
| --- | --- | --- |
| `n8n_conversation_cases` | Legacy case timeline | Operational source for case state and UI reads |
| `n8n_conversation_messages` | Legacy message timeline | High-volume conversation history |
| `n8n_wa_inbound_messages` | Legacy inbound normalization | Identity and inbound context source |
| `n8n_vw_hub_cases` | Legacy read view | UI aggregation layer |
| `crm_opportunities` | Commercial durable state | Current opportunity memory |
| `crm_agent_decisions` | Append-only decision log | Current decision history |
| `crm_agent_actions` | Governed action queue | Durable action lifecycle boundary |
| `brain_message_outbox` | Execution-intent outbox | Future worker bridge |
| `hub_audit_log` | Cross-cutting audit | Existing audit trail |
| `ai_orchestrator_shadow_log` | Shadow observability | Diagnostic, not CRM truth |

## Entity-level summary

| Entity | Current SoT | P1 direction | Notes |
| --- | --- | --- | --- |
| Case | MariaDB legacy | MariaDB legacy | Keep high-volume timeline in the legacy engine for P1 |
| Message | MariaDB legacy | MariaDB legacy | Do not migrate the full message timeline before the brain stabilizes |
| Opportunity | MariaDB current table | PostgreSQL/Supabase brain DB | Strong candidate for brain migration |
| Decision | MariaDB current table | PostgreSQL/Supabase brain DB | Append-only and transactional |
| Action | MariaDB current table | PostgreSQL/Supabase brain DB | Queue semantics benefit from Postgres locking |
| Outbox | MariaDB current table | PostgreSQL/Supabase brain DB | Claim/lock patterns fit Postgres well |
| Audit log | MariaDB legacy | MariaDB legacy for now | Cross-cutting and already integrated |
| Raw webhook | Legacy/transient | Object storage | Not hot relational data |
| Attachment | Legacy/external blob handling | Object storage | Keep binary payloads out of hot tables |
| Follow-up | Dry-run today | PostgreSQL/Supabase brain DB | Scheduler comes later |
| Customer Candidate | Provisional read projection | Read projection only | Not Customer Master yet |
| Customer Master future | Not implemented | PostgreSQL CRM identity master | Deferred |

## Key conclusion

The audit now supports the persistence ADR:

- MariaDB keeps the legacy case and message surface.
- PostgreSQL/Supabase should host the new brain domain.
- No uncontrolled dual-write for the same entity.

## Relation to the ADR

Use `docs/data/persistence-architecture-decision.md` for the canonical decision, access patterns, transaction boundaries, index strategy, and next milestone.

