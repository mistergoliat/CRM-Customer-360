---
doc_id: runbook-sales-agent-r2-a11-controlled-rollout
title: SALES-AGENT-R2-A11 - Controlled Rollout Runbook
status: active
last_reviewed: 2026-08-21
source_of_truth_for:
  - exact operator commands for deploying, activating and rolling back the A11 autonomous runtime
depends_on:
  - ../releases/SALES-AGENT-R2-A11-autonomous-runtime-operationalization-controlled-rollout.md
tags:
  - runbook
  - sales-agent
  - deployment
---

# SALES-AGENT-R2-A11: Controlled Rollout Runbook

Written for the EC2/PM2 environment described in `docs/ACTIVE_RELEASE.md` and the
[deployment-workflow] convention: development happens locally, `main` is the
production-promotion branch, and the instance pulls manually - there is no CI/CD
auto-deploy. This runbook assumes you are on the instance, `main` has been updated,
and you are about to bring the A11 pieces (access gate, autonomy killswitch, retry
worker, follow-up worker) online in a controlled way.

**No PM2 ecosystem config exists in this repo as of A11.** The process names below
(`crm-web`, `crm-worker-outbox`, `crm-worker-followup`, `crm-worker-commercial-work`)
are a proposed, consistent naming convention - **run `pm2 list` first and match
these against whatever your instance already uses** before running any command
below. If your instance already has different names for the web process or the
existing outbox/follow-up workers, use those instead; only the new
`crm-worker-commercial-work` process is genuinely new.

## 0. Pre-deploy checks

```bash
# On the instance, in the repo directory
git status -sb                  # confirm nothing uncommitted/unexpected
pm2 list                        # confirm current process names/state
```

## 1. Update code

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npm run build
```

## 2. Migrations

```bash
npm run db:status               # check pending migration count first
npm run db:migrate              # only if pending migrations > 0
```

**Known debt, not caused by A11**: the local dev DB (`main_management`) observed
during this task had 6 pending migrations (including the A05 CommercialWork
persistence migrations, 029-031) - if your instance's DB is in the same state,
`scripts/autonomous-runtime-backlog-report.ts` and the new worker will error with
`Table 'main_management.crm_commercial_work_steps' doesn't exist` until migrated.
Confirm your instance's actual migration state with `npm run db:status` - do not
assume it matches the local dev environment.

## 3. Environment flags (Stage 0 - safe, default)

