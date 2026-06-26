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
import { freshnessFor, makeProvenance, makeUnknownCatalogValue, normalizeText, tokenize } from "./utils";
import { snapshotProducts, snapshotVariants } from "./snapshot-data";

type SnapshotProductRecord = (typeof snapshotProducts)[number];
type SnapshotVariantRecord = (typeof snapshotVariants)[number];
type SnapshotPriceRecord = SnapshotVariantRecord["price"][number];
type SnapshotAvailabilityRecord = SnapshotVariantRecord["availability"][number];
type SnapshotDimensionRecord = SnapshotVariantRecord["dimensions"][number];
type SnapshotUrlRecord = SnapshotVariantRecord["commercialUrl"][number];

type SnapshotSubject =
  | {
      kind: "product";
      product: SnapshotProductRecord;
      variant: null;
    }
  | {
      kind: "variant";
      product: SnapshotProductRecord;
      variant: SnapshotVariantRecord;
    };

type SnapshotState = {
  productsById: Map<string, SnapshotProductRecord>;
  variantsById: Map<string, SnapshotVariantRecord>;
  variantsByProductId: Map<string, SnapshotVariantRecord[]>;
};

type ContextSelection = {
  shop: string;
  currency: string | null;
  locale: string | null;
};

function buildState(): SnapshotState {
  const productsById = new Map(snapshotProducts.map((product) => [product.id, product] as const));
  const variantsById = new Map(snapshotVariants.map((variant) => [variant.id, variant] as const));
  const variantsByProductId = new Map<string, SnapshotVariantRecord[]>();

  for (const variant of snapshotVariants) {
    const current = variantsByProductId.get(variant.productId) ?? [];
    current.push(variant);
    variantsByProductId.set(variant.productId, current);
  }

  return { productsById, variantsById, variantsByProductId };
}

function provenance(
  record: {
    source: string;
    retrievedAt: string;
    confidence: CatalogConfidence;
  },
  context: CatalogContext
) {
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
      source: "snapshot",
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

function pickRecord<T extends { shop: string; currency?: string | null; locale?: string | null }>(
  records: T[],
  context: ContextSelection
) {
  return (
    records.find((record) => {
      const shopMatch = record.shop === context.shop;
      const currencyMatch = context.currency === null || record.currency === undefined || record.currency === context.currency;
      const localeMatch = context.locale === null || record.locale === undefined || record.locale === context.locale;
      return shopMatch && currencyMatch && localeMatch;
    }) ??
    records.find((record) => record.shop === context.shop) ??
    records[0] ??
    null
  );
}

function productEntity(product: SnapshotProductRecord, context: CatalogContext): Product {
  return {
    id: product.id,
    familyId: product.familyId,
    sku: product.sku,
    name: product.name,
    slug: product.slug,
    description: product.description,
    brand: product.brand,
    category: product.category,
    tags: [...product.tags],
    attributes: { ...product.attributes },
    status: product.status,
    defaultVariantId: product.defaultVariantId,
    variantIds: [...product.variantIds],
    commercialUrl: unknownValue("product_url_requires_catalog_lookup", context),
    provenance: provenance(product.provenance, context)
  };
}

function variantEntity(variant: SnapshotVariantRecord, context: CatalogContext): ProductVariant {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    name: variant.name,
    description: variant.description,
    optionValues: { ...variant.optionValues },
    status: variant.status,
    isDefault: variant.isDefault,
    commercialUrl: unknownValue("variant_url_requires_catalog_lookup", context),
    provenance: provenance(variant.provenance, context)
  };
}

function subjectSearchText(subject: SnapshotSubject) {
  const variant = subject.variant;
  return [
    subject.product.name,
    subject.product.sku ?? "",
    subject.product.description ?? "",
    subject.product.category ?? "",
    subject.product.brand ?? "",
    ...subject.product.tags,
    ...Object.values(subject.product.attributes),
    variant?.name ?? "",
    variant?.sku ?? "",
    variant ? Object.values(variant.optionValues).join(" ") : "",
    variant?.description ?? "",
    ...(variant?.tags ?? [])
  ]
    .join(" ")
    .trim();
}

