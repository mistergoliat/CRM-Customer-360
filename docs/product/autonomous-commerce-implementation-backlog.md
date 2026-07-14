# Autonomous Commerce Implementation Backlog

This backlog converts the PRD and the current repository state into a sequence of independent PRs that can carry the product to the first functional vertical.

> **Integration status (architecture-owner review):** `INFRA-01`, `PR-02A`, `PR-02B`, `PR-03A` are **accepted** and integrated. Evidence: `docs/product/autonomous-commerce-qa-report-infra01-pr02a-02b-03a.md` (first pass) and `docs/product/autonomous-commerce-integration-handoff.md` (independent re-verification, gap closure, and decision record). `PR-04` is unblocked.

> **Identity workstream update:** the native WhatsApp inbound no longer creates a provisional `master_customer` for an unknown sender (`ACS-R1-04-T06.2`); unmatched contacts persist as an unresolved `customer_external_identity` row (`customer_id = NULL`) instead. Identity resolution, onboarding and creation/linking authority stay canonical per `docs/data/customer-onboarding-identity-contract.md` and `docs/data/customer-creation-linking-authority-contract.md` - `crm_customer_onboarding` is legacy (P1M/local-ai-sdr), not part of this boundary. Remaining backlog work is legacy remediation, address lifecycle polish and cleanup of consumers that still assume a linked customer is always present.

## 1. Consistency check

### Contradictions found

1. Stage vocabulary is split between target PRD states and historical shared contracts.
   - PRD target: `discovery`, `qualification`, `recommendation`, `objection_handling`, `purchase_intent`, `checkout_support`, `follow_up`, `won`, `lost`, `handoff`.
   - Legacy shared contracts in `lib/brain/commercial/types.ts` and `lib/brain/commercial/constants.ts`: `discovery`, `qualification`, `solution_fit`, `quotation`, `negotiation`, `closing`, `post_sale_handoff`.
   - Resolution: document both as legacy vs target; do not collapse them silently.

2. Tool naming is inconsistent between PRD and implemented code.
   - PRD lists conceptual tools like `queue_whatsapp_message`, `create_escalation`, and `request_human_handoff`.
   - Current repo implementation uses `queueCustomerMessageRecord` / `queueCustomerMessage` and `requestHumanHandoffRecord` / `requestHumanHandoff`.
   - Resolution: documented implementation aliases are accepted for now; the canonical product tool names live in the tool catalog, not the helper function names.

3. `request_human_handoff` was duplicated in the first tool catalog draft.
   - Resolution: removed the duplicate and kept a single canonical row.

4. `queue_outbound_message` in the first docs was not aligned with the PRD tool naming or the current code path.
   - Resolution: standardized the documented tool to `queue_customer_message`, with the current implementation alias noted.

5. The boundary between `crm_agent_decisions` and `ai_agent_decision` is fixed.
   - PRD and ADR-001 place the durable commercial decision in CRM and the technical execution evidence in `ai_*`.
   - Resolution: accepted and frozen in ADR-001.

6. Action ownership and next-action projection are fixed.
   - `crm_agent_actions` is the durable action source.
   - `crm_opportunities.next_action_*` is a projection.
   - Resolution: accepted and frozen in ADR-003 and ADR-004.

7. Strategy selection is AI-led, not hardcoded deterministic.
   - Deterministic rules remain available as safe fallback and validation.
   - Resolution: align PR-09 with AI planning plus Brain validation.

8. Recommendation must stay inside real eligible candidates.
   - Product selection can only happen from a validated candidate set returned by `CatalogService` and hard filters.
   - Resolution: align PR-10 with candidate-set selection and explanation.

9. The meaning of `productivo` is still easy to overstate.
   - Native slice is real and tested.
   - The full product is not yet complete.
   - Resolution: backlog must use binary acceptance, not "looks wired".

### Ambiguities

1. How to migrate the legacy `crm_opportunities.human_owner_active` field away without breaking existing reads.
2. Whether `CommercialEvent`, `ToolRequest`, and `ToolResult` should be introduced as thin documented aliases over existing runtime shapes before PR-02, or remain documentation-only until their runtime wrappers are built.
3. Whether `AIPlan` and `CapabilityEvaluation` should map cleanly onto existing strategy/policy types during implementation or require new type wrappers.

### Duplications

1. Human handoff state is represented in conversation, opportunity, action, and decision layers.
2. Outbound intent exists in consultative outputs, outbox rows, and timeline messages.
3. Opportunity next action appears both in opportunity state and action rows.
4. Current docs contain both legacy and target stage vocabularies.

### Decisions still pending

1. Final authoritative stage vocabulary migration path.
2. Whether the runtime will expose thin wrappers for `CommercialEvent`, `ToolRequest`, and `ToolResult` in PR-02 or keep those as documentation-only contracts until the implementation PRs land.
3. Whether `AIPlan` and `CapabilityEvaluation` should reuse existing strategy/policy shapes or become new runtime wrappers.

### Docs corrected or created because the resolution was evident

- `docs/product/autonomous-commerce-tool-catalog.md`
- `docs/product/autonomous-commerce-first-vertical.md`
- `docs/product/autonomous-commerce-state-model.md`
- `docs/architecture/adr/ADR-001-commercial-vs-ai-decisions.md`
- `docs/architecture/adr/ADR-002-ai-runtime-observability-boundary.md`
- `docs/architecture/adr/ADR-003-commercial-action-source-of-truth.md`
- `docs/architecture/adr/ADR-004-next-best-action-ownership.md`
- `docs/architecture/adr/ADR-005-catalog-boundary.md`
- `docs/architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md`
- `docs/architecture/adr/ADR-007-failure-escalation-and-outcomes.md`

## 2. Frozen contracts

These contracts should be frozen before the implementation sequence starts. Some already exist partially in code; some exist only as neighboring types; some are still missing.
The ownership boundaries behind them are now fixed by ADR-001 through ADR-007.
Every frozen contract carries `contractName` and `schemaVersion`; schema versions follow semver, with compatible changes as minor and breaking changes as major.

### 2.1 `CommercialEvent`

- Responsibility: normalize inbound, outbound, status, timer, and internal business events into one commercial event envelope.
- Owner: command runtime.
- Minimum fields:
  - `id`
  - `eventType`
  - `source`
  - `correlationId`
  - `occurredAt`
  - `customerRef`
  - `conversationRef`
  - `opportunityRef`
  - `payload`
- Optional fields:
  - `providerMessageId`
  - `channel`
  - `metadata`
  - `dedupeKey`
- Invariants:
  - one event, one correlation id;
  - no raw provider payload as source of truth;
  - idempotent by source + external id when applicable.
- Produced by: webhook adapters, worker status handlers, timers, internal commands.
- Consumed by: context builder, opportunity lifecycle, cycle orchestrator, audit.
- Persistence: event log table or append-only log model not yet explicit in code.
- Version: `1.0.0`.
- Current code state: missing as an explicit contract; spread across inbound processing and shadow/event runtimes.

### 2.2 `CommercialContext`

- Responsibility: provide the normalized commercial snapshot used by decisioning.
- Owner: AI planning layer.
- Minimum fields:
  - `customer`
  - `conversation`
  - `recentMessages`
  - `opportunity`
  - `needProfile`
  - `actions`
  - `signals`
  - `availableCapabilities`
- Optional fields:
  - `policyContext`
  - `metadata`
  - `knowledgeContext`
  - `customerCandidate`
- Invariants:
  - no unsafe raw payload;
  - serializable;
  - no legacy fallback assumptions inside the contract.
- Produced by: commercial context builder.
- Consumed by: consultative engine, policy, orchestrator, review surfaces.
- Persistence: not the source of truth itself; read model from multiple tables.
- Version: `1.0.0` target contract; current code exists as `CommercialContextBuilderResult` / `SalesAgentInput` family.
- Current code state: partially implemented under `lib/brain/commercial/types.ts`, `lib/brain/commercial/context/*`, `lib/brain/commercial/sales-agent/*`.

### 2.3 `OpportunityState`

- Responsibility: durable commercial state for a single opportunity.
- Owner: commercial decision domain.
- Minimum fields:
  - `opportunityKey`
  - `status`
  - `stage`
  - `primaryIntent`
  - `currentSummary`
  - `nextActionType`
  - `nextActionDueAt`
  - `waitingFor`
  - `humanOwnerActive`
  - `aiBlocked`
  - `closedAt`
- Optional fields:
  - `productInterests`
  - `requirements`
  - `objections`
  - `signals`
  - `temperature`
  - `priority`
- Invariants:
  - one logical opportunity per key;
  - terminal states must be explicit;
  - no silent duplicate opportunities for the same commercial path.
- Produced by: consultative engine and opportunity commands.
- Consumed by: AI SDR, UI, follow-up, handoff, audit.
- Persistence: `crm_opportunities`.
- Version: `1.0.0` target contract; current code has a working model, but stage vocabulary is still partly historical.
- Current code state: implemented, but not fully frozen against the PRD target vocabulary.

### 2.4 `ConversationState`

- Responsibility: durable state of the message thread.
- Owner: conversation domain / command runtime.
- Minimum fields:
  - `customerId`
  - `channel`
  - `externalThreadId`
  - `status`
  - `aiEnabled`
  - `humanOwnerActive`
  - `lastInboundAt`
  - `lastOutboundAt`
- Optional fields:
  - `provider`
  - `ownerType`
  - `ownerId`
  - `lastMessageAt`
- Invariants:
  - one thread per customer/channel identity;
  - inbound must be persisted before agent execution;
  - human takeover must suppress automated response.
