import { CREATE_CUSTOMER_ALLOWED_PURPOSES, type CreateCustomerCommercialPurpose } from "@/lib/domains/customer-service";
import type { CustomerOnboardingPurpose } from "@/lib/domains/customer-onboarding";

/**
 * The single, typed mapping from real operation/capability/intent names to
 * onboarding purposes (task section 8). Deliberately an allowlist: any
 * operation not listed here never activates onboarding - consultas
 * generales, busqueda, precio, disponibilidad, recomendacion, comparacion y
 * explicacion tecnica must all resolve to `null` by omission, not by a
 * denylist that could miss a future action name.
 *
 * Keys are real identifiers already used in this codebase:
 * - multi-request canonical intents (lib/brain/commercial/multi-request/turnPlannerProvider.ts)
 * - legacy Sales Agent decision/action types (lib/brain/commercial/salesAgentTypes.ts)
 * - the identity capabilities themselves, when a plan explicitly proposes them
 */
const OPERATION_TO_ONBOARDING_PURPOSE: Record<string, CustomerOnboardingPurpose> = {
  // multi-request canonical intents
  product_quote: "quote",
  maintenance_quote: "quote",
  order_status: "order_inquiry",
  complaint: "complaint",
  warranty: "warranty",

  // legacy Sales Agent decision/action types
  request_quote_draft: "quote",
  create_quote_draft: "quote",
  request_order_lookup: "order_inquiry",

  // explicit identity capability proposals
  create_customer: "account_update",
  link_external_identity: "account_update"
};

export function mapOperationToOnboardingPurpose(operation: string): CustomerOnboardingPurpose | null {
  return OPERATION_TO_ONBOARDING_PURPOSE[operation] ?? null;
}

export function operationRequiresIdentity(operation: string): boolean {
  return operation in OPERATION_TO_ONBOARDING_PURPOSE;
}

/**
 * Onboarding purposes cover historical operations (order_inquiry, complaint,
 * warranty, return) that create_customer must never authorize (contract
 * section 4/7). Purposes with no create_customer equivalent map to null on
 * purpose - evaluateCreateCustomerAuthority then denies them for not being
 * in CREATE_CUSTOMER_ALLOWED_PURPOSES, which is the correct outcome, not a
 * special case handled here.
 */
const ONBOARDING_PURPOSE_TO_COMMERCIAL_PURPOSE: Partial<Record<CustomerOnboardingPurpose, CreateCustomerCommercialPurpose>> = {
  quote: "quote",
  purchase: "purchase",
  account_update: "account_request"
};

export function mapOnboardingPurposeToCommercialPurpose(purpose: CustomerOnboardingPurpose | null | undefined): CreateCustomerCommercialPurpose | null {
  if (!purpose) return null;
  return ONBOARDING_PURPOSE_TO_COMMERCIAL_PURPOSE[purpose] ?? null;
}

export function isAllowedCreateCustomerPurpose(purpose: string): purpose is CreateCustomerCommercialPurpose {
  return (CREATE_CUSTOMER_ALLOWED_PURPOSES as readonly string[]).includes(purpose);
}
