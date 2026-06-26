# Autonomous Commerce Quality Gate

- Scope: `AC-QUALITY-GATE-01`
- Branch: `ai/codex/ac-quality-gate-01`
- Worktree: `C:\Users\Goli\Pesas Chile\CRM-Customer-360-quality-gate-01`
- Commit base original: `fd23066f88b30c0e1b7550cd1b8c977e75f9a076`
- Commit base after rebase: `24a87645b373f2ad7b062a02e10f41ade9ff03d8`

## Environment

- The gate runs against the real application and the real MariaDB test schema.
- The command resets the test database before each internal run.
- `RUN_AUTONOMOUS_COMMERCE_QA=1` enables the dedicated QA test file inside the full suite.
- The generated machine-readable report is written to `tmp/autonomous-commerce-quality-gate-report.json`.
- The report artifact is ignored by git and regenerated on demand.

## Fixtures

- Known WhatsApp identity linked to an existing customer.
- Seeded case and message history for a human-owned / AI-blocked conversation.
- Seeded inbound and outbound timeline records.
- Seeded opportunity row for context assembly.

## Regeneration Command

```bash
QA_BASE_COMMIT=24a87645b373f2ad7b062a02e10f41ade9ff03d8 npm run qa:autonomous-commerce
```

The JSON report is not a versioned source of truth. Regenerate it whenever you need fresh evidence.

## Scenarios

- GET verification succeeds with the configured token.
- GET verification fails with an invalid token.
- POST with a valid Meta HMAC is accepted.
- POST without a signature is rejected.
- POST with an invalid signature is rejected.
- Signature verification uses the raw request body.
- Production without a Meta secret fails closed.
- Payloads without messages do not mutate persistence.
- Invalid JSON fails safely before persistence.
- Replay and concurrency do not duplicate rows.
- Identity resolution remains read-only and deterministic.
- Commercial context builds from persisted data without mutating state.
- Architecture boundaries stay within the allowed surface.

## Assertions

- One inbound `commercial_event` per provider message id.
- One logical conversation message per provider message id.
- Replays reuse the same conversation and customer links.
- Duplicate delivery updates stay idempotent.
- No empty strings leak into the duplicate response path.
- `unknown` values do not collapse to `false`, `0`, or `out_of_stock`.
- Webhook failure cases do not persist partial state.
- The gate stays read-only with respect to production concerns.

## Results

- `npm run typecheck`: passed
- `npm run lint`: passed with existing warnings only
- `npm run build`: passed with a non-fatal Windows symlink warning
- `npm run qa:autonomous-commerce` invocation 1:
  - internal run 1: `9` tests passed, `totalDurationMs 10944`
  - internal run 2: `9` tests passed, `totalDurationMs 8985`
- `npm run qa:autonomous-commerce` invocation 2:
  - internal run 1: `9` tests passed, `totalDurationMs 10560`
  - internal run 2: `9` tests passed, `totalDurationMs 14663`
- Full repo test tree: `583` passed, `1` skipped, `0` failed

## Timing

- Gate invocation 1 finished in about `25s`.
- Gate invocation 2 finished in about `29s`.
- Full repository suite finished in about `18s`.

## Limitations

- The gate depends on local DB access and reset permissions.
- The repo-wide suite intentionally skips the QA file unless the env flag is set.
- Existing lint warnings are out of scope for this gate.
- The Windows build still emits the symlink tracing warning during standalone copying.

## CI Guidance

- Use the regeneration command above for the dedicated QA job.
- Keep the QA job separate from the normal regression job.
- Preserve the generated JSON only as ephemeral evidence; do not commit it.

## Extension Path

- Add PR-04 fixtures only after opportunity lifecycle ownership is integrated.
- Expand the ingress and identity coverage when adjacent scopes are handed off.
- Keep the gate read-only and avoid product side effects in all future additions.
