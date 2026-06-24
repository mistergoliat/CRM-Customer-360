import { getCustomerById, findCustomerByEmail } from "@/lib/domains/customers";
import { listChats } from "@/lib/chats";
import { listCases } from "@/lib/cases";
import type { CustomerOnboardingCustomerContext } from "@/lib/brain/commercial/customer-onboarding/types";

export async function getCustomerContext(input: { customerId?: string | null; email?: string | null; conversationCaseId?: string | number | null }): Promise<CustomerOnboardingCustomerContext> {
  const warnings: string[] = [];
  let customer = null;

  if (input.customerId) {
    const byId = await getCustomerById(input.customerId);
    customer = byId?.customer ?? null;
    if (!byId) warnings.push("customer_not_found");
  }

  if (!customer && input.email) {
    const byEmail = await findCustomerByEmail(input.email);
    customer = byEmail?.customer ?? null;
    if (!byEmail) warnings.push("customer_lookup_failed");
  }

  const email = customer?.email ?? input.email ?? null;
  const conversationSearch = email ? await listChats({ q: email, page: 1 }) : null;
  const caseSearch = email ? await listCases({ q: email, page: 1 }) : null;

  return {
    customer,
    recentConversations:
      conversationSearch && !conversationSearch.error
        ? conversationSearch.rows.slice(0, 5).map((row) => ({
            id: String(row.conversation_case_id),
            label: String(row.contact_name ?? row.wa_id ?? "Conversation"),
            href: `/conversations/${row.conversation_case_id}`,
            meta: String(row.status ?? row.priority ?? "")
          }))
        : [],
    openCases:
      caseSearch && !caseSearch.error
        ? caseSearch.rows.slice(0, 5).map((row) => ({
            id: String(row.conversation_case_id ?? row.id ?? ""),
            label: String(row.contact_name ?? row.wa_id ?? "Case"),
            href: `/cases/${row.conversation_case_id ?? row.id ?? ""}`,
            meta: String(row.status ?? row.priority ?? "")
          }))
        : [],
    recentOrders: [],
    warnings,
    dataQuality: {
      status: customer ? "partial" : "unavailable",
      warnings,
      source: "customer_master"
    }
  };
}
