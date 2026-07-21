---
title: Persistence architecture decision
doc_id: data-persistence-architecture-decision
status: superseded
superseded_by: docs/CAPABILITY_MATRIX.md
version: "2.0.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on:
  - product/autonomous-commerce-prd
supersedes: []
tags:
  - data-contract
  - historical
---
# Persistence Architecture Decision

> **SUPERSEDED (2026-07-21).** La decision descrita en este documento (Opcion B: PostgreSQL/Supabase como destino del dominio "brain" - opportunities/decisions/actions/outbox) nunca se ejecuto. Toda la evidencia real de las releases ACS (`ACS-R1-04`, `ACS-R1-05`, `ACS-R1-05.1`) confirma que `crm_opportunities`, `crm_agent_decisions`, `crm_agent_actions` y `brain_message_outbox` corren sobre **MariaDB real** (`crm_test`, `main_management`, contenedor `mariadb:11.4`), sin excepcion, en decenas de tests E2E citados en `docs/ACTIVE_RELEASE.md`. No existe adapter, migracion ni evidencia de PostgreSQL/Supabase en ningun cierre de tarea ACS. `docs/CAPABILITY_MATRIX.md` es la fuente de verdad del estado tecnico real de persistencia. Este documento se conserva como registro del analisis y de por que la Opcion B no se ejecuto (nunca fue necesaria: MariaDB probo sostener los patrones de idempotencia, claim/lock y append-only que motivaban la comparacion). **No usar como referencia para decisiones de persistencia nuevas** ni como evidencia de que existe una migracion a Postgres pendiente.

## 1. Executive summary

This ADR chooses a split persistence model for the Agentic CRM:

- MariaDB remains the source of truth for the legacy case and message timeline.
- PostgreSQL, optionally operated through Supabase, becomes the source of truth for the new brain domain.

The reason is not preference. It is fit to access patterns, transaction boundaries, idempotency, and migration risk.

The new brain domain is small, transactional, append-only where it matters, and queue-heavy. It benefits from PostgreSQL features such as JSONB, stronger constraints, `SKIP LOCKED`, and simpler atomic claim/update patterns. The legacy conversation surface is high-volume, already integrated, and should not be migrated as a blocker for the brain.

The decision is therefore:

- keep legacy cases/messages in MariaDB for P1;
- move brain operational stores to PostgreSQL/Supabase;
- forbid uncontrolled dual-write for the same entity;
- implement PostgreSQL/Supabase repository adapters first.

## 2. Current state

The repository currently runs on MariaDB for runtime access through `mysql2/promise`.

Observed today:

- legacy case and conversation reads still use `n8n_*` tables and views;
- the operational loop already persists `crm_opportunities` and `crm_agent_decisions`;
- the action queue adds `crm_agent_actions`;
- the outbox exists as `brain_message_outbox`;
- P1K-012D-A removed storage coupling from the execution gate core.

So the current state is hybrid already, but the physical storage is still MariaDB. This ADR defines the target split, not a live cutover.

## 3. Domain entities

The entities below are the minimum set to evaluate for the Agentic CRM persistence boundary.

