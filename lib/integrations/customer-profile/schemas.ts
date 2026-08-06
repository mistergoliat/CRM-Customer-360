import {
  CUSTOMER_PROFILE_CONTRACT_VERSION,
  CUSTOMER_PROFILE_IDENTITY_SOURCE,
  CUSTOMER_PROFILE_IDENTITY_STATUS,
  type CustomerCommercialSummaryResponse,
  type CustomerDataProvenance,
  type CustomerOrderStatusDeliveryEstimate,
  type CustomerOrderStatusResponse,
  type CustomerProfileReadinessResponse,
  type CustomerProfileResponse,
  type CustomerPurchasedProductsResponse,
  type CustomerPurchaseBehaviorResponse
} from "./types";

type ParseSuccess<T> = { ok: true; value: T };
type ParseFailure = { ok: false; reason: "INVALID_RESPONSE" | "CONTRACT_VERSION_UNSUPPORTED" | "PROVENANCE_MISMATCH" };

const DECIMAL_STRING_PATTERN = /^\d+(\.\d+)?$/;
const ORDER_REFERENCE_PATTERN = /^[A-Za-z0-9]{1,32}$/;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: RecordValue, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function asNullableString(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const text = asString(value);
  return text === null ? { ok: false } : { ok: true, value: text };
}

function asNullableIsoDateString(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  const text = asIsoDateString(value);
  return text === null ? { ok: false } : { ok: true, value: text };
}

function asDecimalString(value: unknown): string | null {
  return typeof value === "string" && DECIMAL_STRING_PATTERN.test(value) ? value : null;
}

function asIsoDateString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp).toISOString() === value ? value : null;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const entry of value) {
    const text = asString(entry);
    if (text === null) return null;
    result.push(text);
  }
  return result;
}

function parseDataProvenance(value: unknown, requestedCustomerId: number): ParseSuccess<CustomerDataProvenance> | ParseFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, ["customerIdentity", "dataSources", "generatedAt", "contractVersion"])) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  if (!isRecord(value.customerIdentity) || !hasOnlyKeys(value.customerIdentity, ["customerId", "source", "externalCustomerId", "status"])) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }

  const customerId = asPositiveInteger(value.customerIdentity.customerId);
  const source = value.customerIdentity.source;
  const externalCustomerId = asNonEmptyString(value.customerIdentity.externalCustomerId);
  const status = value.customerIdentity.status;
  const generatedAt = asIsoDateString(value.generatedAt);
  const contractVersion = value.contractVersion;

  if (
    customerId === null ||
    source !== CUSTOMER_PROFILE_IDENTITY_SOURCE ||
    externalCustomerId === null ||
    status !== CUSTOMER_PROFILE_IDENTITY_STATUS ||
    generatedAt === null
  ) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  if (contractVersion !== CUSTOMER_PROFILE_CONTRACT_VERSION) {
    return { ok: false, reason: "CONTRACT_VERSION_UNSUPPORTED" };
  }
  if (customerId !== requestedCustomerId) {
    return { ok: false, reason: "PROVENANCE_MISMATCH" };
  }
  if (!Array.isArray(value.dataSources)) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }

  const dataSources: Array<CustomerDataProvenance["dataSources"][number]> = [];
  for (const entry of value.dataSources) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["source", "entity", "purpose"])) {
      return { ok: false, reason: "INVALID_RESPONSE" };
    }
    const entrySource = entry.source;
    const entity = entry.entity;
    const purpose = asNonEmptyString(entry.purpose);
    if (
      entrySource !== CUSTOMER_PROFILE_IDENTITY_SOURCE ||
      purpose === null ||
      (entity !== "ps_customer" && entity !== "ps_orders" && entity !== "ps_order_detail" && entity !== "ps_order_cart_rule" && entity !== "derived_purchase_behavior")
    ) {
      return { ok: false, reason: "INVALID_RESPONSE" };
    }
    dataSources.push({ source: CUSTOMER_PROFILE_IDENTITY_SOURCE, entity, purpose });
  }

  return {
    ok: true,
    value: {
      customerIdentity: { customerId, source: CUSTOMER_PROFILE_IDENTITY_SOURCE, externalCustomerId, status: CUSTOMER_PROFILE_IDENTITY_STATUS },
      dataSources,
      generatedAt,
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION
    }
  };
}

