/**
 * Real smoke test for the Capability Gateway's Catalog Port
 * (MS-pesaschile-catalog-service). Makes real HTTP calls - never runs in CI,
 * never runs without CATALOG_SERVICE_BASE_URL / CATALOG_SERVICE_API_KEY
 * explicitly configured in the environment.
 *
 * Usage:
 *   npx tsx scripts/manual-test/catalog-service-smoke.ts --query="jaula"
 */
import { randomUUID } from "node:crypto";
import { readHttpCatalogAdapterConfig, createHttpCatalogAdapter } from "../../lib/catalog";
import { selectBestCatalogMatch } from "../../lib/brain/commercial/native-cycle/rankCatalogSearchResults";
import { CATALOG_ADAPTER_CONTRACT_VERSION } from "../../lib/catalog/types";

function parseQueryArg(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--query=")) return arg.slice("--query=".length);
  }
  return "jaula";
}

async function main() {
  const config = readHttpCatalogAdapterConfig();
  if (!config) {
    console.error("CATALOG_SERVICE_BASE_URL and/or CATALOG_SERVICE_API_KEY are not set.");
    console.error("This smoke test makes real HTTP calls and must never run without real credentials.");
    process.exitCode = 1;
    return;
  }

  const query = parseQueryArg(process.argv.slice(2));
  const correlationId = randomUUID();
  const adapter = createHttpCatalogAdapter(config);

  console.log(`Catalog Port smoke test - contract ${CATALOG_ADAPTER_CONTRACT_VERSION}`);
  console.log(`baseUrl=${config.baseUrl} timeoutMs=${config.timeoutMs} correlationId=${correlationId}`);
  console.log(`query="${query}"`);
  console.log("");

  const searchStartedAt = Date.now();
  const searchResult = await adapter.searchProducts({ query, limit: 5 }, { correlationId });
  const searchLatencyMs = Date.now() - searchStartedAt;

  if (!searchResult.ok) {
    console.error(`searchProducts FAILED in ${searchLatencyMs}ms`);
    console.error(JSON.stringify(searchResult.error, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(`searchProducts OK in ${searchLatencyMs}ms - ${searchResult.value.items.length} item(s)`);
  console.log(`  evidence: source=${searchResult.value.provenance.source} retrievedAt=${searchResult.value.provenance.retrievedAt} cached=${searchResult.value.provenance.cached}`);
  for (const item of searchResult.value.items) {
    console.log(`  - productId=${item.productId} combinationId=${item.combinationId} matchType=${item.matchType} availability=${item.availability} name="${item.name}"`);
  }

  const best = selectBestCatalogMatch(searchResult.value.items);
  if (!best) {
    console.log("");
    console.log("No results to fetch details for - smoke test ends after search.");
    return;
  }

  console.log("");
  console.log(`Selected best match: productId=${best.item.productId} rule=${best.reason.rule} matchType=${best.reason.matchType} availability=${best.reason.availability}`);

  const detailsStartedAt = Date.now();
  const detailsResult = await adapter.getProductDetails(
    { productId: best.item.productId, combinationId: best.item.combinationId !== "0" ? best.item.combinationId : undefined },
    { correlationId }
  );
  const detailsLatencyMs = Date.now() - detailsStartedAt;

  if (!detailsResult.ok) {
    console.error(`getProductDetails FAILED in ${detailsLatencyMs}ms`);
    console.error(JSON.stringify(detailsResult.error, null, 2));
    process.exitCode = 1;
    return;
  }

  if (!detailsResult.value) {
    console.log(`getProductDetails OK in ${detailsLatencyMs}ms - product not found (unexpected right after a search match)`);
    return;
  }

  console.log(`getProductDetails OK in ${detailsLatencyMs}ms`);
  console.log(`  evidence: source=${detailsResult.value.provenance.source} retrievedAt=${detailsResult.value.provenance.retrievedAt} cached=${detailsResult.value.provenance.cached}`);
  console.log(`  name="${detailsResult.value.name}" sku=${detailsResult.value.sku} active=${detailsResult.value.active}`);
  console.log(`  availability=${detailsResult.value.availability} stockQuantity=${detailsResult.value.stockQuantity}`);
  if (detailsResult.value.price) {
    console.log(`  price=${detailsResult.value.price.amount} ${detailsResult.value.price.currency} (discountApplied=${detailsResult.value.price.discountApplied})`);
  } else {
    console.log("  price=unknown (never presented as zero or invented)");
  }

  console.log("");
  console.log(`Total latency: ${searchLatencyMs + detailsLatencyMs}ms (search=${searchLatencyMs}ms, details=${detailsLatencyMs}ms)`);
}

main().catch((error) => {
  console.error("Smoke test crashed unexpectedly:", error);
  process.exitCode = 1;
});
