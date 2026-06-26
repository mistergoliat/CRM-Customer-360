import { queryRows as defaultQueryRows, safeQueryRows as defaultSafeQueryRows } from "@/lib/db";
import type {
  Availability,
  CatalogConfidence,
  CatalogContext,
  CatalogService,
  CatalogUrl,
  CompatibilityInput,
  CompatibilityResult,
  Dimensions,
  Product,
  ProductDimensions,
  ProductPrice,
  ProductRelation,
  ProductSearchHit,
  ProductSearchQuery,
  ProductSearchResult,
  ProductVariant,
  UnknownCatalogValue
} from "./types";
import { freshnessFor, makeProvenance, makeUnknownCatalogValue, normalizeText, tokenize, toNumber, toText } from "./utils";

type QueryRows = typeof defaultQueryRows;
type SafeQueryRows = typeof defaultSafeQueryRows;

type QueryClient = {
  queryRows: QueryRows;
  safeQueryRows: SafeQueryRows;
};

type PrestashopCatalogAdapterDependencies = Partial<QueryClient> & {
  defaultLanguageId?: number;
};

type DbRow = Record<string, unknown>;

type PriceRow = {
  list_price: number | null;
  sale_price: number | null;
  currency_iso: string | null;
  tax_included: boolean | null;
  tax_rate: number | null;
  tax_code: string | null;
  valid_from: string | null;
  valid_to: string | null;
  source: string | null;
  retrieved_at: string | null;
  confidence: CatalogConfidence | null;
  base_price: number | null;
  variant_price: number | null;
  reduction_type: string | null;
  reduction: number | null;
};

type AvailabilityRow = {
  quantity: number | null;
  location: string | null;
  lead_time_days: number | null;
  source: string | null;
  retrieved_at: string | null;
  confidence: CatalogConfidence | null;
  active: number | string | null;
};

type DimensionRow = {
  width: number | null;
  height: number | null;
  depth: number | null;
  packaged_width: number | null;
  packaged_height: number | null;
  packaged_depth: number | null;
  source: string | null;
  retrieved_at: string | null;
  confidence: CatalogConfidence | null;
};

type UrlRow = {
  href: string | null;
  url: string | null;
  domain_ssl: string | null;
  link_rewrite: string | null;
  name: string | null;
  reference: string | null;
  source: string | null;
  retrieved_at: string | null;
  confidence: CatalogConfidence | null;
};

type ProductRow = {
  id_product?: string | number;
  reference?: string | null;
  price?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  depth?: number | string | null;
  active?: number | string | null;
  name?: string | null;
  description_short?: string | null;
  description?: string | null;
  manufacturer_name?: string | null;
  category_name?: string | null;
  quantity?: number | string | null;
  link_rewrite?: string | null;
  domain_ssl?: string | null;
  url?: string | null;
  href?: string | null;
  id_shop_default?: number | string | null;
  id_manufacturer?: number | string | null;
  id_category_default?: number | string | null;
  retrieved_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  confidence?: CatalogConfidence | null;
};

type VariantRow = {
  id_product_attribute?: string | number;
  id_product?: string | number;
  reference?: string | null;
  price?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  depth?: number | string | null;
  default_on?: number | string | null;
  active?: number | string | null;
  name?: string | null;
  description_short?: string | null;
  description?: string | null;
  product_name?: string | null;
  product_reference?: string | null;
  base_price?: number | string | null;
  manufacturer_name?: string | null;
  category_name?: string | null;
  quantity?: number | string | null;
  link_rewrite?: string | null;
  domain_ssl?: string | null;
  url?: string | null;
  href?: string | null;
  option_values?: string | null;
  retrieved_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  confidence?: CatalogConfidence | null;
};

type TagRow = {
  category_name?: string | null;
  manufacturer_name?: string | null;
  reference?: string | null;
  name?: string | null;
  product_reference?: string | null;
  option_values?: string | null;
};

const DEFAULT_LANGUAGE_ID = 1;

function clientFromDependencies(dependencies: PrestashopCatalogAdapterDependencies): QueryClient {
  return {
    queryRows: dependencies.queryRows ?? defaultQueryRows,
    safeQueryRows: dependencies.safeQueryRows ?? defaultSafeQueryRows
  };
}

function buildProvenance(record: { source: string; retrievedAt: string; confidence: CatalogConfidence }, context: CatalogContext) {
  return makeProvenance({
    source: record.source,
    retrievedAt: record.retrievedAt,
    freshness: freshnessFor(record.retrievedAt, context.effectiveAt),
    confidence: record.confidence,
    tenant: context.tenant,
    shop: context.shop,
    locale: context.locale,
    currency: context.currency
  });
}

function unknownValue(reason: string, context: CatalogContext): UnknownCatalogValue {
  return makeUnknownCatalogValue(
    reason,
    makeProvenance({
      source: "prestashop",
      retrievedAt: context.effectiveAt,
      freshness: "unknown",
      confidence: "low",
      tenant: context.tenant,
      shop: context.shop,
      locale: context.locale,
      currency: context.currency
    })
  );
}

function isTruthyFlag(value: unknown) {
  return value === 1 || value === "1" || value === true;
}