| Entity | Purpose | Current source of truth | P1 source of truth | Future candidate | Write pattern | Read pattern | Consistency requirement | Retention | Expected volume | Recommended storage | Migration priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Customer Candidate | Provisional identity projection | Legacy reads from MariaDB / `n8n_*` | MariaDB read projection | PostgreSQL CRM identity projection | Derived from inbound and legacy signals | Read-mostly | Best-effort, fail closed on ambiguity | Medium to long, but not canonical master | High | Read model, not hot write store | Low |
| Customer Master future | Definitive identity master | Not implemented | Not implemented | PostgreSQL CRM identity service | Future authoritative writes only | Read-heavy across the product | Strong consistency when introduced | Long-term | High | PostgreSQL CRM | Deferred |
| Case | Operational conversation case | MariaDB legacy `n8n_conversation_cases` | MariaDB legacy | PostgreSQL CRM case store only if case-core migration happens | Human and workflow updates | High read frequency | Transactional within legacy boundary | Long-term | High | MariaDB | Low in P1 |
| Message | Conversation timeline entry | MariaDB legacy `n8n_conversation_messages` and inbound tables | MariaDB legacy | PostgreSQL or dedicated append-only store later | Append-heavy, write-once | Very high read volume | Idempotent append and timeline ordering | Long-term with partition/archive later | Very high | MariaDB in P1, archive later | Low in P1 |
| Opportunity | Durable commercial state | MariaDB current `crm_opportunities` | PostgreSQL/Supabase brain DB | PostgreSQL CRM with analytics replicas | Update-in-place with versioning | Frequent reads by case/wa_id/status | Strong transactional consistency | Long-term | Medium | PostgreSQL/Supabase | High |
| Agent Decision | Append-only commercial decision log | MariaDB current `crm_agent_decisions` | PostgreSQL/Supabase brain DB | PostgreSQL append-only event log | Append-only | Read latest and audit trail | Strong append consistency | Long-term | Medium | PostgreSQL/Supabase | High |
| Agent Action | Governed action queue row | MariaDB current `crm_agent_actions` | PostgreSQL/Supabase brain DB | PostgreSQL queue with future executor | Insert/update lifecycle row | Status, due, conflict, idempotency | Strong transactional consistency | Hot operational + historical archive | Medium | PostgreSQL/Supabase | High |
| Outbox Message | Execution intent for worker | MariaDB current `brain_message_outbox` | PostgreSQL/Supabase brain DB | PostgreSQL outbox with worker | Claim, lock, retry, mark terminal | Poll and claim due rows | Strong idempotency and lock safety | Hot operational, archive after terminal | Medium to high | PostgreSQL/Supabase | High |
| Execution Result | Record of a future worker result | Not canonical yet | PostgreSQL/Supabase brain DB | PostgreSQL append-only result log | Append-only after worker execution | Audit and troubleshooting | Strong append consistency | Long-term | Medium | PostgreSQL/Supabase | High |
| Audit Log | Cross-cutting audit trail | MariaDB `hub_audit_log` | MariaDB legacy for now | Optional future brain audit stream | Append-only | Audit views and operator review | Strong append consistency | Long-term with compact payloads | Medium | MariaDB legacy | Medium |
| Raw Webhook | Raw inbound payload capture | Legacy / transient storage | Object storage, not hot DB | Object storage with signed access | Write once, then archive | Rare forensic access | Integrity, not hot query speed | Short retention in hot storage | Very high burst | Object storage | High for offload |
| Attachment | Binary evidence / file blob | External or legacy references | Object storage | Object storage | Write once | Signed access / CDN | Integrity and permissions | Lifecycle-managed | Variable, large | Object storage | Medium |
| Follow-up | Deferred commercial follow-up | Dry-run only today | PostgreSQL/Supabase via action queue | PostgreSQL scheduler / worker tables | Planned, cancelable, retryable | Due list and state list | Idempotent and cancel-safe | Hot until closed, then archive | Medium | PostgreSQL/Supabase | High |

## 4. Source-of-truth matrix

