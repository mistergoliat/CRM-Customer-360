---
title: Customer Identity Source Mapping & Ownership
doc_id: customer-identity-source-mapping
status: superseded
superseded_by: docs/data/customer-onboarding-identity-contract.md
version: "1.1.0"
owner: architecture
last_reviewed: 2026-07-21
source_of_truth_for: []
depends_on: []
supersedes: []
tags:
  - historical
---

> **SUPERSEDED (2026-07-21).** Companion to `docs/customer-identity-contract.md` (P1J-era resolver), same superseding chain. Kept as historical record; not a reference for new work.

# Customer Identity Source Mapping & Ownership

## Purpose

Define how customer-related sources should be classified, owned, and consumed before any persistent Customer Master implementation.

This document answers one question: who owns which customer signals, and how trustworthy are they for future identity resolution.

## What a source means

A source is any platform, table, channel, or system that delivers data or signals about a customer.

Sources can provide:

- identity
- transactions
- engagement
- operational context
- manual confirmation
- transitional or contaminated records

## Source categories

### System of record objective

The future CRM Customer Master is the system of record objective for centralized customer information.

### High-confidence partial source

A source that is reliable for some identity or transaction signals, but not complete enough to be the final master.

### Engagement source

A source that mainly records interactions, interest, or outreach.

### Transactional source

A source that records purchases, invoices, or order-level facts.

### Transitional source

A source that is temporary, partial, or contaminated, and should eventually be replaced.

### Technical source

A source that exists to move, normalize, or orchestrate data, not to define truth.

### Manual trusted source

A source confirmed by a human operator in the HUB.

## Ownership declarations

- CRM Customer Master future: system of record objective.
- PrestaShop: high-confidence partial source.
- WhatsApp: engagement and lead source.
- HUB operator: manual trusted source.
- AppSheet: transitional / contaminating source.
- n8n: technical transitional source.
- POS general customer: transactional weak source unless identity is captured.
- future email marketing: engagement / campaign source.
- future voice/call tool: engagement / action source with higher sensitivity.

## Source map

### CRM Customer Master future

- Description: future centralized CRM customer master.
- Identifiers: all resolved identities and customer_master_id.
- Can create customer: yes, future write-enabled only.
- Can update customer: yes, future write-enabled only.
- Can attach identity: yes, future write-enabled only.
- Can create timeline event: yes, future write-enabled only.
- Confidence: high by design.
- Coverage: target full coverage across ecommerce, POS, WhatsApp, campaigns, calls, and manual creation.
- Duplicate risk: low if identity policy is respected.
- Ownership: CRM / HUB governance.
- Customer Resolver read-only use: target entity to resolve against, but not yet written.
- Customer Master future use: canonical truth.
- Must not overwrite: source provenance, original identity values, external source ids.

### PrestaShop `ps_customer`

- Description: ecommerce customer table in PrestaShop.
- Identifiers: `id_customer`, verified email, linked customer profile.
- Can create customer: no, not in this phase.
- Can update customer: no, future integration only.
- Can attach identity: yes, conceptually in future resolver.
- Can create timeline event: yes, via future backfill or resolver read model.
- Confidence: high.
- Coverage: partial, approximately 75% of customers by business knowledge.
- Duplicate risk: medium, because it does not cover all channels.
- Ownership: ecommerce / CRM integration.
- Customer Resolver read-only use: strong match source for ecommerce identity.
- Customer Master future use: strong partial source to backfill master.
- Must not overwrite: CRM manual data, source provenance, non-ecommerce customer states.

### PrestaShop `ps_address`

- Description: address and contact data source, including local phone format.
- Identifiers: phone in local format, address fields, contact fields.
- Can create customer: no.
- Can update customer: no.
- Can attach identity: yes, as supporting evidence only.
- Can create timeline event: no direct creation, only backfill context.
- Confidence: medium after normalization.
- Coverage: partial, dependent on profile completeness.
- Duplicate risk: medium to high if phone is used alone.
- Ownership: ecommerce supporting data.
- Customer Resolver read-only use: supporting evidence for phone match.
- Customer Master future use: secondary identity support, not primary master.
- Must not overwrite: verified email, `id_customer`, operator-confirmed data.

### PrestaShop `ps_orders`

- Description: order and transaction records.
- Identifiers: `id_order`, invoice references, order-linked customer ids.
- Can create customer: no direct, but can seed candidates.
- Can update customer: no.
- Can attach identity: yes, strong transactional evidence.
- Can create timeline event: yes, as transactional event seed.
- Confidence: high when sourced from trusted DB.
- Coverage: partial to strong for customers who purchased.
- Duplicate risk: low to medium.
- Ownership: ecommerce transactional data.
- Customer Resolver read-only use: strong anchor for purchase-linked resolution.
- Customer Master future use: high-confidence backfill and timeline seed.
- Must not overwrite: email identity, manual ownership decisions, source provenance.

