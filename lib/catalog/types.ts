/**
 * Catalog port (ADR-005): the commercial domain depends on this contract only
 * - never on HTTP endpoints, API keys, or PrestaShop SQL directly. Field
 * shapes are trimmed to what the real MS-pesaschile-catalog-service returns;
 * fields it does not provide (dimensions, compatibility) are intentionally
 * absent rather than invented.
 */

export const CATALOG_AVAILABILITY_STATUSES = [
  "in_stock",
  "out_of_stock",
  "unknown"
] as const;
export type CatalogAvailabilityStatus = (typeof CATALOG_AVAILABILITY_STATUSES)[number];

export type CatalogProvenance = {
  source: "catalog_service_http";
  retrievedAt: string;
  /** True when the upstream service served this from its own cache, not a fresh read. */
  cached: boolean;
};

export type CatalogAttribute = {
  group: string;
  value: string;
};

export type CatalogProductVariant = {
  variantId: string;
  sku: string | null;
  label: string | null;
  attributes: CatalogAttribute[];
  /** Price delta vs. the base product; null when unknown. Never zero-filled. */
  priceImpact: number | null;
  stockQuantity: number | null;
  availability: CatalogAvailabilityStatus;
  isDefault: boolean;
};

export type CatalogProductPrice = {
  /** Unknown price stays null - never presented as zero or invented (ADR-005). */
  amount: number | null;
  currency: string | null;
  taxIncluded: boolean | null;
  /**
   * SALES-AGENT-R1-T1.1. The exact rate the Catalog Service already applied
   * to derive `amount` (V1 `pricing.taxRate`, additive field, sourced from
   * that service's single configured-rate pricing pipeline - never a second,
   * independently-read value). Null only when the upstream field is missing
   * or malformed - CRM never defaults this to a hardcoded rate (e.g. 0.19)
   * and never infers it from currency/country.
   */
  taxRate: number | null;
  discountApplied: boolean;
};

export type ProductPublicLink = {
  canonicalUrl: string | null;
  scope: "exact_product" | "parent_product";
  available: boolean;
  unavailableReason?: "missing_link_rewrite" | "invalid_product_id" | "invalid_base_url";
  requiresVariantSelection: boolean;
  variantAttributeLabels: string[];
};

export type CatalogProduct = {
  productId: string;
  name: string;
  sku: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  active: boolean;
  selectedVariant: CatalogProductVariant | null;
  variants: CatalogProductVariant[];
  price: CatalogProductPrice | null;
  availability: CatalogAvailabilityStatus;
  stockQuantity: number | null;
  /**
   * CRM-R1-T13E: base product weight + combination delta, rounded to 3
   * decimals by the upstream service. 0 is a real, preserved value (never
   * coerced to null); null means the service could not resolve a weight for
   * the selected variant (same "no resoluble" case as price/stock, not a
   * missing-field default). Never negative - the upstream service fails the
   * whole request closed (503) before a negative value could reach here.
   */
  weightKg: number | null;
  publicLink?: ProductPublicLink;
  provenance: CatalogProvenance;
};

export type CatalogSearchResultItem = {
  productId: string;
  combinationId: string;
  sku: string | null;
  name: string;
  variantLabel: string | null;
  shortDescription: string | null;
  stockQuantity: number | null;
  availability: CatalogAvailabilityStatus;
  matchType: "exact_sku" | "exact_name" | "partial_name" | "description";
};

export type CatalogSearchResult = {
  query: string;
  items: CatalogSearchResultItem[];
  provenance: CatalogProvenance;
};

/** Mirrors the real service's POST /v1/products/batch item input (max 20 items per call). */
export type CatalogBatchItemInput = {
  productId: string;
  combinationId?: string;
  quantity?: number;
};

export type CatalogBatchItemResult =
  | { ok: true; input: CatalogBatchItemInput; product: CatalogProduct }
  | { ok: false; input: CatalogBatchItemInput; error: CatalogPortError };

export type CatalogBatchResult = {
  items: CatalogBatchItemResult[];
  provenance: CatalogProvenance;
};

export const CATALOG_EXPLORE_AVAILABILITY_FILTERS = ["available", "unavailable", "all"] as const;
export type CatalogExploreAvailabilityFilter = (typeof CATALOG_EXPLORE_AVAILABILITY_FILTERS)[number];

export const CATALOG_EXPLORE_SORT_FIELDS = ["price", "stock", "name"] as const;
export type CatalogExploreSortField = (typeof CATALOG_EXPLORE_SORT_FIELDS)[number];

