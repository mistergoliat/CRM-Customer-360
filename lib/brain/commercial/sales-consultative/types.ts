export type SalesNeedProfile = {
  useCase: string | null;
  customerType: string | null;
  goals: string[];
  requiredFeatures: string[];
  preferredFeatures: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  availableSpace: {
    width: number | null;
    height: number | null;
    length: number | null;
    unit: string | null;
  } | null;
  location: {
    country: string | null;
    region: string | null;
    city: string | null;
    address: string | null;
  } | null;
  deliveryDeadline: string | null;
  experienceLevel: string | null;
  purchaseUrgency: string | null;
  decisionReadiness: string | null;
  missingInformation: string[];
  lastUpdatedAt: string;
};

export type SalesConsultativeStage =
  | "discovery"
  | "qualification"
  | "recommendation"
  | "objection_handling"
  | "purchase_intent"
  | "checkout_support"
  | "follow_up"
  | "won"
  | "lost"
  | "handoff";

export type SalesConsultativeObjectionType =
  | "price"
  | "shipping_cost"
  | "lack_of_space"
  | "out_of_stock"
  | "delivery_time"
  | "product_quality"
  | "comparison_with_competitor"
  | "needs_approval"
  | "not_ready"
  | "trust"
  | "unknown";

export type SalesConsultativeActionType =
  | "ask_qualification_question"
  | "recommend_product"
  | "recommend_alternative"
  | "offer_bundle"
  | "provide_price"
  | "check_shipping"
  | "provide_checkout_link"
  | "prepare_quote"
  | "schedule_follow_up"
  | "wait_for_customer"
  | "handoff_to_human"
  | "close_won"
  | "close_lost";

export type SalesConsultativeProduct = {
  id: string;
  reference: string | null;
  name: string;
  category: string | null;
  description: string | null;
  price: number | null;
  currency: string;
  stockQuantity: number | null;
  dimensions: {
    width: number | null;
    height: number | null;
    length: number | null;
    unit: string | null;
  } | null;
  features: string[];
  compatibility: string[];
  relatedProductIds: string[];
  manufacturer: string | null;
  imageUrl: string | null;
  source: string;
};

export type SalesConsultativeCandidate = {
  product: SalesConsultativeProduct;
  score: number;
  scoreBreakdown: {
    needFit: number;
    budget: number;
    space: number;
    features: number;
    stock: number;
    compatibility: number;
  };
  reasons: string[];
  tradeOffs: string[];
  isValid: boolean;
};

export type SalesConsultativeRecommendation = {
  main: SalesConsultativeCandidate | null;
  alternative: SalesConsultativeCandidate | null;
  complements: SalesConsultativeProduct[];
  candidates: SalesConsultativeCandidate[];
  summary: string;
  missingInformation: string[];
};

export type SalesConsultativeObjection = {
  type: SalesConsultativeObjectionType;
  description: string;
  status: "open" | "acknowledged" | "addressed" | "resolved" | "reopened" | "closed";
  confidence: "high" | "medium" | "low";
  detectedAt: string;
  source: "customer_message" | "conversation_history" | "brain_context" | "product_tool" | "operator_input" | "unknown";
  resolvedAt: string | null;
};

export type SalesConsultativeOpportunity = {
  id: string | number | null;
  opportunityKey: string;
  status: string;
  stage: SalesConsultativeStage | string | null;
  primaryIntent: string;
  currentSummary: string | null;
  nextActionType: SalesConsultativeActionType | string | null;
  nextActionDueAt: string | null;
  waitingFor: string | null;
  humanOwnerActive: boolean;
  aiBlocked: boolean;
  customerCandidateId: string | number | null;
  customerMasterId: string | number | null;
  leadId: string | number | null;
  conversationCaseId: string | number | null;
  waId: string | null;
  requirements: unknown[];
  missingRequirements: unknown[];
  productInterests: unknown[];
  objections: SalesConsultativeObjection[];
  signals: string[];
  version: number;
  lastActivityAt: string;
  closedAt: string | null;
};

export type SalesConsultativeCustomerContext = {
  waId: string | null;
  phoneNumberId: string | null;
  email: string | null;
  phone: string | null;
  idCustomer: string | number | null;
  idOrder: string | number | null;
  invoiceNumber: string | number | null;
  contactId: string | number | null;
};

export type SalesConsultativeInteraction = {
  id: string | number | null;
  direction: "inbound" | "outbound" | "manual" | "system" | "internal" | "unknown";
  text: string | null;
  occurredAt: string | null;
  source: string | null;
};

export type SalesConsultativeNextAction = {
  type: SalesConsultativeActionType;
  channel: "whatsapp" | "internal";
  reason: string;
  confidence: "high" | "medium" | "low";
  dueAt: string | null;
  draftMessage: string | null;
  blockedReasons: string[];
  requiresHuman: boolean;
};

