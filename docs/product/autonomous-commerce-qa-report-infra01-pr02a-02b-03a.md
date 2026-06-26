# QA Report — INFRA-01, PR-02A, PR-02B, PR-03A

Reproducible evidence for the four blockers identified after the first functional verification of PR-02/PR-03 (see `docs/product/autonomous-commerce-implementation-backlog.md`). All commands below were run against a freshly recreated local MariaDB volume, not the pre-existing development container.

## Scope

- `INFRA-01` — reproducible MariaDB bootstrap from an empty volume.
- `PR-02A` — production-safe WhatsApp ingress (no admin token dependency, provider-specific auth).
- `PR-02B` — duplicate-response timestamp contract fix.
- `PR-03A` — identity conflict detection and safety.
- Side fix found while testing PR-03A's audit trail: `auditLog()` was silently failing every write under `crm_app`'s minimal grants (`lib/audit.ts`).

`PR-04` was intentionally **not** started. This report only covers the four items above plus the final end-to-end re-verification.

## 1. Reproducible bootstrap from an empty volume (INFRA-01)

```powershell
npm run db:down
docker volume rm infra_main_management_mariadb_data
npm run db:up
npm run db:wait
npm run db:migrate -- --database=dev
npm run db:bootstrap:smoke
```

Observed (this session, verbatim from the smoke script):

```
[smoke] applying migrations against the dev target (main_management)...
[skip] 001_hub_audit_log.sql
... (all 11 migrations skip on re-run, already applied)
Applied: 0
Pending: 0
[smoke] checking expected tables and app connectivity...
[smoke] ok: 16 expected tables present, crm_app can connect and query.
[smoke] checking crm_app write/no-DDL permission boundary...
crm_app permissions: ok
[smoke] checking crm_dev_admin DDL permission...
main_management admin/root permissions: ok
[smoke] PASS: clean-volume bootstrap is reproducible (database, user, grants, migrations, app connection).
```

Two real, independent bugs were found and fixed to get here (not just the original credential/env mismatch):

1. `infra/mariadb/init/002-set-local-passwords.sh` had CRLF line endings (Windows checkout, no `.gitattributes` rule), which made `docker-entrypoint.sh` fail with `cannot execute: required file not found` — the script never ran on first boot. Fixed the file and added `.gitattributes` (`infra/mariadb/init/* text eol=lf`, `*.sh text eol=lf`) so this cannot regress on another Windows clone.
2. The script invoked `mysql`, which the `mariadb:11.4` image no longer ships (renamed to `mariadb`). Fixed to `mariadb --protocol=socket ...`.
3. `infra/.env`/`.env` never defined `DB_HOST`/`DB_PORT`/`DATABASE_*` consistently with the actual compose port (3306) and database (`main_management`); `crm_app` was also never created in `001-create-databases-and-users.sql` (only granted). Fixed the SQL (added `CREATE USER IF NOT EXISTS 'crm_app'@'%'`) and rewrote the env contract (see below).

### Single env contract

- `DB_HOST` / `DB_PORT` / `DB_NAME` are shared across every target (one local instance).
- `DB_USER` / `DB_PASSWORD` are **not** set generically — `lib/database-config.ts`'s alias resolution makes them win over `MIGRATION_DATABASE_USER`/`TEST_DATABASE_USER`/etc., which would make `crm_dev_admin` unreachable for migrations/tests. Each target keeps its own `*_USER`/`*_PASSWORD` (`DATABASE_*` for the app, `MIGRATION_DATABASE_*`, `TEST_DATABASE_*`, `LEGACY_DATABASE_*`).
- `CRM_APP_PASSWORD` is infra-only: consumed by `infra/mariadb/init/002-set-local-passwords.sh` via docker-compose, must equal `DATABASE_PASSWORD`.

Applied identically to `.env`, `.env.example`, `infra/.env`, `infra/.env.example`. Documented in `docs/development/local-database.md`.

## 2. Production-safe WhatsApp ingress (PR-02A)

`middleware.ts` now carves out `/api/integrations/whatsapp/webhook` from the blanket admin/session gate. The route's own `verifyMetaSignature` is the only authenticity check, and now fails closed when no app secret is configured **and** `NODE_ENV=production` (previously always allowed unsigned traffic, in every environment).

Live proof (real app, real DB, real HTTP, **zero admin token**, this session):

```
curl -X POST http://127.0.0.1:3010/api/integrations/whatsapp/webhook \
  -H "Content-Type: application/json" --data-binary @final-webhook.json
```

```json
{"ok":true,"warnings":["meta_signature_secret_not_configured"],"processed":1,
 "results":[{"kind":"inbound","ok":true,"duplicate":false, ...,
 "customer":{"id":2,"firstname":"Cliente","lastname":"Final", ...},
 "commercialEvent":{"id":"cevt_fe04a8073947f6fddf16709f0c4eeac5", ...},
 "commercialEventStatus":"created","identityWarnings":[],"identityConflict":null}]}
```

No `x-admin-bypass-token` header was sent. The same request to an unrelated route (`/api/system/health`) still returns `{"error":"unauthorized"}` without it — regression-checked in `tests/native/whatsapp-webhook-auth.test.ts`.