- Produced by: native inbound service and human takeover commands.
- Consumed by: UI, agent runtime, outbox worker, delivery status updates.
- Persistence: `conversation`.
- Version: `1.0.0`.
- Current code state: implemented.

### 2.5 `TurnObjective`

- Responsibility: the goal of a single commercial turn.
- Owner: AI planning layer.
- Minimum fields:
  - `type`
  - `rationale`
  - `confidence`
  - `requiresHuman`
  - `channel`
- Optional fields:
  - `missingInformation`
  - `recommendedQuestion`
  - `suggestedFollowUp`
- Invariants:
  - exactly one primary turn objective;
  - objective must be derivable from context and policy;
  - cannot invent state transitions.
- Produced by: consultative engine.
- Consumed by: opportunity lifecycle, response generation, action queue.
- Persistence: part of decision/action records, not yet a standalone table.
- Version: `1.0.0` target contract; current code is inferred from consultative output.
- Current code state: partially represented in `SalesConsultativeResult` and `SalesAgentDecision`.

### 2.6 `CommercialStrategy`

- Responsibility: describe how the turn should be handled commercially.
- Owner: AI planning layer.
- Minimum fields:
  - `name`
  - `purpose`
  - `preconditions`
  - `desiredOutcome`
  - `fallback`
  - `riskLevel`
- Optional fields:
  - `objectionTypes`
  - `requiredTools`
  - `approvalRequirement`
- Invariants:
  - one strategy per turn;
  - must match observed signals;
  - must not bypass policy.
- Produced by: strategy selector.
- Consumed by: recommendation, objection handling, follow-up planning.
- Persistence: not yet a dedicated table.
- Version: `1.0.0`.
- Current code state: exists as behavior, not as a frozen domain contract.

### 2.7 `NextBestAction`

- Responsibility: define the single next commercial action to take.
- Owner: commercial decision domain.
- Minimum fields:
  - `type`
  - `objective`
  - `rationaleSummary`
  - `channel`
  - `dueAt`
  - `requiredTools`
  - `preconditions`
  - `cancellationConditions`
  - `successCriteria`
  - `idempotencyKey`
  - `approvalRequirement`
- Optional fields:
  - `messageDraft`
  - `blockedReasons`
  - `followUpHint`
- Invariants:
  - one primary action only;
  - must be cancelable under policy;
  - must never imply direct send.
- Produced by: consultative engine.
- Consumed by: action queue, outbox, UI, follow-up.
- Persistence: `crm_agent_decisions.next_action_json` today; later also action rows.
- Version: `1.0.0` target contract; code currently uses consultative result fields and `next_action_json`.
- Current code state: partially implemented.

### 2.8 `ToolRequest`

- Responsibility: declare a tool call requested by the agent.
- Owner: capability gateway.
- Minimum fields:
  - `tool`
  - `status`
  - `reason`
  - `requiredInputs`
  - `optionalInputs`
  - `fallbackDecision`
- Optional fields:
  - `confidence`
  - `blocking`
  - `riskLevel`
  - `expectedEvidence`
- Invariants:
  - tool name must be from registry;
  - blocked tool calls must stay blocked;
  - no direct side effect from the request itself.
- Produced by: sales agent runtime.
- Consumed by: policy layer, tool executor, review surfaces.
- Persistence: current code has `SalesAgentToolRequest` and `BrainToolRequest`, but no single product contract.
- Version: `1.0.0`.
- Current code state: partially implemented under `lib/brain/tools/types.ts` and `lib/brain/commercial/sales-agent/validationTypes.ts`.

### 2.9 `ToolResult`

- Responsibility: record the outcome of a tool request.
- Owner: command runtime.
- Minimum fields:
  - `tool`
  - `status`
  - `startedAt`
  - `finishedAt`
  - `output`
  - `error`
  - `correlationId`
- Optional fields:
  - `retryable`
  - `latencyMs`
  - `warnings`
  - `providerRef`
- Invariants:
  - every executed tool must have a terminal result;
  - result must be auditable;
  - error must be explicit when failing closed.
- Produced by: tool executor.
- Consumed by: agent runtime, audit, orchestrator, UI.
- Persistence: `ai_tool_execution` today is closest, but not a product contract yet.
- Version: `1.0.0`.
- Current code state: absent as a formal contract.

### 2.10 `CRMCommand`

- Responsibility: represent a validated domain command.
- Owner: command runtime.
- Minimum fields:
  - `commandType`
  - `aggregateRef`
  - `correlationId`
  - `requestedBy`
  - `payload`
  - `requestedAt`
- Optional fields:
  - `idempotencyKey`
  - `policyDecision`
  - `sourceEventId`
- Invariants:
  - command is validated before execution;
  - command is idempotent or guarded by a dedupe key;
  - command never writes directly from the model layer.
- Produced by: orchestrator and validated UI actions.
- Consumed by: command handlers and repositories.
- Persistence: not yet an explicit command log.
- Version: `1.0.0`.
- Current code state: absent as a formal contract.

### 2.11 `ActionOutcome`

- Responsibility: capture observable outcomes related to an action.
- Owner: commercial action domain.
- Minimum fields:
  - `actionId`
  - `status`
  - `resultType`
  - `resultSummary`
  - `occurredAt`
- Optional fields:
  - `providerMessageId`
  - `errorCode`
  - `retryCount`
  - `nextActionId`
- Invariants:
  - an action can generate multiple outcomes over time;
  - each outcome must be auditable;
  - outcome must not be inferred from a UI state.
- Produced by: action executor, worker, manual operator completion, or provider callbacks.
- Consumed by: opportunity lifecycle, UI, audit, metrics.
- Persistence: spread across action rows, outbox rows, and conversation messages today.
- Version: `1.0.0`.
- Current code state: partial.

### 2.12 `CommercialCycleResult`

- Responsibility: summarize the complete autonomous cycle outcome.
- Owner: command runtime.
- Minimum fields:
  - `commercialEventId`
  - `context`
  - `strategy`
  - `turnObjective`
  - `nextBestAction`
  - `toolRequests`
  - `toolResults`
  - `actionOutcome`
  - `warnings`
- Optional fields:
  - `decisionId`
  - `opportunityId`
  - `conversationId`
  - `followUpPlan`
- Invariants:
  - every cycle must be traceable to one incoming event;
  - one cycle must not create multiple primary outcomes;
  - cycle result is a summary projection, not the truth layer.
- Produced by: commercial cycle orchestrator.
- Consumed by: UI, audit, reporting, follow-up.
- Persistence: currently split between multiple tables and traces.
- Version: `1.0.0`.
- Current code state: partial, mostly represented by consultative service and shadow orchestration.

### 2.13 `AIPlan`

- Responsibility: represent the wide commercial plan before a single action is accepted.
- Owner: AI planning layer.
- Minimum fields:
  - `planId`
  - `commercialCycleId`
  - `objective`
  - `strategy`
  - `primaryAction`
  - `alternativeActions`
  - `capabilities`
  - `expectedOutcomes`
  - `replanConditions`
  - `stopConditions`
- Optional fields:
  - `evidence`
  - `idempotencyKey`
  - `escalationTarget`
  - `reactivationHint`
- Invariants:
  - one primary action per accepted cycle;
  - a plan can exist without side effects;
  - plan is not the same as an accepted commercial decision.
- Produced by: AI planning layer.
- Consumed by: capability evaluation, policy, decisioning, orchestration.
- Persistence: not yet a dedicated product table.
- Version: `1.0.0`.
- Current code state: missing as an explicit contract.

### 2.14 `CapabilityEvaluation`

- Responsibility: record whether a proposed capability is available and under what constraints.
- Owner: capability gateway.
- Minimum fields:
  - `capabilityName`
  - `status`
  - `reason`
  - `policyResult`
  - `validatedAt`
- Optional fields:
  - `missingInformation`
  - `requiresApproval`
  - `blockedReasons`
  - `replanHint`
- Invariants:
  - unavailable capabilities must not be treated as available;
  - capability evaluation can block or replan without mutating CRM;
  - failed tool proposals do not become commercial decisions.
- Produced by: backend validation.
- Consumed by: planning, decisioning, UI, audit.
- Persistence: projected through runtime traces and audit, not a current dedicated table.
- Version: `1.0.0`.
- Current code state: partially represented by policy and validation types, not frozen as a standalone contract.

### 2.15 `AIProposal`

- Responsibility: capture one proposed commercial move before acceptance.
- Owner: AI planning layer.
- Minimum fields:
  - `contractName`
  - `schemaVersion`
  - `proposalId`
  - `planId`
  - `objective`
  - `strategy`
  - `proposedAction`
  - `rationale`
  - `capabilities`
- Optional fields:
  - `blockedReasons`
  - `replanHint`
  - `evidence`
  - `confidence`
- Invariants:
  - a proposal is not yet accepted;
  - a proposal can be replanned or rejected without mutating CRM;
  - a proposal must not produce side effects by itself.
- Produced by: AI planning layer.
- Consumed by: capability gateway, commercial decision domain, audit.
- Persistence: runtime trace / observability projection.
- Version: `1.0.0`.
- Current code state: implicit in consultative output and AI traces.

### 2.16 `AcceptedCommercialDecision`

- Responsibility: durable commercial decision accepted by the Brain.
- Owner: commercial decision domain.
- Minimum fields:
  - `contractName`
  - `schemaVersion`
  - `decisionId`
  - `commercialCycleId`
  - `opportunityId`
  - `strategy`
  - `acceptedAction`
  - `rationaleSummary`
  - `authority`
  - `status`
  - `correlationId`
- Optional fields:
  - `supersedesDecisionId`
  - `expectedOutcome`
  - `escalationId`
  - `replanHint`