function parseRecentOrderState(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["stateId", "name", "resolution"])) return null;
  const stateId = asPositiveInteger(value.stateId);
  const name = asNullableString(value.name);
  const resolution = value.resolution;
  if (stateId === null || !name.ok || (resolution !== "resolved" && resolution !== "unknown")) return null;
  return { stateId, name: name.value, resolution: resolution as "resolved" | "unknown" };
}

function parseRecentOrder(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["orderId", "reference", "currentStateId", "currentState", "valid", "createdAt", "updatedAt", "totalPaidTaxIncl", "totalProductsTaxIncl", "currencyId"])
  ) {
    return null;
  }
  const orderId = asPositiveInteger(value.orderId);
  const reference = asNonEmptyString(value.reference);
  const currentStateId = asPositiveInteger(value.currentStateId);
  const currentState = parseRecentOrderState(value.currentState);
  const valid = asBoolean(value.valid);
  const createdAt = asNonEmptyString(value.createdAt);
  const updatedAt = asNonEmptyString(value.updatedAt);
  const totalPaidTaxIncl = asDecimalString(value.totalPaidTaxIncl);
  const totalProductsTaxIncl = asDecimalString(value.totalProductsTaxIncl);
  const currencyId = asPositiveInteger(value.currencyId);
  if (
    orderId === null ||
    reference === null ||
    currentStateId === null ||
    currentState === null ||
    valid === null ||
    createdAt === null ||
    updatedAt === null ||
    totalPaidTaxIncl === null ||
    totalProductsTaxIncl === null ||
    currencyId === null
  ) {
    return null;
  }
  return { orderId, reference, currentStateId, currentState, valid, createdAt, updatedAt, totalPaidTaxIncl, totalProductsTaxIncl, currencyId };
}

function parsePurchasedProduct(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "productId",
      "productAttributeId",
      "productName",
      "productReference",
      "totalQuantityPurchased",
      "orderCount",
      "firstPurchasedAt",
      "lastPurchasedAt",
      "totalSpentTaxIncl",
      "catalogStatus"
    ])
  ) {
    return null;
  }
  const productId = asPositiveInteger(value.productId);
  const productAttributeId = asNonNegativeInteger(value.productAttributeId);
  const productName = asNonEmptyString(value.productName);
  const productReference = asNullableString(value.productReference);
  const totalQuantityPurchased = asNonNegativeInteger(value.totalQuantityPurchased);
  const orderCount = asNonNegativeInteger(value.orderCount);
  const firstPurchasedAt = asIsoDateString(value.firstPurchasedAt);
  const lastPurchasedAt = asIsoDateString(value.lastPurchasedAt);
  const totalSpentTaxIncl = asDecimalString(value.totalSpentTaxIncl);
  const catalogStatus = value.catalogStatus;
  if (
    productId === null ||
    productAttributeId === null ||
    productName === null ||
    !productReference.ok ||
    totalQuantityPurchased === null ||
    orderCount === null ||
    firstPurchasedAt === null ||
    lastPurchasedAt === null ||
    totalSpentTaxIncl === null ||
    (catalogStatus !== "linked" && catalogStatus !== "deleted_or_unavailable")
  ) {
    return null;
  }
  return {
    productId,
    productAttributeId,
    productName,
    productReference: productReference.value,
    totalQuantityPurchased,
    orderCount,
    firstPurchasedAt,
    lastPurchasedAt,
    totalSpentTaxIncl,
    catalogStatus: catalogStatus as "linked" | "deleted_or_unavailable"
  };
}

function parseConcentration(value: unknown) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["top1Share", "top3Share", "hhi", "effectiveDiversity"])) return null;
  const top1Share = asDecimalString(value.top1Share);
  const top3Share = asDecimalString(value.top3Share);
  const hhi = asDecimalString(value.hhi);
  const effectiveDiversity = asDecimalString(value.effectiveDiversity);
  if (top1Share === null || top3Share === null || hhi === null || effectiveDiversity === null) return null;
  return { top1Share, top3Share, hhi, effectiveDiversity };
}