### WhatsApp / Meta `wa_id`

- Description: inbound engagement identifier from WhatsApp.
- Identifiers: `wa_id`, message ids, phone-number context.
- Can create customer: yes, provisional customer candidate only.
- Can update customer: no.
- Can attach identity: yes, as provisional identity.
- Can create timeline event: yes, as engagement event seed.
- Confidence: medium to high depending on origin.
- Coverage: strong for WhatsApp leads and inquiries.
- Duplicate risk: medium.
- Ownership: conversational engagement.
- Customer Resolver read-only use: lead-hot signal and provisional matching anchor.
- Customer Master future use: attachable identity, not final master by itself.
- Must not overwrite: verified email, ecommerce strong ids, operator-confirmed data.

### `n8n_conversation_cases`

- Description: legacy operational case table.
- Identifiers: case ids, lifecycle references, routing state.
- Can create customer: no.
- Can update customer: no.
- Can attach identity: no, only signal extraction.
- Can create timeline event: yes, as transitional signal.
- Confidence: low to medium.
- Coverage: limited to operational cases.
- Duplicate risk: high if treated as identity truth.
- Ownership: transitional orchestration.
- Customer Resolver read-only use: case-to-customer signal only.
- Customer Master future use: backfill context and history, not canonical identity.
- Must not overwrite: customer identities, ecommerce ids, human-confirmed data.

### `n8n_conversation_messages`

- Description: legacy conversation message history.
- Identifiers: message ids, sender ids, timestamps, text.
- Can create customer: no.
- Can update customer: no.
- Can attach identity: indirectly, by extracting signals.
- Can create timeline event: yes, as historical event seed.
- Confidence: low to medium.
- Coverage: broad for historical conversations.
- Duplicate risk: medium.
- Ownership: technical transitional history.
- Customer Resolver read-only use: backfill timeline and signal extraction.
- Customer Master future use: append history, not truth source.
- Must not overwrite: stronger ecommerce or human-confirmed identities.

### `n8n_wa_inbound_messages`

- Description: WhatsApp inbound signal table.
- Identifiers: `wa_id`, message ids, inbound metadata.
- Can create customer: yes, provisional candidate only.
- Can update customer: no.
- Can attach identity: yes, provisional.
- Can create timeline event: yes.
- Confidence: medium.
- Coverage: strong for inbound WhatsApp leads.
- Duplicate risk: medium.
- Ownership: technical transitional inbound capture.
- Customer Resolver read-only use: lead creation and candidate matching.
- Customer Master future use: seed candidate creation.
- Must not overwrite: email, PrestaShop ids, operator-confirmed data.

### AppSheet cotizaciones future/transitional

- Description: current or future quotation capture source.
- Identifiers: app-specific quote ids, customer fields, contact fields.
- Can create customer: yes, provisional only, and only if future policy allows.
- Can update customer: no, not as truth source.
- Can attach identity: yes, but not dominant.
- Can create timeline event: yes, as quote-origin signal.
- Confidence: low to medium.
- Coverage: transitional and partial.
- Duplicate risk: high.
- Ownership: temporary operations / migration.
- Customer Resolver read-only use: import-like candidate source.
- Customer Master future use: replace only after policy and ownership are defined.
- Must not overwrite: stronger CRM, ecommerce, or operator-confirmed data.

### HUB operator / manual

- Description: human operator actions in HUB.
- Identifiers: operator id, manual confirmation, reviewed data.
- Can create customer: yes, future write-enabled and manual trusted.
- Can update customer: yes, with controlled governance.
- Can attach identity: yes.
- Can create timeline event: yes.
- Confidence: high when confirmed.
- Coverage: whenever the operator has context.
- Duplicate risk: low if review policy is used.
- Ownership: CRM operations.
- Customer Resolver read-only use: highest-trust conflict resolution signal.
- Customer Master future use: manual create and explicit conflict resolution.
- Must not overwrite: stronger provenance without review, source data, audit trail.

### POS physical general customer

- Description: in-store or physical POS sale where customer may buy as general customer.
- Identifiers: transaction ids, optional email, optional phone.
- Can create customer: no, not without identity.
- Can update customer: no.
- Can attach identity: yes, if email or phone captured.
- Can create timeline event: yes, as transaction event if linkable.
- Confidence: low unless identity is captured.
- Coverage: physical store transactions.
- Duplicate risk: medium.
- Ownership: retail / POS integration.
- Customer Resolver read-only use: weak transaction signal unless identity exists.
- Customer Master future use: transaction context, not identity by itself.
- Must not overwrite: stronger customer identities and operator-confirmed records.

### Future email marketing

