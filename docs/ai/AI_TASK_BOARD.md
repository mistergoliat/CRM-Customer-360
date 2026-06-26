# AI Task Board

This file is a fallback coordination record. Prefer GitHub Issues/Projects for live parallel work.

## Rules

- Only the integrator updates canonical status after cross-review.
- Each active task has exactly one owner.
- Two active tasks cannot share allowed paths or semantic ownership.
- Agents submit handoff files rather than editing each other's task summaries.

## Active tasks

| ID | Owner | Status | Branch | Semantic owner | Dependencies |
|---|---|---:|---|---|---|
| AC-PR04 | Claude | READY | `ai/claude/ac-pr04` (not yet created) | Opportunity lifecycle and terminality | PR-03 component verification |
| AC-INFRA-INGRESS | Claude | ACCEPTED | integrated directly on `ADRclaude` (`be00ae9`, `8854ab1`, `54c02bb`); `ai/codex/ac-infra-ingress` was never created | Dev DB bootstrap and WhatsApp ingress | PR-02 integration verification |
| AC-CATALOG | Codex | CHANGES_REQUESTED | `ai/codex/ac-catalog` (rebased onto `ADRclaude`, not merged) | ADR-005 CatalogService and adapters | AC-INFRA-INGRESS dependency satisfied. See `docs/product/autonomous-commerce-review-ac-catalog.md` for required changes. |

## AC-PR04

**Allowed concepts**

- opportunity lifecycle;
- terminal states;
- transition validation;
- lifecycle contract tests;
- integration with native CommercialContext.

**Forbidden concepts**

- webhook authentication;
- Docker/MariaDB bootstrap;
- catalog adapters;
- production deployment;
- changes to accepted ADR text.

**Required evidence**

- transition matrix;
- tests for valid and invalid transitions;
- no silent reopen of won/lost opportunities;
- read-model compatibility;
- build/typecheck/test results.

## AC-INFRA-INGRESS

**Allowed concepts**

- `infra/**`;
- environment contract and examples;
- MariaDB initialization;
- migration smoke tooling;
- WhatsApp webhook route;
- middleware carve-out;
- Meta verification/signature validation;
- duplicate webhook response contract;
- ingress integration tests.

**Forbidden concepts**

- opportunity lifecycle;
- CommercialDecision;
- CommercialAction;
- Next Best Action;
- autonomous planning;
- accepted ADR edits.

**Required evidence**

- bootstrap from empty volume;
- app connects with least-privilege user;
- webhook verification succeeds without admin bypass token;
- unauthentic POST is rejected before persistence;
- duplicate inbound produces one logical message/event;
- timestamps are valid or explicitly absent, never empty strings;
- full commands and results.

## AC-CATALOG

**Allowed concepts**

- `CatalogService`;
- catalog domain models;
- SnapshotCatalogAdapter;
- read-only PrestashopCatalogAdapter;
- contract tests and fixtures;
- provenance, freshness and unknown semantics.

**Forbidden concepts**

- commercial lifecycle;
- direct creation of actions or decisions;
- reservation or inventory writes;
- discount authorization;
- checkout effects;
- accepted ADR edits.
