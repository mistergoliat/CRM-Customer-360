import type { CommercialLineItem, CommercialLineItemSelection } from "@/lib/domains/commercial-line-items";
import type { CreatedQuote } from "@/lib/domains/created-quote";
import type { SelectedShippingOption } from "@/lib/domains/selected-shipping-option";
import type { ShippingDestination } from "@/lib/domains/shipping-destination";
import type { PendingCommercialIntentRecord } from "../multi-intent/types";
import type { CommercialIdentityRequirementDecision } from "../identity/commercial-identity-requirement";
import type { RuntimeIdentityContext } from "../native-cycle/customer-session/runtimeIdentityContext";
import type { CommercialObjectiveStatus, CommercialWorkStatus, CommercialWorkStepStatus } from "./statuses";
import type { CommercialObjectiveType } from "./objectiveTypes";
import type { CommercialWorkStepCapability, CommercialWorkStepType } from "./stepTypes";

export type CommercialTrigger =
  | {
      type: "CUSTOMER_MESSAGE";
      conversationId: number;
      opportunityId: number | null;
      sourceMessageId: number | null;
      sourceMessageSequence?: number | null;
      commercialSequence?: number | null;
    }
  | {
      type: "FOLLOW_UP_DUE";
      actionId: number;
      conversationId?: number | null;
      opportunityId?: number | null;
      commercialSequence?: number | null;
    }
  | {
      type: "WORK_RETRY_DUE";
      commercialWorkId: string;
      stepId: string;
      commercialSequence?: number | null;
    }
  | {
      type: "SYSTEM_EVENT";
      eventType: string;
      correlationId: string;
      conversationId?: number | null;
      opportunityId?: number | null;
      commercialSequence?: number | null;
    }
  | {
      type: "HANDOFF";
      conversationId: number;
      opportunityId?: number | null;
      commercialSequence?: number | null;
    };

export type CommercialObjectiveOrigin = "customer_requested" | "system_generated" | "operator_requested" | "projection_seed";

export type CommercialObjectiveSeed =
  | {
      kind?: "objective";
      seedId?: string;
      type: CommercialObjectiveType;
      origin?: CommercialObjectiveOrigin;
      inputs?: CommercialObjectiveInputs;
      /**
       * SALES-AGENT-R2-A08.6, Part 3 (post-audit fix). Set only by
       * reconciliation.ts's objectiveSeedFromPersisted, carrying forward the
       * already-persisted objective's real status - deriveCommercialObjectives.ts
       * needs this to decide CANCELLED vs SUPERSEDED for a cancel request,
       * since every freshly-derived CommercialObjective starts at "PENDING"
       * (baseObjective) regardless of what it is carrying forward; without
       * this, that in-progress "PENDING" would look transitionable to
       * CANCELLED even for an objective the persisted aggregate already has
       * as COMPLETED, producing an invalid transition once compared against
       * the real prior state at persistence time.
       */
      carriedStatus?: CommercialObjectiveStatus;
    }
  | {
      kind: "cancel";
      seedId?: string;
      targetType?: CommercialObjectiveType | "selection" | "destination" | "shipping" | "quote";
      reason?: string;
    };

