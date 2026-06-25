import { safeQueryRows } from "@/lib/db";
import { loadNativeConversationDetailByPublicId } from "@/lib/brain/native-whatsapp";
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

async function loadCustomerResolution(customerId: number | null) {
  if (!customerId) {
    return {
      status: "unresolved" as const,
      customerId: null as string | null,
      customerEmail: null as string | null,
      customerName: null as string | null,
      customerPlatformOrigin: null as string | null,
      warnings: [] as string[]
    };
  }

  const customerResult = await safeQueryRows<{ id: number | string; firstname: string; lastname: string; email: string; platform_origin: string | null }>(
    "SELECT id, firstname, lastname, email, platform_origin FROM master_customer WHERE id = ? LIMIT 1",
    [customerId]
  );
  if (!customerResult.ok) {
    return {
      status: "unknown" as const,
      customerId: String(customerId),
      customerEmail: null as string | null,
      customerName: null as string | null,
      customerPlatformOrigin: null as string | null,
      warnings: [customerResult.error]
    };
  }

  const customer = customerResult.rows[0] ?? null;
  return {
    status: customer ? ("linked" as const) : ("found" as const),
    customerId: customer ? String(customer.id) : String(customerId),
    customerEmail: customer ? asText(customer.email) : null,
    customerName: customer ? `${customer.firstname ?? ""} ${customer.lastname ?? ""}`.trim() || null : null,
    customerPlatformOrigin: customer?.platform_origin ?? null,
    warnings: []
  };
}

function isRecentWindowOpen(lastMessageAt: string | null) {
  if (!lastMessageAt) return false;
  const date = new Date(lastMessageAt);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() < 24 * 60 * 60 * 1000;
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

      const items = (rowsResult.ok ? rowsResult.rows : []).map((row) => ({
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
        href: `/conversations/${asText(row.public_id) ?? row.id}`
      }));

      return {
        items,
        pagination: {
          page,
          pageSize,
          total: countResult.ok ? Number(countResult.rows[0]?.total ?? items.length) : items.length
        },
        meta: {
          mode: "real" as const,
          source: "conversation",
          warnings: rowsResult.ok ? [] : [rowsResult.error]
        }
      };
    },
    async getById(id: string) {
      const detail = await loadNativeConversationDetailByPublicId(id);
      if (!detail) return null;

      const customerResolution = await loadCustomerResolution(detail.conversation.customer_id);
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
          warnings: dataQualityWarnings
        }
      } satisfies ConversationDetailReadModel;
    }
  };
}
