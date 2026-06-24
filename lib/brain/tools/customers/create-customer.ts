import { createCustomer } from "@/lib/domains/customers";
import { auditCustomerOnboardingEvent } from "@/lib/brain/commercial/customer-onboarding/audit";
import type { PlatformOrigin } from "@/lib/domains/customers/platform-origin";

export async function createCustomerTool(input: {
  firstname: string;
  lastname: string;
  email: string;
  platformOrigin: PlatformOrigin;
  customerConfirmed: true;
  conversationCaseId?: string | number | null;
  correlationId?: string | null;
}) {
  const created = await createCustomer({
    firstname: input.firstname,
    lastname: input.lastname,
    email: input.email,
    platformOrigin: input.platformOrigin
  });

  await auditCustomerOnboardingEvent({
    action: "customer.created",
    customerId: created.customer?.id ?? null,
    conversationCaseId: input.conversationCaseId ?? null,
    payload: {
      customerId: created.customer?.id ?? null,
      source: "hub_webapp",
      changedFields: ["firstname", "lastname", "email", "platform_origin"],
      platformOrigin: input.platformOrigin,
      correlationId: input.correlationId ?? null
    }
  });

  return created;
}