function buildSubjects(state: SnapshotState): SnapshotSubject[] {
  const subjects: SnapshotSubject[] = [];
  for (const product of state.productsById.values()) {
    subjects.push({ kind: "product", product, variant: null });
    for (const variant of state.variantsByProductId.get(product.id) ?? []) {
      subjects.push({ kind: "variant", product, variant });
    }
  }
  return subjects;
}

function scoreSubject(subject: SnapshotSubject, queryText: string, queryTokens: string[]) {
  const subjectTokens = tokenize(subjectSearchText(subject));
  const overlap = queryTokens.filter((token) => subjectTokens.includes(token)).length;
  const exactName = normalizeText(subject.product.name).includes(normalizeText(queryText)) ? 4 : 0;
  const exactSku = subject.product.sku && normalizeText(subject.product.sku).includes(normalizeText(queryText)) ? 3 : 0;
  const exactVariantSku = subject.variant?.sku && normalizeText(subject.variant.sku).includes(normalizeText(queryText)) ? 3 : 0;
  return overlap * 2 + exactName + exactSku + exactVariantSku;
}

function subjectReasons(subject: SnapshotSubject, queryText: string, queryTokens: string[]) {
  const subjectTokens = tokenize(subjectSearchText(subject));
  const overlaps = queryTokens.filter((token) => subjectTokens.includes(token));
  const reasons = overlaps.length > 0 ? [`Matches: ${overlaps.slice(0, 4).join(", ")}`] : [];
  if (subject.kind === "variant") {
    reasons.push(subject.variant.isDefault ? "Default variant" : "Variant match");
  } else if (subject.product.variantIds.length > 1) {
    reasons.push("Product family");
  }
  if (subject.product.status === "discontinued" || subject.variant?.status === "discontinued") {
    reasons.push("Discontinued");
  }
  if (normalizeText(subject.product.name).includes(normalizeText(queryText))) {
    reasons.push("Name match");
  }
  return [...new Set(reasons)];
}

function resolveSubject(state: SnapshotState, subjectId: string): SnapshotSubject | null {
  const variant = state.variantsById.get(subjectId) ?? null;
  if (variant) {
    const product = state.productsById.get(variant.productId) ?? null;
    return product ? { kind: "variant", product, variant } : null;
  }

  const product = state.productsById.get(subjectId) ?? null;
  if (!product) return null;
  return { kind: "product", product, variant: null };
}

function resolveVariantRecord(state: SnapshotState, subject: SnapshotSubject) {
  if (subject.kind === "variant") return subject.variant;
  if (subject.product.defaultVariantId) {
    return state.variantsById.get(subject.product.defaultVariantId) ?? null;
  }
  return null;
}

function resolveRecordArray<T extends { shop: string }>(
  subject: SnapshotSubject,
  state: SnapshotState,
  selector: (record: SnapshotVariantRecord) => T[]
) {
  const variant = resolveVariantRecord(state, subject);
  return variant ? selector(variant) : [];
}

function buildPriceFromRecord(subject: SnapshotSubject, record: SnapshotPriceRecord, context: CatalogContext): ProductPrice {
  const currency = record.currency ?? context.currency ?? "CLP";
  const listAmount = record.listPrice ?? 0;
  const saleAmount = record.salePrice;
  const listPrice = { amount: listAmount, currency };
  const salePrice = saleAmount === null ? null : { amount: saleAmount, currency };
  const effectivePrice = salePrice ?? listPrice;
  return {
    subjectType: subject.kind,
    subjectId: subject.kind === "variant" ? subject.variant.id : subject.product.id,
    listPrice,
    salePrice,
    effectivePrice,
    currency,
    tax: {
      included: record.taxIncluded,
      rate: record.taxRate,
      code: record.taxCode
    },
    validFrom: record.validFrom,
    validTo: record.validTo,
    source: record.source,
    retrievedAt: record.retrievedAt,
    freshness: freshnessFor(record.retrievedAt, context.effectiveAt),
    provenance: provenance(record, context)
  };
}