export type SalesConsultativeInput = {
  currentTime: string | Date;
  messageText: string;
  customerContext: SalesConsultativeCustomerContext;
  opportunity: SalesConsultativeOpportunity | null;
  existingProfile: SalesNeedProfile | null;
  recentInteractions: SalesConsultativeInteraction[];
  productRepository: SalesConsultativeProductRepository;
  operationsRepository: SalesConsultativeOperationsRepository;
  currentStageHint?: SalesConsultativeStage | null;
  metadata?: Record<string, unknown> | null;
};

export type SalesConsultativeResult = {
  handled: boolean;
  stage: SalesConsultativeStage;
  nextBestAction: SalesConsultativeActionType;
  opportunityStatus: string;
  opportunityStage: SalesConsultativeStage | null;
  profile: SalesNeedProfile;
  recommendation: SalesConsultativeRecommendation;
  objections: SalesConsultativeObjection[];
  responseText: string;
  followUp: {
    scheduled: boolean;
    cancelled: boolean;
    dueAt: string | null;
    reason: string;
  };
  persistence: {
    profileSaved: boolean;
    opportunitySaved: boolean;
    productInterestSaved: boolean;
    objectionSaved: boolean;
    actionSaved: boolean;
    outboundQueued: boolean;
    outboxId: string | number | null;
    auditWritten: boolean;
    followUpCancelled: boolean;
    quotePrepared: boolean;
    humanHandoffRequested: boolean;
  };
  action: SalesConsultativeNextAction | null;
  warnings: string[];
};

export type SalesConsultativeProfileInput = {
  currentTime: string | Date;
  messageText: string;
  existingProfile: SalesNeedProfile | null;
  customerContext: SalesConsultativeCustomerContext;
  opportunity: SalesConsultativeOpportunity | null;
};

export type SalesConsultativeProductRepository = {
  searchProducts(input: {
    query: string;
    limit?: number;
    profile: SalesNeedProfile;
  }): Promise<SalesConsultativeProduct[]>;
  getProductDetails(productId: string): Promise<SalesConsultativeProduct | null>;
  getProductPrice(productId: string): Promise<number | null>;
  getProductStock(productId: string): Promise<number | null>;
  getProductDimensions(productId: string): Promise<SalesConsultativeProduct["dimensions"]>;
  getProductCompatibility(productId: string): Promise<string[]>;
  getRelatedProducts(productId: string): Promise<SalesConsultativeProduct[]>;
};

export type SalesConsultativeOperationsRepository = {
  saveSalesNeedProfile(input: {
    opportunity: SalesConsultativeOpportunity | null;
    profile: SalesNeedProfile;
    currentTime: string;
    messageText: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ ok: boolean; profileId: number | null; warning?: string | null }>;
  createOrUpdateOpportunity(input: {
    opportunity: SalesConsultativeOpportunity | null;
    profile: SalesNeedProfile;
    stage: SalesConsultativeStage;
    status: string;
    summary: string;
    nextActionType: SalesConsultativeActionType;
    nextActionDueAt: string | null;
    currentTime: string;
    customerContext: SalesConsultativeCustomerContext;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ ok: boolean; opportunityId: number | null; opportunityKey: string; warning?: string | null }>;
  recordProductInterest(input: {
    opportunity: SalesConsultativeOpportunity | null;
    profile: SalesNeedProfile;
    recommendation: SalesConsultativeRecommendation;
    currentTime: string;
  }): Promise<{ ok: boolean; warning?: string | null }>;
  recordObjection(input: {
    opportunity: SalesConsultativeOpportunity | null;
    objection: SalesConsultativeObjection;
    currentTime: string;
  }): Promise<{ ok: boolean; warning?: string | null }>;
  createFollowUpAction(input: {
    opportunity: SalesConsultativeOpportunity | null;
    actionType: SalesConsultativeActionType;
    dueAt: string | null;
    messageText: string;
    currentTime: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ ok: boolean; actionId: number | null; warning?: string | null }>;
  cancelFollowUpAction(input: {
    opportunity: SalesConsultativeOpportunity | null;
    reason: string;
    currentTime: string;
  }): Promise<{ ok: boolean; warning?: string | null }>;
  prepareQuote(input: {
    opportunity: SalesConsultativeOpportunity | null;
    recommendation: SalesConsultativeRecommendation;
    currentTime: string;
  }): Promise<{ ok: boolean; quoteId: string | null; warning?: string | null }>;
  queueCustomerMessage(input: {
    opportunity: SalesConsultativeOpportunity | null;
    messageText: string;
    currentTime: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ ok: boolean; queued: boolean; outboxId: string | number | null; warning?: string | null }>;
  requestHumanHandoff(input: {
    opportunity: SalesConsultativeOpportunity | null;
    reason: string;
    currentTime: string;
  }): Promise<{ ok: boolean; warning?: string | null }>;
  writeAudit(input: {
    action: string;
    entityType: string;
    entityId: string | number | null;
    after?: unknown;
    before?: unknown;
  }): Promise<void>;
};