- Invariants:
  - one accepted commercial decision per accepted branch;
  - may exist without AI if produced by policy or human;
  - must correlate to a cycle and outcome trail.
- Produced by: commercial decision domain.
- Consumed by: commercial action domain, UI, audit, cycle result.
- Persistence: `crm_agent_decisions`.
- Version: `1.0.0`.
- Current code state: partially represented by `crm_agent_decisions`.

### 2.17 `CommercialAction`

- Responsibility: durable action that can be scheduled, executed, cancelled, failed, or completed.
- Owner: commercial action domain.
- Minimum fields:
  - `contractName`
  - `schemaVersion`
  - `actionId`
  - `decisionId`
  - `actionType`
  - `status`
  - `scheduledFor`
  - `preconditions`
  - `cancellationConditions`
  - `expectedOutcome`
- Optional fields:
  - `escalationId`
  - `outboxMessageId`
  - `idempotencyKey`
  - `blockedReasons`
- Invariants:
  - one primary durable action per accepted commercial branch;
  - may have multiple outcomes;
  - transport is downstream, not the action itself.
- Produced by: commercial decision domain.
- Consumed by: command runtime, worker, UI, audit.
- Persistence: `crm_agent_actions`.
- Version: `1.0.0`.
- Current code state: partially represented by `crm_agent_actions`.

### 2.18 `ActionExecution`

- Responsibility: technical execution record for one action attempt.
- Owner: command runtime.
- Minimum fields:
  - `contractName`
  - `schemaVersion`
  - `executionId`
  - `actionId`
  - `status`
  - `startedAt`
  - `finishedAt`
  - `attempt`
  - `resultSummary`
- Optional fields:
  - `providerMessageId`
  - `errorCode`
  - `retryable`
  - `outcomeIds`
- Invariants:
  - execution can repeat with retries, but each attempt is auditable;
  - execution is not the durable action itself.
- Produced by: worker / command runtime.
- Consumed by: audit, UI, action domain, cycle result.
- Persistence: runtime trace and technical execution tables.
- Version: `1.0.0`.
- Current code state: partially represented by outbox and AI execution traces.

### 2.19 `Escalation`

- Responsibility: model a routed escalation path and its lifecycle.
- Owner: commercial action domain.
- Minimum fields:
  - `contractName`
  - `schemaVersion`
  - `escalationId`
  - `actionId`
  - `conversationId`
  - `opportunityId`
  - `routingState`
  - `acceptanceState`
  - `resolutionState`
- Optional fields:
  - `returnedToAiAt`
  - `assignedHumanId`
  - `reason`
  - `aliasOfRequestHumanHandoff`
- Invariants:
  - escalation creation, routing, acceptance, resolution, and return-to-AI are distinct;
  - escalation may be autonomous only within policy;
  - specialized handoff aliases must resolve to the same durable escalation path.
- Produced by: commercial decision/action domains.
- Consumed by: UI, routing, handoff controls, audit.
- Persistence: no dedicated table yet.
- Version: `1.0.0`.
- Current code state: implicit in handoff controls and action routing.

### 2.20 `ReactivationContext`

- Responsibility: capture why a dormant, lost, or won path may be revisited.
- Owner: commercial decision domain.
- Minimum fields:
  - `contractName`
  - `schemaVersion`
  - `contextId`
  - `opportunityId`
  - `priorOpportunityId`
  - `sourceState`
  - `reason`
  - `reactivationType`
- Optional fields:
  - `channel`
  - `allowedByPolicy`
  - `notes`
- Invariants:
  - won/lost do not reopen silently;
  - dormant/paused may continue the same opportunity path;
  - reactivation must be explicit.
- Produced by: commercial decision domain.
- Consumed by: opportunity lifecycle, audit, UI.
- Persistence: projected through opportunity and decision records.
- Version: `1.0.0`.
- Current code state: implicit policy gap.

### 2.21 `CommercialQuote`

- Responsibility: represent a quote or quote-like commercial proposal.
- Owner: commercial decision domain.
- Minimum fields:
  - `contractName`
  - `schemaVersion`
  - `quoteId`
  - `opportunityId`
  - `actionId`
  - `items`
  - `totals`
  - `policy`
  - `expiryAt`
- Optional fields:
  - `approvalState`
  - `source`
  - `checkoutLink`
  - `notes`
- Invariants:
  - quote content must be based on validated catalog and policy;
  - quote does not mutate the order by itself;
  - quote is auditable and revisable.
- Produced by: commercial decision domain.
- Consumed by: UI, outbound, approval flow, audit.
- Persistence: not yet a dedicated table.
- Version: `1.0.0`.
- Current code state: implicit in consultative outputs and future checkout flow.

### 2.22 `ExpectedOutcome`

- Responsibility: declare the expected result of an action or plan.
- Owner: AI planning layer.
- Minimum fields:
  - `contractName`
  - `schemaVersion`
  - `outcomeId`
  - `actionId`
  - `commercialCycleId`
  - `expectedType`
  - `successCriteria`
  - `failureCriteria`
- Optional fields:
  - `timeoutAt`
  - `escalationHint`
  - `replanHint`
- Invariants:
  - expectation is not execution;
  - outcome expectations can be revised before acceptance;
  - expected outcome does not replace observed outcome.
- Produced by: AI planning layer.
- Consumed by: commercial decision domain, action domain, audit.
- Persistence: runtime trace / decision record.
- Version: `1.0.0`.
- Current code state: implicit in plan/decision output.

## 3. PR backlog

### PR-01 - Normalize domain vocabulary and accepted ownership

- Status: documented complete.
- ID: `PR-01`
- Title: `Normalize commercial domain vocabulary and accepted ownership`
- Capacity: `domain contracts`
- Priority: `highest`
- Depends on: none
- Blocks: `PR-02` to `PR-16`

Result:

- the repo has a single documented distinction between target PRD vocabulary and legacy shared vocabulary;
- ownership of conversation, opportunity, decision, action, outbox, and catalog boundary is explicitly separated;
- the accepted ADRs are frozen into the product docs and PR-01 does not reopen them;
- no tool is marked available unless it has a real implementation path.

Technical scope:

- update/finalize the autonomous-commerce docs only;
- align `docs/product/autonomous-commerce-state-model.md`, `docs/product/autonomous-commerce-tool-catalog.md`, and `docs/product/autonomous-commerce-authority-matrix.md` with ADR-001 through ADR-007;
- freeze the documented contracts without reopening ownership;
- keep stage vocabulary documentation aligned between target PRD and legacy code;
- document `crm_agent_decisions` vs `ai_agent_decision`, `crm_agent_actions` vs `brain_message_outbox`, `crm_opportunities.next_action_*` as projection, `CatalogService` as the canonical boundary, and the accepted conversation/opportunity control split;
- do not modify runtime code yet.

Exclusions:

- no migrations;
- no runtime changes;
- no new tools;
- no new UI.

Tests:

- doc review against PRD;
- search-based consistency checks for vocabulary;
- no runtime tests.

Acceptance:

- the docs can answer what is target vocabulary, what is legacy vocabulary, and which table owns each durable concept without re-opening the ADRs.
- the docs can answer what is target vocabulary, what is legacy vocabulary, which contract versions are frozen, and which table or domain owns each durable concept without re-opening the ADRs.

Risks:

- leaving stage vocabulary ambiguous;
- normalizing a tool name that has no implementation;
- masking the difference between technical AI tables and CRM truth.

Evidence required:

- doc links;
- file paths;
- code references for current names.

### INFRA-01 - Reproducible MariaDB bootstrap