function buildAvailability(subject: SnapshotSubject, context: CatalogContext): Availability {
  const variant = resolveVariantRecord(state, subject);
  const record = pickRecord(variant?.availability ?? [], {
    shop: context.shop,
    currency: null,
    locale: null
  });
  if (!record) {
    return {
      status: "unknown",
      quantity: null,
      location: null,
      leadTimeDays: null,
      source: "snapshot",
      retrievedAt: context.effectiveAt,
      freshness: "unknown",
      provenance: unknownValue("availability_unknown", context).provenance
    };
  }
  return {
    status: record.status,
    quantity: record.quantity,
    location: record.location,
    leadTimeDays: record.leadTimeDays,
    source: record.source,
    retrievedAt: record.retrievedAt,
    freshness: freshnessFor(record.retrievedAt, context.effectiveAt),
    provenance: provenance(record, context)
  };
}

function buildDimensions(subject: SnapshotSubject, context: CatalogContext): ProductDimensions | UnknownCatalogValue {
  const variant = resolveVariantRecord(state, subject);
  const record = pickRecord(variant?.dimensions ?? [], {
    shop: context.shop,
    currency: null,
    locale: null
  });
  if (!record) {
    return unknownValue("dimensions_unknown", context);
  }
  const recordProvenance = provenance(record, context);
  return {
    assembled: record.assembled ?? makeUnknownCatalogValue("assembled_dimensions_unknown", recordProvenance),
    packaged: record.packaged ?? makeUnknownCatalogValue("packaged_dimensions_unknown", recordProvenance),
    provenance: recordProvenance
  };
}

function buildUrl(subject: SnapshotSubject, context: CatalogContext): CatalogUrl | UnknownCatalogValue {
  const variant = resolveVariantRecord(state, subject);
  const records = variant?.commercialUrl ?? [];
  const record = pickRecord(records, {
    shop: context.shop,
    currency: null,
    locale: null
  });
  if (!record) {
    return unknownValue("commercial_url_unknown", context);
  }
  return {
    href: record.href,
    label: record.label,
    source: record.source,
    retrievedAt: record.retrievedAt,
    freshness: freshnessFor(record.retrievedAt, context.effectiveAt),
    provenance: provenance(record, context)
  };
}

function pickCompatibilityRule(product: SnapshotProductRecord, input: CompatibilityInput) {
  const rules = product.compatibility ?? [];
  if (input.candidateId) {
    const explicit = rules.find((rule) => rule.candidateId === input.candidateId);
    if (explicit) return explicit;
  }
  const requirementTags = input.requirements?.tags?.map((tag) => normalizeText(tag)) ?? [];
  if (requirementTags.length > 0) {
    return rules.find((rule) => (rule.tags ?? []).some((tag) => requirementTags.includes(normalizeText(tag)))) ?? null;
  }
  return null;
}

function fitDimensions(need: Dimensions | null | undefined, subject: SnapshotSubject) {
  if (!need) return null;
  const variant = subject.kind === "variant" ? subject.variant : null;
  const dimensions = variant?.dimensions.find((record) => record.shop === "cl-main")?.assembled ?? null;
  if (!dimensions) return null;
  if (
    (need.length !== null && need.length !== undefined && dimensions.length > need.length) ||
    (need.width !== null && need.width !== undefined && dimensions.width > need.width) ||
    (need.height !== null && need.height !== undefined && dimensions.height > need.height)
  ) {
    return false;
  }
  return true;
}

