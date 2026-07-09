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

## Catalog Port smoke test (ACS-R1-01.1)

Real HTTP calls against `MS-pesaschile-catalog-service`. Refuses to run (exit
code 1, no request made) unless `CATALOG_SERVICE_BASE_URL` and
`CATALOG_SERVICE_API_KEY` are both set - never runs in CI, never runs without
real credentials.

```bash
CATALOG_SERVICE_BASE_URL=... CATALOG_SERVICE_API_KEY=... \
  npx tsx scripts/manual-test/catalog-service-smoke.ts --query="jaula"
```

Searches a real product, selects the best match with the same deterministic
ranker the production runtime uses (`rankCatalogSearchResults`), fetches its
details, and reports: contract version, latency for each call, and evidence
(`source`, `retrievedAt`, `cached`) for both calls. Read-only - never
mutates catalog data, never writes to the CRM database.