function asDimensions(row: ProductRow | VariantRow | null): Dimensions | null {
  if (!row) return null;
  const length = toNumber(row.depth);
  const width = toNumber(row.width);
  const height = toNumber(row.height);
  if (length === null && width === null && height === null) return null;
  return {
    length: length ?? 0,
    width: width ?? 0,
    height: height ?? 0,
    unit: "cm"
  };
}

function dimensionsFromRow(row: DimensionRow | null, context: CatalogContext): ProductDimensions | UnknownCatalogValue {
  if (!row) return unknownValue("dimensions_unknown", context);
  const provenance = buildProvenance(
    {
      source: row.source ?? "prestashop",
      retrievedAt: row.retrieved_at ?? context.effectiveAt,
      confidence: row.confidence ?? "medium"
    },
    context
  );
  const assembled = row.width === null && row.height === null && row.depth === null ? null : { length: row.depth ?? 0, width: row.width ?? 0, height: row.height ?? 0, unit: "cm" };
  const packaged =
    row.packaged_width === null && row.packaged_height === null && row.packaged_depth === null
      ? null
      : { length: row.packaged_depth ?? 0, width: row.packaged_width ?? 0, height: row.packaged_height ?? 0, unit: "cm" };

  if (!assembled && !packaged) return unknownValue("dimensions_unknown", context);
  return {
    assembled: assembled ?? makeUnknownCatalogValue("assembled_dimensions_unknown", provenance),
    packaged: packaged ?? makeUnknownCatalogValue("packaged_dimensions_unknown", provenance),
    provenance
  };
}

function productStatus(active: unknown): Product["status"] {
  if (active === 0 || active === "0" || active === false) return "discontinued";
  if (active === 1 || active === "1" || active === true) return "active";
  return "unknown";
}

function normalizeTags(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)).flatMap((value) => tokenize(value)).filter(Boolean))];
}

function productTags(row: TagRow | null) {
  return normalizeTags([row?.category_name, row?.manufacturer_name, row?.reference, row?.name]);
}

function variantTags(row: TagRow | null) {
  return normalizeTags([row?.category_name, row?.manufacturer_name, row?.reference, row?.product_reference, row?.name, row?.option_values]);
}

function splitOptionValues(value: string | null | undefined) {
  if (!value) return {};
  const entries = value.split("|").map((token) => token.split(":")).filter((pair) => pair.length === 2);
  return Object.fromEntries(entries.map(([key, item]) => [key.trim(), item.trim()]));
}

function buildProduct(row: ProductRow, context: CatalogContext, variantIds: string[] = []): Product {
  const retrievedAt = row.retrieved_at ?? row.updated_at ?? row.created_at ?? context.effectiveAt;
  const confidence = row.confidence ?? "medium";
  const provenance = buildProvenance({ source: "prestashop", retrievedAt, confidence }, context);
  const id = toText(row.id_product ?? null) ?? "";
  return {
    id,
    familyId: id || null,
    sku: toText(row.reference),
    name: toText(row.name) ?? toText(row.reference) ?? id,
    slug: toText(row.link_rewrite),
    description: toText(row.description_short ?? row.description),
    brand: toText(row.manufacturer_name),
    category: toText(row.category_name),
    tags: productTags(row),
    attributes: {},
    status: productStatus(row.active),
    defaultVariantId: variantIds[0] ?? null,
    variantIds,
    commercialUrl: unknownValue("product_url_requires_catalog_lookup", context),
    provenance
  };
}

function buildVariant(row: VariantRow, context: CatalogContext): ProductVariant {
  const retrievedAt = row.retrieved_at ?? row.updated_at ?? row.created_at ?? context.effectiveAt;
  const confidence = row.confidence ?? "medium";
  const provenance = buildProvenance({ source: "prestashop", retrievedAt, confidence }, context);
  return {
    id: toText(row.id_product_attribute ?? null) ?? "",
    productId: toText(row.id_product ?? null) ?? "",
    sku: toText(row.reference),
    name: toText(row.name) ?? toText(row.product_name) ?? toText(row.reference) ?? toText(row.id_product_attribute ?? null) ?? "",
    description: toText(row.description_short ?? row.description),
    optionValues: splitOptionValues(row.option_values),
    status: productStatus(row.active),
    isDefault: isTruthyFlag(row.default_on),
    commercialUrl: unknownValue("variant_url_requires_catalog_lookup", context),
    provenance
  };
}

function parseLanguageId(rows: Array<{ id_lang?: number }>, fallback: number) {
  const candidate = rows[0]?.id_lang;
  return Number.isFinite(candidate ?? NaN) && (candidate ?? 0) > 0 ? Number(candidate) : fallback;
}

async function getLanguageId(client: QueryClient, fallback: number) {
  const result = await client.safeQueryRows<{ id_lang?: number }>("SELECT id_lang FROM ps_product_lang LIMIT 1");
  if (!result.ok || result.rows.length === 0) return fallback;
  return parseLanguageId(result.rows, fallback);
}

