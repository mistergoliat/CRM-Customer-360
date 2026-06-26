import { safeQueryRows } from "@/lib/db";
import { loadNativeConversationDetailByPublicId } from "@/lib/brain/native-whatsapp";
import type { ConversationRepository } from "./contracts";
import type { ConversationDetailReadModel } from "./types";
import { findDistinctCustomersByNormalizedValue } from "@/lib/integrations/customer-external-identity";

function asText(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  const numeric = asNumber(value);
  if (numeric !== null) return numeric !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function isRecentWindowOpen(lastMessageAt: string | null) {
  if (!lastMessageAt) return false;
  const date = new Date(lastMessageAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < 24 * 60 * 60 * 1000;
}

function buildConversationListError(page: number, error: string) {
  return {
    items: [],
    pagination: { page, pageSize: 25, total: 0 },
    meta: {
      mode: "real" as const,
      source: "conversation",
      warnings: [error],
      status: "error" as const
    },
    error
  };
}

function buildConversationListItem(row: Record<string, unknown>, resolution: CustomerResolutionResult) {
  return {
    id: asText(row.public_id) ?? String(row.id),
    contactName: ([asText(row.customer_firstname), asText(row.customer_lastname)].filter(Boolean).join(" ").trim() || asText(row.external_contact_id)) ?? null,
    waId: asText(row.external_contact_id),
    status: asText(row.status),
    priority: asBoolean(row.human_owner_active) ? "high" : asBoolean(row.ai_enabled) ? "normal" : "low",
    department: asBoolean(row.human_owner_active) ? "human_handoff" : "ai_sdr",
    serviceCode: asText(row.channel),
    requiresHuman: asBoolean(row.human_owner_active) || !asBoolean(row.ai_enabled),
    whatsappWindowOpen: isRecentWindowOpen(asText(row.last_message_at)),
    lastMessage: asText(row.last_message),
    lastMessageAt: asText(row.last_message_at),
    owner: asText(row.owner_type),
    source: "native_mariadb",
    href: `/conversations/${asText(row.public_id) ?? row.id}`,
    customerResolutionStatus: resolution.status,
    customerId: resolution.customerId,
    customerEmail: resolution.customerEmail,
    customerName: resolution.customerName,
    customerPlatformOrigin: resolution.customerPlatformOrigin
  };
}

function buildConversationDetailError(publicId: string, error: string): ConversationDetailReadModel {
  return {
    conversation: null,
    messages: [],
    customerResolutionStatus: "unknown",
    customerId: null,
    customerEmail: null,
    customerName: null,
    customerPlatformOrigin: null,
    opportunity: null,
    salesNeedProfile: null,
    lastDecision: null,
    actions: [],
    customer: {
      state: "error",
      source: "native_mariadb",
      warnings: [error],
      summary: "Error al cargar el customer."
    },
    case: {
      state: "error",
      source: "native_mariadb",
      warnings: [error],
      summary: `Error al cargar la conversacion ${publicId}.`
    },
    dataQuality: {
      status: "error",
      warnings: [error],
      source: "native_mariadb"
    },
    warnings: [error],
    meta: {
      mode: "real",
      source: "conversation",
      warnings: [error],
      status: "error"
    },
    error
  };
}

type CustomerResolutionStatus = "unresolved" | "found" | "linked" | "conflict" | "unknown";

type CustomerResolutionResult = {
  status: CustomerResolutionStatus;
  customerId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  customerPlatformOrigin: string | null;
  warnings: string[];
  error: string | null;
};

async function loadConversationCustomerResolution(input: { customerId: number | null; externalContactId: string | null }): Promise<CustomerResolutionResult> {
  if (!input.customerId && !input.externalContactId) {
    return {
      status: "unresolved",
      customerId: null,
      customerEmail: null,
      customerName: null,
      customerPlatformOrigin: null,
      warnings: [],
      error: null
    };
  }

  const distinctResult = input.externalContactId
    ? await findDistinctCustomersByNormalizedValue("whatsapp", input.externalContactId)
    : { ok: true as const, customerIds: [] as number[], error: null as string | null };
  if (!distinctResult.ok) {
    return {
      status: "unknown",
      customerId: input.customerId ? String(input.customerId) : null,
      customerEmail: null,
      customerName: null,
      customerPlatformOrigin: null,
      warnings: [distinctResult.error],
      error: distinctResult.error
    };
  }

  const distinctCustomerIds = distinctResult.customerIds;
  const hasConflict = input.customerId !== null
    ? distinctCustomerIds.length > 1 || (distinctCustomerIds.length === 1 && Number(distinctCustomerIds[0]) !== Number(input.customerId))
    : distinctCustomerIds.length > 1;

  const customerIdToLoad =
    input.customerId ??
    (distinctCustomerIds.length === 1 ? distinctCustomerIds[0] : null);

  const customerResult = customerIdToLoad === null
    ? { ok: true as const, rows: [] as Array<{ id: number; firstname: string; lastname: string; email: string; platform_origin: string | null }>, error: null as string | null }
    : await safeQueryRows<{ id: number; firstname: string; lastname: string; email: string; platform_origin: string | null }>(
        "SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE id = ? LIMIT 1",
        [customerIdToLoad]
      );
  if (!customerResult.ok) {
    return {
      status: "unknown",
      customerId: input.customerId ? String(input.customerId) : null,
      customerEmail: null,
      customerName: null,
      customerPlatformOrigin: null,
      warnings: [customerResult.error],
      error: customerResult.error
    };
  }

  const customer = customerResult.rows[0] ?? null;
  if (hasConflict) {
    return {
      status: "conflict",
      customerId: customer ? String(customer.id) : input.customerId ? String(input.customerId) : null,
      customerEmail: customer ? customer.email : null,
      customerName: customer ? `${customer.firstname} ${customer.lastname}`.trim() || null : null,
      customerPlatformOrigin: customer?.platform_origin ?? null,
      warnings: ["identity_conflict_customer_conversation_mismatch"],
      error: null
    };
  }

  if (input.customerId) {
    return {
      status: customer ? "linked" : "found",
      customerId: customer ? String(customer.id) : String(input.customerId),
      customerEmail: customer ? customer.email : null,
      customerName: customer ? `${customer.firstname} ${customer.lastname}`.trim() || null : null,
      customerPlatformOrigin: customer?.platform_origin ?? null,
      warnings: [],
      error: null
    };
  }

  if (customer) {
    return {
      status: "found",
      customerId: String(customer.id),
      customerEmail: customer.email,
      customerName: `${customer.firstname} ${customer.lastname}`.trim() || null,
      customerPlatformOrigin: customer.platform_origin ?? null,
      warnings: [],
      error: null
    };
  }

  return {
    status: "unresolved",
    customerId: null,
    customerEmail: null,
    customerName: null,
    customerPlatformOrigin: null,
    warnings: [],
    error: null
  };
}

export function createDefaultConversationRepository(): ConversationRepository {
  return {
    async list(input) {
      const pageSize = 25;
      const page = Math.max(1, Number(input.page ?? 1));
      const offset = (page - 1) * pageSize;
      const search = input.q?.trim() ?? "";
      const where: string[] = [];
      const params: Array<string | number> = [];

      if (search) {
        const term = `%${search.toLowerCase()}%`;
        where.push("(LOWER(c.external_contact_id) LIKE ? OR LOWER(c.public_id) LIKE ? OR LOWER(CONCAT_WS(' ', mc.firstname, mc.lastname)) LIKE ? OR LOWER(mc.email) LIKE ?)");
        params.push(term, term, term, term);
      }

      const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
      const countResult = await safeQueryRows<{ total: number }>(
        `
          SELECT COUNT(*) AS total
          FROM conversation c
          LEFT JOIN master_customer mc ON mc.id = c.customer_id
          ${whereSql}
        `,
        params
      );
      if (!countResult.ok) {
        return buildConversationListError(page, countResult.error);
      }

      const rowsResult = await safeQueryRows<Record<string, unknown>>(
        `
          SELECT
            c.id,
            c.public_id,
            c.channel,
            c.provider,
            c.channel_account_id,
            c.external_contact_id,
            c.external_thread_id,
            c.customer_id,
            c.status,
            c.owner_type,
            c.owner_id,
            c.ai_enabled,
            c.human_owner_active,
            c.last_message_at,
            c.last_inbound_at,
            c.last_outbound_at,
            c.created_at,
            c.updated_at,
            mc.firstname AS customer_firstname,
            mc.lastname AS customer_lastname,
            mc.email AS customer_email,
            mc.platform_origin AS customer_platform_origin,
            (
              SELECT cm.body
              FROM conversation_message cm
              WHERE cm.conversation_id = c.id
              ORDER BY cm.created_at DESC, cm.id DESC
              LIMIT 1
            ) AS last_message
          FROM conversation c
          LEFT JOIN master_customer mc ON mc.id = c.customer_id
          ${whereSql}
          ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC, c.id DESC
          LIMIT ${pageSize} OFFSET ${offset}
        `,
        params
      );
      if (!rowsResult.ok) {
        return buildConversationListError(page, rowsResult.error);
      }

      const items = await Promise.all(
        rowsResult.rows.map(async (row) => {
          const resolution = await loadConversationCustomerResolution({
            customerId: asNumber(row.customer_id),
            externalContactId: asText(row.external_contact_id)
          });
          return buildConversationListItem(row, resolution);
        })
      );

      const warnings = [...new Set(items.flatMap((item) => (item.customerResolutionStatus === "unknown" ? ["identity_resolution_partial"] : [])))];

      return {
        items,
        pagination: {
          page,
          pageSize,
          total: Number(countResult.rows[0]?.total ?? items.length)
        },
        meta: {
          mode: "real" as const,
          source: "conversation",
          warnings,
          status: items.length > 0 ? "real" : "empty"
        },
        error: null
      };
    },
    async getById(id: string) {
      const detail = await loadNativeConversationDetailByPublicId(id);
      if (!detail) return null;

      if (detail.error) {
        return buildConversationDetailError(id, detail.error);
      }

      const customerResolution = await loadConversationCustomerResolution({
        customerId: detail.conversation.customer_id,
        externalContactId: detail.conversation.external_contact_id
      });
      const conversation = {
        id: detail.conversation.public_id,
        contactName: detail.customer ? `${detail.customer.firstname} ${detail.customer.lastname}`.trim() : detail.conversation.external_contact_id,
        waId: detail.conversation.external_contact_id,
        status: detail.conversation.status,
        priority: detail.conversation.human_owner_active ? "high" : detail.conversation.ai_enabled ? "normal" : "low",
        department: detail.conversation.human_owner_active ? "human_handoff" : "ai_sdr",
        serviceCode: detail.conversation.channel,
        requiresHuman: Boolean(detail.conversation.human_owner_active) || !Boolean(detail.conversation.ai_enabled),
        whatsappWindowOpen: isRecentWindowOpen(detail.conversation.last_message_at),
        lastMessage: detail.messages[detail.messages.length - 1]?.body ?? null,
        lastMessageAt: detail.conversation.last_message_at,
        owner: detail.conversation.owner_type,
        source: "native_mariadb",
        href: `/conversations/${detail.conversation.public_id}`,
        customerResolutionStatus: customerResolution.status,
        customerId: customerResolution.customerId,
        customerEmail: customerResolution.customerEmail,
        customerName: customerResolution.customerName,
        customerPlatformOrigin: customerResolution.customerPlatformOrigin
      };

      const messages = detail.messages.map((message) => ({
        key: message.public_id,
        source: message.provider,
        direction: message.direction,
        body: message.body ?? "",
        occurredAt: message.provider_timestamp ?? message.created_at,
        status: message.status,
        timelineSource: message.provider
      }));

      const dataQualityWarnings = [...(detail.customer ? [] : ["customer_not_linked"])];
      if (!detail.conversation.customer_id) {
        dataQualityWarnings.push("customer_resolution_missing");
      }
      if (customerResolution.status === "conflict") {
        dataQualityWarnings.push("identity_conflict_customer_conversation_mismatch");
      }

      return {
        conversation,
        messages,
        customerResolutionStatus: customerResolution.status,
        customerId: customerResolution.customerId,
        customerEmail: customerResolution.customerEmail,
        customerName: customerResolution.customerName,
        customerPlatformOrigin: customerResolution.customerPlatformOrigin,
        opportunity: detail.opportunity
          ? {
              id: detail.opportunity.id,
              opportunityKey: detail.opportunity.opportunityKey,
              status: detail.opportunity.status,
              stage: detail.opportunity.stage,
              currentSummary: detail.opportunity.currentSummary,
              nextActionType: detail.opportunity.nextActionType,
              nextActionDueAt: detail.opportunity.nextActionDueAt,
              humanOwnerActive: detail.opportunity.humanOwnerActive,
              aiBlocked: detail.opportunity.aiBlocked
            }
          : null,
        salesNeedProfile: detail.profile ?? null,
        lastDecision: detail.lastDecision ?? null,
        actions: detail.actions ?? [],
        customer: {
          state: detail.customer ? "real" : "partial",
          source: "native_mariadb",
          warnings: dataQualityWarnings,
          summary: detail.customer
            ? `Cliente ${detail.customer.firstname} ${detail.customer.lastname} resuelto en MariaDB.`
            : "Cliente provisional sin resolver."
        },
        case: {
          state: detail.opportunity ? "real" : "partial",
          source: "native_mariadb",
          warnings: detail.opportunity ? [] : ["opportunity_missing"],
          summary: detail.opportunity
            ? `Oportunidad ${detail.opportunity.opportunityKey} vinculada a la conversación.`
            : "No hay oportunidad activa asociada."
        },
        dataQuality: {
          status: dataQualityWarnings.length > 0 ? "partial" : "valid",
          warnings: dataQualityWarnings,
          source: "native_mariadb"
        },
        warnings: dataQualityWarnings,
        meta: {
          mode: "real",
          source: "conversation",
          warnings: dataQualityWarnings,
          status: "real"
        }
      } satisfies ConversationDetailReadModel;
    }
  };
}