- ID: `INFRA-01`
- Title: `Reproducible local MariaDB bootstrap from an empty volume`
- Capacity: `developer environment / CI reproducibility`
- Priority: `highest`
- Status: **accepted**. Fixed and verified from a truly empty Docker volume (`docker compose down -v` equivalent + recreate): single env contract (`DB_HOST`/`DB_PORT` shared; `DATABASE_*`/`MIGRATION_DATABASE_*`/`TEST_DATABASE_*`/`LEGACY_DATABASE_*` keep their own per-target `*_USER`/`*_PASSWORD` — `DB_USER`/`DB_PASSWORD` are deliberately *not* set generically, since `lib/database-config.ts`'s alias resolution would make them win over `MIGRATION_DATABASE_USER` and make `crm_dev_admin` unreachable; `CRM_APP_PASSWORD` is infra-only, consumed by `infra/mariadb/init/002-set-local-passwords.sh`); `crm_app` now actually created in `001-create-databases-and-users.sql`; fixed a CRLF/shebang bug (`.gitattributes` added) and a `mysql` -> `mariadb` CLI rename in `002-set-local-passwords.sh` that silently broke first-boot password/grant provisioning. `npm run db:bootstrap:smoke` provisions+migrates+verifies in one command.
  - Independently re-verified (architecture-owner review, second clean-volume run): `npm run db:down && docker volume rm infra_main_management_mariadb_data && npm run db:up && npm run db:wait` -> `MariaDB ready for dev`; `npm run db:migrate -- --database=dev` -> 11/11 applied; `npm run db:bootstrap:smoke` -> `PASS: clean-volume bootstrap is reproducible (database, user, grants, migrations, app connection)`, 16 expected tables present, `crm_app` confirmed read/write without DDL, `crm_dev_admin` confirmed DDL-capable. No real credentials in any tracked file (`.env`/`infra/.env` are gitignored; tracked `.example` files use local-only placeholder values). No manual SQL step in the documented path.
- Depends on: none
- Blocks: `PR-02A`, `PR-02B`, `PR-03A`, and any functional/integration verification.

Result:

- a single, documented environment variable contract for DB host/port/name/user/password, with no silent fallback between `DB_*`, `DATABASE_*`, and `CRM_APP_PASSWORD` naming;
- from an empty Docker volume: database created, `crm_app` created with minimal grants, all `migrations/*.sql` applied, and the Next.js app able to connect, with zero manual SQL.

Technical scope:

- reconcile `infra/.env`, `infra/.env.example`, `.env`, `.env.example`, `infra/docker-compose.dev.yml`, `infra/mariadb/init/*`, and `lib/database-config.ts` alias resolution onto one contract;
- fix `infra/mariadb/init/002-set-local-passwords.sh` (expects `DB_PASSWORD`) vs `infra/.env` (`DATABASE_PASSWORD`/`CRM_APP_PASSWORD`) mismatch, and the empty `MARIADB_USER`/`MARIADB_PASSWORD` passed into the official image from undefined `${DB_USER}`/`${DB_PASSWORD}`;
- wire `npm run db:migrate` (or an equivalent bootstrap script) into the documented path from empty volume to ready app, replacing ad hoc `mariadb` CLI calls;
- add an automated smoke script/test that: starts from a disposable volume, runs the bootstrap, asserts the expected tables exist, asserts `crm_app` can connect and run a basic query, and tears down.

Exclusions:

- no application runtime/business logic changes;
- no production secrets;
- no destructive action against any volume the developer didn't just create for the smoke test.

Tests:

- smoke test/script that provisions a clean volume and verifies tables + user + connectivity;
- documented manual verification commands as a fallback.

Acceptance:

- `docker compose down -v && docker compose up -d` (disposable, documented) followed by the documented bootstrap commands leaves a working app connection with zero manual SQL inside the container;
- the smoke test fails clearly if any step (user creation, grants, migrations, app connection) breaks.

Risks:

- accidentally encoding throwaway local credentials as if they were a security boundary;
- divergence between this bootstrap and a future managed/staging DB.

Evidence required:

- exact bootstrap/reset/test commands;
- smoke test output from a clean volume;
- the resolved single env var contract.

### PR-02 - Introduce commercial event normalization

- ID: `PR-02`
- Title: `Normalize inbound and internal events into CommercialEvent`
- Capacity: `observe and persist events`
- Priority: `highest`
- Status: **accepted**. Real webhook POST -> one `commercial_event` row; duplicate POST -> no second row, checked directly in the DB. The two production blockers noted in the first verification pass (`PR-02A` ingress auth, `PR-02B` duplicate timestamps) are now both resolved and accepted below; PR-02 itself does not need further changes.
- Depends on: `PR-01`
- Blocks: `PR-03` to `PR-16`

Result:

- a native inbound event becomes one normalized commercial event with idempotency and correlation ids;
- inbound, outbound, status, and internal commercial events can share one envelope.
- the event boundary consumes the frozen contract set and does not redefine ownership, action semantics, or strategy.
- `CommercialEvent.causationId` only references another `commercial_event.id`; direct provider-originated events set `causationId = null` and keep message or action references in payload or metadata.
- Meta delivery acceptance remains a technical delivery lifecycle on `brain_message_outbox.provider_status`, while `conversation_message` remains the visible timeline projection and `commercial_event` records the fact.

Technical scope:

- add the `CommercialEvent` contract in a product domain module;
- add a small event log or event projection layer if needed;
- connect the native WhatsApp webhook path to the normalized event shape;
- consume the frozen contracts from PR-01 instead of redefining `AIProposal`, `AcceptedCommercialDecision`, `CommercialAction`, `ActionExecution`, `Escalation`, `ReactivationContext`, `CommercialQuote`, or `ExpectedOutcome`;
- avoid strategy or recommendation logic in this PR.

Exclusions:

- no catalog queries;
- no recommendation;
- no outbox send;
- no UI changes.

Tests:

- event normalization unit tests;
- idempotency tests by provider + provider_message_id;
- database integration test for event persistence.

Acceptance:

- the same inbound event does not produce two commercial events;
- event payloads are sanitized and serializable.
- duplicate handling returns the existing row without mutating it;
- the repository remains append-only for `commercial_event`.

Risks:

- duplicating source of truth with conversation/message tables;
- bringing strategy into event ingestion;
- mixing technical AI trace with commercial event truth.

Evidence required:

- event ids;
- correlation ids;
- duplicate suppression query;
- event rows in DB if persisted.

### PR-02A - Production-safe WhatsApp ingress

- ID: `PR-02A`
- Title: `Provider-specific authentication for the WhatsApp webhook, independent of the admin session gate`
- Capacity: `ingress security`
- Priority: `highest`
- Status: **accepted**. `middleware.ts` carves out `/api/integrations/whatsapp/webhook` (alongside the existing `/login`/`/api/auth/login` carve-outs); the route's own `verifyMetaSignature` is the only gate, computed over the **literal raw request body** (`request.text()`, before `JSON.parse`) with a **timing-safe** comparison (`crypto.timingSafeEqual`, length-checked first), and fails closed when no app secret is configured and `NODE_ENV=production` (previously always allowed unsigned traffic when unconfigured, in every environment). 14/14 tests in `tests/native/whatsapp-webhook-auth.test.ts` pass, including 3 added during architecture-owner review to close real gaps: (1) a raw-body-fidelity test proves the signature is verified over the exact bytes Meta would send, not a parsed-and-reserialized copy — sends a pretty-printed (non-canonical) JSON body, signs over that literal text, confirms acceptance; (2) a production-fail-closed test sets `NODE_ENV=production` with no secret configured and confirms 401 `meta_signature_secret_not_configured`; (3) a missing-`hub.challenge` GET case. Independently re-verified live against a real running app, real DB, **zero** `x-admin-bypass-token`: GET valid verification returns the challenge; GET wrong token -> 403; signed POST -> 200 + 1 `commercial_event` row; identical signed POST again -> `duplicate:true`, still 1 row; unsigned POST -> 401 `missing_signature`; forged-signature POST -> 401 `invalid_signature`. An unrelated route (`/api/system/health`) still returns `{"error":"unauthorized"}` without the admin header (regression-checked in both the test suite and live).
- Depends on: `PR-02`, `INFRA-01` (needed to run its DB-backed tests)
- Blocks: production use of `PR-02`/`PR-03`'s native inbound path; `PR-04`+ should not be treated as "live" until this lands.

Result:

- `POST/GET /api/integrations/whatsapp/webhook` is reachable by Meta's real infrastructure without any admin/operator credential;
- it is not reachable by anyone else without passing Meta's own authenticity check;
- the generic admin-bypass middleware gate (`middleware.ts`) no longer decides whether the provider's webhook can be invoked.

Technical scope:

- carve out `/api/integrations/whatsapp/webhook` from `middleware.ts`'s blanket `/api/*` gate (alongside the existing `/login`/`/api/auth/login` carve-outs), the same way the route already carves itself out logically from session auth;
- keep/extend `verifyMetaSignature` (HMAC `x-hub-signature-256` over the raw body using `META_WHATSAPP_APP_SECRET`/`BRAIN_META_WHATSAPP_APP_SECRET`) as the actual authenticity gate for `POST`, and make it fail closed (reject) when the secret is configured but the signature is missing/invalid; treat "secret not configured" as a loud warning, not a silent allow, in any environment where `APP_ENV`/`NODE_ENV` indicates production;
- keep the existing `GET` `hub.verify_token` challenge flow for Meta's initial subscription handshake;
- preserve idempotency by `providerMessageId` (already implemented via `commercial_event.dedupe_key` / `conversation_message.provider_message_id`) — do not regress it while changing the auth boundary.

Exclusions:

- no changes to other `/api/*` routes' auth;
- no change to the commercial event/context contracts;
- no outbound/send changes.

Tests:

- valid webhook verification (`GET` with correct `hub.verify_token` + `hub.mode=subscribe`) returns the challenge;
- invalid verification (wrong token, wrong mode, missing challenge) is rejected;
- authentic `POST` (valid `x-hub-signature-256`) is processed;
- inauthentic `POST` (missing/invalid signature, secret configured) is rejected, not processed;
- valid payload is persisted once;
- malformed payload fails safely without persisting;
- duplicate `providerMessageId` does not duplicate `commercial_event`/`conversation_message`;
- a request with zero credentials (no admin token, no signature) still reaches the route's own auth logic instead of being intercepted by the generic 401 from `middleware.ts`;
- an unrelated `/api/*` route still requires the admin session/bypass token exactly as before (regression guard that the carve-out is scoped to this one route).

Acceptance:

- a request shaped like Meta's real webhook call (no `x-admin-bypass-token`, valid/absent signature per configuration) reaches the handler;
- with `META_WHATSAPP_APP_SECRET` configured, a forged signature is rejected before any DB write.

Risks:

- widening the middleware carve-out beyond this one path;
- accepting unsigned traffic by default in an environment that should require signatures;
- breaking the existing local/manual testing path that currently relies on the admin bypass token.

Evidence required:

- middleware diff scoped to the one route;
- signature verification test output (pass/fail cases);
- confirmation that other `/api/*` routes are unaffected.

### PR-02B - Duplicate response contract

- ID: `PR-02B`
- Title: `Fix empty occurredAt/receivedAt on the duplicate-webhook response path`
- Capacity: `contract correctness`
- Priority: `medium`
- Status: **accepted**. Root cause: `commercialEventRowToContract` (`lib/brain/commercial/events/repository.ts`) read `occurred_at`/`received_at` with a text-only coercion (`asText`) that silently returned `""` for `mysql2`'s `Date` objects (every DATETIME column comes back as `Date`, not `string`, once round-tripped through the DB — this only affected rows re-read from the DB, i.e. the duplicate path and any future direct caller of `loadCommercialEventByDedupeKey`, not the freshly-inserted in-memory object returned on first creation). Fixed with a dedicated `asDateTimeIso` helper that converts `Date -> toISOString()`; never returns `""` for a `NOT NULL` DATETIME column. Test added in `tests/commercial/commercial-events.test.ts` ("PR-02B: ..."), passing. Independently re-verified live: signed POST -> real ISO `occurredAt`/`receivedAt`; identical POST again (duplicate path) -> still real, non-empty ISO values, same contract shape as the first response.
- Depends on: `PR-02`
- Blocks: nothing structural; safe to ship independently of `PR-02A`.

Risk discovered while fixing this (not fixed here, out of PR-02B's bounded scope): the round-tripped timestamp is the *correct, real* persisted value, but it is not necessarily the *same instant* as what was originally written. `commercial_event.occurred_at`/`received_at` are naive `DATETIME(3)` columns (no timezone), and the `mysql2` pool in `lib/db.ts` is created without an explicit `timezone` option, so reads/writes go through `mysql2`'s default local-timezone interpretation. In this environment that produced a observed +4h offset between the in-memory ISO value and the value read back from the DB for the same row. This is a pre-existing, systemic issue affecting every naive DATETIME column read as a JS `Date` anywhere in the app — not introduced or fixed by PR-02B, and far larger in blast radius than this PR's scope (would need an explicit decision: force `timezone: "Z"` on the pool, or store/compare everything in UTC consistently, then re-verify every other table that relies on the current behavior). Flagged here as a separate, real risk for a future dedicated task; the PR-02B test compares the duplicate-path value against a second fresh DB read of the same row (both round-tripped, so internally consistent) rather than against the pre-round-trip in-memory value.

Result:

- the `commercialEvent` embedded in a `duplicate:true` webhook response carries the same real, persisted `occurredAt`/`receivedAt` as the original event, not empty strings.

Technical scope:

- in the duplicate branch of `processNativeWhatsAppInbound` (`lib/brain/native-whatsapp/service.ts`) and in `loadCommercialEventByDedupeKey`/`recordCommercialEvent` (`lib/brain/commercial/events`), return the persisted event's actual timestamps instead of constructing a partial object with unset date fields;
- define an explicit contract: a timestamp field is either a valid ISO string or the field/object is `null` — never an empty string `""`.

Exclusions:

- no change to dedupe key derivation or dedupe semantics;
- no schema change (timestamps are already persisted correctly; this is a read/serialization bug).

Tests:

- first insertion: `commercialEvent.occurredAt`/`receivedAt` are valid ISO strings matching what was sent;
- duplicate POST of the same `providerMessageId`: `commercialEvent.occurredAt`/`receivedAt` equal the original event's persisted values (not `""`, not different from the first response).

Acceptance:

- byte-for-byte same `occurredAt`/`receivedAt` between the first response and any subsequent duplicate response for the same event.

Risks:

- silently changing the response shape for any existing consumer that depends on the current (buggy) empty-string behavior — none found in this repo, but flag if discovered.

Evidence required:

- before/after response bodies for first vs. duplicate POST.

### PR-03 - Build the commercial context read model

- ID: `PR-03`
- Title: `Build the commercial context read model without legacy fallback`
- Capacity: `understand customer and opportunity`
- Priority: `high`
- Status: **accepted** for the read-model contract itself; product integration (a real caller in the commercial cycle) is still `PR-04`+ scope, by this PR's own design. `buildNativeCommercialContext` run against a real conversation seeded through the live webhook matched the DB field-for-field; `not_found` path degrades safely against the real DB too. `customer_external_identity`-based identity-conflict visibility (this section's own "not yet done" note below) is now closed by `PR-03A`. `buildNativeCommercialContext` in `lib/brain/commercial/context/buildNativeCommercialContext.ts`, exported from `lib/brain/commercial/context/index.ts`.
- Depends on: `PR-01`, `PR-02`
- Blocks: `PR-04` to `PR-16`

Result:

- the system can read customer, conversation, opportunity, need profile, actions, and relevant history into one context object;
- the context used by the cycle does not depend on legacy tables or shadow-only assumptions.

Technical scope:

- formalize `CommercialContext` / `CommercialContextBuilderInput` as the product-facing boundary;
- reuse `master_customer`, `customer_external_identity`, `conversation`, `conversation_message`, `crm_opportunities`, `crm_sales_need_profiles`, `crm_agent_actions`;
- make the boundary explicit in a reusable service or adapter;
- keep it read-only.

Exclusions:

- no tool execution;
- no outbound;
- no state mutations;
- no UI.

Tests:

- context completeness tests;
- stale-context tests;
- identity-conflict tests;
- integration tests against MariaDB local.

Acceptance:

- one inbound customer thread resolves to one context snapshot that can drive decisions;
- missing context degrades safely.

Risks:

- accidentally reading legacy state;
- overloading context with strategy or execution;
- duplicating opportunity state.

Evidence required:

- context snapshot ids;
- selected source tables;
- completeness status;
- warnings.

Evidence delivered (this slice):

- `buildNativeCommercialContext(input)` returns a `CommercialContext` snapshot (`contractName: "CommercialContext"`, `schemaVersion: "1.0"`) keyed by `conversationPublicId`, sourced only through the existing native loader `loadNativeConversationDetailByPublicId` (`master_customer`, `conversation`, `conversation_message`, `crm_opportunities`, `crm_sales_need_profiles`, `crm_agent_actions`). No legacy `BrainContext`/shadow path is touched.
- Read-only: no INSERT/UPDATE in the new module; `loadConversationDetail` is injectable for tests.
- Completeness vocabulary: `complete | partial | minimal | insufficient`, computed from presence of customer, opportunity, and recent messages.
- Warnings emitted: `conversation_not_found`, `invalid_current_time`, `missing_customer`, `missing_opportunity`, `missing_need_profile`, `missing_recent_messages`, `stale_context` (using the existing 7-day `COMMERCIAL_CONTEXT_STALE_THRESHOLD_MS`), `human_owner_active`, `ai_blocked`.
- Tests: `tests/commercial/buildNativeCommercialContext.test.ts` — 5 injected-dependency unit tests (not_found, invalid time, degrade-safely/minimal completeness, stale context, human-owner/ai-blocked signals) pass deterministically without a DB. A 6th integration test reuses `processNativeWhatsAppInbound` (same pattern as `tests/native/native-whatsapp.test.ts`) to seed a real thread and read it back; it is blocked locally by a pre-existing MariaDB credential issue (`Access denied for user 'crm_app'@...`) that affects the already-merged native-whatsapp/commercial-event suites identically, not by this change.
- Not yet done: PR-03 also lists `customer_external_identity` as a reusable source and an explicit identity-conflict test against real divergent identities; the current native loader resolves identity through `master_customer`/`customer_external_identity` upstream (in `resolveOrPersistNativeExternalIdentity`) but does not yet surface a multi-identity conflict signal inside the context snapshot itself. Carved out as `PR-03A`.

### PR-03A - Identity conflict safety

- ID: `PR-03A`
- Title: `Detect and surface identity conflicts instead of silently picking a customer`
- Capacity: `identity safety`
- Priority: `high`
- Status: **accepted**. `resolveOrPersistNativeExternalIdentity` (`lib/brain/native-whatsapp/service.ts`) checks `findDistinctCustomersByNormalizedValue` (new, `lib/integrations/customer-external-identity/repository.ts`) before any normalized-value lookup; when a normalized value (e.g. phone) already links to more than one distinct customer, it returns `customer: null` plus a structured `identityConflict` (`type: "divergent_identity_links"`, candidate customer ids) instead of silently picking one. A second check compares the freshly resolved customer against the conversation's already-stored `customer_id`; a mismatch raises `type: "customer_conversation_mismatch"`, forces `customer: null` for that turn, and `createOrUpdateNativeConversation`'s existing `COALESCE(VALUES(customer_id), customer_id)` preserves the prior link rather than silently overwriting it. Both signals propagate into `processNativeWhatsAppInbound`'s `identityWarnings`/`identityConflict` and into `auditLog` (new action `customer.identity_conflict`). All 6 required scenarios pass against the real local DB in `tests/native/identity-conflict.test.ts`.
  - **Block is real, not a warning**: in every conflict case `result.customerId === null` and `result.customer === null` — verified by direct assertion in the tests and live (see below). No code path resolves a customer when a conflict is open.
  - **Visible to future `CommercialContext` consumers** (closes `PR-03`'s open item): `buildNativeCommercialContext` independently re-derives the same conflict by calling `findDistinctCustomersByNormalizedValue` against the conversation's `externalContactId` and comparing against its resolved `customer`; exposes `identityConflict`, `signals.identityConflict`, and the two new warning codes. 3 new tests in `tests/commercial/buildNativeCommercialContext.test.ts`.
  - **Live, independent proof** (architecture-owner review, real app + real DB, not mocks): seeded two `customer_external_identity` rows for one phone number pointing at two different real customers (ids 21/22), sent a fresh inbound from that number through `processNativeWhatsAppInbound` directly -> `customerId: null`, `identityConflict.candidateCustomerIds: [21, 22]`; then ran `buildNativeCommercialContext` against the resulting real `conversationPublicId` -> independently reproduced the **same** `identityConflict.candidateCustomerIds: [21, 22]` and `signals.identityConflict: true`; `hub_audit_log` shows real `customer.identity_conflict` rows for this and prior runs (ids 26, 18, 16).
- Side fix discovered while writing the human-resolution/audit-trail test, formalized in this review (see "Audit log" below): `auditLog()` (`lib/audit.ts`) called `ensureAuditTable()` (`CREATE TABLE IF NOT EXISTS`) unconditionally even after confirming the table already exists, and `crm_app`'s minimal grants (correctly) deny `CREATE` — so every audit write was silently failing before this work (logged as `audit_log_failed`, swallowed, no row written). Removed the redundant call; **no new grants were added** — the fix reduces privileged operations, it does not request more. Policy decided explicitly: audit logging degrades on failure (catches, logs `audit_log_failed` to console, never throws) and must never block or roll back a commercial/native write that already succeeded, consistent with ADR-002/ADR-007 (observability is not commercial truth, technical failures must not abandon the customer). Verified by two new tests in `tests/native/audit-log.test.ts`: a direct successful write (row appears in `hub_audit_log`), and an injected failure (circular JSON in `after`) that is caught, logged, does not throw, and leaves no partial row.
- Depends on: `PR-03`, `INFRA-01` (needed to run its real-DB tests)
- Blocks: any commercial decision that the cycle (`PR-04`+) would make based on an unresolved/ambiguous identity.

Result:

- when inbound identity resolution (`resolveOrPersistNativeExternalIdentity` and the underlying `customer_external_identity`/`master_customer` lookups) finds more than one plausible, non-equivalent customer for the same inbound signal, that conflict is detected and surfaced structurally — not silently resolved by picking the first/most-recent match;
- `CommercialContext`/the resolution result carries an explicit conflict signal (e.g. `identityConflict: true` plus the candidate ids and the reason) instead of only the boolean `identity_conflict` heuristic already partially present in the legacy `buildCommercialContext` adapters;
- commercial decisions that depend on identity (anything PR-04+ builds on top of `CommercialContext`) must treat an identity conflict as a hard block, not a warning to ignore.

Technical scope:

- inspect `resolveOrPersistNativeExternalIdentity` (`lib/brain/native-whatsapp/service.ts`), `findExternalIdentityByProviderExternalId`/`findExternalIdentityByNormalizedValue`/`upsertExternalIdentity` (`lib/integrations/customer-external-identity`), and `master_customer` lookups;
- define what "conflict" means precisely: (a) the same external id maps to two different `customer_id`s across `customer_external_identity` rows, (b) the provider id and the normalized-value lookup resolve to two different existing customers, (c) the conversation's stored `customer_id` disagrees with the customer the current inbound message would resolve to;
- add a structured conflict result (candidates, reason, detected-at) propagated into `buildNativeCommercialContext`'s `signals`/`warnings` (extending, not duplicating, the existing `NativeCommercialContextWarning` vocabulary);
- when a conflict is detected, do not auto-merge or auto-pick; require a human-resolvable trail (audit log entry/escalation-shaped warning) sufficient for an operator to act, per ADR-007's escalation model — implementing the actual escalation workflow itself is out of scope here, only the signal and trace.

Exclusions:

- no automatic merge/dedupe of customers;
- no new escalation UI;
- no changes to opportunity/decision/action lifecycle (that's PR-04+).

Tests (unit + integration against real DB once `INFRA-01` lands):

- unambiguous identity (single matching external identity) resolves cleanly, no conflict signal;
- nonexistent identity (first contact) persists an unresolved external identity with customer_id = NULL, no conflict;
- duplicate-but-equivalent identities (same customer linked twice, e.g. two `customer_external_identity` rows pointing at the same `customer_id`) — no conflict;
- divergent identities (same external id historically linked to two different customers) — conflict signal raised, no silent pick;
- conflict between the conversation's stored `customer_id` and the customer the current inbound would resolve to — conflict signal raised;
- human resolution path: once an operator/process disambiguates (e.g. updates the identity link), the next resolution is clean again, and the prior conflict is still visible in the trail (not erased).

Acceptance:

- no test or real-DB run ever returns a resolved customer silently when two non-equivalent customers were genuinely plausible;
- every conflict case produces a warning/signal an operator can act on, with enough identifying detail (candidate customer ids, the external id involved) to investigate.

Risks:

- false positives blocking legitimate continuing conversations if the conflict definition is too aggressive;
- performance cost of extra lookups on every inbound message;
- conflating "missing data" (no identity yet) with "conflicting data" (two incompatible identities) — these must stay distinct signals.

Evidence required:

- the structural conflict signal shape;
- test matrix results for the six scenarios above against the real local DB;
- at least one captured example of the warning/audit trail an operator would see.

### PR-04 - Freeze opportunity lifecycle and terminality

- ID: `PR-04`
- Title: `Freeze opportunity lifecycle, stage transitions, and terminality`
- Capacity: `opportunity lifecycle`
- Priority: `high`
- Depends on: `PR-03`
- Blocks: `PR-05` to `PR-16`

Result:

- one opportunity can be created, recovered, updated, and closed with explicit terminal behavior;
- the system does not create duplicate opportunities for the same commercial path.

Technical scope:

- align `crm_opportunities` behavior with one target lifecycle;
- document and enforce transition rules;
- decide how `status`, `stage`, `waitingFor`, `nextActionType`, `nextActionDueAt`, `humanOwnerActive`, and `aiBlocked` interact;
- add or tighten DB-level uniqueness or service-level idempotency if needed.

Exclusions:

- no recommendation yet;
- no tool registry expansion;
- no follow-up execution.

Tests:

- create/reuse opportunity tests;
- terminal transition tests;
- duplicate opportunity prevention tests;
- state regression tests.

Acceptance:

- a second inbound turn reuses the same active opportunity when it should;
- terminal opportunities do not reopen silently.

Risks:

- conflicting definitions of status versus stage;
- terminal states reopening by accident;
- dual control fields diverging.

Evidence required:

- opportunity ids;
- key uniqueness;
- transition logs;
- terminal state proof.

### PR-05 - Freeze Next Best Action and decision persistence

- ID: `PR-05`
- Title: `Persist a single Next Best Action per cycle`
- Capacity: `next best action`
- Priority: `high`
- Depends on: `PR-04`
- Blocks: `PR-06` to `PR-16`

Result:

- every commercial cycle persists one primary next action and its cancellation conditions;
- `crm_agent_actions` is the durable action source;
- `brain_message_outbox` is transport only;
- `crm_opportunities.next_action_*` is a projection;
- `crm_agent_decisions.next_action_json` remains historical evidence.

Technical scope:

- formalize `NextBestAction`;
- align `crm_agent_decisions.next_action_json` with the product contract;
- treat `crm_agent_actions` as the durable execution target;
- keep `brain_message_outbox` downstream from the action boundary;
- preserve one-action-per-cycle semantics.

Exclusions:

- no tool execution yet;
- no catalog change;
- no outbound send path.

Tests:

- next-action validation tests;
- single-action-per-cycle tests;
- cancellation condition tests;
- decision persistence tests.

Acceptance:

- exactly one primary next action exists for a cycle;
- the same inbound does not create duplicate decisions.

Risks:

- double-writing next action in opportunity and decision tables;
- action duplication;
- approval ambiguity.

Evidence required:

- decision id;
- next action JSON;
- associated opportunity id;
- idempotency key.

### PR-06 - Establish tool execution foundation

- ID: `PR-06`
- Title: `Create the governed tool execution foundation`
- Capacity: `tool execution`
- Priority: `high`
- Depends on: `PR-05`
- Blocks: `PR-07` to `PR-16`

Result:

- tools can be requested, validated, executed, timed out, and audited through one boundary;
- unavailable tools stay unavailable.

Technical scope:

- normalize tool request/result contracts;
- create or reconcile a tool registry;
- add authorization and timeout handling;
- connect audit records;
- keep direct side effects outside the agent runtime.

Exclusions:

- no actual catalog or customer tools yet;
- no new WhatsApp send capability;
- no UI beyond minimal diagnostics if needed.

Tests:

- allow/deny tool request tests;
- timeout tests;
- audit trail tests;
- unknown-tool rejection tests.

Acceptance:

- a tool request cannot bypass backend validation;
- blocked tools remain blocked.

Risks:

- tool registry drift;
- fake tools being exposed as real;
- agent bypassing the command boundary.

Evidence required:

- tool request id;
- tool result id;
- audit row;
- blocked/allowed decision.

### PR-07 - Implement customer and context tools

- ID: `PR-07`
- Title: `Implement customer and context tools on MariaDB local`
- Capacity: `customer and context tools`
- Priority: `high`
- Depends on: `PR-06`
- Blocks: `PR-10` to `PR-16`

Result:

- the system can read customer, conversation, opportunity, profile, and recent interactions through real tools.

Technical scope:

- implement the context tools declared in the backlog as real functions or command handlers;
- reuse the native MariaDB tables and read models;
- keep the tools read-only.

Exclusions:

- no catalog search;
- no recommendations;
- no outbound.

Tests:

- MariaDB integration tests;
- read-only contract tests;
- current-state tests against native conversation view.

Acceptance:

- each tool returns live local data and not fixtures.

Risks:

- reading from the wrong source of truth;
- duplicating context logic;
- exposing mutable behavior in read tools.

Evidence required:

- tool outputs;
- table queries;
- conversation/opportunity ids.

### PR-08 - Implement catalog tools

- ID: `PR-08`
- Title: `Implement real catalog tools and a single catalog boundary`
- Capacity: `catalog tools`
- Priority: `high`
- Depends on: `PR-06`
- Blocks: `PR-09` to `PR-16`

Result:

- the system can search products, read price, stock, dimensions, compatibility, and related items from one catalog boundary.

Technical scope:

- define a `CatalogService`;
- connect the service to the current Prestashop adapter or a real read-only snapshot source;
- make source of truth explicit for product data;
- keep direct catalog access out of the decision engine.

Exclusions:

- no recommendation scoring yet;
- no objection handling;
- no WhatsApp changes.

Tests:

- product search tests;
- price/stock/dimensions/compatibility tests;
- negative tests for unavailable products.

Acceptance:

- the recommendation pipeline can ask the catalog and get real values.

Risks:

- stale catalog data;
- incompatible source of truth;
- catalog access through free-text prompting instead of a service.

Evidence required:

- product ids;
- price values;
- stock values;
- compatibility evidence.

### PR-09 - Introduce strategy selection foundation

- ID: `PR-09`
- Title: `Select a commercial strategy before recommending`
- Capacity: `strategy selection`
- Priority: `medium-high`
- Depends on: `PR-07`, `PR-08`
- Blocks: `PR-10` to `PR-16`

Result:

- the AI planning layer can select and propose a commercial strategy before deciding the next action, and the Brain validates schema, data, capabilities, policies, and execution feasibility.

Technical scope:

- introduce a `CommercialStrategy` contract;
- map current consultative signals to strategies like discovery, qualification, consultative recommendation, budget-focused recommendation, objection recovery, purchase acceleration, low-pressure follow-up, dormant recovery, and human escalation;
- keep deterministic rules as safe fallback and validation, not as the normal commercial brain.

Exclusions:

- no final recommendation text yet;
- no outbound send;
- no UI.

Tests:

- strategy selection unit tests;
- signal-to-strategy mapping tests;
- fallback strategy tests.

Acceptance:

- the AI planning layer proposes a strategy that the Brain can validate or reject safely, with fallback only when policy or execution constraints require it.

Risks:

- strategy overfitting;
- vague strategy names;
- leaking execution details into strategy.

Evidence required:

- selected strategy;
- input signals;
- fallback reason when used.

### PR-10 - Implement recommendation capability

- ID: `PR-10`
- Title: `Recommend one main product, one alternative, and relevant complements`
- Capacity: `recommendation`
- Priority: `high`
- Depends on: `PR-08`, `PR-09`
- Blocks: `PR-11` to `PR-16`

Result:

- the system filters candidates, scores them, selects one main product, one alternative, and only strict complements.

Technical scope:

- use hard filters, scoring, and validation;
- allow the AI to choose and explain only among eligible candidates returned by `CatalogService`;
- never select outside the validated candidate set;
- surface trade-offs and evidence from catalog data.

Exclusions:

- no discount creation;
- no checkout mutations;
- no voice.

Tests:

- recommendation with incomplete information;
- budget-constrained recommendation;
- space-constrained recommendation;
- alternative and complement correctness tests.

Acceptance:

- a valid recommendation is based on real catalog data, stays inside the validated candidate set, and can be explained.

Risks:

- free-text product selection;
- recommending invalid or incompatible products;
- too many alternatives or complements.

Evidence required:

- candidate list;
- scores;
- main recommendation;
- alternative recommendation;
- complement list.

### PR-11 - Implement objection management

- ID: `PR-11`
- Title: `Persist and respond to objections`
- Capacity: `objection management`
- Priority: `high`
- Depends on: `PR-10`
- Blocks: `PR-12` to `PR-16`

Result:

- objections are detected, persisted, and used to choose the next action.

Technical scope:

- persist objection type and description;
- update opportunity state based on objection;
- generate alternative and trade-off when appropriate;
- keep discounting out of scope.

Exclusions:

- no discount tool;
- no inventory reservation;
- no order modification.

Tests:

- price objection;
- stock objection;
- delivery objection;
- competitor objection;
- unknown objection.

Acceptance:

- the objection is not only answered; it also changes state and future action.

Risks:

- treating objection as mere text reply;
- losing the objection history;
- inventing compensations or discounts.

Evidence required:

- objection row;
- updated opportunity;
- alternative recommendation or follow-up decision.

### PR-12 - Implement follow-up lifecycle

- ID: `PR-12`
- Title: `Create, schedule, cancel, expire, and execute follow-ups`
- Capacity: `follow-up lifecycle`
- Priority: `high`
- Depends on: `PR-11`
- Blocks: `PR-13` to `PR-16`
- Reconciliation note (2026-07-14): a follow-up runtime exists today and is partially wired end to end (worker, `crm_agent_actions`, re-entry into `runNativeAutonomousCycle`, outbox), but built through `lib/brain/commercial/sales-consultative/**` rather than a dedicated PR-12 implementation, and it carries real P0 gaps (hardcoded attempt/policy fields, no stale-lock recovery, contact policy not enforced at write time). This PR entry is not marked accepted by this note. Full findings, gap list and next steps: `docs/audits/follow-up-runtime-reconciliation.md`.
- Governance note (2026-07-14): this PR's remaining work (consolidation and hardening, not new scope) is now governed by `ACS-R1-05` - Autonomous Follow-up Runtime (`docs/releases/ACS-R1-05-autonomous-follow-up-runtime.md`), tasks `ACS-R1-05-T01` to `ACS-R1-05-T07`. `PR-12` itself stays a historical backlog entry, not an active task queue.

Result:

- follow-up actions become durable, cancelable, executable, and auditable.

Technical scope:

- make `crm_agent_actions` the follow-up lifecycle boundary;
- add scheduling and cancellation logic;
- ensure inbound posterior cancels pending follow-up;
- connect handoff and AI-blocked states to cancellation.

Exclusions:

- no voice;
- no marketing automation;
- no non-governed outbound.

Tests:

- schedule follow-up;
- cancel on inbound reply;
- expire when due and invalid;
- block when handoff or AI blocked;
- execute once only.

Acceptance:

- a follow-up is canceled on a later customer reply and never sends twice.

Risks:

- duplicate follow-up sends;
- stale locked actions;
- action state diverging from opportunity state.

Evidence required:

- action id;
- scheduling timestamp;
- cancel reason;
- executed or canceled status.

### PR-13 - Build the commercial cycle orchestrator

- ID: `PR-13`
- Title: `Orchestrate Observe -> Understand -> Evaluate -> Plan -> Act -> Measure -> Update`
- Capacity: `commercial cycle orchestrator`
- Priority: `high`
- Depends on: `PR-02` to `PR-12`
- Blocks: `PR-14` to `PR-16`
- Reconciliation note (2026-07-14): `runNativeAutonomousCycle` (`lib/brain/commercial/native-cycle/`) is a real, connected orchestrator - confirmed as the actual re-entry point the follow-up worker calls, not a stub. See `docs/audits/follow-up-runtime-reconciliation.md` for the verified connection and its remaining gaps downstream (outbox, delivery outcomes).

Result:

- one cycle can read the event, derive context, choose strategy, pick next action, execute through tools/commands, measure result, and update state.

Technical scope:

- compose the frozen contracts instead of creating a monolith;
- keep each step independently testable;
- ensure the cycle can be run without legacy dependencies.

Exclusions:

- no new channel adapter yet;
- no new UI beyond minimum logs if needed.

Tests:

- end-to-end in-memory orchestrator tests;
- step-level regression tests;
- failure isolation tests.

Acceptance:

- the cycle can run from an event to an updated opportunity/action outcome.

Risks:

- monolithic orchestrator;
- duplicate side effects;
- making the orchestrator the owner of every other contract.

Evidence required:

- cycle result;
- step outputs;
- persisted state changes.

### PR-14 - Integrate the WhatsApp adapter

- ID: `PR-14`
- Title: `Wire Meta WhatsApp inbound and outbound into the autonomous commercial loop`
- Capacity: `WhatsApp adapter integration`
- Priority: `highest`
- Depends on: `PR-13`
- Blocks: `PR-15` to `PR-16`

Result:

- a real Meta inbound event becomes a commercial event and a commercial action becomes outbox + worker + timeline state.

Technical scope:

- keep the webhook adapter natively connected;
- preserve allowlist and fail-closed flags;
- ensure outbound uses outbox, worker, Meta adapter, provider_message_id, and timeline projection;
- no direct send from the agent or UI.

Exclusions:

- no new channel;
- no direct WhatsApp tool;
- no loosening of side-effect flags.

Tests:

- inbound duplicate suppression;
- outbox duplicate suppression;
- provider status projection;
- allowlist rejection;
- fail-closed flag tests.

Acceptance:

- a real WhatsApp event can traverse the native loop without legacy runtime.

Risks:

- accidental direct send;
- allowlist misconfiguration;
- provider/timeline divergence.

Evidence required:

- webhook event ids;
- outbox ids;
- provider_message_id;
- timeline row ids.

### PR-15 - Deliver minimum operational UI

- ID: `PR-15`
- Title: `Show conversation, opportunity, profile, strategy, next action, tools, and outcomes in UI`
- Capacity: `UI operational minimum`
- Priority: `medium-high`
- Depends on: `PR-13`, `PR-14`
- Blocks: `PR-16`

Result:

- operators can inspect the native commercial loop without using technical scripts.

Technical scope:

- adapt the existing conversation and opportunity surfaces;
- show inbound/outbound timeline, profile, decision, action, handoff, and AI state;
- keep the UI read-only or guarded where needed.

Exclusions:

- no new product simulator;
- no fake fixtures presented as real;
- no execution from UI without governance.

Tests:

- page render tests;
- read-model tests;
- no-fixture regression tests.

Acceptance:

- the native loop is visible and traceable from the UI.

Risks:

- UI based on stale or mixed sources;
- exposing fixture data as real;
- operator controls that bypass backend validation.

Evidence required:

- screenshots or rendered markup;
- conversation and opportunity ids;
- visible state fields.

### PR-16 - First vertical end-to-end

- ID: `PR-16`
- Title: `Complete the first vertical from WhatsApp inbound to follow-up and strategy update`
- Capacity: `first vertical`
- Priority: `highest`
- Depends on: `PR-01` to `PR-15`
- Blocks: none

Result:

- the system handles: customer consults -> system understands -> opportunity created -> need discovered -> catalog queried -> recommendation made -> objection handled -> follow-up created -> result measured -> strategy updated.

Technical scope:

- use the already-frozen contracts and services;
- keep one outbound pipeline for AI SDR and follow-up;
- prove the flow with real local DB and real or controlled WhatsApp integration.

Exclusions:

- no voice;
- no marketing automation;
- no multi-tenant rewrite.

Tests:

- full vertical integration tests;
- duplicate-event regression tests;
- follow-up cancellation tests;
- handoff tests;
- UI evidence tests.

Acceptance:

- the first vertical can be demonstrated end-to-end with no legacy runtime dependency.

Risks:

- route fragmentation;
- duplicate opportunity or action creation;
- recommendation using fake data;
- follow-up not canceled by inbound.

Evidence required:

- inbound id;
- customer id;
- conversation id;
- opportunity id;
- profile id;
- decision id;
- action id;
- outbox id;
- provider_message_id;
- timeline row id;
- follow-up cancellation or execution proof.

## 4. Dependency graph

```mermaid
flowchart TD
  PR01[PR-01 Domain vocabulary] --> PR02[PR-02 CommercialEvent]
  PR01 --> PR03[PR-03 CommercialContext]
  PR01 --> PR04[PR-04 Opportunity lifecycle]
  PR02 --> PR13[PR-13 Orchestrator]
  PR03 --> PR13
  PR04 --> PR05[PR-05 Next Best Action]
  PR05 --> PR06[PR-06 Tool foundation]
  PR06 --> PR07[PR-07 Customer/context tools]
  PR06 --> PR08[PR-08 Catalog tools]
  PR07 --> PR09[PR-09 Strategy selection]
  PR08 --> PR09
  PR09 --> PR10[PR-10 Recommendation]
  PR10 --> PR11[PR-11 Objections]
  PR11 --> PR12[PR-12 Follow-ups]
  PR12 --> PR13
  PR13 --> PR14[PR-14 WhatsApp adapter]
  PR14 --> PR15[PR-15 UI minimum]
  PR15 --> PR16[PR-16 First vertical]
```

## 5. Parallelizable blocks

### Block A

- Owner: Codex
- PRs: `PR-07` and `PR-08`
- Allowed files:
  - `lib/brain/commercial/*` tool adapters that do not touch global contracts
  - `lib/integrations/*` for read-only adapters
- Shared files:
  - `docs/product/autonomous-commerce-tool-catalog.md`
  - `docs/product/autonomous-commerce-state-model.md`
- Frozen contracts:
  - `CommercialContext`
  - `ToolRequest`
  - `ToolResult`
- Restrictions:
  - no tool registry edits in both PRs at once;
  - no `processInbound` changes;
  - no state table changes.
- Merge order: `PR-07` first, then `PR-08`.

### Block B

- Owner: Claude Code
- PRs: `PR-10` and `PR-11`
- Allowed files:
  - consultative recommendation and objection modules only
- Shared files:
  - `lib/brain/commercial/sales-consultative/*`
  - `docs/product/autonomous-commerce-capability-map.md`
- Frozen contracts:
  - `CommercialStrategy`
  - `NextBestAction`
- Restrictions:
  - no follow-up lifecycle edits;
  - no outbox changes;
  - no direct UI work.
- Merge order: `PR-10`, then `PR-11`.

### Block C

- Owner: Codex
- PRs: `PR-14` and `PR-15`
- Allowed files:
  - webhook adapter / outbox projection files for `PR-14`
  - read-only UI files for `PR-15`
- Shared files:
  - `docs/product/autonomous-commerce-first-vertical.md`
  - `docs/product/autonomous-commerce-current-state.md`
- Frozen contracts:
  - `CommercialEvent`
  - `ConversationState`
  - `OpportunityState`
- Restrictions:
  - no direct send bypass;
  - no mixing adapter and UI in the same PR;
  - no schema changes in both at once.
- Merge order: `PR-14` before `PR-15`.

### Not parallel by design

- `PR-01`, `PR-02`, `PR-03`, `PR-04`, `PR-05`, `PR-06`, `PR-12`, `PR-13`, `PR-16` should be serialized because they touch shared contracts, state, or orchestration boundaries.

## 6. First batch selected

Selected first batch: `PR-01`, `PR-02`, `PR-03`, `PR-04`

Reason:

- they freeze the language;
- they define the event boundary;
- they build the context boundary;
- they stabilize opportunity ownership before any tool or outbound work.

### PR-01 prompt

Branch suggestion: `autocomm/pr-01-domain-vocabulary`

Prompt:

> Freeze the commercial vocabulary and accepted ownership model. Align the docs so the repo has one explicit target vocabulary, one explicit legacy vocabulary, and one owner per durable concept, using ADR-001 through ADR-007 as already accepted boundaries. Freeze `AIPlan`, `CapabilityEvaluation`, `CommercialEvent`, `CommercialCycleResult`, `ToolRequest`, `ToolResult`, `CRMCommand`, `ActionOutcome`, `NextBestAction`, `CommercialContext`, `OpportunityState`, `ConversationState`, `AIProposal`, `AcceptedCommercialDecision`, `CommercialAction`, `ActionExecution`, `Escalation`, `ReactivationContext`, `CommercialQuote`, and `ExpectedOutcome` as documented contracts without reopening ownership. Do not modify runtime code, migrations, or tool availability. Update only the documented contracts and make the current/target split unambiguous.

Files allowed:

- `docs/architecture/adr/ADR-001-commercial-vs-ai-decisions.md`
- `docs/architecture/adr/ADR-002-ai-runtime-observability-boundary.md`
- `docs/architecture/adr/ADR-003-commercial-action-source-of-truth.md`
- `docs/architecture/adr/ADR-004-next-best-action-ownership.md`
- `docs/architecture/adr/ADR-005-catalog-boundary.md`
- `docs/architecture/adr/ADR-006-autonomous-planning-and-capability-governance.md`
- `docs/architecture/adr/ADR-007-failure-escalation-and-outcomes.md`
- `docs/product/autonomous-commerce-current-state.md`
- `docs/product/autonomous-commerce-capability-map.md`
- `docs/product/autonomous-commerce-tool-catalog.md`
- `docs/product/autonomous-commerce-state-model.md`
- `docs/product/autonomous-commerce-authority-matrix.md`
- `docs/product/autonomous-commerce-roadmap.md`
- `docs/product/autonomous-commerce-first-vertical.md`
- `docs/product/autonomous-commerce-implementation-backlog.md`

Tests required:

- doc consistency review;
- search-based verification for tool/state names.

Criteria:

- the docs can answer what is target, what is legacy, what is accepted, and what is still pending without reopening the ADRs.

Merge order:

- first.

### PR-02 prompt

Branch suggestion: `autocomm/pr-02-commercial-event`

Prompt:

> Introduce a normalized `CommercialEvent` boundary for inbound, outbound, status, and internal commercial events. The result must be a real event envelope with idempotency and correlation ids, but it must not contain strategy, recommendation, or outbound send logic. Consume the frozen contracts from PR-01 instead of redefining ownership or action semantics. Keep the change narrowly scoped to event normalization and persistence.

Files allowed:

- event normalization and persistence modules only
- webhook adapter glue if needed
- event-related tests

Tests required:

- event normalization unit tests;
- duplicate suppression tests;
- database integration test.

Criteria:

- one inbound event becomes one normalized commercial event, and a duplicate inbound does not create a second event.

Merge order:

- second.

### PR-03 prompt

Branch suggestion: `autocomm/pr-03-commercial-context`

Prompt:

> Build the commercial context read model used by the autonomous commerce cycle. Read customer, conversation, opportunity, profile, recent interactions, and actions from native tables and expose them through one read-only boundary. Do not call tools that mutate state or query legacy fallbacks.

Files allowed:

- commercial context builder and adapter modules
- read-only repository modules
- context tests

Tests required:

- completeness tests;
- stale context tests;
- identity conflict tests;
- integration tests on local MariaDB.

Criteria:

- one inbound thread can be summarized into one safe commercial context snapshot.

Merge order:

- third.

### PR-04 prompt

Branch suggestion: `autocomm/pr-04-opportunity-lifecycle`

Prompt:

> Freeze the opportunity lifecycle. Make creation, recovery, updates, terminality, and deduplication deterministic and explicit. Clarify the interaction between opportunity status, stage, next action, waiting state, and AI/human controls. Do not add recommendation or tool execution in this PR.

Files allowed:

- opportunity lifecycle modules
- opportunity tests
- related read-model adjustments only

Tests required:

- opportunity create/reuse tests;
- terminal transition tests;
- duplicate prevention tests;
- regression tests for stage/status mapping.

Criteria:

- the same commercial path reuses the same opportunity, and terminal opportunities do not reopen silently.

Merge order:

- fourth.

## 7. Files modified by this documentation step

- `docs/architecture/adr/ADR-001-commercial-vs-ai-decisions.md`
- `docs/architecture/adr/ADR-002-ai-runtime-observability-boundary.md`
- `docs/architecture/adr/ADR-003-commercial-action-source-of-truth.md`
- `docs/architecture/adr/ADR-004-next-best-action-ownership.md`
- `docs/architecture/adr/ADR-005-catalog-boundary.md`
- `docs/product/autonomous-commerce-tool-catalog.md`
- `docs/product/autonomous-commerce-first-vertical.md`
- `docs/product/autonomous-commerce-state-model.md`
- `docs/product/autonomous-commerce-implementation-backlog.md`
- `docs/product/autonomous-commerce-implementation-backlog.md`
