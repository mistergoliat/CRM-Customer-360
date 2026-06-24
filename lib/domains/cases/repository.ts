import { safeQueryRows } from "@/lib/db";
import { createLegacyN8nCaseRepository } from "@/lib/integrations/legacy-n8n/case-repository";
import type { CaseRepository } from "./contracts";

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

async function loadCustomerResolution(caseId: string) {
  const linkResult = await safeQueryRows<{ customer_id: string }>(
    "SELECT customer_id FROM customer_conversation_link WHERE conversation_case_id = ? LIMIT 1",
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

export function createDefaultCaseRepository(): CaseRepository {
  const adapter = createLegacyN8nCaseRepository();
  return {
    async list(filters) {
      const result = await adapter.list(filters);
      const rows = result.rows as Record<string, unknown>[];
      return {
        items: rows.map((row) => ({
          id: asText(row.conversation_case_id ?? row.case_id ?? row.id ?? "") ?? "",
          contactName: asText(row.contact_name),
          waId: asText(row.wa_id),
          status: asText(row.status),
          priority: asText(row.priority),
          department: asText(row.department),
          serviceCode: asText(row.service_code),
          requiresHuman: Boolean(row.requires_human),
          whatsappWindowOpen: Boolean(row.whatsapp_window_open),
          lastMessage: asText(row.last_message),
          lastMessageAt: asText(row.last_message_at),
          updatedAt: asText(row.updated_at),
          source: "legacy_n8n",
          href: `/cases/${asText(row.conversation_case_id ?? row.case_id ?? row.id ?? "") ?? ""}`
        })),
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total
        },
        meta: {
          mode: "real",
          source: "n8n_vw_hub_cases",
          warnings: result.error ? [result.error] : []
        }
      };
    },
    async getById(id: string) {
      const result = await adapter.getById(id);
      if (!result || !result.caseRow) return null;
      const row = result.caseRow;
      const caseId = asText(row.conversation_case_id ?? row.case_id ?? row.id ?? id) ?? id;
      const timeline = result.timeline.map((entry) => entry);
      const resolution = await loadCustomerResolution(caseId);
      return {
        caseRow: row,
        timeline: {
          caseId,
          source: result.timelineSource,
          rows: timeline,
          warnings: result.warnings
        },
        customerResolutionStatus: resolution.status,
        customerId: resolution.customerId,
        customerEmail: resolution.customerEmail,
        customerName: resolution.customerName,
        customerPlatformOrigin: resolution.customerPlatformOrigin,
        meta: {
          mode: "real",
          source: "n8n_vw_hub_cases",
          warnings: result.warnings
        },
        warnings: [...result.warnings, ...resolution.warnings]
      };
    },
    async getTimeline(id: string) {
      const result = await adapter.getTimeline(id);
      const caseId = asText(result.caseRow?.conversation_case_id ?? result.caseRow?.case_id ?? result.caseRow?.id ?? id) ?? id;
      return {
        caseId,
        source: result.timelineSource,
        rows: result.timeline,
        warnings: result.warnings
      };
    }
  };
}
