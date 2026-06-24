# Real Data Integration Status

## Screens

- `/dashboard` - `partial`
- `/conversations` - `real`
- `/conversations/[id]` - `real`
- `/cases` - `real`
- `/cases/[id]` - `real`
- `/customers` - `real`
- `/customers/[id]` - `real`

## Sections still demo-backed

- LTV
- scoring
- segment
- notes
- campaigns

These sections are intentionally marked as demo or unavailable in the UI until a real backend exists.

## Warnings and gaps

- `timeline_fallback_by_wa_id` remains visible when the conversation timeline needs fallback resolution.
- Audit creation is non-blocking if `hub_audit_log` is missing, but the warning is surfaced.
- `Idempotency-Key` is accepted at the API boundary, but persistent idempotency storage is not introduced in this PR.
- `platform_origin` is persisted on `master_customer` and shown in Customers UI as the account origin.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npx --yes tsx --test tests/domains/*.test.ts`
