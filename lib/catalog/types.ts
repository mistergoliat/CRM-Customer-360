export type CatalogSource = "snapshot" | "prestashop" | "bridge";

export type CatalogFreshness = "fresh" | "stale" | "unknown";

export type CatalogConfidence = "high" | "medium" | "low" | "unknown";

export interface Provenance {
  source: CatalogSource | string;
  retrievedAt: string;
  freshness: CatalogFreshness;
  confidence: CatalogConfidence;
  tenant?: string | null;
  shop?: string | null;
  locale?: string | null;
  currency?: string | null;
}

export interface UnknownCatalogValue {
  kind: "unknown";
  reason: string;
  provenance: Provenance;
}

export interface Money {
  amount: number;
  currency: string;
}

export interface Dimensions {
  length: number;
  width: number;
  height: number;
  unit: string;
}

export type CatalogDimensionValue = Dimensions | UnknownCatalogValue;

export interface ProductDimensions {
  assembled: CatalogDimensionValue;
  packaged: CatalogDimensionValue;
  provenance: Provenance;
}

export type AvailabilityStatus =
  | "in_stock"
  | "out_of_stock"
  | "backorder"
  | "preorder"
  | "discontinued"
  | "unknown";

export interface Availability {
  status: AvailabilityStatus;
  quantity: number | null;
  location: string | null;
  leadTimeDays: number | null;
  source: CatalogSource | string;
  retrievedAt: string;
  freshness: CatalogFreshness;
  provenance: Provenance;
}

export interface ProductPrice {
  subjectType: "product" | "variant";
  subjectId: string;
  listPrice: Money | UnknownCatalogValue;
  salePrice: Money | UnknownCatalogValue | null;
  effectivePrice: Money | UnknownCatalogValue;
  currency: string;
  tax: {
    included: boolean;
    rate: number | null;
    code: string | null;
  };
  validFrom: string | null;
  validTo: string | null;
  source: CatalogSource | string;
  retrievedAt: string;
  freshness: CatalogFreshness;
  provenance: Provenance;
}

export interface CatalogUrl {
  href: string;
  label: string;
  source: CatalogSource | string;
  retrievedAt: string;
  freshness: CatalogFreshness;
  provenance: Provenance;
}

export interface ProductRelation {
  subjectId: string;
  relatedId: string;
  relationType:
    | "same_family"
    | "accessory"
    | "bundle"
    | "substitute"
    | "compatible"
    | "upsell"
    | "cross_sell"
    | "replacement";
  reason: string;
  provenance: Provenance;
}

export interface Product {
  id: string;
  familyId: string | null;
  sku: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  brand: string | null;
  category: string | null;
  tags: string[];
  attributes: Record<string, string>;
  status: "active" | "discontinued" | "unknown";
  defaultVariantId: string | null;
  variantIds: string[];
  commercialUrl: CatalogUrl | UnknownCatalogValue;
  provenance: Provenance;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string | null;
  name: string;
  description: string | null;
  optionValues: Record<string, string>;
  status: "active" | "discontinued" | "unknown";
  isDefault: boolean;
  commercialUrl: CatalogUrl | UnknownCatalogValue;
  provenance: Provenance;
}

export interface CompatibilityResult {
  compatible: true | false | "unknown";
  reasons: string[];
  restrictions: string[];
  evidence: string[];
  provenance: Provenance;
}

export interface CatalogCustomerContext {
  id: string | null;
  waId: string | null;
  email: string | null;
  phone: string | null;
}

export interface CatalogContext {
  tenant: string;
  shop: string;
  customer: CatalogCustomerContext | null;
  channel: string;
  locale: string;
  currency: string;
  quantity: number;
  effectiveAt: string;
}

export interface ProductSearchQuery {
  text: string;
  limit?: number;
  productId?: string | null;
  variantId?: string | null;
  filters?: {
    shop?: string | null;
    currency?: string | null;
    locale?: string | null;
    category?: string | null;
    tags?: string[];
    status?: Array<"active" | "discontinued" | "unknown">;
  };
}

export interface CompatibilityInput {
  subjectId: string;
  candidateId?: string | null;
  requirements?: {
    tags?: string[];
    dimensions?: Dimensions | null;
    useCase?: string | null;
    category?: string | null;
  };
}

export interface ProductSearchHit {
  product: Product;
  variant: ProductVariant | null;
  score: number;
  reasons: string[];
  price: ProductPrice | UnknownCatalogValue;
  availability: Availability;
  dimensions: ProductDimensions | UnknownCatalogValue;
  compatibility: CompatibilityResult;
  commercialUrl: CatalogUrl | UnknownCatalogValue;
  provenance: Provenance;
}

export interface ProductSearchResult {
  query: ProductSearchQuery;
  items: ProductSearchHit[];
  total: number;
  provenance: Provenance;
}

export interface CatalogService {
  searchProducts(query: ProductSearchQuery, context: CatalogContext): Promise<ProductSearchResult>;
  getProduct(productId: string, context: CatalogContext): Promise<Product | null>;
  getVariant(variantId: string, context: CatalogContext): Promise<ProductVariant | null>;
  getPrice(subjectId: string, context: CatalogContext): Promise<ProductPrice | UnknownCatalogValue>;
  getAvailability(subjectId: string, context: CatalogContext): Promise<Availability>;
  getDimensions(subjectId: string, context: CatalogContext): Promise<ProductDimensions | UnknownCatalogValue>;
  getCompatibility(input: CompatibilityInput, context: CatalogContext): Promise<CompatibilityResult>;
  getRelatedProducts(subjectId: string, context: CatalogContext): Promise<ProductRelation[]>;
  getCommercialUrl(subjectId: string, context: CatalogContext): Promise<CatalogUrl | UnknownCatalogValue>;
}

