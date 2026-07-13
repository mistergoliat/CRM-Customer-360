# Customer Identity Onboarding Architecture

> **superseded_by**: [customer-onboarding-identity-contract](../data/customer-onboarding-identity-contract.md), [customer-creation-linking-authority-contract](../data/customer-creation-linking-authority-contract.md) and the [ACS-R1-04 release spec](../releases/ACS-R1-04-customer-identity-onboarding.md) (`ACS-R1-04-T06.2`). This doc predates T06.2's reconciliation: it describes `crm_customer_onboarding` as durable truth for onboarding lifecycle, which is wrong - that table is legacy (P1M/local-ai-sdr) and not canonical. The canonical model is `customer_external_identity` (may be unresolved) + `crm_customer_onboarding_state`/`CustomerOnboardingService` for onboarding + Customer Service Port/Capability Gateway for creation and linking. Kept only as a historical record of PR #43's original (unreconciled) intent.

## Boundary

The identity boundary separates:

- external contact identity;
- durable customer master;
- conversation linkage;
- onboarding lifecycle;
- address ownership.

WhatsApp does not imply a customer account.

## Source of truth

Durable truth is split by concern:

- `customer_external_identity` holds provider identities and may be unresolved.
- `crm_customer_onboarding` holds lifecycle state and consent evidence.
- `master_customer` is only created from exact email + positive consent.
- `conversation.customer_id` is nullable.
- `crm_opportunities.customer_master_id` is nullable.
- `customer_addresses` stores many addresses per customer.

## Invariants

- no `master_customer` without real email;
- no `master_customer` without consent when no account exists;
- no silent customer choice on conflict;
- no fake local domain email;
- address selection is not confirmation;
- no shipping/dispatch without a confirmed address.

## Transaction rules

Creation and linkage must be transactional or idempotent:

- create or reuse external identity;
- create or reuse customer onboarding state;
- search exact email;
- create customer only after consent;
- link conversation and active opportunity only if safe;
- emit durable evidence after commit.

## Error handling

- conflict must stay visible;
- infrastructure errors must not collapse into `not_found`;
- unresolved identity must keep the conversation usable;
- retries must not duplicate customers or identities.

## Rollout

The feature can be gated temporarily, but the target architecture is:

- unresolved external identity first;
- email resolution second;
- consent third;
- customer creation fourth;
- address confirmation before fulfillment.