- Description: future email engagement and campaign source.
- Identifiers: email, campaign ids, message ids, engagement events.
- Can create customer: no by itself.
- Can update customer: no.
- Can attach identity: yes, as engagement evidence.
- Can create timeline event: yes.
- Confidence: medium.
- Coverage: broad once campaigns exist.
- Duplicate risk: medium.
- Ownership: marketing / CRM.
- Customer Resolver read-only use: engagement evidence only.
- Customer Master future use: interaction history and enrichment.
- Must not overwrite: verified customer identity or stronger transactional evidence.

### Future voice/call tool

- Description: future sensitive engagement and action source.
- Identifiers: call ids, phone numbers, operator ids, call outcome, transcript refs.
- Can create customer: no by itself.
- Can update customer: no.
- Can attach identity: yes, if caller identity is captured.
- Can create timeline event: yes, as sensitive engagement event.
- Confidence: medium.
- Coverage: future, limited by rollout.
- Duplicate risk: medium.
- Ownership: operator-supervised engagement.
- Customer Resolver read-only use: engagement and lead enrichment only.
- Customer Master future use: create events, not identity truth alone.
- Must not overwrite: email, PrestaShop, HUB-confirmed identity.

## Preliminary precedence

When multiple sources are available, resolution should prefer:

1. CRM Customer Master future confirmed
2. HUB operator confirmed
3. PrestaShop `ps_customer.id_customer`
4. PrestaShop verified email
5. PrestaShop order or invoice association
6. WhatsApp `wa_id` plus normalized phone match
7. `ps_address` phone normalized
8. AppSheet quotation
9. n8n legacy
10. POS general customer without identity
11. email marketing engagement
12. voice/call engagement

## Identity rules

- Different strong emails do not merge automatically.
- Another email implies another customer unless explicit human merge exists later.
- `wa_id` can create a provisional customer candidate, not a final master.
- Local phone must be normalized before comparison.
- `ps_address` phone alone must not dominate over email or `id_customer`.
- POS general customer does not create a customer without a reliable identifier.
- AppSheet must never dominate identity.
- n8n is never source of truth for identity.
- HUB operator may create or confirm a customer, but not overwrite strong data without conflict handling.
- PrestaShop is strong for ecommerce but incomplete for the overall CRM.
- future quotation capture should collect email, phone, name, comuna, and origin.
- future call capture may create events or leads, not a master customer by itself.

## Customer Candidate Read Model

Before any persistent Customer Master exists, the recommended bridge model is a Customer Candidate Read Model.

This model:

- resolves candidates from existing sources
- does not write `customer_master`
- does not perform destructive merge
- does not finalize identity
- returns confidence
- returns `sourceMatches`
- returns warnings
- returns `writePolicy`

### Example

```json
{
  "resolution_mode": "read_only_composite",
  "customer_candidate": {
    "email": "cliente@email.com",
    "wa_id": "56912345678",
    "prestashop_customer_id": 123,
    "confidence": "high"
  },
  "sourceMatches": [
    {
      "source": "prestashop",
      "matched_by": "email",
      "confidence": "high"
    },
    {
      "source": "whatsapp",
      "matched_by": "wa_id",
      "confidence": "medium"
    }
  ],
  "writePolicy": {
    "can_create_customer_master": false,
    "can_attach_identity": false,
    "reason": "source_ownership_not_defined"
  }
}
```

## WhatsApp inquiry flow

Recommended read-only flow:

1. If `wa_id` matches future customer identity or normalized `ps_address` phone, resolve as existing candidate.
2. If `wa_id` does not match, create a provisional candidate in memory/read-only.
3. If the customer gives email, search PrestaShop.
4. If PrestaShop has a match, associate the candidate with the ecommerce customer candidate.
5. If no PrestaShop match exists, keep the lead as a CRM candidate.
6. If the customer buys later, link `id_customer` from PrestaShop to the future CRM Customer.

## Future quote flow

Recommended flow:

1. Quote capture should not depend on AppSheet as final truth.
2. Quote onboarding should collect:
   - email
   - phone
   - name
   - comuna
   - origin channel
3. Quote capture may create a customer candidate.
4. Future quote write path may create a Customer CRM only once ownership and write policy are safe.
5. AppSheet should remain transitional/importable, not the center.

## POS flow

Recommended flow:

1. POS general customer without identity should only create a transaction or timeline event if it can be linked.
2. If POS captures email or phone, it may feed a customer candidate.
3. POS must not auto-create a customer master without a reliable identifier.

## Criteria for future Customer Master migration

Future migration to persistent Customer Master should be authorized only when:

1. source mapping is approved
2. ownership rules are documented
3. read-only resolver exists and is tested
4. phone normalization is defined
5. PrestaShop read-only integration is validated
6. HUB manual create strategy is defined
7. main conflicts are known
8. no-auto-merge policy is validated
9. initial backfill strategy is designed
10. AppSheet/import transitional rules are defined
