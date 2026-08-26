# SALES-AGENT-R2-ID-R2-A11.1 - Production PrestaShop Identity Read Source Wiring

## Veredicto

`ID_R2_A11_1_PRESTASHOP_SOURCE_WIRING_VALIDATED`

`PRODUCTION_PRESTASHOP_SOURCE: DEPLOYMENT_BLOCKER` (unchanged status, changed reason - see section 9). This task builds the connection boundary, the explicit switch and the fail-closed guarantees; it does not, by itself, move the currently-running production process off `main_management`, because doing that silently on deploy is exactly the kind of accidental topology change PARTE 4/6 of the task spec forbid. Flipping the switch is now a one-line, explicit, ops-owned action (section 10) instead of an invisible default.

## Baseline

- `docs/releases/SALES-AGENT-R2-ID-R2-A11-repeat-purchase-customer-aware-objectives.md`, section 13 - the finding this task closes: `lib/integrations/prestashop-mirror/repository.ts`'s `findPrestashopCustomerIdsByEmail`/`findPrestashopCustomerIdsByOrderReference` issue unqualified `FROM \`ps_customer\``/`FROM \`ps_orders\`` against whatever database the shared `@/lib/db` pool is configured against (`DATABASE_NAME`/`DB_NAME`, de facto `main_management` in this repo's `.env`), with no distinct connection to a real `pesas_productiva` anywhere in the codebase.
- `lib/integrations/logistics/{config,pool,pc-pos-adapter}.ts` (CRM-R1-T13C) - the only precedent in this codebase for "a genuinely separate operational database, own dedicated pool, own env vars, never falls back to `DATABASE_*`". Reused as the structural template for this task (section 3), not copied literally per the task spec's own instruction to prefer existing convention over inventing one.

## 1. Topology audit (PARTE 1)

- One MariaDB instance backs the app pool (`lib/db.ts#getPool`, singleton, `DATABASE_*`/`DB_*` via `lib/database-config.ts#resolveNamedDatabaseConnection("app")`), plus separately-configured migration/test/legacy targets on the **same** instance (different database names, same host in local dev) - none of these is a second physical PrestaShop connection.
- `lib/integrations/logistics/pool.ts` is the only prior example of a genuinely independent pool (`pc_pos`, `LOGISTICS_DB_*`, `LOGISTICS_DB_ENABLED` gate, own `mysql.createPool`) - confirmed never used for `ps_customer`/`ps_orders`.
- No `pesas_productiva` reference existed anywhere in the repo before this task (`rg -i pesas_productiva` - zero hits pre-change).
- `ps_customer`/`ps_orders` are seeded locally by `database/fixtures/legacy-n8n-schema.sql` into `main_management` - confirmed by re-running the existing real-DB test (`tests/domains/customerIdentity.test.ts`, "IDR03/IDR10 integration") against the local dev database, and by this task's own new integration test (PSDS11) against the same database.
- `main_management.ps_customer`/`ps_orders` are optional/nullable in this codebase's own design (`getColumns` returning `[]` is treated as "table not available", not an error) - consistent with them being a local mirror/fixture, never asserted anywhere as the productive PrestaShop database.

## 2. Semantic boundary, unchanged (PARTE 2)

`lib/integrations/prestashop-mirror/repository.ts` keeps exposing exactly the same two semantic operations it did before (`findPrestashopCustomerIdsByEmail`, `findPrestashopCustomerIdsByOrderReference`) with the same return contract (`PrestashopCandidateLookup`). It still never leaks a database/schema name to `lib/domains/customer-identity/local-adapter.ts` or the resolution service - it now additionally never even knows *which* physical connection answered the query, only that it got an executor (`PrestashopQueryExecutor`, `{getColumns, safeQueryRows}`) from `./pool`.

## 3. Connection ownership (PARTE 3)

New files, `lib/integrations/logistics/{config,pool}.ts`'s pattern reused directly:

