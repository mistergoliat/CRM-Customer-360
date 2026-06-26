import type {
  CatalogContext,
  CatalogService,
  CompatibilityInput,
  Product,
  ProductDimensions,
  ProductPrice,
  ProductSearchQuery,
  ProductVariant,
  UnknownCatalogValue
} from "@/lib/catalog";
import { createPrestashopCatalogService } from "@/lib/catalog";
import { isUnknownCatalogValue, normalizeText, tokenize } from "@/lib/catalog/utils";
import type {
  SalesConsultativeProduct,
  SalesConsultativeProductRepository,
  SalesNeedProfile
} from "./types";

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
}

function defaultCatalogContext(overrides: Partial<CatalogContext> = {}): CatalogContext {
  const effectiveAt = overrides.effectiveAt ?? new Date().toISOString();
  return {
    tenant: overrides.tenant ?? "default",
    shop: overrides.shop ?? "cl-main",
    customer: overrides.customer ?? null,
    channel: overrides.channel ?? "sales_consultative",
    locale: overrides.locale ?? "es-CL",
    currency: overrides.currency ?? "CLP",
    quantity: overrides.quantity ?? 1,
    effectiveAt
  };
}

function isCatalogProduct(entity: Product | ProductVariant | null): entity is Product {
  return Boolean(entity && "variantIds" in entity);
}

function resolveMoneyValue(value: ProductPrice | UnknownCatalogValue | null | undefined) {
  if (!value || isUnknownCatalogValue(value)) return null;
  const price = value.effectivePrice;
  if (isUnknownCatalogValue(price)) return null;
  return price.amount;
}

function resolveDimensionsValue(value: ProductDimensions | UnknownCatalogValue | null | undefined): SalesConsultativeProduct["dimensions"] {
  if (!value || isUnknownCatalogValue(value)) return null;
  const primary = !isUnknownCatalogValue(value.assembled) ? value.assembled : !isUnknownCatalogValue(value.packaged) ? value.packaged : null;
  if (!primary) return null;
  return {
    width: primary.width,
    height: primary.height,
    length: primary.length,
    unit: primary.unit
  };
}

function resolveCompatibilityTokens(product: Product, compatibility: Awaited<ReturnType<CatalogService["getCompatibility"]>>) {
  return uniqueStrings([
    product.category,
    product.brand,
    ...product.tags,
    ...compatibility.reasons,
    ...compatibility.restrictions,
    ...compatibility.evidence
  ]);
}

function mapSearchHitToConsultativeProduct(
  hit: Awaited<ReturnType<CatalogService["searchProducts"]>>["items"][number]
): SalesConsultativeProduct {
  const baseEntity = hit.variant ?? hit.product;
  const effectiveEntity = hit.variant ?? hit.product;
  const product = hit.product;
  const price = resolveMoneyValue(hit.price as ProductPrice | UnknownCatalogValue);
  const dimensions = resolveDimensionsValue(hit.dimensions as ProductDimensions | UnknownCatalogValue);
  const compatibilityTokens = resolveCompatibilityTokens(product, hit.compatibility);
  const imageUrl = isUnknownCatalogValue(hit.commercialUrl) ? null : hit.commercialUrl.href;

  return {
    id: effectiveEntity.id,
    reference: effectiveEntity.sku ?? product.sku ?? null,
    name: hit.variant ? `${product.name} - ${hit.variant.name}` : product.name,
    category: product.category,
    description: hit.variant?.description ?? product.description,
    price,
    currency: !isUnknownCatalogValue(hit.price) ? hit.price.currency : "CLP",
    stockQuantity: hit.availability.status === "unknown" ? null : hit.availability.quantity,
    dimensions,
    features: uniqueStrings([...product.tags, ...(hit.variant ? Object.values(hit.variant.optionValues) : [])]),
    compatibility: compatibilityTokens,
    relatedProductIds: [],
    manufacturer: product.brand,
    imageUrl,
    source: product.provenance.source
  };
}