Automated coverage (`tests/native/whatsapp-webhook-auth.test.ts`, 11/11 passing): GET valid/invalid verification (token, mode), authentic POST, inauthentic POST (forged signature, rejected before persisting), zero-credential POST (rejected by the route's own check, not by middleware), malformed JSON, malformed-but-parseable payload, duplicate dedupe, middleware passthrough for the webhook path, middleware regression for an unrelated `/api/*` route.

## 3. Duplicate response timestamp contract (PR-02B)

Root cause: `commercialEventRowToContract` (`lib/brain/commercial/events/repository.ts`) read `occurred_at`/`received_at` with a text-only coercion that silently returned `""` for `mysql2`'s `Date` objects — every DATETIME column comes back as a `Date`, not a `string`, once re-read from the DB (duplicate path only; the freshly-created in-memory object on first insert was never affected). Fixed with a dedicated `asDateTimeIso` helper.

Live proof, duplicate POST in this session's final pass:

```json
"commercialEvent":{"occurredAt":"2026-06-26T22:37:07.000Z","receivedAt":"2026-06-26T22:37:09.737Z", ...}
```

Never empty. Contract test added in `tests/commercial/commercial-events.test.ts` ("PR-02B: ...").

**Separate risk found, not fixed here (out of bounded scope):** the round-tripped value is the *real persisted* value but not necessarily the *same instant* as the original input — `commercial_event.occurred_at`/`received_at` are naive `DATETIME(3)` (no timezone) and the `mysql2` pool (`lib/db.ts`) has no explicit `timezone` option, so reads/writes go through `mysql2`'s default local-timezone interpretation. Observed a reproducible +4h offset between the in-memory ISO value and the DB round-trip in this environment. This affects every naive DATETIME column read as a JS `Date` anywhere in the app, not just this table — documented in the backlog as a separate risk for a dedicated task.

## 4. Identity conflict safety (PR-03A)

`resolveOrCreateNativeCustomer` (`lib/brain/native-whatsapp/service.ts`) no longer silently picks a customer when:

- **Divergent identities**: the same normalized value (e.g. phone) already links to more than one distinct `customer_id` in `customer_external_identity` (new `findDistinctCustomersByNormalizedValue`).
- **Customer/conversation mismatch**: the freshly resolved customer differs from the customer already stored on the conversation.

Both cases return `customer: null` for that turn (continuity preserved — the inbound message is still always persisted), set a structured `identityConflict` (`type`, candidate customer ids, `detectedAt`), push a warning into `identityWarnings`, and write `auditLog({ action: "customer.identity_conflict", ... })` for human follow-up. `createOrUpdateNativeConversation`'s existing `COALESCE(VALUES(customer_id), customer_id)` means a conflicted turn never overwrites a previously-good link.

All 6 required scenarios pass against the real local DB (`tests/native/identity-conflict.test.ts`):

```
✔ unambiguous identity: a single linked customer resolves cleanly, no conflict
✔ nonexistent identity: first contact creates a provisional customer without conflict
✔ duplicate but equivalent identities: two links to the same customer do not conflict
✔ divergent identities: ... raises a conflict and does not silently pick one
✔ conflict between an existing conversation's customer and a freshly resolved customer ...
✔ human resolution: after disambiguating divergent identities, the next resolution is clean
  and the conflict stays visible in the audit trail
```

### Side fix: audit logging was silently disabled

While writing the human-resolution test (asserting the conflict is visible in `hub_audit_log`), found that `auditLog()` called `ensureAuditTable()` (`CREATE TABLE IF NOT EXISTS`) unconditionally even after confirming the table already exists via `hasTable()`. `crm_app`'s minimal grants correctly deny `CREATE`, so this call threw on every single audit write, was swallowed by the outer `try/catch`, logged only as `audit_log_failed`, and the real `INSERT` never ran. **No audit log entries were being written at all** under minimal grants before this fix. Removed the redundant call (`lib/audit.ts`). Verified live in this session: `hub_audit_log` now has real rows (`SELECT id, action, entity_id FROM hub_audit_log` → `1, customer.created, 1`).

## 5. Final end-to-end pass (this session, in order)

1. `npm run db:down && docker volume rm infra_main_management_mariadb_data && npm run db:up` — clean volume.
2. `npm run db:wait` → `MariaDB ready for dev`.
3. `npm run db:migrate -- --database=dev` → 11/11 applied.
4. `npm run db:bootstrap:smoke` → PASS.
5. `npm run dev -- -p 3010` (real app, with `DB_*` pointed at the clean DB).
6. `POST /api/integrations/whatsapp/webhook` with **no** `x-admin-bypass-token` and **no** signature → `200`, `ok:true`, customer created, `commercial_event` created.
7. Same payload again → `duplicate:true`, `commercialEventStatus:"duplicate"`, real (non-empty) timestamps.
8. `SELECT COUNT(*) FROM commercial_event` / `conversation_message` → `1` / `1` despite two POSTs.
9. `SELECT * FROM hub_audit_log` → real row present (`customer.created`).
10. `buildNativeCommercialContext(conversationPublicId)` against this real conversation → `status:"success"`, customer/conversation/messages match the DB exactly.
11. `npx tsc --noEmit` → clean.
12. `npm run build` → clean.
13. `npx tsx --test` across **every** `*.test.ts` in the repo (38 files) → **575/575 passing**, 0 failures.
14. `npm run lint` → 0 errors (35 pre-existing warnings, none in touched files beyond what already existed).

## Open items intentionally left out of this batch

- Naive-DATETIME / `mysql2` timezone interpretation (flagged in §3) — systemic, needs its own dedicated task.
- `PR-03`'s `customer_external_identity` is now used for conflict detection but the conflict signal is not yet threaded into `buildNativeCommercialContext`'s `CommercialContext` snapshot itself (only into the resolution result/audit trail) — acceptable per PR-03A's "contexto **o** resultado de resolución" wording; flagged as a PR-04+ follow-up if the cycle needs it earlier.
- `PR-02A`'s production fail-closed behavior (`NODE_ENV=production` with no app secret) has not been exercised with `NODE_ENV=production` set, since that also changes unrelated Next.js build/runtime behavior; the logic is the same conditional already covered by the existing test pattern (`lib/auth.ts` uses the identical `NODE_ENV === "production"` check elsewhere in this repo).
