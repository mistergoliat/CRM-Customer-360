/**
 * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B5. Real smoke test for the 3 TR-B4
 * CatalogPort methods (never runs in CI, never runs without
 * CATALOG_SERVICE_BASE_URL / CATALOG_SERVICE_API_KEY configured) - same
 * discipline as catalog-service-smoke.ts, extended to cover the endpoints
 * that script does not touch:
 *
 *   GET  /v1/products/semantics/registry
 *   GET  /v1/products/training-semantics/registry
 *   POST /v1/products/semantic-discovery/query
 *
 * Usage:
 *   npx tsx scripts/manual-test/semantic-discovery-smoke.ts
 */
import { randomUUID } from "node:crypto";
import { readHttpCatalogAdapterConfig, createHttpCatalogAdapter } from "../../lib/catalog";
import { CATALOG_ADAPTER_CONTRACT_VERSION } from "../../lib/catalog/types";

async function main() {
  const config = readHttpCatalogAdapterConfig();
  if (!config) {
    console.error("CATALOG_SERVICE_BASE_URL and/or CATALOG_SERVICE_API_KEY are not set.");
    console.error("This smoke test makes real HTTP calls and must never run without real credentials.");
    process.exitCode = 1;
    return;
  }

  const correlationId = randomUUID();
  const adapter = createHttpCatalogAdapter(config);

  console.log(`Semantic Discovery smoke test - contract ${CATALOG_ADAPTER_CONTRACT_VERSION}`);
  console.log(`baseUrl=${config.baseUrl} timeoutMs=${config.timeoutMs} correlationId=${correlationId}`);
  console.log("");

  console.log("--- GET /v1/products/semantics/registry ---");
  const productStartedAt = Date.now();
  const productRegistry = await adapter.getProductSemanticsRegistry!({ correlationId });
  const productLatencyMs = Date.now() - productStartedAt;
  if (!productRegistry.ok) {
    console.error(`getProductSemanticsRegistry FAILED in ${productLatencyMs}ms`);
    console.error(JSON.stringify(productRegistry.error, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`getProductSemanticsRegistry OK in ${productLatencyMs}ms - ontologyVersion=${productRegistry.value.ontologyVersion}`);
    for (const axisEntry of productRegistry.value.axes) {
      console.log(`  axis=${axisEntry.axis} codeCount=${axisEntry.values.length} sampleCodes=${axisEntry.values.slice(0, 5).map((value) => value.code).join(",")}`);
    }
  }

  console.log("");
  console.log("--- GET /v1/products/training-semantics/registry ---");
  const trainingStartedAt = Date.now();
  const trainingRegistry = await adapter.getTrainingSemanticsRegistry!({ correlationId });
  const trainingLatencyMs = Date.now() - trainingStartedAt;
  if (!trainingRegistry.ok) {
    console.error(`getTrainingSemanticsRegistry FAILED in ${trainingLatencyMs}ms`);
    console.error(JSON.stringify(trainingRegistry.error, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`getTrainingSemanticsRegistry OK in ${trainingLatencyMs}ms - registryVersion=${trainingRegistry.value.registryVersion}`);
    console.log(`  exerciseCapabilities(${trainingRegistry.value.exerciseCapabilities.length})=${trainingRegistry.value.exerciseCapabilities.slice(0, 5).join(",")}`);
    console.log(`  bodyRegions(${trainingRegistry.value.bodyRegions.length})=${trainingRegistry.value.bodyRegions.slice(0, 10).join(",")}`);
    console.log(`  muscleGroups(${trainingRegistry.value.muscleGroups.length})=${trainingRegistry.value.muscleGroups.slice(0, 10).join(",")}`);
  }

  if (!productRegistry.ok || !trainingRegistry.ok) {
    console.log("");
    console.log("Skipping POST /v1/products/semantic-discovery/query - at least one registry could not be loaded to build a valid, real-code request.");
    return;
  }

  const firstProductAxisWithCodes = productRegistry.value.axes.find((axisEntry) => axisEntry.values.length > 0);
  if (!firstProductAxisWithCodes) {
    console.log("");
    console.log("No product axis with at least one code was returned - cannot build a real query. Smoke ends after registries.");
    return;
  }

  console.log("");
  console.log("--- POST /v1/products/semantic-discovery/query ---");
  const queryStartedAt = Date.now();
  const queryResult = await adapter.querySemanticDiscovery!(
    { requirements: [{ axis: firstProductAxisWithCodes.axis, codes: [firstProductAxisWithCodes.values[0].code], mode: "required", match: "any" }], limit: 5 },
    { correlationId }
  );
  const queryLatencyMs = Date.now() - queryStartedAt;
  if (!queryResult.ok) {
    console.error(`querySemanticDiscovery FAILED in ${queryLatencyMs}ms`);
    console.error(JSON.stringify(queryResult.error, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(`querySemanticDiscovery OK in ${queryLatencyMs}ms - axis=${firstProductAxisWithCodes.axis} code=${firstProductAxisWithCodes.values[0].code}`);
  console.log(`  totalMatches=${queryResult.value.totalMatches} truncated=${queryResult.value.truncated} resultCount=${queryResult.value.results.length}`);
  for (const result of queryResult.value.results.slice(0, 3)) {
    console.log(`  - productId=${result.productId} matchedRequirements=${JSON.stringify(result.matchedRequirements)}`);
  }
}

main().catch((error) => {
  console.error("Smoke test crashed unexpectedly:", error);
  process.exitCode = 1;
});