| Entity | Current SoT | P1 SoT | Future candidate | Notes |
| --- | --- | --- | --- | --- |
| Case | MariaDB legacy | MariaDB legacy | PostgreSQL CRM case store only if case migration becomes explicit | High-volume operational timeline stays with legacy for P1 |
| Message | MariaDB legacy | MariaDB legacy | PostgreSQL or dedicated append-only store later | Timeline is the largest hot dataset; do not move it as a prerequisite |
| Opportunity | MariaDB current `crm_opportunities` | PostgreSQL/Supabase brain DB | PostgreSQL CRM with analytic replicas | Transactional, low volume, high value state |
| Decision | MariaDB current `crm_agent_decisions` | PostgreSQL/Supabase brain DB | PostgreSQL append-only event log | Append-only decision history belongs with the brain |
| Action | MariaDB current `crm_agent_actions` | PostgreSQL/Supabase brain DB | PostgreSQL queue + executor | Needs idempotency, conflict detection, and lifecycle control |
| Outbox | MariaDB current `brain_message_outbox` | PostgreSQL/Supabase brain DB | PostgreSQL worker outbox | Claim/lock semantics fit Postgres well |
| Execution Result | Not yet canonical | PostgreSQL/Supabase brain DB | PostgreSQL append-only result stream | Must stay co-located with the execution gate and outbox |
| Audit Log | MariaDB `hub_audit_log` | MariaDB legacy | Optional future brain audit stream | Cross-cutting audit already exists in legacy |
| Raw Webhook | Legacy transient DB / tables | Object storage | Object storage | Not hot data; archive or purge after capture |
| Attachment | External or legacy blob handling | Object storage | Object storage | Never keep binary blobs in hot relational rows |
| Customer Candidate | Legacy read projection | MariaDB read projection | PostgreSQL CRM identity projection | Provisional identity, not master truth |
| Customer Master future | None | None | PostgreSQL CRM identity master | Deferred until master model exists |

## 5. Access patterns

### Cases

| Pattern | Frequency | Latency target | Required index | Transactional or analytical |
| --- | --- | --- | --- | --- |
| Load case by id | Very high | Low tens of ms | Primary key | Transactional |
| List active cases | High | Sub-100ms | `status`, `priority`, `department`, `last_activity_at` | Transactional |
| Filter by status/priority/department | High | Sub-100ms | Composite index on the filter columns | Transactional |
| Load last activity | High | Sub-100ms | `last_activity_at` | Transactional |

### Messages

| Pattern | Frequency | Latency target | Required index | Transactional or analytical |
| --- | --- | --- | --- | --- |
| Load latest 50 messages by case | Very high | Sub-100ms | `conversation_case_id, created_at, id` | Transactional |
| Cursor pagination | Very high | Sub-100ms | `conversation_case_id, created_at, id` and `wa_id, created_at, id` | Transactional |
| Find message by provider_message_id | Medium | Sub-50ms | Unique `provider_message_id` | Transactional |
| Find last inbound | High | Sub-100ms | `wa_id, created_at, id` with direction filter | Transactional |
| Find last outbound | High | Sub-100ms | `wa_id, created_at, id` with direction filter | Transactional |

### Opportunities

| Pattern | Frequency | Latency target | Required index | Transactional or analytical |
| --- | --- | --- | --- | --- |
| Find active opportunity by wa_id | High | Sub-50ms | `wa_id` | Transactional |
| Find by opportunity_key | Very high | Sub-50ms | Unique `opportunity_key` | Transactional |
| Update current commercial state | High | Sub-100ms | Primary key + optimistic version | Transactional |
| List stale opportunities | Medium | Sub-100ms | `status`, `last_activity_at`, `next_action_due_at` | Transactional |

### Decisions

| Pattern | Frequency | Latency target | Required index | Transactional or analytical |
| --- | --- | --- | --- | --- |
| Append decision | High | Sub-100ms | Unique `decision_id` | Transactional |
| Load latest decision by opportunity | High | Sub-100ms | `opportunity_id, created_at desc` | Transactional |
| Load audit trail | Medium | Sub-100ms | `opportunity_id, created_at desc` | Analytical/transactional hybrid |
| Find by message_id/correlation_id | Medium | Sub-50ms | `message_id`, `correlation_id` | Transactional |

### Actions

| Pattern | Frequency | Latency target | Required index | Transactional or analytical |
| --- | --- | --- | --- | --- |
| Find by action_id | Very high | Sub-50ms | Unique `action_id` | Transactional |
| Find by idempotency_key | Very high | Sub-50ms | Unique `idempotency_key` | Transactional |
| List actions by status | High | Sub-100ms | `status, scheduled_for` | Transactional |
| List scheduled actions due | High | Sub-100ms | `scheduled_for`, `status` | Transactional |
| List actions by opportunity/case/wa_id | High | Sub-100ms | `opportunity_id`, `conversation_case_id`, `wa_id` | Transactional |
| Detect conflicts | High | Sub-100ms | `wa_id`, `conversation_case_id`, `status`, `idempotency_key` | Transactional |

