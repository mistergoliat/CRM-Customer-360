import http from "node:http";
import type { AddressInfo } from "node:net";
import { resetCapabilityGatewayCatalogPortForTests } from "../../capability-gateway/registry";
import { resetCalculateShippingCatalogPortForTests, setCalculateShippingCarrierServiceForTests, resetCalculateShippingCarrierServiceForTests } from "../../capability-gateway/calculateShippingCapability";
import { setCommuneResolverForTests, resetCommuneResolverForTests } from "../../capability-gateway/shippingDestinationCapability";
import { createCommuneResolver } from "@/lib/domains/commune-resolution";
import type { CommuneCatalogEntry, CommuneCatalogPort } from "@/lib/domains/commune-resolution";
import { comparisonKey } from "@/lib/domains/commune-resolution/normalize";
import { setShippingDestinationForOpportunity } from "@/lib/domains/shipping-destination";
import { setCommercialLineItemsForOpportunity } from "@/lib/domains/commercial-line-items";
import type { CarrierQuoteInput, CarrierQuoteResult, CarrierService } from "@/lib/domains/carrier-service";

/**
 * LLM-R1-T05, Part A. The isolated benchmark environment: a deterministic
 * local Catalog Service (real HTTP, on 127.0.0.1, never leaves the machine -
 * same mechanism tests/agent-loop/*.test.ts already use throughout
 * LLM-R1-T01-T04), a deterministic fake Carrier MS (in-process, zero HTTP),
 * and a deterministic fake commune catalog wrapped by the REAL
 * createCommuneResolver (so "Santiago" ambiguity - a hardcoded policy
 * override in knownAmbiguous.ts checked before any catalog lookup - resolves
 * exactly like production, never a hand-duplicated copy of that logic).
 *
 * The one thing this environment does NOT and cannot fake: `select_products`
 * and `set_shipping_destination`'s own durable per-opportunity persistence
 * (lib/domains/commercial-line-items, lib/domains/shipping-destination) has
 * no injectable seam in the current architecture - exactly like every
 * existing test that exercises these two capabilities
 * (tests/commercial/calculateShippingCapability.test.ts), it reads/writes
 * the local MariaDB this repo's own test suite already depends on (never
 * production - see the DB_* env vars this process already runs under for
 * `npm test`). A fresh, randomly-generated opportunityId per case-run keeps
 * every run isolated without needing explicit cleanup.
 */

export type BenchmarkFixtureProduct = {
  productId: string;
  name: string;
  shortDescription: string;
  price: number;
  stockQuantity: number;
  weightKg: number;
  available: boolean;
};

/** LLM-R1-T05 corpus fixture catalog - deliberately small and fixed, never derived from real Catalog Service data. */
export const BENCHMARK_PRODUCTS: Record<string, BenchmarkFixtureProduct> = {
  "31": { productId: "31", name: "Barra Olimpica Classic 20kg", shortDescription: "Barra olimpica de acero, 20kg, uso general.", price: 89990, stockQuantity: 15, weightKg: 20, available: true },
  "32": { productId: "32", name: "Barra Olimpica Pro 20kg", shortDescription: "Barra olimpica de competicion, 20kg, rodamientos de alta rotacion.", price: 149990, stockQuantity: 6, weightKg: 20, available: true },
  // C10: get_product_details for this id always fails (503) - a controlled, known capability failure.
  "999": { productId: "999", name: "Producto con falla controlada", shortDescription: "n/a", price: 0, stockQuantity: 0, weightKg: 1, available: false }
};

export const BENCHMARK_COMMUNES: readonly CommuneCatalogEntry[] = [
  { communeId: 99, canonicalName: "Ñuñoa" },
  { communeId: 100, canonicalName: "Las Condes" }
];

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function productDetailPayload(product: BenchmarkFixtureProduct) {
  return {
    product: { productId: Number(product.productId), name: product.name, sku: null, shortDescription: product.shortDescription, longDescription: null, active: true },
    variants: [],
    selectedVariant: null,
    // taxRate (IVA 19%, Chile) was absent until SALES-AGENT-R2-A07.5 - never
    // needed by the Agent Tool Loop benchmark this fixture was built for, but
    // required by create_quote's real assembleQuoteInput (resolveCatalogLine
    // fails closed with catalog_tax_metadata_missing without it). Purely
    // additive: no existing consumer reads/asserts on taxRate.
    pricing: { effectiveUnitPrice: product.price, currency: "CLP", taxIncluded: true, taxRate: 0.19, discountApplied: false },
    stock: { available: product.available, physicalQuantity: product.stockQuantity },
    weightKg: product.weightKg,
    freshness: { cached: false }
  };
}