function parseBehaviorProduct(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "productId",
      "latestObservedProductName",
      "latestObservedProductReference",
      "variantCountPurchased",
      "repeatedVariantCount",
      "orderCount",
      "totalQuantityPurchased",
      "totalSpentTaxIncl",
      "spendShare",
      "orderShare",
      "quantityShare",
      "firstPurchasedAt",
      "lastPurchasedAt",
      "daysSinceLastPurchase",
      "isRepeated"
    ])
  ) {
    return null;
  }
  const productId = asPositiveInteger(value.productId);
  const latestObservedProductName = asNonEmptyString(value.latestObservedProductName);
  const latestObservedProductReference = asNullableString(value.latestObservedProductReference);
  const variantCountPurchased = asNonNegativeInteger(value.variantCountPurchased);
  const repeatedVariantCount = asNonNegativeInteger(value.repeatedVariantCount);
  const orderCount = asNonNegativeInteger(value.orderCount);
  const totalQuantityPurchased = asNonNegativeInteger(value.totalQuantityPurchased);
  const totalSpentTaxIncl = asDecimalString(value.totalSpentTaxIncl);
  const spendShare = asDecimalString(value.spendShare);
  const orderShare = asDecimalString(value.orderShare);
  const quantityShare = asDecimalString(value.quantityShare);
  const firstPurchasedAt = asIsoDateString(value.firstPurchasedAt);
  const lastPurchasedAt = asIsoDateString(value.lastPurchasedAt);
  const daysSinceLastPurchase = asNonNegativeInteger(value.daysSinceLastPurchase);
  const isRepeated = asBoolean(value.isRepeated);
  if (
    productId === null ||
    latestObservedProductName === null ||
    !latestObservedProductReference.ok ||
    variantCountPurchased === null ||
    repeatedVariantCount === null ||
    orderCount === null ||
    totalQuantityPurchased === null ||
    totalSpentTaxIncl === null ||
    spendShare === null ||
    orderShare === null ||
    quantityShare === null ||
    firstPurchasedAt === null ||
    lastPurchasedAt === null ||
    daysSinceLastPurchase === null ||
    isRepeated === null
  ) {
    return null;
  }
  return {
    productId,
    latestObservedProductName,
    latestObservedProductReference: latestObservedProductReference.value,
    variantCountPurchased,
    repeatedVariantCount,
    orderCount,
    totalQuantityPurchased,
    totalSpentTaxIncl,
    spendShare,
    orderShare,
    quantityShare,
    firstPurchasedAt,
    lastPurchasedAt,
    daysSinceLastPurchase,
    isRepeated
  };
}

function parseBehaviorVariant(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "productId",
      "productAttributeId",
      "productName",
      "productReference",
      "orderCount",
      "totalQuantityPurchased",
      "totalSpentTaxIncl",
      "spendShare",
      "orderShare",
      "quantityShare",
      "firstPurchasedAt",
      "lastPurchasedAt",
      "daysSinceLastPurchase",
      "isRepeated"
    ])
  ) {
    return null;
  }
  const productId = asPositiveInteger(value.productId);
  const productAttributeId = asNonNegativeInteger(value.productAttributeId);
  const productName = asNonEmptyString(value.productName);
  const productReference = asNullableString(value.productReference);
  const orderCount = asNonNegativeInteger(value.orderCount);
  const totalQuantityPurchased = asNonNegativeInteger(value.totalQuantityPurchased);
  const totalSpentTaxIncl = asDecimalString(value.totalSpentTaxIncl);
  const spendShare = asDecimalString(value.spendShare);
  const orderShare = asDecimalString(value.orderShare);
  const quantityShare = asDecimalString(value.quantityShare);
  const firstPurchasedAt = asIsoDateString(value.firstPurchasedAt);
  const lastPurchasedAt = asIsoDateString(value.lastPurchasedAt);
  const daysSinceLastPurchase = asNonNegativeInteger(value.daysSinceLastPurchase);
  const isRepeated = asBoolean(value.isRepeated);
  if (
    productId === null ||
    productAttributeId === null ||
    productName === null ||
    !productReference.ok ||
    orderCount === null ||
    totalQuantityPurchased === null ||
    totalSpentTaxIncl === null ||
    spendShare === null ||
    orderShare === null ||
    quantityShare === null ||
    firstPurchasedAt === null ||
    lastPurchasedAt === null ||
    daysSinceLastPurchase === null ||
    isRepeated === null
  ) {
    return null;
  }
  return {
    productId,
    productAttributeId,
    productName,
    productReference: productReference.value,
    orderCount,
    totalQuantityPurchased,
    totalSpentTaxIncl,
    spendShare,
    orderShare,
    quantityShare,
    firstPurchasedAt,
    lastPurchasedAt,
    daysSinceLastPurchase,
    isRepeated
  };
}