async function loadProductRow(client: QueryClient, productId: string, languageId: number) {
  const result = await client.safeQueryRows<ProductRow>(
    `
      SELECT
        p.id_product,
        p.reference,
        p.price,
        p.width,
        p.height,
        p.depth,
        p.active,
        pl.name,
        pl.description_short,
        pl.description,
        pl.link_rewrite,
        p.id_manufacturer,
        m.name AS manufacturer_name,
        p.id_category_default,
        cl.name AS category_name,
        sa.quantity,
        su.domain_ssl,
        su.domain,
        pl.link_rewrite AS url,
        pl.link_rewrite AS href
      FROM ps_product p
      LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
      LEFT JOIN ps_manufacturer m ON m.id_manufacturer = p.id_manufacturer
      LEFT JOIN ps_category_lang cl ON cl.id_category = p.id_category_default AND cl.id_lang = ?
      LEFT JOIN ps_stock_available sa ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
      LEFT JOIN ps_shop_url su ON su.id_shop = p.id_shop_default
      WHERE p.id_product = ?
      LIMIT 1
    `,
    [languageId, languageId, productId]
  );
  return result.ok ? result.rows[0] ?? null : null;
}

async function loadVariantRow(client: QueryClient, variantId: string, languageId: number) {
  const result = await client.safeQueryRows<VariantRow>(
    `
      SELECT
        pa.id_product_attribute,
        pa.id_product,
        pa.reference,
        pa.price,
        pa.width,
        pa.height,
        pa.depth,
        pa.default_on,
        pa.active,
        pl.name,
        pl.description_short,
        pl.description,
        pl.link_rewrite,
        p.reference AS product_reference,
        p.price AS base_price,
        p.id_manufacturer,
        m.name AS manufacturer_name,
        p.id_category_default,
        cl.name AS category_name,
        sa.quantity,
        su.domain_ssl,
        su.domain,
        pa.name AS variant_name,
        GROUP_CONCAT(CONCAT(al.name, ':', agl.name) ORDER BY al.name SEPARATOR '|') AS option_values
      FROM ps_product_attribute pa
      LEFT JOIN ps_product p ON p.id_product = pa.id_product
      LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
      LEFT JOIN ps_manufacturer m ON m.id_manufacturer = p.id_manufacturer
      LEFT JOIN ps_category_lang cl ON cl.id_category = p.id_category_default AND cl.id_lang = ?
      LEFT JOIN ps_stock_available sa ON sa.id_product = pa.id_product AND sa.id_product_attribute = pa.id_product_attribute
      LEFT JOIN ps_shop_url su ON su.id_shop = p.id_shop_default
      LEFT JOIN ps_product_attribute_combination pac ON pac.id_product_attribute = pa.id_product_attribute
      LEFT JOIN ps_attribute a ON a.id_attribute = pac.id_attribute
      LEFT JOIN ps_attribute_lang al ON al.id_attribute = a.id_attribute AND al.id_lang = ?
      LEFT JOIN ps_attribute_group_lang agl ON agl.id_attribute_group = a.id_attribute_group AND agl.id_lang = ?
      WHERE pa.id_product_attribute = ?
      GROUP BY pa.id_product_attribute
      LIMIT 1
    `,
    [languageId, languageId, languageId, languageId, variantId]
  );
  return result.ok ? result.rows[0] ?? null : null;
}

async function loadProductVariants(client: QueryClient, productId: string, languageId: number) {
  const result = await client.safeQueryRows<VariantRow>(
    `
      SELECT
        pa.id_product_attribute,
        pa.id_product,
        pa.reference,
        pa.price,
        pa.width,
        pa.height,
        pa.depth,
        pa.default_on,
        pa.active,
        pa.name,
        pl.name AS product_name,
        p.reference AS product_reference
      FROM ps_product_attribute pa
      LEFT JOIN ps_product p ON p.id_product = pa.id_product
      LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
      WHERE pa.id_product = ?
      ORDER BY pa.default_on DESC, pa.id_product_attribute ASC
    `,
    [languageId, productId]
  );
  return result.ok ? result.rows : [];
}

function priceFromRow(subjectType: "product" | "variant", subjectId: string, row: PriceRow, context: CatalogContext): ProductPrice | UnknownCatalogValue {
  if (row.list_price === null && row.base_price === null && row.variant_price === null) {
    return unknownValue("price_unknown", context);
  }

  const currency = row.currency_iso ?? context.currency;
  const baseAmount = row.list_price ?? row.base_price ?? 0;
  const variantDelta = row.variant_price ?? 0;
  const rawAmount = subjectType === "variant" ? baseAmount + variantDelta : baseAmount;
  const saleAmount =
    row.sale_price !== null
      ? row.sale_price
      : row.reduction !== null && row.reduction_type
        ? row.reduction_type === "percentage"
          ? rawAmount - rawAmount * row.reduction
          : rawAmount - row.reduction
        : null;
  const listPrice = { amount: rawAmount, currency };
  const salePrice = saleAmount === null ? null : { amount: Math.max(0, saleAmount), currency };
  const effectivePrice = salePrice ?? listPrice;
  const retrievedAt = row.retrieved_at ?? context.effectiveAt;
  const provenance = buildProvenance(
    {
      source: row.source ?? "prestashop",
      retrievedAt,
      confidence: row.confidence ?? "medium"
    },
    context
  );
  return {
    subjectType,
    subjectId,
    listPrice,
    salePrice,
    effectivePrice,
    currency,
    tax: {
      included: row.tax_included ?? true,
      rate: row.tax_rate,
      code: row.tax_code
    },
    validFrom: row.valid_from,
    validTo: row.valid_to,
    source: row.source ?? "prestashop",
    retrievedAt,
    freshness: freshnessFor(retrievedAt, context.effectiveAt),
    provenance
  };
}