function searchItemPayload(product: BenchmarkFixtureProduct) {
  return {
    productId: Number(product.productId),
    combinationId: 0,
    sku: null,
    name: product.name,
    variantLabel: null,
    shortDescription: product.shortDescription,
    physicalQuantity: product.stockQuantity,
    available: product.available,
    matchType: "partial_name"
  };
}

function catalogRequestHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? "";

  if (req.method === "GET" && url.includes("/v1/products/search")) {
    return sendJson(res, 200, {
      query: "barra olimpica",
      items: [searchItemPayload(BENCHMARK_PRODUCTS["31"]), searchItemPayload(BENCHMARK_PRODUCTS["32"])],
      freshness: { cached: false }
    });
  }

  if (req.method === "POST" && url === "/v1/products/explore") {
    return sendJson(res, 200, {
      scope: { availability: "available" },
      sort: { by: "price", direction: "asc" },
      totalMatched: 2,
      exhaustiveForScope: true,
      products: [
        { productId: "31", name: BENCHMARK_PRODUCTS["31"].name, price: BENCHMARK_PRODUCTS["31"].price, currency: "CLP", stockQuantity: BENCHMARK_PRODUCTS["31"].stockQuantity, stockScope: "direct", availability: "available" },
        { productId: "32", name: BENCHMARK_PRODUCTS["32"].name, price: BENCHMARK_PRODUCTS["32"].price, currency: "CLP", stockQuantity: BENCHMARK_PRODUCTS["32"].stockQuantity, stockScope: "direct", availability: "available" }
      ]
    });
  }

  if (req.method === "POST" && url === "/v1/products/batch") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}") as { items?: Array<{ productId: number }> };
      const items = (parsed.items ?? []).map((item) => {
        const product = BENCHMARK_PRODUCTS[String(item.productId)];
        if (!product || product.productId === "999") {
          return { ok: false, input: { productId: item.productId }, error: { code: "PRODUCT_NOT_FOUND", message: "not found" } };
        }
        // parseBatchItem (httpCatalogAdapter.ts) re-parses value.product through
        // parseProductResponse - the exact same nested shape /v1/products/{id}
        // returns at its top level, not spread onto the batch entry itself.
        return { ok: true, input: { productId: item.productId }, product: productDetailPayload(product) };
      });
      sendJson(res, 200, { items });
    });
    return;
  }

  const detailMatch = url.match(/^\/v1\/products\/(\d+)/);
  if (req.method === "GET" && detailMatch) {
    const productId = detailMatch[1];
    if (productId === "999") {
      // C10: a controlled, known capability failure - never silently treated as success.
      return sendJson(res, 503, { error: { code: "DATABASE_UNAVAILABLE", message: "Benchmark fixture: simulated controlled failure for product 999." } });
    }
    const product = BENCHMARK_PRODUCTS[productId];
    if (!product) return sendJson(res, 404, { error: { code: "PRODUCT_NOT_FOUND", message: "not found" } });
    return sendJson(res, 200, productDetailPayload(product));
  }

  return sendJson(res, 404, { error: { code: "NOT_FOUND", message: "unmapped benchmark fixture route" } });
}

function fakeCommuneCatalogPort(): CommuneCatalogPort {
  return {
    async findByNormalizedName(normalizedName) {
      return { ok: true, entries: BENCHMARK_COMMUNES.filter((entry) => comparisonKey(entry.canonicalName) === normalizedName) };
    }
  };
}

export type BenchmarkCarrierBehavior = "success" | "no_options";

function fakeCarrierService(behavior: BenchmarkCarrierBehavior = "success"): CarrierService & { calls: CarrierQuoteInput[] } {
  const calls: CarrierQuoteInput[] = [];
  return {
    calls,
    async quoteAll(input: CarrierQuoteInput): Promise<CarrierQuoteResult> {
      calls.push(input);
      if (behavior === "no_options") return { ok: true, options: [] };
      return { ok: true, options: [{ carrierName: "Benchmark Express", serviceType: "STANDARD", totalCost: 4990, estimatedDelivery: "2-3 dias habiles" }] };
    }
  };
}

