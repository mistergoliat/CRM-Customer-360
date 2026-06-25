import { queryRows, safeQueryRows } from "@/lib/db";
import type {
  SalesConsultativeProduct,
  SalesConsultativeProductRepository,
  SalesNeedProfile
} from "./types";

type ProductRow = Record<string, unknown>;

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function tokenize(value: string) {
  return uniqueStrings(
    normalizeText(value)
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length > 1)
  );
}

function hasTableColumnsAvailable(rows: Array<{ Field: string }>) {
  return rows.length > 0;
}

async function getLanguageId() {
  const result = await safeQueryRows<{ id_lang?: number }>("SELECT id_lang FROM ps_product_lang LIMIT 1");
  if (!result.ok || result.rows.length === 0) return 1;
  return Number(result.rows[0]?.id_lang ?? 1) || 1;
}

async function getCategoryName(categoryId: string | number | null, languageId: number) {
  if (!categoryId) return null;
  const result = await safeQueryRows<{ name?: string }>("SELECT name FROM ps_category_lang WHERE id_category = ? AND id_lang = ? LIMIT 1", [categoryId, languageId]);
  if (!result.ok) return null;
  return toText(result.rows[0]?.name);
}

async function getManufacturerName(manufacturerId: string | number | null) {
  if (!manufacturerId) return null;
  const result = await safeQueryRows<{ name?: string }>("SELECT name FROM ps_manufacturer WHERE id_manufacturer = ? LIMIT 1", [manufacturerId]);
  if (!result.ok) return null;
  return toText(result.rows[0]?.name);
}

async function loadProductFeatures(productIds: Array<string | number>, languageId: number) {
  if (productIds.length === 0) return new Map<string, string[]>();
  const placeholders = productIds.map(() => "?").join(", ");
  const result = await safeQueryRows<{ id_product?: string | number; value?: string }>(
    `
      SELECT fp.id_product, COALESCE(fvl.value, CAST(fv.id_feature_value AS CHAR)) AS value
      FROM ps_feature_product fp
      LEFT JOIN ps_feature_value fv ON fv.id_feature_value = fp.id_feature_value
      LEFT JOIN ps_feature_value_lang fvl ON fvl.id_feature_value = fp.id_feature_value AND fvl.id_lang = ?
      WHERE fp.id_product IN (${placeholders})
    `,
    [languageId, ...productIds]
  );
  const map = new Map<string, string[]>();
  if (!result.ok) return map;
  for (const row of result.rows) {
    const id = toText(row.id_product);
    const value = toText(row.value);
    if (!id || !value) continue;
    const current = map.get(id) ?? [];
    current.push(value);
    map.set(id, uniqueStrings(current));
  }
  return map;
}

function rowToProduct(row: ProductRow, languageId: number, features: string[], compatibility: string[]): SalesConsultativeProduct {
  const id = toText(row.id_product) ?? "";
  const width = toNumber(row.width);
  const height = toNumber(row.height);
  const length = toNumber(row.depth ?? row.length);
  return {
    id,
    reference: toText(row.reference),
    name: toText(row.name) ?? id,
    category: toText(row.category_name),
    description: toText(row.description_short ?? row.description),
    price: toNumber(row.price),
    currency: "CLP",
    stockQuantity: toNumber(row.quantity),
    dimensions: width !== null || height !== null || length !== null ? { width, height, length, unit: "cm" } : null,
    features: uniqueStrings(features),
    compatibility: uniqueStrings(compatibility),
    relatedProductIds: [],
    manufacturer: toText(row.manufacturer_name),
    imageUrl: row.id_image ? `https://dummyimage.invalid/product/${row.id_image}` : null,
    source: "prestashop"
  };
}

function scoreQueryMatch(product: SalesConsultativeProduct, queryTokens: string[]) {
  const productTokens = tokenize([product.name, product.reference ?? "", product.category ?? "", product.description ?? "", ...product.features, ...product.compatibility].join(" "));
  return queryTokens.filter((token) => productTokens.includes(token)).length;
}

