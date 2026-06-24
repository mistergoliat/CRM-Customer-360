import { auditCustomerOnboardingEvent } from "@/lib/brain/commercial/customer-onboarding/audit";
import { loadCustomerConversationLink, persistCustomerConversationLink } from "@/lib/brain/commercial/customer-onboarding/state";

export async function linkCustomerToConversation(input: {
  customerId: string;
  conversationCaseId: string | number;
  source?: "ai_sdr" | "operator" | "system";
  confidence?: "high" | "medium" | "low";
  correlationId?: string | null;
}) {
  const existing = await loadCustomerConversationLink(input.conversationCaseId);
  if (existing.ok && existing.link) {
    if (existing.link.customerId === input.customerId) {
      return { status: "already_linked" as const, link: existing.link, warnings: existing.warnings };
    }
    await auditCustomerOnboardingEvent({
      action: "customer.link.failed",
      customerId: input.customerId,
      conversationCaseId: input.conversationCaseId,
      payload: {
        status: "conflict",
        existingCustomerId: existing.link.customerId,
        customerId: input.customerId,
        correlationId: input.correlationId ?? null
      }
    });
    return { status: "conflict" as const, link: existing.link, warnings: ["conversation_case_already_linked"] };
  }

  const persisted = await persistCustomerConversationLink({
    customerId: input.customerId,
    conversationCaseId: input.conversationCaseId,
    linkSource: input.source ?? "ai_sdr",
    confidence: input.confidence ?? "high"
  });
  if (!persisted.ok || !persisted.link) {
    await auditCustomerOnboardingEvent({
      action: "customer.link.failed",
      customerId: input.customerId,
      conversationCaseId: input.conversationCaseId,
      payload: {
        status: persisted.status,
        warnings: persisted.warnings,
        correlationId: input.correlationId ?? null
      }
    });
    return { status: "unavailable" as const, warnings: persisted.warnings };
  }

  await auditCustomerOnboardingEvent({
    action: "customer.linked",
    customerId: input.customerId,
    conversationCaseId: input.conversationCaseId,
    payload: {
      customerId: input.customerId,
      conversationCaseId: input.conversationCaseId,
      source: input.source ?? "ai_sdr",
      confidence: input.confidence ?? "high",
      correlationId: input.correlationId ?? null
    }
  });

  return { status: persisted.status, link: persisted.link, warnings: persisted.warnings };
}