function parseDeliveryEstimate(value: unknown): CustomerOrderStatusDeliveryEstimate | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "minimumBusinessDays", "maximumBusinessDays", "startsFrom"])) return null;
  const status = value.status;
  if (status === "applicable") {
    const minimumBusinessDays = asNonNegativeInteger(value.minimumBusinessDays);
    const maximumBusinessDays = asNonNegativeInteger(value.maximumBusinessDays);
    if (minimumBusinessDays === null || maximumBusinessDays === null || value.startsFrom !== "dispatch") return null;
    return { status: "applicable", minimumBusinessDays, maximumBusinessDays, startsFrom: "dispatch" };
  }
  if (status === "not_applicable" || status === "unknown") {
    if (value.minimumBusinessDays !== null || value.maximumBusinessDays !== null || value.startsFrom !== null) return null;
    return { status, minimumBusinessDays: null, maximumBusinessDays: null, startsFrom: null };
  }
  return null;
}

export function validateCustomerId(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function validatePurchasedProductsLimit(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 100;
}

export function validatePurchasedProductsOffset(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validatePurchaseBehaviorTopProducts(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 10;
}

export function validatePurchaseBehaviorTopVariants(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 10;
}

export function validateOrderReference(value: unknown): boolean {
  return typeof value === "string" && ORDER_REFERENCE_PATTERN.test(value);
}

export function parseCustomerProfileResponse(value: unknown, requestedCustomerId: number): ParseSuccess<CustomerProfileResponse> | ParseFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "customerId", "profile", "provenance", "warnings"])) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  if (value.status !== "available") return { ok: false, reason: "INVALID_RESPONSE" };
  const customerId = asPositiveInteger(value.customerId);
  if (customerId === null) return { ok: false, reason: "INVALID_RESPONSE" };
  if (customerId !== requestedCustomerId) return { ok: false, reason: "PROVENANCE_MISMATCH" };
  if (!isRecord(value.profile) || !hasOnlyKeys(value.profile, ["customerId", "generatedAt", "customer", "prestashop", "recentOrders", "warnings"])) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const profileCustomerId = asPositiveInteger(value.profile.customerId);
  const generatedAt = asIsoDateString(value.profile.generatedAt);
  if (profileCustomerId === null || generatedAt === null || profileCustomerId !== requestedCustomerId) {
    return { ok: false, reason: "PROVENANCE_MISMATCH" };
  }
  if (!isRecord(value.profile.customer) || !hasOnlyKeys(value.profile.customer, ["firstname", "lastname", "email", "rut", "platformOrigin"])) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const firstname = asNonEmptyString(value.profile.customer.firstname);
  const lastname = asNonEmptyString(value.profile.customer.lastname);
  const email = asNonEmptyString(value.profile.customer.email);
  const rut = asNullableString(value.profile.customer.rut);
  const platformOrigin = asNonEmptyString(value.profile.customer.platformOrigin);
  if (firstname === null || lastname === null || email === null || !rut.ok || platformOrigin === null) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  if (!isRecord(value.profile.prestashop) || !hasOnlyKeys(value.profile.prestashop, ["customerId", "active", "shopId", "createdAt", "updatedAt"])) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const prestashopCustomerId = asPositiveInteger(value.profile.prestashop.customerId);
  const active = asBoolean(value.profile.prestashop.active);
  const shopId = asPositiveInteger(value.profile.prestashop.shopId);
  const createdAt = asNullableString(value.profile.prestashop.createdAt);
  const updatedAt = asNullableString(value.profile.prestashop.updatedAt);
  if (prestashopCustomerId === null || active === null || shopId === null || !createdAt.ok || !updatedAt.ok || prestashopCustomerId !== requestedCustomerId) {
    return { ok: false, reason: "PROVENANCE_MISMATCH" };
  }
  if (!Array.isArray(value.profile.recentOrders)) return { ok: false, reason: "INVALID_RESPONSE" };
  const recentOrders: Array<CustomerProfileResponse["profile"]["recentOrders"][number]> = [];
  for (const entry of value.profile.recentOrders) {
    const parsed = parseRecentOrder(entry);
    if (parsed === null) return { ok: false, reason: "INVALID_RESPONSE" };
    recentOrders.push(parsed);
  }
  const profileWarnings = parseStringArray(value.profile.warnings);
  const warnings = parseStringArray(value.warnings);
  if (profileWarnings === null || warnings === null) return { ok: false, reason: "INVALID_RESPONSE" };
  const provenance = parseDataProvenance(value.provenance, requestedCustomerId);
  if (!provenance.ok) return provenance;
  return {
    ok: true,
    value: {
      status: "available",
      customerId,
      profile: {
        customerId: profileCustomerId,
        generatedAt,
        customer: { firstname, lastname, email, rut: rut.value, platformOrigin },
        prestashop: { customerId: prestashopCustomerId, active, shopId, createdAt: createdAt.value, updatedAt: updatedAt.value },
        recentOrders,
        warnings: profileWarnings
      },
      provenance: provenance.value,
      warnings
    }
  };
}