async function resolveConsultativeEntity(
  service: CatalogService,
  subjectId: string,
  context: CatalogContext
): Promise<{ product: Product | null; entity: Product | ProductVariant | null }> {
  const variant = await service.getVariant(subjectId, context);
  if (variant) {
    const product = await service.getProduct(variant.productId, context);
    return { product, entity: variant };
  }
  const product = await service.getProduct(subjectId, context);
  return { product, entity: product };
}

function mapEntityToConsultativeProduct(
  product: Product,
  entity: Product | ProductVariant,
  price: ProductPrice | UnknownCatalogValue,
  availability: Awaited<ReturnType<CatalogService["getAvailability"]>>,
  dimensions: ProductDimensions | UnknownCatalogValue,
  relatedIds: string[],
  compatibilityTokens: string[]
): SalesConsultativeProduct {
  const imageUrl = isUnknownCatalogValue(product.commercialUrl) ? null : product.commercialUrl.href;
  const effectiveName = entity.id === product.id ? product.name : `${product.name} - ${entity.name}`;
  const reference = entity.id === product.id ? product.sku : entity.sku ?? product.sku;
  const variantOptions = "optionValues" in entity ? Object.values(entity.optionValues) : [];

  return {
    id: entity.id,
    reference,
    name: effectiveName,
    category: product.category,
    description: entity.description ?? product.description,
    price: resolveMoneyValue(price),
    currency: !isUnknownCatalogValue(price) ? price.currency : "CLP",
    stockQuantity: availability.status === "unknown" ? null : availability.quantity,
    dimensions: resolveDimensionsValue(dimensions),
    features: uniqueStrings([...product.tags, ...variantOptions, ...(entity.id === product.id ? [] : [entity.name])]),
    compatibility: compatibilityTokens,
    relatedProductIds: relatedIds,
    manufacturer: product.brand,
    imageUrl,
    source: product.provenance.source
  };
}