/**
 * LLM-R1-T05 fixture setup helper - seeds a durable shipping destination for
 * a case whose scenario assumes one already exists (C04/C05/C09), using the
 * exact same real domain function (and the same fake commune catalog data)
 * setupBenchmarkEnvironment installs - never a parallel resolver instance
 * with different data.
 */
export async function seedBenchmarkShippingDestination(opportunityId: number, destinationText: string): Promise<void> {
  const result = await setShippingDestinationForOpportunity(
    { opportunityId, inputText: destinationText },
    { resolver: createCommuneResolver(fakeCommuneCatalogPort()) }
  );
  if (!result.ok) {
    throw new Error(`benchmark fixture setup: failed to seed shipping destination "${destinationText}" (status=${result.status})`);
  }
}

/** LLM-R1-T05 fixture setup helper - seeds a durable product selection for a case whose scenario assumes one already exists (C03/C04/C09). */
export async function seedBenchmarkSelection(opportunityId: number, items: Array<{ productId: string; quantity: number }>): Promise<void> {
  const result = await setCommercialLineItemsForOpportunity({ opportunityId, items: items.map((item) => ({ productId: item.productId, combinationId: null, quantity: item.quantity })) });
  if (!result.ok) {
    throw new Error(`benchmark fixture setup: failed to seed commercial line items for opportunity ${opportunityId} (status=${result.status})`);
  }
}

export type BenchmarkEnvironment = {
  baseUrl: string;
  /** A fresh, isolated opportunityId for this environment's lifetime - never reused across cases/runs. */
  opportunityId: number;
  teardown: () => Promise<void>;
};

let opportunityIdCounter = 0;
function nextBenchmarkOpportunityId(): number {
  // A fixed, clearly-synthetic high range (never overlapping any real
  // opportunity id space) plus a process-local monotonic counter - unique
  // within one benchmark process run without needing a DB round trip.
  opportunityIdCounter += 1;
  return 900_000_000 + (Date.now() % 1_000_000) * 100 + opportunityIdCounter;
}

/**
 * Sets up one isolated environment: a local Catalog Service HTTP server, a
 * fake Carrier MS, a fake (but really-resolved-via-real-logic) commune
 * catalog, and a fresh opportunityId. Call `teardown()` when done - restores
 * every module-level override to its real, production default so this
 * process (or the wider test suite it may run inside) is never left in a
 * benchmark-only state.
 */
export async function setupBenchmarkEnvironment(carrierBehavior: BenchmarkCarrierBehavior = "success"): Promise<BenchmarkEnvironment> {
  const server = http.createServer(catalogRequestHandler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const previousCatalogBaseUrl = process.env.CATALOG_SERVICE_BASE_URL;
  const previousCatalogApiKey = process.env.CATALOG_SERVICE_API_KEY;
  process.env.CATALOG_SERVICE_BASE_URL = baseUrl;
  process.env.CATALOG_SERVICE_API_KEY = "benchmark-fixture-key";
  resetCapabilityGatewayCatalogPortForTests();
  resetCalculateShippingCatalogPortForTests();

  setCommuneResolverForTests(createCommuneResolver(fakeCommuneCatalogPort()));
  setCalculateShippingCarrierServiceForTests(fakeCarrierService(carrierBehavior));

  return {
    baseUrl,
    opportunityId: nextBenchmarkOpportunityId(),
    teardown: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousCatalogBaseUrl === undefined) delete process.env.CATALOG_SERVICE_BASE_URL;
      else process.env.CATALOG_SERVICE_BASE_URL = previousCatalogBaseUrl;
      if (previousCatalogApiKey === undefined) delete process.env.CATALOG_SERVICE_API_KEY;
      else process.env.CATALOG_SERVICE_API_KEY = previousCatalogApiKey;
      resetCapabilityGatewayCatalogPortForTests();
      resetCalculateShippingCatalogPortForTests();
      resetCommuneResolverForTests();
      resetCalculateShippingCarrierServiceForTests();
    }
  };
}