export function parseCustomerCommercialSummaryResponse(value: unknown, requestedCustomerId: number): ParseSuccess<CustomerCommercialSummaryResponse> | ParseFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "customerId", "summary", "provenance"])) return { ok: false, reason: "INVALID_RESPONSE" };
  if (value.status !== "available") return { ok: false, reason: "INVALID_RESPONSE" };
  const customerId = asPositiveInteger(value.customerId);
  if (customerId === null) return { ok: false, reason: "INVALID_RESPONSE" };
  if (customerId !== requestedCustomerId) return { ok: false, reason: "PROVENANCE_MISMATCH" };
  if (
    !isRecord(value.summary) ||
    !hasOnlyKeys(value.summary, [
      "totalOrders",
      "totalSpentTaxIncl",
      "averageOrderValueTaxIncl",
      "firstOrderAt",
      "lastOrderAt",
      "daysSinceLastOrder",
      "purchaseFrequencyDays",
      "totalUnitsPurchased",
      "distinctProductsPurchased",
      "cancelledOrderCount",
      "refundedOrderCount",
      "currencyIsoCode"
    ])
  ) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const totalOrders = asNonNegativeInteger(value.summary.totalOrders);
  const totalSpentTaxIncl = asDecimalString(value.summary.totalSpentTaxIncl);
  const averageOrderValueTaxIncl = asDecimalString(value.summary.averageOrderValueTaxIncl);
  const firstOrderAt = asNullableIsoDateString(value.summary.firstOrderAt);
  const lastOrderAt = asNullableIsoDateString(value.summary.lastOrderAt);
  const daysSinceLastOrder = value.summary.daysSinceLastOrder === null ? null : asNonNegativeInteger(value.summary.daysSinceLastOrder);
  const purchaseFrequencyDays = value.summary.purchaseFrequencyDays === null ? null : asNonNegativeInteger(value.summary.purchaseFrequencyDays);
  const totalUnitsPurchased = asNonNegativeInteger(value.summary.totalUnitsPurchased);
  const distinctProductsPurchased = asNonNegativeInteger(value.summary.distinctProductsPurchased);
  const cancelledOrderCount = asNonNegativeInteger(value.summary.cancelledOrderCount);
  const refundedOrderCount = asNonNegativeInteger(value.summary.refundedOrderCount);
  if (
    totalOrders === null ||
    totalSpentTaxIncl === null ||
    averageOrderValueTaxIncl === null ||
    !firstOrderAt.ok ||
    !lastOrderAt.ok ||
    daysSinceLastOrder === null && value.summary.daysSinceLastOrder !== null ||
    purchaseFrequencyDays === null && value.summary.purchaseFrequencyDays !== null ||
    totalUnitsPurchased === null ||
    distinctProductsPurchased === null ||
    cancelledOrderCount === null ||
    refundedOrderCount === null ||
    value.summary.currencyIsoCode !== "CLP"
  ) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const provenance = parseDataProvenance(value.provenance, requestedCustomerId);
  if (!provenance.ok) return provenance;
  return {
    ok: true,
    value: {
      status: "available",
      customerId,
      summary: {
        totalOrders,
        totalSpentTaxIncl,
        averageOrderValueTaxIncl,
        firstOrderAt: firstOrderAt.value,
        lastOrderAt: lastOrderAt.value,
        daysSinceLastOrder,
        purchaseFrequencyDays,
        totalUnitsPurchased,
        distinctProductsPurchased,
        cancelledOrderCount,
        refundedOrderCount,
        currencyIsoCode: "CLP"
      },
      provenance: provenance.value
    }
  };
}

