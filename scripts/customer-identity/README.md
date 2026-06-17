# Customer Identity Evaluation Script

This folder contains the read-only evaluator for `resolveCustomerCandidate()`.

## Purpose

- Measure quality, coverage, conflict handling, and latency.
- Keep evaluation PII-safe.
- Avoid DB writes and product side effects.
- Separate reviewed cases from unreviewed cases.

## Usage

```bash
npm run customer-identity:evaluate
```

Other modes:

```bash
npm run customer-identity:evaluate -- --demo
npm run customer-identity:evaluate -- --cases ./fixtures/customer-identity-cases.json
npm run customer-identity:evaluate -- --sample-mode existing --limit 50
npm run customer-identity:evaluate -- --cases-json '[{"caseId":"demo-1","waId":"56912345678"}]'
npm run customer-identity:evaluate -- --prepare-review --limit 60
```

## Input shape

Each case may include:

- `waId`
- `email`
- `phone`
- `idCustomer`
- `idOrder`
- `invoiceNumber`
- `conversationCaseId`
- `messageId`
- `sourceCategories`
- `reviewedByHuman`
- `reviewNote`
- `expectedResolution`
- `expectedCustomerReference`

Cases with `reviewedByHuman !== true` do not participate in exact match, false positive, or false negative metrics.

## Output

The script prints a PII-safe summary and, optionally, sanitized case results.
The `--prepare-review` mode prints an anonymized template with blank expectation fields for human review.

## Safety rules

- Do not put raw customer data into case ids or labels.
- Do not store results in DB.
- Do not emit raw emails, phones, `wa_id`, or names in logs.
- Use synthetic test data for demo mode.
- Keep review notes free of PII.
- Do not infer expected results with the same resolver being evaluated.

## Notes

- `demo` mode uses synthetic fixtures.
- `existing` mode reads limited data from existing sources in read-only mode.
- `customer_candidate` is not changed by this script; it only observes the existing resolver behavior.
- `--prepare-review` is intended for human review before a real evaluation run.
- The example file `scripts/customer-identity/fixtures.example.json` shows the anonymized template shape.