export type CommercialObjectiveInputs = {
  query?: string;
  productReference?: string;
  quantity?: number;
  items?: CommercialLineItem[];
  productEvidenceAvailable?: boolean;
  /**
   * SALES-AGENT-R2-A11.1, Part 2. Populated only when a real search_products
   * capability execution resolved 2+ ambiguous matches for productReference -
   * grounds buildMissingInfoQuestion's PRODUCT_AMBIGUOUS wording in real
   * catalog names instead of inventing/guessing options.
   *
   * SALES-AGENT-R2-A11.2-C. `price` is additive: present (an amount/currency
   * pair, or explicitly null) only when the T12 candidate carried one -
   * never invented when the field is simply absent from an older/legacy
   * payload shape.
   */
  productCandidates?: { productId: string; combinationId?: string; name: string; price?: { amount: number; currency: string } | null }[];
  destinationText?: string;
  communeId?: number;
  canonicalDestinationName?: string;
  optionIndex?: number;
  /**
   * SALES-AGENT-R2-A11.4. The customer's raw shipping-option reference (e.g.
   * "la segunda" / "Chilexpress" / "la mas barata") - the durable input for
   * SELECT_SHIPPING_OPTION, never mutated. optionIndex above is derived from
   * this fresh on every projection pass (buildCommercialWorkProjection.ts's
   * applyObjectiveState), never trusted across passes on its own - an index
   * is positional and means nothing once shipping is recalculated, the raw
   * text is what the customer actually meant.
   */
  optionReference?: string;
  /**
   * SALES-AGENT-R2-A11.4. Populated only when matchShippingOptionReference
   * found 2+ real candidates for optionReference this pass - grounds
   * buildMissingInfoQuestion's SHIPPING_OPTION_AMBIGUOUS/_RECALCULATED
   * wording in real calculate_shipping options, never invented ones.
   */
  shippingOptionCandidates?: { index: number; carrierName: string; serviceType: string; totalCost: number; estimatedDelivery: string }[];
  /**
   * SALES-AGENT-R2-ID-R2-A11. Customer's own words narrowing which previous
   * purchase they mean (e.g. "los discos" out of "quiero comprar los discos
   * que compré antes") - optional, never invented when the customer only
   * said something generic ("lo mismo de siempre"). Used to filter
   * historicalPurchaseCandidates when purchase history returns more than one
   * product; never sent to Catalog directly (only the resolved
   * productReference below is).
   */
  productHint?: string;
  /**
   * SALES-AGENT-R2-ID-R2-A11. Real previously-purchased products (ID-R2-A10's
   * Customer Profile boundary, never Catalog) when 2+ remain after
   * productHint filtering - grounds the disambiguation question in real
   * purchase history, never invented options. Distinct from
   * productCandidates above (those are CURRENT catalog matches from a
   * search_products execution) - these are HISTORICAL, not yet resolved
   * against the live catalog at all.
   */
  historicalPurchaseCandidates?: { historicalName: string; historicalProductId?: string; quantity?: number; lastPurchasedAt?: string }[];
  /**
   * SALES-AGENT-R2-ID-R2-A12. Customer's own words narrowing what they want
   * THIS turn ("economico", "para entrenar en casa", "discos") - optional,
   * never invented for a bare "que me recomiendas" with nothing to narrow
   * by. Always wins over any historical signal as the search query
   * (buildCommercialWorkProjection.ts) once loaded - never blended.
   */
  queryHint?: string;
  /**
   * SALES-AGENT-R2-ID-R2-A12. Present only when `query` above actually came
   * from the loaded historical signal - absent whenever it came from
   * `queryHint` or no personalization was possible (never a fake "generic"
   * value standing in for absence). Read only by the finalizer's wording,
   * never by any ranking/filtering logic.
   */
  recommendationSignalSource?: "purchase_history";
  /**
   * SALES-AGENT-R2-ID-R2-A12. Coarse RFM segment code
   * (customerRfm.segment.code), captured because it comes along for free
   * with the same loadCommercialCustomerContext call - never raw
   * recency/frequency/monetary numbers. Inert in v1: not read by the search
   * query, the finalizer, or any ranking/filtering - a hook for a future
   * task, not active behavior.
   */
  rfmSegmentLabel?: string;
  /**
   * SALES-AGENT-R2-ID-R2-A12. Real, CURRENT catalog candidates from a
   * search_products/T12 execution - never historical products, never
   * invented. Distinct from productCandidates above (PRODUCT_AMBIGUOUS
   * clarification for a product the customer named directly) and from
   * historicalPurchaseCandidates (2+ past purchases to disambiguate) -
   * these are ranked/suggested candidates the customer did not ask for by
   * name, always presented and waited on even when there is only one
   * (never auto-selected, unlike REPEAT_PURCHASE).
   */
  recommendationCandidates?: { productId: string; combinationId?: string; name: string; price?: { amount: number; currency: string } | null }[];
};

export type CommercialObjectiveResolvedInputs = {
  commercialLineItemsFactId?: string;
  shippingDestinationFactId?: string;
  selectedShippingOptionFactId?: string;
  createdQuoteFactId?: string;
  shippingCalculationExecutionId?: string;
};