export const CATALOG_EXPLORE_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type CatalogExploreSortDirection = (typeof CATALOG_EXPLORE_SORT_DIRECTIONS)[number];

export type CatalogExploreSort = {
  by: CatalogExploreSortField;
  direction: CatalogExploreSortDirection;
};

export type CatalogExplorePriceRange = {
  min?: number;
  max?: number;
};

export const CATALOG_EXPLORE_STOCK_SCOPES = ["product", "product_aggregate"] as const;
export type CatalogExploreStockScope = (typeof CATALOG_EXPLORE_STOCK_SCOPES)[number];

export const CATALOG_EXPLORE_CLASSIFICATION_SOURCES = ["category", "attribute", "rule", "text_fallback"] as const;
export type CatalogExploreClassificationSource = (typeof CATALOG_EXPLORE_CLASSIFICATION_SOURCES)[number];

/**
 * Explore endpoint input (POST /v1/products/explore, ACS-R1-05.1-T02.6).
 * Its filter/sort vocabulary and `availability` semantics are an independent
 * upstream sub-contract from searchProducts/getProductDetails - deliberately
 * not unified with CatalogAvailabilityStatus (different concept: catalog
 * scope filter, not per-item stock status). Confirmed against
 * mistergoliat/MS-pesaschile-catalog-service main@147794b / feature@efc2f7e.
 */
export type CatalogExploreInput = {
  query?: string;
  categoryId?: string;
  categorySlug?: string;
  productType?: string;
  price?: CatalogExplorePriceRange;
  availability?: CatalogExploreAvailabilityFilter;
  sort: CatalogExploreSort;
  limit: number;
};

export type CatalogExploreScope = {
  query?: string;
  categoryId?: string;
  categorySlug?: string;
  productType?: string;
  availability: CatalogExploreAvailabilityFilter;
};

export type CatalogExploreItem = {
  productId: string;
  name: string;
  /** Unknown price stays null - never presented as zero or invented (ADR-005). */
  price: number | null;
  currency: string;
  stockQuantity: number | null;
  stockScope: CatalogExploreStockScope;
  /**
   * Upstream leaves this an open string - its own vocabulary (e.g.
   * "inactive") is distinct from CatalogAvailabilityStatus. Preserved
   * verbatim, never coerced into a closed enum (ADR-005: unknown se conserva).
   */
  availability: string;
};

export type CatalogExploreResult = {
  scope: CatalogExploreScope;
  sort: CatalogExploreSort;
  totalMatched: number;
  /** Whether `items` covers every match for `scope`, or only a top slice - governs whether the agent may use absolute ranking language. */
  exhaustiveForScope: boolean;
  classificationSource?: CatalogExploreClassificationSource;
  items: CatalogExploreItem[];
  provenance: CatalogProvenance;
};

/**
 * SALES-AGENT-R2-A11.2-C. POST /api/v2/catalog/resolve-product-intent ("T12
 * Product Intent Resolution") - a natural-language product query resolved
 * into resolved | clarification_required | no_match, with synonym expansion,
 * unit normalization and explicit-constraint ranking the legacy
 * /v1/products/search endpoint does not have (see
 * docs/audits/SALES-AGENT-R2-A11.2-catalog-service-integration-audit.md).
 * Field shapes mirror MS-pesaschile-catalog-service's own zod contract
 * (src/application/catalog/product-intent/contracts.ts) exactly - only
 * fields CRM actually reads are kept, unread fields (availability,
 * pricing.discount*, imageUrl, etc.) are intentionally absent rather than
 * carried as dead weight.
 */
export const PRODUCT_INTENT_RESOLUTION_STATUSES = ["resolved", "clarification_required", "no_match"] as const;
export type ProductIntentResolutionStatus = (typeof PRODUCT_INTENT_RESOLUTION_STATUSES)[number];

export type ProductIntentReference = {
  productId: string;
  combinationId?: string;
};

/** Unlike CatalogProductPrice, T12 never returns a price object with a null amount - the whole field is absent instead (contracts.ts's productIntentPriceSchema has no nullable amount). */
export type ProductIntentPrice = {
  amount: number;
  currency: string;
};

export const PRODUCT_INTENT_STOCK_STATUSES = ["in_stock", "out_of_stock", "available_for_order", "unknown"] as const;
export type ProductIntentStockStatus = (typeof PRODUCT_INTENT_STOCK_STATUSES)[number];