export function parseCustomerPurchasedProductsResponse(value: unknown, requestedCustomerId: number): ParseSuccess<CustomerPurchasedProductsResponse> | ParseFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "customerId", "products", "pagination", "provenance"])) return { ok: false, reason: "INVALID_RESPONSE" };
  if (value.status !== "available") return { ok: false, reason: "INVALID_RESPONSE" };
  const customerId = asPositiveInteger(value.customerId);
  if (customerId === null) return { ok: false, reason: "INVALID_RESPONSE" };
  if (customerId !== requestedCustomerId) return { ok: false, reason: "PROVENANCE_MISMATCH" };
  if (!Array.isArray(value.products)) return { ok: false, reason: "INVALID_RESPONSE" };
  const products: Array<CustomerPurchasedProductsResponse["products"][number]> = [];
  for (const entry of value.products) {
    const parsed = parsePurchasedProduct(entry);
    if (parsed === null) return { ok: false, reason: "INVALID_RESPONSE" };
    products.push(parsed);
  }
  if (!isRecord(value.pagination) || !hasOnlyKeys(value.pagination, ["limit", "offset", "returned", "hasMore"])) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const limit = asNonNegativeInteger(value.pagination.limit);
  const offset = asNonNegativeInteger(value.pagination.offset);
  const returned = asNonNegativeInteger(value.pagination.returned);
  const hasMore = asBoolean(value.pagination.hasMore);
  if (limit === null || offset === null || returned === null || hasMore === null) return { ok: false, reason: "INVALID_RESPONSE" };
  const provenance = parseDataProvenance(value.provenance, requestedCustomerId);
  if (!provenance.ok) return provenance;
  return {
    ok: true,
    value: {
      status: "available",
      customerId,
      products,
      pagination: { limit, offset, returned, hasMore },
      provenance: provenance.value
    }
  };
}