export function createCatalogBackedSalesConsultativeProductRepository(
  service: CatalogService,
  contextOverrides: Partial<CatalogContext> = {}
): SalesConsultativeProductRepository {
  return {
    async searchProducts(input) {
      const context = defaultCatalogContext(contextOverrides);
      const query: ProductSearchQuery = {
        text: input.query,
        limit: input.limit ?? 8,
        filters: {
          tags: uniqueStrings([
            ...input.profile.requiredFeatures,
            ...input.profile.preferredFeatures,
            input.profile.useCase
          ]),
          status: ["active", "discontinued", "unknown"]
        }
      };
      const result = await service.searchProducts(query, context);
      return result.items.map((item) => mapSearchHitToConsultativeProduct(item));
    },
    async getProductDetails(productId: string) {
      const context = defaultCatalogContext(contextOverrides);
      const resolved = await resolveConsultativeEntity(service, productId, context);
      if (!resolved.product || !resolved.entity) return null;
      const price = await service.getPrice(resolved.entity.id, context);
      const availability = await service.getAvailability(resolved.entity.id, context);
      const dimensions = await service.getDimensions(resolved.entity.id, context);
      const compatibility = await service.getCompatibility({ subjectId: resolved.entity.id }, context);
      const related = await service.getRelatedProducts(resolved.product.id, context);
      return mapEntityToConsultativeProduct(
        resolved.product,
        resolved.entity,
        price,
        availability,
        dimensions,
        related.map((relation) => relation.relatedId),
        resolveCompatibilityTokens(resolved.product, compatibility)
      );
    },
    async getProductPrice(productId: string) {
      const context = defaultCatalogContext(contextOverrides);
      const resolved = await resolveConsultativeEntity(service, productId, context);
      const price = resolved.entity ? await service.getPrice(resolved.entity.id, context) : await service.getPrice(productId, context);
      return resolveMoneyValue(price);
    },
    async getProductStock(productId: string) {
      const context = defaultCatalogContext(contextOverrides);
      const resolved = await resolveConsultativeEntity(service, productId, context);
      const availability = resolved.entity ? await service.getAvailability(resolved.entity.id, context) : await service.getAvailability(productId, context);
      return availability.status === "unknown" ? null : availability.quantity;
    },
    async getProductDimensions(productId: string) {
      const context = defaultCatalogContext(contextOverrides);
      const resolved = await resolveConsultativeEntity(service, productId, context);
      const dimensions = resolved.entity ? await service.getDimensions(resolved.entity.id, context) : await service.getDimensions(productId, context);
      return resolveDimensionsValue(dimensions);
    },
    async getProductCompatibility(productId: string) {
      const context = defaultCatalogContext(contextOverrides);
      const resolved = await resolveConsultativeEntity(service, productId, context);
      if (!resolved.product || !resolved.entity) return [];
      const compatibility = await service.getCompatibility({ subjectId: resolved.entity.id }, context);
      return uniqueStrings([
        ...resolved.product.tags,
        resolved.product.category,
        resolved.product.brand,
        resolved.entity.id === resolved.product.id ? null : resolved.entity.name,
        ...compatibility.reasons
      ]);
    },
    async getRelatedProducts(productId: string) {
      const context = defaultCatalogContext(contextOverrides);
      const resolved = await resolveConsultativeEntity(service, productId, context);
      if (!resolved.product) return [];
      const related = await service.getRelatedProducts(resolved.product.id, context);
      const products: SalesConsultativeProduct[] = [];
      for (const relation of related) {
        const relatedResolved = await resolveConsultativeEntity(service, relation.relatedId, context);
        if (!relatedResolved.product || !relatedResolved.entity) continue;
        const price = await service.getPrice(relatedResolved.entity.id, context);
        const availability = await service.getAvailability(relatedResolved.entity.id, context);
        const dimensions = await service.getDimensions(relatedResolved.entity.id, context);
        const compatibility = await service.getCompatibility({ subjectId: relatedResolved.entity.id }, context);
        const details = mapEntityToConsultativeProduct(
          relatedResolved.product,
          relatedResolved.entity,
          price,
          availability,
          dimensions,
          [],
          resolveCompatibilityTokens(relatedResolved.product, compatibility)
        );
        if (details) products.push(details);
      }
      return products;
    }
  };
}

function createMemoryProductMap(products: SalesConsultativeProduct[]) {
  return new Map<string, SalesConsultativeProduct>(products.map((product) => [product.id, product]));
}

function scoreMemoryProduct(product: SalesConsultativeProduct, queryTokens: string[]) {
  const productTokens = tokenize([product.name, product.reference ?? "", product.category ?? "", product.description ?? "", product.manufacturer ?? "", ...product.features, ...product.compatibility].join(" "));
  return queryTokens.filter((token) => productTokens.includes(token)).length;
}

export function createMemorySalesConsultativeProductRepository(products: SalesConsultativeProduct[]): SalesConsultativeProductRepository {
  const catalog = createMemoryProductMap(products);

  return {
    async searchProducts(input) {
      const queryTokens = tokenize(input.query);
      return [...catalog.values()]
        .map((product) => ({
          product,
          score: scoreMemoryProduct(product, queryTokens)
        }))
        .sort((left, right) => right.score - left.score)
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
        .map((candidate) => ({
          candidate,
          overlap: targetTokens.filter((token) => tokenize([candidate.name, candidate.category ?? "", ...candidate.features, ...candidate.compatibility].join(" ")).includes(token)).length
        }))
        .filter((item) => item.overlap > 0)
        .sort((left, right) => right.overlap - left.overlap)
        .slice(0, 4)
        .map((item) => item.candidate);
    }
  };
}

export function createPrestashopProductRepository() {
  return createCatalogBackedSalesConsultativeProductRepository(createPrestashopCatalogService());
}
