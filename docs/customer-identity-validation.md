# Customer Identity Validation

## Purpose

Define a safe, read-only way to evaluate the quality, coverage, conflict handling, and latency of `resolveCustomerCandidate()` without writing DB or changing product behavior.

This validation has two distinct modes:

- synthetic demo validation to verify the evaluator itself
- real anonymized validation with human-reviewed expectations

## What this validation does

- Runs `resolveCustomerCandidate()` on controlled cases.
- Measures resolution distribution, warnings, latency, and match quality.
- Keeps all outputs PII-safe.
- Does not write DB.
- Does not merge identities.
- Does not mutate context behavior.
- Separates reviewed and unreviewed cases.

## Recommended execution modes

1. `demo` synthetic fixtures with no PII.
2. Local JSON file with controlled cases.
3. Read-only source samples from existing tables.
4. `--prepare-review` template generation for human review.

## Suggested command

```bash
npm run customer-identity:evaluate
```

Optional modes:

```bash
npm run customer-identity:evaluate -- --demo
npm run customer-identity:evaluate -- --cases ./fixtures/customer-identity-cases.json
npm run customer-identity:evaluate -- --sample-mode existing --limit 50
npm run customer-identity:evaluate -- --cases-json '[{"caseId":"demo-1","waId":"56912345678"}]'
npm run customer-identity:evaluate -- --prepare-review --limit 60
```

## Metrics

The evaluator reports:

- `total_cases`
- `resolved_existing_count/rate`
- `linked_identity_count/rate`
- `created_provisional_count/rate`
- `conflict_needs_review_count/rate`
- `not_enough_identity_count/rate`
- `skipped_read_only_count/rate`
- `phone_normalization_success_rate`
- `warning_count_by_code`
- `warning_count_by_source`
- `average_latency_ms`
- `p50_latency_ms`
- `p95_latency_ms`
- `max_latency_ms`
- `average_reader_count`
- `average_query_count`
- `source_match_count_by_source`
- `reviewed_cases`
- `unreviewed_cases`
- `reviewed_exact_match_count/rate`
- `reviewed_false_positive_count/rate`
- `reviewed_false_negative_count/rate`
- `reviewed_conflict_detection_accuracy`
- `informational_count`
- `warning_count`
- `error_count`

## Classification

- `pass`: no fatal errors, no warning/error messages, and reviewed expectations match cleanly.
- `warning`: the resolver is stable but there are warnings, informational no-match coverage, or false negatives within the tolerated range.
- `fail`: fatal errors, error messages, false positives, or missed conflict detection.

## Message taxonomy

- `informational`: `no_match`
- `warning`: `table_not_found`, `column_not_found`, `ambiguous_match`, `invalid_phone`, `source_not_configured`, `schema_drift`, `unknown_warning`
- `error`: `query_failed`, `reader_unavailable`

`no_match` is informational when there is no human-reviewed expectation of a match. It should not degrade the global classification on its own.

## PII protection

- Console output uses case hashes, not raw identifiers.
- No email, phone, wa_id, or names are written to output.
- No DB writes occur.
- No report is persisted to disk unless a caller explicitly redirects stdout.
- Review notes must remain PII-free.

## Endpoint locations

### `/api/brain/context/resolve`

`customer_candidate` appears inside the response payload at:

- `customer_context.customer_candidate`

This field is present in the normal response and is not gated by `debug`.

### `/api/brain/process-inbound`

`processInbound` already returns the context response, so the same field appears at:

- `context.customer_context.customer_candidate`

This is also not gated by `debug`. The `debug` flag only affects `context_debug`, not `customer_candidate`.

## Real anonymized evaluation procedure

1. Generate a review template:
   - `npm run customer-identity:evaluate -- --prepare-review --limit 60`
2. Review the anonymized cases manually.
3. Fill `expectedResolution`, `expectedCustomerReference`, `reviewedByHuman=true`, and a short `reviewNote`.
4. Run the evaluator on the reviewed file:
   - `npm run customer-identity:evaluate -- --cases ./path/to/reviewed-fixtures.json`
5. Interpret only reviewed-case precision metrics for approval.
6. Use unreviewed cases only for coverage and latency.

## Recommended sample mix

- 20 ecommerce customers with email and phone
- 10 WhatsApp cases with PrestaShop match
- 10 WhatsApp cases without match
- 5 customers with multiple addresses
- 5 malformed phones
- 5 incompatible signals
- 5 customers outside PrestaShop

## Acceptance criteria

- Evaluation runs without DB writes.
- Schema drift degrades to warnings.
- False positive rate stays at 0 on reviewed sample sets.
- Fatal resolver errors stay at 0.
- `p95_latency_ms` is reported.
- Strong conflicts end in `conflict_needs_review`.
- `false_negative_rate` is reported and should remain at or below 15% initially on reviewed samples.
- The review template can be generated without exposing PII.