export type CommercialMissingRequirement =
  | "PRODUCT"
  | "PRODUCT_EVIDENCE"
  | "PRODUCT_AMBIGUOUS"
  | "PRODUCT_NOT_FOUND"
  | "QUANTITY"
  | "DESTINATION"
  | "SELECTION"
  | "SHIPPING"
  | "SHIPPING_OPTION_AMBIGUOUS"
  | "SHIPPING_OPTION_NOT_FOUND"
  | "SHIPPING_OPTION_RECALCULATED"
  | "QUOTE"
  // SALES-AGENT-R2-ID-R2-A07. One value per non-SUFFICIENT
  // CommercialIdentityRequirementDecision status this codebase actually
  // produces (see commercialIdentityGate.ts) - never collapsed into a single
  // generic value (task PARTE 3/18: "falta email != conflict != system
  // failure != ready to link"). SYSTEM_WAIT has no entry here - it never
  // reaches WAITING_CUSTOMER (see commercialIdentityGate.ts), so it is never
  // a "missing requirement" from the customer's point of view.
  | "IDENTITY_EVIDENCE"
  | "IDENTITY_AMBIGUOUS"
  | "IDENTITY_LINK_PENDING"
  | "IDENTITY_CONFLICT"
  | "IDENTITY_VERIFICATION"
  // SALES-AGENT-R2-ID-R2-A11. 2+ distinct previously-purchased products
  // remain after productHint filtering - a real, distinct customer question
  // ("which of these purchases do you mean"), never collapsed into the
  // catalog-space PRODUCT_AMBIGUOUS above (that one means "2+ CURRENT catalog
  // matches for a name", this one means "2+ HISTORICAL purchases" - resolved
  // one stage earlier, before any catalog search ever runs).
  | "REPEAT_PURCHASE_AMBIGUOUS"
  // SALES-AGENT-R2-ID-R2-A12. Bounded, Catalog-current recommendation
  // candidates are ready and the customer needs to pick one - distinct from
  // both PRODUCT_AMBIGUOUS (a product they DID name) and
  // REPEAT_PURCHASE_AMBIGUOUS (historical, not yet Catalog-validated).
  | "RECOMMENDATION_CANDIDATES"
  // SALES-AGENT-R2-ID-R2-A12. No queryHint this turn and no usable
  // historical signal (no history, Customer Profile unavailable, or profile
  // not found) - a normal, identity-free clarifying question, never a
  // reason to reopen onboarding or invent a query.
  | "RECOMMENDATION_QUERY_HINT";

export type CommercialEvidenceRef = {
  kind: "request_fact" | "capability_execution" | "commercial_event" | "agent_action" | "conversation_state";
  id?: string | number;
  factType?: "commercial_line_items" | "shipping_destination" | "selected_shipping_option" | "created_quote" | "pending_commercial_intents";
  capabilityName?: string;
  status?: string;
  stale?: boolean;
  reason?: string;
};

export type CommercialWorkBlockerCode =
  | "MISSING_PRODUCT"
  | "MISSING_PRODUCT_EVIDENCE"
  | "PRODUCT_AMBIGUOUS"
  | "PRODUCT_NOT_FOUND"
  | "MISSING_QUANTITY"
  | "MISSING_DESTINATION"
  | "MISSING_SELECTION"
  | "MISSING_SHIPPING"
  | "SHIPPING_OPTION_AMBIGUOUS"
  | "SHIPPING_OPTION_NOT_FOUND"
  | "SHIPPING_OPTION_RECALCULATED"
  | "CAPABILITY_UNAVAILABLE"
  | "WAITING_CUSTOMER"
  | "WAITING_SYSTEM"
  | "HUMAN_OWNER_ACTIVE"
  | "AI_DISABLED"
  | "SUPERSEDED"
  | "UNSUPPORTED"
  | "CANCELLED"
  | "STALE_EVIDENCE"
  // SALES-AGENT-R2-ID-R2-A11. See the matching CommercialMissingRequirement
  // comment above - never conflated with the catalog-space "PRODUCT_AMBIGUOUS".
  | "REPEAT_PURCHASE_AMBIGUOUS"
  // SALES-AGENT-R2-ID-R2-A12. See the matching CommercialMissingRequirement
  // comments above - same distinctions apply to blockers.
  | "RECOMMENDATION_CANDIDATES"
  | "RECOMMENDATION_QUERY_HINT"
  // SALES-AGENT-R2-ID-R2-A07. A single code for every non-SUFFICIENT
  // CommercialIdentityRequirementDecision (A06) - the decision's own `status`
  // (carried in `identityDecision` below) already distinguishes falta nivel /
  // ready to link / ambiguity / conflict / system wait / entity verification,
  // so this code never needs a per-status variant of its own (PARTE 3: the
  // structure is preserved via identityDecision, not via a wider code union).
  | "IDENTITY_REQUIREMENT";

export type CommercialWorkBlockerSource = "work" | "objective" | "step" | "conversation";

export type CommercialWorkBlocker = {
  code: CommercialWorkBlockerCode;
  source: CommercialWorkBlockerSource;
  objectiveId?: string;
  stepId?: string;
  evidence?: CommercialEvidenceRef[];
  /**
   * SALES-AGENT-R2-ID-R2-A07. Present only on an "IDENTITY_REQUIREMENT"
   * blocker - the full A06 decision this blocker was derived from, verbatim
   * (never re-summarized, never re-interpreted). No PII: `evaluate.ts`
   * (A06) documents that this decision type only ever carries level/status/
   * entityType/requiredEvidence/policyCode enums, inherited from
   * RuntimeIdentityContext's own privacy guarantee (A05).
   */
  identityDecision?: CommercialIdentityRequirementDecision;
};