export function parseCustomerPurchaseBehaviorResponse(value: unknown, requestedCustomerId: number): ParseSuccess<CustomerPurchaseBehaviorResponse> | ParseFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "customerId", "currencyIsoCode", "calculatedAt", "summary", "topProducts", "topVariants", "provenance"])) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  if (value.status !== "available") return { ok: false, reason: "INVALID_RESPONSE" };
  const customerId = asPositiveInteger(value.customerId);
  const calculatedAt = asIsoDateString(value.calculatedAt);
  if (customerId === null || calculatedAt === null) return { ok: false, reason: "INVALID_RESPONSE" };
  if (customerId !== requestedCustomerId) return { ok: false, reason: "PROVENANCE_MISMATCH" };
  if (value.currencyIsoCode !== "CLP") return { ok: false, reason: "INVALID_RESPONSE" };
  if (
    !isRecord(value.summary) ||
    !hasOnlyKeys(value.summary, [
      "validOrderCount",
      "distinctProductCount",
      "distinctVariantCount",
      "repeatedProductCount",
      "repeatedVariantCount",
      "repeatProductRate",
      "repeatVariantRate",
      "repeatedVariantSpendShare",
      "productSpendConcentration",
      "variantSpendConcentration"
    ])
  ) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const validOrderCount = asNonNegativeInteger(value.summary.validOrderCount);
  const distinctProductCount = asNonNegativeInteger(value.summary.distinctProductCount);
  const distinctVariantCount = asNonNegativeInteger(value.summary.distinctVariantCount);
  const repeatedProductCount = asNonNegativeInteger(value.summary.repeatedProductCount);
  const repeatedVariantCount = asNonNegativeInteger(value.summary.repeatedVariantCount);
  const repeatProductRate = asDecimalString(value.summary.repeatProductRate);
  const repeatVariantRate = asDecimalString(value.summary.repeatVariantRate);
  const repeatedVariantSpendShare = asDecimalString(value.summary.repeatedVariantSpendShare);
  const productSpendConcentration = parseConcentration(value.summary.productSpendConcentration);
  const variantSpendConcentration = parseConcentration(value.summary.variantSpendConcentration);
  if (
    validOrderCount === null ||
    distinctProductCount === null ||
    distinctVariantCount === null ||
    repeatedProductCount === null ||
    repeatedVariantCount === null ||
    repeatProductRate === null ||
    repeatVariantRate === null ||
    repeatedVariantSpendShare === null ||
    productSpendConcentration === null ||
    variantSpendConcentration === null
  ) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  if (!Array.isArray(value.topProducts) || !Array.isArray(value.topVariants)) return { ok: false, reason: "INVALID_RESPONSE" };
  const topProducts: Array<CustomerPurchaseBehaviorResponse["topProducts"][number]> = [];
  for (const entry of value.topProducts) {
    const parsed = parseBehaviorProduct(entry);
    if (parsed === null) return { ok: false, reason: "INVALID_RESPONSE" };
    topProducts.push(parsed);
  }
  const topVariants: Array<CustomerPurchaseBehaviorResponse["topVariants"][number]> = [];
  for (const entry of value.topVariants) {
    const parsed = parseBehaviorVariant(entry);
    if (parsed === null) return { ok: false, reason: "INVALID_RESPONSE" };
    topVariants.push(parsed);
  }
  const provenance = parseDataProvenance(value.provenance, requestedCustomerId);
  if (!provenance.ok) return provenance;
  return {
    ok: true,
    value: {
      status: "available",
      customerId,
      currencyIsoCode: "CLP",
      calculatedAt,
      summary: {
        validOrderCount,
        distinctProductCount,
        distinctVariantCount,
        repeatedProductCount,
        repeatedVariantCount,
        repeatProductRate,
        repeatVariantRate,
        repeatedVariantSpendShare,
        productSpendConcentration,
        variantSpendConcentration
      },
      topProducts,
      topVariants,
      provenance: provenance.value
    }
  };
}

export function parseCustomerOrderStatusResponse(value: unknown, requestedCustomerId: number): ParseSuccess<CustomerOrderStatusResponse> | ParseFailure {
  if (!isRecord(value) || !hasOnlyKeys(value, ["status", "customerId", "order", "provenance", "warnings"])) return { ok: false, reason: "INVALID_RESPONSE" };
  if (value.status !== "available") return { ok: false, reason: "INVALID_RESPONSE" };
  const customerId = asPositiveInteger(value.customerId);
  if (customerId === null) return { ok: false, reason: "INVALID_RESPONSE" };
  if (customerId !== requestedCustomerId) return { ok: false, reason: "PROVENANCE_MISMATCH" };
  if (
    !isRecord(value.order) ||
    !hasOnlyKeys(value.order, [
      "orderId",
      "reference",
      "currentStateId",
      "currentStateName",
      "deliveryMethod",
      "deliveryEstimate",
      "lastRecordedUpdateAt",
      "source",
      "isRealTimeTracking"
    ])
  ) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const orderId = asPositiveInteger(value.order.orderId);
  const reference = asNonEmptyString(value.order.reference);
  const currentStateId = asPositiveInteger(value.order.currentStateId);
  const currentStateName = asNullableString(value.order.currentStateName);
  const deliveryMethod = value.order.deliveryMethod;
  const deliveryEstimate = parseDeliveryEstimate(value.order.deliveryEstimate);
  const lastRecordedUpdateAt = asIsoDateString(value.order.lastRecordedUpdateAt);
  const source = value.order.source;
  const isRealTimeTracking = value.order.isRealTimeTracking;
  if (
    orderId === null ||
    reference === null ||
    currentStateId === null ||
    !currentStateName.ok ||
    (deliveryMethod !== "direct_dispatch" &&
      deliveryMethod !== "external_carrier" &&
      deliveryMethod !== "store_pickup" &&
      deliveryMethod !== "warehouse_pickup" &&
      deliveryMethod !== "event_pickup" &&
      deliveryMethod !== "unknown") ||
    deliveryEstimate === null ||
    lastRecordedUpdateAt === null ||
    source !== "prestashop_current_state" ||
    isRealTimeTracking !== false
  ) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const warnings = parseStringArray(value.warnings);
  if (warnings === null || !warnings.every((entry) => entry === "order_state_label_missing" || entry === "carrier_not_found" || entry === "delivery_method_unknown")) {
    return { ok: false, reason: "INVALID_RESPONSE" };
  }
  const provenance = parseDataProvenance(value.provenance, requestedCustomerId);
  if (!provenance.ok) return provenance;
  return {
    ok: true,
    value: {
      status: "available",
      customerId,
      order: {
        orderId,
        reference,
        currentStateId,
        currentStateName: currentStateName.value,
        deliveryMethod,
        deliveryEstimate,
        lastRecordedUpdateAt,
        source: "prestashop_current_state",
        isRealTimeTracking: false
      },
      provenance: provenance.value,
      warnings
    }
  };
}

