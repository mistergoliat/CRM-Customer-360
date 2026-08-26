# SALES-AGENT-R2-ID-R2-A11.2 - Production PrestaShop Source Activation + Smoke

## Veredicto

`ID_R2_A11_2_PRODUCTION_SOURCE_ACTIVATION_BLOCKED`

`PRODUCTION_PRESTASHOP_SOURCE: DEPLOYMENT_BLOCKER` (unchanged from A11.1 - blocked at an earlier gate than expected, see section 2).

## Baseline

- `docs/releases/SALES-AGENT-R2-ID-R2-A11.1-production-prestashop-read-source-wiring.md` - built the dedicated pool, the explicit `PRESTASHOP_IDENTITY_SOURCE` switch, fail-closed semantics and the `prestashop_identity_db` health item. That doc's own section 9 already flagged: "the currently-deployed EC2 process has not been reconfigured to use it". This task set out to close that gap operationally; instead it found a **prior**, more fundamental gap.

## 1. Scope of this task

PARTE 1 of the task spec ("NO CAMBIAR NADA TODAVÍA") - read-only reconnaissance only. Executed via SSH (`Master` host, `ec2-user`) against the real EC2 instance. No file was written, no process was restarted, no database was mutated. All findings below come from `git`/`pm2 list`/`grep`-for-key-names-only commands.

## 2. Finding: A11.1 was never deployed (blocks PARTE 4/5 before they can start)

- Production `/home/ec2-user/CRM-Customer-360` is on branch `develop` at commit `ec3d303` ("Merge pull request #99 from mistergoliat/feat/marketing-r1-t04-copilot-workspace", 2026-08-21).
- The entire `SALES-AGENT-R2-ID-R2` identity track (A02 through A11.1 - candidate resolver, evidence, verification, runtime identity, commercial identity gating, PrestaShop bridge, Customer Profile consumption, repeat purchase, and the dedicated PrestaShop pool this task was meant to activate) exists **only as uncommitted local changes** in the implementation environment - never committed, never pushed to `origin`, never merged. Production's `develop` predates all of it, and even predates PR #100/#101 already merged on top of it locally.
- Confirmed directly: production's `.env` has **zero** `PRESTASHOP_*` keys (checked by listing every `^[A-Z0-9_]+` key name in the file - `LOGISTICS_DB_*` keys are present and presumably live, `PRESTASHOP_*` keys are entirely absent). There is nothing to "activate" - the code that would read `PRESTASHOP_IDENTITY_SOURCE` is not running on this instance.
- This is a harder blocker than the one PARTE 5 anticipated ("confirmar que A11.1 está realmente desplegado antes de activar env" - the check itself, not just a possible negative result). PARTE 4/5/6/7/8/9/10/11/12 of the task spec all assume A11.1's code is already running in production; none of them can proceed while that assumption is false.

## 3. Other pre-existing state observed (not caused by this task, not modified)