function compatibilityResult(subject: SnapshotSubject, input: CompatibilityInput, context: CatalogContext): CompatibilityResult {
  const provenanceBase = subject.kind === "variant" ? subject.variant.provenance : subject.product.provenance;
  const provenanceValue = provenance(provenanceBase, context);
  const rule = pickCompatibilityRule(subject.product, input);
  const subjectTags = new Set([
    ...subject.product.tags.map((tag) => normalizeText(tag)),
    ...(subject.kind === "variant" ? subject.variant.tags.map((tag) => normalizeText(tag)) : [])
  ]);
  const requirementTags = input.requirements?.tags?.map((tag) => normalizeText(tag)) ?? [];
  const overlappingTags = requirementTags.filter((tag) => subjectTags.has(tag));

  if (rule?.kind === "true") {
    return {
      compatible: true,
      reasons: [...new Set([...(rule.reasons ?? []), ...(overlappingTags.length > 0 ? overlappingTags.map((tag) => `Matched tag ${tag}`) : [])])],
      restrictions: [...new Set(rule.restrictions ?? [])],
      evidence: [...new Set(rule.evidence ?? [])],
      provenance: provenanceValue
    };
  }

  if (rule?.kind === "false") {
    return {
      compatible: false,
      reasons: [...new Set(rule.reasons ?? [])],
      restrictions: [...new Set(rule.restrictions ?? [])],
      evidence: [...new Set(rule.evidence ?? [])],
      provenance: provenanceValue
    };
  }

  if (rule?.kind === "unknown") {
    return {
      compatible: "unknown",
      reasons: [...new Set([...(rule.reasons ?? []), "Insufficient evidence to confirm compatibility."])],
      restrictions: [...new Set(rule.restrictions ?? [])],
      evidence: [...new Set(rule.evidence ?? [])],
      provenance: provenanceValue
    };
  }

  const fitted = fitDimensions(input.requirements?.dimensions ?? null, subject);
  if (fitted === true) {
    return {
      compatible: true,
      reasons: overlappingTags.length > 0 ? overlappingTags.map((tag) => `Matched tag ${tag}`) : ["Dimensions fit the requested space."],
      restrictions: [],
      evidence: [subject.product.id, subject.kind === "variant" ? subject.variant.id : subject.product.id],
      provenance: provenanceValue
    };
  }
  if (fitted === false) {
    return {
      compatible: false,
      reasons: ["Dimensions exceed the requested space."],
      restrictions: ["space_constraint"],
      evidence: [subject.product.id, subject.kind === "variant" ? subject.variant.id : subject.product.id],
      provenance: provenanceValue
    };
  }

  if (overlappingTags.length > 0) {
    return {
      compatible: true,
      reasons: overlappingTags.map((tag) => `Matched tag ${tag}`),
      restrictions: [],
      evidence: [subject.product.id, subject.kind === "variant" ? subject.variant.id : subject.product.id],
      provenance: provenanceValue
    };
  }

  return {
    compatible: "unknown",
    reasons: ["Compatibility not explicitly demonstrated by snapshot data."],
    restrictions: [],
    evidence: [subject.product.id, subject.kind === "variant" ? subject.variant.id : subject.product.id],
    provenance: provenanceValue
  };
}

function buildRelatedProducts(subject: SnapshotSubject, context: CatalogContext): ProductRelation[] {
  const provenanceValue = provenance(subject.product.provenance, context);
  return subject.product.relations.map((relation) => ({
    subjectId: subject.product.id,
    relatedId: relation.relatedId,
    relationType: relation.relationType,
    reason: relation.reason,
    provenance: provenanceValue
  }));
}

function resolveSearchPrices(state: SnapshotState, subject: SnapshotSubject, context: CatalogContext) {
  const variant = resolveVariantRecord(state, subject);
  return variant?.price ?? [];
}

function resolveSearchAvailability(state: SnapshotState, subject: SnapshotSubject, context: CatalogContext) {
  const variant = resolveVariantRecord(state, subject);
  return variant?.availability ?? [];
}

function resolveSearchDimensions(state: SnapshotState, subject: SnapshotSubject, context: CatalogContext) {
  const variant = resolveVariantRecord(state, subject);
  return variant?.dimensions ?? [];
}

function resolveSearchUrls(state: SnapshotState, subject: SnapshotSubject, context: CatalogContext) {
  const variant = resolveVariantRecord(state, subject);
  return variant?.commercialUrl ?? [];
}