function availabilityFromRow(row: AvailabilityRow | null, context: CatalogContext): Availability {
  if (!row) {
    return {
      status: "unknown",
      quantity: null,
      location: null,
      leadTimeDays: null,
      source: "prestashop",
      retrievedAt: context.effectiveAt,
      freshness: "unknown",
      provenance: unknownValue("availability_unknown", context).provenance
    };
  }

  const retrievedAt = row.retrieved_at ?? context.effectiveAt;
  const provenance = buildProvenance(
    {
      source: row.source ?? "prestashop",
      retrievedAt,
      confidence: row.confidence ?? "medium"
    },
    context
  );
  const status =
    row.active === 0 || row.active === "0"
      ? "discontinued"
      : row.quantity === null
        ? "unknown"
        : row.quantity > 0
          ? "in_stock"
          : "out_of_stock";

  return {
    status,
    quantity: row.quantity,
    location: row.location,
    leadTimeDays: row.lead_time_days,
    source: row.source ?? "prestashop",
    retrievedAt,
    freshness: freshnessFor(retrievedAt, context.effectiveAt),
    provenance
  };
}

function dimensionsFromProductRow(row: ProductRow | VariantRow | null, context: CatalogContext): ProductDimensions | UnknownCatalogValue {
  if (!row) return unknownValue("dimensions_unknown", context);
  const assembled = asDimensions(row);
  if (!assembled) return unknownValue("dimensions_unknown", context);
  const provenance = buildProvenance(
    {
      source: "prestashop",
      retrievedAt: row.retrieved_at ?? row.updated_at ?? row.created_at ?? context.effectiveAt,
      confidence: row.confidence ?? "medium"
    },
    context
  );
  const packaged =
    toNumber((row as DbRow).packaged_width) === null &&
    toNumber((row as DbRow).packaged_height) === null &&
    toNumber((row as DbRow).packaged_depth) === null
      ? null
      : {
          length: toNumber((row as DbRow).packaged_depth) ?? 0,
          width: toNumber((row as DbRow).packaged_width) ?? 0,
          height: toNumber((row as DbRow).packaged_height) ?? 0,
          unit: "cm"
        };
  return {
    assembled,
    packaged: packaged ?? makeUnknownCatalogValue("packaged_dimensions_unknown", provenance),
    provenance
  };
}

function commercialUrlFromRow(row: UrlRow | null, context: CatalogContext): CatalogUrl | UnknownCatalogValue {
  if (!row) return unknownValue("commercial_url_unknown", context);
  const retrievedAt = row.retrieved_at ?? context.effectiveAt;
  const provenance = buildProvenance(
    {
      source: row.source ?? "prestashop",
      retrievedAt,
      confidence: row.confidence ?? "medium"
    },
    context
  );
  const href =
    row.href ??
    row.url ??
    (row.domain_ssl && row.link_rewrite
      ? `https://${row.domain_ssl.replace(/^https?:\/\//, "")}/${row.link_rewrite.replace(/^\/+/, "")}.html`
      : null);
  if (!href) return unknownValue("commercial_url_unknown", context);
  return {
    href,
    label: row.name ?? row.reference ?? href,
    source: row.source ?? "prestashop",
    retrievedAt,
    freshness: freshnessFor(retrievedAt, context.effectiveAt),
    provenance
  };
}

function subjectTagsFromRows(product: TagRow | null, variant: TagRow | null) {
  return new Set([
    ...productTags(product),
    ...variantTags(variant)
  ]);
}

function scoreSubject(text: string, tokens: string[], productText: string, variantText: string) {
  const subjectTokens = tokenize(`${productText} ${variantText}`);
  const overlap = tokens.filter((token) => subjectTokens.includes(token)).length;
  const exactMatch = normalizeText(productText).includes(normalizeText(text)) ? 4 : 0;
  const variantMatch = normalizeText(variantText).includes(normalizeText(text)) ? 2 : 0;
  return overlap * 2 + exactMatch + variantMatch;
}

