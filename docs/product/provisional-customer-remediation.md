# Provisional Customer Remediation

## What needs remediation

Older runs created provisional customers with emails like:

- `wa-<phone>@local.invalid`

These rows are legacy artifacts. Do not delete them automatically in this PR.

## How to identify them

Primary signal:

- email ends in `.invalid`
- email starts with `wa-`

Secondary signal:

- rows linked only by temporary WhatsApp identity data
- conversations with no verified email match
- customers with no meaningful commercial activity

## How to measure the scope

Use a read-only query over `master_customer`:

- count rows whose email matches the provisional pattern;
- group by `platform_origin`;
- join to `conversation`, `crm_opportunities`, `customer_conversation_link`, `customer_external_identity`, `customer_addresses` and `hub_audit_log` to understand impact.

Measure at least:

- total provisional customers;
- customers with conversations;
- customers with opportunities;
- customers with orders or quotes;
- customers with addresses;
- customers with audit history.

## How to distinguish used data from garbage

Treat a row as "used" when it has one or more of:

- real conversation history;
- linked opportunity;
- linked quote/order;
- addresses created by the customer;
- audit evidence of operator work.

Treat a row as "garbage" when it has none of the above and was only created as a temporary identity placeholder.

## Future migration strategy

The future migration should be dry-run first and non-destructive:

- identify candidate rows;
- map each conversation to a real email or keep it unresolved;
- preserve active commercial records;
- merge only when a real customer can be proven;
- never rewrite history without evidence.

## Rollback

Rollback should be data-preserving:

- stop after the dry-run stage;
- keep provisional rows intact;
- keep conversation and opportunity links reversible;
- write a diff report before any destructive step.

## Recommended future script

Create a future script that supports:

- dry-run mode;
- candidate reporting;
- merge plan export;
- conversation remapping preview;
- order/quote impact preview;
- rollback report.

