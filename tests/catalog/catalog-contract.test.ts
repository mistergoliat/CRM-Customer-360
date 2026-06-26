import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotCatalogService, createPrestashopCatalogService } from "@/lib/catalog";
import type { CatalogContext } from "@/lib/catalog";
import { isUnknownCatalogValue } from "@/lib/catalog/utils";

const FRESH = "2026-06-26T09:00:00.000Z";
const STALE = "2025-01-15T09:00:00.000Z";

function makeContext(overrides: Partial<CatalogContext> = {}): CatalogContext {
  return {
    tenant: overrides.tenant ?? "tenant-a",
    shop: overrides.shop ?? "cl-main",
    customer: overrides.customer ?? null,
    channel: overrides.channel ?? "whatsapp",
    locale: overrides.locale ?? "es-CL",
    currency: overrides.currency ?? "CLP",
    quantity: overrides.quantity ?? 1,
    effectiveAt: overrides.effectiveAt ?? FRESH
  };
}

type FixtureRow = Record<string, unknown>;

function buildFixtureRows() {
  const products: Record<string, FixtureRow> = {
    "bench-basic": {
      id_product: "bench-basic",
      reference: "BENCH-BASIC",
      price: 110000,
      width: 50,
      height: 40,
      depth: 120,
      active: 1,
      name: "Bench Basic",
      description_short: "Banco simple para entrenamiento en casa.",
      description: "Banco simple para entrenamiento en casa.",
      manufacturer_name: "Crimson Logic",
      category_name: "strength",
      quantity: 7,
      link_rewrite: "bench-basic",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/bench-basic",
      href: "https://catalog.local/cl/bench-basic",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "strength",
      retrieved_at: FRESH,
      confidence: "high"
    },
    "bike-pro": {
      id_product: "bike-pro",
      reference: "BIKE-PRO",
      price: 280000,
      width: 60,
      height: 120,
      depth: 130,
      active: 1,
      name: "Bike Pro",
      description_short: "Bicicleta comercial con variantes de color.",
      description: "Bicicleta comercial con variantes de color.",
      manufacturer_name: "Crimson Logic",
      category_name: "cardio",
      quantity: 5,
      link_rewrite: "bike-pro",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/bike-pro",
      href: "https://catalog.local/cl/bike-pro",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "cardio",
      retrieved_at: FRESH,
      confidence: "high"
    },
    "treadmill-sale": {
      id_product: "treadmill-sale",
      reference: "TREADMILL-SALE",
      price: 300000,
      width: 90,
      height: 130,
      depth: 180,
      active: 1,
      name: "Treadmill Sale",
      description_short: "Cinta de correr con promoción activa.",
      description: "Cinta de correr con promoción activa.",
      manufacturer_name: "Crimson Logic",
      category_name: "cardio",
      quantity: 3,
      link_rewrite: "treadmill-sale",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/treadmill-sale",
      href: "https://catalog.local/cl/treadmill-sale",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "cardio",
      retrieved_at: FRESH,
      confidence: "high"
    },
    "mystery-band": {
      id_product: "mystery-band",
      reference: "MYSTERY-BAND",
      price: null,
      width: 12,
      height: 2,
      depth: 25,
      active: 1,
      name: "Mystery Band",
      description_short: "Producto de catálogo con precio no verificado.",
      description: "Producto de catálogo con precio no verificado.",
      manufacturer_name: "Crimson Logic",
      category_name: "accessory",
      quantity: 4,
      link_rewrite: "mystery-band",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/mystery-band",
      href: "https://catalog.local/cl/mystery-band",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "accessory",
      retrieved_at: FRESH,
      confidence: "medium"
    },
    "paddock-rower": {
      id_product: "paddock-rower",
      reference: "PADDOCK-ROWER",
      price: 219000,
      width: 60,
      height: 90,
      depth: 210,
      active: 1,
      name: "Paddock Rower",
      description_short: "Remo con stock no confirmado.",
      description: "Remo con stock no confirmado.",
      manufacturer_name: "Crimson Logic",
      category_name: "cardio",
      quantity: null,
      link_rewrite: "paddock-rower",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/paddock-rower",
      href: "https://catalog.local/cl/paddock-rower",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "cardio",
      retrieved_at: FRESH,
      confidence: "medium"
    },
    "legacy-bike": {
      id_product: "legacy-bike",
      reference: "LEGACY-BIKE",
      price: 199000,
      width: 55,
      height: 115,
      depth: 125,
      active: 0,
      name: "Legacy Bike",
      description_short: "Producto discontinuado.",
      description: "Producto discontinuado.",
      manufacturer_name: "Legacy Line",
      category_name: "cardio",
      quantity: 0,
      link_rewrite: "legacy-bike",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/legacy-bike",
      href: "https://catalog.local/cl/legacy-bike",
      id_shop_default: "cl-main",
      id_manufacturer: "legacy",
      id_category_default: "cardio",
      retrieved_at: FRESH,
      confidence: "high"
    },
    "folding-bench": {
      id_product: "folding-bench",
      reference: "FOLDING-BENCH",
      price: 169000,
      width: 45,
      height: 45,
      depth: 125,
      packaged_width: 50,
      packaged_height: 25,
      packaged_depth: 130,
      active: 1,
      name: "Folding Bench",
      description_short: "Plegable.",
      description: "Plegable.",
      manufacturer_name: "Crimson Logic",
      category_name: "strength",
      quantity: 2,
      link_rewrite: "folding-bench",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/us/folding-bench",
      href: "https://catalog.local/us/folding-bench",
      id_shop_default: "intl-store",
      id_manufacturer: "crimson",
      id_category_default: "strength",
      retrieved_at: STALE,
      confidence: "medium"
    },
    "hr-monitor": {
      id_product: "hr-monitor",
      reference: "HR-MONITOR",
      price: 35000,
      width: 8,
      height: 2,
      depth: 12,
      active: 1,
      name: "HR Monitor",
      description_short: "Monitor de frecuencia cardíaca.",
      description: "Monitor de frecuencia cardíaca.",
      manufacturer_name: "Crimson Logic",
      category_name: "accessory",
      quantity: 18,
      link_rewrite: "hr-monitor",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/hr-monitor",
      href: "https://catalog.local/cl/hr-monitor",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "accessory",
      retrieved_at: FRESH,
      confidence: "high"
    },
    "tiny-mat": {
      id_product: "tiny-mat",
      reference: "TINY-MAT",
      price: 25000,
      width: 20,
      height: 1,
      depth: 30,
      active: 1,
      name: "Tiny Mat",
      description_short: "Estera pequeña.",
      description: "Estera pequeña.",
      manufacturer_name: "Crimson Logic",
      category_name: "accessory",
      quantity: 20,
      link_rewrite: "tiny-mat",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/tiny-mat",
      href: "https://catalog.local/cl/tiny-mat",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "accessory",
      retrieved_at: FRESH,
      confidence: "high"
    },
    "mystery-addon": {
      id_product: "mystery-addon",
      reference: "MYSTERY-ADDON",
      price: 15000,
      width: null,
      height: null,
      depth: null,
      active: 1,
      name: "Mystery Addon",
      description_short: "Accesorio sin evidencia suficiente.",
      description: "Accesorio sin evidencia suficiente.",
      manufacturer_name: "Crimson Logic",
      category_name: "accessory",
      quantity: 9,
      link_rewrite: "mystery-addon",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/mystery-addon",
      href: "https://catalog.local/cl/mystery-addon",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "accessory",
      retrieved_at: FRESH,
      confidence: "low"
    },
    "mat-pro": {
      id_product: "mat-pro",
      reference: "MAT-PRO",
      price: 39000,
      width: 70,
      height: 1,
      depth: 190,
      active: 1,
      name: "Mat Pro",
      description_short: "Complemento.",
      description: "Complemento.",
      manufacturer_name: "Crimson Logic",
      category_name: "accessory",
      quantity: 18,
      link_rewrite: "mat-pro",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/mat-pro",
      href: "https://catalog.local/cl/mat-pro",
      id_shop_default: "cl-main",
      id_manufacturer: "crimson",
      id_category_default: "accessory",
      retrieved_at: FRESH,
      confidence: "high"
    }
  };

  const variants: Record<string, FixtureRow> = {
    "bike-pro-black": {
      id_product_attribute: "bike-pro-black",
      id_product: "bike-pro",
      reference: "BIKE-PRO-BLACK",
      base_price: 280000,
      price: 0,
      width: 60,
      height: 120,
      depth: 130,
      default_on: 1,
      active: 1,
      name: "Bike Pro Black",
      description_short: "Variante negra.",
      description: "Variante negra.",
      product_name: "Bike Pro",
      product_reference: "BIKE-PRO",
      manufacturer_name: "Crimson Logic",
      category_name: "cardio",
      quantity: 4,
      link_rewrite: "bike-pro",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/bike-pro-black",
      href: "https://catalog.local/cl/bike-pro-black",
      option_values: "Color:Black",
      retrieved_at: FRESH,
      confidence: "high"
    },
    "bike-pro-white": {
      id_product_attribute: "bike-pro-white",
      id_product: "bike-pro",
      reference: "BIKE-PRO-WHITE",
      base_price: 280000,
      price: 12000,
      width: 60,
      height: 120,
      depth: 130,
      default_on: 0,
      active: 1,
      name: "Bike Pro White",
      description_short: "Variante blanca.",
      description: "Variante blanca.",
      product_name: "Bike Pro",
      product_reference: "BIKE-PRO",
      manufacturer_name: "Crimson Logic",
      category_name: "cardio",
      quantity: 2,
      link_rewrite: "bike-pro",
      domain_ssl: "catalog.local",
      url: "https://catalog.local/cl/bike-pro-white",
      href: "https://catalog.local/cl/bike-pro-white",
      option_values: "Color:White",
      retrieved_at: FRESH,
      confidence: "high"
    }
  };

  const specificPrices: Record<string, FixtureRow> = {
    "treadmill-sale:0": {
      list_price: 300000,
      sale_price: 250000,
      currency_iso: "CLP",
      valid_from: "2026-06-01T00:00:00.000Z",
      valid_to: "2026-12-31T23:59:59.000Z",
      reduction_type: "amount",
      reduction: 50000,
      source: "prestashop",
      retrieved_at: FRESH,
      confidence: "high"
    },
    "folding-bench:0": {
      list_price: 219,
      sale_price: null,
      currency_iso: "USD",
      valid_from: null,
      valid_to: null,
      reduction_type: null,
      reduction: null,
      source: "prestashop",
      retrieved_at: STALE,
      confidence: "medium"
    }
  };

  const queries: string[] = [];
  const normalize = (sql: string) => sql.replace(/\s+/g, " ").trim().toLowerCase();
  const searchText = (row: FixtureRow) =>
    normalize(
      [
        row.reference,
        row.name,
        row.description_short,
        row.description,
        row.product_name,
        row.product_reference,
        row.manufacturer_name,
        row.category_name,
        row.option_values
      ]
        .filter(Boolean)
        .join(" ")
    );

  async function safeQueryRows<T>(sql: string, params: unknown[] = []) {
    queries.push(sql);
    const normalized = normalize(sql);
    if (normalized.includes("select id_lang from ps_product_lang")) {
      return { ok: true as const, rows: [{ id_lang: 1 } as T] };
    }

    if (normalized.includes("from ps_specific_price")) {
      const productId = String(params[0] ?? "");
      const attributeId = String(params[1] ?? 0);
      const row = specificPrices[`${productId}:${attributeId}`] ?? null;
      return { ok: true as const, rows: row ? ([row as T] as T[]) : [] };
    }

    if (normalized.includes("from ps_product_attribute pa") && normalized.includes("where pa.id_product_attribute = ?")) {
      const id = String(params.at(-1) ?? "");
      const row = variants[id] ?? null;
      return { ok: true as const, rows: row ? ([row as T] as T[]) : [] };
    }

    if (normalized.includes("from ps_product_attribute pa") && normalized.includes("where pa.id_product = ?")) {
      const productId = String(params.at(-1) ?? "");
      const rows = Object.values(variants).filter((row) => String(row.id_product) === productId);
      return { ok: true as const, rows: rows as T[] };
    }

    if (normalized.includes("from ps_product p") && normalized.includes("where p.id_product <> ?")) {
      const productId = String(params[2] ?? "");
      const category = String(params[3] ?? "");
      const manufacturer = String(params[4] ?? "");
      const rows = Object.values(products).filter(
        (row) =>
          String(row.id_product) !== productId &&
          (String(row.id_category_default) === category || String(row.id_manufacturer) === manufacturer)
      );
      return { ok: true as const, rows: rows as T[] };
    }

    if (normalized.includes("from ps_product p") && normalized.includes("where p.id_product = ?")) {
      const productId = String(params.at(-1) ?? "");
      const row = products[productId] ?? null;
      return { ok: true as const, rows: row ? ([row as T] as T[]) : [] };
    }

    if (normalized.includes("from ps_product_attribute pa") && normalized.includes("pa.reference like ?")) {
      const like = String(params[4] ?? params[3] ?? "").replace(/%/g, "").toLowerCase();
      const rows = Object.values(variants).filter((row) => searchText(row).includes(like));
      return { ok: true as const, rows: rows as T[] };
    }

    if (normalized.includes("from ps_product p") && normalized.includes("p.active = 1")) {
      const like = String(params[2] ?? params[3] ?? "").replace(/%/g, "").toLowerCase();
      const rows = Object.values(products).filter((row) => searchText(row).includes(like));
      return { ok: true as const, rows: rows as T[] };
    }

    return { ok: false as const, rows: [] as T[], error: `Unhandled SQL: ${sql}` };
  }

  return {
    queries,
    queryRows: async <T>(sql: string, params: unknown[] = []) => {
      queries.push(sql);
      const result = await safeQueryRows<T>(sql, params);
      if (!result.ok) throw new Error(result.error);
      return result.rows;
    },
    safeQueryRows
  };
}