- Production `pm2 list`: 7 processes online (`crm-web`, `crm-outbox`, `crm-followup`, `crm-commercial-work`, `catalog-service`, `customer-profile`, `quote-service`) - all healthy at inspection time, host CPU 2.6%/RAM 52.2%.
- `mysql` client (MariaDB 10.5.29 distribution) is available on the instance.
- The production checkout has its own uncommitted local state unrelated to this task: `package-lock.json` modified, a `.tmp-commercial-tests-cjs/` tree showing as deleted in `git status`, and an untracked `.env.backup-20260812-010958` file. None of these were touched or investigated further - out of scope, flagged only so a future deploy doesn't mistake them for this task's own changes.
- A `~/.secrets` directory exists on the instance. An attempt to list only its file names (as part of PARTE 1's "hostname/config de la base productiva si ya existe en configuración segura") was blocked by the operating harness's own safety classifier before it ran. That block was correct and was not worked around - if a `pesas_productiva` credential already lives there, a human operator needs to surface it, not this session.

## 4. Decisions made with the user (this task's own gating checkpoint)

Per PARTE 1's "no cambiar nada todavía" and the general principle that pushing uncommitted work to a shared remote and reconfiguring a live production instance are both consequential, hard-to-reverse actions, this session stopped after the read-only reconnaissance above and asked the user directly how to proceed. Answers:

- **Deploy path**: "Stop here entirely" - no commit, no push, no merge, no `git pull`/`npm ci`/`npm run build`/`pm2 restart` performed by this session.
- **`pesas_productiva` credential** (needed for PARTE 2/3's connectivity/grants checks): "Skip DB verification for now" - PARTE 2 and PARTE 3 were not attempted; no credential was requested, stored, or used.

No part of PARTE 4 through PARTE 12 was executed as a result. This is a deliberate, user-confirmed stop, not an oversight.

## 5. PARTE-by-PARTE status

| Parte | Status | Why |
| --- | --- | --- |
| 1 - inspect instance | Done | Section 2/3 above |
| 2 - confirm pesas_productiva reachable | Not attempted | No credential (user chose to skip) |
| 3 - validate grants | Not attempted | Depends on 2 |
| 4 - configure CRM env | Not attempted | User chose to stop before any change; also blocked by 2 (A11.1 code not deployed) |
| 5 - deploy code | Not attempted | User chose to stop; the uncommitted A02-A11.1 work was never pushed/merged |
| 6 - health check | Not meaningful yet | The `prestashop_identity_db` health item does not exist on the currently-deployed commit |
| 7 - read-only SQL smoke | Not attempted | Depends on 2 |
| 8 - application-level smoke | Not attempted | Depends on 4/5 |
| 9 - numeric-separation smoke | Not attempted | Depends on 8 |
| 10 - negative config test | Verified at the code level only | Already covered by A11.1's own test suite (PSDS07/08/09, `tests/integrations/prestashopMirrorTopology.test.ts`) against the local repository state - not re-run against the production instance, since the feature isn't deployed there |
| 11 - runtime identity smoke | Not attempted | Depends on 4/5 |
| 12 - optional E2E controlled test | Not attempted | Depends on 11; also explicitly optional |
| 13 - rollback | Not applicable | Nothing was changed, so nothing needs rolling back |

## 6. Debts / next steps (for whoever picks this up)

- The A02-A11.1 work needs to be committed, pushed, and merged through this repo's normal review process before any activation attempt can proceed - that is a decision and an action for the user/team, not something this session performed.
- A read-only `pesas_productiva` credential needs to be sourced (possibly already in `~/.secrets` on the instance - unconfirmed) and handed to whoever runs PARTE 2/3, or provisioned fresh per A11.1's documented grant requirements (`SELECT`-only on `ps_customer`/`ps_orders`).
- Once both of the above are resolved, PARTE 2 through PARTE 13 of the original A11.2 task spec are still the right checklist to run - nothing about that plan was invalidated, only its precondition (A11.1 deployed) was found to be unmet.
- The pre-existing local state on the production checkout (`package-lock.json` diff, deleted `.tmp-commercial-tests-cjs/`, `.env.backup-20260812-010958`) should be reviewed by whoever next deploys to that instance - not evaluated here, out of this task's scope.

## Criterio de salida - checklist

1. `source runtime = production_db` - not applicable, code not deployed.
2. `database = pesas_productiva` - not verified.
3. `ps_customer` reachable - not verified.
4. `ps_orders` reachable - not verified.
5. Dedicated pool confirmed - not verified in production (confirmed in code/tests only, per A11.1).
6. App-level lookup confirmed - not verified.
7. No fallback to `main_management` - not verified in production; guaranteed by code (A11.1) once deployed.
8. Credentials read-only/restricted grants - not verified, no credential available this session.
9. Health `ok` - not verified; health item does not exist on the deployed commit.
10. No change to global `DATABASE_NAME` - true trivially, nothing was changed at all this session.

**Overall**: `PRODUCTION_PRESTASHOP_SOURCE: DEPLOYMENT_BLOCKER`, cause: A11.1 has not been deployed to production yet (no commit, no push, no merge has happened for that track) - not a connectivity, credential, or grants problem, which remain unverified downstream of this.