export type CommercialWorkDependency =
  | { type: "FACT_CONFIRMED"; factType: "commercial_line_items" | "shipping_destination" | "selected_shipping_option" | "created_quote" }
  | { type: "CAPABILITY_EVIDENCE"; capabilityName: CommercialWorkStepCapability }
  | { type: "CUSTOMER_INPUT"; requirement: CommercialMissingRequirement }
  | { type: "STEP_COMPLETED"; stepId: string }
  | { type: "CONVERSATION_AUTONOMY_ALLOWED" };

export type CommercialObjective = {
  objectiveId: string;
  type: CommercialObjectiveType;
  status: CommercialObjectiveStatus;
  origin: CommercialObjectiveOrigin;
  inputs: CommercialObjectiveInputs;
  resolvedInputs: CommercialObjectiveResolvedInputs;
  missingRequirements: CommercialMissingRequirement[];
  supersedesObjectiveIds: string[];
  evidence: CommercialEvidenceRef[];
  blockers: CommercialWorkBlocker[];
};

export type CommercialWorkStep = {
  stepId: string;
  objectiveIds: string[];
  type: CommercialWorkStepType;
  status: CommercialWorkStepStatus;
  dependencies: CommercialWorkDependency[];
  capabilityName: CommercialWorkStepCapability | null;
  input: CommercialObjectiveInputs;
  evidence: CommercialEvidenceRef[];
  blockers: CommercialWorkBlocker[];
  retryable: boolean;
  retryCandidate: boolean;
  idempotencyKey: string | null;
  attemptCount: number;
  maxAttempts: number | null;
  nextAttemptAt: string | null;
  startedAt: string | null;
  lastAttemptAt: string | null;
  lockOwner: string | null;
  lockUntil: string | null;
};

export type CommercialCapabilityExecutionProjection = {
  id?: number | string;
  publicId: string;
  capabilityName: CommercialWorkStepCapability | "search_company_knowledge" | string;
  executionStatus: "completed" | "missing_information" | "denied" | "requires_approval" | "temporarily_blocked" | "invalid_arguments" | "failed" | "not_executed";
  retryable?: boolean;
  errorCode?: string | null;
  requestSummaryJson?: Record<string, unknown> | null;
  responseSummaryJson?: Record<string, unknown> | null;
  completedAt?: string | null;
};

export type CommercialConversationProjection = {
  id: number;
  humanOwnerActive: boolean;
  aiEnabled: boolean;
  status?: string | null;
};

export type CommercialOpportunityProjection = {
  id: number | null;
  status?: string | null;
};

export type CommercialWorkProjectionInput = {
  trigger: CommercialTrigger;
  conversation: CommercialConversationProjection;
  opportunity?: CommercialOpportunityProjection | null;
  objectiveSeeds?: CommercialObjectiveSeed[];
  pendingCommercialIntents?: PendingCommercialIntentRecord[];
  commercialLineItems?: CommercialLineItemSelection | null;
  shippingDestination?: ShippingDestination | null;
  selectedShippingOption?: SelectedShippingOption | null;
  createdQuote?: CreatedQuote | null;
  recentCapabilityExecutions?: CommercialCapabilityExecutionProjection[];
  recentCommercialEvents?: CommercialEvidenceRef[];
  now?: string | Date;
  /**
   * SALES-AGENT-R2-ID-R2-A07. This turn's identity fact (A05), already
   * privacy-safe by construction. Optional so every existing caller/test
   * that never threads it (benchmark harness, older tests) keeps its exact
   * current behavior unchanged (commercialIdentityGate.ts is a no-op without
   * it) - never defaulted to a synthetic value here.
   */
  runtimeIdentity?: RuntimeIdentityContext;
};

export type CommercialWork = {
  id: string;
  projectionVersion: 1;
  opportunityId: number | null;
  conversationId: number;
  sourceMessageId: number | null;
  sourceSequence: number | null;
  lastReconciledSequence: number | null;
  previousWorkPublicId: string | null;
  supersedesWorkPublicId: string | null;
  trigger: CommercialTrigger;
  status: CommercialWorkStatus;
  objectives: CommercialObjective[];
  steps: CommercialWorkStep[];
  blockers: CommercialWorkBlocker[];
  derivedAt: string;
  metrics: CommercialWorkProjectionMetrics;
};

export type CommercialWorkProjectionMetrics = {
  objectiveCount: number;
  readyStepCount: number;
  waitingCustomerObjectiveCount: number;
  waitingSystemStepCount: number;
  blockerCount: number;
};