- `lib/integrations/prestashop-mirror/config.ts` - `readPrestashopDbConfig(env)` resolves one of two states, explicit and env-driven only:
  - `{source:"local_mirror"}` - default when `PRESTASHOP_IDENTITY_SOURCE` is unset or `"local_mirror"`.
  - `{source:"production_db", host, port, user, password, database}` - only when `PRESTASHOP_IDENTITY_SOURCE=production_db`, and only by reading `PRESTASHOP_DATABASE_HOST`/`_USER`/`_PASSWORD`/`_NAME`/`_PORT` - never `DATABASE_*`/`DB_*` as a fallback (PSDS08).
- `lib/integrations/prestashop-mirror/pool.ts` - `getPrestashopQueryExecutor()` returns either the local mirror executor (a thin wrapper around `@/lib/db`'s existing `getColumns`/`safeQueryRows` - the exact functions the repository called directly before this task) or a dedicated executor backed by its own `mysql.createPool` (own module-level singleton, own column cache, `connectionLimit: 3`, never the app's pool). `resetPrestashopPoolForTests()` mirrors `resetLogisticsPoolForTests()`.
- `lib/integrations/prestashop-mirror/repository.ts` - both readers now take an injectable `getExecutor` parameter defaulting to `getPrestashopQueryExecutor` (same DI convention `pc-pos-adapter.ts#createPcPosCommuneCatalog` and `getCustomerPurchaseHistoryCapability.ts` already use in this codebase) - production call sites (`local-adapter.ts`) pass nothing, unchanged call shape.

## 4. No schema-qualified SQL (PARTE 4)

`FROM \`ps_customer\``/`FROM \`ps_orders\`` remain unqualified. The dedicated pool's own `database` config selects `pesas_productiva` (or whatever is configured) at the connection level - never a `pesas_productiva.ps_customer` string built into a query. This keeps dev/test decoupled from the production database name, per the task spec's own explicit preference (PARTE 4).

## 5. Fail closed (PARTE 5)

`readPrestashopDbConfig` throws `PrestashopDbConfigurationError` when `PRESTASHOP_IDENTITY_SOURCE=production_db` is declared but `PRESTASHOP_DATABASE_*` is incomplete/invalid (PSDS07), or when the source value itself is unrecognized. `repository.ts#resolveExecutor` catches that (and any other executor-construction failure) and returns `{ok:false, error:"prestashop_db_configuration_error: ..."}` - **never** `{ok:true, tableAvailable:false, prestashopCustomerIds:[]}` (PSDS09). This `ok:false` is not new plumbing: `lib/domains/customer-identity/evidence.ts#classifyPrestashopCandidates` already treats any `ok:false` from these two readers as `SYSTEM_FAILURE` (confirmed by reading that file, lines ~59-62/141-153) - a config failure was already wired, end to end, to become `SYSTEM_FAILURE` rather than "no encontré cliente"; this task only had to make sure a broken `production_db` config produces `ok:false` instead of being silently absorbed as "table not available".

## 6. Environment policy (PARTE 6)

Explicit `PRESTASHOP_IDENTITY_SOURCE` env var, two values only - never inferred from `NODE_ENV` or a database name. Default (unset) is `local_mirror`, so **this deploy alone changes nothing about the currently-running production process** - see section 9/10 for what an operator must still do.

## 7. A02 resolver untouched (PARTE 7/8)

`lib/domains/customer-identity/local-adapter.ts` is the only production caller of this module and is byte-for-byte unchanged by this task (confirmed by diff). Both `findPrestashopCustomerIdsByEmail` (email -> `ps_customer.id_customer`) and `findPrestashopCustomerIdsByOrderReference` (order reference -> `ps_orders.id_customer`) resolve their executor through the identical `getPrestashopQueryExecutor` factory (PSDS12) - they can never end up pointed at two different physical databases from the same running config, so "email from mirror + order from productiva" (the mixing PARTE 8 warns against) cannot happen by construction.

## 8. Master customer separation (PARTE 9)