export type ProductIntentStock = {
  status: ProductIntentStockStatus;
  quantity?: number;
  available: boolean;
};

export const PRODUCT_INTENT_CLARIFICATION_DIMENSIONS = [
  "product_type",
  "weight",
  "diameter",
  "length",
  "category",
  "brand",
  "variant",
  "unspecified"
] as const;
export type ProductIntentClarificationDimension = (typeof PRODUCT_INTENT_CLARIFICATION_DIMENSIONS)[number];

export type ProductIntentClarificationOption = {
  value: string;
  label: string;
  productIds: string[];
};

export type ProductIntentClarification = {
  dimension: ProductIntentClarificationDimension;
  options: ProductIntentClarificationOption[];
};

export type ProductIntentCandidateProduct = {
  productId: string;
  combinationId?: string;
  name: string;
  reference?: string;
  description?: string;
  price: ProductIntentPrice | null;
  stock: ProductIntentStock;
  publicLink?: ProductPublicLink;
};

/**
 * Match reasons are kept as an open string[] rather than duplicating the
 * Catalog Service's closed 13-value enum here - CRM only ever displays/logs
 * these (evidence/audit, Part 15 of the A11.2-C task), it never branches on
 * a specific reason value, so mirroring the enum would be dead precision.
 */
export type ProductIntentCandidate = {
  product: ProductIntentCandidateProduct;
  rank: number;
  score: number;
  reasons: string[];
};

export type ProductIntentWarning = {
  code: string;
  details?: Record<string, unknown>;
};

export type ProductIntentResolutionResult = {
  query: { original: string; normalized: string };
  resolution: {
    status: ProductIntentResolutionStatus;
    confidence: number;
    sourceProduct?: ProductIntentReference;
  };
  candidates: ProductIntentCandidate[];
  clarification?: ProductIntentClarification;
  statistics: { retrieved: number; eligible: number; returned: number };
  warnings: ProductIntentWarning[];
  provenance: CatalogProvenance;
};

/**
 * CATALOG-INTELLIGENCE-A00.5.1. GET /v1/products/:productId/semantics reads
 * MS-pesaschile-catalog-service's published product semantic snapshot
 * (offline classifier + ontology, never re-run per request). NEEDS_REVIEW is
 * listed for forward-compatibility even though the upstream snapshot has not
 * emitted it yet (confirmed against A00.5's documented classificationCounts).
 */
export const PRODUCT_SEMANTIC_CLASSIFICATION_STATUSES = [
  "CLASSIFIED",
  "PARTIALLY_CLASSIFIED",
  "OTHER",
  "EXCLUDED_NON_PRODUCT",
  "NEEDS_REVIEW"
] as const;
export type ProductSemanticClassificationStatus = (typeof PRODUCT_SEMANTIC_CLASSIFICATION_STATUSES)[number];

export type CatalogProductSemanticsExclusion = {
  ruleId: string;
  reason: string;
};

/**
 * Read-only projection of the upstream fact. Tags are trimmed to their
 * durable ontology code - axis/confidence/ruleId are upstream audit detail
 * this console does not currently render, intentionally absent rather than
 * carried as dead weight (same convention as CatalogExploreItem, etc.).
 */
export type CatalogProductSemantics = {
  productId: string;
  classificationStatus: ProductSemanticClassificationStatus;
  primaryProductFamily: string | null;
  secondaryProductFamilies: string[];
  disciplines: string[];
  useContexts: string[];
  ontologyVersion: string;
  classifierVersion: string;
  snapshotId: string;
  exclusion: CatalogProductSemanticsExclusion | null;
  provenance: CatalogProvenance;
};

/**
 * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4. Real upstream contract confirmed
 * against mistergoliat/MS-pesaschile-catalog-service (POST
 * /v1/products/semantic-discovery/query, GET /v1/products/semantics/registry,
 * GET /v1/products/training-semantics/registry -
 * src/application/catalog/semantic-discovery/contracts.ts). `relations` (an
 * upstream-optional DIRECT/SUPPORTED/FAMILY_DERIVED refinement for the
 * training axes) remains outside the request model because CRM does not
 * currently require relation filtering. Response evidence is retained where
 * the service publishes it so later Agent observation projection can compact
 * it without losing lineage or match diagnostics at this boundary.
 */