const snapshotService = createSnapshotCatalogService();
const prestashopFixture = buildFixtureRows();
const prestashopService = createPrestashopCatalogService({
  queryRows: prestashopFixture.queryRows,
  safeQueryRows: prestashopFixture.safeQueryRows
});
const failingPrestashopService = createPrestashopCatalogService({
  async queryRows() {
    throw new Error("db unavailable");
  },
  async safeQueryRows<T>(sql: string) {
    return { ok: false as const, rows: [] as T[], error: `db unavailable: ${sql}` };
  }
});

const adapters = [
  { name: "snapshot", service: snapshotService, context: makeContext({ shop: "cl-main", currency: "CLP" }) },
  { name: "prestashop", service: prestashopService, context: makeContext({ shop: "cl-main", currency: "CLP" }) }
] as const;

for (const adapter of adapters) {
  test(`${adapter.name}: search is deterministic and keeps product and variant separate`, async () => {
    const first = await adapter.service.searchProducts({ text: "bike pro", limit: 10 }, adapter.context);
    const second = await adapter.service.searchProducts({ text: "bike pro", limit: 10 }, adapter.context);
    assert.deepEqual(first, second);
    assert.ok(first.items.some((item) => item.product.id === "bike-pro"));
    assert.ok(first.items.some((item) => item.variant?.id === "bike-pro-black"));
    const productHit = first.items.find((item) => item.product.id === "bike-pro" && item.variant === null);
    const variantHit = first.items.find((item) => item.variant?.id === "bike-pro-black");
    assert.ok(productHit);
    assert.ok(variantHit);
    assert.notEqual(productHit?.product.id, variantHit?.variant?.id);
  });

  test(`${adapter.name}: product, variant, price, availability, dimensions and url`, async () => {
    const product = await adapter.service.getProduct("bike-pro", adapter.context);
    const variant = await adapter.service.getVariant("bike-pro-black", adapter.context);
    assert.ok(product);
    assert.ok(variant);
    assert.equal(product?.id, "bike-pro");
    assert.equal(variant?.productId, "bike-pro");

    const price = await adapter.service.getPrice("treadmill-sale", adapter.context);
    assert.equal(isUnknownCatalogValue(price), false);
    if (!isUnknownCatalogValue(price)) {
      assert.equal(price.currency, "CLP");
      assert.ok(price.salePrice && !isUnknownCatalogValue(price.salePrice));
      if (price.salePrice && !isUnknownCatalogValue(price.salePrice)) {
        assert.equal(price.salePrice.amount, adapter.name === "snapshot" ? 399000 : 250000);
      }
      assert.equal(price.validFrom, "2026-06-01T00:00:00.000Z");
    }

    const availability = await adapter.service.getAvailability("bench-basic", adapter.context);
    assert.equal(availability.status, "in_stock");
    assert.equal(availability.quantity, adapter.name === "snapshot" ? 12 : 7);

    const dimensions = await adapter.service.getDimensions("folding-bench", adapter.context);
    assert.equal(isUnknownCatalogValue(dimensions), false);
    if (!isUnknownCatalogValue(dimensions)) {
      assert.equal(isUnknownCatalogValue(dimensions.assembled), false);
      assert.equal(isUnknownCatalogValue(dimensions.packaged), false);
      if (!isUnknownCatalogValue(dimensions.assembled) && !isUnknownCatalogValue(dimensions.packaged)) {
        assert.equal(dimensions.assembled.unit, "cm");
        assert.equal(dimensions.packaged.unit, "cm");
      }
      assert.notDeepEqual(dimensions.assembled, dimensions.packaged);
    }

    const url = await adapter.service.getCommercialUrl("bench-basic", adapter.context);
    assert.equal(isUnknownCatalogValue(url), false);
    if (!isUnknownCatalogValue(url)) {
      assert.ok(url.href.includes("bench-basic"));
    }
  });

  test(`${adapter.name}: compatibility and related products`, async () => {
    const compatible = await adapter.service.getCompatibility(
      {
        subjectId: "bike-pro",
        requirements: { tags: ["bike"], category: "cardio", dimensions: null, useCase: null }
      },
      adapter.context
    );
    assert.equal(compatible.compatible, true);

    const incompatible = await adapter.service.getCompatibility(
      adapter.name === "snapshot"
        ? {
            subjectId: "bike-pro",
            candidateId: "tiny-mat",
            requirements: { tags: ["bike"], category: "cardio", dimensions: null, useCase: null }
          }
        : {
            subjectId: "bike-pro",
            requirements: { tags: [], category: "cardio", dimensions: { length: 10, width: 10, height: 10, unit: "cm" }, useCase: null }
          },
      adapter.context
    );
    assert.equal(incompatible.compatible, false);

    const unknown = await adapter.service.getCompatibility({ subjectId: "mystery-band" }, adapter.context);
    assert.equal(unknown.compatible, "unknown");

    const related = await adapter.service.getRelatedProducts("folding-bench", adapter.context);
    assert.ok(related.some((relation) => relation.relatedId === "mat-pro"));
  });

  test(`${adapter.name}: unknown stays unknown and provenance carries context`, async () => {
    const price = await adapter.service.getPrice("mystery-band", makeContext({ shop: "intl-store", currency: "USD" }));
    assert.equal(isUnknownCatalogValue(price), true);

    const availability = await adapter.service.getAvailability("paddock-rower", makeContext({ shop: "intl-store", currency: "USD" }));
    assert.equal(availability.status, "unknown");

    const dimensions = await adapter.service.getDimensions(adapter.name === "snapshot" ? "mystery-band" : "mystery-addon", makeContext({ shop: "intl-store", currency: "USD" }));
    assert.equal(isUnknownCatalogValue(dimensions), true);

    const url = await adapter.service.getCommercialUrl("missing-catalog-item", makeContext({ shop: "intl-store", currency: "USD" }));
    assert.equal(isUnknownCatalogValue(url), true);
  });
}