function buildSearchHit(
  productRow: ProductRow,
  variantRow: VariantRow | null,
  context: CatalogContext,
  query: ProductSearchQuery,
  queryTokens: string[]
): ProductSearchHit {
  const product = buildProduct(productRow, context, variantRow ? [toText(variantRow.id_product_attribute ?? null) ?? ""] : []);
  const variant = variantRow ? buildVariant(variantRow, context) : null;
  const productText = [product.name, product.sku ?? "", product.description ?? "", product.category ?? "", product.brand ?? ""].join(" ");
  const variantText = variant ? [variant.name, variant.sku ?? "", variant.description ?? "", Object.values(variant.optionValues).join(" ")].join(" ") : "";
  const score = scoreSubject(query.text, queryTokens, productText, variantText);
  const availability = availabilityFromRow(
    {
      quantity: toNumber((variantRow ?? productRow).quantity),
      location: null,
      lead_time_days: null,
      source: "prestashop",
      retrieved_at: (variantRow ?? productRow).retrieved_at ?? context.effectiveAt,
      confidence: (variantRow ?? productRow).confidence ?? "medium",
      active: (variantRow ?? productRow).active ?? null
    },
    context
  );
  const priceRow: PriceRow = {
    list_price: null,
    sale_price: null,
    currency_iso: context.currency,
    tax_included: true,
    tax_rate: null,
    tax_code: null,
    valid_from: null,
    valid_to: null,
    source: "prestashop",
    retrieved_at: (variantRow ?? productRow).retrieved_at ?? context.effectiveAt,
    confidence: (variantRow ?? productRow).confidence ?? "medium",
    base_price: toNumber(productRow.price),
    variant_price: variantRow ? toNumber(variantRow.price) : null,
    reduction_type: null,
    reduction: null
  };

  return {
    product,
    variant,
    score,
    reasons: score > 0 ? [`Matches ${queryTokens.slice(0, 3).join(", ")}`] : [],
    price: priceFromRow(variantRow ? "variant" : "product", variantRow ? String(variantRow.id_product_attribute ?? product.id) : product.id, priceRow, context),
    availability,
    dimensions: dimensionsFromProductRow(variantRow ?? productRow, context),
    compatibility: compatibilityFromRows(
      productRow,
      variantRow,
      context,
      {
        subjectId: variantRow ? toText(variantRow.id_product_attribute ?? null) ?? product.id : product.id,
        candidateId: query.productId ?? query.variantId ?? null,
        requirements: {
          tags: query.filters?.tags ?? [],
          category: query.filters?.category ?? null,
          dimensions: null,
          useCase: null
        }
      }
    ),
    commercialUrl: commercialUrlFromRow(
      {
        href: toText((variantRow ?? productRow).href ?? null),
        url: toText((variantRow ?? productRow).url ?? null),
        domain_ssl: toText((variantRow ?? productRow).domain_ssl ?? null),
        link_rewrite: toText((variantRow ?? productRow).link_rewrite ?? null),
        name: toText((variantRow ?? productRow).name ?? null) ?? toText(productRow.name ?? null),
        reference: toText((variantRow ?? productRow).reference ?? null) ?? toText(productRow.reference ?? null),
        source: "prestashop",
        retrieved_at: (variantRow ?? productRow).retrieved_at ?? context.effectiveAt,
        confidence: (variantRow ?? productRow).confidence ?? "medium"
      },
      context
    ),
    provenance: buildProvenance(
      {
        source: "prestashop",
        retrievedAt: (variantRow ?? productRow).retrieved_at ?? context.effectiveAt,
        confidence: (variantRow ?? productRow).confidence ?? "medium"
      },
      context
    )
  };
}

function compatibilityFromRows(productRow: ProductRow, variantRow: VariantRow | null, context: CatalogContext, query: CompatibilityInput): CompatibilityResult {
  const provenance = buildProvenance(
    {
      source: "prestashop",
      retrievedAt: (variantRow ?? productRow).retrieved_at ?? context.effectiveAt,
      confidence: (variantRow ?? productRow).confidence ?? "medium"
    },
    context
  );
  const tags = subjectTagsFromRows(productRow, variantRow);
  const requirementTags = query.requirements?.tags?.map((tag) => normalizeText(tag)) ?? [];
  const matchedTags = requirementTags.filter((tag) => tags.has(tag));
  if (matchedTags.length > 0) {
    return {
      compatible: true,
      reasons: matchedTags.map((tag) => `Matched tag ${tag}`),
      restrictions: [],
      evidence: [productRow.id_product ? String(productRow.id_product) : "unknown"],
      provenance
    };
  }

  const dimensions = asDimensions(variantRow ?? productRow);
  const need = query.requirements?.dimensions ?? null;
  if (dimensions && need) {
    const exceeds =
      (need.length !== null && need.length !== undefined && dimensions.length > need.length) ||
      (need.width !== null && need.width !== undefined && dimensions.width > need.width) ||
      (need.height !== null && need.height !== undefined && dimensions.height > need.height);
    if (exceeds) {
      return {
        compatible: false,
        reasons: ["Dimensions exceed the requested space."],
        restrictions: ["space_constraint"],
        evidence: [productRow.id_product ? String(productRow.id_product) : "unknown"],
        provenance
      };
    }
    return {
      compatible: true,
      reasons: ["Dimensions fit the requested space."],
      restrictions: [],
      evidence: [productRow.id_product ? String(productRow.id_product) : "unknown"],
      provenance
    };
  }

  return {
    compatible: "unknown",
    reasons: ["Compatibility cannot be demonstrated from the available PrestaShop data."],
    restrictions: [],
    evidence: [productRow.id_product ? String(productRow.id_product) : "unknown"],
    provenance
  };
}

function resolveProductFilter(subject: ProductRow | VariantRow, query: ProductSearchQuery, context: CatalogContext) {
  if (query.filters?.shop && query.filters.shop !== context.shop) return false;
  if (query.filters?.currency && query.filters.currency !== context.currency) return false;
  if (query.filters?.locale && query.filters.locale !== context.locale) return false;
  const subjectStatus = productStatus(subject.active);
  if (query.filters?.status && !query.filters.status.includes(subjectStatus)) return false;
  if (query.filters?.category && normalizeText(toText((subject as ProductRow).category_name ?? null) ?? "") !== normalizeText(query.filters.category)) return false;
  if (query.filters?.tags && query.filters.tags.length > 0) {
    const tags = subjectTagsFromRows(
      {
        category_name: subject.category_name,
        manufacturer_name: subject.manufacturer_name,
        reference: subject.reference,
        name: subject.name
      },
      "id_product_attribute" in subject
        ? {
            category_name: subject.category_name,
            manufacturer_name: subject.manufacturer_name,
            reference: subject.reference,
            name: subject.name,
            product_reference: subject.product_reference,
            option_values: subject.option_values
          }
        : null
    );
    if (!query.filters.tags.some((tag) => tags.has(normalizeText(tag)))) return false;
  }
  return true;
}

