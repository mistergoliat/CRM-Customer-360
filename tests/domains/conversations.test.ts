import assert from "node:assert/strict";
import test from "node:test";
import { createConversationService } from "../../lib/domains/conversations/service";

test("conversations list maps repository data", async () => {
  const service = createConversationService({
    repository: {
      list: async () => ({
        items: [
          {
            id: "101",
            contactName: "Camila Rojas",
            waId: "56911111111",
            status: "open",
            priority: "high",
            department: "ventas",
            serviceCode: "quote_requested",
            requiresHuman: true,
            whatsappWindowOpen: true,
            lastMessage: "Hola",
            lastMessageAt: "2026-06-24T12:00:00.000Z",
            owner: "ventas",
            source: "legacy_n8n",
            href: "/conversations/101"
          }
        ],
        pagination: { page: 1, pageSize: 30, total: 1 },
        meta: { mode: "real", source: "n8n_vw_hub_cases", warnings: [], status: "real" }
      }),
      getById: async () => null
    }
  });

  const result = await service.list({ page: 1 });
  assert.equal(result.items[0].contactName, "Camila Rojas");
  assert.equal(result.meta.source, "n8n_vw_hub_cases");
});

test("conversations detail surfaces data quality warnings", async () => {
  const service = createConversationService({
    repository: {
      list: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 30, total: 0 },
        meta: { mode: "real", source: "n8n_vw_hub_cases", warnings: [], status: "real" }
      }),
      getById: async () => ({
        conversation: {
          id: "101",
          contactName: "Camila Rojas",
          waId: "56911111111",
          status: "open",
          priority: "high",
          department: "ventas",
          serviceCode: "quote_requested",
          requiresHuman: true,
          whatsappWindowOpen: true,
          lastMessage: "Hola",
          lastMessageAt: "2026-06-24T12:00:00.000Z",
          owner: "ventas",
          source: "legacy_n8n",
          href: "/conversations/101"
        },
        customerResolutionStatus: "linked",
        customerId: "10",
        customerEmail: "camila@example.com",
        customerName: "Camila Rojas",
        customerPlatformOrigin: "whatsapp",
        messages: [
          {
            key: "m1",
            source: "n8n_wa_inbound_messages",
            direction: "inbound",
            body: "Hola",
            occurredAt: "2026-06-24T11:59:00.000Z",
            status: "delivered",
            timelineSource: "n8n_wa_inbound_messages"
          }
        ],
        customer: {
          state: "partial",
          source: "legacy_n8n",
          warnings: ["timeline_fallback_by_wa_id"],
          summary: "Fallback by wa_id"
        },
        case: {
          state: "real",
          source: "legacy_n8n",
          warnings: [],
          summary: "Caso vinculado"
        },
        dataQuality: {
          status: "partial",
          warnings: ["timeline_fallback_by_wa_id"],
          source: "legacy_n8n"
        },
        warnings: ["timeline_fallback_by_wa_id"],
        meta: { mode: "real", source: "n8n_vw_hub_cases", warnings: ["timeline_fallback_by_wa_id"], status: "real" }
      })
    }
  });

  const detail = await service.getById("101");
  assert.equal(detail?.dataQuality.status, "partial");
  assert.deepEqual(detail?.dataQuality.warnings, ["timeline_fallback_by_wa_id"]);
});

test("conversations detail returns null for missing rows", async () => {
  const service = createConversationService({
    repository: {
      list: async () => ({
        items: [],
        pagination: { page: 1, pageSize: 30, total: 0 },
        meta: { mode: "real", source: "n8n_vw_hub_cases", warnings: [], status: "empty" }
      }),
      getById: async () => null
    }
  });

  const detail = await service.getById("missing");
  assert.equal(detail, null);
});