export function parseCustomerProfileReadinessResponse(value: unknown): ParseSuccess<CustomerProfileReadinessResponse> | ParseFailure {
  if (!isRecord(value)) return { ok: false, reason: "INVALID_RESPONSE" };
  const common = ["status", "prestashop", "crm", "customerIdentitySource", "identityStatus", "contractVersion"] as const;
  const readyKeys = [...common] as const;
  const notReadyKeys = [...common, "reason"] as const;
  const status = value.status;
  if (status === "ready") {
    if (!hasOnlyKeys(value, readyKeys)) return { ok: false, reason: "INVALID_RESPONSE" };
    if (
      value.prestashop !== true ||
      asBoolean(value.crm) === null ||
      value.customerIdentitySource !== CUSTOMER_PROFILE_IDENTITY_SOURCE ||
      value.identityStatus !== CUSTOMER_PROFILE_IDENTITY_STATUS
    ) {
      return { ok: false, reason: "INVALID_RESPONSE" };
    }
    if (value.contractVersion !== CUSTOMER_PROFILE_CONTRACT_VERSION) return { ok: false, reason: "CONTRACT_VERSION_UNSUPPORTED" };
    return {
      ok: true,
      value: {
        status: "ready",
        prestashop: true,
        crm: value.crm as boolean,
        customerIdentitySource: CUSTOMER_PROFILE_IDENTITY_SOURCE,
        identityStatus: CUSTOMER_PROFILE_IDENTITY_STATUS,
        contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION
      }
    };
  }
  if (status === "not_ready") {
    if (!hasOnlyKeys(value, notReadyKeys)) return { ok: false, reason: "INVALID_RESPONSE" };
    if (
      value.prestashop !== false ||
      asBoolean(value.crm) === null ||
      value.customerIdentitySource !== CUSTOMER_PROFILE_IDENTITY_SOURCE ||
      value.identityStatus !== CUSTOMER_PROFILE_IDENTITY_STATUS ||
      (value.reason !== "prestashop_unavailable" && value.reason !== "prestashop_schema_incompatible")
    ) {
      return { ok: false, reason: "INVALID_RESPONSE" };
    }
    if (value.contractVersion !== CUSTOMER_PROFILE_CONTRACT_VERSION) return { ok: false, reason: "CONTRACT_VERSION_UNSUPPORTED" };
    return {
      ok: true,
      value: {
        status: "not_ready",
        prestashop: false,
        crm: value.crm as boolean,
        customerIdentitySource: CUSTOMER_PROFILE_IDENTITY_SOURCE,
        identityStatus: CUSTOMER_PROFILE_IDENTITY_STATUS,
        contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
        reason: value.reason
      }
    };
  }
  return { ok: false, reason: "INVALID_RESPONSE" };
}