async function loadSearchProductRows(client: QueryClient, queryText: string, languageId: number, limit: number) {
  const like = `%${queryText.trim()}%`;
  const result = await client.safeQueryRows<ProductRow>(
    `
      SELECT
        p.id_product,
        p.reference,
        p.price,
        p.width,
        p.height,
        p.depth,
        p.active,
        pl.name,
        pl.description_short,
        pl.description,
        pl.link_rewrite,
        m.name AS manufacturer_name,
        cl.name AS category_name,
        sa.quantity,
        su.domain_ssl,
        pl.link_rewrite AS url,
        pl.link_rewrite AS href,
        p.id_shop_default,
        p.id_manufacturer,
        p.id_category_default
      FROM ps_product p
      LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
      LEFT JOIN ps_manufacturer m ON m.id_manufacturer = p.id_manufacturer
      LEFT JOIN ps_category_lang cl ON cl.id_category = p.id_category_default AND cl.id_lang = ?
      LEFT JOIN ps_stock_available sa ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
      LEFT JOIN ps_shop_url su ON su.id_shop = p.id_shop_default
      WHERE p.active = 1 AND (
        p.reference LIKE ? OR
        pl.name LIKE ? OR
        pl.description_short LIKE ? OR
        pl.description LIKE ? OR
        m.name LIKE ? OR
        cl.name LIKE ?
      )
      ORDER BY p.id_product DESC
      LIMIT ${Math.max(1, Math.min(limit, 20))}
    `,
    [languageId, languageId, like, like, like, like, like, like]
  );
  return result.ok ? result.rows : [];
}

async function loadSearchVariantRows(client: QueryClient, queryText: string, languageId: number, limit: number) {
  const like = `%${queryText.trim()}%`;
  const result = await client.safeQueryRows<VariantRow>(
    `
      SELECT
        pa.id_product_attribute,
        pa.id_product,
        pa.reference,
        pa.price,
        pa.width,
        pa.height,
        pa.depth,
        pa.default_on,
        pa.active,
        pa.name,
        pl.name AS product_name,
        pl.description_short,
        pl.description,
        pl.link_rewrite,
        p.reference AS product_reference,
        p.price AS base_price,
        m.name AS manufacturer_name,
        cl.name AS category_name,
        sa.quantity,
        su.domain_ssl,
        pa.name AS variant_name,
        GROUP_CONCAT(CONCAT(al.name, ':', agl.name) ORDER BY al.name SEPARATOR '|') AS option_values
      FROM ps_product_attribute pa
      LEFT JOIN ps_product p ON p.id_product = pa.id_product
      LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
      LEFT JOIN ps_manufacturer m ON m.id_manufacturer = p.id_manufacturer
      LEFT JOIN ps_category_lang cl ON cl.id_category = p.id_category_default AND cl.id_lang = ?
      LEFT JOIN ps_stock_available sa ON sa.id_product = pa.id_product AND sa.id_product_attribute = pa.id_product_attribute
      LEFT JOIN ps_shop_url su ON su.id_shop = p.id_shop_default
      LEFT JOIN ps_product_attribute_combination pac ON pac.id_product_attribute = pa.id_product_attribute
      LEFT JOIN ps_attribute a ON a.id_attribute = pac.id_attribute
      LEFT JOIN ps_attribute_lang al ON al.id_attribute = a.id_attribute AND al.id_lang = ?
      LEFT JOIN ps_attribute_group_lang agl ON agl.id_attribute_group = a.id_attribute_group AND agl.id_lang = ?
      WHERE pa.reference LIKE ? OR pa.name LIKE ? OR pl.name LIKE ? OR pa.description_short LIKE ? OR pa.description LIKE ?
      GROUP BY pa.id_product_attribute
      ORDER BY pa.id_product_attribute DESC
      LIMIT ${Math.max(1, Math.min(limit, 20))}
    `,
    [languageId, languageId, languageId, languageId, like, like, like, like, like]
  );
  return result.ok ? result.rows : [];
}

async function loadSingleRow<T>(client: QueryClient, sql: string, params: unknown[]) {
  const result = await client.safeQueryRows<T>(sql, params);
  return result.ok ? result.rows[0] ?? null : null;
}

async function loadSpecificPriceRow(client: QueryClient, productId: string, productAttributeId: string | number | null, languageId: number) {
  return loadSingleRow<PriceRow>(
    client,
    `
      SELECT
        sp.price AS list_price,
        sp.reduction AS sale_price,
        sp.id_currency AS currency_iso,
        sp.from_date AS valid_from,
        sp.to_date AS valid_to,
        sp.reduction_type,
        sp.reduction,
        sp.id_product,
        sp.id_product_attribute,
        sp.retrieved_at,
        sp.confidence
      FROM ps_specific_price sp
      WHERE sp.id_product = ? AND (sp.id_product_attribute = ? OR sp.id_product_attribute = 0)
      ORDER BY sp.id_specific_price DESC
      LIMIT 1
    `,
    [productId, productAttributeId ?? 0]
  );
}