export const CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION = 1 as const;
export const CATALOG_PRODUCT_SEMANTICS_SCHEMA_VERSION = "1" as const;
export const CATALOG_PRODUCT_SEMANTICS_ONTOLOGY_VERSION = "commercial-product-ontology-v3" as const;
export const CATALOG_TRAINING_SEMANTICS_SCHEMA_VERSION = "2" as const;
export const CATALOG_TRAINING_SEMANTICS_REGISTRY_VERSION = "training-semantic-registry-v2" as const;

export const CATALOG_SEMANTIC_DISCOVERY_PRODUCT_AXES = ["PRODUCT_FAMILY", "DISCIPLINE", "USE_CONTEXT"] as const;
export const CATALOG_SEMANTIC_DISCOVERY_TRAINING_AXES = [
  "EXERCISE_CAPABILITY",
  "TRAINING_FUNCTION",
  "BODY_REGION",
  "MUSCLE_GROUP",
  "TRAINING_PATTERN"
] as const;
export const CATALOG_SEMANTIC_DISCOVERY_AXES = [...CATALOG_SEMANTIC_DISCOVERY_PRODUCT_AXES, ...CATALOG_SEMANTIC_DISCOVERY_TRAINING_AXES] as const;
export type CatalogSemanticDiscoveryProductAxis = (typeof CATALOG_SEMANTIC_DISCOVERY_PRODUCT_AXES)[number];
export type CatalogSemanticDiscoveryTrainingAxis = (typeof CATALOG_SEMANTIC_DISCOVERY_TRAINING_AXES)[number];
export type CatalogSemanticDiscoveryAxis = (typeof CATALOG_SEMANTIC_DISCOVERY_AXES)[number];

export const CATALOG_SEMANTIC_DISCOVERY_MODES = ["required", "preferred"] as const;
export type CatalogSemanticDiscoveryMode = (typeof CATALOG_SEMANTIC_DISCOVERY_MODES)[number];

export const CATALOG_SEMANTIC_DISCOVERY_MATCHES = ["any", "all"] as const;
export type CatalogSemanticDiscoveryMatch = (typeof CATALOG_SEMANTIC_DISCOVERY_MATCHES)[number];

export type CatalogSemanticDiscoveryExpectedSnapshots = {
  productSemanticSnapshotId?: string;
  trainingSemanticSnapshotId?: string;
};

export type CatalogSemanticDiscoveryRequirement = {
  axis: CatalogSemanticDiscoveryAxis;
  codes: string[];
  mode: CatalogSemanticDiscoveryMode;
  match: CatalogSemanticDiscoveryMatch;
};

export type CatalogSemanticDiscoveryInput = {
  requirements: CatalogSemanticDiscoveryRequirement[];
  limit?: number;
  schemaVersion?: typeof CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION;
  expectedSnapshots?: CatalogSemanticDiscoveryExpectedSnapshots;
};

export type CatalogSemanticDiscoverySource = "PRODUCT_SEMANTICS" | "TRAINING_SEMANTICS";

export type CatalogSemanticDiscoveryMatchedRequirement = {
  axis: CatalogSemanticDiscoveryAxis;
  requestedCodes: string[];
  matchedCodes: string[];
  source: CatalogSemanticDiscoverySource;
  mode: CatalogSemanticDiscoveryMode;
  match: CatalogSemanticDiscoveryMatch;
  relationTypes?: string[];
  confidenceLevels?: string[];
  reason?: string;
};

export type CatalogSemanticDiscoveryEvidence = {
  kind: string;
  sourceId?: string;
  matchedText?: string;
  ruleId?: string;
  note?: string;
};

export type CatalogSemanticDiscoverySemanticAssignment = {
  code: string;
  relationType: string;
  evidence?: CatalogSemanticDiscoveryEvidence[];
};

export type CatalogSemanticDiscoveryExerciseCapabilityAssignment = CatalogSemanticDiscoverySemanticAssignment & {
  classificationConfidence: string;
};

export type CatalogSemanticDiscoveryProductTag = {
  code: string;
  confidence: string;
};

/** Stable product fact projection; response-level lineage remains separate. */
export type CatalogSemanticDiscoveryProductFact = {
  productId: string;
  classificationStatus: string;
  primaryProductFamily: CatalogSemanticDiscoveryProductTag | null;
  secondaryProductFamilies: CatalogSemanticDiscoveryProductTag[];
  disciplines: CatalogSemanticDiscoveryProductTag[];
  useContexts: CatalogSemanticDiscoveryProductTag[];
  ontologyVersion: string;
  ontologyHash: string;
  classifierVersion: string;
};

