import { findMasterCustomerByEmail } from "@/lib/domains/customer-identity-onboarding";
import { auditCustomerOnboardingEvent } from "@/lib/brain/commercial/customer-onboarding/audit";
import type { CustomerLookupResult } from "@/lib/brain/commercial/customer-onboarding/types";
import { normalizeCustomerEmail } from "@/lib/domains/customers/email";
import { isRealCustomerEmail } from "@/lib/domains/customers/email";

export async function lookupCustomerByEmail(input: { email: string; conversationCaseId?: string | number | null; correlationId?: string | null }): Promise<CustomerLookupResult> {
  const normalizedEmail = normalizeCustomerEmail(input.email);
  if (!normalizedEmail || !isRealCustomerEmail(normalizedEmail)) {
    await auditCustomerOnboardingEvent({
      action: "customer.lookup.completed",
      conversationCaseId: input.conversationCaseId ?? null,
      payload: {
        email: normalizedEmail,
        status: "error",
        warning: "invalid_email",
        correlationId: input.correlationId ?? null
      }
    });
    return { status: "error", warning: "invalid_email", warnings: ["invalid_email"] };
  }

  const match = await findMasterCustomerByEmail(normalizedEmail);

  if (match.status === "error") {
    await auditCustomerOnboardingEvent({
      action: "customer.lookup.completed",
      conversationCaseId: input.conversationCaseId ?? null,
      payload: {
        email: normalizedEmail,
        status: "error",
        warning: "customer_lookup_failed",
        correlationId: input.correlationId ?? null
      }
    });
    return { status: "error", warning: "customer_lookup_failed", warnings: [] };
  }

  if (match.status === "matched") {
    await auditCustomerOnboardingEvent({
      action: "customer.lookup.completed",
      customerId: match.customers[0]?.id ?? null,
      conversationCaseId: input.conversationCaseId ?? null,
      payload: {
        email: normalizedEmail,
        status: "found",
        customerId: match.customers[0]?.id ?? null,
        correlationId: input.correlationId ?? null
      }
    });
    return { status: "found", customer: match.customers[0], warnings: [] };
  }

  if (match.status === "conflict") {
    await auditCustomerOnboardingEvent({
      action: "customer.lookup.completed",
      conversationCaseId: input.conversationCaseId ?? null,
      payload: {
        email: normalizedEmail,
        status: "conflict",
        customerIds: match.customers.map((customer) => customer.id),
        correlationId: input.correlationId ?? null
      }
    });
    return { status: "conflict", candidates: match.customers, warnings: [] };
  }

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
