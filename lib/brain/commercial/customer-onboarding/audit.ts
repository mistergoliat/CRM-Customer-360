import { auditLog } from "@/lib/audit";

export async function auditCustomerOnboardingEvent(input: {
  action: Parameters<typeof auditLog>[0]["action"];
  customerId?: string | number | null;
  conversationCaseId?: string | number | null;
  payload?: Record<string, unknown>;
}) {
  await auditLog({
    action: input.action,
    entityType: "customer_onboarding",
    entityId: input.conversationCaseId ?? input.customerId ?? null,
    after: input.payload ?? {}
  });
}