### Outbox

| Pattern | Frequency | Latency target | Required index | Transactional or analytical |
| --- | --- | --- | --- | --- |
| Find by idempotency_key | Very high | Sub-50ms | Unique `idempotency_key` | Transactional |
| Claim available rows | Very high | Sub-100ms | `status, available_at` | Transactional |
| Lock rows | Very high | Sub-100ms | `locked_at`, `status` | Transactional |
| Retry failed rows | Medium | Sub-100ms | `status`, `available_at` | Transactional |
| Mark delivered/failed | High | Sub-50ms | `status`, `id` | Transactional |

## 6. Transaction boundaries

### Action to outbox

Must be atomic inside the brain database:

```text
insert outbox command
+ mark action planned
+ link outbox id
```

Reason: the action and the outbox command represent one execution intent.

### Decision persistence

Should be atomic inside the brain database:

```text
update opportunity state
+ append agent decision
```

Reason: the state change and the reason for that state change must not diverge.

### Outbox worker

Must be atomic for claim/lock:

```text
claim row
+ lock row
```

Reason: prevent double processing and lost work.

### Inbound cancellation

Should be event-driven, not a distributed transaction.

Reason:

- it may span MariaDB legacy message/case state and PostgreSQL brain state;
- cross-database ACID is not the right tradeoff for P1;
- cancellation must be idempotent and reconcilable instead of distributed-transaction dependent.

### Cross-database rule

No P1 transaction should require MariaDB and PostgreSQL to commit atomically together.

## 7. Volume assumptions

- Cases: moderate volume, but high operational visibility.
- Messages: highest volume and most expensive to migrate.
- Opportunities: low to medium volume, but high business importance.
- Decisions: append-only, medium volume.
- Actions: medium volume, bursty during active conversations.
- Outbox: medium volume, bursty, must support retries.
- Raw webhooks: very high ingest volume, but not hot relational data.
- Attachments: potentially large blobs, never hot relational rows.

This volume profile is why the decision separates legacy timeline data from the new brain state.

## 8. Retention

### Long-term

- `crm_opportunities`
- `crm_agent_decisions`
- `messages`
- `cases`
- `audit_log`

### Hot operational, then archive

- `crm_agent_actions`
- `brain_message_outbox`
- `execution_result`

These tables are operational first, but their terminal rows must remain available for audit and retry analysis. Exact archive timing should follow legal and operational retention rules, not an arbitrary default.

### Short retention or offload

- raw webhooks
- diagnostics that contain request snapshots

Keep the hot database small. Move raw payloads to object storage or purge them after the operational window closes.

### Object storage

- attachments
- raw webhook archives

Binary payloads do not belong in hot relational tables.

## 9. Index strategy

### `crm_opportunities`

- unique `opportunity_key`
- `wa_id`
- `status`
- `last_activity_at`
- `next_action_due_at`

### `crm_agent_decisions`

- unique `decision_id`
- `opportunity_id, created_at`
- `message_id`
- `correlation_id`

### `crm_agent_actions`

- unique `action_id`
- unique `idempotency_key`
- `status, scheduled_for`
- `opportunity_id`
- `conversation_case_id`
- `wa_id`

### `brain_message_outbox`

- unique `idempotency_key`
- `status, available_at`
- `locked_at`
- `action_id`

### `messages`

- `conversation_case_id, created_at, id`
- `wa_id, created_at, id`
- unique `provider_message_id`

If PostgreSQL is used for the brain tables, partial indexes for hot states such as `planned`, `available`, `failed`, and `locked` are recommended to keep claim queries small.

## 10. JSON / payload policy

