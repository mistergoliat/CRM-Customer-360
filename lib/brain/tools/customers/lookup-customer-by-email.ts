import { findCustomerByEmail } from "@/lib/domains/customers";
import { auditCustomerOnboardingEvent } from "@/lib/brain/commercial/customer-onboarding/audit";
import type { CustomerLookupResult } from "@/lib/brain/commercial/customer-onboarding/types";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function lookupCustomerByEmail(input: { email: string; conversationCaseId?: string | number | null; correlationId?: string | null }): Promise<CustomerLookupResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const customer = await findCustomerByEmail(normalizedEmail);

  if (!customer) {
    await auditCustomerOnboardingEvent({
      action: "customer.lookup.completed",
      conversationCaseId: input.conversationCaseId ?? null,
      payload: {
        email: normalizedEmail,
        status: "not_found",
        correlationId: input.correlationId ?? null
      }
    });
    return { status: "not_found", normalizedEmail, warnings: [] };
  }

  await auditCustomerOnboardingEvent({
    action: "customer.lookup.completed",
    customerId: customer.customer?.id ?? null,
    conversationCaseId: input.conversationCaseId ?? null,
    payload: {
      email: normalizedEmail,
      status: "found",
      customerId: customer.customer?.id ?? null,
      correlationId: input.correlationId ?? null
    }
  });

  return { status: "found", customer: customer.customer, warnings: customer.warnings };
}