function searchScore(text: string, queryTokens: string[]) {
  const tokens = tokenize(text);
  return queryTokens.filter((token) => tokens.includes(token)).length;
}

export function createPrestashopCatalogService(dependencies: PrestashopCatalogAdapterDependencies = {}): CatalogService {
  const client = clientFromDependencies(dependencies);
  const defaultLanguageId = dependencies.defaultLanguageId ?? DEFAULT_LANGUAGE_ID;

  return {
    async searchProducts(query: ProductSearchQuery, context: CatalogContext): Promise<ProductSearchResult> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const queryTokens = tokenize(query.text);
      const limit = query.limit ?? 8;
      const productRows = await loadSearchProductRows(client, query.text, languageId, limit);
      const variantRows = await loadSearchVariantRows(client, query.text, languageId, limit);

      const productHits = productRows
        .filter((row) => resolveProductFilter(row, query, context))
        .map((row) => buildSearchHit(row, null, context, query, queryTokens));
      const variantHits = variantRows
        .filter((row) => resolveProductFilter(row, query, context))
        .map((row) => {
          const productRow: ProductRow = {
            id_product: row.id_product,
            reference: row.product_reference,
            price: row.base_price,
            width: row.width,
            height: row.height,
            depth: row.depth,
            active: row.active,
            name: row.product_name,
            description_short: row.description_short,
            description: row.description,
            manufacturer_name: row.manufacturer_name,
            category_name: row.category_name,
            quantity: row.quantity,
            link_rewrite: row.link_rewrite,
            domain_ssl: row.domain_ssl,
            url: row.link_rewrite ?? null,
            href: row.link_rewrite ?? null,
            confidence: row.confidence ?? "medium",
            retrieved_at: row.retrieved_at ?? row.updated_at ?? row.created_at ?? context.effectiveAt
          };
          return buildSearchHit(productRow, row, context, query, queryTokens);
        });

      const items = [...productHits, ...variantHits]
        .filter((hit) => hit.score > 0 || query.text.trim().length === 0)
        .sort((left, right) => right.score - left.score || left.product.id.localeCompare(right.product.id) || (left.variant?.id ?? "").localeCompare(right.variant?.id ?? ""))
        .slice(0, limit);

      return {
        query,
        items,
        total: items.length,
        provenance: buildProvenance(
          {
            source: "prestashop",
            retrievedAt: context.effectiveAt,
            confidence: "medium"
          },
          context
        )
      };
    },
    async getProduct(productId: string, context: CatalogContext): Promise<Product | null> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const row = await loadProductRow(client, productId, languageId);
      if (!row) return null;
      const variants = await loadProductVariants(client, productId, languageId);
      return buildProduct(row, context, variants.map((variant) => toText(variant.id_product_attribute ?? null) ?? "").filter(Boolean));
    },
    async getVariant(variantId: string, context: CatalogContext): Promise<ProductVariant | null> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const row = await loadVariantRow(client, variantId, languageId);
      return row ? buildVariant(row, context) : null;
    },
    async getPrice(subjectId: string, context: CatalogContext): Promise<ProductPrice | UnknownCatalogValue> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const variantRow = await loadVariantRow(client, subjectId, languageId);
      if (variantRow) {
        const modifier = await loadSpecificPriceRow(client, String(variantRow.id_product ?? subjectId), variantRow.id_product_attribute ?? null, languageId);
        return priceFromRow(
          "variant",
          subjectId,
          {
            list_price: modifier?.list_price ?? null,
            sale_price: modifier?.sale_price ?? null,
            currency_iso: modifier?.currency_iso ?? context.currency,
            tax_included: true,
            tax_rate: null,
            tax_code: null,
            valid_from: modifier?.valid_from ?? null,
            valid_to: modifier?.valid_to ?? null,
            source: "prestashop",
            retrieved_at: modifier?.retrieved_at ?? variantRow.retrieved_at ?? context.effectiveAt,
            confidence: modifier?.confidence ?? variantRow.confidence ?? "medium",
            base_price: toNumber(variantRow.base_price),
            variant_price: toNumber(variantRow.price),
            reduction_type: modifier?.reduction_type ?? null,
            reduction: modifier?.reduction ?? null
          },
          context
        );
      }

      const productRow = await loadProductRow(client, subjectId, languageId);
      if (!productRow) return unknownValue("price_unknown", context);
      const modifier = await loadSpecificPriceRow(client, String(productRow.id_product ?? subjectId), 0, languageId);
      return priceFromRow(
        "product",
        subjectId,
        {
          list_price: modifier?.list_price ?? null,
          sale_price: modifier?.sale_price ?? null,
          currency_iso: modifier?.currency_iso ?? context.currency,
          tax_included: true,
          tax_rate: null,
          tax_code: null,
          valid_from: modifier?.valid_from ?? null,
          valid_to: modifier?.valid_to ?? null,
          source: "prestashop",
          retrieved_at: modifier?.retrieved_at ?? productRow.retrieved_at ?? context.effectiveAt,
          confidence: modifier?.confidence ?? productRow.confidence ?? "medium",
          base_price: toNumber(productRow.price),
          variant_price: null,
          reduction_type: modifier?.reduction_type ?? null,
          reduction: modifier?.reduction ?? null
        },
        context
      );
    },
    async getAvailability(subjectId: string, context: CatalogContext): Promise<Availability> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const variantRow = await loadVariantRow(client, subjectId, languageId);
      if (variantRow) {
        return availabilityFromRow(
          {
            quantity: toNumber(variantRow.quantity),
            location: null,
            lead_time_days: null,
            source: "prestashop",
            retrieved_at: variantRow.retrieved_at ?? context.effectiveAt,
            confidence: variantRow.confidence ?? "medium",
            active: variantRow.active ?? null
          },
          context
        );
      }
      const productRow = await loadProductRow(client, subjectId, languageId);
      return availabilityFromRow(
        productRow
          ? {
              quantity: toNumber(productRow.quantity),
              location: null,
              lead_time_days: null,
              source: "prestashop",
              retrieved_at: productRow.retrieved_at ?? context.effectiveAt,
              confidence: productRow.confidence ?? "medium",
              active: productRow.active ?? null
            }
          : null,
        context
      );
    },
    async getDimensions(subjectId: string, context: CatalogContext): Promise<ProductDimensions | UnknownCatalogValue> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const variantRow = await loadVariantRow(client, subjectId, languageId);
      if (variantRow) {
        return dimensionsFromProductRow(variantRow, context);
      }
      const productRow = await loadProductRow(client, subjectId, languageId);
      return dimensionsFromProductRow(productRow, context);
    },
    async getCompatibility(input: CompatibilityInput, context: CatalogContext): Promise<CompatibilityResult> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const variantRow = await loadVariantRow(client, input.subjectId, languageId);
      const productRow = variantRow ? await loadProductRow(client, String(variantRow.id_product ?? input.subjectId), languageId) : await loadProductRow(client, input.subjectId, languageId);
      if (!productRow) {
        return {
          compatible: "unknown",
          reasons: ["Subject not found."],
          restrictions: [],
          evidence: [],
          provenance: unknownValue("compatibility_unknown", context).provenance
        };
      }
      return compatibilityFromRows(productRow, variantRow, context, input);
    },
    async getRelatedProducts(subjectId: string, context: CatalogContext): Promise<ProductRelation[]> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const variantRow = await loadVariantRow(client, subjectId, languageId);
      const productId = variantRow ? String(variantRow.id_product ?? subjectId) : subjectId;
      const productRow = await loadProductRow(client, productId, languageId);
      if (!productRow) return [];

      const query = await client.safeQueryRows<Record<string, unknown>>(
        `
          SELECT
            p.id_product,
            p.reference,
            p.active,
            pl.name,
            pl.description_short,
            m.name AS manufacturer_name,
            cl.name AS category_name
          FROM ps_product p
          LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ?
          LEFT JOIN ps_manufacturer m ON m.id_manufacturer = p.id_manufacturer
          LEFT JOIN ps_category_lang cl ON cl.id_category = p.id_category_default AND cl.id_lang = ?
          WHERE p.id_product <> ? AND (p.id_category_default = ? OR p.id_manufacturer = ?)
          ORDER BY p.id_product DESC
          LIMIT 8
        `,
        [languageId, languageId, productId, productRow.id_category_default ?? null, productRow.id_manufacturer ?? null]
      );
      if (!query.ok) return [];

      const provenance = buildProvenance(
        {
          source: "prestashop",
          retrievedAt: productRow.retrieved_at ?? context.effectiveAt,
          confidence: productRow.confidence ?? "medium"
        },
        context
      );

      const relations: ProductRelation[] = [];
      for (const row of query.rows) {
        const relatedId = toText(row.id_product ?? null);
        if (!relatedId) continue;
        relations.push({
          subjectId: productId,
          relatedId,
          relationType: "same_family",
          reason: "Same category or manufacturer.",
          provenance
        });
      }
      return relations;
    },
    async getCommercialUrl(subjectId: string, context: CatalogContext): Promise<CatalogUrl | UnknownCatalogValue> {
      const languageId = await getLanguageId(client, defaultLanguageId);
      const variantRow = await loadVariantRow(client, subjectId, languageId);
      if (variantRow) {
        return commercialUrlFromRow(
          {
            href: toText(variantRow.href ?? null),
            url: toText(variantRow.url ?? null),
            domain_ssl: toText(variantRow.domain_ssl ?? null),
            link_rewrite: toText(variantRow.link_rewrite ?? null),
            name: toText(variantRow.name ?? null) ?? toText(variantRow.product_name ?? null),
            reference: toText(variantRow.reference ?? null),
            source: "prestashop",
            retrieved_at: variantRow.retrieved_at ?? context.effectiveAt,
            confidence: variantRow.confidence ?? "medium"
          },
          context
        );
      }

      const productRow = await loadProductRow(client, subjectId, languageId);
      if (!productRow) return unknownValue("commercial_url_unknown", context);
      return commercialUrlFromRow(
        {
          href: toText(productRow.href ?? null),
          url: toText(productRow.url ?? null),
          domain_ssl: toText(productRow.domain_ssl ?? null),
          link_rewrite: toText(productRow.link_rewrite ?? null),
          name: toText(productRow.name ?? null),
          reference: toText(productRow.reference ?? null),
          source: "prestashop",
          retrieved_at: productRow.retrieved_at ?? context.effectiveAt,
          confidence: productRow.confidence ?? "medium"
        },
        context
      );
    }
  };
}
