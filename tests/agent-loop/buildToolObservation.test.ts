import assert from "node:assert/strict";
import test from "node:test";
import { buildToolObservation } from "@/lib/brain/commercial/agent-loop/buildToolObservation";
import type { CapabilityGatewayResult } from "@/lib/brain/commercial/capability-gateway/types";
import type { CatalogProduct } from "@/lib/catalog";

const FIXED_TIME = "2026-07-28T12:00:00.000Z";

function completed(data: Record<string, unknown> | null): CapabilityGatewayResult<Record<string, unknown>> {
  return {
    capability: "get_product_details",
    version: "capability-gateway.v1",
    availability: "available",
    status: "completed",
    data,
    errorCode: null,
    retryable: false,
    evidence: [],
    warnings: [],
    retryCount: 0,
    startedAt: FIXED_TIME,
    completedAt: FIXED_TIME,
    executionPublicId: "capability-exec-test"
  };
}

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    productId: "7",
    name: "Pack 4 Bandas de Resistencia",
    sku: "SKU-7",
    shortDescription: "Bandas de resistencia.",
    longDescription: null,
    active: true,
    selectedVariant: null,
    variants: [],
    price: { amount: 19990, currency: "CLP", taxIncluded: true, discountApplied: false },
    availability: "in_stock",
    stockQuantity: 4,
    provenance: { source: "catalog_service_http", retrievedAt: FIXED_TIME, cached: false },
    ...overrides
  };
}

test("get_product_details observation preserves the complete publicLink object", () => {
  const canonicalUrl = "https://pesaschile.cl/categories/7-pack-4-bandas.html?ref=wa#detalle";
  const observation = buildToolObservation(
    "get_product_details",
    completed(
      product({
        publicLink: {
          canonicalUrl,
          scope: "parent_product",
          available: true,
          requiresVariantSelection: true,
          variantAttributeLabels: ["Talla", "Color"]
        }
      }) as unknown as Record<string, unknown>
    )
  );

  assert.equal(observation.status, "completed");
  const data = observation.data as { publicLink?: Record<string, unknown> };
  assert.deepEqual(data.publicLink, {
    canonicalUrl,
    scope: "parent_product",
    available: true,
    requiresVariantSelection: true,
    variantAttributeLabels: ["Talla", "Color"]
  });
});

test("get_product_details observation preserves unavailable publicLink evidence", () => {
  const observation = buildToolObservation(
    "get_product_details",
    completed(
      product({
        publicLink: {
          canonicalUrl: null,
          scope: "exact_product",
          available: false,
          unavailableReason: "missing_link_rewrite",
          requiresVariantSelection: false,
          variantAttributeLabels: []
        }
      }) as unknown as Record<string, unknown>
    )
  );

  const data = observation.data as { publicLink?: Record<string, unknown> };
  assert.deepEqual(data.publicLink, {
    canonicalUrl: null,
    scope: "exact_product",
    available: false,
    unavailableReason: "missing_link_rewrite",
    requiresVariantSelection: false,
    variantAttributeLabels: []
  });
});

test("search_products observation does not expose publicLink even if upstream search data contains it", () => {
  const observation = buildToolObservation("search_products", {
    ...completed({
      query: "banda",
      items: [
        {
          productId: "7",
          combinationId: "0",
          sku: "SKU-7",
          name: "Pack 4 Bandas",
          variantLabel: null,
          shortDescription: "Bandas.",
          stockQuantity: 4,
          availability: "in_stock",
          matchType: "exact_name",
          publicLink: {
            canonicalUrl: "https://pesaschile.cl/categories/7-pack-4-bandas.html",
            scope: "exact_product",
            available: true,
            requiresVariantSelection: false,
            variantAttributeLabels: []
          }
        }
      ],
      provenance: { source: "catalog_service_http", retrievedAt: FIXED_TIME, cached: false }
    }),
    capability: "search_products"
  });

  const data = observation.data as { items: Array<Record<string, unknown>> };
  assert.equal("publicLink" in data.items[0], false);
});

test("search_products observation exposes at most five compact product results", () => {
  const observation = buildToolObservation("search_products", {
    ...completed({
      query: "barra",
      items: Array.from({ length: 7 }, (_unused, index) => ({
        productId: String(index + 1),
        name: `Producto ${index + 1}`,
        availability: "in_stock",
        stockQuantity: index + 1,
        shortDescription: `Descripcion ${index + 1}`,
        price: { amount: 1000 + index, currency: "CLP" },
        publicLink: { canonicalUrl: `https://example.test/${index + 1}` }
      })),
      provenance: { source: "catalog_service_http", retrievedAt: FIXED_TIME, cached: false }
    }),
    capability: "search_products"
  });

  const data = observation.data as { items: Array<Record<string, unknown>> };
  assert.equal(data.items.length, 5);
  assert.deepEqual(Object.keys(data.items[0]).sort(), ["availability", "name", "productId", "stockQuantity"]);
  assert.doesNotMatch(JSON.stringify(data), /price|shortDescription|publicLink|https?:\/\//);
});