async function loadProductBaseRows(query: string, limit: number, languageId: number) {
  const normalizedQuery = query.trim();
  const like = `%${normalizedQuery}%`;
  const result = await safeQueryRows<ProductRow>(
    `
      SELECT
        p.id_product,
        p.reference,
        p.price,
        p.width,
        p.height,
        p.depth,
        p.id_manufacturer,
        p.id_category_default,
        p.id_image,
        pl.name,
        pl.description_short,
        pl.description,
        sa.quantity,
        m.name AS manufacturer_name,
        cl.name AS category_name
      FROM ps_product p
      LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
      LEFT JOIN ps_stock_available sa ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
      LEFT JOIN ps_manufacturer m ON m.id_manufacturer = p.id_manufacturer
      LEFT JOIN ps_category_lang cl ON cl.id_category = p.id_category_default AND cl.id_lang = ?
      WHERE p.active = 1 AND (
        p.reference LIKE ? OR
        pl.name LIKE ? OR
        pl.description_short LIKE ? OR
        pl.description LIKE ? OR
        m.name LIKE ? OR
        cl.name LIKE ?
      )
      ORDER BY COALESCE(sa.quantity, 0) DESC, p.id_product DESC
      LIMIT ${Math.max(1, Math.min(limit, 20))}
    `,
    [languageId, languageId, like, like, like, like, like, like]
  );
  if (!result.ok) return [];
  return result.rows;
}

async function buildProductsFromRows(rows: ProductRow[], languageId: number, query: string) {
  const ids = rows.map((row) => toText(row.id_product)).filter((value): value is string => Boolean(value));
  const featureMap = await loadProductFeatures(ids, languageId);
  const queryTokens = tokenize(query);

  const products = rows.map((row) => {
    const id = toText(row.id_product) ?? "";
    const features = featureMap.get(id) ?? [];
    const compatibility = uniqueStrings([
      toText(row.category_name),
      toText(row.manufacturer_name),
      ...features
    ]);
    const product = rowToProduct(row, languageId, features, compatibility);
    return {
      product,
      queryMatch: scoreQueryMatch(product, queryTokens)
    };
  });

  return products.sort((left, right) => right.queryMatch - left.queryMatch).map((item) => item.product);
}

async function loadProductDetails(productId: string, languageId: number): Promise<SalesConsultativeProduct | null> {
  const result = await safeQueryRows<ProductRow>(
    `
      SELECT
        p.id_product,
        p.reference,
        p.price,
        p.width,
        p.height,
        p.depth,
        p.id_manufacturer,
        p.id_category_default,
        p.id_image,
        pl.name,
        pl.description_short,
        pl.description,
        sa.quantity,
        m.name AS manufacturer_name,
        cl.name AS category_name
      FROM ps_product p
      LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
      LEFT JOIN ps_stock_available sa ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
      LEFT JOIN ps_manufacturer m ON m.id_manufacturer = p.id_manufacturer
      LEFT JOIN ps_category_lang cl ON cl.id_category = p.id_category_default AND cl.id_lang = ?
      WHERE p.id_product = ?
      LIMIT 1
    `,
    [languageId, languageId, productId]
  );
  if (!result.ok || result.rows.length === 0) return null;
  const featureMap = await loadProductFeatures([productId], languageId);
  const row = result.rows[0];
  const features = featureMap.get(productId) ?? [];
  const compatibility = uniqueStrings([toText(row.category_name), toText(row.manufacturer_name), ...features]);
  return rowToProduct(row, languageId, features, compatibility);
}

async function getStockForProduct(productId: string) {
  const result = await safeQueryRows<{ quantity?: number }>(
    "SELECT quantity FROM ps_stock_available WHERE id_product = ? AND id_product_attribute = 0 LIMIT 1",
    [productId]
  );
  if (!result.ok || result.rows.length === 0) return null;
  return toNumber(result.rows[0]?.quantity);
}

async function getPriceForProduct(productId: string) {
  const result = await safeQueryRows<{ price?: number; reduction?: number; reduction_type?: string }>(
    `
      SELECT price, reduction, reduction_type
      FROM ps_specific_price
      WHERE id_product = ?
      ORDER BY id_specific_price DESC
      LIMIT 1
    `,
    [productId]
  );
  if (result.ok && result.rows.length > 0) {
    const row = result.rows[0];
    const price = toNumber(row.price);
    const reduction = toNumber(row.reduction);
    if (price !== null) {
      if (reduction !== null && row.reduction_type === "amount") {
        return Math.max(0, price - reduction);
      }
      if (reduction !== null && row.reduction_type === "percentage") {
        return Math.max(0, price - price * reduction);
      }
      return price;
    }
  }

  const details = await loadProductDetails(productId, await getLanguageId());
  return details?.price ?? null;
}

