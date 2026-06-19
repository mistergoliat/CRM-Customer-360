# Manual Tests

This folder contains opt-in, destructive-guarded or read-only smoke helpers.

## AI SDR operational loop smoke test

Recommended entrypoint:

```bash
npx tsx scripts/manual-test/ai-sdr-operational-loop-smoke.ts --mode=precheck
npx tsx scripts/manual-test/ai-sdr-operational-loop-smoke.ts --mode=dry-run
npx tsx scripts/manual-test/ai-sdr-operational-loop-smoke.ts --mode=persist --confirm-persist=YES
npx tsx scripts/manual-test/ai-sdr-operational-loop-smoke.ts --mode=idempotency --confirm-persist=YES
```

Safety rules:

* never enabled by default;
* persist mode requires explicit confirmation;
* no WhatsApp send;
* no outbox worker;
* no n8n mutation;
* no automatic cleanup;
* no new tables or migrations.
