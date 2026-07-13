import { createCustomerFromAuthorizedOnboarding, recordCustomerCreationConsent } from "@/lib/domains/customer-identity-onboarding";
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
  sourceMessageId?: string | null;
  occurredAt?: string | Date;
}) {
  if (input.conversationCaseId === null || input.conversationCaseId === undefined) {
    throw new Error("conversation_case_id_required");
  }
  if (!input.sourceMessageId?.trim()) {
    throw new Error("source_message_id_required");
  }

  const consent = await recordCustomerCreationConsent({
    conversationCaseId: input.conversationCaseId,
    email: input.email,
    granted: true,
    sourceMessageId: input.sourceMessageId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    channel: "whatsapp"
  });

  if (!consent.ok) {
    throw new Error(consent.warning ?? "customer_creation_consent_failed");
  }

  const created = await createCustomerFromAuthorizedOnboarding({
    conversationCaseId: input.conversationCaseId,
    email: input.email,
    firstname: input.firstname,
    lastname: input.lastname,
    platformOrigin: input.platformOrigin,
    sourceMessageId: input.sourceMessageId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    channel: "whatsapp"
  });

  if (created.status === "conflict") {
    throw new Error(created.warnings[0] ?? "customer_email_conflict");
  }

  if (created.status === "error") {
    throw new Error(created.warnings[0] ?? "customer_create_failed");
  }

  const customer = created.customer;

  await auditCustomerOnboardingEvent({
    action: created.status === "created" ? "customer.created" : "customer.identity_matched",
    customerId: customer?.id ?? null,
    conversationCaseId: input.conversationCaseId ?? null,
    payload: {
      customerId: customer?.id ?? null,
      source: created.status === "created" ? "hub_webapp" : "customer_identity_onboarding",
      changedFields: ["firstname", "lastname", "email", "platform_origin"],
      platformOrigin: input.platformOrigin,
      correlationId: input.correlationId ?? null
    }
  });

  return {
    customer,
    warnings: created.warnings
  };
}