test("prestashop adapter degrades safely on infrastructure failure", async () => {
  const context = makeContext();
  const result = await failingPrestashopService.searchProducts({ text: "bike", limit: 5 }, context);
  assert.equal(result.items.length, 0);

  const price = await failingPrestashopService.getPrice("bike-pro", context);
  assert.equal(isUnknownCatalogValue(price), true);

  const availability = await failingPrestashopService.getAvailability("bike-pro", context);
  assert.equal(availability.status, "unknown");

  const dimensions = await failingPrestashopService.getDimensions("bike-pro", context);
  assert.equal(isUnknownCatalogValue(dimensions), true);

  const url = await failingPrestashopService.getCommercialUrl("bike-pro", context);
  assert.equal(isUnknownCatalogValue(url), true);
});

test("prestashop adapter issues only read queries", async () => {
  const context = makeContext();
  await prestashopService.searchProducts({ text: "bike", limit: 5 }, context);
  await prestashopService.getPrice("bike-pro", context);
  await prestashopService.getAvailability("bike-pro", context);
  await prestashopService.getDimensions("bike-pro", context);
  await prestashopService.getRelatedProducts("bike-pro", context);
  await prestashopService.getCommercialUrl("bike-pro", context);

  assert.ok(prestashopFixture.queries.length > 0);
  const forbidden = /^(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE)\b/;
  assert.equal(prestashopFixture.queries.some((sql) => forbidden.test(sql.trim())), false);
});
