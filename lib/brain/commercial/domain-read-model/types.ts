import type { CatalogPort, CatalogProduct } from "@/lib/catalog";
import type { CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import type { QuoteServicePort, QuoteServiceQuote } from "@/lib/domains/quote-service";
import type { RuntimeIdentityContext } from "../native-cycle/customer-session/runtimeIdentityContext";
import type { NativeCustomerSessionExecutionContext } from "../native-cycle/customer-session/types";
import type { CommercialCapabilityExecutionProjection, CommercialWorkBlocker } from "../work/types";
import type { PersistedCommercialWork } from "../work/persistenceTypes";
import type { CommercialWorkStatus } from "../work/statuses";
import { type CommercialFreshness, type CommercialFreshnessState } from "./freshness";

export type { CommercialFreshness, CommercialFreshnessState } from "./freshness";

export type CommercialReadEvidence = {
  readonly kind: string;
  readonly status: CommercialFreshnessState;
  readonly source: string;
  readonly capturedAt: string | null;
  readonly reference: string | null;
  readonly summary: string;
};

export type CommercialReadFailure = {
  readonly ok: false;
  /** Stable, PII-safe code selected by the reader boundary. */
  readonly reason: string;
};

export type CommercialReaderResult<T> = T | null | CommercialReadFailure;

export type CommercialCaseProjection = {
  readonly caseId: string;
  readonly conversationId: number;
  readonly opportunityId: number | null;
  readonly workId: string | null;
  readonly workVersion: number | null;
  readonly status: CommercialWorkStatus | "NOT_CREATED";
  readonly blockers: readonly CommercialWorkBlocker[];
  readonly freshness: CommercialFreshness;
};

export type CommercialObjectiveProjection = {
  readonly objectiveId: string;
  readonly type: string;
  readonly status: string;
  readonly missingRequirements: readonly string[];
  readonly blockers: readonly CommercialWorkBlocker[];
  readonly freshness: CommercialFreshness;
};

export type CommercialCatalogProductProjection = {
  readonly productId: string;
  readonly name: string;
  readonly sku: string | null;
  readonly price: CatalogProduct["price"];
  readonly availability: CatalogProduct["availability"];
  readonly stockQuantity: number | null;
  readonly weightKg: number | null;
  readonly retrievedAt: string | null;
  readonly provenance: CatalogProduct["provenance"] | null;
  readonly freshness: CommercialFreshness;
};

export type CommercialCartItemProjection = {
  readonly productId: string;
  readonly combinationId: string | null;
  readonly quantity: number;
  readonly product: CommercialCatalogProductProjection | null;
  readonly freshness: CommercialFreshness;
};

export type CommercialCartProjection = {
  readonly factId: string | null;
  readonly updatedAt: string | null;
  readonly items: readonly CommercialCartItemProjection[];
  readonly freshness: CommercialFreshness;
};

export type CommercialDestinationProjection = {
  readonly factId: string;
  readonly communeId: number;
  readonly canonicalName: string;
  readonly updatedAt: string;
  readonly freshness: CommercialFreshness;
};

export type CommercialShippingCalculationProjection = {
  readonly executionId: string | null;
  readonly executionStatus: string;
  readonly selectionFactId: string | null;
  readonly destinationFactId: string | null;
  readonly completedAt: string | null;
  readonly freshness: CommercialFreshness;
};

export type CommercialShippingSelectionProjection = {
  readonly factId: string;
  readonly shippingQuoteExecutionId: string;
  readonly selectionFactId: string;
  readonly destinationFactId: string;
  readonly optionIndex: number;
  readonly carrierName: string;
  readonly serviceType: string;
  readonly totalCost: number;
  readonly estimatedDelivery: string;
  readonly calculatedAt: string;
  readonly selectedAt: string;
};

export type CommercialShippingState = "MISSING" | "CURRENT" | "STALE" | "UNKNOWN";

export type CommercialShippingProjection = {
  readonly state: CommercialShippingState;
  readonly selection: CommercialShippingSelectionProjection | null;
  readonly calculation: CommercialShippingCalculationProjection | null;
  readonly freshness: CommercialFreshness;
};

export type CommercialQuoteGrounding = "CURRENT_FOR_KNOWN_ANCHORS" | "STALE" | "UNKNOWN";

export type CommercialQuoteProjection = {
  readonly quoteId: string;
  readonly quoteNumber: string | null;
  readonly status: QuoteServiceQuote["status"] | null;
  readonly currency: string | null;
  readonly total: string | null;
  readonly validUntil: string | null;
  readonly version: number | null;
  readonly selectionFactId: string | null;
  readonly freshness: CommercialFreshness;
  readonly grounding: CommercialQuoteGrounding;
};

export type CommercialCustomerProfileProjection = {
  readonly status: "AVAILABLE" | "NOT_FOUND" | "UNAVAILABLE" | "UNKNOWN";
  readonly retrievedAt: string | null;
  readonly relationshipSummary: {
    readonly conversationCount: number | null;
    readonly opportunityCount: number | null;
    readonly quoteCount: number | null;
    readonly orderCount: number | null;
    readonly lastActivityAt: string | null;
  } | null;
};

export type CommercialCustomerProjection = {
  readonly status: NativeCustomerSessionExecutionContext["identity"]["status"] | "unknown";
  readonly identityLevel: RuntimeIdentityContext["identityLevel"] | null;
  readonly hasResolvedCustomer: boolean;
  readonly verificationRequired: boolean;
  readonly profile: CommercialCustomerProfileProjection | null;
};

export type CommercialConversationProjection = {
  readonly conversationId: number;
  readonly sessionVersion: string | number | null;
};

export type CommercialDomainReadModel = {
  readonly case: CommercialCaseProjection;
  readonly objective: CommercialObjectiveProjection | null;
  readonly cart: CommercialCartProjection;
  readonly destination: CommercialDestinationProjection | null;
  readonly shipping: CommercialShippingProjection;
  readonly quote: CommercialQuoteProjection | null;
  readonly customer: CommercialCustomerProjection;
  readonly conversation: CommercialConversationProjection;
  readonly evidence: readonly CommercialReadEvidence[];
};

export type CommercialWorkRepositoryReader = {
  readonly getByPublicId?: (publicId: string) => Promise<PersistedCommercialWork | null>;
  readonly findActive?: (input: { opportunityId?: number | null; conversationId?: number | null; limit?: number }) => Promise<readonly PersistedCommercialWork[]>;
};

export type CommercialDomainReadModelDependencies = {
  readonly commercialWorkRepository?: CommercialWorkRepositoryReader;
  readonly readCommercialWork?: (input: {
    readonly conversationId: number;
    readonly opportunityId: number | null;
    readonly workPublicId: string | null;
  }) => Promise<CommercialReaderResult<PersistedCommercialWork>>;
  readonly readCart?: (opportunityId: number) => Promise<CommercialReaderResult<CommercialLineItemSelection>>;
  readonly readDestination?: (opportunityId: number) => Promise<CommercialReaderResult<ShippingDestination>>;
  readonly readSelectedShipping?: (opportunityId: number) => Promise<CommercialReaderResult<SelectedShippingOption>>;
  readonly readCreatedQuote?: (opportunityId: number) => Promise<CommercialReaderResult<CreatedQuote>>;
  readonly readShippingCalculations?: (opportunityId: number) => Promise<CommercialReaderResult<readonly CommercialCapabilityExecutionProjection[]>>;
  readonly catalogPort?: CatalogPort | null;
  readonly quoteServicePort?: QuoteServicePort | null;
  readonly customerProfile?: CommercialCustomerProfileProjection | null;
  readonly readCustomerProfile?: (input: {
    readonly trustedCustomerSession: NativeCustomerSessionExecutionContext | null | undefined;
    readonly correlationId: string;
  }) => Promise<CommercialReaderResult<CommercialCustomerProfileProjection>>;
};

export type BuildCommercialDomainReadModelInput = {
  readonly conversationId: number;
  readonly opportunityId?: number | null;
  readonly workPublicId?: string | null;
  /** Test/tooling seam; production callers normally use the repository reader. */
  readonly commercialWork?: PersistedCommercialWork | null;
  readonly sessionVersion?: string | number | null;
  readonly correlationId: string;
  readonly trustedCustomerSession?: NativeCustomerSessionExecutionContext | null;
  /** Kept as a dependency even where source timestamps are authoritative. */
  readonly now?: () => Date;
  readonly dependencies?: CommercialDomainReadModelDependencies;
};