Rules:

- filterable fields must be normal columns;
- JSON or JSONB is only for variable payloads;
- large raw payloads must not remain indefinitely in hot tables;
- payload size must be capped and sanitized;
- secrets and tokens must never be stored in canonical rows;
- raw webhooks should be archived out of the hot path;
- if a field is frequently queried, denormalize it into a normal column.

Practical implication:

- use JSONB for `requirements`, `state_changes`, `warnings`, `policy_notes`, and other variable brain payloads;
- do not store raw provider responses or raw inbound webhooks as the durable hot truth.

## 11. Technology comparison

### MariaDB

Pros:

- already in the repo and already operating;
- compatible with the legacy HUB and current runtime;
- low immediate migration cost for legacy case/message surfaces;
- mature operational familiarity.

Limits:

- weaker ergonomics for queue claiming and advanced indexing patterns;
- JSON support exists, but query ergonomics are weaker than PostgreSQL JSONB;
- more awkward for hot idempotent worker workflows;
- not the best fit for the new brain boundary if the goal is to isolate operational state.

### PostgreSQL

Pros:

- JSONB and GIN are a better fit for variable brain payloads;
- `SKIP LOCKED` and row locking make outbox/queue patterns cleaner;
- stronger constraints and richer indexing options;
- easier to model append-only logs and transactional state changes;
- future pgvector is available if the product later needs semantic retrieval.

Limits:

- higher migration cost if all legacy chat data is moved at once;
- requires a deliberate coexistence plan with MariaDB;
- operational complexity increases if the repo keeps both engines alive.

### Supabase

Supabase is not a separate storage engine for this decision. It is PostgreSQL with managed tooling around it.

Pros:

- local and managed developer workflow;
- migrations and branching are easier to operationalize;
- useful for P1 lab and future repository adapters.

Limits:

- vendor/platform layer on top of PostgreSQL;
- auth/realtime/storage are not required for P1;
- should not be treated as a different database class.

## 12. Architecture options

### Option A - MariaDB only

`legacy + new brain in same engine`

Advantages:

- lowest immediate migration cost;
- fewer moving parts;
- no cross-database references.

Risks:

- the new brain remains constrained by the legacy engine;
- queue and outbox semantics are harder to keep clean;
- the largest hot datasets and the new operational store share the same failure domain;
- future migration cost increases because the brain and legacy timeline grow together.

### Option B - MariaDB legacy + PostgreSQL brain

`MariaDB: cases/messages legacy`

`PostgreSQL: opportunities/decisions/actions/outbox/execution results`

Advantages:

- separates high-volume legacy timeline from transactional brain state;
- better fits the access patterns of the execution gate and outbox;
- reduces the blast radius of future brain evolution;
- keeps the legacy HUB untouched while the brain matures.

Risks:

- cross-database references must stay soft;
- operational discipline is required to avoid dual-write;
- adapter work is required before the cutover.

### Option C - Full PostgreSQL migration

`cases/messages/CRM/brain/outbox`

Advantages:

- single engine long term;
- cleaner eventual architecture;
- uniform queue and transaction semantics.

Why not now:

- moves the largest and oldest datasets unnecessarily;
- increases cutover and regression risk;
- forces the product to solve a bigger migration before the brain is proven;
- delays the operational value of the new brain.

## 13. Dual-write policy

Uncontrolled dual-write is forbidden.

Explicit rule:

```text
No writing the same entity as source of truth in MariaDB and PostgreSQL simultaneously.
```

If replication or shadow-write is ever needed:

- there must be one authoritative writer;
- the other store must be derived or read-only;
- reconciliation must be explicit and idempotent;
- failure handling must fail closed;
- the derived store must never silently become the source of truth.

For P1, the safe rule is simple:

- one entity, one authoritative store, one writer path.

## 14. Final decision (superseded — see banner)

Original decision (never executed):

- MariaDB remains the source of truth for legacy case and message data in P1.
- PostgreSQL/Supabase becomes the source of truth for the new brain domain.