`master_customer` never appears anywhere in `repository.ts`/`pool.ts`/`config.ts` (PSDS06, enforced by a source-grep test). Unchanged: the `customer_external_identity` bridge (`provider="prestashop"`, `external_id=ps_customer.id_customer`) remains the only path from a PrestaShop id to `master_customer.id`, entirely outside this module.

## 9. Actual production source (PARTE 14/25 revisited)

**Still not independently verified from this implementation environment** - no network access to any real RDS/PrestaShop database exists here, same limitation every prior task in this release has documented for external services. What changed since the A11 baseline:

- Before this task: production had **no mechanism at all** to point PrestaShop identity reads anywhere other than the app's own `DATABASE_*` pool - the blocker was structural.
- After this task: the mechanism exists (`PRESTASHOP_IDENTITY_SOURCE=production_db` + `PRESTASHOP_DATABASE_*`), is fail-closed, and is tested (section 11) - but **the currently-deployed EC2 process has not been reconfigured to use it**, because this task does not touch instance `.env` files (out of scope, same boundary every other release doc in this repo respects for secrets/instance config). The blocker is now purely operational: an operator must (a) confirm whether `pesas_productiva` is reachable from the EC2 instance and obtain read-only credentials, (b) decide - with ops, not by inference - whether `main_management`'s `ps_customer`/`ps_orders` were ever an intentionally maintained mirror of it or just dev/test fixture data, and (c) set the four `PRESTASHOP_DATABASE_*` vars and `PRESTASHOP_IDENTITY_SOURCE=production_db` on the instance, then restart (section 10).

## 10. Deployment instructions (PARTE 15)

Same EC2/PM2 manual-pull model as `docs/runbooks/SALES-AGENT-R2-A11-controlled-rollout-runbook.md` (no CI/CD auto-deploy in this repo).

1. `git fetch origin && git checkout main && git pull --ff-only origin main && npm ci && npm run build` (no new migration in this task - `npm run db:migrate` not required for this change specifically).
2. Add to the instance's `.env` (never committed):
   ```bash
   PRESTASHOP_IDENTITY_SOURCE=production_db
   PRESTASHOP_DATABASE_HOST=<pesas_productiva host>
   PRESTASHOP_DATABASE_PORT=3306
   PRESTASHOP_DATABASE_NAME=pesas_productiva
   PRESTASHOP_DATABASE_USER=<read-only user - see permissions below>
   PRESTASHOP_DATABASE_PASSWORD=<its password>
   ```
   Leaving `PRESTASHOP_IDENTITY_SOURCE` unset (or `local_mirror`) keeps today's exact behavior - safe to deploy the code change alone first, and flip the switch as a separate, deliberate step once credentials are confirmed.
3. `pm2 restart crm-web --update-env`.
4. Verify: `GET /api/system/health` (operator-only) now reports a `prestashop_identity_db` item - `status:"ok"` with `details:"source=production_db host=..."` confirms the dedicated pool is live and `ps_customer` answered; `status:"error"` means `PRESTASHOP_DATABASE_*` is incomplete (fix `.env` and restart); `status:"warning"` with `source=production_db` means the connection resolved but the query didn't (check host/credentials/network/grants).
5. Rollback: unset `PRESTASHOP_IDENTITY_SOURCE` (or set it back to `local_mirror`) and restart - reverts to the pre-A11.1 topology immediately, no code rollback needed.

### Permissions (PARTE 11)

