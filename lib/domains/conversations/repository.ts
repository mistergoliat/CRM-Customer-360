import { safeQueryRows } from "@/lib/db";
import { createLegacyN8nConversationRepository } from "@/lib/integrations/legacy-n8n/conversation-repository";
import type { ConversationRepository } from "./contracts";
import type { ConversationDetailReadModel } from "./types";

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

async function loadCustomerResolution(caseId: string) {
  const linkResult = await safeQueryRows<{ customer_id: string; link_status: string; link_source: string; confidence: string }>(
    "SELECT customer_id, link_status, link_source, confidence FROM customer_conversation_link WHERE conversation_case_id = ? LIMIT 1",
    [caseId]
  );

  if (!linkResult.ok) {
    return {
      status: "unknown" as const,
      customerId: null as string | null,
      customerEmail: null as string | null,
      customerName: null as string | null,
      customerPlatformOrigin: null as string | null,
      warnings: [linkResult.error]
    };
  }

  const link = linkResult.rows[0] ?? null;
  if (!link) {
    return {
      status: "unresolved" as const,
      customerId: null as string | null,
      customerEmail: null as string | null,
      customerName: null as string | null,
      customerPlatformOrigin: null as string | null,
      warnings: []
    };
  }

  const customerResult = await safeQueryRows<{ id: string; firstname: string; lastname: string; email: string; platform_origin: string | null }>(
    "SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE id = ? LIMIT 1",
    [link.customer_id]
  );

  if (!customerResult.ok) {
    return {
      status: "unknown" as const,
      customerId: link.customer_id,
      customerEmail: null as string | null,
      customerName: null as string | null,
      customerPlatformOrigin: null as string | null,
      warnings: [customerResult.error]
    };
  }

  const customer = customerResult.rows[0] ?? null;
  return {
    status: customer ? ("linked" as const) : ("found" as const),
    customerId: customer ? String(customer.id) : link.customer_id,
    customerEmail: customer ? asText(customer.email) : null,
    customerName: customer ? `${customer.firstname ?? ""} ${customer.lastname ?? ""}`.trim() || null : null,
    customerPlatformOrigin: customer?.platform_origin ?? null,
    warnings: []
  };
}

export function createDefaultConversationRepository(): ConversationRepository {
  const adapter = createLegacyN8nConversationRepository();
  return {
    async list(input) {
      const result = await adapter.list(input);
      return {
        items: result.items.map((item) => ({
          id: String(item.conversation_case_id),
          contactName: item.contact_name,
          waId: item.wa_id,
          status: item.status,
          priority: item.priority,
          department: item.department,
          serviceCode: item.service_code,
          requiresHuman: Boolean(item.requires_human),
          whatsappWindowOpen: Boolean(item.whatsapp_window_open),
          lastMessage: item.last_message,
          lastMessageAt: item.last_message_at,
          owner: item.department,
          source: "legacy_n8n",
          href: `/conversations/${item.conversation_case_id}`
        })),
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total
        },
        meta: {
          mode: "real",
          source: "n8n_vw_hub_cases",
          warnings: result.warnings
        }
      };
    },
    async getById(id: string) {
      const result = await adapter.getById(id);
      if (!result) return null;

      const resolution = await loadCustomerResolution(id);
      const conversation = result.listItem
        ? {
            id: String(result.listItem.conversation_case_id),
            contactName: result.listItem.contact_name,
            waId: result.listItem.wa_id,
            status: result.listItem.status,
            priority: result.listItem.priority,
            department: result.listItem.department,
            serviceCode: result.listItem.service_code,
            requiresHuman: Boolean(result.listItem.requires_human),
            whatsappWindowOpen: Boolean(result.listItem.whatsapp_window_open),
            lastMessage: result.listItem.last_message,
            lastMessageAt: result.listItem.last_message_at,
            owner: result.listItem.department,
            source: "legacy_n8n",
            href: `/conversations/${result.listItem.conversation_case_id}`,
            customerResolutionStatus: resolution.status,
            customerId: resolution.customerId,
            customerEmail: resolution.customerEmail,
            customerName: resolution.customerName,
            customerPlatformOrigin: resolution.customerPlatformOrigin
          }
        : null;

      const dataQualityWarnings = [...result.warnings, ...resolution.warnings];
      if (!result.context) {
        dataQualityWarnings.push("conversation_context_missing");
      }

      return {
        conversation,
        messages: result.messages.map((message) => ({
          key: message.key,
          source: message.source,
          direction: message.direction,
          body: message.body,
          occurredAt: message.occurredAt,
          status: message.status,
          timelineSource: message.source
        })),
        customerResolutionStatus: resolution.status,
        customerId: resolution.customerId,
        customerEmail: resolution.customerEmail,
        customerName: resolution.customerName,
        customerPlatformOrigin: resolution.customerPlatformOrigin,
        customer: {
          state: conversation ? "partial" : "unavailable",
          source: "legacy_n8n",
          warnings: dataQualityWarnings,
          summary: conversation ? `Conversacion ${conversation.id} encontrada.` : "Conversacion no encontrada."
        },
        case: {
          state: result.caseRow ? "real" : "partial",
          source: "legacy_n8n",
          warnings: result.caseRow ? [] : ["case_row_missing"],
          summary: result.caseRow ? `Caso ${asText(result.caseRow.conversation_case_id ?? result.caseRow.id) ?? id} vinculado.` : "Caso relacionado no disponible."
        },
        dataQuality: {
          status: dataQualityWarnings.length > 0 ? "partial" : "valid",
          warnings: dataQualityWarnings,
          source: "legacy_n8n"
        },
        warnings: dataQualityWarnings,
        meta: {
          mode: "real",
          source: "n8n_vw_hub_cases",
          warnings: dataQualityWarnings
        }
      } satisfies ConversationDetailReadModel;
    }
  };
}