/** Stable training fact projection including the service's evidence-bearing assignments and derived codes. */
export type CatalogSemanticDiscoveryTrainingFact = {
  productId: string;
  resolutionState: string;
  coverageStatus: string;
  exerciseCapabilities: CatalogSemanticDiscoveryExerciseCapabilityAssignment[];
  trainingFunctions: CatalogSemanticDiscoverySemanticAssignment[];
  bodyRegions: string[];
  primaryMuscleGroups: string[];
  secondaryMuscleGroups: string[];
  trainingPatterns: string[];
};

export type CatalogSemanticDiscoveryResultItem = {
  productId: string;
  matchedRequirements: CatalogSemanticDiscoveryMatchedRequirement[];
  productSemantics: CatalogSemanticDiscoveryProductFact | null;
  trainingSemantics: CatalogSemanticDiscoveryTrainingFact | null;
};

export type CatalogSemanticDiscoveryLineage = {
  productSemantics: {
    snapshotId: string;
    semanticChecksum: string;
    ontologyVersion: string;
    ontologyHash: string;
    classifierVersion: string;
  } | null;
  trainingSemantics: {
    snapshotId: string;
    semanticChecksum: string;
    registryVersion: string;
    registryHash: string;
    classifierVersion: string;
    rulesHash: string;
  } | null;
};

export type CatalogSemanticDiscoveryResult = {
  schemaVersion: typeof CATALOG_SEMANTIC_DISCOVERY_SCHEMA_VERSION;
  query: {
    requirements: CatalogSemanticDiscoveryRequirement[];
    options: { limit: number };
  };
  results: CatalogSemanticDiscoveryResultItem[];
  totalMatches: number;
  truncated: boolean;
  lineage: CatalogSemanticDiscoveryLineage;
  provenance: CatalogProvenance;
};

export type CatalogSemanticRegistryStatus = string;

/** Intentional registry value projection; status is retained for compatibility/governance. */
export type CatalogSemanticRegistryValue = {
  code: string;
  labelEs: string;
  definition: string;
  status: CatalogSemanticRegistryStatus;
  residual: boolean;
};

export type CatalogProductSemanticsRegistry = {
  schemaVersion: string;
  ontologyVersion: string;
  ontologyHash: string;
  status: CatalogSemanticRegistryStatus;
  axes: { axis: CatalogSemanticDiscoveryProductAxis; values: CatalogSemanticRegistryValue[] }[];
};

export type CatalogTrainingSemanticExerciseCapability = {
  code: string;
  canonicalName: string;
  description: string;
  status: CatalogSemanticRegistryStatus;
  derivedBodyRegions: string[];
  primaryMuscleGroups: string[];
  secondaryMuscleGroups: string[];
  trainingPatterns: string[];
};

export type CatalogTrainingSemanticFunction = {
  code: string;
  canonicalName: string;
  description: string;
  status: CatalogSemanticRegistryStatus;
  allowedRelationTypes: string[];
  allowedEvidenceKinds: string[];
};

export type CatalogTrainingSemanticExerciseDerivedRelation = {
  capabilityCode: string;
  bodyRegions: string[];
  primaryMuscleGroups: string[];
  secondaryMuscleGroups: string[];
  trainingPatterns: string[];
};

export type CatalogTrainingSemanticFamilyTrainingFunctionDerivation = {
  productFamily: string;
  trainingFunctionCode: string;
  relationType: string;
  evidenceKind: string;
  status: CatalogSemanticRegistryStatus;
  rationale: string;
};

export type CatalogTrainingSemanticBoundaries = {
  exerciseCapability: string;
  trainingFunction: string;
  deadlift: {
    dedicatedMachine: string;
    deadliftJack: string;
    barbell: string;
    familyDerived: boolean;
  };
  squat: {
    forbiddenGenericCode: string;
    explicitCapabilities: string[];
    genericEquipmentPolicy: string;
  };
};

export type CatalogTrainingSemanticsRegistry = {
  schemaVersion: string;
  registryVersion: string;
  registryHash: string;
  status: CatalogSemanticRegistryStatus;
  exerciseCapabilities: CatalogTrainingSemanticExerciseCapability[];
  trainingFunctions: CatalogTrainingSemanticFunction[];
  bodyRegions: string[];
  muscleGroups: string[];
  trainingPatterns: string[];
  exerciseDerivedRelations: CatalogTrainingSemanticExerciseDerivedRelation[];
  familyTrainingFunctionDerivations: CatalogTrainingSemanticFamilyTrainingFunctionDerivation[];
  semanticBoundaries: CatalogTrainingSemanticBoundaries;
};