Original chosen architecture (not what actually shipped):

```text
MariaDB for legacy
PostgreSQL/Supabase for new brain
```

Why Option B was chosen on paper:

- access patterns for opportunities, decisions, actions, outbox, and execution results are transactional and queue-heavy;
- PostgreSQL gives cleaner locking, constraints, JSONB, and idempotent worker semantics;
- the legacy timeline is high-volume and already integrated, so moving it now adds risk without helping the brain;
- this split minimizes blast radius while keeping the future brain coherent.

**What actually happened**: the PostgreSQL/Supabase adapter work below was never started. Every brain entity (`crm_opportunities`, `crm_agent_decisions`, `crm_agent_actions`, `brain_message_outbox`) was implemented, hardened and verified end-to-end against **MariaDB** across `ACS-R1-04`/`ACS-R1-05`/`ACS-R1-05.1` (see `docs/ACTIVE_RELEASE.md` for the MariaDB-backed evidence of every task). MariaDB's `mysql2` transactions, row locking and unique-constraint idempotency proved sufficient for the claim/lock and append-only patterns this document worried about. The comparison in sections 11-12 remains useful as a record of the tradeoff analysis; the decision itself is reversed by observed reality.

Rejected alternatives (kept for historical record; MariaDB-only, i.e. the rejected "Option A", is what actually runs today):

- MariaDB only;
- full PostgreSQL migration of cases/messages in P1.

Next adapter: none. There is no PostgreSQL/Supabase migration in flight or planned. Any future persistence change must be proposed as a new decision against `docs/CAPABILITY_MATRIX.md`'s real state, not resumed from this document.

Migration boundary (historical, describes the unexecuted plan):

- legacy cases/messages stay in MariaDB for P1;
- brain entities move by explicit adapter cutover only;
- no same-entity dual-write;
- no distributed transaction between MariaDB and PostgreSQL.

Rollback/fallback:

- keep the MariaDB legacy path available for cases/messages;
- cut over brain writers only after adapter contract tests pass;
- if the new brain path fails, fail closed and keep legacy read surfaces stable;
- do not silently fall back to a second authoritative writer.

Conditions to revisit:

- case/message volume or query patterns justify a broader migration;
- cross-database failure rate becomes operationally significant;
- index growth or outbox throughput exceeds planned Postgres capacity;
- the product decides to unify the entire timeline on PostgreSQL after the brain stabilizes.

## 15. Migration strategy

The migration path is additive and reversible:

1. Keep legacy case/message reads on MariaDB.
2. Implement PostgreSQL/Supabase repositories for the brain entities.
3. Add contract tests against synthetic data only.
4. Backfill the brain tables from current state.
5. Cut over one brain writer boundary at a time.
6. Keep legacy data read-only and observable during the transition.
7. Revisit case/message migration only after the brain is stable.

This avoids a big-bang migration and keeps the blast radius contained.

## 16. Testing strategy

Test the architecture without touching production:

- in-memory repository contract tests;
- local PostgreSQL or Supabase Docker for brain entities;
- synthetic data only;
- replay and idempotency tests for retry paths;
- rollback tests for unit-of-work failure;
- repository adapter tests for claim/lock and unique constraints;
- read-only validation against MariaDB legacy fixtures;
- no production credentials in local test runs.

If a real integration check is needed, use a disposable local environment with only the core tables and synthetic rows.

## 17. Risks

- legacy still in MariaDB;
- cross-database consistency;
- migration cost;
- operational complexity;
- permissions;
- test environment parity;
- adapter implementation delay;
- accidental dual-write if boundaries are not enforced.

## 18. Next milestone (superseded — see banner)

This section originally recommended `P1K-012D-C - PostgreSQL/Supabase Repository Adapters` as the next step. That milestone was never started and is not planned. The brain domain's actual persistence layer is MariaDB; see `docs/CAPABILITY_MATRIX.md` for its real, current state.