Add to your instance's `.env` (never commit it) if not already present. This is
the **safe default** - a fresh deploy with none of these set already behaves this
way (see the release doc's env var table for full defaults):

```bash
BRAIN_WHATSAPP_TEST_MODE_ENABLED=true
BRAIN_WHATSAPP_TEST_WA_IDS=
BRAIN_AUTONOMOUS_RESPONSES_ENABLED=false
BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=false
BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED=false
```

At this point the web process can restart safely - autonomous responses are OFF,
so inbound messages are still persisted (never lost) but nothing autonomous happens.

```bash
pm2 restart crm-web --update-env
```

## 4. Backlog review (before enabling either worker for the first time)

```bash
npm run backlog:report
```

Read the JSON output. If `commercialWorkRetryBacklog.oldestAge` or
`followUpBacklog.oldestAge` is old (days, not minutes) - this is expected the
first time you run this against a database that already has development/testing
history - decide whether to:

- **(a)** set an activation cutoff so the worker/follow-up ignore everything
  created before now:
  ```bash
  BRAIN_COMMERCIAL_WORK_WORKER_ACTIVATION_CUTOFF=<current UTC ISO timestamp>
  BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ACTIVATION_CUTOFF=<current UTC ISO timestamp>
  ```
- **(b)** manually review and clean up the specific backlogged rows first (out of
  this runbook's scope - a DB operation, do it deliberately, not blindly).

**Never enable `BRAIN_COMMERCIAL_WORK_WORKER_ENABLED` /
`BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED` without doing this check first** - see
release doc Part 59/60 for why (unsolicited follow-ups / retry surprises to
historical/test conversations).

## 5. Stage 1 - owner-only activation

Add/change on the instance:

```bash
BRAIN_AUTONOMOUS_RESPONSES_ENABLED=true
BRAIN_WHATSAPP_TEST_MODE_ENABLED=true
BRAIN_WHATSAPP_TEST_WA_IDS=<owner's real WA ID, digits only, e.g. 56912345678>
BRAIN_COMMERCIAL_WORK_RUNTIME_ENABLED=true
BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS=<owner's real WA ID>
```

Restart the web process:

```bash
pm2 restart crm-web --update-env
```

Do a real owner-number WhatsApp smoke (see the release doc's owner-only test
script) before enabling either background worker.

### 5a. Start the retry worker (only after the backlog review in step 4)

```bash
BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=true
```

```bash
pm2 start npm --name crm-worker-commercial-work -- run worker:commercial-work
pm2 save
```

Or, if PM2 is already managing the process from a prior deploy:

```bash
pm2 restart crm-worker-commercial-work --update-env
```

Watch its logs:

```bash
pm2 logs crm-worker-commercial-work --lines 100
```

### 5b. Start the follow-up worker (only after the backlog review in step 4)

```bash
BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED=true
```

The follow-up worker process may already exist from before A11 (it also drains
the legacy sales-consultative follow-up queue) - check `pm2 list` first.

```bash
pm2 start npm --name crm-worker-followup -- run worker:followup   # if it does not already exist
pm2 restart crm-worker-followup --update-env                       # if it does
pm2 save
```

```bash
pm2 logs crm-worker-followup --lines 100
```

## 6. Add testers (Stage 2)

```bash
BRAIN_WHATSAPP_TEST_WA_IDS=<owner>,<tester1>,<tester2>,<tester3>
```

```bash
pm2 restart crm-web --update-env
```

`BRAIN_COMMERCIAL_WORK_RUNTIME_WA_IDS` is a separate list - decide explicitly
whether all testers or a subset also get routed to R2 (vs. the legacy runtime),
and update it independently. The two lists are never the same flag.

## 7. Disable autonomy (emergency, fastest path)

```bash
BRAIN_AUTONOMOUS_RESPONSES_ENABLED=false
```

```bash
pm2 restart crm-web --update-env
pm2 restart crm-worker-commercial-work --update-env   # if running
pm2 restart crm-worker-followup --update-env          # if running
```

This alone stops every autonomous LLM call, capability execution, worker
continuation and follow-up send, everywhere, immediately after the restart.
Manual operator replies are never affected (they never route through the
gated functions - see release doc Part "AUTO05").

## 8. Return to owner-only mode

```bash
BRAIN_WHATSAPP_TEST_MODE_ENABLED=true
BRAIN_WHATSAPP_TEST_WA_IDS=<owner only>
```

```bash
pm2 restart crm-web --update-env
```

## 9. Disable the workers individually

```bash
BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=false
```
```bash
pm2 restart crm-worker-commercial-work --update-env
```

```bash
BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED=false
```
```bash
pm2 restart crm-worker-followup --update-env
```

Both processes stay running (poll loop continues) but every tick becomes a
complete no-op - no DB writes beyond the flag check itself.

## 10. Inspect logs / PM2 / DB queues

```bash
pm2 logs crm-worker-commercial-work --lines 200
pm2 logs crm-worker-followup --lines 200
pm2 status

npm run backlog:report          # read-only, safe to run anytime, any state
npm run preflight:autonomous    # config-only validation, never touches the DB
```

Direct DB inspection (read-only), if you need more detail than the backlog
report gives:

```sql
SELECT status, COUNT(*) FROM crm_commercial_work_steps GROUP BY status;
SELECT status, COUNT(*) FROM crm_agent_actions WHERE action_type = 'schedule_followup' GROUP BY status;
```

## 11. Emergency rollback

Fastest containment, no `git revert` needed - env change + restart:

```bash
BRAIN_AUTONOMOUS_RESPONSES_ENABLED=false
BRAIN_WHATSAPP_TEST_MODE_ENABLED=true
BRAIN_WHATSAPP_TEST_WA_IDS=<owner only, or empty to block everyone>
BRAIN_COMMERCIAL_WORK_WORKER_ENABLED=false
BRAIN_COMMERCIAL_WORK_FOLLOW_UP_ENABLED=false
```

```bash
pm2 restart crm-web --update-env
pm2 restart crm-worker-commercial-work --update-env   # if running
pm2 restart crm-worker-followup --update-env          # if running
```

If code itself needs to be rolled back (not just config), that is a separate,
higher-stakes decision - revert the specific commit on `main` and redeploy
through the normal `git fetch` / `git pull --ff-only` / `npm ci` / `npm run
build` / `pm2 restart` sequence above, never `git reset --hard` on a shared
branch without explicit confirmation.