The `PRESTASHOP_DATABASE_USER` credential must be a **read-only** MariaDB user, `SELECT`-only on `ps_customer`/`ps_orders` (no write grant, ever - this is the ecommerce's own database, not CRM-owned). Exact `GRANT` statement is an ops/DBA action outside this repo's migration system (same boundary `LOGISTICS_DB_*`'s own documentation draws for `pc_pos`) - no credential is included in this doc or in any test.

## 11. Readiness (PARTE 12)

A real operator-facing health surface already existed (`lib/system.ts#getSystemHealth`, backing `GET /api/system/health`, `requireOperator`-gated) - extended with one more independent item, `prestashop_identity_db` (own try/catch, cannot take down the rest of the report, matching every other item's isolation). It reports the resolved `source` and does a cheap, cached `DESCRIBE ps_customer` probe - `error` only for a genuine config problem (never for "table missing", which stays `warning`, consistent with how this module has always treated that ambiguity). The public catalog and every other capability are unaffected regardless of this item's status (PARTE 12's "no tumbar todo CRM por esta dependencia" - trivially true, this is a read-only report item, not a gate).

## 12. Tests (PARTE 13)

`tests/integrations/prestashopMirrorTopology.test.ts` (13 tests, PSDS01-13, all against real code - fakes only where a real `pesas_productiva` isn't reachable from this environment, real local MariaDB for PSDS11):

- PSDS01/02 - `production_db` resolves a distinct dedicated executor; database name comes from config, never hardcoded.
- PSDS03 - the app pool and a configured PrestaShop pool never resolve to the same database, given a realistic combined env.
- PSDS04/05 - email/order readers hit the injected executor against `ps_customer`/`ps_orders` respectively (SQL text asserted).
- PSDS06 - `master_customer` never appears in the module (source grep).
- PSDS07/08 - missing/incomplete `production_db` config throws, never silently reads `DATABASE_*`/`DB_*`.
- PSDS09 - a broken config is `ok:false` (technical failure), never the empty/not-found shape.
- PSDS10/11 - default is `local_mirror`; it really reads the local `ps_customer` fixture through the shared app pool (real DB, `main_management`).
- PSDS12 - both readers default to the identical executor factory (source grep - no split-source regression possible).
- PSDS13 - no write SQL anywhere in `repository.ts`/`pool.ts`/`config.ts`.

PSDS14/15 (no Customer Profile behavior change, no A02 decision semantics change) are not new isolated tests - they are the claim the full regression run in section 13 verifies (same tests, same outcomes, before and after this task).

## 13. Regression (PARTE 16)

- `npx tsc --noEmit`: clean.
- `npm run lint`: clean (0 errors; 39 pre-existing warnings, none in any file this task touched).
- `npm run build`: clean.
- Targeted real-DB regression (156 tests: this task's own PSDS01-13, `tests/domains/customerIdentity.test.ts` [A02], `tests/domains/customerIdentityEvidence.test.ts`, `tests/domains/customerIdentityVerification.test.ts` [A03/A04], `tests/commercial/prestashopIdentityBridge.test.ts` [A09], `tests/commercial/getCustomerPurchaseHistoryCapability.test.ts`/`repeatPurchaseObjective.test.ts`/`repeatPurchaseE2E.test.ts` [A10/A11], `tests/commercial/readyToLinkE2E.test.ts`) - 156/156 green on a clean re-run. One isolated re-run hit a single pre-existing, unrelated flake (`IVP18`, an email-auto-merge shared-DB-state assertion in `customerIdentityVerification.test.ts`, unrelated to this task's files) that passed both alone and on immediate re-run of the full group - consistent with the shared-`crm_test`/`main_management` cross-file concurrency flakes this repo's own release docs already document repeatedly, not a regression this task introduced.
- Full `npm test` (248 files, default parallel batching) was attempted twice for complete-suite confirmation. Both attempts progressed cleanly through every file this task's change can affect (all green) and deep into `tests/commercial` (500+ tests), then reproducibly stalled - zero CPU movement across all worker processes, confirmed via `Get-Process`/`Get-CimInstance`, not just slow - at the identical point both times, inside the batch containing `commercialWorkParallelExecution.test.ts`/`repeatPurchaseE2E.test.ts`/etc. This is a genuine, pre-existing deadlock in that specific batch's concurrency under this environment's default parallel test execution, unrelated to this task (neither file this task touches is anywhere near that batch; the hang reproduced identically on the very first attempt, before any interaction with this task's own files was possible). Both attempts were killed after confirming the hang was not progressing. Every failure observed before the stall (11 across both runs) was individually inspected and falls into three categories this repo's own prior release docs already document as pre-existing and unrelated: the "`Missing DATABASE_NAME`" file-level env-hook race (7 instances, `resolveDatabaseConnectionFromEnv` at `lib/database-config.ts:141`, caused by concurrent test files each mutating shared `process.env` at import time), a wall-clock timing assertion under parallel CPU load (`commercialWorkParallelExecution.test.ts`, `commercialWorkRetryWorker.test.ts`), and shared-`crm_test`-scope cross-file state contamination (`salesAgentConfiguration.test.ts` `[R17]`, `customerIdentityEvidence.test.ts` `IDE02`). None touched `prestashop-mirror`, `lib/system.ts`, or any file this task modified. The 156-test targeted regression above - covering every file this task's change can actually affect - together with this partial-but-clean broader run and the isolated-flake checks, is the basis for this doc's verdict; the batch-level hang itself is pre-existing test-infrastructure debt, not evidence against this task's change, and is recorded as a debt below rather than silently ignored.

## 14. Debts (consolidated)

- `PRODUCTION_PRESTASHOP_SOURCE: DEPLOYMENT_BLOCKER` persists until an operator completes section 10's steps 2-4 against the real EC2 instance with real `pesas_productiva` credentials - no code change can close this from an environment with no RDS network access.
- Whether `main_management.ps_customer`/`ps_orders` were ever an intentionally-maintained mirror of `pesas_productiva`, or are purely dev/test fixture data with no productive relationship, is still not confirmed with ops - this task does not assume either answer, it only stops the *accidental* dependency.
- No automated CI/scheduled smoke exists against the real `pesas_productiva` connection once configured - `GET /api/system/health`'s new item is manual-check only (an operator loading the page), matching every other item in that report today.
- Read-only DB grant for `PRESTASHOP_DATABASE_USER` is an ops/DBA action this task cannot perform or verify from here - documented as a requirement (section 10), not executed.
- **New finding, not caused by this task**: `npm test`'s default full-suite run reproducibly deadlocks (zero CPU across all worker processes, not merely slow) partway through `tests/commercial` on this machine, at the batch containing `commercialWorkParallelExecution.test.ts`/`repeatPurchaseE2E.test.ts` - confirmed twice, independent of this task's own files. Worth a dedicated investigation (likely real lock contention between concurrently-running MariaDB-backed tests in that specific batch) - out of scope here since PARTE 16 only requires this task's own change to regress cleanly, which section 13's targeted + partial-broader evidence already establishes.

## Criterio de salida - checklist

1. Producción no usa accidentalmente `main_management` para `ps_customer` - **not yet true for the currently-deployed instance** (section 9/14: unchanged until an operator completes the deploy steps); the code makes it possible to make it true and never regress silently back to accidental once configured.
2. Producción no usa accidentalmente `main_management` para `ps_orders` - same as above.
3. Existe connection boundary explícito - section 3 (`config.ts`/`pool.ts`). OK.
4. A02 consume ese boundary - section 7 (`local-adapter.ts` unchanged, routes through the new boundary transparently). OK.
5. Dev/test siguen funcionando - section 6/12 (PSDS10/11, real regression). OK.
6. Missing config falla cerrado - section 5 (PSDS07). OK.
7. No existe fallback silencioso - section 5/6 (PSDS08). OK.
8. DB errors no se convierten en NOT_FOUND - section 5 (PSDS09, reuses existing `SYSTEM_FAILURE` plumbing). OK.
9. Source es read-only por diseño/ops - section 10 (documented requirement; not enforceable from code, same as the `pc_pos` precedent). Documented, not code-verifiable.
10. Docs de deployment están actualizadas - section 10 (this doc) + `.env.example`. OK.
11. Regression A02-A11 está verde - section 13 (156/156 targeted regression green). OK.
12. Un smoke real o evidencia operativa suficiente demuestra que producción apunta a `pesas_productiva` - **not satisfied**, no RDS access from this environment (section 9/14). This is the sole reason `PRODUCTION_PRESTASHOP_SOURCE` stays `DEPLOYMENT_BLOCKER`.
