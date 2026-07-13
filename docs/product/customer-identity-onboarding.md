# Customer Identity Onboarding

## Goal

WhatsApp inbound must not create a fake `master_customer`.

The product rule is:

- WhatsApp contact is an external identity;
- conversation can exist with `customer_id = null`;
- exact email match resolves to an existing customer;
- new customer creation requires explicit consent;
- addresses live separately from `master_customer`.

## Durable model

The repo now uses a split identity model:

- `customer_external_identity` stores provider identities and may be unresolved (`customer_id = null`).
- `crm_customer_onboarding` stores the durable lifecycle of identity resolution and consent.
- `conversation.customer_id` is nullable.
- `crm_opportunities.customer_master_id` remains nullable until identity is resolved.
- `customer_addresses` remains a child table of `master_customer`.

## Lifecycle

### Unknown WhatsApp inbound

- Reuse or create the external identity row.
- Reuse or create the conversation.
- Persist the inbound message.
- Keep `conversation.customer_id = null`.
- Do not create `master_customer`.

### Email capture

- Normalize the email.
- Reject invalid syntax and artificial/internal domains.
- Persist the email as a fact/state update.
- Search exact email matches only.

### Match

- If exactly one customer exists, link the external identity.
- Update `conversation.customer_id` only when safe.
- Update the active opportunity only when it belongs to the same conversation.
- Mark onboarding as matched.

### No match

- Mark onboarding as `creation_permission_requested`.
- Ask for consent before creating a customer.

### Consent

- Consent must include:
  - `email`
  - `sourceMessageId`
  - `grantedAt`
  - `channel`
- Negative consent does not create a customer.

### Creation

- Create `master_customer` only after consent and exact email validation.
- Reuse the existing customer on retry or race.
- Detect conflict if a concurrent customer appeared.
- Link the external identity and update conversation/opportunity if the transaction owns those links.

## Conflicts

- One phone number linked to multiple customers is a conflict.
- The system must not silently choose a winner.
- Conflicts stay visible in onboarding state and audit logs.

## Address rules

- Addresses are owned by a customer.
- `selected` is not `confirmed`.
- Confirmation is required before shipping or dispatch.
- A request must never infer a shipping address automatically.

## Capabilities and events

Read capabilities:

- `find_customer_by_email`
- `get_identity_status`
- `list_customer_addresses`
- `get_customer_address`

Mutation contracts are documented separately and do not live in the read registry.

Relevant events:

- `identity_email_requested`
- `identity_email_provided`
- `identity_match_started`
- `identity_matched`
- `identity_conflict_detected`
- `customer_creation_permission_requested`
- `customer_creation_authorized`
- `customer_creation_rejected`
- `customer_created`
- `external_identity_linked`
- `delivery_address_selected`
- `delivery_address_confirmed`

## Rollout

Temporary flag:

- `BRAIN_IDENTITY_ONBOARDING_ENABLED=false`

The target state is to run the new identity onboarding behavior by default and retire the flag after rollout validation. The flag must not preserve fake customer creation as a permanent fallback.