export const CATALOG_PORT_ERROR_CODES = [
  "invalid_input",
  "unauthorized",
  "rate_limited",
  "not_found",
  "unavailable",
  "timeout",
  "invalid_response",
  "not_configured",
  "unknown_error"
] as const;
export type CatalogPortErrorCode = (typeof CATALOG_PORT_ERROR_CODES)[number];

export type CatalogPortError = {
  code: CatalogPortErrorCode;
  message: string;
  retryable: boolean;
  providerErrorCode?: string | null;
  correlationId?: string | null;
};

export type CatalogPortResult<T> = { ok: true; value: T } | { ok: false; error: CatalogPortError };

export type CatalogRequestContext = {
  correlationId: string;
};

export type CatalogPort = {
  searchProducts(
    input: { query: string; limit?: number; includeOutOfStock?: boolean },
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogSearchResult>>;
  getProductDetails(
    input: { productId: string; combinationId?: string },
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogProduct | null>>;
  /**
   * ACS-R1-05-T06.2: hydrates up to 20 candidates in one call (real service
   * contract: POST /v1/products/batch). Internal enrichment step for the
   * search -> batch -> ranking pipeline - never exposed as a separate
   * LLM-facing tool (the Sales Agent only ever requests `searchProducts`).
   */
  batchGetProducts(
    input: { items: CatalogBatchItemInput[] },
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogBatchResult>>;
  /**
   * ACS-R1-05.1-T02.6: extremes, top-N, rankings and filtered/sorted browse
   * (real service contract: POST /v1/products/explore). Independent
   * request/response vocabulary from searchProducts/getProductDetails - see
   * CatalogExploreInput/CatalogExploreResult.
   */
  exploreCatalog(
    input: CatalogExploreInput,
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogExploreResult>>;
  /**
   * SALES-AGENT-R2-A11.2-C. Real service contract: POST
   * /api/v2/catalog/resolve-product-intent (T12). A distinct method from
   * searchProducts, never a shape change to it - searchProducts keeps
   * calling the legacy /v1/products/search endpoint unchanged for its own
   * existing callers (e.g. the admin catalog console), while the Capability
   * Gateway's search_products capability is the one caller that switches to
   * this method (see capability-gateway/registry.ts).
   */
  resolveProductIntent(
    input: { query: string; limit?: number; inStockOnly?: boolean },
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<ProductIntentResolutionResult>>;
  /**
   * CATALOG-INTELLIGENCE-A00.5.1: read-only inspection of a product's
   * published semantic facts (real service contract: GET
   * /v1/products/:productId/semantics). Optional - this is an
   * inspection-only capability layered on the existing boundary, so callers
   * that only need commercial data (search, details, batch, explore, product
   * intent) are unaffected and existing CatalogPort test doubles do not need
   * to implement it. `value: null` means the product is outside the
   * classified universe (real service 404) - distinct from an error, and
   * mirroring getProductDetails' null-for-not-found convention.
   */
  getProductSemantics?(
    input: { productId: string },
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogProductSemantics | null>>;
  /**
   * SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4: real service contract (POST
   * /v1/products/semantic-discovery/query). Optional, same discipline as
   * getProductSemantics - existing CatalogPort test doubles that only need
   * commercial data are unaffected. Optional snapshot pins are forwarded only
   * when explicitly supplied by the caller; the adapter never invents them.
   */
  querySemanticDiscovery?(
    input: CatalogSemanticDiscoveryInput,
    context: CatalogRequestContext
  ): Promise<CatalogPortResult<CatalogSemanticDiscoveryResult>>;
  /** SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4: real service contract (GET /v1/products/semantics/registry). */
  getProductSemanticsRegistry?(context: CatalogRequestContext): Promise<CatalogPortResult<CatalogProductSemanticsRegistry>>;
  /** SALES-AGENT-R3-SEMANTIC-DISCOVERY-TR-B4: real service contract (GET /v1/products/training-semantics/registry). */
  getTrainingSemanticsRegistry?(context: CatalogRequestContext): Promise<CatalogPortResult<CatalogTrainingSemanticsRegistry>>;
};

export const CATALOG_ADAPTER_CONTRACT_VERSION = "catalog-service.v1" as const;