async function getDimensionsForProduct(productId: string) {
  const details = await loadProductDetails(productId, await getLanguageId());
  return details?.dimensions ?? null;
}

async function getCompatibilityForProduct(productId: string) {
  const details = await loadProductDetails(productId, await getLanguageId());
  return details?.compatibility ?? [];
}

async function getRelatedProductsForProduct(productId: string) {
  const languageId = await getLanguageId();
  const baseDetails = await loadProductDetails(productId, languageId);
  if (!baseDetails) return [];

  const relatedRows = await loadProductBaseRows([baseDetails.name, ...baseDetails.features.slice(0, 3), ...baseDetails.compatibility.slice(0, 3)].join(" "), 6, languageId);
  const products = await buildProductsFromRows(relatedRows, languageId, baseDetails.name);
  return products.filter((product) => product.id !== productId).slice(0, 4);
}

export function createPrestashopProductRepository(): SalesConsultativeProductRepository {
  return {
    async searchProducts(input) {
      const languageId = await getLanguageId();
      const rows = await loadProductBaseRows(input.query, input.limit ?? 8, languageId);
      if (rows.length === 0) return [];
      return buildProductsFromRows(rows, languageId, input.query);
    },
    async getProductDetails(productId: string) {
      return loadProductDetails(productId, await getLanguageId());
    },
    async getProductPrice(productId: string) {
      return getPriceForProduct(productId);
    },
    async getProductStock(productId: string) {
      return getStockForProduct(productId);
    },
    async getProductDimensions(productId: string) {
      return getDimensionsForProduct(productId);
    },
    async getProductCompatibility(productId: string) {
      return getCompatibilityForProduct(productId);
    },
    async getRelatedProducts(productId: string) {
      return getRelatedProductsForProduct(productId);
    }
  };
}

export function createMemorySalesConsultativeProductRepository(products: SalesConsultativeProduct[]): SalesConsultativeProductRepository {
  const catalog = new Map<string, SalesConsultativeProduct>(products.map((product) => [product.id, product]));

  return {
    async searchProducts(input) {
      const queryTokens = tokenize(input.query);
      return [...catalog.values()]
        .map((product) => {
          const productTokens = tokenize(
            [
              product.name,
              product.reference ?? "",
              product.category ?? "",
              product.description ?? "",
              product.manufacturer ?? "",
              ...product.features,
              ...product.compatibility
            ].join(" ")
          );
          const match = queryTokens.filter((token) => productTokens.includes(token)).length;
          return { product, match };
        })
        .sort((left, right) => right.match - left.match)
        .slice(0, input.limit ?? 8)
        .map((item) => item.product);
    },
    async getProductDetails(productId: string) {
      return catalog.get(productId) ?? null;
    },
    async getProductPrice(productId: string) {
      return catalog.get(productId)?.price ?? null;
    },
    async getProductStock(productId: string) {
      return catalog.get(productId)?.stockQuantity ?? null;
    },
    async getProductDimensions(productId: string) {
      return catalog.get(productId)?.dimensions ?? null;
    },
    async getProductCompatibility(productId: string) {
      return catalog.get(productId)?.compatibility ?? [];
    },
    async getRelatedProducts(productId: string) {
      const product = catalog.get(productId);
      if (!product) return [];
      const targetTokens = tokenize([product.name, product.category ?? "", ...product.features, ...product.compatibility].join(" "));
      return [...catalog.values()]
        .filter((candidate) => candidate.id !== productId)
        .map((candidate) => {
          const candidateTokens = tokenize([candidate.name, candidate.category ?? "", ...candidate.features, ...candidate.compatibility].join(" "));
          const overlap = targetTokens.filter((token) => candidateTokens.includes(token)).length;
          return { candidate, overlap };
        })
        .filter((item) => item.overlap > 0)
        .sort((left, right) => right.overlap - left.overlap)
        .slice(0, 4)
        .map((item) => item.candidate);
    }
  };
}