function buildSearchHit(subject: SnapshotSubject, query: ProductSearchQuery, context: CatalogContext, queryTokens: string[]): ProductSearchHit {
  const product = productEntity(subject.product, context);
  const variant = subject.kind === "variant" ? variantEntity(subject.variant, context) : null;
  const priceRecord = pickRecord(resolveSearchPrices(state, subject, context), {
    shop: context.shop,
    currency: context.currency,
    locale: context.locale
  });
  const availabilityRecord = pickRecord(resolveSearchAvailability(state, subject, context), {
    shop: context.shop,
    currency: null,
    locale: null
  });
  const dimensionsRecord = pickRecord(resolveSearchDimensions(state, subject, context), {
    shop: context.shop,
    currency: null,
    locale: null
  });
  const urlRecord = pickRecord(resolveSearchUrls(state, subject, context), {
    shop: context.shop,
    currency: null,
    locale: null
  });

  return {
    product,
    variant,
    score: scoreSubject(subject, query.text, queryTokens),
    reasons: subjectReasons(subject, query.text, queryTokens),
    price: priceRecord && priceRecord.listPrice !== null ? buildPriceFromRecord(subject, priceRecord, context) : unknownValue("price_unknown", context),
    availability: availabilityRecord
      ? {
          status: availabilityRecord.status,
          quantity: availabilityRecord.quantity,
          location: availabilityRecord.location,
          leadTimeDays: availabilityRecord.leadTimeDays,
          source: availabilityRecord.source,
          retrievedAt: availabilityRecord.retrievedAt,
          freshness: freshnessFor(availabilityRecord.retrievedAt, context.effectiveAt),
          provenance: provenance(availabilityRecord, context)
        }
      : {
          status: "unknown",
          quantity: null,
          location: null,
          leadTimeDays: null,
          source: "snapshot",
          retrievedAt: context.effectiveAt,
          freshness: "unknown",
          provenance: unknownValue("availability_unknown", context).provenance
        },
    dimensions: dimensionsRecord
      ? {
          assembled: dimensionsRecord.assembled ?? makeUnknownCatalogValue("assembled_dimensions_unknown", provenance(dimensionsRecord, context)),
          packaged: dimensionsRecord.packaged ?? makeUnknownCatalogValue("packaged_dimensions_unknown", provenance(dimensionsRecord, context)),
          provenance: provenance(dimensionsRecord, context)
        }
      : unknownValue("dimensions_unknown", context),
    compatibility: compatibilityResult(
      subject,
      {
        subjectId: subject.kind === "variant" ? subject.variant.id : subject.product.id,
        candidateId: query.productId ?? query.variantId ?? null,
        requirements: {
          tags: query.filters?.tags ?? [],
          category: query.filters?.category ?? null,
          dimensions: null,
          useCase: null
        }
      },
      context
    ),
    commercialUrl: urlRecord
      ? {
          href: urlRecord.href,
          label: urlRecord.label,
          source: urlRecord.source,
          retrievedAt: urlRecord.retrievedAt,
          freshness: freshnessFor(urlRecord.retrievedAt, context.effectiveAt),
          provenance: provenance(urlRecord, context)
        }
      : unknownValue("commercial_url_unknown", context),
    provenance: provenance(subject.kind === "variant" ? subject.variant.provenance : subject.product.provenance, context)
  };
}

function filterSubject(subject: SnapshotSubject, context: CatalogContext, query: ProductSearchQuery) {
  if (query.filters?.shop && context.shop !== query.filters.shop) return false;
  if (query.filters?.currency && context.currency !== query.filters.currency) return false;
  if (query.filters?.locale && context.locale !== query.filters.locale) return false;
  const status = subject.kind === "variant" ? subject.variant.status : subject.product.status;
  if (query.filters?.status && !query.filters.status.includes(status)) return false;
  if (query.filters?.category && normalizeText(subject.product.category ?? "") !== normalizeText(query.filters.category)) return false;
  if (query.filters?.tags && query.filters.tags.length > 0) {
    const subjectTags = new Set([
      ...subject.product.tags.map((tag) => normalizeText(tag)),
      ...(subject.kind === "variant" ? subject.variant.tags.map((tag) => normalizeText(tag)) : [])
    ]);
    if (!query.filters.tags.some((tag) => subjectTags.has(normalizeText(tag)))) return false;
  }
  return true;
}

const state = buildState();

export function createSnapshotCatalogService(): CatalogService {
  return {
    async searchProducts(query: ProductSearchQuery, context: CatalogContext): Promise<ProductSearchResult> {
      const queryTokens = tokenize(query.text);
      const items = buildSubjects(state)
        .filter((subject) => filterSubject(subject, context, query))
        .map((subject) => buildSearchHit(subject, query, context, queryTokens))
        .filter((item) => item.score > 0 || query.text.trim().length === 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.product.id.localeCompare(right.product.id) ||
            (left.variant?.id ?? "").localeCompare(right.variant?.id ?? "")
        )
        .slice(0, query.limit ?? 8);

      return {
        query,
        items,
        total: items.length,
        provenance: makeProvenance({
          source: "snapshot",
          retrievedAt: context.effectiveAt,
          freshness: "fresh",
          confidence: "high",
          tenant: context.tenant,
          shop: context.shop,
          locale: context.locale,
          currency: context.currency
        })
      };
    },
    async getProduct(productId: string, context: CatalogContext): Promise<Product | null> {
      const product = state.productsById.get(productId) ?? null;
      return product ? productEntity(product, context) : null;
    },
    async getVariant(variantId: string, context: CatalogContext): Promise<ProductVariant | null> {
      const variant = state.variantsById.get(variantId) ?? null;
      return variant ? variantEntity(variant, context) : null;
    },
    async getPrice(subjectId: string, context: CatalogContext): Promise<ProductPrice | UnknownCatalogValue> {
      const subject = resolveSubject(state, subjectId);
      if (!subject) {
        return unknownValue("price_unknown", context);
      }
      const record = pickRecord(resolveSearchPrices(state, subject, context), {
        shop: context.shop,
        currency: context.currency,
        locale: context.locale
      });
      return record && record.listPrice !== null ? buildPriceFromRecord(subject, record, context) : unknownValue("price_unknown", context);
    },
    async getAvailability(subjectId: string, context: CatalogContext): Promise<Availability> {
      const subject = resolveSubject(state, subjectId);
      if (!subject) {
        return {
          status: "unknown",
          quantity: null,
          location: null,
          leadTimeDays: null,
          source: "snapshot",
          retrievedAt: context.effectiveAt,
          freshness: "unknown",
          provenance: unknownValue("availability_unknown", context).provenance
        };
      }
      const record = pickRecord(resolveSearchAvailability(state, subject, context), {
        shop: context.shop,
        currency: null,
        locale: null
      });
      return record
        ? {
            status: record.status,
            quantity: record.quantity,
            location: record.location,
            leadTimeDays: record.leadTimeDays,
            source: record.source,
            retrievedAt: record.retrievedAt,
            freshness: freshnessFor(record.retrievedAt, context.effectiveAt),
            provenance: provenance(record, context)
          }
        : {
            status: "unknown",
            quantity: null,
            location: null,
            leadTimeDays: null,
            source: "snapshot",
            retrievedAt: context.effectiveAt,
            freshness: "unknown",
            provenance: unknownValue("availability_unknown", context).provenance
          };
    },
    async getDimensions(subjectId: string, context: CatalogContext): Promise<ProductDimensions | UnknownCatalogValue> {
      const subject = resolveSubject(state, subjectId);
      if (!subject) return unknownValue("dimensions_unknown", context);
      const record = pickRecord(resolveSearchDimensions(state, subject, context), {
        shop: context.shop,
        currency: null,
        locale: null
      });
      if (!record) return unknownValue("dimensions_unknown", context);
      const recordProvenance = provenance(record, context);
      return {
        assembled: record.assembled ?? makeUnknownCatalogValue("assembled_dimensions_unknown", recordProvenance),
        packaged: record.packaged ?? makeUnknownCatalogValue("packaged_dimensions_unknown", recordProvenance),
        provenance: recordProvenance
      };
    },
    async getCompatibility(input: CompatibilityInput, context: CatalogContext): Promise<CompatibilityResult> {
      const subject = resolveSubject(state, input.subjectId);
      if (!subject) {
        return {
          compatible: "unknown",
          reasons: ["Subject not found."],
          restrictions: [],
          evidence: [],
          provenance: unknownValue("compatibility_unknown", context).provenance
        };
      }
      return compatibilityResult(subject, input, context);
    },
    async getRelatedProducts(subjectId: string, context: CatalogContext): Promise<ProductRelation[]> {
      const subject = resolveSubject(state, subjectId);
      return subject ? buildRelatedProducts(subject, context) : [];
    },
    async getCommercialUrl(subjectId: string, context: CatalogContext): Promise<CatalogUrl | UnknownCatalogValue> {
      const subject = resolveSubject(state, subjectId);
      if (!subject) return unknownValue("commercial_url_unknown", context);
      const record = pickRecord(resolveSearchUrls(state, subject, context), {
        shop: context.shop,
        currency: null,
        locale: null
      });
      if (!record) return unknownValue("commercial_url_unknown", context);
      return {
        href: record.href,
        label: record.label,
        source: record.source,
        retrievedAt: record.retrievedAt,
        freshness: freshnessFor(record.retrievedAt, context.effectiveAt),
        provenance: provenance(record, context)
      };
    }
  };
}
